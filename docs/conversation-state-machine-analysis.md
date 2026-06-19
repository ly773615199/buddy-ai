# 对话状态机 × 三脑架构 — 深度分析与改造方案

> 日期: 2026-06-19
> 基于: 全量代码审计（conversation-state-machine.ts / message-processor.ts / signal-collector.ts / agent.ts / brain.ts / plan-executor.ts / orchestrator.ts / ws-handler.ts）

---

## 一、现状分析

### 1.1 状态机实现概况

**文件**: `src/core/conversation-state-machine.ts`（443 行）

```
状态流转: idle → discussing → confirming → executing → done
```

| 状态 | 触发条件 | 当前行为 | 注入 Prompt |
|------|---------|---------|------------|
| `idle` | 初始/超时10分钟 | 无 | 无 |
| `discussing` | `hasExecutionIntent()` 正则匹配 | questionsAsked++ | "还可以问N个关键问题" |
| `confirming` | `hasSpecificDetails()` ≥2个细节 或 questionsAsked ≥ maxQuestions | 无 | "输出方案摘要，等确认" |
| `executing` | `isConfirmation()` 或 `isDirectExecution()` | 无 | "直接调用工具，不要问问题" |
| `done` | 无自动触发（需外部 setPhase） | 无 | 空字符串 |

### 1.2 状态机在系统中的位置

```
用户消息
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  ConversationStateMachine                                    │
│  - 独立模块，纯正则匹配                                       │
│  - 无外部依赖（不感知三脑、资源、工具）                         │
│  - 输出: phasePrompt + phase                                  │
└──────────────┬───────────────────────────────────────────────┘
               │ 注入两个位置:
               │
               ├─① MessageProcessor.buildContext() ──→ Prompt 预算 (priority=82)
               │   位置: message-processor.ts:274
               │   作用: 告诉 LLM 当前阶段
               │
               └─② SignalCollector.collectPerceptionState() ──→ taskType 提升
                   位置: signal-collector.ts:175
                   作用: discussing→reasoning, confirming→reasoning, executing→tools
```

### 1.3 三脑决策链路

```
orchestrate(content)
    │
    ├─ Stage 1: collectSignals(content, conversationSM)
    │   └─ collectPerceptionState()
    │       ├─ 右脑 classifyFromText() → intent
    │       ├─ IntentClassifier 细粒度补充
    │       └─ conversationSM.getPhase() → taskType 提升 ← 状态机在此有影响
    │
    ├─ Stage 1.5: collectResourceState()
    │   └─ ResourceHub / 经验路由
    │
    ├─ Gate-0: 经验直达检查
    │
    └─ Stage 2: ThreeBrain.decide()
        ├─ 小脑: regulate() → BodyState + HomeostasisAction[]
        ├─ 右脑: predict() → IntuitionSignal
        ├─ 审议委员会: deliberate() → proceed/refine/brainstorm/concede
        ├─ 法则分类: classify() → Law 1-6
        └─ 左脑: decide() → ExecutionPlan { mode, selectedNodes }
             │
             ▼
        executeByPlan(plan)
            ├─ 资源可行性检查 (ResourceHub)
            ├─ CapabilityScheduler.allocate() → 五维能力组合
            ├─ 7种执行模式: local_only/single/parallel/cascade/sequential/debate/direct
            └─ recordResourceOutcome() → 资源反馈
```

---

## 二、核心问题：状态机与三脑的断层

### 2.1 问题一：状态机是"盲"的

状态机只看正则匹配，不感知：

| 维度 | 状态机能看到 | 三脑能看到 | 差距 |
|------|------------|-----------|------|
| 用户意图 | 正则 `做.*游戏` | 右脑 NN 分类 + 原型匹配 + 细粒度意图 | 状态机远弱于三脑 |
| 资源状态 | ❌ 完全不感知 | ResourceHub 全局资源画像 | 状态机盲目进入 executing |
| 任务复杂度 | ❌ 不评估 | signal.complexity + DAG 检测 | 状态机不区分简单/复杂 |
| 情绪/精力 | ❌ 不感知 | 小脑 BodyState (energy/temperature/focus) | 状态机不考虑用户状态 |
| 执行结果 | ❌ 不感知 | feedback() 闭环 | 状态机卡在 executing 不回退 |

### 2.2 问题二：executing 阶段的资源分配是"空"的

当前 executing 阶段：
1. 状态机生成 Prompt: "直接调用工具，不要问问题"
2. 但 **不检查资源是否足够**
3. **不根据任务复杂度分配资源**
4. **不感知执行结果**（成功→done 需要外部手动 setPhase）

真正的资源分配发生在 `orchestrate()` → `ThreeBrain.decide()` → `PlanExecutor.executeByPlan()`，但状态机对这个过程 **没有任何控制权**。

### 2.3 问题三：状态机与三脑可能冲突

| 场景 | 状态机认为 | 三脑认为 | 结果 |
|------|-----------|---------|------|
| "我想做一款游戏" | discussing（正则命中） | clarify（审议委员会判定需要追问） | 两者都注入 Prompt，可能重复 |
| "好，开始吧" | executing（确认词命中） | single（法则3：本地覆盖） | 状态机说"调用工具"，三脑选了单模型 |
| 资源不足时 | 仍然在 executing | local_only（预算耗尽降级） | 状态机不知道已降级 |
| 执行失败 | 卡在 executing | redecide（重新决策） | 状态机不回退 |

### 2.4 问题四：done 状态没有触发机制

`executing → done` 的转换 **没有实现**。当前代码中 `computeNextPhase()` 的 `executing` 分支：

```typescript
case 'executing':
  // 执行中 → 保持（等待工具执行完成）
  return 'executing';  // ← 永远卡在这里
```

没有监听执行结果，没有超时，没有完成信号。

### 2.5 问题五：需求提取硬编码

`extractRequirements()` 硬编码了游戏相关关键词：

```typescript
const gameTypes = ['roguelike', 'rpg', 'fps', 'moba', '卡牌', '策略', ...];
const techStacks = ['typescript', 'javascript', 'python', 'unity', ...];
const refs = ['杀戮尖塔', '哈迪斯', '以撒的结合', ...];
```

这对非游戏任务完全无用。

---

## 三、改造方案

### 3.1 设计原则

1. **状态机是三脑的"前台"** — 不重复三脑的决策，只管理对话节奏
2. **三脑可以否决状态机** — 资源不足/审议否决时，三脑可以 force 回退
3. **执行结果驱动状态转换** — 成功→done，失败→discussing（重试）
4. **状态机提供上下文给三脑** — 当前阶段、已收集需求、提问次数

### 3.2 改造后的信号流

```
用户消息
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  ConversationStateMachine                                    │
│  输入: 用户消息 + 三脑信号（可选）                              │
│  输出: phase + phasePrompt + transition                       │
│                                                              │
│  新增:                                                       │
│  - receiveBrainSignal(signal) — 接收三脑反馈                  │
│  - onExecutionResult(success, detail) — 执行结果驱动转换      │
│  - canTransitionTo(phase) — 三脑否决检查                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ThreeBrain.decide()                                         │
│  输入: content + signal + resources + conversationPhase       │
│  新增: conversationPhase 影响决策                              │
│                                                              │
│  discussing → 审议委员会可以 refine/ask_user                  │
│  confirming → 左脑输出方案摘要节点                              │
│  executing  → 左脑分配资源 + 检查能力覆盖                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  PlanExecutor.executeByPlan()                                │
│  新增: 执行结果回调到状态机                                    │
│                                                              │
│  成功 → conversationSM.onExecutionResult(true)               │
│  失败 → conversationSM.onExecutionResult(false, reason)      │
│  超时 → conversationSM.onExecutionResult(false, 'timeout')   │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 具体改造点

#### 改造点 1: 状态机接收三脑信号

```typescript
// conversation-state-machine.ts 新增

interface BrainSignal {
  /** 三脑判定的资源状态 */
  resourceStatus: 'sufficient' | 'degraded' | 'exhausted';
  /** 三脑判定的任务复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 三脑判定的意图分类 */
  intentCategory: string;
  /** 三脑置信度 */
  confidence: number;
  /** 审议委员会建议 */
  deliberationAction?: 'proceed' | 'refine' | 'brainstorm' | 'concede';
}

/**
 * 接收三脑信号，影响状态转换
 * 
 * 核心逻辑：
 * - 资源耗尽时，executing → discussing（降级讨论）
 * - 审议委员会 refine 时，executing → confirming（重新确认）
 * - 置信度低时，discussing 延长讨论（不急着进 confirming）
 */
receiveBrainSignal(signal: BrainSignal): void {
  // 资源耗尽：强制回退到 discussing
  if (signal.resourceStatus === 'exhausted' && this.state.phase === 'executing') {
    this.transitionTo('discussing', '资源耗尽，需要重新规划');
    return;
  }
  
  // 审议委员会要求澄清：回到 confirming
  if (signal.deliberationAction === 'refine' && this.state.phase === 'executing') {
    this.transitionTo('confirming', '审议委员会要求重新确认');
    return;
  }
  
  // 置信度低：延长讨论（不增加 questionsAsked）
  if (signal.confidence < 0.4 && this.state.phase === 'discussing') {
    this.state.maxQuestions = Math.min(this.state.maxQuestions + 1, 5);
  }
}
```

#### 改造点 2: 执行结果驱动状态转换

```typescript
// conversation-state-machine.ts 新增

/**
 * 执行结果回调 — 驱动 executing → done 或 executing → discussing
 * 
 * 由 PlanExecutor 在执行完成后调用
 */
onExecutionResult(success: boolean, detail?: string): void {
  if (this.state.phase !== 'executing') return;
  
  if (success) {
    this.transitionTo('done', '执行成功');
  } else {
    // 失败：检查是否应该重试
    if (this.state.retryCount < this.state.maxRetries) {
      this.state.retryCount++;
      this.transitionTo('discussing', `执行失败 (${detail})，重新讨论方案`);
    } else {
      // 重试次数用尽
      this.transitionTo('done', `执行失败，重试次数用尽 (${detail})`);
    }
  }
}

/**
 * 超时检查 — executing 阶段超过 N 分钟自动回退
 */
checkTimeout(): void {
  if (this.state.phase !== 'executing') return;
  
  const EXECUTING_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
  if (Date.now() - this.state.phaseStartedAt > EXECUTING_TIMEOUT_MS) {
    this.onExecutionResult(false, '执行超时');
  }
}
```

#### 改造点 3: 状态机提供上下文给三脑

```typescript
// conversation-state-machine.ts 新增

/**
 * 导出对话上下文 — 供三脑决策使用
 */
getContextForBrain(): ConversationContext {
  return {
    phase: this.state.phase,
    intent: this.state.intent,
    requirements: { ...this.state.requirements },
    questionsAsked: this.state.questionsAsked,
    maxQuestions: this.state.maxQuestions,
    timeInPhase: Date.now() - this.state.phaseStartedAt,
    totalTransitions: this.transitions.length,
    retryCount: this.state.retryCount,
  };
}

interface ConversationContext {
  phase: ConversationPhase;
  intent: string;
  requirements: Record<string, string>;
  questionsAsked: number;
  maxQuestions: number;
  timeInPhase: number;
  totalTransitions: number;
  retryCount: number;
}
```

#### 改造点 4: ThreeBrain.decide() 接收对话阶段

```typescript
// brain.ts decide() 方法修改

async decide(
  input: string,
  signal: TaskSignal,
  resources: ResourceState,
  failureContext?: FailureAnalysis,
  conversationContext?: ConversationContext,  // ← 新增参数
): Promise<DecisionResult> {
  // Step 1: 小脑 — 感知融合
  // ... 不变 ...
  
  // Step 2: 右脑 — 直觉预测
  // ... 不变 ...
  
  // Step 2.5: 审议委员会 — 结构化审议
  // 新增: 对话阶段影响审议结果
  const deliberationResult = await this.deliberation.deliberate(
    input, signal.domains, bodyState, intuition,
  );
  
  // 新增: 对话阶段覆盖审议结果
  if (conversationContext) {
    // discussing 阶段: 审议不能直接 proceed（需要先收集需求）
    if (conversationContext.phase === 'discussing' && 
        deliberationResult.action === 'proceed' &&
        conversationContext.questionsAsked < conversationContext.maxQuestions) {
      // 审议说 proceed，但还在讨论阶段 → 继续讨论
      deliberationResult.action = 'refine';
      deliberationResult.reasoning = '对话阶段: 仍在讨论中，继续收集需求';
    }
    
    // confirming 阶段: 审议不能 refine（用户已确认）
    if (conversationContext.phase === 'confirming' && 
        deliberationResult.action === 'refine') {
      // 用户已确认，审议不能否决
      deliberationResult.action = 'proceed';
    }
    
    // executing 阶段: 检查资源状态
    if (conversationContext.phase === 'executing') {
      if (resources.budgetRemaining <= 0) {
        // 资源耗尽 → 强制降级
        plan = {
          mode: 'local_only',
          reason: '资源耗尽，降级到本地执行',
          selectedNodes: [],
          confidence: 0.5,
          source: 'conversation-sm',
        };
      }
    }
  }
  
  // Step 3: 左脑 — 法则系统 + 规则 + 调度
  // ... 不变 ...
}
```

#### 改造点 5: PlanExecutor 回调状态机

```typescript
// plan-executor.ts 修改

export async function executeByPlan(
  ctx: ExecutionContext,
  plan: OrchestrationPlan,
): Promise<ExecutionResult> {
  // ... 现有逻辑 ...
  
  try {
    const result = await executeInner(ctx, plan);
    
    // 新增: 执行结果回调状态机
    if (ctx.sys.conversationSM) {
      ctx.sys.conversationSM.onExecutionResult(true);
    }
    
    return result;
  } catch (err) {
    // 新增: 执行失败回调状态机
    if (ctx.sys.conversationSM) {
      ctx.sys.conversationSM.onExecutionResult(false, (err as Error).message);
    }
    
    throw err;
  }
}
```

#### 改造点 6: orchestrate() 传递对话阶段

```typescript
// agent.ts orchestrate() 方法修改

async orchestrate(content: string, failureContext?: FailureAnalysis): Promise<OrchestrationPlan> {
  // Stage 1: 信号采集
  const signal = this.collectSignals(content);
  
  // Stage 1.5: 资源状态
  const resources = this.collectResourceState(content, signal);
  
  // 新增: 获取对话上下文
  const conversationContext = this.sys.conversationSM?.getContextForBrain();
  
  // ... Gate-0 经验直达检查 ...
  
  // 三脑决策路径
  if (threeBrain) {
    return this.orchestrateWithThreeBrain(
      content, signal, resources, threeBrain, 'threeBrain', failureContext,
      conversationContext,  // ← 新增参数
    );
  }
  
  // ... 旧决策路径 ...
}
```

#### 改造点 7: 需求提取通用化

```typescript
// conversation-state-machine.ts extractRequirements() 改造

private extractRequirements(message: string): void {
  const lower = message.toLowerCase();

  // 通用需求模式（不再硬编码游戏相关）
  const patterns: Array<{ key: string; regex: RegExp }> = [
    // 技术栈
    { key: 'techStack', regex: /(?:typescript|javascript|python|java|go|rust|c\+\+|swift|kotlin|react|vue|angular|node|django|flask|spring|unity|unreal|godot|phaser)/i },
    // 平台
    { key: 'platform', regex: /(?:pc|mobile|web|网页|手机|主机|桌面|ios|android|windows|mac|linux)/i },
    // 框架/工具
    { key: 'framework', regex: /(?:docker|kubernetes|nginx|redis|mysql|postgres|mongodb|elasticsearch)/i },
    // 参考/风格
    { key: 'reference', regex: /(?:类似|参考|风格|像|模仿|参考).*?([\u4e00-\u9fa5a-zA-Z0-9]+)/ },
    // 数量/规模
    { key: 'scale', regex: /(?:小型|中型|大型|简单|复杂|完整|最小|MVP|原型)/ },
    // 时间要求
    { key: 'timeline', regex: /(?:尽快|今天|这周|这个月|不急|慢慢来)/ },
  ];

  for (const { key, regex } of patterns) {
    const match = lower.match(regex);
    if (match) {
      this.state.requirements[key] = match[1] ?? match[0];
    }
  }
}
```

---

## 四、改造后的状态转换规则

### 4.1 完整状态转换表

| 当前状态 | 触发条件 | 目标状态 | 谁决定 | 注入 Prompt |
|---------|---------|---------|--------|------------|
| `idle` | `hasExecutionIntent()` | `discussing` | 状态机 | "问关键问题" |
| `idle` | 超时10分钟 | `idle` | 状态机 | 无 |
| `discussing` | `hasSpecificDetails() ≥2` | `confirming` | 状态机 | "输出方案摘要" |
| `discussing` | `questionsAsked ≥ maxQuestions` | `confirming` | 状态机 | "输出方案摘要" |
| `discussing` | `isDirectExecution()` | `executing` | 状态机 | "直接执行" |
| `discussing` | 三脑 confidence < 0.4 | `discussing` | 三脑 | 延长讨论 |
| `confirming` | `isConfirmation()` | `executing` | 状态机 | "分配资源执行" |
| `confirming` | `hasModification()` | `discussing` | 状态机 | "重新讨论" |
| `confirming` | 审议 refine | `discussing` | 三脑 | "重新讨论" |
| `executing` | 执行成功 | `done` | 执行结果 | 无 |
| `executing` | 执行失败 + 可重试 | `discussing` | 执行结果 | "重新规划" |
| `executing` | 执行失败 + 重试耗尽 | `done` | 执行结果 | "任务失败" |
| `executing` | 资源耗尽 | `discussing` | 三脑 | "资源不足，重新规划" |
| `executing` | 超时5分钟 | `discussing` | 状态机 | "执行超时" |
| `executing` | 审议 refine | `confirming` | 三脑 | "重新确认" |
| `done` | `hasExecutionIntent()` | `discussing` | 状态机 | "新任务" |
| `done` | 任意消息 | `idle` | 状态机 | 无 |

### 4.2 谁有最终决定权

```
优先级: 执行结果 > 三脑信号 > 状态机正则

执行结果回调 (最高优先级):
  - success=true  → 强制 done
  - success=false → 强制 discussing（可重试）或 done（不可重试）

三脑信号 (中优先级):
  - resourceStatus=exhausted → 强制 discussing
  - deliberationAction=refine → 强制 discussing
  - confidence < 0.4 → 延长 discussing（不强制转换）

状态机正则 (低优先级):
  - hasExecutionIntent() → discussing
  - isConfirmation() → executing
  - isDirectExecution() → executing
```

---

## 五、改造实施计划

### Phase 6.1: 状态机增强（Day 1-2）

- [ ] 新增 `ConversationContext` 接口
- [ ] 新增 `BrainSignal` 接口
- [ ] 实现 `receiveBrainSignal()` 方法
- [ ] 实现 `onExecutionResult()` 方法
- [ ] 实现 `checkTimeout()` 方法
- [ ] 实现 `getContextForBrain()` 方法
- [ ] 新增 `retryCount` / `maxRetries` 字段
- [ ] `extractRequirements()` 通用化

### Phase 6.2: 三脑集成（Day 3-4）

- [ ] `ThreeBrain.decide()` 接收 `conversationContext` 参数
- [ ] 讨论阶段: 审议不能直接 proceed
- [ ] 确认阶段: 审议不能 refine
- [ ] 执行阶段: 资源检查 + 降级逻辑
- [ ] `orchestrate()` 传递对话上下文

### Phase 6.3: 执行闭环（Day 5-6）

- [ ] `PlanExecutor.executeByPlan()` 回调状态机
- [ ] 成功 → `onExecutionResult(true)`
- [ ] 失败 → `onExecutionResult(false, reason)`
- [ ] 超时检测集成

### Phase 6.4: 测试验收（Day 7）

- [ ] 单元测试: 状态转换全覆盖
- [ ] 集成测试: "我想做一款游戏" 全链路
- [ ] 边界测试: 资源耗尽/执行超时/审议否决
- [ ] 回归测试: 现有 107 个测试全部通过

---

## 六、验收标准

- [ ] "我想做一款游戏" → discussing，最多问 2 个问题
- [ ] "roguelike 卡牌，TypeScript" → confirming，输出方案
- [ ] "好，开始吧" → executing，三脑分配资源
- [ ] 执行成功 → 自动转 done
- [ ] 执行失败 → 自动转 discussing（可重试）
- [ ] 资源耗尽 → executing 强制回退 discussing
- [ ] 5 分钟超时 → executing 强制回退 discussing
- [ ] 审议 refine → executing 回退到 confirming
- [ ] 状态机不与三脑冲突（优先级机制）
- [ ] 现有 107 个测试全部通过
