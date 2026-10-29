//! LANX 3.2: the phone page over HTTPS.
//!
//! A phone's browser only allows the microphone, notifications and "add to
//! home screen" on a page served over HTTPS. Nobody issues public
//! certificates for a PC on an office network, so LANX makes its own: a small
//! certificate authority ("LANX on <PC name>", good for ten years) and, signed
//! by it, a server certificate for this PC's addresses (renewed every year, or
//! as soon as the PC has an address that is not in it). A phone installs the
//! authority once — `/lanx-ca.crt` on Android, `/lanx-ca.mobileconfig` on an
//! iPhone — and trusts the secure page from then on. The files live in
//! `<data dir>\phone-tls\`; the private keys never leave this PC.

use super::PhoneService;
use base64::Engine;
use rand::RngCore;
use rand::rngs::OsRng;
use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, SerialNumber};
use rustls::ServerConfig;
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use time::{Duration, OffsetDateTime};

const CA_YEARS: i64 = 10;
const SERVER_DAYS: i64 = 365;
/// A server certificate this close to its end is renewed.
const RENEW_DAYS: i64 = 30;
const CA_PEM: &str = "ca.pem";
const CA_KEY: &str = "ca-key.pem";
/// The authority's name, kept so a renewed server certificate still names the
/// same issuer after the PC is renamed.
const CA_NAME: &str = "ca-name.txt";
const SERVER_PEM: &str = "server.pem";
const SERVER_KEY: &str = "server-key.pem";
/// What LANX remembers about the server certificate (so it knows when to
/// renew without a certificate parser): the names in it and when it ends.
const SERVER_META: &str = "server.json";

#[derive(Serialize, Deserialize)]
struct ServerMeta {
    sans: Vec<String>,
    not_after: i64,
}

/// The certificates in use, ready for the HTTPS listener.
pub struct Tls {
    dir: PathBuf,
    ca_pem: String,
    ca_der: Vec<u8>,
    fingerprint: String,
    sans: Vec<String>,
    not_after: i64,
    config: Arc<ServerConfig>,
}

impl Tls {
    /// The authority certificate as PEM text.
    pub fn ca_pem(&self) -> &str {
        &self.ca_pem
    }

    /// The authority certificate as DER bytes (what a phone installs).
    pub fn ca_der(&self) -> &[u8] {
        &self.ca_der
    }

    /// SHA-256 of the authority certificate, `AB:CD:…`, shown in Settings so
    /// a careful user can compare it with what the phone shows.
    pub fn ca_fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub fn server_config(&self) -> Arc<ServerConfig> {
        self.config.clone()
    }

    /// The names and addresses the server certificate is valid for.
    pub fn server_sans(&self) -> &[String] {
        &self.sans
    }

    /// When the server certificate ends (unix seconds).
    pub fn server_not_after(&self) -> i64 {
        self.not_after
    }

    /// Where `ca.pem` is on disk.
    pub fn ca_path(&self) -> PathBuf {
        self.dir.join(CA_PEM)
    }

    /// An unsigned Apple configuration profile carrying the authority, so an
    /// iPhone installs it from Settings. The identifiers come from the
    /// certificate's fingerprint: downloading the profile again updates the
    /// installed one instead of adding a second.
    pub fn mobileconfig(&self, pc_name: &str) -> String {
        let digest = Sha256::digest(&self.ca_der);
        let uuid = |b: &[u8]| {
            format!(
                "{}-{}-{}-{}-{}",
                hex::encode_upper(&b[0..4]),
                hex::encode_upper(&b[4..6]),
                hex::encode_upper(&b[6..8]),
                hex::encode_upper(&b[8..10]),
                hex::encode_upper(&b[10..16])
            )
        };
        let name = xml_escape(&format!("LANX certificate ({})", pc_name));
        let prefix = hex::encode(&digest[..6]);
        let data = base64::engine::general_purpose::STANDARD.encode(&self.ca_der);
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n<dict>\n\
\t<key>PayloadContent</key>\n\t<array>\n\t\t<dict>\n\
\t\t\t<key>PayloadCertificateFileName</key>\n\t\t\t<string>{file}.crt</string>\n\
\t\t\t<key>PayloadContent</key>\n\t\t\t<data>{data}</data>\n\
\t\t\t<key>PayloadDescription</key>\n\t\t\t<string>Lets this phone trust the LANX page on {pc}.</string>\n\
\t\t\t<key>PayloadDisplayName</key>\n\t\t\t<string>{name}</string>\n\
\t\t\t<key>PayloadIdentifier</key>\n\t\t\t<string>com.lanx.phone.ca.{prefix}.cert</string>\n\
\t\t\t<key>PayloadType</key>\n\t\t\t<string>com.apple.security.root</string>\n\
\t\t\t<key>PayloadUUID</key>\n\t\t\t<string>{uuid1}</string>\n\
\t\t\t<key>PayloadVersion</key>\n\t\t\t<integer>1</integer>\n\
\t\t</dict>\n\t</array>\n\
\t<key>PayloadDescription</key>\n\t<string>Lets this phone trust the LANX page on {pc}.</string>\n\
\t<key>PayloadDisplayName</key>\n\t<string>{name}</string>\n\
\t<key>PayloadIdentifier</key>\n\t<string>com.lanx.phone.ca.{prefix}</string>\n\
\t<key>PayloadOrganization</key>\n\t<string>LANX</string>\n\
\t<key>PayloadRemovalDisallowed</key>\n\t<false/>\n\
\t<key>PayloadType</key>\n\t<string>Configuration</string>\n\
\t<key>PayloadUUID</key>\n\t<string>{uuid2}</string>\n\
\t<key>PayloadVersion</key>\n\t<integer>1</integer>\n\
</dict>\n</plist>\n",
            file = file_name_for(pc_name),
            data = data,
            pc = xml_escape(pc_name),
            name = name,
            prefix = prefix,
            uuid1 = uuid(&digest[0..16]),
            uuid2 = uuid(&digest[16..32]),
        )
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// `LANX-<pc name>` with only letters, digits, `-` and `_` (a download name).
pub fn file_name_for(pc_name: &str) -> String {
    let safe: String = pc_name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    format!("LANX-{}", if safe.is_empty() { "PC".to_string() } else { safe })
}

/// `AB:CD:…` of the SHA-256 of some bytes.
pub fn fingerprint_of(der: &[u8]) -> String {
    let digest = Sha256::digest(der);
    digest.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(":")
}

/// Everything the server certificate must be valid for: loopback, the PC's
/// name and every address it has on the office network.
pub fn wanted_sans(pc_name: &str, addresses: &[String]) -> Vec<String> {
    let mut out = vec!["127.0.0.1".to_string(), "localhost".to_string()];
    let host = pc_name.trim().to_ascii_lowercase();
    if !host.is_empty() && host.len() <= 63 && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !host.starts_with('-') {
        out.push(host);
    }
    for a in addresses {
        let a = a.trim().to_string();
        if !a.is_empty() && a.parse::<std::net::IpAddr>().is_ok() && !out.contains(&a) {
            out.push(a);
        }
    }
    out
}

fn ca_params(cn: &str) -> Result<CertificateParams, String> {
    let mut p = CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, cn);
    dn.push(DnType::OrganizationName, "LANX");
    p.distinguished_name = dn;
    p.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign, KeyUsagePurpose::DigitalSignature];
    let now = OffsetDateTime::now_utc();
    p.not_before = now - Duration::days(1);
    p.not_after = now + Duration::days(365 * CA_YEARS + 2);
    p.serial_number = Some(random_serial());
    Ok(p)
}

fn random_serial() -> SerialNumber {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes[0] &= 0x7f; // a positive number
    SerialNumber::from_slice(&bytes)
}

fn read(dir: &Path, name: &str) -> Option<String> {
    std::fs::read_to_string(dir.join(name)).ok().filter(|s| !s.trim().is_empty())
}

fn write(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    std::fs::write(dir.join(name), text).map_err(|e| format!("cannot write {}: {}", name, e))
}

/// Loads the authority and server certificate from `dir`, making or renewing
/// whatever is missing, stale or does not cover `addresses`.
pub fn load_or_create(dir: &Path, pc_name: &str, addresses: &[String]) -> Result<Tls, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;

    // The authority: reused for as long as it exists (phones trust it).
    let (ca_name, ca_pem, ca_key) = match (read(dir, CA_NAME), read(dir, CA_PEM), read(dir, CA_KEY)) {
        (Some(name), Some(pem), Some(key)) if KeyPair::from_pem(&key).is_ok() && CertificateDer::from_pem_slice(pem.as_bytes()).is_ok() => (name.trim().to_string(), pem, key),
        _ => {
            let name = format!("LANX on {}", pc_name.trim());
            let key = KeyPair::generate().map_err(|e| e.to_string())?;
            let cert = ca_params(&name)?.self_signed(&key).map_err(|e| e.to_string())?;
            let pem = cert.pem();
            let key_pem = key.serialize_pem();
            write(dir, CA_NAME, &name)?;
            write(dir, CA_KEY, &key_pem)?;
            write(dir, CA_PEM, &pem)?;
            // A new authority: the old server certificate was signed by the old one.
            let _ = std::fs::remove_file(dir.join(SERVER_META));
            (name, pem, key_pem)
        }
    };
    let ca_der = CertificateDer::from_pem_slice(ca_pem.as_bytes()).map_err(|e| format!("bad {}: {}", CA_PEM, e))?;

    // The server certificate: renewed when it is missing, ends soon, or does
    // not name an address this PC has now.
    let wanted = wanted_sans(pc_name, addresses);
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let existing = (|| {
        let meta: ServerMeta = serde_json::from_str(&read(dir, SERVER_META)?).ok()?;
        let pem = read(dir, SERVER_PEM)?;
        let key = read(dir, SERVER_KEY)?;
        CertificateDer::from_pem_slice(pem.as_bytes()).ok()?;
        PrivateKeyDer::from_pem_slice(key.as_bytes()).ok()?;
        let covers = wanted.iter().all(|s| meta.sans.contains(s));
        let fresh = meta.not_after - now > RENEW_DAYS * 86_400;
        (covers && fresh).then_some((meta, pem, key))
    })();
    let (meta, server_pem, server_key) = match existing {
        Some(e) => e,
        None => {
            let ca_key = KeyPair::from_pem(&ca_key).map_err(|e| format!("bad {}: {}", CA_KEY, e))?;
            let issuer = Issuer::new(ca_params(&ca_name)?, ca_key);
            let mut p = CertificateParams::new(wanted.clone()).map_err(|e| e.to_string())?;
            let mut dn = DistinguishedName::new();
            dn.push(DnType::CommonName, format!("LANX phone page ({})", pc_name.trim()));
            dn.push(DnType::OrganizationName, "LANX");
            p.distinguished_name = dn;
            p.is_ca = IsCa::ExplicitNoCa;
            p.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
            p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
            let start = OffsetDateTime::now_utc();
            p.not_before = start - Duration::days(1);
            p.not_after = start + Duration::days(SERVER_DAYS);
            p.serial_number = Some(random_serial());
            let key = KeyPair::generate().map_err(|e| e.to_string())?;
            let cert = p.signed_by(&key, &issuer).map_err(|e| e.to_string())?;
            let meta = ServerMeta { sans: wanted.clone(), not_after: p.not_after.unix_timestamp() };
            let pem = cert.pem();
            let key_pem = key.serialize_pem();
            write(dir, SERVER_KEY, &key_pem)?;
            write(dir, SERVER_PEM, &pem)?;
            write(dir, SERVER_META, &serde_json::to_string(&meta).unwrap_or_default())?;
            (meta, pem, key_pem)
        }
    };

    let server_der = CertificateDer::from_pem_slice(server_pem.as_bytes()).map_err(|e| format!("bad {}: {}", SERVER_PEM, e))?;
    let key = PrivateKeyDer::from_pem_slice(server_key.as_bytes()).map_err(|e| format!("bad {}: {}", SERVER_KEY, e))?;
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![server_der, ca_der.clone()], key)
        .map_err(|e| format!("certificate not usable: {}", e))?;
    Ok(Tls {
        dir: dir.to_path_buf(),
        fingerprint: fingerprint_of(&ca_der),
        ca_der: ca_der.to_vec(),
        ca_pem,
        sans: meta.sans,
        not_after: meta.not_after,
        config: Arc::new(config),
    })
}

impl PhoneService {
    /// The name phones see: the PC's name from Settings (or Windows).
    pub(crate) fn pc_name(&self) -> String {
        self.network
            .db
            .get_settings()
            .ok()
            .map(|s| s.hostname)
            .filter(|h| !h.trim().is_empty())
            .or_else(|| std::env::var("COMPUTERNAME").ok())
            .filter(|h| !h.trim().is_empty())
            .unwrap_or_else(|| "PC".to_string())
    }

    fn tls_dir(&self) -> PathBuf {
        self.network.app_data_dir().join("phone-tls")
    }

    /// The certificates, made on first use (and cached).
    pub(crate) fn tls(&self) -> Option<Arc<Tls>> {
        if let Some(t) = self.tls.lock().clone() {
            return Some(t);
        }
        self.refresh_tls()
    }

    /// Re-reads the certificates, renewing the server one when this PC has
    /// an address it does not cover (a new Wi-Fi, say).
    pub(crate) fn refresh_tls(&self) -> Option<Arc<Tls>> {
        let addresses = if crate::testmode::bind_addr().is_loopback() { Vec::new() } else { crate::discovery::local_ipv4_addresses() };
        match load_or_create(&self.tls_dir(), &self.pc_name(), &addresses) {
            Ok(t) => {
                let t = Arc::new(t);
                *self.tls.lock() = Some(t.clone());
                Some(t)
            }
            Err(e) => {
                eprintln!("[Phone] secure page: no certificate ({})", e);
                None
            }
        }
    }

    /// The authority's fingerprint (empty until the certificates exist).
    pub fn cert_fingerprint(&self) -> String {
        self.tls().map(|t| t.ca_fingerprint().to_string()).unwrap_or_default()
    }

    /// Where `ca.pem` is (for "Reveal" in Settings).
    pub fn cert_path(&self) -> String {
        self.tls_dir().join(CA_PEM).to_string_lossy().to_string()
    }
}
