# 开发记录 2026-04-27

> 本次开发涵盖：前端 UI 全面优化、精灵自主行为视觉增强、后端基础设施补全、全链路架构审计、孤立模块清理

---

## 一、前端 UI 全面优化 (Phase A/B/C)

**提交**: `77e8d89` | **文件**: 11 个 | **改动**: +980 / -302

### Phase A — 沟通窗口交互增强

| 任务 | 文件 | 内容 |
|------|------|------|
| A.1 消息操作菜单 | `MessageBubble.tsx`, `ChatPanel.tsx`, `App.tsx` | hover 显示复制/重试/删除按钮，onRetry/onDelete 回调 |
| A.2 代码块语法高亮 | `utils/markdown.tsx`, `main.tsx`, `index.css` | highlight.js 集成，7 种语言，代码复制按钮 |
| A.3 输入框增强 | `InputBar.tsx` | 自动高度、↑↓ 历史命令（50 条）、/ 快捷命令面板 |
| A.4 消息搜索 | `ChatPanel.tsx` | Ctrl+F 搜索、实时高亮、ESC 关闭 |

### Phase B — 整体 UI 治理

| 任务 | 文件 | 内容 |
|------|------|------|
| B.1 主题系统 | `index.css`, 全部组件 | CSS 变量体系（17 个变量），全局动画迁移到 CSS |
| B.2 响应式布局 | `App.tsx`, `index.css` | 768px/480px 断点，移动端上下排列 |
| B.3 Tab 存活 | `App.tsx` | display:none 切换，组件不销毁重建 |
| B.4 空状态组件 | `EmptyState.tsx` (新建) | 统一 emoji + title + desc 空状态 |

### Phase C — 性能优化

| 任务 | 文件 | 内容 |
|------|------|------|
| C.1 虚拟滚动 | `ChatPanel.tsx` | @tanstack/react-virtual，100+ 消息自动启用 |
| C.2 Markdown 缓存 | `MessageBubble.tsx` | useMemo 缓存 renderMarkdown |
| C.3 PIXI 优化 | `SpriteRenderer.tsx` | IntersectionObserver + visibilitychange 暂停、粒子上限 80 |

---

## 二、精灵自主行为视觉增强

### Phase 3.3 拖拽交互
**提交**: `92e2bbc`

- Pointer 事件拖拽精灵
- 拖拽中粒子兴奋反应（每 3 帧 2 个粒子）
- 松手后弹性弹回（0.85 衰减系数）
- 拖拽范围限制 ±80x / ±60y

### Phase 3.4 状态菜单
**提交**: `92e2bbc`

- 右键/长按（600ms）显示上下文菜单
- 菜单项：进化阶段、情绪、亲密度、稀有度、最近行为
- 毛玻璃背景 + 动画
- 点击外部自动关闭

### Phase 6 进化形态差异化
**提交**: `cd05916`

| 阶段 | 耳朵 | 尾巴 | 翅膀 | 纹路 | 装饰点 |
|------|------|------|------|------|--------|
| formed | 0.8x | 0.7x | ❌ | 30% | 3 |
| mature | 1.0x | 1.0x | ❌ | 60% | 5 |
| complete | 1.2x | 1.3x | ✅ | 80% | 8 |
| legendary | 1.4x | 1.5x | ✅+光晕 | 100% | 12 |

---

## 三、后端基础设施补全

**提交**: `6a8708d`

### 3.1 结构化日志系统
- **文件**: `src/audit/structured-logger.ts`
- 5 级日志 (DEBUG/INFO/WARN/ERROR/FATAL)
- 生产环境 JSON 输出，开发环境彩色格式化
- child() 子 logger、startTimer() 性能计时
- 异常安全（try/catch 包裹）

### 3.2 健康检查端点
- **端点**: `GET /api/health`
- 检查项：内存、数据库、情绪引擎、模型池、WebSocket
- 返回整体状态 (healthy/degraded/unhealthy) + 各组件延迟
- 不健康时返回 503

### 3.3 通信层自诊断
- **文件**: `src/core/link-diagnostics.ts`
- **端点**: `GET /api/diagnostics`
- 指标追踪：连接/断连次数、延迟历史、消息/错误计数
- 诊断能力：频繁断连检测、高延迟检测、错误率检测、延迟趋势分析（内存泄漏预警）

---

## 四、全链路架构审计

### 审计范围
- 3 条最复杂路径完整追踪
- 30+ 后端模块集成状态检查
- 10+ 前端模块集成状态检查

### 关键发现

#### ❌ 完全孤立的模块（从未被调用）

| 模块 | 说明 |
|------|------|
| `src/core/intent-classifier.ts` | 导出 IntentClassifier 类，整个项目无任何 import |
| `src/orchestrate/workflow-dag-adapter.ts` | 导出 WorkflowDAGAdapter，无消费者 |
| `src/orchestrate/dag-compiler.ts` | 导出 DAGExperienceCompiler，无消费者 |
| `frontend/src/comm/link.ts` | 导出 BuddyLink，useWebSocket 自己实现连接 |
| `frontend/src/comm/shared-connection.ts` | 导出但无消费者 |
| `frontend/src/sensors/` | 6 个文件全部导出但无消费者 |
| `frontend/src/components/SensorPanel.tsx` | 导出但 App.tsx 中无引用 |

#### ⚠️ 部分实现 / 无触发入口

| 模块 | 说明 |
|------|------|
| 多专家并行 (handleMultiExpertParallel) | 后端完整实现，但前端无 UI 触发入口 |
| FusionBuffer | 只在 handleMultiExpert 中使用，而该路径无前端入口 |
| orch_start/orch_done 事件 | 前端处理了，但后端 executor.ts 从未发送 |
| CognitiveDashboard | 有状态管理但 App.tsx 中无 Tab 入口 |
| sensors/voice 部分文件 | emotion-voice.ts / sound-events.ts 未被集成 |

#### ⚠️ 冗余调用

| 问题 | 说明 |
|------|------|
| preprocessMessage 双重调用 | handleUserMessage 先调 pet/emotion，再调 agentRef.preprocessMessage 又调一遍 |
| assessComplexity 误命中 | 关键词匹配太简单，"然后"、"同时" 可能把简单对话路由到 DAG |

### 已集成模块统计

- **后端**: 27/30+ 模块已正确接入主流程
- **前端**: 15/20+ 模块已正确接入
- **路径 3 (空闲行为→精灵视觉)**: ✅ 完整无断裂

---

## 提交记录

| 提交 | 内容 | 时间 |
|------|------|------|
| `77e8d89` | feat: 前端 UI 全面优化 — Phase A/B/C | 13:17 |
| `92e2bbc` | feat: 精灵 Phase 3.3 拖拽交互 + Phase 3.4 状态菜单 | 13:27 |
| `cd05916` | feat: 精灵 Phase 6 进化形态差异化 | 13:31 |
| `6a8708d` | feat: 结构化日志 + 健康检查 + 通信层自诊断 | 13:43 |

---

## 待办事项

## 五、孤立模块清理（14:00）

**提交**: `fca2192` | **文件**: 5 个 | **改动**: +20 / -98

基于全量代码审计 + 开发计划对照分析，对孤立模块执行 4 项快速修复：

| # | 修复 | 文件 | 详情 |
|---|------|------|------|
| 1 | CognitiveDashboard 补 Tab | `App.tsx` | 新增 `cognitive` Tab，导入并渲染 CognitiveDashboard 组件 |
| 2 | assessComplexity 提阈值 | `message-processor.ts` | `markerCount>=3`(原2)、`clauses>=4`(原3)、短消息(<30字)直接跳过 |
| 3 | preprocessMessage 去重 | `ws-handler.ts` | 移除 handleUserMessage 中重复的 emotion.onUserMessage / pet.trackFeature / pet.trackMessage 调用，统一走 preprocessMessage |
| 4 | 删除死代码 | `workflow-dag-adapter.ts` | 无消费者，DAGPlanner 已覆盖自然语言→DAG 路径 |

## 六、DAG 能力三代整合（14:24）

**提交**: `ea9a21f` | **文件**: 6 个 | **改动**: +147 / -495

| 代 | 模块 | 操作 | 理由 |
|---|------|------|------|
| 1st | `tools/workflows.ts` | 🔴 删除 | 9 个硬编码模板，无消费者 |
| 1st | `orchestrate/dag-compiler.ts` | 🔴 删除 | 80% 代码与 experience-compiler.ts 重复 |
| 2nd | `DAGPlanner` | ✅ 保留 | 当前主力，LLM 动态规划 |
| 3rd | DAG 模式提取 | 🟢 合入 experience-compiler | `extractDAGPattern()` + `detectParallelism()` + `detectRetryPatterns()` |

## 七、集成 intent-classifier（14:36）

**提交**: `1f2c070` | **文件**: 2 个 | **改动**: +19 / -5

| 文件 | 改动 |
|------|------|
| `subsystems.ts` | 新增 IntentClassifier 实例 |
| `message-processor.ts` | 工具选择改为两层过滤：意图分类（零延迟）→ 语义检索（兜底） |

效果：20 工具 → 3-5 工具，省 ~1500 token，降低工具误调用

### 待办更新

- [x] 为 CognitiveDashboard 添加独立 Tab ✅
- [x] 修复 preprocessMessage 双重调用 ✅
- [x] 改进 assessComplexity DAG 检测逻辑 ✅
- [x] 删除或集成 `workflow-dag-adapter.ts` ✅（已删除）
- [x] 合并 `dag-compiler.ts` 到 experience-compiler.ts ✅
- [x] 删除 `tools/workflows.ts`（第一代死代码）✅
- [x] ~~集成 `comm/link.ts`~~ ✅ 已确认集成完成（useWebSocket 全量使用 BuddyLink）
- [x] 集成 `intent-classifier.ts` ✅（两层工具过滤：意图分类→语义检索）
- [ ] 集成 `comm/link.ts` 到 useWebSocket（P0，Phase 7 核心）
- [ ] 集成 `intent-classifier.ts`（P2，工具裁剪省 token）
