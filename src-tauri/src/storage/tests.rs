#[cfg(test)]
mod tests {
    use crate::storage::schema::run_migrations;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db failed");
        run_migrations(&mut conn).expect("migrations failed");
        conn
    }

    #[test]
    fn test_migrations_and_schema() {
        let conn = setup_test_db();
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| {
                r.get(0)
            })
            .expect("query version failed");
        assert_eq!(version, 1);
    }

    #[test]
    fn test_peer_and_conversation_persistence() {
        let conn = setup_test_db();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // Insert peer
        conn.execute(
            "INSERT INTO peers (id, display_name, hostname, last_ip, tcp_port, public_key, trust_state, status, last_seen, avatar_color)
             VALUES ('peer-1', 'Alice', 'Alice-PC', '192.168.1.50', 52926, NULL, 'unverified', 'online', ?1, '#3b82f6')",
            [now],
        ).unwrap();

        // Insert conversation
        conn.execute(
            "INSERT INTO conversations (id, peer_id, last_message_preview, last_message_time, unread_count, is_pinned, created_at)
             VALUES ('conv-1', 'peer-1', 'Hello!', ?1, 1, 0, ?1)",
            [now],
        ).unwrap();

        // Insert message
        conn.execute(
            "INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, timestamp, status, error_reason, is_outgoing)
             VALUES ('msg-1', 'conv-1', 'peer-1', 'my-device', 'Hello!', 'text', ?1, 'delivered', NULL, 0)",
            [now],
        ).unwrap();

        // Query conversation
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = 'conv-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_settings_persistence() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('display_name', 'LANX User')",
            [],
        )
        .unwrap();

        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'display_name'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "LANX User");
    }
}
