//! LANX 1.8.0: storage for emergency alerts (who got them, who answered).

use super::Database;
use rusqlite::{OptionalExtension, Result, params};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AlertAck {
    pub peer_id: String,
    pub name: String,
    /// safe | help
    pub status: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertInfo {
    pub id: String,
    pub from_id: String,
    pub from_name: String,
    pub kind: String,
    pub text: String,
    pub at: i64,
    pub cleared_at: Option<i64>,
    /// This computer raised it.
    pub mine: bool,
    /// What this computer answered (alerts from colleagues).
    pub my_ack: Option<String>,
    /// Alerts you raised: who it reached, and who answered.
    pub sent_to: Vec<String>,
    pub acks: Vec<AlertAck>,
}

impl Database {
    pub fn insert_alert(&self, a: &AlertInfo) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR IGNORE INTO alerts (id, from_id, from_name, kind, text, at, cleared_at, mine, my_ack)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![a.id, a.from_id, a.from_name, a.kind, a.text, a.at, a.cleared_at, a.mine as i64, a.my_ack],
        )?;
        Ok(())
    }

    pub fn alert(&self, id: &str) -> Result<Option<AlertInfo>> {
        let base = {
            let conn = self.conn.lock();
            conn.query_row(
                "SELECT id, from_id, from_name, kind, text, at, cleared_at, mine, my_ack FROM alerts WHERE id = ?1",
                params![id],
                |r| {
                    Ok(AlertInfo {
                        id: r.get(0)?,
                        from_id: r.get(1)?,
                        from_name: r.get(2)?,
                        kind: r.get(3)?,
                        text: r.get(4)?,
                        at: r.get(5)?,
                        cleared_at: r.get(6)?,
                        mine: r.get::<_, i64>(7)? != 0,
                        my_ack: r.get(8)?,
                        sent_to: Vec::new(),
                        acks: Vec::new(),
                    })
                },
            )
            .optional()?
        };
        let Some(mut a) = base else { return Ok(None) };
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT name FROM alert_targets WHERE alert_id = ?1 ORDER BY name")?;
        a.sent_to = stmt.query_map(params![id], |r| r.get(0))?.flatten().collect();
        let mut stmt = conn.prepare("SELECT peer_id, name, status, at FROM alert_acks WHERE alert_id = ?1 ORDER BY at")?;
        a.acks = stmt
            .query_map(params![id], |r| Ok(AlertAck { peer_id: r.get(0)?, name: r.get(1)?, status: r.get(2)?, at: r.get(3)? }))?
            .flatten()
            .collect();
        Ok(Some(a))
    }

    /// Recent alerts, newest first.
    pub fn recent_alerts(&self, since: i64) -> Result<Vec<AlertInfo>> {
        let ids: Vec<String> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare("SELECT id FROM alerts WHERE at >= ?1 ORDER BY at DESC LIMIT 50")?;
            stmt.query_map(params![since], |r| r.get(0))?.flatten().collect()
        };
        Ok(ids.iter().filter_map(|id| self.alert(id).ok().flatten()).collect())
    }

    pub fn add_alert_target(&self, alert_id: &str, peer_id: &str, name: &str, how: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO alert_targets (alert_id, peer_id, name, how) VALUES (?1, ?2, ?3, ?4)",
            params![alert_id, peer_id, name, how],
        )?;
        Ok(())
    }

    /// (peer id, how it was sent: "alert" | "text") for an alert you raised.
    pub fn alert_targets(&self, alert_id: &str) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT peer_id, how FROM alert_targets WHERE alert_id = ?1")?;
        let rows = stmt.query_map(params![alert_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.flatten().collect())
    }

    pub fn set_alert_ack(&self, alert_id: &str, peer_id: &str, name: &str, status: &str, at: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO alert_acks (alert_id, peer_id, name, status, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![alert_id, peer_id, name, status, at],
        )?;
        Ok(())
    }

    pub fn set_my_alert_ack(&self, alert_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE alerts SET my_ack = ?1 WHERE id = ?2", params![status, alert_id])?;
        Ok(())
    }

    pub fn clear_alert(&self, alert_id: &str, at: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE alerts SET cleared_at = ?1 WHERE id = ?2 AND cleared_at IS NULL", params![at, alert_id])?;
        Ok(())
    }

    /// Colleagues' alerts this computer still has to answer (not cleared).
    pub fn unanswered_alerts(&self, since: i64) -> Result<usize> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM alerts WHERE mine = 0 AND my_ack IS NULL AND cleared_at IS NULL AND at >= ?1",
            params![since],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n as usize)
    }
}
