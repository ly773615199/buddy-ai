# Buddy 无限上下文实现计划

> 日期: 2026-06-20
> 状态: 规划中
> 目标: 三脑统一调控上下文，大型任务不丢失记忆和上下文

---

## 一、现状分析

### 当前上下文架构

```
SQLite messages 表（无限存储）
    ↓ getRecentMessages(20)     ← 只取最近 20 条
    ↓ compressMessages(5)       ← 旧消息截断
    ↓ buildMessages()           ← system prompt + 压缩历史
    ↓ PromptBudgetManager       ← 按优先级分配 token
    ↓ LLM 调用 (32K tokens)
    ↓ compressToolHistory()     ← 超 60% 阈值压缩
```

### 核心问题

| 问题 | 根因 | 影响 |
|------|------|------|
| 只取 20 条消息 | 硬编码 `getRecentMessages(20)` | 长对话早期上下文丢失 |
| 无对话摘要 | 旧消息直接截断 | 语义信息不可恢复 |
| Token 估算粗糙 | `content.length / 3` | 中文场景误差大 |
| 记忆与对话割裂 | 记忆是检索的，对话是截取的 | 知识不连贯 |
| 三脑不参与上下文分配 | 上下文管理在 message-processor 中硬编码 | 无法智能调控 |

### 研究成果

| 方案 | 核心思路 | 适用性 |
|------|----------|--------|
| **MemGPT** | 虚拟上下文管理，LLM 自主调度内存 | ★★★★★ 最贴合 |
| **分层记忆** | Working → Episodic → Semantic 三层 | ★★★★★ Buddy 已有基础 |
| **Context Engineering** | 五种上下文类型分类管理 | ★★★★ 工程指导性强 |
| **RAG + 滑动窗口** | 检索增强 + 压缩摘要 | ★★★ 传统方案 |

---

## 二、设计方案：三脑调控的虚拟上下文管理

### 核心理念

**不是扩大上下文窗口，而是让三脑智能管理有限窗口。**

MemGPT 的核心洞察：LLM 的上下文窗口就像 CPU 的寄存器——容量有限但速度最快。操作系统通过虚拟内存让程序"看起来"有无限内存。三脑系统应该让 LLM "看起来"有无限上下文。

### 架构：三层记忆 + 三脑调控

```
┌─────────────────────────────────────────────────────────────┐
│                    三脑统一调控                                │
│  小脑(感知) → 右脑(预测) → 左脑(调度)                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   换入/换出   ┌──────────┐   检索    ┌──────┐ │
│  │ L1: 工作  │ ←──────────→ │ L2: 情节  │ ←──────→ │ L3:  │ │
│  │ 记忆      │              │ 记忆      │          │ 语义  │ │
│  │ (上下文窗) │              │ (SQLite)  │          │ 记忆  │ │
│  │ 32K token │              │ 无限      │          │ 无限  │ │
│  └──────────┘              └──────────┘          └──────┘ │
│       ↑                        ↑                    ↑      │
│    LLM 直接               摘要+检索              向量+FTS5  │
│    可见                   可换入                 可检索      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ L4: 程序记忆（经验图谱 + 技能包 + 工具知识）            │  │
│  │ 三脑 NN 决策 + Thompson Sampling                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 四层记忆定义

| 层级 | 名称 | 存储 | 容量 | 延迟 | 内容 |
|------|------|------|------|------|------|
| L1 | 工作记忆 | 上下文窗口 | 32K token | 0ms | 当前对话 + system prompt |
| L2 | 情节记忆 | SQLite messages | 无限 | ~5ms | 对话历史 + 摘要 + 工具结果 |
| L3 | 语义记忆 | SQLite + embeddings | 无限 | ~50ms | 长期知识 + 记忆 + 经验 |
| L4 | 程序记忆 | 经验图谱 + NN | 无限 | ~10ms | 技能 + 决策模式 + 工具知识 |

### 三脑在上下文管理中的角色

```
用户输入
  ↓
小脑：感知当前上下文状态
  ├─ L1 占用率（已用 / 32K）
  ├─ L2 中相关记忆数量
  ├─ 当前任务类型（代码/对话/推理）
  └─ 情绪状态（影响优先级）
  ↓
右脑：预测需要什么上下文
  ├─ 哪些历史消息与当前任务相关？
  ├─ 哪些记忆需要换入 L1？
  ├─ 哪些 L1 内容可以换出？
  └─ 任务复杂度 → 需要多少上下文？
  ↓
左脑：执行上下文调度
  ├─ 换入：从 L2/L3 检索相关片段 → 注入 L1
  ├─ 换出：L1 中不相关内容 → 生成摘要 → 存入 L2
  ├─ 压缩：旧消息 → 语义摘要（用 LLM）
  └─ 裁剪：低优先级内容从 system prompt 移除
  ↓
LLM 执行（在优化后的 L1 上下文中）
  ↓
结果反馈给三脑（更新记忆、经验、统计）
```

---

## 三、详细执行计划

### Phase 1：上下文预算重构（4h）

**目标**：将硬编码的上下文管理改为三脑可调控的动态管理。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1.1 | 新建 `ContextBudget` 类，替代 `getRecentMessages(20)` | `src/core/context-budget.ts` |
| 1.2 | Token 估算改为精确计算（字符权重表） | 同上 |
| 1.3 | 动态消息数：根据 token 预算自适应 | 同上 |
| 1.4 | 接入三脑决策：左脑调度器控制换入/换出 | `src/brain/brain.ts` |

```typescript
// src/core/context-budget.ts
export class ContextBudget {
  private maxTokens: number;        // LLM 上下文窗口
  private systemTokens: number;     // system prompt 占用
  private reservedTokens: number;   // 预留给工具结果

  // 三层记忆引用
  private L1: Message[];            // 工作记忆（当前上下文）
  private L2: MessageStore;         // 情节记忆（SQLite）
  private L3: MemoryStore;          // 语义记忆（向量检索）

  // Token 精确计算
  estimateTokens(text: string): number {
    // 中文: 1 字 ≈ 1.5 token
    // 英文: 1 词 ≈ 1.3 token
    // 代码: 1 字符 ≈ 0.4 token
    const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const english = (text.match(/[a-zA-Z]+/g) ?? []).length;
    const code = text.length - chinese - english;
    return Math.ceil(chinese * 1.5 + english * 1.3 + code * 0.4);
  }

  // 动态获取可用消息数
  getAvailableMessageSlots(): number {
    const usedTokens = this.L1.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    const available = this.maxTokens - this.systemTokens - this.reservedTokens - usedTokens;
    // 假设平均每条消息 200 token
    return Math.max(0, Math.floor(available / 200));
  }

  // 换入：从 L2 检索相关消息 → 注入 L1
  async swapIn(query: string, count: number): Promise<void> {
    const relevant = await this.L2.search(query, count);
    this.L1.push(...relevant);
    this.sortL1ByRelevance(query);
  }

  // 换出：L1 中不相关内容 → 生成摘要 → 存入 L2
  async swapOut(keepRecent: number): Promise<void> {
    const toSwap = this.L1.slice(0, -keepRecent);
    if (toSwap.length === 0) return;

    // 用 LLM 生成摘要
    const summary = await this.summarize(toSwap);
    await this.L2.addSummary(summary);

    // 从 L1 移除
    this.L1 = this.L1.slice(-keepRecent);
  }
}
```

### Phase 2：对话摘要引擎（3h）

**目标**：旧对话不截断，而是生成语义摘要保留关键信息。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 2.1 | 新建 `ConversationSummarizer` 类 | `src/core/conversation-summarizer.ts` |
| 2.2 | 摘要策略：增量摘要（不每次全量重算） | 同上 |
| 2.3 | 摘要存储：SQLite 新增 `conversation_summaries` 表 | `src/memory/store.ts` |
| 2.4 | 触发条件：L1 占用 >70% 或每 N 轮对话 | `src/core/context-budget.ts` |

```typescript
// src/core/conversation-summarizer.ts
export class ConversationSummarizer {
  // 增量摘要：只摘要新消息，与旧摘要合并
  async incrementalSummarize(
    existingSummary: string,
    newMessages: Message[],
  ): Promise<string> {
    const prompt = `
之前的对话摘要：
${existingSummary}

新的对话内容：
${newMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

请生成更新后的对话摘要，保留：
1. 关键决策和结论
2. 未完成的任务
3. 重要的上下文信息（文件名、代码位置、配置等）
4. 用户的偏好和要求

摘要应该简洁（200字以内），但不能丢失重要细节。
`;
    return await this.llm.call(prompt);
  }

  // 任务摘要：针对大型任务的专门摘要
  async taskSummarize(messages: Message[], taskType: string): Promise<TaskSummary> {
    // 根据任务类型提取不同维度
    // 代码任务：保留文件路径、函数名、修改内容
    // 推理任务：保留推理链、结论、假设
    // 对话任务：保留情感、承诺、待办
  }
}
```

### Phase 3：三脑上下文调度器（6h）

**目标**：三脑系统统一控制上下文的换入/换出/压缩/检索。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 3.1 | 新建 `ContextScheduler` 类 | `src/core/context-scheduler.ts` |
| 3.2 | 小脑：感知上下文状态（L1 占用率、相关性、情绪） | 同上 |
| 3.3 | 右脑：预测上下文需求（NN 推断哪些记忆相关） | `src/brain/right/index.ts` |
| 3.4 | 左脑：执行调度决策（规则引擎 + Thompson Sampling） | `src/brain/left/rule-engine.ts` |
| 3.5 | 接入 message-processor 替代硬编码逻辑 | `src/core/message-processor.ts` |

```typescript
// src/core/context-scheduler.ts
export class ContextScheduler {
  constructor(
    private cerebellum: Cerebellum,      // 小脑：感知
    private rightBrain: RightBrain,      // 右脑：预测
    private leftBrain: LeftBrain,        // 左脑：调度
    private contextBudget: ContextBudget,
    private summarizer: ConversationSummarizer,
  ) {}

  /**
   * 三脑协作调度上下文
   * 每次 LLM 调用前执行
   */
  async schedule(userInput: string): Promise<ContextPlan> {
    // Step 1: 小脑 — 感知当前状态
    const state = this.cerebellum.senseContextState({
      l1Usage: this.contextBudget.getL1Usage(),
      l2RelevantCount: await this.contextBudget.countRelevantL2(userInput),
      taskType: this.inferTaskType(userInput),
      emotion: this.cerebellum.inferMood(),
    });

    // Step 2: 右脑 — 预测需要什么上下文
    const prediction = await this.rightBrain.predictContextNeeds({
      input: userInput,
      state,
      recentMessages: this.contextBudget.getL1().slice(-5),
    });

    // Step 3: 左脑 — 制定调度计划
    const plan = this.leftBrain.scheduleContext({
      state,
      prediction,
      rules: this.getSchedulerRules(),
    });

    return plan;
  }

  /**
   * 执行调度计划
   */
  async executePlan(plan: ContextPlan): Promise<void> {
    // 换入
    if (plan.swapIn.length > 0) {
      await this.contextBudget.swapIn(plan.swapInQuery, plan.swapInCount);
    }

    // 换出
    if (plan.shouldSwapOut) {
      await this.contextBudget.swapOut(plan.keepRecent);
    }

    // 摘要
    if (plan.shouldSummarize) {
      const summary = await this.summarizer.incrementalSummarize(
        plan.existingSummary,
        plan.messagesToSummarize,
      );
      await this.contextBudget.storeSummary(summary);
    }

    // 检索增强
    if (plan.shouldRetrieve) {
      const memories = await this.contextBudget.retrieveFromL3(plan.retrieveQuery);
      this.contextBudget.injectMemories(memories);
    }
  }

  /**
   * 调度规则（左脑规则引擎）
   */
  private getSchedulerRules(): SchedulingRule[] {
    return [
      // 规则 1: L1 占用 >70% → 触发换出
      {
        condition: (s) => s.l1Usage > 0.7,
        action: 'swap_out',
        priority: 90,
      },
      // 规则 2: 代码任务 → 保留更多近期上下文
      {
        condition: (s) => s.taskType === 'code' && s.l1Usage > 0.5,
        action: 'compress_older',
        params: { keepRecent: 15 },
        priority: 80,
      },
      // 规则 3: 长对话 → 生成增量摘要
      {
        condition: (s) => s.messageCount > 30,
        action: 'summarize',
        priority: 70,
      },
      // 规则 4: 检索到高相关记忆 → 换入
      {
        condition: (s) => s.l2RelevantCount > 0 && s.l1Usage < 0.6,
        action: 'swap_in',
        priority: 60,
      },
      // 规则 5: 情绪激动 → 保留更多对话上下文
      {
        condition: (s) => s.emotion.intensity > 0.7,
        action: 'keep_more',
        params: { keepRecent: 20 },
        priority: 50,
      },
    ];
  }
}
```

### Phase 4：记忆整合层（4h）

**目标**：L2 情节记忆和 L3 语义记忆统一检索，对话中提取的知识自动写入长期记忆。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 4.1 | 新建 `MemoryIntegrator` 类 | `src/core/memory-integrator.ts` |
| 4.2 | 对话 → 知识提取 → 写入 L3 | 同上 |
| 4.3 | L2 + L3 统一检索接口 | 同上 |
| 4.4 | EnhancedTfIdf 接入 L2 检索 | `src/memory/store.ts` |

```typescript
// src/core/memory-integrator.ts
export class MemoryIntegrator {
  /**
   * 从对话中提取知识，写入 L3 语义记忆
   * 每 N 轮对话触发一次
   */
  async extractAndStore(messages: Message[]): Promise<void> {
    const prompt = `
从以下对话中提取值得长期记住的信息：
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

提取格式（JSON 数组）：
[
  {"key": "主题", "value": "具体信息", "importance": 0.8, "category": "decision|fact|preference|task"}
]

只提取用户明确表达的偏好、决策、事实。不要提取闲聊内容。
`;
    const extracted = await this.llm.call(prompt);
    const items = JSON.parse(extracted);

    for (const item of items) {
      await this.l3.setMemory(item.category, item.key, item.value, item.importance);
    }
  }

  /**
   * 统一检索：L2 情节 + L3 语义
   */
  async unifiedSearch(query: string, limit: number): Promise<SearchResult[]> {
    const [l2Results, l3Results] = await Promise.all([
      this.l2.search(query, limit),
      this.l3.searchMemoriesHybridAsync(query, limit),
    ]);

    // 合并去重，按相关性排序
    return this.mergeAndRank(l2Results, l3Results, query);
  }
}
```

### Phase 5：大型任务上下文保障（3h）

**目标**：执行大型任务（代码重构、多步骤工作流）时不丢失上下文。

| 步骤 | 改动 | 文件 |
|------|------|------|
| 5.1 | 任务执行前：快照当前上下文 | `src/core/context-scheduler.ts` |
| 5.2 | 任务执行中：每步结果写入 L2 | `src/core/llm.ts` |
| 5.3 | 任务执行后：结果摘要写入 L2 + 知识提取写入 L3 | 同上 |
| 5.4 | 断点续传：任务中断后从 L2 恢复上下文 | `src/core/execution-session.ts` |

```typescript
// 任务上下文快照
interface TaskContextSnapshot {
  taskId: string;
  startTime: number;
  goal: string;
  steps: StepResult[];
  l1Snapshot: Message[];       // 任务开始时的 L1
  accumulatedContext: string;   // 累积的关键上下文摘要
}

// 大型任务执行保障
async function executeLargeTask(task: string, scheduler: ContextScheduler) {
  // 1. 快照
  const snapshot = await scheduler.createSnapshot(task);

  // 2. 执行（多步）
  for (const step of plan.steps) {
    const result = await executeStep(step);

    // 3. 每步结果写入 L2（不占用 L1）
    await scheduler.contextBudget.addToL2({
      role: 'assistant',
      content: `[任务步骤] ${step.name}: ${result.summary}`,
      metadata: { taskId: snapshot.taskId, step: step.id },
    });

    // 4. 检查 L1 是否需要压缩
    if (scheduler.contextBudget.getL1Usage() > 0.7) {
      await scheduler.executePlan(await scheduler.schedule(task));
    }
  }

  // 5. 任务完成：生成总结，提取知识
  const summary = await scheduler.summarizer.taskSummarize(snapshot);
  await scheduler.memoryIntegrator.extractAndStore(summary);
}
```

---

## 四、执行时间线

```
Phase 1: 上下文预算重构 (4h)
├── ContextBudget 类
├── Token 精确计算
├── 动态消息数
└── 三脑接入点

Phase 2: 对话摘要引擎 (3h)
├── ConversationSummarizer 类
├── 增量摘要算法
├── SQLite 存储
└── 触发条件

Phase 3: 三脑上下文调度器 (6h)
├── ContextScheduler 类
├── 小脑感知上下文状态
├── 右脑预测上下文需求
├── 左脑执行调度规则
└── 接入 message-processor

Phase 4: 记忆整合层 (4h)
├── MemoryIntegrator 类
├── 对话 → 知识提取
├── L2 + L3 统一检索
└── EnhancedTfIdf 接入

Phase 5: 大型任务保障 (3h)
├── 任务上下文快照
├── 每步结果写入 L2
├── 断点续传
└── 任务完成知识提取

合计: 20h
```

---

## 五、验收标准

| 场景 | 验收条件 |
|------|----------|
| 长对话（>50 轮） | 早期关键信息不丢失，可通过摘要回忆 |
| 大型代码任务 | 执行 10+ 步骤后，上下文完整，能继续对话 |
| 记忆检索 | 对话中提到的信息可被后续检索到 |
| 三脑调控 | 后端日志显示三脑调度决策（换入/换出/摘要） |
| Token 精确 | 估算误差 <10%（当前误差 ~30%） |
| 断点续传 | 任务中断后可从 L2 恢复继续 |
