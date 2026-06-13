# Task 005: 本地微模型桥接

## 目标

让三进制专家模型自动融入 ModelRouter 的决策链。

## 改动文件

- `src/core/model-router.ts`（扩展）
- `src/core/subsystems.ts`（桥接注册）

## 设计

### 自动注册流程

```
三进制专家训练完成
  → TernaryScheduler 通知
  → ModelRouter.registerLocalExpert(domain, {
      execute: (prompt) => ternaryRouter.query(domain, prompt),
      confidence: 0,  // 初始为 0，随使用积累
      capabilities: { toolCalling: false, streaming: false, ... }
    })
  → 路由决策时自动检查：domain 匹配 + confidence > 0.7 → 使用
```

### 置信度来源

- **训练指标**：训练完成时的 finalLoss → 映射为初始置信度
- **推理反馈**：每次使用后，根据 LLM 对结果的评价调整
- **用户反馈**：用户说"回答得好" → +0.1，"不对" → -0.2

### ModelRouter 中的本地模型决策

```typescript
// 决策链第 3 步
private tryLocalExpert(taskType: TaskType, ctx: TaskContext): ModelConfig | null {
  if (taskType !== 'domain' || !ctx.domainMatch) return null;
  
  const expert = this.localExperts.get(ctx.domainMatch);
  if (!expert) return null;
  
  if (expert.confidence < 0.7) return null;  // 置信度不够，不冒险
  
  return {
    model: expert,  // 伪装成 LanguageModel 接口
    capabilities: expert.capabilities,
    source: `local/${ctx.domainMatch}`,
  };
}
```

## 验收标准

- [ ] `ModelRouter.registerLocalExpert()` 注册本地专家
- [ ] `ModelRouter.unregisterLocalExpert()` 移除
- [ ] 路由决策第 3 步检查本地专家：domain 匹配 + confidence > 0.7
- [ ] 置信度 < 0.7 时自动回退到云端模型
- [ ] 本地专家调用结果通过 `recordOutcome()` 反馈置信度
- [ ] Subsystems 中训练完成事件触发注册

## 依赖

- Task 003（ModelRouter）
- 现有 `src/ternary/` 模块（不改动，只桥接）

## 备注

本地专家模型需要包装成 AI SDK 的 `LanguageModel` 接口，或者 ModelRouter 内部做适配。
最简单的方案：ModelRouter 对本地模型走独立的调用路径，不强求接口统一。
