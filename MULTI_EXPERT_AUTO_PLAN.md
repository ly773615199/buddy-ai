# Buddy 调度决策核心设计 v2

**日期**: 2026-04-27
**状态**: 待执行
**目标**: 在 BuddyAgent 中收口分析+决策逻辑，消灭 5 处分散路由，实现自动多专家协作

---

## 〇、第一原则

**BuddyAgent 是大脑，子系统是工具。**

`agent.ts` 已经承担了"大脑"角色：`preprocessMessage()` 做收集、`postprocessResult()` 做反馈和学习。唯独**分析和决策**两块散落在 5 个子模块里，各自为政。

这次改造的目标：**把散落的分析+决策收口到 `agent.ts` 的一个方法里**，不新建平级类。

---

## 一、现状：决策散落 5 处

```
BuddyAgent (agent.ts) — 大脑
  ├── 收集 ✅ preprocessMessage()
  ├── 分析 ❌ 散在 3 个文件
  ├── 决策 ❌ 散在 2 个文件
  ├── 执行 ✅ WSHandler / ExpertPool / TaskExecutor
  ├── 反馈 ✅ postprocessResult()
  └── 学习 ✅ DecisionRecorder / ExperienceEngine
```

### 5 个分散的路由器

| # | 位置 | 职责 | 问题 |
|---|------|------|------|
| 1 | `message-processor.ts:355` | `assessComplexity()` — 判断是否走 DAG | 关键词匹配太简单，"然后"、"同时"误命中 |
| 2 | `model-router.ts:384` | `inferComplexity()` — 按 taskType+长度选 tier | 和 #1 重复，互不通信 |
| 3 | `llm.ts:518` | `inferComplexity()` — 同上 | 和 #2 完全重复的代码 |
| 4 | `model-router.ts:250` | `select()` — 按 taskType 选 primary/lightweight | 只看 taskType，不看领域 |
| 5 | `expert-pool.ts:170` | `selectExpertsForTask()` — 关键词匹配选专家 | 硬编码，不理解语义 |

### 代码重复

| 重复 | 涉及文件 | 行数 |
|------|---------|------|
| `inferComplexity` × 2 | `model-router.ts` + `llm.ts` | ~30 行 × 2 |
| `assessComplexity` vs `inferComplexity` | `message-processor.ts` vs `model-router.ts` | ~60 行，逻辑不同 |
| TaskQueue + ExecutionSession | `handleUserMessage` vs `handleMultiExpertParallel` | ~100 行 |
| 情绪广播 | 两条路径各写一套 | ~20 行 × 2 |

---

## 二、改造方案：Orchestrator 收口到 agent.ts

### 架构变更

```
BuddyAgent (agent.ts)
  ├── preprocessMessage()     ← 已有，不动
  ├── orchestrate()           ← 新增，分析+决策
  ├── executeByPlan()         ← 新增，按决策执行
  └── postprocessResult()     ← 已有，不动
```

**不新建文件。** `orchestrate()` 和 `executeByPlan()` 是 `BuddyAgent` 的方法，内部调用已有子系统。

### 新增方法签名

```typescript
// agent.ts 新增

/** 编排决策 — 分析任务 + 选择协作模式 + 分配资源 */
private orchestrate(content: string): OrchestrationPlan

/** 按决策执行 — 根据 plan 走不同执行路径 */
private async executeByPlan(plan: OrchestrationPlan): Promise<ExecutionResult>
```

### OrchestrationPlan 类型

```typescript
// types.ts 新增

export type CollaborationMode = 
  | 'local_only'   // 本地专家独立完成
  | 'single'       // 单个外部 LLM
  | 'parallel'     // 多专家同时调用，结果融合
  | 'cascade'      // 先小模型试，质量不够再升级
  | 'sequential'   // 接力传递上下文
  | 'debate';      // 多方论证 + 裁决

export interface OrchestrationPlan {
  /** 协作模式 */
  mode: CollaborationMode;
  /** 决策理由（可追溯） */
  reason: string;
  /** 检测到的领域 */
  domains: string[];
  /** 任务复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 选定的执行节点 */
  selectedNodes: Array<{
    id: string;
    type: 'local_expert' | 'cloud_node' | 'primary' | 'lightweight';
    model?: string;
    domain?: string;
  }>;
  /** 是否需要 DAG 编排 */
  useDAG: boolean;
  /** 决策元数据 */
  meta: {
    localCoverageRatio: number;
    localConfidence: number;
    budgetRemaining: number;
    availableNodeCount: number;
    userCorrectionCount: number;
  };
}
```

---

## 三、orchestrate() 详细设计

### 决策流程

```
输入: content (用户消息)
  │
  ▼
┌─ Step 1: 收集信号 ──────────────────────────────────┐
│  - detectDomains(content) → 领域列表                  │
│  - assessComplexity(content) → 复杂度                 │
│  - getLocalExperts() → 本地专家列表+置信度             │
│  - getCloudNodes() → 可用云端节点                     │
│  - getBudgetRemaining() → 剩余预算                    │
│  - getUserCorrections() → 用户纠正次数                │
│  - getConversationDepth() → 对话深度                  │
│  - getTimeContext() → 时段                            │
└──────────────────────────────────────────────────────┘
  │
  ▼
┌─ Step 2: 分析能力匹配 ──────────────────────────────┐
│  - localCoverageRatio = 本地覆盖领域数 / 总领域数      │
│  - localConfidence = 本地专家最高置信度                 │
│  - needsExternal = 能力缺口 OR 置信度 < 0.6           │
│  - needsMulti = 领域数 >= 2 AND 复杂度 != 'simple'    │
└──────────────────────────────────────────────────────┘
  │
  ▼
┌─ Step 3: 决策树 ────────────────────────────────────┐
│                                                       │
│  预算耗尽? ──── YES ──→ local_only                    │
│     │ NO                                              │
│     ▼                                                 │
│  用户纠正 >= 3? ── YES ──→ local_only                 │
│     │ NO                                              │
│     ▼                                                 │
│  本地完全覆盖 AND 置信度 >= 0.7?                       │
│     │ YES ──→ local_only                              │
│     │ NO                                              │
│     ▼                                                 │
│  领域数 == 0 OR 复杂度 == 'simple'?                    │
│     │ YES ──→ single (ModelRouter 选模型)              │
│     │ NO                                              │
│     ▼                                                 │
│  领域数 >= 2 AND 可用节点 >= 2?                        │
│     │ YES ──→ parallel (多专家并行)                    │
│     │ NO                                              │
│     ▼                                                 │
│  可用节点 == 1?                                       │
│     │ YES ──→ single                                  │
│     │ NO                                              │
│     ▼                                                 │
│  默认 → cascade (小模型先试，不行升级)                  │
│                                                       │
└──────────────────────────────────────────────────────┘
  │
  ▼
输出: OrchestrationPlan
```

### 三个合并的分析函数

从 `message-processor.ts`、`model-router.ts`、`llm.ts` 提取合并为 `BuddyAgent` 的私有方法：

```typescript
// agent.ts 新增 — 替代 3 处重复

/** 统一领域检测 */
private detectDomains(content: string): string[] {
  const domainKeywords: Record<string, string[]> = {
    code: ['代码', '函数', '重构', 'bug', 'code', 'function', 'refactor', 'debug', 'class', '接口'],
    architect: ['架构', '设计', '模式', 'architecture', 'design', 'pattern', '模块', '系统'],
    test: ['测试', '用例', '覆盖率', 'test', 'case', 'coverage', '断言', 'assert'],
    review: ['审查', 'review', '规范', '安全', '性能', '质量'],
    data: ['数据', '分析', '统计', 'data', 'analyze', 'csv', 'json', 'sql'],
    writing: ['写', '文章', '文档', 'write', 'article', 'doc', '总结', '翻译'],
  };
  
  const lower = content.toLowerCase();
  return Object.entries(domainKeywords)
    .filter(([_, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([domain]) => domain);
}

/** 统一复杂度评估 — 替代 assessComplexity + inferComplexity × 2 */
private assessTaskComplexity(content: string): {
  complexity: 'simple' | 'medium' | 'complex';
  shouldUseDAG: boolean;
  dagReason: string;
} {
  // 短消息 → simple
  if (content.length < 30) {
    return { complexity: 'simple', shouldUseDAG: false, dagReason: '' };
  }

  // 并行标记词
  const parallelMarkers = ['同时', '并且', '一边', '另外', '分别', 'also', 'and', 'while', 'simultaneously'];
  const markerCount = parallelMarkers.filter(m => content.includes(m)).length;

  // 子句数
  const clauses = content.split(/[,，;；.。\n]+/).filter(s => s.trim().length > 3);
  
  // DAG 判断
  const shouldUseDAG = markerCount >= 3 || clauses.length >= 4;
  const dagReason = shouldUseDAG
    ? (markerCount >= 3 ? `并行标记词 ${markerCount} 个` : `子句 ${clauses.length} 个`)
    : '';

  // 复杂度
  const reasoningKeywords = ['分析', '比较', '设计', '优化', '重构', 'analyze', 'compare', 'design', 'optimize'];
  const reasonScore = reasoningKeywords.filter(k => content.toLowerCase().includes(k)).length;
  
  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  if (content.length > 200 || reasonScore >= 2) complexity = 'complex';
  else if (content.length > 80 || reasonScore >= 1) complexity = 'medium';

  return { complexity, shouldUseDAG, dagReason };
}
```

---

## 四、executeByPlan() 详细设计

```typescript
private async executeByPlan(plan: OrchestrationPlan): Promise<ExecutionResult> {
  switch (plan.mode) {
    case 'local_only': {
      // 本地专家直接回答
      const expert = plan.selectedNodes[0];
      if (expert?.domain) {
        const result = await this.sys.ternaryRouter.query(expert.domain, plan.content);
        return { text: result.answer, source: 'local', toolCalls: [] };
      }
      // fallback 到 single
      return this.executeSingle(plan);
    }

    case 'single': {
      // 单 LLM 调用（现有路径）
      return this.executeSingle(plan);
    }

    case 'parallel': {
      // 多专家并行（复用 ExpertPool）
      return this.executeParallel(plan);
    }

    case 'cascade': {
      // 级联：小模型先试，质量不够升级
      return this.executeCascade(plan);
    }

    case 'sequential': {
      // 接力：上一步输出 → 下一步输入
      return this.executeSequential(plan);
    }

    case 'debate': {
      // 辩论：多方论证 → 裁决
      return this.executeDebate(plan);
    }
  }
}
```

### 各模式实现

#### single — 复用现有路径

```typescript
private async executeSingle(plan: OrchestrationPlan): Promise<ExecutionResult> {
  // 直接走 MessageProcessor.processStream()，和现有 handleUserMessage 一样
  const result = await this.processor.processStream(plan.content, null, null);
  return { text: result.text, source: 'single', toolCalls: result.toolCalls };
}
```

#### parallel — 复用 ExpertPool

```typescript
private async executeParallel(plan: OrchestrationPlan): Promise<ExecutionResult> {
  const experts: ExpertConfig[] = plan.selectedNodes.map(node => ({
    id: node.id,
    modelConfig: { id: node.id, provider: '', model: node.model ?? '' },
    systemPrompt: EXPERT_TEMPLATES[node.domain ?? 'general']?.systemPrompt ?? '你是通用助手。',
    taskType: (node.domain ?? 'general') as TaskType,
  }));

  const results = await this.expertPool.runParallel(experts, plan.content, {
    timeoutMs: 90_000,
    maxConcurrent: 3,
  });

  // 融合
  const fused = this.fuseResults(results, plan.content);
  return { text: fused, source: 'parallel', toolCalls: [], expertResults: results };
}

/** 结果融合 — 初期拼接+去重，后续可加 LLM 融合 */
private fuseResults(results: ExpertResult[], originalQuestion: string): string {
  const successful = results.filter(r => r.success);
  if (successful.length === 0) return '所有专家均未返回有效结果。';
  if (successful.length === 1) return successful[0].text;

  // 拼接 + 简单去重
  const parts = successful.map((r, i) => `**[专家 ${i + 1}]**\n${r.text}`);
  return parts.join('\n\n---\n\n');
}
```

#### cascade — 级联策略

```typescript
private async executeCascade(plan: OrchestrationPlan): Promise<ExecutionResult> {
  // 第一轮：lightweight 模型
  const lightResult = await this.sys.llm.chat(
    [{ role: 'user', content: plan.content, timestamp: Date.now() }],
    [], 1, { taskType: 'chat' }
  );

  // 质量评估（简单启发式）
  const quality = this.evaluateQuality(lightResult.text, plan.content);
  
  if (quality >= 0.6) {
    return { text: lightResult.text, source: 'cascade_light', toolCalls: [] };
  }

  // 第二轮：primary 模型
  const primaryResult = await this.sys.llm.chat(
    [{ role: 'user', content: plan.content, timestamp: Date.now() }],
    [], 1, { taskType: 'reasoning' }
  );

  return { text: primaryResult.text, source: 'cascade_primary', toolCalls: [] };
}

/** 简单质量评估 */
private evaluateQuality(answer: string, question: string): number {
  let score = 0.5; // 基线
  if (answer.length < 20) score -= 0.3; // 太短
  if (answer.length > question.length * 0.5) score += 0.1; // 有内容
  if (answer.includes('不确定') || answer.includes('不知道')) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}
```

#### sequential — 接力执行

```typescript
private async executeSequential(plan: OrchestrationPlan): Promise<ExecutionResult> {
  let context = plan.content;
  const steps: string[] = [];

  for (const node of plan.selectedNodes) {
    const result = await this.sys.llm.chat(
      [{ role: 'user', content: context, timestamp: Date.now() }],
      [], 1, { taskType: 'chat', userOverride: node.model }
    );
    steps.push(result.text);
    context = result.text; // 上一步输出作为下一步输入
  }

  return { text: steps[steps.length - 1], source: 'sequential', toolCalls: [] };
}
```

#### debate — 辩论+裁决

```typescript
private async executeDebate(plan: OrchestrationPlan): Promise<ExecutionResult> {
  // 多方论证
  const arguments_ = await Promise.all(
    plan.selectedNodes.map(async (node) => {
      const result = await this.sys.llm.chat(
        [{ role: 'user', content: plan.content, timestamp: Date.now() }],
        [], 1, { taskType: 'chat', userOverride: node.model }
      );
      return { nodeId: node.id, argument: result.text };
    })
  );

  // 裁决者（用 primary 模型）
  const judgePrompt = [
    '你是裁决者。以下是多个专家对同一问题的回答，请综合判断，给出最终结论。',
    '',
    ...arguments_.map((a, i) => `专家 ${i + 1} (${a.nodeId}):\n${a.argument}`),
    '',
    '请给出你的最终结论：',
  ].join('\n');

  const judgeResult = await this.sys.llm.chat(
    [{ role: 'user', content: judgePrompt, timestamp: Date.now() }],
    [], 1, { taskType: 'reasoning' }
  );

  return { text: judgeResult.text, source: 'debate', toolCalls: [], expertResults: arguments_ };
}
```

---

## 五、集成到主流程

### ws-handler.ts 改造

```typescript
// ws-handler.ts handleUserMessage() 改造

async handleUserMessage(content: string, msgId?: string): Promise<void> {
  // ... 现有 TaskQueue / ExecutionSession 逻辑 ...

  try {
    // ── 新增：委托给 agent.orchestrate() ──
    const plan = this.agentRef.orchestrate(content);
    
    if (this.verbose) {
      console.log(`  [Orchestrate] mode=${plan.mode} reason=${plan.reason} domains=${plan.domains.join(',')} nodes=${plan.selectedNodes.length}`);
    }

    // 决策追踪
    this.sys.audit.logDecision({
      mode: plan.mode,
      reason: plan.reason,
      domains: plan.domains,
      complexity: plan.complexity,
      nodes: plan.selectedNodes.map(n => n.id),
    });

    // ── 执行 ──
    const result = await this.agentRef.executeByPlan(plan);

    // 广播结果
    this.eventBus?.emit({ type: 'reply', text: result.text });
    session.complete();

  } catch (err) {
    // ... 现有错误处理 ...
  }
}
```

### handleMultiExpertParallel 保留但 deprecated

```typescript
/** @deprecated 多专家现在由 orchestrate() 自动路由，此方法保留兼容旧前端 */
async handleMultiExpertParallel(content: string): Promise<void> {
  // 走 orchestrate() 的 parallel 路径
  const plan = this.agentRef.orchestrate(content);
  plan.mode = 'parallel'; // 强制 parallel
  const result = await this.agentRef.executeByPlan(plan);
  this.eventBus?.emit({ type: 'reply', text: result.text });
}
```

### AgentBridge 接口扩展

```typescript
// ws-handler.ts 中的 AgentBridge 接口扩展

interface AgentBridge {
  preprocessMessage(content: string): { type: string; content: string } | null;
  postprocessResult(content: string, result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> }): void;
  // 新增
  orchestrate(content: string): OrchestrationPlan;
  executeByPlan(plan: OrchestrationPlan): Promise<ExecutionResult>;
}
```

---

## 六、三处重复代码的处理

| 重复 | 处理方式 |
|------|---------|
| `message-processor.ts:assessComplexity()` | **删除**，调用方改为 `agent.orchestrate()` 内部使用统一方法 |
| `model-router.ts:inferComplexity()` | **删除**，合并到 `agent.assessTaskComplexity()` |
| `llm.ts:inferComplexity()` | **删除**，合并到 `agent.assessTaskComplexity()` |
| `model-router.ts:select()` | **保留**，作为 `orchestrate()` 的一个调用对象 |
| `expert-pool.ts:selectExpertsForTask()` | **保留**，但 `orchestrate()` 用自己的领域检测替代其关键词匹配 |

**原则**：不删除子系统的接口，但决策权上移到 agent.ts。

---

## 七、前端清理

### Phase 3（与 MULTI_EXPERT_AUTO_PLAN v1 相同）

| 文件 | 改动 |
|------|------|
| `frontend/src/components/InputBar.tsx` | 删除 🎯 按钮 |
| `frontend/src/components/ChatPanel.tsx` | 删除 `onMultiExpert` prop |
| `frontend/src/App.tsx` | 删除 `sendMultiExpert` 传参 |
| `frontend/src/hooks/useWebSocket.ts` | `sendMultiExpert` 标记 deprecated |

---

## 八、文件变更总览

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `src/core/agent.ts` | 修改 | +200（orchestrate + executeByPlan + detectDomains + assessTaskComplexity + fuseResults + evaluateQuality） |
| `src/types.ts` | 修改 | +30（OrchestrationPlan / CollaborationMode / ExecutionResult 类型） |
| `src/core/ws-handler.ts` | 修改 | +40（handleUserMessage 改造 + AgentBridge 扩展 + 决策日志） |
| `src/core/message-processor.ts` | 修改 | -30（删除 assessComplexity 及调用方） |
| `src/core/model-router.ts` | 修改 | -15（删除 inferComplexity） |
| `src/core/llm.ts` | 修改 | -15（删除 inferComplexity） |
| `frontend/src/components/InputBar.tsx` | 修改 | -20（删除 🎯 按钮） |
| `frontend/src/components/ChatPanel.tsx` | 修改 | -5 |
| `frontend/src/App.tsx` | 修改 | -3 |
| **合计** | | +270 新增，-88 删除 |

---

## 九、决策追踪

每次 `orchestrate()` 调用记录完整决策链：

```typescript
// agent.ts orchestrate() 末尾

this.decisionTrace.push({
  timestamp: Date.now(),
  input: content.slice(0, 200),
  domains,
  complexity,
  localCoverageRatio,
  localConfidence,
  selectedMode: plan.mode,
  reason: plan.reason,
  selectedNodes: plan.selectedNodes.map(n => n.id),
});
```

持久化到 `DecisionRecorder`（扩展字段）：

```typescript
this.sys.decisionRecorder.record({
  input: content.slice(0, 500),
  intent: plan.domains.join(','),
  domain: plan.domains.join(','),
  selectedNode: plan.selectedNodes.map(n => n.id).join('+'),
  selectionReason: plan.reason,
  success: true, // 后续由 feedback 更新
  collaborationMode: plan.mode,
  // 新增
  localCoverageRatio: plan.meta.localCoverageRatio,
  localConfidence: plan.meta.localConfidence,
  complexity: plan.complexity,
});
```

---

## 十、验收标准

| # | 场景 | 预期 | 验证方式 |
|---|------|------|---------|
| 1 | "帮我重构这个函数并写测试" | domains=[code, test] → parallel | 日志：`mode=parallel reason=多领域` |
| 2 | "今天天气怎么样" | domains=[] → single | 日志：`mode=single reason=简单任务` |
| 3 | "分析这段代码的架构" | domains=[architect] → single | 日志：`mode=single reason=单领域` |
| 4 | "帮我重构并写测试同时优化性能" | domains=[code, test] → parallel | 日志：`mode=parallel` |
| 5 | ModelPool 只有 1 个可用节点 | → single | 日志：`mode=single reason=资源不足` |
| 6 | 用户连续纠正 3 次 | → local_only | 日志：`mode=local_only reason=用户纠正过多` |
| 7 | 预算耗尽 | → local_only | 日志：`mode=local_only reason=预算耗尽` |
| 8 | 凌晨 3 点简单问题 | → local_only | 日志：`mode=local_only reason=深夜降级` |
| 9 | 每个决策的 reason 可追溯 | — | 决策日志完整 |
| 10 | 原有 DAG 编排不受影响 | — | `assessComplexity` 逻辑保留 |
| 11 | handleMultiExpertParallel 仍可用 | — | deprecated 但不报错 |
| 12 | 性能：orchestrate() < 5ms | — | 纯逻辑，无 LLM 调用 |

---

## 十一、实现步骤

| 步骤 | 内容 | 工时 |
|------|------|------|
| 1 | `types.ts` 新增 OrchestrationPlan / CollaborationMode / ExecutionResult | 0.5h |
| 2 | `agent.ts` 新增 detectDomains + assessTaskComplexity（合并 3 处重复） | 1h |
| 3 | `agent.ts` 新增 orchestrate() — 决策树 | 2h |
| 4 | `agent.ts` 新增 executeByPlan() — 6 种模式 | 3h |
| 5 | 删除 message-processor/model-router/llm 中的重复代码 | 1h |
| 6 | `ws-handler.ts` 改造 handleUserMessage 接入 orchestrate() | 2h |
| 7 | AgentBridge 接口扩展 | 0.5h |
| 8 | 前端清理（删除 🎯 按钮） | 0.5h |
| 9 | 决策追踪 + DecisionRecorder 扩展 | 1h |
| 10 | 单测：orchestrate 各分支 | 2h |
| 11 | 集成测试：端到端验证 | 1h |
| **合计** | | **14.5h ≈ 2 天** |

---

## 十二、依赖关系

```
步骤 1 (类型) ──→ 步骤 2 (分析函数)
                     │
                     ├──→ 步骤 3 (orchestrate)
                     │       │
                     │       └──→ 步骤 4 (executeByPlan)
                     │               │
                     │               └──→ 步骤 6 (ws-handler 集成)
                     │
                     └──→ 步骤 5 (删除重复代码)

步骤 7 (AgentBridge) ──→ 步骤 6
步骤 8 (前端清理)     ──→ 步骤 6
步骤 9 (决策追踪)     ──→ 步骤 3
步骤 10 (单测)        ──→ 步骤 4
步骤 11 (集成测试)    ──→ 步骤 6
```

---

## 十三、风险控制

| 风险 | 控制措施 |
|------|---------|
| 决策误判 | reason 可追溯，决策日志持久化 |
| API 成本增加 | 本地优先、限制最多 3 专家、budget 模型级联 |
| 前端兼容 | handleMultiExpertParallel 保留 deprecated 路径 |
| 与已有组件冲突 | 不删除子系统接口，决策权上移但调用关系不变 |
| DAG 编排受影响 | assessComplexity 的逻辑完整保留到 agent.ts |
| 性能 | orchestrate() 是纯逻辑，无 LLM 调用，< 5ms |

---

## 十四、远期演进

| 阶段 | 内容 | 触发条件 |
|------|------|---------|
| v2.0 | 融合回复从拼接升级为 LLM 摘要 | parallel 模式使用频率 > 30% |
| v2.1 | Thompson Sampling 选择协作策略 | DecisionRecorder 积累 > 1000 条 |
| v2.2 | cascade 质量评估器从启发式升级为 LLM 评估 | cascade 模式误判率 > 20% |
| v3.0 | Router-R1 方向：决策引擎本身用 RL 训练 | 数据量充足 + 算力允许 |

---

## 十五、备注

- **不新建文件** — `orchestrate()` 和 `executeByPlan()` 是 `BuddyAgent` 的方法
- **不删除子系统接口** — ModelRouter/ModelPoolScheduler/ExpertPool 保留，被 agent.ts 调用
- **三进制本地专家不动** — 已通过 ModelRouter 自动参与路由
- **DAG 编排不动** — orchestrate() 的 `useDAG` 字段控制，逻辑和原来一致
- **handleMultiExpertParallel 保留** — deprecated 但不删除，等前端完全适配后再清
- **2 天完成** — 比 v1 方案（7.5 天）快 3.75 倍，因为复用已有组件而非新建
