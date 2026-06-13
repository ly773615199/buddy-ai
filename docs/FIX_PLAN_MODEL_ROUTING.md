# 修复方案：模型路由 400 + 重放消息去重

> 日期: 2026-05-10
> 状态: 待实施
> 优先级: P0（阻塞对话功能）

## 问题 1：硅基流动 400 "Model does not exist"

### 复现路径

```
用户发消息 → LLMAdapter.chat()
  → ModelRouter.select(taskType='chat')
    → ModelPool.layer0StaticFilter() — 只看 active/streaming/cost
    → ModelPool.layer1MetadataFilter() — chat 没设 preferredCategories
    → Thompson Sampling 选中 bge-reranker-v2-m3
  → ProviderFactory.create({ provider: 'siliconflow', model: 'BAAI/bge-reranker-v2-m3' })
  → 硅基流动 /v1/chat/completions → 400: "Model does not exist"
```

### 根因

模型发现（model-discovery.ts）从硅基流动 `/v1/models` 拉取全部模型（含 embedding/reranker），
enrichment 正确标记了 category='reranker'，但选择漏斗的 layer0/layer1 没有使用这个信息过滤。

### 修复方案

#### 改动 1：ModelProfile 新增派生能力字段

文件: `src/core/model-pool.ts`

```typescript
interface ModelProfile {
  // ... 现有字段 ...

  /** 从 category/pipelineTag/静态知识派生的能力硬约束 */
  derived?: {
    chatCapable: boolean;
    toolCapable: boolean;
    embedCapable: boolean;
    visionCapable: boolean;
  };
}
```

#### 改动 2：rawToProfile() 填充 derived

文件: `src/core/model-discovery.ts`

```typescript
function rawToProfile(raw, config, litellmData, enrichment): ModelProfile | null {
  // ... 现有逻辑 ...

  // 派生能力判断
  const chatCapable = isChatCapable(profile);
  profile.derived = {
    chatCapable,
    toolCapable: chatCapable && profile.capabilities.toolCalling,
    embedCapable: isEmbedCapable(profile),
    visionCapable: enrichment?.category === 'vl-chat' || profile.capabilities.vision,
  };

  return profile;
}

function isChatCapable(p: ModelProfile): boolean {
  // 1. pipelineTag 明确
  if (p.pipelineTag) {
    const CHAT_TAGS = new Set([
      'text-generation', 'image-text-to-text', 'any-to-any',
      'conversational', 'question-answering',
    ]);
    return CHAT_TAGS.has(p.pipelineTag);
  }
  // 2. category 明确
  if (p.category) {
    return ['chat', 'vl-chat', 'omni-chat'].includes(p.category);
  }
  // 3. 静态知识命中
  // (已有 capabilities 打分说明是已知模型，默认 chat)
  // 4. 名称推断 fallback
  return true; // 向后兼容
}

function isEmbedCapable(p: ModelProfile): boolean {
  if (p.category === 'embedding') return true;
  if (p.pipelineTag === 'feature-extraction' || p.pipelineTag === 'sentence-similarity') return true;
  return false;
}
```

#### 改动 3：layer0 按任务类型过滤

文件: `src/core/model-pool.ts`

```typescript
private layer0StaticFilter(taskType?: TaskType): ModelProfile[] {
  const result: ModelProfile[] = [];
  for (const profile of this.profiles.values()) {
    if (profile.active === false) continue;
    if (this.isExcluded(profile.id)) continue;
    if (!profile.capabilities.streaming) continue;
    if (profile.costPer1kInput > this.preferences.maxCostPer1k * 2) continue;

    // 新增：按任务类型过滤硬约束
    if (taskType && profile.derived) {
      if ((taskType === 'chat' || taskType === 'tools' || taskType === 'reasoning')
          && !profile.derived.chatCapable) continue;
      if (taskType === 'embedding' && !profile.derived.embedCapable) continue;
      if ((taskType === 'image-gen' || taskType === 'image-edit')
          && profile.category !== 'image-gen' && profile.category !== 'image-edit') continue;
    }

    result.push(profile);
  }
  return result;
}
```

同时修改 `selectFromUnified` 传入 taskType：

```typescript
selectFromUnified(requirement: ModelRequirement): ModelSelection | null {
  if (this.profiles.size === 0) return null;

  let candidates = this.layer0StaticFilter(requirement.taskType);  // 传入 taskType
  if (candidates.length === 0) return null;

  candidates = this.layer1MetadataFilter(candidates, requirement);
  if (candidates.length === 0) {
    candidates = this.layer0StaticFilter();  // 降级不传 taskType
    if (candidates.length === 0) return null;
  }

  return this.layer2ThompsonSelect(candidates, requirement);
}
```

#### 改动 4：Cascade 扩展到所有任务

文件: `src/core/llm.ts`

```typescript
// 之前:
if (errorType === 'capability_mismatch' && taskType === 'tools') {

// 之后:
if (errorType === 'capability_mismatch') {
```

---

## 问题 2：重放消息去重

已在代码中实现（验证通过）：

1. `link-handler.ts:91` — `_replaySeq` 注入
2. `useWebSocket.ts` — `lastSeqRef` 追踪 + `recentContentRef` 内容去重
3. `useWebSocket.ts` — `lastSeq > 0` 才 resume
4. `useWebSocket.ts` — `connectGuardRef` 防 StrictMode 双重执行
5. `ws/server.ts` — `shouldReplay()` 白名单排除瞬态事件

无需额外改动。

---

## 实施顺序

1. **阶段 1**（解决 400）: 改动 1-4，~100 行代码 ✅ 已完成
2. **阶段 2**（丰富决策）: queryCapableModels + buildModelRequirement 增强 ✅ 已完成
3. **阶段 3**（闭环反馈）: quality-scorer + taskAffinity EWMA ✅ 已完成
4. **阶段 4**（任务完成感知）: cascade 惩罚 + 工具结果回流 + 任务级 affinity 更新

阶段 4 核心改动：
- `llm.ts`: cascade 成功后调用 `recordFeedback` 惩罚原模型
- `model-router.ts`: 新增 `recordTaskOutcome()` 聚合任务级反馈
- `ws-handler.ts`: 任务结束时调用 `recordTaskOutcome`
- `model-pool.ts`: 新增 `recordTaskFeedback()` 按贡献度批量更新
