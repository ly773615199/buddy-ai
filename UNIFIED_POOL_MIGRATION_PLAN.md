# 统一模型池迁移计划

> 从旧池（ModelPool + ModelPoolScheduler + primary/lightweight）完全迁移到新池（ModelPool 统一 + 控制面/数据面分离）

## 迁移原则

- 不留残余：旧代码标记 deprecated 或移除
- 渐进式：每个 Phase 独立可验证
- 向后兼容：旧配置自动迁移
- 全量测试：每个 Phase 完成后运行测试

---

## Phase 1: 数据面 — ModelPool 统一

**目标**：合并 ModelPool 和 ModelPoolUnified 为一个 ModelPool

### 1.1 扩展 ModelPool

**文件**：`src/core/model-pool.ts`

新增：
- `profiles: Map<string, ModelProfile>` — 模型画像存储
- `thompsonParams: Map<string, BetaParams>` — Thompson Sampling 参数
- `preferences: UserPoolPreferences` — 用户偏好
- `select(requirement: ModelRequirement): ModelSelection | null` — 三级漏斗选择
- `recordFeedback(modelId, taskType, success, latencyMs, cost)` — 反馈记录
- `initializeFromProviders(providers: PlatformConfig[])` — 自动发现初始化
- `refreshPlatform(config)` — 刷新平台
- `addExclusion()` / `removeExclusion()` / `updatePreferences()` — 用户控制
- `getAllProfiles()` / `getProfile()` / `addProfile()` / `removeProfile()` — 画像管理
- `getThompsonParams()` — 调试用

保留：
- 节点管理（registerNode / getNode / getAvailableNodes）
- 熔断/恢复（circuitBroken / recordSuccess / recordFailure）
- EWMA 统计
- 级联升级（selectUpgraded）
- 统计持久化（pool-stats.json）

### 1.2 废弃 ModelPoolUnified

**文件**：`src/core/model-pool-unified.ts`

- 标记 `@deprecated`
- 内部委托给新 ModelPool
- 保留导出类型（ModelProfile、ModelRequirement、ModelSelection、UserPoolPreferences）

### 1.3 迁移调用入口

ModelDiscovery、ModelKnowledge、DecisionRecorder、ProviderLimiter 保持不变。

**验证**：`model-pool.test.ts` + `model-pool-unified.test.ts` 通过

---

## Phase 2: 控制面 — ModelRouter 统一

**目标**：ModelRouter 成为唯一选择入口

### 2.1 ModelRouter 改造

**文件**：`src/core/model-router.ts`

- `select()` 新增可选参数 `bodyState?: BodyState`
- `buildModelRequirement()` 接收 BodyState，注入 load/energy 调节
- 移除 `setPoolScheduler()` / `getPoolScheduler()` 依赖
- 移除 `setUnifiedPool()` / `getUnifiedPool()` 依赖
- 改为依赖新 ModelPool 的 `select()` 方法
- `recordOutcome()` 统一委托给 ModelPool.recordFeedback()
- 移除本地 learnedPrefs（统一由 ModelPool Thompson Sampling 管理）
- 新增 `consumeLastSelection()` 从 LLMAdapter 迁移

### 2.2 UnifiedScheduler 简化

**文件**：`src/brain/left/scheduler.ts`

- 移除 `unifiedPool` 字段和 `setUnifiedPool()`
- 改为通过 ModelRouter 选择模型
- `schedule()` 改为：构建 ModelRequirement → router.select() → 转 OrchestrationNode
- 保留新颖度路由、元认知控制

### 2.3 废弃 ModelPoolScheduler

**文件**：`src/core/model-pool-scheduler.ts`

- 标记 `@deprecated`
- 保留类定义（向后兼容旧配置）

**验证**：`model-router.test.ts` 通过

---

## Phase 3: 执行面 — LLMAdapter 瘦身 ✅

**目标**：LLMAdapter 只做执行

### 3.1 迁移初始化 ✅

**文件**：`src/core/llm.ts` + `src/core/subsystems.ts`

- `initPool()` / `initUnifiedPool()` → `@deprecated` no-op，由 Subsystems 直接创建 ModelPool 并注入
- Subsystems 构造函数中创建 ModelPool 并注入 ModelRouter

### 3.2 迁移决策记录 ✅

**文件**：`src/core/llm.ts` + `src/core/model-router.ts`

- `recordDecision()` 已从 llm.ts 移除（死代码，executeWithFallback 已改用 router.recordOutcome()）
- `getDecisionRecorder()` 已移除（agent.ts 直接用 router.getDecisionRecorder()）
- `consumeLastUnifiedSelection()` → `@deprecated`，委托给 consumeLastSelection()
- LLMAdapter.executeWithFallback() 统一调用 router.recordOutcome()

### 3.3 保留执行面

- chat/streamChat/structuredOutput/chatWithNode
- 重试 + 熔断
- 消息预处理
- 热更新 updateProvider()

**验证**：`llm.test.ts` 通过 ✅

---

## Phase 4: 子系统调用层 — LLMCallService ✅

**目标**：统一子系统的 LLM 调用

### 4.1 新增 LLMCallService ✅

**新文件**：`src/core/llm-call-service.ts`（64行，含 call / callMessages / callForPlanning）

### 4.2 迁移子系统 ✅

通过 `setLLMCaller()` 注入 LLMCallService 调用器：

- STMPStore → `setLLMCaller` ✅
- DreamEngine → `setLLMCaller` ✅
- KnowledgeExtractor → `setLLMCaller` ✅
- KnowledgeInterviewer → `setLLMCaller` ✅
- DataAugmentor → `setLLMCaller` ✅
- DAGPlanner → 构造函数注入 `callForPlanning` ✅
- ProactiveEngine → `setLLMCaller` ✅（通过 BuddyClock 透传）
- BuddyClock → `setLLMCaller` ✅（透传到 ProactiveEngine）
- Shadow Brain → 构造函数注入 `llm.call` ✅
- ExpertPool → 已通过 ws-handler 函数注入（无需改）
- ReminderParser → 已使用函数注入模式（按需传入）

**验证**：各子系统测试通过 ✅

---

## Phase 5: Agent.ts 清理 ✅

**目标**：Agent.ts 只通过 ModelRouter + LLMCallService

### 5.1 统一选择入口 ✅

- agent.ts 已无 `callLLMPrompt` / `callLLMMessages` / `callLLMForPlanning`
- 使用 `router.getPool()` / `router.getDecisionRecorder()`
- 无直接访问 `sys.llm.getPoolScheduler()` / `sys.llm.getUnifiedPool()`

### 5.2 修复 provider 查找 ✅

```typescript
// 已修复
const providerConfig = this.config.models?.providers?.find(p => p.id === node.provider);
```

### 5.3 collectResourceState 简化 ✅

- 通过 ModelRouter 获取可用模型数

**验证**：`agent.test.ts` 通过 ✅

---

## Phase 6: 配置清理 ✅

### 6.1 types.ts ✅

- `BuddyConfig.llm` → `@deprecated` ✅
- `BuddyConfig.pool` → `@deprecated` ✅
- `OrchestrationNode.type` → 已无 `'primary'`/`'lightweight'`（类型为 `'local_expert' | 'cloud_node' | 'experience'`）✅
- RuleEngine 硬编码节点 ID 已替换为 `'auto'` ✅

### 6.2 config.ts ✅

- `migrateToUnifiedConfig()` 保留（自动迁移旧配置）

**验证**：配置加载测试通过 ✅

---

## Phase 7: 前端适配

### 7.1 ws-handler API

- `/api/model-pool` → 从 ModelPool 读取
- `/api/model-pool/*` → 写入 ModelPool
- API 接口不变，内部实现调整

### 7.2 前端组件

- Settings.tsx 无改动（API 接口不变）

---

## Phase 8: 测试更新 ✅

- model-pool.test.ts — ✅ 通过
- model-pool-unified.test.ts — ✅ 通过
- model-router.test.ts — ✅ 通过
- llm.test.ts — ✅ 通过
- agent.test.ts — ✅ 通过
- brain.test.ts — ✅ 已存在（`src/brain/brain.test.ts`，121行）
- llm-call-service.test.ts — ✅ 通过
- proactive-engine.test.ts — ✅ 通过

**验证**：8 个核心测试文件全部通过（131 tests）✅

---

## 文件改动汇总

| 文件 | 改动类型 | Phase |
|------|---------|-------|
| `src/core/model-pool.ts` | 大改 | 1 |
| `src/core/model-pool-unified.ts` | 废弃 | 1 |
| `src/core/model-router.ts` | 大改 | 2 |
| `src/core/llm.ts` | 中改 | 3 |
| `src/core/subsystems.ts` | 中改 | 3, 4 |
| `src/core/agent.ts` | 中改 | 5 |
| `src/brain/left/scheduler.ts` | 中改 | 2 |
| `src/brain/left/rule-engine.ts` | 小改 | 6 |
| `src/brain/types.ts` | 小改 | 6 |
| `src/types.ts` | 小改 | 6 |
| `src/core/ws-handler.ts` | 小改 | 7 |
| `src/core/model-pool-scheduler.ts` | 废弃 | 2 |
| `src/core/llm-call-service.ts` | 新增 | 4 |
| 11 个子系统文件 | 小改 | 4 |
| 测试文件 | 中改 | 8 |

总计：约 20 个文件，核心改动 6 个，小改动 14 个。

---

## 执行顺序

```
Phase 0 (准备) → Phase 1 (数据面) → Phase 2 (控制面) → Phase 3 (执行面)
→ Phase 4 (子系统) → Phase 5 (Agent) → Phase 6 (配置) → Phase 7 (前端) → Phase 8 (测试)
```

每个 Phase 完成后运行全量测试，确保不回退。
