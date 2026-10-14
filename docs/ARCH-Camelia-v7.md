# Camelia 架构说明（审阅版）

> 版本：v7 · 2026-10-15 · Asia/Shanghai  
> 相对 v6：UNKNOWN 批处理/降级、未知 errorClass 兜底、actual/expected 关键字段 diff、translate 上下文封顶、手动升闸覆盖自动；开工锁：Schema v1.0、启发式外置、回滚校验、右轨指标、探索预算  
> **状态：Phase 4 可开工冻结规格（v7）**

---

## 0. 一句话

能稳可开工。四权分立；**未知可兜底、UNKNOWN 不弹窗地狱、比较只 diff 关键字段、用户手动升闸优先于自动降闸。**

---

## 1. 继承（不重发明）

四权 · 签名检索键 · 硬/软/异步验证器 · errorClass 枚举 · Router 双轨（A 增减 / B 排序 / 冲突问人）· ε 仅 L1 · translate 可拒 · 结构化连败升闸 · 可见信任窗口 · 升闸滞后 M≈3

---

## 2. 第四轮补丁

### 2.1 UNKNOWN：防弹窗疲劳

- 同 `errorClass` 的 UNKNOWN **连续 ≥3** → **自动降为 FAIL**（走修环境），停弹窗。  
- 否则 UNKNOWN **批量展示**，一次确认多项。  
- 超时/重试/日志保留。

### 2.2 未知 errorClass 兜底

```
IF errorClass ∉ heuristic_table
  THEN candidates = [rollback, consult_docs, escalate_human]
```

禁止无候选卡死。

### 2.3 actual ≠ expected：关键字段 JSON diff

- `expected` / `actual` **同一 Schema**。  
- 比较只含核心字段；忽略时间戳、随机 ID 等噪声。  
- 第一期：严格关键字段 diff；格式噪声不得触发连败升闸。

### 2.4 translate 上下文封顶

只允许：`errorClass` · `verifierId` · `action_id` · 签名摘要（3–5 离散值）· 最近一条成功/失败。  
禁止全量 SkillRecord、禁止完整对话史。无状态，非聊天。

### 2.5 手动升闸覆盖自动降闸

用户手动升闸 → **手动模式**；暂停自动降闸。  
恢复自动：用户手动降闸，**或** 连续 M 次成功且期间无用户干预。  
**用户主权 > 统计。**

---

## 3. 开工前必须锁死

### 3.1 translate JSON Schema **v1.0（冻结）**

```json
{
  "action_id": "string",
  "prediction": "string",
  "confidence": "number",
  "verifier_target": "string",
  "rollback_point": {
    "type": "git_stash|file_backup|docker_snapshot|db_transaction",
    "id": "string"
  },
  "human_gate_level": "L0|L1|L2|L3"
}
```

缺字段 / 类型错 / 枚举越界 → **Reject**。confidence ∈ [0,1]。

### 3.2 启发式表 = 外部配置（YAML/JSON）

可改优先级、加规则、禁用规则；人在环延伸到策略编辑。

### 3.3 回滚点执行前校验（必实现）

| type | 校验 |
|------|------|
| git_stash | stash 存在 |
| file_backup | 文件存在可读 |
| docker_snapshot | 快照 ID 存在 |
| db_transaction | 事务已开 |

失败 → 拒单，不执行。

### 3.4 右轨可观测（第一天）

Router 命中（A vs B）· translate 拒绝率 · 人闸各级通过率 · 按 errorClass 的 expected/actual 差异 · SkillRecord 日增 · 升闸（自动 vs 手动）

### 3.5 探索预算

每 `errorClass` **每日最多 N 次** ε；超额停止探索，回纯启发式。

---

## 4. 主环（v7）

```
环境(OK|FAIL|UNKNOWN→批/降FAIL) → A 候选(+未知兜底) → B 排序
  → 冲突|未知人闸 → translate(封顶上下文+Schema v1.0)
  → 人闸(手动优先) → 回滚校验 → 执行 → 硬门
  → 关键字段 diff → SkillRecord / 探索预算
```

---

## 5. 变更记录

| 版 | 要点 |
|----|------|
| v6 | 三态环境 · A/B 仲裁 · 结构化连败 |
| **v7** | UNKNOWN 批/降FAIL · 未知兜底 · 关键 diff · 上下文封顶 · 手动覆盖 · Schema 冻结 · 表外置 · 回滚校验 · 右轨指标 · 探索预算 |

**Phase 4 以 v7 为冻结开工规格。**
