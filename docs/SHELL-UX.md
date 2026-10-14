# Camelia 壳层（当前产品）

> **以 `main` 为准，PR #4 squash-merge 之后。** 提交 `1b36ad2`（`feat(ui): shell controls, isolated modes, and preset portraits`）。
>
> 本文描述已经交付的桌面界面。2026-10-13 的模式计划（只有 Work/Math、顶栏分段、桌面 `Camelia-Agent-new.exe`）是历史，见 [`PLAN-2026-10-13-mode-ia.md`](PLAN-2026-10-13-mode-ia.md) 文首说明。引擎能力边界仍以代码和 [`ITERATION_LOG.md`](ITERATION_LOG.md) 为准，不要把界面上的时间线当成多智能体已经在跑。

中文界面字符串以 `packages/ui/src/i18n/strings.ts` 的 `zh` 为准。下面的英文是代码里的 id。

## 模式：Work / Math / Term

顶栏**没有**模式切换。分段控件在**左侧会话栏上方**（`ModeTabs`，`data-mode-tabs`）。三个标签的中英文都是 **Work**、**Math**、**Term**。

| id | 中文标签 | 这一栏里有什么 |
| --- | --- | --- |
| `work` | Work | 日常对话。有任务时，任务卡嵌在聊天记录里。旧的 `chat` / `plan` 都归到这里。 |
| `math` | Math | 数学建模聊天。引擎还没有数模命令；演示课题必须手动加载，并带演示标记。 |
| `term` | Term | 团队模式的**本地**时间线。见下文「Term 的边界」。 |

不在分段控件里的「评测 / 教学」（`mode.eval` / `mode.teach`）只是登记过的后续名字，界面上没有。

会话**按模式隔离**：

- Work 只列出 `kind` 为 `work`、`chat`，或没有 `kind` 的会话（没有 `kind` 的旧行就是 Work）。
- Math 只列出 `kind === 'math'`。
- Term 只列出 `kind === 'term'`。

点另一个模式时，如果这一栏已经有自己的会话，就切到那条；**不会**为此新建会话，也不会改正在跑的任务。Math / Term 在没有自己的会话时，不把 Work 的对话显示出来。任务在 Work 里跑、人正在看 Math 或 Term 时，工作区顶部有一条「Work模式有一个任务正在运行」和「查看」。

`normalizeModeId` 把遗留的 `chat` 和 `plan` 收成 `work`。设置里的默认模式改的是下次窗口偏好（`localPrefs.preferredMode`），不是任务快照。

## 布局与快捷键

从左到右四列：48px 图标活动栏（不折叠）、会话栏（展开约 260px，收起为 0）、工作区、右侧抽屉（关掉时宽度为 0）。底栏状态条横跨整窗。顶栏是 36px 浮层（品牌、会话标题、窗控），可以常显、随顶部指针出现，或隐藏。

| 动作 | 怎么做 |
| --- | --- |
| 收起左侧会话栏 | 再点一次**当前已打开的活动栏图标**（会话或插件）。没有「收起会话」按钮。 |
| 展开左侧会话栏 | 点活动栏图标；栏已经收起时，顶栏也会出现展开按钮。 |
| 打开 / 关闭右侧抽屉 | 顶栏右侧的面板按钮。**抽屉开着时，这个按钮仍留在顶栏**，不进抽屉头。 |
| 键盘 | Ctrl+B 会话栏，Ctrl+Alt+B 产物抽屉，Ctrl+反引号把顶栏叫出来。按住不连发。齿轮 → **快捷方式配置** 里是同一组。 |

齿轮（活动栏最下方）先打开**小菜单**：主题 / 快捷方式配置 / 设置。主题在菜单里就生效，不会先进入整页设置。整页设置是菜单第三项。

右侧抽屉打开后落在**产物**。运行、记忆、上下文、事件、子代理在顶栏的 **更多** 里，不在抽屉头再做一条导航。Math 的「新建数学会话」会临时占住这一列（见下）。

## 输入框：模型与力度

模型芯片在输入框里。点它打开**输入框内的模型列表**（`data-composer-models`），不打开设置。列表是当前 provider 已配置的 id、该 provider 的预设目录、以及正在用的模型；也可以手打一个 id。选择发送 `select_provider`，**只换这个 provider 上的模型，不换厂商**。没有 provider 时芯片不打开列表。

力度是一颗**显示当前档位**的按钮，默认 **High**（`localPrefs.effort`）。点开弹出 **Max / High / Low**（中文界面也是这三个词），点某一档就设上，**不会**按一下轮换。Work / Math 发送 `chat_message` 或 `submit_task` 时带上 `effort`。它只是提示词里的深度约束，**不切换模型**。Term 的发送不走这两条命令（见下）。

Work 的输入框另外保留权限策略下拉。

## 底栏文件夹

状态条左下角的文件夹名是当前工作区路径的最后一段。点它输入路径，或在桌面壳里用「浏览」（`pick_folder`），再「使用此文件夹」。确认发送 `set_workspace`。路径不是文件夹时提示「这不是文件夹」；有任务在跑时提示「有任务正在进行」，并且不改当前任务。

## 第一次打开与登录

还没人登录、并且本机没有记下「已经跳过」时，先出整页登录（`data-login-gate`）。登录走 **GitHub device flow**（和账户菜单同一条），需要 OAuth client id。

跳过的按钮文案是 **暂不登录**（`login.skip`）。没有第二颗叫「跳过」的按钮。点它会：

- 写入 `localStorage` 的 `camelia.loginGate = skipped`；
- 留下未登录的默认账户（账户菜单显示「未登录」）；
- 下次启动不再出这页。

**退出登录**同样把这个标记写成 `skipped`，不会把登录页再挡回来。之后仍可从活动栏头像登录。

## 插件栏

活动栏图标的名字是 **插件**（`extensions.title` / `rail.extensions`）。点开后，左栏标题是 **扩展**（`extensions.panelTitle`），下面有搜索框「搜索已安装的扩展」。

搜索只过滤**这一栏里的已安装列表**。当前构建里这份列表是空数组，所以常见状态是「还没有插件」。引擎仍然只在**进程启动**时读取 `~/.camelia/plugins` 下带 `camelia.plugin.json` 的目录。没有启用开关，也没有应用内下载。「如何安装」在标题栏「…」里。示例插件 `plugins/quiet-activity-bar` 是主题存根，不替换这 48px 图标栏。

## 聊天里的「思考中」

用户消息发出、助手气泡还没出现时，记录上方有一枚 **思考中…**（`data-chat-thinking="pending"`）。助手气泡里的思考（`turn.thinking`，以及正文中的 `<think>` / `<thinking>`）用同一句当折叠标题：

- 还在流式、正文里还没有答案时，块是展开的（`data-chat-thinking="live"`）。
- 答案正文已经在标签外面时，块标成 `folded`。这条回复到达时答案已经写好的，思考默认收起。
- 若流式过程中块已经展开，答案到达后**不会**再强制折上：折叠组件只在「正在思考」时强制打开。

助手气泡正在流式输出时，另外有一条 **回复中…**。

## Term 的边界

Term 的时间线是 **plan → execute → verify → done**（界面文案：计划 / 执行 / 校验 / 完成）。它由输入框发送驱动：写入本地的 `termRun`，从 `plan` 开始，大约每 900ms 进下一站，直到 `done`。没有 Term 会话时会先 `new_session`，`kind: 'term'`。

这一条**不**发送 `submit_task`。引擎**没有**团队多智能体编排。时间线是窗口自己的状态，不是任务快照，也不能当成多个 agent 已经分工做完。

## Math 新建

在 Math 里点「新建会话」**不会**立刻建会话（删掉最后一条空白行时除外，那是为了栏里还有地方可去）。右侧打开 **新建数学会话**：

- 赛制：国赛（`cumcm`，默认）/ 美赛（`mcm`）/ 其他（`other`）；
- 是否 **使用内置模板**（默认勾选）。

模板选项就在这右侧栏里，没有另一份模板画廊。点「创建会话」才发送 `new_session`（`kind: 'math'`），并把赛制和是否用模板记在窗口状态里。创建后右栏设置收起，Math 进度条旁显示例如「美赛 · 内置模板」。

引擎仍无数模命令。「运行本阶段」不可用，并说明原因。演示课题要手动加载，带演示标记，不会自己开始。

## 设置里的记忆

齿轮 → 设置，左侧有 **记忆**（`settings.section.memory`）。这一页列出引擎里的全部记忆（`list_memories`，不带会话范围），可以提升、标为不正确、忘记，并看到遗忘记录。

右侧抽屉里的「记忆」是**当前任务**学到的，和设置里这一页不是同一份范围。

## 预设头像

连接预设的头像是水墨风小人头，不是字母圆片：

| provider | 头像 |
| --- | --- |
| `aliyun`，以及 id 里带 `aliyun` / `dashscope` / `qwen` | **应用图标**（`app-icon.png`），不是小人头 |
| `ollama` | 水墨头（一款发型） |
| `openrouter` | 水墨头（另一款） |
| `opencode-zen` / `zen` | 水墨头 |
| `custom` 与其它未知 id | 同一套水墨头；未知 id 多一颗小痣，避免冒充内置款 |

用户自己的头像仍可以在设置里选山茶标记或「你」字，那是账户头像，不是预设厂商头像。

## 阿里云兼容 `/models`

设置 → 连接预设 → 测试连接，走 `testOpenAiCompatible`：对以 `/v1` 结尾的 Base URL 请求 `{base}/models`（阿里云兼容模式即 `https://dashscope.aliyuncs.com/compatible-mode/v1/models`）。

- 密码框**为空**时，不凭空发 `Authorization`。
- 若填了 `providerId`，会去读 `keys.json` 里该 id 的已存密钥（桌面命令 `read_provider_key`）。读到了才加 `Authorization: Bearer <key>`。
- 框里和 `keys.json` 都没有密钥时，请求不带 `Authorization`。对端 401/403 记为 `missing-key`：「没有带上密钥。已保存的密钥会自动用于测试；如果还没有，请先粘贴。」
- **已经带上密钥**之后的 401/403 记为 `invalid-key`：「密钥被拒绝。请核对密钥是否有效，以及是否和这个地域的地址匹配（北京密钥对应 dashscope.aliyuncs.com）。仍可手动填写模型 ID。」
- 粘贴的 `Bearer ` 前缀会去掉再发送。

输入框里的模型列表在探测失败时仍可用预设目录和手写 id，不必先打开设置。

## 本地覆盖安装

构建用 **Node 22**（`better-sqlite3` ABI 127，见根 [`README.md`](../README.md)）。不要在 Node 24 下改写这份原生模块。

```bash
pnpm --filter @camelia/desktop desktop:build
```

产物：`apps/desktop/src-tauri/target/release/camelia-desktop.exe`（带 `custom-protocol`，内嵌 UI）。

本机要覆盖正在用的桌面程序时，只覆盖下面这些位置。目录不存在就先建 `D:\app\Camelia`。

| 目标 | 做法 |
| --- | --- |
| `D:\app\Camelia\camelia-desktop.exe` | 直接覆盖 |
| `%LOCALAPPDATA%\Camelia\camelia-desktop.exe` | 直接覆盖 |
| 桌面启动器 | **只有一个** `Camelia.lnk`，原地改掉。目标是 `D:\app\Camelia\camelia-desktop.exe`，工作目录 `WorkingDirectory` 是 `D:\app\Camelia` |

不要在桌面新建 `Camelia-Agent-new.exe`，也不要再放一份 `Camelia.exe`。`desktop:bundle` 的 NSIS 安装目录仍是 `%LOCALAPPDATA%\Camelia\`，那条安装路径有效，和上面的免安装覆盖是两件事。细节见 [`apps/desktop/README.md`](../apps/desktop/README.md)。
