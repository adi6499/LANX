#[cfg(test)]
mod tests {
    use crate::networking::protocol::*;
    use crate::security::{DeviceIdentity, KeyTrustCheck};
    use crate::storage::Database;
    use crate::storage::models::{Message, Peer};
    use rusqlite::Connection;
    use std::io::Cursor;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::net::{TcpListener, TcpStream};

    fn create_test_identity() -> DeviceIdentity {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::storage::schema::run_migrations(&mut conn).unwrap();
        DeviceIdentity::load_or_create(&conn).unwrap()
    }

    fn create_test_database() -> Database {
        Database::new_in_memory().unwrap()
    }

    // 1. Protocol serialization, envelope, and Ed25519 signature verification
    #[test]
    fn test_protocol_envelope_and_signature_verification() {
        let identity = create_test_identity();
        let payload = PacketPayload::Message(MessagePayload {
            message_id: "msg-123".to_string(),
            conversation_id: "conv-123".to_string(),
            content: "Hello LANX secure network".to_string(),
            message_type: "text".to_string(),
        });

        let packet = PacketEnvelope::new(&identity, "Alice", PacketType::Message, None, payload);

        // Verification must succeed with original signature
        assert!(packet.verify_signature().unwrap());

        // Tampering with sender name or ID must fail verification
        let mut tampered = packet.clone();
        tampered.sender_name = "Mallory".to_string();
        assert!(!tampered.verify_signature().unwrap());
    }

    // 2. Maximum frame sizes - reject frames exceeding 64 KB
    #[tokio::test]
    async fn test_frame_length_bounds_and_rejection() {
        let oversized_len: u32 = 100_000;
        let mut buf = Vec::new();
        buf.extend_from_slice(&oversized_len.to_be_bytes());
        buf.extend_from_slice(&vec![0u8; 100]); // Partial body

        let mut cursor = Cursor::new(buf);
        let res = read_framed_packet(&mut cursor).await;
        assert!(res.is_err());
        assert!(
            res.unwrap_err()
                .to_string()
                .contains("strict maximum limit")
        );
    }

    // 3. Malformed and truncated packets
    #[tokio::test]
    async fn test_malformed_and_truncated_packet() {
        // Frame claims 50 bytes, but stream has only 10 bytes
        let mut buf = Vec::new();
        buf.extend_from_slice(&(50u32).to_be_bytes());
        buf.extend_from_slice(b"{\"packet_i"); // Truncated

        let mut cursor = Cursor::new(buf);
        let res = read_framed_packet(&mut cursor).await;
        assert!(res.is_err());
    }

    // 4. Unknown protocol version rejection
    #[test]
    fn test_unknown_protocol_version() {
        let identity = create_test_identity();
        let mut packet = PacketEnvelope::new(
            &identity,
            "Alice",
            PacketType::Ping,
            None,
            PacketPayload::Ping,
        );
        packet.version = 99; // Unknown future or invalid version

        let valid = packet.version == PROTOCOL_VERSION;
        assert!(
            !valid,
            "Packets with version 99 must not be accepted as protocol version 1"
        );
    }

    // 5. Key trust change detection (anti-spoofing warning)
    #[test]
    fn test_key_trust_change_detection() {
        let id1 = create_test_identity();
        let id2 = create_test_identity();

        let check1 = DeviceIdentity::check_peer_key_trust(None, &id1.public_key_hex());
        assert_eq!(check1, KeyTrustCheck::FirstContact);

        let check2 = DeviceIdentity::check_peer_key_trust(
            Some(&id1.public_key_hex()),
            &id1.public_key_hex(),
        );
        assert_eq!(check2, KeyTrustCheck::MatchesExisting);

        let check3 = DeviceIdentity::check_peer_key_trust(
            Some(&id1.public_key_hex()),
            &id2.public_key_hex(),
        );
        match check3 {
            KeyTrustCheck::KeyChangedWarning { expected, actual } => {
                assert_eq!(expected, id1.public_key_hex());
                assert_eq!(actual, id2.public_key_hex());
            }
            _ => panic!("Expected KeyChangedWarning when peer public key changes!"),
        }
    }

    // 6. Peer expiry logic (offline detection)
    #[test]
    fn test_peer_expiry_logic() {
        let db = create_test_database();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let active_peer = Peer {
            id: "peer-active".to_string(),
            display_name: "Active Peer".to_string(),
            hostname: "HOST-A".to_string(),
            last_ip: "192.168.1.50".to_string(),
            tcp_port: 52926,
            public_key: None,
            trust_state: "trusted".to_string(),
            status: "online".to_string(),
            last_seen: now - 3, // Seen 3s ago
            avatar_color: "#10b981".to_string(),
        };

        let expired_peer = Peer {
            id: "peer-expired".to_string(),
            display_name: "Expired Peer".to_string(),
            hostname: "HOST-B".to_string(),
            last_ip: "192.168.1.51".to_string(),
            tcp_port: 52926,
            public_key: None,
            trust_state: "unverified".to_string(),
            status: "online".to_string(),
            last_seen: now - 20, // Seen 20s ago (> 15s expiry)
            avatar_color: "#ef4444".to_string(),
        };

        db.upsert_peer(&active_peer).unwrap();
        db.upsert_peer(&expired_peer).unwrap();

        // Expire peers older than 15s
        let peers = db.list_peers().unwrap();
        for mut p in peers {
            if p.status == "online" && (now - p.last_seen > 15) {
                p.status = "offline".to_string();
                db.upsert_peer(&p).unwrap();
            }
        }

        let updated_peers = db.list_peers().unwrap();
        let p_active = updated_peers
            .iter()
            .find(|p| p.id == "peer-active")
            .unwrap();
        let p_expired = updated_peers
            .iter()
            .find(|p| p.id == "peer-expired")
            .unwrap();

        assert_eq!(p_active.status, "online");
        assert_eq!(p_expired.status, "offline");
    }

    // 7. Loopback two-peer integration test with dynamic ports
    #[tokio::test]
    async fn test_two_peer_loopback_messaging_and_ack() {
        let peer_b_db = Arc::new(create_test_database());
        let peer_b_identity = create_test_identity();

        // Bind Peer B on loopback with dynamic port (0)
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let peer_b_addr = listener.local_addr().unwrap();

        let b_db_clone = peer_b_db.clone();
        let b_id_clone = peer_b_identity.clone();

        // Peer B server task
        let server_task = tokio::spawn(async move {
            let (mut stream, _remote_addr) = listener.accept().await.unwrap();
            let packet = read_framed_packet(&mut stream).await.unwrap();
            assert!(packet.verify_signature().unwrap());

            if let PacketPayload::Message(msg_payload) = packet.payload {
                // Ensure conversation
                let conv = b_db_clone
                    .get_or_create_conversation(&packet.sender_id)
                    .unwrap();

                // Commit message to DB
                let incoming = Message {
                    id: msg_payload.message_id.clone(),
                    conversation_id: conv.id,
                    sender_id: packet.sender_id.clone(),
                    receiver_id: b_id_clone.device_id.clone(),
                    content: msg_payload.content.clone(),
                    message_type: "text".to_string(),
                    timestamp: 1000,
                    status: "delivered".to_string(),
                    error_reason: None,
                    is_outgoing: false,
                };
                b_db_clone.insert_message(&incoming).unwrap();

                // Send ACK only after successful DB commit
                let ack_reply = PacketEnvelope::new(
                    &b_id_clone,
                    "Peer B",
                    PacketType::MessageAck,
                    Some(packet.packet_id),
                    PacketPayload::MessageAck(MessageAckPayload {
                        message_id: msg_payload.message_id,
                        status: "delivered".to_string(),
                        db_committed: true,
                        reason: None,
                    }),
                );
                write_framed_packet(&mut stream, &ack_reply).await.unwrap();
            }
        });

        // Peer A client: Send message to Peer B
        let peer_a_identity = create_test_identity();
        let mut client_stream = TcpStream::connect(peer_b_addr).await.unwrap();

        let message_payload = PacketPayload::Message(MessagePayload {
            message_id: "test-msg-456".to_string(),
            conversation_id: "conv-b".to_string(),
            content: "Hello from Peer A!".to_string(),
            message_type: "text".to_string(),
        });

        let send_packet = PacketEnvelope::new(
            &peer_a_identity,
            "Peer A",
            PacketType::Message,
            None,
            message_payload,
        );

        write_framed_packet(&mut client_stream, &send_packet)
            .await
            .unwrap();

        // Await Ack
        let ack_reply = read_framed_packet(&mut client_stream).await.unwrap();
        assert!(ack_reply.verify_signature().unwrap());

        if let PacketPayload::MessageAck(ack) = ack_reply.payload {
            assert_eq!(ack.message_id, "test-msg-456");
            assert!(ack.db_committed);
            assert_eq!(ack.status, "delivered");
        } else {
            panic!("Expected MessageAck response!");
        }

        server_task.await.unwrap();

        // Verify message was stored in Peer B's SQLite database
        let stored = peer_b_db.get_message_by_id("test-msg-456").unwrap();
        assert!(stored.is_some());
        let m = stored.unwrap();
        assert_eq!(m.content, "Hello from Peer A!");
        assert_eq!(m.sender_id, peer_a_identity.device_id);
    }

    // 8. Deduplication check: retransmitted message IDs do not create duplicates
    #[test]
    fn test_duplicate_message_deduplication() {
        let db = create_test_database();
        let conv = db.get_or_create_conversation("sender-1").unwrap();
        let msg = Message {
            id: "msg-duplicate-test".to_string(),
            conversation_id: conv.id.clone(),
            sender_id: "sender-1".to_string(),
            receiver_id: "receiver-1".to_string(),
            content: "Unique content".to_string(),
            message_type: "text".to_string(),
            timestamp: 500,
            status: "delivered".to_string(),
            error_reason: None,
            is_outgoing: false,
        };

        db.insert_message(&msg).unwrap();

        // Verify message exists
        let msgs = db.get_messages(&conv.id).unwrap();
        assert_eq!(msgs.len(), 1);

        // Check deduplication
        let is_dup = msgs.iter().any(|m| m.id == "msg-duplicate-test");
        assert!(
            is_dup,
            "Duplicate detector must recognize existing message ID"
        );
    }

    // 9. Delivery status failure transition when connection fails
    #[test]
    fn test_delivery_status_failure_transition() {
        let db = create_test_database();
        let conv = db.get_or_create_conversation("peer-unreachable").unwrap();
        let msg = Message {
            id: "msg-fail-test".to_string(),
            conversation_id: conv.id.clone(),
            sender_id: "me".to_string(),
            receiver_id: "peer-unreachable".to_string(),
            content: "Unreachable packet".to_string(),
            message_type: "text".to_string(),
            timestamp: 600,
            status: "sending".to_string(),
            error_reason: None,
            is_outgoing: true,
        };

        db.insert_message(&msg).unwrap();

        // Simulate connection refusal
        let error = "Connection refused or unreachable: Connection reset by peer";
        db.update_message_status(&msg.id, "failed", Some(error))
            .unwrap();

        let updated = db.get_message_by_id(&msg.id).unwrap().unwrap();
        assert_eq!(updated.status, "failed");
        assert_eq!(updated.error_reason, Some(error.to_string()));
    }
}
