// The spike's shell (docs/desktop-program-plan.md §5, §14 step 1). Throwaway.
//
// Starts Node as a sidecar with the core's bundle, sends `start` once the core
// says it is ready, and records every timing as a JSON line: on standard
// output (prefixed SPIKE), in the log folder's spike.jsonl, and to the page.
// Quitting sends `stop` and waits for the core to exit, up to five seconds,
// before the program ends. SPIKE_AUTOQUIT=1 quits half a second after the hub
// is listening, so a run can be timed from a terminal; SPIKE_PORT overrides 3101;
// SPIKE_LOG names the log file.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

static LAUNCHED: OnceLock<Instant> = OnceLock::new();

fn since_launch() -> u64 {
    LAUNCHED.get().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0)
}

fn ms(at: &Mutex<Option<Instant>>) -> Option<u64> {
    let at: Option<Instant> = *at.lock().unwrap();
    at.map(|t| t.elapsed().as_millis() as u64)
}

#[derive(Default)]
struct Core {
    child: Mutex<Option<CommandChild>>,
    spawned_at: Mutex<Option<Instant>>,
    start_sent_at: Mutex<Option<Instant>>,
    stop_sent_at: Mutex<Option<Instant>>,
    quitting: AtomicBool,
    stopped: AtomicBool,
    next_id: AtomicU64,
    log: Mutex<Option<PathBuf>>,
}

fn record(app: &AppHandle, value: Value) {
    let line = value.to_string();
    println!("SPIKE {line}");
    let path = app.state::<Core>().log.lock().unwrap().clone();
    if let Some(path) = path {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
    let _ = app.emit("spike", value);
}

fn send(app: &AppHandle, mut message: Value) {
    let core = app.state::<Core>();
    message["id"] = json!(core.next_id.fetch_add(1, SeqCst) + 1);
    let mut line = message.to_string();
    line.push('\n');
    let result = core.child.lock().unwrap().as_mut().map(|child| child.write(line.as_bytes()));
    if let Some(Err(err)) = result {
        record(app, json!({ "event": "write_failed", "error": err.to_string() }));
    }
}

fn settings(app: &AppHandle) -> Value {
    let dir = app
        .path()
        .app_local_data_dir()
        .map(|d| d.join("workspaces"))
        .unwrap_or_else(|_| PathBuf::from("workspaces"));
    let port: u16 = std::env::var("SPIKE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3101);
    // A fixed value for the spike; the program keeps a drawn one in the keychain (plan §7).
    json!({ "dir": dir, "port": port, "remote": "http://127.0.0.1:3100", "localToken": "spike-not-a-secret" })
}

fn spawn_core(app: &AppHandle) -> Result<(), String> {
    let script = app
        .path()
        .resolve("core/core.mjs", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let command = app
        .shell()
        .sidecar("armature-node")
        .map_err(|e| e.to_string())?
        .args([script.to_string_lossy().to_string()]);
    let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;
    let core = app.state::<Core>();
    *core.spawned_at.lock().unwrap() = Some(Instant::now());
    let pid = child.pid();
    *core.child.lock().unwrap() = Some(child);
    record(app, json!({ "event": "spawned", "pid": pid, "sinceLaunchMs": since_launch(), "script": script }));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        if !line.trim().is_empty() {
                            on_line(&app, line.trim());
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    record(&app, json!({ "event": "stderr", "line": String::from_utf8_lossy(&bytes).trim() }))
                }
                CommandEvent::Terminated(payload) => {
                    on_terminated(&app, payload.code, payload.signal);
                    break;
                }
                CommandEvent::Error(err) => record(&app, json!({ "event": "error", "error": err })),
                _ => {}
            }
        }
    });
    Ok(())
}

fn on_line(app: &AppHandle, line: &str) {
    let message: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return record(app, json!({ "event": "stdout", "line": line })),
    };
    let core = app.state::<Core>();
    if message["event"] == "ready" {
        record(app, json!({ "event": "ready", "spawnToReadyMs": ms(&core.spawned_at), "sinceLaunchMs": since_launch(), "core": message }));
        *core.start_sent_at.lock().unwrap() = Some(Instant::now());
        send(app, json!({ "op": "start", "settings": settings(app) }));
        return;
    }
    if message["op"] == "start" {
        record(app, json!({ "event": "started", "startToStartedMs": ms(&core.start_sent_at), "sinceLaunchMs": since_launch(), "core": message }));
        if message["ok"] == true && std::env::var("SPIKE_AUTOQUIT").as_deref() == Ok("1") {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                graceful_quit(&app, "SPIKE_AUTOQUIT");
            });
        }
        return;
    }
    record(app, json!({ "event": "reply", "core": message }));
}

fn on_terminated(app: &AppHandle, code: Option<i32>, signal: Option<i32>) {
    let core = app.state::<Core>();
    core.child.lock().unwrap().take();
    core.stopped.store(true, SeqCst);
    let expected = core.quitting.load(SeqCst);
    record(app, json!({ "event": "core_exited", "code": code, "signal": signal, "stopToExitMs": ms(&core.stop_sent_at), "expected": expected }));
    if expected {
        app.exit(0);
    }
}

fn graceful_quit(app: &AppHandle, reason: &str) {
    let core = app.state::<Core>();
    if core.quitting.swap(true, SeqCst) {
        return;
    }
    if core.stopped.load(SeqCst) || core.child.lock().unwrap().is_none() {
        core.stopped.store(true, SeqCst);
        app.exit(0);
        return;
    }
    record(app, json!({ "event": "quitting", "reason": reason }));
    *core.stop_sent_at.lock().unwrap() = Some(Instant::now());
    send(app, json!({ "op": "stop" }));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let core = app.state::<Core>();
        if core.stopped.load(SeqCst) {
            return;
        }
        let child = core.child.lock().unwrap().take();
        if let Some(child) = child {
            let _ = child.kill();
        }
        core.stopped.store(true, SeqCst);
        record(&app, json!({ "event": "stop_timed_out", "killed": true }));
        app.exit(0);
    });
}

#[tauri::command]
fn ping(app: AppHandle) {
    send(&app, json!({ "op": "ping" }));
}

#[tauri::command]
fn quit(app: AppHandle) {
    graceful_quit(&app, "button");
}

fn main() {
    LAUNCHED.set(Instant::now()).ok();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Core::default())
        .invoke_handler(tauri::generate_handler![ping, quit])
        .setup(|app| {
            let handle = app.handle().clone();
            // SPIKE_LOG names the file when a check script runs the shell (spike-check.mjs).
            let log = match std::env::var("SPIKE_LOG") {
                Ok(path) => Some(PathBuf::from(path)),
                Err(_) => handle.path().app_log_dir().ok().map(|dir| {
                    let _ = std::fs::create_dir_all(&dir);
                    dir.join("spike.jsonl")
                }),
            };
            *handle.state::<Core>().log.lock().unwrap() = log;
            record(
                &handle,
                json!({ "event": "launched", "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "pid": std::process::id(), "setupMs": since_launch() }),
            );
            if let Err(err) = spawn_core(&handle) {
                record(&handle, json!({ "event": "spawn_failed", "error": err }));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the spike's shell failed to build");
    app.run(|handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            if !handle.state::<Core>().stopped.load(SeqCst) {
                api.prevent_exit();
                graceful_quit(handle, "exit requested");
            }
        }
    });
}
