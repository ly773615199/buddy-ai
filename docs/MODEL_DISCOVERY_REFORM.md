# 模型发现与过滤重构方案

> 日期: 2026-05-06 | 状态: 待评审

## 1. 问题

当前 `model-discovery.ts` 用**硬编码 exclude 列表**过滤模型：

```ts
// 现状：猜名字
const excludes = ['embedding', 'embed', 'tts', 'image', 'instruct', ...];
if (excludes.some(e => id.includes(e))) return false;
```

**缺陷：**
- `'instruct'` 误杀 14 个 Instruct 聊天模型
- `'image'` 误杀 VL 模型
- `'embed'` 匹配不到 `bge-`、`bce-` 等变体
- 新模型上线需要手动更新规则
- 换平台（OpenRouter、DeepSeek）规则全部失效

## 2. 方案：HuggingFace 元数据驱动

### 核心思路

SiliconFlow 包的都是开源模型，ID 格式 `{org}/{model}` 与 HuggingFace 一致。
通过 HuggingFace API 获取**模型发布方标注的官方元数据**，用 `pipeline_tag` 做分类判断。

### 数据源优先级

```
L1  HuggingFace API 结构化数据  → pipeline_tag, parameters, model_type
L2  HuggingFace README 解析     → context_length, max_output
L3  LiteLLM 社区数据            → pricing, 补充能力标注
L4  平台 API 原始数据            → SiliconFlow 返回的有限字段
L5  名称推断 (fallback)          → 兜底规则
```

### pipeline_tag 分类映射

| pipeline_tag | 模型池分类 | 是否加入模型池 |
|---|---|---|
| `text-generation` | `chat` | ✅ |
| `image-text-to-text` | `vl-chat` | ✅ |
| `any-to-any` | `omni-chat` | ✅ |
| `visual-question-answering` | `vl-chat` | ✅ |
| `question-answering` | `chat` | ✅ |
| `conversational` | `chat` | ✅ |
| `text-to-image` | `image-gen` | ❌ |
| `image-to-image` | `image-edit` | ❌ |
| `text-to-video` | `video-gen` | ❌ |
| `image-to-video` | `video-gen` | ❌ |
| `text-to-speech` | `tts` | ❌ |
| `audio-to-audio` | `audio` | ❌ |
| `audio-to-text` | `asr` | ❌ |
| `feature-extraction` | `embedding` | ❌ |
| `sentence-similarity` | `embedding` | ❌ |
| `text-ranking` | `reranker` | ❌ |
| `text-classification` | `reranker` | ❌ |
| `fill-mask` | `mlm` | ❌ |
| `translation` | `translation` | ⚠️ 按需 |
| *未匹配* | fallback 规则 | 按名字推断 |

## 3. 架构设计

### 模块划分

```
src/core/
├── model-discovery.ts          # 现有：平台 API 模型列表获取
├── model-enrichment.ts         # 新增：HuggingFace 元数据增强
├── model-classifier.ts         # 新增：模型分类逻辑（从 discovery 拆出）
├── model-pool.ts               # 现有：统一模型池（接入 enrichment 数据）
└── model-knowledge-updater.ts  # 现有：后台刷新器（调用 enrichment）
```

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    添加 API 端点                              │
│  POST /api/model-pool/providers                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 1: 平台 API 获取模型列表                                │
│  ┌─────────────────────────────────────┐                     │
│  │ SiliconFlow /v1/models              │                     │
│  │ → [{id, object, created, owned_by}] │                     │
│  └─────────────────────────────────────┘                     │
└──────────────────────┬───────────────────────────────────────┘
                       │ 102 个原始模型
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 2: HuggingFace 元数据增强 (新增)                        │
│  ┌─────────────────────────────────────┐                     │
│  │ 对每个模型 ID:                      │                     │
│  │  1. 解析 HF repo 路径               │                     │
│  │     Pro/Qwen/xxx → Qwen/xxx         │                     │
│  │     zai-org/GLM → THUDM/GLM         │                     │
│  │  2. 查 HF API (/api/models/{id})   │                     │
│  │     → pipeline_tag, params, type    │                     │
│  │  3. 查 HF README (可选)             │                     │
│  │     → context_length, max_output    │                     │
│  │  4. 缓存结果 (7天TTL)              │                     │
│  └─────────────────────────────────────┘                     │
│  并发控制: 5 并发, 350ms 批间隔                               │
│  超时: 单个 10s, 整批 120s                                    │
└──────────────────────┬───────────────────────────────────────┘
                       │ 95/102 匹配 (93%)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 3: 模型分类 (新增)                                      │
│  ┌─────────────────────────────────────┐                     │
│  │ if pipeline_tag ∈ CHAT_TAGS:        │                     │
│  │   → 加入模型池                      │                     │
│  │ elif pipeline_tag ∈ EXCLUDE_TAGS:   │                     │
│  │   → 排除                            │                     │
│  │ else:                               │                     │
│  │   → fallback 名称推断               │                     │
│  └─────────────────────────────────────┘                     │
└──────────────────────┬───────────────────────────────────────┘
                       │ 71 个聊天模型
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 4: 写入统一模型池                                       │
│  ┌─────────────────────────────────────┐                     │
│  │ ModelProfile 增强字段:              │                     │
│  │  - category: 'chat'|'vl-chat'|...   │                     │
│  │  - parameters: 7615616512           │                     │
│  │  - contextLength: 131072            │                     │
│  │  - maxOutput: 8192                  │                     │
│  │  - modelType: 'qwen2'              │                     │
│  │  - license: 'apache-2.0'           │                     │
│  │  - pipelineTag: 'text-generation'  │                     │
│  │  - hfId: 'Qwen/Qwen2.5-7B-Inst..' │                     │
│  │  - enrichmentSource: 'hf_api'      │                     │
│  └─────────────────────────────────────┘                     │
│  三脑决策可用字段:                                             │
│  - 参数量 → 推理能力评估                                      │
│  - 上下文长度 → 任务匹配                                      │
│  - 架构族 → 能力特征                                          │
│  - 许可证 → 合规检查                                          │
└──────────────────────────────────────────────────────────────┘
```

## 4. 关键实现

### 4.1 model-enrichment.ts (新增)

```ts
/**
 * HuggingFace 元数据增强器
 *
 * 职责：给模型列表补充 HuggingFace 官方元数据
 * 数据源：hf-mirror.com API + README 解析
 */

interface EnrichmentResult {
  pipelineTag: string;        // text-generation, image-text-to-text, ...
  modelType: string;          // qwen2, deepseek_v3, ...
  parameters: number | null;  // 参数量
  contextLength: number | null;
  maxOutput: number | null;
  tags: string[];             // chat, conversational, ...
  license: string | null;
  language: string[] | null;
  likes: number;
  downloads: number;
  hfId: string | null;        // 匹配到的 HuggingFace repo
  source: 'hf_api' | 'hf_readme' | 'inferred' | 'cache';
}

interface ModelEnricher {
  /**
   * 批量增强模型元数据
   * @param modelIds 硅基流动模型 ID 列表
   * @param concurrency 并发数 (默认 5)
   * @returns Map<modelId, EnrichmentResult>
   */
  enrich(modelIds: string[], concurrency?: number): Promise<Map<string, EnrichmentResult>>;

  /** 清除缓存 */
  clearCache(): void;

  /** 获取缓存状态 */
  getCacheStatus(): { entries: number; totalSize: number };
}
```

**核心逻辑：**

```ts
// HF repo 路径解析
function resolveHFRepo(sfId: string): string[] {
  const candidates = new Set<string>();

  // 1. 原始 ID
  candidates.add(sfId);

  // 2. 去掉 Pro/ LoRA/ 前缀
  for (const prefix of ['Pro/', 'LoRA/']) {
    if (sfId.startsWith(prefix)) candidates.add(sfId.slice(prefix.length));
  }

  // 3. 已知映射表 (可配置)
  if (KNOWN_MAP[sfId]) candidates.add(KNOWN_MAP[sfId]);

  // 4. 平台特定规则 (zai-org → THUDM)
  if (sfId.includes('zai-org/GLM')) {
    const model = sfId.split('/').pop();
    candidates.add(`THUDM/${model}`);
  }

  return [...candidates];
}

// 上下文长度提取 (从 README)
function extractContextLength(readme: string): {
  contextLength: number | null;
  maxOutput: number | null;
} {
  // 模式1: "Context Length: Full 131,072 tokens"
  // 模式2: "up to 128K tokens"
  // 模式3: "max_position_embeddings: 131072"
  // 模式4: 上下文相关段落中的数字
}
```

### 4.2 model-classifier.ts (新增)

```ts
/**
 * 模型分类器
 *
 * 职责：根据元数据判断模型用途，决定是否加入模型池
 */

type ModelCategory =
  | 'chat'        // 纯文本聊天
  | 'vl-chat'     // 视觉语言聊天
  | 'omni-chat'   // 全模态聊天
  | 'embedding'   // 向量嵌入
  | 'reranker'    // 重排序
  | 'image-gen'   // 图像生成
  | 'image-edit'  // 图像编辑
  | 'video-gen'   // 视频生成
  | 'tts'         // 语音合成
  | 'asr'         // 语音识别
  | 'translation' // 翻译
  | 'ocr'         // OCR
  | 'other'       // 其他
  | 'unknown';    // 未识别

// 聊天模型 pipeline_tag 白名单
const CHAT_TAGS = new Set([
  'text-generation',
  'image-text-to-text',
  'any-to-any',
  'visual-question-answering',
  'question-answering',
  'conversational',
]);

// 排除的 pipeline_tag
const EXCLUDE_TAGS = new Set([
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'text-to-speech', 'audio-to-audio', 'audio-to-text',
  'feature-extraction', 'sentence-similarity',
  'text-ranking', 'text-classification', 'fill-mask',
]);

function classify(enrichment: EnrichmentResult): ModelCategory {
  const tag = enrichment.pipelineTag;

  // 精确匹配
  if (CHAT_TAGS.has(tag)) {
    if (tag === 'image-text-to-text') return 'vl-chat';
    if (tag === 'any-to-any') return 'omni-chat';
    return 'chat';
  }

  if (EXCLUDE_TAGS.has(tag)) {
    if (tag.startsWith('text-to-image') || tag === 'image-to-image') return 'image-gen';
    if (tag.includes('video')) return 'video-gen';
    if (tag === 'text-to-speech') return 'tts';
    if (tag.includes('audio')) return 'asr';
    if (tag.includes('embedding') || tag === 'sentence-similarity') return 'embedding';
    if (tag === 'text-ranking' || tag === 'text-classification') return 'reranker';
    return 'other';
  }

  // Fallback: tags 推断
  const tags = enrichment.tags.map(t => t.toLowerCase());
  if (tags.includes('chat') || tags.includes('conversational')) return 'chat';

  // Fallback: 名称推断
  return inferFromName(enrichment.hfId || '');
}

// 模型池过滤入口
function shouldIncludeInPool(category: ModelCategory): boolean {
  return ['chat', 'vl-chat', 'omni-chat'].includes(category);
}
```

### 4.3 model-discovery.ts (修改)

```ts
// 改动：在 discoverModels 中加入 enrichment 步骤

export async function discoverModels(config: PlatformConfig): Promise<DiscoveryResult> {
  // ... 现有逻辑：从平台 API 获取模型列表 ...

  const rawModels = meta.extractModels(data);

  // ── 新增：HuggingFace 元数据增强 ──
  const enricher = getModelEnricher();
  const enrichmentMap = await enricher.enrich(rawModels.map(m => m.id));

  // ── 修改：用 pipeline_tag 替代 isValidChatModel ──
  const models = rawModels
    .map(m => {
      const enrichment = enrichmentMap.get(m.id);
      const category = enrichment ? classify(enrichment) : inferFromName(m.id);

      // 只保留聊天模型
      if (!shouldIncludeInPool(category)) return null;

      return rawToProfile(m, config, enrichment);
    })
    .filter(Boolean) as ModelProfile[];

  return { platform: config.id, models, ... };
}
```

### 4.4 ModelProfile 类型扩展

```ts
// types.ts 新增字段
interface ModelProfile {
  // ... 现有字段 ...

  // ── 新增：HuggingFace 增强字段 ──
  category: ModelCategory;         // 模型分类
  parameters: number | null;       // 参数量
  contextLength: number | null;    // 上下文长度 (tokens)
  maxOutput: number | null;        // 最大输出长度 (tokens)
  modelType: string | null;        // 架构族 (qwen2, deepseek_v3, ...)
  license: string | null;          // 许可证
  pipelineTag: string | null;      // HuggingFace pipeline_tag
  hfId: string | null;             // HuggingFace repo ID
  enrichmentSource: string | null; // 数据来源 (hf_api / inferred / cache)
}
```

## 5. 数据获取与缓存策略

### 核心原则

- HuggingFace 元数据是**准静态**的（模型发布后很少变）
- 平台 API 模型列表是**动态**的（新模型随时上线）
- **列表实时拉，元数据缓存用**

### 获取时机

```
添加端点 (T=0)
  ├─ 拉平台 /models 列表（实时）
  ├─ 批量查 HuggingFace 元数据（5并发, ~15s）
  ├─ 写入本地缓存
  └─ 模型池可用 ✅

日常启动 (T=1~7天)
  ├─ 读本地缓存 (<1s)
  └─ 模型池直接可用，不查网络 ✅

后台刷新 (每30分钟)
  ├─ 重新拉 /models 列表
  ├─ 对比缓存：只查新增模型的 HuggingFace
  └─ 增量更新缓存 ✅

缓存过期 (T>7天)
  └─ 后台异步重新查询，不阻塞使用
```

### 缓存结构

```
.cache/model-profiles/
├── Qwen__Qwen2.5-7B-Instruct.json    # 单个模型画像缓存
├── deepseek-ai__DeepSeek-R1.json
└── ...

缓存内容: EnrichmentResult + _cachedAt 时间戳
缓存 TTL: 7 天
缓存键: SF model ID (slash → double underscore)
```

### 对比

| | 每次查 | 添加时查+缓存 |
|---|---|---|
| 首次延迟 | ~15s | ~15s |
| 二次延迟 | ~15s | <1s |
| 网络依赖 | 强 | 弱（缓存可用） |
| 新模型 | 自动 | 增量更新（30min） |

## 6. 降级策略

```
HuggingFace 查询失败时的降级链:

1. hf-mirror.com 超时/不可用
   → 使用本地缓存 (即使过期)

2. 缓存也没有
   → 使用 LiteLLM 社区数据匹配

3. LiteLLM 也没有
   → 使用名称推断规则 (inferFromName)

4. 名称也无法判断
   → 标记为 'unknown'，不加入模型池

保证: 任何情况下都不会因为 enrichment 失败而阻塞启动
```

## 7. 性能预算

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 平台 API 获取列表 | ~1s | SiliconFlow /models |
| HF 元数据查询 (102 模型, 5 并发) | ~15s | 首次, 无缓存 |
| HF 元数据查询 (有缓存) | <1s | 读本地文件 |
| README 上下文提取 (可选) | +5s | 仅首次 |
| 分类 + 写入池 | <100ms | 纯逻辑 |
| **总计 (首次)** | **~20s** | 后台异步, 不阻塞启动 |
| **总计 (有缓存)** | **~2s** | 启动时可用 |

**关键设计：** enrichment 在后台异步执行，不阻塞启动。用户先看到基本模型列表，enrichment 完成后自动刷新。

## 8. 三脑决策增强

### 当前三脑能看到的

| 字段 | 用途 | 来源 |
|------|------|------|
| `tier` | premium/standard/budget/free | 静态推断 |
| `capabilities` | reasoning/code/chinese/english/math/toolCalling/vision | 静态推断 |
| `maxContextTokens` | 上下文过滤 | **硬编码平台默认值** |
| `costPer1kInput/output` | 成本约束 | LiteLLM 或静态 |
| `toolCallingMode` | native/prompt/none | 按平台猜 |
| `stats` | 调用次数/成功率/延迟 | 运行时累积 |

### 三脑当前缺失的

| 缺失字段 | 影响 |
|----------|------|
| `category` | 分不清 chat vs embedding vs reranker |
| `parameters` | 不知道模型大小，无法评估推理能力上限 |
| `contextLength`（真实值） | 用硬编码默认值，实际差异巨大 |
| `modelType` | 不知道架构族，无法利用架构特性 |
| `pipelineTag` | 不知道官方用途标注 |
| `license` | 无法做合规检查 |

### 硬编码问题示例

```ts
// model-pool.ts 第 293 行
siliconflow: { maxContextTokens: 32000, maxOutputTokens: 8192 }
```

实际模型差异：

| 模型 | 硬编码 | 真实值 |
|------|--------|--------|
| Qwen3.5-397B | 32K | 256K |
| Qwen3-235B | 32K | 986K |
| Kimi-K2.6 | 32K | 256K |
| DeepSeek-R1 | 32K | 32K（巧合准确） |

### enrichment 后三脑能拿到的

```ts
// 之前：靠猜
{ maxContextTokens: 32000, tier: 'standard', capabilities: { reasoning: 0.5 } }

// 之后：真实数据
{
  maxContextTokens: 262144,     // README 提取的真实值
  parameters: 403400000000,     // 403B 参数
  category: 'chat',             // pipeline_tag 确认是聊天模型
  modelType: 'qwen3_5_moe',    // 架构族
  license: 'apache-2.0',       // 许可证
}
```

三脑决策链从"看 tier 猜"升级为"看真实参数量 + 上下文长度 + 架构能力"选模型。

## 9. 迁移计划

### Phase 1: 新增 enrichment 模块 (不影响现有逻辑)
- [ ] 创建 `model-enrichment.ts`
- [ ] 创建 `model-classifier.ts`
- [ ] 添加缓存目录 `.cache/model-profiles/`
- [ ] 单元测试

### Phase 2: 接入 discovery 流程
- [ ] 修改 `model-discovery.ts`，调用 enrichment
- [ ] 扩展 `ModelProfile` 类型
- [ ] 修改 `rawToProfile` 使用 enrichment 数据
- [ ] 修改 `model-pool.ts` 读取新字段

### Phase 3: 替换旧过滤逻辑
- [ ] 移除 `isValidChatModel` 函数
- [ ] 移除硬编码 exclude 列表
- [ ] 更新前端模型池展示 (显示参数量、上下文长度)

### Phase 4: 通用化
- [ ] 支持 OpenRouter、DeepSeek 等其他平台
- [ ] 支持自定义 HF 映射表 (`KNOWN_MAP` 可配置)
- [ ] 模型画像导出/导入功能

## 10. 验收标准

- [ ] SiliconFlow 102 个模型，分类准确率 ≥ 95%
- [ ] 聊天模型不被误杀（Instruct、VL 模型）
- [ ] Embedding/Reranker/图像生成模型正确排除
- [ ] 新模型上线无需手动更新规则
- [ ] 缓存生效后，添加端点到模型池可用 < 3s
- [ ] enrichment 失败不影响启动
