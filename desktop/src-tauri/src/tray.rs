//! The tray, or the menu bar on macOS (docs/desktop-program-plan.md §9, §15 question 10): the
//! program lives there while its window is closed, so the tools on the machine keep their hub.
//! Open shows the window; the hub's item pauses or resumes it, its label following the hub's
//! state; Quit stops the hub and ends the program.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::core::{self, Core};

pub struct Tray {
    hub: MenuItem<Wry>,
}

/// Shows and focuses the window, wherever the program was asked to come forward from.
pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Armature", true, None::<&str>)?;
    let hub = MenuItem::with_id(app, "hub", "Pause the hub", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Armature", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &hub, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Armature")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "quit" => core::quit(app),
            "hub" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if app.state::<Core>().state().core == "running" {
                        if let Err(err) = core::stop_hub(&app).await {
                            core::say(&app, "error", &err);
                        }
                    } else {
                        core::start_hub(&app).await;
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Windows and Linux: a left click opens the window; the menu is on the right button.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(Tray { hub });
    Ok(())
}

/// The hub's item follows the shell's state: Pause while running, Resume while paused, and
/// disabled while the core starts or has failed, or no hub has been set up yet.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    let state = app.state::<Core>().state();
    let set_up = state.started.as_ref().is_some_and(|s| s.get("started").is_some());
    let (label, enabled) = match state.core {
        "running" => ("Pause the hub", true),
        "stopped" if set_up => ("Resume the hub", true),
        _ => ("Pause the hub", false),
    };
    let _ = tray.hub.set_text(label);
    let _ = tray.hub.set_enabled(enabled);
}
