# PROGRESS

架构冻结：**ARCH-Camelia-v7 + ARCH-Camelia-v8**。不另开 v9 叙事。打脸只记在本文件。

启发式表版本：`1.0.0`（`packages/harness/src/cognition/advise/heuristics.v1.json`）。  
translate Schema：`1.0`（字段集冻结，非法即 Reject）。

## 落地摘要

| Date (UTC) | Stage | Summary |
|------------|-------|---------|
| 2026-10-14 | 9–14 | Phase 4 advise：封印 errorClass、结构化残差、环境三态、启发式表 1.0.0、轨 A/B、translate Schema v1.0、人闸 L0–L3、日探索预算 50、SkillRecord 版本。复用 `23cf614` 的 `validateRollbackPoint`、`parseTranslateActionV1`、`mayWriteMemoryFromVerifier` 与 Health 面板。已变基到 `603c45e`（阶段 15–19），未改 Work token gate。 |
| 2026-10-14 | 15–19 | Work chat thinks first (goal, constraints, short plan, then tools); `WorkTokenGate` plus `docs/WORK-TOKEN-GATE.md`; main AI `invoke_subagents` reuses `TeamOrchestrator.dispatch` and shared memory; Plan/Goal scaffold (`work.mode_set`, `work.plan_saved`); composer folder drop. |
| 2026-10-14 | 20–23 | Work 团队开关 + `TeamOrchestrationCard`；Term 页签软弃用；v7 回滚枚举 + translate 校验桩；v8 右轨 `health` 面板；ARCH v7/v8 + ROADMAP 入 `docs/`。 |
| — | 1–8 | 基线见 `docs/ROADMAP-30-PHASES.md` 波次 A。 |

## 2026-10-14 · Phase 4 advise 路径（阶段 9–14）

`advise` 模式在观察结算之后出一张票据：环境三态 → 轨 A 候选 → 轨 B 只排序 → translate Schema v1.0 → 人闸 →（放行时）回滚校验。默认人闸 **L2**，票据停在 `pending_human`，不改计划、不执行回滚、不写工具。`observe` / `off` 与 Phase 3 相同。

### 打脸记录（实现与冻结规格不一致处）

1. **预测残差与结构化残差是两套类型。** Phase 0–3 的 `Residual`（Brier / surprise）保持不变，历史表不改义。Phase 4 的结构化残差是 `StructuredResidual`（errorClass、expected/actual、关键字段 diff、硬/软门）。不把数值残差阈值接进人闸。
2. **advise 的 errorClass 与 `ErrorRecovery.ErrorClass` 不是同一个枚举。** 恢复梯子仍是 `transient|permanent|model|tool|policy`。advise 枚举封印在 `ADVISE_ERROR_CLASSES`。不在表内的字符串（含模型随口起的名字）收成 `unknown`，走 `[rollback, consult_docs, escalate_human]`。
3. **本落地不执行回滚，也不改计划。** 阶段 22 的 `validateRollbackPoint` 已在主仓。advise 放行后用**显式布尔探针**调用它：证据里没有该 id 就失败。省略探针会让阶段 22 的桩把点当成存在。`executeRollbackPoint` 仍返回 `rollback stub — not executed`，循环不调用它。人闸放行（L0/L1）只把票据标成 `authorized`。`drive` 仍不行动。
4. **升闸数的是触发这次 advise 的关键字段 diff**（同一 `verifierId` + `errorClass`，actual≠expected，M=3），不是执行之后的硬门回读。格式噪声（时间戳、trace id）不算连败。
5. **`EXPLORATION_FAILED` 不写 SkillRecord、不进连败、不进轨 B 样本。** 探索只在 **L1**、且当日全局预算未尽时发生。预算是全局 50，按该 errorClass 的 UNKNOWN 频率与残差密度分，不按类写死 N，也没有「全局 100 条硬切」。
6. **SkillRecord 增加可选 `heuristicTableVersion`。** schema `6 → 7`，旧行读回为缺省。拒单（translate 非法或回滚校验失败）不写。人闸未决的票据也不写，因为还没有执行结果。
7. **右轨两层指标用阶段 23 的 Health 面板**（`data-panel-health`）。有 `cognition.advice` 时读真数：人闸通过率、按 errorClass 的残差、自动+手动升闸、轨 A/B、translate 拒绝率、当日 SkillRecord、信任窗口。没有 advise 事件时保持阶段 23 的占位，不再另挂一条建议轨。手动升/降闸是 `AdviseSession` 的方法；面板只展示信任窗口，本轮没有新的 UI 命令去驱动它。
8. **环境探针的超时/重试在 `checkEnvironment`。** 循环里的探针是同步分类（超时类消息抛错 → UNKNOWN），不在任务路径上睡满超时。日志只留状态词，不留用户代码；热存 7 天，更早的只计归档条数。
9. **SkillRecord 只在硬门通过且成功时写入。** 复用阶段 21 `mayWriteMemoryFromVerifier`。硬门是 test / type / sandbox。lint 与其它类、以及硬门失败，不落技能。授权且非探索的结果仍更新内存里的轨 B 样本，含失败。`parseTranslateActionV1` 只做形状校验、不带探针；存在性检查留在人闸之后。

### Changelog

| 项 | 版本 | 说明 |
|----|------|------|
| heuristic table | 1.0.0 | 首张外置表。改规则、优先级或动作集必须升版本。 |
| translate schema | 1.0 | 六字段冻结。增删字段视为次版本，并拒绝旧形状。 |
| rebase `603c45e` | — | 阶段 15–19 留在主仓。本分支不改 `WorkTokenGate`、Plan/Goal 脚手架或文件夹拖入。 |
