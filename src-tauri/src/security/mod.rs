use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Clone)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

#[derive(Debug, PartialEq, Eq)]
pub enum KeyTrustCheck {
    FirstContact,
    MatchesExisting,
    KeyChangedWarning { expected: String, actual: String },
}

impl DeviceIdentity {
    pub fn load_or_create(conn: &Connection) -> Result<Self, String> {
        let stored_secret: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'identity_secret_key'",
                [],
                |row| row.get(0),
            )
            .ok();

        let stored_device_id: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'device_id'",
                [],
                |row| row.get(0),
            )
            .ok();

        if let (Some(secret_hex), Some(dev_id)) = (stored_secret, stored_device_id) {
            let secret_bytes = hex::decode(&secret_hex)
                .map_err(|e| format!("Corrupt identity_secret_key in database: {}", e))?;
            if secret_bytes.len() != 32 {
                return Err("Invalid identity key length in database".to_string());
            }
            let mut key_arr = [0u8; 32];
            key_arr.copy_from_slice(&secret_bytes);
            let signing_key = SigningKey::from_bytes(&key_arr);
            let verifying_key = signing_key.verifying_key();

            Ok(Self {
                device_id: dev_id,
                signing_key,
                verifying_key,
            })
        } else {
            // Generate new persistent identity
            let mut csprng = OsRng;
            let signing_key = SigningKey::generate(&mut csprng);
            let verifying_key = signing_key.verifying_key();
            let secret_hex = hex::encode(signing_key.to_bytes());
            let public_hex = hex::encode(verifying_key.to_bytes());

            let device_id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('device_id', ?1)",
                params![device_id],
            )
            .map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('identity_secret_key', ?1)",
                params![secret_hex],
            )
            .map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('identity_public_key', ?1)",
                params![public_hex],
            )
            .map_err(|e| e.to_string())?;

            Ok(Self {
                device_id,
                signing_key,
                verifying_key,
            })
        }
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.verifying_key.to_bytes())
    }

    pub fn sign_bytes(&self, data: &[u8]) -> String {
        let sig = self.signing_key.sign(data);
        hex::encode(sig.to_bytes())
    }

    pub fn fingerprint(&self) -> String {
        Self::format_fingerprint(&self.public_key_hex())
    }

    pub fn format_fingerprint(public_key_hex: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(public_key_hex.as_bytes());
        let hash = hasher.finalize();
        hash[..8]
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(":")
    }

    pub fn verify_signature(
        public_key_hex: &str,
        data: &[u8],
        signature_hex: &str,
    ) -> Result<bool, String> {
        let pub_bytes =
            hex::decode(public_key_hex).map_err(|e| format!("Invalid public key hex: {}", e))?;
        if pub_bytes.len() != 32 {
            return Err("Public key must be exactly 32 bytes".to_string());
        }
        let mut pub_arr = [0u8; 32];
        pub_arr.copy_from_slice(&pub_bytes);
        let verifying_key = VerifyingKey::from_bytes(&pub_arr)
            .map_err(|e| format!("Invalid Ed25519 public key: {}", e))?;

        let sig_bytes =
            hex::decode(signature_hex).map_err(|e| format!("Invalid signature hex: {}", e))?;
        if sig_bytes.len() != 64 {
            return Err("Signature must be exactly 64 bytes".to_string());
        }
        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&sig_bytes);
        let signature = Signature::from_bytes(&sig_arr);

        match verifying_key.verify(data, &signature) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub fn check_peer_key_trust(
        stored_pubkey: Option<&str>,
        incoming_pubkey: &str,
    ) -> KeyTrustCheck {
        match stored_pubkey {
            None | Some("") => KeyTrustCheck::FirstContact,
            Some(expected) if expected == incoming_pubkey => KeyTrustCheck::MatchesExisting,
            Some(expected) => KeyTrustCheck::KeyChangedWarning {
                expected: expected.to_string(),
                actual: incoming_pubkey.to_string(),
            },
        }
    }
}
