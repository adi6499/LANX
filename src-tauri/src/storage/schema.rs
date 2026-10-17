use rusqlite::{Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LATEST_SCHEMA_VERSION: i64 = 6;

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

    if current_version < 2 {
        // v2: real file transfers (links to chat messages, resumable partial
        // files, failure reasons) and an index for the offline outbox.
        let tx = conn.transaction()?;
        tx.execute_batch(
            "
            ALTER TABLE messages ADD COLUMN transfer_id TEXT;
            ALTER TABLE transfers ADD COLUMN conversation_id TEXT;
            ALTER TABLE transfers ADD COLUMN temp_path TEXT;
            ALTER TABLE transfers ADD COLUMN error_reason TEXT;

            CREATE INDEX IF NOT EXISTS idx_messages_outbox ON messages(receiver_id, is_outgoing, status);
            CREATE INDEX IF NOT EXISTS idx_messages_transfer ON messages(transfer_id);
            CREATE INDEX IF NOT EXISTS idx_transfers_peer ON transfers(peer_id, status);
            ",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            (2, now),
        )?;
        tx.commit()?;
    }

    if current_version < 3 {
        // v3 (LANX 1.1): group chats, per-member delivery/read tracking,
        // secret (disappearing) messages, hidden chats, read receipts.
        // `conversations` is rebuilt so group chats can exist without a peer
        // (SQLite cannot drop NOT NULL in place). Foreign keys must be off
        // while the table is swapped; the pragma is ignored inside a transaction.
        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        let result = (|| -> Result<()> {
            let tx = conn.transaction()?;
            tx.execute_batch(
                "
                CREATE TABLE conversations_v3 (
                    id TEXT PRIMARY KEY,
                    peer_id TEXT,
                    kind TEXT NOT NULL DEFAULT 'direct',
                    last_message_preview TEXT,
                    last_message_time INTEGER NOT NULL,
                    unread_count INTEGER NOT NULL DEFAULT 0,
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    is_hidden INTEGER NOT NULL DEFAULT 0,
                    secret_ttl INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (peer_id) REFERENCES peers(id) ON DELETE CASCADE
                );
                INSERT INTO conversations_v3 (id, peer_id, kind, last_message_preview, last_message_time,
                                              unread_count, is_pinned, created_at)
                    SELECT id, peer_id, 'direct', last_message_preview, last_message_time,
                           unread_count, is_pinned, created_at
                    FROM conversations;
                DROP TABLE conversations;
                ALTER TABLE conversations_v3 RENAME TO conversations;
                CREATE INDEX IF NOT EXISTS idx_conversations_peer ON conversations(peer_id);

                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    admin_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    avatar_color TEXT NOT NULL DEFAULT '#6366f1',
                    membership TEXT NOT NULL DEFAULT 'member',
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS group_members (
                    group_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    public_key TEXT,
                    PRIMARY KEY (group_id, device_id)
                );
                -- Group changes still to be sent to a member: kind 'update' | 'leave'.
                CREATE TABLE IF NOT EXISTS group_sync (
                    group_id TEXT NOT NULL,
                    peer_id TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'update',
                    PRIMARY KEY (group_id, peer_id)
                );
                -- Outgoing group messages: one row per member.
                CREATE TABLE IF NOT EXISTS message_deliveries (
                    message_id TEXT NOT NULL,
                    peer_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'sending',
                    error_reason TEXT,
                    PRIMARY KEY (message_id, peer_id),
                    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
                );

                ALTER TABLE messages ADD COLUMN ttl_secs INTEGER;
                ALTER TABLE messages ADD COLUMN expire_at INTEGER;
                ALTER TABLE messages ADD COLUMN receipt_pending INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE transfers ADD COLUMN parent_id TEXT;

                CREATE INDEX IF NOT EXISTS idx_messages_expire ON messages(expire_at);
                CREATE INDEX IF NOT EXISTS idx_messages_receipts ON messages(sender_id, receipt_pending);
                CREATE INDEX IF NOT EXISTS idx_deliveries_peer ON message_deliveries(peer_id, status);
                CREATE INDEX IF NOT EXISTS idx_transfers_parent ON transfers(parent_id);
                ",
            )?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                (3, now),
            )?;
            tx.commit()
        })();
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        result?;
    }

    if current_version < 4 {
        // v4 (LANX 1.2): "Share LANX update". Installers travel as transfers
        // of kind 'update'; their release signature is kept alongside. Each
        // peer's LANX version (from the handshake) decides what it is offered.
        let tx = conn.transaction()?;
        tx.execute_batch(
            "
            ALTER TABLE transfers ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
            ALTER TABLE peers ADD COLUMN app_version TEXT;
            CREATE TABLE IF NOT EXISTS update_offers (
                transfer_id TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                signature TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transfers_kind ON transfers(kind, direction, status);
            ",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            (4, now),
        )?;
        tx.commit()?;
    }

    if current_version < 5 {
        // v5 (LANX 1.2.7): how long each transfer took. started_ms/started_bytes
        // are set whenever bytes start flowing (again, after a resume);
        // duration_ms when it completes.
        let tx = conn.transaction()?;
        tx.execute_batch(
            "
            ALTER TABLE transfers ADD COLUMN started_ms INTEGER;
            ALTER TABLE transfers ADD COLUMN started_bytes INTEGER;
            ALTER TABLE transfers ADD COLUMN duration_ms INTEGER;
            ",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            (5, now),
        )?;
        tx.commit()?;
    }

    if current_version < 6 {
        // v6 (LANX 1.2.9): colleagues' profiles (avatar, status, about me).
        let tx = conn.transaction()?;
        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS peer_profiles (
                peer_id TEXT PRIMARY KEY,
                rev INTEGER NOT NULL,
                profile TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            (6, now),
        )?;
        tx.commit()?;
    }

    Ok(())
}
