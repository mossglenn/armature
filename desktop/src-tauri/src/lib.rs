//! The Armature desktop program's shell (docs/desktop-program-plan.md §3; ADR-0069 decision 1):
//! the window, the keychain, the browser for the sign-in, and the core's life. It holds no logic
//! about workspaces, tokens or the hub beyond relaying: the core decides, and answers as the hub's
//! routes would.

mod core;
mod keychain;
mod logs;
mod relay;
mod tray;

use serde_json::{json, Value};
use std::sync::atomic::Ordering::SeqCst;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::core::{Core, ShellState};

/// A page's request to the core, forwarded when the page may send it; the reply is the core's,
/// `{ status, body }`, as the hub's route would answer.
#[tauri::command]
async fn core_request(app: AppHandle, request: Value) -> Result<Value, String> {
    let request_type = request.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
    if !relay::allowed_from_webview(&request_type) {
        return Ok(json!({ "status": 403, "body": { "error": "shell_only", "message": format!("{request_type} is the shell's own request, not a page's") } }));
    }
    let reply = core::ask(&app, request).await?;
    core::after_reply(&app, &request_type, &reply);
    Ok(reply)
}

/// The latest log lines, for a log page opened after them.
#[tauri::command]
fn log_lines(app: AppHandle) -> Vec<Value> {
    app.state::<Core>().recent_lines()
}

/// The pairing value every tool on the machine sends as `Armature-Local-Token` (plan §7), for the
/// pairing page alone; never in the shared state or the log.
#[tauri::command]
fn pairing_value(app: AppHandle) -> Option<String> {
    app.state::<Core>().local_token()
}

/// Opens the log folder in the system's file manager.
#[tauri::command]
fn open_log_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn shell_state(app: AppHandle) -> ShellState {
    app.state::<Core>().state()
}

/// Pauses or resumes the hub, as the tray's item does.
#[tauri::command]
async fn set_hub(app: AppHandle, running: bool) -> Result<ShellState, String> {
    if running {
        core::start_hub(&app).await;
    } else {
        core::stop_hub(&app).await?;
    }
    Ok(app.state::<Core>().state())
}

/// The system's request to end the program (SIGTERM, and SIGINT from a terminal) is a quit, so the
/// hub stops and the lock is released; Tauri does not treat it as one (the spike, ADR-0069 decision 4).
#[cfg(unix)]
fn quit_on_signals(app: &AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    for kind in [SignalKind::terminate(), SignalKind::interrupt()] {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(mut stream) = signal(kind) {
                stream.recv().await;
                core::quit(&handle);
            }
        });
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // First, so a second launch (by a link, or a double click) reaches this program and ends
        // at once; with the deep-link feature it hands its link on (plan §8).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| tray::show_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Core::default())
        .invoke_handler(tauri::generate_handler![core_request, shell_state, set_hub, log_lines, pairing_value, open_log_folder])
        // Closing the window hides it; the program stays in the tray so the tools keep their hub
        // (plan §9, §15 question 10). Quit is the tray's, the menu's, or the system's.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(unix)]
            quit_on_signals(&handle);
            tray::build(&handle)?;
            // macOS registers the scheme from the bundle; Windows and Linux at run time too,
            // which a development build needs (plan §8).
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(err) = app.deep_link().register_all() {
                core::say(&handle, "warn", &format!("The armature:// links could not be registered ({err})"));
            }
            let on_link = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(remote) = relay::connect_remote(url.as_str()) {
                        core::linked(&on_link, remote);
                    }
                }
            });
            if let Err(err) = core::launch(&handle) {
                core::say(&handle, "error", &format!("The core could not be started: {err}"));
            }
            // A link that launched the program.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    if let Some(remote) = relay::connect_remote(url.as_str()) {
                        core::linked(&handle, remote);
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Armature shell failed to build");

    app.run(|handle, event| {
        // macOS: a click on the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            tray::show_window(handle);
            return;
        }
        // Any way out (the last window closed, the menu's Quit, the system) goes through the core's
        // stop first; the shell's own exit, once the core has stopped, passes.
        match event {
            RunEvent::ExitRequested { api, .. } => {
                if !handle.state::<Core>().exiting.load(SeqCst) {
                    api.prevent_exit();
                    core::quit(handle);
                }
            }
            // An exit no one asked for first (macOS's quit): the core is stopped before it ends.
            RunEvent::Exit => core::stop_before_exit(handle),
            _ => {}
        }
    });
}
