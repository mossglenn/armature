//! The program's own updates (docs/desktop-program-plan.md §10): the release channel checked at
//! start and daily, an available update shown in the window, and installed only when the person
//! asks. The feed and the key are the configuration's (`plugins.updater` in tauri.conf.json: this
//! repository's latest release's `latest.json`, the updater's minisign public key, and
//! `requireSignedVersion`, so a feed cannot pair a newer version number with an older release's
//! genuine artifact). An update whose signature does not verify is never installed (the plugin's
//! own check, on download and again on install).
//!
//! Installing downloads the update while the hub still serves the tools, then ends the core as
//! quitting does (`stop`, so the folder's lock is released and no write is cut off, then its
//! process), then installs: Windows refuses to replace an executable that is running, and the
//! sidecar is one. On Windows the installer ends the program itself (the plugin exits once the
//! installer has started); on macOS and Linux the shell restarts into the new version. An install
//! that fails starts the core and its hub again and says why.
//!
//! The pages reach this through `check_update` and `install_update` (lib.rs); the plugin's own
//! JavaScript commands are not granted to the window (capabilities/default.json).

use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::core::{self, Core};

/// How often the release channel is asked, by the wall clock.
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// How often the watcher wakes to see whether a check is due: a sleeping machine's monotonic clock
/// stands still on macOS, so a timer of a day alone would drift by every night the lid was closed.
const WAKE_EVERY: Duration = Duration::from_secs(60 * 60);
/// The first check waits for the hub's start, which the person is waiting on.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(10);

/// An available update as the pages see it, in the shell's state.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub version: String,
    /// The version running now.
    pub current: String,
    /// When the release was published, as the feed gives it (RFC 3339).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// The release's notes, as the feed gives them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// `available`, `downloading`, `installing`, or `failed` (the update still available to try again).
    pub state: &'static str,
    /// The share downloaded, in whole percent, when the size is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    installing: AtomicBool,
    last_check: Mutex<Option<SystemTime>>,
}

/// Whether a daily check is due: none yet, or the last a day ago or more; a clock set back is
/// taken as due rather than as a check in the future.
pub fn due(last: Option<SystemTime>, now: SystemTime) -> bool {
    match last {
        None => true,
        Some(last) => now.duration_since(last).map_or(true, |since| since >= CHECK_EVERY),
    }
}

/// The share of `total` received, in whole percent; none when the size is unknown.
pub fn percent(received: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    Some((received.min(total) * 100 / total) as u8)
}

fn available(update: &Update) -> UpdateState {
    UpdateState {
        version: update.version.clone(),
        current: update.current_version.clone(),
        date: update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_string),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        state: "available",
        progress: None,
        error: None,
    }
}

fn show(app: &AppHandle, update: &Update, state: &'static str, progress: Option<u8>, error: Option<String>) {
    let shown = UpdateState { state, progress, error, ..available(update) };
    core::set_state(app, |s| s.update = Some(shown));
}

/// Checks at start, then whenever a day has passed since the last check that answered.
pub fn watch(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            let last = *handle.state::<Updates>().last_check.lock().unwrap();
            if due(last, SystemTime::now()) {
                if let Err(err) = check(&handle).await {
                    core::say(&handle, "info", &format!("The release channel could not be checked ({err}); the program tries again within the hour"));
                }
            }
            tokio::time::sleep(WAKE_EVERY).await;
        }
    });
}

/// Asks the release channel; the shell's state then names the update, or none.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateState>, String> {
    let updates = app.state::<Updates>();
    if updates.installing.load(SeqCst) {
        return Ok(app.state::<Core>().state().update);
    }
    // Windows: the plugin ends the program once the installer has started, without the exit
    // events; the shell is then exiting, not quitting (lib.rs's ExitRequested passes).
    let on_exit = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || on_exit.state::<Core>().exiting.store(true, SeqCst))
        .build()
        .map_err(|e| e.to_string())?;
    // A feed that answers without a release (no release published yet, so `releases/latest` is 404,
    // or a release without latest.json) is the plugin's ReleaseNotFound, distinct from a network
    // failure: there is nothing to install, so it is no update, said once in the log for whoever
    // looks into a feed that should have one.
    let found = match updater.check().await {
        Ok(found) => found,
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => {
            if updates.last_check.lock().unwrap().is_none() {
                core::say(app, "info", "The release channel has no published release; nothing to install");
            }
            None
        }
        Err(err) => return Err(err.to_string()),
    };
    *updates.last_check.lock().unwrap() = Some(SystemTime::now());
    let state = found.as_ref().map(available);
    let before = app.state::<Core>().state().update.map(|u| u.version);
    if let Some(update) = &state {
        if before.as_deref() != Some(update.version.as_str()) {
            core::say(app, "info", &format!("Version {} is available (this is {})", update.version, update.current));
        }
    }
    *updates.pending.lock().unwrap() = found;
    let shown = state.clone();
    core::set_state(app, |s| s.update = shown);
    Ok(state)
}

/// Downloads, ends the core, installs and restarts; on failure the core starts again and the
/// update stays available with the reason.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let Some(update) = updates.pending.lock().unwrap().clone() else {
        return Err("No update is waiting; check for updates first".to_string());
    };
    if updates.installing.swap(true, SeqCst) {
        return Err("The update is already being installed".to_string());
    }
    let mut core_ended = false;
    let result = run_install(app, &update, &mut core_ended).await;
    if let Err(err) = &result {
        updates.installing.store(false, SeqCst);
        core::say(app, "error", &format!("The update to {} failed: {err}", update.version));
        show(app, &update, "failed", None, Some(err.clone()));
        if core_ended {
            core::relaunch(app);
        }
    }
    result
}

async fn run_install(app: &AppHandle, update: &Update, core_ended: &mut bool) -> Result<(), String> {
    core::say(app, "info", &format!("Downloading version {}", update.version));
    show(app, update, "downloading", Some(0), None);
    let (mut received, mut shown) = (0u64, Some(0u8));
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let now = percent(received, total);
                if now != shown {
                    shown = now;
                    show(app, update, "downloading", now, None);
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    show(app, update, "installing", None, None);
    core::say(app, "info", &format!("Stopping the hub to install version {}", update.version));
    core::end_for_update(app).await;
    *core_ended = true;
    update.install(&bytes).map_err(|e| e.to_string())?;

    // macOS and Linux: the new version is in place; the program starts again into it. The shell is
    // exiting, so lib.rs's ExitRequested lets the restart through rather than taking it for a quit.
    core::say(app, "info", &format!("Version {} is installed; the program starts again", update.version));
    app.state::<Core>().exiting.store(true, SeqCst);
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_is_due_daily_by_the_wall_clock() {
        let now = SystemTime::now();
        assert!(due(None, now));
        assert!(!due(Some(now - Duration::from_secs(60 * 60)), now));
        assert!(!due(Some(now - (CHECK_EVERY - Duration::from_secs(1))), now));
        assert!(due(Some(now - CHECK_EVERY), now));
        assert!(due(Some(now - Duration::from_secs(3 * 24 * 60 * 60)), now));
        // A clock set back: the last check looks like the future, and a check is made.
        assert!(due(Some(now + Duration::from_secs(60)), now));
    }

    #[test]
    fn progress_is_a_whole_percent_of_a_known_size() {
        assert_eq!(percent(0, Some(200)), Some(0));
        assert_eq!(percent(50, Some(200)), Some(25));
        assert_eq!(percent(199, Some(200)), Some(99));
        assert_eq!(percent(300, Some(200)), Some(100));
        assert_eq!(percent(10, None), None);
        assert_eq!(percent(10, Some(0)), None);
    }
}
