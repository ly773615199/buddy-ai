# Phase 0 实施计划：ByteEncoder 文本编码器

> 日期: 2026-05-15
> 前置文档: THREE_BRAIN_EVOLUTION_PLAN.md, THREE_BRAIN_IMPLEMENTATION_SPEC.md
> 策略: 3 条铁律（序列化不改、现有测试全绿、每步 git tag）

---

## 一、目标

替代 `classifyFromText()` 的关键词匹配，建立字节级文本编码器，将自然语言映射到 128 维语义空间。

**验收指标**：
- 中文意图分类准确率 ~40% → ~70%
- 英文意图分类准确率 ~50% → ~75%
- 中英混合输入 ~60%
- 推理延迟增加 <3ms
- 新增参数 ~145K，总计 ~445K

---

## 二、施工清单

### Step 1: 新建 `src/brain/right/features/text-encoder.ts`

字节级文本编码器，纯 TypeScript，零 npm 依赖。

**组件**：
- `ByteEmbedding(256, 32)` — 字节查表嵌入，Xavier 初始化
- `estimateEntropy()` — 基于字节频率的局部熵估算，无参数
- `dynamicMerge()` — 熵驱动的动态合并：高熵保留独立 token，低熵与相邻合并
- `Projection(32→128)` — 投影层，复用 `tensor.ts` 的 `matmul`
- `EncoderBlock×2` — 复用现有 `EncoderBlock`（attention.ts + ffn.ts）

**接口**：
```typescript
export interface TextEncoderConfig {
  byteEmbedDim: number;       // 默认 32
  outputDim: number;          // 默认 128
  numLayers: number;          // 默认 2
  numHeads: number;           // 默认 4
  ffnDim: number;             // 默认 256
  mergeEntropyThreshold: number; // 默认 1.5
  maxSeqLen: number;          // 默认 512
}

export class TextEncoder {
  constructor(config?: Partial<TextEncoderConfig>)
  forward(text: string): Tensor           // [S', outputDim]
  parameters(): Tensor[]                   // 可训练参数
  countParams(): number
  serialize(): ArrayBuffer                 // 独立序列化
  static deserialize(data: ArrayBuffer): TextEncoder
}
```

**参数量**：
| 组件 | 参数 |
|------|------|
| ByteEmbedding(256, 32) | 8,192 |
| EntropyEstimator | 0 |
| Proj(32→128) | 4,096 |
| EncoderBlock×2 (d=128, h=4, ffn=256) | ~133,000 |
| **总计** | **~145K** |

### Step 2: 修改 `src/brain/right/features/encoder.ts`

新增 `encodeFeaturesV2()` 函数。

**不改**：`encodeFeatures()` / `encodeFeaturesFast()` 保持原样。

**新增**：
```typescript
export function encodeFeaturesV2(
  input: EncodeInput,
  textEncoder?: TextEncoder,
  rawText?: string,
): number[]
```

逻辑：
- 有 `textEncoder` 且有 `rawText` → 文本走 TextEncoder 输出的 token IDs 拼接到序列前部
- 否则 → fallback 到原 `encodeFeatures()`

### Step 3: 修改 `src/brain/right/nn/model.ts`

新增 `forwardWithText()` 方法。

**不改**：`forward()` / `forwardInference()` / `forwardInferenceFast()` 保持原样。

**新增**：
```typescript
forwardWithText(
  tokenIds: number[],
  textEmbedding: Tensor,  // 来自 TextEncoder 的输出 [S', 128]
): ModelOutput
```

逻辑：
- tokenIds → embedding → encoder blocks → pooled（现有路径）
- textEmbedding → 池化 → 与 pooled 拼接 → 投影 → 输出头
- 输出头的输入维度从 128 变为 256（128 + 128），需要适配

**注意**：输出头 `OutputHead` 的 `w1` 维度是 `[dModel, hiddenDim]`，拼接后 dModel 变为 256。需要：
- 新建一个 `OutputHeadsV2` 或者让 `OutputHead` 支持动态 dModel
- 或者：textEmbedding 先投影回 128 维再与 pooled 相加（而非拼接），这样不改输出头

**最终方案**：**加法融合**，不拼接。
```typescript
// textPooled: [1, 128] — TextEncoder 输出的池化
// pooled: [1, 128] — 现有 encoder 输出的池化
// fused = pooled + gate * textPooled
// gate = sigmoid(linear(pooled))  — 可学习门控
```
这样输出头维度不变，零破坏。

### Step 4: 修改 `src/brain/right/index.ts`

替换 `classifyFromText()` 的关键词匹配。

**不改**：`predict()` / `predictDetailed()` / `learn()` 等所有现有方法。

**修改** `classifyFromText()`：
```typescript
classifyFromText(input: string): {
  category: string;
  confidence: number;
  suggestedTools: string[];
  hit: boolean;
} {
  // 新路径：有 TextEncoder 时走 NN
  if (this.textEncoder) {
    const textEmb = this.textEncoder.forward(input);
    // 从 textEmb 中提取意图分类...
    return this.classifyFromTextNN(textEmb);
  }
  // 旧路径：关键词规则（保持不变）
  return this.classifyFromTextRules(input);
}
```

**新增**私有方法 `classifyFromTextNN()`，复用现有 prototypeMemory 的 findNearest。

### Step 5: 测试 + 打 tag

**新建** `src/brain/right/features/text-encoder.test.ts`：
- 测试 ByteEmbedding 前向
- 测试动态合并（纯 ASCII / 中文 / 混合）
- 测试完整 forward 输出维度
- 测试序列化/反序列化
- 测试推理延迟 <3ms

**验证**：`npx vitest run` 全绿（含现有测试）。

**Git tag**: `phase-0-text-encoder`

---

## 三、文件变更总结

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `src/brain/right/features/text-encoder.ts` | 新建 | ~250 行 |
| `src/brain/right/features/text-encoder.test.ts` | 新建 | ~150 行 |
| `src/brain/right/features/encoder.ts` | 新增函数 | +30 行 |
| `src/brain/right/nn/model.ts` | 新增方法 | +40 行 |
| `src/brain/right/index.ts` | 修改 classifyFromText | +50 行 / 改 30 行 |
| **总计** | | **~550 行新代码** |

---

## 四、风险与回滚

- **风险**：TextEncoder 未训练时输出随机向量，可能降低意图分类质量
- **缓解**：`classifyFromText()` 有 fallback — TextEncoder 不可用时自动回到关键词规则
- **回滚**：`git tag -d phase-0-text-encoder && git reset --hard HEAD~1`

---

## 五、后续 Phase 依赖

Phase 0 建立的 128 维语义空间是后续所有 Phase 的地基：
- Phase 1 (Cross-Head Attention)：输出头交互不依赖 TextEncoder，可并行
- Phase 2 (KnowledgeGate)：知识向量复用 TextEncoder 的 128 维空间
- Phase 3 (ReasoningHead)：推理步骤向量在同一空间
- Phase 6 (多模态)：Vision/Audio encoder 投影到同一 128 维空间
