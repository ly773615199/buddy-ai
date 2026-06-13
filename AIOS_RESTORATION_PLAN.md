# AIOS 决策执行能力恢复计划

> 生成时间：2026-04-27
> 基于：全量代码审计 + 开发计划对比 + 实际消息路径追踪
> 目标：将已实现但未接入的智能模块重新接入消息主路径，恢复自进化能力

---

## 问题诊断

### 消息主路径对比

```
当前路径（所有消息）：
  用户消息 → preprocessMessage() → processStream() → LLM.chat() → 返回
                                                          ↑
                                              所有消息都走这里，无路由

应有的路径：
  用户消息 → preprocessMessage() → ExperienceRouter.route()
                                        ↓
                        ┌───────────────┼───────────────┐
                        ↓               ↓               ↓
                  exp_direct      exp_verified      llm_only
                  (零LLM)       (执行+LLM质检)    (LLM+强制学习)
                        ↓               ↓               ↓
                  执行已学经验    执行经验+验证    processStream()
                  置信度↑         置信度更新      → 编译新经验
```

### 断裂点清单

| # | 断裂点 | 位置 | 影响 |
|---|--------|------|------|
| 1 | ExperienceRouter 从未被调用 | agent.ts / ws-handler.ts | 学过的经验永远不被复用 |
| 2 | orchestrate() 用关键词匹配领域，不用 ExperienceRouter | agent.ts:orchestrate() | 决策质量低 |
| 3 | CLI 路径不走 orchestrate() | agent.ts:handleCLIMessage() | CLI 模式无智能路由 |
| 4 | ExperienceEvolver.compileFromConversation() 未接入主路径 | message-processor.ts | 对话不会自动编译成经验 |
| 5 | KnowledgeInterviewer.analyzeAndDecide() 未被调用 | message-processor.ts | 不会主动提问填补知识缺口 |
| 6 | 训练管道无自动触发 | lora/ternary | 知识积累到成熟不会自动训练 |
| 7 | orchestrate() 决策不记录到 DecisionRecorder | agent.ts | 决策不可追溯 |

---

## 实施计划

### Phase 1：ExperienceRouter 接入编排决策（核心）

**目标**：orchestrate() 用 ExperienceRouter 替代关键词匹配

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
// orchestrate() 中，替换 detectDomains() 为 ExperienceRouter.route()
orchestrate(content: string): OrchestrationPlan {
  // Step 1: 先查经验图谱
  const routeDecision = this.sys.experienceRouter.route(content);

  // Step 2: 根据路由路径决定协作模式
  if (routeDecision.path === 'exp_direct') {
    // 高置信度经验 → 零 LLM
    return { mode: 'local_only', reason: `经验直连: ${routeDecision.skill.id}`, ... };
  }
  if (routeDecision.path === 'exp_verified') {
    // 中置信度 → 执行 + LLM 质检
    return { mode: 'cascade', reason: `经验+质检: ${routeDecision.skill.id}`, ... };
  }
  // exp_hint / llm_only → 走原有逻辑，但把经验作为 hint
  // ...保留原有复杂度评估 + 节点选择逻辑
}
```

**预估工时**：1 天

---

### Phase 2：executeByPlan() 接入经验执行器

**目标**：local_only / cascade 模式用 ExperienceExecutor 执行已学经验

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
// executeLocal() 中，用 ExperienceExecutor 替代直接调 ternaryRouter
private async executeLocal(plan: OrchestrationPlan): Promise<ExecutionResult> {
  const node = plan.selectedNodes[0];
  if (node?.skillId) {
    const skill = this.sys.experienceGraph.getNode(node.skillId);
    if (skill) {
      const result = await this.sys.experienceExecutor.execute(skill);
      // 更新置信度
      if (result.success) {
        this.sys.experienceEvolver.onSuccess(skill.id, result.durationMs);
      } else {
        this.sys.experienceEvolver.onFailure(skill.id, result.error ?? '');
      }
      return { text: result.reply, source: `exp/${skill.id}`, toolCalls: result.toolCalls };
    }
  }
  return this.executeSingle(plan); // fallback
}
```

**预估工时**：0.5 天

---

### Phase 3：CLI 路径接入编排

**目标**：handleCLIMessage() 也走 orchestrate() + executeByPlan()

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
async handleCLIMessage(content: string): Promise<string> {
  this.preprocessMessage(content);

  // 接入编排决策（与 WS 路径统一）
  const plan = this.orchestrate(content);
  const result = await this.executeByPlan(plan);

  this.postprocessResult(content, result);
  return result.text;
}
```

**预估工时**：0.5 天

---

### Phase 4：经验自动编译接入

**目标**：每次成功对话后自动编译新经验

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
postprocessResult(content, result): void {
  // ...现有逻辑...

  // 新增：成功对话自动编译经验
  if (result.toolCalls.length > 0) {
    const conv: ConversationSnapshot = {
      id: `conv-${Date.now()}`,
      userMessage: content,
      assistantReply: result.text,
      toolCalls: result.toolCalls,
      timestamp: Date.now(),
      wasSuccessful: true,
    };
    // 异步编译，不阻塞主路径
    this.sys.intelligence.evolver.canCompile() &&
      this.sys.intelligence.evolver.compileFromConversation(conv)
        .catch(err => { if (this.verbose) console.warn('[Evolver] 编译失败:', err.message); });
  }
}
```

**注**：`learnFromConversation()` 已在 `postprocessResult()` 中调用，但它是通过 `processor.learnFromConversation()` 间接调用的。需要确认 `intelligence.learn()` 内部是否调用了 `evolver.compileFromConversation()`。如果没有，需要补上。

**预估工时**：0.5 天

---

### Phase 5：主动提问引擎接入

**目标**：对话结束后异步分析是否需要追问

**改动文件**：`src/core/ws-handler.ts`

**改动内容**：

```typescript
// handleUserMessage() 末尾，result 返回后：
async handleUserMessage(content: string, msgId?: string): Promise<void> {
  // ...现有逻辑...

  // result 返回后，异步分析是否追问
  try {
    const question = await this.processor.analyzeAndAsk();
    if (question) {
      this.eventBus?.emit({ type: 'bubble', text: question });
    }
  } catch { /* 追问失败不影响主流程 */ }
}
```

**预估工时**：0.5 天

---

### Phase 6：决策可追溯性

**目标**：每次编排决策记录到 DecisionRecorder

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
orchestrate(content: string): OrchestrationPlan {
  // ...现有决策逻辑...

  // 新增：记录决策到 DecisionRecorder
  this.sys.llm.getDecisionRecorder()?.record({
    input: content.slice(0, 500),
    intent: plan.domains.join(','),
    domain: plan.domains[0] ?? null,
    novelty: routeDecision.novelty ?? 0,
    complexity: plan.complexity,
    selectedNode: plan.selectedNodes.map(n => n.id).join('+'),
    selectionReason: plan.reason,
    success: true,
    latencyMs: 0,
    inputTokens: 0, outputTokens: 0, costEstimate: 0,
    fallbackTriggered: false,
    collaborationMode: plan.mode,
    localCoverageRatio: plan.meta.localCoverageRatio,
    localConfidence: plan.meta.localConfidence,
  });

  return plan;
}
```

**注**：orchestrate() 末尾已有 DecisionRecorder 调用，但记录的是固定值。需要把 routeDecision 的 novelty 等真实值传入。

**预估工时**：0.5 天

---

### Phase 7：训练管道自动触发

**目标**：领域知识达到 trainable 阶段时自动触发训练

**改动文件**：`src/core/agent.ts` 或 `src/core/message-processor.ts`

**改动内容**：

```typescript
// 在 extractKnowledgeAsync() 或 learnFromConversation() 中：
// 检查领域是否达到 trainable 阈值
const profiles = this.sys.cognitive.getAllDomainProfiles();
for (const profile of profiles) {
  if (profile.growthStage === 'trainable' && !profile.trainingTriggered) {
    // 自动导出训练数据
    const exporter = new TrainingExporter(this.sys.stmp, this.sys.cognitive, ...);
    const result = await exporter.exportDomain(profile.domain);
    if (result.exportedSamples >= 10) {
      // 自动提交训练
      await this.sys.loraService.startTraining(profile.domain);
      profile.trainingTriggered = true; // 防止重复触发
    }
  }
}
```

**预估工时**：1 天

---

### Phase 8：停滞检测 + 自动恢复

**目标**：ExperienceEvolver 的停滞检测结果反馈到编排决策

**改动文件**：`src/core/agent.ts`

**改动内容**：

```typescript
orchestrate(content: string): OrchestrationPlan {
  // 如果经验系统处于停滞状态，跳过经验路由，直接走 LLM
  if (this.sys.intelligence.evolver.isStagnant()) {
    return { mode: 'single', reason: '经验系统停滞中，走 LLM', ... };
  }
  // ...正常路由逻辑
}
```

**预估工时**：0.5 天

---

## 总工时

| Phase | 内容 | 工时 | 优先级 |
|-------|------|------|--------|
| 1 | ExperienceRouter 接入编排决策 | 1 天 | P0 |
| 2 | executeByPlan 接入经验执行器 | 0.5 天 | P0 |
| 3 | CLI 路径接入编排 | 0.5 天 | P0 |
| 4 | 经验自动编译接入 | 0.5 天 | P1 |
| 5 | 主动提问引擎接入 | 0.5 天 | P1 |
| 6 | 决策可追溯性 | 0.5 天 | P2 |
| 7 | 训练管道自动触发 | 1 天 | P2 |
| 8 | 停滞检测 + 自动恢复 | 0.5 天 | P2 |
| **合计** | | **5 天** | |

---

## 实施顺序

```
Phase 1-3（2 天）→ 核心路径打通，经验可以被复用
     ↓
Phase 4-5（1 天）→ 学习闭环，对话自动编译 + 主动提问
     ↓
Phase 6-8（2 天）→ 可观测性 + 自动化
```

**Phase 1-3 完成后**：Buddy 能从经验图谱中复用已学过的工具组合，不再每次从零调 LLM。
**Phase 4-5 完成后**：每次成功对话自动编译新经验，知识缺口自动追问。形成"用→学→用"闭环。
**Phase 6-8 完成后**：决策可追溯，训练自动触发，停滞自动恢复。完整的 AIOS 自进化循环。

---

## 验证方案

### Phase 1-3 验证

```bash
# 1. 启动 WS 服务
npm run dev:ws

# 2. 发送一个之前学过的任务（如"列一下当前目录文件"）
# 预期：orchestrate 输出 mode=local_only，走 exp_direct，不调 LLM
# 日志应显示：[Orchestrate] mode=local_only reason=经验直连: xxx

# 3. 发送一个新任务
# 预期：走 llm_only，调 LLM，对话后自动编译新经验

# 4. CLI 模式测试
npx tsx src/main.ts
# 预期：同样走 orchestrate 路径
```

### Phase 4-5 验证

```bash
# 1. 发送一个包含工具调用的对话
# 预期：日志显示 [Evolver] 编译成功: xxx

# 2. 再次发送类似任务
# 预期：命中刚编译的经验，走 exp_direct

# 3. 知识缺口测试
# 发送一个领域相关但知识不足的问题
# 预期：[Interviewer] 追问: xxx
```

### Phase 6-8 验证

```bash
# 1. 查看决策记录
cat ~/.buddy/decision-records.jsonl | tail -5

# 2. 查看进化事件
cat ~/.buddy/experience-events.jsonl | tail -10

# 3. 领域成熟后自动训练
# 预期：日志显示 [LoRA] 自动训练触发: domain=xxx
```

---

## 风险与降级

| 风险 | 降级方案 |
|------|---------|
| ExperienceRouter 匹配质量差 | 保留原有 orchestrate() 逻辑作为 fallback |
| 编译出的经验质量低 | 停滞检测自动暂停 + 置信度门槛过滤 |
| 主动提问太频繁 | 频率限制（每对话最多 1 次）+ 情绪过滤 |
| 训练成本高 | 先只做 Prompt Injection，LoRA 手动触发 |
| CLI/WS 路径不一致 | Phase 3 统一后，两者共用 orchestrate() |

---

*v1.0 — 2026-04-27 | 基于全量代码审计 + 开发计划对比*
