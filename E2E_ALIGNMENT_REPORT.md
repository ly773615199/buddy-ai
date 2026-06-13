# E2E 测试用例 vs 前端实现对齐报告

**生成时间**: 2026-05-10  
**Spec 文件数**: 34  
**总测试用例数**: ~793  

---

## 🔴 关键问题（E2E 测试会 FAIL）

### 1. `knowledge-panel.spec.ts` — 缺少 loading 状态

**测试**: `test('初始加载显示 loading 提示')`  
**期望**: `page.getByText(/加载知识图谱/)`  
**实际**: `KnowledgePanel.tsx` **没有任何 loading 状态文案**。组件直接渲染数据或空状态。  
**修复**: 在 KnowledgePanel 中添加 loading 态，或删除此测试用例。

### 2. `experts-vision-trace.spec.ts` — "专家商城" 标题不存在

**测试**: `test('专家面板 — 页面结构完整')`  
**期望**: `page.getByText('专家商城')`  
**实际**: `Experts.tsx` 代码注释中有 "专家商城前端组件"，但**没有作为可见文本渲染**。  
**修复**: 在 Experts 组件顶部添加 `<h2>专家商城</h2>` 标题。

### 3. `sensor-panel.spec.ts` — 面板标题和按钮文案不匹配

**测试**: 多个测试用例  
**期望**:  
- `page.getByText(/传感器面板/)` — 不存在
- `page.getByText('位置')` / `page.getByText('运动')` / `page.getByText('环境')` — 实际是 "📍 位置" / "🏃 运动" / "🌡️ 环境"（带 emoji 前缀）
- `page.getByText('点击上方按钮开启传感器')` — 不存在

**实际**: `SensorPanel.tsx` 按钮文本为 `{statusDot(...)} 📍 位置`、`{statusDot(...)} 🏃 运动`、`{statusDot(...)} 🌡️ 环境`。无面板标题，无开启提示文案。  
**修复**: 更新 E2E 测试的选择器以匹配实际文案，或在 SensorPanel 中添加缺失的文案。

---

## 🟡 潜在问题（可能在特定条件下 FAIL）

### 4. `app.spec.ts` — "统一模型池未初始化" 条件严格

**测试**: `test('设置面板 — 模型池 Tab')`  
**期望**: `page.getByText('统一模型池未初始化')`  
**实际**: `Settings.tsx` 中此文案只在 `!providersFetching && !pool?.initialized && providers.length === 0` 时显示。如果 mock 环境有 providers 数据，此测试会 FAIL。  
**建议**: 确保 mock WS 环境不注入 providers 数据，或改用更宽松的断言。

### 5. `memory-intelligence.spec.ts` — "专家" i18n 依赖

**测试**: `test('记忆面板 — 多领域深度数据')`  
**期望**: `page.getByText('专家').first()`  
**实际**: growthStage `expert` 的标签是否翻译为 "专家" 取决于 i18n 系统。如果 i18n 未生效，实际显示的是 `expert`。  
**建议**: 确认 i18n 系统在测试环境中正常工作。

### 6. `knowledge-panel.spec.ts` — "学习文件" 文案带 count

**测试**: `test('切换到知识列表视图')`  
**期望**: `page.getByText(/已学习文件/)`  
**实际**: `KnowledgePanel.tsx` 使用 `"📁 已学习文件 ({{count}})"` 模板。正则 `/已学习文件/` 应能匹配。✅

---

## 🟢 对齐良好的测试

| Spec 文件 | 状态 | 说明 |
|-----------|------|------|
| `app.spec.ts` | ✅ | Tab 图标/标签匹配 |
| `i18n.spec.ts` | ✅ | i18n 系统对齐 |
| `onboarding.spec.ts` | ✅ | Onboarding 流程匹配 |
| `persistence.spec.ts` | ✅ | localStorage 持久化匹配 |
| `buddy-canvas.spec.ts` | ✅ | Canvas 渲染匹配 |
| `chat-flow.spec.ts` | ✅ | 消息渲染匹配 |
| `tool-execution.spec.ts` | ✅ | 工具面板数据匹配 |
| `tool-memory.spec.ts` | ✅ | 工具/记忆面板匹配 |
| `memory-intelligence.spec.ts` | ✅ | 记忆系统匹配 |
| `three-brain.spec.ts` | ✅ | 三脑决策匹配 |
| `voice-audio.spec.ts` | ✅ | 音频系统匹配 |
| `ws-lifecycle.spec.ts` | ✅ | WS 生命周期匹配 |
| `ws-reconnection.spec.ts` | ✅ | WS 重连匹配 |
| `visual-regression.spec.ts` | ✅ | 截图对比匹配 |
| `smooth-interaction.spec.ts` | ✅ | 性能测试匹配 |
| `activity-panel.spec.ts` | ✅ | 活动面板子标签匹配 |
| `agent-trace.spec.ts` | ✅ | 追踪面板匹配 |
| `brain-decision.spec.ts` | ✅ | REST API 决策匹配 |
| `cognitive-dashboard.spec.ts` | ✅ | 认知仪表盘匹配 |
| `confirm-clarify.spec.ts` | ✅ | 确认流程匹配 |
| `diagnostic-card.spec.ts` | ✅ | 诊断卡片匹配 |
| `emotion-voice-vision.spec.ts` | ✅ | 情绪/视觉匹配 |
| `error-boundary.spec.ts` | ✅ | 错误边界匹配 |
| `frontend-components.spec.ts` | ✅ | 组件覆盖匹配 |
| `pet-interaction.spec.ts` | ✅ | 宠物交互匹配 |
| `vision-panel.spec.ts` | ✅ | 视觉面板匹配 |
| `electron-hardware.spec.ts` | ⚠️ | Electron mock 测试 |
| `electron-integration.spec.ts` | ⚠️ | Electron 集成测试 |
| `ternary-local.spec.ts` | ⚠️ | 三进制本地推理（需后端模块） |
| `real-llm.spec.ts` | ⏭️ | 需要 SILICONFLOW_API_KEY |
| `model-selection-real.spec.ts` | ⏭️ | 需要 SILICONFLOW_API_KEY |

---

## 修复建议优先级

1. **P0** — `knowledge-panel.spec.ts` loading 测试 → 添加 loading 态或删除测试
2. **P0** — `experts-vision-trace.spec.ts` 专家商城标题 → 添加标题文案
3. **P0** — `sensor-panel.spec.ts` 文案不匹配 → 更新选择器或组件文案
4. **P1** — `app.spec.ts` 模型池初始化条件 → 确保 mock 环境一致
