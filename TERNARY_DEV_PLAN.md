# 三进制增量微模型 — 开发计划

> 基于 `TERNARY_LORA_ANALYSIS.md` 架构方案，落地为可执行开发任务
> 2026-04-21

---

## 总览

```
Phase 1         Phase 2         Phase 3         Phase 4         Phase 5
格式+存储        推理引擎        增量训练        蒸馏管线        商城生态
(1.5 周)        (2 周)          (2 周)          (3 周)          (1.5 周)
   │               │               │               │               │
   ▼               ▼               ▼               ▼               ▼
.ta 格式         本地推理         自动成长        独立小模型       商城分发
权重管理         纯 CPU          夜间增量        无基座依赖       安装/交易
   │               │               │               │               │
   └─────── 可交付测试 ──────┘     └── 可交付测试 ──┘
```

总计 **10 周**，1 个全职开发者。

---

## Phase 1：三进制格式 + 存储层（1.5 周）

> 目标：定义 .ta 格式，实现三进制权重的存储、读取、管理

### 1.1 .ta 格式规范定义（0.5 天）

新建 `src/ternary/format.ts`，定义三进制模型格式：

```typescript
// .ta 文件结构
interface TernaryModelMeta {
  version: string;              // "1.0.0"
  domain: string;               // 领域名
  baseModel: string;            // 蒸馏来源模型
  architecture: string;         // "ternary-transformer-100m"
  inFeatures: number;           // 输入维度
  outFeatures: number;          // 输出维度
  rank: number;                 // LoRA rank (训练阶段)
  numLayers: number;            // Transformer 层数
  quantBits: number;            // 基座量化位宽 (4)
  threshold: number;            // 阈值
  totalParams: number;          // 总参数量
  growthStage: 'seed' | 'sprout' | 'growing' | 'trainable' | 'mature';
  trainSteps: number;           // 累计训练步数
  lastUpdated: number;          // 上次更新时间戳
  checksum: string;             // sha256
}

// 二进制布局:
// [Header JSON length: 4 bytes]
// [Header JSON: variable]
// [A matrix: packed 2-bit, inFeatures × rank]
// [B matrix: packed 2-bit, rank × outFeatures]
// [Offset factors: fp16, numGroups × outFeatures] (optional)
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 定义 TernaryModelMeta 接口 | `src/ternary/format.ts` | 0.5 天 |
| 定义二进制布局常量 | `src/ternary/format.ts` | 包含在内 |

### 1.2 三进制打包/解包（1 天）

新建 `src/ternary/codec.ts`：

```typescript
class TernaryCodec {
  // {-1, 0, 1} → 2-bit packed (00=0, 01=+1, 10=-1)
  static pack(ternary: Int8Array): Uint8Array
  static unpack(packed: Uint8Array, length: number): Int8Array
  
  // 文件读写
  static encode(model: TernaryModel): ArrayBuffer
  static decode(buffer: ArrayBuffer): TernaryModel
  
  // 体积计算
  static estimateSize(inFeatures: number, rank: number, outFeatures: number): number
  static estimateModelSize(numParams: number): number  // 1B → ~190MB
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 2-bit 打包/解包算法 | `src/ternary/codec.ts` | 0.5 天 |
| .ta 文件 encode/decode | `src/ternary/codec.ts` | 0.5 天 |
| 体积估算工具函数 | `src/ternary/codec.ts` | 包含在内 |

### 1.3 三进制模型管理器（1 天）

改造 `src/lora/service.ts` → 或新建 `src/ternary/manager.ts`：

```typescript
class TernaryModelManager {
  init(): Promise<void>                    // 扫描本地模型
  list(): TernaryModelMeta[]               // 列出所有模型
  get(domain: string): TernaryModelMeta | null
  save(model: TernaryModel): Promise<void> // 保存到 ~/.buddy/models/
  delete(domain: string): Promise<boolean>
  getInfo(domain: string): ModelInfo       // 体积/参数量/成长阶段
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 本地模型扫描+索引 | `src/ternary/manager.ts` | 0.5 天 |
| CRUD 操作 + 元数据持久化 | `src/ternary/manager.ts` | 0.5 天 |

### 1.4 测试（0.5 天）

新建 `src/ternary/format.test.ts`：

| 测试项 | 验证点 |
|--------|--------|
| 打包/解包 roundtrip | {-1,0,1} → pack → unpack == 原始 |
| 文件 encode/decode | 完整 .ta 文件读写无损 |
| 体积估算准确性 | 1B 参数 ≈ 190 MB |
| 大矩阵性能 | 4096×4096 打包 < 100ms |

### Phase 1 交付物

- [ ] `.ta` 格式规范文档
- [ ] `src/ternary/format.ts` — 格式定义
- [ ] `src/ternary/codec.ts` — 打包/解包
- [ ] `src/ternary/manager.ts` — 模型管理
- [ ] `src/ternary/format.test.ts` — 测试全部通过

---

## Phase 2：推理引擎（2 周）

> 目标：三进制模型本地推理，纯 CPU 整数运算

### 2.1 三进制矩阵运算核心（2 天）

新建 `src/ternary/compute.ts`：

```typescript
class TernaryCompute {
  // 核心: 三进制矩阵 × 向量 (乘法变加法)
  static matVecMul(
    weights: Int8Array,    // {-1, 0, 1} 打包的权重矩阵
    input: Float32Array,   // 输入向量
    output: Float32Array,  // 输出向量
    rows: number,
    cols: number
  ): void
  
  // 批量矩阵乘
  static batchMatMul(weights: Int8Array, inputs: Float32Array[], ...): Float32Array[]
  
  // 注意力计算 (Q, K, V 三进制)
  static ternaryAttention(
    Q: Int8Array, K: Int8Array, V: Int8Array,
    input: Float32Array, seqLen: number
  ): Float32Array
}
```

性能目标：
- 4096×4096 矩阵 × 4096 向量 < 20ms (纯 JS)
- 如果不够快，WASM 回退

| 任务 | 文件 | 耗时 |
|------|------|------|
| 三进制 matVec 优化实现 | `src/ternary/compute.ts` | 1 天 |
| 批量运算 + 注意力 | `src/ternary/compute.ts` | 1 天 |

### 2.2 前向推理引擎（2 天）

新建 `src/ternary/engine.ts`：

```typescript
class TernaryEngine {
  private model: TernaryModel
  private kvCache: KVCache
  
  load(modelPath: string): Promise<void>     // 加载 .ta 模型
  unload(): void                              // 释放内存
  
  // 单步解码
  decode(tokenId: number): Promise<{ logits: Float32Array; nextToken: number }>
  
  // 流式生成
  generate(prompt: string, maxTokens: number): AsyncIterable<string>
  
  // 性能统计
  getStats(): { tokPerSec: number; memoryMB: number }
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 模型加载 + 初始化 | `src/ternary/engine.ts` | 0.5 天 |
| Transformer 前向传播 | `src/ternary/engine.ts` | 1 天 |
| KV Cache + 流式解码 | `src/ternary/engine.ts` | 0.5 天 |

### 2.3 Tokenizer 集成（0.5 天）

```typescript
// 使用 sentencepiece 或 BPE tokenizer
// tokenizer 文件随 .ta 模型一起分发
class TernaryTokenizer {
  encode(text: string): number[]
  decode(ids: number[]): string
  load(tokenizerPath: string): Promise<void>
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| Tokenizer 加载+编解码 | `src/ternary/tokenizer.ts` | 0.5 天 |

### 2.4 Buddy 工具集成（1 天）

将三进制引擎注册为 Buddy 工具：

```typescript
// 注册到 src/tools/builtin.ts 或新建 src/tools/ternary-expert.ts
{
  name: 'ternary_expert_query',
  description: '使用本地三进制专家模型回答领域问题',
  parameters: {
    domain: string,      // 领域名
    question: string,     // 问题
  },
  execute: async ({ domain, question }) => {
    const engine = await getEngine(domain)
    return engine.generate(question, 256)
  }
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 工具注册 + 路由逻辑 | `src/tools/ternary-expert.ts` | 0.5 天 |
| 领域选择策略 (哪个专家回答) | `src/tools/ternary-expert.ts` | 0.5 天 |

### 2.5 性能基准 + 测试（1.5 天）

| 测试项 | 目标 |
|--------|------|
| 单层推理延迟 | 4096×4096 < 20ms |
| 完整模型推理 | 100M 参数 < 2s 首 token |
| 生成速度 | > 10 tok/s (Node.js) |
| 内存占用 | 100M 模型 < 100 MB RAM |
| 与 FP16 对比 | 精度损失 < 5% |

| 任务 | 文件 | 耗时 |
|------|------|------|
| 性能基准脚本 | `src/ternary/bench.ts` | 0.5 天 |
| 推理正确性测试 | `src/ternary/engine.test.ts` | 0.5 天 |
| WASM 回退实现（如需要） | `src/ternary/compute.wasm` | 0.5 天 |

### Phase 2 交付物

- [ ] `src/ternary/compute.ts` — 三进制矩阵运算
- [ ] `src/ternary/engine.ts` — 推理引擎
- [ ] `src/ternary/tokenizer.ts` — Tokenizer
- [ ] `src/tools/ternary-expert.ts` — Buddy 工具集成
- [ ] `src/ternary/bench.ts` — 性能基准
- [ ] 推理速度 > 10 tok/s，精度损失 < 5%

---

## Phase 3：增量训练 + 自动成长（2 周）

> 目标：模型夜间自动增量训练，用户无感

### 3.1 t-SignSGD 实现（1 天）

新建 `src/ternary/optimizer.ts`：

```typescript
class TernarySignSGD {
  // 基于 LoTA-QAF t-SignSGD 的 TypeScript 实现
  step(
    A: Int8Array,           // 三进制权重 {-1,0,1}
    B: Float32Array,        // 浮点权重
    gradB: Float32Array,    // B 的梯度
    stepCount: number,
    totalSteps: number
  ): void
  
  // 动态阈值调度
  // phase 1 (0-80%): threshold_ratio 0.95→0.999
  // phase 2 (80-100%): 0.999→0.9999
  private computeSigma(progress: number): number
  
  // 符号梯度下降 + 三值化约束
  private signUpdate(param: Float32Array, grad: Float32Array, sigma: number): void
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| t-SignSGD 核心逻辑 | `src/ternary/optimizer.ts` | 0.5 天 |
| 阈值调度 + 梯度过滤 | `src/ternary/optimizer.ts` | 0.5 天 |

### 3.2 增量训练流程（2 天）

新建 `src/ternary/trainer.ts`：

```typescript
class IncrementalTrainer {
  // 从 STMP 提取新知识 → 生成训练样本
  prepareTrainingData(domain: string): Promise<TrainingSample[]>
  
  // 单次增量训练
  trainStep(
    model: TernaryModel,
    samples: TrainingSample[],
    steps: number  // 默认 10 步
  ): Promise<TrainingResult>
  
  // 夜间自动训练
  async autoTrain(domain: string): Promise<void> {
    const samples = await this.prepareTrainingData(domain)
    if (samples.length === 0) return  // 预检过滤
    const result = await this.trainStep(model, samples, 10)
    await this.saveModel(model)  // 更新本地模型
  }
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| STMP → 训练样本管线 | `src/ternary/trainer.ts` | 1 天 |
| 增量训练主循环 | `src/ternary/trainer.ts` | 1 天 |

### 3.3 心跳集成 + 自动触发（1 天）

改造 `HEARTBEAT.md` 逻辑：

```typescript
// 在心跳检查时触发增量训练
// 条件: 有新知识 + 距上次训练 > 24h + 用户不活跃时段

if (hasNewKnowledge(domain) && hoursSinceLastTrain(domain) > 24 && isIdleTime()) {
  await trainer.autoTrain(domain)
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 心跳触发条件判断 | `src/ternary/scheduler.ts` | 0.5 天 |
| 训练状态持久化 | `src/ternary/scheduler.ts` | 0.5 天 |

### 3.4 成长模式切换（0.5 天）

```typescript
// 模式 B (变深): 固定参数量，0 比例降低
// 模式 A (变大): 扩展参数量
// 自动判断何时切换

function shouldGrowDeeper(stats: DomainStats): boolean {
  const zeroRatio = countZeros(model.weights) / totalParams
  return zeroRatio > 0.3  // 还有容量，继续变深
}

function shouldGrowWider(stats: DomainStats): boolean {
  const zeroRatio = countZeros(model.weights) / totalParams
  return zeroRatio <= 0.3 && stats.knowledgeCount > threshold
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 模式 A/B 策略 | `src/ternary/growth.ts` | 0.5 天 |

### 3.5 测试（1.5 天）

| 测试项 | 验证点 |
|--------|--------|
| t-SignSGD 收敛 | 损失下降，三进制约束保持 |
| 增量训练正确性 | 新知识后模型输出变化 |
| 灾难性遗忘 | 旧知识准确率不显著下降 |
| 夜间触发 | 心跳条件正确判断 |

### Phase 3 交付物

- [ ] `src/ternary/optimizer.ts` — t-SignSGD
- [ ] `src/ternary/trainer.ts` — 增量训练
- [ ] `src/ternary/scheduler.ts` — 自动调度
- [ ] `src/ternary/growth.ts` — 成长模式
- [ ] 夜间自动增量训练运行正常

---

## Phase 4：蒸馏管线（3 周）

> 目标：大模型知识 → 独立三进制小模型，不依赖基座

### 4.1 蒸馏数据准备（1 天）

```typescript
// 从 STMP + 大模型生成蒸馏训练数据
class DistillDataPrep {
  // 让大模型为每条知识生成问答对 + 推理链
  async generateDistillSamples(domain: string): Promise<DistillSample[]>
  
  // Self-Instruct 扩增: 1 条 → 5-10 条
  async augment(samples: DistillSample[]): Promise<DistillSample[]>
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 蒸馏数据管线 | `src/ternary/distill-prep.ts` | 1 天 |

### 4.2 三进制小模型架构（2 天）

新建 `src/ternary/architecture.ts`：

```typescript
// 轻量三进制 Transformer 架构
interface TernaryTransformerConfig {
  vocabSize: number        // 词表大小 (32000)
  hiddenSize: number       // 隐藏层维度 (768 for 100M, 2048 for 1B)
  numLayers: number        // 层数 (12 for 100M, 24 for 1B)
  numHeads: number         // 注意力头数
  intermediateSize: number // FFN 中间层维度
  maxSeqLen: number        // 最大序列长度
}

// 三个规模预设
const PRESETS = {
  tiny:   { hiddenSize: 768,  numLayers: 12, totalParams: 100_000_000  },  // ~20 MB
  small:  { hiddenSize: 1024, numLayers: 16, totalParams: 300_000_000  },  // ~60 MB
  medium: { hiddenSize: 2048, numLayers: 24, totalParams: 1_000_000_000 }, // ~190 MB
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 架构定义 + 预设 | `src/ternary/architecture.ts` | 0.5 天 |
| 权重初始化 + 结构构建 | `src/ternary/architecture.ts` | 1 天 |
| 参数量计算 + 体积预估 | `src/ternary/architecture.ts` | 0.5 天 |

### 4.3 知识蒸馏训练（3 天）

新建 `src/ternary/distill.ts`：

```typescript
class KnowledgeDistiller {
  // 从大模型（教师）蒸馏到三进制小模型（学生）
  async distill(
    teacherModel: string,      // 大模型 API (如 Qwen-72B)
    studentConfig: TernaryTransformerConfig,
    trainingData: DistillSample[],
    outputDir: string
  ): Promise<TernaryModel>
  
  // 蒸馏损失: KL散度 + 任务损失
  private computeLoss(
    teacherLogits: Float32Array,
    studentLogits: Float32Array,
    labels: number[]
  ): number
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 教师-学生蒸馏循环 | `src/ternary/distill.ts` | 1.5 天 |
| 损失函数 + 温度调度 | `src/ternary/distill.ts` | 0.5 天 |
| 导出 .ta 格式 | `src/ternary/distill.ts` | 1 天 |

### 4.4 质量评估（1 天）

```typescript
class ModelEvaluator {
  // 领域准确率测试
  async evalDomainAccuracy(model: TernaryModel, testData: TestSample[]): Promise<number>
  
  // 与大模型对比
  async compareWithTeacher(
    studentModel: TernaryModel,
    teacherApi: string,
    questions: string[]
  ): Promise<ComparisonResult>
  
  // 成长阶段评估
  async assessGrowthStage(model: TernaryModel): Promise<GrowthStage>
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 评估框架 | `src/ternary/eval.ts` | 0.5 天 |
| 自动化测试用例 | `src/ternary/eval.ts` | 0.5 天 |

### 4.5 云端训练对接（2 天）

```typescript
// 对接 AutoDL / 硅基流动 GPU 服务
class CloudTrainer {
  async submitDistillJob(config: DistillJobConfig): Promise<string>  // 返回 job ID
  async getStatus(jobId: string): Promise<JobStatus>
  async downloadResult(jobId: string): Promise<TernaryModel>
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 云端 API 对接 | `src/ternary/cloud-trainer.ts` | 1 天 |
| 任务状态轮询/Webhook | `src/ternary/cloud-trainer.ts` | 0.5 天 |
| 下载 + 校验 | `src/ternary/cloud-trainer.ts` | 0.5 天 |

### 4.6 测试（2 天）

| 测试项 | 验证点 |
|--------|--------|
| 蒸馏效果 | 100M 学生模型 vs 70B 教师，领域准确率 > 80% |
| 三进制约束 | 全部权重 ∈ {-1, 0, 1} |
| 推理独立性 | 不连接任何 API，纯本地运行 |
| 模型体积 | 100M ≈ 20MB, 1B ≈ 190MB |

### Phase 4 交付物

- [ ] `src/ternary/distill-prep.ts` — 蒸馏数据
- [ ] `src/ternary/architecture.ts` — 模型架构
- [ ] `src/ternary/distill.ts` — 蒸馏训练
- [ ] `src/ternary/eval.ts` — 质量评估
- [ ] `src/ternary/cloud-trainer.ts` — 云端对接
- [ ] 100M 三进制模型独立推理，领域准确率 > 80%

---

## Phase 5：商城 + 生态（1.5 周）

> 目标：用户可购买、安装、分享三进制专家模型

### 5.1 商城接口（1 天）

改造 `src/shop/catalog.ts`：

```typescript
interface ExpertModelListing {
  domain: string
  name: string
  description: string
  author: string
  architecture: string          // "ternary-100m"
  sizeBytes: number             // 体积
  growthStage: GrowthStage      // 成长阶段
  accuracy: number              // 领域准确率
  price: number                 // 价格（免费/付费）
  downloads: number
  rating: number
  versions: ModelVersion[]
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 商城列表 + 详情 | `src/shop/catalog.ts` | 0.5 天 |
| 搜索 + 筛选 | `src/shop/catalog.ts` | 0.5 天 |

### 5.2 安装/卸载（0.5 天）

```typescript
class ExpertModelInstaller {
  async install(domain: string): Promise<void>     // 下载 + 校验 + 注册
  async uninstall(domain: string): Promise<void>   // 删除 + 反注册
  async update(domain: string): Promise<void>      // 增量更新
}
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 安装流程 | `src/shop/installer.ts` | 0.5 天 |

### 5.3 用户界面展示（1 天）

前端改造：

```
我的专家模型
┌────────────────────────────────────────┐
│ 🔵 Go 专家    40MB  ★★★☆☆  成长中     │
│    200M参数 · 上次更新: 2小时前          │
│    [使用] [详情] [删除]                 │
├────────────────────────────────────────┤
│ 🟢 法务专家   100MB ★★★★☆  成熟       │
│    500M参数 · 上次更新: 1天前            │
│    [使用] [详情] [删除]                 │
├────────────────────────────────────────┤
│ 📦 发现更多专家模型 → 商城              │
└────────────────────────────────────────┘
```

| 任务 | 文件 | 耗时 |
|------|------|------|
| 专家模型列表组件 | `frontend/src/components/Experts.tsx` | 0.5 天 |
| 成长进度展示 | `frontend/src/components/ExpertCard.tsx` | 0.5 天 |

### 5.4 测试（1 天）

| 测试项 | 验证点 |
|--------|--------|
| 安装流程 | 下载 → 校验 → 注册 → 可用 |
| 体积展示 | 准确显示 20MB/60MB/190MB |
| 切换速度 | 领域切换 < 100ms |

### Phase 5 交付物

- [ ] 商城三进制模型列表
- [ ] 一键安装/卸载
- [ ] 前端专家模型管理界面
- [ ] 完整用户体验闭环

---

## 依赖关系

```
Phase 1 ──→ Phase 2 ──→ Phase 3
(format)    (inference)  (incremental)
                          │
                          ▼
                       Phase 4 ──→ Phase 5
                       (distill)    (marketplace)

Phase 1 和 Phase 2 可以部分并行
Phase 3 和 Phase 4 有依赖 (增量训练需要推理引擎)
Phase 5 依赖 Phase 4 (有模型才能上架)
```

---

## 技术栈

| 组件 | 技术选型 | 备选 |
|------|---------|------|
| 三进制运算 | 纯 TypeScript + DataView | WASM (如性能不够) |
| 推理引擎 | 纯 JS Transformer | ONNX Runtime (如精度要求高) |
| 训练 (云端) | Python + PyTorch + LoTA-QAF | 硅基流动/AutoDL |
| Tokenizer | sentencepiece WASM | tiktoken |
| 模型格式 | 自定义 .ta 二进制 | GGUF (如需兼容 llama.cpp) |
| 商城 | 现有 src/shop/ 扩展 | — |

---

## 关键里程碑

| 周 | 里程碑 | 验证标准 |
|----|--------|---------|
| W2 | .ta 格式可用 | 可存储/读取/列出三进制模型 |
| W4 | 本地推理跑通 | 100M 模型 > 10 tok/s, 精度 < 5% 损失 |
| W6 | 增量训练自动运行 | 夜间自动增量, 模型能力提升可感知 |
| W9 | 端到端蒸馏 | 大模型知识 → 100M 三进制模型独立运行 |
| W10 | 商城上线 | 用户可发现/安装/使用专家模型 |

---

*v1.0 — 2026-04-21 | 从架构方案到可执行开发计划*
