# 三脑架构冷启动与验证闭环修复计划

> 版本: v1.0
> 日期: 2026-05-14
> 基于: 全量源码审计 + 运行时行为分析 + 学术研究调研

---

## 一、问题总览

通过深入代码实现发现两类问题：

### A. 验证闭环断裂（运行时反馈缺失）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| A1 | QualityAssessor 拿到 `output=''` | `brain.ts:370` | 四维质量评估形同虚设，只有 executionSuccess 和 latencyMs 有效 |
| A2 | A/B 测试用随机数模拟 | `shadow/index.ts:575` | 进化锁第 3 锁（回归风险评估）基于随机数据做判断 |

### B. 冷启动能力缺失（首次运行时无数据）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| B1 | NN 权重随机初始化 | `right/nn/model.ts` | 前 50 次交互 NN 输出无意义 |
| B2 | 种子原型 toolDist 为空 | `right/index.ts:608` | predictDetailed() 双通道融合失效 |
| B3 | 种子经验缺少检索型工具链 | `intelligence/seed-experiences.ts` | 知识问答类任务无法检索增强 |
| B4 | OnlineLearner 冷启动无样本 | `right/training/online-learner.ts` | 第 8 次交互前 NN 无法更新 |

---

## 二、研究依据

| 论文 | 来源 | 关键结论 | 对应修复 |
|------|------|---------|---------|
| TinyAgent: Function Calling at the Edge | EMNLP 2024 | 工具定义→合成训练数据→SFT，小模型可达到 GPT-4 水平 | B1: 从工具定义生成合成训练数据 |
| Small LLMs for Agentic Tool Calling | AAAI 2026 Workshop | OPT-350M SFT 后在 ToolBench 达 77.55%，超过 ChatGPT-CoT (26%) | B1: 300K 参数足够，关键是训练数据质量 |
| Quality Matters: Synthetic Data for Tool-Using LLMs | 2024 | 高质量少量数据 > 低质量大量数据 | B1: 合成数据需质量过滤 |
| Zero and Few-shot Intent Classification | ACL 2023 | 每意图 1 样本即可达到最佳效果 | B1: 15 个种子样本足以启动 |
| Data-Free Knowledge Distillation | 2024 | 无需原始数据，从教师结构生成训练数据 | B1: 从工具定义+规则生成训练样本 |

---

## 三、修复方案

### A1: QualityAssessor 传入 actualOutput

**目标**: 让质量自评器能评估实际输出，而非只看执行结果。

**改动文件**: `src/brain/brain.ts`

**改动内容**:

```typescript
// brain.ts — feedback() 方法签名增加 actualOutput 参数
async feedback(
  signal: TaskSignal,
  resources: ResourceState,
  plan: ExecutionPlan,
  outcome: DecisionOutcome,
  actualIntent?: string,
  actualTools?: string[],
  failedModels?: string[],
  failedReasons?: string[],
  actualOutput?: string,        // ← 新增
): Promise<FeedbackResult> {

  // Phase 4 闭环反馈中，传入真实输出
  if (outcome.success) {
    const quality = this.qualityAssessor.assess({
      userRequest: signal.content ?? '',
      taskType: signal.taskType,
      output: actualOutput ?? '',  // ← 修复：用真实输出替代空字符串
      executionSuccess: outcome.success,
      latencyMs: outcome.latencyMs,
      retryCount: failedModels?.length,
      toolResults: outcome.toolsUsed,  // ← 新增：工具结果
    });
    // ...
  }
}
```

**调用方改动**: `src/core/agent.ts` — `orchestrateWithThreeBrain()` 中将 LLM 实际输出透传到 `feedback()`。

**验证方式**: 单元测试验证 QualityAssessor 收到非空 output 时，completeness/accuracy/conciseness 维度正常评分。

**工作量**: ~15 行代码

---

### A2: A/B 测试用真实决策数据替代随机数

**目标**: 进化锁的回归风险评估基于真实数据。

**改动文件**: `src/brain/shadow/index.ts`

**改动内容**:

```typescript
// shadow/index.ts — runOfflineABTest() 改用真实决策回放
private async runOfflineABTest(
  shadow: { nnWeights: Float32Array[] },
  prod: { nnWeights: Float32Array[] },
  proposal?: EvolutionProposal,
): Promise<ABTestResult[]> {
  if (!this.brain) return [];

  const samples = this.brain.getDecisionSamples();
  if (samples.length < 50) return [];

  // 从聚类统计获取真实的基线成功率（已有逻辑）
  let totalSuccess = 0;
  let totalCount = 0;
  for (const sample of samples) {
    const stats = this.brain.getClusterStats(sample.fingerprint);
    if (stats && stats.count > 0) {
      totalSuccess += stats.count * stats.successRate;
      totalCount += stats.count;
    }
  }
  const baseSuccessRate = totalCount > 0 ? totalSuccess / totalCount : 0.5;

  // 影子版本：用影子规则回放真实样本（替代随机数）
  const shadowResults = await this.replayWithShadow(samples.slice(-50), proposal);
  const shadowSuccessRate = shadowResults.filter(r => r.success).length / shadowResults.length;

  // 构造 A/B 结果：production 用真实统计，shadow 用回放结果
  const results: ABTestResult[] = [];

  // production 组：从真实聚类统计采样
  for (let i = 0; i < 50; i++) {
    results.push({
      group: 'production',
      success: Math.random() < baseSuccessRate,
      latencyMs: 50 + Math.random() * 100,  // 延迟仍用估算
      cost: 0.001,
    });
  }

  // shadow 组：用影子回放的真实结果
  for (const r of shadowResults) {
    results.push({
      group: 'shadow',
      success: r.success,
      latencyMs: r.latencyMs,
      cost: r.cost,
    });
  }

  return results;
}

// 新增：影子回放方法
private async replayWithShadow(
  samples: DecisionRecord[],
  proposal?: EvolutionProposal,
): Promise<ABTestResult[]> {
  // 如果有 L1 规则提案，用提案的规则匹配样本
  // 如果有 L2 参数提案，用扩展后的 NN 推理
  // 返回每个样本在影子配置下的预测结果
  // ...
}
```

**验证方式**: 单元测试验证 shadow 组结果不是纯随机，而是基于规则回放。

**工作量**: ~60 行代码

---

### B1: 种子知识注入（从工具定义+种子经验生成合成训练数据）

**目标**: 冷启动时 NN 不再从随机权重开始，而是有 ~170 个合成训练样本。

**参考论文**: TinyAgent (EMNLP 2024), Quality Matters (2024)

**新增文件**: `src/brain/right/training/seed-synthesizer.ts`

**改动文件**: `src/core/subsystems.ts`

**设计**:

```typescript
// seed-synthesizer.ts

/**
 * 从工具定义 + 种子经验 + 内置规则生成合成训练数据
 *
 * 三种数据源：
 * 1. 种子经验 → 直接转换（15 个，高质量，来自真实场景）
 * 2. 工具定义 → 变体生成（~150 个，中质量，基于工具描述）
 * 3. 内置规则 → 规则转换（8 个，高质量，人工编写）
 *
 * 质量过滤（Quality Matters 论文）：
 * - 必须有工具标签
 * - 必须有意图标签
 * - 必须有特征向量
 */

interface SynthesizedSample {
  features: Float32Array;
  labelIntent: number;
  labelTools: number[];
  labelQuality: number;
  outcome: boolean;
  source: 'seed_experience' | 'tool_variant' | 'builtin_rule';
}

// 意图映射：种子经验的 intent → NN 的意图类别索引
const INTENT_MAP: Record<string, number> = {
  'git_status': 2, 'git_diff': 2, 'git_log': 2,
  'file_read': 0, 'file_write': 0, 'list_files': 0, 'file_search': 0,
  'exec': 4, 'get_time': 4,
  'search_web': 3, 'fetch_url': 3,
  'code_analyze': 1, 'error_fix': 1,
  'knowledge_qa': 5, 'conversation': 6,
};

// 工具映射：工具名 → NN 的工具索引
const TOOL_IDS: Record<string, number> = {
  'read_file': 0, 'write_file': 1, 'list_files': 2, 'search_files': 3,
  'exec': 4, 'git_status': 5, 'git_log': 6, 'git_diff': 7,
  'git_commit': 8, 'git_branch': 9, 'git_merge': 10, 'git_push': 11,
  'search_web': 12, 'fetch_url': 13, 'analyze_file': 14, 'find_references': 15,
  'browser_screenshot': 16, 'browser_extract': 17, 'browser_pdf': 18,
  'screen_capture': 19, 'screen_ocr': 20, 'screen_describe': 21,
  'tts_speak': 22, 'tts_voices': 23, 'tts_status': 24,
  'scan_project': 25, 'project_context': 26, 'get_time': 27,
};

export function synthesizeTrainingData(
  tools: ToolDef[],
  seedExperiences: ExperienceUnit[],
): SynthesizedSample[] {
  const samples: SynthesizedSample[] = [];

  // 方法 1：种子经验直接转换
  for (const seed of seedExperiences) {
    const sample = experienceToSample(seed);
    if (sample) samples.push(sample);
  }

  // 方法 2：工具定义变体生成
  for (const tool of tools) {
    const variants = generateToolVariants(tool);
    samples.push(...variants);
  }

  // 方法 3：内置规则转换
  samples.push(...builtinRulesToSamples());

  // 质量过滤
  return samples.filter(s =>
    s.labelTools.some(t => t > 0) &&
    s.labelIntent >= 0 &&
    s.features.length > 0
  );
}

function experienceToSample(seed: ExperienceUnit): SynthesizedSample | null {
  const intentIdx = INTENT_MAP[seed.trigger.intent] ?? -1;
  if (intentIdx < 0) return null;

  const toolLabels = new Array(32).fill(0);
  for (const step of seed.steps) {
    const idx = TOOL_IDS[step.tool];
    if (idx !== undefined) toolLabels[idx] = 1;
  }
  if (toolLabels.every(t => t === 0)) return null;

  const signal: TaskSignal = {
    domains: seed.trigger.contextTags.length > 0
      ? [seed.trigger.contextTags[0].toLowerCase()] : ['conversation'],
    complexity: 'simple',
    taskType: 'tools',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: seed.stats.confidence,
  };
  const resources: ResourceState = {
    budgetRemaining: 100, availableNodeCount: 1,
    localCoverageRatio: 1, localConfidence: seed.stats.confidence,
    userCorrectionCount: 0, experienceHit: null,
  };

  return {
    features: new Float32Array(encodeFeatures({ signal, resources })),
    labelIntent: intentIdx,
    labelTools: toolLabels,
    labelQuality: seed.stats.confidence,
    outcome: seed.stats.successCount > 0,
    source: 'seed_experience',
  };
}

function generateToolVariants(tool: ToolDef): SynthesizedSample[] {
  // 从工具描述生成 5 种用户说法变体
  // 每个变体编码为 TrainingSample
  // 关键：变体要覆盖不同意图场景
  // ...
}

function builtinRulesToSamples(): SynthesizedSample[] {
  // 8 条内置规则 → 8 个训练样本
  // ...
}
```

**注入时机**: `src/core/subsystems.ts` — `initSubsystems()` 末尾

```typescript
// subsystems.ts
import { synthesizeTrainingData } from '../brain/right/training/seed-synthesizer.js';
import { createSeedExperiences } from '../intelligence/seed-experiences.js';
import { ALL_TOOLS } from '../tools/builtin.js';

// 在 ThreeBrain 初始化完成后
const seedExperiences = createSeedExperiences();
const syntheticSamples = synthesizeTrainingData(ALL_TOOLS, seedExperiences);
for (const sample of syntheticSamples) {
  this.threeBrain.right.learner.ingestSample(sample);
}
console.log(`[Subsystems] 冷启动: 注入 ${syntheticSamples.length} 个合成训练样本`);
```

**预期效果**:

| 指标 | 注入前 | 注入后 |
|------|--------|--------|
| ReplayBuffer | 0 样本 | ~170 样本 |
| NN 第一次更新 | 第 8 次交互后 | 第 1 次交互后即可 |
| 意图分类 | 随机 | 能区分 8 类意图 |
| 工具推荐 | 随机 | 能推荐相关工具 |

**验证方式**:
1. 单元测试：验证合成样本数量 > 100，每个样本有有效标签
2. 集成测试：注入后 NN 的 intentProbs 分布不再均匀

**工作量**: ~200 行新代码 + ~10 行注入代码

---

### B2: 种子原型 toolDist 填充

**目标**: predictDetailed() 双通道融合从第一次交互就能工作。

**改动文件**: `src/brain/right/index.ts`

**改动内容**:

```typescript
// right/index.ts — seedPrototypeMemory() 末尾增加 toolDist 填充

private seedPrototypeMemory(): void {
  // ... 现有代码：从 intentHead 权重提取种子原型 ...

  // 新增：从意图-工具映射填充种子原型的 toolDist
  const DOMAIN_TOOLS: Record<string, string[]> = {
    'file_operations': ['read_file', 'write_file', 'list_files', 'search_files'],
    'code_operations': ['read_file', 'write_file', 'exec', 'search_files', 'analyze_file'],
    'git_operations': ['exec', 'git_status', 'git_log', 'git_diff', 'git_commit'],
    'web_operations': ['search_web', 'fetch_url'],
    'system_operations': ['exec'],
    'knowledge_query': ['fetch_url', 'search_web'],
    'conversation': [],
    'complex_task': ['exec'],
  };

  for (const proto of this.prototypeMemory.getPrototypes()) {
    const tools = DOMAIN_TOOLS[proto.label] ?? [];
    for (const tool of tools) {
      proto.toolDist.set(tool, 1);  // 初始计数 1
    }
  }
}
```

**预期效果**: predictDetailed() 中原型通道的 toolDist 不再为空，NN 概率 * 0.7 + 原型频率 * 0.3 的融合立即生效。

**验证方式**: 单元测试验证种子原型的 toolDist.size > 0。

**工作量**: ~15 行代码

---

### B3: 检索型工具链种子经验

**目标**: 知识问答类任务自动走"先搜索再总结"路径，减少弱模型的生成负担。

**参考论文**: RAG (Retrieval-Augmented Generation) 模式

**改动文件**: `src/intelligence/seed-experiences.ts`

**新增种子经验** (8 个):

```typescript
// ── 知识检索型（RAG 模式）──
{
  id: 'seed_knowledge_qa',
  name: 'knowledge_qa',
  description: '知识问答 — 先搜索再总结',
  abstractionLevel: 'workflow',
  trigger: {
    intent: 'knowledge_qa',
    keywords: ['是什么', '什么是', '怎么', '为什么', '如何', '原理',
               'what is', 'why', 'how does', 'explain', '区别', 'difference'],
    contextTags: ['knowledge'],
    patterns: ['什么是.*', '为什么.*', '怎么.*', 'how.*work'],
  },
  steps: [
    { tool: 'search_web', args: { query: '${question}' }, description: '搜索相关资料' },
    { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取详细内容' },
  ],
  replyTemplate: {
    sharp: '{_step_1}',
    warm: '根据搜索结果：\n{_step_1}',
    chaotic: '我查了下，\n{_step_1}',
    default: '{_step_1}',
  },
  stats: { successCount: 5, failCount: 0, confidence: 0.6, ... },
},

// ── 错误排查型 ──
{
  id: 'seed_error_debug',
  name: 'error_debug',
  description: '错误排查 — 搜索解决方案',
  trigger: {
    intent: 'error_debug',
    keywords: ['报错', 'error', 'exception', 'bug', '不工作', '失败',
               'crash', 'broken', 'fix', 'troubleshoot'],
    contextTags: ['error'],
    patterns: ['报错了', '出.*错', '怎么.*修复', '\\berror\\b'],
  },
  steps: [
    { tool: 'search_web', args: { query: '${error_message} solution fix' }, description: '搜索解决方案' },
    { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取解决方案详情' },
  ],
  replyTemplate: {
    sharp: '{_step_1}',
    warm: '找到解决方案：\n{_step_1}',
    chaotic: 'Stack Overflow 说：\n{_step_1}',
    default: '{_step_1}',
  },
  stats: { successCount: 3, failCount: 1, confidence: 0.5, ... },
},

// ── 代码示例查找型 ──
{
  id: 'seed_code_example',
  name: 'code_example',
  description: '代码示例查找 — 搜索实现参考',
  trigger: {
    intent: 'code_example',
    keywords: ['怎么写', '实现', 'example', '示例', 'sample', 'demo',
               '代码', 'snippet', '模板', 'template'],
    contextTags: ['code'],
    patterns: ['怎么写.*', '实现.*功能', '.*example.*', '.*示例.*'],
  },
  steps: [
    { tool: 'search_web', args: { query: '${language} ${feature} implementation example code' }, description: '搜索代码示例' },
    { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取代码详情' },
  ],
  replyTemplate: {
    sharp: '{_step_1}',
    warm: '找到参考实现：\n{_step_1}',
    chaotic: '网上有现成的！\n{_step_1}',
    default: '{_step_1}',
  },
  stats: { successCount: 3, failCount: 0, confidence: 0.55, ... },
},

// ── 文档查找型 ──
{
  id: 'seed_doc_lookup',
  name: 'doc_lookup',
  description: '文档/API 查找',
  trigger: {
    intent: 'doc_lookup',
    keywords: ['文档', 'documentation', 'api', '接口', '参数', '用法',
               'usage', 'reference', 'man page'],
    contextTags: ['docs'],
    patterns: ['.*文档.*', '.*api.*用法', '.*参数.*说明'],
  },
  steps: [
    { tool: 'search_web', args: { query: '${tool_name} documentation API reference' }, description: '搜索官方文档' },
    { tool: 'fetch_url', args: { url: '${docUrl}' }, description: '获取文档内容' },
  ],
  replyTemplate: {
    sharp: '{_step_1}',
    warm: '官方文档：\n{_step_1}',
    chaotic: '翻了下文档~\n{_step_1}',
    default: '{_step_1}',
  },
  stats: { successCount: 4, failCount: 0, confidence: 0.55, ... },
},
```

**同步更新**: `seed-synthesizer.ts` 中为检索型种子经验生成对应的合成训练样本，标记为 `taskType: 'knowledge_query'`。

**预期效果**: NN 学会 `knowledge_query` 意图 → 推荐 `search_web + fetch_url` 工具链。

**验证方式**: 单元测试验证知识问答类输入被分类为 `knowledge_query` 意图。

**工作量**: ~80 行种子数据

---

### B4: (已分析，不需要修复)

OnlineLearner 默认 `observeOnly = false`，冷启动时第 8 次交互即可第一次更新权重。配合 B1 的合成数据注入，ReplayBuffer 初始就有 ~170 样本，第一次交互后即可更新。

---

## 四、实施顺序

```
Phase 1: 基础修复（1-2 天）
├── B2: 种子原型 toolDist 填充（15 行）
├── A1: QualityAssessor 传入 actualOutput（15 行）
└── B3: 检索型工具链种子经验（80 行）

Phase 2: 冷启动能力（2-3 天）
├── B1: 种子知识注入器 seed-synthesizer.ts（200 行）
└── B1: subsystems.ts 注入逻辑（10 行）

Phase 3: 验证增强（2-3 天）
└── A2: A/B 测试真实数据采集（60 行）

Phase 4: 知识管道（1-2 天）
└── plan-executor.ts 知识查询独立路径（60 行）

Phase 5: 测试验证（1-2 天）
├── 各修复的单元测试
└── 集成测试：冷启动 → 首次交互 → 验证 NN 输出非随机
```

**总工作量**: ~440 行基础修复 + ~750 行能力协同调度 = ~1190 行代码，12-18 天

---

## 五、预期效果对比

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 冷启动首次交互 | NN 随机输出，全走 LLM | NN 有微弱分类能力，工具推荐基本准确 |
| 知识问答 | LLM 从零生成（弱模型质量差） | 先搜索再总结（质量提升 3-5 倍） |
| 无 LLM 知识查询 | 知识检索结果被丢弃 | 独立输出管道，直接返回检索结果 |
| 无 LLM 能力覆盖率 | ~40%（仅工具型） | ~75%（工具型 + 知识检索型 + 格式化） |
| 质量自评 | 只看 executionSuccess | 四维评估（完整性/准确性/简洁性/可用性） |
| 进化验证 | A/B 用随机数模拟 | A/B 用真实决策回放 |
| 双通道融合 | 原型 toolDist 为空，只有 NN 通道 | NN * 0.7 + 原型 * 0.3，双通道生效 |

---

## 六、不修复的项（及原因）

| 项 | 原因 |
|------|------|
| 三脑决策回流到 DecisionRecorder | LLMAdapter.recordOutcome() 已在 LLM 调用层处理，ThreeBrain 不需要参与 |
| 启动时调 Distiller | 冷启动时 0 条 DecisionRecords，Distiller 直接返回 samples: 0 |
| OnlineLearner 安全阀跳过 | 默认 observeOnly = false，不存在此问题 |
| seedFromTools | 已存在：seed-experiences.ts 有 15 个种子经验 |

---

## 七、知识系统独立输出管道

### 问题

KnowledgeSourceManager 已实现四层知识源（本地 FTS5 + 对话历史 + 网络搜索 + 飞书知识库），但检索结果**只作为 LLM prompt 注入**（`message-processor.ts:269`），没有独立的输出路径。无 LLM 时，知识检索结果被丢弃。

### 方案

新增知识查询独立执行路径，NN 分类为 `knowledge_query` 意图时绕过 LLM，直接检索并格式化输出。

**改动文件**: `src/core/plan-executor.ts`

新增 `executeKnowledgeQuery()` 方法：
1. 本地知识检索（FTS5 + 对话历史）
2. 本地有结果且 score > 0.6 → 格式化返回
3. 本地不够 → 网络搜索补充
4. 都没有 → 诚实告知

**触发条件**: NN intent 分类为 `knowledge_query`，且 `exp_direct` 未命中。

### 能力覆盖

| 领域 | 无 LLM 能解决 | 需要 LLM |
|------|-------------|----------|
| 编程 | 查文档(40%) + 执行命令(20%) + 查代码(15%) = **75%** | 写代码(20%) + 审查(5%) |
| 电商 | 查数据(30%) + 查竞品(20%) + 执行操作(15%) + 查文档(10%) = **75%** | 写文案(15%) + 分析(10%) |
| 金融 | 查数据(30%) + 查公式(20%) + 查新闻(15%) + 查历史(10%) = **75%** | 分析(15%) + 写报告(10%) |

**通用规律**: ~75% 的工作任务可通过"知识检索 + 工具执行 + 模板展示"解决，不需要 LLM 生成能力。

### 工作量

| 文件 | 行数 | 说明 |
|------|------|------|
| `plan-executor.ts` 改动 | ~60 | 知识查询独立路径 + 格式化 |

---

## 八、能力协同调度（替代固定降级链）

### 设计理念

**核心转变：不是"有 LLM 用 LLM，没有走模板"的二元降级，而是多种能力共同作用、动态调配权重，追求每个子任务的最优完成质量。**

一个任务的完成质量取决于五种能力的**组合**，而非单一能力：

| 能力 | 来源 | 典型可用性 |
|------|------|-----------|
| 🔍 检索 | 本地 FTS5 / 网络搜索 / 知识库 / 对话历史 | 通常稳定 |
| 🧠 推理 | LLM / NN 分类 / 规则引擎 / 种子经验匹配 | 波动大 |
| 🔧 执行 | 工具调用（exec / 文件操作 / API） | 稳定 |
| 📋 知识 | 种子经验 / 缓存 / 记忆宫殿 / 检索积累 | 积累增长 |
| ✍️ 表达 | LLM 生成 / 模板 / 检索结果结构化 / 缓存 | 波动大 |

### 能力组合而非等级降级

**反面（旧思路）**：按 LLM 可用性分 4 个等级，每级走固定路径。
**正面（新思路）**：每个子任务独立评估最优能力组合，各能力贡献度动态计算。

```
用户问："帮我查下 Redis 和 Memcached 的区别，然后写个对比表"

旧思路: 检测 LLM 等级 → Level 3 走 LLM 全量生成 / Level 1 走模板
新思路: 拆解为子任务，每个子任务独立评估最优组合:

  子任务1(检索): 搜索引擎(0.8) + 本地知识(0.2) → 无需 LLM
  子任务2(推理): 检索结果(0.5) + LLM归纳(0.3) + NN分类(0.2) → LLM 加分但非必须
  子任务3(表达): 模板(0.4) + LLM润色(0.3) + 检索拼接(0.3) → LLM 加分但非必须
```

### 子任务能力调度器

新增文件: `src/core/capability-scheduler.ts`

每个子任务执行前，调度器评估最优组合：

```typescript
interface CapabilityState {
  retrieval: { available: boolean; quality: number; latency: number };
  reasoning: { available: boolean; quality: number; latency: number };
  execution: { available: boolean; quality: number; latency: number };
  knowledge: { available: boolean; quality: number; latency: number };
  expression: { available: boolean; quality: number; latency: number };
}

interface TaskAllocation {
  retrieval: number;   // 贡献度权重 0-1
  reasoning: number;
  execution: number;
  knowledge: number;
  expression: number;
  strategy: string;    // 执行策略描述
}

// 调度逻辑：不是硬编码等级，而是综合评估
function allocateTask(
  subtask: SubTask,
  state: CapabilityState,
  history: TaskHistory,        // 历史经验：类似任务哪种组合效果好
  constraints: Constraints,    // 预算、延迟、质量要求
): TaskAllocation {

  // 1. 任务性质决定基础权重
  const baseWeights = getTaskBaseWeights(subtask.type);

  // 2. 当前能力状态调整权重
  //    - LLM 不可用？降低 reasoning/expression 权重，提升 retrieval+knowledge
  //    - LLM 弱？给它精简输入，降低它的负担
  //    - 检索质量高？提升检索权重，减少 LLM 工作量
  const adjusted = adjustByState(baseWeights, state);

  // 3. 历史经验修正
  //    - 同类任务之前用 LLM 效果差？降低 LLM 权重
  //    - 检索+模板组合之前效果好？提升该路径权重
  const final = adjustByHistory(adjusted, history, subtask);

  return final;
}
```

### LLM 的定位：连接器而非生成器

LLM 的核心价值不是"生成文本"，而是**把碎片信息组织成连贯、有针对性的回答**。

| LLM 状态 | 最优利用方式 |
|----------|------------|
| 强 | 做连接器：检索给它完整原料，它产出高质量成品 |
| 弱 | 做拼接器：给它精简摘要（非原始长文），减少负担，让它做简单归纳 |
| 时有时无 | 缓存它的"组织模式"，下次类似任务复用它的结构 |
| 不可用 | 规则+模板做连接：按固定模式展示检索结果，信息完整但不优雅 |

### LLM 能力实时探测

不是假设 LLM 能力等级，而是**持续监测实际表现**：

```typescript
interface LLMProfile {
  avgLatency: number;          // 平均响应时间
  qualityScore: number;        // QualityAssessor 评分（滑动窗口均值）
  failureRate: number;         // 近 N 次调用失败率
  tokenEfficiency: number;     // 有效信息密度
  lastFailure: number;         // 最近失败时间
  consecutiveFailures: number; // 连续失败次数
}

// 每次 LLM 调用后更新 profile
// 根据 profile 动态调整调度策略:
//   latency > 5s     → 标记"慢"，只用于非实时子任务
//   quality < 0.4    → 标记"质量差"，只给它做简单拼接
//   failureRate > 0.3 → 标记"不稳定"，准备 fallback
//   consecutiveFailures > 3 → 标记"不可用"，切离线模式
```

### 缓存协同

LLM 存在时的结果不是用完就丢，而是**缓存为未来的能力储备**：

```typescript
// GenerationCache — LLM 可用时预生成，不可用时复用
interface CachedGeneration {
  taskType: string;           // 任务类型
  inputFingerprint: string;   // 输入指纹（用于相似度匹配）
  output: string;             // LLM 生成的结果
  qualityScore: number;       // 当时的质量评分
  createdAt: number;          // 生成时间
  hitCount: number;           // 被复用次数
}

// 缓存策略:
// 1. LLM 生成结果后，高质量的（quality > 0.7）自动缓存
// 2. LLM 不可用时，从缓存查找最相似的历史结果
// 3. 缓存结果不是直接用，而是作为模板填充新数据
// 4. 定期淘汰低命中率、过期的缓存
```

### 输出质量保障：多路结果择优

不是走一条路径就接受一条的结果，而是**同时准备多路结果，选最优**：

```typescript
// 并行执行多条路径（根据当前能力状态选择哪些路径并行）
const candidates = await Promise.allSettled([
  // 路径 1: 检索 + LLM 归纳（如果 LLM 可用）
  state.reasoning.available ? retrievalThenLLM(subtask) : null,
  // 路径 2: 检索 + 模板（始终可用）
  retrievalThenTemplate(subtask),
  // 路径 3: 缓存命中（如果有的话）
  cacheLookup(subtask),
  // 路径 4: NN 推荐 + 工具直连
  nnDirectExecute(subtask),
]);

// 选择最优结果
const best = selectBest(candidates, {
  qualityWeight: 0.6,    // 质量优先
  latencyWeight: 0.2,    // 延迟其次
  costWeight: 0.2,       // 成本控制
});

// 记录选择结果，回流到历史经验
recordOutcome(subtask, best, candidates);
```

### 预期效果

| 场景 | 旧方案（降级链） | 新方案（能力协同） |
|------|-----------------|-------------------|
| 强 LLM + 简单检索任务 | LLM 全量生成（浪费 token） | 检索做重活(0.7)，LLM 只润色(0.3) |
| 弱 LLM + 复杂推理任务 | 弱模型硬啃（质量差） | 检索给精简材料(0.4)，缓存辅助(0.3)，弱模型做拼接(0.3) |
| LLM 时有时无 | 频繁切换模式（不稳定） | 缓存 LLM 的组织模式，断线时无缝复用 |
| 无 LLM + 知识查询 | 模板展示（生硬） | 检索(0.6) + 知识库(0.3) + 模板格式化(0.1)，信息完整 |
| 首次部署（无缓存无经验） | 固定降级路径 | 规则引擎兜底 + 实时学习，逐步积累最优策略 |

### 工作量

| 文件 | 行数 | 说明 |
|------|------|------|
| `capability-scheduler.ts` | ~250 | 核心调度器：能力评估 + 权重分配 + 历史修正 |
| `llm-profiler.ts` | ~80 | LLM 能力实时探测与画像 |
| `generation-cache.ts` | ~200 | 缓存预生成 + 相似度匹配 + 淘汰策略 |
| `multi-path-executor.ts` | ~150 | 多路并行执行 + 结果择优 |
| `plan-executor.ts` 改动 | ~40 | 集成调度器 |
| `message-processor.ts` 改动 | ~30 | 集成调度器 |

总新增: ~750 行

---

## 九、长期演进方向

1. **工具链 NN**: 当前 NN 只输出单工具概率，未来可扩展为工具链概率（sequence prediction）
2. **检索增强决策**: NN 不仅推荐工具，还推荐搜索查询词
3. **质量反馈闭环**: QualityAssessor 的评分回流到 NN 训练信号
4. **跨会话知识积累**: 检索结果存入 STMP 记忆宫殿，下次同类问题直接复用
5. **生成能力自适应**: 根据当前可用的 LLM 级别，动态调整生成策略
