// Hide the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * Camelia desktop shell.
 *
 * Deliberately thin: the shell owns the window and the *boot parameters*, not the
 * product. All task state is projected by `@camelia/ui` from the engine's event stream
 * (whitepaper 搂6.1), so the Rust side stays a window factory 鈥?there is no business
 * logic here to drift.
 *
 * Boot parameters are injected as `window.__CAMELIA_BOOT__` before the bundle runs, so
 * the shell can select what the app projects without relying on the asset protocol's
 * query strings. Two modes are carried on the same channel:
 *   鈥?`--scene=<id>` / `CAMELIA_SCENE`         鈥?project a scripted fixture state;
 *   鈥?`--engine-url=<url>` / `CAMELIA_ENGINE_URL` 鈥?attach to a live `camelia serve`.
 * The UI prefers the engine URL when both are present, so pointing the shell at an
 * engine cannot accidentally show a demo scene.
 *
 * When no engine URL is provided, the shell spawns `camelia serve --port=0 --json`
 * as a child process, reads the bound URL from stdout, and injects it as the engine
 * URL so the desktop works out of the box without a separate terminal.
 *
 * All engine stdout/stderr after boot is appended to `~/.camelia/logs/engine.log`
 * so issues can be inspected after the fact.
 */
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

mod updater;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri::Manager;

/// `CREATE_NO_WINDOW` 鈥?Windows runs the child without allocating it a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A `Command` that never puts a console window on screen.
///
/// `node.exe` is a console-subsystem binary. When this GUI process spawns it, Windows
/// allocates a fresh console for the child unless `CREATE_NO_WINDOW` is set 鈥?and
/// because the engine lives as long as the window does, that black box stays on screen
/// for the whole session. Piping stdout/stderr does **not** suppress it; only the
/// creation flag does. The flag is a no-op on every other platform.
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Resolve a boot value from `--<name>=<value>` first, then the environment variable.
fn boot_value(flag: &str, env: &str) -> Option<String> {
    let prefix = format!("--{flag}=");
    std::env::args()
        .find_map(|arg| arg.strip_prefix(&prefix).map(str::to_owned))
        .or_else(|| std::env::var(env).ok())
        .filter(|value| !value.is_empty())
}

/// Path to the persistent engine log: `~/.camelia/logs/engine.log`.
fn engine_log_path() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = std::path::Path::new(&home).join(".camelia").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("engine.log")
}

/// Write a line to the engine log with a timestamp prefix.
fn log_line(tag: &str, line: &str) {
    let path = engine_log_path();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let now = chrono_local_now();
        let _ = writeln!(f, "{now} [{tag}] {line}");
    }
}

/// Small local timestamp without pulling in chrono as a heavy dep.
fn chrono_local_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Local time approximation (UTC+8 for the user's region).
    let local_secs = secs + 8 * 3600;
    let days = local_secs / 86400;
    let tod = local_secs % 86400;
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    // Days since 1970-01-01 鈫?year/month/day (rough, good enough for logs).
    let mut y = 1970u64;
    let mut remaining = days;
    loop {
        let year_days = if is_leap(y) { 366 } else { 365 };
        if remaining < year_days { break; }
        remaining -= year_days;
        y += 1;
    }
    let month_days: [u64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1u64;
    let mut d = remaining + 1;
    for (i, &md) in month_days.iter().enumerate() {
        let md = if i == 1 && is_leap(y) { md + 1 } else { md };
        if d <= md { m = (i + 1) as u64; break; }
        d -= md;
    }
    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}")
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

/// Camelia home: `~/.camelia`.
fn camelia_home() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&home).join(".camelia")
}

/// Find `packages/cli/dist/bin.js`.
///
/// An installed exe lives under `%LOCALAPPDATA%\Camelia`, so walking up from
/// the binary never reaches a checkout. `CAMELIA_CLI` and `~/.camelia/desktop.json`
/// (`{"cli":"..."}`) name the checkout explicitly; the walk remains for a
/// binary that still sits inside the repo.
fn find_engine_path() -> Option<std::path::PathBuf> {
    if let Ok(raw) = std::env::var("CAMELIA_CLI") {
        let candidate = std::path::PathBuf::from(raw.trim());
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(candidate) = cli_from_desktop_config() {
        return Some(candidate);
    }
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..10 {
        let candidate = dir.join("packages/cli/dist/bin.js");
        if candidate.is_file() {
            return Some(candidate);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

/// Strip a UTF-8 BOM if present. PowerShell `Set-Content -Encoding utf8` (Windows
/// PowerShell 5.x) writes a BOM that makes `serde_json` reject the whole file 鈥?/// which used to look like "CLI bin.js not found" with a valid-looking desktop.json.
fn strip_utf8_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

/// Parse `~/.camelia/desktop.json` (UTF-8, BOM tolerated). Returns None on any I/O or JSON error.
fn read_desktop_json() -> Option<serde_json::Value> {
    let path = camelia_home().join("desktop.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(strip_utf8_bom(&raw)).ok()
}

fn cli_from_desktop_config() -> Option<std::path::PathBuf> {
    let value = read_desktop_json()?;
    let cli = value.get("cli")?.as_str()?.trim();
    let candidate = std::path::PathBuf::from(cli);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn config_path() -> std::path::PathBuf {
    camelia_home().join("config.json")
}

fn keys_path() -> std::path::PathBuf {
    camelia_home().join("keys.json")
}

fn read_config_object() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
    match serde_json::from_str::<serde_json::Value>(&raw).map_err(|err| err.to_string())? {
        serde_json::Value::Object(map) => Ok(map),
        _ => Err("config.json is not an object".into()),
    }
}

fn clean_model_id(value: &str, allow_empty: bool) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return if allow_empty { Ok(String::new()) } else { Err("model is required".into()) };
    }
    if trimmed.len() > 80 {
        return Err("model id is too long".into());
    }
    let ok = trimmed.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '/' | '-' | '@'));
    if !ok {
        return Err(format!("invalid model id: {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn clean_provider_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return Err("provider id is required".into());
    }
    if trimmed.len() > 64 {
        return Err("provider id is too long".into());
    }
    let ok = trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if !ok || trimmed.starts_with('-') || trimmed.starts_with('_') {
        return Err(format!("invalid provider id: {trimmed}"));
    }
    Ok(trimmed)
}

fn clean_base_url(value: &str, allow_empty: bool) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return if allow_empty {
            Ok(String::new())
        } else {
            Err("base URL is required".into())
        };
    }
    if trimmed.len() > 512 {
        return Err("base URL is too long".into());
    }
    if trimmed.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("base URL contains whitespace".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("base URL must start with http:// or https://".into());
    }
    Ok(trimmed.to_string())
}

fn clean_plan_approval(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "always" => Ok("always".to_string()),
        "auto" => Ok("auto".to_string()),
        other => Err(format!("invalid plan approval mode: {other}")),
    }
}

fn write_config_map(map: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let home = camelia_home();
    std::fs::create_dir_all(&home).map_err(|err| err.to_string())?;
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|err| err.to_string())?;
    std::fs::write(config_path(), format!("{body}\n")).map_err(|err| err.to_string())
}

fn write_keys_map(map: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let home = camelia_home();
    std::fs::create_dir_all(&home).map_err(|err| err.to_string())?;
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|err| err.to_string())?;
    std::fs::write(keys_path(), format!("{body}\n")).map_err(|err| err.to_string())
}

fn providers_from_config(map: &serde_json::Map<String, serde_json::Value>) -> Vec<serde_json::Value> {
    match map.get("providers") {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                let obj = item.as_object()?;
                let id = obj.get("id")?.as_str()?.trim();
                if id.is_empty() {
                    return None;
                }
                let label = obj
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .trim();
                let base_url = obj
                    .get("baseUrl")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let kind = obj
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("openai-compatible");
                let models: Vec<serde_json::Value> = obj
                    .get("models")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.as_str())
                            .map(|m| m.trim())
                            .filter(|m| !m.is_empty())
                            .map(|m| serde_json::Value::String(m.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let default_model = obj
                    .get("defaultModel")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .map(|m| m.to_string());
                let mut out = serde_json::Map::new();
                out.insert("id".into(), serde_json::Value::String(id.to_string()));
                out.insert(
                    "label".into(),
                    serde_json::Value::String(if label.is_empty() {
                        id.to_string()
                    } else {
                        label.to_string()
                    }),
                );
                out.insert("kind".into(), serde_json::Value::String(kind.to_string()));
                out.insert("baseUrl".into(), serde_json::Value::String(base_url.to_string()));
                out.insert("models".into(), serde_json::Value::Array(models));
                if let Some(model) = default_model {
                    out.insert("defaultModel".into(), serde_json::Value::String(model));
                }
                Some(serde_json::Value::Object(out))
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Read optional `node` path from `~/.camelia/desktop.json`.
fn node_from_desktop_config() -> Option<String> {
    let value = read_desktop_json()?;
    let node = value.get("node")?.as_str()?.trim();
    let candidate = std::path::PathBuf::from(node);
    if candidate.is_file() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Prefer an fnm-managed Node 22 (matches repo `.nvmrc`) when present.
///
/// Supports both layouts:
/// - older: `node-versions/v22.x.y/installation/node.exe`
/// - current Windows: `node-versions/22.x.y/node-v22.x.y-win-x64/node.exe`
fn find_fnm_node22() -> Option<String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let roots = [
        std::path::Path::new(&home).join(r"AppData\Roaming\fnm\node-versions"),
        std::path::Path::new(&home).join(r"AppData\Local\fnm\node-versions"),
        std::path::Path::new(&home).join(r".fnm\node-versions"),
    ];
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            // Folder may be `v22.18.0` or bare `22.18.0`.
            if !(name.starts_with("v22") || name.starts_with("22.")) {
                continue;
            }
            let base = entry.path();
            let installation = base.join("installation").join("node.exe");
            if installation.is_file() {
                candidates.push(installation);
                continue;
            }
            // Windows fnm extracts as `node-v22.x.y-win-x64/node.exe` under the version dir.
            if let Ok(children) = std::fs::read_dir(&base) {
                for child in children.flatten() {
                    let child_name = child.file_name();
                    let child_name = child_name.to_string_lossy();
                    if !(child_name.starts_with("node-v22") || child_name.contains("win-")) {
                        continue;
                    }
                    let exe = child.path().join("node.exe");
                    if exe.is_file() {
                        candidates.push(exe);
                    }
                }
            }
            let direct = base.join("node.exe");
            if direct.is_file() {
                candidates.push(direct);
            }
        }
    }
    candidates.sort();
    candidates
        .pop()
        .map(|p| p.to_string_lossy().to_string())
}

/// Prefer nvm-windows Node 22 (`%NVM_HOME%\v22.*\node.exe`).
fn find_nvm_node22() -> Option<String> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("NVM_HOME") {
        roots.push(std::path::PathBuf::from(home));
    }
    if let Ok(user) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        roots.push(std::path::Path::new(&user).join(r"AppData\Roaming\nvm"));
        roots.push(std::path::Path::new(&user).join(r".nvm"));
    }
    roots.push(std::path::PathBuf::from(r"C:\Users\Public\nvm"));
    roots.push(std::path::PathBuf::from(r"d:\app\nvm"));
    roots.push(std::path::PathBuf::from(r"D:\app\nvm"));

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !(name.starts_with("v22") || name.starts_with("22.")) {
                continue;
            }
            let exe = entry.path().join("node.exe");
            if exe.is_file() {
                candidates.push(exe);
            }
        }
    }
    candidates.sort();
    candidates
        .pop()
        .map(|p| p.to_string_lossy().to_string())
}

/// Find node executable.
///
/// Order: `CAMELIA_NODE` 鈫?`~/.camelia/desktop.json` `node` 鈫?fnm Node 22 鈫?/// nvm-windows Node 22 鈫?Program Files 鈫?PATH. Preferring Node 22 avoids ABI
/// mismatches when `better-sqlite3` was built against the repo `.nvmrc` toolchain.
fn find_node() -> Option<String> {
    if let Ok(raw) = std::env::var("CAMELIA_NODE") {
        let candidate = std::path::PathBuf::from(raw.trim());
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    if let Some(candidate) = node_from_desktop_config() {
        return Some(candidate);
    }
    if let Some(candidate) = find_fnm_node22() {
        return Some(candidate);
    }
    if let Some(candidate) = find_nvm_node22() {
        return Some(candidate);
    }
    let preferred = r"C:\Program Files\nodejs\node.exe";
    if std::path::Path::new(preferred).exists() {
        return Some(preferred.to_string());
    }
    if let Ok(path) = std::env::var("PATH") {
        for entry in path.split(';') {
            let candidate = std::path::Path::new(entry).join("node.exe");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Remediation copy shared by ABI probe failures and post-mortem log scans.
fn abi_mismatch_hint(detail: &str) -> String {
    format!(
        "Node/better-sqlite3 ABI mismatch ({detail}). Use Node 22 per .nvmrc: set CAMELIA_NODE or ~/.camelia/desktop.json \"node\" to that node.exe (UTF-8, no BOM), or run `pnpm rebuild better-sqlite3` under the same Node the desktop will spawn. See engine.log."
    )
}

/// Quick load of better-sqlite3 under the chosen Node before `serve`.
/// Failures become a clear `engineSpawnError` instead of a silent fixture offline.
fn probe_better_sqlite3(node: &str, project_root: &std::path::Path) -> Result<(), String> {
    let script = concat!(
        "try {",
        " const path = require('path');",
        " const mod = path.join(process.cwd(), 'packages', 'core', 'node_modules', 'better-sqlite3');",
        " const Database = require(mod);",
        " const db = new Database(':memory:');",
        " db.exec('select 1');",
        " db.close();",
        " process.stdout.write('ok');",
        "} catch (e) {",
        " process.stderr.write(String(e && e.message ? e.message : e));",
        " process.exit(2);",
        "}"
    );
    let output = hidden_command(node)
        .arg("-e")
        .arg(script)
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("could not probe better-sqlite3: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&output.stderr);
    let err = err.trim();
    if err.contains("NODE_MODULE_VERSION") || err.contains("compiled against a different Node") {
        return Err(abi_mismatch_hint(err.lines().next().unwrap_or(err)));
    }
    if err.is_empty() {
        return Err("better-sqlite3 probe failed (no stderr) 鈥?check Node version vs .nvmrc".into());
    }
    Err(format!("better-sqlite3 probe failed: {err}"))
}

/// Spawn `camelia serve --port=0 --json` and return (child, engine_url, session_id).
///
/// After the URL is parsed, background threads continue piping stdout and stderr
/// into the log file so engine output after boot is not lost.
/// Desktop first-run defaults, written once into `~/.camelia/config.json`.
///
/// The plan gate exists so a plan can be *reviewed*, not so every conversation waits. The
/// engine's own fallback is `always`, which is right for headless `camelia` 鈥?nobody is
/// watching a CLI to click approve 鈥?but wrong for a window where the plan is on screen
/// the whole time. So the shell seeds `auto` instead, and never overwrites a value the
/// Settings toggle (or a hand-edit) already put there.
fn ensure_desktop_defaults() -> Result<(), String> {
    let mut map = read_config_object()?;
    if map.contains_key("planApproval") {
        return Ok(());
    }
    map.insert("planApproval".into(), serde_json::Value::String("auto".into()));
    write_config_map(map)
}

fn spawn_engine() -> Result<(Child, String, String), String> {
    let dbg_path = std::env::temp_dir().join("camelia-engine-debug.log");
    let mut dbg = String::new();

    // Seed the desktop's first-run policy *before* the engine exists. The engine reads
    // `~/.camelia/config.json` exactly once, at process start, so this is the last moment
    // the write can matter for this launch.
    dbg.push_str(&format!("seed: {:?}\n", ensure_desktop_defaults()));

    let bin = find_engine_path();
    dbg.push_str(&format!("bin: {:?}\n", bin));
    let Some(bin) = bin else {
        let msg = "CLI bin.js not found (set CAMELIA_CLI or ~/.camelia/desktop.json cli)".to_string();
        dbg.push_str(&format!("{msg}\n"));
        let _ = std::fs::write(&dbg_path, &dbg);
        return Err(msg);
    };

    let node = find_node();
    dbg.push_str(&format!("node: {:?}\n", node));
    let Some(node) = node else {
        let msg = "node.exe not found (set CAMELIA_NODE or desktop.json node)".to_string();
        dbg.push_str(&format!("{msg}\n"));
        let _ = std::fs::write(&dbg_path, &dbg);
        return Err(msg);
    };

    let Some(project_root) = bin.ancestors().nth(4).map(|p| p.to_path_buf()) else {
        let msg = format!("could not resolve project root from {}", bin.display());
        dbg.push_str(&format!("{msg}\n"));
        let _ = std::fs::write(&dbg_path, &dbg);
        return Err(msg);
    };
    dbg.push_str(&format!("project_root: {:?}\n", project_root));

    if let Err(err) = probe_better_sqlite3(&node, &project_root) {
        dbg.push_str(&format!("sqlite probe: {err}\n"));
        let _ = std::fs::write(&dbg_path, &dbg);
        log_line("boot", &err);
        return Err(err);
    }
    dbg.push_str("sqlite probe: ok\n");

    // Truncate the log on each fresh engine start so it does not grow forever.
    let _ = std::fs::write(engine_log_path(), format!("--- engine started {} ---\n", chrono_local_now()));

    let child = hidden_command(&node)
        .arg(&bin)
        .arg("serve")
        .arg("--port=0")
        .arg("--json")
        .current_dir(&project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    match &child {
        Ok(c) => dbg.push_str(&format!("spawned pid: {}\n", c.id())),
        Err(e) => {
            dbg.push_str(&format!("spawn error: {e}\n"));
            let _ = std::fs::write(&dbg_path, &dbg);
            return Err(format!("spawn error: {e}"));
        }
    }
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return Err(format!("spawn error: {e}")),
    };

    let stdout = child.stdout.take().ok_or_else(|| "engine stdout missing".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "engine stderr missing".to_string())?;

    // Drain stderr into the log in a background thread immediately.
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            log_line("err", &line);
        }
    });

    // Read stdout line by line until we parse the ready JSON.
    let mut reader = BufReader::new(stdout);
    let mut buf = String::new();
    let mut engine_url: Option<String> = None;
    let mut session_id: Option<String> = None;

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                log_line("out", line.trim_end());
                buf.push_str(&line);
                if engine_url.is_none() {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&buf) {
                        if let Some(url) = value.get("url").and_then(|v| v.as_str()) {
                            let session = value
                                .get("sessionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            dbg.push_str(&format!("engine ready: {url}\n"));
                            engine_url = Some(url.to_string());
                            session_id = Some(session);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                log_line("err", &format!("stdout read error: {e}"));
                break;
            }
        }
    }

    let Some(url) = engine_url else {
        let log_tail = std::fs::read_to_string(engine_log_path()).unwrap_or_default();
        let msg = if log_tail.contains("NODE_MODULE_VERSION")
            || log_tail.contains("compiled against a different Node")
        {
            abi_mismatch_hint("engine crashed while loading SQLite")
        } else {
            "engine exited before ready JSON 鈥?see ~/.camelia/logs/engine.log (not a live connection; fixture offline is intentional until spawn succeeds)".to_string()
        };
        dbg.push_str(&format!("{msg}\n"));
        let _ = std::fs::write(&dbg_path, &dbg);
        let _ = child.kill();
        let _ = child.wait();
        return Err(msg);
    };
    let session = session_id.unwrap_or_default();

    // Continue draining stdout into the log in a background thread.
    std::thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            log_line("out", &line);
        }
    });

    let _ = std::fs::write(&dbg_path, dbg);
    Ok((child, url, session))
}

/// The boot parameters, serialized to JSON so no value can break out of the literal.
fn boot_script(
    engine_url: Option<&str>,
    session_id: Option<&str>,
    scene: Option<&str>,
    spawn_error: Option<&str>,
) -> Option<String> {
    let mut map = serde_json::Map::new();
    map.insert("version".into(), serde_json::Value::String(env!("CARGO_PKG_VERSION").to_owned()));
    map.insert("commit".into(), serde_json::Value::String(option_env!("CAMELIA_GIT_SHA").unwrap_or("f5592c3").to_owned()));
    if let Some(scene) = scene {
        map.insert("scene".into(), serde_json::Value::String(scene.to_owned()));
    }
    if let Some(url) = engine_url {
        map.insert("engineUrl".into(), serde_json::Value::String(url.to_owned()));
    }
    if let Some(session) = session_id {
        map.insert("sessionId".into(), serde_json::Value::String(session.to_owned()));
    }
    if let Some(err) = spawn_error {
        map.insert("engineSpawnError".into(), serde_json::Value::String(err.to_owned()));
    }
    Some(format!(
        "window.__CAMELIA_BOOT__ = {};",
        serde_json::Value::Object(map)
    ))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|err| format!("failed to open URL: {err}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(trimmed)
            .spawn()
            .map_err(|err| format!("failed to open URL: {err}"))?;
    }
    Ok(())
}

/// Native folder dialog via `rfd` (IFileDialog on Windows).
///
/// The previous PowerShell `FolderBrowserDialog` spawn used redirected stdout and
/// often failed to surface a window from the Tauri WebView host — the UI then
/// showed 「文件夹选择框没有打开」. Typed paths still work when this returns Err.
#[tauri::command]
fn pick_folder() -> Result<String, String> {
    // `rfd` must run off the async runtime; spawn_blocking keeps the UI responsive.
    let picked = std::thread::spawn(|| {
        rfd::FileDialog::new()
            .set_title("Select folder")
            .pick_folder()
    })
    .join()
    .map_err(|_| "folder dialog failed: thread panicked".to_string())?;

    match picked {
        Some(path) => {
            let s = path.to_string_lossy().trim().to_string();
            if s.is_empty() {
                Err("cancelled".into())
            } else {
                Ok(s)
            }
        }
        None => Err("cancelled".into()),
    }
}

#[tauri::command]
fn github_device_code(client_id: String, scope: String) -> Result<serde_json::Value, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("missing-client-id".into());
    }
    let scope = if scope.trim().is_empty() {
        "read:user public_repo".to_string()
    } else {
        scope.trim().to_string()
    };
    let body = format!("client_id={}&scope={}", urlencoding_form(client_id), urlencoding_form(&scope));
    let raw = curl_github_form("https://github.com/login/device/code", &body)?;
    Ok(raw)
}

#[tauri::command]
fn github_device_poll(client_id: String, device_code: String) -> Result<serde_json::Value, String> {
    let client_id = client_id.trim();
    let device_code = device_code.trim();
    if client_id.is_empty() {
        return Err("missing-client-id".into());
    }
    if device_code.is_empty() {
        return Err("missing-device-code".into());
    }
    let body = format!(
        "client_id={}&device_code={}&grant_type={}",
        urlencoding_form(client_id),
        urlencoding_form(device_code),
        urlencoding_form("urn:ietf:params:oauth:grant-type:device_code")
    );
    let raw = curl_github_form("https://github.com/login/oauth/access_token", &body)?;
    Ok(raw)
}

fn urlencoding_form(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn curl_github_form(url: &str, body: &str) -> Result<serde_json::Value, String> {
    let output = hidden_command("curl")
        .args([
            "-sS",
            "-X",
            "POST",
            url,
            "-H",
            "Accept: application/json",
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "--data",
            body,
        ])
        .output()
        .map_err(|err| format!("curl failed to start: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("curl exit {}: {stderr}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(text.trim()).map_err(|err| format!("github response was not JSON: {err}; body={text}"))
}
#[tauri::command]
fn open_engine_log() -> Result<String, String> {
    let path = engine_log_path();
    // Open the log file in the default text editor.
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("notepad.exe")
            .arg(&path)
            .spawn();
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_model_settings() -> Result<serde_json::Value, String> {
    let map = read_config_object()?;
    let preferred = map
        .get("preferredProvider")
        .and_then(|value| value.as_str())
        .unwrap_or("ollama");
    let model = map.get("model").and_then(|value| value.as_str()).unwrap_or("");
    let grunt = map.get("gruntModel").and_then(|value| value.as_str()).unwrap_or("");
    let providers = providers_from_config(&map);
    Ok(serde_json::json!({
        "preferredProvider": preferred,
        "model": model,
        "gruntModel": grunt,
        // `null` when this install has never chosen, so the webview can tell
        // "not set" apart from "set to the default" and avoid clobbering its own.
        "planApproval": map.get("planApproval").and_then(|value| value.as_str()),
        "providers": providers,
    }))
}

/// Persist the plan-approval policy into `~/.camelia/config.json`.
///
/// This is the durable half of the Settings toggle. The engine command
/// (`set_plan_approval`) only mutates process memory, and the desktop shell spawns a
/// fresh engine on every launch 鈥?without this write the choice reverted to `always`
/// on restart, which is why every conversation kept stopping at the plan gate.
#[tauri::command]
fn write_plan_approval(mode: String) -> Result<(), String> {
    let mode = clean_plan_approval(&mode)?;
    let mut map = read_config_object()?;
    map.insert("planApproval".into(), serde_json::Value::String(mode));
    write_config_map(map)
}

#[tauri::command]
fn write_model_settings(preferred_provider: String, model: String, grunt_model: String) -> Result<(), String> {
    let provider = clean_provider_id(&preferred_provider)?;
    let model = clean_model_id(&model, false)?;
    let grunt = clean_model_id(&grunt_model, true)?;
    let mut map = read_config_object()?;
    map.insert("preferredProvider".into(), serde_json::Value::String(provider));
    map.insert("model".into(), serde_json::Value::String(model));
    if grunt.is_empty() {
        map.remove("gruntModel");
    } else {
        map.insert("gruntModel".into(), serde_json::Value::String(grunt));
    }
    write_config_map(map)
}

#[tauri::command]
fn upsert_provider_preset(
    id: String,
    label: String,
    base_url: String,
    models: Vec<String>,
    default_model: Option<String>,
    model_capabilities: Option<serde_json::Value>,
    activate: Option<bool>,
    model: Option<String>,
    grunt_model: Option<String>,
) -> Result<(), String> {
    let id = clean_provider_id(&id)?;
    let label = label.trim();
    if label.is_empty() || label.len() > 80 {
        return Err("preset name is required".into());
    }
    if label.chars().any(|ch| ch.is_control()) {
        return Err("preset name contains control characters".into());
    }
    let base = clean_base_url(&base_url, id == "ollama")?;
    let base = if base.is_empty() {
        "http://127.0.0.1:11434/v1".to_string()
    } else {
        base
    };
    let cleaned_models: Vec<String> = models
        .iter()
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .map(|m| clean_model_id(m, false))
        .collect::<Result<Vec<_>, _>>()?;
    let default = default_model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(|m| clean_model_id(m, false))
        .transpose()?
        .or_else(|| cleaned_models.first().cloned());

    let mut entry = serde_json::Map::new();
    entry.insert("id".into(), serde_json::Value::String(id.clone()));
    entry.insert("label".into(), serde_json::Value::String(label.to_string()));
    entry.insert("kind".into(), serde_json::Value::String("openai-compatible".into()));
    entry.insert("baseUrl".into(), serde_json::Value::String(base));
    entry.insert(
        "models".into(),
        serde_json::Value::Array(
            cleaned_models
                .iter()
                .map(|m| serde_json::Value::String(m.clone()))
                .collect(),
        ),
    );
    if let Some(ref dm) = default {
        entry.insert("defaultModel".into(), serde_json::Value::String(dm.clone()));
    }
    if let Some(caps) = model_capabilities {
        if caps.is_object() {
            entry.insert("modelCapabilities".into(), caps);
        }
    }

    let mut map = read_config_object()?;
    let mut list = match map.remove("providers") {
        Some(serde_json::Value::Array(items)) => items,
        _ => Vec::new(),
    };
    let mut replaced = false;
    for item in list.iter_mut() {
        if item.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            if let Some(obj) = item.as_object_mut() {
                for (k, v) in entry.iter() {
                    obj.insert(k.clone(), v.clone());
                }
            } else {
                *item = serde_json::Value::Object(entry.clone());
            }
            replaced = true;
            break;
        }
    }
    if !replaced {
        list.push(serde_json::Value::Object(entry));
    }
    map.insert("providers".into(), serde_json::Value::Array(list));

    if activate.unwrap_or(false) {
        map.insert("preferredProvider".into(), serde_json::Value::String(id.clone()));
        let decision = model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(|m| clean_model_id(m, false))
            .transpose()?
            .or(default)
            .ok_or_else(|| "model is required when activating".to_string())?;
        map.insert("model".into(), serde_json::Value::String(decision));
        let grunt = grunt_model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(|m| clean_model_id(m, false))
            .transpose()?;
        if let Some(g) = grunt {
            map.insert("gruntModel".into(), serde_json::Value::String(g));
        }
    }

    write_config_map(map)
}

#[tauri::command]
fn delete_provider_preset(id: String) -> Result<(), String> {
    let id = clean_provider_id(&id)?;
    let mut map = read_config_object()?;
    let list = match map.remove("providers") {
        Some(serde_json::Value::Array(items)) => items,
        _ => Vec::new(),
    };
    let next: Vec<serde_json::Value> = list
        .into_iter()
        .filter(|item| item.get("id").and_then(|v| v.as_str()) != Some(id.as_str()))
        .collect();
    if next.is_empty() {
        map.remove("providers");
    } else {
        map.insert("providers".into(), serde_json::Value::Array(next));
    }
    if map.get("preferredProvider").and_then(|v| v.as_str()) == Some(id.as_str()) {
        map.insert(
            "preferredProvider".into(),
            serde_json::Value::String("ollama".into()),
        );
    }
    write_config_map(map)?;

    let mut keys = read_keys_object()?;
    if keys.remove(&id).is_some() {
        write_keys_map(keys)?;
    }
    Ok(())
}

fn read_keys_object() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = keys_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
    match serde_json::from_str::<serde_json::Value>(&raw).map_err(|err| err.to_string())? {
        serde_json::Value::Object(map) => Ok(map),
        _ => Err("keys.json is not an object".into()),
    }
}

fn key_hint(value: &str) -> String {
    let tail: String = value.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    if tail.is_empty() { String::new() } else { format!("路路路路{tail}") }
}

#[tauri::command]
fn read_key_status() -> Result<serde_json::Value, String> {
    let map = read_keys_object()?;
    let mut out = serde_json::Map::new();
    for id in ["aliyun", "openrouter", "opencode-zen", "ollama"] {
        if id == "ollama" {
            out.insert(id.into(), serde_json::json!({ "local": true, "configured": false, "hint": "" }));
            continue;
        }
        let configured = map.get(id).and_then(|value| value.as_str()).filter(|value| !value.is_empty());
        out.insert(
            id.into(),
            serde_json::json!({
                "local": false,
                "configured": configured.is_some(),
                "hint": configured.map(key_hint).unwrap_or_default(),
            }),
        );
    }
    for (id, value) in map.iter() {
        if out.contains_key(id) {
            continue;
        }
        let configured = value.as_str().filter(|v| !v.is_empty());
        out.insert(
            id.clone(),
            serde_json::json!({
                "local": false,
                "configured": configured.is_some(),
                "hint": configured.map(key_hint).unwrap_or_default(),
            }),
        );
    }
    Ok(serde_json::Value::Object(out))
}

/// Full key for a connectivity probe. The settings field stays empty once a key is saved,
/// so the webview cannot put `Authorization` on `GET /models` unless this command supplies it.
#[tauri::command]
fn read_provider_key(provider: String) -> Result<String, String> {
    let id = clean_provider_id(&provider)?;
    if id == "ollama" {
        return Ok(String::new());
    }
    let map = read_keys_object()?;
    Ok(map
        .get(&id)
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string())
}

#[tauri::command]
fn write_provider_key(provider: String, api_key: String) -> Result<(), String> {
    let id = clean_provider_id(&provider)?;
    if id == "ollama" {
        return Err("ollama does not use an API key".into());
    }
    let key = api_key.trim();
    if key.len() < 8 || key.len() > 512 {
        return Err("API key length looks wrong".into());
    }
    if key.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("API key contains whitespace".into());
    }
    let mut map = read_keys_object()?;
    map.insert(id, serde_json::Value::String(key.to_string()));
    write_keys_map(map)
}

/// Which hop of an update download this URL is.
///
/// The first URL must be this repo's GitHub Release asset. Later hops may be the
/// GitHub CDN that `releases/download` redirects to. A CDN URL is not accepted as
/// the URL the webview asks for.
#[derive(Clone, Copy)]
enum UpdateHop {
    Start,
    Redirect,
}

fn update_url_allowed(url: &str, hop: UpdateHop) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty()
        || url.chars().any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '\\' | '"' | '\'' | '<' | '>' | '`' | '#'))
    {
        return Err("update URL contains illegal characters".into());
    }
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| "update URL must be https".to_string())?;
    if rest.contains('@') {
        return Err("update URL must not include credentials".into());
    }
    let (host_port, path_q) = rest
        .split_once('/')
        .ok_or_else(|| "update URL is missing a path".to_string())?;
    let host = if let Some((host, port)) = host_port.rsplit_once(':') {
        if port != "443" {
            return Err("update URL port is not allowed".into());
        }
        host
    } else {
        host_port
    };
    let host = host.to_ascii_lowercase();
    let path = path_q.split('?').next().unwrap_or("");
    if path.is_empty() || path.contains("..") {
        return Err("update URL path is not allowed".into());
    }
    let release_prefix = "/CameliaDev/Camelia-Agent/releases/download/";
    let github_installer = host == "github.com"
        && path.starts_with(release_prefix)
        && path.to_ascii_lowercase().ends_with(".exe")
        && !path.to_ascii_lowercase().ends_with(".exe.blockmap");
    let cdn = matches!(
        host.as_str(),
        "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com"
            | "github-releases.githubusercontent.com"
    );
    match hop {
        UpdateHop::Start if github_installer => Ok(()),
        UpdateHop::Redirect if github_installer || cdn => Ok(()),
        _ => Err("update URL is not a Camelia release installer".into()),
    }
}

/// Download the NSIS setup exe and start it.
///
/// `curl` is invoked with a fixed argument list — the URL is one argument, never
/// interpolated into a shell. Redirects are followed one hop at a time and each
/// target is checked again. This does not change `installMode: currentUser`.
/// Silent signed updates still need a Tauri updater key and `latest.json`.
#[tauri::command]
fn download_update(url: String) -> Result<(), String> {
    let url = url.trim();
    update_url_allowed(url, UpdateHop::Start)?;
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("installer download is only available on Windows".into())
    }
    #[cfg(windows)]
    {
        let final_url = follow_update_redirects(url)?;
        let dest = installer_dest_path(&final_url);
        curl_download(&final_url, &dest)?;
        std::process::Command::new(&dest)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("failed to start installer: {err}"))
    }
}

#[cfg(windows)]
fn follow_update_redirects(start: &str) -> Result<String, String> {
    let mut current = start.to_string();
    for hop in 0..5 {
        let kind = if hop == 0 { UpdateHop::Start } else { UpdateHop::Redirect };
        update_url_allowed(&current, kind)?;
        let output = hidden_command("curl")
            .args([
                "-sS",
                "-I",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-redirs",
                "0",
                "--max-time",
                "30",
                &current,
            ])
            .output()
            .map_err(|err| format!("curl failed to start: {err}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("curl exit {}: {stderr}", output.status));
        }
        let headers = String::from_utf8_lossy(&output.stdout);
        let (status, location) = http_status_and_location(&headers)?;
        if (300..400).contains(&status) {
            let next = location.ok_or_else(|| "redirect without a location".to_string())?;
            if !next.starts_with("https://") {
                return Err("update redirect must be an absolute https URL".into());
            }
            current = next;
            continue;
        }
        if (200..300).contains(&status) {
            return Ok(current);
        }
        return Err(format!("download answered {status}"));
    }
    Err("too many redirects".into())
}

#[cfg(windows)]
fn http_status_and_location(raw: &str) -> Result<(u16, Option<String>), String> {
    let mut status = None;
    let mut location = None;
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("HTTP/") {
            if let Some(code) = rest.split_whitespace().nth(1).and_then(|part| part.parse().ok()) {
                status = Some(code);
                location = None;
            }
        } else if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("location") {
                location = Some(value.trim().to_string());
            }
        }
    }
    status
        .ok_or_else(|| "no HTTP status from curl".to_string())
        .map(|code| (code, location))
}

#[cfg(windows)]
fn installer_dest_path(url: &str) -> std::path::PathBuf {
    let path = url.split('?').next().unwrap_or(url);
    let raw = path.rsplit('/').next().unwrap_or("Camelia-setup.exe");
    let mut name = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            name.push(ch);
        }
    }
    if !name.to_ascii_lowercase().ends_with(".exe") || name.len() > 80 {
        name = "Camelia-setup.exe".into();
    }
    std::env::temp_dir().join(name)
}

#[cfg(windows)]
fn curl_download(url: &str, dest: &std::path::Path) -> Result<(), String> {
    let dest_str = dest.to_str().ok_or_else(|| "installer path is not utf-8".to_string())?;
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-redirs",
            "0",
            "--max-time",
            "600",
            "-o",
            dest_str,
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

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn read_engine_log(tail: Option<usize>) -> Result<String, String> {
    let path = engine_log_path();
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let n = tail.unwrap_or(200);
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > n { lines.len() - n } else { 0 };
    Ok(lines[start..].join("\n"))
}


/// Shell package version (from Cargo.toml / tauri.conf).
#[tauri::command]
fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Configured update feed URL (or the built-in default).
#[tauri::command]
fn update_feed_url() -> String {
    updater::feed_url_from_config()
}

/// Persist a new feed URL (allowlist-checked).
#[tauri::command]
fn set_update_feed(url: String) -> Result<(), String> {
    updater::set_feed_url(&url)
}

/// Ask the portable feed whether a newer build exists.
#[tauri::command]
fn check_update() -> Result<Option<serde_json::Value>, String> {
    let current = env!("CARGO_PKG_VERSION");
    match updater::check_update(current) {
        Ok(Some(info)) => Ok(Some(serde_json::json!({
            "version": info.version,
            "notes": info.notes,
            "url": info.url,
            "sha256": info.sha256,
        }))),
        Ok(None) => Ok(None),
        Err(_) => Ok(None),
    }
}

/// Download, verify sha256, swap the running exe, and exit so the swap script can finish.
#[tauri::command]
fn apply_update(
    app: tauri::AppHandle,
    version: String,
    url: String,
    sha256: String,
) -> Result<(), String> {
    let info = updater::UpdateInfo {
        version,
        notes: String::new(),
        url,
        sha256,
    };
    updater::apply_portable_update(&info)?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        app.exit(0);
    });
    Ok(())
}

fn main() {
    // If the user explicitly passed an engine URL or scene, don't spawn.
    let explicit_url = boot_value("engine-url", "CAMELIA_ENGINE_URL");
    let explicit_scene = boot_value("scene", "CAMELIA_SCENE");
    let explicit_session = boot_value("session-id", "CAMELIA_SESSION_ID");

    let engine_child: Mutex<Option<Child>> = Mutex::new(None);
    let engine_url: Option<String>;
    let session_id: Option<String>;
    let mut spawn_error: Option<String> = None;

    if explicit_url.is_none() && explicit_scene.is_none() {
        match spawn_engine() {
            Ok((child, url, session)) => {
                eprintln!("[camelia] engine ready at {url}");
                log_line("boot", &format!("engine ready at {url}"));
                engine_url = Some(url);
                session_id = if session.is_empty() { None } else { Some(session) };
                *engine_child.lock().unwrap() = Some(child);
            }
            Err(err) => {
                eprintln!("[camelia] could not spawn engine 鈥?falling back to offline mode: {err}");
                log_line("boot", &format!("could not spawn engine 鈥?offline mode: {err}"));
                engine_url = None;
                session_id = None;
                spawn_error = Some(err);
            }
        }
    } else {
        engine_url = explicit_url;
        session_id = explicit_session;
    }

    let script = boot_script(
        engine_url.as_deref(),
        session_id.as_deref(),
        explicit_scene.as_deref(),
        spawn_error.as_deref(),
    );

    tauri::Builder::default()
        .setup(move |app| {
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Camelia")
                .inner_size(1280.0, 820.0)
                .min_inner_size(1024.0, 680.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                .theme(Some(tauri::Theme::Dark));
            if let Some(script) = script {
                window = window.initialization_script(script);
            }
            let built = window.build()?;
            let fallback = built.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                let _ = fallback.show();
            });
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(mut child) = engine_child.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                // Quit the process — do not leave a headless engine or a second tray icon.
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            pick_folder,
            github_device_code,
            github_device_poll,
            open_engine_log,
            read_engine_log,
            read_model_settings,
            write_model_settings,
            write_plan_approval,
            upsert_provider_preset,
            delete_provider_preset,
            read_key_status,
            read_provider_key,
            write_provider_key,
            relaunch_app,
            download_update,
            current_version,
            update_feed_url,
            set_update_feed,
            check_update,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the Camelia desktop shell");
}

#[cfg(test)]
mod tests {
    use super::{clean_plan_approval, strip_utf8_bom, update_url_allowed, UpdateHop};

    #[test]
    fn clean_plan_approval_accepts_both_modes_and_normalises_case() {
        assert_eq!(clean_plan_approval("always").unwrap(), "always");
        assert_eq!(clean_plan_approval("auto").unwrap(), "auto");
        assert_eq!(clean_plan_approval("  AUTO  ").unwrap(), "auto");
    }

    #[test]
    fn clean_plan_approval_rejects_anything_else() {
        assert!(clean_plan_approval("").is_err());
        assert!(clean_plan_approval("never").is_err());
        assert!(clean_plan_approval("auto; rm -rf /").is_err());
    }

    #[test]
    fn strip_utf8_bom_removes_bom_only() {
        assert_eq!(strip_utf8_bom("{\"a\":1}"), "{\"a\":1}");
        assert_eq!(strip_utf8_bom("\u{feff}{\"cli\":\"x\"}"), "{\"cli\":\"x\"}");
    }

    #[test]
    fn update_url_allows_this_repos_setup_exe() {
        let url = "https://github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe";
        assert!(update_url_allowed(url, UpdateHop::Start).is_ok());
        assert!(update_url_allowed(url, UpdateHop::Redirect).is_ok());
    }

    #[test]
    fn update_url_rejects_other_hosts_and_assets_as_the_start() {
        assert!(update_url_allowed(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/x",
            UpdateHop::Start
        )
        .is_err());
        assert!(update_url_allowed(
            "https://github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/notes.txt",
            UpdateHop::Start
        )
        .is_err());
        assert!(update_url_allowed("https://evil.example/Camelia_0.2.0_x64-setup.exe", UpdateHop::Start).is_err());
        assert!(update_url_allowed(
            "https://github.com.evil.test/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe",
            UpdateHop::Start
        )
        .is_err());
        assert!(update_url_allowed(
            "https://user:pass@github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe",
            UpdateHop::Start
        )
        .is_err());
    }

    #[test]
    fn update_url_allows_github_cdn_only_after_a_redirect() {
        let cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/abc";
        assert!(update_url_allowed(cdn, UpdateHop::Start).is_err());
        assert!(update_url_allowed(cdn, UpdateHop::Redirect).is_ok());
        assert!(update_url_allowed("https://objects.githubusercontent.com/a/b", UpdateHop::Redirect).is_ok());
        assert!(update_url_allowed("https://github-releases.githubusercontent.com/a", UpdateHop::Redirect).is_ok());
        assert!(update_url_allowed("http://github.com/CameliaDev/Camelia-Agent/releases/download/v/a.exe", UpdateHop::Redirect).is_err());
    }

    #[test]
    fn strip_utf8_bom_keeps_content() {
        let raw = "{\n  \"node\": \"C:\\\\n\\\\node.exe\"\n}\n";
        assert_eq!(strip_utf8_bom(raw), raw);
    }
}
