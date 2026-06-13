# ModelPool 多模型池开发计划 v2

> 统一管理云端 LLM + 本地专家微模型，实现智能调度、多专家协作、成本优化

## 核心认知

**LLM 和专家是执行者，不是决策者。真正智能的是知道"什么时候用谁"的调度层。**

就像医院的分诊台 — 外科、内科、放射科都是专家，但分诊台才是决定你该看哪个科的智能核心。分诊台错了，再好的专家也白搭。

## 架构定位

```
Subsystems（容器）
  │
  ├─ 基础设施层（Buddy 管理的资源）
  │    ├─ MemoryStore, ToolRegistry, STMPStore...
  │    ├─ ModelPool          ← 新建：连接池 + 统计 + 熔断
  │    └─ LLMAdapter          ← 适配 pool
  │
  └─ 智能层（Buddy 的认知能力）
       ├─ ModelPoolScheduler  ← 新建：智能决策核心（分诊台）
       ├─ ExperienceRouter    → 提供新颖度信号
       ├─ IntentClassifier    → 提供任务分类信号
       ├─ CognitiveEngine     → 提供领域置信度信号
       └─ TernaryExpertRouter → 提供本地专家匹配信号
```

**ModelPool** = 基础设施（管连接）
**ModelPoolScheduler** = 智能核心（做决策）

## 研究结论

### 已验证有效的方案

| 方案 | 来源 | 核心机制 | Buddy 复用 |
|---|---|---|---|
| kNN 路由 | 2025 论文 | embedding 空间找相似历史 | ExperienceGraph 已有 |
| 级联 (Cascade) | FrugalGPT 2023 | 小模型先试，不行再升级 | 与 fallback 天然契合 |
| 训练无关路由 | PORT NeurIPS 2025 | 小样本学习策略 | Buddy 有数据积累能力 |
| 决策感知路由 | EquiRouter 2026 | 学排名不学分数 | 设计时注意 |
| 输出长度可控 | R2-Router 2026 | 强模型+短输出 > 弱模型+长输出 | maxOutputTokens 可调 |

### 已验证失败的路径

| 失败 | 来源 | 原因 | Buddy 规避 |
|---|---|---|---|
| 路由退化 (Routing Collapse) | arXiv 2602.03478 | 训练绝对分数 → 预算越高越选贵模型 | 用相对排序，不用绝对评分 |
| DNN 路由器安全性 | arXiv 2503.08704 | 可学习参数易被攻击/操纵 | 用 kNN/规则/统计，不用神经网络 |
| 固定成本假设 | arXiv 2602.02823 | 忽略输出长度对质量和成本的影响 | 调度时同时决定输出长度约束 |

### 设计原则

```
✅ 要做的：
  1. 记录每次决策 + 结果（数据积累是智能的基础）
  2. 用相对排序，不用绝对评分（避免 collapse）
  3. 级联：小模型/专家先试，不行再升级
  4. kNN 匹配历史成功案例（简单有效）
  5. Thompson Sampling 探索/利用（已有，继续用）
  6. 调度时同时决定输出长度约束

❌ 不要做的：
  1. 不要用 DNN/神经网络做路由决策（脆弱、不安全）
  2. 不要训练绝对分数预测器（会 collapse）
  3. 不要假设每个模型的成本/质量是固定的
  4. 不要一开始就设计复杂的调度算法（先记录数据）
```

## 三层调度架构

```
┌──────────────────────────────────────────────────┐
│           ModelPoolScheduler（智能决策核心）        │
│                                                   │
│  Layer 1: 规则快筛（0ms）                          │
│    ├─ 专家匹配（TernaryExpertRouter）              │
│    ├─ 意图分类（IntentClassifier）                 │
│    └─ 静态规则（任务类型 → 模型 tier）              │
│                                                   │
│  Layer 2: 经验路由（<10ms）                        │
│    ├─ kNN 匹配历史成功案例（ExperienceGraph）       │
│    ├─ Thompson Sampling 探索/利用                  │
│    └─ 新颖度判断（ExperienceRouter）               │
│                                                   │
│  Layer 3: 级联兜底（按需）                         │
│    ├─ 小模型/专家先试                              │
│    ├─ 质量不达标 → 升级到大模型                     │
│    └─ 预算约束 → 全局成本最优                      │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Layer 1: 规则快筛

```typescript
// 输入有明确领域 → 本地专家（零成本、<50ms）
// 简单闲聊 → budget 云端模型
// 复杂推理 → premium 云端模型
// 需要 tool calling → 支持原生 function calling 的模型

function ruleFilter(input: string, intent: IntentResult): PoolNode[] {
  const candidates = pool.getAvailableNodes();

  // 专家优先
  const domain = ternaryRouter.selectDomain(input);
  if (domain) {
    const experts = candidates.filter(n => n.type === 'local_expert' && n.domain === domain);
    if (experts.length > 0) return experts;
  }

  // 按意图过滤
  return candidates.filter(n => {
    if (intent.category === 'conversation' && n.tier === 'budget') return true;
    if (intent.category === 'complex_task' && n.tier === 'premium') return true;
    if (intent.category === 'code_operations' && n.tags.includes('code')) return true;
    // ...
  });
}
```

### Layer 2: 经验路由

```typescript
// 在历史记录中找相似输入
// 看历史上哪个模型在这类任务上成功率最高
// Thompson Sampling 平衡探索和利用

function experienceRoute(candidates: PoolNode[], input: string): PoolNode {
  // kNN：找最近的 K 个历史案例
  const similar = decisionHistory.findSimilar(input, 10);

  if (similar.length > 0) {
    // 统计每个模型在相似案例上的成功率
    const scores = new Map<string, number>();
    for (const record of similar) {
      const current = scores.get(record.selectedNode) ?? 0;
      scores.set(record.selectedNode, current + (record.success ? 1 : 0));
    }

    // Thompson Sampling 选最优
    const best = thompsonSelect(candidates, scores);
    if (best) return best;
  }

  // 没有历史数据 → 退回 Layer 1 结果
  return candidates[0];
}
```

### Layer 3: 级联兜底

```typescript
// FrugalGPT 思路：小模型先试，不行再升级

async function cascadeExecute(node: PoolNode, input: string): Promise<Result> {
  const result = await execute(node, input);

  // 质量检查
  if (result.confidence < 0.6 || result.needsEscalation) {
    // 升级到更强的模型
    const upgraded = pool.selectUpgraded(node);
    if (upgraded) {
      console.log(`[Cascade] ${node.id} → ${upgraded.id}`);
      return execute(upgraded, input);
    }
  }

  return result;
}
```

## 池内节点类型

| 类型 | 来源 | 成本 | 延迟 | 适用场景 |
|------|------|------|------|----------|
| `cloud` | 硅基流动/OpenAI/DeepSeek 等 | 按 token 计费 | 500ms-5s | 通用推理、复杂任务 |
| `local_expert` | 三进制微模型 | 零成本 | <50ms | 领域精确匹配 |
| `lora` | LoRA 微调模型 | 零成本 | <100ms | 特定风格/领域 |

## 决策记录（智能的基础）

```typescript
// 每次调度都记录，这是智能的燃料

interface DecisionRecord {
  // 输入
  input: string;
  inputHash: string;           // 用于快速匹配相似输入
  timestamp: number;

  // 决策前的信号
  intent: IntentCategory;      // IntentClassifier 的结果
  domain: string | null;       // TernaryExpertRouter 的匹配
  novelty: number;             // ExperienceRouter 的新颖度
  complexity: 'simple' | 'medium' | 'complex';

  // 决策
  selectedNode: string;        // 选了谁
  selectionReason: string;     // 为什么选它
  selectionLayer: 1 | 2 | 3;   // 哪层做的决策
  outputTokenLimit: number;    // 输出长度约束（R2-Router 思路）

  // 结果
  success: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  userFeedback?: 'good' | 'bad';
  fallbackTriggered: boolean;
  fallbackFrom?: string;
}

// 持久化到 ~/.buddy/pool-decisions.jsonl
// 每行一条，方便追加和分析
```

## 统一节点定义

```typescript
interface PoolNode {
  id: string;                    // 全局唯一
  type: 'cloud' | 'local_expert' | 'lora';

  // 云端
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;

  // 本地专家
  domain?: string;
  engine?: TernaryEngine;

  // 通用
  tags: string[];
  tier: 'premium' | 'standard' | 'budget' | 'free';
  warm: boolean;
  capabilities: ProviderCapabilities;

  // 成本
  costPer1kInput?: number;
  costPer1kOutput?: number;

  // 运行时统计（按 taskType 分维度）
  stats: {
    totalCalls: number;
    successRate: number;          // 全局成功率
    avgLatencyMs: number;
    consecutiveFailures: number;
    // 按任务类型分维度（避免 collapse 的关键）
    byTaskType: Record<string, {
      attempts: number;
      successRate: number;
      avgLatency: number;
    }>;
  };
}
```

## 配置示例

```json
{
  "llm": {
    "provider": "siliconflow",
    "model": "Qwen/Qwen2.5-72B-Instruct",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.siliconflow.cn/v1",

    "pool": {
      "strategy": "task_match",
      "budget": { "maxCostPerHour": 5.0 },
      "nodes": [
        {
          "id": "qwen-72b",
          "type": "cloud",
          "provider": "siliconflow",
          "model": "Qwen/Qwen2.5-72B-Instruct",
          "tags": ["reasoning", "code", "complex", "vision"],
          "tier": "premium",
          "costPer1kInput": 0.04
        },
        {
          "id": "qwen-14b",
          "type": "cloud",
          "provider": "siliconflow",
          "model": "Qwen/Qwen2.5-14B-Instruct",
          "tags": ["chat", "tools", "general"],
          "tier": "standard",
          "costPer1kInput": 0.01
        },
        {
          "id": "qwen-7b",
          "type": "cloud",
          "provider": "siliconflow",
          "model": "Qwen/Qwen2.5-7B-Instruct",
          "tags": ["chat", "fast", "cheap"],
          "tier": "budget",
          "costPer1kInput": 0.005
        },
        {
          "id": "deepseek-v3",
          "type": "cloud",
          "provider": "deepseek",
          "model": "deepseek-chat",
          "tags": ["reasoning", "math", "code"],
          "tier": "standard",
          "costPer1kInput": 0.002
        },
        {
          "id": "react-expert",
          "type": "local_expert",
          "domain": "react",
          "tags": ["react", "frontend", "hooks", "jsx"],
          "tier": "free"
        },
        {
          "id": "python-expert",
          "type": "local_expert",
          "domain": "python",
          "tags": ["python", "data", "ml", "fastapi"],
          "tier": "free"
        },
        {
          "id": "git-expert",
          "type": "local_expert",
          "domain": "git",
          "tags": ["git", "version_control", "merge"],
          "tier": "free"
        }
      ]
    },

    "fallbacks": [
      { "provider": "siliconflow", "model": "Qwen/Qwen2.5-14B-Instruct" },
      { "provider": "ollama", "model": "llama3.1" }
    ]
  }
}
```

## 调度示例

```
用户: "帮我写一个 React 组件"
  Layer 1: domain=react → react-expert ✅ (零成本, <50ms)

用户: "分析一下这个架构为什么选择微服务"
  Layer 1: intent=reasoning, 无 domain → premium candidates
  Layer 2: kNN 找相似 → qwen-72b 历史成功率 92%
  → qwen-72b

用户: "帮我整理一下 git 提交历史"
  Layer 1: domain=git → git-expert ✅ (零成本, <50ms)

用户: "写个 Python 脚本爬取数据，用 Docker 部署"
  Layer 1: intent=complex_task → DAG 编排
  → Task 1 (分析): qwen-72b (cloud)
  → Task 2 (Python): python-expert (local)
  → Task 3 (Docker): docker-expert (local) 或 qwen-7b (cloud)
  → Task 4 (集成): qwen-72b (cloud)
```

## 开发任务

### Phase 1: 记录层（优先级 P0，1 天）

#### Task 1.1: DecisionRecord 类型定义
- **文件**: `src/types.ts`
- **改动**: 新增 `DecisionRecord`、`PoolNode`、`ModelPoolConfig` 类型

#### Task 1.2: 决策记录器
- **文件**: `src/core/decision-recorder.ts`（新建）
- **改动**:
  - `DecisionRecorder` 类
  - `record(decision)` — 追加到 `~/.buddy/pool-decisions.jsonl`
  - `findSimilar(input, k)` — 基于 inputHash 找相似历史
  - `getStats(nodeId, taskType)` — 按维度统计成功率/延迟
  - `load()` / `save()` — 持久化

#### Task 1.3: LLMAdapter 埋点
- **文件**: `src/core/llm.ts`
- **改动**: `executeWithFallback` 里加 `DecisionRecorder.record()`
- **说明**: 不改调度逻辑，只记录

### Phase 2: ModelPool 基础设施（优先级 P0，2 天）

#### Task 2.1: ModelPool 类
- **文件**: `src/core/model-pool.ts`（新建）
- **改动**:
  - 节点注册/查询/过滤
  - 预热（`warmup()`）
  - 熔断/恢复（连续 3 次失败 → 摘除）
  - 统计（EWMA 滑动窗口）

#### Task 2.2: ModelPoolScheduler 类
- **文件**: `src/core/model-pool-scheduler.ts`（新建）
- **改动**:
  - `schedule(input, context)` — 三层调度入口
  - Layer 1: 规则快筛（整合 IntentClassifier + TernaryExpertRouter）
  - Layer 2: 经验路由（整合 DecisionRecorder + Thompson Sampling）
  - Layer 3: 级联兜底（质量不达标 → 升级）
  - 避免 collapse：用相对排序，不用绝对评分

#### Task 2.3: ModelRouter 集成
- **文件**: `src/core/model-router.ts`
- **改动**: `select()` 增加 pool 分支（有 pool 时走 scheduler，无 pool 时走原逻辑）

#### Task 2.4: LLMAdapter 适配
- **文件**: `src/core/llm.ts`
- **改动**:
  - `executeWithFallback` 使用 pool scheduler
  - 新增 `warmupPool()` 方法
  - 级联逻辑：`cascadeExecute()`

#### Task 2.5: Subsystems 初始化
- **文件**: `src/core/subsystems.ts`
- **改动**:
  - 初始化 ModelPool + ModelPoolScheduler
  - 将 TernaryExpertRouter 的专家注册进 pool
  - 调用 `warmupPool()`

### Phase 3: 配置与持久化（优先级 P0，1 天）

#### Task 3.1: 配置管理
- **文件**: `src/config.ts`
- **改动**: `mergeConfig()` 处理 pool 字段

#### Task 3.2: 交互式配置
- **文件**: `src/main.ts`
- **改动**: 支持添加云端/本地专家节点

#### Task 3.3: Pool 状态持久化
- **文件**: `src/core/model-pool.ts`
- **改动**: 统计数据持久化到 `~/.buddy/pool-stats.json`

### Phase 4: 测试（优先级 P0，2 天）

#### Task 4.1: DecisionRecorder 测试
- **文件**: `src/core/decision-recorder.test.ts`（新建）
- **覆盖**: 记录/查询/统计/持久化

#### Task 4.2: ModelPool 测试
- **文件**: `src/core/model-pool.test.ts`（新建）
- **覆盖**: 节点注册/预热/熔断/恢复

#### Task 4.3: ModelPoolScheduler 测试
- **文件**: `src/core/model-pool-scheduler.test.ts`（新建）
- **覆盖**:
  - Layer 1 规则快筛正确性
  - Layer 2 经验路由（有/无历史数据）
  - Layer 3 级联触发
  - 向后兼容（无 pool 时走原逻辑）
  - 不会 collapse（不会总选最贵的）

#### Task 4.4: 集成测试
- **文件**: `src/e2e-pool.test.ts`（新建）
- **覆盖**: 端到端调度 + 级联降级

#### Task 4.5: 现有测试回归
- **验证**: `npm run test` 全部通过

## 向后兼容

- 不配置 `pool` 字段时，行为与当前完全一致
- `primary`/`lightweight`/`fallbacks` 继续保留
- 现有测试不需要修改

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 DecisionRecord、PoolNode、ModelPoolConfig |
| `src/core/decision-recorder.ts` | 新建 | 决策记录器 |
| `src/core/model-pool.ts` | 新建 | 连接池 + 统计 + 熔断 |
| `src/core/model-pool-scheduler.ts` | 新建 | 三层调度智能核心 |
| `src/core/model-router.ts` | 修改 | 集成 pool 分支 |
| `src/core/llm.ts` | 修改 | 适配 pool + warmupPool + cascadeExecute |
| `src/core/subsystems.ts` | 修改 | 初始化 pool + 注册专家 |
| `src/config.ts` | 修改 | mergeConfig 处理 pool |
| `src/main.ts` | 修改 | 交互式配置 |
| `src/core/decision-recorder.test.ts` | 新建 | 决策记录器测试 |
| `src/core/model-pool.test.ts` | 新建 | ModelPool 测试 |
| `src/core/model-pool-scheduler.test.ts` | 新建 | 调度器测试 |
| `src/e2e-pool.test.ts` | 新建 | 集成测试 |
| `MODEL_POOL_PLAN.md` | 修改 | 本计划文档 |

## 参考文献

- FrugalGPT (Stanford 2023) — 级联策略，98% 成本降低
- RouteLLM (LMSYS 2024) — 二选一路由，偏好数据训练
- kNN Router (2025) — 简单 kNN 竞胜复杂学习路由器
- PORT (NeurIPS 2025) — 无训练在线路由
- EquiRouter (2026) — 决策感知路由，避免 routing collapse
- R2-Router (2026) — 输出长度可控路由
- LLMRouter (UIUC 2026) — 16+ 策略统一框架
- OmniRouter (2025) — 全局预算约束优化
