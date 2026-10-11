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
 */
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

/// The boot parameters, serialized to JSON so no value can break out of the literal.
fn boot_script() -> Option<String> {
    let mut map = serde_json::Map::new();
    if let Some(scene) = boot_value("scene", "CAMELIA_SCENE") {
        map.insert("scene".into(), serde_json::Value::String(scene));
    }
    if let Some(url) = boot_value("engine-url", "CAMELIA_ENGINE_URL") {
        map.insert("engineUrl".into(), serde_json::Value::String(url));
    }
    if let Some(session) = boot_value("session-id", "CAMELIA_SESSION_ID") {
        map.insert("sessionId".into(), serde_json::Value::String(session));
    }
    if map.is_empty() {
        return None;
    }
    Some(format!(
        "window.__CAMELIA_BOOT__ = {};",
        serde_json::Value::Object(map)
    ))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Camelia")
                .inner_size(1280.0, 820.0)
                .min_inner_size(1024.0, 680.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                .theme(Some(tauri::Theme::Dark));
            if let Some(script) = boot_script() {
                window = window.initialization_script(script);
            }
            // Hidden until the webview applies saved geometry. A fallback show
            // keeps a JS error from leaving an invisible window.
            let built = window.build()?;
            let fallback = built.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                let _ = fallback.show();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the Camelia desktop shell");
}