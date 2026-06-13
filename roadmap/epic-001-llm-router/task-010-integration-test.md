# Task 010: 集成测试

## 目标

验证整个路由器系统的端到端功能。

## 改动文件

- `src/core/model-router.test.ts`（新建）
- `src/core/llm.test.ts`（新建或更新）

## 测试场景

### 1. 基础路由

```
配置: primary=siliconflow/72B, lightweight=siliconflow/7B
测试:
  - 闲聊消息 → 应选 lightweight
  - 复杂代码任务 → 应选 primary
  - 未配置 lightweight → 全走 primary
```

### 2. Fallback

```
配置: primary=mock(会失败), lightweight=mock(会失败), fallbacks=[mock(成功)]
测试:
  - primary 失败 → 自动切 lightweight → 还失败 → 切 fallback → 成功
  - 全部失败 → 抛出最后一个错误
```

### 3. 用户覆盖

```
测试:
  - /model primary → 闲聊也走 primary
  - /model auto → 恢复自动路由
  - preferences 配置 → manual 模式按偏好走
```

### 4. 本地专家

```
测试:
  - 注册本地专家(domain='react', confidence=0.8)
  - React 相关问题 → 选本地专家
  - 注册本地专家(domain='react', confidence=0.5)
  - React 相关问题 → 置信度不够，走云端
```

### 5. 经验学习

```
测试:
  - 连续记录 3 次失败 → 该组合被屏蔽
  - 记录 5 次成功(80%+) → 标记为优选
  - 重启后学习数据恢复
```

## 验收标准

- [ ] model-router.test.ts 覆盖上述 5 个场景
- [ ] 所有测试通过
- [ ] 测试使用 MockLLM，不依赖真实 API
- [ ] 边界情况：无 lightweight、无 fallbacks、空配置

## 依赖

- Task 003-007（所有核心模块）

## 备注

使用项目已有的 vitest 框架。MockLLM 已存在于 src/core/mock-llm.ts，可复用。
