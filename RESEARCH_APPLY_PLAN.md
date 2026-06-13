# 研究借鉴落地计划

基于 5 篇研究论文的深度代码分析，逐项落地改进。

## 关联研究

| # | 论文 | 核心思想 | 对标模块 |
|---|------|----------|----------|
| 1 | SchedCP (arXiv 2509.01245) | 解耦控制面：语义推理 vs 执行 | agent.ts orchestrate() |
| 2 | CQB-MNL (arXiv 2602.02061) | 隐式反馈 + Contextual Bandit | model-pool-scheduler.ts |
| 3 | AIOS (arXiv 2403.16971) | Kernel 上下文动态管理 | prompt-budget.ts |
| 4 | Self-Evolving Agents (arXiv 2409.00872) | 遗忘曲线记忆衰减 | experience-evolver.ts |
| 5 | Self-Optimizing Multi-Agent (arXiv 2412.17149) | 假设生成 + 自动测试 | experience-evolver.ts |

## 落地清单

### P0-1: orchestrate() 拆分 Signal + Decision（借鉴 SchedCP）
- **状态**: ✅ 已完成 (ae9ceef)
- **改动**: 拆为 collectSignals() + collectResourceState() + decideCollaboration()

### P0-2: Thompson Sampling 多维反馈（借鉴 CQB-MNL）
- **状态**: ✅ 已完成 (1e53df6)
- **改动**: weightedSuccessScore() 加权延迟/成本/token效率/用户反馈

### P1-1: PromptBudgetManager taskType 感知（借鉴 AIOS）
- **状态**: ✅ 已完成 (b43b060)
- **改动**: assemble(taskType?) 根据任务类型动态调整优先级

### P1-2: 经验执行轻量验证（借鉴 SchedCP Execution Verifier）
- **状态**: ✅ 已完成 (dc61359)
- **改动**: verifyExperienceOutput() sanity check，失败降级到 LLM

### P2-1: 遗忘曲线衰减（借鉴 Self-Evolving Agents）
- **状态**: ✅ 已完成 (8dab2e4)
- **改动**: recalcConfidence() 加入 30 天半衰期遗忘因子

### P2-2: 假设生成 + 自动测试（借鉴 Self-Optimizing Multi-Agent）
- **状态**: ✅ 已完成 (6b7faa8)
- **改动**: hypothesize() + extractErrorPatterns() + generateHypotheses() + applyHypothesis()
