# 原型记忆层 — 双通道意图表征方案

> 在保留 intentHead 监督信号的基础上，叠加原型层实现动态意图发现与数据驱动的工具选择
> 预估工期：3-4 天

---

## 一、问题

当前右脑 NN 的意图分类是硬编码的 8 类离散系统：

```
input → NN → hidden[128] → intentHead(128→8, softmax) → argmax → "code_operations"
```

**问题：**
1. 意图数量固定，无法从数据中发现新模式
2. 新类需要 `expandIntentHead` 改 NN 结构 + 重新训练
3. 工具选择依赖离散类别到工具的静态映射
4. 低置信度时无法判断是"见过但不确定"还是"真的没见过"

**注意：** intentHead 的交叉熵 loss 为 hidden 空间提供了关键的意图监督信号，确保 backbone 学到的表征对意图有区分度。不能去掉。

---

## 二、方案：原型记忆层（Prototype Memory）— 双通道架构

**核心思想：** 不改 NN 架构，不替代 intentHead，在推理时叠加一层原型匹配。两个通道并行运行，各司其职。

```
训练时（不变）：
  NN backbone + 5 个输出头联合训练
  intentHead 的 crossEntropy loss → 确保 hidden 空间有意图结构
  ↓
  hidden[128] 是一个对意图、工具、质量、空间、场景都有区分度的表征

推理时（新增原型通道）：
  hidden[128] 出来后同时走两个通道：

  通道 A（现有）：intentHead → argmax → 8 类意图（快速、确定）
  通道 B（新增）：原型匹配 → 最近原型 → label + toolDist（动态、模糊）

  两个通道的输出合并为最终 IntuitionSignal
```

**为什么双通道而不是替代：**
- intentHead 提供训练时的监督信号（loss → gradient → backbone 学到意图结构）
- 原型层利用这个结构做更精细的推理（最近邻 + 动态扩展 + 工具先验）
- 两者共享同一份 hidden[128] 表征，互不干扰
- 意图是"骨架"（保证表征质量），原型是"肌肉"（利用表征做决策）

**参考论文：**
- Prototypical Networks (Snell, NeurIPS 2017) — embedding 空间最近邻分类
- PLPCL (Deng, EMNLP 2024) — 伪标签原型对比发现新意图
- Instruct-LF (Xie, NAACL 2025) — LLM + 统计模型联合发现潜在因子

---

## 三、数据结构

### 3.1 Prototype

```typescript
interface Prototype {
  /** 唯一标识 */
  id: string;
  /** 人类可读标签（初始 8 个预设，后续由 LLM 或规则生成） */
  label: string;
  /** 类中心向量 [128]，在线 EMA 更新 */
  centroid: Float32Array;
  /** 归入此类的累计样本数 */
  count: number;
  /** 工具使用分布：toolName → 使用次数 */
  toolDist: Map<string, number>;
  /** 最近 N 次工具成功率 */
  toolSuccess: Map<string, { attempts: number; successes: number }>;
  /** 创建时间 */
  firstSeen: number;
  /** 最近命中时间 */
  lastSeen: number;
  /** 是否为种子原型（不可衰减删除） */
  isSeed: boolean;
  /** 原型标签（用于调试） */
  tags: string[];
}
```

### 3.2 NoveltyCandidate（暂存区）

```typescript
interface NoveltyCandidate {
  /** 该簇的样本 embedding 列表（环形缓冲，最多 MAX_NOVEL_SAMPLES） */
  samples: Float32Array[];
  /** 累计观察次数 */
  observeCount: number;
  /** 首次观察时间 */
  firstSeen: number;
  /** 最近观察时间 */
  lastSeen: number;
  /** 该簇常用的工具 */
  toolHints: Map<string, number>;
}
```

### 3.3 PrototypeMemoryConfig

```typescript
interface PrototypeMemoryConfig {
  /** 新颖度阈值：到最近原型的余弦距离超过此值视为新意图（默认 0.6） */
  noveltyThreshold: number;
  /** 合并阈值：两个原型距离小于此值时合并（默认 0.3） */
  mergeThreshold: number;
  /** 新类确认所需的最少样本数（默认 5） */
  minNovelSamples: number;
  /** 原型最大数量（默认 32） */
  maxPrototypes: number;
  /** EMA 学习率（默认 0.1） */
  emaLR: number;
  /** 衰减周期：超过此时间未命中的原型衰减（默认 7 天） */
  decayAfterMs: number;
  /** 种子原型不衰减 */
  protectSeeds: boolean;
}
```

---

## 四、核心算法

### 4.1 最近原型匹配

```
输入: hidden[128] (NN 输出的 embedding)
输出: { prototype, distance, confidence, isNovel }

1. L2 归一化 hidden → unit_vec
2. 对每个 prototype.centroid 计算余弦相似度: cos_sim = dot(unit_vec, centroid_norm)
3. 余弦距离 = 1 - cos_sim
4. 找最近的原型 (min distance)
5. distance < noveltyThreshold → 命中
   - confidence = 1 - distance / noveltyThreshold (归一化到 0-1)
   - isNovel = false
6. distance ≥ noveltyThreshold → 新颖
   - confidence = distance (越远越不确定)
   - isNovel = true
```

### 4.2 在线原型更新（EMA）

```
命中原型 P 时：
  P.centroid = (1 - lr) * P.centroid + lr * hidden
  P.count++
  P.lastSeen = now
  lr = emaLR / sqrt(P.count)  // 随样本数衰减学习率
```

### 4.3 新意图发现流程

```
1. hidden 到所有原型距离 ≥ noveltyThreshold
2. 存入暂存区（按最近邻聚类分桶）
3. 暂存区某桶样本数 ≥ minNovelSamples:
   a. 计算该桶样本的均值作为新原型 centroid
   b. 统计该桶的 toolHints 作为初始 toolDist
   c. 创建新原型（label 暂定 "auto_<timestamp>"）
   d. 可选：调用 LLM 根据样本内容生成人类可读标签
   e. 清空该桶
4. 原型总数 ≥ maxPrototypes → 合并最近的一对原型
```

### 4.4 原型合并

```
当原型数达到 maxPrototypes:
1. 计算所有原型两两之间的余弦距离
2. 找距离最小的一对 (A, B)
3. 合并为新原型 C:
   - C.centroid = (A.centroid * A.count + B.centroid * B.count) / (A.count + B.count)
   - C.count = A.count + B.count
   - C.toolDist = merge(A.toolDist, B.toolDist)
   - C.isSeed = A.isSeed || B.isSeed  // 有种子则保留种子标记
   - C.label = A.count >= B.count ? A.label : B.label  // 保留样本多的标签
4. 删除 A, B，加入 C
```

### 4.5 原型衰减

```
定期检查（每次 heartbeat 或每小时）：
  for each prototype P:
    if now - P.lastSeen > decayAfterMs:
      if P.isSeed → 跳过
      else → 删除 P（或标记为 inactive）

目的：清理不再出现的意图模式，保持原型空间紧凑
```

---

## 五、与现有代码的集成

### 5.1 新文件

```
src/brain/right/
├── prototype-memory.ts           # PrototypeMemory 核心类
├── prototype-memory.test.ts      # 单元测试
```

### 5.2 改动文件

#### `src/brain/right/features/decoder.ts`

双通道合并：intentHead 和原型匹配并行运行，各出各的结果。

```typescript
// 调整后：两个都跑，各出各的结果
function decodeSignal(output: ModelOutput, protoMem?: PrototypeMemory): IntuitionSignal {
  // 通道 A：intentHead（始终运行）
  const intentResult = decodeIntent(output);  // argmax，不变

  // 通道 B：原型匹配（始终运行）
  let protoResult = null;
  if (protoMem && output._hidden) {
    protoResult = protoMem.findNearest(output._hidden);
  }

  // 合并：两个信号都保留
  return {
    intent: intentResult,                    // 来自 intentHead
    protoMatch: protoResult,                 // 来自原型层（新增字段）
    suggestedTools: protoResult && !protoResult.isNovel
      ? protoResult.prototype.topTools()     // 原型给工具先验
      : intentResult.tools,                  // fallback 到 intentHead 的工具
    qualityEstimate: output.qualityScore,
    hit: intentResult.confidence > threshold,
  };
}
```

#### `src/brain/types.ts`

IntuitionSignal 扩展 protoMatch 字段：

```typescript
export interface IntuitionSignal {
  intent: { category: string; confidence: number };
  protoMatch?: {                              // 新增
    prototype: { id: string; label: string };
    distance: number;
    isNovel: boolean;
  };
  suggestedTools: string[];
  qualityEstimate: number;
  hit: boolean;
}
```

#### `src/brain/right/index.ts`

```typescript
// RightBrain 类新增成员
private prototypeMemory: PrototypeMemory;

// 构造函数中初始化（从 8 个种子原型开始）
this.prototypeMemory = new PrototypeMemory(config);

// predict() 中：
const result = decodeSignal(output, this.prototypeMemory);

// 工具执行反馈：
onToolResult(protoId: string, toolName: string, success: boolean) {
  this.prototypeMemory.updateTool(protoId, toolName, success);
}
```

#### `src/brain/brain.ts`

```typescript
// decide() 中，工具执行后反馈
// 已有 feedback() 方法 → 接入 prototypeMemory.updateTool()
```

### 5.3 种子原型初始化

从现有 NN 的 intentHead 权重中提取 8 个种子原型：

```typescript
function seedFromIntentHead(model: IntuitionNet): Prototype[] {
  const weights = model.getIntentHeadWeights();  // [8, 128]
  const labels = INTENT_LABELS;
  return labels.map((label, i) => ({
    id: `seed_${label}`,
    label,
    centroid: normalize(weights.row(i)),
    count: 0,
    toolDist: new Map(),
    toolSuccess: new Map(),
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    isSeed: true,
    tags: ['seed'],
  }));
}
```

---

## 六、工具选择集成

### 6.1 原型 → 工具先验

每个原型维护 `toolDist: Map<string, number>`，记录该意图下各工具的使用频次。

当原型命中时：
```
suggestedTools = prototype.topTools(k=5)
  → 按使用频次排序，取 top 5
  → 返回 [{ name: 'read_file', probability: 0.6 }, ...]
```

工具分布是**从数据中学习的**，不是预设的。

### 6.2 与 Thompson Sampling 的协同

```
原型匹配 → 工具先验 (toolDist)
                ↓
Thompson Sampling: alpha = hist_weightedSuccesses + 1 + protoProb * 5
                ↓
             最终工具选择
```

原型给先验概率，Thompson Sampling 做探索/利用平衡。

---

## 七、LLM 命名（可选，Phase 2）

新原型创建后，用 LLM 分析该簇的输入样本，生成人类可读标签：

```typescript
async function namePrototype(samples: string[]): Promise<string> {
  const prompt = `分析以下用户输入模式，用 2-4 个字命名这个意图类别：
${samples.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join('\n')}

只返回类别名称，不要解释。`;

  return await llmCall([{ role: 'user', content: prompt }]);
}
```

这一步是可选的，不影响核心功能。

---

## 八、验收标准

### 基础功能
- [x] 8 个种子原型正确初始化（从 intentHead 权重提取）
- [x] 已知意图输入 → intentHead 和原型同时输出 → 两者一致时置信度提升
- [x] 意图和原型不一致时 → 标记为边界样本 → 可用于训练数据筛选
- [x] 新颖输入 → 距离超阈值 → 存入暂存区
- [x] 暂存区满 → 自动创建新原型
- [x] 原型数量达到上限 → 自动合并

### 学习闭环
- [x] 工具执行成功 → 更新原型的 toolDist
- [x] 原型的 centroid 随新样本 EMA 更新
- [x] 长期未命中的非种子原型被衰减删除

### 性能
- [x] 原型匹配延迟 < 0.1ms（32 原型 × 128 维 = 4096 次乘法）
- [x] 不影响 NN 前向传播延迟
- [x] 内存开销 < 50KB（32 原型 × 128 × 4 字节 ≈ 16KB + 元数据）

### 集成
- [x] intentHead 保持不变，训练信号不丢失
- [x] 原型层与 intentHead 并行运行，互不干扰
- [x] 原型输出工具先验 → Thompson Sampling 使用
- [ ] heartbeat 时执行原型衰减检查

---

## 九、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 原型漂移（centroid 偏移过大） | 中 | 旧意图识别变差 | EMA 学习率随样本数衰减；种子原型不衰减 |
| 碎片化（太多小原型） | 低 | 搜索变慢，语义重叠 | mergeThreshold 合并；maxPrototypes 硬上限 |
| 假新意图（阈值太松） | 中 | 噪声原型过多 | minNovelSamples ≥ 5 才确认；暂存区有时间窗口 |
| 遗忘（旧原型被覆盖） | 低 | 历史意图丢失 | 种子原型保护；定期快照 |
| 延迟增加 | 极低 | < 0.1ms | 32 原型 × 128 维 = O(4K) 浮点运算 |
| 高维空间距离失效 | 中 | 原型挤在一起 | 对比微调训练提升表征质量（中期优化） |

---

## 十、执行顺序

```
Phase 1: PrototypeMemory 核心类 + 单元测试 ✅ (2ea4010)
       ├── Prototype 数据结构
       ├── findNearest() — 余弦距离匹配
       ├── observeNovel() — 暂存区管理
       ├── createPrototype() — 新原型创建
       ├── updateCentroid() — EMA 更新
       └── merge/decay — 合并与衰减

Phase 2: 集成到 decoder + RightBrain（双通道）✅ (ecd0521)
       ├── types.ts: IntuitionSignal 扩展 protoMatch 字段
       ├── decoder.ts: decodeSignal() 双通道合并
       ├── right/index.ts: 初始化 + predict() 集成
       ├── 种子原型从 intentHead 权重提取
       └── 工具执行反馈闭环

Phase 3: Thompson Sampling 协成 + 测试 ✅ (e1b77b0)
       ├── 原型 toolDist → 工具先验
       ├── 与 thompsonSelectWithProbs 协同
       ├── 端到端测试（8 个集成测试）
       └── 性能基准测试
```
