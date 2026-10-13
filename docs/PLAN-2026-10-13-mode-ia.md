# Camelia-Agent 模式 / 信息架构计划书（2026-10-13）

> **状态**：决策已写入本文；**用户确认前不实施**架构相关改动（P0-1 / F3 / F6 等）。  
> **今日已做**：把对话模式重构与壳层改动入库（见文末 commit），并清理 `.tmp-*` 垃圾。  
> **仓库**：`C:\Users\37963\Desktop\Camelia-Agent`  
> **约束**：PowerShell 用 `;`；桌面引擎须 Node 22（ABI 127）；不 force-push。

---

## 0. 一句话结论

**P0-1 推荐 F6 对齐方案（非 A/B/C 原样）**：Work 模式下聊天流内联「任务运行卡」承载原 `Conversation` 可见性；明细面板（事件/步骤/上下文/记忆等）进**右栏**（F3）；`PlanReview` 作为任务卡内的审批区块，不再单独占第三个顶栏模式。Math 保持独立工作区 + 左栏数模记录。据此迁移 `app.test.tsx` 22 例，避免删可见性（否决 C）也避免整体回滚 PlanWorkspace 拆分（否决纯 A）。

---

## 1. 决策表（锁定草案，待用户 OK）

| ID | 议题 | 我们的决策 | 依据 | 实施前是否可动代码 |
| --- | --- | --- | --- | --- |
| **P0-1** | `Conversation` 孤儿 + 22 测失败 | **F6-对齐：Work 内联任务卡 + 右栏明细**（见 §2）；否决 C；不选纯 A；纯 B（Plan 分栏）仅作备选 | 保留白皮书 §5 可见性；配合用户已定 Work/Math 两档；减少两次返工 | **否**（等 OK） |
| **P0-2** | ModeShell 横条 | 任务运行且当前面看不到任务记录时显示；Work 收敛后 CTA → Work；重写注释 | 与 P0-1/F6 同批 | **否**（随 F6） |
| **F1** | 不重要消息可折叠 | 默认折叠：工具明细、步骤卡、验收/校验、compaction；永远展开：交付/审批/`ask_user`；一行摘要；先无全局开关、不跨会话记忆 | 降噪；先做默认策略 | Phase 4 |
| **F2** | RunDock / TRAE | **保留现状位置**（Composer 上方）；样式收紧为 pill + 进度；**纯 chat 回合**另加轻量运行指示（气泡旁或 RunDock 变体） | 用户诉求与现状部分重合，补齐 chat 回合空洞 | Phase 4 |
| **F3** | 顶栏面板 → 右栏 | **用户已定**：ModeHeader 图标触发不变；内容在**右侧竖栏**展开；取消/收缩横向 `PanelDeck` | 用户 2026-10-13 | Phase 3（OK 后） |
| **F4** | Live 徽标 | **保持**；品牌名不变；品牌右侧加 **Work / Math** 分段控件 | 用户已定 | Phase 1 |
| **F5** | 聊天框上方横线 | **默认猜测去掉 ModeHeader `border-b`**；若用户报标号 2/3 再改 | 等指认；可先试 1 | Phase 4（或用户报号后立刻） |
| **F6** | 模式收敛 | 顶栏 **Work / Math**；Composer 内 ModeTabs **去重移除**；权限下拉保留；会话 `kind: work \| math`；旧会话默认 `work` | 用户已定结构；kind 迁移见 §2.4 | Phase 1–2 |
| **F7.1** | ModeHeader 职责 | 收敛为：会话名 + 面板图标（触发右栏）；去掉冗余模式名 leading | 随 F6 | Phase 1/3 |
| **F7.2** | 纯 chat 运行反馈 | 与 F2 轻量指示合并 | — | Phase 4 |
| **F7.3** | 22 测全绿 | 随 P0-1 表面迁移断言目标 | — | Phase 2/5 |
| **P1** | turbo / e2e / exe / c12 | 测绿 → mock 截图 → 重建 exe → 临时文件已在 Phase 0 清理 | — | Phase 5 |

### 明确不做（本轮）

- 不写大块后端业务新能力（除会话 `kind` 契约的最小字段，见 §2.4）。
- 不强制实现引擎 stub 的回滚/中途切模型「假成功」。
- 不删除 `Conversation` 源码直到新任务卡能覆盖其可见性断言。
- 不把 Live 徽标改成通知中心（F4 候选留档）。
- 不 force-push；不把 API Key / `.env` 入库。

---

## 2. P0-1 详细方案（推荐）

### 2.1 否决与取舍

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| **A** Plan 恢复渲染整份 `Conversation`，PlanReview 回内部 tab | **不作为主方案** | 撤销「计划独立评审面」拆分；与 F6「计划 tab 消失」冲突，必二次返工 |
| **B** PlanWorkspace 内 PlanReview ‖ Conversation 分栏 | **备选** | 保留独立评审，但顶栏仍是三模式思维；布局成本高，且 F6 后「计划」模式本身消失 |
| **C** 删除 Conversation + 删断言 | **否决** | 叙述/工具/审批/交付等可见性永久损失，违背白皮书 §5 |
| **推荐 D（F6 对齐）** | **主方案** | Work = 聊天转录 + 任务运行时内联任务卡（内含 PlanReview 审批区）；右栏 = 原面板明细；Math 不动 |

### 2.2 目标信息架构（Work）

```
TopBar: [品牌] [Work | Math] ………… [Live]
主区:   ModeHeader(会话名 + 面板图标)
        ChatTranscript
          ├─ 普通气泡（可折叠工具行，F1）
          └─ 任务进行中/完成：TaskRunCard（内联）
                ├─ 生命周期摘要（可点开）
                ├─ PlanReview（待审批时）
                ├─ 叙述 / StepCard / 交付卡 / 审批卡
                └─ 「在右栏查看明细」快捷入口
        Panel → 右栏（F3）：事件 / 步骤 / 上下文 / 记忆 / sub-agents / model
        RunDock（Composer 上方）
        Composer（无 ModeTabs；保留权限下拉）
左栏:   会话列表（按 kind 过滤：Work 只显示 work）
```

### 2.3 组件拆分（实施时）

| 新/改 | 职责 | 来源 |
| --- | --- | --- |
| `TaskRunCard`（新） | 从 `Conversation` 抽出「单任务可见块」：叙述、工具卡、步骤、审批、交付、干预 | `Conversation.tsx` |
| `ChatTranscript` | 继续聊天气泡；在有 `snapshot.task` 且非纯闲聊时嵌入 `TaskRunCard` | 现有 |
| `PlanReview` | 嵌进 `TaskRunCard` 的审批区；不再要求独立 `plan` 模式 tab | 现有 |
| `Conversation.tsx` | 过渡期保留为 `TaskRunCard` 的装配或 re-export；断言迁移完成后可瘦身 | 现有 |
| `PlanWorkspace` / `mode=plan` | Phase 1 后降级：路由别名到 Work，或隐藏 tab 仅内部 deep-link | ModeShell |
| 右栏容器（新或恢复） | 承接 PanelDeck 内容；默认收起；图标打开 | F3 |

### 2.4 会话 `kind`（最小后端，仅契约）

- 字段：`session.kind: 'work' | 'math'`（创建时写入；SQLite / SessionStore / wire snapshot）。
- 创建：Work 顶栏下「新会话」→ `work`；Math 下 → `math`。
- **迁移**：已有会话 **全部回填 `work`**（简单、可逆）；不做启发式。
- UI：左栏按当前顶栏模式过滤；Math 空态文案独立。
- **说明**：这是为 F6 左栏分流的最小核心改动；不做 ChatLoop/任务引擎行为大改。若用户要求「本阶段零后端」，则 Phase 1 先用 `localPrefs` 侧会话标签（弱一致），Phase 2 再落库——**默认仍建议最小 kind 落库**，避免双份真相。

### 2.5 测试迁移地图（22 例 → 新表面）

| 原断言场景 | 新挂载点 | 操作 |
| --- | --- | --- |
| empty / connecting / planning / running / approval / failure / done / diff / error / avatars / interventions | `TaskRunCard`（Work + 有 task 的 fixture） | `renderScene` **不再**盲点 plan tab；改为：默认 Work，必要时 `seedTask` / 点开任务卡 |
| 仅聊天气泡 | `chat-mode.test.tsx` | 保持 |
| 面板标题 / 步骤列表 | 右栏打开后查询（原 `openPanel` 改点图标 → 断言 `[data-right-rail]`） | 随 F3 |
| `app.test.tsx` 顶部注释 | 改为「任务表面 checklist = Work 内联任务卡」 | 删「点 plan tab」临时补丁 |

验收：`pnpm --filter @camelia/ui test` 中原 22 失败归零；chat-mode 仍绿。

---

## 3. 分项说明（其余 ID）

### P0-2 ModeShell

- `showStrip`：`running && !awaitingApproval && !taskSurfaceVisible(mode)`。  
  - F6 后：`taskSurfaceVisible` = `mode === 'work'`（任务卡在 Work）；Math 显示横条；若用户人在气泡滚动也可显示「返回任务卡」锚点。
- CTA：`setMode('work')`（文案 i18n `mode.elsewhere`）。
- 重写 L4–8、L65–67 注释，删除「Chat and plan both render the conversation」。

### F1 折叠

- 组件：在 `ChatTranscript` / `TaskRunCard` 内对 `ToolCard`、Step 验收块包 `CollapsibleBlock`。
- 默认：`collapsed=true`；摘要行：`{toolName} · {duration} · {statusIcon}`。
- 交付卡 / ApprovalCard / ask_user：**禁止**折叠。
- prefs：本阶段不写 `compactMode`；折叠态仅组件内 state。

### F2 RunDock

- 确认：无任务时隐藏 = 保留。
- 改动：视觉 TRAE 化（高度更矮、pill、可选展开箭头）；chat 流式回合用 `data-chat-running` 轻量条（不伪造 task 生命周期）。

### F3 右栏

- 恢复/新建 `RightRail`（或 `SidePanelHost`）：宽度可拖（复用原 `--rail-right-w` / RailDivider right）。
- 面板互斥：同时只开一个（与现 PanelDeck 一致）；再开替换。
- 默认启动收起（延续 prefs「右栏冷启收起」精神）。
- 删除主区内横向 PanelDeck 占位（或高度收为 0）。

### F4 / F6 顶栏

- `TopBar`：品牌右侧 `SegmentedControl`：`Work | Math`。
- 去掉 Composer 内 `ModeTabs`（三档）；权限策略下拉留在 Composer。
- store：`mode: 'work' | 'math'`（内部可将旧 `'chat'|'plan'` 映射/迁移一次 prefs）。

### F5 横线

- 首选：`ModeHeader.tsx` 去掉 `border-b`。
- 备选：PanelDeck `border-t`（若 F3 已删 Deck 则自动消失）；Composer 自身描边不动除非用户点名。

### F7 / P1

- ModeHeader 与 TopBar 合并策略：**不合并**；TopBar 可 auto-hide，ModeHeader 常显。
- P1：全量 turbo test → `camelia serve --mock` 截图 → desktop:build 覆盖两处 exe → 确认无 `.tmp-patch` 残留。

---

## 4. 分阶段实施

### Phase 0 — Git / 清理（今日，已执行/执行中）

| 项 | 内容 |
| --- | --- |
| 动作 | 提交对话模式 + 壳层已有改动；`git rm` 已跟踪的 `.tmp-*`；gitignore 扩展；删除 probe 脚本与 probe 截图 |
| 文件 | `.gitignore`；各 packages 已改文件；**不**含本计划所述 UI 架构重做 |
| 验收 | `git status` 干净或仅剩计划允许的未决；无密钥 |
| 风险 | 大 Diff 误夹密钥 → commit 前 `git diff` 扫 `.env` / keys |

### Phase 1 — F6 壳：顶栏 Work/Math（用户 OK 后）

| 项 | 内容 |
| --- | --- |
| 文件 | `TopBar.tsx`、`ModeTabs.tsx`（移除或废用）、`Composer.tsx`、`store.ts` / `useMode`、`strings.ts`、`ModeShell.tsx`（chat→work 别名）、`App.tsx` |
| 验收 | 顶栏可见 Work/Math；Composer 无三档 tab；切换 Math 进 MathWorkspace；Live 仍在 |
| 风险 | 旧 localPrefs `mode=plan` → 启动映射到 `work` |
| 不做 | 尚不全量重写 Conversation；可暂留隐藏 plan 路由 |

### Phase 2 — P0-1 任务表面（Work 内联任务卡）

| 项 | 内容 |
| --- | --- |
| 文件 | 新 `TaskRunCard.tsx`；改 `ChatTranscript.tsx` / `ChatWorkspace.tsx`；瘦身 `Conversation.tsx`；`PlanWorkspace` 降级；`ModeShell` P0-2；可选 `kind`：`SessionStore` / events / `new-session.ts` |
| 验收 | Work 下跑 fixture `running`/`approval`/`done` 能看到原 Conversation 关键块；22 测迁移后转绿（可与 Phase 5 同批） |
| 风险 | 内联卡过长 → 依赖 F1 折叠；Plan 自动跳转逻辑（ModeShell awaitingApproval）改为滚到任务卡 / 展开卡 |

### Phase 3 — F3 面板进右栏

| 项 | 内容 |
| --- | --- |
| 文件 | 新右栏宿主；`PanelIcons` / `PanelDeck`；`App.tsx` 网格恢复 right track；`RailDivider`；`local-prefs` 宽度；改 `app.test` 的 `openPanel` |
| 验收 | 点「事件」等 → 右栏展开对应面板；主区无横向 Deck；冷启右栏收起 |
| 风险 | 与 RunDock / Composer 高度打架 → 维持 padding 模型 |

### Phase 4 — F1 / F2 / F5 抛光

| 项 | 内容 |
| --- | --- |
| 文件 | `CollapsibleBlock`；ToolCard/Step 包装；`RunDock.tsx`；chat 轻量运行条；`ModeHeader` border |
| 验收 | 默认噪音收起；审批/交付仍展开；RunDock TRAE 感；用户确认横线消失 |
| 风险 | 过度折叠导致「以为没跑」→ 摘要行必须含状态色 |

### Phase 5 — 测试 / 截图 / exe

| 项 | 内容 |
| --- | --- |
| 命令 | `pnpm turbo test`（或分 filter）；mock e2e 截图；`pnpm --filter @camelia/ui build`；`pnpm --filter @camelia/desktop desktop:build`；覆盖 `%LOCALAPPDATA%\Camelia\camelia-desktop.exe` 与桌面 `Camelia-Agent-new.exe` |
| 验收 | ui 套件无 P0-1 那 22 红；chat-mode 绿；冷启 Live（Node 22）；手测 Work 任务卡 + 右栏 + Math |
| 风险 | ABI：禁止在 Node 24 下 rebuild better-sqlite3 |

---

## 5. 风险总表

| 风险 | 缓解 |
| --- | --- |
| 先改 F6 再改 P0-1 导致计划模式测试更红 | Phase 2 与测试迁移绑在同一 PR/同一连续会话 |
| kind 落库与「不写后端」张力 | 默认最小字段；否则 localPrefs 弱标签并文档化债务 |
| 右栏与历史「冷启强制收起」回归 | prefs 版本 + 启动覆盖逻辑复用 |
| Conversation 双轨（旧组件+新卡）漂移 | 单一数据路径：只从 snapshot 渲染；旧文件变薄包装 |

---

## 6. 用户确认清单（回复即可开工）

请确认或改选：

1. **P0-1**：同意推荐 **D（F6 内联任务卡 + 右栏）**？还是改选 A / B / C？  
2. **kind**：允许最小后端字段 `session.kind`，旧会话回填 `work`？  
3. **F5**：先按去掉 ModeHeader `border-b` 试，还是等你报标号？  
4. **Phase 顺序**：1→2→3→4→5 是否 OK？

确认前：**只维护 git / 文档 / 与本计划无关的热修**；不实施上表架构项。

---


## 7. 今日 Git 纪要

| Commit | 说明 |
| --- | --- |
| `c05bcd5` | chore: 停止跟踪 .tmp 垃圾、扩展 gitignore |
| `82ede96` | feat(core/agent/cli): 对话模式 ChatLoop + Engine 命令 |
| `54831b5` | feat(ui): ChatTranscript / ModeHeader / PanelDeck / RunDock / IconRail 等 |
| `3d5e630` | feat(desktop): 图标与 mascot + README/CODE-SUMMARY |
| （本提交） | docs: PLAN-2026-10-13-mode-ia.md |

## 8. 附录：库存原文要点索引

- 对话模式计划已落地：chat 事件族、ChatLoop、EngineServer、权限下拉、ChatTranscript、回归绿（引擎侧）。  
- P0-1：`Conversation` 零引用；`app.test.tsx` 22 红；临时「点 plan tab」无效（PlanReview ≠ Conversation）。  
- F3/F4/F6：用户已定向（见决策表）。  
- c12 临时脚本：Phase 0 删除；根目录 ChatLoop 副本若存在不入库（以 `packages/` 为准）。

