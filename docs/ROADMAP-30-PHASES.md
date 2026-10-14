# Camelia 后续计划书（30 阶段）

> 生成：2026-10-15 · Asia/Shanghai  
> 架构冻结：**ARCH-Camelia-v7 + v8**（不再加 v9 叙事）  
> 当前主仓：已合 PR #4–#12；认知 Phase 0–3 有，**Phase 4 未合拢**  
> 原则：每阶段有验收；门禁未过不进下一阶段；文档与代码同 PR 更新

## 进度图例

- ✅ 已完成（约等于现网）
- 🔧 本轮 ≥10h 启动包（优先）
- ⏳ 后续
- 🧊 依赖架构冻结 / 真数据

---

## 波次 A · 已交付基线（阶段 1–8）≈ ✅

| # | 阶段 | 验收 |
|---|------|------|
| 1 | 桌面壳 Live / ABI 对齐 | 冷启动 Live，hello 非 fixture |
| 2 | 会话轨 / 模式隔离 / 可删末会话 | Work≠Math≠Term 列表 |
| 3 | Skills 页 + 本地安装路径 | 左栏第三图标可用 |
| 4 | 策展记忆（非流水账） | Settings 记忆为事实型 |
| 5 | 扩展/Skills 目录仓搜索安装 | camelia-extensions catalog |
| 6 | 聊天状态条 / 迭代上限 1000 | 工具后状态收敛 |
| 7 | 认知 Phase 0–2（签名/回退/计分） | PR #8 |
| 8 | 认知 Phase 3 observe 接入 | 行为基本不变可观察 |

---

## 波次 B · Phase 4 合拢（阶段 9–14）🔧 本轮核心

规格：`docs/ARCH-Camelia-v7.md` + `v8.md`

| # | 阶段 | 关键交付 | 验收 |
|---|------|----------|------|
| 9 | 环境检查三态 | OK/FAIL/UNKNOWN；超时重试；日志；UNKNOWN×3→FAIL；批量确认 | 假阴/阳可查；不弹窗地狱 |
| 10 | errorClass 枚举 + 硬门 ObservedValue | 枚举封印；测/型/沙箱硬门；软门 lint；关键字段 diff | Residual 结构化 |
| 11 | 最小 Residual Router（轨 A） | 外置 YAML/JSON+version；未知兜底；environment_ok 前置 | 永不无候选卡死 |
| 12 | translate() Schema v1.0 | 无状态；上下文封顶；非法 Reject；回滚点校验 | 拒单不写 SkillRecord |
| 13 | 分级人闸 L0–L3 + 信任窗口 | UI 可见；手动覆盖；降闸重置连成；升闸=结构化连败 M≈3 | 右轨健康三指标 |
| 14 | 轨 B 排序 + 探索预算 + SkillRecord | B 只排序；组≥20 开统计；全局日探索≤50；记 heuristic_table_version | 双轨指标可见 |

---

## 波次 C · Work 运行时产品化（阶段 15–20）🔧 本轮并行

| # | 阶段 | 关键交付 | 验收 |
|---|------|----------|------|
| 15 | ✅ Work system：先想再动手 | chatSystemPrompt 深化；禁「禁止规划」 | 默认想清→短计划 |
| 16 | ✅ Token / 门闸协议 | 子 AI 先想后拿 token；越界交回 | 无 token 不可动工具。见 `docs/WORK-TOKEN-GATE.md` |
| 17 | ✅ 主 AI 调子 AI | 协调者+共享记忆分派 | 非单会话空聊。复用 `TeamOrchestrator.dispatch` |
| 18 | ✅ Plan / Goal 模式脚手架 | UI+事件预留 | 可切换，可存计划。不是任务状态机 |
| 19 | ✅ 聊天拖入文件夹 | composer 支持 folder drop | 文件夹可附着 |
| 20 | Term UI 并入 Work | 保留 TeamOrchestrator；顶栏可弱化 Term | 编排从 Work 可达 ✅ |

---

## 波次 D · 验证世界与记忆门卫（阶段 21–24）⏳

| # | 阶段 | 关键交付 | 验收 |
|---|------|----------|------|
| 21 | 硬门写记忆门卫 | 仅硬门通过写入 | 失败不污染记忆 ✅（stub） |
| 22 | ErrorRecovery / rollback 机器可读 | 四枚举校验+执行 | 拒单/可回滚 ✅（校验+stub） |
| 23 | 右轨两层指标面板 | 上健康/下折叠诊断 | v8 指标齐全 ✅ |
| 24 | 项目认知库仓雏形 | CameliaDev/camelia-cognition + 能力分路由钩子 | 本地可读目录 |

---

## 波次 E · Math / OAuth / 打包（阶段 25–27）⏳

| # | 阶段 | 关键交付 | 验收 |
|---|------|----------|------|
| 25 | Math 真 math.exec + 赛制模板门 | 新建先选赛制 | 非 demo-deep 空转 |
| 26 | GitHub OAuth Client ID | 设备流一键登录 | 需用户提供 Ov23… |
| 27 | 合入后自动 exe 覆盖 | D:\app\Camelia 等 | 站立约定继续 |

---

## 波次 F · 数据驱动下一轮（阶段 28–30）🧊

| # | 阶段 | 关键交付 | 验收 |
|---|------|----------|------|
| 28 | Phase 4 真跑 ≥ 数百任务 | 残差/拒绝率/升闸报表 | 有数据再议 Phase 5 |
| 29 | 统计轨独立增补候选（若数据支持） | 组≥50 评估 | 冲突仍可人闸 |
| 30 | 沙箱自改 + 对齐门（远期） | 仅沙箱+验证+人审合入 | 无裸自改主干 |

---

## 本轮 ≥10h 启动包（关机可跑）

1. **Docs**：把 ARCH-Camelia-v7/v8、本计划书、PHASE4-SPEC 合入 `docs/`，README 链到冻结规格。  
2. **Cloud Agent A**：阶段 9–14 Phase 4 核心实现 + 单测。  
3. **Cloud Agent B**：阶段 15–19 Work system / token / plan 脚手架 / 拖文件夹。  
4. **Cloud Agent C**（若带宽）：阶段 20–23 右轨指标 + ErrorRecovery 对齐 v7。  
5. CI 绿 → squash merge → 按站立约定打 exe（用户机在线时）。

## 文档维护约定（强制）

- 架构变更：只改「实现笔记 / 打脸记录」，**不**开 v9 架构叙事，除非 Phase 4 真数据打脸。  
- 每阶段 PR 必须更新：本计划书进度表勾选 + `docs/PROGRESS.md` 一行摘要。  
- 启发式表、Schema、指标名变更必须升 `heuristic_table_version` / Schema 次版本并写 CHANGELOG。

## 协作备注

- DeepSeek：架构评审至 v8，同意冻结。  
- 豆包：用户称已接手一部分——**范围待用户补全**；计划书中标「豆包」占位，避免重复开工。  
