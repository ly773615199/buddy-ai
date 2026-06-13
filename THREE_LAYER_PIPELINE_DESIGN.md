# 三层知识管线设计方案

> 日期: 2026-06-14
> 目标: 采集→编辑→发送 三层管线，贴合现有架构

---

## 一、现状分析

### 1.1 已有知识源（6 个）

| 源 | 接口 | 数据类型 | 特点 |
|---|---|---|---|
| STMP | `stmp.retrieve()` | MemoryNode | 时空记忆宫殿，房间+时间轴+语义星图 |
| ExperienceGraph | `graph.getNode()` | ExperienceUnit | 经验图谱，触发条件+步骤+统计 |
| KnowledgeSourceManager | `sourceManager.query()` | KnowledgeNode | 本地文件/网络搜索/飞书 |
| TernaryRouter | `ternaryRouter.query()` | 三进制专家 | 本地专家推理 |
| PromptInjector | `promptInjector.inject()` | DomainKnowledgePack | STMP 领域知识注入 |
| SignalConvergenceLayer | `convergenceLayer.ingest*()` | 反馈/知识/进化信号 | 信号汇聚（不做知识融合） |

### 1.2 现有消费路径（3 条，互不相连）

```
路径 A: processStream → buildContext → PromptInjector → 注入 system prompt → LLM
路径 B: executeByPlan → 经验执行器 → 直接返回
路径 C: experienceRouter.route() → 置信度路由 → 经验/LLM
```

**问题**：
1. 三条路径互不相通，知识不共享
2. 工具结果不进入知识系统（不被碰撞、不被积累）
3. 检索结果直接拼接到 prompt，无融合/去重/冲突处理
4. 跨源知识碰撞从未发生（经验 × 搜索结果 × 记忆）

### 1.3 文档设计 vs 实际差距

文档描述的理想架构：
```
采集层 KnowledgeConvergence  → 统一收集
编辑层 CollisionEngine       → 碰撞/融合/涌现
发送层 AssemblyBridge        → 格式化输出
```

实际代码：**三个组件全部缺失**。CollisionEngine 刚创建（基础版）。

---

## 二、设计方案：贴合现有架构的三层管线

### 2.1 核心原则

1. **不替代 LLM** — 碰撞引擎做知识预处理，LLM 做最终生成
2. **渐进集成** — 每层独立可用，降级不影响现有流程
3. **复用现有接口** — STMP/ExperienceGraph/KnowledgeSourceManager 已有检索能力，不重复实现
4. **工具结果纳入** — 工具执行结果也进入知识系统

### 2.2 架构总览

```
用户输入
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  ① 采集层: KnowledgeConvergence                      │
│                                                      │
│  并行从 6 个源收集 → 统一为 CollisionNode              │
│  ├─ STMP.retrieve()         → 记忆节点                │
│  ├─ ExperienceGraph.match() → 经验节点                │
│  ├─ KnowledgeSource.query() → 搜索/文件节点           │
│  ├─ TernaryRouter.query()   → 专家推理节点            │
│  ├─ toolResults (新增)      → 工具结果节点            │
│  └─ conversationContext     → 对话上下文节点           │
│                                                      │
│  输出: CollisionNode[] (统一格式，含向量)              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  ② 编辑层: CollisionEngine                           │
│                                                      │
│  纯计算，不用 LLM                                     │
│  ├─ 去重: 相似度 > 0.85 → 合并 (fuse)                │
│  ├─ 互补: 0.3 ≤ sim ≤ 0.85 → 拼接 (scatter)         │
│  ├─ 涌现: sim < 0.3 → 跨源新组合 (emerge)            │
│  ├─ 冲突检测: 矛盾信息标记 + 可信度排序               │
│  └─ 相关性排序: 按与输入的向量相似度排序              │
│                                                      │
│  输出: EditResult (编辑后的知识 + 操作记录)            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  ③ 发送层: KnowledgeAssembler                        │
│                                                      │
│  根据意图选择输出策略（不生成文本，只组装 prompt）      │
│  ├─ report: 结构化汇报 → 按维度组织                   │
│  ├─ explain: 解释说明 → 背景→核心→示例               │
│  ├─ compare: 对比分析 → 并列对比表格                  │
│  ├─ execute: 执行确认 → 操作→结果→建议                │
│  └─ chat: 闲聊 → 最简化，不注入知识                   │
│                                                      │
│  输出: 注入 prompt 的结构化知识片段                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              LLM 流式生成最终回复
```

### 2.3 各层详细设计

#### ① 采集层: KnowledgeConvergence

**文件**: `src/intelligence/knowledge-convergence.ts` (新建 ~200 行)

**职责**: 并行从所有源收集知识，统一为 `CollisionNode[]`

**关键设计**:
- 复用现有检索接口（不重新实现检索逻辑）
- 并行采集，单源超时 500ms 不阻塞
- 工具结果也纳入（新增 source='tool'）
- 简单向量化：用 ByteEncoder 的 `forwardPooled()` 生成 128 维向量

```typescript
export interface CollisionNode {
  id: string;
  content: string;
  vector: Float32Array;         // 128 维向量
  source: string;               // 'stmp' | 'experience' | 'local' | 'web' | 'feishu' | 'ternary' | 'tool' | 'conversation'
  score: number;                // 来源相关性得分 0-1
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class KnowledgeConvergence {
  constructor(
    private stmp: STMPStore,
    private experienceGraph: ExperienceGraph,
    private knowledgeSourceManager: KnowledgeSourceManager,
    private ternaryRouter: TernaryRouter | null,
    private textEncoder: TextEncoder | null,  // ByteEncoder 单例
    private verbose: boolean,
  ) {}

  async converge(input: string, options?: {
    toolResults?: Array<{ name: string; result: string }>;
    contextTags?: string[];
    maxNodes?: number;           // 默认 20
    timeoutMs?: number;          // 单源超时，默认 500ms
  }): Promise<CollisionNode[]> {
    // 并行采集，单源超时保护
    const sources = await Promise.allSettled([
      this.fromSTMP(input, options),
      this.fromExperience(input, options),
      this.fromKnowledgeSources(input, options),
      this.fromTernary(input, options),
      this.fromToolResults(options),
      this.fromConversation(input),
    ]);
    // 合并 + 向量化 + 去重
    ...
  }
}
```

#### ② 编辑层: CollisionEngine

**文件**: `src/intelligence/collision-engine.ts` (已创建，需增强)

**职责**: 知识碰撞/融合/冲突检测（纯计算，不用 LLM）

**增强点**:
- 新增 `dedup()` 方法：基于向量相似度去重
- 新增 `detectConflicts()` 方法：检测矛盾信息
- 新增 `rankByRelevance()` 方法：按与输入的相关性排序
- `edit()` 方法增加冲突处理逻辑

#### ③ 发送层: KnowledgeAssembler

**文件**: `src/intelligence/knowledge-assembler.ts` (新建 ~150 行)

**职责**: 将编辑后的知识组装为可注入 prompt 的结构化文本

**关键设计**:
- 不生成文本（那是 LLM 的事）
- 根据意图选择组装策略
- 输出格式化的 prompt 片段，带来源标注
- 控制 token 预算（默认 2000 字符）

```typescript
export type OutputIntent = 'report' | 'explain' | 'compare' | 'execute' | 'chat';

export class KnowledgeAssembler {
  assemble(editResult: EditResult, intent: OutputIntent, maxChars?: number): string {
    if (intent === 'chat') return ''; // 闲聊不注入知识

    const strategy = this.getStrategy(intent);
    const parts: string[] = [];

    // 按策略组织知识片段
    for (const item of editResult.edited.slice(0, strategy.maxItems)) {
      parts.push(strategy.format(item));
    }

    // 添加来源标注
    const sources = [...new Set(editResult.edited.flatMap(e => e.sources))];
    parts.push(`\n[来源: ${sources.join(', ')}]`);

    return parts.join('\n').slice(0, maxChars ?? 2000);
  }
}
```

### 2.4 集成点

#### 集成点 1: processStream（主消息处理）

**当前**: `buildContext()` → `PromptInjector.inject()` → LLM
**改造**: `buildContext()` → `KnowledgeConvergence.converge()` → `CollisionEngine.edit()` → `KnowledgeAssembler.assemble()` → 注入 prompt → LLM

```typescript
// message-processor.ts — buildContext() 中
const convergence = new KnowledgeConvergence(...);
const nodes = await convergence.converge(content, { toolResults: recentToolResults });
const editResult = new CollisionEngine().edit(nodes, this.detectIntent(content));
const knowledgePrompt = new KnowledgeAssembler().assemble(editResult, this.detectIntent(content));
if (knowledgePrompt) {
  budget.add({ id: 'collision-knowledge', source: 'pipeline', priority: PRIORITY.DOMAIN_KNOWLEDGE, content: knowledgePrompt, required: false });
}
```

#### 集成点 2: tool 执行结果

**当前**: 工具结果 → formatToolResult → 返回给 LLM
**改造**: 工具结果 → formatToolResult → **同时**喂入 KnowledgeConvergence → 后续消息可引用

#### 集成点 3: decide() 决策

**当前**: brain.decide() → plan → execute
**改造**: brain.decide() 中，当 plan.confidence < 0.5 时，用 CollisionEngine 做候选方案碰撞

### 2.5 降级策略

| 层 | 降级条件 | 降级行为 |
|---|---|---|
| 采集层 | 单源超时/异常 | 跳过该源，用其余源 |
| 采集层 | TextEncoder 不可用 | 跳过向量化，碰撞用关键词相似度 |
| 编辑层 | 节点 < 2 | 跳过碰撞，直接返回原始节点 |
| 发送层 | 闲聊意图 | 不注入知识，走原流程 |
| 全部 | pipeline 异常 | 回退到现有 PromptInjector |

---

## 三、文件清单

| 文件 | 类型 | 行数 | 说明 |
|------|------|------|------|
| `src/intelligence/knowledge-convergence.ts` | 新建 | ~200 | 采集层 |
| `src/intelligence/collision-engine.ts` | 增强 | ~250 | 编辑层（已创建，增强冲突检测） |
| `src/intelligence/knowledge-assembler.ts` | 新建 | ~150 | 发送层 |
| `src/core/message-processor.ts` | 修改 | +30 | 集成管线到 buildContext |
| `src/brain/brain.ts` | 修改 | +20 | setEditingPipeline + decide 集成 |
| `src/core/subsystems.ts` | 修改 | +20 | 初始化 + 注入 |

总计: ~670 行新增/修改

---

## 四、验收标准

1. 采集层：6 个源并行采集，单源超时不阻塞
2. 编辑层：相似知识去重，跨源碰撞产生新组合
3. 发送层：根据意图选择组装策略，控制 token 预算
4. 集成：processStream 使用管线替代直接 PromptInjector
5. 降级：任何层异常不影响现有流程
6. 性能：管线总耗时 < 50ms（不含源检索时间）
