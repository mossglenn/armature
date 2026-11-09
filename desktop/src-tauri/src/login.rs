//! Starting at login (docs/desktop-program-plan.md §9): a setting, off by default, kept in the
//! core's settings file like the others (`startAtLogin`, app/lib/desktop/settings.ts), which the
//! system's own entry follows: a Launch Agent on macOS, the Run key on Windows, an autostart entry
//! on Linux (tauri-plugin-autostart). The shell brings the entry into line after every `start` and
//! every change on the settings page, so the file stays the one place the choice lives and an entry
//! removed by hand comes back only when the setting says so.
//!
//! A program started at login starts hidden, in the tray or menu bar: the hub is what is wanted
//! then, for the tools, not the window.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::core;

/// The argument the system's entry passes, by which a start at login is told from a person's.
pub const HIDDEN: &str = "--hidden";

/// The setting in a reply's `settings`, when it is there.
pub fn wanted(settings: &Value) -> Option<bool> {
    settings.get("startAtLogin").and_then(Value::as_bool)
}

/// Whether this start is the system's at login (the program's own path first, then its arguments).
pub fn launched_hidden<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().skip(1).any(|arg| arg == HIDDEN)
}

/// Brings the system's entry into line with the settings, saying so when it changes.
pub fn follow(app: &AppHandle, settings: &Value) {
    let Some(wanted) = wanted(settings) else { return };
    let launcher = app.autolaunch();
    let result = match launcher.is_enabled() {
        Ok(enabled) if enabled == wanted => return,
        // An entry that cannot be read is not removed; one is made when asked for.
        Err(_) if !wanted => return,
        _ if wanted => launcher.enable(),
        _ => launcher.disable(),
    };
    match result {
        Ok(()) if wanted => core::say(app, "info", "The program now starts at login, in the tray"),
        Ok(()) => core::say(app, "info", "The program no longer starts at login"),
        Err(err) => core::say(app, "warn", &format!("Starting at login could not be {} ({err})", if wanted { "turned on" } else { "turned off" })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_setting_is_read_only_when_it_is_there() {
        assert_eq!(wanted(&json!({ "startAtLogin": true, "port": 3101 })), Some(true));
        assert_eq!(wanted(&json!({ "startAtLogin": false })), Some(false));
        assert_eq!(wanted(&json!({ "port": 3101 })), None);
        assert_eq!(wanted(&json!({ "startAtLogin": "yes" })), None);
        assert_eq!(wanted(&Value::Null), None);
    }

    #[test]
    fn a_start_at_login_is_told_by_its_argument_not_the_path() {
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(launched_hidden(args(&["/Applications/Armature.app/Contents/MacOS/armature-desktop", "--hidden"])));
        assert!(!launched_hidden(args(&["C:\\Program Files\\Armature\\armature-desktop.exe"])));
        assert!(!launched_hidden(args(&["/opt/--hidden/armature"])));
        assert!(!launched_hidden(args(&["armature", "armature://connect?remote=https://api.example.edu"])));
    }
}
