# Buddy 智能升级开发计划

> 生成时间：2026-04-24
> 基于：EFFICIENCY_OPTIMIZATION_PLAN.md + 代码审计 + 前沿论文调研
> 范围：隐患修复 + 效率优化补全 + 智能能力升级
> 原则：不改变已有功能，增量增强

---

## 第一部分：隐患修复（紧急）

> 已发现的 bug 和架构问题，必须在新功能之前修掉。

### H1: 全局缓存无自动清理 — 内存泄漏

**问题**：`globalToolCache` 和 `globalSemanticCache` 有 `purge()` 方法但无人调用，长期运行内存只增不减。

**修复方案**：
```typescript
// 在 subsystems.ts 初始化时注册定时清理
setInterval(() => {
  const purged = globalToolCache.purge() + globalSemanticCache.purge();
  if (purged > 0) console.log(`[Cache] 清理 ${purged} 条过期缓存`);
}, 60_000); // 每 60 秒清理一次
```

**文件**：`src/core/subsystems.ts`
**工作量**：0.5h
**风险**：极低

---

### H2: `match()` 子串匹配性能退化

**问题**：P3 修复中新增的子串匹配遍历全部关键词，50+ 节点时可能超过 1ms 验收标准。

**修复方案**：
```typescript
// experience-graph.ts — match() 中限制子串匹配范围
// 1. 短关键词（≤3 字符）跳过子串匹配，只走倒排索引
// 2. 关键词数量 > 200 时，降级为只对 top-N 高置信度节点做子串匹配
for (const [kw, ids] of this.keywordIndex) {
  if (kw.length <= 3) continue; // 短关键词靠倒排索引
  if (inputLower.includes(kw)) {
    for (const id of ids) candidateIds.add(id);
  }
}
```

**文件**：`src/intelligence/experience-graph.ts`
**工作量**：1h
**风险**：低 — 可能漏掉短关键词的子串匹配，但倒排索引已覆盖精确匹配

---

### H3: `speculativePrefetch` 无并发限制

**问题**：高置信度经验多时，同时发起几十个工具调用，可能耗尽资源。

**修复方案**：
```typescript
// message-processor.ts — speculativePrefetch
const MAX_PREFETCH = 5;
const tasks = highConf
  .flatMap(exp => exp.steps.filter(...).map(...))
  .filter(Boolean)
  .slice(0, MAX_PREFETCH); // 限制并发数
```

**文件**：`src/core/message-processor.ts`
**工作量**：0.5h
**风险**：极低

---

### H4: `intentCache` 无大小限制

**问题**：`SemanticToolCache.intentCache` 是普通 Map，高频场景下无限增长。

**修复方案**：改用 LRU 或加 max-size 淘汰：
```typescript
private readonly MAX_INTENT_ENTRIES = 500;

set(content: string, toolCalls: SemanticCacheEntry['toolCalls']): void {
  const hash = this.computeIntentHash(content);
  if (this.intentCache.size >= this.MAX_INTENT_ENTRIES) {
    const first = this.intentCache.keys().next().value;
    if (first) this.intentCache.delete(first);
  }
  this.intentCache.set(hash, { ... });
}
```

**文件**：`src/tools/cache.ts`
**工作量**：0.5h
**风险**：极低

---

### H5: 工具结果截断阈值不统一

**问题**：三个地方有不同截断阈值 — llm.ts (10000), compressMessages (200), formatToolResult (未知)。

**修复方案**：提取为共享常量：
```typescript
// src/core/constants.ts
export const TOOL_RESULT_LIMITS = {
  maxRaw: 10_000,        // 工具原始结果上限
  maxCompressed: 200,    // 压缩后保留长度
  maxPrompt: 5_000,      // 注入 prompt 的上限
} as const;
```

**文件**：`src/core/constants.ts`, `src/core/llm.ts`, `src/core/message-processor.ts`
**工作量**：1h
**风险**：低

---

### H6: 停用词表不统一

**问题**：`message-processor.ts` 的 `extractConcepts` 和 `cache.ts` 的 `INTENT_STOP_WORDS` 是两套独立列表。

**修复方案**：提取到 `src/core/constants.ts` 共享：
```typescript
export const SHARED_STOP_WORDS = new Set([
  // 中文
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '请', '帮', '能', '吗', '呢', '吧', '啊', '哈', '嗯',
  // 英文
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'of', 'and', 'or',
  'it', 'this', 'that', 'please', 'help', 'can', 'could', 'would', 'you',
]);
```

**文件**：`src/core/constants.ts`, `src/tools/cache.ts`, `src/core/message-processor.ts`
**工作量**：0.5h
**风险**：极低

---

### H7: `assessComplexity` 中文短句失效

**问题**：`content.split(/[,，;；、]/).filter(c => c.trim().length > 5)` 导致中文 4 字短句被过滤。

**修复方案**：降低阈值：
```typescript
const clauses = content.split(/[,，;；、]/).filter(c => c.trim().length > 2);
```

**文件**：`src/core/message-processor.ts`
**工作量**：0.5h
**风险**：低 — 可能增加误触发，但 markerCount >= 2 的条件已足够严格

---

**隐患修复总计**：~4.5h，全部低风险

---

## 第二部分：效率优化补全

> EFFICIENCY_OPTIMIZATION_PLAN.md 中已规划但未完善的部分。

### E1: 记忆检索并行化（P8）

**现状**：`retrieveMemories()` 串行阻塞 buildContext 主路径。

**方案**：将记忆检索与 emotion/desire/cognitive 并行：
```typescript
const [relevantMemories, emotionPrompt, desireVector] = await Promise.all([
  this.retrieveMemories(content),
  Promise.resolve(this.sys.emotion.getPromptInjection()),
  Promise.resolve(this.sys.desire.getVector()),
]);
```

**收益**：STMP 检索 5-20ms 不再阻塞
**文件**：`src/core/message-processor.ts`
**工作量**：1h

---

### E2: `assessComplexity` 增强（P1 补全）

**现状**：只检测标记词/并行词/子句数，对隐式复杂请求无效。

**方案**：增加检测维度：
```typescript
// 1. 多实体引用（多个文件名/路径）
const pathMatches = content.match(/[\w/\\.-]+\.\w+/g) ?? [];
const hasMultiplePaths = new Set(pathMatches).size >= 2;

// 2. 条件语句
const hasCondition = /如果|假如|unless|if\s/i.test(content);

// 3. 数量指示
const hasQuantity = /所有|每个|全部|批量|all|every|batch/i.test(content);

return {
  shouldUseDAG: markerCount >= 2 || hasParallel || clauses.length >= 3
    || hasMultiplePaths || (hasCondition && clauses.length >= 2) || hasQuantity,
  reason: `...`,
};
```

**文件**：`src/core/message-processor.ts`
**工作量**：1.5h

---

### E3: Prompt 预算静态段缓存（P9）

**现状**：`PromptBudgetManager.assemble()` 每次重新拼接所有段。

**方案**：静态段（core-instruction、trust-permissions）在信任度不变时缓存拼接结果：
```typescript
private cachedStaticPrompt: string | null = null;
private staticFingerprint: string = '';

assemble(): string {
  if (staticFingerprint === currentFingerprint && this.cachedStaticPrompt) {
    return this.cachedStaticPrompt + dynamicSegments;
  }
  // ... 重新拼接
}
```

**文件**：`src/core/prompt-budget.ts`
**工作量**：1h

---

**效率补全总计**：~3.5h

---

## 第三部分：智能升级

> 基于前沿论文和代码审计，分三个阶段实施。

---

### Phase 1: 基础智能增强（1-2 天）

> 改动小、收益直接、风险低。

#### I1: 实时能力边界感知

**依据**：CognitiveEngine 已有 `domain_profiles` 表，但回答前从未查询。

**方案**：
```typescript
// message-processor.ts — processStream/processBatch 回答前
async assessCapability(content: string): Promise<{
  domain: string;
  familiarity: number;
  shouldQualify: boolean;
}> {
  const domains = this.detectDomains(content);
  const primary = domains[0] ?? 'general';
  const profile = this.sys.cognitive.getDomainProfile(primary);

  return {
    domain: primary,
    familiarity: profile.depthScore,
    shouldQualify: profile.growthStage === 'seed' || profile.depthScore < 0.3,
  };
}

// 回答时自动加限定语
if (assessment.shouldQualify) {
  prefix = `⚠️ 我对「${assessment.domain}」了解有限，以下建议仅供参考：\n\n`;
}
```

**文件**：`src/core/message-processor.ts`, `src/cognitive/engine.ts`
**工作量**：3h
**收益**：减少错误回答，提升用户信任

---

#### I2: 失败经验回写

**依据**：Reflexion (arXiv:2303.11366) — 用语言化反思替代梯度更新。

**方案**：P6 反思门检测到失败时，生成反思并写入经验图谱：
```typescript
// experience-executor.ts — execute() 中反思失败时
if (reflection.shouldRequery) {
  // 生成失败反思
  const failureNote: FailureMemory = {
    experienceId: skill.id,
    failureContext: JSON.stringify(outputs),
    rootCause: reflection.issues.join('; '),
    timestamp: Date.now(),
  };

  // 写入经验图谱的附属存储
  this.failureMemories.set(skill.id, failureNote);

  return {
    success: false,
    error: `反思不通过: ${reflection.issues.join(', ')}`,
    needsLLMFallback: true,
    failureHint: `上次执行这个经验失败了，原因: ${reflection.issues.join('; ')}。请考虑替代方案。`,
  };
}
```

下次执行同一经验时，将 `failureHint` 注入 prompt。

**文件**：`src/intelligence/experience-executor.ts`
**工作量**：3h
**收益**：从错误中学习，减少重复失败

---

#### I3: 推理链持久化

**依据**：Hindsight (arXiv:2512.12818) — 结构化记忆支持跨轮推理。

**方案**：在 STMP 之上加轻量级推理链存储：
```typescript
// src/memory/reasoning-chain.ts
interface ReasoningChain {
  id: string;
  topic: string;               // 推理主题（从对话中提取）
  conclusions: string[];        // 已得出的结论
  openQuestions: string[];      // 未解决的问题
  confidence: number;           // 整体置信度
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;            // 默认 2 小时过期
}

class ReasoningChainStore {
  private chains = new Map<string, ReasoningChain>();

  // 对话结束时提取结论
  conclude(topic: string, conclusion: string): void { ... }

  // 新对话开始时检索相关推理链
  retrieve(query: string): ReasoningChain[] { ... }

  // 注入 prompt
  buildPromptInjection(chains: ReasoningChain[]): string {
    return chains.map(c =>
      `## 之前的推理: ${c.topic}\n结论: ${c.conclusions.join('; ')}\n待解决: ${c.openQuestions.join('; ')}`
    ).join('\n\n');
  }
}
```

**文件**：新建 `src/memory/reasoning-chain.ts`，修改 `src/core/message-processor.ts`
**工作量**：4h
**收益**：跨轮对话推理连贯，从"回答问题"升级到"理解问题"

---

**Phase 1 总计**：~10h

---

### Phase 2: 主动智能（2-3 天）

> 让 Buddy 从被动响应变为主动思考。

#### I4: 内心独白线程

**依据**：Inner Thoughts (arXiv:2501.00383) — 持续的内心思考流。

**方案**：在心跳机制基础上，增加轻量级后台分析：
```typescript
// src/core/inner-thoughts.ts
class InnerThoughtsEngine {
  private thoughtQueue: Thought[] = [];

  // 每次用户消息后触发（异步，不阻塞响应）
  async onUserMessage(messages: Message[]): Promise<void> {
    const thoughts = await this.analyze(messages);

    for (const thought of thoughts) {
      if (thought.urgency > 0.7) {
        // 高紧急度 → 插入下一次回复
        this.thoughtQueue.push(thought);
      } else if (thought.urgency > 0.4) {
        // 中紧急度 → 等合适时机
        this.pendingThoughts.push(thought);
      }
      // 低紧急度 → 忽略
    }
  }

  // 检查是否有待插入的思考
  getInterjection(): string | null {
    const t = this.thoughtQueue.shift();
    return t ? `\n\n💭 ${t.content}` : null;
  }

  private async analyze(messages: Message[]): Promise<Thought[]> {
    // 检测知识缺口
    // 检测错误信息
    // 检测用户困惑
    // 检测可以补充的信息
  }
}
```

**触发条件**（不依赖 LLM，纯规则）：
- 用户提到不确定的词（"可能"、"也许"、"不太确定"）→ 准备补充
- 对话中出现技术术语但没有解释 → 准备解释
- 用户连续问同类问题 → 准备总结

**文件**：新建 `src/core/inner-thoughts.ts`，修改 `src/core/subsystems.ts`
**工作量**：6h
**收益**：从被动工具变为主动助手

---

#### I5: 澄清决策器

**依据**：MAC (arXiv:2512.13154) — 评估不确定性和风险，决定是否主动澄清。

**方案**：
```typescript
// src/core/clarifier.ts
interface ClarificationDecision {
  shouldClarify: boolean;
  ambiguousAspects: string[];
  clarificationQuestion: string;
  riskIfWrong: 'low' | 'medium' | 'high';
}

class ClarificationEngine {
  assess(content: string, availableTools: ToolDef[]): ClarificationDecision {
    const ambiguities: string[] = [];

    // 1. 多个可能的目标文件
    const paths = content.match(/[\w/.-]+\.\w+/g) ?? [];
    if (paths.length > 1) ambiguities.push('多个文件路径');

    // 2. 模糊的操作词
    const vagueActions = ['改', '修', '优化', '处理', 'fix', 'improve'];
    if (vagueActions.some(v => content.includes(v)) && !content.includes('具体'))
      ambiguities.push('操作不具体');

    // 3. 缺少关键参数
    if (/部署|deploy/i.test(content) && !content.includes('到') && !content.includes('to'))
      ambiguities.push('部署目标不明确');

    // 4. 评估风险
    const hasWrite = /写|创建|删除|部署|write|create|delete|deploy/i.test(content);
    const risk = hasWrite ? 'high' : 'low';

    return {
      shouldClarify: ambiguities.length >= 2 || (ambiguities.length >= 1 && risk === 'high'),
      ambiguousAspects: ambiguities,
      clarificationQuestion: this.buildQuestion(ambiguities),
      riskIfWrong: risk,
    };
  }
}
```

**文件**：新建 `src/core/clarifier.ts`，修改 `src/core/message-processor.ts`
**工作量**：4h
**收益**：减少错误执行，提升任务完成率

---

#### I6: 意图预测 + 预加载

**依据**：DSP (arXiv:2509.01920) — 基于上下文预测下一步。

**方案**：利用经验图谱的边关系预测下一步意图：
```typescript
// message-processor.ts — processStream 完成后
async predictNextIntent(lastExperience: ExperienceUnit): Promise<void> {
  // 经验图谱中 A → requires → B，说明用户可能接下来需要 B
  const successors = this.sys.intelligence.graph.getSuccessors(lastExperience.id);

  for (const { node } of successors.slice(0, 3)) {
    // 预加载这些经验的只读工具到缓存
    for (const step of node.steps) {
      if (MessageProcessor.READONLY_TOOLS.has(step.tool)) {
        const key = ToolCache.makeKey(step.tool, step.args);
        if (!globalToolCache.get(key)) {
          this.sys.tools.get(step.tool)
            ?.execute(step.args)
            .then(r => globalToolCache.set(key, String(r), 60))
            .catch(() => {});
        }
      }
    }
  }
}
```

**文件**：`src/core/message-processor.ts`
**工作量**：2h
**收益**：后续请求响应更快

---

**Phase 2 总计**：~12h

---

### Phase 3: 深度智能（3-5 天）

> 架构级改进，需要更多设计和测试。

#### I7: 四层记忆网络

**依据**：Hindsight — World Facts / Agent Experiences / Entity Summaries / Evolving Beliefs。

**方案**：在 STMP 之上扩展：
```typescript
// src/memory/entity-store.ts
interface EntitySummary {
  name: string;              // 实体名（人名、项目名、技术栈）
  type: 'person' | 'project' | 'technology' | 'concept';
  facts: string[];           // 关于这个实体的事实
  lastMentionedAt: number;
  mentionCount: number;
  sentiment: number;         // -1 到 1
}

// src/memory/belief-store.ts
interface Belief {
  id: string;
  statement: string;         // 信念陈述
  confidence: number;        // 置信度 0-1
  evidence: string[];        // 支撑证据
  contradictedBy: string[];  // 反驳证据
  updatedAt: number;
  source: 'inferred' | 'told' | 'observed';
}
```

**工作流**：
1. 对话中提到实体 → 更新 EntitySummary
2. 对话中产生推断 → 写入 Belief（低置信度）
3. 多次验证 → 提升 Belief 置信度
4. 出现矛盾 → 降低旧 Belief 置信度，记录反驳证据

**文件**：新建 `src/memory/entity-store.ts`, `src/memory/belief-store.ts`
**工作量**：8h
**收益**：从"记住对话"升级到"理解世界"

---

#### I8: 经验图谱自动进化

**依据**：Reflexion + ExperienceEvolver 停滞检测。

**方案**：当经验连续失败时，自动拆分或合并：
```typescript
// experience-evolver.ts — 新增 autoEvolve
async autoEvolve(): Promise<void> {
  const allExp = this.graph.getAllNodes();

  // 1. 拆分：高失败率的多步骤经验
  const failing = allExp.filter(e =>
    e.stats.failCount > 3 &&
    e.stats.failCount / (e.stats.successCount + e.stats.failCount) > 0.4 &&
    e.steps.length > 1
  );

  for (const exp of failing) {
    // 尝试拆分为单步经验
    const split = this.splitExperience(exp);
    if (split.length > 1) {
      this.graph.removeNode(exp.id);
      split.forEach(s => this.graph.addNode(s));
    }
  }

  // 2. 合并：频繁连续使用的两个经验
  const pairs = this.findFrequentPairs();
  for (const [a, b] of pairs) {
    const merged = this.mergeExperiences(a, b);
    if (merged) this.graph.addNode(merged);
  }
}
```

**文件**：`src/intelligence/experience-evolver.ts`
**工作量**：6h
**收益**：经验图谱自优化，越用越好

---

#### I9: 跨会话知识迁移

**依据**：Agent Memory 综述 — 记忆碎片化问题。

**方案**：梦境巩固时，将高频领域的经验导出为可迁移的知识包：
```typescript
// src/intelligence/knowledge-export.ts
interface KnowledgePack {
  domain: string;
  version: number;
  experiences: ExperienceUnit[];    // 该领域的所有经验
  domainProfile: DomainProfile;     // 领域画像
  extractedAt: number;
}

// 导出
export function exportDomainPack(domain: string): KnowledgePack { ... }

// 导入（新会话或新项目）
export function importDomainPack(pack: KnowledgePack): void { ... }
```

**文件**：新建 `src/intelligence/knowledge-export.ts`
**工作量**：4h
**收益**：跨项目/跨会话复用知识

---

**Phase 3 总计**：~18h

---

## 实施路线图

```
Week 1: 隐患修复 + 效率补全
  ├─ Day 1: H1-H4 (缓存清理/并发限制/性能修复)
  ├─ Day 2: H5-H7 + E1 (常量统一/并行化)
  └─ Day 3: E2-E3 (复杂度检测增强/Prompt缓存)

Week 2: Phase 1 智能增强
  ├─ Day 4: I1 (能力边界感知)
  ├─ Day 5: I2 (失败经验回写)
  └─ Day 6: I3 (推理链持久化)

Week 3: Phase 2 主动智能
  ├─ Day 7-8: I4 (内心独白)
  ├─ Day 9: I5 (澄清决策器)
  └─ Day 10: I6 (意图预测)

Week 4-5: Phase 3 深度智能
  ├─ Day 11-13: I7 (四层记忆网络)
  ├─ Day 14-15: I8 (经验自动进化)
  └─ Day 16: I9 (跨会话知识迁移)
```

---

## 验收标准

### 隐患修复验收
- [ ] 24 小时连续运行后内存无增长
- [ ] 50 节点 match() < 1ms
- [ ] speculativePrefetch 并发 ≤ 5
- [ ] 全部截断阈值统一为常量

### Phase 1 验收
- [ ] seed 阶段领域回答自动加限定语
- [ ] 经验执行失败后，下次同一经验携带失败提示
- [ ] 跨 3 轮对话的推理链正确携带结论

### Phase 2 验收
- [ ] 内心独白在检测到用户困惑时主动补充
- [ ] 模糊写操作触发澄清（≥80% 准确率）
- [ ] 经验执行后预加载后续经验工具

### Phase 3 验收
- [ ] EntitySummary 自动累积实体信息
- [ ] Belief 在多次验证后置信度提升
- [ ] 高失败率经验自动拆分
- [ ] 领域知识包可导出/导入

---

## 风险矩阵

| 编号 | 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|---------|
| R1 | 内心独白增加 LLM 调用成本 | 中 | 中 | 纯规则触发，不调 LLM |
| R2 | 澄清过多影响用户体验 | 中 | 高 | 限制每会话最多 2 次澄清 |
| R3 | 推理链过长撑爆 prompt | 低 | 高 | 最多注入 3 条，每条 ≤ 200 字符 |
| R4 | 失败经验回写产生错误指导 | 低 | 中 | 回写需 2 次以上失败才触发 |
| R5 | 四层记忆增加复杂度 | 高 | 中 | 先做 EntityStore，BeliefStore 延后 |

---

## 不做的事

- **不做**完整的 RL 训练 — 成本太高，用规则 + LLM 替代
- **不做**多 agent 协作 — 当前单 agent 足够，复杂度不值得
- **不做**向量数据库替换 STMP — 改动太大，渐进优化
- **不做**实时知识图谱 — 用 EntityStore 轻量替代
