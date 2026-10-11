// Hide the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * Camelia desktop shell.
 *
 * Deliberately thin: the shell owns the window and the *boot parameters*, not the
 * product. All task state is projected by `@camelia/ui` from the engine's event stream
 * (whitepaper §6.1), so the Rust side stays a window factory — there is no business
 * logic here to drift.
 *
 * Boot parameters are injected as `window.__CAMELIA_BOOT__` before the bundle runs, so
 * the shell can select what the app projects without relying on the asset protocol's
 * query strings. Two modes are carried on the same channel:
 *   • `--scene=<id>` / `CAMELIA_SCENE`         — project a scripted fixture state;
 *   • `--engine-url=<url>` / `CAMELIA_ENGINE_URL` — attach to a live `camelia serve`.
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

use tauri::{WebviewUrl, WebviewWindowBuilder};

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
    // Days since 1970-01-01 → year/month/day (rough, good enough for logs).
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

/// Find the project root by walking up from the current exe until we find
/// `packages/cli/dist/bin.js`.
fn find_engine_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..10 {
        let candidate = dir.join("packages/cli/dist/bin.js");
        if candidate.exists() {
            return Some(candidate);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

/// Find node executable. Prefer the system install over any sandbox runtime.
fn find_node() -> Option<String> {
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

/// Spawn `camelia serve --port=0 --json` and return (child, engine_url, session_id).
///
/// After the URL is parsed, background threads continue piping stdout and stderr
/// into the log file so engine output after boot is not lost.
fn spawn_engine() -> Option<(Child, String, String)> {
    let dbg_path = std::env::temp_dir().join("camelia-engine-debug.log");
    let mut dbg = String::new();

    let bin = find_engine_path();
    dbg.push_str(&format!("bin: {:?}\n", bin));
    let bin = bin?;

    let node = find_node();
    dbg.push_str(&format!("node: {:?}\n", node));
    let node = node?;

    let project_root = bin.ancestors().nth(4)?.to_path_buf();
    dbg.push_str(&format!("project_root: {:?}\n", project_root));

    // Truncate the log on each fresh engine start so it does not grow forever.
    let _ = std::fs::write(engine_log_path(), format!("--- engine started {} ---\n", chrono_local_now()));

    let child = Command::new(&node)
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
            let _ = std::fs::write(&dbg_path, dbg);
            return None;
        }
    }
    let mut child = child.ok()?;

    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;

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

    let url = engine_url?;
    let session = session_id.unwrap_or_default();

    // Continue draining stdout into the log in a background thread.
    std::thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            log_line("out", &line);
        }
    });

    let _ = std::fs::write(&dbg_path, dbg);
    Some((child, url, session))
}

/// The boot parameters, serialized to JSON so no value can break out of the literal.
fn boot_script(engine_url: Option<&str>, session_id: Option<&str>, scene: Option<&str>) -> Option<String> {
    let mut map = serde_json::Map::new();
    if let Some(scene) = scene {
        map.insert("scene".into(), serde_json::Value::String(scene.to_owned()));
    }
    if let Some(url) = engine_url {
        map.insert("engineUrl".into(), serde_json::Value::String(url.to_owned()));
    }
    if let Some(session) = session_id {
        map.insert("sessionId".into(), serde_json::Value::String(session.to_owned()));
    }
    if map.is_empty() {
        return None;
    }
    Some(format!(
        "window.__CAMELIA_BOOT__ = {};",
        serde_json::Value::Object(map)
    ))
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
fn read_engine_log(tail: Option<usize>) -> Result<String, String> {
    let path = engine_log_path();
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let n = tail.unwrap_or(200);
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > n { lines.len() - n } else { 0 };
    Ok(lines[start..].join("\n"))
}

fn main() {
    // If the user explicitly passed an engine URL or scene, don't spawn.
    let explicit_url = boot_value("engine-url", "CAMELIA_ENGINE_URL");
    let explicit_scene = boot_value("scene", "CAMELIA_SCENE");
    let explicit_session = boot_value("session-id", "CAMELIA_SESSION_ID");

    let engine_child: Mutex<Option<Child>> = Mutex::new(None);
    let engine_url: Option<String>;
    let session_id: Option<String>;

    if explicit_url.is_none() && explicit_scene.is_none() {
        match spawn_engine() {
            Some((child, url, session)) => {
                eprintln!("[camelia] engine ready at {url}");
                log_line("boot", &format!("engine ready at {url}"));
                engine_url = Some(url);
                session_id = if session.is_empty() { None } else { Some(session) };
                *engine_child.lock().unwrap() = Some(child);
            }
            None => {
                eprintln!("[camelia] could not spawn engine — falling back to offline mode");
                log_line("boot", "could not spawn engine — offline mode");
                engine_url = None;
                session_id = None;
            }
        }
    } else {
        engine_url = explicit_url;
        session_id = explicit_session;
    }

    let script = boot_script(engine_url.as_deref(), session_id.as_deref(), explicit_scene.as_deref());

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
            }
        })
        .invoke_handler(tauri::generate_handler![open_engine_log, read_engine_log])
        .run(tauri::generate_context!())
        .expect("failed to run the Camelia desktop shell");
}
