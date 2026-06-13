# Buddy 文档对比分析报告 — 修复与迭代综合评估

> 生成时间: 2026-06-13
> 分析范围: 项目代码 vs 压缩包新增文档 (58 份)
> 目标: 识别已知问题、提取优秀设计方案、制定迭代计划

---

## 一、总览

| 分类 | 数量 | 说明 |
|------|------|------|
| FIX/REPAIR 类 | 8 | 已知缺陷修复方案 |
| 架构迭代类 | 25 | 系统架构升级方案 |
| 模型训练类 | 12 | 三进制/BuddyLM/ByteEncoder 训练计划 |
| 功能增强类 | 13 | 新功能或功能补全方案 |

---

## 二、FIX 类文档 — 当前代码中的遗留问题

### 🔴 P0 级（必须修复）

#### FIX-01: SVG XSS 漏洞
- **文档**: `FIX_PLAN_DETAILED.md`
- **问题**: `markdown.tsx` 中 `dangerouslySetInnerHTML` 渲染 highlight.js 输出，无 DOMPurify 净化
- **当前状态**: ❌ **未修复** — 代码中无 DOMPurify 依赖，`sanitizeHighlight()` 仅用正则过滤，可被绕过
- **影响**: 恶意代码块可执行 XSS 攻击
- **修复方案**: 安装 dompurify，替换正则净化为 DOMPurify.sanitize()
- **工作量**: 0.5 天

#### FIX-02: feedback() 闭环断裂
- **文档**: `CONFIDENCE_REFORM_PLAN.md` (B-1 ~ B-7)
- **问题**: `ThreeBrain.feedback()` 从未被调用，导致:
  - ConfidenceCalibrator 永远达不到 MIN_SAMPLES=5
  - BlendBrain REINFORCE 策略梯度不学习
  - BlendBandit R⁵ 连续 Bandit 不更新
  - DispatchLearner Thompson Sampling 历史为空
  - userCorrectionCount 不更新
- **当前状态**: ❌ **未修复** — `grep` 确认 agent.ts/ws-handler.ts/message-processor.ts 均无 `.feedback(` 调用
- **影响**: 整个学习闭环失效，三脑决策系统无法从执行结果中学习
- **修复方案**: 在 postprocessResult 或 reflect 流程中注入 feedback 调用
- **工作量**: 1-2 天

#### FIX-03: setEditingPipeline 未调用
- **文档**: `CONFIDENCE_REFORM_PLAN.md` (B-1)
- **问题**: `subsystems.ts` 缺少 `setEditingPipeline()` 调用，v5 管线永远降级到 legacy
- **当前状态**: ❌ **未修复** — 代码中无 `setEditingPipeline` 调用
- **影响**: 碰撞引擎+知识汇聚管线形同虚设
- **工作量**: 0.5 天

#### FIX-04: Gate-0 经验路由副作用无法回滚
- **文档**: `FIX_PLAN_CHAIN.md` (P03/P09)
- **问题**: `execExperience()` 先执行副作用再验证结果，失败时无法回滚
- **当前状态**: ⚠️ **部分存在** — agent.ts L586 有 try-catch 包裹，但无回滚机制
- **影响**: 经验执行失败时可能产生脏状态
- **工作量**: 1 天

#### FIX-05: hasAlternativePaths 永远返回 false
- **文档**: `FIX_PLAN_CHAIN.md` (P13)
- **问题**: 实现中 `failedModels.length < 3` 条件几乎不可能触发（实际 failedModels 通常为 undefined）
- **当前状态**: ⚠️ **代码存在但逻辑有缺陷** — brain.ts L420-430
- **影响**: 失败后不尝试替代路径，直接降级到 fallback
- **工作量**: 0.5 天

### 🟡 P1 级（应该修复）

#### FIX-06: 三套意图系统不统一
- **文档**: `FIX_PLAN_CHAIN.md` (P01/P17)
- **问题**: IntentClassifier / detectDomains / SemanticIntentIndex 各自独立分类，同一输入被分类 6 次
- **当前状态**: ❌ **未修复** — 代码中 70 处相关调用，无统一感知层
- **影响**: 计算浪费 + 分类结果不一致
- **修复方案**: 新建 `PerceptionState` 统一感知结果（见 FIX_PLAN_CHAIN.md Phase 0）
- **工作量**: 2-3 天

#### FIX-07: 执行过程无监控回调
- **文档**: `THREE_BRAIN_EXECUTION_AUDIT.md` (P0-1)
- **问题**: `executeBlendStrategy()` 遍历组件时无进度回调、无超时控制、无取消机制
- **当前状态**: ❌ **未修复** — plan-executor.ts 无 onProgress/onTaskStart 回调
- **影响**: 决策者对执行过程"失明"
- **工作量**: 2 天

#### FIX-08: 资源感知决策断裂
- **文档**: `RESOURCE_AWARENESS_FIX_PLAN.md`
- **问题**: BlendBrain 采样时不感知资源可用性，cascade 策略偏向不存在的资源
- **当前状态**: ⚠️ **部分存在** — ResourceHub 已实现但与 ModelPool 断联
- **影响**: "今天天气怎么样" 等简单查询可能被路由到不可用的 cloudLLM → 15s 超时
- **工作量**: 1-2 天

#### FIX-09: ResourceHub ↔ ModelPool 完全断联
- **文档**: `RESOURCE_HUB_FIX_PLAN.md`
- **问题**: ModelPool 激活/去激活/发现/状态变更时，ResourceHub 不知道
- **当前状态**: ❌ **未修复** — 无 `ModelPoolResourceBridge` 实现
- **影响**: 云端模型画像永远是默认值，推荐系统基于错误数据决策
- **工作量**: 1 天

#### FIX-10: ByteEncoder 训练路径不一致
- **文档**: `BYTEENCODER_TRAIN_FIX_PLAN.md`
- **问题**: 训练用 meanPool+L2，推理用 lastToken 无归一化；增量训练全链路断路（byteBridge=null）
- **当前状态**: ⚠️ **训练路径已修复（V2 数据），但增量训练接入仍断**
- **影响**: ByteEncoder 权重运行时完全冻结，无法在线学习
- **工作量**: 2 天

#### FIX-11: ToolProposal 信息流绕路
- **文档**: `TOOL_PROPOSAL_FIX_PLAN.md`
- **问题**: 工具确定性输出走了概率性的向量检索管线，语义鸿沟+信息损耗
- **当前状态**: ❌ **未修复** — 无 `routeToolProposal` 方法
- **影响**: 工具结果被 FragmentExtractor 破坏结构化信息
- **工作量**: 1 天

#### FIX-12: BuddyLM 权重加载错位
- **文档**: `BUDDYLM_WEIGHT_LOADING_FIX_PLAN.md` + `WEIGHT_LOADING_DEEP_ANALYSIS.md`
- **问题**: Checkpoint 参数顺序（interleaved）与模型 parameters() 顺序（grouped）不一致，导致 64 个参数被跳过
- **当前状态**: ❌ **未修复** — 加载器仍按顺序逐个对比 size
- **影响**: BuddyLM 输出乱码，置信度 ~0.07
- **工作量**: 1 天（参数顺序映射表已明确）

### 🟢 P2 级（可选修复）

#### FIX-13: BlendBrain 信号流断裂
- **文档**: `BLEND_BRAIN_REPAIR_PLAN.md`
- **问题**: 128 维输入只接了 3 个信号源，5 个输出维度只有 2-3 个有执行器
- **当前状态**: ⚠️ **部分改进** — 特征向量仍为 128 维
- **修复方案**: 扩展到 180 维 + 11 维输出
- **工作量**: 3-5 天

#### FIX-14: DAG 假阳性
- **文档**: `FIX_PLAN_CHAIN.md` (P06)
- **问题**: "然后" 等高频词触发 DAG 规划
- **当前状态**: ⚠️ **可能存在** — 需验证 message-processor.ts 的 DAG 触发逻辑
- **工作量**: 0.5 天

---

## 三、迭代文档 — 优秀设计方案提取

### 🏗️ A 类: 架构级方案（影响深远，建议优先实施）

#### ITER-01: 统一感知层 (PerceptionState)
- **来源**: `FIX_PLAN_CHAIN.md` Phase 0
- **核心思想**: 一次计算，全链路共享。替代 IntentClassifier/detectDomains/assessTaskComplexity 的多次重复调用
- **优秀设计**:
  - `PerceptionState` 包含 intent/domains/complexity/taskType/search/dag/suggestedTools/embedding
  - 信号采集阶段只算一次，后续决策/执行/反馈全部复用
  - 消除 6 次重复分类的计算浪费
- **实施建议**: 新建 `src/core/perception-state.ts`，改造 signal-collector.ts
- **预计收益**: 延迟降低 30-50ms，分类一致性提升

#### ITER-02: 调度模式改革（降级→竞争裁决）
- **来源**: `DISPATCH_REFORM_PLAN.md` + `DISPATCH_REFORM_PLAN_FEASIBILITY.md`
- **核心思想**: 各模块各出方案，三脑裁决选最优，裁决后多模块协作执行
- **优秀设计**:
  - **前瞻式可行性门控**: 方案产出时声明资源需求，裁决前做可行性过滤
  - **ProposalCollector + FeasibilityChecker + Arbiter** 三件套
  - 竞争模式智能触发（不是每次都并行）
  - 裁决后走 DAG/ToolChain/能力协同 执行，不是单路径
- **当前状态**: 部分已实现（Arbiter 存在），但完整竞争裁决流程未落地
- **预计收益**: 本地方案竞争力提升，减少不必要的 LLM 调用

#### ITER-03: 法则系统（规则→法则进化）
- **来源**: `LAW_SYSTEM_DESIGN.md`
- **核心思想**: 从 if-then 规则进化到带生命周期的法则（生成→试运行→校准→稳定→衰退→淘汰）
- **优秀设计**:
  - 53 条种子规则 + 12 条内置规则已就绪
  - PolicyDistiller 生命周期管理（置信度校准+优先级调整+规则合并+条件收窄）
  - DecisionMemory 持久化 + kNN 相似查询 + 反事实样本生成
  - DispatchLearner LLM 胜出时蒸馏到本地模块
- **当前状态**: 基础设施已实现，但完整生命周期未跑通
- **预计收益**: 确定性操作覆盖从 ~13% 提升到 40%+

#### ITER-04: 信息整合引擎（零 LLM 组装）
- **来源**: `INFORMATION_INTEGRATION_ENGINE.md` + `INTEGRATION_ENGINE_REFORM.md`
- **核心思想**: 不"生成"，只"组装"。字典层→语义层→组装层→篇法层
- **优秀设计**:
  - 四层管线: 多粒度存储 → ByteEncoder 检索 → 骨架模板填充 → 逻辑链控制
  - 创造性机制: 变异+评估+进化闭环+用户框架注入
  - 已接入 ByteEncoder（替换 quickEmbed hash 伪编码）
  - ReasoningHead 多步推理驱动组装
- **当前状态**: 基础架构已实现（IntegrationEngine 存在），但组装质量待提升
- **预计收益**: 85%+ 日常交互零 LLM 调用

#### ITER-05: 细粒度意图层
- **来源**: `FINE_GRAINED_INTENT_PLAN.md`
- **核心思想**: 语义粗筛+关键词精排，消费 ByteEncoder 向量为三脑提供精准工具路由信号
- **优秀设计**:
  - 混合匹配: `semanticScore×0.4 + nearestScore×0.6 + keywordBoost + excludePenalty`
  - 在线学习: addSeed 钩子+持久化+衰减+flush+缓存失效
  - 不是决策层，只是辅助感知模块
- **当前状态**: ✅ **Phase 1-4 全部完成**（30/30 测试通过）
- **建议**: 已完成，确认集成到统一感知层

### 🧠 B 类: 模型训练方案（中长期）

#### ITER-06: 三进制自然生长机制
- **来源**: `TERNARY_GROWTH_PLAN.md`
- **核心思想**: 三进制 {-1,0,1} 天然支持稀疏生长。0=未学习，训练驱动偏离零值→激活为±1
- **优秀设计**:
  - 叠加合并: 非零覆盖零，同值保持，冲突取新值
  - 生长生命周期: seed→sprout→growing→trainable→mature
  - 推理成本恒定，容量无限（MoE 架构）
- **当前状态**: ✅ **Phase 1-5 已完成**
- **建议**: 继续推进冷启动预训练

#### ITER-07: 无限成长语义编码器 (MoE)
- **来源**: `INFINITE_GROWTH_PLAN.md`
- **核心思想**: 总线宽度永远 256，通过增加 MoE Expert 数量扩展能力（而非加维度/加层）
- **优秀设计**:
  - 旧方案死胡同: L0(128)→L1(128)→L2(128)→L3(256)→... 总线宽度改变，下游全改
  - MoE 方案: [共享 Attention] → [MoE-FFN] → 256 维输出，N 个 Expert 可无限增长
  - 推理成本恒定: 每 token 只激活 Top-K 个 Expert
- **建议**: 作为 ByteEncoder 长期演进方案

#### ITER-08: 联合预训练方案
- **来源**: `PRETRAIN_PLAN.md` + `TERNARY_PRETRAIN_PLAN.md`
- **核心思想**: 端到端联合训练，分阶段递进
- **优秀设计**:
  - Stage 0: Tokenizer 训练 + ByteEncoder 对比学习
  - Stage 1: Encoder-Decoder 联合 CE 预训练
  - 两层架构: 容器层(GPU预训练产出) + 模型层(三进制蒸馏)，独立可换
  - vocabSize=16384, hiddenDim=256, 8 MoE Expert, Top-K=2
- **当前状态**: 部分完成（ByteEncoder Stage 0-4, BBPE Stage 0）
- **建议**: 在启智平台完成 GPU 预训练后，蒸馏到三进制

#### ITER-09: 训练架构对齐
- **来源**: `ALIGNMENT_PLAN.md` + `ARCHITECTURE_ROADMAP.md`
- **核心思想**: 训练(Python)和推理(TypeScript)必须架构完全对齐
- **优秀设计**:
  - 三层分类: 地基层(结构约束) → 预训练层(冷启动) → 自进化层(持续精进)
  - 已修复: Encoder架构/MoE loss/数据流/训练超参对齐
  - 地基层锁定: BBPE词表/三进制格式/MatMul/cross-attention/MoE
- **建议**: 严格执行对齐验证流程

#### ITER-10: 权重加载修复方案
- **来源**: `BUDDYLM_WEIGHT_LOADING_FIX_PLAN.md`
- **核心思想**: Checkpoint→Model 参数索引映射表
- **优秀设计**:
  - 每 block 66 参数的精确映射规则（interleaved→grouped）
  - CCA 层跳过逻辑（checkpoint 无此参数）
  - 预期修复: 467/531 → 528/531 (99.4%)
- **建议**: 立即实施，这是 BuddyLM 输出乱码的根因

### 🔧 C 类: 功能增强方案

#### ITER-11: 双世界模型平行宇宙
- **来源**: `DUAL_WORLD_MODEL_PLAN.md`
- **核心思想**: WorldModel(MLP 快速推理) + SceneWorldModel(GNN 精确模拟) 相互独立又相互纠缠
- **优秀设计**:
  - 宇宙A(推理): 多步推理链+反事实推理+类比迁移
  - 宇宙B(模拟): 多步场景推演+实体级变更预测+风险传播分析
  - 纠缠层: 综合两个宇宙的决策输出
- **当前状态**: WorldModel 和 SceneWorldModel 均已实现，但未做纠缠
- **预计收益**: 复杂决策质量提升

#### ITER-12: 能力发现与动态路由
- **来源**: `CAPABILITY_ROUTING_SOLUTION.md`
- **核心思想**: 正则规则覆盖确定性操作，ByteEncoder 语义路由覆盖模糊意图
- **优秀设计**:
  - 15 个无 LLM 可解场景 + 完整能力矩阵
  - ByteEncoder 256 维向量 ~3ms 纯 CPU 语义路由
  - 与 RuleEngine 互补: 规则覆盖确定性，语义覆盖模糊性
- **预计收益**: 减少 30-40% 的 LLM 调用

#### ITER-13: 知识分层计划
- **来源**: `KNOWLEDGE_TIER_PLAN.md`
- **核心思想**: 冷启动覆盖 60-70% 场景，首次交互不显得傻
- **优秀设计**:
  - 当前种子经验仅 15 条（覆盖率 ~20%）
  - 目标: 100+ 种子经验 + 按需搜索 + 自积累
  - 三阶冷启动: 种子规则→种子经验→按需扩展
- **预计收益**: 冷启动体验从"什么都不会"提升到"基本能用"

#### ITER-14: 社区商业化分离
- **来源**: `COMMUNITY_SEPARATION_PLAN.md`
- **核心思想**: 软件归软件，社区归社区，商业化归商业化
- **优秀设计**:
  - billing 插件化已完成（BillingPlugin 接口+动态导入）
  - shop 回归核心（装饰/赛季是软件功能）
  - 社区网站独立部署（用户系统+内容平台+商业化）
- **当前状态**: ✅ Phase 1 已完成

#### ITER-15: 搜索重构（归入组装引擎）
- **来源**: `SEARCH_REFACTOR_PLAN.md`
- **核心思想**: 三条搜索路径统一为组装引擎管线的一部分
- **优秀设计**:
  - 删除 SearchArbiter（550 行），搜索决策移入三脑编排
  - ProactiveResearcher 归入组装引擎
  - 搜索结果走 Reranker→ContentSelector 质量管线
- **当前状态**: 三条路径仍并存
- **预计收益**: 减少搜索冗余，提升搜索质量

#### ITER-16: STMP 记忆检索升级
- **来源**: `STMP_UPGRADE_PLAN.md`
- **核心思想**: ByteEncoder 接入 STMP，中文语义搜索替代无效的 FTS5
- **优秀设计**:
  - Schema 迁移: stmp_nodes 新增 embedding BLOB 列
  - 混合检索: `score = α×fts5_score + (1-α)×cosine_similarity` (α=0.4)
  - 全量余弦扫描（STMP 节点通常 <10K，不需要 ANN 索引）
- **当前状态**: ✅ **Phase 1 已完成**（56 个测试通过）

#### ITER-17: 权限系统重构
- **来源**: `PERMISSION_REFACTOR_PLAN.md`
- **核心思想**: 亲密度只控制人格行为，不控制用户权限。权限基于操作风险等级
- **优秀设计**:
  - RiskLevel: safe/confirm/privacy（与亲密度无关）
  - 环境变量 `BUDDY_PERMISSION_V2=1` 启用新系统
  - 向后兼容: 旧 capability-gate 测试全部通过
- **当前状态**: ✅ **已完成**（15+37+34 测试通过）

#### ITER-18: 置信度体系改造
- **来源**: `CONFIDENCE_REFORM_PLAN.md`
- **核心思想**: 从单一数字公式升级为五层评估体系
- **优秀设计**:
  - Self-Critique + Review Panel + Self-Consistency + Process Evaluator + Outcome Verifier
  - 领域自适应阈值（医疗 vs 闲聊不同阈值）
  - 紧急通道: urgency 驱动快速通道
  - 纠错学习: 连续纠错立即调整策略权重
- **当前状态**: 基础设施存在但闭环未打通
- **预计收益**: 决策质量可追溯、可解释

#### ITER-19: 可视化组装
- **来源**: `VISUAL_ASSEMBLY_PLAN.md`
- **核心思想**: 组装引擎输出思维导图/流程图/架构图，而非纯文本
- **优秀设计**:
  - 零外部服务: 服务端 SVG 渲染
  - KnowledgeGraph 天然图结构 → GraphViz DOT → SVG
  - 前端直接 `<img src="data:image/svg+xml,...">` 渲染
- **预计收益**: 复杂信息的可视化呈现

#### ITER-20: 本地执行能力补全
- **来源**: `LOCAL_EXECUTION_DETAIL_PLAN.md` + `LOCAL_EXECUTION_MASTERY_PLAN.md`
- **核心思想**: 让规则引擎+BuddyLM 能输出可执行的工具调用序列，而非仅文本建议
- **优秀设计**:
  - 学徒超越师傅: 云端LLM→本地蒸馏→本地超越
  - ExecutablePlan: 规则引擎输出带工具调用的可执行计划
  - tool call 样本收集→训练→本地执行
- **当前状态**: 本地方案只能输出文本建议，不能执行工具
- **预计收益**: 离线场景可用性大幅提升

---

## 四、综合迭代计划

### Phase 1: 紧急修复（1-2 周）

| 优先级 | 任务 | 来源 | 工作量 | 验收标准 |
|:------:|------|------|--------|----------|
| P0 | SVG XSS 修复 | FIX-01 | 0.5d | DOMPurify 净化，XSS 测试用例通过 |
| P0 | feedback() 闭环打通 | FIX-02 | 1.5d | ThreeBrain.decide() 后有 feedback 调用 |
| P0 | setEditingPipeline 注入 | FIX-03 | 0.5d | v5 管线不再降级到 legacy |
| P0 | BuddyLM 权重加载映射 | FIX-12 | 1d | 参数加载率 99.4%，输出可理解中文 |
| P1 | hasAlternativePaths 修复 | FIX-05 | 0.5d | 失败后能尝试替代路径 |
| P1 | DAG 假阳性过滤 | FIX-14 | 0.5d | "然后" 等高频词不再误触发 DAG |

**Phase 1 验收**: BuddyLM 输出可理解文本，三脑反馈闭环跑通，安全漏洞修复。

### Phase 2: 架构升级（2-4 周）

| 优先级 | 任务 | 来源 | 工作量 | 验收标准 |
|:------:|------|------|--------|----------|
| A1 | 统一感知层 | ITER-01 | 2d | PerceptionState 替代 6 次重复分类 |
| A2 | ModelPool↔ResourceHub 桥 | FIX-09 | 1d | 云端模型画像实时更新 |
| A3 | 资源感知决策 | FIX-08 | 1.5d | 不可用资源不再被路由 |
| A4 | ToolProposal 直连路由 | FIX-11 | 1d | 确定性工具结果不走向量检索 |
| A5 | 搜索重构 | ITER-15 | 2d | 三条路径统一为组装引擎管线 |
| A6 | 知识分层冷启动 | ITER-13 | 2d | 种子经验 15→100+，覆盖率 20%→60% |
| A7 | 执行监控回调 | FIX-07 | 2d | 决策者能感知执行进度 |

**Phase 2 验收**: 感知统一、资源感知、搜索统一、冷启动覆盖 60%+。

### Phase 3: 能力进化（4-8 周）

| 优先级 | 任务 | 来源 | 工作量 | 验收标准 |
|:------:|------|------|--------|----------|
| B1 | 竞争裁决+可行性门控 | ITER-02 | 3d | 各模块出方案→裁决→协作执行 |
| B2 | 法则系统生命周期 | ITER-03 | 3d | 规则从生成到淘汰的完整生命周期 |
| B3 | 本地执行能力 | ITER-20 | 5d | 规则引擎输出可执行工具调用序列 |
| B4 | 置信度五层评估 | ITER-18 | 3d | 决策可追溯、可解释 |
| B5 | ByteEncoder 增量训练接入 | FIX-10 | 2d | 运行时 ByteEncoder 在线学习 |
| B6 | 三进制冷启动预训练 | ITER-08 | 5d | 三进制模型输出有意义 token |
| B7 | BlendBrain 特征扩展 | FIX-13 | 3d | 180 维输入+11 维输出 |

**Phase 3 验收**: 竞争裁决跑通，本地执行可用，三进制模型冷启动完成。

### Phase 4: 高级特性（8-12 周）

| 优先级 | 任务 | 来源 | 工作量 | 验收标准 |
|:------:|------|------|--------|----------|
| C1 | 双世界模型纠缠 | ITER-11 | 5d | 推理宇宙+模拟宇宙联合决策 |
| C2 | 无限成长 MoE 编码器 | ITER-07 | 5d | ByteEncoder MoE 架构，Expert 可增长 |
| C3 | 可视化组装 | ITER-19 | 3d | 输出 SVG 思维导图/流程图 |
| C4 | 能力发现动态路由 | ITER-12 | 3d | ByteEncoder 语义路由覆盖模糊意图 |
| C5 | 训练架构对齐验证 | ITER-09 | 2d | Python 训练 ↔ TS 推理完全兼容 |

**Phase 4 验收**: 高级认知能力可用，MoE 成长机制跑通。

---

## 五、关键发现总结

### 5.1 最有价值的设计方案

1. **统一感知层** (ITER-01): 消除 6 次重复分类，一次计算全链路共享
2. **竞争裁决+可行性门控** (ITER-02): 各模块出方案→裁决→协作执行，前瞻性资源检查
3. **三进制自然生长** (ITER-06): {-1,0,1} 天然支持稀疏生长，推理成本恒定容量无限
4. **信息整合引擎** (ITER-04): 零 LLM 组装，85%+ 日常交互本地完成
5. **法则系统生命周期** (ITER-03): 规则从生成到淘汰的完整管理

### 5.2 最紧急的修复项

1. **feedback() 闭环断裂** (FIX-02): 整个学习闭环失效，三脑无法从结果中学习
2. **SVG XSS 漏洞** (FIX-01): 安全漏洞，恶意代码可执行
3. **BuddyLM 权重加载错位** (FIX-12): 模型输出乱码的根因
4. **setEditingPipeline 未调用** (FIX-03): v5 管线形同虚设
5. **ResourceHub↔ModelPool 断联** (FIX-09): 云端模型画像永远是默认值

### 5.3 文档与代码的差异

| 维度 | 文档描述 | 代码现状 | 差距 |
|------|----------|----------|------|
| 反馈闭环 | 完整的 calibrator→BlendBrain→ResourceHub→TS 闭环 | feedback() 从未被调用 | **完全断裂** |
| 意图分类 | 统一感知层 | 三套独立系统，6 次重复分类 | **未统一** |
| 搜索路径 | 统一为组装引擎管线 | 三条路径并存 | **未统一** |
| 资源感知 | 决策层感知资源可用性 | BlendBrain 采样时不检查资源 | **未实现** |
| 执行监控 | 决策者实时感知执行进度 | 决策后"失明" | **未实现** |
| 本地执行 | 规则引擎输出可执行工具调用 | 只能输出文本建议 | **未实现** |
| 权限系统 | 风险等级门控 | ✅ 已完成 | **已对齐** |
| STMP 升级 | ByteEncoder 语义搜索 | ✅ 已完成 | **已对齐** |
| 细粒度意图 | 语义粗筛+关键词精排 | ✅ 已完成 | **已对齐** |
| 权限重构 | 亲密度≠权限 | ✅ 已完成 | **已对齐** |

---

## 六、附录: 文档分类索引

### FIX 类 (8)
| 文件 | 问题域 | 当前状态 |
|------|--------|----------|
| FIX_PLAN_DETAILED.md | 安全+代码质量 | 未修复 |
| FIX_PLAN_CHAIN.md | 全链路断裂 | 未修复 |
| BUDDYLM_WEIGHT_LOADING_FIX_PLAN.md | 权重加载 | 未修复 |
| BYTEENCODER_TRAIN_FIX_PLAN.md | 训练路径 | 部分修复 |
| RESOURCE_AWARENESS_FIX_PLAN.md | 资源感知 | 未修复 |
| RESOURCE_HUB_FIX_PLAN.md | 资源画像 | 未修复 |
| TOOL_PROPOSAL_FIX_PLAN.md | 工具结果流 | 未修复 |
| BLEND_BRAIN_REPAIR_PLAN.md | NN 信号流 | 未修复 |

### 架构迭代类 (25)
| 文件 | 核心思想 | 价值评级 |
|------|----------|:--------:|
| DISPATCH_REFORM_PLAN.md | 降级→竞争裁决 | ⭐⭐⭐⭐⭐ |
| FIX_PLAN_CHAIN.md | 统一感知层 | ⭐⭐⭐⭐⭐ |
| LAW_SYSTEM_DESIGN.md | 规则→法则进化 | ⭐⭐⭐⭐⭐ |
| INFORMATION_INTEGRATION_ENGINE.md | 零 LLM 组装 | ⭐⭐⭐⭐⭐ |
| CONFIDENCE_REFORM_PLAN.md | 五层评估体系 | ⭐⭐⭐⭐ |
| THREE_BRAIN_DECISION_REFORM_PLAN.md | 神经混合决策 | ⭐⭐⭐⭐ |
| THREE_BRAIN_EXECUTION_AUDIT.md | 执行监控审计 | ⭐⭐⭐⭐ |
| CAPABILITY_ROUTING_SOLUTION.md | 能力发现路由 | ⭐⭐⭐⭐ |
| SEARCH_REFACTOR_PLAN.md | 搜索统一 | ⭐⭐⭐⭐ |
| RESOURCE_AWARENESS_PLAN.md | 资源感知中间件 | ⭐⭐⭐⭐ |
| RESOURCE_HUB_OPTIMIZATION_PLAN.md | 资源画像优化 | ⭐⭐⭐⭐ |
| RULE_ENGINE_ENHANCEMENT_PLAN.md | 规则引擎增强 | ⭐⭐⭐⭐ |
| DUAL_WORLD_MODEL_PLAN.md | 双世界模型 | ⭐⭐⭐⭐ |
| UNIFIED_INTENT_PLAN.md | 统一意图管道 | ⭐⭐⭐⭐ |
| INTENT_COMPLETENESS_PLAN.md | 追问系统统一 | ⭐⭐⭐ |
| WORLD_MODEL_REFORM.md | 世界模型接入 | ⭐⭐⭐ |
| REFACTOR_ASSEMBLY_COLLISION.md | 碰撞×组装改造 | ⭐⭐⭐ |
| VISUAL_ASSEMBLY_PLAN.md | 可视化组装 | ⭐⭐⭐ |
| COMMUNITY_SEPARATION_PLAN.md | 社区商业化分离 | ⭐⭐⭐ |
| PERMISSION_REFACTOR_PLAN.md | 权限重构 | ✅ 已完成 |
| STMP_UPGRADE_PLAN.md | STMP 升级 | ✅ 已完成 |
| FINE_GRAINED_INTENT_PLAN.md | 细粒度意图 | ✅ 已完成 |
| INTEGRATED_LLM_PLAN.md | 集成 LLM 架构 | ⚠️ 已废弃 |
| INTEGRATION_ENGINE_REFORM.md | 整合引擎改造 | ⭐⭐⭐ |
| OPTIMIZATION_PLAN.md | 字典排列组合 | ⭐⭐⭐ |

### 模型训练类 (12)
| 文件 | 核心思想 | 价值评级 |
|------|----------|:--------:|
| ARCHITECTURE_ROADMAP.md | 地基优先策略 | ⭐⭐⭐⭐⭐ |
| ALIGNMENT_PLAN.md | 训练推理对齐 | ⭐⭐⭐⭐⭐ |
| TERNARY_GROWTH_PLAN.md | 三进制自然生长 | ⭐⭐⭐⭐⭐ |
| PRETRAIN_PLAN.md | 联合预训练 | ⭐⭐⭐⭐ |
| TERNARY_PRETRAIN_PLAN.md | 三进制冷启动 | ⭐⭐⭐⭐ |
| INFINITE_GROWTH_PLAN.md | MoE 无限成长 | ⭐⭐⭐⭐ |
| BUDDYLM_ASSEMBLY_INTEGRATION_PLAN.md | 解绑架构 | ⭐⭐⭐⭐ |
| ENCODER_ENHANCEMENT_PLAN.md | 语义增强 | ⭐⭐⭐ |
| ENCODER_UNIFICATION_PLAN.md | 编码器统一 | ⭐⭐⭐ |
| WEIGHT_LOADING_DEEP_ANALYSIS.md | 权重加载分析 | ⭐⭐⭐ |
| BuddyLM_256D_RETRAIN_PLAN.md | 256d 重训 | ⭐⭐⭐ |
| BYTEENCODER_UPGRADE_PLAN.md | ByteEncoder 升级 | ⭐⭐⭐ |

### 功能增强类 (13)
| 文件 | 核心思想 | 价值评级 |
|------|----------|:--------:|
| LOCAL_EXECUTION_MASTERY_PLAN.md | 本地执行补全 | ⭐⭐⭐⭐⭐ |
| LOCAL_EXECUTION_DETAIL_PLAN.md | 本地执行详细方案 | ⭐⭐⭐⭐ |
| KNOWLEDGE_TIER_PLAN.md | 知识分层冷启动 | ⭐⭐⭐⭐ |
| EXPERIENCE_MODEL_PLAN.md | 专家经验模型 | ⭐⭐⭐⭐ |
| BRAIN_GAP_CLOSURE_PLAN.md | 三脑缺口修复 | ⭐⭐⭐⭐ |
| KG_GROWTH_PLAN.md | 知识图谱成长 | ⭐⭐⭐ |
| TASK_AWARE_SOURCE_ROUTER_PLAN.md | 精准源路由 | ⭐⭐⭐ |
| DISPATCH_REFORM_PLAN_FEASIBILITY.md | 可行性门控 | ⭐⭐⭐ |
| CROSS_VALIDATION.md | 交叉验证 | ⭐⭐⭐ |
| PHASE0_DECISIONS.md | 架构参数锁定 | ⭐⭐⭐ |
| INTELLIGENCE_FORMULA.md | 智能公式 E=mc² | ⭐⭐ |
| BYTEENCODER_IDLE_TRAIN_PLAN.md | 空闲训练 | ⭐⭐ |
| CCA_GRADIENT_TRAINING_PLAN.md | CCA 梯度训练 | ⭐⭐ |
