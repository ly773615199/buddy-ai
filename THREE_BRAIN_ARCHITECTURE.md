# Buddy 三脑架构改造方案

> 版本: v3.1
> 日期: 2026-04-28
> 基于: 全量代码审计（57,400 行后端 + 33,400 行测试）+ 学术研究调研 + 代码深度审查

---

## 一、改造动机

当前 Buddy 的决策/学习/感知三个维度的代码**分散在 30+ 个文件中**，缺乏统一的架构边界。

1. **决策散装**：`decideCollaboration()`（8 条规则）、`ModelPoolScheduler`（Thompson Sampling）、`ExperienceRouter`（四层路由）、`IntentClassifier`（关键词匹配）各自为政
2. **学习断裂**：三进制引擎（6600 行死代码）、经验进化器、ModelRouter.learnedPrefs 三条学习链路互不相通
3. **感知碎片**：情绪、欲望、环境观察、隐私管理、事件总线、空闲行为散落在 6 个模块，没有统一的本体状态

---

## 二、三脑架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        BuddyAgent                               │
│                     (编排层 / 消息路由)                           │
└──────────────┬──────────────────┬──────────────────┬────────────┘
               │                  │                  │
               ▼                  ▼                  ▼
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│      🧠 左脑         │ │     💡 右脑       │ │     🦶 小脑       │
│   Left Brain         │ │   Right Brain     │ │   Cerebellum     │
│                      │ │                   │ │                  │
│  理性决策脑           │ │  直觉学习脑        │ │  本体感知脑       │
│                      │ │                   │ │                  │
│ ┌──────────────────┐ │ │ ┌───────────────┐ │ │ ┌──────────────┐ │
│ │ RuleEngine       │ │ │ │ IntuitionNet  │ │ │ │ BodyState    │ │
│ │ 规则引擎          │ │ │ │ 决策习惯NN内核 │ │ │ │ 本体状态机    │ │
│ ├──────────────────┤ │ │ ├───────────────┤ │ │ ├──────────────┤ │
│ │ Scheduler        │ │ │ │ OnlineLearner │ │ │ │ Homeostasis  │ │
│ │ 统一调度器        │ │ │ │ 在线学习器     │ │ │ │ 稳态调节器    │ │
│ ├──────────────────┤ │ │ ├───────────────┤ │ │ ├──────────────┤ │
│ │ PolicyDistiller  │ │ │ │ Distiller     │ │ │ │ SensorFusion │ │
│ │ 策略蒸馏器        │ │ │ │ 蒸馏管线      │ │ │ │ 感知融合      │ │
│ ├──────────────────┤ │ │ ├───────────────┤ │ │ ├──────────────┤ │
│ │ DecisionMemory   │ │ │ │ ReplayBuffer  │ │ │ │ MotorControl │ │
│ │ 决策记忆          │ │ │ │ 经验回放缓冲   │ │ │ │ 运动控制      │ │
│ └──────────────────┘ │ │ └───────────────┘ │ │ ├──────────────┤ │
└──────────────────────┘ └──────────────────┘ │ │ Adaptive     │ │
                                              │ │ 自适应层      │ │
                                              │ │ ┌──────────┐ │ │
                                              │ │ │ Rhythm   │ │ │
                                              │ │ │ 节律适配  │ │ │
                                              │ │ ├──────────┤ │ │
                                              │ │ │ Habit    │ │ │
                                              │ │ │ 肌肉记忆  │ │ │
                                              │ │ ├──────────┤ │ │
                                              │ │ │ErrTuner  │ │ │
                                              │ │ │错误阈值   │ │ │
                                              │ │ └──────────┘ │ │
                                              │ └──────────────┘ │
└──────────────────────┘ └──────────────────┘ └──────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    共享基础设施                                   │
│  DecisionRecorder │ STMP │ MemoryStore │ EventBus │ Config      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、右脑：直觉学习脑（核心，最高优先级）

### 3.1 设计原则

| 原则 | 要求 |
|------|------|
| **原生内置** | 纯 TypeScript/JavaScript 实现，零 npm 依赖，不下载不安装不外挂 |
| **手写 NN 内核** | Embedding + Self-Attention + FFN + Multi-Head Output，全手写 |
| **只学决策习惯** | 不生成文本，只输出结构化决策建议 |
| **边跑边学** | 每次交互后在线更新权重，不等攒批 |
| **持续收敛** | 防遗忘机制 + 经验回放 + 蒸馏管线 |

### 3.2 研究基础

| 论文 | 来源 | 贡献 |
|------|------|------|
| Structured Agent Distillation | AAMAS 2026, CMU/Harvard/MIT | span-level loss：信号span + 动作span 分别加权 |
| Online Policy Distillation with Decision-Attention | 2024 | 在线互蒸馏，无预训练教师，Decision-Attention 加权 |
| Sub-goal Distillation | 2024 | 子目标蒸馏，比纯模仿学习提升 16.7% |
| Layerwise Proximal Replay | ICML 2024 | 在线持续学习防遗忘，比 EWC 轻量 |
| Tiny RNN 发现认知策略 | Nature 2025 | 小网络+好结构 > 大网络+差结构，100K 参数足够 |

### 3.3 NN 内核架构

```
输入特征（结构化，非自然语言）
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Feature Encoder                                 │
│  ├─ token_ids: number[]     → Embedding(d=64)   │
│  ├─ signal: TaskSignal      → Linear → d=32     │
│  ├─ body: BodyState         → Linear → d=32     │
│  └─ history: number[]       → Embedding(d=32)   │
│                                                  │
│  拼接 → [seq_len, d=128]                         │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Encoder Block × 2                               │
│  ├─ Multi-Head Self-Attention (heads=4, d=128)   │
│  ├─ LayerNorm                                    │
│  ├─ FFN (128 → 256 → 128, GELU)                 │
│  └─ LayerNorm + Residual                         │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Multi-Head Output（三个输出头，共享 backbone）    │
│                                                  │
│  ├─ intent_head:                                 │
│  │   Linear(128, 64) → GELU → Linear(64, 8)     │
│  │   输出: 8 类意图的 logits                      │
│  │   loss: CrossEntropy                          │
│                                                  │
│  ├─ tool_head:                                   │
│  │   Linear(128, 64) → GELU → Linear(64, 32)     │
│  │   输出: 32 个核心工具的选择概率                  │
│  │   loss: BinaryCrossEntropy (多标签)            │
│                                                  │
│  └─ quality_head:                                │
│      Linear(128, 64) → GELU → Linear(64, 1)      │
│      输出: 质量预判 0-1                            │
│      loss: MSE                                   │
│                                                  │
│  总 loss = α*L_intent + β*L_tool + γ*L_quality   │
│  α=0.4, β=0.4, γ=0.2 (可调)                      │
└─────────────────────────────────────────────────┘
```

### 3.4 参数量估算

| 层 | 参数量 |
|---|--------|
| Embedding (vocab=2048, d=64) | 131,072 |
| Signal Encoder (32→32) | 1,024 |
| Body Encoder (32→32) | 1,024 |
| History Embedding (256, d=32) | 8,192 |
| Encoder Block × 2 | ~133,000 |
| intent_head (128→64→8) | 8,768 |
| tool_head (128→64→32) | 10,272 |
| quality_head (128→64→1) | 8,257 |
| **总计** | **~301,609** |

**~300K 参数，int8 量化后 ~300KB，纯 CPU 推理 < 5ms。**

### 3.5 在线学习策略

```
┌─────────────────────────────────────────────────────────────┐
│                   在线学习循环                                │
│                                                             │
│  每次交互后：                                                │
│  1. 收集样本: (input_features, label_intent, label_tools,   │
│               label_quality, outcome_success)                │
│  2. 存入 ReplayBuffer（容量 1000，FIFO 淘汰）               │
│  3. 从 ReplayBuffer 采样 batch_size=8                       │
│  4. 计算 loss（span-level，借鉴 Structured Agent Distill）  │
│  5. 加入 LPR 近端项（防遗忘）                               │
│  6. 反向传播，更新权重                                       │
│  7. 保存权重快照                                             │
│                                                             │
│  蒸馏管线（定期，每小时或夜间）：                             │
│  1. 从 DecisionMemory 收集 LLM 教师的决策                   │
│  2. 用教师的 (input, decision) 作为软标签                    │
│  3. 在线蒸馏训练（借鉴 Online Policy Distillation）          │
│  4. 评估 → 达标则更新模型，不达标则保留旧模型                │
└─────────────────────────────────────────────────────────────┘
```

### 3.6 防遗忘机制：Layerwise Proximal Replay

```typescript
// 每层的 loss 增加近端项
// 借鉴 ICML 2024 Layerwise Proximal Replay
for (const layer of model.layers) {
  const taskLoss = computeTaskLoss(layer);
  const proximalTerm = lambda * l2norm(layer.weights - layer.weightsSnapshot);
  layer.totalLoss = taskLoss + proximalTerm;
}

// lambda 调度：训练初期小（允许学习），后期大（防止遗忘）
// weightsSnapshot 每 100 步更新一次
```

### 3.7 蒸馏管线：Structured Agent Distillation

```
教师数据来源：DecisionMemory 中的 LLM 决策记录
    │
    ▼
Span 分割（借鉴 AAMAS 2026）：
├─ signal_span: [domains, complexity, taskType, intentConfidence]
├─ context_span: [bodyState, recentHistory, resourceState]
└─ action_span: [selectedMode, selectedNodes, tools]
    │
    ▼
Span-level Loss：
├─ L_signal = CE(teacher_signal, student_signal)     ← 信号对齐
├─ L_context = MSE(teacher_context, student_context)  ← 上下文对齐
└─ L_action = CE(teacher_action, student_action)      ← 动作对齐
    │
    ▼
Decision-Attention 加权（借鉴 Online PD 2024）：
├─ 成功的教师决策 → 权重 1.0
├─ 失败的教师决策 → 权重 0.3（学"什么是不好的"）
└─ 最近的决策 → 权重更高（指数衰减）
```

### 3.8 文件结构

```
src/brain/right/
├── index.ts                 ← 统一入口 RightBrain
├── nn/
│   ├── tensor.ts            ← 张量运算（matmul, add, relu, softmax, layernorm）
│   ├── embedding.ts         ← Embedding 层
│   ├── attention.ts         ← Multi-Head Self-Attention
│   ├── ffn.ts               ← Feed-Forward Network
│   ├── encoder.ts           ← Encoder Block（Attention + FFN + LayerNorm）
│   ├── output-heads.ts      ← 三个输出头
│   ├── model.ts             ← IntuitionNet 模型（组合所有层）
│   ├── quantize.ts          ← int8 量化/反量化
│   └── serialize.ts         ← 权重序列化/反序列化（.bin 格式）
├── training/
│   ├── replay-buffer.ts     ← 经验回放缓冲（FIFO，容量 1000）
│   ├── online-learner.ts    ← 在线学习器（每次交互后更新）
│   ├── lpr.ts               ← Layerwise Proximal Replay 防遗忘
│   ├── distiller.ts         ← Structured Agent Distillation 蒸馏器
│   └── loss.ts              ← Loss 函数（CE, MSE, span-level 组合）
├── features/
│   ├── encoder.ts           ← 输入特征编码器
│   └── decoder.ts           ← 输出解码器（logits → 决策建议）
└── types.ts                 ← 类型定义
```

### 3.9 认知扩展能力（方案 B — 多模态扩展）

> 当前右脑只做"工具选择直觉"（8 类意图 + 32 工具分类）。
> 方案 B 将右脑从纯分类器升级为**空间认知引擎**，引入 8 项新能力。

#### 能力清单

| 能力 | 论文依据 | 改动层 | 新增代码 |
|------|---------|--------|---------|
| ① 模式直觉 | Structured Agent Distillation (AAMAS 2026) | 不改架构，只训练 | 0 |
| ② 记忆关联 | Layerwise Proximal Replay (ICML 2024) | ReplayBuffer 加 kNN 索引 | ~100 行 |
| ③ 隐性经验 | Sub-goal Distillation (2024) | Distiller 输出可提取规则 | ~150 行 |
| ④ 空间想象 | **CoordConv** (NeurIPS 2018) | Encoder 加坐标编码 | ~200 行 |
| ⑤ 场景表征 | **Slot Attention** (NeurIPS 2020) | Encoder 加 object-centric 表征 | ~250 行 |
| ⑥ 简易图片解析 | **ViT / MAE** (2020/2022) | Embedding 加 patch embedding | ~300 行 |
| ⑦ 脑内构图 | **World Models / DreamerV3** (2023) | 加 spatial output head | ~200 行 |
| ⑧ 场景拓扑推演 | **Scene Representation Networks** (NeurIPS 2019) | 加 autoregressive 解码器 | ~300 行 |

#### 新增论文基础

| 论文 | 来源 | 贡献 | 对应能力 |
|------|------|------|----------|
| CoordConv | NeurIPS 2018 | 坐标编码，让网络感知空间位置 | ④ 空间想象 |
| ViT | ICLR 2021 | Patch embedding → Transformer，图像 token 化 | ⑥ 图片解析 |
| MAE | CVPR 2022 | 自监督视觉预训练，masked autoencoder | ⑥ 图片解析 |
| Slot Attention | NeurIPS 2020 | Object-centric 表征，无监督物体发现 | ⑤ 场景表征 |
| Scene Representation Networks | NeurIPS 2019 | 结构化场景表征 + 组合泛化 | ⑧ 场景拓扑 |
| World Models | 2018 / DreamerV3 2023 | 潜空间想象 + 环境预测 | ⑦ 脑内构图 |

#### 参数量变化

| 配置 | 当前 | 方案 B | 原因 |
|------|------|--------|------|
| vocabSize | 2048 | 4096 | 图片 patch + spatial token |
| embedDim | 64 | 128 | 多模态融合需更宽嵌入 |
| hiddenDim | 128 | 256 | 场景表征需更大容量 |
| numLayers | 2 | 4 | 多模态对齐需更深网络 |
| numIntents | 8 | 8 | 不变 |
| numTools | 32 | 32 | 不变 |
| **总参数** | **~300K** | **~2.5M** | ~8 倍 |
| **int8 模型大小** | ~300KB | ~2.5MB | 可接受 |
| **CPU 推理** | < 5ms | ~15-20ms | 仍在实时级别 |

#### Encoder 扩展方案

```typescript
// 当前 token ID 空间（不改动）
10-29:    domain
30-39:    complexity
40-49:    taskType
50-81:    tools
100-199:  数值 bin
200-299:  情绪 bin
300-399:  欲望 bin

// 新增 token ID 空间（追加，不影响已有）
400-449:  spatial coordinate bins（x/y/z 离散化为 50 bins）
450-549:  image patch IDs（图片 10×10 分块 = 100 patches）
550-599:  scene graph node types（物体类别）
600-649:  scene graph edge types（空间关系：上/下/左/右/内/外）
650-699:  slot IDs（Slot Attention 输出的 object slots）
700-799:  预留

// 编码流程
输入 → 多模态 Encoder → 统一 token 序列 → Embedding → Backbone
       ├─ 结构化编码器（已有：signal + body + tools）
       ├─ 空间编码器（新增：坐标 → 离散 bins → token IDs）
       ├─ 图像编码器（新增：图片 → patch → token IDs）
       └─ 场景编码器（新增：scene graph → node/edge token IDs）
```

#### Output Head 扩展方案

```typescript
// 当前 3 个头（不改动）
intentHead:   Linear(256, 128) → GELU → Linear(128, 8)     // 意图分类
toolHead:     Linear(256, 128) → GELU → Linear(128, 32)    // 工具选择
qualityHead:  Linear(256, 128) → GELU → Linear(128, 1)     // 质量预判

// 新增 2 个头
spatialHead:  Linear(256, 128) → GELU → Linear(128, 6)     // 空间坐标 (x,y,z,w,h,d)
sceneHead:    Linear(256, 256) → GELU → Linear(256, N)     // 场景拓扑（N = 最大节点数）

// 总 loss
L = α*L_intent + β*L_tool + γ*L_quality + δ*L_spatial + ε*L_scene
    (0.3)       (0.3)      (0.1)         (0.15)        (0.15)
```

#### 脑内构图（Mental Simulation）

```
latent space（潜空间想象）：
  z = encoder(observation)         // 当前状态编码
  z' = world_model.predict(z, a)   // 给定动作，预测下一状态
  reconstruction = decoder(z')     // 解码为可解释表征

实现方式：
  - World Model: 简单 MLP 预测 latent delta
  - 不需要生成像素，只预测结构化变化（坐标偏移、拓扑变化）
  - 纯 CPU 可运行，< 10ms
```

---

## 四、左脑：理性决策脑

### 4.1 研究基础

| 技术 | 来源 | 贡献 |
|------|------|------|
| Contextual Thompson Sampling | arxiv 2023 | 上下文感知的 Thompson，不只是按 taskType |
| Budget-constrained Thompson | arxiv 2024 | 预算约束下的 Thompson Sampling |
| 关联规则挖掘 + 序列模式挖掘 | 经典数据挖掘 | 从决策记录中自动提炼规则 |

### 4.2 模块设计

```
src/brain/left/
├── index.ts                 ← 统一入口 LeftBrain
├── rule-engine.ts           ← 规则引擎
├── scheduler.ts             ← 统一调度器
├── policy-distiller.ts      ← 策略蒸馏器
├── decision-memory.ts       ← 决策记忆
└── types.ts                 ← 类型定义
```

#### RuleEngine — 规则引擎

```typescript
interface Rule {
  id: string;
  name: string;
  priority: number;
  condition: (signal: TaskSignal, resources: ResourceState,
              intuition?: IntuitionSignal, body?: BodyState) => boolean;
  action: (signal: TaskSignal, resources: ResourceState) => ExecutionPlan;
  source: 'builtin' | 'learned' | 'user';
  stats: { hits: number; successes: number; lastUsed: number; };
}

class RuleEngine {
  private rules: Rule[] = [];
  private negations: Map<string, number> = new Map(); // 黑名单 pattern → 命中次数

  loadBuiltinRules(): void { /* 迁移现有 8 条 if-else */ }
  addLearnedRule(rule: Rule): void { /* 从蒸馏器接收新规则 */ }
  addNegation(pattern: string): void { /* 从蒸馏器接收否定规则 */ }
  evaluate(signal, resources, intuition?, body?): ExecutionPlan | null { /* 优先级匹配 */ }
  feedback(ruleId: string, success: boolean): void { /* 更新规则统计 */ }
  prune(options: { maxAge: number; minSuccessRate: number }): void { /* 淘汰低效规则 */ }
}
```

#### PolicyDistiller — 策略蒸馏器

```
蒸馏流程（定期执行，每小时或手动触发）：

Step 1: 从 DecisionMemory 按 signal_fingerprint 聚类
  fingerprint = hash(domains + complexity + taskType)
  同一 fingerprint 的决策记录聚合

Step 2: 提炼成功模式（正规则）
  cluster.successRate > 0.8 && cluster.count >= 5
  → 生成 Rule { condition: fingerprint匹配, action: cluster.mode }

Step 3: 提炼失败模式（否定规则）
  cluster.successRate < 0.2 && cluster.count >= 3
  → 加入 negations 黑名单

Step 4: 序列模式挖掘
  用 PrefixSpan 算法发现决策序列：
  "用户先 git_status 再 read_file 的成功率比直接 read_file 高 30%"
  → 生成序列规则

Step 5: 规则冲突检测
  新规则的 condition 与现有规则交集 > 50% 但 action 不同 → 冲突
  冲突时保留置信度更高的，淘汰另一个

Step 6: 规则淘汰
  超过 7 天未命中 或 成功率 < 0.3 的 learned 规则 → 移除
```

#### UnifiedScheduler — 统一调度器

整合现有 ModelPoolScheduler + ModelRouter + ExperienceRouter：

```
调度流程：
1. 经验路由优先（四层路由 + Thompson Sampling）
2. 三进制本地专家（零成本 <50ms）
3. ModelPool 调度（Contextual Thompson Sampling）
4. 右脑直觉信号注入
5. 小脑稳态指令注入（如需降级）
6. ModelRouter 兜底
```

---

## 五、小脑：本体感知 + 稳态调节脑

### 5.1 研究基础

| 技术 | 来源 | 贡献 |
|------|------|------|
| MAPE-K 模型 | IBM Autonomic Computing | Monitor→Analyze→Plan→Execute→Knowledge |
| 仿生 PID 负反馈 | Nature Sci Reports 2023 | 比例+积分+微分调节，比 if-else 更平滑 |

### 5.2 模块设计

```
src/brain/cerebellum/
├── index.ts                 ← 统一入口 Cerebellum
├── body-state.ts            ← 本体状态机
├── homeostasis.ts           ← 稳态调节器（MAPE-K + PID）
├── sensor-fusion.ts         ← 感知融合
├── motor-control.ts         ← 运动控制
└── types.ts                 ← 类型定义
```

#### BodyState — 本体状态机

整合 EmotionEngine + DesireEngine + 环境信号为统一状态：

```typescript
interface BodyState {
  // 生理层
  energy: number;            // 0-100
  temperature: number;       // 0-100 活跃度
  load: number;              // 0-100 系统负载
  hunger: number;            // 0-100 交互饥渴度

  // 情绪层（Plutchik 8 维）
  emotion: EmotionVector;

  // 欲望层（6 维）
  desires: DesireVector;

  // 认知层
  focusLevel: number;
  confidenceLevel: number;
  confusionLevel: number;

  // 社交层
  intimacyLevel: number;
  socialNeed: number;

  // 环境层
  hour: number;
  isUserActive: boolean;
  lastInteractionMs: number;
  systemHealth: 'good' | 'degraded' | 'critical';
}
```

#### HomeostasisRegulator — 稳态调节器（MAPE-K + PID）

```
四条调节回路，每条用 PID 控制器：

1. 能量回路：
   error = energy_target - energy_current
   output = Kp*error + Ki*∫error + Kd*d(error)/dt
   → 调节动作：trigger_dream / slow_response / adjust_model

2. 情绪回路：
   valence = (joy + trust + anticipation) - (sadness + anger + fear)
   error = valence_target (0) - valence_current
   → 调节动作：inject_mood / adjust_prompt

3. 认知回路：
   error = confusion_threshold (50) - confusion_current
   → 调节动作：request_clarify / reduce_tools

4. 负载回路：
   error = load_target (60) - load_current
   → 调节动作：adjust_model / queue_message

多级阈值：
  |error| < 20 → 无动作
  |error| 20-50 → 警告级（注入 prompt 提示）
  |error| 50-80 → 干预级（切换模型/减少工具）
  |error| > 80 → 强制级（触发梦境/暂停响应）
```

### 5.3 自适应层（Adaptive Layer）— 肌肉记忆 + 节律 + 错误阈值

> 生物学依据：小脑掌握平衡、协调、习惯。新增三层"条件反射"，使小脑从被动反应进化到主动适应。

#### 设计原则

| 原则 | 要求 |
|------|------|
| **纯统计** | 只做计数/均值/百分位，不做推理 |
| **阈值调整** | 调参数，不改逻辑 |
| **无新行为** | 不学新决策模式，只优化已有路径 |
| **< 1ms** | 查表 + 算术，无循环依赖 |

#### 模块设计

```
src/brain/cerebellum/adaptive/
├── rhythm.ts          ← 节律自适配：调节心跳/梦境/后台频率
├── habit.ts           ← 肌肉记忆：高频 pattern 缓存
└── error-tuner.ts     ← 错误阈值自适应：弱化/强化告警
```

#### rhythm.ts — 节律自适配

根据全天负载，自动调节 BuddyClock 参数：

```typescript
interface RhythmState {
  // 负载统计（滑动窗口 1 小时）
  loadSamples: number[];        // 最近 60 个采样点（每分钟一个）
  interactionRate: number;      // 每小时交互次数
  errorRate: number;            // 每小时错误次数

  // 输出参数（供 BuddyClock 读取）
  heartbeatIntervalMs: number;  // 动态心跳间隔（默认 300000）
  dreamDensity: number;         // 梦境频率系数 0.5-2.0
  backgroundTaskDensity: number; // 后台任务密度 0.5-2.0
  maintenanceFrequency: number; // 自检频率系数 0.5-2.0
}

class RhythmAdaptor {
  // 调节规则（纯 PID，不改逻辑）
  regulate(body: BodyState, clock: ClockState): RhythmAdjustment {
    const load = this.movingAverage(this.loadSamples);

    // 高峰压低：负载 > 70 → 拉长心跳、压低梦境
    if (load > 70) {
      return {
        heartbeatIntervalMs: 600_000,    // 10 分钟
        dreamDensity: 0.3,               // 压到 30%
        backgroundTaskDensity: 0.5,
        maintenanceFrequency: 0.5,
      };
    }

    // 空闲提升：负载 < 30 → 缩短心跳、提升自检
    if (load < 30) {
      return {
        heartbeatIntervalMs: 180_000,    // 3 分钟
        dreamDensity: 1.5,               // 提升到 150%
        backgroundTaskDensity: 1.2,
        maintenanceFrequency: 2.0,       // 双倍巡检
      };
    }

    // 正常区间：线性插值
    const factor = 1 - (load - 30) / 40; // 0~1
    return {
      heartbeatIntervalMs: 300_000 + factor * 300_000,
      dreamDensity: 0.3 + factor * 1.2,
      backgroundTaskDensity: 0.5 + factor * 0.7,
      maintenanceFrequency: 0.5 + factor * 1.5,
    };
  }
}
```

#### habit.ts — 肌肉记忆

统计高频决策 pattern，命中时跳过完整链路：

```typescript
interface HabitEntry {
  fingerprint: string;        // signal hash: domains|complexity|taskType
  action: ExecutionPlan;      // 上次决策
  hitCount: number;
  avgLatencyMs: number;
  successRate: number;
  lastUsed: number;
}

class HabitMemory {
  private cache: Map<string, HabitEntry> = new Map();
  private readonly maxEntries = 200;
  private readonly minHits = 5;         // 至少命中 5 次才固化
  private readonly minSuccessRate = 0.8; // 成功率 > 80% 才信任

  // 查询：命中 → 直接返回缓存决策
  lookup(signal: TaskSignal): ExecutionPlan | null {
    const fp = this.fingerprint(signal);
    const entry = this.cache.get(fp);
    if (!entry) return null;
    if (entry.hitCount < this.minHits) return null;
    if (entry.successRate < this.minSuccessRate) return null;
    entry.hitCount++;
    entry.lastUsed = Date.now();
    return entry.action;
  }

  // 记录：完整链路的决策写入 cache
  record(signal: TaskSignal, plan: ExecutionPlan, success: boolean): void {
    const fp = this.fingerprint(signal);
    let entry = this.cache.get(fp);
    if (!entry) {
      entry = { fingerprint: fp, action: plan, hitCount: 0,
                avgLatencyMs: 0, successRate: 0, lastUsed: Date.now() };
      this.cache.set(fp, entry);
    }
    // 滑动平均更新成功率
    entry.successRate = entry.successRate * 0.9 + (success ? 0.1 : 0);
    entry.hitCount++;
    entry.lastUsed = Date.now();
    entry.action = plan; // 覆盖为最新决策
  }

  // 淘汰：7 天未使用 或 成功率跌破阈值
  prune(): number { /* ... */ }
}
```

#### error-tuner.ts — 错误阈值自适应

高频无害异常 → 弱化告警；致命阻塞 → 强化熔断：

```typescript
interface ErrorProfile {
  errorType: string;
  occurrences: number;         // 总次数
  recentRate: number;          // 最近 1 小时频率
  severity: 'low' | 'medium' | 'high' | 'critical';
  lastOccurrence: number;

  // 自适应阈值
  alertThreshold: number;      // 原始阈值 → 动态调整
  suppressionFactor: number;   // 1.0 = 正常, 0.1 = 几乎忽略
  boostFactor: number;         // 1.0 = 正常, 3.0 = 三倍敏感
}

class ErrorTuner {
  private profiles: Map<string, ErrorProfile> = new Map();

  // 观测一次错误，更新统计
  observe(errorType: string, severity: ErrorProfile['severity']): void {
    let p = this.profiles.get(errorType);
    if (!p) {
      p = { errorType, occurrences: 0, recentRate: 0, severity,
            lastOccurrence: 0, alertThreshold: 1, suppressionFactor: 1, boostFactor: 1 };
      this.profiles.set(errorType, p);
    }
    p.occurrences++;
    p.lastOccurrence = Date.now();

    // 高频无害：弱化
    if (p.severity === 'low' && p.recentRate > 10) {
      p.suppressionFactor = Math.max(0.1, p.suppressionFactor * 0.9);
    }

    // 致命+首次：强化
    if (p.severity === 'critical' && p.occurrences <= 3) {
      p.boostFactor = Math.min(3.0, p.boostFactor * 1.5);
    }
  }

  // 获取调整后的告警权重
  getAlertWeight(errorType: string): number {
    const p = this.profiles.get(errorType);
    if (!p) return 1.0;
    return p.suppressionFactor * p.boostFactor;
  }

  // 周期性衰减（每小时调用一次）
  decay(): void {
    for (const p of this.profiles.values()) {
      p.suppressionFactor = Math.min(1.0, p.suppressionFactor * 1.05); // 缓慢恢复
      p.boostFactor = Math.max(1.0, p.boostFactor * 0.95);             // 缓慢回落
    }
  }
}
```

#### 与 HomeostasisRegulator 的协作

```
BodyState → HomeostasisRegulator (PID) → HomeostasisAction[]
                                              │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                       RhythmAdaptor     HabitMemory      ErrorTuner
                       (调钟/调密度)     (查表跳过)      (调告警阈值)
                              │                │                │
                              ▼                ▼                ▼
                       BuddyClock      LeftBrain.decide()  SensorFusion
```

---

## 五.一、外围知识通道（已有模块审计）

> v3.1 新增：代码深度审查发现系统已有多个外部知识通道，但未接入三脑训练循环。

### 5.1.1 已有通道清单

| 模块 | 文件 | 功能 | 与三脑的关系 |
|------|------|------|-------------|
| **FeedbackLearner** | `src/feedback/learner.ts` | 检测用户纠正（"不对"、"记住"、"以后别"），存入 MemoryStore | ❌ 未接入右脑 OnlineLearner |
| **BuddyLearn** | `src/knowledge/learn.ts` | 从文件/URL/文本学习知识，分块存入 MemoryStore | ❌ 未接入右脑 ReplayBuffer |
| **KnowledgeInterviewer** | `src/intelligence/knowledge-interviewer.ts` | 检测知识缺口，主动生成追问，控制提问时机 | ❌ 答案未结构化喂给右脑 |
| **ReasoningChainStore** | `src/memory/reasoning-chain.ts` | 跨轮推理链持久化，注入 prompt | ❌ 未作为训练信号 |
| **ExperienceEvolver** | `src/intelligence/experience-evolver.ts` | 置信度更新、梦境合并、假设生成+测试、停滞检测 | ❌ 进化结果未反馈 NN 权重 |
| **KnowledgeExporter** | `src/intelligence/knowledge-export.ts` | 跨会话知识迁移（领域知识包导出/导入） | ✅ 知识可迁移，但导入后未训练 |
| **ExperienceRouter** | `src/intelligence/experience-router.ts` | 四层路由 + Thompson Sampling | ✅ 已接入左脑 Scheduler |

### 5.1.2 通道现状分析

```
FeedbackLearner（用户纠正）
    → 存入 MemoryStore ✅
    → 右脑 OnlineLearner 不知道 ❌

BuddyLearn（知识注入）
    → 存入 MemoryStore ✅
    → 右脑 ReplayBuffer 不知道 ❌

KnowledgeInterviewer（主动追问）
    → 问到了答案 ✅
    → 存入 MemoryStore ✅
    → 右脑不知道这些是"高价值知识" ❌

ReasoningChainStore（推理链）
    → 注入 prompt ✅
    → 没有作为训练信号给右脑 ❌

ExperienceEvolver（经验进化）
    → 假设测试 ✅
    → 结果没反馈给右脑 NN ❌

Distiller（蒸馏器）
    → 从 DecisionMemory 蒸馏 ✅
    → 没读 FeedbackLearner 的纠正 ❌
```

**结论：系统不缺外部知识通道，缺的是把这些通道的输出接入右脑的训练循环。**

### 5.1.3 与自蒸馏的关系

系统的所有学习本质上是**自蒸馏**：

| 模块 | 表面上叫 | 实际上是 |
|---|---|---|
| Structured Agent Distillation | "教师-学生蒸馏" | 教师 = 自己过去的决策记录 |
| OnlineLearner | "在线学习" | 从自己的交互结果更新权重 |
| PolicyDistiller | "策略蒸馏" | 从自己的成功/失败模式提炼规则 |
| HabitMemory | "肌肉记忆" | 把自己的高频决策缓存起来 |
| ErrorTuner | "错误自适应" | 从自己的错误频率调阈值 |
| World Model | "环境预测" | 预测自己动作的后果 |

**架构有外部智慧（论文先验），数据完全自产（机器经验）。** 外部知识通道已存在但未打通，导致认知天花板 = 初始 LLM 的知识边界。

---

## 五.二、信号汇聚层（Signal Convergence Layer）

> v3.1 新增：打通外围通道 → 右脑训练循环的集成方案。

### 5.2.1 设计原则

| 原则 | 要求 |
|------|------|
| **不改已有模块** | FeedbackLearner、BuddyLearn 等保持独立，只加"桥接" |
| **统一信号格式** | 所有外部信号转为 `TrainingSample`，复用现有学习管线 |
| **优先级分层** | 用户纠正 > 知识注入 > 推理链 > 经验进化 |
| **可选接入** | 信号汇聚层可开关，不影响核心决策流 |

### 5.2.2 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    SignalConvergenceLayer                        │
│                    （信号汇聚层 — 新增）                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ FeedbackSink │  │ KnowledgeSink│  │ ReasoningSink│           │
│  │ 纠正信号接收  │  │ 知识信号接收  │  │ 推理链接收   │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│         ▼                 ▼                 ▼                    │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              SignalPrioritizer                       │        │
│  │  优先级: 纠正(×3) > 知识(×2) > 推理(×1.5) > 进化(×1)│        │
│  └─────────────────────┬───────────────────────────────┘        │
│                        │                                         │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              TrainingSampleBuilder                   │        │
│  │  统一转为 TrainingSample 格式                        │        │
│  │  加权写入 ReplayBuffer                               │        │
│  └─────────────────────┬───────────────────────────────┘        │
│                        │                                         │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │   右脑 ReplayBuffer │
              │   (已有)            │
              └──────────────────┘
```

### 5.2.3 信号转换规则

#### FeedbackSink — 纠正信号

```typescript
// FeedbackLearner 检测到纠正 → 转为高权重 TrainingSample
function feedbackToSample(correction: Correction, context: DecisionContext): TrainingSample {
  // 纠正 = "你之前做的不对"，所以构造一个反事实样本
  // 标签 = 用户说的正确做法
  return {
    features: encodeFeatures(context),
    labelIntent: mapCorrectionToIntent(correction),  // 从纠正内容推断意图
    labelTools: mapCorrectionToTools(correction),     // 从纠正内容推断工具
    labelQuality: correction.negative ? 0.1 : 0.9,
    outcome: !correction.negative,
    timestamp: Date.now(),
    weight: 3.0,  // 纠正样本权重 × 3（最高优先级）
  };
}
```

#### KnowledgeSink — 知识信号

```typescript
// BuddyLearn 学到知识 → 转为中权重 TrainingSample
function knowledgeToSample(knowledge: LearnedKnowledge, domain: string): TrainingSample {
  // 知识 = "关于 X 领域，应该这样做"
  return {
    features: encodeKnowledgeFeatures(knowledge, domain),
    labelIntent: domainToIntent(domain),
    labelTools: domainToTools(domain),
    labelQuality: 0.7,  // 知识质量中等（未经实践验证）
    outcome: true,
    timestamp: Date.now(),
    weight: 2.0,  // 知识样本权重 × 2
  };
}
```

#### ReasoningSink — 推理链信号

```typescript
// ReasoningChain 有结论 → 转为训练样本
function reasoningToSample(chain: ReasoningChain): TrainingSample | null {
  if (chain.confidence < 0.5) return null;  // 低置信度推理不学
  if (chain.conclusions.length === 0) return null;

  return {
    features: encodeReasoningFeatures(chain),
    labelIntent: topicToIntent(chain.topic),
    labelTools: topicToTools(chain.topic),
    labelQuality: chain.confidence,
    outcome: chain.confidence > 0.7,
    timestamp: Date.now(),
    weight: 1.5,  // 推理链样本权重 × 1.5
  };
}
```

### 5.2.4 接入时机

```
FeedbackLearner.applyCorrection()  →  调用 convergenceLayer.ingestFeedback()
BuddyLearn.learnFromText()         →  调用 convergenceLayer.ingestKnowledge()
BuddyLearn.learnFromFile()         →  调用 convergenceLayer.ingestKnowledge()
KnowledgeInterviewer.recordAnswered() → 调用 convergenceLayer.ingestKnowledge()
ReasoningChainStore.conclude()     →  调用 convergenceLayer.ingestReasoning()
ExperienceEvolver.hypothesize()    →  调用 convergenceLayer.ingestEvolution()
```

### 5.2.5 文件结构

```
src/brain/convergence/
├── index.ts                 ← SignalConvergenceLayer 统一入口
├── feedback-sink.ts         ← FeedbackLearner → TrainingSample
├── knowledge-sink.ts        ← BuddyLearn → TrainingSample
├── reasoning-sink.ts        ← ReasoningChain → TrainingSample
├── evolution-sink.ts        ← ExperienceEvolver → TrainingSample
├── prioritizer.ts           ← 信号优先级 + 去重
└── types.ts                 ← 汇聚层类型定义
```

---

## 五.三、研究前沿增强（Research-Backed Enhancements）

> v3.1 新增：基于最新学术研究的方向，尚未实现但高度可行。

### 5.3.1 元认知控制信号（Metacognition as Control Signal）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| MUSE: Metacognition for Unknown Situations | arXiv 2024 | Agent 通过元认知层评估自身能力边界 |
| Uncertainty as a Control Signal | arXiv 2025 | 不确定性不只是告警，应直接控制行为 |

**现状：** 右脑 `quality_head` 输出质量预判 0-1，但只作为参考指标，未影响决策路径。

**改造方案：** 将 quality 作为一等控制信号注入 ExperienceRouter 路由决策：

```typescript
// 在 ExperienceRouter.route() 中增加元认知判断
route(input: string, contextTags: string[], intuition?: IntuitionSignal): RouteDecision {
  // 新增：元认知检查（在所有路由之前）
  if (intuition && intuition.qualityEstimate < 0.3) {
    return { path: 'llm_only', reason: 'metacognitive_uncertainty', novelty: 1.0 };
  }
  if (intuition && intuition.qualityEstimate < 0.6) {
    // 中等信心 → 走经验但要求 LLM 验证
    return { path: 'exp_verified', reason: 'metacognitive_caution', ... };
  }
  // ...原有路由逻辑
}
```

**改动量：** ~20 行代码，零新模块。**收益：** 高不确定性时自动降级，避免自信地犯错。

### 5.3.2 反事实样本生成（Counterfactual Data Augmentation）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| Counterfactual Data Augmentation | 多项 2023-2024 | 反事实样本增强训练数据，小模型泛化能力显著提升 |

**现状：** 一次交互只产生一个训练样本（实际选择的结果）。

**改造方案：** 从 DecisionMemory 构造反事实样本——"如果当时选了另一个方案会怎样"：

```typescript
// 在 DecisionMemory 中新增反事实样本生成
generateCounterfactuals(record: DecisionRecord): TrainingSample[] {
  const samples: TrainingSample[] = [];
  // 找同 fingerprint 但不同 mode 的历史记录
  const alternatives = this.records.filter(r =>
    this.fingerprint(r.signal) === this.fingerprint(record.signal) &&
    r.plan.mode !== record.plan.mode
  );

  for (const alt of alternatives) {
    // 用替代方案的历史成功率作为反事实标签
    const altSuccessRate = this.calcSuccessRate(alt);
    samples.push({
      features: encodeFeatures(record),  // 原始输入
      labelIntent: inferIntent(alt),      // 替代方案的意图
      labelTools: inferTools(alt),         // 替代方案的工具
      labelQuality: altSuccessRate,
      outcome: altSuccessRate > 0.5,
      timestamp: record.timestamp,
      weight: 0.5,  // 反事实样本权重较低（是推断的，不是真实发生的）
    });
  }
  return samples;
}
```

**改动量：** ~60 行代码，在 DecisionMemory 中新增方法。**收益：** 一次交互 → 多个样本，样本效率倍增。

### 5.3.3 课程学习（Curriculum Learning）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| Strategic Data Ordering | arXiv 2024 | 按难度排序训练样本，小模型收敛速度提升 30-50% |
| Prioritized Experience Replay | Scientific Reports 2024 | 按 TD-error 动态调整采样优先级 |

**现状：** ReplayBuffer 是 FIFO + 随机/加权采样，样本不分难易。

**改造方案：** 给 TrainingSample 加 `difficulty` 字段，训练时从易到难：

```typescript
// TrainingSample 新增字段
interface TrainingSample {
  // ...现有字段
  difficulty: number;  // 0-1
}

// difficulty 计算
function calcDifficulty(sample: TrainingSample): number {
  // 成功的简单，失败的难
  const outcomeDiff = sample.outcome ? 0.2 : 0.8;
  // 权重低的（失败/旧的）更难
  const weightDiff = 1 - sample.weight;
  // 最近的简单（上下文清晰），久远的难
  const ageMs = Date.now() - sample.timestamp;
  const ageDiff = Math.min(1, ageMs / 86400000); // 1天=1.0
  return (outcomeDiff * 0.4 + weightDiff * 0.3 + ageDiff * 0.3);
}

// ReplayBuffer 新增课程采样
sampleCurriculum(batchSize: number, progress: number): TrainingSample[] {
  // progress: 0~1，训练进度
  // 前 30% 只采 difficulty < 0.3 的简单样本
  // 后 70% 逐步放开到全量
  const maxDifficulty = 0.3 + progress * 0.7;
  const eligible = this.buffer.filter(s => s.difficulty <= maxDifficulty);
  return this.weightedSample(eligible, batchSize);
}
```

**改动量：** ~40 行代码。**收益：** 训练收敛加速 30-50%。

### 5.3.4 再注意力重放（Re-attentive Experience Replay）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| Re-attentive Experience Replay | Machine Learning 2024 | 重放旧经验时用当前状态重新计算注意力权重 |

**现状：** `sampleBySimilarity()` 只用特征余弦相似度，不考虑当前 BodyState。

**改造方案：** 上下文感知采样：

```typescript
// ReplayBuffer 新增上下文感知采样
sampleContextual(targetFeatures: Float32Array, bodyState: BodyState, k: number): TrainingSample[] {
  return this.buffer
    .map(sample => ({
      sample,
      score:
        cosineSimilarity(targetFeatures, sample.features) * 0.5 +  // 特征相似度
        timeDecay(sample.timestamp) * 0.2 +                        // 时效性
        emotionAffinity(bodyState.emotion, sample.emotion) * 0.3   // 情绪相关性
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(r => r.sample);
}
```

**改动量：** ~30 行代码。**收益：** 旧经验在新语境下更有用。

### 5.3.5 自对弈验证（Self-Play Debate）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| Training LMs to Win Debates | NYU 2024 | 自对弈辩论后裁判准确率显著提升 |
| Self-Play in Adversarial Games | arXiv 2025 | Agent 通过自我对抗发现推理漏洞 |

**现状：** 左脑做决策后直接执行，没有内部质疑环节。

**改造方案：** 高不确定性时，右脑扮演反方质疑左脑决策：

```typescript
// 在 LeftBrain.decide() 中新增自对弈
async decide(signal, resources, intuition, body): Promise<ExecutionPlan> {
  const plan = this.ruleEngine.evaluate(signal, resources, intuition, body)
    ?? this.scheduler.schedule(signal, resources, intuition, body);

  // 新增：高不确定性时触发自对弈
  if (intuition && intuition.qualityEstimate < 0.5 && plan.confidence < 0.6) {
    const challenge = this.challengePlan(plan, signal, resources, intuition);
    if (challenge.shouldOverride) {
      return challenge.alternative;
    }
  }
  return plan;
}

private challengePlan(plan, signal, resources, intuition): ChallengeResult {
  // 右脑质疑：历史上这个模式的成功率？
  const historical = this.decisionMemory.findSimilar(signal, 5);
  const historicalSuccess = historical.filter(r => r.record.outcome?.success).length / historical.length;

  if (historicalSuccess < 0.3 && plan.mode !== 'sequential') {
    return {
      shouldOverride: true,
      alternative: { ...plan, mode: 'sequential', reason: '自对弈降级: 历史成功率低' }
    };
  }
  return { shouldOverride: false };
}
```

**改动量：** ~50 行代码。**收益：** 高风险决策有内部校验。

### 5.3.6 渐进式知识图谱（Incremental Knowledge Graph）

| 论文 | 来源 | 核心发现 |
|------|------|----------|
| Knowledge Acquisition via RL on Graph | arXiv 2024 | 图结构组织知识，Agent 推理效率比扁平记忆高 40% |

**现状：** 经验以 ExperienceGraph 存储（有边），知识以 MemoryStore 存储（扁平 key-value），两者不互通。

**改造方案：** 将 MemoryStore 的知识条目纳入 ExperienceGraph 的节点/边体系：

```
概念节点: "git", "文件操作", "Python", "调试"
关系边:   "git" --[常用于]--> "代码操作"
          "Python" --[需要]--> "调试"
          "调试" --[触发]--> "search_files + exec"

推理时：从当前任务的概念节点出发，沿边找到相关经验和知识
```

**改动量：** 较大（需要扩展 ExperienceGraph 支持知识节点）。**收益：** 结构化推理基础。**建议排入 Phase 8。**

---

## 六、三脑协作协议

### 6.1 信号流向

```
外部输入 ──────────────────────────────────────────┐
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │    小脑          │
                                            │ 感知融合 + 稳态   │
                                            └────────┬────────┘
                                                     │ BodyState
                                                     │ HomeostasisActions
                                              ┌──────┴──────┐
                                              ▼             ▼
                                     ┌──────────────┐ ┌──────────────┐
                                     │    左脑       │ │    右脑       │
                                     │ 规则 + 调度   │ │ 直觉 + 学习   │
                                     └──────┬───────┘ └──────┬───────┘
                                            │                │
                                            │  直觉信号注入    │
                                            │◄───────────────┘
                                            ▼
                                     ┌──────────────┐
                                     │   执行层      │
                                     │ LLM + 工具    │
                                     └──────────────┘
```

### 6.2 三脑通信接口

```typescript
/** 左脑 → 右脑 */
interface LeftToRight {
  askIntuition(task: IntuitionTask, input: string): Promise<IntuitionResult>;
  reportOutcome(outcome: DecisionOutcome): void;
}

/** 右脑 → 左脑 */
interface RightToLeft {
  getSignal(): IntuitionSignal;
}

/** 小脑 → 左脑/右脑 */
interface CerebellumToBrain {
  getHomeostasisActions(): HomeostasisAction[];
  getBodyState(): BodyState;
}

/** 左脑/右脑 → 小脑 */
interface BrainToCerebellum {
  reportExecution(result: ExecutionResult): void;
}
```

### 6.3 决策融合

```
用户消息进入
    │
    ▼
小脑: BodyState 更新 + HomeostasisAction[]
    │
    ├─ high priority 调节动作 → 直接执行，跳过左脑
    │
    ▼
右脑: IntuitionNet.predict(features) → IntuitionDecision
    │
    ▼
左脑: RuleEngine.evaluate(signal, resources, intuition, bodyState)
    │
    ├─ 命中规则 → 按规则执行
    └─ 未命中 → Scheduler.schedule(signal + intuition + body)
    │
    ▼
执行 → 结果反馈给三脑
    ├─ 左脑: DecisionMemory.record()
    ├─ 右脑: OnlineLearner.collectSample() → 在线更新权重
    └─ 小脑: BodyStateManager.update(result)
```

---

## 七、详细开发计划

### Phase 0: 准备（Day 1）

| 任务 | 产出 | 耗时 |
|------|------|------|
| 创建 `src/brain/` 目录结构 | 目录骨架 | 10min |
| 创建 `src/brain/types.ts` | 共享类型定义 | 30min |
| 创建三脑入口文件（空壳） | index.ts × 3 | 30min |
| 在 Subsystems 中预留三脑初始化位 | 代码修改 | 30min |
| 提交到 GitHub | commit | 10min |

### Phase 1: 右脑 NN 内核（Day 2-5）★ 最高优先级

#### Day 2: 张量运算 + 基础层

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现 Tensor 类（shape, data, ops） | `nn/tensor.ts` | 张量基础运算 |
| 实现 matmul, add, relu, softmax | `nn/tensor.ts` | 核心数学运算 |
| 实现 LayerNorm | `nn/tensor.ts` | 归一化 |
| 实现 Embedding 层 | `nn/embedding.ts` | 查表嵌入 |
| 单元测试 | `nn/__tests__/tensor.test.ts` | 验证数值正确性 |

#### Day 3: Attention + FFN + Encoder

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现 Multi-Head Self-Attention | `nn/attention.ts` | QKV 投影 + 缩放点积 + 多头 |
| 实现 FFN（两层 MLP + GELU） | `nn/ffn.ts` | 前馈网络 |
| 实现 Encoder Block | `nn/encoder.ts` | Attention + FFN + LayerNorm + Residual |
| 单元测试 | `nn/__tests__/attention.test.ts` | 验证 attention 计算 |

#### Day 4: 输出头 + 完整模型

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现三个输出头 | `nn/output-heads.ts` | intent_head, tool_head, quality_head |
| 组合完整 IntuitionNet | `nn/model.ts` | Embedding → Encoder×2 → Heads |
| 实现 forward() 推理 | `nn/model.ts` | 前向传播 |
| 实现 int8 量化 | `nn/quantize.ts` | 权重量化/反量化 |
| 实现权重序列化 | `nn/serialize.ts` | .bin 格式读写 |
| 集成测试 | `nn/__tests__/model.test.ts` | 端到端推理验证 |

#### Day 5: 特征编码 + 输出解码 + 接口

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现输入特征编码器 | `features/encoder.ts` | TaskSignal + BodyState + history → tensor |
| 实现输出解码器 | `features/decoder.ts` | logits → IntuitionDecision |
| 实现 RightBrain 统一入口 | `index.ts` | predict() + getSignal() |
| 性能基准测试 | 测试脚本 | 验证 < 5ms 推理 |
| 提交到 GitHub | commit | 右脑 NN 内核 v0.1 |

### Phase 2: 右脑在线学习（Day 6-8）

#### Day 6: Loss + ReplayBuffer

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现 CrossEntropy loss | `training/loss.ts` | 分类 loss |
| 实现 MSE loss | `training/loss.ts` | 回归 loss |
| 实现 span-level 组合 loss | `training/loss.ts` | α*L_intent + β*L_tool + γ*L_quality |
| 实现 ReplayBuffer | `training/replay-buffer.ts` | FIFO 容量 1000，采样 batch |
| 单元测试 | 训练相关测试 | |

#### Day 7: OnlineLearner + LPR

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现反向传播（手写梯度） | `nn/backward.ts` | 各层梯度计算 |
| 实现 SGD 优化器 | `training/optimizer.ts` | 学习率调度 |
| 实现 LPR 近端项 | `training/lpr.ts` | 每层权重正则 |
| 实现 OnlineLearner | `training/online-learner.ts` | 每次交互后：采样→loss→backward→update |
| 集成测试 | 端到端学习测试 | |

#### Day 8: Distiller + 蒸馏管线

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现 span 分割器 | `training/distiller.ts` | signal_span + context_span + action_span |
| 实现 Decision-Attention 加权 | `training/distiller.ts` | 成功/失败/时间衰减权重 |
| 实现蒸馏训练循环 | `training/distiller.ts` | 从 DecisionMemory 收集→训练→评估 |
| 接入 DecisionMemory | 对接左脑 | 数据流打通 |
| 提交到 GitHub | commit | 右脑在线学习 v0.1 |

### Phase 3: 左脑规则引擎 + 蒸馏（Day 9-11）

#### Day 9: RuleEngine

| 任务 | 文件 | 产出 |
|------|------|------|
| 定义 Rule 接口 | `left/types.ts` | 规则类型 |
| 迁移 8 条内置规则 | `left/rule-engine.ts` | 从 agent.ts 迁移 |
| 实现规则匹配（优先级） | `left/rule-engine.ts` | evaluate() |
| 实现规则反馈 | `left/rule-engine.ts` | feedback() + prune() |
| 单元测试 | | |

#### Day 10: DecisionMemory + PolicyDistiller

| 任务 | 文件 | 产出 |
|------|------|------|
| 整合 DecisionRecorder | `left/decision-memory.ts` | 记录 + 查询 + 聚类 |
| 实现 signal fingerprint 聚类 | `left/policy-distiller.ts` | 按 pattern 聚类 |
| 实现正规则提炼 | `left/policy-distiller.ts` | 成功率 > 0.8 → 新规则 |
| 实现否定规则提炼 | `left/policy-distiller.ts` | 成功率 < 0.2 → 黑名单 |
| 实现规则冲突检测 | `left/policy-distiller.ts` | condition 交集检测 |

#### Day 11: UnifiedScheduler + LeftBrain 入口

| 任务 | 文件 | 产出 |
|------|------|------|
| 整合 ModelPoolScheduler | `left/scheduler.ts` | 三层调度 |
| 整合 ModelRouter | `left/scheduler.ts` | 任务路由 |
| 整合 ExperienceRouter | `left/scheduler.ts` | 经验路由 |
| 注入右脑直觉信号 | `left/scheduler.ts` | IntuitionSignal → 调度决策 |
| 实现 LeftBrain 统一入口 | `left/index.ts` | decide() + recordOutcome() |
| 提交到 GitHub | commit | 左脑 v0.1 |

### Phase 4: 小脑稳态调节（Day 12-14）

#### Day 12: BodyState

| 任务 | 文件 | 产出 |
|------|------|------|
| 定义 BodyState 接口 | `cerebellum/types.ts` | 完整状态类型 |
| 实现 BodyStateManager | `cerebellum/body-state.ts` | 状态更新 + 事件处理 |
| 迁移 EmotionEngine 接口 | `cerebellum/body-state.ts` | 情绪状态集成 |
| 迁移 DesireEngine 接口 | `cerebellum/body-state.ts` | 欲望状态集成 |

#### Day 13: HomeostasisRegulator

| 任务 | 文件 | 产出 |
|------|------|------|
| 实现 PID 控制器 | `cerebellum/homeostasis.ts` | 比例+积分+微分 |
| 实现能量回路 | `cerebellum/homeostasis.ts` | energy → dream/slow |
| 实现情绪回路 | `cerebellum/homeostasis.ts` | valence → mood/prompt |
| 实现认知回路 | `cerebellum/homeostasis.ts` | confusion → clarify/tools |
| 实现负载回路 | `cerebellum/homeostasis.ts` | load → model/queue |
| 实现多级阈值 | `cerebellum/homeostasis.ts` | 警告/干预/强制 |

#### Day 14: SensorFusion + MotorControl + 入口

| 任务 | 文件 | 产出 |
|------|------|------|
| 迁移 FusionBuffer | `cerebellum/sensor-fusion.ts` | 多源感知融合 |
| 迁移 PerceptionEventBus | `cerebellum/sensor-fusion.ts` | 事件总线 |
| 迁移 IdleBehavior | `cerebellum/motor-control.ts` | 空闲行为 |
| 迁移 ProactiveEngine | `cerebellum/motor-control.ts` | 主动行为 |
| 实现 Cerebellum 统一入口 | `cerebellum/index.ts` | regulate() + getBodyState() |
| 提交到 GitHub | commit | 小脑 v0.1 |

### Phase 5: 三脑联调 + Agent 接入（Day 15-17）

#### Day 15: 三脑通信

| 任务 | 产出 |
|------|------|
| 实现 LeftToRight 接口 | 左脑调用右脑直觉 |
| 实现 RightToLeft 接口 | 右脑返回信号给左脑 |
| 实现 CerebellumToBrain 接口 | 小脑注入稳态指令 |
| 实现 BrainToCerebellum 接口 | 执行结果反馈小脑 |

#### Day 16: Agent 接入

| 任务 | 产出 |
|------|------|
| 在 Subsystems 中初始化三脑 | 三脑实例化 |
| 重写 orchestrate() | 接入三脑决策流 |
| 重写消息处理管线 | 三脑信号注入 |
| 端到端测试 | 消息→三脑→执行→反馈 |

#### Day 17: 性能优化 + 文档

| 任务 | 产出 |
|------|------|
| 性能基准测试 | 三脑决策 < 10ms |
| 清理旧代码 | 废弃分散的旧模块 |
| 更新 ARCHITECTURE.md | 文档同步 |
| 更新 README.md | 功能说明 |
| 提交到 GitHub | commit + push |

### Phase 6: 小脑自适应层（Day 18-20）

#### Day 18: RhythmAdaptor — 节律自适配

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 RhythmState 类型定义 | `cerebellum/adaptive/rhythm.ts` | loadSamples / interactionRate / errorRate | 20min |
| 实现滑动窗口（60 点移动平均） | `cerebellum/adaptive/rhythm.ts` | movingAverage() + addSample() | 30min |
| 实现高峰调节逻辑 | `cerebellum/adaptive/rhythm.ts` | load > 70 → 拉长心跳、压低梦境密度 | 30min |
| 实现空闲调节逻辑 | `cerebellum/adaptive/rhythm.ts` | load < 30 → 缩短心跳、提升自检频率 | 30min |
| 实现正常区间线性插值 | `cerebellum/adaptive/rhythm.ts` | 30 < load < 70 → 平滑过渡 | 20min |
| 对接 BuddyClock 参数注入 | `cerebellum/adaptive/rhythm.ts` | setHeartbeatInterval() / setDreamDensity() | 30min |
| 对接 HomeostasisRegulator 输出 | `cerebellum/index.ts` | regulate() 结果驱动 rhythm 更新 | 20min |
| 单元测试 | `adaptive/rhythm.test.ts` | 高峰/空闲/正常三档验证 | 30min |

**产出**：`rhythm.ts` ~200 行，负载变化后 1 分钟内完成适配

#### Day 19: HabitMemory — 肌肉记忆

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 HabitEntry 类型定义 | `cerebellum/adaptive/habit.ts` | fingerprint / action / hitCount / successRate | 20min |
| 实现 fingerprint 哈希函数 | `cerebellum/adaptive/habit.ts` | hash(domains + complexity + taskType) → string | 20min |
| 实现 lookup() 查表 | `cerebellum/adaptive/habit.ts` | 命中缓存 → 直接返回 ExecutionPlan | 30min |
| 实现 record() 写入 | `cerebellum/adaptive/habit.ts` | 成功率滑动平均 + 计数器递增 | 30min |
| 实现固化条件判断 | `cerebellum/adaptive/habit.ts` | hitCount ≥ 5 && successRate ≥ 0.8 → 固化 | 20min |
| 实现淘汰机制 | `cerebellum/adaptive/habit.ts` | 7 天未用 / successRate < 0.6 → 移除 | 20min |
| 实现 LRU 淘汰（maxEntries=200） | `cerebellum/adaptive/habit.ts` | 超限时移除最久未用 | 20min |
| 接入 LeftBrain.decide() 前置查询 | `brain/left/index.ts` | decide() 先查 habit → 命中则跳过规则+调度 | 30min |
| 未命中时回写 | `brain/left/index.ts` | 完整链路决策结果写入 habit cache | 20min |
| 单元测试 | `adaptive/habit.test.ts` | 固化/淘汰/命中率验证 | 30min |

**产出**：`habit.ts` ~250 行，稳态后缓存命中率 > 40%，常规链路延迟从 5ms 降至 < 0.1ms

#### Day 20: ErrorTuner + 集成 + 性能基准

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 ErrorProfile 类型定义 | `cerebellum/adaptive/error-tuner.ts` | errorType / severity / suppressionFactor / boostFactor | 20min |
| 实现 observe() 错误观测 | `cerebellum/adaptive/error-tuner.ts` | 更新频率统计 + 自适应因子计算 | 30min |
| 实现弱化逻辑 | `cerebellum/adaptive/error-tuner.ts` | low severity + 高频 → suppressionFactor 衰减 | 20min |
| 实现强化逻辑 | `cerebellum/adaptive/error-tuner.ts` | critical severity + 首次 → boostFactor 放大 | 20min |
| 实现周期衰减 decay() | `cerebellum/adaptive/error-tuner.ts` | 每小时缓慢恢复到中性值 | 20min |
| 实现 getAlertWeight() 查询 | `cerebellum/adaptive/error-tuner.ts` | 返回 suppressionFactor × boostFactor | 10min |
| 对接 SensorFusion 事件 | `cerebellum/sensor-fusion.ts` | ingest() 时调用 errorTuner.observe() | 20min |
| 对接 HomeostasisRegulator 阈值 | `cerebellum/homeostasis.ts` | PID 输出乘以 alertWeight | 20min |
| 创建 adaptive 统一入口 | `cerebellum/adaptive/index.ts` | RhythmAdaptor + HabitMemory + ErrorTuner 导出 | 20min |
| 集成测试 | `adaptive/integration.test.ts` | 三层联动 + 边界条件 | 30min |
| 性能基准测试 | 测试脚本 | 三层均 < 1ms（纯查表+算术） | 30min |
| 提交到 GitHub | commit | 小脑自适应层 v0.1 | 10min |

**产出**：`error-tuner.ts` ~200 行，100 次同类异常后 suppressionFactor < 0.3

### Phase 6.5: 信号汇聚 + 研究增强（Day 20.5-21）★ 高 ROI

> v3.1 新增：打通已有外围知识通道 + 应用最新研究方向。改动量小，收益大。

#### Day 20.5 上午: 信号汇聚层骨架

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 创建 convergence 目录 | `brain/convergence/` | 目录骨架 | 10min |
| 定义汇聚层类型 | `brain/convergence/types.ts` | Sink 接口 + PrioritizedSample | 30min |
| 实现 SignalConvergenceLayer | `brain/convergence/index.ts` | 统一入口 + 注册 Sink | 40min |
| 实现 SignalPrioritizer | `brain/convergence/prioritizer.ts` | 优先级排序 + 去重 | 30min |
| 单元测试 | `convergence/convergence.test.ts` | 验证信号转换 | 30min |

#### Day 20.5 下午: 四个 Sink 实现

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 FeedbackSink | `brain/convergence/feedback-sink.ts` | 纠正→TrainingSample(×3) | 30min |
| 实现 KnowledgeSink | `brain/convergence/knowledge-sink.ts` | 知识→TrainingSample(×2) | 30min |
| 实现 ReasoningSink | `brain/convergence/reasoning-sink.ts` | 推理链→TrainingSample(×1.5) | 20min |
| 实现 EvolutionSink | `brain/convergence/evolution-sink.ts` | 进化→TrainingSample(×1) | 20min |
| 接入 FeedbackLearner | `feedback/learner.ts` | applyCorrection() 调用汇聚层 | 15min |
| 接入 BuddyLearn | `knowledge/learn.ts` | learnFromText/File() 调用汇聚层 | 15min |
| 接入 ReasoningChainStore | `memory/reasoning-chain.ts` | conclude() 调用汇聚层 | 15min |
| 集成测试 | `convergence/integration.test.ts` | 端到端信号流验证 | 30min |

**产出**：`brain/convergence/` ~400 行，外围通道全部接入右脑训练循环

#### Day 21 上午: 元认知 + 反事实

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 元认知路由注入 | `brain/left/scheduler.ts` | quality < 0.3 → 强制 LLM | 30min |
| 元认知路由注入 | `intelligence/experience-router.ts` | quality < 0.5 → exp_verified | 30min |
| 反事实样本生成 | `brain/left/decision-memory.ts` | generateCounterfactuals() | 1h |
| 反事实集成 | `brain/right/training/online-learner.ts` | collectSample() 调用反事实 | 30min |
| 单元测试 | | 元认知路由 + 反事实样本验证 | 30min |

#### Day 21 下午: 课程学习 + 再注意力

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| TrainingSample 加 difficulty | `brain/types.ts` | 新增 difficulty 字段 | 10min |
| difficulty 计算 | `brain/right/training/replay-buffer.ts` | calcDifficulty() | 20min |
| 课程采样 | `brain/right/training/replay-buffer.ts` | sampleCurriculum() | 30min |
| 上下文感知采样 | `brain/right/training/replay-buffer.ts` | sampleContextual() | 30min |
| OnlineLearner 接入课程采样 | `brain/right/training/online-learner.ts` | 根据训练进度选采样策略 | 30min |
| 提交到 GitHub | commit | 信号汇聚 + 研究增强 v0.1 | 10min |

**产出**：
- 信号汇聚层 ~400 行
- 元认知路由 ~20 行改动
- 反事实生成 ~60 行
- 课程学习 ~40 行
- 再注意力 ~30 行
- **总计 ~550 行，ROI 最高的改动**

### Phase 7: 右脑认知扩展（Day 22-36）

#### Day 22-23: 论文研读 + 架构设计

| 任务 | 产出 | 耗时 |
|------|------|------|
| 研读 CoordConv (NeurIPS 2018) | 坐标编码原理笔记 | 4h |
| 研读 ViT/MAE (2020/2022) | Patch embedding 设计笔记 | 6h |
| 研读 Slot Attention (NeurIPS 2020) | Object-centric 表征笔记 | 6h |
| 研读 World Models / DreamerV3 | 潜空间想象机制笔记 | 8h |
| 研读 Scene Representation Networks | 结构化场景表征笔记 | 6h |
| 设计多模态 Encoder 接口 | `features/multimodal-encoder.ts` 接口定义 | 4h |
| 设计新 Output Head 接口 | `nn/output-heads.ts` 扩展方案 | 2h |
| 更新 NNConfig 参数 | vocabSize/embedDim/hiddenDim/numLayers 调整 | 1h |

#### Day 24-25: Spatial Encoder（空间编码器）

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现坐标离散化 | `features/spatial-encoder.ts` | x/y/z → 50 bins → token IDs (400-449) | 2h |
| 实现 CoordConv 注入 | `features/spatial-encoder.ts` | 在 token embedding 上叠加坐标通道 | 2h |
| 实现空间关系编码 | `features/spatial-encoder.ts` | 相对位置 → 方向 token (上/下/左/右) | 2h |
| 集成到 encodeFeatures() | `features/encoder.ts` | spatial tokens 追加到序列末尾 | 1h |
| 单元测试 | | 验证坐标编码正确性 | 1h |

#### Day 26-27: Image Encoder（图像编码器）

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 Patch Embedding | `features/image-encoder.ts` | 图片 → 10×10 patches → token IDs (450-549) | 4h |
| 实现 Position Encoding | `features/image-encoder.ts` | 2D sinusoidal position embedding | 2h |
| 实现 CLIP 风格对齐 | `features/image-encoder.ts` | 图像 token 与文本 token 共享 embedding 空间 | 3h |
| 集成到 encodeFeatures() | `features/encoder.ts` | image tokens 追加到序列 | 1h |
| 单元测试 | | 验证 patch 分块 + 编码正确性 | 2h |

#### Day 28-29: Scene Encoder（场景编码器）

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 Scene Graph 编码 | `features/scene-encoder.ts` | 物体节点 + 空间关系边 → token IDs (550-649) | 3h |
| 实现 Slot Attention 轻量版 | `features/scene-encoder.ts` | 输入 token → K 个 object slots | 4h |
| 实现 slot → token 映射 | `features/scene-encoder.ts` | slot 向量 → 离散 slot ID (650-699) | 2h |
| 集成到 encodeFeatures() | `features/encoder.ts` | scene tokens 追加到序列 | 1h |
| 单元测试 | | 验证场景编码 + slot 分配 | 2h |

#### Day 30-31: Spatial + Scene Output Heads

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 SpatialHead | `nn/output-heads.ts` | backbone → 6 维坐标 (x,y,z,w,h,d) | 2h |
| 实现 SceneHead | `nn/output-heads.ts` | backbone → 拓扑节点 logits | 3h |
| 实现 Spatial Loss | `training/loss.ts` | MSE(预测坐标, 真实坐标) | 1h |
| 实现 Scene Loss | `training/loss.ts` | CE(预测节点, 真实拓扑) | 1h |
| 更新 spanLevelLoss() | `training/loss.ts` | L = α*L_intent + β*L_tool + γ*L_quality + δ*L_spatial + ε*L_scene | 1h |
| 更新 backwardPass() | `training/backward.ts` | 新 head 的梯度计算 | 2h |
| 单元测试 | | 验证新 head 前向+反向 | 2h |

#### Day 32-33: 脑内构图（Mental Simulation）

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| 实现 WorldModel 轻量 MLP | `nn/world-model.ts` | z → predict(z, action) → z' | 3h |
| 实现 latent space 预测 | `nn/world-model.ts` | 当前状态 → 动作 → 预测下一状态 | 3h |
| 实现结构化解码 | `nn/world-model.ts` | z' → 坐标偏移 + 拓扑变化 | 2h |
| 实现想象循环 | `nn/world-model.ts` | 多步预测：z → z' → z'' → ... | 2h |
| 集成到 RightBrain | `right/index.ts` | imagine(actions) → predictedStates | 1h |
| 单元测试 | | 验证预测一致性 | 1h |

#### Day 34-35: 模式直觉 + 记忆关联 + 隐性经验

| 任务 | 文件 | 产出 | 耗时 |
|------|------|------|------|
| ReplayBuffer 加 kNN 索引 | `training/replay-buffer.ts` | sampleBySimilarity(signal, k) | 3h |
| Distiller 输出可提取规则 | `training/distiller.ts` | distillToRules() → Rule[] | 3h |
| OnlineLearner 关联学习 | `training/online-learner.ts` | 相似样本加权采样 | 2h |
| 单元测试 | | 验证 kNN 查找 + 规则提取 | 2h |

#### Day 36: 集成 + 训练 + 性能基准

| 任务 | 产出 | 耗时 |
|------|------|------|
| 更新 NNConfig 默认参数 | vocabSize=4096, embedDim=128, hiddenDim=256, numLayers=4 | 30min |
| 端到端集成测试 | 多模态输入 → 三脑决策 → 反馈 | 2h |
| 性能基准测试 | 推理 < 20ms, 模型 < 3MB | 1h |
| 训练数据准备 | 采集多模态交互样本 | 2h |
| 在线学习收敛验证 | 100 次交互后各 head loss 下降 | 2h |
| 提交到 GitHub | commit | 10min |

### Phase 8: 性能优化 + 持续调优（Day 37+）

> v3.2 新增：基于 2026-05-01 压力测试的逐层耗时分析，制定精确的性能优化方案。
> **详细实施方案见 → [`MATMUL_OPTIMIZATION_PLAN.md`](./MATMUL_OPTIMIZATION_PLAN.md)**

#### 8.0 性能现状分析（2026-05-01 基准测试）

**测试环境**: Linux 6.8.0 (x64), Node.js v22.22.1, 纯 CPU

**默认配置** (RightBrain DEFAULT_CONFIG):
```
vocabSize: 4096, embedDim: 128, hiddenDim: 256
numHeads: 4, numLayers: 4, ffnDim: 512
参数量: 3,014,735 (~3M)
```

**逐层耗时分解** (单次 forward, 序列长度 21 tokens):

| 组件 | 耗时 | 占比 | 瓶颈操作 |
|------|------|------|----------|
| Embedding | 0.07ms | 0.1% | 查表 |
| Projection (128→256) | 1.30ms | 1.4% | matmul [21,128]×[128,256] |
| **4× Encoder Blocks** | **87.48ms** | **97.6%** | — |
| └ Q/K/V 投影 (每 block) | 31.2ms | 34.8% | 3× matmul [21,256]×[256,256] |
| └ FFN (每 block) | 42.8ms | 47.8% | 2× matmul [21,256]×[256,512] + gelu |
| └ Attention scores+softmax | 3.2ms | 3.6% | scores [1,4,21,21] + weightedSum |
| └ LayerNorm + residual | ~0.3ms | 0.3% | — |
| Pool + 5 Output Heads | 0.72ms | 0.8% | 5× matmul [1,256]×[256,outDim] |
| **总计** | **~89.6ms** | **100%** | — |

**matmul 吞吐量**: ~1.05 GFLOPS（纯 JS Float32Array，符合 V8 预期）

**内存分配**: ~138 次 zeros() 调用/forward, ~2.9MB 临时 Float32Array

**文档 vs 实际偏差**:

| 维度 | 文档描述 (v3.1) | 实际默认值 | 偏差 |
|------|----------------|-----------|------|
| numLayers | 2 | **4** | 2× |
| hiddenDim | 128 | **256** | 2× |
| 参数量 | ~300K | **~3M** | **10×** |
| 推理延迟 | < 5ms | **~90ms** | **18×** |

**根因**: `RightBrain` 的 `DEFAULT_CONFIG` 与 §3.4 参数量估算表不一致。

#### 8.1 优化方案总览

| # | 方案 | 预期收益 | 改动量 | 优先级 |
|---|------|---------|--------|--------|
| 1 | 默认配置对齐文档 | 90ms → **~5ms** | 改配置 | **P0** |
| 2 | 推理模式跳过反向缓存 | ~5-10% | ~30 行 | P1 |
| 3 | Tensor 对象池化 | 减少 GC, 训练场景显著 | ~150 行 | P1 |
| 4 | 融合算子 (add+bias, LN+residual) | ~5-10% | ~100 行 | P2 |
| 5 | WASM matmul | 5-10× 提速 | 高 (需 C/Rust) | P2 |
| 6 | int8 推理 (非仅存储) | ~2-4× (内存带宽受限时) | ~200 行 | P3 |

#### 8.1.1 方案 1: 默认配置对齐文档 (P0, 最高 ROI)

**原理**: 90ms 延迟的 97.6% 来自 4 层 Encoder Block 的 matmul。将配置对齐文档描述的 2 层 128d，参数量从 3M 降到 ~300K，延迟从 ~90ms 降到 ~5ms。

**修改文件**: `src/brain/right/index.ts`

```typescript
// 修改前 (当前默认)
const DEFAULT_CONFIG: RightBrainConfig = {
  nn: {
    vocabSize: 4096, embedDim: 128, hiddenDim: 256,
    numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
    ffnDim: 512, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
  },
  // ...
};

// 修改后 (对齐文档 §3.4)
const DEFAULT_CONFIG: RightBrainConfig = {
  nn: {
    vocabSize: 2048, embedDim: 64, hiddenDim: 128,
    numHeads: 4, numLayers: 2, numIntents: 8, numTools: 32,
    ffnDim: 256, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
  },
  // ...
};
```

**预期效果**:

| 指标 | 修改前 | 修改后 |
|------|--------|--------|
| 参数量 | 3,014,735 | ~301,609 |
| 模型大小 (float32) | ~11.5MB | ~1.2MB |
| 模型大小 (int8) | ~3MB | ~300KB |
| 推理延迟 | ~90ms | ~5ms |
| 达标 (文档 < 5ms) | ❌ | ✅ |

**兼容性**: 现有 `loadModel()` 会按文件中的 shape 加载，不受默认配置影响。已有模型文件继续正常工作。

**风险**: 低。模型容量减小可能影响复杂任务的意图分类准确率，但 §3.4 的研究依据（Nature 2025: "小网络+好结构 > 大网络+差结构, 100K 参数足够"）表明 300K 参数对 8 类意图 + 32 工具分类任务已充足。

#### 8.1.2 方案 2: 推理模式跳过反向缓存 (P1)

**原理**: 推理时不需要反向传播，但当前 `forward()` 仍然为每个操作创建 `_ctx`（保存父节点引用）和 `_cached*` 中间值。这些操作虽然单次开销小（~0.5ms），但在高频推理场景下累积可观。

**修改文件**: `src/brain/right/nn/model.ts`, `encoder.ts`, `attention.ts`, `ffn.ts`, `output-heads.ts`

```typescript
// model.ts — forward() 增加 inference 参数
forward(tokenIds: number[], inference = false): ModelOutput {
  // ...
  for (const block of this.encoderBlocks) {
    h = block.forward(h, true, inference);  // 传递 inference 标志
  }
  // ...
}

// tensor.ts — 各运算在 inference 模式下跳过 _ctx
export function matmul(a: Tensor, b: Tensor, inference = false): Tensor {
  // ... 计算 ...
  if (!inference) {
    out._ctx = { op: 'matmul', saved: [], parents: [a, b] };
  }
  return out;
}

// attention.ts — inference 模式下跳过 _cached*
forward(x: Tensor, useCausalMask = true, inference = false): Tensor {
  // ... 推理逻辑 ...
  if (!inference) {
    // 只在训练时缓存中间值
  }
}
```

**预期效果**: 推理延迟降低 ~5-10%（~4-9ms），内存分配减少 ~30%。

#### 8.1.3 方案 3: Tensor 对象池化 (P1)

**原理**: 当前每次 `zeros()` 都分配新的 `Float32Array`，138 次/forward。在训练循环（batch=8, 每次 forward+backward）中，这些临时对象导致频繁 GC。

**新增文件**: `src/brain/right/nn/pool.ts`

```typescript
/**
 * Tensor 对象池 — 复用 Float32Array 减少 GC 压力
 *
 * 按 shape 分桶，每桶维护一个空闲列表。
 * acquire() 从桶中取一个，release() 归还。
 * 推理时不需要池化（单次分配即可），训练时显著减少 GC。
 */
export class TensorPool {
  private pools: Map<string, Float32Array[]> = new Map();
  private maxPerBucket = 32;

  acquire(shape: number[]): Float32Array {
    const key = shape.join('×');
    const bucket = this.pools.get(key);
    if (bucket && bucket.length > 0) {
      const buf = bucket.pop()!;
      buf.fill(0);
      return buf;
    }
    return new Float32Array(shape.reduce((a, b) => a * b, 1));
  }

  release(shape: number[], buf: Float32Array): void {
    const key = shape.join('×');
    let bucket = this.pools.get(key);
    if (!bucket) {
      bucket = [];
      this.pools.set(key, bucket);
    }
    if (bucket.length < this.maxPerBucket) {
      bucket.push(buf);
    }
  }

  clear(): void {
    this.pools.clear();
  }
}

// 全局池实例
export const globalPool = new TensorPool();

// 修改 zeros() 使用池
export function pooledZeros(shape: number[], pool = globalPool): Tensor {
  const data = pool.acquire(shape);
  return new Tensor(data, shape);
}
```

**预期效果**: 训练场景 GC 减少 ~60%，batch=8 训练延迟降低 ~15-20%。推理场景收益不明显（单次分配，GC 来得及回收）。

#### 8.1.4 方案 4: 融合算子 (P2)

**原理**: 当前 `add(matmul(a, b), bias)` 创建了两个中间 Tensor（matmul 输出 + add 输出）。融合为单个操作可以减少一次内存写入。

```typescript
/**
 * 融合 matmul + bias: [M,K]×[K,N] + [N] → [M,N]
 * 比分开调用减少一次 zeros() + 一次全量写入
 */
export function matmulAddBias(a: Tensor, b: Tensor, bias: Tensor): Tensor {
  const [M, K] = a.shape;
  const N = b.shape[1];
  const out = zeros([M, N]);
  const TILE = 32;

  for (let i0 = 0; i0 < M; i0 += TILE) {
    const iEnd = Math.min(i0 + TILE, M);
    for (let k0 = 0; k0 < K; k0 += TILE) {
      const kEnd = Math.min(k0 + TILE, K);
      for (let j0 = 0; j0 < N; j0 += TILE) {
        const jEnd = Math.min(j0 + TILE, N);
        for (let i = i0; i < iEnd; i++) {
          const aRow = i * K;
          const oRow = i * N;
          for (let k = k0; k < kEnd; k++) {
            const aik = a.data[aRow + k];
            if (aik === 0) continue;
            const bRow = k * N;
            for (let j = j0; j < jEnd; j++) {
              out.data[oRow + j] += aik * b.data[bRow + j];
            }
          }
        }
        // 融合 bias 加法（在块循环内完成）
        if (k0 === 0) { // 只在第一个 k 块时加 bias
          for (let i = i0; i < iEnd; i++) {
            const oRow = i * N;
            for (let j = j0; j < jEnd; j++) {
              out.data[oRow + j] += bias.data[j];
            }
          }
        }
      }
    }
  }
  return out;
}
```

**预期效果**: 每个 Encoder Block 减少 ~4 次 zeros()，总计减少 ~16 次/forward，延迟降低 ~5-8%。

#### 8.1.5 方案 5: WASM matmul (P2, 高收益高投入)

**原理**: 纯 JS matmul 吞吐 ~1.05 GFLOPS，受限于 V8 的 JIT 编译和 Float32Array 访问开销。WASM 可以利用 SIMD 指令，预期 5-10× 提速。

**实现路径**:
1. 用 C/Rust 实现分块矩阵乘法 + SIMD 优化
2. 编译为 WASM 模块
3. JS 侧调用 WASM matmul 替代当前 `tensor.ts:matmul()`
4. 通过 `WebAssembly.Memory` 共享 Float32Array 内存，避免拷贝

**预期效果**: 90ms → ~10-18ms (当前默认配置), 5ms → ~0.5-1ms (优化配置)

**风险**: 高。需要维护 C/Rust 构建链，增加部署复杂度。建议在方案 1-4 完成后评估是否必要。

#### 8.1.6 方案 6: int8 推理 (P3, 低优先级)

**原理**: 当前 int8 量化仅用于存储（`saveModelQuantized`），推理时仍反量化为 float32。直接用 int8 做 matmul 可以减少内存带宽需求。

**分析**: 当前 matmul 是**计算受限**（1.05 GFLOPS），不是**内存受限**。int8 推理在内存带宽受限场景下有 ~4× 提速，但在计算受限场景下收益有限（~1.5-2×）。

**结论**: 不推荐优先实施。方案 1 (配置对齐) 已经解决了根本问题。

#### 8.1.7 方案 7: Early Exit / LayerSkip (P1, 高 ROI)

> 论文: *LayerSkip: Enabling Early Exit Inference and Self-Speculative Decoding*
> 来源: Meta AI, ACL 2024, arXiv:2404.16710
> 实测: 1.82-2.16× 提速，零额外参数

**核心思想**: 训练时对浅层施加低 dropout、深层施加高 dropout，推理时在置信度足够高的中间层提前退出。简单任务走 2 层，复杂任务走 4 层。

**对 Buddy 的适用性**: 极高。当前 4 层 Encoder，如果第 2 层输出的 intent 概率已经 > 0.85，直接跳过第 3-4 层。

```typescript
// 在 EncoderBlock 循环中加入 early exit
forward(tokenIds: number[], inference = false): ModelOutput {
  let h = this.embedding.forward(tokenIds);
  if (this.config.embedDim !== this.config.hiddenDim) {
    h = matmul(h, this._projWeight!);
  }

  for (let i = 0; i < this.encoderBlocks.length; i++) {
    h = this.encoderBlocks[i].forward(h, true, inference);
    // Early Exit: 至少走 2 层，置信度足够高时提前退出
    if (inference && i >= 1) {
      const pooled = this._poolLast(h);
      const { intent } = this.heads.intentHead.forward(pooled);
      const maxProb = Math.max(...intent.data);
      if (maxProb > this.config.exitThreshold ?? 0.85) {
        break;
      }
    }
  }
  // ... 后续 output heads
}
```

**预期收益**: 简单任务 ~45ms（2 层），复杂任务 ~90ms（4 层），平均 ~1.5-2× 提速。

**改动量**: ~50 行代码 + 训练时加入 layer dropout。

**自发性**: Early Exit 需要训练时加入 layer dropout。这属于**训练方式变更**，由影子大脑（Phase 9）的进化引擎在 L3/L4 级别提出，经 A/B 验证后自动合入。推理侧的 early exit 逻辑是纯代码改动，不需要重新训练即可生效（但准确率需要训练配合）。

#### 8.1.8 方案 8: 结构化剪枝 (P2)

> 论文: *Energy-Efficient Transformer Inference: Optimization Strategies*
> 来源: arXiv:2502.16627, 2025
> 实测: L1 剪枝实现 63% 推理提速，精度退化极小

**核心思想**: 剪掉 FFN 中 L1 范数最小的神经元和注意力头中贡献最小的头。

**对 Buddy 的适用性**: 高。当前 FFN 是 256→512→256，很多神经元可能是冗余的。

```
剪枝前: FFN [256, 512] + [512, 256] = 262K 参数
剪枝后: FFN [256, 256] + [256, 256] = 131K 参数 (减少 50%)

注意力头剪枝: 4 头 → 2 头，attention 计算量减半
```

**实施步骤**:
1. 计算每个 FFN 神经元的 L1 范数（权重绝对值之和）
2. 剪掉范数最小的 50% 神经元
3. 剪掉注意力头中 attention weight 方差最小的头
4. **自发微调**: 剪枝后自动进入 `OnlineLearner` 的 observeOnly 模式，用后续交互数据恢复精度

**预期收益**: 参数量减少 30-50%，推理提速 ~1.5×，精度退化 < 2%。

**改动量**: ~100 行（剪枝工具 + 微调逻辑）。

**自发性**: 剪枝决策（剪哪些神经元/头）由影子大脑（Phase 9）的进化引擎自动生成，微调由现有 `OnlineLearner` 自动完成。整个流程无人工介入。

#### 8.1.9 方案 9: 低秩分解 (P2)

> 论文: *Lossless Model Compression via Joint Low-Rank Factorization*
> 来源: arXiv:2412.06867, 2024

**核心思想**: 将大权重矩阵分解为两个小矩阵的乘积。

**对 Buddy 的适用性**: 中高。当前 FFN 的 w1 是 [256, 512]（131K 参数），可以分解为：

```
分解前: [256, 512] = 131,072 参数, matmul [21,256]×[256,512] = 5.2ms
分解后: [256, 64] × [64, 512] = 16,384 + 32,768 = 49,152 参数
        matmul [21,256]×[256,64] + [21,64]×[64,512] = 0.65 + 1.3 = 1.95ms
```

**预期收益**: FFN 提速 ~2.7×，总提速 ~30-40%。

**改动量**: ~80 行（修改 FFN.forward() 支持分解模式）。

**自发性**: 分解方案（rank 值、哪些层分解）由影子大脑的进化引擎自动生成，分解后的微调由 `OnlineLearner` 自动完成，rank 参数通过影子大脑的 A/B 对比自动调优。

**风险**: 分解后需要微调恢复精度。rank=64 是经验值，需要实验确定最优 rank。

#### 8.1.10 方案 10: 注意力融合 (P3)

> 来源: FlashAttention V1/V2 (Tri Dao)

**核心思想**: 将 Q×K^T + mask + softmax + ×V 融合为单个 tiling 循环，避免中间矩阵的内存写入。

**对 Buddy 的适用性**: 中。当前 attention 分 5 步，每步都 `zeros()` 分配新矩阵。融合后减少 3 次内存分配。

```
当前: scores(分配) → mask(分配) → softmax(分配) → weightedSum(分配) → merge(分配)
融合: scores+mask+softmax+weightedSum(1次分配) → merge(1次分配)
```

**预期收益**: attention 部分提速 ~30-40%，但 attention 只占总时间的 3.6%，整体收益 ~1-2%。

**结论**: 优先级低，仅在其他方案完成后考虑。

#### 8.1.11 方案 11: WASM SIMD / ONNX Runtime (P3, 打破零依赖)

**来源**: TensorFlow.js WASM backend, Microsoft ONNX Runtime

**核心数据**: 纯 JS matmul ~1 GFLOPS，WASM SIMD ~5-10 GFLOPS，ONNX Runtime (MKL) ~50-100 GFLOPS。

**两种路径**:

| 路径 | 提速 | 依赖 | 工程量 |
|------|------|------|--------|
| 自写 WASM (C/Rust + SIMD) | 5-10× | 无 npm，需构建链 | 高 |
| ONNX Runtime Node.js | 50-100× | `onnxruntime-node` | 中 |
| TF.js WASM backend | 3-5× | `@tensorflow/tfjs-backend-wasm` | 低 |

**结论**: 打破"零 npm 依赖"原则，仅在方案 0-10 都无法满足时考虑。

#### 8.1 优化方案总览（完整版）

| # | 方案 | 预期收益 | 改动量 | 零依赖 | 自发性 | 优先级 | 论文/来源 |
|---|------|---------|--------|--------|--------|--------|----------|
| 0 | 默认配置对齐文档 | 90ms → ~5ms | 改配置 | ✅ | — | **P0** | — |
| 1 | 推理模式跳过反向缓存 | ~5-10% | ~30 行 | ✅ | — | P1 | — |
| 2 | Tensor 对象池化 | 减少 GC | ~150 行 | ✅ | — | P1 | — |
| 3 | 融合算子 | ~5-10% | ~100 行 | ✅ | — | P2 | — |
| 4 | WASM matmul | 5-10× | 高 | ❌ | — | P2 | — |
| 5 | int8 推理 | ~1.5-2× | ~200 行 | ✅ | — | P3 | — |
| 6 | **Early Exit** | **1.5-2×** | **~50 行** | ✅ | 影子大脑驱动 | **P1** | ACL 2024, Meta |
| 7 | **结构化剪枝** | **1.5×** | ~100 行 | ✅ | 影子大脑+OnlineLearner | P2 | arXiv 2025 |
| 8 | **低秩分解** | **1.3-1.5×** | ~80 行 | ✅ | 影子大脑+OnlineLearner | P2 | arXiv 2024 |
| 9 | 注意力融合 | ~1-2% | 中 | ✅ | — | P3 | FlashAttention |
| 10 | WASM/ONNX | 5-100× | 大 | ❌ | — | P3 | TF.js / MS |

**最佳组合（零依赖 + 全自发）**: 方案 0 + 6 + 7 = 配置对齐 + Early Exit + 剪枝 → 预期 **90ms → 2-3ms**。

#### 8.2 持续调优（模型质量）

| 任务 | 优先级 | 模块 |
|------|--------|------|
| 右脑模型精度调优（loss 权重、学习率、batch size） | P0 | 右脑 |
| 蒸馏管线调优（教师数据质量、蒸馏频率） | P0 | 右脑 |
| 多模态训练收敛验证（5 个 head 联合训练） | P0 | 右脑 |
| 用真实 LLM 反馈验证学习收敛（替代随机标签测试） | P0 | 右脑 |
| 规则蒸馏效果验证 | P1 | 左脑 |
| PID 参数调优（Kp, Ki, Kd） | P1 | 小脑 |
| 习惯缓存命中率调优（minHits、fingerprint 粒度） | P1 | 小脑 |
| 节律参数调优（负载阈值、调节系数） | P1 | 小脑 |
| 错误阈值收敛速度调优（衰减率、上下限） | P2 | 小脑 |
| Spatial Head 精度调优（坐标 bins 粒度） | P2 | 右脑 |
| Scene Head 拓扑复杂度调优（最大节点数） | P2 | 右脑 |
| World Model 预测步长调优 | P2 | 右脑 |
| 序列模式挖掘（PrefixSpan） | P2 | 左脑 |
| Contextual Thompson Sampling 升级 | P2 | 左脑 |
| 渐进式知识图谱（ExperienceGraph + MemoryStore 统一图结构） | P2 | 全局 |
| 自对弈验证模块化（独立 SelfPlayVerifier） | P2 | 左脑+右脑 |
| 信号汇聚层调优（Sink 权重、去重策略、质量门槛） | P2 | 汇聚层 |
| 反事实样本质量验证（A/B 测试反事实 vs 纯事实训练） | P3 | 右脑 |
| 前端可视化（三脑状态面板 + 自适应指标 + 场景表征） | P3 | 全局 |

#### 8.3 性能优化实施计划

| Phase | 内容 | 天数 | 预期收益 | 自发性 |
|-------|------|------|----------|--------|
| 8.1.1 | 默认配置对齐文档 | 0.5 天 | 90ms → 5ms | — |
| 8.1.2 | 推理模式跳过反向缓存 | 1 天 | 5-10% | — |
| 8.1.3 | Tensor 对象池化 | 1 天 | 训练 GC 减少 60% | — |
| 8.1.4 | 融合算子 | 1 天 | 5-8% | — |
| 8.1.7 | Early Exit (LayerSkip) | 2 天 | 1.5-2× 提速 | 影子大脑 L3 驱动 |
| 8.1.8 | 结构化剪枝 | 2 天 | 1.5× 提速 | 影子大脑 + OnlineLearner |
| 8.1.9 | 低秩分解 | 1 天 | 1.3-1.5× 提速 | 影子大脑 + OnlineLearner |
| 8.1.5 | WASM matmul (可选) | 3-5 天 | 5-10× 提速 | — |
| 8.1.10 | 注意力融合 (可选) | 1 天 | ~1-2% 提速 | — |
| 8.2 | 模型质量调优 | 持续 | 准确率提升 | 在线学习 + 蒸馏 |

**建议执行顺序**: 8.1.1 → 8.1.7 → 8.1.8 → 8.1.2 → 8.1.3 → 8.1.9 → 其余

---

## 八、文件映射（旧 → 新）

| 旧模块 | 新位置 | 操作 |
|--------|--------|------|
| `agent.ts:decideCollaboration()` | `brain/left/rule-engine.ts` | 迁移为 Rule 对象 |
| `agent.ts:orchestrate()` | `brain/left/index.ts` | 重写，接入三脑 |
| `core/model-pool-scheduler.ts` | `brain/left/scheduler.ts` | 迁移 |
| `core/model-router.ts` | `brain/left/scheduler.ts` | 合并 |
| `core/decision-recorder.ts` | `brain/left/decision-memory.ts` | 迁移+扩展 |
| `intelligence/experience-router.ts` | `brain/left/scheduler.ts` | 合并 |
| `intelligence/experience-evolver.ts` | `brain/right/` (训练信号) | 提供反馈数据 |
| `core/intent-classifier.ts` | 右脑 IntuitionNet 替代 | 逐步废弃 |
| `emotion/engine.ts` | `brain/cerebellum/body-state.ts` | 被 BodyStateManager 包装 |
| `desire/engine.ts` | `brain/cerebellum/body-state.ts` | 被 BodyStateManager 包装 |
| `core/fusion-buffer.ts` | `brain/cerebellum/sensor-fusion.ts` | 迁移 |
| `perception/event-bus.ts` | `brain/cerebellum/sensor-fusion.ts` | 迁移 |
| `behavior/idle.ts` | `brain/cerebellum/motor-control.ts` | 迁移 |
| `core/proactive-engine.ts` | `brain/cerebellum/motor-control.ts` | 迁移 |
| `core/buddy-clock.ts` | `brain/cerebellum/motor-control.ts` | 迁移 |
| BuddyClock 参数调节 | `brain/cerebellum/adaptive/rhythm.ts` | 新增：节律自适配 |
| 决策链路缓存 | `brain/cerebellum/adaptive/habit.ts` | 新增：肌肉记忆 |
| 错误阈值调节 | `brain/cerebellum/adaptive/error-tuner.ts` | 新增：错误反射弱化/强化 |
| 自适应统一入口 | `brain/cerebellum/adaptive/index.ts` | 新增：导出三层自适应模块 |
| 空间编码器 | `brain/right/features/spatial-encoder.ts` | 新增：CoordConv 坐标编码 |
| 图像编码器 | `brain/right/features/image-encoder.ts` | 新增：ViT patch embedding |
| 场景编码器 | `brain/right/features/scene-encoder.ts` | 新增：Slot Attention + scene graph |
| 世界模型 | `brain/right/nn/world-model.ts` | 新增：潜空间想象 + 预测 |
| 信号汇聚层 | `brain/convergence/index.ts` | 新增：打通外围通道→右脑训练 |
| 纠正信号接收 | `brain/convergence/feedback-sink.ts` | 新增：FeedbackLearner→TrainingSample |
| 知识信号接收 | `brain/convergence/knowledge-sink.ts` | 新增：BuddyLearn→TrainingSample |
| 推理链接收 | `brain/convergence/reasoning-sink.ts` | 新增：ReasoningChain→TrainingSample |
| 进化信号接收 | `brain/convergence/evolution-sink.ts` | 新增：ExperienceEvolver→TrainingSample |
| 信号优先级 | `brain/convergence/prioritizer.ts` | 新增：优先级排序+去重 |
| `feedback/learner.ts` | `brain/convergence/feedback-sink.ts` | 桥接：applyCorrection() 调用汇聚层 |
| `knowledge/learn.ts` | `brain/convergence/knowledge-sink.ts` | 桥接：learnFrom*() 调用汇聚层 |
| `memory/reasoning-chain.ts` | `brain/convergence/reasoning-sink.ts` | 桥接：conclude() 调用汇聚层 |
| `intelligence/experience-evolver.ts` | `brain/convergence/evolution-sink.ts` | 桥接：hypothesize() 调用汇聚层 |

---

## 九、度量指标

| 指标 | 目标 | 现状 (2026-05-01) | 测量方式 |
|------|------|-------------------|----------|
| 右脑推理延迟 | < 5ms（300K 参数，纯 CPU） | ⚠️ **89.6ms**（3M 参数默认配置） | 基准测试 |
| 右脑模型大小 | < 500KB（int8 量化后） | ⚠️ **~3MB**（3M 参数 int8） | 文件大小 |
| 右脑意图分类准确率 | > 85%（vs IntentClassifier 关键词匹配） | 未测 | A/B 测试 |
| 右脑在线学习收敛 | 100 次交互后准确率提升 > 10% | ⚠️ 未收敛（随机标签，预期行为） | 学习曲线 |
| 右脑防遗忘率 | 旧任务退化 < 5% | 未测 | 验证集对比 |
| 左脑决策延迟 | < 5ms（纯规则 + 调度） | ✅ **0.002ms** | 计时 |
| 左脑策略蒸馏产出 | 每周 ≥ 3 条新规则 | 未测 | 统计 |
| 小脑稳态调节延迟 | < 1ms（纯数值 PID） | ✅ **0.009ms** | 计时 |
| 小脑调节频率 | 每小时 ≤ 5 次 | 未测 | 统计 |
| 小脑习惯缓存命中率 | > 40%（稳态后） | 未测 | 统计 |
| 小脑节律调节响应 | 负载变化后 1 分钟内适配 | 未测 | 计时 |
| 小脑错误阈值收敛 | 100 次同类异常后 suppressionFactor < 0.3 | 未测 | 统计 |
| 右脑空间编码精度 | 坐标预测误差 < 5% 网格宽度 | 未测 | 验证集 |
| 右脑场景拓扑准确率 | 节点关系预测 > 70% | 未测 | A/B 测试 |
| 右脑世界模型预测一致性 | 3 步预测偏差 < 10% | 未测 | 余弦相似度 |
| 右脑多模态推理延迟 | < 20ms（2.5M 参数，int8，纯 CPU） | 未测 | 基准测试 |
| 右脑模型大小 | < 3MB（int8 量化后） | 未测 | 文件大小 |
| 三脑总决策延迟 | < 10ms（不含 LLM 调用） | ⚠️ **89.6ms** | 端到端计时 |
| 信号汇聚延迟 | < 1ms（样本转换 + 写入 Buffer） | 未测 | 计时 |
| 纠正样本注入率 | > 90% 的用户纠正被转为训练样本 | 未测 | 统计 |
| 知识样本注入率 | > 80% 的学习内容被转为训练样本 | 未测 | 统计 |
| 反事实样本倍增率 | 每次交互平均产生 > 2 个样本（含反事实） | 未测 | 统计 |
| 元认知降级率 | 高不确定性时 100% 走 LLM 路径 | 未测 | 统计 |
| 课程学习收敛加速 | 比随机采样快 > 30% | 未测 | 学习曲线对比 |
| 自对弈触发率 | 高不确定性时 100% 触发内部质疑 | 未测 | 统计 |

> **性能基线注释**: 89.6ms 延迟的 97.6% 来自 4 层 Encoder Block 的 matmul 运算。
> 根因是 DEFAULT_CONFIG (4层,256d,3M 参数) 与文档目标 (2层,128d,300K 参数) 不一致。
> 修复配置后预期延迟降至 ~5ms。详见 §Phase 8 性能优化方案。

---

## 十、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 手写 NN 数值不稳定 | 推理结果错误 | 单元测试覆盖每一层，与 PyTorch 对比验证 |
| 在线学习不收敛 | 右脑越学越差 | 学习率调度 + LPR 防遗忘 + 回滚机制 |
| 三脑信号冲突 | 决策震荡 | 明确优先级：小脑 > 左脑规则 > 右脑直觉 |
| 旧代码迁移遗漏 | 功能回归 | 逐模块迁移，每模块对应测试 |
| 模型权重文件损坏 | 推理崩溃 | 校验和 + 自动回滚到上一个好权重 |
| 习惯缓存决策漂移 | 缓存决策过时导致质量下降 | 成功率实时监控 + 自动降级到完整链路 |
| 节律调节振荡 | 心跳频率来回跳动 | 滑动窗口平滑 + 调节幅度上限 |
| 错误阈值过度弱化 | 真实异常被忽略 | suppressionFactor 下限 0.1 + 致命错误永远不弱化 |
| 多模态训练不收敛 | 新 head 无法学习 | 先冻结 backbone，只训新 head；分层学习率 |
| 视觉 token 淹没文本 token | 注意力被图片 patch 主导 | Attention mask 隔离模态 + 可调节权重 |
| 2.5M 参数在线学习变慢 | 更新延迟增大 | 分层学习率：新 head 快、backbone 慢 |
| 模型扩大后灾难性遗忘 | 旧能力退化 | LPR λ 随参数量线性增大 |
| 场景编码器计算开销 | Slot Attention 迭代耗时 | 限制 slot 数量（K≤8）+ 提前退出 |
| 信号汇聚噪声放大 | 低质量外部信号污染 ReplayBuffer | 优先级加权 + 去重 + 质量门槛 |
| 纠正样本过拟合 | 权重×3 导致模型过度适应个别纠正 | 纠正样本数量上限 + 定期衰减权重 |
| 反事实样本失真 | 推断的替代结果与真实不符 | 反事实权重限制在 0.5 + 只用高置信度历史 |
| 元认知过度保守 | quality 阈值太高导致大部分任务都走 LLM | 阈值可调 + A/B 测试验证 |
| 课程学习进度误判 | progress 计算不准导致跳过有用样本 | 前 100 步强制全量采样作为热身 |
| 自对弈延迟开销 | 内部质疑增加决策时间 | 只在 quality < 0.5 且 confidence < 0.6 时触发 |

---

## 十一、影子大脑：自我迭代基础设施（Phase 9）

> 详细实施方案见 → [`SHADOW_BRAIN_EVOLUTION.md`](./SHADOW_BRAIN_EVOLUTION.md)

三脑架构的自进化目前局限于**能力空间内的优化**（权重微调、规则提炼、参数自调），无法扩展能力边界。影子大脑引入"沙箱试进化 + 安全锁验证 + 灰度合入"机制，让系统在不破坏线上稳定性的前提下，自主生成并验证新能力。

**核心组件**：
- **影子大脑**：线上三脑的完整副本，在隔离环境中运行候选进化方案
- **迭代时机控制器**：判断何时适合执行进化（负载/样本量/稳定性/时间窗口）
- **进化锁**：四道防线——目标漂移检测（GDI）、约束保护（CPS）、回归风险评估、人工审批
- **状态管理**：版本存档、进化日志、能力图谱、收敛追踪

**论文基础**：Darwin Gödel Machine（自改进 + 沙箱验证）、DGM-Hyperagents（元认知自修改）、SAHOO 框架（进化安全锁）、Group-Evolving Agents（经验共享进化）
