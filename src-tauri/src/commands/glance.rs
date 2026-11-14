//! LANX 3.15.0: what the wallpaper screen shows under its clock that the window cannot
//! find out by itself — this PC's battery, and the weather for a place the user chose.
//!
//! The weather is the one thing here that uses the internet. It comes from Open-Meteo
//! (open-meteo.com: free, no account, no key) and is fetched by the PC's own downloader,
//! as the wallpaper links are (`wallscreen.rs`): LANX has no HTTP client of its own.
//! Only the place the user picked (its coordinates) or the name they typed is sent.

use super::wallscreen::fetch_small;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Battery {
    /// 0..100
    pub percent: u8,
    pub charging: bool,
    /// On mains power.
    pub plugged: bool,
}

/// "73", "73,charging" or "73,plugged": a pretend battery for LANX's own tests (test copies only).
fn test_battery() -> Option<Battery> {
    crate::testmode::profile()?;
    let v = std::env::var("LANX_TEST_BATTERY").ok()?;
    let mut parts = v.split(',');
    let percent: u8 = parts.next()?.trim().parse().ok()?;
    let word = parts.next().unwrap_or("").trim().to_string();
    Some(Battery { percent: percent.min(100), charging: word == "charging", plugged: word == "charging" || word == "plugged" })
}

/// This PC's battery, or nothing when it has none (a desktop PC).
#[tauri::command]
pub fn battery_status() -> Option<Battery> {
    if let Some(b) = test_battery() {
        return Some(b);
    }
    read_battery()
}

#[cfg(windows)]
fn read_battery() -> Option<Battery> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    // SAFETY: a plain query that fills the struct handed to it.
    let s = unsafe {
        let mut s: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut s) == 0 {
            return None;
        }
        s
    };
    battery_from_windows(s.ACLineStatus, s.BatteryFlag, s.BatteryLifePercent)
}

/// Windows' three numbers as a battery: flag 128 = no battery, 255 = unknown, 8 = charging;
/// percent 255 = unknown; line 1 = on mains.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn battery_from_windows(line: u8, flag: u8, percent: u8) -> Option<Battery> {
    if flag == 255 || flag & 128 != 0 || percent > 100 {
        return None;
    }
    Some(Battery { percent, charging: flag & 8 != 0, plugged: line == 1 })
}

#[cfg(not(windows))]
fn read_battery() -> Option<Battery> {
    battery_from_sys(Path::new("/sys/class/power_supply"))
}

/// Linux: the first real battery under /sys/class/power_supply (a mouse's or a headset's
/// battery says `scope` = Device and is skipped).
#[cfg_attr(windows, allow(dead_code))]
pub fn battery_from_sys(dir: &Path) -> Option<Battery> {
    let read = |p: &Path, name: &str| std::fs::read_to_string(p.join(name)).ok().map(|s| s.trim().to_string());
    let mut found: Option<(u8, String)> = None;
    let mut mains = false;
    let mut entries: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        match read(&p, "type").as_deref() {
            Some("Battery") if read(&p, "scope").as_deref() != Some("Device") => {
                if found.is_none() {
                    if let Some(c) = read(&p, "capacity").and_then(|c| c.parse::<u8>().ok()) {
                        found = Some((c.min(100), read(&p, "status").unwrap_or_default()));
                    }
                }
            }
            Some("Mains") | Some("USB") => mains |= read(&p, "online").as_deref() == Some("1"),
            _ => {}
        }
    }
    let (percent, status) = found?;
    let charging = status == "Charging";
    Some(Battery { percent, charging, plugged: mains || charging || status == "Full" || status == "Not charging" })
}

// ------------------------------------------------------------------ the weather

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Place {
    pub name: String,
    /// "England, United Kingdom"
    pub region: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Weather {
    pub temp: f64,
    /// The weather as a WMO code (0 clear … 95 thunderstorm).
    pub code: u32,
    pub day: bool,
    pub high: Option<f64>,
    pub low: Option<f64>,
}

const NO_WEATHER: &str = "The weather could not be fetched (no internet?).";

/// A name as it may stand in a web address: every byte that is not a letter or digit as %XX.
pub fn url_word(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let dir = crate::storage::data_dir(crate::testmode::profile().as_deref()).join("glance");
    std::fs::create_dir_all(&dir).map_err(|_| NO_WEATHER.to_string())?;
    let part = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    let got = fetch_small(url, &part, 256 * 1024, std::time::Duration::from_secs(25));
    let text = std::fs::read_to_string(&part);
    let _ = std::fs::remove_file(&part);
    got.map_err(|_| NO_WEATHER.to_string())?;
    serde_json::from_str(&text.map_err(|_| NO_WEATHER.to_string())?).map_err(|_| NO_WEATHER.to_string())
}

/// The places a typed name can mean (at most five).
pub fn places_from(v: &serde_json::Value) -> Vec<Place> {
    let text = |r: &serde_json::Value, k: &str| r.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    v.get("results")
        .and_then(|r| r.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    let (lat, lon) = (r.get("latitude")?.as_f64()?, r.get("longitude")?.as_f64()?);
                    let name = text(r, "name");
                    if name.is_empty() || !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
                        return None;
                    }
                    let region = [text(r, "admin1"), text(r, "country")].into_iter().filter(|s| !s.is_empty() && *s != name).collect::<Vec<_>>().join(", ");
                    Some(Place { name: name.chars().take(60).collect(), region: region.chars().take(80).collect(), lat, lon })
                })
                .take(5)
                .collect()
        })
        .unwrap_or_default()
}

/// What the service answered, as the weather now (nothing when the answer has no temperature).
pub fn weather_from(v: &serde_json::Value) -> Option<Weather> {
    let cur = v.get("current")?;
    let temp = cur.get("temperature_2m")?.as_f64()?;
    if !temp.is_finite() || !(-120.0..=160.0).contains(&temp) {
        return None;
    }
    let first = |k: &str| v.get("daily").and_then(|d| d.get(k)).and_then(|a| a.get(0)).and_then(|x| x.as_f64()).filter(|x| x.is_finite());
    Some(Weather {
        temp,
        code: cur.get("weather_code").and_then(|c| c.as_u64()).unwrap_or(0).min(99) as u32,
        day: cur.get("is_day").and_then(|d| d.as_u64()).unwrap_or(1) != 0,
        high: first("temperature_2m_max"),
        low: first("temperature_2m_min"),
    })
}

/// Looks a place up by the name the user typed.
#[tauri::command(async)]
pub fn weather_places(query: String) -> Result<Vec<Place>, String> {
    let q: String = query.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if q.chars().count() < 2 {
        return Err("Type the name of a town or city.".to_string());
    }
    let url = format!("https://geocoding-api.open-meteo.com/v1/search?name={}&count=5&language=en&format=json", url_word(&q));
    let found = places_from(&fetch_json(&url)?);
    if found.is_empty() {
        return Err(format!("No place called “{q}” was found. Try the nearest larger town."));
    }
    Ok(found)
}

/// The weather now at a place the user picked.
#[tauri::command(async)]
pub fn weather_now(lat: f64, lon: f64, fahrenheit: bool) -> Result<Weather, String> {
    if !lat.is_finite() || !lon.is_finite() || !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("That place has no position LANX can use. Choose it again.".to_string());
    }
    let unit = if fahrenheit { "&temperature_unit=fahrenheit" } else { "" };
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1{unit}"
    );
    weather_from(&fetch_json(&url)?).ok_or_else(|| NO_WEATHER.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_windows_battery_numbers() {
        assert_eq!(battery_from_windows(1, 8, 64), Some(Battery { percent: 64, charging: true, plugged: true }));
        assert_eq!(battery_from_windows(0, 1, 97), Some(Battery { percent: 97, charging: false, plugged: false }));
        assert_eq!(battery_from_windows(1, 128, 255), None, "a desktop PC has no battery");
        assert_eq!(battery_from_windows(255, 255, 255), None, "unknown");
        assert_eq!(battery_from_windows(0, 2, 255), None, "a level Windows does not know");
    }

    #[test]
    fn the_linux_battery_files() {
        let dir = std::env::temp_dir().join(format!("lanx-battery-{}", uuid::Uuid::new_v4()));
        let put = |name: &str, files: &[(&str, &str)]| {
            let p = dir.join(name);
            std::fs::create_dir_all(&p).unwrap();
            for (f, v) in files {
                std::fs::write(p.join(f), format!("{v}\n")).unwrap();
            }
        };
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(battery_from_sys(&dir), None, "nothing there: a desktop PC");
        put("AC", &[("type", "Mains"), ("online", "0")]);
        put("hidpp_battery_0", &[("type", "Battery"), ("scope", "Device"), ("capacity", "12"), ("status", "Discharging")]);
        assert_eq!(battery_from_sys(&dir), None, "a mouse's battery is not the PC's");
        put("BAT0", &[("type", "Battery"), ("capacity", "58"), ("status", "Discharging")]);
        assert_eq!(battery_from_sys(&dir), Some(Battery { percent: 58, charging: false, plugged: false }));
        put("BAT0", &[("type", "Battery"), ("capacity", "59"), ("status", "Charging")]);
        put("AC", &[("type", "Mains"), ("online", "1")]);
        assert_eq!(battery_from_sys(&dir), Some(Battery { percent: 59, charging: true, plugged: true }));
        put("BAT0", &[("type", "Battery"), ("capacity", "100"), ("status", "Full")]);
        assert_eq!(battery_from_sys(&dir), Some(Battery { percent: 100, charging: false, plugged: true }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_typed_name_in_a_web_address() {
        assert_eq!(url_word("New Delhi"), "New%20Delhi");
        assert_eq!(url_word("Zürich&x=1"), "Z%C3%BCrich%26x%3D1");
        assert_eq!(url_word("पुणे"), "%E0%A4%AA%E0%A5%81%E0%A4%A3%E0%A5%87");
    }

    #[test]
    fn what_the_weather_service_answers() {
        let places: serde_json::Value = serde_json::from_str(
            r#"{"results":[{"name":"London","latitude":51.50853,"longitude":-0.12574,"country":"United Kingdom","admin1":"England"},
               {"name":"London","latitude":42.98339,"longitude":-81.23304,"country":"Canada","admin1":"Ontario"},
               {"name":"Nowhere","latitude":912.0,"longitude":0.0},{"latitude":1.0,"longitude":1.0}]}"#,
        )
        .unwrap();
        let found = places_from(&places);
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!((found[0].name.as_str(), found[0].region.as_str()), ("London", "England, United Kingdom"));
        assert!(places_from(&serde_json::json!({})).is_empty());

        let now: serde_json::Value = serde_json::from_str(
            r#"{"current":{"time":"2026-11-14T15:30","temperature_2m":9.3,"weather_code":1,"is_day":1},
                "daily":{"temperature_2m_max":[9.7],"temperature_2m_min":[0.1]}}"#,
        )
        .unwrap();
        assert_eq!(weather_from(&now), Some(Weather { temp: 9.3, code: 1, day: true, high: Some(9.7), low: Some(0.1) }));
        assert_eq!(weather_from(&serde_json::json!({"current":{"temperature_2m":21.0}})), Some(Weather { temp: 21.0, code: 0, day: true, high: None, low: None }));
        assert_eq!(weather_from(&serde_json::json!({"current":{"temperature_2m":9999.0}})), None);
        assert_eq!(weather_from(&serde_json::json!({"error":true})), None);
    }

    #[test]
    fn odd_places_are_refused_before_anything_is_fetched() {
        assert!(weather_places(" a ".to_string()).is_err());
        assert!(weather_now(f64::NAN, 0.0, false).is_err());
        assert!(weather_now(95.0, 0.0, false).is_err());
    }
}
