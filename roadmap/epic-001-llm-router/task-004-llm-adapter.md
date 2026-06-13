# Task 004: LLMAdapter 集成路由器

## 目标

改造 `LLMAdapter`（`src/core/llm.ts`）：
- 所有公开方法通过 ModelRouter 选择模型
- Fallback 机制：主模型失败 → lightweight → fallbacks 链
- 移除之前的 `routingModels` Map（用 ModelRouter 替代）

## 改动文件

- `src/core/llm.ts`

## 改动要点

### 构造函数

```typescript
constructor(config: BuddyConfig['llm']) {
  // 1. ProviderFactory 创建主模型
  // 2. 创建 lightweight 模型（如果配置了）
  // 3. 创建 fallback 模型链
  // 4. 初始化 ModelRouter
  this.router = new ModelRouter(config, { primary, lightweight, fallbacks });
}
```

### chat() 改造

```typescript
async chat(messages, tools, maxSteps, options?: { taskType?: TaskType; userOverride?: string }) {
  const model = this.router.select(options?.taskType ?? inferTaskType(messages), context);
  
  try {
    return await this.callModel(model, messages, tools, maxSteps);
  } catch (err) {
    // fallback 链
    for (const fb of this.router.getFallbacks(model)) {
      try { return await this.callModel(fb, messages, tools, maxSteps); }
      catch { continue; }
    }
    throw err;
  }
}
```

### streamChat() 改造

同 chat()，选模型后调用 streamText。

### structuredOutput() 改造

选模型时需要考虑 `capabilities.structuredOutput`，不支持的自动走 Prompt 模拟路径。

### 新增方法

```typescript
// 获取路由器（供外部查询/学习）
getRouter(): ModelRouter

// 获取当前模型摘要（供状态展示）
getModelSummary(): { primary: string; lightweight?: string; fallbacks: string[] }
```

## 验收标准

- [ ] `chat()` 通过 ModelRouter 选模型，不再直接用 `this.model`
- [ ] `streamChat()` 同上
- [ ] `structuredOutput()` 同上，且能根据模型能力选择原生/Prompt 模拟路径
- [ ] Fallback 链工作：primary 失败 → lightweight → fallbacks → 报错
- [ ] `testConnection()` 保持不变（测试主模型连接）
- [ ] `getModelSummary()` 返回所有已配置模型的信息
- [ ] 现有调用方（message-processor.ts、subsystems.ts）无需改动（接口兼容）

## 依赖

- Task 001（ProviderFactory）
- Task 002（类型定义）
- Task 003（ModelRouter）

## 备注

关键是保持公开接口兼容。chat/streamChat/structuredOutput 的签名只增加可选参数，不破坏现有调用。
