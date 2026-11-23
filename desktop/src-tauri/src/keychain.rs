//! The two secrets the program keeps across its starts, in the system's keychain (Keychain
//! Services on macOS, the Credential Manager on Windows, the Secret Service on Linux), under the
//! program's identifier (docs/desktop-program-plan.md §6 and §7):
//!
//!   the refresh token, under the remote's address, its identity provider and the program's
//!     client there, the only durable credential for the remote
//!   the pairing key, under `local-token`, which every tool on the machine pairs with
//!
//! The refresh token is bound to the provider that issued it, not to the remote's address alone
//! (the code review of 2026-11-09, C6): the settings are a plain file, and a remote may change the
//! provider its profile names, so a token found under the address alone would be posted to whatever
//! provider is named now. Under the three together, a changed provider finds no entry and the
//! person signs in. An entry of the earlier form, under the address alone, is never read and is
//! removed when met, so a program updated from before this signs in once.
//!
//! Neither is ever written to a file or the log. A keychain the system cannot open (a Linux
//! session without a Secret Service) is not fatal: the program then signs in at each start and
//! draws a new pairing key, and says so in the log.
//!
//! Every call to the keychain runs on one thread of its own, in the order it was asked for (`Line`;
//! the 2026-11-09 review's S10). The system may answer a keychain call with a prompt (macOS asks
//! again after an update re-signs the program), and until 0.2.1 a rotated refresh token was written
//! on the task that reads the core's output, so a prompt left unanswered held every reply behind it.
//! That write is now queued and not waited for. The order is what keeps a sign-out a sign-out: a
//! write queued before the sign-out's removal runs before it, where a write spawned on its own could
//! land after the removal and sign the person in again at the next start, which is why S10 was set
//! aside on 2026-11-16. Ending the program waits a bounded time for what is still queued (`waiting`).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::sync::{mpsc, Arc, OnceLock};

use keyring::Entry;
use tokio::sync::oneshot;

pub const SERVICE: &str = "com.mossglenn.armature";
const LOCAL_TOKEN: &str = "local-token";

type Job = Box<dyn FnOnce() + Send>;

/// Work run on one thread, one job at a time, in the order sent; `send` never waits for it.
pub struct Line {
    jobs: mpsc::Sender<Job>,
    waiting: Arc<AtomicUsize>,
}

impl Line {
    pub fn new(name: &str) -> Line {
        let (jobs, received) = mpsc::channel::<Job>();
        let waiting = Arc::new(AtomicUsize::new(0));
        let left = waiting.clone();
        std::thread::Builder::new()
            .name(name.to_string())
            .spawn(move || {
                for job in received {
                    // A job that panics ends itself, not the line: the jobs behind it still run.
                    let _ = catch_unwind(AssertUnwindSafe(job));
                    left.fetch_sub(1, SeqCst);
                }
            })
            .expect("the keychain's thread could not be started");
        Line { jobs, waiting }
    }

    /// Queues a job; the caller goes on at once.
    pub fn send(&self, job: impl FnOnce() + Send + 'static) {
        self.waiting.fetch_add(1, SeqCst);
        if self.jobs.send(Box::new(job)).is_err() {
            self.waiting.fetch_sub(1, SeqCst);
        }
    }

    /// Queues a job and waits for its result, behind every job sent before it.
    pub async fn run<T: Send + 'static>(&self, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        self.send(move || {
            let _ = tx.send(job());
        });
        rx.await.map_err(|_| "the keychain's thread did not answer".to_string())
    }

    /// The jobs sent and not yet finished.
    pub fn waiting(&self) -> usize {
        self.waiting.load(SeqCst)
    }
}

fn line() -> &'static Line {
    static LINE: OnceLock<Line> = OnceLock::new();
    LINE.get_or_init(|| Line::new("keychain"))
}

/// The keychain calls queued and not yet finished, which ending the program waits for.
pub fn waiting() -> usize {
    line().waiting()
}

/// The account a refresh token is kept under: the remote's address, the issuer and the client id,
/// each without a trailing slash, so the token goes only to the provider that issued it.
pub fn refresh_account(remote: &str, issuer: &str, client_id: &str) -> String {
    format!("refresh:{}|{}|{}", remote.trim_end_matches('/'), issuer.trim_end_matches('/'), client_id)
}

/// The account of the earlier form, under the remote's address alone: removed, never read.
pub fn legacy_refresh_account(remote: &str) -> String {
    format!("refresh:{}", remote.trim_end_matches('/'))
}

fn read(account: &str) -> Result<Option<String>, String> {
    match Entry::new(SERVICE, account).and_then(|entry| entry.get_password()) {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn write(account: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, account).and_then(|entry| entry.set_password(value)).map_err(|err| err.to_string())
}

fn forget(account: &str) -> Result<(), String> {
    match Entry::new(SERVICE, account).and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub async fn refresh_token(account: String) -> Result<Option<String>, String> {
    line().run(move || read(&account)).await?
}
/// Queued and not waited for: the reader of the core's output keeps reading. `failed` hears a refusal.
pub fn keep_refresh_token(account: String, token: String, failed: impl FnOnce(String) + Send + 'static) {
    line().send(move || {
        if let Err(err) = write(&account, &token) {
            failed(err);
        }
    });
}
pub async fn forget_refresh_token(account: String) -> Result<(), String> {
    line().run(move || forget(&account)).await?
}
/// Queued and not waited for, its refusal not heard, as the core's own clearing has been since 0.1.3.
pub fn forget_refresh_token_later(account: String) {
    line().send(move || {
        let _ = forget(&account);
    });
}

pub async fn local_token() -> Result<Option<String>, String> {
    line().run(|| read(LOCAL_TOKEN)).await?
}
pub async fn keep_local_token(token: String) -> Result<(), String> {
    line().run(move || write(LOCAL_TOKEN, &token)).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refresh_token_is_kept_under_its_remote_its_issuer_and_the_client() {
        let account = refresh_account("https://api.armature.example.edu/", "https://login.example.edu/realms/armature/", "armature-desktop");
        assert_eq!(account, "refresh:https://api.armature.example.edu|https://login.example.edu/realms/armature|armature-desktop");
        // Another provider, or another client at the same one, is another entry: the token is not found for it.
        assert_ne!(account, refresh_account("https://api.armature.example.edu", "https://login.example.net/realms/armature", "armature-desktop"));
        assert_ne!(account, refresh_account("https://api.armature.example.edu", "https://login.example.edu/realms/armature", "other"));
        // The earlier form, under the address alone, is no entry of the new form.
        assert_eq!(legacy_refresh_account("http://127.0.0.1:3100/"), "refresh:http://127.0.0.1:3100");
        assert_ne!(account, legacy_refresh_account("https://api.armature.example.edu"));
    }

    #[tokio::test]
    async fn a_stalled_call_holds_only_the_calls_behind_it_and_they_keep_their_order() {
        use std::sync::Mutex;
        use std::time::Duration;
        let line = Line::new("keychain-test");
        let done = Arc::new(Mutex::new(Vec::new()));
        // A prompt nobody has answered yet.
        let (answer, prompt) = mpsc::channel::<()>();
        let seen = done.clone();
        line.send(move || {
            prompt.recv().unwrap();
            seen.lock().unwrap().push("rotated token kept");
        });
        // The reader queues the next rotation and goes on: `send` returned while the first waits.
        let seen = done.clone();
        line.send(move || seen.lock().unwrap().push("second rotation kept"));
        assert_eq!(line.waiting(), 2);
        // The sign-out's removal, queued after both, is waited for by its page.
        let seen = done.clone();
        let sign_out = line.run(move || seen.lock().unwrap().push("removed at sign-out"));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(done.lock().unwrap().is_empty(), "nothing runs ahead of the stalled call");
        answer.send(()).unwrap();
        sign_out.await.unwrap();
        // The removal ran last, so the sign-out stands.
        assert_eq!(*done.lock().unwrap(), ["rotated token kept", "second rotation kept", "removed at sign-out"]);
        assert_eq!(line.waiting(), 0);
    }

    #[tokio::test]
    async fn a_call_that_panics_leaves_the_line_running() {
        let line = Line::new("keychain-test");
        line.send(|| panic!("a keychain backend that panics"));
        assert_eq!(line.run(|| 7).await, Ok(7));
        assert_eq!(line.waiting(), 0);
    }
}
