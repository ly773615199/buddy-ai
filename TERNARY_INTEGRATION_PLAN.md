# Buddy 核心模块集成激活计划

> 生成时间：2026-04-22
> 最后更新：2026-04-22（代码核销 + 前端接入完成）
> 基于：全量代码审计 + DEVELOPMENT_MASTER_PLAN.md + TERNARY_DEV_PLAN.md + JOINT_DEV_PLAN.md + 实际代码对比

---

## 一、架构全景：三进制是 Buddy 的最终成果

三进制微模型不是"可选附加功能"，而是 Buddy 产品定义的核心终点之一：

```
用户日常对话
    ↓
知识提取 (extractor.ts) ✅ 已运行
    ↓
STMP 存储 (stmp.ts) ✅ 已运行
    ↓
领域画像成长 (cognitive/engine.ts) ✅ 已运行
    ↓
┌──────────────────────────────────────────────────────┐
│                  知识变现三条路                        │
│                                                      │
│  ① Prompt 注入 (即时可用)     ✅ prompt-injector 已接入│
│  ② 训练数据导出 (JSONL)      ✅ /export-training 可用  │
│  ③ 三进制微模型 (最终形态)    ❌ 代码写了但未接入       │
│                                                      │
└──────────────────────────────────────────────────────┘
    ↓
三进制本地推理 → 不依赖外部 API 的领域专家
```

**三进制让 Buddy 从"有脸的 ChatGPT"变成"真正属于你的 AI"——越用越聪明，最终脱离云端。**

---

## 二、代码完成度 vs 集成度对照

### 已写代码 + 已集成（正常运行）

| 模块 | 文件 | 集成位置 | 状态 |
|---|---|---|---|
| 知识提取 | `knowledge/extractor.ts` | `message-processor.ts` 自动调用 | ✅ |
| STMP 记忆宫殿 | `memory/stmp.ts` | `subsystems.ts` 初始化 | ✅ |
| 领域画像 | `cognitive/engine.ts` | `subsystems.ts` 初始化 | ✅ |
| Prompt 注入 | `intelligence/prompt-injector.ts` | `message-processor.ts` buildContext | ✅ |
| 经验模型引擎 | `intelligence/index.ts` | `subsystems.ts` 初始化 | ✅ |
| 知识采访官 | `intelligence/knowledge-interviewer.ts` | `subsystems.ts` + `message-processor.ts` | ✅ |
| LoRA 服务 | `lora/service.ts` | `subsystems.ts` 初始化（默认禁用） | ✅ |
| 训练数据导出 | `intelligence/training-exporter.ts` | CLI `/export-training` 命令 | ✅ |
| 梦境巩固 | `memory/dream.ts` | `subsystems.ts` 初始化 | ✅ |
| 能力包系统 | `skills/*.ts` | `subsystems.ts` 初始化 | ✅ |
| **三进制核心** | `src/ternary/` 20 文件 | `subsystems.ts` 初始化 + 工具注册 | ✅ |
| **三进制工具** | `tools/ternary-expert.ts` | `ALL_TOOLS` + `createTernaryTools` | ✅ |
| **数据扩增器** | `intelligence/data-augmentor.ts` | `subsystems.ts` + `training-exporter.ts` | ✅ |
| **商城安装器** | `shop/installer.ts` | `subsystems.ts` + REST API | ✅ |
| **三进制调度器** | `ternary/scheduler.ts` | `subsystems.ts` + 心跳 `tryTernaryTrain` | ✅ |
| **WS 事件** | `ws-handler.ts` | `ternary_train_complete` 已推送 | ✅ |
| **REST API** | `ws-handler.ts` | `GET /api/ternary/models` + install/uninstall | ✅ |
| **前端专家商城** | `frontend/Experts.tsx` | 真实 API 对接 + WS 实时更新 | ✅ |
| **前端训练进度** | `frontend/useWebSocket.ts` | `trainProgress` 状态 + 事件处理 | ✅ |
| **前端推理标注** | `frontend/MessageBubble.tsx` | `ternarySource` 标注 | ✅ |

### ~~已写代码 + 未集成（死代码）~~ → 全部已集成

| 模块 | 文件数 | 代码量 | ~~被引用~~ | ~~集成缺失~~ | 当前状态 |
|---|---|---|---|---|---|
| **三进制核心** | `src/ternary/` 20 文件 | 6,355 行 | ✅ subsystems.ts 初始化 | ~~❌~~ | ✅ 已集成 |
| **三进制工具** | `tools/ternary-expert.ts` | ~240 行 | ✅ createTernaryTools | ~~❌~~ | ✅ 已注册到 ALL_TOOLS |
| **数据扩增器** | `intelligence/data-augmentor.ts` | ~260 行 | ✅ subsystems.ts | ~~❌~~ | ✅ 已初始化 + LLM caller 已注入 |
| **商城安装器** | `shop/installer.ts` | ~60 行 | ✅ subsystems.ts + REST API | ~~❌~~ | ✅ 已接入 |

### 代码完成度 vs 集成度总结

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  知识积累管道:  ██████████████████████ 100% ✅ 全链路运行    │
│  Prompt 注入:   ██████████████████████ 100% ✅ 已接入对话    │
│  经验模型:      ██████████████████████ 100% ✅ 已接入对话    │
│  知识采访官:    ██████████████████████ 100% ✅ 已接入对话    │
│  训练数据导出:  ██████████████████████ 100% ✅ CLI 可用      │
│                                                             │
│  三进制格式:    ██████████████████████ 100% ✅ 已集成        │
│  三进制推理:    ██████████████████████ 100% ✅ 已集成        │
│  三进制训练:    ██████████████████████ 100% ✅ 已集成        │
│  三进制蒸馏:    ██████████████████████ 100% ✅ 已集成        │
│  数据扩增器:    ██████████████████████ 100% ✅ 已集成        │
│  REST API:      ██████████████████████ 100% ✅ 已集成        │
│  前端专家商城:  ██████████████████████ 100% ✅ 已集成        │
│  前端训练进度:  ██████████████████████ 100% ✅ 已集成        │
│  前端推理标注:  ██████████████████████ 100% ✅ 已集成        │
│                                                             │
│  结论: 后端 + 前端全部集成完成                               │
│  剩余: 依赖安装 + TypeScript 编译验证 + 正反馈闭环微调       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、集成计划

### 总体目标

将已写完的 6,600+ 行死代码激活，打通"对话 → 知识积累 → 三进制训练 → 本地推理"全链路。

### Phase 0：数据扩增器接入（0.5 天）

> `DataAugmentor` 已写完但从未被调用。接入后 1 条知识 → 5+ 条训练样本。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 0.1 | Subsystems 初始化 DataAugmentor | `core/subsystems.ts` | `this.dataAugmentor = new DataAugncoder(this.stmp, ...)` |
| 0.2 | 注入 LLM 调用器 | `core/subsystems.ts` | `this.dataAugmentor.setLLMCaller(callLLMMessages)` |
| 0.3 | TrainingExporter 集成扩增 | `intelligence/training-exporter.ts` | 导出时自动调用 augumentor 扩增样本 |
| 0.4 | Agent 暴露接口 | `core/agent.ts` | `getDataAugmentor()` |

### Phase 1：三进制管理器 + 推理引擎接入（1 天）

> 核心：让 Buddy 启动时扫描本地 .ta 模型，用户可用三进制推理。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 1.1 | Subsystems 初始化 TernaryModelManager | `core/subsystems.ts` | 扫描 `~/.buddy/models/` |
| 1.2 | Subsystems 初始化 TernaryEngine（懒加载） | `core/subsystems.ts` | 不启动时加载模型，用时再 load |
| 1.3 | 注册 ternary_expert_query 工具 | `tools/builtin.ts` 或独立文件 | 按领域路由到对应引擎 |
| 1.4 | 工具加入 ALL_TOOLS | `tools/builtin.ts` | `ALL_TOOLS` 数组 |
| 1.5 | Agent 暴露管理接口 | `core/agent.ts` | `getTernaryManager()`, `getTernaryEngine()` |
| 1.6 | CLI `/models` 命令 | `main.ts` | 列出本地三进制模型 |

### Phase 2：三进制调度器 + 心跳集成（1 天）

> 核心：夜间自动增量训练。用户睡觉时模型在"长肉"。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 2.1 | Subsystems 初始化 TernaryScheduler | `core/subsystems.ts` | 注入 manager + trainer + stmp |
| 2.2 | 心跳触发 checkAndTrain | `HEARTBEAT.md` 逻辑或 `behavior/idle.ts` | 空闲时段自动检查 |
| 2.3 | 训练前置：STMP → TrainingDataset | `ternary/trainer.ts` | 对接已有 STMP 数据 |
| 2.4 | 训练完成后通知前端 | WS 事件 `ternary_train_complete` | `types.ts` WSEvent 新增 |
| 2.5 | CLI `/train-ternary <domain>` | `main.ts` | 手动触发训练 |
| 2.6 | CLI `/train-ternary-status` | `main.ts` | 查看训练状态 |

### Phase 3：商城安装器接入（0.5 天）

> `shop/installer.ts` 已写完但未接入。三进制模型可通过商城安装。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 3.1 | Subsystems 初始化 ModelInstaller | `core/subsystems.ts` | 注入 manager |
| 3.2 | ShopCatalog 增加三进制模型商品类型 | `shop/catalog.ts` | ExpertModelListing |
| 3.3 | CLI `/install-model <domain>` | `main.ts` | 安装三进制专家模型 |
| 3.4 | 商城列表展示三进制模型 | `main.ts` `/shop` | 标注体积/精度/阶段 |

### Phase 4：前端展示 + 交互（2 天）

> 让用户在前端看到三进制模型状态、训练进度、推理结果。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 4.1 | WS 事件：三进制模型列表 | `ws/server.ts` | `ternary_models` 事件 |
| 4.2 | WS 事件：训练进度 | `ws/server.ts` | `ternary_train_progress` 事件 |
| 4.3 | WS 事件：推理结果 | `ws/server.ts` | `ternary_inference_result` 事件 |
| 4.4 | Experts 组件展示三进制模型 | `components/Experts.tsx` | 模型卡片/精度/体积/阶段 |
| 4.5 | 训练进度条 | `components/Experts.tsx` 或新组件 | 实时训练进度 |
| 4.6 | ChatPanel 中标注三进制推理来源 | `components/MessageBubble.tsx` | "由本地 Go 专家模型回答" |

### Phase 5：正反馈闭环（1 天）

> 微模型推理时记录低置信度 → Knowledge Interviewer 精准追问 → 更多知识 → 更好的模型。

**任务**：

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 5.1 | TernaryEngine 推理时记录 confidence | `ternary/engine.ts` | 低置信度标记为 KnowledgeGap |
| 5.2 | KnowledgeInterviewer 消费 gaps | `intelligence/knowledge-interviewer.ts` | gap → 追问问题 |
| 5.3 | Scheduler 检查 gap 数量触发训练 | `ternary/scheduler.ts` | gap > 10 → 提前训练 |

---

## 四、数据流全景（集成后）

```
用户对话
  │
  ├─→ KnowledgeExtractor ──→ STMP ──→ 领域画像成长
  │                                         │
  │         ┌───────────────────────────────┘
  │         │
  │    ┌────▼─────┐    ┌──────────────┐    ┌─────────────────┐
  │    │ Prompt    │    │ Training     │    │ Ternary          │
  │    │ Injector  │    │ Exporter     │    │ Scheduler        │
  │    │ (即时)    │    │ (CLI 手动)   │    │ (夜间自动)       │
  │    └────┬─────┘    └──────┬───────┘    └────────┬────────┘
  │         │                 │                      │
  │    注入到 LLM         导出 JSONL           TernaryTrainer
  │    的 system prompt    + DataAugmentor      (纯 CPU t-SignSGD)
  │         │               扩增 5x                   │
  │         │                 │                      │
  │    LLM 回复时          可上传云端              保存 .ta 模型
  │    包含领域知识        做 LoRA 微调               │
  │         │                                         │
  │         │              ┌──────────────────────────┘
  │         │              │
  │    ┌────▼──────────────▼────┐
  │    │   TernaryEngine        │
  │    │   本地推理 (纯 CPU)     │
  │    └────────────┬───────────┘
  │                 │
  │          三进制专家回答
  │          (不调外部 API)
  │                 │
  │    ┌────────────▼───────────┐
  │    │   Knowledge Interviewer│
  │    │   记录低置信度 gaps     │──→ 精准追问用户 → 更多知识
  │    └────────────────────────┘         ↑
  │                                       │
  │              正反馈循环 ←─────────────┘
  │
  └─→ 经验模型引擎 (ExperienceEngine)
       工具调用模式学习（独立于三进制）
```

---

## 五、排期

| Phase | 内容 | 耗时 | 累计 | 状态 |
|---|---|---|---|---|
| 0 | 数据扩增器接入 | 0.5 天 | 0.5 天 | ✅ 已完成 |
| 1 | 三进制管理器+推理引擎接入 | 1 天 | 1.5 天 | ✅ 已完成 |
| 2 | 三进制调度器+心跳集成 | 1 天 | 2.5 天 | ✅ 已完成 |
| 3 | 商城安装器接入 | 0.5 天 | 3 天 | ✅ 已完成 |
| 4 | 前端展示+交互 | 2 天 | 5 天 | ✅ 已完成 |
| 5 | 正反馈闭环 | 1 天 | 6 天 | 🔄 部分完成（feedTernaryScheduler 已接入，低置信度→追问链路待验证） |

### 依赖关系

```
Phase 0 (DataAugmentor) ──→ Phase 1 (Ternary 接入) ──→ Phase 2 (调度器)
                                                        │
                                                        ├──→ Phase 3 (商城)
                                                        │
                                                        └──→ Phase 4 (前端)
                                                              │
Phase 1 + 2 ──→ Phase 5 (正反馈闭环) ←──────────────────────┘
```

Phase 0/1 可先行，Phase 3/4 可并行。

---

## 六、验收标准

- [ ] Buddy 启动时扫描 `~/.buddy/models/`，`/models` 列出已有三进制模型
- [ ] `ternary_expert_query` 工具注册到 ALL_TOOLS，LLM 可调用
- [ ] 有三进制模型时，对应领域问题由本地模型回答（不调外部 API）
- [ ] 心跳/空闲时自动触发增量训练（`TernaryScheduler.checkAndTrain()`）
- [ ] `/train-ternary <domain>` 手动触发训练，显示进度
- [ ] 训练完成后自动保存 .ta 模型，前端收到通知
- [ ] `/export-training` 导出时自动调用 DataAugmentor 扩增
- [ ] 前端 Experts 面板展示三进制模型列表/状态/精度
- [ ] ChatPanel 标注"由本地 XX 专家模型回答"
- [ ] 正反馈循环：推理低置信度 → Interviewer 追问 → 积累知识

---

## 七、与内测计划的关系

本计划和 `INTERNAL_TEST_PLAN.md` 并行：

- **内测计划**（P0/P1）：确保基础体验稳定（构建/类型/错误处理）
- **本计划**：激活三进制核心链路，是产品差异化的核心

建议顺序：先完成内测 P0（构建验证+端口修复），再执行本计划。两者可部分并行。
