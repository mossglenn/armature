//! The Armature desktop program's shell (docs/desktop-program-plan.md §3; ADR-0069 decision 1):
//! the window, the keychain, the browser for the sign-in, and the core's life. It holds no logic
//! about workspaces, tokens or the hub beyond relaying: the core decides, and answers as the hub's
//! routes would.

mod core;
mod keychain;
mod logs;
mod relay;

use serde_json::{json, Value};
use std::sync::atomic::Ordering::SeqCst;
use tauri::{AppHandle, Manager, RunEvent};

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Core::default())
        .invoke_handler(tauri::generate_handler![core_request, shell_state, set_hub])
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(unix)]
            quit_on_signals(&handle);
            if let Err(err) = core::launch(&handle) {
                core::say(&handle, "error", &format!("The core could not be started: {err}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Armature shell failed to build");

    app.run(|handle, event| {
        // Any way out (the last window closed, the menu's Quit, the system) goes through the core's
        // stop first; the shell's own exit, once the core has stopped, passes.
        if let RunEvent::ExitRequested { api, .. } = event {
            if !handle.state::<Core>().exiting.load(SeqCst) {
                api.prevent_exit();
                core::quit(handle);
            }
        }
    });
}
