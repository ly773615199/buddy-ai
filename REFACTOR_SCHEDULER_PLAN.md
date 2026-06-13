# 调度器重构计划

## 状态

| 项目 | 状态 | 说明 |
|------|------|------|
| 三层调度架构 | ✅ 完成 | 规则快筛 + 经验路由 + 级联兜底 |
| DecisionRecorder | ✅ 完成 | JSONL 持久化、kNN 查询、分维度统计 |
| ModelPool 熔断/恢复 | ✅ 完成 | EWMA 统计、连续失败熔断、自动恢复 |
| Thompson Sampling | ✅ 完成 | Beta 分布近似采样 |
| 前端 ActivityPanel 任务事件展示 | ✅ 完成 | SchedulerSection 组件 + WebSocket 事件 |
| PoolNode capabilities 数据填充 | ✅ 完成 | 自动推断 + 手动覆盖 |
| ProviderLimiter 按 provider/model 粒度追踪 | ✅ 完成 | 滑动窗口 RPM/TPM 追踪 |

## 剩余项详情

### 1. 前端 ActivityPanel 任务事件展示

**目标**：在 ActivityPanel 中新增 "调度" 子标签页，展示调度器的决策历史

**数据源**：
- DecisionRecorder 的 JSONL 记录
- 通过 WebSocket 推送 `schedule_event` 类型事件

**展示内容**：
- 最近调度记录列表（时间、输入摘要、选中节点、层级、原因、延迟、成功/失败）
- 按节点/任务类型的统计饼图
- 调度层级分布（Layer 1/2/3 各占比）

### 2. PoolNode capabilities 数据填充

**目标**：在 PoolNode 中增加 `capabilities` 字段，标记每个模型的能力值

**能力维度**：
- toolCalling: boolean
- vision: boolean
- streaming: boolean
- maxContextTokens: number
- maxOutputTokens: number
- preferredToolFormat: string

**数据来源**：
- 从 ProviderAdapter.getStaticCapabilities() 获取
- 支持手动覆盖（配置文件）

### 3. ProviderLimiter 按 provider/model 粒度追踪

**目标**：实现 provider 级别的速率限制追踪

**实现方案**：
- 滑动窗口计数器（每 provider/model 组合独立追踪）
- 追踪维度：RPM（每分钟请求数）、TPM（每分钟 token 数）
- 超限时自动降级到其他 provider
- 与 ModelPool 的熔断机制协同

## 实施顺序

1. PoolNode capabilities 数据填充（基础设施，影响调度决策）
2. ProviderLimiter 追踪（调度优化）
3. ActivityPanel 任务事件展示（可视化）
