//! What the shell relays between the webview and the core, as pure rules the tests hold
//! (docs/desktop-program-plan.md §5 and §6; ADR-0069 decisions 1 and 3).
//!
//! The webview may ask the core what a page needs; the requests that are the shell's own (`start`
//! and `stop`, which the shell sends with the keychain's values, and `credential`, which carries
//! the refresh token) are refused from it. Of the core's events, `credential` is kept for the
//! keychain and never forwarded, so the webview never sees a refresh token (plan §6); `open` is
//! the sign-in's browser address, which the shell opens itself; the rest are forwarded.

use serde_json::Value;

/// The requests a page may send the core: everything but the shell's own.
pub const WEBVIEW_REQUESTS: &[&str] = &[
    "profile", "connect", "settings", "signIn", "signOut", "resetPairing", "workspaces", "status", "create", "clone", "push", "bringIn", "deliver",
];

/// Whether a page may send the core a request of this type.
pub fn allowed_from_webview(request_type: &str) -> bool {
    WEBVIEW_REQUESTS.contains(&request_type)
}

/// What the shell does with one of the core's events.
#[derive(Debug, PartialEq)]
pub enum EventAction {
    /// A refresh token to keep in the keychain; not forwarded.
    KeepCredential(String),
    /// The sign-in's address: opened in the system browser, and forwarded so the page can say so.
    OpenAndForward(String),
    /// The person was signed out by the provider: the keychain's token is removed, and the page told.
    ForgetCredentialAndForward,
    /// A line for the log files, and forwarded.
    LogAndForward,
    /// The hub's state changed: the shell's state follows, and the page is told.
    HubAndForward,
    Forward,
    /// Not an event the shell can read: dropped.
    Drop,
}

pub fn classify(event: &Value) -> EventAction {
    match event.get("event").and_then(Value::as_str) {
        Some("credential") => match event.get("refreshToken").and_then(Value::as_str) {
            Some(token) if !token.is_empty() => EventAction::KeepCredential(token.to_string()),
            _ => EventAction::Drop,
        },
        Some("open") => match event.get("url").and_then(Value::as_str) {
            Some(url) if url.starts_with("https://") || url.starts_with("http://") => EventAction::OpenAndForward(url.to_string()),
            _ => EventAction::Drop,
        },
        Some("signedOut") => EventAction::ForgetCredentialAndForward,
        Some("log") => EventAction::LogAndForward,
        Some("hub") => EventAction::HubAndForward,
        Some(_) => EventAction::Forward,
        None => EventAction::Drop,
    }
}

/// A reply's body with the local token removed, for the shell's state, which every page reads;
/// the pairing page asks for the value on its own.
pub fn without_local_token(mut body: Value) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.remove("localToken");
    }
    body
}

/// The core's standard output as whole lines, however the pipe delivers it.
#[derive(Default)]
pub struct LineBuffer {
    partial: String,
}

impl LineBuffer {
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.partial.push_str(chunk);
        let mut lines = Vec::new();
        while let Some(end) = self.partial.find('\n') {
            let line: String = self.partial.drain(..=end).collect();
            let line = line.trim();
            if !line.is_empty() {
                lines.push(line.to_string());
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_webview_may_not_send_the_shells_own_requests() {
        for own in ["start", "stop", "credential"] {
            assert!(!allowed_from_webview(own), "{own}");
        }
        for page in ["connect", "signIn", "push", "deliver", "resetPairing"] {
            assert!(allowed_from_webview(page), "{page}");
        }
        assert!(!allowed_from_webview(""));
        assert!(!allowed_from_webview("Push"));
    }

    #[test]
    fn a_refresh_token_is_kept_and_never_forwarded() {
        assert_eq!(classify(&json!({ "event": "credential", "refreshToken": "r1" })), EventAction::KeepCredential("r1".into()));
        assert_eq!(classify(&json!({ "event": "credential" })), EventAction::Drop);
        assert_eq!(classify(&json!({ "event": "credential", "refreshToken": "" })), EventAction::Drop);
    }

    #[test]
    fn the_sign_ins_address_is_opened_only_when_it_is_a_web_address() {
        assert_eq!(
            classify(&json!({ "event": "open", "request": 3, "url": "https://login.example.edu/auth?x=1" })),
            EventAction::OpenAndForward("https://login.example.edu/auth?x=1".into())
        );
        assert_eq!(classify(&json!({ "event": "open", "url": "file:///etc/passwd" })), EventAction::Drop);
        assert_eq!(classify(&json!({ "event": "open" })), EventAction::Drop);
    }

    #[test]
    fn other_events_are_logged_followed_or_forwarded() {
        assert_eq!(classify(&json!({ "event": "log", "line": "x" })), EventAction::LogAndForward);
        assert_eq!(classify(&json!({ "event": "hub", "state": "running" })), EventAction::HubAndForward);
        assert_eq!(classify(&json!({ "event": "signedOut", "reason": "invalid_grant" })), EventAction::ForgetCredentialAndForward);
        assert_eq!(classify(&json!({ "event": "something-new" })), EventAction::Forward);
        assert_eq!(classify(&json!({ "id": 1, "status": 200 })), EventAction::Drop);
    }

    #[test]
    fn the_local_token_stays_out_of_the_shared_state() {
        let body = without_local_token(json!({ "started": true, "localToken": "secret", "url": "http://127.0.0.1:3101" }));
        assert_eq!(body, json!({ "started": true, "url": "http://127.0.0.1:3101" }));
    }

    #[test]
    fn lines_are_whole_however_the_pipe_splits_them() {
        let mut buffer = LineBuffer::default();
        assert_eq!(buffer.push("{\"a\":1}\n{\"b\""), vec!["{\"a\":1}"]);
        assert_eq!(buffer.push(":2}\r\n\n{\"c\":3}\n"), vec!["{\"b\":2}", "{\"c\":3}"]);
        assert!(buffer.push("").is_empty());
    }
}
