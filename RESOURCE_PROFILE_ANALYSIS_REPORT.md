# Buddy 资源画像 & 三脑决策 运行轨迹分析报告

> 测试时间: 2026-06-15 18:43 GMT+8
> 测试环境: SiliconFlow API (sk-ujgvk...dyzn)
> 后端版本: 0.2.0 | 模型池: 88 模型, 73 激活

---

## 一、测试结论总览

| 维度 | 状态 | 评分 |
|------|------|------|
| 三脑决策系统 | ✅ 正常工作 | 8/10 |
| 资源画像驱动决策 | ✅ 按域/复杂度选模型 | 7/10 |
| 生命周期状态机 | ⚠️ 存在非法转换 bug | 4/10 |
| 能力画像准确性 | ⚠️ 冷启动数据不足 | 5/10 |
| 反馈闭环 | ❌ 执行失败未回写画像 | 3/10 |
| 决策可解释性 | ✅ 有 trace 追踪 | 8/10 |

---

## 二、三脑决策实际运行轨迹

### 2.1 决策路径

所有 7 次决策均走 `threeBrain` 路径，平均延迟 **17.49ms**：

```
[ThreeBrain] 法则 #1 (确定性执行): 规则命中: 经验路由命中: seed_get_time (80%)
[ThreeBrain] 决策完成: 49.46ms, mode=single, source=rule+router
[LeftBrain] 规则引擎节点补全: auto → siliconflow/Pro/deepseek-ai/DeepSeek-V3.1-Terminus (default)
```

### 2.2 资源画像驱动的模型选择

系统根据任务域自动选择不同模型（✅ 正确行为）：

| 任务 | 域 | 选中模型 | 决策延迟 |
|------|-----|----------|----------|
| 天气查询 | web | DeepSeek-V3.1-Terminus | 14.7ms |
| 代码生成 | file, system | Qwen2.5-7B-Instruct | 10.5ms |
| 知识问答 | knowledge, web | Qwen3.6-27B | 12.2ms |
| 代码分析 | code, file, system | GLM-4-32B | 8.6ms |
| 简单计算 | conversation | Qwen3-VL-32B-Thinking | 9.1ms |

**结论**: 三脑决策确实遵循资源画像，按域/复杂度选择了不同层级的模型。

### 2.3 小脑感知融合

```
[Cerebellum] 节律调节: heartbeat=260000ms, dream=1.17
[Cerebellum] regulate: 0.41ms, 1 动作
[UserState] rushed (50%) → brief
[DEBUG] 信任: 16 (acquaintance) | 情绪: happy | 可用工具: 17 个 | 进化: hatching
```

小脑正确感知了用户状态（rushed）和自身情绪（happy），并注入了决策上下文。

---

## 三、发现的不足与 Bug

### 🔴 Bug 1: 生命周期非法转换 `discovered → deprecated`（严重）

**现象**: 启动时刷出数百条警告：
```
[Lifecycle] 非法转换: discovered → deprecated (model/siliconflow/Wan-AI/Wan2.2-I2V-A14B)
[Lifecycle] 非法转换: discovered → deprecated (model/siliconflow/Qwen/Qwen3-32B)
... (重复 60+ 次)
```

**根因**: `ResourceHubAdapter.registerLegacy()` 在注册旧资源时，如果旧状态是 `unavailable`，会映射为 `deprecated` 并调用 `markState()`。但资源刚注册时处于 `discovered` 状态，`discovered → deprecated` 不在合法转换表中。

**合法转换**: `discovered → [active, rejected]`

**修复位置**: `src/brain/hub/resource-hub-adapter.ts:46-64`

```typescript
// 当前代码（有 bug）
const stateMap = { unavailable: 'deprecated', ... };
if (targetState && targetState !== 'discovered') {
  this.hub.markState(resource.id, targetState); // discovered → deprecated 非法！
}

// 修复方案：先转到 rejected，再由审计决定是否 deprecated
const stateMap = { unavailable: 'rejected', ... };
```

### 🔴 Bug 2: `active → active` 自转换警告

**现象**: 
```
[Lifecycle] 非法转换: active → active (model/siliconflow/BAAI/bge-m3)
```

**根因**: `unified-resource-bridge.ts` 的 `fullSync()` 在同步时直接设置 `resource.state = 'active'`，绕过了 `LifecycleManager.transition()`，导致后续 `markState('active')` 触发自转换检查。

**修复位置**: `src/brain/hub/unified-resource-bridge.ts:198-203`

```typescript
// 当前代码（绕过状态机）
resource.state = 'active';

// 修复方案：通过 lifecycle manager 转换
if (resource.state !== 'active') {
  this.lifecycle.transition(resource, 'active', '同步激活');
}
```

### 🟡 问题 3: 执行失败未回写资源画像

**现象**: 所有 7 次决策的 `success` 均为 `null` 或 `false`，但资源画像的健康度未更新。

**日志证据**:
```
[PlanExecutor] 统一池执行失败，退回默认: Forbidden
```

**影响**: 资源画像无法反映真实的执行成功率，三脑决策基于过时数据做决策。

**根因**: `PlanExecutor` 执行失败时，没有调用 `UnifiedResourceHub.recordOutcome()` 更新资源统计。

**修复建议**: 在 `PlanExecutor` 的失败路径中加入：
```typescript
sys.resourceSystem?.hub.recordOutcome(modelId, {
  success: false, latencyMs, taskType: signal.taskType, domain: signal.domains[0]
});
```

### 🟡 问题 4: 决策追踪的 success 字段延迟更新

**现象**: REST API 返回的 `decision-trace` 中 `success` 为 `null`，但实际已执行失败。

**根因**: 决策追踪在决策完成后立即写入，但执行结果是异步返回的。`recordDecisionOutcome()` 可能未被正确调用。

### 🟡 问题 5: 经验路由匹配不够精确

**现象**: "天气查询" 匹配到了 `seed_how_to`，"代码生成" 匹配到了 `seed_pip_install`。

**影响**: 右脑的直觉预测虽然工作了，但 seed 经验的粒度太粗，导致匹配不够精确。

**建议**: 增加 seed 经验的数量和粒度，或改进原型记忆的匹配算法。

### 🟡 问题 6: 能力画像缺乏实时探测

**现象**: 模型的能力画像（toolCalling、vision 等）在启动时由 `ModelEnricher` 从静态 catalog 填充，但运行时未根据实际执行结果更新。

**影响**: 如果模型实际不支持 toolCalling，但 catalog 标记为支持，三脑决策会做出错误选择。

**建议**: 在执行失败时，根据错误类型更新能力画像。例如：
- 400 Bad Request + tools → 标记 `toolCalling: false`（verified）
- 401 Forbidden → 标记 `reachable: false`

### 🟢 问题 7: 余额不足导致的级联失败

**现象**: 
```
[MemoryStore] embedMemory failed: HTTP 403: account balance is insufficient
[ModelPool] 模型 siliconflow/Qwen/Qwen3-Embedding-8B 标记 denied: auth
```

**影响**: Embedding 模型全部失败 → 记忆搜索不可用 → 知识管线退化 → 决策质量下降。

**建议**: 增加余额检测机制，在余额不足时提前降级到免费模型或本地模型。

---

## 四、资源画像准确性评估

### 4.1 冷启动阶段

- 模型发现: ✅ 从 SiliconFlow API 自动发现 88 个模型
- 能力填充: ⚠️ 依赖静态 catalog，86/88 命中，但未验证
- 初始状态: ✅ 全部进入 `discovered` 状态
- 首次探测: ⚠️ 探测调度器启动，但大量模型直接跳到 `deprecated`（bug）

### 4.2 运行阶段

- 决策选模: ✅ 按域/复杂度选择了不同模型
- 执行反馈: ❌ 失败未回写画像
- 健康度更新: ❌ 未根据执行结果更新
- 能力漂移检测: ⚠️ DriftDetector 存在但未收到数据

### 4.3 画像驱动决策的证据

```
[ModelRouter] 知情决策: taskType=chat, 可用模型=47, 最可靠=Qwen2.5-7B(100%), 最便宜=Qwen2.5-14B
[ModelRouter] 知情决策: taskType=embedding, 可用模型=5, 最可靠=bge-large-zh-v1.5(100%), 最便宜=bge-large-zh-v1.5
[ModelRouter] 知情决策: taskType=tools, 可用模型=47, 最可靠=Qwen2.5-7B(100%), 最便宜=Qwen2.5-14B
```

✅ ModelRouter 确实在按 taskType + 可靠性 + 成本做知情决策。

---

## 五、优化建议优先级

| 优先级 | 问题 | 影响 | 修复复杂度 |
|--------|------|------|-----------|
| P0 | discovered→deprecated 非法转换 | 日志噪音 + 状态不一致 | 低（改 stateMap） |
| P0 | active→active 自转换 | 状态机绕过 | 低（加状态检查） |
| P1 | 执行失败未回写画像 | 画像不准确 | 中（改 PlanExecutor） |
| P1 | 能力画像缺乏实时验证 | 决策可能错误 | 中（加执行反馈） |
| P2 | 经验路由匹配精度 | 决策质量 | 高（增加 seed + 改算法） |
| P2 | 余额检测机制 | 级联失败 | 中（加余额检测） |
| P3 | 决策追踪 success 延迟 | 调试体验 | 低（改写入时机） |

---

## 六、总结

**三脑决策系统核心逻辑正常**: 7次决策全部走 threeBrain 路径，平均 17.49ms，按域/复杂度选择了不同模型，小脑正确感知了用户状态。

**资源画像系统存在两个层面的问题**:
1. **状态机层面**: 生命周期转换有 bug（discovered→deprecated、active→active）
2. **数据层面**: 执行失败未回写画像，导致画像不能反映真实运行状况

**核心架构设计良好**: UnifiedResourceHub + CapabilityGraph + LifecycleManager + DriftDetector + MarginalAuditor 的分层设计是合理的，但数据流通路有断点。

**下一步**: 修复 P0/P1 bug → 补全执行反馈闭环 → 验证画像准确性 → 优化经验路由。
