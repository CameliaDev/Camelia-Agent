# Camelia 壳层（当前产品）

> **以 `main` 为准，PR #4 squash-merge 之后。** 提交 `1b36ad2`（`feat(ui): shell controls, isolated modes, and preset portraits`）。
>
> 本文描述已经交付的桌面界面。2026-10-13 的模式计划（只有 Work/Math、顶栏分段、桌面 `Camelia-Agent-new.exe`）是历史，见 [`PLAN-2026-10-13-mode-ia.md`](PLAN-2026-10-13-mode-ia.md) 文首说明。引擎能力边界仍以代码和 [`ITERATION_LOG.md`](ITERATION_LOG.md) 为准。Term 的阶段跟引擎任务走，不再用窗口里的计时器冒充编排。

中文界面字符串以 `packages/ui/src/i18n/strings.ts` 的 `zh` 为准。下面的英文是代码里的 id。

## 模式：Work / Math / Term

顶栏**没有**模式切换。分段控件在**左侧会话栏上方**（`ModeTabs`，`data-mode-tabs`）。三个标签的中英文都是 **Work**、**Math**、**Term**。

| id | 中文标签 | 这一栏里有什么 |
| --- | --- | --- |
| `work` | Work | 日常对话。有任务时，任务卡嵌在聊天记录里。旧的 `chat` / `plan` 都归到这里。 |
| `math` | Math | 数学建模聊天。引擎还没有数模命令；演示课题必须手动加载，并带演示标记。 |
| `term` | Term | 团队模式。协调者拆工人，工人走已有的子代理。见下文「Term 的边界」。 |

不在分段控件里的「评测 / 教学」（`mode.eval` / `mode.teach`）只是登记过的后续名字，界面上没有。

会话**按模式隔离**：

- Work 只列出 `kind` 为 `work`、`chat`，或没有 `kind` 的会话（没有 `kind` 的旧行就是 Work）。
- Math 只列出 `kind === 'math'`。
- Term 只列出 `kind === 'term'`。

点另一个模式时，如果这一栏已经有自己的会话，就切到那条；**不会**为此新建会话，也不会改正在跑的任务。启动后如果当前模式和已恢复的会话不是同一种，同样切到该模式已有的会话。Math / Term 在没有自己的会话时，不把 Work 的对话和标题显示出来。任务在 Work 里跑、人正在看 Math 或 Term 时，工作区顶部有一条「Work模式有一个任务正在运行」和「查看」，运行坞还在，但顶栏不显示 Work 的标题。

左栏标题是 **会话**（`sessions.history`），不再写「聊天记录」。`+` 为**当前模式**新建会话。已经停在空白会话（`blank`，或标题是「新会话」/ New chat / New session 且没有对话和任务）时，`+` 只把光标放进输入框。标题是工作区名或「hello」的空行不会被当成可复用空白。双击一行就地改名（`rename_session`）。删除会发 `delete_session`；删掉该模式最后一行后，顶栏立刻变成「新会话」，再要一条排除刚删 id 的空白，避免旧标题还挂着。

顶栏中间的会话标题只在**当前模式对得上**时出现，字号约 15px、深色加粗。对不上时不显示另一模式的标题。

Work 空白页的说明是：可以直接回答，也可以把目标做成任务（规划、执行、再校验）。不再写「不建任务、不做计划」。

`normalizeModeId` 把遗留的 `chat` 和 `plan` 收成 `work`。设置里的默认模式改的是下次窗口偏好（`localPrefs.preferredMode`），不是任务快照。

## 布局与快捷键

从左到右四列：48px 图标活动栏（不折叠）、会话栏（展开约 260px，收起为 0）、工作区、右侧抽屉（关掉时宽度为 0）。活动栏前三个图标依次是会话、插件、Skills。底栏状态条横跨整窗。顶栏是 36px 浮层（品牌、会话标题、窗控），可以常显、随顶部指针出现，或隐藏。

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

力度是一颗**显示当前档位**的按钮，默认 **High**（`localPrefs.effort`）。点开弹出 **Max / High / Low**（中文界面也是这三个词），点某一档就设上，**不会**按一下轮换。Work / Math 发送 `chat_message` 或 `submit_task` 时带上 `effort`。Term 发送 `submit_term` 时也带上。它只是提示词里的深度约束，**不切换模型**。

Work 的输入框另外保留权限策略下拉。

## 底栏文件夹

状态条左下角的文件夹名是当前工作区路径的最后一段。点它输入路径，或在桌面壳里用「浏览」（`pick_folder`），再「使用此文件夹」。确认发送 `set_workspace`。引擎命令在 `EngineServer` 里；路径不是文件夹时提示「这不是文件夹」；有任务在跑时提示「有任务正在进行」，并且不改当前任务。Windows 上的选择框用 `powershell -STA`，避免 `FolderBrowserDialog` 在非 STA 线程里静默失败。选择框打不开时，对话框里会写明，取消则不提示。

第一次打开时，登录页还可以填安装目录和工作区目录（都能浏览）。安装目录只记在本机偏好里，不搬动 exe，也不另做安装包。工作区若填了，继续之前会 `set_workspace`；路径无效就留在这一页。空着则和以前一样跳过。之后仍可从左下角换文件夹。

## 第一次打开与登录

还没人登录、并且本机没有记下「已经跳过」时，先出整页登录（`data-login-gate`）。登录走 **GitHub device flow**（和账户菜单同一条）。本仓库**没有**内置 Client ID（`BAKED_GITHUB_OAUTH_CLIENT_ID` 为空）。没有 `Ov23…` 时设备码流程完不成；账户菜单会先打开粘贴框，不会假装已经登录。见 [`GITHUB-OAUTH.md`](GITHUB-OAUTH.md)。

跳过的按钮文案是 **暂不登录**（`login.skip`）。没有第二颗叫「跳过」的按钮。点它会：

- 写入 `localStorage` 的 `camelia.loginGate = skipped`；
- 留下未登录的默认账户（账户菜单显示「未登录」）；
- 下次启动不再出这页。

**退出登录**同样把这个标记写成 `skipped`，不会把登录页再挡回来。之后仍可从活动栏头像登录。

## 插件栏与 Skills

活动栏图标的顺序是：会话、**插件**（`extensions.title` / `rail.extensions`）、**Skills**（第三个，`data-rail-view="skills"`）。插件点开后，左栏标题是 **扩展**（`extensions.panelTitle`），下面有搜索框「搜索已安装的扩展」。

搜索只过滤**这一栏里的已安装列表**。当前构建里这份列表是空数组，所以常见状态是「还没有插件」。引擎仍然只在**进程启动**时读取 `~/.camelia/plugins` 下带 `camelia.plugin.json` 的目录。没有启用开关，也没有应用内下载。「如何安装」在标题栏「…」里。示例插件 `plugins/quiet-activity-bar` 是主题存根，不替换这 48px 图标栏。

Skills 页列出含 `SKILL.md` 的文件夹（和 Cursor / Claude 的布局一样，frontmatter 里的 `name` / `description`）。扫描 `~/.camelia/skills`、工作区 `.camelia/skills`、`.cursor/skills`、`.claude/skills`、`.agents/skills`，以及用户主目录下的 `.cursor/skills` 和 `.claude/skills`。「打开目录」再加一个扫描根。「安装…」把选中的文件夹复制进 `~/.camelia/skills`。命令是 `list_skills` 和 `install_skill`。

## 聊天里的「思考中」

用户消息发出、助手气泡还没出现时，记录上方有一枚 **思考中…**（`data-chat-thinking="pending"`）。助手气泡里的思考（`turn.thinking`，以及正文中的 `<think>` / `<thinking>`）用同一句当折叠标题：

- 还在流式、正文里还没有答案时，块是展开的（`data-chat-thinking="live"`）。
- 答案正文已经在标签外面时，块标成 `folded`。这条回复到达时答案已经写好的，思考默认收起。
- 若流式过程中块已经展开，答案到达后**不会**再强制折上：折叠组件只在「正在思考」时强制打开。

助手气泡正在流式输出时，另外有一条 **回复中…**。

## Term 的边界

**保留 Term 标签。** 把团队编排折进 Work / Math 的输入框会动到 `submit_term`、时间线、计划批准和一大批测试，这一次不做。Term 不是第三条聊天：空白说明写明协调者拆工人、工人是子代理。`TeamOrchestrator` 仍是引擎路径。机制分层见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

Term 的时间线是 **plan → execute → verify → done**（界面文案：计划 / 执行 / 校验 / 完成）。输入框发送 `submit_term`（没有 Term 会话时先 `new_session`，`kind: 'term'`）。引擎里的 `TeamOrchestrator` 做这些事：

1. 协调者向当前决策模型要一份工人列表（JSON）。解析失败或列表为空，任务失败，**不会**假装完成。
2. 按模型能力给每个工人选模型（见下）。有一个工人选不出来，整轮失败，工人不会开工。
3. 工人走已经存在的 `SubAgentOrchestrator`（每个工人是隔离子代理，不是另一套运行时）。
4. 校验工人报告。至少一名工人 `ok` 才发 `task.completed`，界面才到「完成」。全都失败、或一个都没跑，状态是失败，时间线停在「没有成功的工人报告」。

界面对齐的是任务快照，不是本地计时器：`planning` / 待批准 → 计划，`executing` → 执行，`verifying` → 校验，`done` 且有成功工人 → 完成。`planApproval` 为 `always` 时，批准按钮留在 Term 里，不会把人拽回 Work。

**选模型的规则**（`assignRoleModel`）：

- 需要视觉：只要 `supportsVision` 为真，且来源不是 `unknown`。配置、接口广告、或从 id 推断（如 `qwen-vl`、`gpt-4o`）都算。推断不出的不算。
- 需要最小上下文：窗口必须来自配置、接口或 id 推断，并且 ≥ 要求。泛用的 128k 默认值**不算**。
- 需要工具：`supportsTools` 为真。
- 当前选中的模型如果还满足条件，优先用它；否则用上下文更大的那一个。
- 用户目标里出现截图 / 图片 / image 等，而协调者忘了标视觉，第一个工人会被标成需要视觉。没有视觉模型就失败，不把看不见的模型派上去。

还不是这些东西：不是任意多个互聊的房间；工人内部仍是原来的计划—执行循环；能力没广告出来时只能靠 id 启发式，启发式也会错；协调者自己仍用当前决策模型写计划，不因为计划文本去换一个视觉模型。

## 应用内反馈

设置 → **反馈**。缺陷或建议，标题和正文，可选附带应用版本和当前模式。提交用本机已经登录的 GitHub 令牌（设备码流程，范围含 `public_repo`），调用 GitHub 创建 Issue。默认仓库 `CameliaDev/camelia-feedback`，输入框可以改成别的 `owner/name`。

默认仓库 `CameliaDev/camelia-feedback` 已经存在并且是公开的。仓库不存在、或这个账号看不到它时，界面说明问题并停在错误上。不会显示「已创建」。令牌不够（401/403）同样失败。新建仓库通常没有 `bug` 标签，所以请求**不带** labels，避免 422 被当成成功或含糊的失败。

Cursor 的 GitHub App 不需要能访问这个反馈仓库；走的是用户自己的令牌。应用不会代为创建仓库。

## 模型能力

模型记录上有 `supportsVision`、`contextWindow`（token）、`supportsTools`，以及 `capabilitySource` 说明每个值是广告、配置、推断、提供方默认，还是未知。`/v1/models` 若带回 `context_length`、`architecture.input_modalities` 含 `image`、`supported_parameters` 含 `tools`，测试连接会解析并写入该 provider 的 `modelCapabilities`。没有这些字段时不编造，id 启发式只在认得出时使用。

输入框的模型列表可以直接筛选「视觉 / 长上下文」，不必先打开设置。每个模型名旁边是能力芯片（`data-model-caps`）：视觉用界面语言（中文「视觉」），上下文写成 `131k` / `500K` 这类缩写，不另加英文 “ctx”。长上下文指已知窗口 ≥ 100k；来源是 `default` 的不计入。来源是 `default` 或 `unknown` 的窗口数字不会标在列表上，避免把泛用的 128k 说成这个模型的上下文。

## Math 新建

在 Math 里点 `+` **立刻**建一条数学会话，默认国赛（`cumcm`）和内置模板，进度条旁显示「国赛 · 内置模板」。赛制仍可改：进度条上的「新建数学会话」打开右侧栏（`data-math-open-setup`），里面选国赛 / 美赛 / 其他，以及是否使用内置模板，再点「创建会话」另建一条。模板选项就在这右侧栏里，没有另一份模板画廊。

引擎仍无数模命令。「运行本阶段」不可用，并说明原因。演示课题要手动加载，带演示标记，不会自己开始。

## 设置里的记忆

齿轮 → 设置，左侧有 **记忆**（`settings.section.memory`）。这一页只列可长期保留的事实、偏好、教训和做法（`list_memories`，`curated: true`）。任务结束时写的 `artifact` 行（「produced N artifact(s)」）仍会进库，供任务记忆面板使用，**不**出现在设置页。可以提升、标为不正确、忘记。

右侧抽屉里的「记忆」是**当前任务**学到的，包含运行日志，和设置里这一页不是同一份范围。

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
