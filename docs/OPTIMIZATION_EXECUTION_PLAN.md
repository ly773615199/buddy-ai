# Buddy 系统能力优化执行方案

> 日期: 2026-06-14
> 目标: 将 5 个核心维度从当前水平提升至满星
> 原则: 最小改动、最大收益、向后兼容、可度量

---

## 总览：7 项优化，3 个 Sprint

| Sprint | 优化项 | 改动量 | 目标维度 | 预估提升 |
|--------|--------|--------|----------|----------|
| **Sprint 1** | 意图 embedding 分类 | 小 | 意图理解 ⭐⭐⭐→⭐⭐⭐⭐⭐ | +2⭐ |
| **Sprint 1** | 记忆 embedding 检索 | 中 | 记忆检索 ⭐⭐→⭐⭐⭐⭐⭐ | +3⭐ |
| **Sprint 1** | 记忆时序衰减 | 极小 | 记忆检索 | 锦上添花 |
| **Sprint 2** | 资源选择多维反馈 | 小 | 资源选择 ⭐⭐⭐→⭐⭐⭐⭐⭐ | +2⭐ |
| **Sprint 2** | 上下文动态优先级 | 中 | 上下文管理 ⭐⭐⭐⭐→⭐⭐⭐⭐⭐ | +1⭐ |
| **Sprint 3** | 跨会话结构化续做 | 中 | 跨会话任务 ⭐☆→⭐⭐⭐⭐⭐ | +4⭐ |
| **Sprint 3** | 上下文摘要压缩 | 中 | 上下文管理 | 锦上添花 |

---

## Sprint 1: 意图 + 记忆（最高投入产出比）

### 1.1 意图 embedding 分类

#### 现状分析

**文件**: `src/core/intent-classifier.ts`（206 行）

当前实现是纯关键词匹配：
```
classify(input) → 遍历 INTENT_RULES → 关键词 includes() → 取最高分
```

**问题**:
- 只有 8 个粗分类，关键词列表手工维护
- "帮我看看那个认证模块有没有问题" → 匹配不到 code_operations
- "这个东西不太对" → 落入 conversation（置信度 0.5）
- 同义词、口语化、隐喻全部失效

#### 改动方案

**改动文件**: `src/core/intent-classifier.ts`（重写 classify 方法）

**新增依赖**: 无。复用已有的 `llm.executeMultimodal('embedding', ...)` 通道。

**核心设计**: 两级分类器 — 关键词快速路径 + embedding 语义兜底

```
classify(input):
  1. 关键词匹配（<1ms）
     - 命中且 confidence >= 0.6 → 直接返回（快速路径）
  2. embedding 语义匹配（~10ms）
     - 对输入做 embed → 与意图原型库算余弦相似度
     - 最高相似度 > 0.72 → 返回该意图
     - 0.60 ~ 0.72 → 与关键词结果取加权
     - < 0.60 → 返回关键词结果或 conversation
```

**意图原型库**（每意图 5-8 个典型表达，硬编码在文件中）:

```typescript
const INTENT_PROTOTYPES: Record<IntentCategory, string[]> = {
  file_operations: [
    '帮我读一下这个文件',
    '把这段代码写到 config.ts 里',
    '看看目录下有什么文件',
    '创建一个新的配置文件',
    '删除临时文件',
  ],
  code_operations: [
    '帮我看看这个函数有没有 bug',
    '重构一下这段代码',
    '这个模块的依赖关系是什么',
    '跑一下测试',
    '分析代码结构',
  ],
  // ... 每个意图 5-8 个
};
```

**embedding 缓存**: 原型库的 embedding 启动时计算一次，缓存在内存中（Map<string, number[]>）。意图原型是静态的，不需要每次重新计算。

**接口不变**: `classify()` 签名不变，返回值不变，对调用方透明。

#### 具体实现步骤

1. 在 `IntentClassifier` 类中新增:
   - `private prototypeEmbeddings: Map<IntentCategory, number[]>` — 缓存
   - `private async initPrototypes(llm: LLMAdapter): Promise<void>` — 启动时计算原型 embedding
   - `private async embedText(text: string): Promise<number[]>` — 封装 embedding 调用
   - `private cosineSim(a: number[], b: number[]): number` — 余弦相似度（复用 memory/store.ts 的实现）

2. 修改 `classify()`:
   - 增加 `async`（签名变更为 `classify(input: string): Promise<IntentResult>`）
   - 关键词匹配后检查 confidence，>= 0.6 直接返回
   - 否则走 embedding 路径

3. 修改调用方:
   - `filterTools()` 变更为 async
   - `message-processor.ts` 中调用处加 await

4. 新增意图分类（从 8 类扩展）:
   - `data_analysis` — 数据分析、图表、统计
   - `devops` — Docker、部署、CI/CD
   - `writing` — 写文档、润色、翻译
   - `debugging` — 排查问题、日志分析
   - `planning` — 任务规划、架构设计

#### 验证标准

- 口语化输入（无关键词）正确分类率: 目标 ≥ 85%
- 快速路径命中率: 目标 ≥ 60%（避免不必要的 embedding 调用）
- 延迟: 快速路径 < 1ms，embedding 路径 < 20ms
- 向后兼容: 所有现有测试通过

---

### 1.2 记忆 embedding 检索

#### 现状分析

**文件**: `src/memory/store.ts`

当前混合检索: `FTS5(0.6) + TF-IDF bigram(0.4)`

TF-IDF 实现（约 100 行）:
- 中文 bigram 分词（滑动窗口 2 字符）
- TF-IDF 稀疏向量（Map<string, number>）
- 余弦相似度

**问题**:
- bigram 只能捕捉相邻字符关联，"认证"和"鉴权"相似度极低
- "数据库优化" 检索不到 "SQLite WAL 模式调优"
- 稀疏向量对中文语义几乎无能为力

#### 改动方案

**改动文件**: `src/memory/store.ts`

**核心设计**: 三路混合检索 — FTS5 + TF-IDF + Embedding

```
searchMemoriesHybrid(query, limit):
  1. FTS5 精确匹配（<1ms）— 权重 0.25
  2. TF-IDF 语义匹配（~5ms）— 权重 0.15
  3. Embedding 向量匹配（~15ms）— 权重 0.60
  4. 三路结果加权合并 → top limit 返回
```

**数据库变更**: 新增 `memory_embeddings` 表

```sql
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id INTEGER PRIMARY KEY,
  vector BLOB NOT NULL,          -- Float32Array 序列化
  dimensions INTEGER NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

**新增方法**:

```typescript
// 1. 为单条记忆生成 embedding 并存储
async embedMemory(id: number, key: string, value: string): Promise<void>

// 2. 批量 embedding（启动时或写入时异步调用）
async embedBatch(batchSize = 50): Promise<number>
  -- 查询没有 embedding 的记忆
  -- 批量调用 executeMultimodal('embedding', ...)
  -- 存入 memory_embeddings 表

// 3. embedding 向量检索
searchMemoriesEmbedding(query: string, limit = 5):
  -- 查询文本 → embed → 与所有 memory_embeddings 算余弦相似度
  -- 返回 top limit
  -- 注意: 向量在内存中计算（SQLite 没有原生向量索引）
  -- 对于 < 10000 条记忆，全量扫描可接受（~50ms）
  -- 超过 10000 条需要 HNSW 索引（未来优化）

// 4. 修改 searchMemoriesHybrid
searchMemoriesHybrid(query, limit):
  const ftsResults = this.searchMemories(query, limit * 2);        // 0.25
  const tfidfResults = this.searchMemoriesSemantic(query, limit * 2); // 0.15
  const embedResults = this.searchMemoriesEmbedding(query, limit * 2); // 0.60
  // 三路加权合并
```

**embedding 生成时机**:
- 记忆写入时异步生成（非阻塞）
- 启动时 `embedBatch()` 补全缺失的 embedding
- 定期（heartbeat 或 cron）检查并补全

#### 具体实现步骤

1. 新增 `memory_embeddings` 表（migration）
2. 实现 `embedMemory()` — 调用 `llm.executeMultimodal('embedding', ...)`
3. 实现 `embedBatch()` — 批量补全
4. 实现 `searchMemoriesEmbedding()` — 向量检索
5. 修改 `searchMemoriesHybrid()` — 三路合并，权重 0.25/0.15/0.60
6. 修改 `addMemory()` / `updateMemory()` — 写入后异步 embed
7. 在 `subsystems.ts` 启动流程中调用 `embedBatch()`

#### 验证标准

- "认证相关的改动" 能找到 "auth 模块重构" — 目标 ✅
- "数据库性能问题" 能找到 "SQLite WAL 模式" — 目标 ✅
- 检索延迟 < 50ms（< 10000 条记忆）
- FTS5 精确匹配仍然有效（向后兼容）

---

### 1.3 记忆时序衰减

#### 现状分析

当前检索结果不考虑时间因素，3 个月前的记忆和今天的权重一样。

#### 改动方案

**改动文件**: `src/memory/store.ts`

**改动极小**: 在 `searchMemoriesHybrid()` 合并阶段增加时间衰减

```typescript
// memories 表有 created_at 字段（Unix 时间戳）
// 在计算最终 score 时:
const ageHours = (Date.now() - memory.created_at) / (1000 * 60 * 60);
const timeDecay = Math.exp(-0.002 * ageHours);  // 24h 内几乎不衰减，30天衰减 ~25%
const finalScore = baseScore * timeDecay;
```

**衰减参数**:
- 半衰期: ~14 天（`ln(2) / 0.002 ≈ 346 小时`）
- 24h 内: 衰减因子 0.95（几乎不影响）
- 7 天: 衰减因子 0.71
- 30 天: 衰减因子 0.25
- 90 天: 衰减因子 0.02

**可选增强**: 用户明确说"记住这个"的记忆标记 `importance = 5`，衰减速度减半。

#### 验证标准

- 最近对话的记忆排名靠前
- 远古记忆不干扰检索
- 高重要性记忆保持活跃

---

## Sprint 2: 资源 + 上下文

### 2.1 资源选择多维反馈

#### 现状分析

**文件**: `src/core/model-pool.ts`（Thompson Sampling）、`src/brain/left/scheduler.ts`（调度器）

当前 Thompson Sampling 反馈:
```typescript
interface ThompsonParams {
  alpha: number;  // 成功次数 + 1
  beta: number;   // 失败次数 + 1
}
```

只记录 success/fail 二元信号。问题:
- 模型返回了回答但质量很差 → 记录为 success（错）
- 模型回答质量很高但工具执行失败 → 记录为 fail（错）
- 新模型冷启动靠运气

#### 改动方案

**改动文件**: `src/core/model-pool.ts`、`src/brain/left/scheduler.ts`

**核心变更**: ThompsonParams 增加质量维度

```typescript
interface ThompsonParams {
  alpha: number;      // 累积质量权重（而非简单计数）
  beta: number;       // 累积失败权重
  totalCalls: number; // 总调用次数
  avgQuality: number; // 平均质量分（滑动窗口）
  lastUsed: number;   // 最后使用时间
}
```

**反馈信号升级**:

```typescript
// 当前: success → alpha += 1, fail → beta += 1
// 改为: qualityScore → alpha += qualityScore, (1 - qualityScore) → beta += ...

function updateThompson(
  params: ThompsonParams,
  success: boolean,
  qualityScore: number,  // 0-1, 来自 evaluateQuality()
  taskType: string
): ThompsonParams {
  if (success) {
    // 质量加权的成功：质量越高，alpha 增量越大
    params.alpha += 0.5 + qualityScore * 0.5;  // 范围 0.5 ~ 1.0
  } else {
    // 失败但质量高（可能是工具问题而非模型问题）→ 减少惩罚
    params.beta += 0.3 + (1 - qualityScore) * 0.7;  // 范围 0.3 ~ 1.0
  }
  params.totalCalls++;
  params.avgQuality = params.avgQuality * 0.9 + qualityScore * 0.1;  // 滑动平均
  params.lastUsed = Date.now();
  return params;
}
```

**冷启动保护**:

```typescript
// 当前: UCB 探索系数 1.3（已实现）
// 增强: 前 5 次调用强制多样化
if (params.totalCalls < 5) {
  sample *= 1.5 + (5 - params.totalCalls) * 0.1;  // 越新越探索
}
```

**调用链路**:
```
plan-executor executeCascade/Debate/Parallel
  → evaluateQuality(answer, question) → qualityScore
  → ws-handler 结果回调
  → modelPool.updateFeedback(modelId, taskType, success, qualityScore)
```

#### 具体实现步骤

1. 修改 `ThompsonParams` 接口（增加 avgQuality, lastUsed）
2. 新增 `updateFeedback(modelId, taskType, success, qualityScore)` 方法
3. 在 `plan-executor.ts` 各执行模式的结果回调中传入 qualityScore
4. 在 `ws-handler.ts` 的结果处理中调用 updateFeedback
5. 修改 `layer2ThompsonSelect()` 使用 avgQuality 辅助决策
6. 冷启动: totalCalls < 5 时加大探索系数

#### 验证标准

- 新模型前 5 次被充分探索
- 高质量模型的被选中率上升
- 失败但质量高的模型不被过度惩罚

---

### 2.2 上下文动态优先级

#### 现状分析

**文件**: `src/core/message-processor.ts`、`src/core/prompt-budget.ts`

当前优先级是静态常量:
```typescript
const PRIORITY = {
  CORE_INSTRUCTION: 100,
  TRUST_PERMISSIONS: 95,
  EMOTION: 60,
  COGNITIVE: 50,
  MEMORY: 40,
  DOMAIN_KNOWLEDGE: 30,
  SKILLS: 20,
  SUPPLEMENTARY: 10,
};
```

问题:
- 用户在深聊代码时，情绪注入（p60）比领域知识（p30）优先级高
- 闲聊时，代码上下文占用宝贵 token

#### 改动方案

**改动文件**: `src/core/message-processor.ts`

**核心设计**: 意图驱动的优先级调整

```typescript
function getDynamicBoost(intent: IntentResult): Map<string, number> {
  const boost = new Map<string, number>();

  switch (intent.category) {
    case 'code_operations':
    case 'debugging':
      boost.set('cognitive', +10);      // 50 → 60（代码任务需要了解用户水平）
      boost.set('emotion', -15);        // 60 → 45（代码任务不需要情绪注入）
      boost.set('domain-knowledge', +20); // 30 → 50（代码任务需要领域知识）
      boost.set('skills', +10);         // 20 → 30
      break;

    case 'conversation':
      boost.set('emotion', +10);        // 60 → 70（闲聊需要情绪感知）
      boost.set('cognitive', +5);       // 50 → 55
      boost.set('domain-knowledge', -20); // 30 → 10（闲聊不需要领域知识）
      boost.set('skills', -15);         // 20 → 5
      break;

    case 'knowledge_query':
      boost.set('domain-knowledge', +25); // 30 → 55（知识查询最需要领域知识）
      boost.set('memory', +10);         // 40 → 50（相关记忆很重要）
      boost.set('emotion', -20);        // 60 → 40
      break;

    case 'file_operations':
    case 'system_operations':
      boost.set('emotion', -25);        // 60 → 35
      boost.set('domain-knowledge', -15);
      boost.set('skills', +5);
      break;

    // ... 其他意图
  }

  return boost;
}
```

**集成点**: 在 `buildContext()` 中，分类结果传入 `budget.add()` 时应用 boost

```typescript
// 在 buildContext() 中
const intent = this.intentClassifier.classify(content);
const boost = getDynamicBoost(intent);

// 添加 segment 时应用 boost
budget.add({
  id: 'emotion',
  source: 'emotion',
  priority: PRIORITY.EMOTION + (boost.get('emotion') ?? 0),
  content: emotionPrompt,
  required: false,
});
```

#### 具体实现步骤

1. 在 `message-processor.ts` 中新增 `getDynamicBoost(intent)` 函数
2. 在 `buildContext()` 中调用 `classify()` 获取意图
3. 将 boost 应用到各 segment 的 priority
4. 保留原始 PRIORITY 常量不变（boost 是增量调整）
5. 日志: 输出调整后的优先级（便于调试）

#### 验证标准

- 代码任务时，领域知识优先级高于情绪
- 闲聊时，情绪优先级高于领域知识
- 总 token 使用量不增加（只是重新分配）

---

## Sprint 3: 跨会话 + 摘要

### 3.1 跨会话结构化续做

#### 现状分析

**文件**: `src/core/execution-session.ts`、`src/project/store.ts`、`src/core/message-processor.ts`

当前流程:
```
session 完成 → toCheckpoint() → 存 execution_checkpoints
新消息 → buildContext → getPendingExecutionCheckpoints(3) → 注入 prompt
```

**问题**:
- 注入的是原始 checkpoint 文本，LLM 需要自己理解"继续做什么"
- 没有结构化的"下一步计划"
- 没有进度可视化
- `fromCheckpoint()` 恢复的 session 状态不完整（steps 丢失）

#### 改动方案

**改动文件**: `src/core/execution-session.ts`、`src/project/store.ts`、`src/core/message-processor.ts`、`src/project/types.ts`

**核心变更 1**: Checkpoint 增加结构化续做信息

```typescript
// src/project/types.ts — 扩展 ExecutionCheckpoint
interface ExecutionCheckpoint {
  // ... 现有字段

  // 新增: 结构化续做信息
  resumePlan?: {
    nextStep: string;              // 下一步具体做什么
    requiredContext: string[];     // 需要的上下文（文件路径、变量名等）
    estimatedRemaining: number;    // 预估剩余步骤数
    dependency?: string;           // 依赖的前置步骤 ID
  };
  progress?: {
    total: number;                 // 总步骤数
    done: number;                  // 已完成
    failed: number;                // 失败
    current: string;               // 当前步骤描述
    percent: number;               // 完成百分比
  };
}
```

**核心变更 2**: toCheckpoint() 生成续做计划

```typescript
// src/core/execution-session.ts
toCheckpoint(): ExecutionCheckpoint {
  // ... 现有逻辑

  // 新增: 生成续做计划
  const pendingSteps = this.steps.filter(s => !s.completedAt);
  const nextStep = pendingSteps[0];

  return {
    // ... 现有字段
    resumePlan: nextStep ? {
      nextStep: `${nextStep.tool}(${JSON.stringify(nextStep.args).slice(0, 100)})`,
      requiredContext: this.extractRequiredContext(nextStep),
      estimatedRemaining: pendingSteps.length,
    } : undefined,
    progress: {
      total: this.steps.length,
      done: completedSteps.length,
      failed: failedSteps.length,
      current: nextStep?.tool ?? '已完成',
      percent: Math.round(completedSteps.length / this.steps.length * 100),
    },
  };
}
```

**核心变更 3**: buildContext 注入结构化续做信息

```typescript
// src/core/message-processor.ts — 修改待恢复任务注入
if (pendingTasks.length > 0) {
  const pendingPrompt = pendingTasks.map(cp => {
    const progress = cp.progress;
    const resume = cp.resumePlan;
    const progressBar = progress
      ? `[${'█'.repeat(Math.floor(progress.percent / 10))}${'░'.repeat(10 - Math.floor(progress.percent / 10))}] ${progress.percent}%`
      : '';

    let resumeInfo = '';
    if (resume) {
      resumeInfo = `\n  → 下一步: ${resume.nextStep}`;
      if (resume.requiredContext.length > 0) {
        resumeInfo += `\n  → 需要: ${resume.requiredContext.join(', ')}`;
      }
      resumeInfo += `\n  → 剩余约 ${resume.estimatedRemaining} 步`;
    }

    return `- 「${cp.goal.slice(0, 80)}」${progressBar}${resumeInfo}`;
  }).join('\n');

  budget.add({
    id: 'pending-tasks',
    source: 'memory',
    priority: 65,
    content: `\n## 待恢复的任务\n${pendingPrompt}\n\n如果用户说"继续"或提到相关任务，从下一步开始执行。`,
    required: false,
  });
}
```

**核心变更 4**: fromCheckpoint() 完整恢复 steps

```typescript
// 当前 fromCheckpoint() 丢失了 steps 详情
// 改为: 从 pendingSteps + completedSteps 重建 steps 数组
static fromCheckpoint(cp: ExecutionCheckpoint): ExecutionSession {
  const session = new ExecutionSession({ ... });

  // 恢复 steps
  const steps: StepRecord[] = [];
  for (const cs of cp.completedSteps) {
    steps.push({ tool: cs.tool, result: cs.result, success: cs.success, completedAt: Date.now() });
  }
  for (const fs of cp.failedSteps) {
    steps.push({ tool: fs.tool, result: fs.error, success: false, completedAt: Date.now() });
  }
  for (const ps of cp.pendingSteps) {
    steps.push({ tool: ps.tool, args: ps.args, completedAt: undefined });
  }
  (session as any).steps = steps;

  return session;
}
```

#### 具体实现步骤

1. 扩展 `ExecutionCheckpoint` 接口（types.ts）
2. 修改 `toCheckpoint()` 生成 resumePlan + progress
3. 修改 `fromCheckpoint()` 完整恢复 steps
4. 修改 `buildContext()` 注入结构化续做信息
5. 修改 `saveExecutionCheckpoint()` 持久化新字段（migration）
6. 测试: 创建 checkpoint → 模拟恢复 → 验证步骤完整性

#### 验证标准

- checkpoint 包含结构化续做计划
- 恢复后 LLM 知道从哪一步继续
- 用户能看到进度条
- steps 在恢复后完整

---

### 3.2 上下文摘要压缩

#### 现状分析

**文件**: `src/core/message-processor.ts`、`src/core/prompt-budget.ts`

当 token 不够时，直接截断: `text.slice(0, maxChars) + '...[budget truncated]'`

问题:
- 截在句子中间，语义断裂
- 丢失重要上下文
- 没有利用 LLM 做智能压缩

#### 改动方案

**改动文件**: `src/core/prompt-budget.ts`

**核心设计**: 分级截断策略

```typescript
// PromptBudgetManager.build() 修改
build(): string {
  // ... 排序逻辑不变

  let budget = this.maxTokens;
  const included: PromptSegment[] = [];

  for (const seg of sorted) {
    const tokens = this.estimateTokens(seg.content);

    if (tokens <= budget) {
      included.push(seg);
      budget -= tokens;
    } else if (seg.required && budget > 30) {
      // required 段: 智能截断（按句子边界）
      const truncated = this.smartTruncate(seg.content, budget);
      included.push({ ...seg, content: truncated });
      budget = 0;
    } else {
      // 非 required 段: 尝试摘要压缩
      if (tokens > 200 && budget > 50) {
        // 大段内容且还有余量 → 保留首尾，压缩中间
        const compressed = this.compressSegment(seg.content, budget);
        included.push({ ...seg, content: compressed });
        budget -= this.estimateTokens(compressed);
      }
      // 否则丢弃
    }
  }

  return included.map(seg => this.wrapSegment(seg)).join('\n\n');
}
```

**智能截断**（按句子边界）:

```typescript
private smartTruncate(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;  // 粗估 1 token ≈ 3 chars

  if (text.length <= maxChars) return text;

  // 按句子分割
  const sentences = text.split(/(?<=[。！？.!?\n])/);
  let result = '';

  for (const sentence of sentences) {
    if ((result + sentence).length > maxChars) break;
    result += sentence;
  }

  // 如果句子截断后太短，回退到字符截断
  if (result.length < maxChars * 0.5) {
    result = text.slice(0, maxChars);
  }

  return result + '\n...[已截断]';
}
```

**段落压缩**（保留首尾）:

```typescript
private compressSegment(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  const lines = text.split('\n');

  if (lines.length <= 3 || text.length <= maxChars) {
    return this.smartTruncate(text, maxTokens);
  }

  // 保留前 2 行和后 1 行
  const head = lines.slice(0, 2).join('\n');
  const tail = lines[lines.length - 1];
  const middleBudget = maxChars - head.length - tail.length - 20; // 20 chars for separator

  if (middleBudget > 50) {
    // 中间部分按重要性采样（保留包含关键词的行）
    const middleLines = lines.slice(2, -1);
    const important = middleLines
      .filter(l => l.includes('**') || l.includes('##') || l.includes('→') || l.includes('✅') || l.includes('❌'))
      .slice(0, 3);

    return `${head}\n...[${middleLines.length - important.length} 行已省略]...\n${important.join('\n')}\n${tail}`;
  }

  return `${head}\n...[已压缩]...\n${tail}`;
}
```

#### 具体实现步骤

1. 在 `PromptBudgetManager` 中新增 `smartTruncate()` 方法
2. 新增 `compressSegment()` 方法
3. 修改 `build()` 方法的截断逻辑
4. 测试: 构造超长 context → 验证截断在句子边界

#### 验证标准

- 截断不在句子中间
- 重要行（标题、状态标记）被保留
- 总 token 不超限

---

## 实施时间线

```
Week 1:
  Day 1-2: Sprint 1.1 意图 embedding 分类
  Day 3-4: Sprint 1.2 记忆 embedding 检索
  Day 5:   Sprint 1.3 记忆时序衰减 + 测试

Week 2:
  Day 1-2: Sprint 2.1 资源选择多维反馈
  Day 3-4: Sprint 2.2 上下文动态优先级
  Day 5:   集成测试 + 回归测试

Week 3:
  Day 1-3: Sprint 3.1 跨会话结构化续做
  Day 4:   Sprint 3.2 上下文摘要压缩
  Day 5:   全链路测试 + 文档更新
```

## 度量指标

| 维度 | 当前 | 目标 | 度量方法 |
|------|------|------|----------|
| 意图理解 | ~60% 准确率 | ≥90% | 50 条口语化测试用例 |
| 资源选择 | 冷启动 ~10 次收敛 | ≤5 次 | 新模型首次使用日志 |
| 上下文管理 | 静态优先级 | 动态调整 | 日志输出优先级变化 |
| 记忆检索 | 关键词匹配 | 语义匹配 | 10 条语义等价测试 |
| 跨会话任务 | 文本注入 | 结构化续做 | 恢复成功率 |

## 风险与回退

| 风险 | 影响 | 回退方案 |
|------|------|----------|
| embedding 延迟过高 | 意图分类变慢 | 关键词快速路径兜底（>= 0.6 不走 embedding） |
| embedding API 不可用 | 记忆检索降级 | 自动回退到 FTS5 + TF-IDF（当前方案） |
| Thompson 参数迁移 | 旧数据不兼容 | 保留旧字段，新字段默认值兜底 |
| 截断策略变更 | 语义断裂 | 保留原 `text.slice()` 作为最终 fallback |
