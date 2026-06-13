# 影子大脑：自我迭代基础设施

> 版本: v2.1
> 日期: 2026-05-02
> 基于: Darwin Gödel Machine、DGM-Hyperagents、SAHOO 框架、Group-Evolving Agents
> 状态: 设计方案 + 完整代码实现（Phase 9 + Phase 10 全部完成）

---

## 零、现有代码实现状态

> v2.0 新增：对三脑架构已实现代码的全面审计，作为影子大脑开发的前置基础。

### 0.1 三脑架构实现总览

三脑架构（Phase 0-6）**已基本实现**，代码量 ~13,700 行，覆盖 `src/brain/` 目录。

| 模块 | 状态 | 核心文件 | 代码行数 | 关键能力 |
|------|------|----------|----------|----------|
| **ThreeBrain 编排层** | ✅ 完整 | `brain/brain.ts` | ~130 | decide/feedback/heartbeat 三脑协作信号流 |
| **左脑 — 规则引擎** | ✅ 完整 | `brain/left/rule-engine.ts` | ~180 | 8 条内置规则 + 学习规则 + 否定规则 + 淘汰 |
| **左脑 — 统一调度器** | ✅ 完整 | `brain/left/scheduler.ts` | ~280 | 四层新颖度路由 + Thompson Sampling + 元认知降级 |
| **左脑 — 策略蒸馏器** | ✅ 完整 | `brain/left/policy-distiller.ts` | ~110 | 聚类 → 正规则/否定规则 → 冲突检测 |
| **左脑 — 决策记忆** | ✅ 完整 | `brain/left/decision-memory.ts` | ~300 | JSONL 持久化 + kNN + 聚类 + 反事实生成 |
| **右脑 — NN 内核** | ✅ 完整 | `brain/right/nn/` (9 文件) | ~2,100 | Tensor + Attention + FFN + Encoder + 5 输出头 + 量化 + 序列化 |
| **右脑 — 在线学习** | ✅ 完整 | `brain/right/training/` (7 文件) | ~1,800 | ReplayBuffer + OnlineLearner + LPR 防遗忘 + 课程学习 + 安全阀 |
| **右脑 — 蒸馏管线** | ✅ 完整 | `brain/right/training/distiller.ts` | ~260 | Structured Agent Distillation + 规则提取 |
| **右脑 — 特征编码** | ✅ 完整 | `brain/right/features/` (5 文件) | ~1,100 | 结构化编码 + 空间/图像/场景多模态编码器 |
| **右脑 — 世界模型** | ✅ 完整 | `brain/right/nn/world-model.ts` | ~245 | MLP 状态转移 + 空间/拓扑预测 + 多步想象 |
| **小脑 — 本体状态** | ✅ 完整 | `brain/cerebellum/body-state.ts` | ~500 | 情绪/欲望/认知/社交/环境全维度状态 |
| **小脑 — 稳态调节** | ✅ 完整 | `brain/cerebellum/homeostasis.ts` | ~200 | 4 条 PID 回路（能量/情绪/认知/负载） |
| **小脑 — 感知融合** | ✅ 完整 | `brain/cerebellum/sensor-fusion.ts` | ~250 | 多源数据融合 + 事件驱动 |
| **小脑 — 运动控制** | ✅ 完整 | `brain/cerebellum/motor-control.ts` | ~300 | 空闲行为 + 主动行为 |
| **小脑 — 自适应层** | ✅ 完整 | `brain/cerebellum/adaptive/` (3 文件) | ~600 | RhythmAdaptor + HabitMemory + ErrorTuner |
| **信号汇聚层** | ✅ 完整 | `brain/convergence/` (6 文件) | ~500 | 4 个 Sink + 优先级排序 + 去重 |
| **集成** | ✅ 完整 | `core/subsystems.ts` | — | ThreeBrain + SignalConvergenceLayer 已初始化 |
| **测试** | ✅ 覆盖 | `brain/bench/` + `*.test.ts` | ~2,100 | 6 个 benchmark + 每模块单元测试 |

### 0.2 影子大脑实现状态

| 模块 | 状态 | 文件 | 代码行数 |
|------|------|------|----------|
| **GapDetector（缺口检测器）** | ✅ 已实现 | `shadow/gap-detector.ts` | 151 |
| **EvolutionEngine（进化引擎）** | ✅ 已实现 | `shadow/evolution-engine.ts` | 235 |
| **TimingController（时机控制器）** | ✅ 已实现 | `shadow/timing-controller.ts` | 120 |
| **EvolutionLock（进化锁）** | ✅ 已实现 | `shadow/evolution-lock.ts` | 269 |
| **EvolutionStateManager（状态管理器）** | ✅ 已实现 | `shadow/state-manager.ts` | 199 |
| **ABTestRecorder（A/B 对比）** | ✅ 已实现 | `shadow/ab-recorder.ts` | 112 |
| **ShadowBrainOrchestrator（编排器）** | ✅ 已实现 | `shadow/index.ts` | 602 |
| **Phase 10: MetaLearner（元认知）** | ✅ 已实现 | `shadow/phase10/meta-learner.ts` | 470 |
| **Phase 10: SelfModifier（递归自改进）** | ✅ 已实现 | `shadow/phase10/self-modifier.ts` | 397 |
| **Phase 10: SwarmManager（群体进化）** | ✅ 已实现 | `shadow/phase10/swarm-manager.ts` | 570 |
| **Phase 10: DreamValidator（梦境预演）** | ✅ 已实现 | `shadow/phase10/dream-validator.ts` | 232 |
| **Phase 10: TransferLearner（跨域迁移）** | ✅ 已实现 | `shadow/phase10/transfer-learner.ts` | 253 |
| **Phase 10: CurriculumEvolver（学习策略进化）** | ✅ 已实现 | `shadow/phase10/curriculum-evolver.ts` | 399 |
| **Phase 10: PromptEvolver（Prompt 自进化）** | ✅ 已实现 | `shadow/phase10/prompt-evolver.ts` | 348 |
| **Phase 10: ToolInventor（工具发明）** | ✅ 已实现 | `shadow/phase10/tool-inventor.ts` | 274 |
| **类型定义** | ✅ 已实现 | `shadow/types.ts` | 203 |
| **集成测试** | ✅ 通过 | `shadow/__tests__/` (15 文件) | 2,273 |
| **ThreeBrain 集成** | ✅ 已接入 | `brain/brain.ts` + `core/subsystems.ts` | — |

**结论：三脑架构 Phase 0-6 已全部实现，影子大脑 Phase 9 + Phase 10 全部实现。**
**代码量：影子脑 4,768 行源码 + 2,273 行测试，136 个测试全部通过。**

---

## 一、动机

三脑架构的四条自进化回路（右脑权重更新、左脑规则提炼、小脑参数自调、信号汇聚层）已经实现了**能力空间内的自优化**，但无法突破能力边界：

| 回路 | 能做什么 | 做不到什么 |
|------|----------|-----------|
| 右脑权重更新 | 意图分类从 80% → 95% | 新增第 9 类意图 |
| 左脑规则提炼 | 从决策记录提炼规则 | 生成从未出现过的决策模式 |
| 小脑参数自调 | 缓存命中率从 20% → 60% | 创造新的缓存策略 |
| 信号汇聚层 | 用户纠正以 ×3 权重消化 | 消化从未见过的信号类型 |

**核心问题**：没有人写代码，能力边界就不会动。

**解决方案**：让系统自己生成新能力 → 在沙箱中验证 → 确认安全后合入线上。这就是影子大脑。

---

## 二、论文基础

### 2.1 Darwin Gödel Machine（DGM）— 2025.05

| 维度 | 内容 |
|------|------|
| 论文 | arXiv:2505.22954 |
| 核心思想 | Agent 修改自己的代码，同时修改"修改代码的方式" |
| 关键机制 | 元智能体（可自我修改）→ 任务智能体（被修改）→ 沙箱验证 → 采纳/回滚 |
| 成果 | SWE-bench 20%→50%，Polyglot 14.2%→30.7% |
| 安全措施 | 沙箱隔离 + 人工监督 |
| 对本项目的启示 | 影子大脑 = DGM 的沙箱验证机制 |

### 2.2 DGM-Hyperagents — 2026.03

| 维度 | 内容 |
|------|------|
| 核心创新 | 任务智能体 + 元智能体双层架构 |
| 关键突破 | 元智能体自身的修改机制也是可编辑的（"学会如何学习"） |
| 对本项目的启示 | 左脑 = 元智能体（规则蒸馏），右脑 = 任务智能体（NN 直觉），小脑 = 监管层 |

### 2.3 SAHOO 框架 — 剑桥大学, 2026.03, ICLR Workshop

| 维度 | 内容 |
|------|------|
| 论文 | arXiv:2603.06333 |
| 核心贡献 | 给 AI 自我改进装"保险丝"——三道防线 |
| 第1道 | 目标漂移检测（GDI）：语义/词汇/结构/分布四维漂移，阈值 0.44 |
| 第2道 | 约束保护（CPS）：硬性约束违反 = 0 才通过 |
| 第3道 | 回归风险评估：退步概率 > 阈值 → 锁定 |
| 额外指标 | 能力-对齐比率（CAR）：能力提升 / 对齐漂移 |
| 成果 | 代码生成 +18.3%，零约束违反；平均 8.8 轮收敛 |
| 对本项目的启示 | 进化锁 = SAHOO 的三道防线 |

### 2.4 Group-Evolving Agents（GEA）— 2026.02

| 维度 | 内容 |
|------|------|
| 论文 | arXiv:2602.04837 |
| 核心创新 | Agent 群体作为进化单位，经验共享 |
| 关键优势 | 比 DGM 更高效利用探索多样性 |
| 成果 | SWE-bench Verified 71.0%（vs DGM 56.7%） |
| 对本项目的启示 | 多个影子版本并行探索不同进化方向 |

### 2.5 AgentBreeder — 2025.02

| 维度 | 内容 |
|------|------|
| 论文 | arXiv:2502.00757 |
| 核心贡献 | 多目标进化搜索 over scaffolds |
| 安全模式 | "蓝色模式"安全优化，"红色模式"对抗性搜索 |
| 成果 | 安全基准 +79.4%，能力保持或提升 |
| 对本项目的启示 | 多目标优化：能力 + 安全 + 延迟同时优化 |

---

## 三、架构设计

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        线上三脑 (Production)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  左脑         │  │  右脑         │  │  小脑         │          │
│  │  规则引擎     │  │  IntuitionNet │  │  BodyState    │          │
│  │  调度器       │  │  OnlineLearner│  │  Homeostasis  │          │
│  │  策略蒸馏器   │  │  蒸馏管线     │  │  自适应层     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                    │
│         └─────────────────┼─────────────────┘                    │
│                           │                                      │
│                    信号汇聚层                                     │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                     缺口检测器
                     (连续失败 ≥ 3)
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     影子大脑 (Shadow Brain)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              影子三脑副本 (Shadow Copy)                    │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │ ShadowLeft   │  │ ShadowRight  │  │ ShadowCereb  │  │    │
│  │  │ 规则副本      │  │ NN 副本       │  │ 参数副本      │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              进化引擎 (Evolution Engine)                   │    │
│  │                                                           │    │
│  │  输入: 能力缺口描述 + 历史决策数据 + 失败分析              │    │
│  │  LLM 生成:                                               │    │
│  │    ├─ 新规则候选（condition + action）                     │    │
│  │    ├─ NN 结构扩展（新输出头 / 新 embedding 维度）          │    │
│  │    ├─ 新工具组合（从未尝试的 exec + read_file 组合）       │    │
│  │    └─ 新意图分类（聚类发现的未知类别）                     │    │
│  │  输出: 写入影子三脑副本                                    │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                         │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │          迭代时机控制器 (Timing Controller)                │    │
│  │                                                           │    │
│  │  检查项:                                                  │    │
│  │    ├─ 系统负载: load < 50 → 允许                          │    │
│  │    ├─ 样本量: 新缺口相关样本 ≥ 100 → 允许                 │    │
│  │    ├─ 稳定性: 最近 10 轮 loss 波动 < 0.01 → 允许          │    │
│  │    ├─ 时间窗口: 低峰期（00:00-06:00）→ 优先               │    │
│  │    └─ 上次进化间隔: ≥ 24h → 允许                          │    │
│  │  输出: bool (允许/拒绝 进化)                               │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │ 允许                                    │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    进化锁 (Evolution Lock)                 │    │
│  │                                                           │    │
│  │  第1锁 — 目标漂移检测 (GDI):                              │    │
│  │    影子版本的决策分布 vs 线上版本                           │    │
│  │    ├─ 语义漂移: 决策理由的 embedding 距离                  │    │
│  │    ├─ 结构漂移: 决策模式的分布差异                         │    │
│  │    ├─ 综合 GDI < 0.44 → 通过                              │    │
│  │    └─ GDI ≥ 0.44 → 拒绝（进化跑偏了）                     │    │
│  │                                                           │    │
│  │  第2锁 — 约束保护 (CPS):                                  │    │
│  │    影子版本是否违反硬性约束                                 │    │
│  │    ├─ 不能产生语法错误的规则                               │    │
│  │    ├─ 不能输出越界的 NN 参数                               │    │
│  │    ├─ 不能破坏现有功能（回归测试）                         │    │
│  │    └─ CPS = 1.0 → 通过；CPS < 1.0 → 拒绝                 │    │
│  │                                                           │    │
│  │  第3锁 — 回归风险评估:                                    │    │
│  │    A/B 对比: 影子版本 vs 线上版本（1000 轮）               │    │
│  │    ├─ 成功率: 影子 ≥ 线上 → 通过                          │    │
│  │    ├─ 延迟: 影子 ≤ 线上 × 1.5 → 通过                     │    │
│  │    ├─ 成本: 影子 ≤ 线上 → 通过                            │    │
│  │    └─ 任一不达标 → 拒绝                                   │    │
│  │                                                           │    │
│  │  第4锁 — 人工审批（可选）:                                 │    │
│  │    ├─ NN 结构变更 → 必须人工审批                          │    │
│  │    ├─ 新意图类别 ≥ 3 个 → 必须人工审批                    │    │
│  │    └─ 规则/参数微调 → 自动通过                            │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │ 全部通过                                │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              状态管理 (State Manager)                      │    │
│  │                                                           │    │
│  │  ├─ 版本存档: 每次进化保存完整快照（可回滚到任意版本）      │    │
│  │  ├─ 进化日志: 记录每次改动的 {原因, 方案, 指标, 结果}       │    │
│  │  ├─ 能力图谱: 当前能力空间 map（哪些会/哪些不会/刚学会）    │    │
│  │  └─ 收敛追踪: 距离目标还差多远（GDI 趋势、CAR 变化）       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 合入
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     线上三脑 (更新后)                             │
│  左脑: 新规则已加入 RuleEngine                                   │
│  右脑: NN 结构已扩展 / 权重已微调                                 │
│  小脑: 新参数已生效                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 进化粒度分级

不同类型的改动，走不同的验证流程：

| 进化类型 | 示例 | 验证轮数 | 需要人工 | 耗时 |
|----------|------|----------|----------|------|
| **L0: 权重微调** | 在线学习调整 NN 权重 | 实时 | ❌ | 0（已有） |
| **L1: 规则生成** | LLM 生成新决策规则 | 500 轮 | ❌ | ~1h |
| **L2: 参数扩展** | 新增意图类别、扩展工具列表 | 1000 轮 | ❌ | ~2h |
| **L3: 结构变更** | NN 新增输出头、扩展 embedding | 2000 轮 | ✅ | ~4h |
| **L4: 架构重构** | 新增整个子模块 | 5000 轮 | ✅ | ~1 天 |

---

## 四、核心模块设计

### 4.1 缺口检测器 (GapDetector)

```typescript
/**
 * 检测能力缺口 — 连续失败 + 低置信度 = 缺口
 *
 * 借鉴: DGM 的"interesting mutation"选择策略
 * 不是所有失败都值得进化，只关注"系统应该会但不会"的任务
 */

interface CapabilityGap {
  id: string;
  fingerprint: string;           // signal hash: domains|complexity|taskType
  description: string;           // 人类可读的缺口描述
  failures: FailureRecord[];     // 失败记录
  firstDetectedAt: number;       // 首次检测时间
  failureCount: number;          // 连续失败次数
  avgConfidence: number;         // 平均置信度
  relatedSamples: number;        // 相关训练样本数
  priority: 'low' | 'medium' | 'high' | 'critical';
}

class GapDetector {
  private gaps: Map<string, CapabilityGap> = new Map();
  private readonly minFailures = 3;
  private readonly maxConfidence = 0.3;

  /** 观测一次决策结果 */
  observe(signal: TaskSignal, outcome: DecisionOutcome, confidence: number): void {
    const fp = this.fingerprint(signal);
    let gap = this.gaps.get(fp);

    if (outcome.success) {
      // 成功 → 重置缺口计数
      if (gap) {
        gap.failureCount = 0;
        gap.failures = [];
      }
      return;
    }

    // 失败 → 记录
    if (!gap) {
      gap = {
        id: `gap-${fp}-${Date.now()}`,
        fingerprint: fp,
        description: this.describeGap(signal),
        failures: [],
        firstDetectedAt: Date.now(),
        failureCount: 0,
        avgConfidence: 0,
        relatedSamples: 0,
        priority: 'low',
      };
      this.gaps.set(fp, gap);
    }

    gap.failures.push({
      timestamp: Date.now(),
      error: outcome.error ?? 'unknown',
      confidence,
    });
    gap.failureCount++;
    gap.avgConfidence = (gap.avgConfidence * (gap.failureCount - 1) + confidence) / gap.failureCount;

    // 更新优先级
    gap.priority = this.calcPriority(gap);
  }

  /** 获取需要进化的缺口（按优先级排序） */
  getActionableGaps(): CapabilityGap[] {
    return [...this.gaps.values()]
      .filter(g => g.failureCount >= this.minFailures && g.avgConfidence < this.maxConfidence)
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  /** 从 signal 生成 fingerprint */
  private fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }

  /** 计算优先级 */
  private calcPriority(gap: CapabilityGap): CapabilityGap['priority'] {
    if (gap.failureCount >= 10 && gap.avgConfidence < 0.1) return 'critical';
    if (gap.failureCount >= 5 && gap.avgConfidence < 0.2) return 'high';
    if (gap.failureCount >= 3) return 'medium';
    return 'low';
  }

  private priorityWeight(p: CapabilityGap['priority']): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[p];
  }

  private describeGap(signal: TaskSignal): string {
    return `domains=[${signal.domains.join(',')}], complexity=${signal.complexity}, type=${signal.taskType}`;
  }
}
```

### 4.2 进化引擎 (EvolutionEngine)

```typescript
/**
 * 进化引擎 — 用 LLM 生成候选进化方案
 *
 * 借鉴: DGM 的"foundation model creates a new, interesting version"
 * 借鉴: Hyperagents 的"meta-agent modifies task-agent"
 *
 * 生成策略:
 * L1 规则生成: 从缺口描述 + 失败原因 → 新规则
 * L2 参数扩展: 从聚类分析 → 新意图/新工具
 * L3 结构变更: 从能力需求 → NN 结构修改
 */

interface EvolutionProposal {
  id: string;
  level: 'L1' | 'L2' | 'L3' | 'L4';
  type: 'new_rule' | 'new_intent' | 'new_tool_combo' | 'nn_expand' | 'module_add';
  description: string;
  gap: CapabilityGap;
  changes: ProposalChange[];
  expectedImpact: string;
  createdAt: number;
}

interface ProposalChange {
  target: 'left' | 'right' | 'cerebellum';
  action: 'add' | 'modify' | 'expand';
  details: unknown; // 规则定义 / NN 结构参数 / 工具组合
}

class EvolutionEngine {
  private llm: LLMCaller;
  private proposalHistory: EvolutionProposal[] = [];

  constructor(llm: LLMCaller) {
    this.llm = llm;
  }

  /**
   * 从能力缺口生成进化候选方案
   */
  async generateProposals(gap: CapabilityGap, context: EvolutionContext): Promise<EvolutionProposal[]> {
    const proposals: EvolutionProposal[] = [];

    // L1: 规则生成（最常见，最低风险）
    if (gap.priority !== 'critical') {
      const ruleProposal = await this.generateRuleProposal(gap, context);
      if (ruleProposal) proposals.push(ruleProposal);
    }

    // L2: 参数扩展（中等风险）
    if (gap.failureCount >= 5) {
      const paramProposal = await this.generateParamProposal(gap, context);
      if (paramProposal) proposals.push(paramProposal);
    }

    // L3: 结构变更（高风险，需要人工审批）
    if (gap.priority === 'critical' && gap.failureCount >= 10) {
      const structProposal = await this.generateStructProposal(gap, context);
      if (structProposal) proposals.push(structProposal);
    }

    this.proposalHistory.push(...proposals);
    return proposals;
  }

  /**
   * L1: 生成新规则候选
   */
  private async generateRuleProposal(gap: CapabilityGap, ctx: EvolutionContext): Promise<EvolutionProposal | null> {
    const prompt = `
你是一个 AI Agent 的规则生成器。

能力缺口:
- 描述: ${gap.description}
- 连续失败: ${gap.failureCount} 次
- 平均置信度: ${gap.avgConfidence.toFixed(2)}
- 失败记录: ${gap.failures.slice(-5).map(f => f.error).join('; ')}

已有规则:
${ctx.existingRules.map(r => `- ${r.name}: ${r.condition}`).join('\n')}

请生成一条新的决策规则来填补这个缺口。

输出 JSON:
{
  "name": "规则名称",
  "condition": "触发条件描述",
  "action": "执行动作描述",
  "priority": 1-10,
  "reasoning": "为什么这条规则能解决缺口"
}`;

    try {
      const response = await this.llm.call(prompt);
      const rule = JSON.parse(response);

      return {
        id: `proposal-${Date.now()}-rule`,
        level: 'L1',
        type: 'new_rule',
        description: `新规则: ${rule.name}`,
        gap,
        changes: [{
          target: 'left',
          action: 'add',
          details: {
            name: rule.name,
            condition: this.compileCondition(rule.condition),
            action: this.compileAction(rule.action),
            priority: rule.priority,
            source: 'evolved',
          },
        }],
        expectedImpact: rule.reasoning,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * L2: 生成参数扩展方案
   */
  private async generateParamProposal(gap: CapabilityGap, ctx: EvolutionContext): Promise<EvolutionProposal | null> {
    // 分析未分类样本的聚类
    const uncategorized = ctx.samples.filter(s => s.labelIntent >= ctx.currentIntentCount);
    if (uncategorized.length < 20) return null;

    const clusters = this.clusterSamples(uncategorized);
    if (clusters.length === 0) return null;

    return {
      id: `proposal-${Date.now()}-param`,
      level: 'L2',
      type: 'new_intent',
      description: `新增 ${clusters.length} 个意图类别`,
      gap,
      changes: [{
        target: 'right',
        action: 'expand',
        details: {
          newIntents: clusters.map(c => ({
            label: c.label,
            samples: c.samples.length,
            description: c.description,
          })),
          expandFrom: ctx.currentIntentCount,
          expandTo: ctx.currentIntentCount + clusters.length,
        },
      }],
      expectedImpact: `覆盖 ${uncategorized.length} 个未分类样本`,
      createdAt: Date.now(),
    };
  }

  /**
   * L3: 生成 NN 结构变更方案
   */
  private async generateStructProposal(gap: CapabilityGap, ctx: EvolutionContext): Promise<EvolutionProposal | null> {
    const prompt = `
你是一个神经网络架构师。

当前模型配置:
- vocabSize: ${ctx.nnConfig.vocabSize}
- embedDim: ${ctx.nnConfig.embedDim}
- hiddenDim: ${ctx.nnConfig.hiddenDim}
- numLayers: ${ctx.nnConfig.numLayers}
- 输出头: intent(${ctx.nnConfig.numIntents}), tool(${ctx.nnConfig.numTools}), quality(1)

能力缺口: ${gap.description}
连续失败: ${gap.failureCount} 次

请建议最小化的结构变更来填补缺口。
只输出必要的修改，不要重构整个模型。

输出 JSON:
{
  "changes": [
    {"param": "参数名", "from": 当前值, "to": 建议值, "reason": "原因"}
  ],
  "newHeads": [
    {"name": "头名称", "outputDim": 维度, "reason": "原因"}
  ],
  "risk": "low|medium|high"
}`;

    try {
      const response = await this.llm.call(prompt);
      const proposal = JSON.parse(response);

      return {
        id: `proposal-${Date.now()}-struct`,
        level: 'L3',
        type: 'nn_expand',
        description: `NN 结构变更: ${proposal.changes.map((c: any) => `${c.param} ${c.from}→${c.to}`).join(', ')}`,
        gap,
        changes: [{
          target: 'right',
          action: 'modify',
          details: proposal,
        }],
        expectedImpact: proposal.changes.map((c: any) => c.reason).join('; '),
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private clusterSamples(samples: TrainingSample[]): Array<{ label: string; samples: TrainingSample[]; description: string }> {
    // 简单聚类：按特征向量的余弦相似度分组
    // 实际实现可用 k-means 或 DBSCAN
    return [];
  }

  private compileCondition(desc: string): (signal: TaskSignal, resources: ResourceState) => boolean {
    // 将自然语言描述编译为可执行的条件函数
    // 实际实现需要 LLM 生成 TypeScript 代码
    return () => false;
  }

  private compileAction(desc: string): (signal: TaskSignal, resources: ResourceState) => ExecutionPlan {
    // 将自然语言描述编译为可执行的动作函数
    return () => ({ mode: 'sequential', nodes: [] });
  }
}
```

### 4.3 迭代时机控制器 (TimingController)

```typescript
/**
 * 迭代时机控制器 — 判断何时适合执行进化
 *
 * 借鉴: SAHOO 的收敛检测
 * 借鉴: DGM 的沙箱验证前置条件
 *
 * 原则: 系统不稳定时不进化，负载高时不进化，样本不足时不进化
 */

interface TimingConfig {
  maxLoad: number;                // 最大允许负载（0-100），默认 50
  minSamples: number;             // 最少相关样本数，默认 100
  maxLossVolatility: number;      // 最大 loss 波动，默认 0.01
  minIntervalMs: number;          // 最小进化间隔，默认 24h
  preferredWindowStart: number;   // 首选时间窗口开始（小时），默认 0
  preferredWindowEnd: number;     // 首选时间窗口结束（小时），默认 6
}

interface TimingDecision {
  allowed: boolean;
  reason: string;
  conditions: {
    load: { current: number; threshold: number; passed: boolean };
    samples: { current: number; threshold: number; passed: boolean };
    stability: { current: number; threshold: number; passed: boolean };
    interval: { sinceLastMs: number; minMs: number; passed: boolean };
    timeWindow: { currentHour: number; inWindow: boolean; passed: boolean };
  };
  score: number; // 0-1, 越高越适合进化
}

class TimingController {
  private config: TimingConfig;
  private lastEvolutionTime: number = 0;
  private lossHistory: number[] = [];

  constructor(config?: Partial<TimingConfig>) {
    this.config = {
      maxLoad: 50,
      minSamples: 100,
      maxLossVolatility: 0.01,
      minIntervalMs: 24 * 60 * 60 * 1000,
      preferredWindowStart: 0,
      preferredWindowEnd: 6,
      ...config,
    };
  }

  /**
   * 判断当前是否适合执行进化
   */
  shouldEvolve(bodyState: BodyState, relatedSamples: number, recentLosses: number[]): TimingDecision {
    const now = Date.now();
    const hour = new Date().getHours();

    // 条件 1: 系统负载
    const loadPassed = bodyState.load < this.config.maxLoad;

    // 条件 2: 样本量
    const samplesPassed = relatedSamples >= this.config.minSamples;

    // 条件 3: 稳定性（loss 波动）
    const volatility = this.calcVolatility(recentLosses);
    const stabilityPassed = volatility < this.config.maxLossVolatility;

    // 条件 4: 进化间隔
    const sinceLast = now - this.lastEvolutionTime;
    const intervalPassed = sinceLast >= this.config.minIntervalMs;

    // 条件 5: 时间窗口（软约束，不满足则降低 score 但不拒绝）
    const inWindow = hour >= this.config.preferredWindowStart && hour < this.config.preferredWindowEnd;

    const conditions = {
      load: { current: bodyState.load, threshold: this.config.maxLoad, passed: loadPassed },
      samples: { current: relatedSamples, threshold: this.config.minSamples, passed: samplesPassed },
      stability: { current: volatility, threshold: this.config.maxLossVolatility, passed: stabilityPassed },
      interval: { sinceLastMs: sinceLast, minMs: this.config.minIntervalMs, passed: intervalPassed },
      timeWindow: { currentHour: hour, inWindow: inWindow, passed: inWindow },
    };

    // 硬性条件全部通过才允许
    const hardPassed = loadPassed && samplesPassed && stabilityPassed && intervalPassed;

    // 计算综合分数
    const score = this.calcScore(conditions);

    return {
      allowed: hardPassed,
      reason: hardPassed
        ? '所有条件满足，可以执行进化'
        : this.describeFailure(conditions),
      conditions,
      score,
    };
  }

  /** 记录进化完成时间 */
  recordEvolution(): void {
    this.lastEvolutionTime = Date.now();
  }

  /** 更新 loss 历史 */
  updateLosses(losses: number[]): void {
    this.lossHistory = losses.slice(-100);
  }

  /** 计算 loss 波动（标准差 / 均值） */
  private calcVolatility(losses: number[]): number {
    if (losses.length < 5) return Infinity; // 样本不足，视为不稳定
    const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
    if (mean === 0) return 0;
    const variance = losses.reduce((s, l) => s + (l - mean) ** 2, 0) / losses.length;
    return Math.sqrt(variance) / mean; // 变异系数
  }

  /** 计算综合分数 */
  private calcScore(conditions: TimingDecision['conditions']): number {
    let score = 0;
    if (conditions.load.passed) score += 0.3;
    if (conditions.samples.passed) score += 0.25;
    if (conditions.stability.passed) score += 0.25;
    if (conditions.interval.passed) score += 0.1;
    if (conditions.timeWindow.passed) score += 0.1;
    return score;
  }

  /** 描述失败原因 */
  private describeFailure(conditions: TimingDecision['conditions']): string {
    const failures: string[] = [];
    if (!conditions.load.passed) failures.push(`负载过高(${conditions.load.current} > ${conditions.load.threshold})`);
    if (!conditions.samples.passed) failures.push(`样本不足(${conditions.samples.current} < ${conditions.samples.threshold})`);
    if (!conditions.stability.passed) failures.push(`loss 不稳定(${conditions.stability.current.toFixed(4)} > ${conditions.stability.threshold})`);
    if (!conditions.interval.passed) failures.push(`距上次进化太近(${Math.round(conditions.interval.sinceLastMs / 3600000)}h < ${Math.round(conditions.interval.minMs / 3600000)}h)`);
    return `进化条件不满足: ${failures.join(', ')}`;
  }
}
```

### 4.4 进化锁 (EvolutionLock)

```typescript
/**
 * 进化锁 — 四道防线验证进化方案的安全性
 *
 * 借鉴: SAHOO 的三道防线（GDI + CPS + 回归风险）
 * 扩展: 第4锁 — 人工审批
 *
 * 所有锁必须全部通过才能合入线上
 */

interface LockResult {
  lockName: string;
  passed: boolean;
  score: number;       // 0-1
  details: string;
  metrics?: Record<string, number>;
}

interface EvolutionValidation {
  allPassed: boolean;
  locks: LockResult[];
  summary: string;
  timestamp: number;
}

class EvolutionLock {
  /**
   * 运行全部四道锁
   */
  async validate(
    shadowBrain: ShadowBrainState,
    productionBrain: ProductionBrainState,
    testResults: ABTestResult[],
    proposal: EvolutionProposal,
  ): Promise<EvolutionValidation> {
    const locks: LockResult[] = [];

    // 第1锁: 目标漂移检测
    locks.push(this.checkGoalDrift(shadowBrain, productionBrain));

    // 第2锁: 约束保护
    locks.push(this.checkConstraints(shadowBrain, proposal));

    // 第3锁: 回归风险评估
    locks.push(this.checkRegression(testResults, productionBrain));

    // 第4锁: 人工审批（L3+ 级别必须）
    if (proposal.level === 'L3' || proposal.level === 'L4') {
      locks.push(this.checkHumanApproval(proposal));
    }

    const allPassed = locks.every(l => l.passed);

    return {
      allPassed,
      locks,
      summary: allPassed
        ? `全部 ${locks.length} 道锁通过，可以合入`
        : `被拒绝: ${locks.filter(l => !l.passed).map(l => l.lockName).join(', ')}`,
      timestamp: Date.now(),
    };
  }

  /**
   * 第1锁: 目标漂移检测 (GDI)
   *
   * 借鉴 SAHOO: 语义/词汇/结构/分布四维漂移
   * Buddy 适配: 比较影子版本和线上版本的决策分布
   */
  private checkGoalDrift(shadow: ShadowBrainState, prod: ProductionBrainState): LockResult {
    // 语义漂移: 决策理由的 embedding 距离
    const semanticDrift = this.calcSemanticDrift(shadow.decisionEmbeddings, prod.decisionEmbeddings);

    // 结构漂移: 决策模式分布差异（KL 散度）
    const structuralDrift = this.calcStructuralDrift(shadow.decisionDistribution, prod.decisionDistribution);

    // 权重漂移: NN 参数变化幅度
    const weightDrift = this.calcWeightDrift(shadow.nnWeights, prod.nnWeights);

    // 综合 GDI（加权平均）
    const gdi = semanticDrift * 0.38 + structuralDrift * 0.29 + weightDrift * 0.33;
    const threshold = 0.44;

    return {
      lockName: '目标漂移检测 (GDI)',
      passed: gdi < threshold,
      score: Math.max(0, 1 - gdi / threshold),
      details: gdi < threshold
        ? `GDI=${gdi.toFixed(3)} < ${threshold}，未跑偏`
        : `GDI=${gdi.toFixed(3)} ≥ ${threshold}，进化跑偏了`,
      metrics: { semanticDrift, structuralDrift, weightDrift, gdi, threshold },
    };
  }

  /**
   * 第2锁: 约束保护 (CPS)
   *
   * 借鉴 SAHOO: 硬性约束违反 = 0
   * Buddy 适配: 规则语法正确 + NN 参数范围正确 + 回归测试通过
   */
  private checkConstraints(shadow: ShadowBrainState, proposal: EvolutionProposal): LockResult {
    const violations: string[] = [];

    // 规则约束
    if (proposal.type === 'new_rule') {
      const rule = proposal.changes[0]?.details as any;
      if (!rule?.condition || typeof rule.condition !== 'function') {
        violations.push('规则 condition 不是有效函数');
      }
      if (!rule?.action || typeof rule.action !== 'function') {
        violations.push('规则 action 不是有效函数');
      }
      if (rule?.priority < 1 || rule?.priority > 10) {
        violations.push('规则 priority 超出范围 [1, 10]');
      }
    }

    // NN 参数约束
    if (proposal.type === 'nn_expand' || proposal.type === 'new_intent') {
      const weights = shadow.nnWeights;
      for (const param of weights) {
        if (param.some(v => !isFinite(v))) {
          violations.push('NN 参数包含 NaN/Infinity');
          break;
        }
      }
    }

    // 功能约束: 影子版本不能破坏现有功能
    if (shadow.regressionTestFailures > 0) {
      violations.push(`回归测试失败 ${shadow.regressionTestFailures} 项`);
    }

    const cps = violations.length === 0 ? 1.0 : 0.0;

    return {
      lockName: '约束保护 (CPS)',
      passed: cps === 1.0,
      score: cps,
      details: cps === 1.0
        ? '所有约束满足'
        : `违反约束: ${violations.join('; ')}`,
      metrics: { violationCount: violations.length, cps },
    };
  }

  /**
   * 第3锁: 回归风险评估
   *
   * 借鉴 SAHOO: 波动性 + 趋势 + 差距
   * Buddy 适配: A/B 对比成功率/延迟/成本
   */
  private checkRegression(testResults: ABTestResult[], prod: ProductionBrainState): LockResult {
    if (testResults.length < 100) {
      return {
        lockName: '回归风险评估',
        passed: false,
        score: 0,
        details: `测试样本不足(${testResults.length} < 100)，无法评估`,
        metrics: { sampleCount: testResults.length },
      };
    }

    const shadowResults = testResults.filter(r => r.group === 'shadow');
    const prodResults = testResults.filter(r => r.group === 'production');

    // 成功率对比
    const shadowSuccessRate = shadowResults.filter(r => r.success).length / shadowResults.length;
    const prodSuccessRate = prodResults.filter(r => r.success).length / prodResults.length;

    // 延迟对比
    const shadowAvgLatency = shadowResults.reduce((s, r) => s + r.latencyMs, 0) / shadowResults.length;
    const prodAvgLatency = prodResults.reduce((s, r) => s + r.latencyMs, 0) / prodResults.length;

    // 成本对比
    const shadowAvgCost = shadowResults.reduce((s, r) => s + (r.cost ?? 0), 0) / shadowResults.length;
    const prodAvgCost = prodResults.reduce((s, r) => s + (r.cost ?? 0), 0) / prodResults.length;

    const checks = {
      successRate: shadowSuccessRate >= prodSuccessRate,
      latency: shadowAvgLatency <= prodAvgLatency * 1.5,
      cost: shadowAvgCost <= prodAvgCost,
    };

    const passed = Object.values(checks).every(Boolean);
    const score = [checks.successRate, checks.latency, checks.cost].filter(Boolean).length / 3;

    return {
      lockName: '回归风险评估',
      passed,
      score,
      details: passed
        ? `成功率 ${pct(shadowSuccessRate)}≥${pct(prodSuccessRate)}, 延迟 ${ms(shadowAvgLatency)}≤${ms(prodAvgLatency * 1.5)}, 成本 $${shadowAvgCost.toFixed(4)}≤$${prodAvgCost.toFixed(4)}`
        : `失败: ${!checks.successRate ? '成功率下降' : ''} ${!checks.latency ? '延迟过高' : ''} ${!checks.cost ? '成本过高' : ''}`,
      metrics: {
        shadowSuccessRate, prodSuccessRate,
        shadowAvgLatency, prodAvgLatency,
        shadowAvgCost, prodAvgCost,
      },
    };
  }

  /**
   * 第4锁: 人工审批（L3+ 级别）
   */
  private checkHumanApproval(proposal: EvolutionProposal): LockResult {
    // 在实际实现中，这里会：
    // 1. 发送审批通知给用户
    // 2. 等待用户确认/拒绝
    // 3. 记录审批结果

    // 简化实现：L3+ 默认需要标记为待审批
    return {
      lockName: '人工审批',
      passed: false, // 需要人工确认
      score: 0,
      details: `L3 级别进化需要人工审批: ${proposal.description}`,
    };
  }

  // ── 辅助计算 ──

  private calcSemanticDrift(shadowEmbeddings: Float32Array[], prodEmbeddings: Float32Array[]): number {
    if (shadowEmbeddings.length === 0 || prodEmbeddings.length === 0) return 0;
    // 计算两组 embedding 的平均余弦距离
    let totalDist = 0;
    const count = Math.min(shadowEmbeddings.length, prodEmbeddings.length);
    for (let i = 0; i < count; i++) {
      totalDist += 1 - this.cosineSimilarity(shadowEmbeddings[i], prodEmbeddings[i]);
    }
    return totalDist / count;
  }

  private calcStructuralDrift(shadowDist: number[], prodDist: number[]): number {
    // KL 散度
    let kl = 0;
    for (let i = 0; i < shadowDist.length; i++) {
      if (shadowDist[i] > 0 && prodDist[i] > 0) {
        kl += shadowDist[i] * Math.log(shadowDist[i] / prodDist[i]);
      }
    }
    return Math.min(1, kl); // 归一化到 [0, 1]
  }

  private calcWeightDrift(shadowWeights: Float32Array[], prodWeights: Float32Array[]): number {
    let totalDiff = 0;
    let totalParams = 0;
    for (let i = 0; i < shadowWeights.length; i++) {
      for (let j = 0; j < shadowWeights[i].length; j++) {
        totalDiff += Math.abs(shadowWeights[i][j] - prodWeights[i][j]);
        totalParams++;
      }
    }
    return totalParams > 0 ? totalDiff / totalParams : 0;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }
}

function pct(v: number): string { return (v * 100).toFixed(1) + '%'; }
function ms(v: number): string { return v.toFixed(1) + 'ms'; }
```

### 4.5 状态管理器 (EvolutionStateManager)

```typescript
/**
 * 状态管理器 — 版本存档 + 进化日志 + 能力图谱 + 收敛追踪
 *
 * 借鉴: DGM 的 archive 机制
 * 借鉴: GEA 的经验共享
 */

interface EvolutionSnapshot {
  version: number;
  timestamp: number;
  leftRules: Rule[];
  nnWeights: Float32Array[];
  nnConfig: NNConfig;
  cerebellumParams: Record<string, number>;
  metrics: {
    successRate: number;
    avgLatencyMs: number;
    avgCost: number;
    gdi: number;
    capabilityCount: number;
  };
}

interface EvolutionLogEntry {
  version: number;
  timestamp: number;
  proposal: EvolutionProposal;
  validation: EvolutionValidation;
  result: 'applied' | 'rejected' | 'rolled_back';
  metricsBefore: Record<string, number>;
  metricsAfter: Record<string, number>;
  durationMs: number;
}

interface CapabilityMap {
  capabilities: Array<{
    fingerprint: string;
    description: string;
    status: 'mastered' | 'learning' | 'gap' | 'evolving';
    successRate: number;
    lastUpdated: number;
  }>;
  totalCapabilities: number;
  masteredCount: number;
  gapCount: number;
  evolvingCount: number;
}

class EvolutionStateManager {
  private snapshots: EvolutionSnapshot[] = [];
  private log: EvolutionLogEntry[] = [];
  private capabilityMap: Map<string, CapabilityMap['capabilities'][0]> = new Map();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /** 保存当前状态快照 */
  async saveSnapshot(brain: BrainState, metrics: EvolutionSnapshot['metrics']): Promise<number> {
    const version = this.snapshots.length + 1;
    const snapshot: EvolutionSnapshot = {
      version,
      timestamp: Date.now(),
      leftRules: brain.left.rules,
      nnWeights: brain.right.getWeights(),
      nnConfig: brain.right.config,
      cerebellumParams: brain.cerebellum.getParams(),
      metrics,
    };
    this.snapshots.push(snapshot);
    await this.persistSnapshot(snapshot);
    return version;
  }

  /** 回滚到指定版本 */
  async rollback(targetVersion: number): Promise<BrainState | null> {
    const snapshot = this.snapshots.find(s => s.version === targetVersion);
    if (!snapshot) return null;

    // 恢复三脑状态
    // 实际实现需要从快照重建 BrainState
    return null;
  }

  /** 记录进化日志 */
  logEvolution(entry: EvolutionLogEntry): void {
    this.log.push(entry);
    this.persistLog(entry);
  }

  /** 更新能力图谱 */
  updateCapability(fingerprint: string, success: boolean, description: string): void {
    let cap = this.capabilityMap.get(fingerprint);
    if (!cap) {
      cap = {
        fingerprint,
        description,
        status: 'learning',
        successRate: 0,
        lastUpdated: Date.now(),
      };
      this.capabilityMap.set(fingerprint, cap);
    }

    // 滑动平均更新成功率
    cap.successRate = cap.successRate * 0.9 + (success ? 0.1 : 0);
    cap.lastUpdated = Date.now();

    // 状态判定
    if (cap.successRate >= 0.8) cap.status = 'mastered';
    else if (cap.successRate >= 0.5) cap.status = 'learning';
    else cap.status = 'gap';
  }

  /** 获取能力图谱 */
  getCapabilityMap(): CapabilityMap {
    const caps = [...this.capabilityMap.values()];
    return {
      capabilities: caps,
      totalCapabilities: caps.length,
      masteredCount: caps.filter(c => c.status === 'mastered').length,
      gapCount: caps.filter(c => c.status === 'gap').length,
      evolvingCount: caps.filter(c => c.status === 'evolving').length,
    };
  }

  /** 获取进化历史摘要 */
  getEvolutionSummary(): {
    totalEvolutions: number;
    successfulEvolutions: number;
    rejectedEvolutions: number;
    rolledBackEvolutions: number;
    avgGdiImprovement: number;
    currentVersion: number;
  } {
    const applied = this.log.filter(e => e.result === 'applied');
    const rejected = this.log.filter(e => e.result === 'rejected');
    const rolledBack = this.log.filter(e => e.result === 'rolled_back');

    return {
      totalEvolutions: this.log.length,
      successfulEvolutions: applied.length,
      rejectedEvolutions: rejected.length,
      rolledBackEvolutions: rolledBack.length,
      avgGdiImprovement: applied.length > 0
        ? applied.reduce((s, e) => s + ((e.metricsBefore.gdi ?? 0) - (e.metricsAfter.gdi ?? 0)), 0) / applied.length
        : 0,
      currentVersion: this.snapshots.length,
    };
  }

  // ── 持久化 ──

  private async persistSnapshot(snapshot: EvolutionSnapshot): Promise<void> {
    // 保存到 ${dataDir}/evolution/snapshots/v${version}.json
    // 实际实现使用 fs.writeFile
  }

  private async persistLog(entry: EvolutionLogEntry): Promise<void> {
    // 追加到 ${dataDir}/evolution/log.jsonl
  }
}
```

---

## 五、影子大脑编排器 (ShadowBrainOrchestrator)

```typescript
/**
 * 影子大脑编排器 — 串联所有组件的主控制器
 *
 * 生命周期:
 * 1. 线上三脑正常运行
 * 2. 缺口检测器发现能力缺口
 * 3. 时机控制器判断可以进化
 * 4. 复制线上状态到影子大脑
 * 5. 进化引擎生成候选方案
 * 6. 影子大脑执行候选方案
 * 7. A/B 对比收集数据
 * 8. 进化锁验证安全性
 * 9. 全部通过 → 合入线上
 * 10. 状态管理器记录快照
 */

class ShadowBrainOrchestrator {
  private gapDetector: GapDetector;
  private evolutionEngine: EvolutionEngine;
  private timingController: TimingController;
  private evolutionLock: EvolutionLock;
  private stateManager: EvolutionStateManager;
  private shadowBrain: ShadowBrainState | null = null;
  private abRecorder: ABTestRecorder;
  private verbose: boolean;

  constructor(config: ShadowBrainConfig) {
    this.gapDetector = new GapDetector();
    this.evolutionEngine = new EvolutionEngine(config.llm);
    this.timingController = new TimingController(config.timing);
    this.evolutionLock = new EvolutionLock();
    this.stateManager = new EvolutionStateManager(config.dataDir);
    this.abRecorder = new ABTestRecorder();
    this.verbose = config.verbose ?? false;
  }

  /**
   * 主循环 — 每次交互后调用
   */
  async onInteraction(signal: TaskSignal, outcome: DecisionOutcome, confidence: number): Promise<void> {
    // 1. 观测结果，更新缺口检测
    this.gapDetector.observe(signal, outcome, confidence);

    // 2. 更新能力图谱
    this.stateManager.updateCapability(
      this.gapDetector['fingerprint'](signal),
      outcome.success,
      `${signal.domains.join(',')}|${signal.complexity}`,
    );

    // 3. 检查是否有可操作的缺口
    const gaps = this.gapDetector.getActionableGaps();
    if (gaps.length === 0) return;

    // 4. 取最高优先级缺口
    const gap = gaps[0];

    // 5. 检查进化时机
    const timing = this.timingController.shouldEvolve(
      this.getCurrentBodyState(),
      gap.relatedSamples,
      this.getRecentLosses(),
    );

    if (!timing.allowed) {
      if (this.verbose) console.log(`[ShadowBrain] 时机未到: ${timing.reason}`);
      return;
    }

    // 6. 启动进化流程
    await this.runEvolution(gap);
  }

  /**
   * 执行一次完整的进化流程
   */
  private async runEvolution(gap: CapabilityGap): Promise<void> {
    const startTime = Date.now();
    if (this.verbose) console.log(`[ShadowBrain] 开始进化: ${gap.description}`);

    // Step 1: 保存当前状态快照
    const snapshotVersion = await this.stateManager.saveSnapshot(
      this.getProductionBrain(),
      this.getCurrentMetrics(),
    );

    // Step 2: 复制线上状态到影子大脑
    this.shadowBrain = this.cloneProductionBrain();

    // Step 3: 生成进化候选方案
    const proposals = await this.evolutionEngine.generateProposals(gap, this.getEvolutionContext());
    if (proposals.length === 0) {
      if (this.verbose) console.log(`[ShadowBrain] 无候选方案，跳过`);
      return;
    }

    // Step 4: 对每个候选方案执行验证
    for (const proposal of proposals) {
      if (this.verbose) console.log(`[ShadowBrain] 验证方案: ${proposal.description}`);

      // 4a: 应用方案到影子大脑
      this.applyProposal(this.shadowBrain, proposal);

      // 4b: A/B 对比（影子 vs 线上）
      const abResults = await this.runABTest(this.shadowBrain, this.getProductionBrain(), 1000);

      // 4c: 进化锁验证
      const validation = await this.evolutionLock.validate(
        this.shadowBrain,
        this.getProductionBrain(),
        abResults,
        proposal,
      );

      // 4d: 记录日志
      this.stateManager.logEvolution({
        version: snapshotVersion,
        timestamp: Date.now(),
        proposal,
        validation,
        result: validation.allPassed ? 'applied' : 'rejected',
        metricsBefore: this.getCurrentMetrics(),
        metricsAfter: this.getShadowMetrics(),
        durationMs: Date.now() - startTime,
      });

      // 4e: 全部通过 → 合入线上
      if (validation.allPassed) {
        await this.mergeToProduction(this.shadowBrain, proposal);
        this.timingController.recordEvolution();
        if (this.verbose) console.log(`[ShadowBrain] ✅ 进化成功: ${proposal.description}`);
      } else {
        if (this.verbose) console.log(`[ShadowBrain] ❌ 进化被拒绝: ${validation.summary}`);
        // 回滚影子大脑
        this.shadowBrain = this.cloneProductionBrain();
      }
    }
  }

  /**
   * A/B 对比测试
   */
  private async runABTest(
    shadow: ShadowBrainState,
    prod: ProductionBrainState,
    rounds: number,
  ): Promise<ABTestResult[]> {
    const results: ABTestResult[] = [];
    const historicalData = await this.getHistoricalData(rounds);

    for (const data of historicalData) {
      const useShadow = Math.random() < 0.5;
      const t0 = performance.now();

      let success: boolean;
      if (useShadow) {
        success = await this.testDecision(shadow, data.signal);
      } else {
        success = await this.testDecision(prod, data.signal);
      }

      results.push({
        group: useShadow ? 'shadow' : 'production',
        success,
        latencyMs: performance.now() - t0,
        cost: 0, // 简化
      });
    }

    return results;
  }

  // ── 辅助方法（简化） ──

  private getCurrentBodyState(): BodyState { return {} as BodyState; }
  private getRecentLosses(): number[] { return []; }
  private getProductionBrain(): ProductionBrainState { return {} as ProductionBrainState; }
  private getCurrentMetrics(): Record<string, number> { return {}; }
  private getShadowMetrics(): Record<string, number> { return {}; }
  private cloneProductionBrain(): ShadowBrainState { return {} as ShadowBrainState; }
  private getEvolutionContext(): EvolutionContext { return {} as EvolutionContext; }
  private applyProposal(shadow: ShadowBrainState, proposal: EvolutionProposal): void {}
  private async mergeToProduction(shadow: ShadowBrainState, proposal: EvolutionProposal): Promise<void> {}
  private async getHistoricalData(count: number): Promise<Array<{ signal: TaskSignal }>> { return []; }
  private async testDecision(brain: ShadowBrainState | ProductionBrainState, signal: TaskSignal): Promise<boolean> { return true; }
}
```

---

## 六、文件结构

```
src/brain/shadow/
├── index.ts                        ← ShadowBrainOrchestrator 统一入口 ✅
├── gap-detector.ts                 ← 缺口检测器 ✅
├── evolution-engine.ts             ← 进化引擎（LLM 生成候选方案）✅
├── timing-controller.ts            ← 迭代时机控制器 ✅
├── evolution-lock.ts               ← 进化锁（四道防线）✅
├── state-manager.ts                ← 状态管理器（存档/日志/图谱/收敛）✅
├── ab-recorder.ts                  ← A/B 对比数据记录器 ✅
├── types.ts                        ← 影子大脑类型定义 ✅
├── phase10/
│   ├── meta-learner.ts             ← 元认知自适应 ✅
│   ├── self-modifier.ts            ← 递归自改进 ✅
│   ├── swarm-manager.ts            ← 多影子并行探索 ✅
│   ├── dream-validator.ts          ← 梦境预演 ✅
│   ├── transfer-learner.ts         ← 跨域知识迁移 ✅
│   ├── curriculum-evolver.ts       ← 学习策略进化 ✅
│   ├── prompt-evolver.ts           ← Prompt 自进化 ✅
│   └── tool-inventor.ts            ← 工具发明 ✅
└── __tests__/
    ├── gap-detector.test.ts        ✅
    ├── evolution-engine.test.ts    ✅
    ├── timing-controller.test.ts   ✅
    ├── evolution-lock.test.ts      ✅
    ├── state-manager.test.ts       ✅
    ├── orchestrator.test.ts        ✅
    ├── integration.test.ts         ✅
    ├── meta-learner.test.ts        ✅
    ├── self-modifier.test.ts       ✅
    ├── swarm-manager.test.ts       ✅
    ├── dream-validator.test.ts     ✅
    ├── transfer-learner.test.ts    ✅
    ├── curriculum-evolver.test.ts  ✅
    ├── prompt-evolver.test.ts      ✅
    └── tool-inventor.test.ts       ✅
```

---

## 七、实施计划

> **全部 Phase 已完成 ✅** — 代码已实现并通过测试（2026-05-02 核实）

### Phase 9.1: 影子大脑骨架 + 缺口检测（Day 37-38）✅ 已完成 ✅ 已完成

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 创建 shadow 目录 + 类型定义 | `shadow/types.ts` | 全部接口定义 | 1h |
| 实现 GapDetector | `shadow/gap-detector.ts` | 缺口检测 + 优先级排序 | 2h |
| 实现 GapDetector 单元测试 | `__tests__/gap-detector.test.ts` | 检测/优先级/重置 | 1h |
| 创建 ShadowBrainOrchestrator 空壳 | `shadow/index.ts` | 生命周期骨架 | 1h |
| 提交 | commit | Phase 9.1 骨架 | 10min |

### Phase 9.2: 进化引擎 + 时机控制器（Day 39-40） ✅ 已完成

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 EvolutionEngine L1 规则生成 | `shadow/evolution-engine.ts` | LLM 生成候选规则 | 3h |
| 实现 EvolutionEngine L2 参数扩展 | `shadow/evolution-engine.ts` | 聚类 → 新意图类别 | 2h |
| 实现 EvolutionEngine L3 结构变更 | `shadow/evolution-engine.ts` | LLM 生成 NN 修改建议 | 2h |
| 实现 TimingController | `shadow/timing-controller.ts` | 五条件判断 | 2h |
| 单元测试 | `__tests__/` | 引擎 + 时机控制器 | 2h |
| 提交 | commit | Phase 9.2 | 10min |

### Phase 9.3: 进化锁（Day 41-42） ✅ 已完成

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现第1锁: GDI 目标漂移检测 | `shadow/evolution-lock.ts` | 语义/结构/权重漂移 | 3h |
| 实现第2锁: CPS 约束保护 | `shadow/evolution-lock.ts` | 规则/NN/功能约束 | 2h |
| 实现第3锁: 回归风险评估 | `shadow/evolution-lock.ts` | A/B 对比成功率/延迟/成本 | 2h |
| 实现第4锁: 人工审批 | `shadow/evolution-lock.ts` | L3+ 需要人确认 | 1h |
| 单元测试 | `__tests__/` | 四道锁全覆盖 | 2h |
| 提交 | commit | Phase 9.3 | 10min |

### Phase 9.4: 状态管理 + A/B 对比（Day 43-44） ✅ 已完成

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现版本存档 | `shadow/state-manager.ts` | 快照保存/加载/回滚 | 2h |
| 实现进化日志 | `shadow/state-manager.ts` | JSONL 持久化 | 1h |
| 实现能力图谱 | `shadow/state-manager.ts` | 能力 map 更新/查询 | 2h |
| 实现收敛追踪 | `shadow/state-manager.ts` | GDI 趋势/CAR 变化 | 1h |
| 实现 ABTestRecorder | `shadow/ab-recorder.ts` | 分组记录/统计 | 2h |
| 单元测试 | `__tests__/` | 状态管理全覆盖 | 2h |
| 提交 | commit | Phase 9.4 | 10min |

### Phase 9.5: 编排器集成 + 端到端测试（Day 45-46） ✅ 已完成

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 ShadowBrainOrchestrator 完整流程 | `shadow/index.ts` | 串联所有组件 | 3h |
| 接入线上三脑 | `core/subsystems.ts` | 初始化影子大脑 | 1h |
| 接入交互结果 | `core/agent.ts` | onInteraction → 缺口检测 | 1h |
| 端到端集成测试 | `__tests__/integration.test.ts` | 完整进化流程 | 3h |
| 安全测试 | `__tests__/integration.test.ts` | 进化锁拒绝/回滚场景 | 2h |
| 提交 | commit | Phase 9.5 | 10min |

---

## 八、详细开发计划（可执行版）

> v2.0 新增：基于现有三脑架构代码审计，制定可直接执行的影子大脑开发计划。

### 8.0 前置依赖与准备工作

#### 已有基础设施（可直接复用）

| 现有模块 | 文件 | 影子大脑复用方式 |
|----------|------|-----------------|
| `DecisionMemory` | `brain/left/decision-memory.ts` | 缺口检测的数据源：`getClusterStats()` + `findSimilar()` |
| `DecisionMemory.generateCounterfactuals()` | 同上 | A/B 对比的反事实基线 |
| `OnlineLearner.observeOnly` | `brain/right/training/online-learner.ts` | 影子 NN 的安全训练模式 |
| `OnlineLearner.safetyValveStatus` | 同上 | 进化锁的收敛检测参考 |
| `IntuitionNet.parameters()` | `brain/right/nn/model.ts` | 权重快照 + GDI 权重漂移计算 |
| `IntuitionNet.forward()` | 同上 | 影子 NN 的推理 + A/B 对比 |
| `RuleEngine.getRules()` | `brain/left/rule-engine.ts` | 进化锁的规则约束检查 |
| `RuleEngine.addLearnedRule()` | 同上 | L1 进化方案的合入接口 |
| `PolicyDistiller.distill()` | `brain/left/policy-distiller.ts` | 蒸馏结果可作为进化候选 |
| `SignalConvergenceLayer` | `brain/convergence/` | 进化方案通过汇聚层写入 ReplayBuffer |
| `BodyStateManager.getState()` | `brain/cerebellum/body-state.ts` | TimingController 的负载/稳定性判断 |
| `HomeostasisRegulator` | `brain/cerebellum/homeostasis.ts` | 进化期间的稳态保护 |
| `ThreeBrain.getStatus()` | `brain/brain.ts` | 全局状态快照 |
| `SGD` + `backwardPass` | `brain/right/training/` | 影子 NN 训练复用 |
| `ReplayBuffer` | `brain/right/training/replay-buffer.ts` | 影子 NN 的训练数据缓冲 |

#### 新增目录结构

```
src/brain/shadow/
├── index.ts                        ← ShadowBrainOrchestrator 统一入口
├── gap-detector.ts                 ← 缺口检测器
├── evolution-engine.ts             ← 进化引擎（LLM 生成候选方案）
├── timing-controller.ts            ← 迭代时机控制器
├── evolution-lock.ts               ← 进化锁（四道防线）
├── state-manager.ts                ← 状态管理器（存档/日志/图谱/收敛）
├── ab-recorder.ts                  ← A/B 对比数据记录器
├── types.ts                        ← 影子大脑类型定义
└── __tests__/
    ├── gap-detector.test.ts
    ├── evolution-engine.test.ts
    ├── timing-controller.test.ts
    ├── evolution-lock.test.ts
    ├── state-manager.test.ts
    └── integration.test.ts
```

### Phase 9.1: 类型定义 + 缺口检测器（Day 37-38） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 创建 shadow 目录 | `brain/shadow/` | 目录骨架 | 5min |
| 2 | 定义全部影子大脑类型 | `shadow/types.ts` | CapabilityGap / EvolutionProposal / ProposalChange / TimingDecision / LockResult / EvolutionValidation / EvolutionSnapshot / EvolutionLogEntry / CapabilityMap / ABTestResult / ShadowBrainConfig / EvolutionContext | 1.5h |
| 3 | 实现 GapDetector.observe() | `shadow/gap-detector.ts` | 观测决策结果，更新缺口统计 | 1h |
| 4 | 实现 GapDetector.getActionableGaps() | 同上 | 过滤连续失败≥3 + 低置信度的缺口 | 30min |
| 5 | 实现 GapDetector.fingerprint() | 同上 | 复用 DecisionMemory 的 fingerprint 逻辑 | 15min |
| 6 | 实现 GapDetector.calcPriority() | 同上 | critical/high/medium/low 四级 | 30min |
| 7 | 实现 GapDetector.describeGap() | 同上 | 人类可读的缺口描述 | 15min |
| 8 | 创建 ShadowBrainOrchestrator 空壳 | `shadow/index.ts` | 生命周期骨架 + 构造函数 | 1h |
| 9 | 单元测试 | `__tests__/gap-detector.test.ts` | 检测/优先级/重置/边界条件 | 1.5h |
| 10 | 提交 | commit | Phase 9.1 | 10min |

#### 关键实现细节

```typescript
// shadow/types.ts — 核心类型

export interface CapabilityGap {
  id: string;
  fingerprint: string;           // 复用 DecisionMemory 的格式
  description: string;
  failures: FailureRecord[];
  firstDetectedAt: number;
  failureCount: number;
  avgConfidence: number;
  relatedSamples: number;        // 从 DecisionMemory.getClusterStats() 获取
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface EvolutionProposal {
  id: string;
  level: 'L1' | 'L2' | 'L3' | 'L4';
  type: 'new_rule' | 'new_intent' | 'new_tool_combo' | 'nn_expand' | 'module_add';
  description: string;
  gap: CapabilityGap;
  changes: ProposalChange[];
  expectedImpact: string;
  createdAt: number;
}

export interface ProposalChange {
  target: 'left' | 'right' | 'cerebellum';
  action: 'add' | 'modify' | 'expand';
  details: unknown;
}

export interface ShadowBrainConfig {
  llm: { call: (prompt: string) => Promise<string> };  // 复用 Subsystems.llm
  dataDir: string;
  timing?: Partial<TimingConfig>;
  verbose?: boolean;
}
```

```typescript
// shadow/gap-detector.ts — 与 DecisionMemory 的对接

import { DecisionMemory } from '../left/decision-memory.js';

export class GapDetector {
  // observe() 从 ThreeBrain.feedback() 调用
  // getActionableGaps() 返回需要进化的缺口
  // 与 DecisionMemory 的区别：
  //   - DecisionMemory 存所有决策记录
  //   - GapDetector 只关注连续失败 + 低置信度的模式
  //   - GapDetector 输出进化优先级，DecisionMemory 输出统计数据
}
```

### Phase 9.2: 进化引擎（Day 39-41） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 EvolutionEngine L1 规则生成 | `shadow/evolution-engine.ts` | LLM 从缺口描述生成 Rule JSON → 编译为 Rule 对象 | 3h |
| 2 | 实现 LLM prompt 模板 | 同上 | 规则生成 / 参数扩展 / 结构变更三套 prompt | 1h |
| 3 | 实现 compileCondition() | 同上 | 自然语言条件 → TypeScript 函数（LLM 生成代码） | 1.5h |
| 4 | 实现 compileAction() | 同上 | 自然语言动作 → ExecutionPlan 函数 | 1h |
| 5 | 实现 EvolutionEngine L2 参数扩展 | 同上 | 从未分类样本聚类 → 新意图类别 | 2h |
| 6 | 实现 clusterSamples() | 同上 | 简单 k-means 或 DBSCAN 聚类 | 1.5h |
| 7 | 实现 EvolutionEngine L3 结构变更 | 同上 | LLM 生成 NN 结构修改建议（JSON 格式） | 2h |
| 8 | 实现 generateProposals() 主入口 | 同上 | 根据缺口级别选择 L1/L2/L3 | 30min |
| 9 | 单元测试 | `__tests__/evolution-engine.test.ts` | L1/L2/L3 生成验证 + 边界条件 | 2h |
| 10 | 提交 | commit | Phase 9.2 | 10min |

#### 关键实现细节

```typescript
// L1 规则生成 — 与 RuleEngine.addLearnedRule() 对接

private async generateRuleProposal(gap: CapabilityGap, ctx: EvolutionContext): Promise<EvolutionProposal | null> {
  const prompt = `
你是一个 AI Agent 的规则生成器。

能力缺口:
- 描述: ${gap.description}
- 连续失败: ${gap.failureCount} 次
- 平均置信度: ${gap.avgConfidence.toFixed(2)}
- 最近失败: ${gap.failures.slice(-3).map(f => f.error).join('; ')}

已有规则（避免重复）:
${ctx.existingRules.map(r => `- ${r.name}: ${r.condition.toString().slice(0, 80)}`).join('\n')}

请生成一条新的决策规则。输出 JSON:
{
  "name": "规则名称",
  "condition": "触发条件的自然语言描述",
  "action": "执行动作的自然语言描述",
  "priority": 1-10,
  "reasoning": "为什么这条规则能解决缺口"
}`;

  const response = await this.llm.call(prompt);
  const rule = JSON.parse(response);

  // 编译为可执行 Rule 对象
  // 注意：compileCondition/compileAction 使用 LLM 生成 TypeScript 代码
  // 安全措施：在沙箱中 eval，限制只能访问 signal/resources/intuition/body 参数
  return {
    id: `proposal-${Date.now()}-rule`,
    level: 'L1',
    type: 'new_rule',
    description: `新规则: ${rule.name}`,
    gap,
    changes: [{
      target: 'left',
      action: 'add',
      details: {
        name: rule.name,
        condition: this.compileCondition(rule.condition),
        action: this.compileAction(rule.action),
        priority: rule.priority,
        source: 'evolved',
      },
    }],
    expectedImpact: rule.reasoning,
    createdAt: Date.now(),
  };
}
```

```typescript
// L2 参数扩展 — 与 IntuitionNet.config 对接

private async generateParamProposal(gap: CapabilityGap, ctx: EvolutionContext): Promise<EvolutionProposal | null> {
  // 从 DecisionMemory 获取未分类样本
  const uncategorized = ctx.samples.filter(s => s.labelIntent >= ctx.currentIntentCount);
  if (uncategorized.length < 20) return null;

  const clusters = this.clusterSamples(uncategorized);
  return {
    level: 'L2',
    type: 'new_intent',
    changes: [{
      target: 'right',
      action: 'expand',
      details: {
        newIntents: clusters.map(c => ({ label: c.label, samples: c.samples.length })),
        expandFrom: ctx.currentIntentCount,
        expandTo: ctx.currentIntentCount + clusters.length,
      },
    }],
    // ...
  };
}
```

### Phase 9.3: 时机控制器（Day 42） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 TimingController.shouldEvolve() | `shadow/timing-controller.ts` | 五条件硬性检查 + 综合评分 | 1.5h |
| 2 | 对接 BodyStateManager | 同上 | 从 Cerebellum.getBodyState() 获取 load/energy/stability | 30min |
| 3 | 对接 DecisionMemory | 同上 | 从 memory.getClusterStats() 获取相关样本数 | 30min |
| 4 | 实现 loss 波动计算 | 同上 | 从 OnlineLearner.stats.avgLoss 获取 | 30min |
| 5 | 实现 recordEvolution() | 同上 | 记录进化完成时间 | 15min |
| 6 | 单元测试 | `__tests__/timing-controller.test.ts` | 五条件分别验证 + 综合评分 | 1.5h |
| 7 | 提交 | commit | Phase 9.3 | 10min |

#### 关键实现细节

```typescript
// 与现有模块的对接点

shouldEvolve(bodyState: BodyState, relatedSamples: number, recentLosses: number[]): TimingDecision {
  // 条件 1: 系统负载 — bodyState.load < 50
  //   数据来源: Cerebellum.getBodyState().load
  //   已有实现: HomeostasisRegulator 的 PID 回路已经维护 load 值

  // 条件 2: 样本量 — relatedSamples >= 100
  //   数据来源: DecisionMemory.getClusterStats() 的 cluster.count
  //   已有实现: DecisionMemory 已有聚类统计

  // 条件 3: 稳定性 — loss 波动 < 0.01
  //   数据来源: OnlineLearner.stats.avgLoss 的历史
  //   已有实现: OnlineLearner.recentLosses 已有 loss 历史

  // 条件 4: 进化间隔 — 距上次 >= 24h
  //   数据来源: stateManager.lastEvolutionTime
  //   新增: state-manager.ts 维护

  // 条件 5: 时间窗口 — 00:00-06:00 优先（软约束）
  //   数据来源: new Date().getHours()
}
```

### Phase 9.4: 进化锁（Day 43-44） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 EvolutionLock.validate() 主入口 | `shadow/evolution-lock.ts` | 四道锁串联，全部通过才返回 true | 30min |
| 2 | 实现第1锁: checkGoalDrift() — GDI | 同上 | 语义漂移 + 结构漂移 + 权重漂移，阈值 0.44 | 2.5h |
| 3 | 实现 calcSemanticDrift() | 同上 | 决策理由的 embedding 距离（复用 IntuitionNet 的 embedding 层） | 1h |
| 4 | 实现 calcStructuralDrift() | 同上 | 决策模式分布的 KL 散度 | 45min |
| 5 | 实现 calcWeightDrift() | 同上 | NN 参数的 L1 距离（复用 IntuitionNet.parameters()） | 30min |
| 6 | 实现第2锁: checkConstraints() — CPS | 同上 | 规则语法 + NN 参数范围 + 回归测试 | 1.5h |
| 7 | 实现第3锁: checkRegression() | 同上 | A/B 对比成功率/延迟/成本 | 1.5h |
| 8 | 实现第4锁: checkHumanApproval() | 同上 | L3+ 需要人工确认（通知机制） | 1h |
| 9 | 单元测试 | `__tests__/evolution-lock.test.ts` | 四道锁全覆盖 + 边界条件 | 2h |
| 10 | 提交 | commit | Phase 9.4 | 10min |

#### 关键实现细节

```typescript
// 第1锁: GDI — 复用现有 NN 组件

private checkGoalDrift(shadow: ShadowBrainState, prod: ProductionBrainState): LockResult {
  // 语义漂移：用 IntuitionNet 的 embedding 层计算决策理由的距离
  //   复用: brain/right/nn/embedding.ts 的 Embedding.forward()
  //   输入: shadow.decisionReasons vs prod.decisionReasons 的 token IDs
  //   输出: 平均余弦距离

  // 结构漂移：决策模式分布的 KL 散度
  //   复用: DecisionMemory.getClusterStats() 的 fingerprint 分布
  //   输入: shadow.decisionDistribution vs prod.decisionDistribution
  //   输出: KL 散度（归一化到 [0,1]）

  // 权重漂移：NN 参数的 L1 距离
  //   复用: IntuitionNet.parameters() 的 Tensor.data
  //   输入: shadow.nnWeights vs prod.nnWeights
  //   输出: 平均绝对差

  // 综合 GDI = 0.38 * semantic + 0.29 * structural + 0.33 * weight
  const gdi = semanticDrift * 0.38 + structuralDrift * 0.29 + weightDrift * 0.33;
  return { passed: gdi < 0.44, score: 1 - gdi / 0.44, ... };
}
```

```typescript
// 第2锁: CPS — 复用 RuleEngine + IntuitionNet

private checkConstraints(shadow: ShadowBrainState, proposal: EvolutionProposal): LockResult {
  const violations: string[] = [];

  // 规则约束：检查 proposal 的 rule 是否语法正确
  if (proposal.type === 'new_rule') {
    const rule = proposal.changes[0]?.details as Rule;
    if (typeof rule.condition !== 'function') violations.push('condition 不是函数');
    if (typeof rule.action !== 'function') violations.push('action 不是函数');
    if (rule.priority < 1 || rule.priority > 10) violations.push('priority 超范围');
  }

  // NN 约束：检查参数无 NaN/Infinity
  if (proposal.type === 'nn_expand' || proposal.type === 'new_intent') {
    const params = shadow.nnWeights;
    for (const p of params) {
      if (p.data.some(v => !isFinite(v))) {
        violations.push('NN 参数包含 NaN/Infinity');
        break;
      }
    }
  }

  // 功能约束：回归测试
  //   复用: 现有 brain/brain.test.ts 的测试用例
  //   在影子大脑上运行，检查是否破坏现有功能

  return { passed: violations.length === 0, ... };
}
```

### Phase 9.5: 状态管理器 + A/B 对比（Day 45-46） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 saveSnapshot() | `shadow/state-manager.ts` | 保存三脑完整状态快照（规则 + NN 权重 + 小脑参数） | 1.5h |
| 2 | 实现 rollback() | 同上 | 从快照恢复三脑状态 | 1h |
| 3 | 实现 logEvolution() | 同上 | JSONL 追加进化日志 | 30min |
| 4 | 实现 updateCapability() | 同上 | 能力图谱的滑动平均更新 | 1h |
| 5 | 实现 getCapabilityMap() | 同上 | mastered/learning/gap/evolving 分类查询 | 30min |
| 6 | 实现 getEvolutionSummary() | 同上 | 进化历史摘要统计 | 30min |
| 7 | 实现 ABTestRecorder.record() | `shadow/ab-recorder.ts` | 分组记录（shadow vs production） | 1h |
| 8 | 实现 ABTestRecorder.analyze() | 同上 | 成功率/延迟/成本对比 + p-value | 1.5h |
| 9 | 实现 ABTestRecorder.clear() | 同上 | 清空历史数据 | 10min |
| 10 | 单元测试 | `__tests__/state-manager.test.ts` + `ab-recorder.test.ts` | 全覆盖 | 2h |
| 11 | 提交 | commit | Phase 9.5 | 10min |

#### 关键实现细节

```typescript
// 快照内容 — 复用现有组件的序列化接口

interface EvolutionSnapshot {
  version: number;
  timestamp: number;
  leftRules: Rule[];             // RuleEngine.getRules() → JSON 序列化
  nnWeights: Float32Array[];     // IntuitionNet.parameters() → 每个 Tensor.data
  nnConfig: NNConfig;            // IntuitionNet.config
  cerebellumParams: Record<string, number>;  // PID gains + adaptive 参数
  metrics: {
    successRate: number;         // DecisionMemory.getGlobalStats().overallSuccessRate
    avgLatencyMs: number;        // DecisionMemory.getGlobalStats().avgLatency
    avgCost: number;
    gdi: number;
    capabilityCount: number;     // stateManager.getCapabilityMap().totalCapabilities
  };
}
```

### Phase 9.6: 编排器集成（Day 47-49） ✅ 已完成

#### 任务清单

| # | 任务 | 文件 | 产出 | 耗时 |
|---|------|------|------|------|
| 1 | 实现 ShadowBrainOrchestrator 完整流程 | `shadow/index.ts` | onInteraction → 缺口检测 → 时机判断 → 生成方案 → 影子验证 → 进化锁 → 合入 | 3h |
| 2 | 实现 cloneProductionBrain() | 同上 | 从 ThreeBrain 复制完整状态到影子副本 | 1h |
| 3 | 实现 applyProposal() | 同上 | 将 L1/L2/L3 方案应用到影子大脑 | 1.5h |
| 4 | 实现 mergeToProduction() | 同上 | 影子状态合入线上（规则追加 + 权重替换 + 参数更新） | 1h |
| 5 | 实现 runABTest() | 同上 | 从 DecisionMemory 取历史数据，影子 vs 线上对比 | 1.5h |
| 6 | 接入 ThreeBrain.feedback() | `brain/brain.ts` | 在 feedback() 末尾调用 shadowBrain.onInteraction() | 30min |
| 7 | 接入 Subsystems 初始化 | `core/subsystems.ts` | 创建 ShadowBrainOrchestrator 实例 | 30min |
| 8 | 接入心跳触发 | `brain/brain.ts` | heartbeat() 中检查是否有待执行的进化 | 30min |
| 9 | 端到端集成测试 | `__tests__/integration.test.ts` | 完整进化流程（模拟缺口 → 进化 → 合入） | 3h |
| 10 | 安全测试 | 同上 | 进化锁拒绝 / 回滚 / 振荡防护 | 2h |
| 11 | 提交 | commit | Phase 9.6 | 10min |

#### 关键对接点

```typescript
// brain/brain.ts — ThreeBrain.feedback() 中接入缺口检测

async feedback(signal, resources, plan, outcome, actualIntent, actualTools): Promise<void> {
  // ... 现有逻辑 ...

  // 新增：影子大脑缺口检测
  if (this.shadowBrain) {
    const bodyState = this.cerebellum.getBodyState();
    const confidence = plan.confidence;
    await this.shadowBrain.onInteraction(signal, outcome, confidence, bodyState);
  }
}
```

```typescript
// core/subsystems.ts — 初始化影子大脑

// 在 Subsystems 构造函数中
if (config.shadowBrain?.enabled) {
  this.shadowBrain = new ShadowBrainOrchestrator({
    llm: { call: (prompt) => this.llm.call(prompt) },
    dataDir: config.dataDir,
    timing: config.shadowBrain.timing,
    verbose: config.shadowBrain.verbose,
  });
}
```

```typescript
// shadow/index.ts — 完整进化流程

async onInteraction(
  signal: TaskSignal,
  outcome: DecisionOutcome,
  confidence: number,
  bodyState: BodyState,
): Promise<void> {
  // 1. 观测结果，更新缺口检测
  this.gapDetector.observe(signal, outcome, confidence);

  // 2. 更新能力图谱
  this.stateManager.updateCapability(
    this.gapDetector.fingerprint(signal),
    outcome.success,
    `${signal.domains.join(',')}|${signal.complexity}`,
  );

  // 3. 检查是否有可操作的缺口
  const gaps = this.gapDetector.getActionableGaps();
  if (gaps.length === 0) return;

  // 4. 取最高优先级缺口
  const gap = gaps[0];

  // 5. 检查进化时机
  const timing = this.timingController.shouldEvolve(
    bodyState,
    gap.relatedSamples,
    this.getRecentLosses(),
  );
  if (!timing.allowed) return;

  // 6. 启动进化流程
  await this.runEvolution(gap);
}

private async runEvolution(gap: CapabilityGap): Promise<void> {
  // Step 1: 保存快照
  const snapshotVersion = await this.stateManager.saveSnapshot(...);

  // Step 2: 复制线上状态到影子大脑
  this.shadowBrain = this.cloneProductionBrain();

  // Step 3: 生成进化方案
  const proposals = await this.evolutionEngine.generateProposals(gap, this.getEvolutionContext());

  // Step 4: 对每个方案验证
  for (const proposal of proposals) {
    // 4a: 应用到影子大脑
    this.applyProposal(this.shadowBrain, proposal);

    // 4b: A/B 对比
    const abResults = await this.runABTest(this.shadowBrain, this.getProductionBrain(), 1000);

    // 4c: 进化锁验证
    const validation = await this.evolutionLock.validate(
      this.shadowBrain, this.getProductionBrain(), abResults, proposal,
    );

    // 4d: 记录日志
    this.stateManager.logEvolution({ ... });

    // 4e: 全部通过 → 合入
    if (validation.allPassed) {
      await this.mergeToProduction(this.shadowBrain, proposal);
      this.timingController.recordEvolution();
    } else {
      this.shadowBrain = this.cloneProductionBrain(); // 回滚
    }
  }
}
```

### Phase 9.7: 性能调优 + 文档（Day 50） ✅ 已完成

| # | 任务 | 产出 | 耗时 |
|---|------|------|------|
| 1 | 性能基准测试：单次进化流程耗时 | 目标 < 4h（L1-L2） | 1h |
| 2 | 性能基准测试：进化锁验证耗时 | 目标 < 10min | 30min |
| 3 | 性能基准测试：A/B 对比 1000 轮耗时 | 目标 < 30min | 30min |
| 4 | 更新 ARCHITECTURE.md | 影子大脑架构说明 | 1h |
| 5 | 更新 README.md | 影子大脑功能说明 | 30min |
| 6 | 最终提交 | commit + push | 10min |

### 开发计划总览

| Phase | 内容 | 天数 | 产出代码行数 |
|-------|------|------|-------------|
| 9.1 | 类型定义 + 缺口检测器 | 2 天 | ~400 行 |
| 9.2 | 进化引擎 | 3 天 | ~600 行 |
| 9.3 | 时机控制器 | 1 天 | ~250 行 |
| 9.4 | 进化锁 | 2 天 | ~500 行 |
| 9.5 | 状态管理器 + A/B 对比 | 2 天 | ~500 行 |
| 9.6 | 编排器集成 | 3 天 | ~400 行 + 集成代码 |
| 9.7 | 性能调优 + 文档 | 1 天 | 文档 |
| **总计** | | **14 天** | **~2,650 行 + 测试 ~800 行** |

### 与现有代码的集成风险评估

| 风险点 | 涉及文件 | 风险等级 | 缓解措施 |
|--------|----------|----------|----------|
| ThreeBrain.feedback() 注入 | `brain/brain.ts` | 低 | 只在末尾加一行调用，不影响现有逻辑 |
| RuleEngine.addLearnedRule() 调用 | `brain/left/rule-engine.ts` | 低 | 已有接口，直接调用 |
| IntuitionNet 权重替换 | `brain/right/nn/model.ts` | 中 | 需要实现 weights 的深拷贝 + 原子替换 |
| DecisionMemory 数据读取 | `brain/left/decision-memory.ts` | 低 | 只读调用，不修改现有数据 |
| LLM 调用增加 | `core/llm.ts` | 中 | 进化引擎需要额外 LLM 调用，时机控制器限制频率 |
| Subsystems 初始化 | `core/subsystems.ts` | 低 | 可选初始化，config 控制开关 |
| BodyStateManager 状态读取 | `brain/cerebellum/body-state.ts` | 低 | 只读调用 |

---

## 八.一、影子大脑度量指标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 缺口检测准确率 | > 90%（真正缺口 vs 临时波动） | 人工标注验证 |
| 进化方案质量 | > 50% 方案通过进化锁 | 统计 |
| GDI 合入后漂移 | < 0.44 | 每次进化后测量 |
| 约束违反率 | 0% | 统计 |
| A/B 对比显著率 | > 80% 方案统计显著 | p-value < 0.05 |
| 进化后成功率提升 | ≥ 0%（不能退步） | 对比测量 |
| 单次进化耗时 | < 4h（L1-L2），< 1 天（L3） | 计时 |
| 能力图谱覆盖率 | 每月新增 ≥ 3 个 mastered 能力 | 统计 |
| 回滚率 | < 10%（合入后需要回滚的比例） | 统计 |

---

## 八.二、扩展突破方向（Phase 10+）

> v2.0 新增：基于 ICML 2025、ACL 2025、GEA 2026 等最新研究，影子大脑可实现的 8 个额外突破方向。
> 这些方向在影子大脑基础架构（Phase 9）完成后，作为 Phase 10+ 逐步实现。

### 突破 8：元认知自适应 — 学会如何学习 ✅ 已实现

**来源**：ICML 2025 *Truly Self-Improving Agents Require Intrinsic Metacognition*

**现状瓶颈**：三脑的学习方式是固定的——右脑用 SGD + LPR 更新权重，左脑用聚类提炼规则，小脑用 PID 调参数。这些学习算法本身不会变。系统只能在固定的学习框架内优化，无法切换到更高效的学习方式。

**突破方案**：影子脑评估"哪种学习方式对哪种任务最有效"→ 自动生成学习策略调度器。

```typescript
// 新增：src/brain/shadow/meta-learner.ts

interface LearningStrategy {
  id: string;
  name: string;
  // 策略参数
  samplingMethod: 'random' | 'curriculum' | 'contextual' | 're-attentive';
  lrSchedule: 'constant' | 'exponential' | 'cosine' | 'adaptive';
  batchSize: number;
  // 效果统计
  avgConvergenceSteps: number;
  avgFinalLoss: number;
  taskTypes: string[];  // 适用于哪些任务类型
}

class MetaLearner {
  private strategies: LearningStrategy[] = [];
  private currentStrategy: LearningStrategy;

  // 评估当前学习策略的效果
  evaluateStrategy(recentLosses: number[], taskType: string): StrategyEvaluation {
    // 计算收敛速度、最终 loss、稳定性
  }

  // 从候选策略中选择最优
  selectBest(taskType: string): LearningStrategy {
    // 按 taskType 匹配历史最优策略
  }

  // 生成新的学习策略候选
  generateStrategy(taskType: string, currentPerformance: PerformanceMetrics): LearningStrategy {
    // 用 LLM 分析当前瓶颈，生成新策略
    // 例如："简单任务用课程学习收敛快，复杂任务用经验回放更好"
  }
}
```

**实现时机**：Phase 9 完成后，作为 Phase 10.1
**改动量**：~300 行新代码 + OnlineLearner 加策略切换接口
**预期收益**：学习收敛速度提升 30-50%

---

### 突破 9：递归自改进 — 改改进器 ✅ 已实现

**来源**：Gödel Agent (ACL 2025) — 自引用框架递归自改进

**现状瓶颈**：影子脑 v2.0 只改三脑（左脑/右脑/小脑），不改影子脑自己。进化引擎的 prompt 模板、进化锁的阈值（GDI=0.44）、时机控制器的参数（负载<50）——这些都是人写死的。如果这些参数不合理，影子脑的进化效率会持续偏低。

**突破方案**：影子脑可以修改自己的组件参数和逻辑。

```typescript
// 新增：src/brain/shadow/self-modifier.ts

interface SelfModification {
  target: 'evolution_engine' | 'timing_controller' | 'evolution_lock' | 'gap_detector';
  parameter: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  evidence: { metric: string; before: number; after: number }[];
}

class SelfModifier {
  // 评估影子脑自身组件的效果
  evaluateComponents(history: EvolutionLogEntry[]): SelfModification[] {
    const modifications: SelfModification[] = [];

    // 检查进化锁：GDI 阈值是否太严？
    const rejectedByGDI = history.filter(e =>
      e.validation.locks.find(l => l.lockName.includes('GDI') && !l.passed)
    );
    if (rejectedByGDI.length / history.length > 0.6) {
      modifications.push({
        target: 'evolution_lock',
        parameter: 'gdiThreshold',
        oldValue: 0.44,
        newValue: 0.55,  // 放宽
        reason: `${(rejectedByGDI.length / history.length * 100).toFixed(0)}% 方案被 GDI 拒绝，阈值可能太严`,
        evidence: [{ metric: 'rejection_rate', before: 0.6, after: 0.55 }],
      });
    }

    // 检查时机控制器：负载阈值是否太松/太严？
    // 检查进化引擎：L1/L2/L3 哪个成功率最高？
    // ...

    return modifications;
  }

  // 应用自修改（也需要经过安全验证）
  async apply(mod: SelfModification): Promise<boolean> {
    // 自修改也需要 A/B 验证
    // 但验证周期更短（只验证影子脑本身的效率指标）
  }
}
```

**实现时机**：Phase 10.2
**改动量**：~400 行新代码
**预期收益**：进化效率每轮递增，长期收益最大

---

### 突破 10：多影子并行探索（群体进化） ✅ 已实现

**来源**：Group-Evolving Agents (arXiv 2026.02) — SWE-bench 71% vs DGM 56.7%

**现状瓶颈**：单线程进化——一个缺口 → 一个方案 → 一个验证。如果方案方向错了，浪费一整个进化周期（24h+）。

**突破方案**：同时启动多个影子副本，每个探索不同方向，取最优合入。

**实际实现：漏斗式双通道验证**

```
候选方案（3-5个）
    │
    ▼ 通道1: 离线模拟（门槛，~5ms）
    │ 基于聚类统计估计成功率
    │ 低于 minOfflineScore → 直接淘汰
    ▼
存活方案（1-3个）
    │
    ▼ 通道2: 影子副本推理（校准，~50ms）
    │ 深拷贝三脑 → 编译方案规则 → 重放决策推理
    │ 真实命中率 = 最终得分
    ▼
最优方案 = 副本得分最高者
```

**互补机制**：
- 离线拦住"统计上不值得进化"的方案（副本的盲区：规则能命中但领域已饱和）
- 副本拦住"规则机制有缺陷"的方案（离线的盲区：统计上值得但规则 condition 写错）
- 误判率从纯离线 30% 或纯副本 15% 降至 ~5%

**ShadowCapableBrainProvider 扩展接口**（`types.ts`）：
```typescript
interface ShadowCapableBrainProvider extends BrainProvider {
  cloneBrainState(): {
    rules: Rule[];
    nnWeights: Float32Array[];
    nnConfig: NNConfig;
    decisionDistribution: number[];
  };
  replayDecision(
    state: { rules: Rule[]; nnWeights: Float32Array[]; nnConfig: NNConfig },
    signal: TaskSignal,
    resources: ResourceState,
  ): Promise<{ success: boolean; latencyMs: number }>;
}
```

**ThreeBrain 已实现此接口**（`brain.ts`）：
- `cloneBrainState`: 规则深拷贝 + NN 权重 Float32Array 拷贝 + 配置拷贝
- `replayDecision`: 纯规则条件匹配（不走 NN 推理）
- `isShadowCapable()` 类型守卫自动检测

**SwarmCandidate 双通道得分**：
```typescript
interface SwarmCandidate {
  offlineResults: ABTestResult[];    // 通道1 原始数据
  replayResults: ABTestResult[] | null; // 通道2 原始数据
  offlineScore: number;              // 离线通道得分
  replayScore: number | null;        // 副本通道得分
  score: number;                     // 最终得分 = replayScore（无副本时 = offlineScore）
}
```

---

### 突破 11：高保真梦境预演（离线验证） ✅ 已实现

**来源**：DreamEngine 已存在于 Buddy（`memory/dream.ts`），但未接入进化流程

**现状瓶颈**：进化验证需要 1000 轮真实 A/B 对比，每轮需要真实用户交互。验证周期长，用户无感知期间（夜间）无法进化。

**突破方案**：影子脑在梦境中预演进化方案——用历史决策数据离线回放，不需要真实交互。

```typescript
// 新增：src/brain/shadow/dream-validator.ts

class DreamValidator {
  // 离线回放验证
  async validateInDream(
    shadow: ShadowBrainState,
    production: ProductionBrainState,
    historicalDecisions: DecisionRecord[],
  ): Promise<DreamValidationResult> {
    let shadowSuccess = 0;
    let prodSuccess = 0;

    for (const record of historicalDecisions) {
      // 用影子版本重新决策
      const shadowPlan = shadow.decide(record.signal, record.resources);
      const prodPlan = production.decide(record.signal, record.resources);

      // 用真实结果作为 ground truth
      if (this.wouldSucceed(shadowPlan, record.outcome)) shadowSuccess++;
      if (this.wouldSucceed(prodPlan, record.outcome)) prodSuccess++;
    }

    return {
      shadowSuccessRate: shadowSuccess / historicalDecisions.length,
      prodSuccessRate: prodSuccess / historicalDecisions.length,
      improvement: shadowSuccess - prodSuccess,
      sampleCount: historicalDecisions.length,
      // 离线验证置信度低于真实 A/B，权重 0.7
      confidence: 0.7,
    };
  }
}
```

**实现时机**：Phase 10.4（与 DreamEngine 对接）
**改动量**：~250 行新代码
**预期收益**：验证成本从"1000 轮真实交互"降到"离线回放 10 分钟"，进化速度提升 10-100 倍

---

### 突破 12：工具发明（创造全新工具） ✅ 已实现

**来源**：Gödel Agent 核心思想——修改自己的代码

**现状瓶颈**：L1-L3 进化只能重组现有 32 个工具的新组合。如果所有组合都试过仍然失败，系统无能为力。

**突破方案**：当工具组合穷尽仍失败时，影子脑用 LLM 生成全新的工具代码。

```typescript
// 新增：src/brain/shadow/tool-inventor.ts

interface InventedTool {
  name: string;
  description: string;
  code: string;           // TypeScript 函数体
  inputSchema: unknown;
  outputSchema: unknown;
  safetyScore: number;    // 静态安全分析得分
  testResults: TestResult[];
}

class ToolInventor {
  // 从能力缺口生成新工具
  async invent(gap: CapabilityGap, existingTools: ToolDefinition[]): Promise<InventedTool | null> {
    const prompt = `
你是一个工具发明家。系统有一个能力缺口无法用现有工具解决。

能力缺口: ${gap.description}
连续失败: ${gap.failureCount} 次
已有工具: ${existingTools.map(t => t.name).join(', ')}

请设计一个新工具来填补这个缺口。
输出 JSON:
{
  "name": "工具名称",
  "description": "工具描述",
  "code": "TypeScript 函数体（纯函数，无副作用，无网络请求）",
  "inputSchema": { ... },
  "outputSchema": { ... }
}`;

    const tool = JSON.parse(await this.llm.call(prompt));

    // 安全审查
    if (!this.safetyCheck(tool)) return null;

    // 沙箱测试
    const testResults = await this.sandboxTest(tool);
    if (testResults.some(r => !r.passed)) return null;

    return tool;
  }

  // 安全检查：无网络请求、无文件删除、无 shell 注入
  private safetyCheck(tool: InventedTool): boolean {
    const forbidden = ['fetch(', 'axios', 'exec(', 'rm ', 'curl', 'wget', 'eval('];
    return !forbidden.some(pattern => tool.code.includes(pattern));
  }
}
```

**实现时机**：Phase 10.5（高复杂度，需要代码沙箱）
**改动量**：~500 行新代码
**预期收益**：工具集从"32 个固定"进化到"按需无限扩展"

---

### 突破 13：跨域知识迁移（学一得十） ✅ 已实现

**来源**：Transfer Learning for AI Agents (InfoQ 2025) + CADENT (arXiv 2026.01)

**现状瓶颈**：右脑的学习是 task-level 的——学会了"git commit"的决策模式，不会自动迁移到"svn commit"或"hg commit"。每个领域从零学起。

**突破方案**：影子脑在进化时发现不同 fingerprint 的缺口有相似结构→ 自动生成迁移规则。

```typescript
// 新增：src/brain/shadow/transfer-learner.ts

interface DomainMapping {
  source: string;         // 源领域 fingerprint
  target: string;         // 目标领域 fingerprint
  similarity: number;     // 结构相似度 0-1
  transferableRules: string[];  // 可迁移的规则 ID
  transferablePatterns: PatternMapping[];  // 概念映射
}

interface PatternMapping {
  sourceConcept: string;  // e.g., "git commit"
  targetConcept: string;  // e.g., "svn commit"
  confidence: number;
}

class TransferLearner {
  // 发现可迁移的领域对
  findTransferable(memory: DecisionMemory): DomainMapping[] {
    const clusters = memory.getClusterStats();
    const mappings: DomainMapping[] = [];

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = this.structuralSimilarity(clusters[i], clusters[j]);
        if (sim > 0.7) {
          mappings.push({
            source: clusters[i].fingerprint,
            target: clusters[j].fingerprint,
            similarity: sim,
            transferableRules: this.findTransferableRules(clusters[i], clusters[j]),
            transferablePatterns: this.mapConcepts(clusters[i], clusters[j]),
          });
        }
      }
    }

    return mappings;
  }

  // 执行迁移
  async transfer(mapping: DomainMapping, ruleEngine: RuleEngine): Promise<number> {
    let transferred = 0;
    for (const ruleId of mapping.transferableRules) {
      const sourceRule = ruleEngine.getRules().find(r => r.id === ruleId);
      if (!sourceRule) continue;

      // 生成目标领域的新规则（概念替换）
      const targetRule = this.adaptRule(sourceRule, mapping.transferablePatterns);
      ruleEngine.addLearnedRule(targetRule);
      transferred++;
    }
    return transferred;
  }
}
```

**实现时机**：Phase 10.6
**改动量**：~350 行新代码
**预期收益**：学习效率从"逐个领域学习"进化到"学一个领域，理解一类领域"

---

### 突破 14：学习策略进化（动态课程） ✅ 已实现

**来源**：Intrinsic Metacognition (ICML 2025) — metacognitive planning

**现状瓶颈**：课程学习（Curriculum Learning）的策略是写死的——前 100 步全量随机，之后按 difficulty 从易到难。这个"100 步"和课程节奏是人定的。

**突破方案**：影子脑可以进化学习策略本身——实验不同的课程节奏，取最优。

```typescript
// 扩展：src/brain/shadow/curriculum-evolver.ts

interface CurriculumStrategy {
  id: string;
  name: string;
  warmupSteps: number;        // 热身步数
  easyRatio: number;          // 简单样本比例
  progressSchedule: 'linear' | 'exponential' | 'step' | 'adaptive';
  difficultyThreshold: number; // 最大难度阈值
  // 效果统计
  convergenceSteps: number;
  finalLoss: number;
  forgettingRate: number;     // 旧任务退化率
}

class CurriculumEvolver {
  private strategies: CurriculumStrategy[] = [];
  private currentStrategy: CurriculumStrategy;

  // 生成新策略候选
  generateStrategies(current: CurriculumStrategy, performance: PerformanceMetrics): CurriculumStrategy[] {
    // 基于当前策略的瓶颈生成变体
    // 例如：收敛慢 → 增加热身步数
    // 例如：遗忘严重 → 降低难度增长速度
    // 例如：loss 震荡 → 切换为 step schedule
  }

  // A/B 测试不同策略
  async compareStrategies(
    strategies: CurriculumStrategy[],
    trainingData: TrainingSample[],
  ): Promise<CurriculumStrategy> {
    // 在影子副本上并行测试不同策略
    // 取收敛最快 + 遗忘最少的
  }
}
```

**实现时机**：Phase 10.7
**改动量**：~250 行新代码
**预期收益**：学习效率的提升不再有天花板

---

### 突破 15：Prompt 自进化（改写自己的说明书） ✅ 已实现

**来源**：Gödel Agent — "dynamically modify its own logic and behavior through prompting"

**现状瓶颈**：三脑的 prompt 模板（注入 LLM 的系统提示词）是人写的。影子脑的进化 prompt 也是人写的。如果 prompt 写得不好（例如缺少关键上下文），进化方案的质量会持续偏低。

**突破方案**：影子脑可以优化自己的 prompt 模板。

```typescript
// 新增：src/brain/shadow/prompt-evolver.ts

interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  // 效果统计
  avgProposalQuality: number;   // 生成方案的平均质量
  acceptanceRate: number;        // 方案通过进化锁的比例
  usageCount: number;
  lastUpdated: number;
}

class PromptEvolver {
  private templates: Map<string, PromptTemplate> = new Map();

  // 分析 prompt 效果
  analyzeEffectiveness(history: EvolutionLogEntry[]): PromptAnalysis[] {
    // 按 prompt 版本分组
    // 计算每个版本的方案质量、通过率、改进幅度
  }

  // 生成 prompt 改进方案
  async improve(prompt: PromptTemplate, analysis: PromptAnalysis): Promise<PromptTemplate> {
    const improvementPrompt = `
你是一个 prompt 优化专家。

当前 prompt:
${prompt.template}

效果分析:
- 方案平均质量: ${analysis.avgQuality.toFixed(2)}
- 通过率: ${(analysis.acceptanceRate * 100).toFixed(0)}%
- 主要失败原因: ${analysis.topFailureReasons.join(', ')}

请改进这个 prompt，使其生成更高质量的进化方案。
保留核心指令，优化上下文提供方式和约束条件。`;

    const improved = await this.llm.call(improvementPrompt);
    return { ...prompt, template: improved, lastUpdated: Date.now() };
  }
}
```

**实现时机**：Phase 10.8
**改动量**：~200 行新代码
**预期收益**：进化系统的"进化能力"本身在进化

---

### 扩展突破优先级总览

| 梯队 | 突破 | 改动量 | ROI | 实现时机 |
|------|------|--------|-----|----------|
| **第一梯队** | #8 元认知自适应 | ~300 行 | ★★★★★ | Phase 10.1 |
| **第一梯队** | #11 梦境预演 | ~250 行 | ★★★★★ | Phase 10.4 |
| **第一梯队** | #14 学习策略进化 | ~250 行 | ★★★★☆ | Phase 10.7 |
| **第二梯队** | #9 递归自改进 | ~400 行 | ★★★★☆ | Phase 10.2 |
| **第二梯队** | #10 多影子并行 | ~350 行 | ★★★★☆ | Phase 10.3 |
| **第二梯队** | #13 跨域迁移 | ~350 行 | ★★★☆☆ | Phase 10.6 |
| **第三梯队** | #12 工具发明 | ~500 行 | ★★★★★ | Phase 10.5 |
| **第三梯队** | #15 Prompt 自进化 | ~200 行 | ★★★☆☆ | Phase 10.8 |

**Phase 10 总计**：~2,600 行新代码，建议在 Phase 9 完成后按优先级逐步实现。

---

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 生成的规则有隐蔽 bug | 决策质量退化 | CPS 约束保护 + 回归测试 |
| 进化方向跑偏 | 系统行为不可预测 | GDI 漂移检测 + 0.44 阈值 |
| 影子大脑资源消耗 | 线上性能受影响 | 时机控制器限制（负载 > 50 不进化） |
| A/B 对比样本不足 | 验证不充分 | 最少 100 轮才允许合入 |
| 进化锁被绕过 | 不安全的改动合入 | 四道锁全部硬性检查，无旁路 |
| 人工审批成为瓶颈 | 进化速度慢 | L1-L2 自动通过，只 L3+ 需要人 |
| 能力图谱不准确 | 误判缺口 | 滑动平均 + 多样本验证 |
| 回滚失败 | 无法恢复到旧版本 | 每次进化前保存完整快照 |
| 进化振荡 | 反复进化/回滚 | 最小间隔 24h + 指数退避 |

---

## 十、与现有模块的关系

| 现有模块 | 与影子大脑的关系 |
|----------|-----------------|
| `ExperienceEvolver.hypothesize()` | 进化引擎的雏形，影子大脑将其从"改参数"升级到"生成新规则+验证" |
| `OnlineLearner.observeOnly` | 安全阀机制的参考，影子大脑的 A/B 测试类似 observeOnly 的升级版 |
| `SignalConvergenceLayer` | 影子大脑的进化方案也通过汇聚层写入 ReplayBuffer |
| `DecisionRecorder` | 进化锁的 A/B 对比数据来源 |
| `GapDetector`（新增） | 替代人工发现能力缺口，自动驱动进化 |
| `ThreeBrain.createBrainProvider()` | 实现 `ShadowCapableBrainProvider` 扩展接口，支持影子副本推理 |
| `LeftBrain.getRules/addLearnedRule` | BrainProvider 的规则读写接口 |
| `RightBrain.getNNWeights/getNNConfig` | BrainProvider 的 NN 状态读取接口 |

### BrainProvider 接口层次

```
BrainProvider（基础接口，只读数据）
├── getRules() / addLearnedRule()
├── getNNConfig() / getNNParamCount() / getNNWeights()
├── getDecisionDistribution() / getRecentLosses()
├── getDecisionSamples() / getClusterStats()
└── runRegressionTests()

ShadowCapableBrainProvider（扩展接口，支持副本推理）
├── extends BrainProvider
├── cloneBrainState()        ← 深拷贝三脑状态
└── replayDecision()         ← 用指定状态重放决策推理

isShadowCapable(bp)          ← 类型守卫，运行时检测
```

SwarmManager 漏斗式验证自动适配：
- 有 ShadowCapableBrainProvider → 双通道（离线门槛 + 副本校准）
- 只有 BrainProvider → 单通道（纯离线模式）
