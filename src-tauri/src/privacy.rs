//! PIN lock and hidden chats.
//!
//! The PIN is stored only as a salted Argon2 hash. While LANX is locked, the
//! commands that return chats, messages or files refuse to answer. Hidden chats
//! are left out of every list until the PIN is entered again ("show hidden").
//! After 5 wrong PINs each further attempt has to wait longer (30 s, 60 s, ...
//! up to 15 min); the counter survives restarts.

use crate::storage::Database;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const FREE_ATTEMPTS: i64 = 5;
const MAX_WAIT_SECS: i64 = 15 * 60;

#[derive(Debug, Default)]
pub struct PrivacyState {
    locked: AtomicBool,
    hidden_unlocked: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LockStatus {
    pub pin_set: bool,
    pub locked: bool,
    pub hidden_unlocked: bool,
    /// Seconds before another PIN attempt is allowed (0 = now).
    pub retry_after_secs: i64,
}

#[derive(Debug, PartialEq)]
pub enum PinCheck {
    Ok,
    Wrong { retry_after_secs: i64 },
    TooSoon { retry_after_secs: i64 },
    NoPin,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

impl PrivacyState {
    /// LANX starts locked when a PIN is set.
    pub fn new(pin_set: bool) -> Self {
        Self {
            locked: AtomicBool::new(pin_set),
            hidden_unlocked: AtomicBool::new(false),
        }
    }

    pub fn is_locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }

    pub fn hidden_unlocked(&self) -> bool {
        self.hidden_unlocked.load(Ordering::SeqCst) && !self.is_locked()
    }

    pub fn lock(&self) {
        self.locked.store(true, Ordering::SeqCst);
        self.hidden_unlocked.store(false, Ordering::SeqCst);
    }

    pub fn unlock(&self) {
        self.locked.store(false, Ordering::SeqCst);
    }

    pub fn set_hidden_unlocked(&self, v: bool) {
        self.hidden_unlocked.store(v, Ordering::SeqCst);
    }

    pub fn status(&self, db: &Database) -> LockStatus {
        LockStatus {
            pin_set: pin_is_set(db),
            locked: self.is_locked(),
            hidden_unlocked: self.hidden_unlocked(),
            retry_after_secs: retry_after(db),
        }
    }

    /// Error for commands that must not run while locked.
    pub fn guard(&self) -> Result<(), String> {
        if self.is_locked() {
            Err("LOCKED".to_string())
        } else {
            Ok(())
        }
    }
}

pub fn pin_is_set(db: &Database) -> bool {
    db.get_setting("pin_hash").is_some_and(|h| !h.is_empty())
}

pub fn validate_new_pin(pin: &str) -> Result<(), String> {
    let len = pin.chars().count();
    if !(4..=12).contains(&len) {
        return Err("The PIN must be 4 to 12 characters long.".to_string());
    }
    if pin.chars().any(char::is_whitespace) {
        return Err("The PIN cannot contain spaces.".to_string());
    }
    Ok(())
}

pub fn hash_pin(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Could not protect the PIN: {}", e))
}

pub fn verify_pin_hash(hash: &str, pin: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

fn retry_after(db: &Database) -> i64 {
    let until: i64 = db
        .get_setting("pin_retry_until")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    (until - now_secs()).max(0)
}

/// Checks a PIN, applying the wrong-attempt delay.
pub fn check_pin(db: &Database, pin: &str) -> PinCheck {
    let Some(hash) = db.get_setting("pin_hash").filter(|h| !h.is_empty()) else {
        return PinCheck::NoPin;
    };
    let wait = retry_after(db);
    if wait > 0 {
        return PinCheck::TooSoon { retry_after_secs: wait };
    }
    if verify_pin_hash(&hash, pin) {
        let _ = db.set_setting("pin_failed", "0");
        let _ = db.set_setting("pin_retry_until", "0");
        return PinCheck::Ok;
    }
    let failed: i64 = db
        .get_setting("pin_failed")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
        + 1;
    let _ = db.set_setting("pin_failed", &failed.to_string());
    let mut wait = 0;
    if failed >= FREE_ATTEMPTS {
        let steps = (failed - FREE_ATTEMPTS).min(10) as u32;
        wait = (30i64 * 2i64.pow(steps)).min(MAX_WAIT_SECS);
        let _ = db.set_setting("pin_retry_until", &(now_secs() + wait).to_string());
    }
    PinCheck::Wrong {
        retry_after_secs: wait,
    }
}

pub fn pin_error_text(check: &PinCheck) -> String {
    match check {
        PinCheck::Ok => String::new(),
        PinCheck::NoPin => "No PIN is set.".to_string(),
        PinCheck::Wrong { retry_after_secs: 0 } => "Wrong PIN.".to_string(),
        PinCheck::Wrong { retry_after_secs } | PinCheck::TooSoon { retry_after_secs } => format!(
            "Too many wrong attempts. Try again in {} seconds.",
            retry_after_secs
        ),
    }
}

/// Sets, changes (needs the current PIN) or removes (`new_pin` = None) the PIN.
pub fn set_pin(db: &Database, current: Option<&str>, new_pin: Option<&str>) -> Result<(), String> {
    if pin_is_set(db) {
        match check_pin(db, current.unwrap_or("")) {
            PinCheck::Ok => {}
            other => return Err(pin_error_text(&other)),
        }
    }
    match new_pin {
        Some(p) => {
            validate_new_pin(p)?;
            let hash = hash_pin(p)?;
            db.set_setting("pin_hash", &hash).map_err(|e| e.to_string())
        }
        None => {
            db.set_setting("pin_hash", "").map_err(|e| e.to_string())?;
            // Without a PIN nothing can stay hidden.
            let conn = db.conn.lock();
            conn.execute("UPDATE conversations SET is_hidden = 0", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_hash_round_trip_and_rules() {
        let h = hash_pin("2468").unwrap();
        assert!(h.starts_with("$argon2"));
        assert!(!h.contains("2468"));
        assert!(verify_pin_hash(&h, "2468"));
        assert!(!verify_pin_hash(&h, "2469"));
        assert!(validate_new_pin("123").is_err());
        assert!(validate_new_pin("12 34").is_err());
        assert!(validate_new_pin("1234567890123").is_err());
        assert!(validate_new_pin("a1b2").is_ok());
    }

    #[test]
    fn set_change_remove_pin_and_lockout() {
        let db = Database::new_in_memory().unwrap();
        assert_eq!(check_pin(&db, "0000"), PinCheck::NoPin);
        set_pin(&db, None, Some("1357")).unwrap();
        assert!(pin_is_set(&db));
        assert!(db.get_settings().unwrap().pin_enabled);
        assert!(set_pin(&db, Some("9999"), Some("2468")).is_err(), "needs current PIN");
        set_pin(&db, Some("1357"), Some("2468")).unwrap();
        assert_eq!(check_pin(&db, "2468"), PinCheck::Ok);

        for _ in 0..4 {
            assert_eq!(check_pin(&db, "0000"), PinCheck::Wrong { retry_after_secs: 0 });
        }
        assert!(matches!(check_pin(&db, "0000"), PinCheck::Wrong { retry_after_secs: 30 }));
        // Even the right PIN has to wait now.
        assert!(matches!(check_pin(&db, "2468"), PinCheck::TooSoon { .. }));
        let _ = db.set_setting("pin_retry_until", "0");
        assert_eq!(check_pin(&db, "2468"), PinCheck::Ok);

        let conv = db.get_or_create_conversation("peer-x").unwrap();
        db.set_conversation_hidden(&conv.id, true).unwrap();
        set_pin(&db, Some("2468"), None).unwrap();
        assert!(!pin_is_set(&db));
        assert!(!db.is_conversation_hidden(&conv.id), "removing the PIN unhides chats");
    }

    #[test]
    fn lock_state() {
        let s = PrivacyState::new(true);
        assert!(s.is_locked());
        assert_eq!(s.guard(), Err("LOCKED".to_string()));
        s.unlock();
        s.set_hidden_unlocked(true);
        assert!(s.hidden_unlocked());
        s.lock();
        assert!(!s.hidden_unlocked(), "locking re-hides hidden chats");
    }
}
