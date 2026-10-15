# @camelia/desktop

Camelia 的**桌面外壳**（Tauri 2.x，Rust + WebView2）。硬约束禁止 Electron。

它刻意做得很薄：外壳只负责「窗口 + 启动参数」，不持有任何业务状态。界面是 `@camelia/ui` 对领域事件流的投影（whitepaper §6.1），Rust 侧没有可漂移的逻辑。

## 职责

- **开窗**：创建主窗口（1280×820，暗色主题，最小 1024×680）。
- **注入启动参数**：在页面脚本执行前写入 `window.__CAMELIA_BOOT__`，让外壳（而非可被用户篡改的 URL）决定应用投影什么状态。同一条通道承载演示场景、真实引擎端点与要续接的会话。

- **诊断通道**：向 WebView 暴露 `open_engine_log` / `read_engine_log` / `relaunch_app`（以及模型与密钥读写）。状态栏上的连接状态打开设置里的「引擎与日志」，可查看 `~/.camelia/logs/engine.log`。引擎断开时显示恢复横幅。

## 边界

外壳**不**依赖 `harness`，也**不**直接读数据库。它只装载 `packages/ui/dist` 的构建产物，业务全部在 `ui → agent → harness → core` 分层内完成。

## 启动参数

| 来源 | 作用 |
| --- | --- |
| `--engine-url=<url>` 或环境变量 `CAMELIA_ENGINE_URL` | 连到真实 `camelia serve` 引擎（SSE）；与 `--scene` 同时存在时**优先引擎** |
| `--scene=<id>` 或环境变量 `CAMELIA_SCENE` | 选择投影的场景（`empty` / `connecting` / `planning` / `plan` / `diff` / `running` / `approval` / `failure` / `error` / `done`） |
| `--session-id=<id>` 或环境变量 `CAMELIA_SESSION_ID` | 续接指定会话 |
| 缺省 | **自动 spawn** `camelia serve --port=0 --json`；成功则注入 `engineUrl`（Live）。spawn 失败则无 `engineUrl`，UI 走 fixture `empty`，并注入 `engineSpawnError`（诚实 Offline，不假装 Live） |

参数在页面脚本执行前序列化为 `window.__CAMELIA_BOOT__`（JSON），值无法逃逸字面量。


## 引擎 Node / desktop.json

冷启动时外壳会 spawn 仓库里的 CLI。Node 解析顺序：

`CAMELIA_NODE` → `~/.camelia/desktop.json` 的 `node` → fnm / nvm-windows 的 **Node 22** → `C:\Program Files\nodejs\node.exe` → `PATH`。

CLI 路径：`CAMELIA_CLI` → `desktop.json` 的 `cli` → 从 exe 向上找 `packages/cli/dist/bin.js`。

| 键 / 变量 | 含义 |
| --- | --- |
| `CAMELIA_NODE` | 强制使用的 `node.exe`（应用 Node **22**，与 `.nvmrc` / `better-sqlite3` ABI 一致） |
| `CAMELIA_CLI` | 强制使用的 `packages/cli/dist/bin.js` |
| `~/.camelia/desktop.json` | `{"cli":"...","node":"..."}`，**UTF-8 无 BOM**（推荐 `node scripts/write-desktop-json.mjs`） |
| `CAMELIA_ENGINE_URL` | 跳过 spawn，直连已有引擎 |

系统装了 Node 24、原生模块按 Node 22 编译时，旧逻辑会静默落到 Offline fixture。现在会先 **probe `better-sqlite3`**，失败则把 ABI 原因写入 `engineSpawnError` / `engine.log`，UI 横幅展示——**fixture 不会假装 Live**。

## 构建

```bash
pnpm --filter @camelia/desktop desktop:build    # 生产构建（含 custom-protocol，内嵌 UI 产物）
pnpm --filter @camelia/desktop desktop:bundle   # 构建 UI + 产出 NSIS 安装包
pnpm --filter @camelia/desktop desktop:dev      # 开发运行（走 Vite devUrl，需先起 ui dev）
pnpm --filter @camelia/desktop desktop:check    # cargo check
```

> `custom-protocol` 特性决定 webview 加载内嵌产物还是 `devUrl`。`desktop:build` 会打开它；用裸 `cargo build --release` 而不带该特性，会得到一个连不上 devUrl 的白屏窗口。

## 本地覆盖（免安装 exe）

`desktop:build` 在 **Node 22** 下执行（与根 README 的 ABI 127 相同，不要在 Node 24 下重编 `better-sqlite3`）。产物是 `src-tauri/target/release/camelia-desktop.exe`。

要替换本机正在用的程序时，覆盖下面这些位置。`D:\app\Camelia` 不存在就先建目录。

| 目标 | 做法 |
| --- | --- |
| `D:\app\Camelia\camelia-desktop.exe` | 直接覆盖 |
| `%LOCALAPPDATA%\Camelia\camelia-desktop.exe` | 直接覆盖 |
| 桌面启动器 | 只保留一个 `Camelia.lnk`，原地更新。目标 `D:\app\Camelia\camelia-desktop.exe`，`WorkingDirectory` 为 `D:\app\Camelia` |

不要在桌面新增 `Camelia-Agent-new.exe`，也不要再放一份 `Camelia.exe`。界面行为以 [`docs/SHELL-UX.md`](../../docs/SHELL-UX.md) 为准。

一键同步（覆盖两处 exe + 合并为单个桌面快捷方式，去掉重复的 `Camelia*.lnk` 与旧版桌面 exe）：

```powershell
pnpm --filter @camelia/desktop desktop:install-local
```

NSIS 安装也会在桌面创建 `Camelia.lnk`（指向 `%LOCALAPPDATA%\Camelia`）。若你还在用 `D:\app\Camelia` 开发覆盖，请用上面的脚本合并，避免两个同名快捷方式、两个进程和多个托盘图标。

## 打包（NSIS）

`desktop:bundle` 先构建 `packages/ui/dist`，再用 `cargo tauri build --bundles nsis` 产出 Windows 安装包：

- **安装模式 `currentUser`**：按用户安装，不弹 UAC、不需要管理员——一个 AI 编码工具没有理由要求提权。
- **语言 `English` + `SimpChinese`**：与 UI 面向的中文用户一致；关掉语言选择器以免安装时多一步。
- 产物路径：`src-tauri/target/release/bundle/nsis/Camelia_<version>_x64-setup.exe`；同时产出免安装的 `src-tauri/target/release/camelia-desktop.exe`。

安装包与裸 exe 同源：都内嵌 `packages/ui/dist`，都只做「开窗 + 注入启动参数」。

### 实测（Windows 11）

| 步骤 | 结果 |
| --- | --- |
| 静默安装 `Camelia_0.1.0_x64-setup.exe /S` | 退出码 **0** |
| 安装目录 | `%LOCALAPPDATA%\Camelia\`（`camelia-desktop.exe` + `uninstall.exe`） |
| 卸载项 | `Camelia 0.1.0`，`InstallLocation=%LOCALAPPDATA%\Camelia` |
| 安装版可启动 | ✅ `tests/screenshots/desktop-installed.png`（`--scene=running`） |
| 安装版可连本地引擎 | ✅ `tests/screenshots/desktop-installed-live.png`（`--engine-url` 指向真实 `camelia serve`） |

卸载：`"%LOCALAPPDATA%\Camelia\uninstall.exe" /S`。

## 应用内检查更新

设置 → 账户 / 关于里的「检查更新」请求 `GET https://api.github.com/repos/CameliaDev/Camelia-Agent/releases/latest`，展示说明，并在 Windows 桌面上下载 `*-setup.exe` 后启动安装程序。安装模式仍是 `currentUser` 覆盖安装，这里不改它。

下载命令是 `download_update`。它只用参数列表调用 `curl`（不经 shell），起始 URL 必须是 `https://github.com/CameliaDev/Camelia-Agent/releases/download/…/*.exe`。重定向只允许落到 `objects.githubusercontent.com`、`release-assets.githubusercontent.com`、`github-releases.githubusercontent.com`，或同一条 Release 路径。非 Windows 直接拒绝。

静默签名更新还没做。那条路需要：Release 上的 `*-setup.exe`、Tauri updater 私钥、以及打进安装包的公钥和 `latest.json`。当前没有 `tauri-plugin-updater`。

## 插件

活动栏图标的名字是 **插件**。点开后左栏标题是 **扩展**，下面有搜索框（「搜索扩展目录」）、筛选和刷新。搜索同时过滤 Camelia 目录和本机已安装插件。

默认目录是 `https://raw.githubusercontent.com/CameliaDev/camelia-extensions/main/catalog.json`。仓库不可用时改读本仓库 `extensions-registry/catalog.json` 的 raw 地址。`CAMELIA_CATALOG_URL` 可覆盖，设了就不再回退。安装会浅克隆条目仓库，把 `path` 复制到 `~/.camelia/plugins/<id>`（须含 `camelia.plugin.json`）。Skills 栏用同一份目录的 `skills`，安装进 `~/.camelia/skills`。

引擎仍在进程启动时扫描 `~/.camelia/plugins`。没有启用开关。安装进磁盘后重新启动桌面才会加载。刷新会重新拉目录并重读已安装文件夹。说明在标题栏「…」→「如何安装」里。

示例：目录里的 `quiet-activity-bar`，或把本仓库 `plugins/quiet-activity-bar` 整夹复制到 `~/.camelia/plugins/quiet-activity-bar`，再启动桌面。这是主题存根（更安静的颜色记号），不是活动栏本身。48px 纯图标活动栏在应用里，不从插件里加载。

## 截图

```powershell
# 投影脚本化场景（fixture）
powershell -ExecutionPolicy Bypass -File scripts/desktop-screenshot.ps1 -Scene running -Out tests/screenshots/desktop-running.png

# 连真实引擎（启动 camelia serve，把 --engine-url 注入外壳）
powershell -ExecutionPolicy Bypass -File scripts/desktop-live-shot.ps1 -Out tests/screenshots/desktop-live.png
```

两个脚本都接受**绝对路径**的 `-Exe`（便于采集安装版 `%LOCALAPPDATA%\Camelia\camelia-desktop.exe`）与相对仓库根的路径。启动 exe、等待窗口、置前，再用 GDI 截取窗口矩形。截**屏幕区域**而非 `PrintWindow` 是有意的：WebView2 经 DirectComposition 渲染，`PrintWindow` 常返回空白帧。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src-tauri/src/main.rs` | 窗口工厂 + 启动参数注入（无业务逻辑） |
| `src-tauri/tauri.conf.json` | 产品名、标识、`frontendDist` 指向 `packages/ui/dist`、`devUrl` |
| `src-tauri/Cargo.toml` | Tauri 2.x 依赖与 `custom-protocol` 特性门 |
| `scripts/gen-icons.mjs` | 逐像素绘制山茶花图标，无外部图像依赖，构建可复现 |
| `scripts/desktop-live-shot.ps1` | 启动真实 `camelia serve`，把 `--engine-url` 注入外壳并采集窗口 |