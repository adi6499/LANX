use rusqlite::{Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn run_migrations(conn: &mut Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    if current_version < 1 {
        let tx = conn.transaction()?;

        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS peers (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                hostname TEXT,
                last_ip TEXT NOT NULL,
                tcp_port INTEGER NOT NULL,
                public_key TEXT,
                trust_state TEXT NOT NULL DEFAULT 'unverified',
                status TEXT NOT NULL DEFAULT 'offline',
                last_seen INTEGER NOT NULL,
                avatar_color TEXT NOT NULL DEFAULT '#3b82f6'
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                last_message_preview TEXT,
                last_message_time INTEGER NOT NULL,
                unread_count INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (peer_id) REFERENCES peers(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'text',
                timestamp INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'sending',
                error_reason TEXT,
                is_outgoing INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash TEXT NOT NULL,
                direction TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                transferred_bytes INTEGER NOT NULL DEFAULT 0,
                local_path TEXT,
                created_at INTEGER NOT NULL,
                completed_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
            CREATE INDEX IF NOT EXISTS idx_conversations_peer ON conversations(peer_id);
            CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers(last_seen);
            ",
        )?;

        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            (1, now),
        )?;

        tx.commit()?;
    }

    Ok(())
}
