# Buddy 源码深度分析文档

> 基于 v0.2.0 源码的完整代码级分析 | 2026-04-28

---

## 一、项目概览

| 维度 | 数据 |
|------|------|
| **定位** | 有形象的个人 AI 助手 — 有脸、有性格、有能力、有记忆 |
| **版本** | v0.2.0 |
| **后端源文件** | 152 个 .ts 文件（非测试） |
| **前端源文件** | 62 个 .ts/.tsx 文件（非测试） |
| **总代码行数** | ~98,900 行 TypeScript |
| **SQLite 数据库** | 6 个独立库 + 1 个经验图谱库 |
| **Git 历史** | 101 次提交，活跃于 2026-04-25 ~ 2026-04-28 |
| **License** | MIT |

---

## 二、技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 22+ / TypeScript 6 / ESM |
| LLM | Vercel AI SDK (generateText/streamText/tool) |
| 数据库 | better-sqlite3 (WAL 模式) |
| 通信 | WebSocket (ws) + HTTP REST |
| 前端 | React 19 + Vite |
| 渲染 | PIXI.js (2D 精灵动画) |
| 测试 | Vitest + Playwright |
| 桌面 | Electron 41 + electron-builder |
| 部署 | Docker + Docker Compose |
| 数据校验 | Zod |
| 支付 | Stripe |

---

## 三、核心入口链

```
main.ts (CLI 入口: init / status / 交互模式)
  └→ BuddyAgent (core/agent.ts — ~1400 行)
       └→ Subsystems (core/subsystems.ts — ~500 行, 50+ 子模块容器)
            ├→ LLMAdapter          — 多 Provider + Fallback + 熔断
            ├→ ToolRegistry         — 工具注册表 (32 内置 + 27 .skillmate + MCP)
            ├→ MemoryStore          — SQLite + FTS5 全文搜索
            ├→ STMPStore            — 时空记忆宫殿
            ├→ DreamEngine          — 梦境巩固引擎
            ├→ CognitiveEngine      — 认知三层架构
            ├→ EmotionEngine        — Buff 叠加情绪系统
            ├→ DesireEngine         — 六欲引擎
            ├→ ExperienceEngine     — 自产智能引擎
            ├→ TernaryExpertRouter  — 三进制推理
            ├→ BuddyClock           — 自主时钟
            ├→ WorkflowManager      — DAG 编排
            ├→ 6 个平台适配器       — CLI/Telegram/Discord/飞书/企微/钉钉
            └→ 30+ 更多模块
```

---

## 四、后端模块详解

### 4.1 核心引擎层 (`src/core/`)

#### 4.1.1 LLM 适配层 (`llm.ts` — 915 行)

**架构**：三层路由 + 熔断 + 重试

```typescript
class LLMAdapter {
  private router: ModelRouter;           // 任务类型 → 模型选择
  private toolCaller: UniversalToolCaller; // 不支持 FC 的模型降级
  private poolScheduler: ModelPoolScheduler | null; // 多模型池
  private decisionRecorder: DecisionRecorder | null; // 决策记录

  // 熔断器
  private failureCount = 0;
  private readonly CIRCUIT_FAIL_THRESHOLD = 5;
  private readonly CIRCUIT_OPEN_MS = 30_000;

  // 重试
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;
}
```

**关键设计**：
- **ProviderFactory** 工厂模式，支持 8 种 Provider（openai / deepseek / anthropic / google / ollama / mimo / custom / siliconflow）
- **ModelRouter** 按 TaskType（chat / tools / reasoning / background / domain）选模型
- **UniversalToolCaller** — 不支持 Function Calling 的模型通过 Prompt 模拟工具调用
- **Fallback 链**：主模型 → lightweight → fallbacks
- **DecisionRecorder** — 每次调用记录决策，为经验学习提供数据

#### 4.1.2 模型路由器 (`model-router.ts`)

```typescript
type TaskType = 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';

const AUTO_TABLE: Record<TaskType, 'primary' | 'lightweight'> = {
  chat: 'lightweight',
  tools: 'lightweight',
  reasoning: 'primary',
  background: 'lightweight',
  domain: 'primary',
};
```

- **任务类型推断**：关键词匹配（TOOL_KEYWORDS / REASONING_KEYWORDS）
- **本地专家注册**：三进制模型注册为 LocalExpert，按 domain 匹配
- **学习偏好**：从历史决策中学习哪种模型在哪种任务上表现更好

#### 4.1.3 模型池 (`model-pool.ts`)

- **EWMA 滑动窗口统计**：成功率和延迟用指数加权移动平均（alpha=0.3）
- **熔断/恢复机制**：连续 3 次失败熔断，1 分钟后尝试恢复
- **能力推断**：根据 provider/model 自动推断 toolCalling / vision / streaming 等能力
- **分维度统计**：按 taskType 分别统计，避免 routing collapse

#### 4.1.4 决策记录器 (`decision-recorder.ts`)

- **JSONL 持久化**：追加写入，不重写整个文件
- **kNN 相似查询**：基于 Jaccard token 集合相似度
- **分维度统计**：按 nodeId + taskType 统计成功率和延迟
- **最大 5000 条记录**，超限裁剪

#### 4.1.5 Prompt 预算管理器 (`prompt-budget.ts`)

**核心思想**：System Prompt 不是越大越好，按优先级填充，超预算截断低优先级段。

**12 级优先级**：

| 级别 | 名称 | 值 | 说明 |
|------|------|---|------|
| 1 | SECURITY | 100 | 安全指令，绝不可丢 |
| 2 | CORE_INSTRUCTION | 95 | 核心行为指令 |
| 3 | TRUST_PERMISSIONS | 90 | 信任度/工具权限 |
| 4 | TOOLS | 80 | 工具列表 |
| 5 | EXPERIENCE_HINT | 75 | 经验提示 |
| 6 | PERSONALITY | 70 | 人格属性 |
| 7 | EMOTION | 60 | 情绪状态 |
| 8 | COGNITIVE | 50 | 用户认知画像 |
| 9 | MEMORY | 40 | 记忆检索 |
| 10 | DOMAIN_KNOWLEDGE | 30 | 领域知识 |
| 11 | SKILLS | 20 | 动态技能列表 |
| 12 | SUPPLEMENTARY | 10 | 补充信息 |

**任务类型动态调整**：
- reasoning → memory +20, knowledge +20, experience +10
- tools → tools +15, skills +10
- chat → personality +15, emotion +15, cognitive +10

#### 4.1.6 意图分类器 (`intent-classifier.ts`)

**8 种意图类别**：

| 类别 | 关键词示例 | 推荐工具 |
|------|-----------|---------|
| file_operations | 读/写/文件/read/write/file | read_file, write_file, list_files, exec |
| code_operations | 代码/函数/分析/analyze/refactor | read_file, write_file, exec, search_files, code_intel |
| git_operations | git/提交/commit/分支/merge | git_status, git_diff, git_commit, git_branch, exec |
| web_operations | 搜索/search/网页/url/抓取 | search_web, fetch_url, browse |
| system_operations | 运行/执行/命令/端口/服务 | exec, get_time |
| knowledge_query | 是什么/为什么/怎么/how/why | search_web |
| conversation | 你好/hello/谢谢/thanks | [] |
| complex_task | 匹配 ≥2 个类别 | 合并多类别工具 |

- **零延迟关键词匹配**
- **置信度** = min(1, 匹配词数 / 3)

#### 4.1.7 澄清决策器 (`clarifier.ts`)

**基于 MAC (arXiv:2512.13154)**

- **5 种问题类型**：ambiguity / conflict / resource / deviation / none
- **目标冲突检测**：简化 vs 扩展、性能 vs 功能、删除 vs 保留、安全 vs 便捷
- **每会话最多 2 次澄清**
- **风险调整阈值**：high risk 时 1 个歧义就澄清

#### 4.1.8 内心独白引擎 (`inner-thoughts.ts`)

**基于 Inner Thoughts (arXiv:2501.00383)** — 纯规则触发，不调 LLM

- **5 种检测**：用户不确定词、技术术语未解释、连续同类问题、可能的错误信息、文件提及但无操作
- **两级队列**：高紧急度(>0.6) → 立即插入，中紧急度(0.3-0.6) → 待定

#### 4.1.9 消息处理器 (`message-processor.ts` — 1050+ 行)

**分层缓存优化**：
- **静态层**：信任度变化才重建（~50x 减少重建频率）
- **半动态层**：每 10 次交互更新一次
- **投机预执行**：不等 LLM 决策，立即预取高置信度经验中的只读工具

**工具裁剪策略**：
1. 意图分类器快速裁剪（关键词匹配，零延迟）
2. 语义检索（意图分类不确定时兜底）

#### 4.1.10 多源融合缓冲区 (`fusion-buffer.ts`)

- **多源并发写入**：无需加锁（Node.js 单线程天然原子）
- **自动关联检测**：概念重叠度 > 0.3 自动关联，> 0.5 支持关系
- **矛盾信息标记**：不覆盖，标记为 warning
- **30 秒窗口定时融合**：合并关联条目 → 检测矛盾 → 重要性加权 → 写入 STMP

#### 4.1.11 工具合成器 (`tool-synthesizer.ts`)

**经验 → 工具桥接**：高频经验单元自动生成 .skillmate 工具

- **触发条件**：置信度 > 0.8 且成功次数 > 5 且步骤 ≤ 5
- **参数泛化**：从具体值提取参数模板（路径/数字/布尔/URL）
- **质量门**：验证名称合法性、描述长度、参数完整性、命令安全性
- **安全检查**：不允许命令包含 `;|&`$()` 等危险字符

#### 4.1.12 BuddyClock 自主时钟 (`buddy-clock.ts` — 450+ 行)

**不是 cron，是自主意识的时钟**

- **心跳机制**：每 5 分钟检查一次（可配置）
- **4 种时钟阶段**：active / idle / sleeping / away
- **规律学习器** (`RoutineLearner`)：从对话历史统计发现主人的活跃时段、工作日/周末差异、常见话题
- **提醒引擎** (`ReminderEngine`)：支持 once / recurring / pattern 三种触发类型
- **主动行为引擎** (`ProactiveEngine`)：6 种行为类型（greeting / care / maintenance / learning / reminder / reflection），所有生成都经过 LLM
- **状态持久化**：JSON 快照写入磁盘

#### 4.1.13 执行会话 (`execution-session.ts`)

- **4 级自主等级**：
  - L0：每步都确认（新用户/高风险）
  - L1：关键步骤确认
  - L2：仅高危操作确认
  - L3：全自动（低风险 + 长会话 + 无纠正）
- **风险评估**：high(deploy/rm/push --force) / medium(write/create/install) / low
- **检查点机制**：每 N 步设置检查点

#### 4.1.14 其他核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| Subsystems | `subsystems.ts` | 50+ 子模块统一初始化容器 |
| Agent | `agent.ts` | 主类，串联所有子系统 |
| WSHandler | `ws-handler.ts` | WebSocket 消息处理 |
| LinkHandler | `link-handler.ts` | 通信链路管理 |
| BehaviorTracker | `behavior-tracker.ts` | 行为信号追踪 |
| SkillOps | `skill-ops.ts` | 能力包操作 |
| Constants | `constants.ts` | 安全规则 + 工具确认逻辑 |
| ResponseNormalizer | `response-normalizer.ts` | 响应格式统一 |
| DBManager | `db-manager.ts` | 6 个数据库统一管理 |
| Migration | `migration.ts` | Schema 版本管理 |
| ProviderRegistry | `provider-registry.ts` | Provider 注册表 |
| ProviderAdapter | `provider-adapter.ts` | Provider 适配器 |
| ProviderLimiter | `provider-limiter.ts` | Provider 限流 |
| ModelPoolScheduler | `model-pool-scheduler.ts` | 模型池调度器 |
| ConcurrencyLimiter | `concurrency-limiter.ts` | 并发限制 |
| TaskQueue | `task-queue.ts` | 任务队列 |
| LinkDiagnostics | `link-diagnostics.ts` | 链路诊断 |
| LinkTypes | `link-types.ts` | 链路类型定义 |
| CapabilityProber | `capability-prober.ts` | 能力探测 |
| MockLLM | `mock-llm.ts` | LLM Mock（测试用） |

---

### 4.2 情绪系统 (`src/emotion/engine.ts` — 450+ 行)

**架构**：The Sims 风格 Buff 叠加 + RimWorld 人格修正 + Buddy 独创表达自由度

#### 8 维连续情绪空间（Plutchik 情绪轮）

```typescript
interface EmotionVector {
  joy: number;           // 喜悦 0-100
  sadness: number;       // 悲伤 0-100
  anger: number;         // 愤怒 0-100
  fear: number;          // 恐惧/焦虑 0-100
  surprise: number;      // 惊讶 0-100
  disgust: number;       // 厌恶/不满 0-100
  trust: number;         // 信任 0-100
  anticipation: number;  // 期待 0-100
}
```

#### 20+ 种 Buff 模板

| Buff | 效果 | 持续时间 | 衰减 |
|------|------|---------|------|
| user_message | anticipation +5, sadness +4 | 60s | 0.95 |
| tool_success | joy +8, trust +3 | 300s | 0.98 |
| tool_error | sadness +15, anger +35 | 300s | 0.98 |
| evolution | joy +37, surprise +20, trust +15 | 1800s | 0.96 |
| user_voice_happy | joy +12, trust +5 | 180s | 0.96 |
| discovery | surprise +15, joy +10, anticipation +8 | 900s | 0.97 |
| continuous_work | sadness +12, fear +5 | 1200s | 0.99 |
| dream_complete | joy +10, trust +8 | 600s | 0.98 |

#### 核心机制

- **BuffPool**：最大 20 层上限，可叠加/淘汰/衰减
- **人格修正**：支持旧 5 维（snark/wisdom/chaos/patience/debugging）和新 OCEAN 大五模型
- **表达自由度**：`chooseExpression()` 不直接暴露内部状态，Buddy "选择" 怎么表现
  - 亲密度低时克制表达（`expressFactor = 0.5 + authenticity`）
  - 人格强度低时随机 mood（混沌阶段）
- **多源融合**：`updateFromSource()` 支持多专家/多渠道情绪加权融合
- **7 种离散 Mood**：energetic / calm / tired / excited / frustrated / happy / thinking / confused

---

### 4.3 人格系统 (`src/personality/ocean.ts`)

#### 大五人格 OCEAN

| 维度 | 低值表现 | 高值表现 |
|------|---------|---------|
| Openness(开放性) | 按部就班，不爱尝试 | 天马行空，充满好奇 |
| Conscientiousness(尽责性) | 随性，想到什么做什么 | 极度自律，绝不半途而废 |
| Extraversion(外倾性) | 话少，喜欢安静观察 | 话痨，总能找到话题 |
| Agreeableness(宜人性) | 非常直接，不绕弯子 | 极度温柔，几乎从不反驳 |
| Neuroticism(神经过敏) | 泰山崩于前面不改色 | 一点小事就能影响情绪 |

#### 10 种物种基线

每种物种有独立的 OCEAN 基线值 + 偏向乘数，同物种也有随机抖动（0.7~1.3 jitter）。

#### personalityStrength (PS)

- **0→1 浮点数**，表示"人格对行为的控制力"
- PS=0：纯混沌，人格对行为无影响
- PS=1：完全人格驱动，行为可预测
- 从进化阶段计算：egg(0.0) → hatching(0.1) → growing(0.3) → formed(0.5) → mature(0.7) → complete(0.85) → legendary(0.95)

#### 行为涌现计算

从使用上下文计算人格变化（增量更新 + 物种倾向 + 随机噪声 + 成长惯性）：
- O：新发现多/领域广 → 升高；纯重复操作 → 降低
- C：完成率高 → 升高；放弃/反复出错不修 → 降低
- E：消息长/主动发言/反馈多 → 升高；被动短回复 → 降低
- A：感谢/软纠正多 → 升高；硬否定多 → 降低
- N：连续错误多 → 升高；成功恢复/长期稳定 → 降低

---

### 4.4 记忆系统 (`src/memory/`)

#### 4.4.1 STMP 时空记忆宫殿 (`stmp.ts` — 550+ 行)

**架构**：房间 + 时间轴 + 语义星图 + FTS5

**数据模型**：

```typescript
interface MemoryNode {
  content: string;
  room: string;                    // 所属房间 ID
  timestamp: number;               // 时间坐标
  temporalContext: { before, after, duration }; // 时间轴
  concepts: string[];              // 语义概念标签
  relations: Array<{ target, type, strength }>; // 关联关系
  emotional: { valence, importance, userMarked }; // 情绪/重要度
  lifecycle: { decay, compressed, hibernated, accessCount }; // 生命周期
  source: 'conversation' | 'learned' | 'observed' | 'dream' | 'extracted';
}
```

**四步检索**：
1. **定位房间**：标签匹配 → 名称匹配 → FTS5 全文搜索
2. **时间轴导航**：房间内搜索 + 时间排序
3. **语义星图扩展**：概念关联 → 跨房间关联
4. **叙事组装**：LLM 增强 / 降级字符串拼接

**Ebbinghaus 衰减**：
```typescript
calculateDecay(node): number {
  const hoursSinceAccess = (Date.now() - lastAccessed) / 3600000;
  const baseDecay = Math.exp(-hoursSinceAccess / 168); // 半衰期 1 周
  return baseDecay + accessBoost + importanceBoost;
}
```

**压缩**：同房间同时期碎片记忆合并

#### 4.4.2 梦境巩固引擎 (`dream.ts` — 380+ 行)

**四阶段流程**：

| 阶段 | 做什么 | 细节 |
|------|--------|------|
| Phase 1: 回放 | 选取近期 50 条 + 高重要度久未访问 10 条 | 分析频繁概念、时间相近但无关联的记忆、重要但衰减严重的记忆 |
| Phase 2: 提取 | LLM 深度分析 / 规则聚类降级 | 从洞察中提炼 2-5 个有价值的模式 |
| Phase 3: 关联 | 5 次随机漫步（创造性联想） | 不按权重选边，随机选 — 创造性联想，跨房间概率 30% |
| Phase 4: 修剪 | 衰减更新 + 房间压缩 | Ebbinghaus 衰减 + 同房间同时期碎片合并 |

**梦境日志**：有情感叙述的自动生成文本

#### 4.4.3 推理链持久化 (`reasoning-chain.ts`)

**基于 Hindsight (arXiv:2512.12818)** — 跨轮对话的结构化推理记忆

- 结论记录：多次验证提升置信度
- 未解决问题追踪：openQuestions 列表
- 2 小时过期，最大 50 条链
- Prompt 注入：最多 3 条，每条最多 200 字符

#### 4.4.4 信念存储 (`belief-store.ts`)

**基于 Hindsight — Evolving Beliefs**

- **3 种来源**：inferred(推断, 初始 0.3) / told(被告知, 初始 0.7) / observed(观察, 初始 0.5)
- 支撑/反驳证据：多次验证提升置信度，矛盾时降低
- JSON 持久化：定期快照写入磁盘
- 最大 100 条信念

#### 4.4.5 实体存储 (`entity-store.ts`)

与信念存储类似架构，存储实体信息（人物/技术/概念）。

---

### 4.5 认知系统 (`src/cognitive/engine.ts` — 650+ 行)

**三层架构**：

| 层 | 内容 | 示例 |
|---|------|------|
| 用户模型 | 身份/行为/偏好/关系 + 演化历史 | "前端开发，偏好简洁代码，晚上活跃" |
| 自我模型 | 能力认知/经历叙事/情绪状态 | "擅长 TypeScript，上周学会了三进制推理" |
| 意图引擎 | 微目标/好奇心/主动行为 | "想深入了解用户的 Rust 项目" |

**领域画像**：
```typescript
interface DomainProfile {
  domain: string;
  domainType: 'rule_based' | 'llm_assisted' | 'hybrid';
  knowledgeCount: number;
  depthScore: number;      // 0-1
  growthStage: 'seed' | 'sprout' | 'growing' | 'trainable' | 'mature';
}
```

---

### 4.6 驱动力系统

#### 4.6.1 六欲引擎 (`src/desire/engine.ts`)

**6 维欲望**：

| 欲望 | 计算公式 | 行为冲动阈值 |
|------|---------|-------------|
| hunger(食欲) | 100 - energy | >90: 主动问候, >70: 探头看用户 |
| curiosity(求知欲) | baseline + pending×10 + seed×8 + discoveries×15 | >75: 主动提问, >60: 深入追问 |
| social(社交欲) | baseline + messages×3 + corrections×15 + lowIntimacy×20 | >80: 回复更长更主动 |
| safety(安全欲) | baseline + errors×12 + stranger×15 | >70: 回复变保守, >60: 多确认一次 |
| expression(表达欲) | baseline + taskComplete×8 + discoveries×12 | >80: 主动总结发现 |
| rest(休息欲) | baseline + work×0.5 + lateNight×30 + lowEnergy×25 | >90: 立即触发梦境, >80: 回复变短变慢 |

**自然衰减**：每 2 分钟 tick

#### 4.6.2 情绪 × 欲望 × 人格 交互

```
OCEAN 人格 → 情绪 Buff 调制系数
OCEAN 人格 → 欲望基线偏移
六欲引擎 → 行为冲动 → 主动行为
情绪引擎 → Prompt 注入 → 回复风格
```

---

### 4.7 自产智能 (`src/intelligence/` — 15 文件)

#### 4.7.1 经验图谱 (`experience-graph.ts`)

- **SQLite 持久化**：`exp_nodes` + `exp_edges`
- **倒排索引**：keyword → expId 集合，O(候选) 替代 O(n) 全量遍历
- **预编译正则**：避免每次 match 重复 `new RegExp`
- **自动发现边**：共享关键词→enhances，同意图→alternative，输出→requires
- **3 种边类型**：requires / enhances / alternative

#### 4.7.2 经验路由器 (`experience-router.ts`)

**Thompson Sampling + 四层路由**

```typescript
route(input): RouteDecision {
  // Thompson Sampling 选候选
  const selected = thompsonSelect(candidates);

  // 四层路由
  if (novelty >= 0.9) return { path: 'llm_only' };           // 极高新颖度
  if (confidence >= 0.8 && successCount >= 3) return { path: 'exp_direct' }; // 高置信度
  if (confidence >= 0.5) return { path: 'exp_verified' };     // 中置信度
  return { path: 'llm_with_hint' };                           // 低置信度
}
```

**Thompson Sampling**：
- Beta(α,β) 分布采样，α=成功次数+1, β=失败次数+1
- Gamma 分布近似（Marsaglia & Tsang 方法）
- 探索系数控制探索力度

**新颖度计算**：1 - (关键词覆盖率×0.5 + 成熟度×0.3 + 置信度×0.2)

#### 4.7.3 其他智能模块

| 模块 | 职责 |
|------|------|
| ExperienceCompiler | 对话→经验单元编译 |
| ExperienceExecutor | 确定性工具执行 |
| ExperienceEvolver | 经验积累/合并/淘汰 |
| KnowledgeInterviewer | 知识缺口检测 + 追问问题生成 |
| DataAugmentor | 训练数据扩增 |
| PromptInjector | 知识注入 Prompt |
| TrainingExporter | JSONL 格式导出 |
| KnowledgeExporter | 领域知识包导出 |
| CheckFunction | 验证函数 |
| Metrics | 量化指标采集 |

#### 4.7.4 知识提取器 (`knowledge/extractor.ts`)

**六类隐性知识**：

| 类型 | 说明 | 示例 |
|------|------|------|
| decision_rule | 什么情况下选A不选B | "40岁以下骨折多为高能量损伤" |
| exception | 常规方法不管用时怎么办 | "老年人Colles骨折保守治疗可能更好" |
| pattern_recognition | 一看就知道 | "对方律师一直在外围试探，说明没有实锤" |
| risk_judgment | 什么情况下会出事 | "三年后这个连接处一定会出问题" |
| human_factor | 怎么跟人打交道 | "这个学生不是不会，是不想学" |
| failure_experience | 判断失误的教训 | "之前忽略了XX导致失败" |

---

### 4.8 工具系统 (`src/tools/` — 19 文件)

#### 32 个内置工具

| 类别 | 数量 | 工具 |
|------|------|------|
| 文件操作 | 4 | read_file / write_file / list_files / search_files |
| Shell | 1 | exec（沙箱隔离） |
| Git | 7 | git_status / git_log / git_diff / git_commit / git_branch / git_merge / git_push |
| 网络 | 2 | search_web / fetch_url |
| 代码智能 | 2 | analyze_file / find_references |
| 浏览器 | 3 | browser_screenshot / browser_extract / browser_pdf |
| 屏幕 RPA | 3 | screen_capture / screen_ocr / screen_describe |
| 语音 TTS | 3 | tts_speak / tts_voices / tts_status |
| 项目索引 | 6 | scan_project / project_context / project_symbols / project_deps / project_index_stats / project_index_rebuild |
| 系统 | 1 | get_time |

#### 27 个 .skillmate 动态工具

声明式格式定义：video_info / video_cut / video_concat / video_speed / video_to_gif / video_extract_audio / audio_info / image_resize / image_convert / pdf_extract / subtitle_extract / json_query / base64_tool / hash_compute / system_info / disk_usage / port_check / process_list / docker_ps / log_tail / npm_run / lint_check / format_code / run_tests / github_info / weather / dependency_audit

#### 沙箱 (`sandbox.ts`)

- **30+ 危险模式正则黑名单**：rm -rf / fork 炸弹 / 数据外泄 / 权限提升 / 系统修改
- **数据外泄检测**：`| curl/wget/nc` 管道到网络工具
- **敏感路径保护**：.ssh / .env / 私钥 / AWS 凭据
- **环境变量清理**：自动删除 SECRET/TOKEN/KEY/PASSWORD 变量
- **符号链接逃逸检测**：`fs.realpath()` 验证真实路径
- **白名单模式**：strict 模式下只允许预定义命令

#### MCP 适配器 (`mcp-adapter.ts`)

- JSON-RPC over stdio
- 6 个预置 Server：filesystem / github / memory / puppeteer / slack / postgres
- 支持 Smithery 市场搜索安装

#### 工具检索器 (`tool-retriever.ts`)

语义检索可用工具子集，注入 LLM prompt，避免 32+ 工具全量注入导致 token 浪费。

#### 工具链 (`tool-chain.ts`)

多工具串联执行，前一步输出自动传给下一步。

---

### 4.9 养成系统 (`src/pet/`)

#### 6 阶段进化

```
蛋(egg) → 幼年(hatching) → 成长(growing) → 成熟(formed) → 完全(mature) → 传说(legendary)
```

#### 5 维行为涌现

```typescript
interface BehaviorSignals {
  snark: number;     // 从用户反馈/纠正中涌现
  wisdom: number;    // 从成功任务/学习中涌现
  chaos: number;     // 从随机行为/意外中涌现
  patience: number;  // 从重复交互/容忍中涌现
  debugging: number; // 从工具使用/调试中涌现
}
```

**关键设计**：性格不是预设的，是从使用行为中涌现的。`BehaviorTracker` 追踪用户交互信号，更新 5 维数值。

#### 27 个功能节点探索

探索地图：基础(6) / 进阶(8) / 专家(8) / 隐藏(5)

#### 亲密度系统

0-100 分值，影响信任度等级（stranger → acquaintance → friend → close_friend → soulmate），进而影响权限。

---

### 4.10 三进制引擎 (`src/ternary/` — 16 文件)

#### 完整 ML 管道

| 模块 | 职责 |
|------|------|
| engine.ts | 推理引擎，纯 CPU 整数运算 |
| trainer.ts | 增量训练器（t-SignSGD） |
| optimizer.ts | 优化器 |
| distill.ts | 知识蒸馏 |
| format.ts | .ta 模型格式 |
| codec.ts | 编解码 |
| compute.ts | 矩阵乘法 / layerNorm / gelu / softmax |
| tokenizer.ts | 自定义 tokenizer |
| scheduler.ts | 训练任务调度 |
| manager.ts | 模型生命周期管理 |
| growth.ts | 成长系统（5 阶段） |
| cloud-trainer.ts | 云端训练对接 |
| architecture.ts | 架构定义 |
| eval.ts | 评估 |
| distill-prep.ts | 蒸馏准备 |

#### 5 阶段成长

| 阶段 | 训练策略 | 阈值 |
|------|---------|------|
| seed | 无训练，等待蒸馏注入 | 初始状态 |
| sprout | 蒸馏完成，少量增量训练 | 10 步 |
| growing | 活跃训练期，夜间自动训练 | 100 步 + 50 样本 |
| trainable | 知识积累充分，深度微调 | 1000 步 + 0.6 覆盖度 |
| mature | 稳定期，仅微调，核心冻结 | 5000 步 + 10 稳定轮 |

---

### 4.11 DAG 编排 (`src/orchestrate/` — 8 文件)

```typescript
class DAGPlanner {
  async plan(userIntent): Promise<TaskDAG> {
    // 1. 语义检索可用工具（ToolRetriever）
    // 2. LLM 生成任务计划
    // 3. 解析为 TaskDAG（含条件分支/重试/超时/并行）
  }
}
```

**TaskDAG 数据结构**：
- `tasks: Map<string, Task>` — 任务节点
- `edges: ConditionEdge[]` — 条件边（if/else）
- `parallelGroups: string[][]` — 并行执行组
- 每个 Task 支持 `retry: { max, delayMs, backoff: 'exponential' }`

**6 种协作模式**：local_only / single / parallel / cascade / sequential / debate

---

### 4.12 社交系统 (`src/social/` — 8 文件)

| 适配器 | 平台 | 特殊能力 |
|--------|------|---------|
| CLIAdapter | 终端 | readline 交互 |
| TelegramAdapter | Telegram | Bot API |
| DiscordAdapter | Discord | Discord.js |
| FeishuAdapter | 飞书 | 开放平台 |
| WeComAdapter | 企业微信 | 加解密 (wecom-crypto.ts) |
| WeChatMPAdapter | 微信公众号 | 消息加解密 |
| DingTalkAdapter | 钉钉 | stream/webhook 双模式 |

---

### 4.13 商业化 (`src/billing/` + `src/shop/`)

- SubscriptionManager：Free / Pro / Team 订阅
- EntitlementChecker：权益检查
- PaymentManager：Stripe 支付集成
- ShopCatalog：商城商品目录
- ModelInstaller：.ta 模型安装/卸载

---

### 4.14 其他后端模块

| 模块 | 文件 | 职责 |
|------|------|------|
| PrivacyManager | `perception/privacy.ts` | 6 种硬件权限 + 信任度联动 + 审计日志 |
| PerceptionEventBus | `perception/event-bus.ts` | 事件驱动感知 |
| EnvironmentObserver | `perception/observer.ts` | 文件系统变化感知 |
| FileWatcher | `perception/fs-watcher.ts` | 文件监听 |
| LaunchReadiness | `launch/readiness.ts` | 启动前健康检查 |
| LoRAService | `lora/` | LoRA 微调服务 |
| AuditLogger | `audit/logger.ts` | 审计日志 |
| StructuredLogger | `audit/structured-logger.ts` | 结构化日志 |
| EnvironmentDetect | `env/detect.ts` | 运行环境检测 |
| Errors | `errors.ts` | 分类错误 + 用户友好消息 |
| LRUCache | `perf/cache.ts` | LRU + TTL 缓存 |
| IdleBehavior | `behavior/idle.ts` | 空闲行为 |
| TTSManager | `voice/tts.ts` | TTS 管理 |
| EdgeTTSBackend | `voice/edge-tts.ts` | Edge TTS 后端 |
| Demo | `demo.ts` | 演示模式 |

---

## 五、前端模块详解

### 5.1 主入口 (`App.tsx`)

- WebSocket 连接管理（自动获取 Token）
- 状态机：connecting → onboarding → connected
- 10 个 Tab：chat / tools / memory / activity / stats / vision / sensors / experts / cognitive / settings
- 情绪过渡音效追踪

### 5.2 组件体系

| 组件 | 职责 |
|------|------|
| Onboarding | 首次使用引导（选主色调→质感→气质→LLM 配置） |
| SpriteRenderer | PIXI.js 精灵渲染，情绪驱动动画 |
| ChatPanel | 对话面板，支持 Markdown 渲染 |
| MessageBubble | 消息气泡 |
| InputBar | 输入栏 |
| CognitiveDashboard | 认知状态可视化 |
| ExplorationMap | 27 个功能节点探索地图 |
| Experts | 多专家并行面板 |
| AgentTrace | Agent 执行轨迹可视化 |
| ToolPanel | 工具面板（使用统计/成功率） |
| MemoryPanel | 记忆面板（领域/知识统计） |
| SensorPanel | 传感器面板 |
| VisionPanel | 视觉面板 |
| Settings | 设置面板（LLM 配置/模型测试） |
| PetStats | 养成状态 |
| ActivityPanel | 活动面板 |
| ToolCallCard | 工具调用卡片 |
| EmptyState | 空状态 |
| ErrorBoundary | 错误边界 |
| svgComponents | SVG 组件 |

### 5.3 音频系统 (`audio/`)

- engine.ts：音频引擎
- sfx-player.ts：音效播放器
- use-audio.ts：React hook

### 5.4 前端情绪系统 (`emotion/`)

- emotion-particles.ts：情绪粒子效果
- emotion-sound.ts：情绪音效
- index.ts：统一入口

### 5.5 前端通信 (`comm/`)

- link.ts：通信链路
- shared-connection.ts：共享连接（多组件复用）
- types.ts：通信类型定义

### 5.6 前端语音系统 (`voice/` — 8 文件)

| 模块 | 职责 |
|------|------|
| stt.ts | 语音转文字 |
| wakeword.ts | 唤醒词检测 |
| emotion-voice.ts | 语音情绪识别 |
| audio-stream.ts | 音频流处理 |
| mic-manager.ts | 麦克风管理 |
| sound-events.ts | 声音事件 |
| audio-interface.ts | 音频接口 |
| index.ts | 统一入口 |

### 5.7 前端视觉系统 (`vision/` — 8 文件)

| 模块 | 职责 |
|------|------|
| camera.ts | 摄像头接口 |
| camera-interface.ts | 摄像头接口定义 |
| face-detect.ts | 人脸检测 |
| ocr.ts | OCR 文字识别 |
| scene-analyze.ts | 场景分析 |
| frame-capture.ts | 帧捕获 |
| privacy.ts | 隐私保护 |
| omni.ts | 全模态理解 |
| screen.ts | 屏幕捕获 |
| index.ts | 统一入口 |

### 5.8 前端传感器系统 (`sensors/` — 6 文件)

| 模块 | 职责 |
|------|------|
| environment.ts | 环境感知（时间/天气） |
| location.ts | 地理位置 |
| motion.ts | 运动检测 |
| context-fusion.ts | 多传感器融合 |
| sensor-interface.ts | 传感器接口 |
| sensors.ts | 统一入口 |

### 5.9 其他前端模块

| 模块 | 职责 |
|------|------|
| hooks/useWebSocket.ts | WebSocket React hook |
| hooks/useVoiceEmotion.ts | 语音情绪 React hook |
| i18n/index.ts | 国际化（多语言） |
| utils/markdown.tsx | Markdown 渲染工具 |
| types/buddy.ts | Buddy 类型定义 |
| types/device-types.ts | 设备类型定义 |
| types/browser-apis.d.ts | 浏览器 API 类型声明 |

---

## 六、数据流架构

```
用户输入
  ↓
WSHandler.handleUserMessage()
  ↓
┌─ BehaviorTracker.onMessage()      → 更新行为信号
├─ FeedbackLearner.detectCorrection() → 检测纠正
├─ EmotionEngine.onUserMessage()     → 添加 Buff
├─ DesireEngine.onUserMessage()      → 更新欲望
├─ PetManager.feed()                 → 养成喂食
├─ MemoryStore.saveMessage()         → 持久化
└─ BuddyClock.notifyInteraction()    → 更新规律
  ↓
MessageProcessor.buildContext()
  ├→ 投机预执行（高置信度经验只读工具预取）
  ├→ 意图分类器快速裁剪工具
  ├→ 语义检索兜底
  ├→ Prompt 预算管理器组装
  └→ 分层缓存（静态/半动态）
  ↓
orchestrate(content) — 编排决策
  ├→ IntentClassifier.classify()     → 意图分类
  ├→ ExperienceRouter.route()        → 经验路由（Thompson Sampling）
  ├→ ClarificationEngine.assess()    → 澄清评估
  ├→ TaskSignal → ResourceState      → 信号 + 资源解耦
  └→ OrchestrationPlan               → 协作模式选择
  ↓
executeByPlan(plan)
  ├→ exp_direct:   经验直连（零 LLM）
  ├→ exp_verified: 经验执行 + LLM 质检
  ├→ llm_with_hint: LLM + 经验注入
  ├→ single:       单 LLM
  ├→ parallel:     多专家并行 + 融合
  └→ DAG:          DAG 编排执行
  ↓
工具执行（SandboxExecutor 沙箱保护）
  ↓
结果返回
  ├→ EmotionEngine.onToolSuccess/Error()
  ├→ DesireEngine.onToolSuccess/Error()
  ├→ PetManager.feed()
  ├→ ExperienceCompiler → 经验图谱更新
  ├→ ToolSynthesizer → 高频经验自动合成工具
  └→ FusionBuffer → 多源融合写入 STMP
  ↓
前端渲染（PIXI.js 精灵动画 + 情绪粒子 + 音效）
```

---

## 七、数据库架构

| 数据库 | 路径 | 表 | 职责 |
|--------|------|---|------|
| memory.db | ~/.buddy/memory.db | messages, memories, diary, relations | 对话 + 记忆 + 日记 |
| stmp.db | ~/.buddy/stmp.db | stmp_rooms, stmp_nodes, stmp_edges, stmp_nodes_fts | 时空记忆宫殿 |
| pet.db | ~/.buddy/pet.db | pet_data, exploration, behavior_signals | 养成数据 |
| cognitive.db | ~/.buddy/cognitive.db | user_profile, self_model, micro_goals, curiosities, domain_profiles | 认知模型 |
| billing.db | ~/.buddy/billing.db | subscriptions, payments, entitlements | 订阅 + 商城 |
| social.db | ~/.buddy/social.db | friends, interactions | 社交数据 |
| experience-graph.db | ~/.buddy/experience-graph.db | exp_nodes, exp_edges | 经验图谱 |

所有数据库使用 WAL 模式，支持读写并发。

---

## 八、配置结构

```json
{
  "name": "Buddy",
  "species": "光灵",
  "personality": { "snark": 15, "wisdom": 70, "chaos": 25, "patience": 85, "debugging": 60 },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-...",
    "lightweight": { "provider": "...", "model": "..." },
    "fallbacks": [{ "provider": "...", "model": "..." }]
  },
  "ws": { "port": 8765, "token": "...", "maxConcurrent": 3, "processingTimeoutMs": 120000 },
  "sandbox": { "timeout": 30000, "workspace": "/tmp/buddy-sandbox" },
  "idle": { "enabled": true, "blinkMs": 3000, "actionMs": 15000 },
  "tts": { "enabled": true, "backend": "edge", "voice": "..." },
  "mcp": { "servers": [{ "name": "...", "command": "...", "args": [...] }] },
  "platforms": {
    "telegram": { "enabled": true, "token": "..." },
    "discord": { "enabled": true, "token": "..." },
    "feishu": { "enabled": true, "appId": "...", "appSecret": "..." },
    "wecom": { "enabled": true, "corpId": "...", "agentId": 0, "secret": "...", "token": "...", "encodingAESKey": "..." },
    "wechat_mp": { "enabled": true, "appId": "...", "appSecret": "...", "token": "...", "encodingAESKey": "..." },
    "dingtalk": { "enabled": true, "appKey": "...", "appSecret": "...", "mode": "stream" }
  },
  "pool": {
    "strategy": "task_match",
    "budget": { "maxCostPerHour": 10 },
    "nodes": [{ "id": "...", "type": "cloud", "provider": "...", "model": "...", "tags": [...], "tier": "premium" }]
  },
  "clock": { "enabled": true, "heartbeatMs": 300000, "maxProactivesPerDay": 5 }
}
```

---

## 九、设计模式总结

| 模式 | 应用 |
|------|------|
| **工厂模式** | ProviderFactory 创建 LLM 模型 |
| **策略模式** | ModelRouter 按任务类型选模型 |
| **观察者模式** | EventBus / PerceptionEventBus |
| **缓冲区模式** | FusionBuffer 多源融合 |
| **熔断器模式** | LLMAdapter / ModelPool |
| **衰减模式** | STMP Ebbinghaus / EmotionEngine Buff / DesireEngine 自然衰减 |
| **涌现模式** | BehaviorSignals 从行为中学习人格 |
| **Thompson Sampling** | ExperienceRouter 探索/利用权衡 |
| **沙箱模式** | SandboxExecutor 隔离执行 |
| **迁移模式** | MigrationManager Schema 版本管理 |
| **JSONL 追加写入** | DecisionRecorder / TrainingExporter |
| **EWMA 统计** | ModelPool 滑动窗口 |
| **Jaccard 相似度** | DecisionRecorder kNN / FusionBuffer 关联检测 |
| **Marsaglia-Tsang** | Thompson Sampling 的 Gamma 分布采样 |
| **倒排索引** | ExperienceGraph 关键词→经验ID |
| **预编译正则** | ExperienceGraph 避免重复编译 |
| **分层缓存** | MessageProcessor 静态/半动态层 |
| **投机预执行** | MessageProcessor 高置信度经验预取 |

---

## 十、学术论文支撑

| 模块 | 论文 |
|------|------|
| 澄清决策器 | MAC (arXiv:2512.13154) |
| 内心独白 | Inner Thoughts (arXiv:2501.00383) |
| 推理链 | Hindsight (arXiv:2512.12818) |
| 信念存储 | Hindsight — Evolving Beliefs |
| 经验路由 | AgentRR / APC |
| Prompt 预算 | AIOS 动态上下文管理 |
| 编排信号解耦 | SchedCP 解耦控制面 |
| Thompson Sampling | CQB-MNL 隐式反馈 |
| 遗忘曲线 | Self-Evolving Agents / Ebbinghaus |
| 情绪系统 | Plutchik 情绪轮 / Russell 环形模型 / The Sims / RimWorld |
| 人格系统 | 大五人格 OCEAN |

---

## 十一、CLI 命令清单

```
/status              查看状态
/learn <file|url>    学习
/learned             已学知识
/watch <path>        监听文件变更
/shop                商城
/buy <id>            购买
/inventory           查看库存
/friends             好友列表
/addfriend <id> <name> 添加好友
/health              上线就绪检查
/export <domain>     导出能力包
/export-training     导出训练数据
/train <domain>      LoRA 微调
/train-status        查看训练进度
/weights             权重管理
/models              列出本地三进制模型
/train-ternary       手动触发三进制训练
/experts             列出已安装专家模型
/install-expert      安装 .ta 模型
/uninstall-expert    卸载专家模型
/rate <domain> <1-5> 给能力包评分
/backup              备份数据库
/dbinfo              查看数据库状态
/mcp                 MCP 服务器状态
/mcp-search          搜索 Smithery 市场
/mcp-install         安装 MCP Server
/pool                ModelPool 状态
/workflow            DAG 工作流管理
/orch <task>         DAG 编排预览
/project             项目索引
/beliefs             信念存储
/entities            实体存储
/privacy             隐私权限状态
/perception          感知事件历史
/knowledge-export    导出知识包
/growth              三进制模型成长报告
/env                 环境检测
/chain               执行工具链
/help                帮助
/quit                退出
```

---

*文档生成时间：2026-04-28 08:11 CST*
*基于 Buddy v0.2.0 源码分析*
