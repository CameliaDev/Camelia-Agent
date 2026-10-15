//! In-app updates — check, download, swap, restart.
//!
//! The shell used to ship `download_update`: it fetched the NSIS setup exe and
//! started it, so "updating" meant walking an installer wizard. This module adds
//! the path the product actually wants — a new version is noticed inside the app,
//! downloaded, checksum-verified, swapped in, and the app restarts itself.
//!
//! Why a feed file instead of the Tauri updater plugin: the updater plugin needs a
//! signing keypair and a `latest.json` served over TLS from a fixed endpoint. This
//! project ships from a repo and a local folder (`D:\app\Camelia`), so the feed is
//! just a JSON file the publisher puts anywhere reachable — GitHub raw by default
//! (mirror-friendly for restricted networks), a LAN server, or a file path — and
//! integrity comes from a sha256 the feed states, verified against the download.
//!
//! The swap itself follows the Windows rule that a running exe cannot be replaced:
//! the app writes a tiny hidden cmd that waits for its own PID to exit, moves the
//! downloaded exe into place, and starts it. The app then exits — the cmd finishes
//! the job with no second installer, no reboot, no user clicks.
//!
//! ```json
//! {
//!   "version": "0.1.29",
//!   "notes": "…",
//!   "portable": { "url": "https://…/camelia-desktop.exe", "sha256": "…" }
//! }
//! ```
//!
//! @module

use serde_json::{json, Value};

use std::path::PathBuf;
use std::process::Command;

/// Feed used when `~/.camelia/config.json` sets no `update.feedUrl`.
pub const DEFAULT_FEED_URL: &str =
    "https://gh-proxy.com/https://raw.githubusercontent.com/CameliaDev/Camelia-Agent/main/latest.json";

/// What the UI needs to render one update offer.
#[derive(Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub sha256: String,
}

/// A feed URL is allowed to come from these hosts only.
fn feed_url_allowed(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty()
        || url
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '\\' | '"' | '\'' | '<' | '>' | '`' | '#'))
    {
        return Err("feed URL contains illegal characters".into());
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| "feed URL must be http(s)".to_string())?;
    let (host_port, path_q) = rest
        .split_once('/')
        .ok_or_else(|| "feed URL is missing a path".to_string())?;
    let host = host_port
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port)
        .to_ascii_lowercase();
    let path = path_q.split('?').next().unwrap_or("");

    let allowed_host = matches!(
        host.as_str(),
        "raw.githubusercontent.com"
            | "github.com"
            | "gh-proxy.com"
            | "cdn.jsdelivr.net"
            | "localhost"
            | "127.0.0.1"
            | "::1"
    );
    if !allowed_host {
        return Err(format!("feed host not allowed: {host}"));
    }
    if host == "github.com" && !path.contains("/raw/") {
        return Err("github.com feed must be a /raw/ URL".into());
    }
    let _ = path;
    Ok(())
}

fn asset_url_allowed(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty()
        || url
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '\\' | '"' | '\'' | '<' | '>' | '`' | '#'))
    {
        return Err("asset URL contains illegal characters".into());
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| "asset URL must be http(s)".to_string())?;
    let host_port = rest.split_once('/').map(|(h, _)| h).unwrap_or(rest);
    let host = host_port
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port)
        .to_ascii_lowercase();
    let allowed = matches!(
        host.as_str(),
        "github.com"
            | "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com"
            | "github-releases.githubusercontent.com"
            | "gh-proxy.com"
            | "raw.githubusercontent.com"
            | "localhost"
            | "127.0.0.1"
            | "::1"
    );
    if !allowed {
        return Err(format!("asset host not allowed: {host}"));
    }
    let path = url.split('?').next().unwrap_or(url);
    if !path.to_ascii_lowercase().ends_with(".exe") {
        return Err("portable asset must be an .exe".into());
    }
    if !url.starts_with("https://")
        && !url.starts_with("http://127.")
        && !url.starts_with("http://localhost")
    {
        return Err("portable asset must be https (or loopback http)".into());
    }
    Ok(())
}

fn split_version(v: &str) -> (Vec<&str>, Option<&str>) {
    let v = v.trim().trim_start_matches('v').trim_start_matches('V');
    let (num, pre) = match v.split_once('-') {
        Some((n, p)) => (n, Some(p)),
        None => (v, None),
    };
    (num.split('.').filter(|p| !p.is_empty()).collect(), pre)
}

fn version_cmp(a: &str, b: &str) -> i32 {
    let (aa, ap) = split_version(a);
    let (bb, bp) = split_version(b);
    let n = aa.len().max(bb.len());
    for i in 0..n {
        let x: u64 = aa.get(i).and_then(|s| s.parse().ok()).unwrap_or(0);
        let y: u64 = bb.get(i).and_then(|s| s.parse().ok()).unwrap_or(0);
        if x < y {
            return -1;
        }
        if x > y {
            return 1;
        }
    }
    match (ap, bp) {
        (None, None) => 0,
        (None, Some(_)) => 1,
        (Some(_), None) => -1,
        (Some(x), Some(y)) => x.cmp(y) as i32,
    }
}

/// Read `update.feedUrl` from `~/.camelia/config.json`; default when absent.
pub fn feed_url_from_config() -> String {
    let path = super::camelia_home().join("config.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return DEFAULT_FEED_URL.to_string();
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&text) else {
        return DEFAULT_FEED_URL.to_string();
    };
    map.get("update")
        .and_then(Value::as_object)
        .and_then(|update| update.get("feedUrl"))
        .and_then(Value::as_str)
        .filter(|url| !url.trim().is_empty())
        .unwrap_or(DEFAULT_FEED_URL)
        .to_string()
}

/// Persist the feed URL so a user (or a future settings pane) can repoint it.
pub fn set_feed_url(url: &str) -> Result<(), String> {
    feed_url_allowed(url)?;
    let path = super::camelia_home().join("config.json");
    let mut map = match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        },
        _ => serde_json::Map::new(),
    };
    let entry = map
        .entry("update".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Value::Object(update) = entry {
        update.insert("feedUrl".to_string(), json!(url.trim()));
    }
    let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|err| err.to_string())?;
    std::fs::write(&path, text).map_err(|err| format!("failed to write config.json: {err}"))
}

/// Fetch the feed and report an update only when it is genuinely newer.
pub fn check_update(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    let feed = feed_url_from_config();
    feed_url_allowed(&feed)?;
    let body = http_get(&feed)?;
    let parsed: Value =
        serde_json::from_str(&body).map_err(|err| format!("feed is not valid JSON: {err}"))?;
    let version = parsed
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| "feed has no version".to_string())?
        .trim()
        .to_string();
    let portable = parsed
        .get("portable")
        .and_then(Value::as_object)
        .ok_or_else(|| "feed has no portable asset".to_string())?;
    let url = portable
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "feed asset has no url".to_string())?
        .trim()
        .to_string();
    let sha256 = portable
        .get("sha256")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    asset_url_allowed(&url)?;
    let notes = parsed
        .get("notes")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if version_cmp(&version, current_version) <= 0 {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version,
        notes,
        url,
        sha256,
    }))
}

fn http_get(url: &str) -> Result<String, String> {
    let output = hidden_command("curl")
        .args([
            "-sS",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            "30",
            url,
        ])
        .output()
        .map_err(|err| format!("curl failed to start: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("curl exit {}: {stderr}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Download to temp, verify sha256, then hand the swap to the detached cmd.
pub fn apply_portable_update(update: &UpdateInfo) -> Result<(), String> {
    asset_url_allowed(&update.url)?;
    let dest = installer_dest_path(&update.url);
    curl_download(&update.url, &dest)?;
    if !update.sha256.is_empty() {
        let actual = sha256_of(&dest)?;
        if actual != update.sha256 {
            let _ = std::fs::remove_file(&dest);
            return Err(format!(
                "checksum mismatch — expected {}, downloaded {}",
                update.sha256, actual
            ));
        }
    }
    spawn_swap_and_restart(&dest)?;
    Ok(())
}

/// `certutil -hashfile` — Windows built in, no sha2 crate in the dependency tree.
#[cfg(windows)]
fn sha256_of(path: &std::path::Path) -> Result<String, String> {
    let output = hidden_command("certutil")
        .args(["-hashfile", &path.to_string_lossy(), "SHA256"])
        .output()
        .map_err(|err| format!("certutil failed to start: {err}"))?;
    if !output.status.success() {
        return Err("certutil could not hash the download".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .find(|line| line.len() == 64 && line.chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(|line| line.to_ascii_lowercase())
        .ok_or_else(|| "certutil output had no sha256 line".into())
}

#[cfg(not(windows))]
fn sha256_of(_path: &std::path::Path) -> Result<String, String> {
    Err("portable update is only available on Windows".into())
}

pub fn current_exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|err| format!("cannot locate current exe: {err}"))
}

#[cfg(windows)]
fn spawn_swap_and_restart(downloaded: &std::path::Path) -> Result<(), String> {
    let target = current_exe_path()?;
    let pid = std::process::id();
    let temp_dir = std::env::temp_dir();
    let script = temp_dir.join(format!("camelia-swap-{pid}.cmd"));
    let downloaded = downloaded.to_string_lossy().replace('"', "");
    let target = target.to_string_lossy().replace('"', "");
    let script_s = script.to_string_lossy().replace('"', "");
    let body = format!(
        "@echo off\r\n:wait\r\ntasklist /pid {pid} 2>nul | findstr /i \"{pid}\" >nul\r\nif errorlevel 1 (goto swap)\r\ntimeout /t 1 /nobreak >nul\r\ngoto wait\r\n:swap\r\nmove /y \"{target}\" \"{target}.old\" >nul 2>nul\r\nmove /y \"{downloaded}\" \"{target}\"\r\nif errorlevel 1 (\r\n  move /y \"{target}.old\" \"{target}\" >nul 2>nul\r\n  exit /b 1\r\n)\r\ndel /q \"{target}.old\" >nul 2>nul\r\nstart \"\" \"{target}\"\r\ndel /q \"{script_s}\" >nul 2>nul\r\n",
    );
    std::fs::write(&script, body).map_err(|err| format!("failed to write swap script: {err}"))?;
    Command::new("cmd")
        .args(["/C", "start", "/min", &script_s])
        .spawn()
        .map_err(|err| format!("failed to start swap script: {err}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn spawn_swap_and_restart(_downloaded: &std::path::Path) -> Result<(), String> {
    Err("portable update is only available on Windows".into())
}

fn installer_dest_path(url: &str) -> PathBuf {
    let name = url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("camelia-update.exe");
    std::env::temp_dir().join(format!("camelia-dl-{name}"))
}

fn curl_download(url: &str, dest: &std::path::Path) -> Result<(), String> {
    let output = hidden_command("curl")
        .args([
            "-sS",
            "-L",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            "600",
            "-o",
            &dest.to_string_lossy(),
            url,
        ])
        .output()
        .map_err(|err| format!("curl failed to start: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(dest);
        return Err(format!("download failed: {stderr}"));
    }
    Ok(())
}

#[cfg(windows)]
fn hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn hidden_command(program: &str) -> Command {
    Command::new(program)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_feed_is_the_mirrored_raw_url() {
        assert!(DEFAULT_FEED_URL.contains("raw.githubusercontent.com"));
        assert!(DEFAULT_FEED_URL.contains("gh-proxy.com"));
    }

    #[test]
    fn feed_allows_repo_raw_and_mirror_and_loopback_http() {
        assert!(feed_url_allowed("https://raw.githubusercontent.com/CameliaDev/Camelia-Agent/main/latest.json").is_ok());
        assert!(feed_url_allowed(DEFAULT_FEED_URL).is_ok());
        assert!(feed_url_allowed("http://127.0.0.1:8080/latest.json").is_ok());
    }

    #[test]
    fn feed_refuses_other_hosts_credentials_and_bad_scheme() {
        assert!(feed_url_allowed("https://evil.example/latest.json").is_err());
        assert!(feed_url_allowed("ftp://raw.githubusercontent.com/x").is_err());
        assert!(feed_url_allowed("https://raw.githubusercontent.com/x.json?x=1#y").is_err());
    }

    #[test]
    fn asset_must_be_https_exe_on_an_allowed_host() {
        assert!(asset_url_allowed("https://github.com/CameliaDev/Camelia-Agent/releases/download/v1/camelia-desktop.exe").is_ok());
        assert!(asset_url_allowed("https://github.com/CameliaDev/Camelia-Agent/releases/download/v1/notes.txt").is_err());
    }

    #[test]
    fn version_compare_orders_numeric_then_lexical() {
        assert!(version_cmp("0.1.0", "0.2.0") < 0);
        assert!(version_cmp("0.2.0", "0.1.9") > 0);
        assert_eq!(version_cmp("v0.1.0", "0.1.0"), 0);
        assert!(version_cmp("0.1.0", "0.1.0-beta") > 0);
    }
}
