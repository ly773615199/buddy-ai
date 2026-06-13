# Task 003: ModelRouter 核心实现

## 目标

新建 `src/core/model-router.ts`，实现模型选择的核心决策引擎。

## 设计

### 决策链（按优先级）

```
1. 用户 per-message 指定    → ctx.userOverride
2. 用户持久化偏好            → config.preferences[taskType]
3. 本地微模型（领域匹配）     → ternaryRouter.findExpert(domain)
4. Buddy 经验调整           → learnedPreferences[taskType]
5. 系统默认规则             → AUTO_TABLE
```

### 默认路由表（AUTO_TABLE）

```typescript
const AUTO_TABLE = {
  chat:       'lightweight',  // 闲聊 → 轻量
  tools:      'lightweight',  // 工具调用 → 轻量（7B 就够）
  reasoning:  'primary',      // 复杂推理 → 主模型
  background: 'lightweight',  // 后台任务 → 轻量
  domain:     'primary',      // 领域问答（无本地专家时）→ 主模型
};
```

### 任务类型判定

```typescript
type TaskType = 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';

// 判定逻辑（关键词 + 上下文）
function inferTaskType(content: string, context: {
  hasToolCalls: boolean;       // 来自编排器的工具调用
  isBackground: boolean;       // 知识提取/梦境/经验编译
  domainMatch?: string;        // 本地专家匹配的领域
}): TaskType
```

### Buddy 经验学习

```typescript
interface RouteOutcome {
  taskType: TaskType;
  model: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

class ModelRouter {
  // 记录每次调用的结果
  recordOutcome(outcome: RouteOutcome): void;
  
  // 查询某个模型在某任务上的历史表现
  getModelScore(taskType: TaskType, model: string): number;
  
  // 选择模型时，排除近期连续失败的模型
  select(taskType: TaskType, context: TaskContext): ModelConfig;
}
```

## 新建文件

- `src/core/model-router.ts`

## 验收标准

- [ ] `ModelRouter` 类实现决策链（5 层优先级）
- [ ] `inferTaskType()` 能根据内容和上下文判断任务类型
- [ ] `select()` 返回 `{ model, capabilities, source }` — source 标记决策来源
- [ ] `recordOutcome()` 记录调用结果，连续失败 3 次自动排除该模型
- [ ] lightweight 未配置时，所有任务走 primary（降级为单模型模式）
- [ ] `getLearnedPreference()` 返回 Buddy 学到的最优模型（或 null）
- [ ] 有完整的单元测试覆盖

## 依赖

- Task 001（ProviderFactory）
- Task 002（类型定义）

## 备注

这是整个 Epic 的核心模块。设计为纯逻辑类，不直接依赖 LLM SDK，只操作 ModelConfig 对象。
