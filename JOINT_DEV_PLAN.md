# 知识采集 × 三进制微模型 — 联合开发计划

> 将"主动提问"与"三进制增量微模型"合并为一条完整产线
> 2026-04-21

---

## 核心洞察：这是同一条线

```
主动提问                    三进制微模型
(DEVELOPMENT_MASTER_PLAN)   (TERNARY_DEV_PLAN)
     │                            │
     │   采集知识                  │   消费知识
     │                            │
     ▼                            ▼
 知识缺口 ──→ 追问采集 ──→ STMP积累 ──→ 训练 ──→ 微模型 ──→ 推理
     ▲                                            │
     │                                            │
     └──── 微模型知道"自己缺什么" ──────────────────┘
           反过来驱动更精准的提问
```

**主动提问是入口，三进制微模型是出口，中间是知识积累。**

微模型成长越快，越需要更多知识；主动提问越精准，知识积累越快。两者形成正反馈循环。

---

## 联合产线全景

```
阶段一: 采集引擎              阶段二: 知识处理              阶段三: 模型产出
(主动提问)                   (质量提升)                    (三进制微模型)
─────────────               ─────────────                 ─────────────
Knowledge Interviewer       TrainingExporter              TernaryEngine
  │                           │                             │
  ├─ 知识缺口检测              ├─ QA对提取                    ├─ .ta 格式
  ├─ 追问问题生成              ├─ 判断力样本                   ├─ 推理引擎
  ├─ 提问时机判断              ├─ Self-Instruct               ├─ 增量训练
  │                           ├─ 多维质量评估                 ├─ 知识蒸馏
  │                           │                             ├─ 商城分发
  ▼                           ▼                             ▼
 问出知识 ──────────────→ 加工知识 ──────────────→ 炼成模型
```

---

## 联合 Phase 拆分

### Phase A：主动提问引擎（1.5 周）

> 来源：DEVELOPMENT_MASTER_PLAN Phase 4a Day 1-2（之前未实现）

**目标**：Buddy 能主动向用户追问专业知识，加速积累。

| 任务 | 文件 | 耗时 |
|------|------|------|
| 知识缺口检测 | `src/intelligence/knowledge-interviewer.ts` | 0.5 天 |
| 追问问题生成（LLM 驱动） | 同上 | 0.5 天 |
| 提问时机判断 | 同上 | 0.5 天 |
| 消息处理器注入追问逻辑 | 修改 `src/core/message-processor.ts` | 0.5 天 |
| 心跳集成 | 修改心跳逻辑 | 0.5 天 |
| 测试 | `src/intelligence/knowledge-interviewer.test.ts` | 0.5 天 |

**验收**：对话中自然追问专业知识，用户不觉得被打断。

---

### Phase B：训练数据质量提升（1 周）

> 来源：DEVELOPMENT_MASTER_PLAN Phase 4a Day 3-5（部分已实现，需补全）

**目标**：知识从"一句话"升级为"问答对+判断力样本+推理链"。

| 任务 | 文件 | 耗时 |
|------|------|------|
| 补全 TrainingExporter.convertToSamples 支持 judgment/correction | 修改 `src/intelligence/training-exporter.ts` | 0.5 天 |
| Self-Instruct 数据扩增器 | 新建 `src/intelligence/data-augmentor.ts` | 1 天 |
| 多维度质量评估 (diversity/reasoning/coverage) | 修改 `src/intelligence/training-exporter.ts` | 0.5 天 |
| 领域推断改为 LLM 驱动 | 修改 `src/knowledge/extractor.ts` | 0.5 天 |
| 测试 | 修改现有测试 | 0.5 天 |

**验收**：10 条知识 → 50+ 条高质量训练样本。

---

### Phase C：三进制格式 + 推理（3.5 周）

> 来源：TERNARY_DEV_PLAN Phase 1 + Phase 2

**目标**：定义格式，本地三进制推理。

#### C1：格式+存储层（1.5 周）

| 任务 | 文件 | 耗时 |
|------|------|------|
| .ta 格式规范 | `src/ternary/format.ts` | 0.5 天 |
| 三进制打包/解包 | `src/ternary/codec.ts` | 1 天 |
| 模型管理器 | `src/ternary/manager.ts` | 1 天 |
| 测试 | `src/ternary/format.test.ts` | 0.5 天 |

#### C2：推理引擎（2 周）

| 任务 | 文件 | 耗时 |
|------|------|------|
| 三进制矩阵运算 | `src/ternary/compute.ts` | 2 天 |
| 推理引擎 | `src/ternary/engine.ts` | 2 天 |
| Tokenizer | `src/ternary/tokenizer.ts` | 0.5 天 |
| Buddy 工具集成 | `src/tools/ternary-expert.ts` | 1 天 |
| 性能基准 + 测试 | `src/ternary/bench.ts` | 1.5 天 |

**验收**：100M 三进制模型 > 10 tok/s，纯 CPU。

---

### Phase D：增量训练 + 自动成长（2 周）

> 来源：TERNARY_DEV_PLAN Phase 3

**目标**：微模型夜间自动成长。

| 任务 | 文件 | 耗时 |
|------|------|------|
| t-SignSGD 优化器 | `src/ternary/optimizer.ts` | 1 天 |
| 增量训练流程 | `src/ternary/trainer.ts` | 2 天 |
| 心跳集成+自动触发 | `src/ternary/scheduler.ts` | 1 天 |
| 成长模式切换 | `src/ternary/growth.ts` | 0.5 天 |
| 测试 | 多个测试文件 | 1.5 天 |

**关键连接**：增量训练消耗的知识来自 Phase A + B 的产出。
```
Phase A 采集的知识 → Phase B 加工的训练样本 → Phase D 增量训练 → 模型成长
```

**验收**：夜间自动增量训练，模型能力提升可感知。

---

### Phase E：知识蒸馏（3 周）

> 来源：TERNARY_DEV_PLAN Phase 4

**目标**：大模型知识 → 独立三进制小模型。

| 任务 | 文件 | 耗时 |
|------|------|------|
| 蒸馏数据准备 | `src/ternary/distill-prep.ts` | 1 天 |
| 三进制模型架构 | `src/ternary/architecture.ts` | 2 天 |
| 蒸馏训练 | `src/ternary/distill.ts` | 3 天 |
| 质量评估 | `src/ternary/eval.ts` | 2 天 |
| 云端训练对接 | `src/ternary/cloud-trainer.ts` | 2 天 |
| 测试 | 2 天 |

**关键连接**：蒸馏的训练数据来自 Phase B 的高质量样本。
微模型成长到一定程度，反过来告诉 Phase A "我还缺什么"。

```
微模型评估结果 → 知识缺口报告 → Phase A 精准追问 → 更多高质量知识
```

**验收**：100M 三进制模型独立推理，领域准确率 > 80%。

---

### Phase F：商城 + 生态（1 周）

> 来源：TERNARY_DEV_PLAN Phase 5

| 任务 | 文件 | 耗时 |
|------|------|------|
| 商城接口 | `src/shop/catalog.ts` | 0.5 天 |
| 安装/卸载 | `src/shop/installer.ts` | 0.5 天 |
| 前端界面 | `frontend/src/components/Experts.tsx` | 1 天 |
| 测试 | 1 天 |

---

## 正反馈循环设计

Phase E 完成后，形成闭环：

```
┌──────────────────────────────────────────────────────────────┐
│                        正反馈循环                             │
│                                                              │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌────────┐ │
│  │ 微模型   │────▶│ 能力评估 │────▶│ 缺口发现 │────▶│ 主动   │ │
│  │ 推理     │     │ 哪里弱?  │     │ 缺什么?  │     │ 追问   │ │
│  └─────────┘     └─────────┘     └─────────┘     └───┬────┘ │
│       ▲                                              │      │
│       │            ┌─────────┐     ┌─────────┐      │      │
│       │            │ 增量训练 │◀────│ 知识积累 │◀─────┘      │
│       │            │ 模型成长 │     │ STMP    │              │
│       └────────────┴─────────┘     └─────────┘              │
│                                                              │
│  微模型越聪明 → 越知道自己缺什么 → 问得越精准 → 知识越好     │
│  → 训练效果越好 → 模型越聪明 → ...                           │
└──────────────────────────────────────────────────────────────┘
```

### 缺口驱动的追问策略

```typescript
// 微模型推理时记录"不确定"的地方
interface KnowledgeGap {
  domain: string
  topic: string           // "Go 并发模式"
  confidence: number      // 模型回答时的置信度 (0-1)
  questionType: 'why' | 'how' | 'when' | 'edge_case'
  lastSeen: number        // 上次遇到的时间戳
}

// Knowledge Interviewer 消费这些缺口
class KnowledgeInterviewer {
  async generateQuestions(domain: string): Promise<Question[]> {
    // 1. 微模型推理时的低置信度记录
    const gaps = await this.getModelGaps(domain)
    
    // 2. STMP 覆盖度分析
    const coverage = await this.analyzeCoverage(domain)
    
    // 3. 合并 → 生成追问问题
    return this.synthesize(gaps, coverage)
  }
}
```

---

## 总时间线

```
Week 1-1.5   Phase A: 主动提问引擎
Week 2-2.5   Phase B: 训练数据质量提升
Week 3-5     Phase C: 三进制格式 + 推理引擎
Week 6-7     Phase D: 增量训练 + 自动成长
Week 8-10    Phase E: 知识蒸馏
Week 11      Phase F: 商城 + 生态
```

总计 **11 周**（比分开做节省 1-2 周，因为 Phase A/B 联合设计避免了重复）

---

## 与现有文档的关系

```
DEVELOPMENT_MASTER_PLAN.md
  Phase 4a (主动提问) ──────────→ 本计划 Phase A + B
  Phase 4b (基座模型赋能)         暂不并入（依赖 Phase E）
  Phase 4c (云端微调对接)         暂不并入（依赖 Phase E）

TERNARY_LORA_ANALYSIS.md        ──→ 本计划的技术背景和理论依据

TERNARY_DEV_PLAN.md             ──→ 本计划 Phase C-F 的详细任务拆分

本计划                          ──→ 统一入口，串联主动提问和三进制微模型
```

---

*v1.0 — 2026-04-21 | 主动提问 × 三进制微模型联合开发计划*
