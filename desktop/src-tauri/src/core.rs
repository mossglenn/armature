//! The core as the shell runs it (docs/desktop-program-plan.md §5 and §9; ADR-0069 decisions 2 to
//! 4): Node as the sidecar `armature-node` with the core's bundle as its one argument, spoken to in
//! JSON lines over its standard input and output.
//!
//! The shell starts the hub itself: `start` with the data folder and the local token the keychain
//! kept, then, when the remote signs people in, `credential` with the refresh token the keychain
//! keeps for that remote. A local token the core drew comes back in the reply and goes to the
//! keychain; a rotated refresh token comes as an event and goes there too. The pages ask through
//! `core_request` (lib.rs), which forwards only what `relay::allowed_from_webview` allows.
//!
//! Quitting sends `stop`, waits up to five seconds for the hub to close and the folder's lock to be
//! released, then ends the sidecar: the core stays alive after `stop` (a paused hub), and only its
//! input's end or a kill ends it. A core that does not answer is killed and leaves its lock, which
//! the next start takes over (ADR-0069 decision 4).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::keychain;
use crate::logs::LogFiles;
use crate::relay::{self, EventAction, LineBuffer};

/// How long quitting waits for the core to stop the hub before ending it.
pub const STOP_WAIT: Duration = Duration::from_secs(5);

/// What the shell knows of the core and its hub; what `shell_state` answers the pages.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub core: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_dir: Option<String>,
    /// The remote the last `armature://connect` link named, kept so a page opened after the link
    /// (a cold launch by the link) still sees it; the connect page clears nothing, it confirms.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

#[derive(Default)]
pub struct Core {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    lines: Mutex<LineBuffer>,
    state: Mutex<ShellState>,
    /// The remote the settings name, from `start`'s reply and `connect`'s; the keychain's key.
    remote: Mutex<Option<String>>,
    data_dir: Mutex<Option<PathBuf>>,
    logs: Mutex<Option<LogFiles>>,
    quitting: AtomicBool,
    /// Set as the core's process ends, before anything else is done about it.
    core_exited: AtomicBool,
    /// Set just before the shell exits, so its own exit is not taken for a request to quit.
    pub exiting: AtomicBool,
}

impl Core {
    pub fn state(&self) -> ShellState {
        self.state.lock().unwrap().clone()
    }
}

fn set_state(app: &AppHandle, update: impl FnOnce(&mut ShellState)) {
    let core = app.state::<Core>();
    update(&mut core.state.lock().unwrap());
    crate::tray::refresh(app);
    let _ = app.emit("core-event", json!({ "event": "shell" }));
}

/// A connect link's remote: kept in the state, announced to the page, and the window brought forward.
pub fn linked(app: &AppHandle, remote: String) {
    say(app, "info", &format!("A link asked to connect to {remote}"));
    set_state(app, |s| s.link = Some(remote.clone()));
    let _ = app.emit("core-event", json!({ "event": "deep-link", "remote": remote }));
    crate::tray::show_window(app);
}

/// A line in the log files and on the log page, in the shell's own words.
pub fn say(app: &AppHandle, level: &str, line: &str) {
    if let Some(logs) = app.state::<Core>().logs.lock().unwrap().as_mut() {
        logs.write(level, line);
    }
    let _ = app.emit("core-event", json!({ "event": "log", "level": level, "line": line, "from": "shell" }));
}

/// Starts the sidecar and the hub. Called once, at setup.
pub fn launch(app: &AppHandle) -> Result<(), String> {
    let core = app.state::<Core>();
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("{}: {e}", data_dir.display()))?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    *core.logs.lock().unwrap() = Some(LogFiles::open(log_dir.clone()));
    *core.data_dir.lock().unwrap() = Some(data_dir.clone());
    set_state(app, |s| {
        s.core = "starting";
        s.data_dir = Some(data_dir.display().to_string());
        s.log_dir = Some(log_dir.display().to_string());
    });

    // Windows: Tauri resolves resources with the extended-length prefix (\\?\C:\...), which Node
    // cannot load as its entry script; dunce gives the plain path (ADR-0069 decision 6).
    let script = app.path().resolve("core/desktop.mjs", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let script = dunce::simplified(&script).to_string_lossy().to_string();
    let (mut rx, child) = app
        .shell()
        .sidecar("armature-node")
        .map_err(|e| e.to_string())?
        .args([script])
        .spawn()
        .map_err(|e| e.to_string())?;
    say(app, "info", &format!("The core started (process {})", child.pid()));
    *core.child.lock().unwrap() = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let lines = handle.state::<Core>().lines.lock().unwrap().push(&String::from_utf8_lossy(&bytes));
                    for line in lines {
                        on_line(&handle, &line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).lines().filter(|l| !l.trim().is_empty()) {
                        say(&handle, "error", line);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    on_terminated(&handle, payload.code);
                    break;
                }
                CommandEvent::Error(err) => say(&handle, "error", &format!("The core's pipe failed: {err}")),
                _ => {}
            }
        }
    });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move { start_hub(&handle).await });
    Ok(())
}

/// Sends a request and waits for its reply; an error when the core is gone.
pub async fn ask(app: &AppHandle, mut request: Value) -> Result<Value, String> {
    let core = app.state::<Core>();
    let id = core.next_id.fetch_add(1, SeqCst) + 1;
    request["id"] = json!(id);
    let (tx, rx) = oneshot::channel();
    core.pending.lock().unwrap().insert(id, tx);
    let mut line = request.to_string();
    line.push('\n');
    let written = match core.child.lock().unwrap().as_mut() {
        Some(child) => child.write(line.as_bytes()).map_err(|e| e.to_string()),
        None => Err("The core is not running".to_string()),
    };
    if let Err(err) = written {
        core.pending.lock().unwrap().remove(&id);
        return Err(err);
    }
    rx.await.map_err(|_| "The core ended before it answered".to_string())
}

/// `start`, then the keychain's refresh token for the remote it names; the shell's state follows.
pub async fn start_hub(app: &AppHandle) {
    let core = app.state::<Core>();
    let Some(data_dir) = core.data_dir.lock().unwrap().clone() else { return };
    set_state(app, |s| s.core = "starting");
    let mut request = json!({ "type": "start", "dataDir": data_dir.display().to_string() });
    match keychain::local_token() {
        Ok(Some(token)) => request["localToken"] = json!(token),
        Ok(None) => {}
        Err(err) => say(app, "warn", &format!("The keychain could not be read ({err}); a new pairing value is drawn at this start")),
    }
    let reply = match ask(app, request).await {
        Ok(reply) => reply,
        Err(err) => return set_state(app, |s| { s.core = "failed"; s.error = Some(err); }),
    };
    let body = reply["body"].clone();
    if reply["status"] != 200 {
        let message = body["message"].as_str().unwrap_or("The core could not start the hub").to_string();
        say(app, "error", &message);
        return set_state(app, |s| { s.core = "failed"; s.error = Some(message); s.started = None; });
    }
    if let Some(token) = body["localToken"].as_str() {
        if let Err(err) = keychain::keep_local_token(token) {
            say(app, "warn", &format!("The pairing value could not be kept in the keychain ({err}); a new one is drawn at the next start"));
        }
    }
    let remote = body["remote"].as_str().map(str::to_string).or_else(|| body["settings"]["remote"].as_str().map(str::to_string));
    *core.remote.lock().unwrap() = remote.clone();
    let running = body["started"] == true;
    set_state(app, |s| {
        s.core = if running { "running" } else { "stopped" };
        s.error = None;
        s.started = Some(relay::without_local_token(body.clone()));
    });
    if body["resolver"] == "oidc" {
        if let Some(remote) = remote {
            send_credential(app, &remote).await;
        }
    }
}

/// The keychain's refresh token for the remote, sent to the core (`credential`).
async fn send_credential(app: &AppHandle, remote: &str) {
    match keychain::refresh_token(remote) {
        Ok(Some(token)) => match ask(app, json!({ "type": "credential", "remote": remote, "refreshToken": token })).await {
            Ok(reply) if reply["status"] == 200 => set_state(app, |s| {
                if let Some(started) = s.started.as_mut() {
                    started["signedIn"] = json!(true);
                }
            }),
            Ok(reply) => say(app, "warn", reply["body"]["message"].as_str().unwrap_or("The core refused the kept credential")),
            Err(err) => say(app, "warn", &err),
        },
        Ok(None) => {}
        Err(err) => say(app, "warn", &format!("The keychain could not be read ({err}); sign in again")),
    }
}

/// `stop`: the hub closes and the folder's lock is released; the core stays for a later start.
pub async fn stop_hub(app: &AppHandle) -> Result<(), String> {
    let reply = ask(app, json!({ "type": "stop" })).await?;
    if reply["status"] != 200 {
        return Err(reply["body"]["message"].as_str().unwrap_or("The core could not stop the hub").to_string());
    }
    set_state(app, |s| {
        s.core = "stopped";
        if let Some(started) = s.started.as_mut() {
            started["started"] = json!(false);
        }
    });
    Ok(())
}

/// What the shell does after the core answers a page's request: the keychain follows the remote,
/// a sign-out and a new pairing value.
pub fn after_reply(app: &AppHandle, request_type: &str, reply: &Value) {
    if reply["status"] != 200 {
        return;
    }
    let core = app.state::<Core>();
    match request_type {
        "connect" => {
            *core.remote.lock().unwrap() = reply["body"]["settings"]["remote"].as_str().map(str::to_string);
        }
        "signOut" => {
            if let Some(remote) = core.remote.lock().unwrap().clone() {
                if let Err(err) = keychain::forget_refresh_token(&remote) {
                    say(app, "warn", &format!("The keychain's credential could not be removed ({err})"));
                }
            }
        }
        "resetPairing" => {
            if let Some(token) = reply["body"]["localToken"].as_str() {
                if let Err(err) = keychain::keep_local_token(token) {
                    say(app, "warn", &format!("The new pairing value could not be kept in the keychain ({err})"));
                }
            }
        }
        _ => {}
    }
}

fn on_line(app: &AppHandle, line: &str) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return say(app, "warn", &format!("The core wrote a line that is not JSON: {line}"));
    };
    let core = app.state::<Core>();
    // Once the program is ending, the main thread may be waiting on the core: only the log file is
    // written, since the tray and the page are reached through that thread.
    if core.exiting.load(SeqCst) {
        if relay::classify(&message) == EventAction::LogAndForward {
            if let Some(logs) = core.logs.lock().unwrap().as_mut() {
                logs.write(message["level"].as_str().unwrap_or("info"), message["line"].as_str().unwrap_or(""));
            }
        }
        if let Some(tx) = message.get("id").and_then(Value::as_u64).and_then(|id| core.pending.lock().unwrap().remove(&id)) {
            let _ = tx.send(message);
        }
        return;
    }
    if let Some(id) = message.get("id") {
        if let Some(tx) = id.as_u64().and_then(|id| core.pending.lock().unwrap().remove(&id)) {
            let _ = tx.send(message);
        } else {
            say(app, "warn", &format!("The core answered a request the shell did not send: {line}"));
        }
        return;
    }
    match relay::classify(&message) {
        EventAction::KeepCredential(token) => {
            let remote = core.remote.lock().unwrap().clone();
            match remote.map(|remote| keychain::keep_refresh_token(&remote, &token)) {
                Some(Ok(())) => {}
                Some(Err(err)) => say(app, "warn", &format!("The credential could not be kept in the keychain ({err}); sign in again at the next start")),
                None => say(app, "warn", "A credential arrived before the remote was known; it is not kept"),
            }
        }
        EventAction::OpenAndForward(url) => {
            if let Err(err) = app.opener().open_url(&url, None::<&str>) {
                say(app, "error", &format!("The browser could not be opened ({err}); open this address yourself: {url}"));
            }
            let _ = app.emit("core-event", message);
        }
        EventAction::ForgetCredentialAndForward => {
            if let Some(remote) = core.remote.lock().unwrap().clone() {
                let _ = keychain::forget_refresh_token(&remote);
            }
            let _ = app.emit("core-event", message);
        }
        EventAction::LogAndForward => {
            if let Some(logs) = core.logs.lock().unwrap().as_mut() {
                logs.write(message["level"].as_str().unwrap_or("info"), message["line"].as_str().unwrap_or(""));
            }
            let _ = app.emit("core-event", message);
        }
        EventAction::HubAndForward => {
            let running = message["state"] == "running";
            set_state(app, |s| s.core = if running { "running" } else { "stopped" });
            let _ = app.emit("core-event", message);
        }
        EventAction::Forward => {
            let _ = app.emit("core-event", message);
        }
        EventAction::Drop => {}
    }
}

fn on_terminated(app: &AppHandle, code: Option<i32>) {
    let core = app.state::<Core>();
    core.core_exited.store(true, SeqCst);
    core.child.lock().unwrap().take();
    // Every request waiting on the core learns it is gone.
    core.pending.lock().unwrap().clear();
    if core.exiting.load(SeqCst) {
        return;
    }
    if core.quitting.load(SeqCst) {
        core.exiting.store(true, SeqCst);
        return app.exit(0);
    }
    let message = format!("The core ended unexpectedly (exit code {}); quit and open the program again", code.map_or("none".to_string(), |c| c.to_string()));
    say(app, "error", &message);
    set_state(app, |s| { s.core = "failed"; s.error = Some(message); });
}

/// The last chance when the program ends without asking (macOS's quit, the Apple Event Cmd-Q
/// sends, ends the event loop with `Exit` and no `ExitRequested`). This runs on the main thread,
/// which the tray and the page need, so it does not ask the core and wait for a reply: it closes
/// the core's input, on which the core stops the hub and releases the folder's lock by itself
/// (ADR-0069 decision 4), and waits up to five seconds for its process to end. Nothing to do when
/// `quit` already ran.
pub fn stop_before_exit(app: &AppHandle) {
    let core = app.state::<Core>();
    if core.exiting.swap(true, SeqCst) {
        return;
    }
    if let Some(logs) = core.logs.lock().unwrap().as_mut() {
        logs.write("info", "The program is ending; the core stops the hub and releases the lock");
    }
    // Dropped, the child's end of the pipe closes; it is not killed (kill_on_drop is off).
    let child = core.child.lock().unwrap().take();
    drop(child);
    let deadline = std::time::Instant::now() + STOP_WAIT;
    while !core.core_exited.load(SeqCst) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    if !core.core_exited.load(SeqCst) {
        if let Some(logs) = core.logs.lock().unwrap().as_mut() {
            logs.write("warn", "The core had not ended when the program did; it stops on its own, or the next start takes over its lock");
        }
    }
}

/// Quits: `stop`, up to five seconds, then the sidecar is ended and the program exits.
pub fn quit(app: &AppHandle) {
    let core = app.state::<Core>();
    if core.quitting.swap(true, SeqCst) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let stopped = tokio::time::timeout(STOP_WAIT, stop_hub(&handle)).await;
        let core = handle.state::<Core>();
        if !matches!(stopped, Ok(Ok(()))) {
            say(&handle, "warn", "The core did not stop the hub in time; it is ended, and the next start takes over its lock");
        }
        core.exiting.store(true, SeqCst);
        if let Some(child) = core.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        handle.exit(0);
    });
}
