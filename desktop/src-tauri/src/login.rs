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
//!
//! What the system's entry is after each attempt goes into the shell's state (`LoginEntry`), so the
//! settings page shows the box as the setting is saved and says beside it when the entry could not be
//! made or removed, rather than a tick over an entry that is not there (the review's R10).

use std::ffi::OsString;

use serde::Serialize;
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

/// The system's entry as the shell last left it (the module's header): whether it is wanted, whether
/// it exists (`None` when that cannot be read), and the sentence of what went wrong, if anything.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginEntry {
    pub wanted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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

/// Brings the system's entry into line with the settings, saying so when it changes, and puts what
/// the entry then is into the shell's state for the settings page.
pub fn follow(app: &AppHandle, settings: &Value) {
    let Some(wanted) = wanted(settings) else { return };
    let launcher = app.autolaunch();
    let mut error = None;
    if let Some((change, news)) = change(launcher.is_enabled().ok(), wanted) {
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
                let line = format!("Starting at login could not be {what} ({err})");
                core::say(app, "warn", &line);
                error = Some(line);
            }
        }
    }
    let entry = LoginEntry { wanted, enabled: launcher.is_enabled().ok(), error };
    core::set_state(app, |s| s.login_entry = Some(entry));
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
    fn the_entry_s_state_is_told_in_the_page_s_terms_and_says_nothing_it_does_not_know() {
        let made = serde_json::to_value(LoginEntry { wanted: true, enabled: Some(true), error: None }).unwrap();
        assert_eq!(made, json!({ "wanted": true, "enabled": true }));
        let refused = serde_json::to_value(LoginEntry { wanted: true, enabled: Some(false), error: Some("Starting at login could not be turned on (denied)".to_string()) }).unwrap();
        assert_eq!(refused, json!({ "wanted": true, "enabled": false, "error": "Starting at login could not be turned on (denied)" }));
        let unread = serde_json::to_value(LoginEntry { wanted: false, enabled: None, error: None }).unwrap();
        assert_eq!(unread, json!({ "wanted": false }));
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
