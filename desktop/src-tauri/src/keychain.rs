//! The two secrets the program keeps across its starts, in the system's keychain (Keychain
//! Services on macOS, the Credential Manager on Windows, the Secret Service on Linux), under the
//! program's identifier (docs/desktop-program-plan.md §6 and §7):
//!
//!   the refresh token, under the remote's address, the only durable credential for the remote
//!   the local token, under `local-token`, which every tool on the machine pairs with
//!
//! Neither is ever written to a file or the log. A keychain the system cannot open (a Linux
//! session without a Secret Service) is not fatal: the program then signs in at each start and
//! draws a new local token, and says so in the log.

use keyring::Entry;

pub const SERVICE: &str = "com.mossglenn.armature";
const LOCAL_TOKEN: &str = "local-token";

/// The account a remote's refresh token is kept under: its address, without a trailing slash.
pub fn refresh_account(remote: &str) -> String {
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

pub fn refresh_token(remote: &str) -> Result<Option<String>, String> {
    read(&refresh_account(remote))
}
pub fn keep_refresh_token(remote: &str, token: &str) -> Result<(), String> {
    write(&refresh_account(remote), token)
}
pub fn forget_refresh_token(remote: &str) -> Result<(), String> {
    forget(&refresh_account(remote))
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
    fn a_refresh_token_is_kept_under_its_remote() {
        assert_eq!(refresh_account("https://api.armature.example.edu/"), "refresh:https://api.armature.example.edu");
        assert_eq!(refresh_account("http://127.0.0.1:3100"), "refresh:http://127.0.0.1:3100");
    }
}
