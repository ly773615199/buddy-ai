# Task 007: Buddy 经验学习

## 目标

Buddy 根据实际调用效果自动调整路由策略，不再完全依赖硬编码规则。

## 改动文件

- `src/core/model-router.ts`（扩展学习逻辑）
- `src/core/ws-handler.ts`（调用结果上报）

## 设计

### 数据结构

```typescript
interface RouteOutcome {
  taskType: TaskType;
  modelId: string;           // 'primary' | 'lightweight' | 'local/xxx'
  provider: string;
  modelName: string;
  success: boolean;
  latencyMs: number;
  errorType?: string;        // 'timeout' | 'rate_limit' | 'quality' | 'unknown'
  timestamp: number;
}

interface LearnedPreference {
  taskType: TaskType;
  preferredModel: string;
  confidence: number;        // 0-1
  sampleCount: number;
  lastUpdated: number;
}
```

### 学习规则

```typescript
recordOutcome(outcome: RouteOutcome): void {
  // 1. 记录到历史（保留最近 100 条/task）
  this.outcomes.push(outcome);
  
  // 2. 更新滑动窗口统计
  const stats = this.getWindowStats(outcome.taskType, outcome.modelId);
  
  // 3. 连续失败 3 次 → 标记该模型不适合该任务
  if (stats.recentFailures >= 3) {
    this.blockedCombinations.add(`${outcome.taskType}:${outcome.modelId}`);
  }
  
  // 4. 成功率 > 80% 且样本 >= 5 → 标记为优选
  if (stats.successRate > 0.8 && stats.count >= 5) {
    this.learnedPrefs.set(outcome.taskType, {
      preferredModel: outcome.modelId,
      confidence: stats.successRate,
      sampleCount: stats.count,
    });
  }
  
  // 5. 延迟异常高 → 降级（如果有可能的话）
  if (outcome.latencyMs > this.latencyThresholds[outcome.taskType]) {
    this.tryDowngrade(outcome.taskType);
  }
}
```

### 查询接口

```typescript
// 决策链第 4 步调用
getLearnedPreference(taskType: TaskType): string | null {
  const pref = this.learnedPrefs.get(taskType);
  if (!pref || pref.confidence < 0.7 || pref.sampleCount < 3) return null;
  return pref.preferredModel;
}

// 被屏蔽的组合
isBlocked(taskType: TaskType, modelId: string): boolean {
  return this.blockedCombinations.has(`${taskType}:${modelId}`);
}
```

### 持久化

学习结果保存到 `~/.buddy/router-learned.json`，重启后加载。

## 验收标准

- [ ] `recordOutcome()` 记录每次调用结果
- [ ] 连续失败 3 次自动屏蔽该模型+任务组合
- [ ] 成功率 > 80% 自动标记为优选
- [ ] `getLearnedPreference()` 返回学到的最优模型
- [ ] 学习结果持久化到文件，重启后恢复
- [ ] 学习数据有上限（每个任务最多 100 条历史），防止内存泄漏

## 依赖

- Task 003（ModelRouter 基础）

## 备注

学习是渐进的，初期样本不足时完全依赖默认规则。随着使用积累，Buddy 会越来越"懂"哪个模型适合什么任务。
