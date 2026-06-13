# Buddy 任务响应效率优化计划

> 生成时间：2026-04-24
> 基于：全量代码审计 + 前沿研究调研 + 现有架构分析
> 范围：不改变功能和本质，纯效率与工作模式创新
> 前置条件：LLM 不变

---

## 一、效率现状分析

### 1.1 当前响应时序（单次请求）

```
用户输入
  │ T+0ms      预处理（养成/情绪/认知/记忆写入）        ~5ms
  │ T+5ms      buildContext（工具过滤/检索/prompt 组装） ~150ms
  │ T+155ms    经验路由（match + Thompson Sampling）     ~5ms
  │
  ├─ 路径 A: exp_direct ─────────────────────────────
  │  T+160ms    经验执行（按 steps 调工具）              ~50-200ms
  │  T+360ms    后处理（记忆写入/知识提取/学习）          ~异步
  │  → 用户等待: ~400ms, Token: 0
  │
  ├─ 路径 B: exp_verified ───────────────────────────
  │  T+160ms    经验执行 + LLM 质检                     ~1-2s
  │  → 用户等待: ~1.5s, Token: ~500
  │
  └─ 路径 C: llm_only ──────────────────────────────
     T+155ms    LLM 流式调用（首 token ~1-3s）          ~3-10s
                多步工具循环（maxSteps=5）               ~每步 +2s
     → 用户等待: ~3-15s, Token: ~2000-8000
```

### 1.2 已识别的效率瓶颈

| # | 瓶颈 | 位置 | 开销 | 频率 |
|---|------|------|------|------|
| B1 | buildContext 全量重建 | message-processor.ts | ~150ms/次 | 每次请求 |
| B2 | ToolRetriever 线性扫描 | tool-retriever.ts | O(n) n=35 | 每次请求 |
| B3 | ExperienceGraph 正则重编译 | experience-graph.ts | 每次 new RegExp | 每次 match |
| B4 | 多工具串行等待 | llm.ts chatWithPromptTools | 串行执行 | 多工具时 |
| B5 | Prompt 段重复序列化 | message-processor.ts | 每次拼接 | 每次请求 |
| B6 | 消息历史全量传递 | message-processor.ts | 20 条全文 | 每次请求 |
| B7 | 经验编译无预过滤 | agent.ts postprocessResult | 每次检查 | 每次对话 |
| B8 | ReAct 串行瓶颈 | llm.ts 多步循环 | 严格串行 | 复杂任务 |

---

## 二、优化方案（按优先级排序）

### P0: 投机预执行 — 经验驱动的工具预取

**原理**：用户输入后，经验图谱匹配到高置信度经验时，不等 LLM 决策，立即并行预执行经验中的工具。LLM 真正调用时命中 ToolCache。

**依据**：arXiv 2512.15834 — Speculative Tool Calls 通过预测工具序列减少推理开销

**改动范围**：

```
src/core/message-processor.ts   — buildContext 中新增 speculativePrefetch()
src/tools/cache.ts              — 无需改动（已有 LRU+TTL）
src/intelligence/experience-graph.ts — match() 返回值增加 steps 引用
```

**实现逻辑**：

```typescript
// message-processor.ts — buildContext 开头新增
async speculativePrefetch(content: string): Promise<number> {
  const candidates = this.sys.intelligence.graph.match(content);
  const highConf = candidates.filter(c =>
    c.stats.confidence > 0.8 &&
    c.stats.successCount >= 3 &&
    c.abstractionLevel === 'concrete'  // 只对具体经验投机
  );
  if (highConf.length === 0) return 0;

  const tasks = highConf.flatMap(exp =>
    exp.steps
      .filter(step => {
        // 安全过滤：只预取只读工具
        const readOnly = ['read_file', 'list_files', 'git_status', 'git_log',
                          'git_diff', 'get_time', 'search_files', 'scan_project'];
        return readOnly.includes(step.tool);
      })
      .map(step => {
        const key = ToolCache.makeKey(step.tool, step.args);
        if (globalToolCache.get(key)) return null;
        return this.sys.tools.get(step.tool)
          ?.execute(step.args)
          .then(r => globalToolCache.set(key, String(r), 30))
          .catch(() => {});
      })
      .filter(Boolean)
  );

  await Promise.allSettled(tasks);
  return tasks.length;
}
```

**安全约束**：
- 只预取只读工具（read_file / git_status / list_files 等）
- 不预取 exec / write_file / search_web 等有副作用的工具
- 置信度门槛 >0.8 + 成功次数 >=3
- 结果进入 TTL=30s 的缓存，过期自动失效

**预期收益**：

| 场景 | 当前延迟 | 优化后 | 提升 |
|------|---------|--------|------|
| "读 package.json" | ~400ms | ~160ms | 2.5x |
| "看看 git 状态" | ~400ms | ~160ms | 2.5x |
| "读文件 + git 状态" | ~500ms | ~160ms | 3x |
| 首次（无经验） | ~5s | ~5s | 无变化 |

---

### P1: 自动 DAG 检测 — 复杂请求自动走图规划

**原理**：检测用户输入的复杂度，多步骤请求自动启用 DAG 编排（已有），而非走 ReAct 串行循环。

**依据**：arXiv 2510.25320 — GAP 框架通过依赖图实现自适应并行/串行执行

**改动范围**：

```
src/core/message-processor.ts — processStream 新增复杂度检测 + DAG 路径
src/orchestrate/planner.ts    — 无需改动（已有 plan()）
src/orchestrate/executor.ts   — 无需改动（已有 execute()）
```

**实现逻辑**：

```typescript
// message-processor.ts — processStream 开头新增
async processStream(content, onChunk, eventBus) {
  // 复杂度检测
  const complexity = this.assessComplexity(content);

  if (complexity.shouldUseDAG) {
    try {
      const dag = await this.sys.dagPlanner.plan(content);
      if (dag.tasks.size >= 2) {
        const result = await this.sys.taskExecutor.execute(dag, (event) => {
          if (event.type === 'orch_task_done') {
            onChunk(`✅ [${event.taskId}] 完成\n`);
          }
        });
        onChunk(result.summary);
        return {
          text: result.summary,
          toolCalls: result.taskResults.map(r => ({
            name: r.id, args: {}, result: r.result,
          })),
        };
      }
    } catch {
      // DAG 规划失败，降级到 ReAct
    }
  }

  // 原有 ReAct 路径...
}

private assessComplexity(content: string): { shouldUseDAG: boolean } {
  // 多步骤标记词
  const stepMarkers = ['然后', '接着', '同时', '并且', '先', '再',
                        'and then', 'also', 'after that', 'first', 'next'];
  const markerCount = stepMarkers.filter(m =>
    content.toLowerCase().includes(m)
  ).length;

  // 并行标记
  const parallelMarkers = ['同时', '并行', '一起', 'along with', 'together'];
  const hasParallel = parallelMarkers.some(m => content.includes(m));

  // 多个独立动作（逗号/分号分隔的动词短语）
  const clauses = content.split(/[,，;；、]/).filter(c => c.trim().length > 5);

  return {
    shouldUseDAG: markerCount >= 2 || hasParallel || clauses.length >= 3,
  };
}
```

**安全约束**：
- DAG 规划失败自动降级到 ReAct
- 最大任务数限制 10（已有 PlannerConfig.maxTasks）
- 每个任务超时 30s（已有 defaultTimeoutMs）

**预期收益**：

| 场景 | ReAct 串行 | DAG 并行 | 提升 |
|------|-----------|---------|------|
| 3 个独立检查 | ~6s | ~2s | 3x |
| 2 读 + 1 写（有依赖） | ~6s | ~4s | 1.5x |
| 5 步链式依赖 | ~10s | ~10s | 无变化 |

---

### P2: buildContext 分层缓存

**原理**：将上下文构建拆为静态/半动态/动态三层，静态层会话级缓存，半动态层定期更新。

**改动范围**：

```
src/core/message-processor.ts — buildContext 重构为分层模式
```

**实现逻辑**：

```typescript
// message-processor.ts
private contextCache = {
  // 静态层 — 信任度不变就不重建
  static: {
    fingerprint: '',          // 信任度指纹
    corePrompt: '',           // 核心指令
    toolList: [] as ToolDef[],// 过滤后的工具列表
    toolIndex: null as any,   // ToolRetriever 索引
    permissions: [] as string[],
  },
  // 半动态层 — 每 N 次交互更新
  semiDynamic: {
    updateCounter: 0,
    cognitivePrompt: '',
    behaviorSignals: null as any,
  },
};

async buildContext(content: string) {
  const trust = this.sys.pet.getIntimacy();
  const trustFingerprint = `${getTrustLevel(trust)}_${Math.floor(trust / 5)}`;

  // ── 静态层：信任度变化才重建 ──
  if (this.contextCache.static.fingerprint !== trustFingerprint) {
    const permissions = getPermissions(getTrustLevel(trust));
    this.contextCache.static = {
      fingerprint: trustFingerprint,
      corePrompt: buildSystemPrompt(config, ...),
      toolList: this.sys.tools.listForPermissions(permissions),
      toolIndex: null,  // 下面重建
      permissions,
    };
    // 重建工具索引
    this.sys.toolRetriever.indexTools(this.contextCache.static.toolList);
  }

  // ── 半动态层：每 10 次交互更新 ──
  this.contextCache.semiDynamic.updateCounter++;
  if (this.contextCache.semiDynamic.updateCounter >= 10) {
    this.contextCache.semiDynamic.cognitivePrompt =
      this.sys.cognitive.getUserPromptFragment();
    this.contextCache.semiDynamic.updateCounter = 0;
  }

  // ── 动态层：每次请求必须更新 ──
  const availableTools = this.sys.toolRetriever.getToolsForPrompt(content);
  const relevantMemories = await this.retrieveMemories(content);
  const emotionPrompt = this.sys.emotion.getPromptInjection();

  // 组装（用缓存的静态段 + 动态段）
  const budget = new PromptBudgetManager(promptBudget);
  budget.add({ content: this.contextCache.static.corePrompt, ... });
  budget.add({ content: this.contextCache.semiDynamic.cognitivePrompt, ... });
  budget.add({ content: emotionPrompt, ... });  // 动态
  // ...
}
```

**预期收益**：

| 指标 | 当前 | 优化后 | 提升 |
|------|------|--------|------|
| buildContext 耗时 | ~150ms | ~30ms | 5x |
| 工具索引重建 | 每次 | 信任度变化时 | ~50x 减少 |
| prompt 序列化 | 每次全量 | 动态段增量 | ~3x |

---

### P3: ExperienceGraph 倒排索引 + 预编译正则

**原理**：将 O(n) 全量遍历改为关键词倒排索引快速定位候选，正则预编译避免重复创建。

**改动范围**：

```
src/intelligence/experience-graph.ts — match() 重构
```

**实现逻辑**：

```typescript
// experience-graph.ts
private keywordIndex = new Map<string, Set<string>>();  // keyword → expId
private compiledPatterns = new Map<string, RegExp[]>();  // expId → RegExp[]

addNode(skill: ExperienceUnit): void {
  this.nodes.set(skill.id, skill);
  // 构建倒排索引
  for (const kw of skill.trigger.keywords) {
    const key = kw.toLowerCase();
    if (!this.keywordIndex.has(key)) this.keywordIndex.set(key, new Set());
    this.keywordIndex.get(key)!.add(skill.id);
  }
  // 预编译正则
  const patterns = skill.trigger.patterns
    .map(p => { try { return new RegExp(p, 'i'); } catch { return null; } })
    .filter(Boolean) as RegExp[];
  this.compiledPatterns.set(skill.id, patterns);
}

match(input: string, contextTags: string[] = []): ExperienceUnit[] {
  const inputLower = input.toLowerCase();
  const inputTokens = inputLower.split(/[^\w\u4e00-\u9fff]+/).filter(t => t.length >= 2);

  // 1. 倒排索引快速筛选候选
  const candidateIds = new Set<string>();
  for (const token of inputTokens) {
    const ids = this.keywordIndex.get(token);
    if (ids) for (const id of ids) candidateIds.add(id);
  }

  // 2. 只对候选做精确匹配
  const results: Array<{ skill: ExperienceUnit; score: number }> = [];
  for (const id of candidateIds) {
    const skill = this.nodes.get(id);
    if (!skill) continue;
    let score = 0;

    // 关键词匹配
    for (const kw of skill.trigger.keywords) {
      if (inputLower.includes(kw.toLowerCase())) score += 2;
    }

    // 预编译正则匹配（不再每次 new RegExp）
    const patterns = this.compiledPatterns.get(id) ?? [];
    for (const re of patterns) {
      if (re.test(input)) score += 3;
    }

    // 上下文标签
    for (const tag of skill.trigger.contextTags) {
      if (contextTags.includes(tag)) score += 1;
    }

    score *= (0.5 + skill.stats.confidence * 0.5);
    if (score > 0) results.push({ skill, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.map(r => r.skill);
}
```

**预期收益**：

| 经验节点数 | 当前 (O(n)) | 优化后 (候选) | 提升 |
|-----------|------------|-------------|------|
| 10 | 10 次遍历 | ~3 候选 | 3x |
| 50 | 50 次遍历 | ~5 候选 | 10x |
| 200 | 200 次遍历 | ~8 候选 | 25x |

---

### P4: 语义缓存 — 不同措辞同一意图

**原理**：将用户输入抽象为意图指纹，不同措辞但相同意图的请求命中同一缓存。

**改动范围**：

```
src/tools/cache.ts — 新增 SemanticToolCache 层
```

**实现逻辑**：

```typescript
// cache.ts — 新增语义缓存层
export class SemanticToolCache {
  private exactCache = new ToolCache(200);
  private intentCache = new Map<string, {
    intentHash: string;
    toolCalls: Array<{ name: string; args: any; result: string }>;
    timestamp: number;
  }>();

  // 意图指纹：提取核心语义词，忽略停用词和措辞
  computeIntentHash(content: string): string {
    const tokens = simpleTokenize(content)
      .filter(t => t.length >= 2)
      .sort()
      .slice(0, 8);
    return tokens.join('|');
  }

  get(content: string): CachedResult | null {
    // 1. 精确缓存（工具级别）
    // 2. 意图缓存（对话级别）
    const hash = this.computeIntentHash(content);
    const cached = this.intentCache.get(hash);
    if (cached && Date.now() - cached.timestamp < 60_000) {
      return cached;
    }
    return null;
  }

  set(content: string, toolCalls: CachedResult[]): void {
    const hash = this.computeIntentHash(content);
    this.intentCache.set(hash, {
      intentHash: hash,
      toolCalls,
      timestamp: Date.now(),
    });
  }
}
```

**预期收益**：重复意图请求（不同措辞）从 ~3s → <10ms

---

### P5: 多工具并行执行

**原理**：LLM 一次返回多个 tool_call 时，无依赖关系的工具并行执行。

**改动范围**：

```
src/core/llm.ts — chatWithPromptTools 中工具执行改为并行
```

**实现逻辑**：

```typescript
// llm.ts — chatWithPromptTools 循环内
for (const tc of normalized.toolCalls) {
  // 原来: 串行 await toolDef.execute(repaired)
  // 改为: 收集后 Promise.allSettled
}

// 改造后:
const toolExecutions = normalized.toolCalls.map(async (tc) => {
  const repaired = this.toolCaller.repairArgs(tc.name, tc.arguments) ?? tc.arguments;

  if (this.beforeToolExecute) {
    const check = await this.beforeToolExecute(tc.name, repaired);
    if (!check.allowed) {
      return { name: tc.name, args: repaired, result: `[已拦截: ${check.reason}]` };
    }
  }

  const toolDef = this.toolCaller.getTool(tc.name);
  if (!toolDef) {
    return { name: tc.name, args: repaired, result: `[工具不存在: ${tc.name}]` };
  }

  try {
    const result = String(await toolDef.execute(repaired));
    return { name: tc.name, args: repaired, result: result.slice(0, 10000) };
  } catch (err) {
    return { name: tc.name, args: repaired, result: `[执行错误: ${err}]` };
  }
});

const results = await Promise.allSettled(toolExecutions);
for (const r of results) {
  if (r.status === 'fulfilled') {
    allToolCalls.push(r.value);
    currentMessages.push({ role: 'user', content: `工具 ${r.value.name} 返回: ${r.value.result}` });
  }
}
```

**预期收益**：3 个并行工具从 ~150ms → ~50ms（3x）

---

### P6: 执行反思门 — 经验执行后质量自评估

**原理**：经验执行后，用规则快速评估输出质量，质量差时自动降级到 LLM 重新处理。

**依据**：Reflexion 框架 — 反思循环提升精度 24%

**改动范围**：

```
src/intelligence/experience-executor.ts — execute() 末尾新增反思
src/core/message-processor.ts — processStream 根据反思结果决策
```

**实现逻辑**：

```typescript
// experience-executor.ts — execute() 返回前新增
const reflection = this.reflect(skill, result, userIntent);
if (reflection.shouldRequery) {
  return {
    ...result,
    success: false,  // 标记为需要重新处理
    error: `反思不通过: ${reflection.issues.join(', ')}`,
    needsLLMFallback: true,
  };
}

private reflect(skill, result, userIntent): ReflectionOutcome {
  const issues: string[] = [];
  const output = Object.values(result.outputs).join('');

  if (output.length < 10) issues.push('输出过短');
  if (result.executionMs > skill.stats.avgExecutionMs * 3) issues.push('执行超时');
  if (/\[拒绝|失败|error|denied/i.test(output)) issues.push('包含错误');

  const intentTokens = simpleTokenize(userIntent);
  const outputTokens = simpleTokenize(output);
  const overlap = intentTokens.filter(t => outputTokens.includes(t));
  if (overlap.length < intentTokens.length * 0.15) issues.push('与意图不匹配');

  return {
    quality: issues.length === 0 ? 'good' : issues.length <= 1 ? 'acceptable' : 'poor',
    issues,
    shouldRequery: issues.length >= 2,
  };
}
```

**预期收益**：经验执行错误率从 ~5% → ~1%（通过自动降级兜底）

---

### P7: 消息历史压缩

**原理**：早期对话和工具结果消息压缩，减少传给 LLM 的 token 数。

**改动范围**：

```
src/core/message-processor.ts — buildMessages 中新增压缩逻辑
```

**实现逻辑**：

```typescript
// message-processor.ts
function compressMessages(messages: Message[], keepRecent = 5): Message[] {
  return messages.map((m, i) => {
    const isRecent = i >= messages.length - keepRecent;
    if (isRecent) return m;  // 最近 5 条保持原样

    // 工具结果消息：只保留摘要
    if (m.role === 'user' && m.content.startsWith('工具 ') && m.content.length > 500) {
      return { ...m, content: m.content.slice(0, 200) + '\n... [已压缩]' };
    }

    // 长消息：截断
    if (m.content.length > 300) {
      return { ...m, content: m.content.slice(0, 150) + '... [已截断]' };
    }

    return m;
  });
}
```

**预期收益**：对话历史 token -30-40%，LLM 推理更快

---

## 三、实施路线图

### Phase 1: 基础加速（1-2 天）

| 序号 | 方案 | 文件 | 风险 | 收益 |
|------|------|------|------|------|
| P3 | 倒排索引 + 预编译正则 | experience-graph.ts | 低 | 高 |
| P5 | 多工具并行执行 | llm.ts | 低 | 中 |
| P2 | buildContext 分层缓存 | message-processor.ts | 低 | 高 |

**Phase 1 预期**：基础路径延迟 -50%，工具执行 -60%

### Phase 2: 智能路由（2-3 天）

| 序号 | 方案 | 文件 | 风险 | 收益 |
|------|------|------|------|------|
| P0 | 投机预执行 | message-processor.ts | 中 | 高 |
| P1 | 自动 DAG 检测 | message-processor.ts | 中 | 高 |
| P6 | 执行反思门 | experience-executor.ts | 低 | 中 |

**Phase 2 预期**：高频任务 -70% 延迟，复杂任务 -50% 延迟

### Phase 3: 深度优化（3-5 天）

| 序号 | 方案 | 文件 | 风险 | 收益 |
|------|------|------|------|------|
| P4 | 语义缓存 | cache.ts | 中 | 中 |
| P7 | 消息历史压缩 | message-processor.ts | 低 | 中 |

**Phase 3 预期**：重复请求 -95% 延迟，token 消耗 -30%

---

## 四、效果总览

```
                    当前延迟      Phase 1 后    Phase 2 后    Phase 3 后
                    ──────────   ──────────   ──────────   ──────────
经验直觉 (exp)      ~400ms       ~200ms       ~160ms       ~160ms
经验+验证           ~1.5s        ~0.8s        ~0.6s        ~0.5s
纯 LLM              ~5s          ~3s          ~2.5s        ~2s
多步工具链           ~10s         ~6s          ~4s          ~3.5s
DAG 并行 (3任务)     ~6s          ~3s          ~2s          ~2s
重复意图             ~5s          ~3s          ~2.5s        ~10ms(缓存)
```

### Token 节省

| 场景 | 当前 | 优化后 | 节省 |
|------|------|--------|------|
| 高频用户 (100次/天) | ~300K token | ~60K token | -80% |
| 对话历史传递 | ~4K token/次 | ~2.5K token/次 | -37% |
| 工具描述注入 | ~2K token/次 | ~800 token/次 | -60% |

---

## 五、风险与约束

### 安全红线（不可逾越）

- 投机预执行**只限只读工具**（read_file / git_status / list_files）
- exec / write_file / search_web 等有副作用的工具绝不预执行
- 语义缓存的 TTL 不超过 60s，防止过期数据
- DAG 自动检测失败必须降级到 ReAct，不能丢任务
- 执行反思门的降级必须回到原有 LLM 路径

### 不改变的本质

- 所有优化都是**透明的**，用户无感知
- 功能集不变：能做什么还是能做什么
- 决策逻辑不变：LLM 做工具选择，经验做加速
- 安全模型不变：沙箱 + 信任度 + 确认拦截

---

## 六、验收标准

### Phase 1 验收

- [ ] ExperienceGraph.match() 50 节点时 <1ms（当前 ~5ms）
- [ ] 3 个并行工具执行 <60ms（当前 ~150ms）
- [ ] buildContext 连续对话 <50ms（当前 ~150ms）

### Phase 2 验收

- [ ] 高置信度经验投机预执行命中率 >60%
- [ ] 复杂请求自动 DAG 检测准确率 >80%
- [ ] 经验执行反思门拦截率 >90%（对低质量结果）

### Phase 3 验收

- [ ] 相同意图不同措辞的缓存命中率 >70%
- [ ] 对话历史 token 减少 >30%
