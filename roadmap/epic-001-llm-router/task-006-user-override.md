# Task 006: 用户覆盖机制

## 目标

用户可以通过两种方式手动控制模型选择：
1. **即时覆盖**：`/model` 命令指定当前会话/消息用哪个模型
2. **持久化偏好**：配置 `preferences` 字段，长期生效

## 改动文件

- `src/core/ws-handler.ts`（处理 /model 命令）
- `src/core/message-processor.ts`（传递 userOverride）
- `src/core/model-router.ts`（读取 preferences）

## 设计

### /model 命令

```
/model                          # 查看当前模型和路由状态
/model primary                  # 切换到主模型
/model lightweight              # 切换到轻量模型
/model local/react              # 切换到本地 React 专家
/model siliconflow/Qwen-72B     # 指定具体模型（本次会话有效）
/model auto                     # 恢复自动路由
```

### 命令处理

```typescript
// ws-handler.ts
case 'command':
  if (msg.command === 'model') {
    const arg = msg.args?.trim();
    if (!arg || arg === 'status') {
      // 展示当前路由状态
      broadcastModelStatus();
    } else if (arg === 'auto') {
      // 清除用户覆盖
      router.clearUserOverride();
    } else {
      // 设置用户覆盖
      router.setUserOverride(arg);
    }
  }
```

### preferences 配置

```typescript
// types.ts llm 字段
preferences?: Record<string, string>;
// 示例：
// { "code_review": "primary", "daily_chat": "lightweight", "react": "local/react" }
```

### 消息传递

```typescript
// message-processor.ts
async processBatch(content: string, eventBus, options?: { userOverride?: string }) {
  const taskType = inferTaskType(content, context);
  const model = router.select(taskType, { userOverride: options?.userOverride });
  // ...
}
```

## 验收标准

- [ ] `/model` 命令展示当前模型和路由状态
- [ ] `/model primary` 切换到主模型（本次会话有效）
- [ ] `/model auto` 恢复自动路由
- [ ] `/model local/<domain>` 切换到本地专家（如果存在）
- [ ] `preferences` 配置在 `routingMode: 'manual'` 时生效
- [ ] 用户覆盖优先级最高（决策链第 1 步）
- [ ] 覆盖状态在 WebSocket 断开后重置（即时覆盖不持久化）

## 依赖

- Task 003（ModelRouter）
- Task 004（LLMAdapter）

## 备注

/user_override 是会话级的，不写入配置文件。preferences 是配置级的，持久化。
