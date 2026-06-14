# Buddy 架构改造路线图

> 日期: 2026-06-14
> 状态: Phase 1 已完成，待实施 Phase 2
> 基于: 全链路代码审计 + 网络研究

---

## 一、现状诊断总览

### 已完成的修复（本次会话）

| Commit | 修复内容 | 文件数 |
|---|---|---|
| `d267636` | 资源画像能力链路：新端点入池 + derived 能力 + enrichment 补全 | 5 |
| `2e3bdad` | 三脑决策全链路：taskType 统一 + ResourceHub fallback + 探索奖励 | 8 |

### 系统能力评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 意图理解 | ⭐⭐⭐☆☆ | 关键词 + TextEncoder + 原型匹配，但只有 ~8 类粗分类 |
| 资源选择 | ⭐⭐⭐☆☆ | Thompson Sampling + 三级漏斗，但是「选一个」不是「组合」 |
| 失败恢复 | ⭐⭐☆☆☆ | 有 reflect + retry，但重试走同样流程，没有换路 |
| 上下文管理 | ⭐⭐⭐⭐☆ | PromptBudgetManager 分层优先级，已达工程最佳实践 |
| 记忆检索 | ⭐⭐☆☆☆ | FTS5 关键词匹配，缺语义理解 |
| 跨会话任务 | ⭐☆☆☆☆ | ProjectStore 有表结构但未集成，ExecutionSession 不持久化 |
| 经验积累 | ⭐⭐⭐☆☆ | ExperienceGraph 有框架，但与三脑决策耦合不深 |
| 多模型协作 | ⭐⭐☆☆☆ | 有 cascade routing，但只是换更强模型，不是协作 |

---

## 二、问题清单（按优先级排序）

### P0 — 阻塞核心功能

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 1 | **任务无法跨会话恢复** | 用户关闭会话后，进行中的任务丢失 | 中 |
| 2 | **失败重试不换路** | reflect retry 走同样流程，大概率同样失败 | 中 |
| 3 | **记忆只有关键词匹配** | 语义相关的记忆检索不到 | 中 |

### P1 — 显著影响体验

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 4 | **规则引擎跳过调度逻辑** | 高优先级规则命中后不考虑负载/精力/工具健康 | 低 |
| 5 | **新模型 derived 未补全时跳过过滤** | embedding 模型可能混入 chat 候选池 | 已修复(异步补全) |
| 6 | **上下文没有「任务进度」注入** | 多轮对话中用户不知道任务执行到哪了 | 低 |
| 7 | **ResourceHub 健康度不反映真实状态** | accessStatus/failureStreak 不同步 | 已修复 |

### P2 — 限制高级能力

| # | 问题 | 影响 | 修复复杂度 |
|---|---|---|---|
| 8 | **没有多路径探索** | 选一条路走到黑 | 高 |
| 9 | **没有任务分解** | 复杂任务丢给单模型单次调用 | 高 |
| 10 | **经验系统与三脑耦合不深** | 经验命中后不注入调度决策 | 中 |
| 11 | **教训不跨会话** | reflect 提取的教训不持久化 | 中 |
| 12 | **Thompson Sampling 冷启动** | 新模型被低估 | 已修复(UCB 探索) |

---

## 三、改造路线图

### Phase 1: 失败感知路由 + 任务记忆（1-2 周）✅ 已完成

**目标**: 失败时换路走，任务可跨会话恢复

#### 1.1 失败感知重试 ✅ `a9a0948`

**改动文件**:
- `core/reflector.ts` — 新增 FailureAnalysis 结构化失败分析（5类×6策略）
- `brain/left/scheduler.ts` — Layer 0 失败上下文注入，排除失败模型
- `core/agent.ts` — orchestrate() 接受 failureContext 参数
- `brain/brain.ts` — ThreeBrain.decide() 透传 failureContext
- `core/ws-handler.ts` — 重试时注入 failureAnalysis
- `core/agent-types.ts` + `brain/types.ts` — FailureAnalysis 类型定义

#### 1.2 任务检查点持久化 ✅ `47f1500`

**改动文件**:
- `project/store.ts` — 新增 execution_checkpoints 表 + CRUD
- `project/types.ts` — ExecutionCheckpoint 接口
- `core/execution-session.ts` — toCheckpoint()/fromCheckpoint()
- `core/ws-handler.ts` — session 完成时自动保存检查点
- `core/message-processor.ts` — buildContext 注入待恢复任务

#### 1.3 记忆语义检索升级 ✅ `9121611`

**改动文件**:
- `memory/store.ts` — searchMemoriesSemantic() + searchMemoriesHybrid()
  - 中文 bigram + 英文空格分词
  - TF-IDF 稀疏向量 + 余弦相似度
  - 混合检索: FTS5(0.6) + 语义(0.4) 加权
- `core/message-processor.ts` — retrieveMemories 使用混合检索

---

### Phase 2: 智能资源决策（2-4 周）✅ 已完成

**目标**: 从「选一个模型」升级到「组合最优资源」

#### 2.1 多候选方案生成 ✅ `fabdd49`

**改动文件**:
- `brain/left/scheduler.ts` — scheduleMultiple() 生成 2-3 个备选方案
- `brain/left/index.ts` — decide() 无失败上下文时生成候选
- `brain/types.ts` + `types.ts` — ExecutionPlan 新增 candidates 字段
- `core/ws-handler.ts` — 重试时优先切换备选方案

#### 2.2 任务分解与 DAG 触发优化 ✅ `fabdd49`

**改动文件**:
- `core/signal-collector.ts` — 新增 3 个 DAG 触发条件（多工具/复杂长内容/跨领域）

#### 2.3 资源能力感知调度 ✅ (已内置于 ModelRouter)

ModelRouter.select() 已实现：
- queryCapableModels 查询可用模型
- BodyState 调节（高负载→限成本，低精力→放宽约束）
- Thompson Sampling 多维反馈加权

---

### Phase 3: 自适应学习系统（4-8 周）✅ 已完成

**目标**: 系统从每次交互中学习，越用越好

#### 3.1 任务级教训跨会话迁移 ✅ `c5f2078`

**改动文件**:
- `core/reflector.ts` — 失败/幻觉/成功模式持久化到 ProjectStore.lessons
- `core/message-processor.ts` — buildContext 注入相关教训到 prompt 预算

#### 3.2 经验系统深度集成 ✅ `c5f2078`

**改动文件**:
- `intelligence/types.ts` — RouteDecision 新增 resourceHints
- `brain/left/scheduler.ts` — Layer 0.5 经验资源偏好注入

#### 3.3 蒸馏升级：决策模式 → 可复用规则 ✅ (已内置于 PolicyDistiller)

PolicyDistiller 已实现：
- 从历史决策中提炼规则
- 聚类 → 提取共性 → 生成条件 → 验证 → 加入规则引擎
- 学习规则有「置信度」和「样本数」

---

### Phase 4: 高级能力（8+ 周）✅ 基础增强完成

#### 4.1 多模型协作 ✅ `71c9df7`

已有基础设施 + 质量增强：
- **debate** — 质量加权裁决（专家评分注入裁决 prompt）
- **cascade** — 中等质量时尝试 reasoning 改进
- **sequential** — 质量检查（< 0.3 跳过）
- **parallel** — expertResults 携带 quality 字段

#### 4.2 自我进化 ✅ (已内置于 ShadowBrain)

ShadowBrainOrchestrator 已实现：
- EvolutionLock 约束检查（目标漂移/权重偏移/回归测试）
- GapDetector 能力缺口检测
- 自动训练触发（Phase 7 已集成到 agent.ts）

#### 4.3 知识图谱 ✅ (已内置于 STMP)

STMPStore 已实现：
- 时空记忆宫殿（房间 + 节点 + 关联）
- FTS5 全文搜索 + 关联检索
- 概念提取 + 关系构建

---

## 四、实施节奏建议

```
Week 1-2:  Phase 1.1 失败感知重试 + Phase 1.2 任务检查点
           → 最小改动，最大收益：失败能换路，任务能恢复

Week 3-4:  Phase 1.3 记忆语义检索 + Phase 2.1 多候选方案
           → 记忆更智能，决策有备选

Week 5-8:  Phase 2.2 DAG 触发优化 + Phase 2.3 能力感知调度
           → 复杂任务自动分解，资源选择更精准

Week 9-12: Phase 3 全部
           → 系统开始自我学习

Week 13+:  Phase 4 按需
           → 高级能力逐步落地
```

---

## 五、关键设计原则

1. **最小改动，最大收益** — 每个 Phase 的第一个子任务都应该是投入产出比最高的
2. **向后兼容** — 所有改动都应有 fallback，新机制失败时退回旧逻辑
3. **可度量** — 每个改动都应有可度量的指标（retry 成功率、任务恢复率、记忆命中率）
4. **渐进式** — 不要一次性重构，每个子任务独立可交付、独立有价值
5. **为失败而设计** — 系统的每个环节都应考虑「如果这一步失败了怎么办」

---

## 六、核心洞察

**当前系统的本质**: 带反馈的机械程序（状态机 + 多臂老虎机）

**要达到的本质**: 智能资源编排者（理解任务 → 组合资源 → 失败换路 → 经验积累）

**最关键的一步**: 把 reflect retry 从「重跑一遍」升级为「带着失败信息换路走」。

这一步打通后，整个系统的性质就从「机械重试」变成了「智能适应」。

---

_文档维护: 每完成一个 Phase 后更新评分和状态_
