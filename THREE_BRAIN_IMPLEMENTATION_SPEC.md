# 三脑改造实现规范：接口级细节

> 版本: v1.0
> 日期: 2026-05-15
> 前置文档: THREE_BRAIN_EVOLUTION_PLAN.md
> 本文档精确到：文件路径、函数签名、参数类型、序列化兼容、测试用例、回滚策略

---

## 总则：无破坏改造的五条铁律

1. **不改已有函数签名**：所有现有函数保持原样，新功能通过新增函数/类实现
2. **不改序列化格式**：`serialize.ts` 的 `.bin` 格式不变，新模块独立序列化
3. **不改测试用例**：现有 test 全部通过，新功能写新 test 文件
4. **渐进式切换**：新路径通过 feature flag 或条件判断启用，默认走旧路径
5. **每步可回滚**：每个 Phase 结束后，删除新增文件即可恢复到改造前状态

---

## Phase 0：TextEncoder — 接口级实现

### 0.1 新建文件清单

| 文件 | 职责 | 行数估算 |
|------|------|---------|
| `src/brain/right/features/text-encoder.ts` | 字节级文本编码器 | ~200 |
| `src/brain/right/features/text-encoder.test.ts` | 单元测试 | ~150 |

### 0.2 不修改的文件（明确排除）

- `src/brain/right/nn/model.ts` — **不改** `forward()` / `forwardInference()` / `forwardInferenceFast()`
- `src/brain/right/nn/serialize.ts` — **不改** 序列化格式和 `generateNames()`
- `src/brain/right/features/encoder.ts` — **不改** `encodeFeatures()` / `encodeFeaturesFast()`
- `src/brain/right/index.ts` — **不改** `predict()` / `predictDetailed()`

### 0.3 新建：text-encoder.ts

```typescript
// src/brain/right/features/text-encoder.ts
//
// 设计约束：
// - 零 npm 依赖，纯 TypeScript
// - 复用现有 Tensor / Embedding / EncoderBlock 基础设施
// - 输出维度 = 128（与 IntuitionNet.hiddenDim 一致）
// - 不破坏任何现有接口

import { Tensor, zeros, randn, matmul, softmax, isInferenceMode } from '../nn/tensor.js';
import { Embedding } from '../nn/embedding.js';
import { EncoderBlock } from '../nn/encoder.js';

// ==================== 配置 ====================

export interface TextEncoderConfig {
  /** 字节 Embedding 维度（默认 32） */
  byteEmbedDim: number;
  /** 输出维度（必须与 IntuitionNet.config.hiddenDim 一致，默认 128） */
  outputDim: number;
  /** Transformer 层数（默认 2） */
  numLayers: number;
  /** 注意力头数（默认 4） */
  numHeads: number;
  /** FFN 维度（默认 256） */
  ffnDim: number;
  /** 动态合并的熵阈值（默认 1.5） */
  mergeEntropyThreshold: number;
  /** 最大序列长度（默认 512 字节） */
  maxSeqLen: number;
}

const DEFAULT_CONFIG: TextEncoderConfig = {
  byteEmbedDim: 32,
  outputDim: 128,
  numLayers: 2,
  numHeads: 4,
  ffnDim: 256,
  mergeEntropyThreshold: 1.5,
  maxSeqLen: 512,
};

// ==================== 熵估算 ====================

/**
 * 局部熵估算 — 用于动态合并决策
 *
 * 在窗口内统计字节频率，计算 Shannon 熵
 * 高熵 = 信息密度高 = 保留独立 token
 * 低熵 = 信息密度低 = 合并为 patch
 */
function localEntropy(bytes: Uint8Array, pos: number, window: number = 4): number {
  const start = Math.max(0, pos - window);
  const end = Math.min(bytes.length - 1, pos + window);
  const size = end - start + 1;

  const freq = new Uint16Array(256);
  for (let i = start; i <= end; i++) {
    freq[bytes[i]]++;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / size;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

// ==================== 动态合并 ====================

/**
 * 熵驱动的动态合并（受 BLT + MrT5 启发）
 *
 * 高熵位置保留独立 token，低熵位置与相邻合并为 patch
 * 返回合并后的 patch 边界索引
 */
function dynamicMergeBoundaries(
  bytes: Uint8Array,
  threshold: number,
): number[] {
  if (bytes.length === 0) return [];

  const boundaries: number[] = [0]; // 第一个 patch 从 0 开始
  let inLowEntropy = false;

  for (let i = 0; i < bytes.length; i++) {
    const entropy = localEntropy(bytes, i);
    const isHighEntropy = entropy > threshold;

    if (isHighEntropy && inLowEntropy) {
      // 从低熵切换到高熵 → 新 patch 开始
      boundaries.push(i);
      inLowEntropy = false;
    } else if (!isHighEntropy && !inLowEntropy) {
      // 从高熵切换到低熵 → 标记，但不立即切分
      // 低熵区域会合并为一个 patch
      inLowEntropy = true;
    }
    // 高熵区域每个字节独立保留（不合并）
    if (isHighEntropy) {
      boundaries.push(i + 1);
    }
  }

  // 确保最后一个 patch 覆盖到末尾
  if (boundaries[boundaries.length - 1] < bytes.length) {
    boundaries.push(bytes.length);
  }

  return boundaries;
}

// ==================== 主类 ====================

export class TextEncoder {
  private config: TextEncoderConfig;
  private byteEmbed: Embedding;       // 复用现有 Embedding 类
  private proj: Tensor;               // [byteEmbedDim, outputDim] 投影矩阵
  private blocks: EncoderBlock[];     // 复用现有 EncoderBlock
  private verbose: boolean;

  constructor(config?: Partial<TextEncoderConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;

    // 字节 Embedding：256 个字节值 → byteEmbedDim 维向量
    this.byteEmbed = new Embedding(256, this.config.byteEmbedDim);

    // 投影到 outputDim（与 IntuitionNet.hiddenDim 对齐）
    const limit = Math.sqrt(6 / (this.config.byteEmbedDim + this.config.outputDim));
    this.proj = randn([this.config.byteEmbedDim, this.config.outputDim], limit);

    // Transformer 编码器
    this.blocks = [];
    for (let i = 0; i < this.config.numLayers; i++) {
      this.blocks.push(
        new EncoderBlock(this.config.outputDim, this.config.numHeads, this.config.ffnDim)
      );
    }
  }

  /**
   * 编码：文本字符串 → 语义向量序列 [S', outputDim]
   *
   * 流程：
   * 1. UTF-8 编码为字节序列
   * 2. 动态合并（低熵 patch 合并）
   * 3. 每个 patch 取平均 Embedding
   * 4. 投影到 outputDim
   * 5. 通过 Transformer 编码器
   *
   * 输出：Tensor [numPatches, outputDim]
   */
  encode(text: string): Tensor {
    // 1. UTF-8 字节
    const bytes = new TextEncoder().encode(text);
    const trimmed = bytes.slice(0, this.config.maxSeqLen);

    // 2. 动态合并：确定 patch 边界
    const boundaries = dynamicMergeBoundaries(trimmed, this.config.mergeEntropyThreshold);
    const numPatches = boundaries.length - 1;

    // 3. 字节 Embedding
    const byteEmb = this.byteEmbed.forward(Array.from(trimmed)); // [S, byteEmbedDim]

    // 4. 对每个 patch 取平均 Embedding
    const patchEmb = zeros([numPatches, this.config.byteEmbedDim]);
    for (let p = 0; p < numPatches; p++) {
      const start = boundaries[p];
      const end = boundaries[p + 1];
      const count = end - start;
      for (let d = 0; d < this.config.byteEmbedDim; d++) {
        let sum = 0;
        for (let i = start; i < end; i++) {
          sum += byteEmb.data[i * this.config.byteEmbedDim + d];
        }
        patchEmb.data[p * this.config.byteEmbedDim + d] = sum / count;
      }
    }

    // 5. 投影到 outputDim
    let h = matmul(patchEmb, this.proj); // [numPatches, outputDim]

    // 6. Transformer 编码（双向，不用 causal mask）
    for (const block of this.blocks) {
      h = block.forward(h, false);
    }

    return h; // [numPatches, outputDim]
  }

  /**
   * 编码为单向量（平均池化）
   * 用于 KnowledgeGate 的 query / 知识条目向量化
   */
  encodeToVector(text: string): Float32Array {
    const h = this.encode(text);
    const dim = h.shape[1];
    const out = new Float32Array(dim);
    const numPatches = h.shape[0];
    for (let p = 0; p < numPatches; p++) {
      for (let d = 0; d < dim; d++) {
        out[d] += h.data[p * dim + d];
      }
    }
    for (let d = 0; d < dim; d++) out[d] /= numPatches;
    return out;
  }

  /** 获取所有可训练参数 */
  parameters(): Tensor[] {
    const params: Tensor[] = [this.byteEmbed.weight, this.proj];
    for (const block of this.blocks) {
      params.push(...block.parameters());
    }
    return params;
  }

  /** 统计参数量 */
  countParams(): number {
    let count = 0;
    for (const p of this.parameters()) count += p.size;
    return count;
  }

  /** 获取配置 */
  getConfig(): TextEncoderConfig {
    return { ...this.config };
  }
}
```

### 0.4 不修改 IntuitionNet 的接入方式

**关键设计**：TextEncoder 是独立模块，不嵌入 IntuitionNet 内部。接入通过 `RightBrain` 层协调。

```typescript
// src/brain/right/index.ts — 新增方法（不改现有方法）

// 在 RightBrain 类中新增：
private textEncoder: TextEncoder | null = null;

/** 初始化 TextEncoder（延迟加载，不影响启动速度） */
initTextEncoder(config?: Partial<TextEncoderConfig>): void {
  if (this.textEncoder) return;
  this.textEncoder = new TextEncoder(config, this.verbose);
  if (this.verbose) {
    console.log(`[RightBrain] TextEncoder 初始化: ${this.textEncoder.countParams()} 参数`);
  }
}

/**
 * 带文本语义的预测 — 新增方法，不改 predict()
 *
 * 与 predict() 的区别：
 * - predict() 只用结构化信号（现有路径，保持不变）
 * - predictWithText() 同时用结构化信号 + 文本语义（新路径）
 *
 * 实现方式：分别编码后在 hidden 层融合
 */
async predictWithText(
  input: string,
  signal: TaskSignal,
  resources: ResourceState,
  body?: BodyState,
  multimodal?: { spatial?: SpatialEncodeInput; image?: RawImage; sceneGraph?: SceneGraph },
): Promise<IntuitionSignal & { textEncoding?: Float32Array }> {
  // 1. 结构化路径（现有逻辑完全不变）
  const structResult = await this.predict(input, signal, resources, body, multimodal);

  // 2. 文本路径（新增）
  if (!this.textEncoder) return structResult;

  const textEmb = this.textEncoder.encode(input); // [S', 128]
  const textVec = this.textEncoder.encodeToVector(input); // [128]

  // 3. 融合策略：用文本语义校正结构化结果
  //    - 如果文本编码的意图与结构化编码不同，且置信度更高，用文本结果
  //    - 否则保持结构化结果不变
  //    这是保守策略，不会降低现有能力
  const textIntent = this.classifyFromTextByVector(textVec);

  if (textIntent.confidence > structResult.intent.confidence + 0.2) {
    return {
      ...structResult,
      intent: textIntent,
      hit: true,
      textEncoding: textVec,
    };
  }

  return structResult;
}

/** 从文本向量分类意图（替代关键词匹配） */
private classifyFromTextByVector(vec: Float32Array): {
  category: string; confidence: number; suggestedTools: string[]; hit: boolean;
} {
  // 用 PrototypeMemory 的最近原型做分类
  // 复用现有的原型匹配机制
  const match = this.prototypeMemory.findNearest(vec);
  if (match && match.confidence > 0.5) {
    return {
      category: match.prototype.label,
      confidence: match.confidence,
      suggestedTools: match.prototype.topTools(5),
      hit: true,
    };
  }
  // fallback 到现有关键词匹配
  return this.classifyFromText('');
}
```

### 0.5 不修改序列化的独立持久化

```typescript
// TextEncoder 的权重独立保存，不混入 IntuitionNet 的 .bin 文件

import { saveModel, loadModel } from '../nn/serialize.js';

// 保存：text-encoder.bin（与 intuition-net.bin 并列）
export function saveTextEncoder(encoder: TextEncoder, path: string): void {
  // 复用现有的 saveModel 接口 — TextEncoder 的 parameters() 返回 Tensor[]
  // serialize.ts 的 saveModel 已经支持任意 Tensor[]，不需要改
  saveModel(encoder as any, path); // 类型适配
}

// 加载
export function loadTextEncoder(encoder: TextEncoder, path: string): void {
  loadModel(encoder as any, path);
}
```

**序列化兼容性**：
- `intuition-net.bin` 格式完全不变 → 现有权重可直接加载
- `text-encoder.bin` 是新文件，不影响现有文件
- 如果 `text-encoder.bin` 不存在，TextEncoder 使用随机初始化（首次运行时的正常状态）

### 0.6 训练接入（不改 OnlineLearner）

```typescript
// 在 OnlineLearner 的训练循环中，新增一个条件分支
// 不改 OnlineLearner 本身，在调用侧处理

// src/brain/right/training/index.ts 或 agent.ts 中的训练调用处

function trainStep(sample: TrainingSample): void {
  // 现有路径：结构化编码 → 训练
  const tokenIds = encodeFeatures(sample.encodeInput);
  const output = model.forward(tokenIds);
  // ... 现有训练逻辑 ...

  // 新增路径（如果 TextEncoder 可用且样本有原始文本）
  if (textEncoder && sample.rawText) {
    const textEmb = textEncoder.encode(sample.rawText);
    // 将 textEmb 拼接到 tokenIds 的 embedding 序列后面
    // 梯度从输出头反传到 TextEncoder 的 ByteEmbedding
    // 这是纯增量操作，不影响上面的现有训练逻辑
  }
}
```

### 0.7 测试用例

```typescript
// src/brain/right/features/text-encoder.test.ts

import { describe, it, expect } from 'vitest';
import { TextEncoder } from './text-encoder.js';

describe('TextEncoder', () => {
  it('初始化成功', () => {
    const enc = new TextEncoder();
    expect(enc.countParams()).toBeGreaterThan(100000);
    expect(enc.countParams()).toBeLessThan(200000);
  });

  it('encode 返回正确维度', () => {
    const enc = new TextEncoder({ outputDim: 128 });
    const result = enc.encode('帮我读取配置文件');
    expect(result.shape[1]).toBe(128); // outputDim
    expect(result.shape[0]).toBeGreaterThan(0); // numPatches > 0
  });

  it('英文输入正常编码', () => {
    const enc = new TextEncoder();
    const result = enc.encode('read the config file');
    expect(result.shape[0]).toBeGreaterThan(0);
  });

  it('中英混合输入正常编码', () => {
    const enc = new TextEncoder();
    const result = enc.encode('帮我git push代码');
    expect(result.shape[0]).toBeGreaterThan(0);
  });

  it('空字符串不崩溃', () => {
    const enc = new TextEncoder();
    const result = enc.encode('');
    expect(result.shape[0]).toBe(0);
  });

  it('超长输入截断到 maxSeqLen', () => {
    const enc = new TextEncoder({ maxSeqLen: 100 });
    const longText = 'a'.repeat(1000);
    const result = enc.encode(longText);
    // 不崩溃，patch 数量应该有限
    expect(result.shape[0]).toBeLessThan(100);
  });

  it('encodeToVector 返回 128 维向量', () => {
    const enc = new TextEncoder({ outputDim: 128 });
    const vec = enc.encodeToVector('测试文本');
    expect(vec.length).toBe(128);
    // 向量不应全为零
    expect(vec.some(v => v !== 0)).toBe(true);
  });

  it('相似文本的向量余弦距离更近', () => {
    const enc = new TextEncoder();
    const vec1 = enc.encodeToVector('读取配置文件');
    const vec2 = enc.encodeToVector('查看配置文件');
    const vec3 = enc.encodeToVector('git push 代码');

    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);
    // "读取"和"查看"应该比"读取"和"git push"更相似
    expect(sim12).toBeGreaterThan(sim13);
  });

  it('拼写错误的输入仍有合理编码', () => {
    const enc = new TextEncoder();
    const vec1 = enc.encodeToVector('读取配置文件');
    const vec2 = enc.encodeToVector('读取配制文件'); // 错别字
    const sim = cosineSimilarity(vec1, vec2);
    expect(sim).toBeGreaterThan(0.5); // 应该仍然比较相似
  });

  it('parameters() 返回正确数量的 Tensor', () => {
    const enc = new TextEncoder({ numLayers: 2 });
    const params = enc.parameters();
    // byteEmbed.weight + proj + 2 * EncoderBlock * (attn 10 + ffn 6)
    expect(params.length).toBe(2 + 2 * 16);
  });
});

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}
```

### 0.8 回滚策略

```
回滚步骤（删除 2 个文件即可）：
1. rm src/brain/right/features/text-encoder.ts
2. rm src/brain/right/features/text-encoder.test.ts
3. git revert <commit>

回滚后状态：
- RightBrain 的 predict() / predictDetailed() 完全不受影响（它们不调用 TextEncoder）
- IntuitionNet 的 forward*() 完全不受影响
- serialize.ts 完全不受影响
- 所有现有测试继续通过
```

### 0.9 验收标准

| 检查项 | 通过条件 |
|--------|---------|
| 现有测试 | `npm test` 全部通过，0 个新增失败 |
| 新增测试 | text-encoder.test.ts 全部通过 |
| 参数量 | TextEncoder 在 140K-160K 范围内 |
| 推理延迟 | `encode('测试文本')` < 3ms |
| 空输入 | `encode('')` 不崩溃，返回空 Tensor |
| 长输入 | `encode('a'.repeat(10000))` 不崩溃，截断到 maxSeqLen |
| 序列化 | `intuition-net.bin` 加载不受影响 |
| TypeScript | `npx tsc --noEmit` 零错误 |

---

## Phase 1：跨头交互 — 接口级实现

### 1.1 修改文件清单

| 文件 | 改动类型 | 破坏性 |
|------|---------|--------|
| `src/brain/right/nn/output-heads.ts` | 新增 `CrossHeadLayer` 类 | ❌ 不改现有类 |
| `src/brain/right/nn/model.ts` | 新增 `forwardV2()` 方法 | ❌ 不改现有方法 |

### 1.2 CrossHeadLayer — 新增类（不改 OutputHeads）

```typescript
// src/brain/right/nn/output-heads.ts — 在文件末尾追加

/**
 * 跨头交互层 — 让输出头互相看到对方的输出
 *
 * 不修改现有 OutputHeads 类，通过组合方式接入
 * 使用方式：
 *   const heads = new OutputHeads(...);  // 现有
 *   const crossHead = new CrossHeadLayer(heads.getHeadDims());  // 新增
 *   const raw = heads.forward(pooled);
 *   const refined = crossHead.refine(raw);
 */
export class CrossHeadLayer {
  // 投影到统一维度
  private projWeights: Tensor[];   // 每头一个 [headDim, crossDim]
  private projBiases: Tensor[];
  // 跨头注意力
  private wq: Tensor;  // [crossDim, crossDim]
  private wk: Tensor;
  private wv: Tensor;
  private wo: Tensor;
  // 输出投影回各头维度
  private outProjWeights: Tensor[];  // 每头一个 [crossDim, headDim]
  private outProjBiases: Tensor[];
  // LayerNorm
  private lnWeight: Tensor;
  private lnBias: Tensor;

  private headDims: number[];
  private crossDim: number;

  constructor(headDims: number[], crossDim: number = 64) {
    this.headDims = headDims;
    this.crossDim = crossDim;

    const limit = Math.sqrt(6 / (Math.max(...headDims) + crossDim));

    this.projWeights = headDims.map(d => randn([d, crossDim], limit));
    this.projBiases = headDims.map(() => zeros([crossDim]));

    this.wq = randn([crossDim, crossDim], limit);
    this.wk = randn([crossDim, crossDim], limit);
    this.wv = randn([crossDim, crossDim], limit);
    this.wo = randn([crossDim, crossDim], limit);

    this.outProjWeights = headDims.map(d => randn([crossDim, d], limit));
    this.outProjBiases = headDims.map(d => zeros([d]));

    this.lnWeight = zeros([crossDim]);
    this.lnBias = zeros([crossDim]);
  }

  /**
   * 精炼：原始输出头 logits → 交互后的 logits
   *
   * 输入：各头的原始 Tensor（来自 OutputHeads.forward()）
   * 输出：同维度的精炼后 Tensor
   */
  refine(raw: { intent: Tensor; tools: Tensor; quality: Tensor; spatial: Tensor; scene: Tensor }): {
    intent: Tensor; tools: Tensor; quality: Tensor; spatial: Tensor; scene: Tensor;
  } {
    const rawTensors = [raw.intent, raw.tools, raw.quality, raw.spatial, raw.scene];

    // 1. 投影到统一维度
    const projected = rawTensors.map((t, i) => {
      const h = matmul(t, this.projWeights[i]);
      // add bias
      for (let d = 0; d < this.crossDim; d++) h.data[d] += this.projBiases[i].data[d];
      return h;
    });

    // 2. 拼接为序列 [numHeads, crossDim]
    const numHeads = rawTensors.length;
    const seqData = new Float32Array(numHeads * this.crossDim);
    for (let i = 0; i < numHeads; i++) {
      seqData.set(projected[i].data, i * this.crossDim);
    }
    const seq = new Tensor(seqData, [numHeads, this.crossDim]);

    // 3. 自注意力
    const q = matmul(seq, this.wq);
    const k = matmul(seq, this.wk);
    const v = matmul(seq, this.wv);

    // 缩放点积注意力
    const scale = 1 / Math.sqrt(this.crossDim);
    const scores = new Float32Array(numHeads * numHeads);
    for (let i = 0; i < numHeads; i++) {
      for (let j = 0; j < numHeads; j++) {
        let dot = 0;
        for (let d = 0; d < this.crossDim; d++) {
          dot += q.data[i * this.crossDim + d] * k.data[j * this.crossDim + d];
        }
        scores[i * numHeads + j] = dot * scale;
      }
    }
    // softmax per row
    for (let i = 0; i < numHeads; i++) {
      let maxVal = -Infinity;
      for (let j = 0; j < numHeads; j++) maxVal = Math.max(maxVal, scores[i * numHeads + j]);
      let sum = 0;
      for (let j = 0; j < numHeads; j++) {
        scores[i * numHeads + j] = Math.exp(scores[i * numHeads + j] - maxVal);
        sum += scores[i * numHeads + j];
      }
      for (let j = 0; j < numHeads; j++) scores[i * numHeads + j] /= sum;
    }

    // 加权求和
    const attended = new Float32Array(numHeads * this.crossDim);
    for (let i = 0; i < numHeads; i++) {
      for (let j = 0; j < numHeads; j++) {
        for (let d = 0; d < this.crossDim; d++) {
          attended[i * this.crossDim + d] += scores[i * numHeads + j] * v.data[j * this.crossDim + d];
        }
      }
    }
    const attendedSeq = new Tensor(attended, [numHeads, this.crossDim]);

    // 4. 输出投影 + residual
    const output = new Tensor(new Float32Array(attendedSeq.data), attendedSeq.shape);
    const refined: Tensor[] = [];
    for (let i = 0; i < numHeads; i++) {
      const headOut = new Tensor(output.data.slice(i * this.crossDim, (i + 1) * this.crossDim), [1, this.crossDim]);
      const proj = matmul(headOut, this.outProjWeights[i]);
      for (let d = 0; d < this.headDims[i]; d++) proj.data[d] += this.outProjBiases[i].data[d];
      // residual: 加上原始输出
      for (let d = 0; d < this.headDims[i]; d++) proj.data[d] += rawTensors[i].data[d];
      refined.push(proj);
    }

    return {
      intent: refined[0],
      tools: refined[1],
      quality: refined[2],
      spatial: refined[3],
      scene: refined[4],
    };
  }

  parameters(): Tensor[] {
    const params: Tensor[] = [];
    for (let i = 0; i < this.headDims.length; i++) {
      params.push(this.projWeights[i], this.projBiases[i], this.outProjWeights[i], this.outProjBiases[i]);
    }
    params.push(this.wq, this.wk, this.wv, this.wo, this.lnWeight, this.lnBias);
    return params;
  }
}
```

### 1.3 IntuitionNet 扩展 — 新增方法（不改现有方法）

```typescript
// src/brain/right/nn/model.ts — 在 IntuitionNet 类末尾追加

private _crossHeadLayer: CrossHeadLayer | null = null;

/** 初始化跨头交互层（延迟加载） */
initCrossHead(): void {
  if (this._crossHeadLayer) return;
  const headDims = [
    this.config.numIntents,  // intent: 8
    this.config.numTools,    // tool: 32
    1,                       // quality: 1
    this.config.numSpatialBins ?? 6,  // spatial
    this.config.numSceneNodes ?? 32,  // scene
  ];
  this._crossHeadLayer = new CrossHeadLayer(headDims, 64);
}

/**
 * 带跨头交互的推理 — 新增方法，不改 forward()
 *
 * 与 forward() 的区别：
 * - forward(): 5 个头独立输出（现有路径）
 * - forwardV2(): 5 个头先独立输出，再通过 CrossAttention 交互（新路径）
 */
forwardV2(tokenIds: number[]): ModelOutput {
  const t0 = performance.now();

  // 前半部分与 forward() 完全一致
  this._cachedTokenIds = tokenIds;
  let h = this.embedding.forward(tokenIds);
  if (this.config.embedDim !== this.config.hiddenDim) {
    h = matmul(h, this._projWeight!);
  }
  for (const block of this.encoderBlocks) {
    h = block.forward(h, true);
  }
  this._cachedEncoderOut = h;
  const lastToken = this._poolLast(h);

  // 输出头：先独立，再交互
  const rawHeads = this.heads.forward(lastToken);

  if (this._crossHeadLayer) {
    const refined = this._crossHeadLayer.refine(rawHeads);
    return {
      intentProbs: new Float32Array(refined.intent.data),
      toolProbs: new Float32Array(refined.tools.data),
      qualityScore: sigmoid(refined.quality.data[0]),
      spatialProbs: new Float32Array(refined.spatial.data),
      sceneProbs: new Float32Array(refined.scene.data),
      latencyMs: performance.now() - t0,
      _hidden: new Float32Array(lastToken.data),
    };
  }

  // fallback：没有 CrossHeadLayer 时走原逻辑
  return {
    intentProbs: new Float32Array(rawHeads.intent.data),
    toolProbs: new Float32Array(rawHeads.tools.data),
    qualityScore: sigmoid(rawHeads.quality.data[0]),
    spatialProbs: new Float32Array(rawHeads.spatial.data),
    sceneProbs: new Float32Array(rawHeads.scene.data),
    latencyMs: performance.now() - t0,
    _hidden: new Float32Array(lastToken.data),
  };
}

/** 统计参数量（含 CrossHeadLayer） */
countParamsV2(): number {
  let count = this.countParams();
  if (this._crossHeadLayer) {
    for (const p of this._crossHeadLayer.parameters()) count += p.size;
  }
  return count;
}
```

### 1.4 序列化兼容

**CrossHeadLayer 权重独立保存**：

```typescript
// 保存
if (model._crossHeadLayer) {
  saveModel({ parameters: () => model._crossHeadLayer!.parameters() } as any, 'cross-head.bin');
}

// 加载
if (existsSync('cross-head.bin')) {
  model.initCrossHead();
  loadModel({ parameters: () => model._crossHeadLayer!.parameters() } as any, 'cross-head.bin');
}
```

### 1.5 RightBrain 接入（不改 predict，新增 predictV2）

```typescript
// src/brain/right/index.ts — 新增方法

async predictV2(
  input: string,
  signal: TaskSignal,
  resources: ResourceState,
  body?: BodyState,
): Promise<IntuitionSignal> {
  const tokenIds = encodeFeatures({ signal, resources, body });
  const output = this.model.forwardV2(tokenIds); // 新方法
  return decodeSignal(output, this.prototypeMemory);
}
```

### 1.6 测试用例

```typescript
// src/brain/right/nn/cross-head.test.ts

describe('CrossHeadLayer', () => {
  it('初始化成功', () => {
    const layer = new CrossHeadLayer([8, 32, 1, 6, 32]);
    expect(layer.parameters().length).toBeGreaterThan(0);
  });

  it('refine 输出维度与输入一致', () => {
    const layer = new CrossHeadLayer([8, 32, 1, 6, 32]);
    const raw = {
      intent: new Tensor(randVec(8), [1, 8]),
      tools: new Tensor(randVec(32), [1, 32]),
      quality: new Tensor(randVec(1), [1, 1]),
      spatial: new Tensor(randVec(6), [1, 6]),
      scene: new Tensor(randVec(32), [1, 32]),
    };
    const refined = layer.refine(raw);
    expect(refined.intent.shape).toEqual([1, 8]);
    expect(refined.tools.shape).toEqual([1, 32]);
    expect(refined.quality.shape).toEqual([1, 1]);
  });

  it('refine 改变了输出值', () => {
    const layer = new CrossHeadLayer([8, 32, 1, 6, 32]);
    const raw = {
      intent: new Tensor(new Float32Array([1,0,0,0,0,0,0,0]), [1, 8]),
      tools: new Tensor(new Float32Array(32).fill(0.5), [1, 32]),
      quality: new Tensor(new Float32Array([0.5]), [1, 1]),
      spatial: new Tensor(new Float32Array(6).fill(0.3), [1, 6]),
      scene: new Tensor(new Float32Array(32).fill(0.1), [1, 32]),
    };
    const refined = layer.refine(raw);
    // 至少有一个值应该不同（因为注意力权重不是单位矩阵）
    const changed = refined.intent.data.some((v, i) => Math.abs(v - raw.intent.data[i]) > 1e-6);
    expect(changed).toBe(true);
  });
});

describe('IntuitionNet.forwardV2', () => {
  it('forwardV2 与 forward 输出格式一致', () => {
    const model = new IntuitionNet({ vocabSize: 2048, embedDim: 64, hiddenDim: 128, numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32, ffnDim: 256, dropout: 0, numSpatialBins: 6, numSceneNodes: 32 });
    model.initCrossHead();
    const tokenIds = [2, 10, 30, 40, 3];
    const out1 = model.forward(tokenIds);
    const out2 = model.forwardV2(tokenIds);
    expect(out2.intentProbs.length).toBe(out1.intentProbs.length);
    expect(out2.toolProbs.length).toBe(out1.toolProbs.length);
    expect(typeof out2.qualityScore).toBe('number');
  });
});
```

### 1.7 回滚策略

```
回滚步骤：
1. 删除 CrossHeadLayer 类（output-heads.ts 末尾追加的代码）
2. 删除 IntuitionNet.initCrossHead() / forwardV2() / countParamsV2()
3. 删除 RightBrain.predictV2()
4. rm cross-head.bin
5. git revert <commit>

回滚后状态：所有现有方法和测试不受影响
```

---

## Phase 2-7：实现规范（关键接口定义）

> Phase 2-7 的详细实现代码在开始执行时逐 Phase 编写。
> 此处定义接口契约，确保每个 Phase 之间的边界清晰。

### Phase 2: KnowledgeGate — 接口契约

```typescript
// src/brain/right/nn/knowledge-gate.ts

export interface KnowledgeEntry {
  id: string;
  type: 'decision_rule' | 'exception' | 'pattern' | 'risk' | 'human_factor' | 'failure_experience';
  content: string;       // 原始文本
  vector: Float32Array;  // 128 维，由 TextEncoder.encodeToVector() 生成
  domain: string;
  confidence: number;
}

export interface KnowledgeRef {
  id: string;
  type: string;
  content: string;
  relevance: number; // 0-1
}

export class KnowledgeGate {
  constructor(config?: { topK?: number; hiddenDim?: number });

  /** 重建索引（从 STMP + ExperienceGraph 同步） */
  rebuildIndex(entries: KnowledgeEntry[]): void;

  /** 增量添加 */
  addEntry(entry: KnowledgeEntry): void;

  /** 检索：query 向量 → 融合向量 + 引用 */
  retrieve(query: Float32Array, topK?: number): {
    fused: Float32Array;   // [128] 门控融合后的向量
    refs: KnowledgeRef[];  // 检索到的知识条目
  };

  /** 统计 */
  size(): number;
  parameters(): Tensor[];
  countParams(): number;
}
```

**不修改的文件**：`stmp.ts` / `experience-graph.ts` / `extractor.ts` — 只读取，不写入

### Phase 3: ReasoningHead — 接口契约

```typescript
// src/brain/right/nn/reasoning-head.ts

export interface ReasoningStep {
  stepIndex: number;
  vector: Float32Array;   // [128]
  confidence: number;     // 0-1
  skipped: boolean;       // 是否被 skip gate 跳过
}

export interface ReasoningResult {
  steps: ReasoningStep[];
  finalVector: Float32Array;  // [128] 最后一步的向量
  finalConfidence: number;
  totalSteps: number;
  skippedSteps: number;
}

export class ReasoningHead {
  constructor(config?: { maxSteps?: number; hiddenDim?: number });

  /** 单路径推理 */
  forward(context: Float32Array, knowledge?: Float32Array): ReasoningResult;

  /** 并行推理（NoThinking） */
  forwardParallel(context: Float32Array, knowledge?: Float32Array, nPaths?: number): ReasoningResult;

  parameters(): Tensor[];
  countParams(): number;
}
```

### Phase 4: StructuredGenerator — 接口契约

```typescript
// src/brain/right/nn/generator.ts

export interface GenerationTemplate {
  id: string;
  pattern: string;        // "文件 {file} {action}成功"
  slots: Array<{ name: string; type: 'entity' | 'verb' | 'number' | 'text' }>;
  domain: string;
  confidence: number;
  usageCount: number;
}

export interface GenerationOutput {
  text: string;
  templateId: string;
  confidence: number;
  needsLLM: boolean;      // true = 需要 LLM 补完
  skeleton?: string;      // needsLLM=true 时的骨架文本
}

export class StructuredGenerator {
  constructor(templates?: GenerationTemplate[]);

  /** 从成功对话编译模板 */
  compileTemplate(conversation: { input: string; output: string }): GenerationTemplate | null;

  /** 生成 */
  generate(context: {
    intent: string;
    tools: string[];
    reasoning?: ReasoningResult;
    knowledge?: Float32Array;
    toolResult?: string;
  }): GenerationOutput;

  /** 模板管理 */
  addTemplate(template: GenerationTemplate): void;
  getTemplates(): GenerationTemplate[];
}
```

### Phase 5: MetaLearner — 接口契约

```typescript
// src/brain/right/training/meta-learner.ts

export type LearningStrategy = 'fast_memorize' | 'deep_understand' | 'analogy_transfer';

export interface LearningContext {
  recentLosses: number[];
  totalSamples: number;
  domain: string;
  novelty: number;  // 0-1
}

export class MetaLearner {
  constructor(config?: { hiddenDim?: number });

  /** 选择学习策略 */
  selectStrategy(sample: TrainingSample, context: LearningContext): LearningStrategy;

  /** 应用策略（修改 OnlineLearner 的超参数） */
  applyStrategy(strategy: LearningStrategy, learner: OnlineLearner): void;

  /** 记录策略效果（用于元学习） */
  recordOutcome(strategy: LearningStrategy, lossBefore: number, lossAfter: number): void;

  parameters(): Tensor[];
}
```

### Phase 6: VisionEncoder / AudioEncoder — 接口契约

```typescript
// src/brain/right/features/vision-encoder.ts

export class VisionEncoder {
  constructor(config?: { patchSize?: number; numLayers?: number; outputDim?: number });

  /** 编码图像 → 语义向量序列 */
  encode(image: RawImage): Tensor;

  /** 编码为单向量（平均池化） */
  encodeToVector(image: RawImage): Float32Array;

  parameters(): Tensor[];
  countParams(): number;
}

// src/brain/right/features/audio-encoder.ts

export class AudioEncoder {
  constructor(config?: { nMels?: number; numLayers?: number; outputDim?: number });

  /** 编码音频波形 → 语义向量序列 */
  encode(samples: Float32Array, sampleRate: number): Tensor;

  /** 编码为单向量 */
  encodeToVector(samples: Float32Array, sampleRate: number): Float32Array;

  parameters(): Tensor[];
  countParams(): number;
}
```

### Phase 7: 知识凝结 — 无新模块

Phase 7 是算法层面的改造，不新增 NN 模块。在 `dream.ts` 中扩展凝结逻辑：

```typescript
// src/memory/dream.ts — 新增方法

/** 知识凝结：在概念空间中聚类，提炼高层模式 */
async condenseKnowledge(options?: {
  minClusterSize?: number;  // 最小簇大小（默认 3）
  maxClusters?: number;     // 最大簇数（默认 50）
}): Promise<{
  condensed: number;   // 凝结的知识条目数
  newPatterns: number; // 新生成的高层模式数
}>;
```

---

## 附录：现有文件改动汇总

| Phase | 文件 | 改动类型 | 具体改动 |
|-------|------|---------|---------|
| 0 | `src/brain/right/features/text-encoder.ts` | **新增** | TextEncoder 类 |
| 0 | `src/brain/right/features/text-encoder.test.ts` | **新增** | 测试 |
| 0 | `src/brain/right/index.ts` | **追加** | `initTextEncoder()` / `predictWithText()` |
| 1 | `src/brain/right/nn/output-heads.ts` | **追加** | CrossHeadLayer 类 |
| 1 | `src/brain/right/nn/model.ts` | **追加** | `initCrossHead()` / `forwardV2()` |
| 1 | `src/brain/right/nn/cross-head.test.ts` | **新增** | 测试 |
| 1 | `src/brain/right/index.ts` | **追加** | `predictV2()` |
| 2 | `src/brain/right/nn/knowledge-gate.ts` | **新增** | KnowledgeGate 类 |
| 2 | `src/brain/right/index.ts` | **追加** | 知识增强预测方法 |
| 3 | `src/brain/right/nn/reasoning-head.ts` | **新增** | ReasoningHead 类 |
| 3 | `src/brain/brain.ts` | **追加** | 推理触发逻辑 |
| 4 | `src/brain/right/nn/generator.ts` | **新增** | StructuredGenerator 类 |
| 4 | `src/core/agent.ts` | **追加** | 本地生成降级逻辑 |
| 5 | `src/brain/right/training/meta-learner.ts` | **新增** | MetaLearner 类 |
| 5 | `src/brain/right/training/lpr.ts` | **修改** | 全局 λ → 分层 λ |
| 6 | `src/brain/right/features/image-encoder.ts` | **替换** | 像素统计 → 学习式编码 |
| 6 | `src/brain/right/features/audio-encoder.ts` | **新增** | AudioEncoder 类 |
| 7 | `src/memory/dream.ts` | **追加** | `condenseKnowledge()` |

**关键**：所有 **追加** 改动都是新增方法/类，不修改现有方法签名。所有 **新增** 文件是纯增量，删除即可回滚。
