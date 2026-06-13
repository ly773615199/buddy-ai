# 多专家并行执行计划

**日期**: 2026-04-27
**状态**: 待执行
**目标**: 将 Buddy 从"单流串行处理"升级为"多专家并行 + 多源记忆融合"

---

## 一、核心问题

### 架构现状

Buddy 的整个架构基于一个隐含假设：**同一时间只有一个 LLM 在处理一条消息**。

```
当前架构（单流模型）:

  用户消息 → isProcessing 锁 → 单个 LLM 调用 → 单个结果 → 单次记忆写入
```

这个假设渗透到每一个组件：
- `ws-handler.ts`: isProcessing 布尔锁，一次只放一条消息
- `llm.ts`: 当前设计不支持并发 LLM 调用
- `memory/store.ts`: 单流写入，无多源融合能力
- `emotion/engine.ts`: 全局单例，无多源状态合并
- `provider-limiter.ts`: 非原子计数，并发下不准

### 根因

**不是"单线程假设崩塌"，而是"架构缺乏多对多融合能力"。**

人脑的记忆天然是多对多的：视觉、听觉、对话、阅读等多个来源同时写入，不需要加锁，因为：
- 不同来源的信息自然形成关联
- 矛盾信息会被标记而非覆盖
- 重要性由内容决定，不由来源顺序决定

Buddy 的记忆系统是单流模型——一条消息进来，一个 LLM 处理，一个结果写入记忆。它没有设计过多源并发写入、多流融合的能力。

### 解决方向

**不是加锁串行化，而是改造为多对多融合模型。**

```
目标架构（多流融合模型）:

  Expert A (代码分析) ──┐
  Expert B (架构建议) ──┼──► FusionBuffer ──► 融合引擎 ──► STMP
  Expert C (测试设计) ──┘
                         │
                         ▼
                   关联检测
                   矛盾标记
                   重要性加权
                   时间线排序
```

---

## 二、集成审计

### 完全未接入（代码写了，主流程零调用）

| 组件 | 文件 | 功能 | 影响 |
|------|------|------|------|
| ExecutionSession | src/core/execution-session.ts | 任务生命周期 + 自主等级 + 检查点 | 🔴 核心能力缺失 |
| ToolSynthesizer | src/core/tool-synthesizer.ts | 经验→工具自动生成 | 🟡 Sprint 3 交付物 |
| ExperienceScheduler | src/skills/scheduler.ts | 经验调度 | 🟡 能力浪费 |
| WorkflowManager | src/orchestrate/workflow-manager.ts | DAG 工作流持久化 | 🟡 已有 DAG 但没持久化 |
| PDFParser | src/knowledge/pdf-parser.ts | PDF 文本提取 | 🟡 知识库能力缺失 |
| BuddyLearn | src/knowledge/learn.ts | 知识学习 | 🟡 能力浪费 |
| FeedbackLearner | src/feedback/learner.ts | 反馈学习 | 🟡 能力浪费 |
| KnowledgeExport | src/intelligence/knowledge-export.ts | 知识导出 | 🟢 低优先级 |

### 仅暴露 Getter，未主动调用

| 组件 | agent.ts 中的 getter | 是否被外部调用 |
|------|---------------------|--------------|
| experienceEvaluator | getExperienceEvaluator() | ❌ 无人调用 |
| skillExporter | getSkillExporter() | ❌ 无人调用 |
| skillVersionManager | getSkillVersionManager() | ❌ 无人调用 |
| qualityRadar | getQualityRadar() | ❌ 无人调用 |
| dataAugmentor | getDataAugmentor() | ❌ 无人调用 |
| loraService | getLoRAService() | ❌ 无人调用 |

### 已接入但集成不完整

| 组件 | 当前集成 | 缺失部分 |
|------|---------|---------|
| ClarificationEngine | message-processor 中检测模糊写操作 | 未检测目标冲突、资源不足、理解偏差 |
| KnowledgeInterviewer | message-processor 中提问 | 未接入主对话循环的主动提问 |
| ModelPoolScheduler | llm.ts 中选模型 | 未反馈调度结果给前端 |
| DAGPlanner | ws-handler 的 orchestrate | 未与 ExecutionSession 联动 |
| TaskExecutor | ws-handler 的 orchestrate | 工具并行 OK，但 LLM 调用仍串行 |

---

## 三、风险分析

| 风险 | 直接原因 | 根本原因 | 解决方向 |
|------|---------|---------|---------|
| 限流计数不准 | 非原子读写 | 并发访问共享可变状态 | 原子操作 |
| 情绪广播混乱 | 全局单例状态 | 缺乏多源状态融合 | 情绪融合引擎 |
| 记忆写入冲突 | 无事务隔离 | 缺乏多对多融合能力 | FusionBuffer |
| API 成本翻倍 | 多次 LLM 调用 | 架构变更的必然代价 | Early termination + 预算控制 |

---

## 四、实施计划

### Phase 1：TaskQueue 替换 isProcessing（3 天）

**目标**: 支持并发任务管理，不再拒绝新消息

**改动文件**: src/core/task-queue.ts（新增）、src/core/ws-handler.ts（修改）

```typescript
// src/core/task-queue.ts
export class TaskQueue {
  private running = new Map<string, TaskSlot>();
  private pending: Array<{ id: string; resolve: () => void; priority: number }> = [];
  private readonly maxConcurrent: number;
  private readonly maxWaitMs: number;

  constructor(maxConcurrent = 3, maxWaitMs = 60000) {
    this.maxConcurrent = maxConcurrent;
    this.maxWaitMs = maxWaitMs;
  }

  async acquire(id: string, priority = 0): Promise<void> {
    if (this.running.size < this.maxConcurrent) {
      this.running.set(id, { id, priority, status: 'running', startedAt: Date.now() });
      return;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter(p => p.id !== id);
        reject(new Error('TaskQueue 等待超时'));
      }, this.maxWaitMs);
      this.pending.push({ id, resolve: () => { clearTimeout(timer); resolve(); }, priority });
      this.pending.sort((a, b) => b.priority - a.priority);
    });
  }

  release(id: string): void {
    this.running.delete(id);
    const next = this.pending.shift();
    if (next) {
      this.running.set(next.id, { id: next.id, priority: next.priority, status: 'running', startedAt: Date.now() });
      next.resolve();
    }
  }

  canAccept(): boolean { return this.running.size < this.maxConcurrent; }
  getRunning(): TaskSlot[] { return [...this.running.values()]; }
}
```

**ProviderLimiter 并发安全修复**:

```typescript
// provider-limiter.ts — 使用原子操作
record(provider: string, model: string, tokens: number): void {
  const key = `${provider}/${model}`;
  const window = this.getOrCreateWindow(key);
  Atomics.add(window.countRef, 0, 1);
  Atomics.add(window.tokensRef, 0, tokens);
}
```

**验收**:
- [ ] 3 条消息可以同时在 pipeline 中
- [ ] 超过并发上限时排队而非拒绝
- [ ] 每条消息有独立 taskId
- [ ] ProviderLimiter 并发计数准确

---

### Phase 2：ExecutionSession 接入主流程（3 天）

**目标**: 任务有完整生命周期管理，支持暂停/取消/检查点

**改动文件**: src/core/ws-handler.ts（修改）、src/core/message-processor.ts（修改）

```typescript
// ws-handler.ts — handleUserMessage 改造
async handleUserMessage(content: string, msgId?: string): Promise<void> {
  const taskId = msgId ?? `msg-${Date.now()}`;

  try {
    await this.taskQueue.acquire(taskId);
  } catch {
    this.eventBus?.emit({ type: 'error', message: '系统繁忙，请稍后重试' });
    return;
  }

  const session = this.sys.createExecutionSession(content, {
    maxRetries: 2, maxSteps: 20, checkpointInterval: 5,
  });
  session.start();

  try {
    const step = session.addStep('llm_call', { content });

    if (session.shouldPauseForConfirmation('llm_call', { content })) {
      this.eventBus?.emit({ type: 'confirm_required', question: `确认执行: ${content.slice(0, 50)}?` });
    }

    const result = await this.processor.processBatch(content, this.eventBus);
    session.completeStep(step.id, result.text, true);
    session.complete();
  } catch (err) {
    session.fail((err as Error).message);
    this.eventBus?.emit({ type: 'error', message: getFallbackReply(this.config.personality) });
  } finally {
    this.taskQueue.release(taskId);
    this.sys.clearSession();
  }
}
```

**验收**:
- [ ] 每条消息有对应的 ExecutionSession
- [ ] 步骤自动记录（addStep/completeStep）
- [ ] 高风险操作自动暂停确认（L0/L1 自主等级）
- [ ] 超时自动释放

---

### Phase 3：FusionBuffer 多源记忆融合（5 天）

**目标**: 记忆系统支持多对多并发写入，自动融合

**改动文件**: src/core/fusion-buffer.ts（新增）、src/core/ws-handler.ts（修改）、src/memory/stmp.ts（修改）

```typescript
// src/core/fusion-buffer.ts
export interface FusionEntry {
  source: string;           // 来源标识（expert-arch, expert-code, user...）
  content: string;
  concepts: string[];
  timestamp: number;
  confidence: number;
  relations: Array<{ target: string; type: 'supports' | 'contradicts' | 'extends' }>;
  emotional?: { valence: number; importance: number };
}

export interface FusionResult {
  merged: number;
  contradictions: number;
  associations: number;
  durationMs: number;
}

export class FusionBuffer {
  private entries: FusionEntry[] = [];
  private readonly windowMs: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private stmp: STMPStore,
    private cognitive: CognitiveEngine,
    windowMs = 30000,
  ) {
    this.windowMs = windowMs;
  }

  // 多源并发写入 — 无需加锁，entries.push 是原子的
  ingest(entry: FusionEntry): void {
    this.entries.push(entry);
    this.detectRelations(entry);
    this.scheduleFlush();
  }

  // 关联检测：新条目与已有条目自动关联
  private detectRelations(entry: FusionEntry): void {
    for (const existing of this.entries) {
      if (existing.source === entry.source) continue;
      const overlap = this.conceptOverlap(entry.concepts, existing.concepts);
      if (overlap > 0.3) {
        entry.relations.push({ target: existing.source, type: 'supports' });
      }
    }
  }

  // 概念重叠度计算
  private conceptOverlap(a: string[], b: string[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(x => setB.has(x));
    return intersection.length / Math.max(setA.size, setB.size, 1);
  }

  // 定时融合
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, this.windowMs);
  }

  // 立即融合
  flush(): FusionResult {
    const start = Date.now();
    const entries = [...this.entries];
    this.entries = [];

    if (entries.length === 0) return { merged: 0, contradictions: 0, associations: 0, durationMs: 0 };

    // 1. 合并关联条目
    const merged = this.mergeRelated(entries);

    // 2. 检测矛盾
    const contradictions = this.findContradictions(entries);

    // 3. 重要性加权
    const weighted = this.weightByImportance(merged);

    // 4. 写入 STMP
    for (const node of weighted) {
      this.stmp.insertNode(node);
    }

    // 5. 更新认知领域
    this.updateCognitiveDomains(entries);

    return {
      merged: weighted.length,
      contradictions: contradictions.length,
      associations: entries.reduce((sum, e) => sum + e.relations.length, 0),
      durationMs: Date.now() - start,
    };
  }

  // 合并关联条目
  private mergeRelated(entries: FusionEntry[]): Array<{
    content: string; concepts: string[]; importance: number; source: string;
  }> {
    const groups = new Map<string, FusionEntry[]>();

    // 按关联关系分组
    for (const entry of entries) {
      const key = entry.relations.length > 0
        ? entry.relations[0].target
        : entry.source;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const result: Array<{ content: string; concepts: string[]; importance: number; source: string }> = [];

    for (const [, group] of groups) {
      if (group.length === 1) {
        const e = group[0];
        result.push({
          content: e.content,
          concepts: e.concepts,
          importance: e.emotional?.importance ?? 5,
          source: e.source,
        });
      } else {
        // 多条合并
        const allConcepts = [...new Set(group.flatMap(e => e.concepts))];
        const avgImportance = group.reduce((s, e) => s + (e.emotional?.importance ?? 5), 0) / group.length;
        const contents = group.map(e => `[${e.source}] ${e.content}`).join('\n');
        result.push({
          content: contents,
          concepts: allConcepts,
          importance: avgImportance,
          source: group.map(e => e.source).join('+'),
        });
      }
    }

    return result;
  }

  // 检测矛盾
  private findContradictions(entries: FusionEntry[]): Array<{ a: FusionEntry; b: FusionEntry }> {
    const contradictions: Array<{ a: FusionEntry; b: FusionEntry }> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const rel = entries[i].relations.find(r => r.target === entries[j].source);
        if (rel?.type === 'contradicts') {
          contradictions.push({ a: entries[i], b: entries[j] });
        }
      }
    }
    return contradictions;
  }

  // 重要性加权
  private weightByImportance(entries: Array<{
    content: string; concepts: string[]; importance: number; source: string;
  }>) {
    return entries
      .sort((a, b) => b.importance - a.importance)
      .map(e => ({
        id: `fusion-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: e.content,
        room: 'perception' as const,
        timestamp: Date.now(),
        temporalContext: { before: [], after: [] },
        concepts: e.concepts,
        relations: [],
        emotional: { valence: 0, importance: e.importance },
        lifecycle: {
          createdAt: Date.now(), lastAccessed: Date.now(),
          accessCount: 1, decay: 1.0, compressed: false, hibernated: false,
        },
        source: 'observed' as const,
      }));
  }

  // 更新认知领域
  private updateCognitiveDomains(entries: FusionEntry[]): void {
    const domainCounts = new Map<string, number>();
    for (const entry of entries) {
      for (const concept of entry.concepts) {
        domainCounts.set(concept, (domainCounts.get(concept) ?? 0) + 1);
      }
    }
    for (const [domain, count] of domainCounts) {
      if (count >= 2) {
        this.cognitive.recordInteraction(domain);
      }
    }
  }
}
```

**ws-handler 集成**:

```typescript
// ws-handler.ts — 多专家结果写入 FusionBuffer
async handleMultiExpert(content: string): Promise<void> {
  const taskId = `multi-${Date.now()}`;
  await this.taskQueue.acquire(taskId);
  const session = this.sys.createExecutionSession(content);
  session.start();

  try {
    // 规划
    const plan = await this.planExpertTasks(content);

    // 并行执行
    const results = await this.expertPool.runParallel(plan.experts, content);

    // 写入 FusionBuffer（多源并发，无需加锁）
    for (const result of results) {
      if (result.success) {
        this.fusionBuffer.ingest({
          source: result.expertId,
          content: result.text,
          concepts: this.extractConcepts(result.text),
          timestamp: Date.now(),
          confidence: result.success ? 0.8 : 0.2,
          relations: [],
        });
      }
    }

    // 立即融合
    const fusionResult = this.fusionBuffer.flush();

    // 广播
    this.eventBus?.emit({
      type: 'multi_expert_complete',
      experts: results.length,
      fusion: fusionResult,
    });

    session.complete();
  } catch (err) {
    session.fail((err as Error).message);
  } finally {
    this.taskQueue.release(taskId);
    this.sys.clearSession();
  }
}
```

**验收**:
- [ ] 多专家结果并发写入 FusionBuffer
- [ ] 关联条目自动合并
- [ ] 矛盾信息自动标记
- [ ] 融合后写入 STMP
- [ ] 认知领域自动更新

---

### Phase 4：ExpertPool 多专家并行（4 天）

**目标**: 多个 LLM 专家并行调用，结果通过 FusionBuffer 融合

**改动文件**: src/core/expert-pool.ts（新增）、src/core/ws-handler.ts（修改）

```typescript
// src/core/expert-pool.ts
export interface ExpertConfig {
  id: string;
  modelConfig: ModelConfig;
  systemPrompt: string;
  taskType: TaskType;
}

export interface ExpertResult {
  expertId: string;
  text: string;
  success: boolean;
  latencyMs: number;
  modelId: string;
}

export class ExpertPool {
  constructor(
    private llm: LLMAdapter,
    private eventBus: EventBus | null,
  ) {}

  async runParallel(
    experts: ExpertConfig[],
    userMessage: string,
    options?: { timeoutMs?: number; earlyTerminate?: boolean },
  ): Promise<ExpertResult[]> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const taskId = `pool-${Date.now()}`;

    this.eventBus?.emit({
      type: 'expert_pool_start',
      taskId,
      experts: experts.map(e => e.id),
    });

    const promises = experts.map(expert =>
      this.callExpert(expert, userMessage, timeoutMs, taskId)
    );

    if (options?.earlyTerminate) {
      // M1-Parallel 模式：谁先完成用谁的
      try {
        const first = await Promise.any(promises);
        return [first];
      } catch {
        // 全部失败，返回所有结果
      }
    }

    const results = await Promise.allSettled(promises);
    return results.map((r, i) => ({
      expertId: experts[i].id,
      text: r.status === 'fulfilled' ? r.value.text : '',
      success: r.status === 'fulfilled',
      latencyMs: r.status === 'fulfilled' ? r.value.latencyMs : 0,
      modelId: experts[i].modelConfig.id,
    }));
  }

  private async callExpert(
    expert: ExpertConfig,
    userMessage: string,
    timeoutMs: number,
    taskId: string,
  ): Promise<ExpertResult> {
    const start = Date.now();

    this.eventBus?.emit({
      type: 'expert_start',
      taskId,
      expertId: expert.id,
      modelId: expert.modelConfig.id,
    });

    const messages: Message[] = [
      { role: 'system', content: expert.systemPrompt, timestamp: Date.now() },
      { role: 'user', content: userMessage, timestamp: Date.now() },
    ];

    try {
      const result = await this.llm.chat(messages, [], 1, { taskType: expert.taskType });
      const latencyMs = Date.now() - start;

      this.eventBus?.emit({
        type: 'expert_done',
        taskId,
        expertId: expert.id,
        latencyMs,
        success: true,
      });

      return { expertId: expert.id, text: result.text, success: true, latencyMs, modelId: expert.modelConfig.id };
    } catch (err) {
      const latencyMs = Date.now() - start;

      this.eventBus?.emit({
        type: 'expert_done',
        taskId,
        expertId: expert.id,
        latencyMs,
        success: false,
        error: (err as Error).message,
      });

      return { expertId: expert.id, text: '', success: false, latencyMs, modelId: expert.modelConfig.id };
    }
  }
}
```

**验收**:
- [ ] 3 个专家并行调用 LLM（Promise.all）
- [ ] 每个专家有独立的 eventBus 事件（带 taskId 标签）
- [ ] Early termination 模式可用
- [ ] 结果写入 FusionBuffer

---

### Phase 5：ClarificationEngine 扩展 + 情绪融合（3 天）

**目标**: 完整接入澄清检测，情绪支持多源融合

**改动文件**: src/core/message-processor.ts（修改）、src/emotion/engine.ts（修改）

```typescript
// message-processor.ts — 扩展澄清检测
const clarification = this.clarifier.assess(content, {
  recentMessages: this.getRecentMessages(5),
});

if (clarification.shouldClarify) {
  switch (clarification.issueType) {
    case 'conflict':
      this.eventBus?.emit({ type: 'clarify', question: clarification.clarificationQuestion });
      return;
    case 'resource':
      this.eventBus?.emit({ type: 'bubble', text: `⚠️ ${clarification.clarificationQuestion}` });
      return;
    case 'deviation':
      this.eventBus?.emit({ type: 'clarify', question: clarification.clarificationQuestion });
      return;
    case 'ambiguity':
      return { text: clarification.clarificationQuestion, toolCalls: [] };
  }
}
```

```typescript
// emotion/engine.ts — 多源情绪融合
interface EmotionSource {
  source: string;
  mood: string;
  energy: number;
  timestamp: number;
}

class EmotionEngine {
  private sources = new Map<string, EmotionSource>();

  // 多源写入
  updateFromSource(source: string, mood: string, energy: number): void {
    this.sources.set(source, { source, mood, energy, timestamp: Date.now() });
  }

  // 融合所有源的情绪
  getFusedState(): EmotionState {
    const now = Date.now();
    const recent = [...this.sources.values()]
      .filter(s => now - s.timestamp < 30000);  // 只看最近 30s

    if (recent.length === 0) return this.getDefaultState();

    // 加权平均（最近的权重更高）
    const totalWeight = recent.reduce((sum, s) => sum + (1 / (now - s.timestamp + 1)), 0);
    const avgEnergy = recent.reduce((sum, s) =>
      sum + s.energy * (1 / (now - s.timestamp + 1)), 0) / totalWeight;

    // 最高票数的 mood
    const moodVotes = new Map<string, number>();
    for (const s of recent) {
      moodVotes.set(s.mood, (moodVotes.get(s.mood) ?? 0) + 1);
    }
    const dominantMood = [...moodVotes.entries()]
      .sort((a, b) => b[1] - a[1])[0][0];

    return { mood: dominantMood, energy: avgEnergy, intensity: recent.length / 3 };
  }
}
```

**验收**:
- [ ] 目标冲突自动检测
- [ ] 理解偏差自动澄清
- [ ] 多专家情绪融合而非覆盖
- [ ] 情绪变化有因果关系

---

### Phase 6：未接入组件批量修复（3 天）

**目标**: 修复集成审计中发现的所有未接入组件

| 组件 | 修复方案 | 改动文件 |
|------|---------|---------|
| ToolSynthesizer | 经验学习循环中触发，高置信度经验自动生成 .skillmate | subsystems.ts 已连接，确认 intelligence 回调生效 |
| ExperienceScheduler | 接入 ws-handler 的空闲行为，定期调度经验执行 | ws-handler.ts 的 setupIdleBehavior |
| WorkflowManager | orchestrate 执行完自动保存为 workflow | ws-handler.ts 的 handleOrchestrate |
| PDFParser | 用户上传 PDF 时自动提取文本写入 STMP | ws-handler.ts 新增文件上传处理 |
| BuddyLearn | 对话结束后自动提取知识 | message-processor.ts 的后处理 |
| FeedbackLearner | 工具调用后记录反馈 | ws-handler.ts 的工具结果处理 |

**验收**:
- [ ] 高频经验自动生成工具
- [ ] PDF 可导入知识库
- [ ] 对话后自动提取知识
- [ ] 工具调用后记录反馈
- [ ] DAG 工作流可持久化

---

## 五、文件变更总览

| Phase | 文件 | 操作 | 行数估算 |
|-------|------|------|---------|
| 1 | src/core/task-queue.ts | 新增 | ~100 |
| 1 | src/core/ws-handler.ts | 修改 | ~50 |
| 1 | src/core/provider-limiter.ts | 修改 | ~30 |
| 2 | src/core/ws-handler.ts | 修改 | ~80 |
| 2 | src/core/message-processor.ts | 修改 | ~60 |
| 3 | src/core/fusion-buffer.ts | 新增 | ~250 |
| 3 | src/core/ws-handler.ts | 修改 | ~60 |
| 3 | src/memory/stmp.ts | 修改 | ~30 |
| 4 | src/core/expert-pool.ts | 新增 | ~200 |
| 4 | src/core/ws-handler.ts | 修改 | ~80 |
| 4 | src/core/subsystems.ts | 修改 | ~30 |
| 5 | src/core/message-processor.ts | 修改 | ~60 |
| 5 | src/emotion/engine.ts | 修改 | ~80 |
| 6 | src/core/ws-handler.ts | 修改 | ~80 |
| 6 | src/core/message-processor.ts | 修改 | ~40 |
| **合计** | | | **~1230** |

---

## 六、依赖关系

```
Phase 1 (TaskQueue) ──► Phase 2 (ExecutionSession) ──► Phase 4 (ExpertPool)
     3天                      3天                           4天
                                    │
                                    ▼
                          Phase 3 (FusionBuffer) ──► Phase 5 (Clarification + 情绪融合)
                                5天                         3天

Phase 6 (未接入组件修复) ──► 可与 Phase 4/5 并行
          3天

总计: 约 16 天（部分 Phase 可并行）
```

---

## 七、验收标准

| Phase | 验收条件 |
|-------|---------|
| 1 | [ ] 3 条消息并发处理 [ ] 排队机制生效 [ ] ProviderLimiter 并发计数准确 |
| 2 | [ ] ExecutionSession 记录每步 [ ] 高风险操作自动暂停 [ ] 超时自动释放 |
| 3 | [ ] 多源并发写入 FusionBuffer [ ] 关联条目自动合并 [ ] 矛盾信息标记 [ ] 融合后写入 STMP |
| 4 | [ ] 3 个专家并行调用 LLM [ ] 前端实时显示专家进度 [ ] Early termination 可用 |
| 5 | [ ] 目标冲突自动检测 [ ] 理解偏差自动澄清 [ ] 情绪多源融合 |
| 6 | [ ] 高频经验自动生成工具 [ ] PDF 可导入 [ ] 对话后自动提取知识 |

---

## 八、风险控制

| 风险 | 控制措施 |
|------|---------|
| API 成本翻倍 | 默认 earlyTerminate 模式，限制最大专家数（默认 3），预算告警 |
| 融合延迟影响响应 | FusionBuffer 异步融合，不阻塞主流程 |
| 矛盾信息误判 | 矛盾标记为 warning，不自动覆盖，用户可查看 |
| 专家模型不可用 | ExpertPool 内置超时 + fallback，单个专家失败不影响其他 |
