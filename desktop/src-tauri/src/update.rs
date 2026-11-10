//! The program's own updates (docs/desktop-program-plan.md §10): the release channel checked at
//! start and daily, an available update shown in the window, and installed only when the person
//! asks. The feed and the key are the configuration's (`plugins.updater` in tauri.conf.json: the
//! `latest.json` of this repository's `desktop-channel` release, which only a published program
//! release moves (.github/workflows/desktop-channel.yml), the updater's minisign public key, and
//! `requireSignedVersion`, so a feed cannot pair a newer version number with an older release's
//! genuine artifact). An update whose signature does not verify is never installed (the plugin's
//! own check, on download and again on install).
//!
//! A feed that answers without a release is not "the latest version": the plugin (2.14.1,
//! `updater.rs`) reports every status but 2xx as `ReleaseNotFound`, a 404 for a channel with no
//! release yet and a 503 or a proxy's 502 alike. On that answer nothing is known, so nothing
//! changes: an update already found stays offered, the check is not recorded (the watcher tries
//! again within the hour), and the page is told the channel had no release to offer (the 2026-11-09
//! review's R2).
//!
//! Installing downloads the update while the hub still serves the tools, then ends the core as
//! quitting does (`stop`, so the folder's lock is released and no write is cut off, then its
//! process), then installs: Windows refuses to replace an executable that is running, and the
//! sidecar is one. On Windows the installer ends the program itself (the plugin exits once the
//! installer has started); on macOS and Linux the shell restarts into the new version. An install
//! that fails starts the core and its hub again and says why.
//!
//! A check waits `CHECK_TIMEOUT` for the channel's answer, and a download is given up when no data
//! has arrived for `DOWNLOAD_STALL`, not after a total time, since a slow link is not a dead one
//! (the review's R4). The plugin has one timeout, set on the builder and carried by the update it
//! finds into the download as a bound on the whole request, so the update's copy is cleared before
//! the download and the watchdog stands in its place.
//!
//! An install that is a system package (`.deb`, `.rpm`) is not checked at all (the review's R5):
//! the feed carries the AppImage for Linux, and the plugin, finding no `linux-x86_64-deb` entry,
//! would fall back to it, download it and fail at the install, after the hub had been stopped. The
//! guide says such an install is updated by installing the next package, and the program says so
//! when asked (`Found::Packaged`).
//!
//! The pages reach this through `check_update` and `install_update` (lib.rs); the plugin's own
//! JavaScript commands are not granted to the window (capabilities/default.json).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::core::{self, Core};
use crate::login;

/// How often the release channel is asked, by the wall clock.
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// How often the watcher wakes to see whether a check is due: a sleeping machine's monotonic clock
/// stands still on macOS, so a timer of a day alone would drift by every night the lid was closed.
const WAKE_EVERY: Duration = Duration::from_secs(60 * 60);
/// The first check waits for the hub's start, which the person is waiting on.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(10);
/// How long a check waits for the channel's answer, a small JSON document, before it is a failed
/// check (the watcher tries again within the hour; a page is told).
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a download may go without a byte before it is given up and the update offered again.
const DOWNLOAD_STALL: Duration = Duration::from_secs(60);

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
    /// When the channel last answered with or without an update; an answer without a release is not recorded.
    last_check: Mutex<Option<SystemTime>>,
    /// Whether the log has said, this run, that the channel answered without a release.
    warned_no_release: AtomicBool,
}

/// What a check found, for the page that asked (lib.rs's `check_update`).
#[derive(Clone, Copy, Serialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Found {
    /// A newer version, now in the shell's state and waiting to be installed.
    Update,
    /// The feed names this version or an older one: nothing to install.
    Latest,
    /// The feed answered without a release: none is published, or it answered an error status
    /// (the module's header). Nothing is known, so the pending update and the last check stay.
    NoRelease,
    /// This install is a system package, which the package manager updates; the channel was not
    /// asked (the module's header).
    Packaged,
}

/// Whether this install is a system package, told as the plugin tells it: the bundle type baked in
/// when the package was made. An AppImage, a macOS app and a Windows install are not.
pub fn packaged() -> bool {
    matches!(bundle_type(), Some(BundleType::Deb | BundleType::Rpm))
}

/// The plugin's answer, sorted into what the program does with it. `ReleaseNotFound` is the one
/// error that is not a failure of the check: a feed with nothing on it, or one that answered a
/// status the plugin folds into the same error, is an answer without a release.
fn classify(result: &Result<Option<Update>, tauri_plugin_updater::Error>) -> Result<Found, String> {
    match result {
        Ok(Some(_)) => Ok(Found::Update),
        Ok(None) => Ok(Found::Latest),
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => Ok(Found::NoRelease),
        Err(err) => Err(err.to_string()),
    }
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
    if packaged() {
        core::say(app, "info", "This install is a system package, updated by installing the next package; the release channel is not checked");
        return;
    }
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

/// Asks the release channel; the shell's state then names the update, or none, and the answer says
/// which of the three the channel gave.
pub async fn check(app: &AppHandle) -> Result<Found, String> {
    if packaged() {
        return Ok(Found::Packaged);
    }
    let updates = app.state::<Updates>();
    if updates.installing.load(SeqCst) {
        return Ok(Found::Update);
    }
    // Windows: the plugin ends the program once the installer has started, without the exit
    // events; the shell is then exiting, not quitting (lib.rs's ExitRequested passes).
    let on_exit = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || on_exit.state::<Core>().exiting.store(true, SeqCst))
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let result = updater.check().await;
    let found = classify(&result)?;
    if found == Found::NoRelease {
        // Said once a run, for whoever looks into a feed that should have a release; the state, the
        // pending update and the last check stay as they were (the module's header).
        if !updates.warned_no_release.swap(true, SeqCst) {
            core::say(app, "info", "The release channel answered without a release (none is published, or it did not answer); the program tries again within the hour");
        }
        return Ok(found);
    }
    let update = result.unwrap_or_default();
    *updates.last_check.lock().unwrap() = Some(SystemTime::now());
    let state = update.as_ref().map(available);
    let before = app.state::<Core>().state().update.map(|u| u.version);
    if let Some(update) = &state {
        if before.as_deref() != Some(update.version.as_str()) {
            core::say(app, "info", &format!("Version {} is available (this is {})", update.version, update.current));
        }
    }
    *updates.pending.lock().unwrap() = update;
    core::set_state(app, |s| s.update = state);
    Ok(found)
}

/// Downloads, ends the core, installs and restarts; on failure the core starts again and the
/// update stays available with the reason.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let Some(mut update) = updates.pending.lock().unwrap().clone() else {
        return Err("No update is waiting; check for updates first".to_string());
    };
    // The check's timeout came with the update and would bound the whole download (the module's
    // header); the stall watchdog in `run_install` takes its place.
    update.timeout = None;
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
    let received = AtomicU64::new(0);
    let mut shown = Some(0u8);
    let download = update.download(
        |chunk, total| {
            let so_far = received.fetch_add(chunk as u64, SeqCst) + chunk as u64;
            let now = percent(so_far, total);
            if now != shown {
                shown = now;
                show(app, update, "downloading", now, None);
            }
        },
        || {},
    );
    let bytes = tokio::select! {
        result = download => result.map_err(|e| e.to_string())?,
        _ = stalled(&received, DOWNLOAD_STALL) => {
            return Err(format!("the download received nothing for {} seconds", DOWNLOAD_STALL.as_secs()));
        }
    };

    show(app, update, "installing", None, None);
    core::say(app, "info", &format!("Stopping the hub to install version {}", update.version));
    core::end_for_update(app).await;
    *core_ended = true;
    update.install(&bytes).map_err(|e| e.to_string())?;

    // macOS and Linux: the new version is in place; the program starts again into it, as Tauri's
    // own restart on the main thread does (its cleanup, then the process replaced), but with this
    // start's arguments less `--hidden`, since a restart the person asked for should bring the window
    // back even when the session began at login (login.rs; the review's R7). Tauri's `restart`
    // re-reads the process's own arguments, so it cannot be told otherwise. The shell is marked
    // exiting so nothing takes the end for a quit.
    core::say(app, "info", &format!("Version {} is installed; the program starts again", update.version));
    app.state::<Core>().exiting.store(true, SeqCst);
    let mut env = app.env();
    env.args_os = login::restart_arguments(env.args_os);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        handle.cleanup_before_exit();
        tauri::process::restart(&env);
    })
    .map_err(|e| e.to_string())?;
    // The restart ends this process from the main thread; this task waits for it.
    std::future::pending().await
}

/// Resolves when `received`, the bytes so far, has not moved for `patience`: the stream is taken as
/// dead. Checked every `patience`, so a stall is noticed between one and two of them.
async fn stalled(received: &AtomicU64, patience: Duration) {
    let mut seen = received.load(SeqCst);
    loop {
        tokio::time::sleep(patience).await;
        let now = received.load(SeqCst);
        if now == seen {
            return;
        }
        seen = now;
    }
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
    fn an_answer_without_a_release_is_neither_the_latest_version_nor_a_failed_check() {
        use tauri_plugin_updater::Error;
        assert_eq!(classify(&Ok(None)), Ok(Found::Latest));
        // The plugin's one error for a 404 and for every other status but 2xx (its updater.rs).
        assert_eq!(classify(&Err(Error::ReleaseNotFound)), Ok(Found::NoRelease));
        // Any other error is the check failing, with its reason for the log and the page.
        let failed = classify(&Err(Error::EmptyEndpoints));
        assert!(failed.is_err(), "{failed:?}");
        assert!(failed.unwrap_err().to_lowercase().contains("endpoint"));
    }

    /// Virtual time: bytes every 30 seconds for three minutes, then silence. The watchdog must not
    /// fire while bytes arrive, and must fire within two patiences of the last one.
    #[tokio::test(start_paused = true)]
    async fn a_download_is_stalled_only_when_no_byte_arrives_for_the_patience() {
        let received = AtomicU64::new(0);
        let patience = Duration::from_secs(60);
        let feeding = async {
            for i in 1..=6u64 {
                tokio::time::sleep(Duration::from_secs(30)).await;
                received.store(i * 1000, SeqCst);
            }
            tokio::time::sleep(Duration::from_secs(600)).await;
        };
        let started = tokio::time::Instant::now();
        tokio::select! {
            _ = feeding => panic!("the watchdog did not fire after the bytes stopped"),
            _ = stalled(&received, patience) => {}
        }
        let elapsed = started.elapsed();
        let last_byte = Duration::from_secs(180);
        assert!(elapsed >= last_byte + patience && elapsed <= last_byte + 2 * patience, "{elapsed:?}");
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
