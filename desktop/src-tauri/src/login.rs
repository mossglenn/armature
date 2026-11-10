//! Starting at login (docs/desktop-program-plan.md §9): a setting, off by default, kept in the
//! core's settings file like the others (`startAtLogin`, app/lib/desktop/settings.ts), which the
//! system's own entry follows: a Launch Agent on macOS, the Run key on Windows, an autostart entry
//! on Linux (tauri-plugin-autostart). The shell brings the entry into line after every `start` and
//! every change on the settings page, so the file stays the one place the choice lives and an entry
//! removed by hand comes back only when the setting says so. An entry that is wanted is made again
//! at every start, not only when it is missing: on macOS it holds the executable's path as it was
//! when it was made, so a program moved to Applications afterward kept starting the old copy (the
//! 2026-11-09 review's R8); the log speaks only when the state changes.
//!
//! A program started at login starts hidden, in the tray or menu bar: the hub is what is wanted
//! then, for the tools, not the window. A restart the person asked for, after an update, drops the
//! argument, so the window comes back (`restart_arguments`; the 2026-11-09 review's R7).

use std::ffi::OsString;

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

/// The arguments a restart the person asked for passes on: this start's, less `--hidden`, since a
/// program updated in a session that began at login should come back with its window, not only in
/// the tray (update.rs).
pub fn restart_arguments<I: IntoIterator<Item = OsString>>(args: I) -> Vec<OsString> {
    args.into_iter().filter(|arg| arg != HIDDEN).collect()
}

/// What is done to the system's entry.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Change {
    Enable,
    Disable,
}

/// The change for an entry, from whether it exists (`None` when that cannot be read) and whether
/// it is wanted, with whether the change is news: an entry wanted is made again every time, so it
/// names the program where it now is (the module's header), news only when it was not there; an
/// entry not wanted is removed when it is there, and left alone when it cannot be read.
pub fn change(enabled: Option<bool>, wanted: bool) -> Option<(Change, bool)> {
    match (enabled, wanted) {
        (_, true) => Some((Change::Enable, enabled != Some(true))),
        (Some(true), false) => Some((Change::Disable, true)),
        (Some(false) | None, false) => None,
    }
}

/// Brings the system's entry into line with the settings, saying so when it changes.
pub fn follow(app: &AppHandle, settings: &Value) {
    let Some(wanted) = wanted(settings) else { return };
    let launcher = app.autolaunch();
    let Some((change, news)) = change(launcher.is_enabled().ok(), wanted) else { return };
    let result = match change {
        Change::Enable => launcher.enable(),
        Change::Disable => launcher.disable(),
    };
    match result {
        Ok(()) if !news => {}
        Ok(()) if wanted => core::say(app, "info", "The program now starts at login, in the tray"),
        Ok(()) => core::say(app, "info", "The program no longer starts at login"),
        Err(err) => {
            let what = match (news, wanted) {
                (true, true) => "turned on",
                (true, false) => "turned off",
                (false, _) => "kept up to date",
            };
            core::say(app, "warn", &format!("Starting at login could not be {what} ({err})"));
        }
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
    fn an_entry_wanted_is_made_again_every_time_and_news_only_when_it_was_missing() {
        assert_eq!(change(Some(false), true), Some((Change::Enable, true)));
        assert_eq!(change(None, true), Some((Change::Enable, true)));
        // Present and wanted: made again with the program's current path, and not news.
        assert_eq!(change(Some(true), true), Some((Change::Enable, false)));
        assert_eq!(change(Some(true), false), Some((Change::Disable, true)));
        assert_eq!(change(Some(false), false), None);
        // An entry that cannot be read is not removed.
        assert_eq!(change(None, false), None);
    }

    #[test]
    fn a_restart_keeps_every_argument_but_the_login_start_s() {
        let args = |list: &[&str]| list.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(restart_arguments(args(&["/Applications/Armature.app/Contents/MacOS/armature", "--hidden"])), args(&["/Applications/Armature.app/Contents/MacOS/armature"]));
        assert_eq!(restart_arguments(args(&["armature", "--other", "--hidden", "x"])), args(&["armature", "--other", "x"]));
        assert_eq!(restart_arguments(args(&["armature"])), args(&["armature"]));
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
