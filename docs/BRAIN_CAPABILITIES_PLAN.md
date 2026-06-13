# 三脑能力补全计划

> 日期: 2026-05-06 | 状态: 待评审 | 更新: 2026-05-06（补充前沿调研）

## 一、现状诊断

三脑架构骨架完整（左脑决策、右脑学习、小脑感知），外围系统丰富（情绪/欲望/人格/记忆/知识/经验/影子大脑）。但系统的感知是**内向的**——对自己的状态感知不错，对外界和自身输出的感知很弱。

### 已有能力矩阵

| 子系统 | 状态 | 感知维度 |
|--------|------|----------|
| SensorFusion | ✅ | 多源事件关联、矛盾检测 |
| BodyState | ✅ | 系统负载、精力、健康度（CPU/内存） |
| EmotionEngine | ✅ | 8 维情绪空间（Plutchik） |
| DesireEngine | ✅ | 六欲（饥饿/求知/社交/安全/表达/休息） |
| BehaviorTracker | ✅ | 用户行为模式 |
| FeedbackLearner | ✅ | 用户纠正/偏好（正则匹配） |
| Clarifier | ✅ | 模糊请求、目标冲突 |
| GapDetector | ✅ | 能力缺口（连续失败检测） |
| KnowledgeExtractor | ✅ | 6 类隐性知识 |
| EnvironmentObserver | ✅ | 项目结构扫描 |

### 缺失能力矩阵

| # | 能力 | 影响面 | 优先级 |
|---|------|--------|--------|
| 1 | 输出质量自评 | 决策反馈闭环 | P0 |
| 2 | 用户状态推断 | 主动行为时机 | P0 |
| 3 | 任务进度感知 | 长任务体验 | P1 |
| 4 | 模型健康探测 | 模型选择可靠性 | P1 |
| 5 | 决策可解释性 | 调试与信任 | P2 |
| 6 | 跨会话学习迁移 | 知识积累效率 | P2 |
| 7 | 主动信息获取 | 任务准备质量 | P2 |
| 8 | 能力覆盖度检查 | 任务可行性预判 | P3 |

---

## 二、详细方案

### 模块 1: OutputQualityAssessor（输出质量自评器）

**问题**: 调用成功 → recordFeedback(success=true)，但成功 ≠ 质量好。代码能跑但有 bug、回答正确但啰嗦、翻译通顺但不准确。

**位置**: `src/brain/cerebellum/quality-assessor.ts`

**接口设计**:
```ts
interface QualityAssessment {
  score: number;                    // 总分 0-1
  dimensions: {
    completeness: number;           // 完整性：输出是否覆盖任务要求
    accuracy: number;               // 准确性：是否包含明显错误
    conciseness: number;            // 简洁性：是否啰嗦冗余
    usability: number;              // 可用性：用户能否直接使用
  };
  level: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failed';
  issues: QualityIssue[];
  suggestion?: string;
}

interface AssessmentContext {
  userRequest: string;              // 原始请求
  taskType: string;                 // 任务类型
  output: string;                   // 模型输出
  executionSuccess: boolean;        // 执行是否成功
  latencyMs: number;                // 耗时
  toolResults?: string[];           // 工具调用结果
  retryCount?: number;              // 重试次数
}
```

**评估逻辑（纯规则，<5ms，不调 LLM）**:
- 完整性：输出为空 -1.0、过短 -0.3、代码任务无代码块 -0.2
- 准确性：错误模式匹配（sorry/I cannot/placeholder）、幻觉信号检测
- 简洁性：输出/请求比 >20x -0.3、内容重复检测
- 可用性：格式化检查、模糊表述过多检测、结构化步骤检测

**权重按任务类型调整**:
- tools: 完整性 0.4 + 准确性 0.3 + 可用性 0.2 + 简洁性 0.1
- reasoning: 准确性 0.4 + 完整性 0.3 + 可用性 0.2 + 简洁性 0.1
- chat: 简洁性 0.3 + 可用性 0.3 + 完整性 0.2 + 准确性 0.2

**接入点**: `ThreeBrain.feedback()` 中，outcome.success 后调用 assessor，将 quality score 注入 FeedbackResult。

**验收标准**:
- [ ] 纯规则评估，无网络调用，<5ms
- [ ] 4 维评分 + 等级 + issues 列表
- [ ] 接入 feedback 闭环，quality score 影响 Thompson Sampling 权重
- [ ] 单元测试覆盖 8 种场景

---

### 模块 2: UserStateInferrer（用户状态推断器）

**问题**: 不知道用户当前是忙是闲、在调试还是在闲聊，导致主动行为时机不当（用户开会时发问候）、回复风格不匹配（用户赶时间给长篇大论）。

**位置**: `src/brain/cerebellum/user-state-inferrer.ts`

**接口设计**:
```ts
type UserState = 'focused'    // 专注工作中（短命令、工具密集）
               | 'exploring'  // 探索中（多问题、长消息）
               | 'chatting'   // 闲聊（短消息、表情多）
               | 'frustrated' // 挫败（否定词、重复请求）
               | 'rushed'     // 赶时间（极短消息、催促词）
               | 'learning'   // 学习中（问为什么、请求解释）
               | 'idle';      // 空闲（长时间无消息）

interface UserStateSignal {
  state: UserState;
  confidence: number;           // 0-1
  signals: string[];            // 触发信号列表
  recommendAction: 'proceed'    // 正常处理
                  | 'brief'     // 简短回复
                  | 'detailed'  // 详细回复
                  | 'wait'      // 不要主动打扰
                  | 'help';     // 主动提供帮助
  sinceLastMessage: number;     // 距上次消息 ms
}
```

**推断逻辑**:
| 状态 | 信号 | 置信度条件 |
|------|------|-----------|
| focused | 消息短(<30字) + 工具密集(>3次/10min) + 连续无间隔 | conf > 0.7 |
| exploring | 消息长(>200字) + 多问号 + 关键词(为什么/怎么/如何) | conf > 0.6 |
| chatting | 消息短 + 表情多 + 无工具调用 + 间隔>5min | conf > 0.6 |
| frustrated | 否定词(不对/错了/重来) + 重复相似请求 + 感叹号 | conf > 0.7 |
| rushed | 极短(<10字) + 催促词(快/赶紧/hurry) + 间隔<30s | conf > 0.6 |
| learning | 问为什么 + 请求解释 + 关键词(原理/区别/对比) | conf > 0.6 |
| idle | 距上次消息 >30min | conf > 0.9 |

**接入点**:
1. `MessageProcessor.processStream()` 入口处调用，结果注入 TaskContext
2. `ProactiveEngine.execute()` 前检查，idle/wait 时不主动打扰
3. `UnifiedScheduler.schedule()` 中，rushed → 强制 budget_fallback（快回复）

**验收标准**:
- [ ] 纯规则推断，无 LLM 调用
- [ ] 7 种状态 + recommendAction
- [ ] 接入消息处理和主动引擎
- [ ] 单元测试覆盖所有状态转换

---

### 模块 3: TaskProgressTracker（任务进度感知器）

**问题**: 长任务（DAG 编排、大文件处理、批量操作）执行时，用户不知道"做到哪了"、"还要多久"。体验上像是卡死了。

**位置**: `src/orchestrate/progress-tracker.ts`

**接口设计**:
```ts
interface TaskProgress {
  taskType: string;
  phase: 'planning' | 'executing' | 'verifying' | 'summarizing';
  steps: ProgressStep[];
  currentStep: number;          // 当前步骤索引
  totalSteps: number;           // 总步骤数
  percentComplete: number;      // 0-100
  estimatedRemainingMs: number; // 预估剩余时间
  elapsedMs: number;            // 已耗时
  stalled: boolean;             // 是否卡住（>30s 无进度）
  stalledReason?: string;
}

interface ProgressStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  result?: string;
}
```

**实现思路**:
- DAG 执行器已有 task 状态跟踪（pending/running/done/failed）
- 包装 TaskExecutor.execute()，在每个 task 状态变更时发射进度事件
- 基于历史同类任务的平均耗时估算剩余时间
- 检测 stalled（>30s 无进度变更）

**接入点**:
1. `TaskExecutor` 的 onEvent 回调中注入进度计算
2. `Agent` 通过 EventBus 发射 `task_progress` 事件给前端
3. stalled 时自动注入 BodyEvent（type: 'task_stalled'），触发小脑调节

**验收标准**:
- [ ] DAG 执行过程中实时更新进度
- [ ] 基于历史数据的剩余时间估算
- [ ] 卡住检测 + 自动报警
- [ ] 进度事件通过 EventBus 发射

---

### 模块 4: ModelHealthProber（模型健康探测器）

**问题**: 模型"活着但变慢了"、"活着但能力退化了"、标签说支持 tool calling 实际不支持。当前只能在调用失败后才知道。

**位置**: `src/core/model-health-prober.ts`

**接口设计**:
```ts
interface HealthProbeResult {
  modelId: string;
  reachable: boolean;           // 是否可达
  latencyMs: number;            // 探测延迟
  quality: 'healthy' | 'degraded' | 'unhealthy';
  capabilities: {
    toolCallingVerified: boolean; // 实测是否支持 tool calling
    visionVerified: boolean;      // 实测是否支持 vision
  };
  lastProbedAt: number;
  probeCount: number;
  consecutiveFailures: number;
}

interface ProbeConfig {
  /** 探测间隔 ms（默认 10 分钟） */
  intervalMs: number;
  /** 探测超时 ms（默认 10s） */
  timeoutMs: number;
  /** 延迟阈值：超过此值标记 degraded（默认 5s） */
  degradedThresholdMs: number;
  /** 连续失败阈值：超过此值标记 unhealthy（默认 3） */
  unhealthyThreshold: number;
  /** 是否启用 */
  enabled: boolean;
}
```

**探测策略**:
- 轻量探测：发一个极短 prompt（"hi"），测延迟和可达性
- 能力探测：发一个带 tool definition 的请求，验证是否返回 tool_calls
- 不测质量（那是 QualityAssessor 的事），只测"能不能用"
- 后台异步，不阻塞任何主流程

**数据流**:
```
探测结果 → ModelProfile 更新（probeLatency/probeHealth）
         → ModelPool.layer1MetadataFilter 增加健康度过滤
         → Thompson Sampling 权重调整（unhealthy 模型降权）
```

**接入点**:
1. `ModelKnowledgeUpdater` 定时刷新时同步探测
2. `ModelPool.layer0StaticFilter()` 增加 unhealthy 过滤
3. 探测结果写入 ModelProfile 的新字段

**验收标准**:
- [ ] 轻量探测 <10s，不影响主流程
- [ ] 能力验证（tool calling 实测）
- [ ] unhealthy 模型自动降权/过滤
- [ ] 探测结果持久化

---

### 模块 5: DecisionExplainer（决策可解释器）

**问题**: 用户问"为什么选这个模型"答不清楚；开发者调试时不知道决策链经过了哪些过滤。

**位置**: `src/core/decision-explainer.ts`

**接口设计**:
```ts
interface DecisionTrace {
  /** 决策 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 输入信号 */
  input: {
    taskType: string;
    complexity: string;
    domains: string[];
    languagePreference?: string;
  };
  /** 漏斗经过的层 */
  layers: TraceLayer[];
  /** 最终选择 */
  result: {
    modelId: string;
    provider: string;
    reason: string;
    confidence: number;
    source: string;
  };
  /** 被过滤掉的候选（top 5） */
  filtered: Array<{ modelId: string; filteredBy: string; reason: string }>;
  /** 总耗时 */
  totalMs: number;
}

interface TraceLayer {
  name: string;                 // 'static_filter' | 'metadata_filter' | 'thompson_select'
  inputCount: number;           // 进入该层的候选数
  outputCount: number;          // 通过的候选数
  filters: Array<{              // 应用的过滤条件
    condition: string;
    passed: boolean;
    affected: number;           // 被此条件过滤的数量
  }>;
  durationMs: number;
}
```

**实现思路**:
- 在 `ModelPool.selectFromUnified()` 中，每层漏斗记录 TraceLayer
- `layer0StaticFilter` 记录黑名单/streaming/成本过滤
- `layer1MetadataFilter` 记录每个能力阈值过滤
- `layer2ThompsonSelect` 记录采样值排名
- Trace 存入 DecisionRecorder，可通过 API 查询

**接入点**:
1. `ModelPool.selectFromUnified()` 增加 trace 参数
2. `ModelRouter.select()` 返回时附带 trace
3. 前端可通过 `GET /api/decision-trace/:id` 查询

**验收标准**:
- [ ] 每次决策生成完整 trace
- [ ] 记录每层过滤的具体原因
- [ ] 可查询最近 N 次决策 trace
- [ ] 性能开销 <1ms

---

### 模块 6: CrossSessionLearner（跨会话学习迁移）

**问题**: A session 学到的模型偏好不能帮 B session。Thompson Sampling 参数随 session 结束丢失。

**位置**: `src/core/cross-session-learner.ts`

**接口设计**:
```ts
interface GlobalThompsonParams {
  /** 按 (taskType, modelId) 聚合 */
  key: string;
  alpha: number;
  beta: number;
  totalSamples: number;
  lastUpdated: number;
  /** 来源 session 列表（最多保留最近 10 个） */
  sourceSessions: string[];
}

interface LearningTransfer {
  /** 从全局参数初始化本地 Thompson */
  initializeLocal(globalKey: string): { alpha: number; beta: number } | null;
  /** 将本地结果上报全局 */
  reportOutcome(taskType: string, modelId: string, success: boolean, latencyMs: number): void;
  /** 获取全局统计 */
  getGlobalStats(): { totalKeys: number; totalSamples: number };
}
```

**实现思路**:
- 持久化到 `data/global-thompson.json`（与 ModelPool 的 unified state 同级）
- 启动时加载全局参数，作为本地 Thompson 的 prior
- 每次 recordFeedback 时同步写入全局
- 全局参数用指数衰减（老数据权重降低），避免过时偏好污染

**接入点**:
1. `ModelPool.recordFeedback()` 中同步调用 `reportOutcome()`
2. `ModelPool.initializeFromProviders()` 后加载全局 prior
3. `ModelPool.selectFromUnified()` 的 layer2 中，全局 prior 作为初始 alpha/beta

**验收标准**:
- [ ] 全局 Thompson 参数持久化
- [ ] 新 session 启动时自动加载全局 prior
- [ ] 指数衰减防止过时数据污染
- [ ] 多 session 并发写入不冲突

---

### 模块 7: ProactiveResearcher（主动信息获取器）

**问题**: 三脑只从已有池子里选模型，不会主动获取任务所需的上下文信息。用户问"部署到阿里云"，三脑不会主动查阿里云文档。

**位置**: `src/core/proactive-researcher.ts`

**接口设计**:
```ts
interface ResearchRequest {
  query: string;                // 搜索关键词
  context: string;              // 当前任务上下文
  depth: 'quick' | 'standard'; // 深度
  maxResults: number;
}

interface ResearchResult {
  query: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    relevance: number;          // 0-1
  }>;
  summary: string;              // LLM 生成的摘要
  fetchedAt: number;
  cacheHit: boolean;
}

interface ProactiveResearcher {
  /** 判断是否需要主动研究 */
  shouldResearch(userRequest: string, taskType: string): boolean;
  /** 执行研究 */
  research(request: ResearchRequest): Promise<ResearchResult>;
  /** 缓存管理 */
  getCached(query: string): ResearchResult | null;
  clearCache(): void;
}
```

**触发条件**:
- 用户请求包含未知实体（地名、产品名、API 名）
- 用户请求涉及最新信息（"最新的"、"2026年"）
- 用户请求涉及部署/配置（"部署到"、"配置"）
- 不触发：纯聊天、已知工具调用、代码生成

**实现思路**:
- 用 `mimo_web_search` 或已有的 `web.ts` 工具执行搜索
- 结果缓存 1 小时
- 搜索结果注入 LLM 上下文（作为 system message 的一部分）
- 不阻塞主流程，超时 5s 放弃

**接入点**:
1. `MessageProcessor.processStream()` 中，判断 shouldResearch → 异步 research
2. 研究结果注入 TaskContext 的新字段 `researchContext`
3. LLM 调用时将 researchContext 作为额外上下文

**验收标准**:
- [ ] 自动识别需要研究的请求
- [ ] 搜索结果缓存 1 小时
- [ ] 超时 5s 自动放弃，不阻塞
- [ ] 研究结果注入 LLM 上下文

---

### 模块 8: CapabilityCoverageChecker（能力覆盖度检查）

**问题**: 池子里没有 vision 模型但接了图片任务，不知道该拒绝还是降级处理。

**位置**: `src/core/capability-checker.ts`

**接口设计**:
```ts
interface CapabilityRequirement {
  needsVision: boolean;
  needsToolCalling: boolean;
  needsNativeToolCalling: boolean;
  minContextTokens: number;
  languagePreference: 'chinese' | 'english' | 'any';
}

interface CoverageReport {
  requirement: CapabilityRequirement;
  coverage: {
    vision: { available: boolean; models: string[] };
    toolCalling: { available: boolean; models: string[] };
    nativeToolCalling: { available: boolean; models: string[] };
    contextLength: { available: boolean; models: string[] };
    language: { available: boolean; models: string[] };
  };
  overallCoverage: number;      // 0-1
  gaps: string[];               // 缺失的能力列表
  recommendation: 'proceed'     // 能力足够
                 | 'degrade'    // 可以降级处理
                 | 'reject';    // 应该拒绝并告知用户
}
```

**实现思路**:
- 从 ModelPool.getAllProfiles() 分析当前能力覆盖
- 从用户请求中提取 CapabilityRequirement（关键词匹配 + enrichment 数据）
- 计算覆盖率，识别 gaps
- coverage < 0.5 → reject，0.5-0.8 → degrade，>0.8 → proceed

**接入点**:
1. `MessageProcessor.processStream()` 入口处检查
2. reject 时生成友好提示（"当前没有支持图片的模型，建议添加..."）
3. degrade 时调整 ModelRequirement（放宽约束）

**验收标准**:
- [ ] 从请求中自动提取能力需求
- [ ] 基于实际模型池计算覆盖率
- [ ] reject/degrade/proceed 三级决策
- [ ] reject 时给出具体建议

---

## 三、实施顺序

```
Phase 1（核心闭环，1-2 天）
├── Module 1: OutputQualityAssessor    ← 直接补全反馈闭环
├── Module 2: UserStateInferrer        ← 影响回复风格和主动行为
└── Module 8: CapabilityCoverageChecker ← 任务可行性预判

Phase 2（可靠性，1-2 天）
├── Module 4: ModelHealthProber        ← 模型选择可靠性
├── Module 3: TaskProgressTracker      ← 长任务体验
└── Module 5: DecisionExplainer        ← 调试与信任

Phase 3（进化，2-3 天）
├── Module 6: CrossSessionLearner      ← 知识积累效率
└── Module 7: ProactiveResearcher      ← 任务准备质量
```

## 四、与现有系统的集成关系

```
用户消息
  │
  ├─→ Module 8: CapabilityCoverageChecker（能否处理？）
  │     └─ reject → 告知用户
  │
  ├─→ Module 2: UserStateInferrer（用户什么状态？）
  │     └─ rushed → 简短回复 / idle → 不打扰
  │
  ├─→ Module 7: ProactiveResearcher（需要查资料吗？）
  │     └─ 注入 researchContext
  │
  ├─→ ThreeBrain.decide()（三脑决策）
  │     ├─→ Module 5: DecisionExplainer（记录决策 trace）
  │     └─→ Module 4: ModelHealthProber（模型健康？）
  │
  ├─→ TaskExecutor.execute()（执行）
  │     └─→ Module 3: TaskProgressTracker（进度？）
  │
  └─→ ThreeBrain.feedback()（反馈）
        ├─→ Module 1: OutputQualityAssessor（质量？）
        └─→ Module 6: CrossSessionLearner（记住）
```

## 五、文件清单

| 模块 | 新增文件 | 修改文件 |
|------|----------|----------|
| 1. QualityAssessor | `src/brain/cerebellum/quality-assessor.ts` | `src/brain/brain.ts` |
| 2. UserStateInferrer | `src/brain/cerebellum/user-state-inferrer.ts` | `src/core/message-processor.ts`, `src/core/proactive-engine.ts` |
| 3. ProgressTracker | `src/orchestrate/progress-tracker.ts` | `src/orchestrate/executor.ts` |
| 4. HealthProber | `src/core/model-health-prober.ts` | `src/core/model-pool.ts`, `src/core/model-knowledge-updater.ts` |
| 5. DecisionExplainer | `src/core/decision-explainer.ts` | `src/core/model-pool.ts`, `src/core/model-router.ts` |
| 6. CrossSessionLearner | `src/core/cross-session-learner.ts` | `src/core/model-pool.ts` |
| 7. ProactiveResearcher | `src/core/proactive-researcher.ts` | `src/core/message-processor.ts` |
| 8. CapabilityChecker | `src/core/capability-checker.ts` | `src/core/message-processor.ts` |

测试文件：每个模块对应一个 `.test.ts`。

## 六、验收标准总览

- [ ] 所有新模块有单元测试，覆盖率 >80%
- [ ] 不引入新的外部依赖
- [ ] 纯规则评估模块（1/2/5/8）无 LLM 调用，<5ms
- [ ] 有 LLM 调用的模块（7）有超时降级
- [ ] 向后兼容：现有 API 和数据格式不变
- [ ] 所有现有测试继续通过

---

## 七、前沿调研补充（2026-05-06）

基于 2024-2026 年相关研究，对计划进行以下补充。所有补充均为现有模块的增强，不改变整体架构。

### 7.1 自我反思增强 → 模块 ① OutputQualityAssessor

**依据：**
- *Self-Reflection in LLM Agents* (arXiv:2405.06682, FLLM 2024)：9 个主流 LLM 自我反思后问题解决能力显著提升 (p < 0.001)
- *A Self-Improving Coding Agent* (arXiv:2504.15228, NeurIPS 2025 提交)：Agent 自主编辑自身代码，SWE-Bench Verified 提升 17%~53%

**补充内容：**

在纯规则评估基础上增加可选的 LLM 反思路径：

```
规则评估 score < 0.5 → 触发轻量 LLM 自我反思（不替换规则评估，作为二级提升）
```

**新增接口：**
```ts
interface ReflectionTrigger {
  /** 是否触发反思（score < threshold） */
  shouldReflect: boolean;
  /** 反思 prompt（注入 LLM） */
  reflectionPrompt: string;
  /** 反思后是否需要重新执行 */
  needsReExecution: boolean;
}
```

**实现要点：**
- 反思不做每次都做，只在"可疑输出"（score < 0.5）时触发
- 反思 prompt 模板：`"以下是用户请求和你的输出，请检查是否有错误或遗漏：\n用户: {request}\n输出: {output}\n请指出问题并给出改进建议。"`
- 反思结果记录到 DecisionRecorder，用于后续 Thompson Sampling 权重调整
- 成本可控：仅 ~5% 的输出会触发反思

### 7.2 统一路由与级联 → ModelPool 三级漏斗

**依据：**
- *A Unified Approach to Routing and Cascading for LLMs* (arXiv:2410.10347, ACL 2025)：提出 Cascade Routing 统一框架，大幅超越单独路由或级联。核心发现：**质量估计器是模型选择成功的关键因素**

**补充内容：**

在 `selectFromUnified()` 的三级漏斗中增加"预估质量"维度：

```ts
// 当前 Layer 2: Thompson Sampling 采样值
// 增强: sample *= qualityEstimate(profile, requirement)

interface QualityEstimator {
  /** 基于历史数据预估模型在该任务上的输出质量 */
  estimate(profile: ModelProfile, requirement: ModelRequirement): number;
}
```

**实现要点：**
- 质量估计器使用 `profile.stats.byTaskType[taskType]` 的历史成功率
- 冷启动（无历史数据）时使用 `profile.capabilities` 的加权分数作为先验
- `executeCascade()` 中的质量检查从简单启发式升级为同一估计器
- 与模块 ④ ModelHealthProber 联动：unhealthy 模型的质量估计自动降权

### 7.3 用户挫败感检测 → 模块 ② UserStateInferrer

**依据：**
- *Handling User Frustration and Emotional Escalation* (EvoMap, 2026)：Agent 反复出错时用户沮丧，需要检测挫败感并调整策略

**补充内容：**

在 `frustrated` 状态的信号检测中增加以下维度：

| 信号 | 来源 | 权重 |
|------|------|------|
| 否定词（不对/错了/不不不） | FeedbackLearner 已有 | 0.3 |
| 连续失败 ≥ 3 次 | GapDetector 数据 | 0.3 |
| 消息长度骤降（最近 3 条均值 < 前 10 条的 30%） | 消息历史 | 0.2 |
| 重复相似请求 | BehaviorTracker.detectRepeat() 已有 | 0.2 |

**置信度计算：**
```
frustratedConfidence = Σ(signal_weight * signal_active)
frustratedConfidence ≥ 0.6 → 推断 frustrated → recommendAction: 'brief' + 'help'
```

### 7.4 进度感知冷启动 → 模块 ③ TaskProgressTracker

**依据：**
- *OrchDAG* (arXiv:2510.24663, 2025)：DAG 编排中的进度跟踪与依赖管理

**补充内容：**

剩余时间估算的冷启动策略：

```ts
interface ETAEstimator {
  /** 历史同类任务的完成时间 */
  history: Map<string, number[]>; // taskType → [duration1, duration2, ...]

  /** 估算剩余时间 */
  estimate(taskType: string, elapsedMs: number, totalSteps: number, completedSteps: number): number {
    const history = this.history.get(taskType) ?? [];
    if (history.length < 3) {
      // 冷启动：用中位数估算
      const medianStepMs = elapsedMs / Math.max(1, completedSteps);
      return medianStepMs * (totalSteps - completedSteps);
    }
    // 积累后：用 EWMA
    const avgDuration = ewma(history);
    const progress = completedSteps / totalSteps;
    return avgDuration * (1 - progress);
  }
}
```

**实现要点：**
- 从 `DecisionRecorder` 获取历史同类任务的执行时间
- 前 3 次用中位数，之后切换到 EWMA（alpha=0.3）
- 卡住检测阈值：30 秒无进度变更 → 标记 stalled

### 7.5 多粒度衰减 → 模块 ⑥ CrossSessionLearner

**依据：**
- *LD-Agent* (NAACL 2025) + *Mem-PAL* (arXiv:2511.13410)：长期对话中的个性化记忆管理，多粒度衰减策略

**补充内容：**

Thompson Sampling 参数的全局持久化增加多粒度衰减：

```ts
interface GlobalThompsonParams {
  key: string;
  alpha: number;
  beta: number;
  totalSamples: number;
  lastUpdated: number;
  sourceSessions: string[];
  /** 新增：衰减粒度 */
  decayProfile: {
    /** 短期衰减（24小时内）：快速遗忘过时偏好 */
    shortTerm: { halfLifeMs: 86_400_000; alpha: number };
    /** 长期衰减（7天以上）：缓慢遗忘稳定偏好 */
    longTerm: { halfLifeMs: 604_800_000; alpha: number };
  };
}
```

**实现要点：**
- 启动时加载全局参数，按 `lastUpdated` 计算衰减
- 24 小时内的数据用短期衰减（快速适应新偏好）
- 7 天以上的数据用长期衰减（保留稳定模式）
- 多 session 并发写入：用文件锁（`proper-lockfile`）或写入临时文件后原子 rename

### 7.6 情绪趋势预测 → BodyStateManager

**依据：**
- *Context-Aware Sentiment Forecasting* (arXiv:2505.24331, 2025)：多视角情感预测

**补充内容：**

在 BodyStateManager 中增加情绪趋势预测（不需要额外模型，纯规则）：

```ts
interface EmotionTrend {
  /** 最近 N 条消息的情绪效价序列 */
  valenceHistory: number[];
  /** 趋势方向：rising / falling / stable */
  direction: 'rising' | 'falling' | 'stable';
  /** 预测下一步效价 */
  predictedValence: number;
  /** 置信度 */
  confidence: number;
}
```

**实现要点：**
- 从 `emotionHistory`（已有，最近 50 条）提取效价序列
- 用最近 5 条的线性回归预测下一步
- `direction` 判断：斜率 > 5 → rising，< -5 → falling，否则 stable
- 预测结果注入 `getPromptInjection()`：`"用户情绪正在恶化，建议简洁回复"`

### 7.7 调研来源汇总

| # | 论文/来源 | 年份 | 关联模块 |
|---|-----------|------|----------|
| 1 | Self-Reflection in LLM Agents (arXiv:2405.06682) | 2024 | ① QualityAssessor |
| 2 | A Self-Improving Coding Agent (arXiv:2504.15228) | 2025 | ① QualityAssessor |
| 3 | Unified Routing and Cascading (arXiv:2410.10347) | 2025 | ModelPool 漏斗 |
| 4 | OrchDAG (arXiv:2510.24663) | 2025 | ③ ProgressTracker |
| 5 | LD-Agent (NAACL 2025) | 2025 | ⑥ CrossSessionLearner |
| 6 | Mem-PAL (arXiv:2511.13410) | 2025 | ⑥ CrossSessionLearner |
| 7 | Handling User Frustration (EvoMap) | 2026 | ② UserStateInferrer |
| 8 | Context-Aware Sentiment Forecasting (arXiv:2505.24331) | 2025 | BodyStateManager |
| 9 | Inferring Latent Intentions (arXiv:2601.08742) | 2026 | ② UserStateInferrer |

### 7.8 更新后的实施顺序

```
Phase 1（核心闭环，1-2 天）
├── Module 1: OutputQualityAssessor + 自我反思增强    ← 补充 7.1
├── Module 2: UserStateInferrer + 挫败感检测增强      ← 补充 7.3
└── Module 8: CapabilityCoverageChecker

Phase 2（可靠性，1-2 天）
├── Module 4: ModelHealthProber + 质量估计器联动      ← 补充 7.2
├── Module 3: TaskProgressTracker + 冷启动策略        ← 补充 7.4
└── Module 5: DecisionExplainer

Phase 3（进化，2-3 天）
├── Module 6: CrossSessionLearner + 多粒度衰减        ← 补充 7.5
├── Module 7: ProactiveResearcher
└── BodyStateManager: 情绪趋势预测                    ← 补充 7.6
```
