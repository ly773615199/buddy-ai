# E2E 测试报告

**日期**: 2026-05-11 19:00 GMT+8（第二轮重测）  
**环境**: Linux x64, Node v22.22.1, Playwright v1.59.1, Chromium (system)  
**模式**: Mock LLM (`BUDDY_MOCK_LLM=1`)  
**分支**: master (commit `c601e99`)

---

## 总览

| 指标 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 318 | 84.4% |
| ❌ 失败 | 46 | 12.2% |
| ⏭ 跳过 | 13 | 3.4% (需 `SILICONFLOW_API_KEY`) |
| **总计** | **377** | 100% |

**总耗时**: ~10.4min（单 worker）

> ⚠️ 与首轮 (16:19) 对比：通过 343→318，失败 22→46。新增 24 个失败用例，主要集中在消息渲染、诊断卡片、确认/澄清、工具执行等模块。

---

## 失败用例详情 (46 个)

### 🔴 消息渲染 — chat-flow (8 个)

| # | 用例 | 根因 |
|---|------|------|
| 1 | `chat-flow.spec.ts:115` — llm_response 助手消息渲染 | 消息类型组件未渲染 |
| 2 | `chat-flow.spec.ts:135` — thinking 思考中消息渲染 | thinking 类型未渲染 |
| 3 | `chat-flow.spec.ts:141` — tool_call + tool_result 工具调用 | 工具调用消息未渲染 |
| 4 | `chat-flow.spec.ts:158` — error 错误消息渲染 | 错误消息未渲染 |
| 5 | `chat-flow.spec.ts:167` — bubble 引导气泡渲染 | 气泡类型未渲染 |
| 6 | `chat-flow.spec.ts:176` — evolution 进化消息渲染 | 进化消息未渲染 |
| 7 | `chat-flow.spec.ts:181` — achievement 成就消息渲染 | 成就消息未渲染 |
| 8 | `chat-flow.spec.ts:187` — 多条消息顺序渲染 | 多消息混合渲染失败 |

> 疑似消息渲染组件整体未加载或 WS mock 事件未正确注入。

### 🔴 诊断卡片 — diagnostic-card (14 个)

| # | 用例 | 根因 |
|---|------|------|
| 9 | `diagnostic-card.spec.ts:62` — 诊断消息渲染 emoji + message | 组件未渲染 |
| 10 | `diagnostic-card.spec.ts:70` — mood 标签渲染 | mood 标签缺失 |
| 11 | `diagnostic-card.spec.ts:77` — 建议操作按钮渲染 | 按钮未渲染 |
| 12 | `diagnostic-card.spec.ts:107` — 技术详情默认收起 | 组件整体缺失 |
| 13 | `diagnostic-card.spec.ts:116` — 点击展开技术详情 | 展开交互失败 |
| 14 | `diagnostic-card.spec.ts:133` — 再次点击收起技术详情 | 收起交互失败 |
| 15 | `diagnostic-card.spec.ts:157` — mood=frustrated 😤 | mood 类型渲染失败 |
| 16 | `diagnostic-card.spec.ts:163` — mood=confused 😕 | mood 类型渲染失败 |
| 17 | `diagnostic-card.spec.ts:172` — mood=tired 😫 | mood 类型渲染失败 |
| 18 | `diagnostic-card.spec.ts:191` — 无建议操作时正常渲染 | 边界场景失败 |
| 19 | `diagnostic-card.spec.ts:202` — 无 detail 时技术细节区域 | 边界场景失败 |
| 20 | `diagnostic-card.spec.ts:213` — 单个建议操作 | 边界场景失败 |
| 21 | `diagnostic-card.spec.ts:225` — 多个诊断消息顺序渲染 | 多消息渲染失败 |

> DiagnosticCard 组件整体未渲染，疑似组件未注册或 WS 事件未触发。

### 🔴 确认/澄清 — confirm-clarify (4 个)

| # | 用例 | 根因 |
|---|------|------|
| 22 | `confirm-clarify.spec.ts:23` — 高风险工具触发确认对话框 | 确认对话框未渲染 |
| 23 | `confirm-clarify.spec.ts:48` — 多个确认请求排队 | 排队机制失败 |
| 24 | `confirm-clarify.spec.ts:72` — clarify 事件渲染澄清问题 | 澄清 UI 未渲染 |
| 25 | `confirm-clarify.spec.ts:85` — 澄清后继续处理 | 处理流程中断 |

### 🔴 工具执行 — tool-execution (4 个)

| # | 用例 | 根因 |
|---|------|------|
| 26 | `tool-execution.spec.ts:119` — 多专家并行调用事件流 | 并行事件未渲染 |
| 27 | `tool-execution.spec.ts:219` — 三进制训练完成事件 | 三进制事件未渲染 |
| 28 | `tool-execution.spec.ts:245` — DAG 编排完整事件流 | DAG 编排未渲染 |
| 29 | `tool-execution.spec.ts:302` — DAG 任务失败 → 重试 | 重试机制失败 |

### 🔴 功能缺失 / UI 未实现 (6 个)

| # | 用例 | 根因 |
|---|------|------|
| 30 | `app.spec.ts:143` — 设置面板 — 模型池 Tab | `getByText('统一模型池未初始化')` 未找到 |
| 31 | `app.spec.ts:184` — 设置面板 — 数据管理 | `getByText('导出数据')` 未找到 |
| 32 | `persistence.spec.ts:388` — 数据管理 — 导出按钮 | 同上，导出功能 UI 未实现 |
| 33 | `i18n.spec.ts:179` — 英文设置面板 | `getByText('Appearance')` 未找到 |
| 34 | `i18n.spec.ts:362` — 术语一致性 | 多语言翻译 key 不一致 |
| 35 | `sensor-panel.spec.ts:72` — 位置数据渲染 | `getByText(/纬度/)` 未找到 |

### 🟡 记忆/认知 — memory-intelligence (3 个)

| # | 用例 | 根因 |
|---|------|------|
| 36 | `memory-intelligence.spec.ts:181` — 梦境完成事件 | WS 事件注入后 UI 未更新 |
| 37 | `memory-intelligence.spec.ts:198` — 领域成熟度通知 | domain_mature 事件未渲染 |
| 38 | `memory-intelligence.spec.ts:219` — 技能注册事件 | skill_registered 事件未渲染 |

### 🟡 边界/持久化 (3 个)

| # | 用例 | 根因 |
|---|------|------|
| 39 | `error-boundary.spec.ts:150` — localStorage 恢复 | 刷新后未恢复 Activity Tab |
| 40 | `error-boundary.spec.ts:179` — Onboarding 跳过刷新 | visual_seed 未写入 localStorage |
| 41 | `persistence.spec.ts:315` — 对话消息刷新后保留 | 对话历史未持久化 |

### 🟢 视觉回归截图差异 (4 个)

| # | 用例 | 说明 |
|---|------|------|
| 42 | `visual-regression.spec.ts:65` — 消息类型 | 截图基线过期 |
| 43 | `visual-regression.spec.ts:199` — 记忆面板 | 截图基线过期 |
| 44 | `visual-regression.spec.ts:318` — 探索面板 | 截图基线过期 |
| 45 | `visual-regression.spec.ts:645` — 外观配置页 | 截图基线过期 |

> 需 `npx playwright test --update-snapshots` 更新基线。

### ⚪ 订阅配额 (1 个)

| # | 用例 | 根因 |
|---|------|------|
| 46 | `ws-lifecycle.spec.ts:80` — 消息配额用完后显示升级提示 | 升级提示 UI 未渲染 |

---

## 跳过用例 (13 个)

均为 `model-selection-real.spec.ts` 中的测试，需真实 LLM API (`SILICONFLOW_API_KEY`)：

- POST /api/model-pool/providers — 模型池初始化
- GET /api/model-pool — 模型池数据
- 三脑决策 → model_decision 全链路
- 前端渲染 — model_decision UI
- 不同任务类型 → 模型选择策略
- 完整闭环 — 配置 → 决策 → 渲染

---

## 失败分类汇总

| 类别 | 数量 | 影响 |
|------|------|------|
| 消息渲染 (chat-flow) | 8 | 消息类型组件整体未渲染 |
| 诊断卡片 (diagnostic-card) | 14 | DiagnosticCard 组件整体未渲染 |
| 确认/澄清 (confirm-clarify) | 4 | 确认对话框/澄清 UI 未渲染 |
| 工具执行 (tool-execution) | 4 | 多专家/DAG/三进制事件流未渲染 |
| 功能缺失 (导出/模型池/i18n/传感器) | 6 | UI 未实现，同首轮 |
| 记忆/认知事件 (memory-intelligence) | 3 | WS 事件注入后 UI 未响应 |
| 边界/持久化 (error-boundary/persistence) | 3 | localStorage 写入时序问题 |
| 视觉回归基线过期 | 4 | 截图差异，需更新基线 |
| 订阅配额 (ws-lifecycle) | 1 | 升级提示 UI 未渲染 |

---

## 建议修复优先级

1. **消息渲染 + 诊断卡片 + 确认/澄清 + 工具执行** (30 个): 组件级问题，需排查组件注册、WS 事件分发、mock 数据结构
2. **功能补全** (6 个): 导出数据、模型池配置引导、i18n 翻译 key、传感器经纬度
3. **记忆/认知事件** (3 个): WS 事件 → UI 映射链路
4. **边界/持久化** (3 个): localStorage 读写时序
5. **视觉回归基线** (4 个): `--update-snapshots` 一键更新
