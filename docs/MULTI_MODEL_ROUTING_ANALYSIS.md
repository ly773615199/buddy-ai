# 多模型路由信息架构分析

> 日期: 2026-05-10
> 状态: 分析完成，待实施
> 关联 Issue: 硅基流动 400 "Model does not exist" + 重放消息去重

## 问题概述

### 症状
1. 硅基流动 API 返回 400: "Model does not exist" — 模型池选到了非聊天模型（embedding/reranker）
2. WebSocket 重连后消息重复 — 重放缓冲区 + 前端去重逻辑有缺陷

### 根因
**信息阻塞** — 决策系统在盲飞。模型发现层拿到了完整信息（category、pipelineTag、parameters），但信息在传递到选择层时被截断，导致三脑决策无法区分"能做聊天的模型"和"不能做聊天的模型"。

---

## 信息流断点分析

### 当前架构

```
信息来源层 (3 个数据源)
├── 静态知识表 (model-knowledge.ts)     — ~35 个聊天模型，能力打分
├── HuggingFace Enrichment              — category, pipelineTag, parameters
└── 平台 API + LiteLLM                  — 模型列表, 定价, 上下文长度
          │
          ▼
ModelDiscovery → rawToProfile() → ModelProfile
          │
          ▼
┌─────────────────────────────────────┐
│  断点 ①: ModelProfile 存储           │
│  category ✓ pipelineTag ✓           │
│  但没有派生出 "能做什么" 的能力标记    │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  断点 ②: layer0StaticFilter         │
│  只看 active/streaming/cost          │
│  不看 category → embedding 模型通过   │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  断点 ③: Thompson Sampling          │
│  从 "所有通过过滤的模型" 里选          │
│  可能选到 bge-reranker               │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  断点 ④: 三脑决策 (ModelRouter)      │
│  buildModelRequirement('chat')       │
│  → { minCapabilities: {} }  空的!    │
│  不知道 pool 里有什么                  │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  断点 ⑤: 反馈层                      │
│  recordOutcome(success: boolean)     │
│  没有质量评分，没有按 taskType 细分    │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  断点 ⑥: 运行时反馈                  │
│  stats.byTaskType 有数据             │
│  但没有流回三脑决策                    │
└─────────────────────────────────────┘
```

### 重放消息断点

```
前端断连 → 重连 → 发送 resume(lastSeq)
                 ↓
后端 getReplayMessages(lastSeq) → 返回缓冲区消息
                 ↓
前端收到重放消息 → 无 id → 重复追加到消息列表
```

---

## 研究支撑

### 相关论文

| 论文 | 年份 | 核心洞察 | 与 Buddy 的关联 |
|---|---|---|---|
| **CARGO** (arXiv:2509.14899) | 2025 | Category-Aware Routing — 不同任务类别用不同预测器，76.4% top-1 准确率 | Buddy 需要按 category 过滤模型 |
| **R2-Router** (arXiv:2602.02823) | 2026 | Routing as Reasoning — 路由器从被动选择器进化为主动推理器 | 三脑应该主动查询 pool 能力 |
| **OmniRouter** (arXiv:2502.20576) | 2025 | 全局优化 — 局部贪心导致全局次优，用 Lagrangian 对偶分解 | Buddy 需要考虑全局资源分配 |
| **Routing, Cascades, User Choice** (ICLR 2026) | 2026 | 提供者和用户的最优路由可能不一致 | 三脑需同时考虑成本和质量 |
| **MAGRPO** (arXiv:2508.04652) | 2025 | 多 LLM 协作 = 多智能体强化学习，共享奖励信号 | ExpertPool 需要跨模型反馈 |
| **RouteLLM** (arXiv:2406.18665) | 2024 | 用偏好数据训练路由分类器，成本-质量权衡 | 路由器应该从历史数据学习 |
| **FrugalGPT** | 2023 | 级联方案 — 便宜模型先试，置信度不够再升级 | Cascade Routing 的理论基础 |

### 关键结论

1. **模型能力不是固定分数，是任务亲和度矩阵** — 同模型做 chat 可能 0.9，做 embedding 是 0
2. **路由必须感知任务类别** — 不能对所有任务用同一套选择逻辑
3. **全局优化优于局部贪心** — 每个查询独立选最优会导致资源错配
4. **反馈闭环是关键** — 执行结果必须回流到决策层
5. **多模型协作需要共享信号** — 模型之间需要知道彼此的能力和表现

---

## 修复计划

### 阶段 1：打通信息流（解决 400 报错）

**目标**: 让选择层知道"这个模型能不能做这件事"

| 文件 | 改动 | 说明 |
|---|---|---|
| `model-pool.ts` ModelProfile | 新增 `derived` 字段 | 从 category/pipelineTag/静态知识派生能力硬约束 |
| `model-pool.ts` layer0 | 加 `taskType` 参数 | 按任务类型过滤不兼容的模型 |
| `llm.ts` cascade | 去掉 `taskType === 'tools'` 限制 | 所有任务类型都支持 cascade |

**派生能力判断逻辑**:

```typescript
derived: {
  chatCapable: boolean,   // pipelineTag ∈ CHAT_TAGS || category ∈ ['chat','vl-chat','omni-chat']
  toolCapable: boolean,   // toolCallingMode !== 'none' && chatCapable
  embedCapable: boolean,  // category === 'embedding' || pipelineTag ∈ EMBED_TAGS
  visionCapable: boolean, // category === 'vl-chat' || vision === true
}
```

**优先级**: pipelineTag > category > 静态知识 > 名称推断 > 默认 true（向后兼容）

**预期效果**: embedding/reranker 模型不再进入 chat 任务的候选池，400 报错消失。

### 阶段 2：丰富决策信息（让三脑"知己"）

**目标**: 三脑做决策时能查询"pool 里有什么、各自擅长什么"

| 文件 | 改动 | 说明 |
|---|---|---|
| `model-pool.ts` | 新增 `queryCapableModels(taskType)` | 返回指定任务类型的可用模型列表 + 能力摘要 |
| `model-pool.ts` | 新增 `getModelAffinity(modelId, taskType)` | 返回模型对特定任务的历史表现 |
| `model-router.ts` | `select()` 先 query 再 select | 不再盲选，而是知情选 |
| `model-router.ts` | `buildModelRequirement()` 注入 BodyState | load 高→选便宜快速的，energy 低→放宽约束 |

**信息流变化**:
```
之前: 三脑 → taskType → 盲选
之后: 三脑 → taskType → queryCapableModels() → 知道有 5 个能做 chat
      → 结合 BodyState(load=80, energy=30) → 选最便宜的那个
```

### 阶段 3：闭环反馈（让三脑"从经验中学习"）

**目标**: 执行结果反馈回决策，越用越准

| 文件 | 改动 | 说明 |
|---|---|---|
| `model-pool.ts` stats | 按 taskType 记录 EWMA 质量分数 | 不只是 success/fail，是"做 chat 的质量 0.82" |
| `llm.ts` recordOutcome | 新增 `qualityScore` 参数 | 支持多维反馈 |
| `model-router.ts` | Thompson Sampling 用 taskAffinity 加权 | 历史表现好的模型被选中概率更高 |
| 新增 `quality-scorer.ts` | 轻量质量评分（可选 Judge LLM） | 执行完自动评分 |

**信息流变化**:
```
之前: 执行 → success/fail → 无学习
之后: 执行 → success/fail + qualityScore + latency
      → 更新 taskAffinity[chat] = EWMA(0.82, newScore)
      → 下次选模型时参考
```

### 阶段 4：任务完成感知（结果信号精细化）

**目标**: 用真实结果（而非互评）驱动模型选择——知道"这次任务到底完成没有"

**核心思路**: 互评是用模型猜测代替真实结果，成本高且不可靠。真正该做的是捕获任务级别的完成信号。

| 信号 | 来源 | 成本 | 决策影响 |
|---|---|---|---|
| LLM 调用成功/失败 | `llm.ts` recordOutcome | 0 | ✅ 已有 |
| 规则质量评分 | `quality-scorer.ts` scoreByRules | 0 | ✅ 已有 |
| Cascade 触发 | `llm.ts` cascadeToStronger | 0 | ❌ 未更新原模型 affinity |
| 工具调用成功率 | `ws-handler.ts` toolCalls | 0 | ❌ 未回流到模型选择 |
| 任务完成度 | ExecutionSession stats | 0 | ❌ 未接入 |
| 响应被接受/丢弃 | 前端信号 | 0 | ❌ 未捕获 |

**关键区分**:
- **单次调用结果**（已有）: 模型 A 回复了 → 成功/失败 + 质量分
- **任务完成结果**（缺失）: 用户的任务做完了吗 → 所有参与模型的共同贡献度

**实现方案**:

```
用户发消息 → handleUserMessage 创建 ExecutionSession
  → LLM 调用（可能多次：cascade、工具调用、重试）
  → 工具执行
  → 最终回复
  → 任务完成？

任务完成信号（客观指标）：
  ✅ LLM 返回了响应（基本完成）
  ✅ 工具调用全部成功（无报错）
  ✅ 无 cascade 触发（模型能力匹配）
  ✅ 无重试（一次成功）
  ❌ cascade 触发 → 原模型 taskAffinity 降权
  ❌ 工具失败 → 该次调用质量分降低
  ❌ 任务超时 → 整体质量分降低

任务完成 → 更新所有参与模型的 taskAffinity
```

**与阶段 3 的区别**:
- 阶段 3: 单次调用 → 单次反馈 → 单模型 affinity
- 阶段 4: 一次任务 → 多次调用 → 所有参与模型按贡献度更新 affinity

| 文件 | 改动 | 说明 |
|---|---|---|
| `model-router.ts` | `recordTaskOutcome()` | 记录任务级完成度，更新所有参与模型 |
| `llm.ts` | cascade 成功后惩罚原模型 | cascade 触发 = 原模型 taskAffinity 降权 |
| `ws-handler.ts` | 任务结束时调用 `recordTaskOutcome` | 接入 ExecutionSession 统计 |
| `model-pool.ts` | `recordTaskFeedback()` | 按贡献度批量更新 affinity |

**不做的事**:
- ❌ 专家互评（用猜测代替结果，成本 N²）
- ❌ Judge LLM（已有规则评分，够用）
- ❌ 用户行为追踪（侵入性强，收益不确定）

---

## 重放消息修复

已在代码中实现的 5 个修复点：

1. **后端 `_replaySeq` 标记** — `link-handler.ts` `getReplayMessages()` 注入 `_replaySeq`
2. **前端重放去重 + lastSeq 追踪** — `useWebSocket.ts` 内容指纹去重 `recentContentRef`
3. **lastSeq=0 不发送 resume** — `useWebSocket.ts` `if (lastSeq > 0 && !hasResumedRef.current)`
4. **防止 effect 双重执行** — `connectGuardRef` 保护 StrictMode
5. **排除瞬态事件** — `ws/server.ts` `shouldReplay()` 白名单机制

---

## 文件清单

### 需要修改的文件（阶段 1）

- `src/core/model-pool.ts` — ModelProfile 接口 + layer0 过滤
- `src/core/model-discovery.ts` — rawToProfile() 填充 derived 字段
- `src/core/model-knowledge.ts` — 确保静态知识覆盖非聊天模型
- `src/core/llm.ts` — cascade 条件扩展

### 需要修改的文件（阶段 2）

- `src/core/model-pool.ts` — 新增 queryCapableModels / getModelAffinity
- `src/core/model-router.ts` — select() 重构 + buildModelRequirement 增强
- `src/core/ws-handler.ts` — BodyState 注入

### 需要新增的文件（阶段 3）

- `src/core/quality-scorer.ts` — 质量评分器
