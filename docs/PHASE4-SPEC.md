# Phase 4 实现规格（指针）

**权威规格：** `ARCH-Camelia-v7.md`（开工锁）+ `ARCH-Camelia-v8.md`（体验/运维补丁）。

实现顺序建议：
1. errorClass 枚举 + Residual 结构 + 关键字段 diff
2. environment check 三态
3. heuristic YAML + Router A + 未知兜底
4. translate Schema v1.0 + rollback validators
5. human gate L0–L3 + trust window UI + manual override
6. SkillRecord + Router B rank-only + exploration budget
7. right-rail metrics (two-tier)

禁止：LLM 发明 errorClass；LLM 从零想动作；ε 在 L2/L3；数值残差阈；全局 100 条硬切统计。
