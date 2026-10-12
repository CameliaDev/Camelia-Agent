import fs from 'node:fs';
import { execSync } from 'node:child_process';

let sha = 'unknown';
try { sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch {}

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('apps/desktop/src-tauri/src/main.rs', (s) => {
  if (s.includes('CAMELIA_APP_VERSION')) return s;
  const old = `fn boot_script(engine_url: Option<&str>, session_id: Option<&str>, scene: Option<&str>) -> Option<String> {
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
}`;
  const neu = `fn boot_script(engine_url: Option<&str>, session_id: Option<&str>, scene: Option<&str>) -> Option<String> {
    let mut map = serde_json::Map::new();
    map.insert("version".into(), serde_json::Value::String(env!("CARGO_PKG_VERSION").to_owned()));
    map.insert("commit".into(), serde_json::Value::String(option_env!("CAMELIA_GIT_SHA").unwrap_or("${sha}").to_owned()));
    if let Some(scene) = scene {
        map.insert("scene".into(), serde_json::Value::String(scene.to_owned()));
    }
    if let Some(url) = engine_url {
        map.insert("engineUrl".into(), serde_json::Value::String(url.to_owned()));
    }
    if let Some(session) = session_id {
        map.insert("sessionId".into(), serde_json::Value::String(session.to_owned()));
    }
    Some(format!(
        "window.__CAMELIA_BOOT__ = {};",
        serde_json::Value::Object(map)
    ))
}`;
  if (!s.includes(old)) throw new Error('boot_script needle');
  return s.replace(old, neu);
});

// Fix About fallback commit to current sha
edit('packages/ui/src/components/SettingsDrawer.tsx', (s) => {
  return s.replace("const commit = boot?.commit || 'f5592c3+';", `const commit = boot?.commit || '${sha}';`);
});

console.log('boot+about sha', sha);
