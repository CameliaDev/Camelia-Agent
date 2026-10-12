/**
 * Math-modeling preset: system prompt and planning template for mathematical
 * modeling tasks (competition-style: problem restatement → assumptions → model
 * → solve → verify → sensitivity → report).
 *
 * Loaded when the task looks like a math-modeling problem. The planner emits
 * steps following this pipeline, and math.exec is the default computation tool.
 * @module
 */

/** One-line detector: does this task look like math modeling? */
export function looksLikeMathModeling(task: string): boolean {
  const t = task.toLowerCase();
  const hits = [
    '建模', '数学模型', '优化', '求解', '微分方程', '线性规划', '灵敏度',
    'model', 'optimize', 'differential equation', 'linear programming',
    'sensitivity', 'simplex', 'simulate', 'differential',
  ];
  return hits.some((h) => t.includes(h));
}

/** The math-modeling system prompt, injected alongside the base prompt. */
export const MATH_MODELING_SYSTEM_SUFFIX = `
你现在处于【数学建模模式】。严格按以下流程工作，不要跳步：

1. **问题重述**：用自己的话把题目翻译成数学语言，列出已知量和待求量。
2. **模型假设**：列出所有简化假设，每条假设要说明"如果不成立会怎样"。
3. **变量与符号**：定义所有变量、单位、取值范围。
4. **建立模型**：写出目标函数和约束（或微分方程、统计模型）。
5. **求解**：必须调用 math.exec 用 Python 求解，禁止手算。
   - 符号解：sympy（sp.solve, sp.integrate, sp.diff）
   - 数值解：numpy/scipy（scipy.optimize, scipy.integrate.odeint）
   - 画图：matplotlib，savefig 到 .camelia/math/ 下
6. **结果验证**：用一个手算能验证的特例检查代码输出对不对。
7. **灵敏度分析**：对关键参数 ±10%，看结果变化。
8. **结论**：用中文写一段结论，说明模型给出了什么答案、适用范围、局限性。

输出最终报告时，用 LaTeX 写公式（$...$ 行内，$$...$$ 独占一行）。
`.trim();

/** Default step template for math-modeling tasks. */
export const MATH_MODELING_STEP_TEMPLATE = [
  '重述问题并列出已知/待求量',
  '列出模型假设并定义变量符号',
  '建立数学模型（目标+约束/方程）',
  '用 math.exec 求解并画图',
  '用特例验证结果正确性',
  '做灵敏度分析（参数 ±10%）',
  '写最终中文报告（含 LaTeX 公式和图）',
];
