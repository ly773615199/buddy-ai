# 三脑改造总计划：即战力 × 潜力双轨方案

> 版本: v1.0
> 日期: 2026-05-15
> 基于: 全量代码审计 + 学术研究调研 + 架构深度分析

---

## 一、设计原则

**每一步都是双收**：不做纯潜力投资（看不到回报），也不做纯即战力补丁（没有复利）。每个改动必须同时满足：

- ✅ **即战力**：改完立刻能用，效果可测量
- ✅ **潜力**：为后续阶段铺路，能力可累积

### 兼容性约束

- 现有 300K 参数的 IntuitionNet **不破坏**，新模块通过 **扩展** 接入
- OnlineLearner / ReplayBuffer / LPR 全部复用，只扩展接口
- 每个 Phase 独立可回滚，不影响线上

---

## 二、现状分析：三脑架构的三大缺口

### 架构信号流

```
用户文本 → signal-collector → TaskSignal(结构化) → 三脑决策 → ExecutionPlan(结构化) → 外部LLM生成回复
```

三脑架构**从不接触原始自然语言**，它只处理结构化的 `TaskSignal`（domain/complexity/taskType）和 `ResourceState`。

### ❌ 缺口一：语言理解

**现状**：`classifyFromText()` 是纯关键词匹配（`src/brain/right/index.ts:341`）

- "帮我看看那个配置文件有没有问题" → 匹配不到任何关键词 → 降级为 `conversation`
- 无法理解隐喻、省略、上下文指代
- NN 的输入是已经结构化后的 token IDs（domain=10, complexity=30 等），不是文本 embedding
- 右脑 NN 学的是「结构化信号 → 决策」的映射，**从未见过原始文字**

**根因**：三脑架构缺少一个 **文本编码器**（text encoder），无法将自然语言映射到语义向量空间。

### ❌ 缺口二：语言生成

**现状**：三脑输出的是 `ExecutionPlan`，`reason` 是内部日志，不是自然语言回复。

- 从 `ExecutionPlan` 到用户看到的文字，中间隔着一个外部 LLM 调用
- 三脑架构本身没有任何解码器/语言模型将决策翻译成自然语言
- 如果外部 LLM 不可用，三脑只能输出结构化 JSON

**根因**：架构设计上，语言生成被完全外包给了外部 LLM。三脑是「决策引擎」不是「表达引擎」。

### ❌ 缺口三：多模态理解

**现状**：`image-encoder.ts` 只提取像素级统计量（平均颜色、方差、边缘强度），等于"看色块"。

- 无法识别物体、文字、人脸、场景语义
- 完全没有音频处理（`src/voice/` 只有 TTS，没有 ASR）
- 视频帧用的也是同一个 image encoder，没有时序建模

**根因**：image encoder 是信号级的像素统计，不是感知级的语义理解。缺预训练视觉模型。

### 一句话总结

> 三脑架构是一个 **结构化决策引擎**，不是认知引擎。它能根据"已经理解好的信号"做决策，但**理解信号本身**（语言/图像/声音）的能力全部依赖外部 LLM。

---

## 三、理论研究支撑

### 3.1 语言理解层：Byte-Level 无分词编码

#### BLT — Byte Latent Transformer (Meta, 2024.12)
📄 [arxiv.org/abs/2412.09871](https://arxiv.org/abs/2412.09871)

- 字节级 LLM 首次匹配 token 化 LLM 的性能，且推理更高效
- **动态 Patch 切分**：根据下一个字节的熵（entropy）动态决定 patch 边界
- 高熵区域分配更多计算，低熵区域用更少计算
- 对 Buddy 的启发：TextEncoder 用熵驱动的动态合并，天然适配多语言混合输入

#### MrT5 — MergeT5 (Stanford/Princeton, 2024.10)
📄 [arxiv.org/abs/2410.20771](https://arxiv.org/abs/2410.20771)

- ByT5 的高效变体，通过学习式删除门动态缩短字节序列
- **序列长度减少 75%**，性能损失极小
- 多语言训练时自动学习不同语言的压缩率
- 对 Buddy 的启发：比 BLT 更轻量，delete gate 可直接复用现有 Tensor + sigmoid

### 3.2 推理能力：小模型也能 Chain-of-Thought

#### SCoTD — Symbolic Chain-of-Thought Distillation (ACL 2023)
📄 [arxiv.org/abs/2306.14050](https://arxiv.org/abs/2306.14050)

- 125M-1.3B 参数的小模型也能做 chain-of-thought 推理
- 关键发现：**从教师模型采样大量推理链（diversity > likelihood）比单条高质量推理链更重要**
- 对 Buddy 的启发：ReasoningHead 训练数据应批量采样多条推理链

#### Skip-Thinking / Chunk-wise Training (2025.05)
📄 [arxiv.org/abs/2505.18642](https://arxiv.org/abs/2505.18642)

- 推理链不需要每一步都"思考"，跳过非推理块可以更快更准
- **Skip-Thinking Training (STT)**：让小模型学会自动跳过非推理的中间块
- 对 Buddy 的启发：ReasoningHead 加 skip gate，与现有 Early Exit 机制一致

#### NoThinking — Reasoning Without Thinking (UC Berkeley, 2025.04)
📄 [arxiv.org/abs/2504.09858](https://arxiv.org/abs/2504.09858)

- 跳过显式思考过程，直接生成答案，配合并行采样效果更好
- 在低 token 预算下，NoThinking 优于 Thinking
- 关键技巧：**并行采样 N 条 + 置信度选择**
- 对 Buddy 的启发：ReasoningHead 支持 parallel decode

### 3.3 知识运用：RAG + 知识图谱

#### GFM-RAG — Graph Foundation Model for RAG (2025.02)
📄 [arxiv.org/abs/2502.01113](https://arxiv.org/abs/2502.01113)

- 用图基础模型做检索增强生成，将知识图谱结构融入 RAG
- GNN 编码知识图谱 → 与查询做交叉注意力 → 检索相关子图
- 对 Buddy 的启发：KnowledgeGate 用 GNN 编码知识图谱，复用现有 `gnn-layer.ts`

#### GRAG — Graph Retrieval-Augmented Generation (2024.05)
📄 [arxiv.org/abs/2405.16506](https://arxiv.org/abs/2405.16506)

- 图结构的 RAG 比平面 RAG 在多跳推理上显著更强
- 用图的邻接关系做推理路径展开
- 对 Buddy 的启发：经验图谱的边类型天然支持多跳推理

### 3.4 视觉理解：轻量级 Vision Transformer

#### MobileViT (Apple, 2021 → 持续迭代)
📄 [arxiv.org/abs/2110.02178](https://arxiv.org/abs/2110.02178)

- CNN + Transformer 混合，在移动设备上高效运行
- 参数量 < 5M，移动端推理 < 10ms
- 对 Buddy 的启发：VisionEncoder 用 CNN 前端 + Transformer 后端

#### EdgeViTs (2022 → 2024 优化)
📄 [arxiv.org/abs/2205.03436](https://arxiv.org/abs/2205.03436)

- **Local-Global-Local** 注意力——先局部注意力，再全局，再局部
- 适合 Buddy 的 CPU-only 场景

### 3.5 语音理解：轻量 ASR

#### PI-Whisper — 增量式语音识别 (2024.06)
📄 [arxiv.org/abs/2406.15668](https://arxiv.org/abs/2406.15668)

- 基于 Whisper-tiny（39M 参数），增量式改造——边听边识别
- 自适应计算：简单句子用更少层，复杂句子用更多层
- 对 Buddy 的启发：AudioEncoder 用 Whisper encoder 前几层 + 知识蒸馏

### 3.6 持续学习：防遗忘的最前沿

#### LPR — Layerwise Proximal Replay (ICML 2024)
📄 [arxiv.org/abs/2402.09542](https://arxiv.org/abs/2402.09542)

- 每层独立的近端约束，比 EWC 更轻量
- Buddy 已在用 LPR，但当前是全局 λ，论文建议每层独立 λ

### 3.7 结构化 Agent 蒸馏

#### Structured Agent Distillation (2025.05)
📄 [arxiv.org/abs/2505.13820](https://arxiv.org/abs/2505.13820)

- 将 LLM Agent 蒸馏到小模型，保留推理+行动能力
- 将轨迹分为 `[REASON]` 和 `[ACT]` 两种 span，对每种用不同 loss
- 对 Buddy 的启发：扩展 Distiller 为 span-level 蒸馏

---

## 四、改造方案：八个 Phase

### Phase 0：概念表征空间

> **即战力**：替代关键词匹配，中文/英文/混合输入的意图分类准确率从 ~40% 提升到 ~70%
> **潜力**：建立所有后续能力共享的语义空间——知识检索、推理、生成、多模态都生长在这之上

#### 0.1 ByteEncoder — 字节级文本编码器

**新建文件**：`src/brain/right/features/text-encoder.ts`

设计：UTF-8 字节 → ByteEmbedding(256, 32) → DynamicMerge → EncoderBlock×2 → [S', hiddenDim]

**关键设计：DynamicMerge（受 BLT + MrT5 启发）**

不是简单 Conv1D 固定窗口，而是熵驱动的动态合并：

- 高熵位置保留独立 token，低熵位置与相邻合并
- "的" "the" "a" 这些高频低熵字节 → 合并为 1 个 patch，节省计算
- "部署" "deploy" "config" 这些高熵字节 → 保留独立 token，保留细节
- 中文 UTF-8 三个字节一组，熵模式与英文不同 → 动态适配

**参数量**：

| 组件 | 参数 |
|------|------|
| ByteEmbedding(256, 32) | 8,192 |
| EntropyEstimator（无参数，纯计算） | 0 |
| Proj(32→128) | 4,096 |
| EncoderBlock×2 (d=128, h=4, ffn=256) | ~133,000 |
| **总计** | **~145K** |

#### 0.2 接入现有 backbone

**修改文件**：`src/brain/right/features/encoder.ts`

- 现有 `encodeFeatures()` 保持不变（向后兼容）
- 新增 `encodeFeaturesV2()` — 当有原始文本时走 TextEncoder 路径

**IntuitionNet 扩展**：`src/brain/right/nn/model.ts`

- 现有 `forward(tokenIds)` 保持不变
- 新增 `forwardWithText(tokenIds, textEmbedding)` — 混合路径
- 结构化 embedding + 文本 embedding 拼接后通过现有 encoder blocks

#### 0.3 训练信号来源

不需要额外标注数据，训练信号来自三个现有来源：

1. **对话意图标签**：用户发消息 → LLM 回复 → 从回复中反推意图
2. **工具使用结果**：用户说"读文件" → 系统执行 read_file → 成功/失败
3. **蒸馏**：外部 LLM 的决策 → 作为软标签蒸馏到 TextEncoder

#### 0.4 即战力验证

| 指标 | 改造前（关键词匹配） | 改造后目标 |
|------|---------------------|-----------|
| 中文意图分类准确率 | ~40% | ~70% |
| 英文意图分类准确率 | ~50% | ~75% |
| 中英混合输入 | 完全失效 | ~60% |
| 拼写错误容错 | 0% | ~50% |
| 推理延迟增加 | — | <3ms |

#### 0.5 潜力验证

- TextEncoder 输出的语义向量维度 = 128，与现有 NN hiddenDim 一致
- 后续 Phase 的 KnowledgeGate / ReasoningHead / Generator 都在这个 128 维空间中工作
- 新增模态（视觉/音频）只需新增 encoder 投影到同一 128 维空间

**参数总预算**：300K（现有）+ 145K（TextEncoder）= **445K**

---

### Phase 1：跨头交互 — 从独立分类到协作推理

> **即战力**：intent + tool + quality 三个头的信息互通，决策准确率提升
> **潜力**：为后续新增 reasoning_head / knowledge_head / generation_head 建立交互框架

#### 1.1 Cross-Head Attention

**修改文件**：`src/brain/right/nn/output-heads.ts`

当前三个输出头是独立的。改为**两阶段输出**：

- Stage 1: pooled → 各头独立前向 → 初始 logits
- Stage 2: 初始 logits 拼接 → CrossAttention → 最终 logits

**CrossHeadLayer 实现**：

- 将各头输出投影到统一维度（64 维）
- 自注意力：让各头互相看到对方的输出
- 投影回各头维度

**关键效果**：

- 当 intent_head 判断为 "code_operations" 时，tool_head 通过注意力看到这个信号，提升 `exec` / `read_file` 的概率
- 当 quality_head 预判质量低时，intent_head 可以调整为 "complex_task"
- 这种交互是**学出来的**，不是硬编码规则

**参数量**：~15K（投影矩阵 + 注意力）

#### 1.2 即战力验证

| 指标 | 改造前（独立头） | 改造后（跨头交互） |
|------|-----------------|-------------------|
| intent-tool 一致性 | ~60% | ~80% |
| 低质量任务识别 | 被动 | 主动（quality 信号影响 intent/tool） |
| 推理延迟增加 | — | <1ms |

#### 1.3 潜力验证

- CrossHeadLayer 是**可扩展的**：后续新增 reasoning_head / knowledge_head 只需加入 `headDims` 数组
- 注意力权重可视化 → 可解释性
- 为 Phase 2 的元学习提供梯度通路

**参数总预算**：445K + 15K = **460K**

---

### Phase 2：KnowledgeGate — 知识从被动存储到主动检索

> **即战力**：推理时自动检索相关知识，提升首次命中率
> **潜力**：知识向量与概念空间对齐，为后续知识凝结铺路

#### 2.1 知识向量化

**新建文件**：`src/brain/right/nn/knowledge-gate.ts`

现有知识存储在 STMPStore、ExperienceGraph、extractor.ts 中。当前检索方式是字符串匹配 / FTS5 全文搜索，改为**向量检索**：

- 用 TextEncoder 编码知识条目的文本描述 → 128 维向量
- 用户输入的向量和知识向量在同一空间 → 直接做注意力交互
- 门控融合：原始 query + 检索知识，由 gate 控制比例

#### 2.2 知识向量从哪来

不训练新的知识编码器，复用 TextEncoder 的输出：

- 知识条目的向量和用户输入的向量在**同一个 128 维空间**中
- 知识同步在 dream 或 heartbeat 时执行

#### 2.3 接入 IntuitionNet

- `forwardWithKnowledge(pooled, textEmbedding)` — 知识增强路径
- 知识向量与 pooled 向量拼接后过投影层
- 通过输出头（含跨头交互）

#### 2.4 即战力验证

| 指标 | 无知识检索 | 有 KnowledgeGate |
|------|-----------|-----------------|
| 知识问答命中率 | ~30% | ~55% |
| 首次交互成功率 | ~50% | ~65% |
| 推理延迟增加 | — | <5ms |

#### 2.5 潜力验证

- KnowledgeGate 的知识向量与 TextEncoder 共享概念空间 → 知识可以**组合**
- 后续 Phase 3（推理）可以沿知识图谱的边做多跳推理
- 后续知识凝结（Phase 7）可以在向量空间中聚类 → 自动提炼高层原理

**参数总预算**：460K + 50K = **510K**

---

### Phase 3：ReasoningHead — 从单步直觉到多步推理

> **即战力**：复杂问题可以分步推理，不再一律降级给 LLM
> **潜力**：推理链可蒸馏、可累积、可迁移——推理能力随时间增长

#### 3.1 推理头架构

**新建文件**：`src/brain/right/nn/reasoning-head.ts`

- 步骤编号 Embedding (8, 64)
- 步骤间 EncoderBlock 注意力
- 每步置信度头 (128→64→1, sigmoid)
- **Skip gate**（Skip-Thinking 论文启发）：判断当前步骤是否需要推理
- 最多 5 步，置信度 > 0.85 时 early exit

#### 3.2 训练信号：NoThinking + 并行采样

- 简单问题：标签 = 跳过所有推理步（skipGate 标签全为 1）
- 复杂问题：标签 = 从外部 LLM 蒸馏推理链（Distiller 扩展）
- 推理链多样性（SCoTD 论文）：每个问题采样 3-5 条不同推理路径

#### 3.3 并行推理模式

对于中等复杂度问题，同时生成 N 条短推理路径，用 quality_head 的变体选最好的。

#### 3.4 即战力验证

| 指标 | 无推理头 | 有 ReasoningHead |
|------|---------|-----------------|
| 复杂任务成功率 | ~40% | ~55% |
| 多步问题处理 | 不支持 | 支持（最多 5 步） |
| 推理延迟 | — | +5-15ms |

#### 3.5 潜力验证

- 推理链可序列化 → 存入 DecisionMemory → 蒸馏给新模型
- 推理步骤向量可被 KnowledgeGate 检索 → 推理经验可复用
- Skip-Thinking 让推理效率随训练提升

**参数总预算**：510K + 80K = **590K**

---

### Phase 4：StructuredGenerator — 结构化输出

> **即战力**：60-70% 的日常交互可以不调用 LLM，直接本地生成
> **潜力**：生成模板从经验中自动学习，质量随时间提升

#### 4.1 模板引擎 + 槽位填充

**新建文件**：`src/brain/right/nn/generator.ts`

- 模板选择头：从 backbone 的 hidden state 选择模板
- 槽位填充：直接从 NN 的中间表示中提取（不用额外网络）
- 槽位值来源：knowledge 中提取实体名、intent 推断动词、toolResult 提取数值

#### 4.2 模板自动学习

模板不手动编写，从成功对话中自动编译：

- 找到 assistant 的成功回复
- 提取骨架（去除具体实体/数值）
- 识别槽位
- 与已有模板合并或创建新模板

#### 4.3 降级策略

- confidence >= 0.6 → 直接使用本地生成
- confidence >= 0.4 → 本地骨架 + LLM 补完
- confidence < 0.4 → 全权交给 LLM（现有路径）

#### 4.4 即战力验证

| 指标 | 无生成器（100% LLM） | 有 StructuredGenerator |
|------|---------------------|----------------------|
| 本地完成率 | 0% | ~60% |
| 平均响应延迟 | 2-5s | <20ms（本地）+ 40% 场景 LLM |
| LLM 调用成本 | 100% | ~40% |

#### 4.5 潜力验证

- 模板从经验中自动学习 → 数量和质量随时间增长
- 用户个性化：每个用户的回复风格自动适配
- 模板库可导出/导入 → 跨实例迁移

**参数总预算**：590K + 30K = **620K**

---

### Phase 5：元学习 — 学会学习

> **即战力**：新领域/新用户的适应速度提升
> **潜力**：学习效率本身随时间增长——系统越学越快

#### 5.1 分层 LPR

**修改文件**：`src/brain/right/training/lpr.ts`

现有 LPR 是全局 λ，升级为每层独立 λ：

- ByteEmbedding：浅层，小 λ（允许大量学习新语言/新术语）
- EncoderBlock：中层
- 输出头/推理头：深层，大 λ（严格保护已学好的能力）

#### 5.2 学习策略选择器

**新建文件**：`src/brain/right/training/meta-learner.ts`

三种学习策略：

- **fast_memorize**：高学习率、单步更新、低 LPR（快速记住）
- **deep_understand**：低学习率、多步 replay、高 LPR（深度理解，不忘旧知识）
- **analogy_transfer**：从相似经验中迁移（在概念空间中找最近邻）

MetaLearner 自身也在线学习 → 策略选择越来越准。

#### 5.3 即战力验证

| 指标 | 固定学习策略 | 元学习策略 |
|------|------------|-----------|
| 新领域适应速度 | ~50 次交互 | ~20 次交互 |
| 遗忘率 | ~15% | ~5% |

#### 5.4 潜力验证

- 学习策略可迁移：一个用户学到的最优策略可以推荐给新用户
- 这是**自我改进**的核心组件

**参数总预算**：620K + 5K = **625K**

---

### Phase 6：多模态扩展 — 视觉 + 音频

> **即战力**：支持图片理解和语音输入
> **潜力**：多模态概念空间统一——"猫"的文本、图片、叫声在同一空间

#### 6.1 VisionEncoder — 替换像素统计

**修改文件**：`src/brain/right/features/image-encoder.ts`（替换现有实现）

- 像素 → 学习式 patch 投影 → Transformer → 语义向量
- `alignProj` 确保视觉向量和文本向量在同一 128 维空间
- 2 层 Transformer（轻量）

**参数量**：~180K

#### 6.2 AudioEncoder — 音频输入

**新建文件**：`src/brain/right/features/audio-encoder.ts`

- 轻量 Mel 滤波器（可学习）
- 卷积压缩 → 1 层 Transformer → 对齐到文本空间
- 训练信号：TTS 系统的文本-音频对

**参数量**：~120K

#### 6.3 统一多模态融合

- 文本/图像/音频/结构化特征 → 各自 encoder → 交叉注意力融合
- 新模态接入只需新增 encoder + alignProj

#### 6.4 即战力验证

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 图片理解 | 看色块 | 识别物体/场景/文字 |
| 语音输入 | 不支持 | 支持（~80% 准确率） |
| 多模态推理 | 不支持 | "这个截图里有错误" → 分析 |

#### 6.5 潜力验证

- 视觉/音频概念接入同一 128 维空间 → 跨模态迁移
- 新模态接入只需新增 encoder + alignProj → 架构可扩展

**参数总预算**：625K + 300K = **925K**（接近 1M）

---

### Phase 7：知识凝结 — 从经验到原理

> **即战力**：知识从零散变为系统化，检索精度提升
> **潜力**：知识层次自动提升——从"怎么做"到"为什么这样做"

#### 7.1 概念聚类

在 `dream.ts` 中扩展：

- 获取所有知识条目的向量
- 在 128 维空间中做层次聚类
- 每个簇生成一个高层概念（用 LLM 或规则生成描述）
- 创建新原型（在概念空间中）

#### 7.2 知识层次提升

```
Level 0 (原始经验):  "用户问X，我回答Y，成功了"
                      ↓ 聚类
Level 1 (模式):      "这类问题通常用这种方法"
                      ↓ 抽象
Level 2 (规则):      "当条件A满足时，选B"
                      ↓ 归纳
Level 3 (原理):      "因为底层原因C，所以A→B"
```

每次 dream 周期执行一次凝结。Level 0 → 1 用聚类，Level 1 → 2 用规则提取（`policy-distiller.ts`），Level 2 → 3 用 LLM 辅助归纳。

#### 7.3 即战力验证

| 指标 | 凝结前 | 凝结后 |
|------|--------|--------|
| 知识检索精度 | ~55% | ~70% |
| 知识条目数量 | 1000 条零散经验 | 1000 条 + 50 个高层模式 |
| 新问题命中率 | 匹配不到就失败 | 高层模式可以覆盖 |

#### 7.4 潜力验证

- 知识层次越高，覆盖面越广——一条原理可以覆盖 100 条经验
- 知识凝结在概念空间中进行 → 凝结后的知识仍然可以被检索
- 这是**智慧**的雏形——从"知道怎么做"到"理解为什么"

**参数总预算**：925K + 0K（知识凝结是算法层面，不增加 NN 参数）= **925K**

---

## 五、总览

### 即战力 × 潜力矩阵

| Phase | 改造 | 即战力收益 | 潜力收益 | 新增参数 | 累计参数 | 延迟增加 |
|-------|------|-----------|----------|---------|---------|---------|
| 0 | 概念表征空间 | 意图分类 +30% | 所有能力的地基 | +145K | 445K | +3ms |
| 1 | 跨头交互 | 决策一致性 +20% | 输出头可扩展框架 | +15K | 460K | +1ms |
| 2 | KnowledgeGate | 知识命中 +25% | 知识向量化、可组合 | +50K | 510K | +5ms |
| 3 | ReasoningHead | 复杂任务 +15% | 推理链可蒸馏累积 | +80K | 590K | +5-15ms |
| 4 | Generator | 60% 本地完成 | 模板自动学习 | +30K | 620K | +2ms |
| 5 | 元学习 | 适应速度 2.5x | 学会学习 | +5K | 625K | +0ms |
| 6 | 多模态 | 图片+语音理解 | 统一概念空间 | +300K | 925K | +5ms |
| 7 | 知识凝结 | 检索精度 +15% | 知识层次提升 | +0K | 925K | +0ms |

### 最终状态

- **925K 参数**，int8 量化后 <1MB
- **CPU 推理 <25ms**
- 比现有 300K 大 3 倍，但能力从"结构化状态机"进化为"认知引擎"
- 任何时候停下，系统都比改造前更强

### 实施节奏

```
Week 1-2:   Phase 0 (TextEncoder)        ← 最高优先级，地基
Week 3:     Phase 1 (跨头交互)            ← 快速收益，改动小
Week 4-5:   Phase 2 (KnowledgeGate)       ← 知识利用
Week 6-7:   Phase 3 (ReasoningHead)       ← 推理能力
Week 8:     Phase 4 (Generator)           ← 本地生成
Week 9:     Phase 5 (元学习)              ← 学习效率
Week 10-11: Phase 6 (多模态)             ← 扩展感知
Week 12:    Phase 7 (知识凝结)            ← 知识升华
```

---

## 六、理论研究索引

| 研究 | 核心贡献 | Buddy 对应模块 | 论文链接 |
|------|----------|----------------|----------|
| BLT (Meta 2024) | 熵驱动动态 patch | TextEncoder | [arxiv.org/abs/2412.09871](https://arxiv.org/abs/2412.09871) |
| MrT5 (Stanford 2024) | 学习式删除门压缩 75% | TextEncoder | [arxiv.org/abs/2410.20771](https://arxiv.org/abs/2410.20771) |
| SCoTD (ACL 2023) | 小模型 CoT 蒸馏 | ReasoningHead | [arxiv.org/abs/2306.14050](https://arxiv.org/abs/2306.14050) |
| Skip-Thinking (2025) | 跳过非推理块 | ReasoningHead | [arxiv.org/abs/2505.18642](https://arxiv.org/abs/2505.18642) |
| NoThinking (Berkeley 2025) | 并行短路径 > 单条长链 | ReasoningHead | [arxiv.org/abs/2504.09858](https://arxiv.org/abs/2504.09858) |
| GFM-RAG (2025) | GNN 编码知识图谱 | KnowledgeGate | [arxiv.org/abs/2502.01113](https://arxiv.org/abs/2502.01113) |
| GRAG (2024) | 图结构多跳推理 | KnowledgeGate | [arxiv.org/abs/2405.16506](https://arxiv.org/abs/2405.16506) |
| MobileViT (Apple) | CNN+Transformer 混合 | VisionEncoder | [arxiv.org/abs/2110.02178](https://arxiv.org/abs/2110.02178) |
| EdgeViTs (2022) | Local-Global-Local 注意力 | VisionEncoder | [arxiv.org/abs/2205.03436](https://arxiv.org/abs/2205.03436) |
| PI-Whisper (2024) | 增量式 ASR | AudioEncoder | [arxiv.org/abs/2406.15668](https://arxiv.org/abs/2406.15668) |
| LPR (ICML 2024) | 每层独立防遗忘 | OnlineLearner | [arxiv.org/abs/2402.09542](https://arxiv.org/abs/2402.09542) |
| SAD (2025) | span 级 agent 蒸馏 | Distiller | [arxiv.org/abs/2505.13820](https://arxiv.org/abs/2505.13820) |
