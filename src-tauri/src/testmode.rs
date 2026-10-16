//! Switches for running extra LANX copies side by side on one PC (automated
//! end-to-end tests). They only take effect together with `LANX_PROFILE`, so a
//! normal installation never reads them.
//!
//! - `LANX_PROFILE=a`        separate data folder, no single-instance lock
//! - `LANX_TCP_PORT=52941`   messaging port for this copy
//! - `LANX_UDP_PORT=52951`   discovery port for this copy
//! - `LANX_BIND=127.0.0.1`   listen on loopback only (no firewall prompt)
//! - `LANX_BEACON_TO=127.0.0.1:52952,...` extra discovery targets
//! - `LANX_QUIET=1`          no notifications, no "start with Windows"
//! - `LANX_INSTALL_DRY_RUN=1` "Update now" checks the installer but writes
//!   `Updates\install-dry-run.txt` in the data folder instead of starting it
//! - `LANX_BACKUP_DELAY=5`   seconds before the first automatic-backup check
//! - `LANX_RING_SECS=8`      how long a call rings before it counts as missed

use std::net::{Ipv4Addr, SocketAddr};

fn var(name: &str) -> Option<String> {
    std::env::var("LANX_PROFILE").ok().filter(|p| !p.trim().is_empty())?;
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

pub fn profile() -> Option<String> {
    std::env::var("LANX_PROFILE").ok().filter(|p| !p.trim().is_empty())
}

pub fn bind_addr() -> Ipv4Addr {
    var("LANX_BIND")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(Ipv4Addr::UNSPECIFIED)
}

pub fn tcp_port() -> Option<u16> {
    var("LANX_TCP_PORT").and_then(|v| v.trim().parse().ok())
}

pub fn udp_port() -> Option<u16> {
    var("LANX_UDP_PORT").and_then(|v| v.trim().parse().ok())
}

pub fn extra_beacon_targets() -> Vec<SocketAddr> {
    var("LANX_BEACON_TO")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default()
}

pub fn quiet() -> bool {
    var("LANX_QUIET").is_some()
}

pub fn install_dry_run() -> bool {
    var("LANX_INSTALL_DRY_RUN").is_some()
}

/// Seconds before the first automatic-backup check (90 normally).
pub fn backup_delay_secs() -> u64 {
    var("LANX_BACKUP_DELAY")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(90)
}

/// How long an unanswered call rings (45 s normally).
pub fn ring_timeout_secs() -> u64 {
    var("LANX_RING_SECS")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(45)
}
