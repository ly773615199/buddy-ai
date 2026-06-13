# Buddy 自研清单 — 种子即大脑

> 生成时间：2026-05-14
> 基于：全量代码审计 + 核心哲学对齐 + 底座基因分析
> 当前版本：0363a2b

---

## 核心理念

**种子就是三脑的语言中枢。它不是外挂的 LM，不是独立的模块——它是大脑的一部分，和三脑共享记忆、共享训练、共享成长。视觉和听觉是它长出的感官，不是额外的模型。**

```
┌──────────────────────────────────────────────┐
│                    三脑                        │
│                                              │
│  ┌────────┐   ┌────────┐   ┌────────┐       │
│  │ 左脑   │   │ 右脑   │   │ 小脑   │       │
│  │ 规则   │   │  NN    │   │ 稳态   │       │
│  └───┬────┘   └───┬────┘   └───┬────┘       │
│      │            │            │             │
│      └────────────┼────────────┘             │
│                   ↓                          │
│  ┌────────────────────────────────────┐      │
│  │          信号汇聚层                 │      │
│  │  ┌──────────────────────────────┐  │      │
│  │  │      语言核心 (种子)          │  │      │
│  │  │                              │  │      │
│  │  │   Qwen2.5-1.5B              │  │      │
│  │  │   + 适配器 (domain_*)        │  │      │
│  │  │   + 视觉 ←── 长出来的感官    │  │      │
│  │  │   + 听觉 ←── 长出来的感官    │  │      │
│  │  │                              │  │      │
│  │  │   共享：记忆 / 训练 / 成长    │  │      │
│  │  └──────────────────────────────┘  │      │
│  └────────────────────────────────────┘      │
│                                              │
│  三脑和种子没有边界，是一个整体。              │
└──────────────────────────────────────────────┘
```

---

## 一、自研清单

### 底座：站在巨人肩上

| 组件 | 选择 | 理由 |
|---|---|---|
| 底座模型 | Qwen2.5-1.5B | 小、可蒸馏、可增量训练、Tokenizer 稳定 |
| Tokenizer | Qwen 的 32K 词表 | 和底座配套，蒸馏时 token 对齐 |
| 推理引擎 | llama.cpp (Node binding) | 直接加载 GGUF 到进程内 |
| Vision Encoder | SigLIP（开源） | 和 Qwen-VL 兼容 |
| Audio Encoder | Whisper（开源） | 成熟方案 |

**为什么是 Qwen2.5-1.5B 而不是 Qwen3-1.7B：**

| 维度 | Qwen2.5-1.5B | Qwen3-1.7B | 对成长的影响 |
|---|---|---|---|
| Tokenizer | 32K | 151K | ⚠️ Qwen3 词表变大，蒸馏管线要重写 |
| Thinking mode | 无 | 有 | ⚠️ 三脑的审议委员会已做"思考"，种子再思考会冲突 |
| 训练成本 | 基准 | +13% 参数 | 每次梦境训练更慢 |
| 收益 | 基准 | 略强 | 对种子来说"能长"比"聪明"重要 |

**底座选择的原则：不是选最强的，是选最能在三脑里活起来、长起来的。**

### 接口：长在自己身上

| 组件 | 代码位置 | 代码量 | 状态 | 说明 |
|---|---|---|---|---|
| **三脑-种子接口** | `brain/brain.ts` + `brain/shadow/types.ts` | 24,311 行 (整个 brain/) | ✅ | BrainProvider 14 个方法，三脑数据全部暴露给种子 |
| **信号汇聚层** | `brain/convergence/` | 655 行 | ✅ | 4 Sink → 优先级 → ReplayBuffer → 训练 |
| **适配器训练框架** | `brain/right/training/` + `ternary/` | 6,693 行 | ⚠️ 需补强 | 在线学习 + t-SignSGD，缺 LR scheduler |
| **适配器管理** | `ternary/manager.ts` + `tools/ternary-expert.ts` | 1,158 行 | ✅ | 按需加载/卸载/路由/成熟度过滤 |

### 适配器：用自己的血肉养成

| 组件 | 代码位置 | 代码量 | 状态 | 说明 |
|---|---|---|---|---|
| **成长系统** | `ternary/growth.ts` + `ternary/scheduler.ts` | 480 行 | ✅ | seed→sprout→growing→trainable→mature |
| **梦境巩固集成** | `memory/dream.ts` + `core/dream-ternary.ts` | 703 行 | ✅ | 四阶段：回放→提取→关联→修剪 |

---

## 二、种子如何成为大脑的一部分

### 1. 共享记忆

种子不是独立的模型，它读写三脑的记忆：

```
用户说了一句话
    ↓
ThreeBrain.decide()
    ↓
小脑感知 → 右脑直觉 → 左脑规则 → 种子生成
    ↓
ThreeBrain.feedback()
    ↓
左脑记录决策 → 右脑在线学习 → 小脑调节稳态 → 影子大脑检测缺口
    ↓
所有记忆写入同一个 STMP 时空宫殿
```

**代码证据：**
- `brain.ts:164` — `getRules: () => this.left.getRules()` — 种子读左脑的规则
- `brain.ts:170` — `getNNWeights: () => this.right.getNNWeights()` — 种子读右脑的权重
- `brain.ts:178` — `cloneBrainState` — 种子深拷贝整个三脑状态
- `brain.ts:324` — `this.right.learnFromOutcome(...)` — 执行结果反馈给右脑在线学习

### 2. 共享训练

三脑的训练数据来自同一个信号汇聚层：

```
用户纠正 → FeedbackSink ──┐
知识学习 → KnowledgeSink ──┤
推理链   → ReasoningSink ──┼→ SignalConvergenceLayer → ReplayBuffer → 右脑训练
进化信号 → EvolutionSink ──┘                                    → 三进制训练
```

**代码证据：**
- `subsystems.ts:896` — `convergenceLayer.ingestFeedback(signal)`
- `subsystems.ts:901` — `convergenceLayer.ingestKnowledge(signal)`
- `subsystems.ts:906` — `convergenceLayer.ingestEvolution(signal)`
- `agent.ts:147` — `convergenceLayer.ingestReasoning(signal)`

**同一个 ReplayBuffer 同时喂给右脑 NN 和三进制引擎，不是两套独立的数据管线。**

### 3. 共享成长

三脑和种子同步成长：

```
每次交互
    ↓
ThreeBrain.feedback() → 决策计数器 +1
    ↓
每 100 次决策 → 自动触发策略蒸馏（左脑规则更新）
    ↓
梦境巩固 → DreamEngine.dream() → 回放/提取/关联/修剪
    ↓
tryTernaryTrain() → 三进制增量训练
    ↓
TernaryGrowth.evaluateGrowth() → 成长阶段评估
    ↓
影子大脑 → 缺口检测 → 进化触发
```

**代码证据：**
- `brain.ts:345` — `this.decisionCount++` — 每次决策计数
- `brain.ts:347` — `if (this.decisionCount % this.DISTILL_INTERVAL === 0)` — 每 100 次自动蒸馏
- `dream-ternary.ts:29` — `tryDream()` — 梦境触发
- `dream-ternary.ts:72` — `tryTernaryTrain()` — 梦境后自动训练
- `growth.ts` — `evaluateGrowth()` — 训练后评估成长阶段

### 4. 视觉和听觉是长出的感官

感官不是外挂模型，输出直接注入三脑的决策流：

```
截图/摄像头/用户图片
    ↓
ThreeBrain.injectImage(image)
    ↓
ThreeBrain.decide() → buildMultimodalContext()
    ↓
pendingImage → ImageEncoder → token IDs (450-549)
    ↓
右脑.predict() — 带多模态上下文的直觉预测
    ↓
左脑.decide() — 规则 + 直觉 + 多模态感知 → 执行计划
```

**代码证据：**
- `brain.ts:121` — `injectScreenshot()` — 截图注入
- `brain.ts:134` — `injectVideoFrame()` — 视频帧注入
- `brain.ts:142` — `injectImage()` — 用户图片注入
- `brain.ts:460` — `buildMultimodalContext()` — 自动构建多模态上下文

**图像变成 token IDs 后，和文本 token 混在一起，由同一个 Transformer 处理。**

---

## 三、当前问题：种子还是外挂的

**现状：种子通过 Ollama API 外部调用，不是三脑的一部分。**

```
当前（外挂）：
  Buddy 进程 ──HTTP──→ Ollama 进程 ──→ Qwen2.5-1.5B
                              ↓
                         返回文本
                              ↓
  Buddy 进程 ←────────────────┘

问题：
  - 种子不在三脑进程内，无法共享 KV Cache
  - 训练要走 HTTP，延迟高
  - 种子无法被三脑的训练直接更新权重
  - 成长阶段管理断层
```

**目标：种子加载到三脑进程内，原生参与推理和训练。**

```
目标（原生）：
  Buddy 进程
    ├── 三脑（左脑 + 右脑 + 小脑）
    ├── 种子（Qwen2.5-1.5B GGUF，进程内加载）
    ├── 共享 KV Cache
    ├── 共享训练数据（同一个 ReplayBuffer）
    ├── 共享成长阶段（同一个 TernaryGrowth）
    └── 感官（视觉/听觉直接注入 token 序列）
```

---

## 四、改进计划

### Phase 1: 种子原生化（3-5 天）★ 最高优先级

让种子从"外挂 API"变成"三脑进程内的语言中枢"。

| 任务 | 文件 | 说明 |
|---|---|---|
| 种子加载器 | 新建 `src/seed/loader.ts` | 用 llama.cpp Node binding 加载 GGUF 到进程内 |
| 种子推理接口 | 新建 `src/seed/inference.ts` | 替换 Ollama API，进程内 forward() |
| 种子训练接口 | 新建 `src/seed/trainer.ts` | t-SignSGD 直接更新种子权重 |
| 三脑集成 | 修改 `src/core/subsystems.ts` | 种子作为子系统初始化 |
| Ollama 降级 | 修改 `src/core/llm.ts` | 种子不可用时降级到 Ollama |

**验收标准：**
- `BuddyAgent` 初始化时种子模型自动加载到进程内
- `decide()` 时种子直接参与推理，不走 HTTP
- `feedback()` 时种子权重被直接更新
- 种子不可用时自动降级到 Ollama API

### Phase 2: 训练稳定性（1-2 天）

| 任务 | 文件 | 说明 |
|---|---|---|
| LR Scheduler | `ternary/optimizer.ts` | 余弦退火，~15 行 |
| STE 梯度模式 | `ternary/optimizer.ts` | 保留梯度幅度，~20 行 |
| 收敛性测试 | `ternary/trainer.test.ts` | 回归测试，~50 行 |

### Phase 3: 蒸馏闭环（2-3 天）

| 任务 | 文件 | 说明 |
|---|---|---|
| 进程内蒸馏 | `src/seed/distill.ts` | 种子加载器内直接蒸馏，不走 HTTP |
| 蒸馏 → 训练管线 | `ternary/distill.ts` | 端到端 |
| 领域专家路由 | `tools/ternary-expert.ts` | 自动注册 |

### Phase 4: 感官生长（3-5 天）

| 任务 | 说明 |
|---|---|
| 视觉接入 | SigLIP ONNX → injectImage() → buildMultimodalContext() |
| 听觉接入 | whisper.cpp → 文本 → 种子上下文 |
| 右脑 NN 验证 | PyTorch 交叉验证 autograd |

### Phase 5: 生产化（持续）

| 任务 | 说明 |
|---|---|
| .ta 格式版本化 | 向前兼容 |
| 模型商店 | 分享/安装/版本管理 |
| 性能基准 CI | 回归检测 |

---

## 五、验证摘要

| 验证维度 | 结果 | 说明 |
|---|---|---|
| 种子与三脑共享记忆 | ✅ | BrainProvider 14 个方法暴露三脑数据 |
| 种子与三脑共享训练 | ✅ | 4 Sink → 同一个 ReplayBuffer |
| 种子与三脑共享成长 | ✅ | 决策计数 → 蒸馏 → 梦境 → 训练 → 成长评估 |
| 视觉是长出的感官 | ✅ | injectImage → buildMultimodalContext → 右脑 predict |
| 听觉是长出的感官 | ⚠️ | 接口在，需接 whisper.cpp |
| 三进制引擎数学正确 | ✅ | 36 项测试，35 通过 |
| 三进制推理性能 | ✅ | 768d 模型 1.92ms/tok |
| 三进制训练收敛 | ⚠️ | 需加 LR scheduler + STE |
| 种子原生化 | ❌ | 当前走 Ollama API，需改为进程内加载 |

---

## 六、自研 vs 开源边界

```
开源（不碰）                自研（核心壁垒）
────────────                ──────────────
Qwen2.5-1.5B 底座          三脑-种子接口
llama.cpp 推理              种子原生加载器（进程内）
SigLIP 视觉                信号汇聚层
Whisper 听觉                适配器训练框架
                            适配器管理
                            成长系统
                            梦境巩固集成
```

**底座用开源，接口自研。开源提供能力，自研提供结构。种子原生长在三脑里。**

---

## 七、里程碑

| 里程碑 | 目标 | 时间 |
|---|---|---|
| **M1** | 种子原生化（进程内加载 + 推理 + 训练） | 05-19 |
| **M2** | 训练稳定（LR + STE + 收敛测试） | 05-21 |
| **M3** | 蒸馏闭环（进程内蒸馏 → 训练 → .ta） | 05-24 |
| **M4** | 领域专家可回答问题 | 05-27 |
| **M5** | 视觉+听觉长入三脑 | 06-01 |
| **M6** | 生产就绪 | 06-05 |
