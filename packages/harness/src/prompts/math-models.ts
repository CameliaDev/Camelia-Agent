/**
 * Math model library: a catalog of classic models the agent can match against
 * a problem. Each entry says what kind of problem it solves, the canonical
 * formulation, and the scipy/sympy call skeleton.
 * @module
 */

export interface MathModelEntry {
  id: string;
  name: string;
  category: 'optimization' | 'differential' | 'statistical' | 'graph' | 'queuing';
  /** When to pick this model. */
  fits: string[];
  /** Canonical formulation (LaTeX-ish). */
  formulation: string;
  /** Python skeleton hint for math.exec. */
  skeleton: string;
}

export const MATH_MODEL_LIBRARY: MathModelEntry[] = [
  {
    id: 'lp',
    name: '线性规划 (Linear Programming)',
    category: 'optimization',
    fits: ['资源分配', '生产计划', '最大利润', '最小成本', '约束都是线性'],
    formulation: 'min cᵀx  s.t. Ax ≤ b, x ≥ 0',
    skeleton: 'from scipy.optimize import linprog; linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=[(0,None)]*n)',
  },
  {
    id: 'nlp-unconstrained',
    name: '无约束非线性优化',
    category: 'optimization',
    fits: ['最小化一个光滑函数', '拟合参数', '梯度下降'],
    formulation: 'min f(x)',
    skeleton: 'from scipy.optimize import minimize; minimize(f, x0, method="BFGS")',
  },
  {
    id: 'nlp-constrained',
    name: '有约束非线性优化',
    category: 'optimization',
    fits: ['非线性约束', '工程设计', '带等式/不等式约束的最小化'],
    formulation: 'min f(x)  s.t. g(x) ≤ 0, h(x) = 0',
    skeleton: 'minimize(f, x0, method="SLSQP", constraints=[{"type":"ineq","fun":g},{"type":"eq","fun":h}])',
  },
  {
    id: 'ode',
    name: '常微分方程 (ODE)',
    category: 'differential',
    fits: ['种群增长', '冷却', '运动', '动态系统随时间演化'],
    formulation: "dy/dt = f(t, y),  y(t0) = y0",
    skeleton: 'from scipy.integrate import odeint; odeint(f, y0, t)',
  },
  {
    id: 'pde-1d',
    name: '一维 PDE（热传导/波动）',
    category: 'differential',
    fits: ['热传导', '扩散', '波传播', '空间+时间演化'],
    formulation: '∂u/∂t = α ∂²u/∂x²',
    skeleton: '用有限差分：np.gradient + 时间步长循环',
  },
  {
    id: 'regression',
    name: '回归分析',
    category: 'statistical',
    fits: ['拟合数据趋势', '预测', '参数估计', '有观测数据点'],
    formulation: 'y = f(x; β) + ε',
    skeleton: 'from scipy.optimize import curve_fit; curve_fit(f, xdata, ydata, p0)',
  },
  {
    id: 'monte-carlo',
    name: '蒙特卡洛模拟',
    category: 'statistical',
    fits: ['随机过程', '概率估计', '解析解不存在', '带噪声的仿真'],
    formulation: 'E[X] ≈ 抽样平均',
    skeleton: 'np.random.default_rng(seed); rng.normal(...); 跑 N=10000 次取平均',
  },
  {
    id: 'graph-shortest',
    name: '图论最短路',
    category: 'graph',
    fits: ['网络路由', '最短路径', '连接点之间的距离'],
    formulation: 'min Σ w_e over paths from s to t',
    skeleton: 'import networkx as nx; nx.shortest_path(G, s, t, weight="weight")',
  },
  {
    id: 'graph-matching',
    name: '匹配/指派问题',
    category: 'graph',
    fits: ['任务分配', '一对一对派', '最小成本匹配'],
    formulation: 'min Σ c_ij x_ij, Σ_j x_ij=1, Σ_i x_ij=1',
    skeleton: 'from scipy.optimize import linear_sum_assignment; linear_sum_assignment(cost_matrix)',
  },
  {
    id: 'queue-mmc',
    name: '排队论 M/M/c',
    category: 'queuing',
    fits: ['服务窗口', '排队等待时间', '服务器数量设计'],
    formulation: 'ρ = λ/(cμ),  P_wait = Erlang-C',
    skeleton: '公式手算 + math.exec 验证数值',
  },
];

/** Pick candidate models for a problem description. */
export function matchModels(problem: string, limit = 3): MathModelEntry[] {
  const scored = MATH_MODEL_LIBRARY.map((m) => {
    const text = problem.toLowerCase();
    const score = m.fits.reduce((acc, kw) => (text.includes(kw.toLowerCase()) ? acc + 1 : acc), 0);
    return { m, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.m);
}
