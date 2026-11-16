//! The two secrets the program keeps across its starts, in the system's keychain (Keychain
//! Services on macOS, the Credential Manager on Windows, the Secret Service on Linux), under the
//! program's identifier (docs/desktop-program-plan.md §6 and §7):
//!
//!   the refresh token, under the remote's address, its identity provider and the program's
//!     client there, the only durable credential for the remote
//!   the local token, under `local-token`, which every tool on the machine pairs with
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
//! draws a new local token, and says so in the log.

use keyring::Entry;

pub const SERVICE: &str = "com.mossglenn.armature";
const LOCAL_TOKEN: &str = "local-token";

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

pub fn refresh_token(account: &str) -> Result<Option<String>, String> {
    read(account)
}
pub fn keep_refresh_token(account: &str, token: &str) -> Result<(), String> {
    write(account, token)
}
pub fn forget_refresh_token(account: &str) -> Result<(), String> {
    forget(account)
}

pub fn local_token() -> Result<Option<String>, String> {
    read(LOCAL_TOKEN)
}
pub fn keep_local_token(token: &str) -> Result<(), String> {
    write(LOCAL_TOKEN, token)
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
}
