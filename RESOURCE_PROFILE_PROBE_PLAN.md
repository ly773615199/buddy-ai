# 资源画像能力探测优化方案

> 日期：2026-06-14 | 作者：Buddy Dev

## 问题诊断

### 现状

当前模型画像（ModelProfile）的能力信息来自**三层推断**，无一经过实际验证：

| 层级 | 来源 | 产物 | 问题 |
|------|------|------|------|
| L1 模型发现 | `discoverAll()` → API `/v1/models` | 模型列表 + 静态 capabilities | 基于 `provider type` 硬编码推断 |
| L2 HuggingFace 增强 | `enrichMissingProfiles()` | category, pipelineTag, parameters | 元数据，不验证 API 行为 |
| L3 名称推断 | 模型名包含 "vision"/"embed" 等 | 派生能力标记 | 猜测，不可靠 |

### 具体案例

```
NVIDIA NIM 上的 google/deplot（图表理解模型）
  → category: "unknown"（HF 无数据）
  → capabilities.toolCalling: true（因为 provider type 是 "openai"）
  → 实际：不支持 tool calling，调用返回 400 Bad Request
```

### 根因

**画像从未与模型进行过"握手"。** 能力标记是静态推断的，不是实测的。

---

## 已有基础设施

项目中已存在两个相关组件，但未被充分利用：

### 1. CapabilityProber (`src/core/capability-prober.ts`)

已实现探测：
- ✅ 基础连通性（`generateText({ prompt: 'ping' })`）
- ✅ `role: 'developer'` 支持
- ✅ 原生 tool calling（发送带 tools 的请求，检查返回）
- ✅ structured output
- ✅ 响应延迟

**缺失探测：**
- ❌ Vision（发送带图片的请求）
- ❌ Streaming（流式 vs 非流式）
- ❌ Embedding（调用 /v1/embeddings）
- ❌ 最大上下文窗口
- ❌ 最大输出 token

### 2. ModelHealthProber (`src/core/model-health-prober.ts`)

已实现：
- ✅ 周期性健康检查（10 分钟间隔）
- ✅ 连续失败计数 → unhealthy 标记
- ✅ 延迟分级（healthy / degraded / unhealthy）

**但只测连通性，不验证能力声明。**

---

## 优化方案

### 总体架构

```
添加端点 API
    ↓
① 立即可用（缓存 or 静态推断，用户不等待）
    ↓
② 后台异步：模型发现 + 能力探测（新）
    ↓
③ 探测结果写回 ModelProfile → 覆盖静态推断
    ↓
④ 周期性健康探测（已有 ModelHealthProber，增强为带能力验证）
```

### Phase 1：扩展 CapabilityProber（核心）

**目标：** 探测所有关键能力维度，不只是 tool calling。

新增探测项：

```typescript
interface ProbeResult {
  // 已有
  reachable: boolean;
  supportsDeveloperRole: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  latencyMs: number;
  errors: string[];

  // 新增
  vision: boolean;              // 支持图片输入
  streaming: boolean;           // 支持流式输出
  embedding: boolean;           // 支持 /v1/embeddings
  maxContextTokens: number;     // 实测最大上下文（二分法探测）
  maxOutputTokens: number;      // 实测最大输出
  supportsParallelTools: boolean; // 支持并行 tool calls
  responseQuality: 'fast' | 'normal' | 'slow'; // 响应速度分级
}
```

**Vision 探测策略：**
```typescript
// 发送一个 1x1 白色像素 base64 图片 + 简单问题
const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
await generateText({
  model,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', image: testImage },
      { type: 'text', text: 'What color is this image?' }
    ]
  }],
  maxOutputTokens: 20,
});
// 成功 → vision: true；400/不支持 → vision: false
```

**Embedding 探测策略：**
```typescript
// 调用 /v1/embeddings 端点
const response = await fetch(`${baseUrl}/embeddings`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: modelId, input: 'test' })
});
// 200 → embedding: true；404/400 → embedding: false
```

**上下文窗口二分探测：**
```typescript
// 用二分法找到模型实际能处理的最大 token 数
// 从 4096 开始，逐步加倍直到失败，然后二分精确定位
// 仅对 chat 模型执行，embedding 模型跳过
```

### Phase 2：批量能力探测调度器（BatchProber）

**目标：** 端点添加后，后台批量探测所有模型的实际能力。

```typescript
class BatchCapabilityProber {
  // 并发控制：避免打爆 API
  private concurrency = 2;
  // 每个模型探测间隔
  private delayMs = 1000;
  // 只探测未验证的模型
  private filterUnprobed(profiles: ModelProfile[]): ModelProfile[]

  // 探测流程
  async probeAll(profiles: ModelProfile[], creds: ProviderCredentials): Promise<Map<string, ProbeResult>> {
    // 1. 筛选：跳过已探测且未过期的
    // 2. 排序：优先探测使用频率高的
    // 3. 并发控制：每次 2 个模型
    // 4. 超时保护：单个模型 15s
    // 5. 失败处理：标记 failed，下次重试
  }
}
```

**触发时机：**
- 端点添加后立即触发（后台）
- 每日定时刷新（凌晨低峰期）
- 模型调用失败后触发单个模型重新探测

### Phase 3：画像融合（ProfileMerger）

**目标：** 将探测结果、HF 元数据、静态推断三层信息融合为最终画像。

```typescript
class ProfileMerger {
  merge(profile: ModelProfile, probeResult: ProbeResult, enrichment: EnrichmentResult): ModelProfile {
    // 优先级：实测 > HF 元数据 > 名称推断 > 静态默认值
    return {
      ...profile,
      capabilities: {
        // 实测结果优先
        toolCalling: probeResult?.toolCalling ?? profile.capabilities.toolCalling,
        vision: probeResult?.vision ?? enrichment?.category === 'vl-chat' ?? profile.capabilities.vision,
        streaming: probeResult?.streaming ?? profile.capabilities.streaming,
        maxContextTokens: probeResult?.maxContextTokens ?? enrichment?.contextLength ?? profile.capabilities.maxContextTokens,
        maxOutputTokens: probeResult?.maxOutputTokens ?? enrichment?.maxOutput ?? profile.capabilities.maxOutputTokens,
      },
      // 标记探测状态
      probeStatus: probeResult ? 'probed' : 'unprobed',
      lastProbedAt: probeResult?.timestamp,
      probeSource: 'batch' | 'on-demand' | 'health-check',
    };
  }
}
```

### Phase 4：增强 ModelHealthProber

**目标：** 健康检查时顺便验证能力声明是否仍然成立。

```typescript
// 现有的健康检查只测连通性
// 增强：如果模型声称支持 tool calling，实际发一个 tool call 验证
async probeHealth(profile: ModelProfile): Promise<HealthProbeResult> {
  const basic = await this.probeBasic(model); // 已有

  // 新增：能力验证（仅对声明支持的能力验证）
  if (profile.capabilities.toolCalling && !basic.toolCallingVerified) {
    // 发一个简单的 tool call 请求验证
    basic.toolCallingVerified = await this.verifyToolCalling(model);
  }
  if (profile.capabilities.vision && !basic.visionVerified) {
    basic.visionVerified = await this.verifyVision(model);
  }

  return basic;
}
```

---

## 实现路径

### 优先级排序

| 阶段 | 内容 | 工作量 | 价值 |
|------|------|--------|------|
| P0 | 扩展 CapabilityProber（vision + streaming + embedding） | 2 天 | 高 — 直接解决 NVIDIA NIM 问题 |
| P1 | BatchCapabilityProber 调度器 | 1 天 | 高 — 端点添加后自动探测 |
| P2 | ProfileMerger 融合逻辑 | 1 天 | 中 — 统一三层数据源 |
| P3 | 增强 ModelHealthProber | 0.5 天 | 中 — 运行时能力验证 |
| P4 | 上下文窗口二分探测 | 1 天 | 低 — 精确但耗时 |

### P0 实现细节

**修改文件：**
- `src/core/capability-prober.ts` — 新增 vision / streaming / embedding 探测
- `src/core/model-pool.ts` — 探测结果写回 ModelProfile
- `src/core/model-discovery.ts` — 探测状态标记

**探测时序：**
```
端点添加 → discoverAll() → 静态画像（立即可用）
                ↓ 异步
         BatchCapabilityProber.probeAll()
                ↓ 每次 2 个模型，间隔 1s
         探测结果 → ProfileMerger.merge() → 更新画像
                ↓
         ModelPool.saveUnifiedState() → 持久化缓存
```

**失败策略：**
- 探测失败 → 保留静态推断值，标记 `probeStatus: 'failed'`
- 连续 3 次失败 → 标记 `probeStatus: 'permanent-failed'`，不再重试
- 7 天后重新尝试（模型可能已更新）

---

## 数据流全景

```
                    ┌─────────────────────────────────────────┐
                    │           ModelProfile                   │
                    │                                          │
  L1 静态推断 ─────→│  platform, id, static capabilities      │
  (discoverAll)     │  (toolCalling: true, vision: false...)  │
                    │                                          │
  L2 HF 元数据 ────→│  category, pipelineTag, parameters      │
  (enrichment)      │  contextLength, license                 │
                    │                                          │
  L3 实际探测 ─────→│  toolCallingVerified: true/false        │
  (BatchProber)     │  visionVerified: true/false             │
                    │  streamingVerified: true/false           │
                    │  actualMaxContext: 32768                 │
                    │  actualMaxOutput: 4096                  │
                    │                                          │
  L4 运行时反馈 ───→│  stats.totalCalls, successRate          │
  (调用统计)        │  denied: true/false                     │
                    │  avgLatencyMs                           │
                    └─────────────────────────────────────────┘
```

**最终决策优先级：**
```
L4 运行时反馈 > L3 实际探测 > L2 HF 元数据 > L1 静态推断
```

---

## 与 LiteLLM 数据的整合

项目已集成 LiteLLM 社区数据（`[ModelDiscovery] LiteLLM 数据已更新: 2784 条目`），但目前只用于名称匹配。可以进一步利用：

```typescript
// LiteLLM 的 model info 包含：
// - supports_vision
// - supports_function_calling
// - max_input_tokens / max_output_tokens
// - supports_parallel_function_calling

// 作为 L2.5 层：比 HF 元数据更精确，比实际探测更快
const litellmInfo = getLiteLLMModelInfo(modelId);
if (litellmInfo) {
  profile.capabilities.vision = litellmInfo.supports_vision ?? profile.capabilities.vision;
  profile.capabilities.toolCalling = litellmInfo.supports_function_calling ?? profile.capabilities.toolCalling;
  profile.capabilities.maxContextTokens = litellmInfo.max_input_tokens ?? profile.capabilities.maxContextTokens;
  profile.capabilities.maxOutputTokens = litellmInfo.max_output_tokens ?? profile.capabilities.maxOutputTokens;
}
```

**数据源优先级更新：**
```
L4 运行时反馈 > L3 实际探测 > L2.5 LiteLLM 社区数据 > L2 HF 元数据 > L1 静态推断
```

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 探测请求消耗 API 额度 | 成本增加 | 控制并发（2个/秒），只探测未验证模型 |
| 探测被 API 限流 | 429 错误 | 指数退避，尊重 Retry-After |
| 某些模型不支持探测格式 | 误判为不支持 | 多种格式尝试，失败保留默认值 |
| 探测结果过期 | 画像不准 | 7 天 TTL + 运行时反馈修正 |

---

## 总结

核心改动：**在模型发现后、用户使用前，插入一个异步能力探测层。**

- 不阻塞用户（静态推断立即可用）
- 不依赖猜测（实测验证每个能力维度）
- 不重复探测（结果缓存 + TTL）
- 不孤立运行（与健康检查、质量评估联动）
