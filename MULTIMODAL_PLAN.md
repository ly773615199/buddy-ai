# Buddy 多模态扩展 + Enrichment 完善 — 详细实施计划

> 生成时间: 2026-05-07
> 原则: 只做加法，不重构已有架构

---

## 一、现状深度审计

### 1.1 Enrichment 流程审计

**数据流:**
```
API 返回模型列表
  → enricher.enrich(ids)
    → L1: model-catalog.json (102条，仅SiliconFlow平台)
    → L2: HuggingFace API (需外网)
    → L3: inferFromName (名称推断兜底)
  → 结果: EnrichmentResult { category, parameters, contextLength, ... }
```

**已发现的问题:**

| # | 问题 | 影响 | 位置 |
|---|------|------|------|
| E1 | `shouldIncludeInPool` 排除 `unknown`/`other`，enrichment 全失败时模型被丢弃 | MiMo 等新平台模型无法入池 | model-classifier.ts:108 |
| E2 | pool filter 用本地 `inferCategoryFromName` 而非 enrichment 结果 | enrichment 分类被忽略 | model-discovery.ts:361 |
| E3 | 两个 `inferFromName` 函数不一致 | classifier 版默认 'unknown'，enrichment 版默认 'chat' | model-classifier.ts:87 vs model-enrichment.ts:360 |
| E4 | enrichment 失败时所有元数据为 null | 三脑拿到空画像（contextLength/parameters/modelType 全 null） | model-enrichment.ts:386 |
| E5 | catalog 只覆盖 SiliconFlow，无其他平台 | L1 命中率低 | model-catalog.json |
| E6 | `inferFromName` 不能识别 VL/Omni 模型 | MiMo-VL 等被归为 'chat' 而非 'vl-chat' | model-enrichment.ts:360 |

**现有实现比我的初版方案更好的地方:**
- ✅ 三级 fallback 已经很成熟（catalog → HF API → inferFromName）
- ✅ catalog 有 102 条预构建数据，离线毫秒级
- ✅ enrichment 结果结构完整（category/parameters/contextLength/license/language/likes/downloads）
- ✅ `inferFromName` 默认 'chat' 的设计是对的（API 返回 = 可用）
- ✅ `rawToProfile` 有三层定价优先级（API → LiteLLM → 用户配置）

### 1.2 模型选择流程审计

**数据流:**
```
用户消息
  → inferTaskType(content) → TaskType (chat/tools/reasoning/background/domain)
  → buildModelRequirement(taskType) → ModelRequirement { minCapabilities, requiredFeatures }
  → pool.select(requirement)
    → Layer 0: 静态裁剪（active/excluded/streaming/cost）
    → Layer 1: 元数据快筛（能力分数匹配）
    → Layer 2: Thompson Sampling 选择
  → ModelProfile → ModelConfig
```

**已发现的问题:**

| # | 问题 | 影响 | 位置 |
|---|------|------|------|
| M1 | TaskType 只有 5 种文本类型 | 三脑无法表达"需要图像生成"等意图 | model-router.ts:10 |
| M2 | ModelRequirement 只有文本能力需求 | 漏斗无法按模型类别筛选 | model-pool.ts:168 |
| M3 | layer1MetadataFilter 只按文本能力筛选 | image-gen/tts/asr/embedding 模型即使在池中也选不到 | model-pool.ts:848 |
| M4 | IntentCategory 不含多模态意图 | "画张图" 被归为 conversation/knowledge_query | intent-classifier.ts:14 |
| M5 | CATEGORY_TO_TASK 映射只有文本任务 | 多模态意图无法映射到正确的 TaskType | agent.ts:551 |

**现有实现比我的初版方案更好的地方:**
- ✅ Thompson Sampling 已经很成熟（Beta 分布采样 + 多维反馈加权）
- ✅ 三层漏斗设计合理（静态裁剪 → 元数据快筛 → TS 选择）
- ✅ `ModelProfile` 已有 `category` 字段，只是没被漏斗使用
- ✅ `profileToCapabilities` 已正确处理 toolCallingMode/vision
- ✅ Cascade Routing（失败后排除重选）已实现

### 1.3 多模态基础审计

**已有的多模态能力（不需要改）:**

| 能力 | 实现 | 状态 |
|------|------|------|
| 右脑图像编码 | `brain/right/features/image-encoder.ts` — RawImage + patch 提取 + 空间编码 | ✅ 完整 |
| 右脑多模态预测 | `brain/right/index.ts` — predict() 支持 image/spatial/sceneGraph 输入 | ✅ 可用 |
| TTS 子系统 | `voice/tts.ts` + `voice/edge-tts.ts` — TTSManager 多后端 | ✅ 生产级 |
| 语音工具 | `tools/voice.ts` — tts_speak/tts_voices/tts_status | ✅ 可用 |
| Vision 检测 | `capability-checker.ts` — VISION_KEYWORDS + 覆盖度检查 | ✅ 可用 |
| 模型分类 | `model-enrichment.ts` — 14 种 ModelCategory | ✅ 完整 |
| 能力推断 | `model-knowledge.ts` — inferCapabilities() 从名称推断 | ✅ 可用 |

**缺失的链路:**
- ❌ 模型池过滤排除了非 chat 模型
- ❌ TaskType 无法表达多模态任务
- ❌ 漏斗无法按模型类别选择
- ❌ 没有 image-gen/embedding/asr/ocr 的执行适配器

### 1.4 六大架构模式对照

| 模式 | 项目实现 | 评估 |
|------|---------|------|
| **SubQ SSA 稀疏选择** | `ToolRetriever` — TF-IDF 语义工具检索 + 停用词过滤 + Intl.Segmenter 中文分词 | ✅ 比建议的更好：零依赖、支持中文 |
| **SubAgent 子智能体** | 不适用 — 项目是智能体管理者，不做子任务委派 | ❌ 不需要 |
| **RAG 按需检索** | `KnowledgeExtractor`(六类隐性知识) + `STMPStore`(时空记忆) + `BeliefStore`(信念存储) + `ReasoningChainStore`(推理链) | ✅ 比建议的更丰富：不只是向量检索，有结构化知识类型 |
| **OS 调度** | `TaskQueue`(优先级并发队列+超时) + `ConcurrencyLimiter`(Vegas+AIMD自适应) + `ProviderLimiter`(RPM/TPM滑动窗口) + 熔断机制 | ✅ 比建议的更成熟：借鉴 TCP 拥塞控制 |
| **API 网关治理** | `ProviderLimiter`(per-provider限额) + `ConcurrencyLimiter`(自适应并发) + `model-pool.ts` 熔断(连续3次失败熔断60s恢复) | ✅ 生产级实现 |
| **工作流引擎** | `DAG` + `TaskExecutor`(条件分支+重试+超时+并行) + `WorkflowManager`(持久化+历史) + `DAGPlanner`(LLM意图→DAG) | ✅ 完整实现：支持条件边、重试策略、并行执行 |

**结论: 六大模式在项目中已有成熟实现，不需要重建。多模态扩展只需把现有模块串起来。**

---

## 二、实施计划

### Phase 0: Enrichment 入池逻辑修复 [P0 — 阻塞性]

**目标:** 所有 API 返回的模型都能入池，enrichment 失败不丢模型

#### 改动 1: `src/core/model-classifier.ts`

```typescript
// 改前
const EXCLUDED_CATEGORIES: ModelCategory[] = ['unknown', 'other'];
export function shouldIncludeInPool(category: ModelCategory): boolean {
  return !EXCLUDED_CATEGORIES.includes(category);
}

// 改后
export function shouldIncludeInPool(_category: ModelCategory): boolean {
  return true; // API 返回的模型 = 用户的资源，全部入池
}
```

**理由:**
- 模型池是三脑的"资源库存"，不是"已验证可用列表"
- 三脑才是决策者，入池阶段不应替三脑做判断
- Thompson Sampling 会自然通过成功率筛选好模型

#### 改动 2: `src/core/model-discovery.ts` (两处)

```typescript
// 改前 (line ~361)
const category = inferCategoryFromName(m.id);
if (!shouldIncludeInPool(category)) return null;

// 改后
const enrichment = enrichmentMap.get(m.id);
const category = enrichment?.category ?? inferCategoryFromName(m.id);
// 不再过滤，全部入池
```

**理由:**
- 用 enrichment 结果（更准确）替代本地推断
- 移除 shouldIncludeInPool 检查

同样修改 `discoverOpenAICompatible` 中的对应逻辑 (line ~462)。

#### 改动 3: `src/core/model-enrichment.ts` — `inferFromName` 增强

```typescript
// 增加 VL/Omni/moderation 识别
private inferFromName(sfId: string): EnrichmentResult {
  const lower = sfId.toLowerCase();
  let category: ModelCategory = 'chat';

  // 硬排除（明确非对话）
  if (/bge-|bce-|embed|text-embedding/.test(lower)) category = 'embedding';
  else if (/rerank/.test(lower)) category = 'reranker';
  else if (/tts|cosyvoice|speech/.test(lower)) category = 'tts';
  else if (/asr|sensevoice|whisper/.test(lower)) category = 'asr';
  else if (/dall-e|dalle|stable-diffusion|flux|imagen|kolors|image-edit/.test(lower)) category = 'image-gen';
  else if (/i2v|t2v|wan2|video/.test(lower)) category = 'video-gen';
  else if (/ocr|paddleocr/.test(lower)) category = 'ocr';
  else if (/moderation|text-to-|t2i/.test(lower)) category = 'other';
  // 精确识别（对话子类型）
  else if (/-vl\b|vl-|vision|visual|qwen-vl|internvl|minicpm-v/.test(lower)) category = 'vl-chat';
  else if (/omni|any-to-any|mini-omni/.test(lower)) category = 'omni-chat';
  else if (/instruct|chat|[-_](it|gguf|awq|gptq|fp8|int[48])\b/.test(lower)) category = 'chat';
  // 默认 chat
  else category = 'chat';
  // ... rest unchanged
}
```

同步更新 `src/core/model-classifier.ts` 的 `inferFromName` 保持一致。

#### 改动 4: 测试更新

- `model-enrichment.test.ts`: `shouldIncludeInPool('unknown')` → expect true
- `model-enrichment.test.ts`: `inferFromName('some-random-model')` → expect 'chat'

#### 验证

```bash
cd /root/.openclaw/workspace/buddy && npx vitest run src/core/model-enrichment.test.ts
```

---

### Phase 1: TaskType 多模态扩展 [P0]

**目标:** 三脑能表达"需要图像生成/语音合成/嵌入"等多模态任务

#### 改动 1: `src/core/model-router.ts` — TaskType 扩展

```typescript
// 改前
export type TaskType = 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';

// 改后
export type TaskType = 'chat' | 'tools' | 'reasoning' | 'background' | 'domain'
  | 'image-gen' | 'image-edit' | 'video-gen'
  | 'tts' | 'asr' | 'embedding' | 'ocr' | 'translation';
```

#### 改动 2: `src/core/model-router.ts` — `inferTaskType` 增加多模态关键词

```typescript
// 在现有关键词之后增加
const IMAGE_GEN_KEYWORDS = ['画', '生成图', '画一张', '图片生成', 'draw', 'generate image', 'create image', 'illustration', '设计图', '做一张图'];
const TTS_KEYWORDS = ['念', '读出来', '语音', '朗读', 'speak', 'read aloud', 'tts', '语音合成'];
const ASR_KEYWORDS = ['听', '转录', '语音识别', 'transcribe', 'speech to text', 'stt', '听写'];
const EMBEDDING_KEYWORDS = ['向量化', '嵌入', 'embed', 'vectorize', 'embedding', '向量'];
const OCR_KEYWORDS = ['识别文字', 'ocr', '提取文字', 'read text from image', '图片里的字'];
const TRANSLATION_KEYWORDS = ['翻译', 'translate'];
const VIDEO_GEN_KEYWORDS = ['生成视频', '视频生成', 'generate video', '做视频'];
const IMAGE_EDIT_KEYWORDS = ['编辑图片', '修图', 'image edit', 'p图'];

export function inferTaskType(content: string, context?: Partial<TaskContext>): TaskType {
  if (context?.isBackground) return 'background';
  if (context?.domainMatch) return 'domain';
  const lower = content.toLowerCase();

  // 多模态优先检测（比文本任务更明确）
  if (IMAGE_GEN_KEYWORDS.some(k => lower.includes(k))) return 'image-gen';
  if (VIDEO_GEN_KEYWORDS.some(k => lower.includes(k))) return 'video-gen';
  if (IMAGE_EDIT_KEYWORDS.some(k => lower.includes(k))) return 'image-edit';
  if (TTS_KEYWORDS.some(k => lower.includes(k))) return 'tts';
  if (ASR_KEYWORDS.some(k => lower.includes(k))) return 'asr';
  if (EMBEDDING_KEYWORDS.some(k => lower.includes(k))) return 'embedding';
  if (OCR_KEYWORDS.some(k => lower.includes(k))) return 'ocr';
  if (TRANSLATION_KEYWORDS.some(k => lower.includes(k))) return 'translation';

  // ... 现有文本检测逻辑不变 ...
}
```

#### 改动 3: `src/core/agent.ts` — CATEGORY_TO_TASK 映射扩展

```typescript
// 在 assessTaskComplexity 的 CATEGORY_TO_TASK 中不需要改
// 因为 IntentCategory 不含多模态，多模态由 inferTaskType 直接检测
// 但需要确保 agent.ts 中调用 inferTaskType 时传入正确的上下文
```

**注意:** IntentCategory 不需要扩展。多模态意图通过 `inferTaskType` 的关键词直接识别，不走 IntentCategory → TaskType 的映射。这是更轻量的方案，不改动意图分类器。

#### 验证

```bash
npx vitest run src/core/model-router.test.ts
```

---

### Phase 2: ModelRequirement 多模态能力需求 [P1]

**目标:** 漏斗能按模型类别筛选，三脑选到正确类型的模型

#### 改动 1: `src/core/model-pool.ts` — ModelRequirement 扩展

```typescript
export interface ModelRequirement {
  // ... 现有字段不变 ...
  /** 需要的模型类别（多模态路由核心） */
  preferredCategories?: ModelCategory[];
  /** 排除的模型类别 */
  excludedCategories?: ModelCategory[];
}
```

#### 改动 2: `src/core/model-router.ts` — `buildModelRequirement` 增加多模态 case

```typescript
buildModelRequirement(taskType: TaskType, context?: TaskContext): ModelRequirement {
  // ... 现有逻辑不变 ...

  switch (taskType) {
    // ... 现有 case 不变 ...

    case 'image-gen':
      req.preferredCategories = ['image-gen'];
      break;
    case 'image-edit':
      req.preferredCategories = ['image-edit'];
      break;
    case 'video-gen':
      req.preferredCategories = ['video-gen'];
      break;
    case 'tts':
      req.preferredCategories = ['tts'];
      break;
    case 'asr':
      req.preferredCategories = ['asr'];
      break;
    case 'embedding':
      req.preferredCategories = ['embedding'];
      break;
    case 'ocr':
      // OCR 可以用专用 OCR 模型，也可以用 VL 模型 + prompt
      req.preferredCategories = ['ocr', 'vl-chat'];
      break;
    case 'translation':
      req.preferredCategories = ['translation'];
      break;
  }

  return req;
}
```

#### 改动 3: `src/core/model-pool.ts` — `TASK_CAPABILITY_MAP` 扩展

```typescript
const TASK_CAPABILITY_MAP: Record<TaskType, Partial<Record<CapabilityKey, number>>> = {
  // ... 现有不变 ...
  'image-gen': {},
  'image-edit': {},
  'video-gen': {},
  'tts': {},
  'asr': {},
  'embedding': {},
  'ocr': {},
  'translation': {},
};
```

#### 改动 4: `src/core/model-pool.ts` — `layer1MetadataFilter` 增加类别过滤

```typescript
private layer1MetadataFilter(candidates: ModelProfile[], req: ModelRequirement): ModelProfile[] {
  return candidates.filter((p) => {
    // 新增：类别匹配
    if (req.preferredCategories?.length) {
      const pCat = p.category ?? 'unknown';
      if (!req.preferredCategories.includes(pCat)) return false;
    }
    if (req.excludedCategories?.length) {
      const pCat = p.category ?? 'unknown';
      if (req.excludedCategories.includes(pCat)) return false;
    }

    // ... 现有能力过滤逻辑不变 ...
  });
}
```

#### 改动 5: `src/core/model-pool.ts` — `computeQualityScore` 增加多模态任务

```typescript
private computeQualityScore(profile: ModelProfile, req: ModelRequirement): number {
  // ... 现有 switch 不变 ...

  // 新增：多模态任务的质量分 = 1（有就选，没有就降级）
  if (['image-gen', 'image-edit', 'video-gen', 'tts', 'asr', 'embedding', 'ocr', 'translation'].includes(req.taskType)) {
    return 1.0; // 多模态模型没有质量评分维度，只要匹配类别就满分
  }

  // ... 现有默认逻辑 ...
}
```

---

### Phase 3: 多模态执行适配器 [P2]

**目标:** 选中的多模态模型能实际执行

#### 设计思路

多模态执行不同于文本生成（chat/streamChat），需要：
- **image-gen**: POST 到平台的 image generation endpoint，返回图片 URL/Buffer
- **tts**: 复用已有 `TTSManager`（不走模型池，独立子系统）
- **asr**: POST 到平台的 audio transcription endpoint
- **embedding**: POST 到平台的 embeddings endpoint，返回向量
- **ocr**: 用 VL 模型 + OCR prompt（走 chat 路径，不需要新执行器）

#### 改动: `src/core/llm.ts` — 增加多模态执行入口

```typescript
/**
 * 多模态执行 — 根据 TaskType 路由到对应执行器
 */
async executeMultimodal(
  taskType: TaskType,
  input: string | Buffer,
  options?: MultimodalOptions,
): Promise<MultimodalResult> {
  const selected = this.selectModel(taskType, {});
  const modelId = selected.model;
  const provider = selected.provider;

  switch (taskType) {
    case 'image-gen':
      return this.executeImageGen(provider, modelId, input as string, options);
    case 'tts':
      // 复用已有 TTSManager
      return this.sys.tts.synthesize(input as string, options);
    case 'asr':
      return this.executeASR(provider, modelId, input as Buffer, options);
    case 'embedding':
      return this.executeEmbedding(provider, modelId, input as string, options);
    case 'ocr':
      // OCR 走 VL 模型的 chat 路径
      return this.executeOCRWithVL(selected, input as Buffer, options);
    default:
      throw new Error(`不支持的多模态任务类型: ${taskType}`);
  }
}
```

**关键:** 每个执行器复用 `ConcurrencyLimiter` 和 `ProviderLimiter`，不需要新建流控。

#### 各执行器实现要点

**image-gen:**
- SiliconFlow: `POST /v1/images/generations`
- OpenAI: `POST /v1/images/generations`
- 复用 `ProviderFactory` 的 baseUrl + apiKey

**asr:**
- SiliconFlow: `POST /v1/audio/transcriptions`
- OpenAI: `POST /v1/audio/transcriptions`

**embedding:**
- SiliconFlow: `POST /v1/embeddings`
- OpenAI: `POST /v1/embeddings`

**ocr:**
- 用 VL 模型（如 Qwen-VL）走 chat 路径
- System prompt: "请提取图片中的所有文字"
- 不需要新的 API endpoint

**tts:**
- 已有 `TTSManager`，不需要新实现
- 通过 `tools/voice.ts` 的 `tts_speak` 工具调用

---

### Phase 4: 工具注册 [P3]

**目标:** 多模态能力注册为工具，让 DAG 能编排

#### 改动: `src/tools/builtin.ts` 或新增 `src/tools/multimodal.ts`

```typescript
export const MULTIMODAL_TOOLS: ToolDef[] = [
  {
    name: 'image_generate',
    description: '根据文字描述生成图片',
    parameters: z.object({
      prompt: z.string().describe('图片描述'),
      size: z.string().optional().describe('尺寸，如 1024x1024'),
    }),
    execute: async (args) => { /* 调用 llm.executeMultimodal('image-gen', ...) */ },
  },
  {
    name: 'speech_recognize',
    description: '识别音频中的语音内容',
    parameters: z.object({
      audio_path: z.string().describe('音频文件路径'),
    }),
    execute: async (args) => { /* 调用 llm.executeMultimodal('asr', ...) */ },
  },
  {
    name: 'text_embed',
    description: '将文本转换为向量嵌入',
    parameters: z.object({
      text: z.string().describe('要嵌入的文本'),
    }),
    execute: async (args) => { /* 调用 llm.executeMultimodal('embedding', ...) */ },
  },
  {
    name: 'image_ocr',
    description: '识别图片中的文字',
    parameters: z.object({
      image_path: z.string().describe('图片文件路径'),
    }),
    execute: async (args) => { /* 调用 llm.executeMultimodal('ocr', ...) */ },
  },
];
```

在 `subsystems.ts` 中注册:
```typescript
this.tools.registerMany(MULTIMODAL_TOOLS);
```

---

## 三、不动的部分（确认）

| 模块 | 理由 |
|------|------|
| 三脑架构 (brain.ts) | 右脑已有多模态编码，不需要改 |
| 模型发现 (model-discovery.ts) | API 调用逻辑不变，只改入池过滤 |
| enrichment 流程 | 三级 fallback 不变，只增强 inferFromName |
| Thompson Sampling | 已成熟，多模态任务自然通过成功率学习 |
| DAG 编排引擎 | 已完整，多模态工具注册后自动可编排 |
| 并发控制 / 速率限制 | 已生产级，多模态任务共享基础设施 |
| 工具检索器 | 已有 TF-IDF 语义匹配，新工具自动可检索 |
| 影子大脑 / SwarmManager | 三脑升级用，与多模态执行无关 |

---

## 四、实施顺序与依赖

```
Phase 0 (Enrichment 修复)
  ↓ 无依赖
Phase 1 (TaskType 扩展)
  ↓ 依赖 Phase 0（模型需要在池中才能被选到）
Phase 2 (ModelRequirement + 漏斗)
  ↓ 依赖 Phase 1（需要 TaskType 才能构建 requirement）
Phase 3 (执行适配器)
  ↓ 依赖 Phase 2（需要选到正确模型才能执行）
Phase 4 (工具注册)
  ↓ 依赖 Phase 3（工具调用执行适配器）
```

每个 Phase 完成后可独立验证：
- Phase 0: 检查模型池是否包含所有 API 返回的模型
- Phase 1: 检查 inferTaskType 是否正确识别多模态意图
- Phase 2: 检查三脑是否为 image-gen 任务选到 image-gen 模型
- Phase 3: 检查 image-gen/tts/asr/embedding 是否能实际执行
- Phase 4: 检查 DAG 能否编排多模态工具
