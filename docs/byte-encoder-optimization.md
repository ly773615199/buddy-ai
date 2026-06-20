# ByteEncoder 最强优化 + 预训计划

> 日期: 2026-06-20
> 状态: 规划中
> 目标: 将 ByteEncoder 从 145K 未训练的辅助组件，升级为项目核心语义引擎

---

## 一、现状评估

### 当前架构

```
文本 → UTF-8 字节 → ByteEmbedding(256→32) → 熵估算 → 动态合并 → 池化
    → 投影(32→128) → EncoderBlock×2(attn+ffn, d=128) → LayerNorm → 128维向量
```

### 当前能力

| 指标 | 当前值 | 问题 |
|------|--------|------|
| 参数量 | 145K | 语义理解能力极有限 |
| 输出维度 | 128 | 信息密度低，碰撞严重 |
| 训练状态 | 未训练（随机权重） | 输出接近噪声 |
| 使用场景 | 右脑直觉预测辅助信号 | 未接入记忆检索 |
| 延迟 | ~10ms | 可接受 |
| 依赖 | 零 npm 依赖 | ✅ 优势 |

### 设计亮点（值得保留）

1. **字节级处理**：不依赖 tokenizer，UTF-8 直接输入，天然支持任何语言 + 代码
2. **熵驱动动态合并**：高熵保留、低熵合并，自适应序列长度
3. **零依赖**：纯 TypeScript，用自研 Tensor/Attention/FFN
4. **可序列化**：支持持久化加载

---

## 二、优化方案

### 2.1 架构升级

#### 当前 vs 目标

| 维度 | 当前 | 目标 | 原因 |
|------|------|------|------|
| 参数量 | 145K | ~2M | 足够捕捉语义，不影响推理速度 |
| 输出维度 | 128 | 384 | 平衡信息密度和计算成本 |
| Encoder 层数 | 2 | 4 | 更深的语义抽象 |
| 注意力头数 | 4 | 6 | 384/6=64 维/头，合理 |
| FFN 维度 | 256 | 768 | 2x 隐藏维度 |
| 字节嵌入维度 | 32 | 64 | 更丰富的字节表示 |
| 合并策略 | 熵阈值 | 熵 + 学习权重 | 可训练的合并决策 |
| 池化策略 | Mean pooling | Attention pooling | 区分重要 token 和噪声 |
| 最大序列长度 | 512 | 1024 | 支持更长文本 |

#### 新架构

```typescript
const OPTIMIZED_CONFIG: TextEncoderConfig = {
  byteEmbedDim: 64,           // 32 → 64
  outputDim: 384,             // 128 → 384
  numLayers: 4,               // 2 → 4
  numHeads: 6,                // 4 → 6
  ffnDim: 768,                // 256 → 768
  mergeEntropyThreshold: 1.5, // 保留，但增加可学习参数
  maxSeqLen: 1024,            // 512 → 1024
  // 新增
  useAttentionPooling: true,  // 替代 mean pooling
  useLearnedMerge: true,      // 可训练的合并权重
  useRotaryEmbedding: true,   // RoPE 位置编码
};
```

#### 参数量估算

| 组件 | 当前 | 目标 |
|------|------|------|
| ByteEmbedding | 256×32 = 8K | 256×64 = 16K |
| Projection | 32×128 = 4K | 64×384 = 25K |
| EncoderBlock×2 → ×4 | ~132K | ~1.8M |
| AttentionPooling | 0 | ~150K |
| LayerNorm | 256 | 1.5K |
| **总计** | **~145K** | **~2M** |

#### 关键改进详解

**1. RoPE 位置编码（Rotary Position Embedding）**

```typescript
// 替代当前的无位置编码
// 让模型感知 token 的位置关系
function applyRoPE(x: Tensor, positions: number[]): Tensor {
  const dim = x.shape[1];
  const freqs = positions.map(p => {
    const result = new Float32Array(dim);
    for (let i = 0; i < dim / 2; i++) {
      const theta = p / Math.pow(10000, (2 * i) / dim);
      result[i * 2] = Math.cos(theta);
      result[i * 2 + 1] = Math.sin(theta);
    }
    return result;
  });
  // 旋转...
}
```

**2. Attention Pooling（替代 Mean Pooling）**

```typescript
// 当前: mean pooling — 所有 token 等权平均
// 目标: attention pooling — 学习哪些 token 更重要

class AttentionPooling {
  private query: Tensor;  // [1, dim] 可学习的查询向量
  private key: Tensor;    // [dim, dim]

  forward(x: Tensor): Tensor {
    // x: [S, dim]
    const keys = matmul(x, this.key);        // [S, dim]
    const scores = matmul(this.query, transpose(keys)); // [1, S]
    const weights = softmax(scores);          // [1, S]
    const pooled = matmul(weights, x);        // [1, dim]
    return pooled;
  }
}
```

**3. 可训练的动态合并**

```typescript
// 当前: 固定熵阈值判断
// 目标: 学习合并/保留的决策

class LearnedMerge {
  private gate: Tensor;  // [byteEmbedDim, 1] — 合并门控

  shouldMerge(byteEmbedding: Tensor, entropy: number): boolean {
    const gateScore = sigmoid(matmul(byteEmbedding, this.gate));
    // 门控分数 + 熵信号 → 联合决策
    return (gateScore.data[0] + entropy / 8) < 0.5;
  }
}
```

### 2.2 预训策略

#### Phase 1：对比学习预训（2-4 周）

**目标**：让 ByteEncoder 学到基本的语义表示能力。

**方法**：SimCSE 风格的无监督对比学习

```
正样本对：同一句话的不同增强（dropout mask 不同）
负样本对：batch 内其他句子

Loss = -log(exp(sim(z_i, z_j) / τ) / Σ exp(sim(z_i, z_k) / τ))
```

**数据来源**：

| 数据集 | 规模 | 用途 |
|--------|------|------|
| 中文维基百科 | ~5M 句 | 通用语义 |
| GitHub 中文 README | ~2M 句 | 技术语义 |
| Buddy 对话日志 | 持续积累 | 领域适配 |
| 代码注释 | ~1M 句 | 代码理解 |

**训练配置**：

```yaml
optimizer: AdamW
learning_rate: 3e-4
weight_decay: 0.01
warmup_steps: 10000
batch_size: 256
temperature: 0.05
epochs: 10
gradient_accumulation: 4
```

**训练流程**：

```typescript
// 伪代码
for (epoch in epochs) {
  for (batch of dataloader) {
    // 1. 前向（两次，不同 dropout mask）
    const z1 = encoder.forward(batch.texts);  // [B, 384]
    const z2 = encoder.forward(batch.texts);  // [B, 384]

    // 2. 对比损失
    const loss = infoNCE(z1, z2, temperature=0.05);

    // 3. 反向传播
    loss.backward();
    optimizer.step();
  }
}
```

#### Phase 2：任务适配预训（1-2 周）

**目标**：让 ByteEncoder 适配 Buddy 的具体任务。

**任务 1：记忆检索匹配**

```
输入：(query, memory_key) 对
标签：1=相关，0=不相关
数据：从 Buddy 记忆系统中自动构造正负样本
```

**任务 2：对话意图分类**

```
输入：用户消息
标签：意图类别（code/chat/search/task/...）
数据：从 Buddy 对话日志中提取
```

**任务 3：代码-自然语言对齐**

```
输入：(代码片段, 自然语言描述) 对
标签：1=匹配，0=不匹配
数据：GitHub issues + code pairs
```

**多任务联合训练**：

```typescript
const totalLoss = λ1 * retrievalLoss + λ2 * intentLoss + λ3 * codeAlignLoss;
// λ1=0.5, λ2=0.3, λ3=0.2
```

#### Phase 3：持续在线学习（永久）

**目标**：ByteEncoder 随使用持续进化。

**方法**：用户交互数据 → 对比学习微调

```
用户问："怎么修复这个 bug"
Buddy 答："在 ws-handler.ts 第 632 行..."
用户反馈：✅ 有用

→ 构造正样本对：("怎么修复这个 bug", "ws-handler.ts 第 632 行")
→ 写入训练队列
→ 定期批量微调（每 100 条或每天）
```

**实现**：

```typescript
class OnlineContrastiveLearner {
  private buffer: Array<{ anchor: string; positive: string; negative: string }> = [];
  private bufferSize = 1000;
  private trainInterval = 100; // 每 100 条训练一次

  addPair(anchor: string, positive: string, negative: string): void {
    this.buffer.push({ anchor, positive, negative });
    if (this.buffer.length >= this.trainInterval) {
      this.train();
    }
  }

  private async train(): Promise<void> {
    const batch = this.buffer.splice(0, this.trainInterval);
    // 小批量微调，学习率衰减
    for (const { anchor, positive, negative } of batch) {
      const za = encoder.forwardPooled(anchor);
      const zp = encoder.forwardPooled(positive);
      const zn = encoder.forwardPooled(negative);
      const loss = tripletLoss(za, zp, zn, margin=0.3);
      loss.backward();
    }
    optimizer.step();
  }
}
```

### 2.3 系统集成

#### 接入记忆检索

```typescript
// 当前：记忆检索用 TF-IDF / Embedding API
// 目标：ByteEncoder 作为本地 embedding provider

class ByteEncoderEmbeddingProvider {
  name = 'byte-encoder-local';
  dimensions = 384;
  private encoder: TextEncoder;

  async embed(text: string): Promise<number[]> {
    const tensor = this.encoder.forwardPooled(text);
    return Array.from(tensor.data);
  }

  isAvailable(): boolean {
    return true; // 始终可用，零依赖
  }
}

// 注册到 embedding 降级链
// 优先级：ONNX → API → ByteEncoder → TF-IDF
```

#### 接入三脑决策

```typescript
// 右脑：用 ByteEncoder 替代当前的随机权重
const semanticVec = encoder.forwardPooled(input);  // 384维
const intuition = await this.intuitionNet.forward(semanticVec);

// 经验图谱：用 ByteEncoder 做语义匹配
const queryVec = encoder.forwardPooled(query);
for (const exp of experiences) {
  const expVec = encoder.forwardPooled(exp.description);
  const similarity = cosineSimilarity(queryVec, expVec);
  // ...
}
```

#### 接入 EnhancedTfIdf

```typescript
// EnhancedTfIdf 的同义词扩展可以用 ByteEncoder 的语义相似度自动发现
class AutoSynonymDiscovery {
  discover(corpus: string[]): Map<string, string[]> {
    const synonyms = new Map<string, string[]>();
    const vocab = extractVocab(corpus);

    // 对每个词计算 embedding
    const embeddings = new Map<string, Float32Array>();
    for (const word of vocab) {
      embeddings.set(word, encoder.forwardPooled(word));
    }

    // 找语义相近的词对
    for (const [w1, e1] of embeddings) {
      for (const [w2, e2] of embeddings) {
        if (w1 >= w2) continue;
        const sim = cosineSimilarity(e1, e2);
        if (sim > 0.8) {
          // 自动发现同义词
          addSynonym(synonyms, w1, w2);
        }
      }
    }
    return synonyms;
  }
}
```

---

## 三、执行计划

### Phase 1：架构优化（6h）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1.1 | 升级配置：4层/6头/384维/768 FFN | `src/brain/right/features/text-encoder.ts` |
| 1.2 | 实现 RoPE 位置编码 | `src/brain/right/features/rope.ts` |
| 1.3 | 实现 AttentionPooling | `src/brain/right/features/attention-pooling.ts` |
| 1.4 | 实现 LearnedMerge | `src/brain/right/features/learned-merge.ts` |
| 1.5 | 更新序列化/反序列化 | `src/brain/right/features/text-encoder.ts` |
| 1.6 | 更新单例和缓存 | `src/brain/right/features/text-encoder-singleton.ts` |

### Phase 2：训练框架（8h）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 2.1 | 实现反向传播（autograd） | `src/brain/right/nn/autograd.ts` |
| 2.2 | 实现 AdamW 优化器 | `src/brain/right/training/adamw.ts` |
| 2.3 | 实现 InfoNCE 对比损失 | `src/brain/right/training/contrastive-loss.ts` |
| 2.4 | 实现数据加载器 | `src/brain/right/training/dataloader.ts` |
| 2.5 | 实现训练循环 | `src/brain/right/training/text-encoder-trainer.ts` |
| 2.6 | 实现评估脚本（相似度 benchmark） | `src/brain/right/training/eval-benchmark.ts` |

### Phase 3：预训数据准备（4h）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 3.1 | 中文语料下载/清洗脚本 | `scripts/prepare-training-data.ts` |
| 3.2 | 代码-文本对构造 | `scripts/code-text-pairs.ts` |
| 3.3 | Buddy 对话日志提取 | `scripts/extract-conversations.ts` |
| 3.4 | 数据格式标准化 | `src/brain/right/training/dataset.ts` |

### Phase 4：预训执行（持续）

| 阶段 | 内容 | 时长 |
|------|------|------|
| Phase 1 | 对比学习预训（中文通用语义） | 2-4 周 |
| Phase 2 | 任务适配（记忆检索+意图+代码对齐） | 1-2 周 |
| Phase 3 | 持续在线学习 | 永久 |

### Phase 5：系统集成（6h）

| 步骤 | 改动 | 文件 |
|------|------|------|
| 5.1 | ByteEncoder 作为 embedding provider | `src/core/embedding-providers/byte-encoder-provider.ts` |
| 5.2 | 注册到 embedding 降级链 | `src/core/subsystems.ts` |
| 5.3 | 右脑用 ByteEncoder 替代随机权重 | `src/brain/right/index.ts` |
| 5.4 | 经验图谱语义匹配增强 | `src/intelligence/experience-graph.ts` |
| 5.5 | EnhancedTfIdf 自动同义词发现 | `src/core/embedding-providers/enhanced-tfidf.ts` |

---

## 四、预期效果

### 训练前后对比

| 指标 | 训练前（当前） | Phase 1 后 | Phase 2 后 | 持续学习后 |
|------|-------------|-----------|-----------|-----------|
| 语义相似度（Spearman） | ~0.05（随机） | ~0.65 | ~0.78 | ~0.85+ |
| 记忆检索 MRR | N/A | ~0.3 | ~0.5 | ~0.7+ |
| 延迟 | ~10ms | ~15ms | ~15ms | ~15ms |
| 模型大小 | ~600KB | ~8MB | ~8MB | ~8MB |

### 系统收益

| 收益 | 说明 |
|------|------|
| **本地语义检索** | 不依赖外部 API，ByteEncoder 直接做 embedding |
| **三脑 NN 输入质量提升** | 128 维随机 → 384 维训练语义向量 |
| **经验图谱匹配增强** | 关键词匹配 → 语义匹配 |
| **同义词自动发现** | 不再依赖人工维护同义词表 |
| **零外部依赖** | 纯 TypeScript，不需要 @huggingface/transformers |
| **持续进化** | 用户使用越多，ByteEncoder 越准 |

### 与 External Embedding 对比

| 维度 | ByteEncoder（训练后） | bge-small-zh | OpenAI Embedding |
|------|---------------------|-------------|-----------------|
| 质量 | ★★★★ | ★★★★ | ★★★★★ |
| 延迟 | ~15ms（本地） | ~50ms（本地）/ ~100ms（API） | ~200ms（API） |
| 依赖 | 零 | @huggingface/transformers | 外部 API |
| 离线 | ✅ | ✅ | ❌ |
| 持续学习 | ✅ | ❌ | ❌ |
| 模型大小 | ~8MB | ~50MB | N/A |
| 代码理解 | ✅（预训时包含） | 弱 | 弱 |

**核心优势**：ByteEncoder 是 Buddy 自有的、持续进化的、零依赖的语义引擎。训练后质量可比 bge-small-zh，但延迟更低、体积更小、支持持续学习。

---

## 五、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 自研 autograd 稳定性 | 中 | 训练不收敛 | 先用小模型验证，逐步扩大 |
| 训练数据质量 | 中 | 语义表示不准 | 数据清洗 + 人工校验 |
| 训练时间过长 | 低 | 进度延迟 | 支持断点续训 |
| 在线学习灾难性遗忘 | 中 | 旧知识丢失 | 定期回放旧数据 + EWC 正则化 |
| 8MB 模型加载时间 | 低 | 启动变慢 | 懒加载 + 序列化缓存 |
