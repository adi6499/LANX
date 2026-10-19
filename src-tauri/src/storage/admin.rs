//! LANX 1.9.0: storage for office management (the admin's settings, who got
//! them) and message clean-up (retention).

use super::Database;
use super::models::*;
use rusqlite::{Result, params};
use serde::Serialize;

/// The admin's view of one colleague.
#[derive(Debug, Clone, Serialize)]
pub struct PolicyPeer {
    pub peer_id: String,
    /// The office settings version they have.
    pub version: i64,
    /// accepted | waiting | declined | old | other-admin | left
    pub status: String,
    pub app_version: String,
    pub at: i64,
}

fn read_json<T: serde::de::DeserializeOwned>(db: &Database, key: &str) -> Option<T> {
    db.get_setting(key).and_then(|v| serde_json::from_str(&v).ok())
}

fn write_json<T: Serialize>(db: &Database, key: &str, v: Option<&T>) -> Result<()> {
    db.set_setting(key, &v.map(|v| serde_json::to_string(v).unwrap_or_default()).unwrap_or_default())
}

impl Database {
    // ---------------------------------------------------------- office policy

    /// The settings this computer sends as the LANX admin.
    pub fn my_policy(&self) -> Option<OfficePolicy> {
        read_json::<OfficePolicy>(self, "admin_policy").filter(|p| p.active).map(|p| p.cleaned())
    }

    pub fn set_my_policy(&self, p: Option<&OfficePolicy>) -> Result<()> {
        write_json(self, "admin_policy", p)
    }

    /// The admin's settings this computer accepted.
    pub fn applied_policy(&self) -> Option<OfficePolicy> {
        read_json::<OfficePolicy>(self, "office_policy").filter(|p| p.active && !p.admin_id.is_empty()).map(|p| p.cleaned())
    }

    pub fn set_applied_policy(&self, p: Option<&OfficePolicy>) -> Result<()> {
        write_json(self, "office_policy", p)
    }

    /// An admin's offer waiting for this user's yes / no.
    pub fn policy_offer(&self) -> Option<OfficePolicy> {
        read_json::<OfficePolicy>(self, "policy_offer").filter(|p| p.active).map(|p| p.cleaned())
    }

    pub fn set_policy_offer(&self, p: Option<&OfficePolicy>) -> Result<()> {
        write_json(self, "policy_offer", p)
    }

    /// Admins this user said no to (they aren't asked again).
    pub fn declined_admins(&self) -> Vec<String> {
        read_json::<Vec<String>>(self, "policy_declined").unwrap_or_default()
    }

    pub fn add_declined_admin(&self, id: &str) -> Result<()> {
        let mut list = self.declined_admins();
        if !list.iter().any(|x| x == id) {
            list.push(id.to_string());
        }
        write_json(self, "policy_declined", Some(&list))
    }

    pub fn remove_declined_admin(&self, id: &str) -> Result<()> {
        let list: Vec<String> = self.declined_admins().into_iter().filter(|x| x != id).collect();
        write_json(self, "policy_declined", Some(&list))
    }

    pub fn set_policy_peer(&self, p: &PolicyPeer) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO policy_peers (peer_id, version, status, app_version, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![p.peer_id, p.version, p.status, p.app_version, p.at],
        )?;
        Ok(())
    }

    pub fn policy_peers(&self) -> Result<Vec<PolicyPeer>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT peer_id, version, status, app_version, at FROM policy_peers")?;
        let rows = stmt.query_map([], |r| {
            Ok(PolicyPeer { peer_id: r.get(0)?, version: r.get(1)?, status: r.get(2)?, app_version: r.get(3)?, at: r.get(4)? })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn clear_policy_peers(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM policy_peers", [])?;
        Ok(())
    }

    // ----------------------------------------------------------- what applies

    /// Days after which messages are deleted (the admin's choice wins).
    pub fn effective_retention_days(&self) -> i64 {
        match self.applied_policy() {
            Some(p) if p.retention_days > 0 => p.retention_days,
            _ => self.get_settings().map(|s| s.retention_days).unwrap_or(0),
        }
    }

    /// The admin's apps first, then your own.
    pub fn effective_apps(&self) -> Vec<(AppLink, bool)> {
        let mut out: Vec<(AppLink, bool)> = self.applied_policy().map(|p| p.apps).unwrap_or_default().into_iter().map(|a| (a, true)).collect();
        if let Some(mine) = self.my_policy() {
            for a in mine.apps {
                if !out.iter().any(|(o, _)| o.target == a.target) {
                    out.push((a, true));
                }
            }
        }
        for a in self.get_settings().map(|s| s.apps).unwrap_or_default() {
            if !out.iter().any(|(o, _)| o.target == a.target) {
                out.push((a, false));
            }
        }
        out
    }

    // --------------------------------------------------------- message clean-up

    /// Deletes messages older than `before` (unix seconds), except starred
    /// ones, with what belongs to them; and finished transfers from the list
    /// (the files themselves stay on disk). Returns how many messages went.
    pub fn prune_messages_before(&self, before: i64) -> Result<usize> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let old = "SELECT id FROM messages WHERE timestamp < ?1 AND starred = 0";
        tx.execute(&format!("DELETE FROM reactions WHERE message_id IN ({old})"), params![before])?;
        tx.execute(&format!("DELETE FROM reminders WHERE message_id IN ({old})"), params![before])?;
        tx.execute(&format!("DELETE FROM card_state WHERE card_id IN ({old})"), params![before])?;
        tx.execute(&format!("DELETE FROM message_deliveries WHERE message_id IN ({old})"), params![before])?;
        let n = tx.execute("DELETE FROM messages WHERE timestamp < ?1 AND starred = 0", params![before])?;
        tx.execute(
            "DELETE FROM transfers WHERE created_at < ?1 AND status IN ('completed','failed','declined','cancelled')",
            params![before],
        )?;
        // Chat list lines follow what is left.
        tx.execute(
            "UPDATE conversations SET last_message_preview = NULL
             WHERE last_message_time < ?1 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id)",
            params![before],
        )?;
        tx.commit()?;
        Ok(n)
    }

    /// Runs the clean-up when one is set. Returns how many messages went.
    pub fn apply_retention(&self, now: i64) -> usize {
        let days = self.effective_retention_days();
        if days <= 0 {
            return 0;
        }
        self.prune_messages_before(now - days * 86400).unwrap_or(0)
    }
}
