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
//! the next start takes over (ADR-0069 decision 4). An update ends the core the same way before it
//! installs (`end_for_update`; update.rs).
//!
//! A push, bring-in, deliver, create, clone or remove in flight (`ACTIONS`) finishes first: quitting
//! waits up to `ACTION_WAIT` for it, an update's install the same before it ends the core (and gives
//! up instead), and the pages hold the install button while one runs, since the core's `stop` closes
//! the hub at once and a push cut off is recovered only at the next start (the 2026-11-09 review's S3
//! and R10). macOS's own quit, which ends the event loop without asking, sends `stop` and ends the
//! process on the main thread the same way, bounded (`stop_before_exit`; the review's S2).
//!
//! The core's environment is cleared and only `KEPT_ENVIRONMENT` passed (the code review of
//! 2026-11-09, S1): the core reads no setting from it, and Node's own variables stay outside. Node
//! runs with `--use-system-ca` (`sidecar_arguments`; the review's S7), so the certificate authorities
//! the machine trusts, an institution's TLS inspection among them, are trusted beside Node's own
//! list, as the browser that reached the instance trusts them; `NODE_EXTRA_CA_CERTS` still adds one.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::{Duration, Instant};

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

/// How many of the latest log lines the shell keeps for the log page, which may open after them.
pub const RECENT_LINES: usize = 500;

/// How long quitting waits for the core to stop the hub before ending it.
pub const STOP_WAIT: Duration = Duration::from_secs(5);

/// How long quitting, and an update about to end the core, wait for an action in flight to finish.
pub const ACTION_WAIT: Duration = Duration::from_secs(30);

/// The requests that change a workspace or its remote, the core's long actions
/// (app/lib/desktop/core.ts): the hub is not stopped under one, and the pages hold the install
/// button while one runs (the module's header).
pub const ACTIONS: &[&str] = &["create", "clone", "push", "bringIn", "deliver", "remove"];

/// Whether a request is one of `ACTIONS`.
pub fn is_action(request_type: &str) -> bool {
    ACTIONS.contains(&request_type)
}

/// An action named for the middle of a sentence: "the push", "the bring-in".
pub fn describe(action: &str) -> &'static str {
    match action {
        "create" => "the workspace being created",
        "clone" => "the clone",
        "push" => "the push",
        "bringIn" => "the bring-in",
        "deliver" => "the delivery",
        "remove" => "the removal",
        _ => "the action",
    }
}

/// Node's arguments: `--use-system-ca`, so the machine's trusted certificate authorities are trusted
/// beside Node's own list (the module's header; the review's S7), then the core's bundle.
pub fn sidecar_arguments(script: &str) -> [String; 2] {
    ["--use-system-ca".to_string(), script.to_string()]
}

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
    /// An update the release channel offers, and how its install is going (update.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<crate::update::UpdateState>,
    /// The actions in flight (`ACTIONS`), oldest first, while there are any: the pages hold the
    /// install button for them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<String>,
    /// The system's start-at-login entry as the shell last left it (login.rs; the review's R10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_entry: Option<crate::login::LoginEntry>,
}

#[derive(Default)]
pub struct Core {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    /// The requests in flight that are `ACTIONS`, by id, in the order sent.
    actions: Mutex<Vec<(u64, String)>>,
    next_id: AtomicU64,
    lines: Mutex<LineBuffer>,
    state: Mutex<ShellState>,
    /// The remote the settings name, from `start`'s reply and `connect`'s; the keychain's key.
    remote: Mutex<Option<String>>,
    data_dir: Mutex<Option<PathBuf>>,
    logs: Mutex<Option<LogFiles>>,
    /// The latest log lines, as the page receives them, for a log page opened after them.
    recent: Mutex<VecDeque<Value>>,
    /// The pairing value in force: the keychain's, or the one the core drew or reset to, kept here
    /// too so the pairing page works when the keychain cannot be written.
    local_token: Mutex<Option<String>>,
    quitting: AtomicBool,
    /// Set as the core's process ends, before anything else is done about it.
    core_exited: AtomicBool,
    /// Set while an update ends the core to install itself, so its end is not taken for a failure.
    updating: AtomicBool,
    /// Set just before the shell exits, so its own exit is not taken for a request to quit.
    pub exiting: AtomicBool,
}

impl Core {
    pub fn state(&self) -> ShellState {
        self.state.lock().unwrap().clone()
    }

    /// The actions in flight, oldest first.
    pub fn actions_in_flight(&self) -> Vec<String> {
        self.actions.lock().unwrap().iter().map(|(_, action)| action.clone()).collect()
    }

    /// Takes a reply's waiting sender; whether the request was an action, so the state is refreshed.
    fn settle(&self, id: u64) -> (Option<oneshot::Sender<Value>>, bool) {
        let tx = self.pending.lock().unwrap().remove(&id);
        let mut actions = self.actions.lock().unwrap();
        let was_action = actions.iter().position(|(sent, _)| *sent == id).map(|at| actions.remove(at)).is_some();
        (tx, was_action)
    }

    pub fn recent_lines(&self) -> Vec<Value> {
        self.recent.lock().unwrap().iter().cloned().collect()
    }

    pub fn local_token(&self) -> Option<String> {
        self.local_token.lock().unwrap().clone()
    }

    fn remember(&self, line: &Value) {
        let mut recent = self.recent.lock().unwrap();
        if recent.len() == RECENT_LINES {
            recent.pop_front();
        }
        recent.push_back(line.clone());
    }
}

pub(crate) fn set_state(app: &AppHandle, update: impl FnOnce(&mut ShellState)) {
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
    let core = app.state::<Core>();
    if let Some(logs) = core.logs.lock().unwrap().as_mut() {
        logs.write(level, line);
    }
    let event = json!({ "event": "log", "level": level, "line": line, "from": "shell" });
    core.remember(&event);
    let _ = app.emit("core-event", event);
}

/// The environment variables the shell passes to the core; everything else is cleared (the code
/// review of 2026-11-09, S1). The core itself reads none of its settings from the environment (they
/// come over the channel), but Node reads `NODE_OPTIONS` and `NODE_TLS_REJECT_UNAUTHORIZED`, which
/// on a developer's machine would open a debugger in the process that holds the tokens, or turn
/// off certificate checks toward the remote and the identity provider. What is kept: the home
/// folder, which `os.homedir()` reads for the synced-folder warning (`app/lib/desktop/folder.ts`);
/// the folders the OneDrive client names, which the same warning reads; `SystemRoot`, without which
/// Node on Windows cannot open a socket; the temporary folder; and `NODE_EXTRA_CA_CERTS`, the one
/// Node setting kept, since it adds a certificate authority rather than removing a check, and is
/// how the program reaches an instance behind an institution's TLS inspection until the carried
/// Node trusts the system's store (the review's S7).
const KEPT_ENVIRONMENT: &[&str] = &[
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "OneDrive",
    "OneDriveCommercial",
    "OneDriveConsumer",
    "NODE_EXTRA_CA_CERTS",
];

/// The variables of `all` the core receives: those `KEPT_ENVIRONMENT` names, matched without regard
/// to case, since Windows names them so. A name that is not Unicode is not one of them.
fn kept_environment<I: IntoIterator<Item = (OsString, OsString)>>(all: I) -> Vec<(OsString, OsString)> {
    all.into_iter()
        .filter(|(name, _)| {
            name.to_str()
                .is_some_and(|name| KEPT_ENVIRONMENT.iter().any(|kept| kept.eq_ignore_ascii_case(name)))
        })
        .collect()
}

/// Starts the sidecar and the hub: at setup, and again after an update that failed to install.
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
        .args(sidecar_arguments(&script))
        .env_clear()
        .envs(kept_environment(std::env::vars_os()))
        .spawn()
        .map_err(|e| e.to_string())?;
    say(app, "info", &format!("The core started (process {})", child.pid()));
    core.core_exited.store(false, SeqCst);
    core.updating.store(false, SeqCst);
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
    let action = request["type"].as_str().filter(|t| is_action(t)).map(str::to_string);
    if let Some(action) = &action {
        core.actions.lock().unwrap().push((id, action.clone()));
        refresh_actions(app);
    }
    let mut line = request.to_string();
    line.push('\n');
    let written = match core.child.lock().unwrap().as_mut() {
        Some(child) => child.write(line.as_bytes()).map_err(|e| e.to_string()),
        None => Err("The core is not running".to_string()),
    };
    if let Err(err) = written {
        if core.settle(id).1 {
            refresh_actions(app);
        }
        return Err(err);
    }
    rx.await.map_err(|_| "The core ended before it answered".to_string())
}

/// The state's list of actions brought up to date with the core's, and the pages told.
fn refresh_actions(app: &AppHandle) {
    let actions = app.state::<Core>().actions_in_flight();
    set_state(app, |s| s.actions = actions);
}

/// Waits up to `ACTION_WAIT` for the actions in flight to finish, saying so, since the hub stops
/// next; `Err` names the first of them when they did not, for the caller to say what it does then.
pub async fn await_actions(app: &AppHandle) -> Result<(), &'static str> {
    let core = app.state::<Core>();
    let Some(first) = core.actions_in_flight().into_iter().next() else { return Ok(()) };
    let first = describe(&first);
    say(app, "info", &format!("Waiting for {first} to finish before the hub stops"));
    let deadline = tokio::time::Instant::now() + ACTION_WAIT;
    while !core.actions_in_flight().is_empty() {
        if tokio::time::Instant::now() >= deadline {
            return Err(first);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}

/// `start`, then the keychain's refresh token for the remote it names; the shell's state follows.
pub async fn start_hub(app: &AppHandle) {
    let core = app.state::<Core>();
    let Some(data_dir) = core.data_dir.lock().unwrap().clone() else { return };
    set_state(app, |s| {
        s.core = "starting";
        s.actions.clear();
    });
    let mut request = json!({ "type": "start", "dataDir": data_dir.display().to_string() });
    match keychain::local_token() {
        Ok(Some(token)) => {
            *core.local_token.lock().unwrap() = Some(token.clone());
            request["localToken"] = json!(token);
        }
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
        *core.local_token.lock().unwrap() = Some(token.to_string());
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
    crate::login::follow(app, &body["settings"]);
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
        "settings" => crate::login::follow(app, &reply["body"]["settings"]),
        "signOut" => {
            if let Some(remote) = core.remote.lock().unwrap().clone() {
                if let Err(err) = keychain::forget_refresh_token(&remote) {
                    say(app, "warn", &format!("The keychain's credential could not be removed ({err})"));
                }
            }
        }
        "resetPairing" => {
            if let Some(token) = reply["body"]["localToken"].as_str() {
                *core.local_token.lock().unwrap() = Some(token.to_string());
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
        if let Some((Some(tx), _)) = message.get("id").and_then(Value::as_u64).map(|id| core.settle(id)) {
            let _ = tx.send(message);
        }
        return;
    }
    if let Some(id) = message.get("id") {
        match id.as_u64().map(|id| core.settle(id)) {
            Some((Some(tx), was_action)) => {
                let _ = tx.send(message);
                if was_action {
                    refresh_actions(app);
                }
            }
            _ => say(app, "warn", &format!("The core answered a request the shell did not send: {line}")),
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
            core.remember(&message);
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
    core.actions.lock().unwrap().clear();
    if core.exiting.load(SeqCst) || core.updating.load(SeqCst) {
        return;
    }
    if core.quitting.load(SeqCst) {
        core.exiting.store(true, SeqCst);
        return app.exit(0);
    }
    let message = format!("The core ended unexpectedly (exit code {}); quit and open the program again", code.map_or("none".to_string(), |c| c.to_string()));
    say(app, "error", &message);
    set_state(app, |s| { s.core = "failed"; s.error = Some(message); s.actions.clear(); });
}

/// The last chance when the program ends without asking (macOS's quit, the Apple Event Cmd-Q
/// sends, ends the event loop with `Exit` and no `ExitRequested`). This runs on the main thread,
/// which the tray and the page need, so it cannot await a reply through the runtime: it does what
/// `quit` does, step by step, watching the shared state instead. An action in flight finishes first,
/// up to `ACTION_WAIT`; then `stop` is written, and its reply, which the reader task takes off the
/// pending map from its own thread, waited for up to `STOP_WAIT`, so the hub closes and the folder's
/// lock is released (ADR-0069 decision 4); then the process is ended, so none outlives the program
/// (the 2026-11-09 review's S2: closing its input alone left a core that had not ended in time
/// running, with only a log line). Nothing to do when `quit` already ran.
pub fn stop_before_exit(app: &AppHandle) {
    let core = app.state::<Core>();
    if core.exiting.swap(true, SeqCst) {
        return;
    }
    let log = |level: &str, line: &str| {
        if let Some(logs) = core.logs.lock().unwrap().as_mut() {
            logs.write(level, line);
        }
    };
    let wait_while = |condition: &dyn Fn() -> bool, at_most: Duration| {
        let deadline = Instant::now() + at_most;
        while condition() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
    };
    log("info", "The program is ending; the core stops the hub and releases the lock");
    if let Some(first) = core.actions_in_flight().into_iter().next() {
        let first = describe(&first);
        log("info", &format!("Waiting for {first} to finish before the hub stops"));
        wait_while(&|| !core.actions_in_flight().is_empty(), ACTION_WAIT);
        if !core.actions_in_flight().is_empty() {
            log("warn", &format!("The hub stops with {first} still running after {} seconds; a push is recovered at the next start", ACTION_WAIT.as_secs()));
        }
    }
    let id = core.next_id.fetch_add(1, SeqCst) + 1;
    let (tx, _unread) = oneshot::channel();
    core.pending.lock().unwrap().insert(id, tx);
    let mut line = json!({ "type": "stop", "id": id }).to_string();
    line.push('\n');
    let written = core.child.lock().unwrap().as_mut().is_some_and(|child| child.write(line.as_bytes()).is_ok());
    if written {
        wait_while(&|| core.pending.lock().unwrap().contains_key(&id) && !core.core_exited.load(SeqCst), STOP_WAIT);
        if core.pending.lock().unwrap().contains_key(&id) && !core.core_exited.load(SeqCst) {
            log("warn", "The core did not stop the hub in time; it is ended, and the next start takes over its lock");
        }
    }
    if let Some(child) = core.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    wait_while(&|| !core.core_exited.load(SeqCst), Duration::from_secs(1));
}

/// Quits: an action in flight finishes first (`ACTION_WAIT`), then `stop`, up to five seconds,
/// then the sidecar is ended and the program exits.
pub fn quit(app: &AppHandle) {
    let core = app.state::<Core>();
    if core.quitting.swap(true, SeqCst) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(action) = await_actions(&handle).await {
            say(&handle, "warn", &format!("The hub stops with {action} still running after {} seconds; a push is recovered at the next start", ACTION_WAIT.as_secs()));
        }
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

/// Ends the core for an update's install (update.rs): `stop`, as quitting sends, up to five
/// seconds, then its process, and up to five seconds more for the process to be gone, so the
/// installer replaces no file a running process holds (Windows refuses to).
pub async fn end_for_update(app: &AppHandle) {
    let core = app.state::<Core>();
    core.updating.store(true, SeqCst);
    if !matches!(tokio::time::timeout(STOP_WAIT, stop_hub(app)).await, Ok(Ok(()))) {
        say(app, "warn", "The core did not stop the hub in time; it is ended, and the next start takes over its lock");
    }
    let child = core.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
    let deadline = tokio::time::Instant::now() + STOP_WAIT;
    while !core.core_exited.load(SeqCst) && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// The core and its hub started again after an update that did not install.
pub fn relaunch(app: &AppHandle) {
    if let Err(err) = launch(app) {
        say(app, "error", &format!("The core could not be started again: {err}"));
        set_state(app, |s| { s.core = "failed"; s.error = Some(err); });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(name, value)| (OsString::from(name), OsString::from(value))).collect()
    }

    fn names(kept: &[(OsString, OsString)]) -> Vec<String> {
        kept.iter().map(|(name, _)| name.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn passes_the_folders_the_core_reads_and_no_node_setting_but_the_extra_authorities() {
        let kept = kept_environment(environment(&[
            ("HOME", "/Users/a"),
            ("PATH", "/usr/bin"),
            ("NODE_OPTIONS", "--inspect"),
            ("NODE_TLS_REJECT_UNAUTHORIZED", "0"),
            ("NODE_EXTRA_CA_CERTS", "/etc/institution.pem"),
            ("OneDrive", "C:\\Users\\a\\OneDrive"),
            ("ARMATURE_LOCAL_TOKEN", "never"),
            ("TMPDIR", "/tmp"),
        ]));
        assert_eq!(names(&kept), ["HOME", "NODE_EXTRA_CA_CERTS", "OneDrive", "TMPDIR"]);
    }

    #[test]
    fn matches_windows_names_without_regard_to_case() {
        let kept = kept_environment(environment(&[("SYSTEMROOT", "C:\\Windows"), ("userprofile", "C:\\Users\\a"), ("Path", "C:\\Windows")]));
        assert_eq!(names(&kept), ["SYSTEMROOT", "userprofile"]);
    }

    #[test]
    fn the_long_actions_are_known_by_name_and_described_for_a_sentence() {
        for action in ["create", "clone", "push", "bringIn", "deliver", "remove"] {
            assert!(is_action(action), "{action}");
            assert_ne!(describe(action), "the action", "{action}");
        }
        for request in ["settings", "workspaces", "status", "commits", "signOut", "stop", "resetPairing"] {
            assert!(!is_action(request), "{request}");
        }
        assert_eq!(describe("bringIn"), "the bring-in");
        assert_eq!(describe("deliver"), "the delivery");
    }

    #[test]
    fn the_sidecar_runs_node_with_the_system_s_certificate_authorities_then_the_core() {
        let args = sidecar_arguments("C:\\Program Files\\Armature\\resources\\core\\desktop.mjs");
        assert_eq!(args, ["--use-system-ca".to_string(), "C:\\Program Files\\Armature\\resources\\core\\desktop.mjs".to_string()]);
    }

    #[test]
    fn the_state_names_the_actions_only_while_there_are_any() {
        let empty = serde_json::to_value(ShellState::default()).unwrap();
        assert!(empty.get("actions").is_none());
        assert!(empty.get("loginEntry").is_none());
        let busy = serde_json::to_value(ShellState { actions: vec!["push".to_string()], ..ShellState::default() }).unwrap();
        assert_eq!(busy["actions"], serde_json::json!(["push"]));
    }
}
