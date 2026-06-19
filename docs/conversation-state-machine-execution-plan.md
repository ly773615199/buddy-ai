# 对话状态机改造 — 详细执行计划

> 日期: 2026-06-19
> 目标: 让状态机在三脑掌控下运行，executing 阶段真正分配资源

---

## 总览: 6 个文件，~200 行改动

```
改动文件                                    改动量    优先级
─────────────────────────────────────────────────────────────
src/core/conversation-state-machine.ts      +80行     P0
src/core/signal-collector.ts                +15行     P0
src/core/message-processor.ts               +10行     P1
src/core/plan-executor.ts                   +20行     P1
src/core/agent.ts                           +30行     P1
src/brain/brain.ts                          +25行     P2
src/core/subsystems.ts                      +5行      P2
─────────────────────────────────────────────────────────────
合计                                         ~185行
```

---

## Step 1: conversation-state-machine.ts — 状态机增强

**文件**: `src/core/conversation-state-machine.ts`
**改动量**: +80 行
**优先级**: P0

### 1.1 新增类型定义（文件顶部，第 12 行后）

```typescript
// ==================== 新增类型 ====================

/** 三脑信号 — 状态机接收的外部决策信号 */
export interface BrainSignal {
  /** 资源状态 */
  resourceStatus: 'sufficient' | 'degraded' | 'exhausted';
  /** 任务复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 三脑置信度 */
  confidence: number;
  /** 审议委员会建议 */
  deliberationAction?: 'proceed' | 'refine' | 'brainstorm' | 'concede';
}

/** 对话上下文 — 导出给三脑使用 */
export interface ConversationContext {
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

### 1.2 ConversationState 新增字段（第 25 行附近）

```typescript
export interface ConversationState {
  // ... 现有字段 ...
  
  // 新增:
  /** 执行重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 最近一次三脑信号 */
  lastBrainSignal: BrainSignal | null;
}
```

### 1.3 新增方法（第 102 行 `setPhase` 方法后）

```typescript
/**
 * 接收三脑信号 — 影响状态转换
 * 
 * 调用时机: orchestrate() 决策完成后
 * 调用方: agent.ts orchestrateWithThreeBrain()
 */
receiveBrainSignal(signal: BrainSignal): void {
  this.state.lastBrainSignal = signal;

  // 资源耗尽: executing → discussing
  if (signal.resourceStatus === 'exhausted' && this.state.phase === 'executing') {
    this.transitionTo('discussing', '资源耗尽，需要重新规划');
    return;
  }

  // 审议要求澄清: executing → confirming
  if (signal.deliberationAction === 'refine' && this.state.phase === 'executing') {
    this.transitionTo('confirming', '审议委员会要求重新确认方案');
    return;
  }

  // 置信度低: 延长讨论（不增加 questionsAsked）
  if (signal.confidence < 0.4 && this.state.phase === 'discussing') {
    this.state.maxQuestions = Math.min(this.state.maxQuestions + 1, 5);
  }
}

/**
 * 执行结果回调 — 驱动 executing → done 或 executing → discussing
 * 
 * 调用时机: PlanExecutor 执行完成（成功或失败）
 * 调用方: plan-executor.ts executeByPlan()
 */
onExecutionResult(success: boolean, detail?: string): void {
  if (this.state.phase !== 'executing') return;

  if (success) {
    this.transitionTo('done', '执行成功');
  } else {
    if (this.state.retryCount < this.state.maxRetries) {
      this.state.retryCount++;
      this.transitionTo('discussing', `执行失败(第${this.state.retryCount}次): ${detail ?? '未知原因'}，重新讨论方案`);
    } else {
      this.transitionTo('done', `执行失败，重试次数用尽: ${detail ?? '未知原因'}`);
    }
  }
}

/**
 * 超时检查 — executing 阶段超过 5 分钟自动回退
 * 
 * 调用时机: buildContext() 每次调用时
 * 调用方: message-processor.ts buildContext()
 */
checkTimeout(): void {
  if (this.state.phase !== 'executing') return;
  const EXECUTING_TIMEOUT_MS = 5 * 60 * 1000;
  if (Date.now() - this.state.phaseStartedAt > EXECUTING_TIMEOUT_MS) {
    this.onExecutionResult(false, '执行超时(5分钟)');
  }
}

/**
 * 导出对话上下文 — 供三脑决策使用
 * 
 * 调用时机: orchestrate() 决策前
 * 调用方: agent.ts orchestrate()
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
```

### 1.4 修改 createInitialState()（第 420 行附近）

```typescript
private createInitialState(): ConversationState {
  return {
    phase: 'idle',
    intent: '',
    requirements: {},
    confirmedPlan: null,
    questionsAsked: 0,
    maxQuestions: 2,
    phaseStartedAt: Date.now(),
    lastActiveAt: Date.now(),
    // 新增:
    retryCount: 0,
    maxRetries: 2,
    lastBrainSignal: null,
  };
}
```

### 1.5 修改 transitionTo() 重置逻辑（第 395 行附近）

```typescript
private transitionTo(phase: ConversationPhase, reason: string): PhaseTransition {
  // ... 现有逻辑 ...

  // 进入新阶段时重置计数器
  if (phase === 'discussing') {
    this.state.questionsAsked = 0;
  }
  if (phase === 'idle') {
    this.state = this.createInitialState();
  }
  // 新增: 进入 executing 时重置重试计数（由 onExecutionResult 递增）
  // 注意: 不在这里重置 retryCount，因为 retryCount 跨多次 executing

  return transition;
}
```

### 1.6 extractRequirements() 通用化（第 220 行附近）

```typescript
private extractRequirements(message: string): void {
  const lower = message.toLowerCase();

  // 通用需求模式（不再硬编码游戏相关）
  const patterns: Array<{ key: string; regex: RegExp }> = [
    { key: 'techStack', regex: /(?:typescript|javascript|python|java|go|rust|c\+\+|swift|kotlin|react|vue|angular|node|django|flask|spring|unity|unreal|godot|phaser)/i },
    { key: 'platform', regex: /(?:pc|mobile|web|网页|手机|主机|桌面|ios|android|windows|mac|linux)/i },
    { key: 'framework', regex: /(?:docker|kubernetes|nginx|redis|mysql|postgres|mongodb|elasticsearch)/i },
    { key: 'reference', regex: /(?:类似|参考|风格|像|模仿).*?([\u4e00-\u9fa5a-zA-Z0-9]+)/ },
    { key: 'scale', regex: /(?:小型|中型|大型|简单|复杂|完整|最小|MVP|原型)/ },
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

## Step 2: signal-collector.ts — 传递对话上下文

**文件**: `src/core/signal-collector.ts`
**改动量**: +15 行
**优先级**: P0

### 2.1 collectPerceptionState() 新增 ConversationContext（第 132 行附近）

```typescript
export function collectPerceptionState(
  sys: Subsystems,
  content: string,
  conversationSM?: ConversationStateMachine,
): PerceptionState {
  // ... 现有逻辑 ...

  // Step 5: 对话状态机提升（已有）
  if (conversationSM) {
    try {
      const smPhase = conversationSM.getPhase();
      const smState = conversationSM.getState();

      // 新增: 获取对话上下文供后续使用
      const smContext = conversationSM.getContextForBrain();

      // discussing + 执行意图 → reasoning（已有）
      if (smPhase === 'discussing' && smState.intent) {
        if (/做|开发|创建|写|建|搞|build|create|develop|make/i.test(smState.intent)) {
          taskType = 'reasoning';
        }
      }

      // confirming → reasoning（已有）
      if (smPhase === 'confirming') {
        taskType = 'reasoning';
      }

      // executing → tools（已有）
      if (smPhase === 'executing') {
        taskType = 'tools';
      }

      // 新增: 将对话上下文附加到返回值
      return {
        // ... 现有字段 ...
        intent: { /* ... */ },
        domains,
        complexity,
        taskType,
        shouldUseDAG,
        dagReason,
        intentConfidence: finalConfidence,
        embedding: intent.embedding,
        timestamp: Date.now(),
        computeMs: performance.now() - t0,
        // 新增:
        conversationContext: smContext,
      };
    } catch { /* 状态机错误不影响分类 */ }
  }

  // ... 现有返回 ...
}
```

### 2.2 PerceptionState 类型扩展（perception-state.ts）

```typescript
// src/core/perception-state.ts 新增字段
export interface PerceptionState {
  // ... 现有字段 ...
  
  /** 对话上下文（来自状态机） */
  conversationContext?: import('./conversation-state-machine.js').ConversationContext;
}
```

---

## Step 3: agent.ts — 传递对话上下文到三脑

**文件**: `src/core/agent.ts`
**改动量**: +30 行
**优先级**: P1

### 3.1 orchestrate() 获取对话上下文（第 631 行附近）

```typescript
async orchestrate(content: string, failureContext?: FailureAnalysis): Promise<OrchestrationPlan> {
  // Stage 1: 信号采集
  const signal = this.collectSignals(content);

  // Stage 1.5: 资源状态
  const resources = this.collectResourceState(content, signal);

  // 新增: 获取对话上下文
  const conversationContext = this.sys.conversationSM?.getContextForBrain() ?? null;

  // ... Gate-0 经验直达检查（不变） ...

  // 三脑决策路径
  if (threeBrain) {
    return this.orchestrateWithThreeBrain(
      content, signal, resources, threeBrain, 'threeBrain', failureContext,
      conversationContext,  // ← 新增参数
    );
  }

  // ... 旧决策路径（不变） ...
}
```

### 3.2 orchestrateWithThreeBrain() 接收并使用对话上下文（第 747 行附近）

```typescript
private async orchestrateWithThreeBrain(
  content: string,
  signal: TaskSignal,
  resources: ResourceState,
  threeBrain: import('../brain/brain.js').ThreeBrain,
  path: 'threeBrain' | 'legacy' = 'threeBrain',
  failureContext?: FailureAnalysis,
  conversationContext?: import('./conversation-state-machine.js').ConversationContext | null,  // ← 新增
): Promise<OrchestrationPlan> {
  const t0 = performance.now();

  // 注入用户消息到感知融合（不变）
  threeBrain.cerebellum.ingestPerception('user', content, signal.domains);

  // 三脑协作决策 — 传递对话上下文
  const decision = await threeBrain.decide(
    content, signal, resources, failureContext,
    conversationContext,  // ← 新增参数
  );

  // ... 决策追踪（不变） ...

  // 新增: 将三脑信号回传状态机
  if (this.sys.conversationSM && conversationContext) {
    this.sys.conversationSM.receiveBrainSignal({
      resourceStatus: resources.budgetRemaining <= 0 ? 'exhausted'
        : resources.budgetRemaining < 0.2 ? 'degraded'
        : 'sufficient',
      complexity: signal.complexity,
      confidence: decision.plan.confidence,
      deliberationAction: decision.deliberationResult?.action,
    });
  }

  // ... 审议结果处理（不变） ...
  // ... 持久化到 DecisionRecorder（不变） ...
  // ... 映射到模型层级提示（不变） ...
}
```

### 3.3 handleCLIMessage() 执行后回调状态机（第 388 行附近）

```typescript
// 在 handleCLIMessage() 中，执行完成后:
result = await this.processor.processStream(content, (chunk) => {
  process.stdout.write(chunk);
}, null);

// 新增: 执行结果回调状态机
if (this.sys.conversationSM) {
  const allSuccess = result.toolCalls.every(tc => !tc.result?.startsWith('['));
  this.sys.conversationSM.onExecutionResult(
    allSuccess,
    allSuccess ? undefined : '工具执行失败',
  );
}
```

---

## Step 4: message-processor.ts — 超时检查

**文件**: `src/core/message-processor.ts`
**改动量**: +10 行
**优先级**: P1

### 4.1 buildContext() 开头添加超时检查（第 269 行附近）

```typescript
async buildContext(content: string): Promise<{...}> {
  // 新增: 超时检查
  this.conversationSM.checkTimeout();

  // P0: 投机预执行（不变）
  this.speculativePrefetch(content).catch(...);

  // ... 现有逻辑 ...
}
```

### 4.2 buildContext() 中状态机处理后获取上下文（第 274 行附近）

```typescript
// ── 对话状态机（先处理，供 inferTaskType 使用）───
try {
  const smResult = this.conversationSM.processMessage(content);
  if (smResult.phasePrompt) {
    budget.add({
      id: 'conversation-phase',
      source: 'conversation-sm',
      priority: 82,
      content: smResult.phasePrompt,
      required: false,
    });
  }
  // 新增: 日志增强
  if (smResult.transition && this.verbose) {
    console.log(`  [ConvSM] ${smResult.transition.from} → ${smResult.transition.to}: ${smResult.transition.reason}`);
  }
  // 新增: executing 阶段注入资源检查提示
  if (smResult.state.phase === 'executing') {
    const ctx = this.conversationSM.getContextForBrain();
    if (ctx.retryCount > 0) {
      budget.add({
        id: 'retry-hint',
        source: 'conversation-sm',
        priority: 83,
        content: `\n⚠️ 这是第 ${ctx.retryCount} 次重试，之前失败了。请检查失败原因，调整方案。`,
        required: false,
      });
    }
  }
} catch (err) {
  if (this.verbose) console.warn('[ConvSM] 状态机错误:', (err as Error).message);
}
```

---

## Step 5: plan-executor.ts — 执行结果回调

**文件**: `src/core/plan-executor.ts`
**改动量**: +20 行
**优先级**: P1

### 5.1 executeByPlan() 包装执行结果（第 101 行附近）

```typescript
export async function executeByPlan(
  ctx: ExecutionContext,
  plan: OrchestrationPlan,
): Promise<ExecutionResult> {
  // ... 资源可行性检查（不变） ...

  // Phase 2: DAG 执行路径（不变）
  if (plan.useDAG && plan.resolvedDAG) {
    return executeDAG(ctx, plan);
  }

  // ... 经验路由（不变） ...

  // 新增: 包装执行，捕获结果回调状态机
  try {
    let result: ExecutionResult;

    // Phase 4: 能力协同调度（不变）
    if (ctx.scheduler && ctx.llmProfiler && ctx.generationCache) {
      // ... 现有逻辑 ...
    }

    switch (plan.mode) {
      case 'local_only': result = await executeLocal(ctx, plan); break;
      case 'single': result = await executeSingle(ctx, plan); break;
      case 'parallel': result = await executeParallel(ctx, plan); break;
      case 'cascade': result = await executeCascade(ctx, plan); break;
      case 'sequential': result = await executeSequential(ctx, plan); break;
      case 'debate': result = await executeDebate(ctx, plan); break;
      case 'deliberate': result = await executeSingle(ctx, plan); break;
      case 'clarify': result = { text: plan.reason, source: 'deliberation', toolCalls: [] }; break;
      case 'brainstorm': result = { text: plan.reason, source: 'deliberation', toolCalls: [] }; break;
      case 'direct': result = await executeDirect(ctx, plan); break;
      default: result = await executeSingle(ctx, plan);
    }

    // 新增: 执行成功回调状态机
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

---

## Step 6: brain.ts — 三脑接收对话阶段

**文件**: `src/brain/brain.ts`
**改动量**: +25 行
**优先级**: P2

### 6.1 decide() 方法签名扩展（第 212 行附近）

```typescript
async decide(
  input: string,
  signal: TaskSignal,
  resources: ResourceState,
  failureContext?: FailureAnalysis,
  conversationContext?: import('../core/conversation-state-machine.js').ConversationContext,  // ← 新增
): Promise<DecisionResult> {
  const t0 = performance.now();

  // Step 1: 小脑（不变）
  const bodyEvent: BodyEvent = { type: 'user_message', timestamp: Date.now(), data: { input } };
  const homeostasisActions = this.cerebellum.regulate(bodyEvent);
  const bodyState = this.cerebellum.getBodyState();

  // Step 2: 右脑（不变）
  let intuition: IntuitionSignal | undefined;
  try {
    const multimodal = this.buildMultimodalContext(input);
    intuition = await this.right.predict(input, signal, resources, bodyState, multimodal);
  } catch (err) {
    if (this.verbose) console.warn('[ThreeBrain] 右脑预测失败:', err);
  }

  // Step 2.5: 审议委员会 — 新增对话阶段影响
  const deliberationResult = await this.deliberation.deliberate(
    input, signal.domains, bodyState, intuition,
  );

  // 新增: 对话阶段覆盖审议结果
  if (conversationContext) {
    // discussing 阶段: 审议不能直接 proceed（还在收集需求）
    if (conversationContext.phase === 'discussing' &&
        deliberationResult.action === 'proceed' &&
        conversationContext.questionsAsked < conversationContext.maxQuestions) {
      // 不强制覆盖，但降低置信度，让左脑更保守
      if (this.verbose) {
        console.log(`[ThreeBrain] 讨论阶段: 审议 proceed 但仍在收集需求 (${conversationContext.questionsAsked}/${conversationContext.maxQuestions})`);
      }
    }

    // confirming 阶段: 审议不能 refine（用户已确认方案）
    if (conversationContext.phase === 'confirming' &&
        deliberationResult.action === 'refine') {
      deliberationResult.action = 'proceed';
      deliberationResult.reasoning = '对话阶段: 用户已确认方案，跳过审议';
      if (this.verbose) {
        console.log(`[ThreeBrain] 确认阶段: 覆盖审议 refine → proceed`);
      }
    }

    // executing 阶段: 检查资源状态
    if (conversationContext.phase === 'executing' &&
        conversationContext.retryCount > 0) {
      // 重试时: 降低置信度阈值，更倾向于降级
      if (this.verbose) {
        console.log(`[ThreeBrain] 执行重试第 ${conversationContext.retryCount} 次: 更保守的决策`);
      }
    }
  }

  // Step 3: 左脑（不变）
  const lawResult = this.lawClassifier.classify(signal, resources, this.left.getRuleEngine());
  // ... 现有逻辑 ...
}
```

---

## Step 7: subsystems.ts — 确保状态机初始化

**文件**: `src/core/subsystems.ts`
**改动量**: +5 行（确认已有，无需改动）

当前代码已在第 275 行初始化:
```typescript
this.conversationSM = new ConversationStateMachine();
```

无需修改。

---

## 实施顺序

```
Day 1: Step 1 (conversation-state-machine.ts)
  - 新增类型定义
  - 新增 receiveBrainSignal / onExecutionResult / checkTimeout / getContextForBrain
  - extractRequirements 通用化
  - createInitialState 新增字段
  - 本地单元测试验证

Day 2: Step 2 (signal-collector.ts) + Step 4 (message-processor.ts)
  - collectPerceptionState 返回 conversationContext
  - buildContext 调用 checkTimeout
  - executing 阶段注入重试提示
  - 集成测试: "我想做一款游戏" 全链路

Day 3: Step 3 (agent.ts) + Step 5 (plan-executor.ts)
  - orchestrate 传递对话上下文
  - orchestrateWithThreeBrain 回传三脑信号
  - executeByPlan 回调状态机
  - 集成测试: 执行成功→done，执行失败→discussing

Day 4: Step 6 (brain.ts)
  - decide 接收 conversationContext
  - discussing 阶段: 审议不能直接 proceed
  - confirming 阶段: 审议不能 refine
  - 全链路测试

Day 5: 回归测试 + 边界测试
  - 现有 107 个测试全部通过
  - 边界: 资源耗尽/执行超时/审议否决/重试耗尽
  - 日志验证: 三脑信号回传正确
```

---

## 验收标准（逐条可测）

| # | 测试场景 | 预期行为 | 验证方式 |
|---|---------|---------|---------|
| 1 | "我想做一款游戏" | discussing，最多问 2 个问题 | 日志 `[ConvSM] idle → discussing` |
| 2 | "roguelike 卡牌，TypeScript" | confirming，输出方案 | 日志 `[ConvSM] discussing → confirming` |
| 3 | "好，开始吧" | executing，三脑分配资源 | 日志 `[ConvSM] confirming → executing` |
| 4 | 执行成功 | 自动转 done | 日志 `[ConvSM] executing → done: 执行成功` |
| 5 | 执行失败 | 自动转 discussing（可重试） | 日志 `[ConvSM] executing → discussing: 执行失败` |
| 6 | 重试 2 次仍失败 | 自动转 done | 日志 `[ConvSM] executing → done: 重试次数用尽` |
| 7 | 资源耗尽 | executing 强制回退 discussing | 日志 `[ConvSM] executing → discussing: 资源耗尽` |
| 8 | 5 分钟超时 | executing 强制回退 discussing | 日志 `[ConvSM] executing → discussing: 执行超时` |
| 9 | 审议 refine | executing 回退 confirming | 日志 `[ConvSM] executing → confirming: 审议要求重新确认` |
| 10 | discussing + 低置信度 | 延长讨论（maxQuestions+1） | 日志 `[ConvSM] maxQuestions 2→3` |
| 11 | confirming + 审议 refine | 审议被覆盖为 proceed | 日志 `[ThreeBrain] 确认阶段: 覆盖审议` |
| 12 | 现有 107 个测试 | 全部通过 | `npm test` |
