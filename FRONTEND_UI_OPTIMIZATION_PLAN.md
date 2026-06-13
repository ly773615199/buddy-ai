# 前端 UI 优化计划

> 生成时间: 2026-04-27
> 状态: 待执行
> 范围: 沟通窗口 + 整体 UI

## 背景

前端 69 个文件，~10K 行代码。沟通窗口的 6 个 bug 已修复（commit 5e6d8eb），但整体 UI 仍有多个优化空间：沟通窗口交互能力弱、无主题系统、样式硬编码、移动端不适配。

## 前端架构现状

```
App.tsx (Tab 路由, 8 个面板)
├── ChatPanel         ← 沟通窗口 (消息列表 + 输入栏)
│   ├── MessageBubble ← 消息气泡 (7 种角色)
│   │   ├── renderMarkdown() ← 轻量 MD 渲染 (无语法高亮)
│   │   └── ToolCallCard     ← 工具调用卡片
│   ├── InputBar      ← 输入栏 (textarea + 语音)
│   └── AgentTrace    ← 推理链时间线
├── SpriteRenderer    ← PIXI.js 精灵 (~1000 行)
├── PetStats          ← 养成状态 (~570 行)
├── ActivityPanel     ← 活动面板
├── ToolPanel         ← 工具面板
├── MemoryPanel       ← 记忆面板
├── Experts           ← 专家商城 (~450 行)
├── VisionPanel       ← 视觉面板
├── Settings          ← 设置 (~630 行)
└── Onboarding        ← 首次引导
```

### 样式系统

- **全部 inline style**，无 CSS 框架
- 颜色体系来自 GitHub Dark 主题
- 无 CSS 变量，颜色硬编码在每个组件中
- hover/active 通过 JS onMouseEnter/onMouseLeave 模拟
- 无响应式断点

### 颜色体系

```
背景:  #0d1117 → #161b22 → #21262d
边框:  #30363d
文字:  #e6edf3 (主) / #c9d1d9 (次) / #8b949e (弱) / #484f58 (极弱)
强调:  #58a6ff (蓝) / #3fb950 (绿) / #d29922 (黄) / #f85149 (红) / #f778ba (粉) / #a371f7 (紫) / #f0883e (橙)
```

---

## 优化计划

### Phase A: 沟通窗口交互增强 (P1)

#### A.1 消息操作菜单

**问题**: 消息只能看，不能操作。

**方案**: 鼠标悬停消息时显示操作按钮：

```
┌─────────────────────────────────┐
│ 这是助手的回复内容...            │  ← 消息气泡
│                                 │
│              📋 复制  🔄 重试   │  ← 悬停操作栏
└─────────────────────────────────┘
```

**操作项**:
- **复制** — 一键复制消息内容到剪贴板
- **重试** — 重新发送最后一条用户消息（仅对最后一条用户消息显示）
- **删除** — 从本地消息列表中移除

**实现**:
- `MessageBubble.tsx` 添加 hover 状态 + 操作按钮
- 使用 `navigator.clipboard.writeText()` 复制
- 重试调用 `onRetry(messageId)` 回调
- 删除调用 `onDelete(messageId)` 回调

**涉及文件**: `MessageBubble.tsx`, `ChatPanel.tsx`, `useWebSocket.ts`

#### A.2 代码块语法高亮 + 复制

**问题**: 代码块只有基本样式，无语法高亮，无复制按钮。

**方案**:
- 集成 `highlight.js`（轻量，~30KB gzip）
- 代码块右上角添加语言标签 + 复制按钮
- 支持常见语言: JavaScript, TypeScript, Python, Bash, JSON, CSS, HTML

**实现**:
- `utils/markdown.tsx` 中代码块渲染改用 highlight.js
- 添加复制按钮（绝对定位在代码块右上角）

```
┌─ TypeScript ─────────────── 📋 ─┐
│ function hello() {              │
│   console.log("world");         │
│ }                               │
└─────────────────────────────────┘
```

**涉及文件**: `utils/markdown.tsx`

**依赖**: `highlight.js` (npm install)

#### A.3 输入框增强

**问题**: 输入框功能简陋。

**方案**:
- **自动高度**: textarea 根据内容自动增长 (max 120px)
- **历史命令**: ↑/↓ 切换历史发送消息
- **快捷命令面板**: 输入 `/` 显示可用命令列表

**涉及文件**: `InputBar.tsx`

#### A.4 消息搜索

**问题**: 长对话找不到之前的消息。

**方案**:
- Ctrl+F 触发搜索框（消息列表顶部）
- 实时过滤匹配消息
- 高亮匹配文字
- ESC 关闭搜索

**涉及文件**: `ChatPanel.tsx`

---

### Phase B: 整体 UI 治理 (P2)

#### B.1 主题系统 (CSS 变量)

**问题**: 颜色硬编码在每个组件中，无法切换主题。

**方案**: 提取 CSS 变量到全局样式：

```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border-primary: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #c9d1d9;
  --text-muted: #8b949e;
  --text-faint: #484f58;
  --accent-blue: #58a6ff;
  --accent-green: #3fb950;
  --accent-yellow: #d29922;
  --accent-red: #f85149;
  --accent-pink: #f778ba;
  --accent-purple: #a371f7;
  --accent-orange: #f0883e;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-mono: 'Cascadia Code', 'Fira Code', monospace;
}
```

**涉及文件**: 新建 `index.css`，所有组件引用 `var(--xxx)`

#### B.2 响应式布局

**问题**: 固定 maxWidth: 1200px，移动端体验差。

**方案**:
- 768px 断点：移动端精灵和面板上下排列
- 480px 断点：进一步压缩间距和字体
- 使用 CSS media query 或 `useMediaQuery` hook

**涉及文件**: `App.tsx`

#### B.3 Tab 切换保持组件存活

**问题**: Tab 切换时组件销毁重建，丢失状态。

**方案**: 所有 Tab 内容同时渲染，通过 display:none 切换：

```tsx
<div style={{ display: activeTab === 'chat' ? 'flex' : 'none' }}>
  <ChatPanel ... />
</div>
<div style={{ display: activeTab === 'tools' ? 'flex' : 'none' }}>
  <ToolPanel ... />
</div>
```

**涉及文件**: `App.tsx`

#### B.4 统一加载/空状态组件

**问题**: 各面板的加载/空状态样式不一致。

**方案**: 提取公共组件：

```tsx
function EmptyState({ emoji, title, desc }: { emoji: string; title: string; desc?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 30, color: '#8b949e' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: '#484f58' }}>{desc}</div>}
    </div>
  );
}
```

**涉及文件**: 新建 `components/EmptyState.tsx`，各面板引用

---

### Phase C: 性能优化 (P3)

#### C.1 消息虚拟滚动

**问题**: 所有消息都在 DOM 中，长对话卡顿。

**方案**: 使用 `@tanstack/react-virtual`：

```tsx
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 60,
  overscan: 5,
});
```

**涉及文件**: `ChatPanel.tsx`

**依赖**: `@tanstack/react-virtual` (npm install)

#### C.2 Markdown useMemo 缓存

**问题**: `renderMarkdown()` 每次渲染都重新解析。

**方案**: 用 `useMemo` 缓存结果：

```tsx
const rendered = useMemo(() => renderMarkdown(content), [content]);
```

**涉及文件**: `MessageBubble.tsx`

#### C.3 PIXI.js 渲染优化

**问题**: SpriteRenderer ~1000 行，粒子系统可能在低端设备卡顿。

**方案**:
- Tab 不可见时暂停 PIXI ticker
- 粒子数量上限 80
- 低端设备降级为 CSS 动画

**涉及文件**: `SpriteRenderer.tsx`

---

## 执行顺序

```
Phase A (P1) — 沟通窗口交互增强
  ├─ A.1 消息操作菜单 (复制/重试/删除)
  ├─ A.2 代码块语法高亮 + 复制按钮
  ├─ A.3 输入框增强 (自动高度/历史命令/快捷命令)
  └─ A.4 消息搜索
         ↓
Phase B (P2) — 整体 UI 治理
  ├─ B.1 主题系统 (CSS 变量)
  ├─ B.2 响应式布局
  ├─ B.3 Tab 切换保持组件存活
  └─ B.4 统一加载/空状态组件
         ↓
Phase C (P3) — 性能优化
  ├─ C.1 消息虚拟滚动
  ├─ C.2 Markdown useMemo 缓存
  └─ C.3 PIXI.js 渲染优化
```

## 预估工作量

| Phase | 文件数 | 预估行数 | 依赖 |
|-------|--------|---------|------|
| A.1 | 3 | ~120 | 无 |
| A.2 | 1 | ~60 | highlight.js |
| A.3 | 1 | ~80 | 无 |
| A.4 | 1 | ~60 | 无 |
| B.1 | 全部 | ~200 (改) | 无 |
| B.2 | 1 | ~40 | 无 |
| B.3 | 1 | ~20 | 无 |
| B.4 | 新建 | ~50 | 无 |
| C.1 | 1 | ~40 | @tanstack/react-virtual |
| C.2 | 1 | ~5 | 无 |
| C.3 | 1 | ~30 | 无 |

## 关键文件

| 文件 | 作用 | Phase |
|------|------|-------|
| `components/MessageBubble.tsx` | 消息气泡 | A.1 |
| `components/ChatPanel.tsx` | 聊天面板 | A.1, A.4 |
| `components/InputBar.tsx` | 输入栏 | A.3 |
| `utils/markdown.tsx` | Markdown 渲染 | A.2 |
| `App.tsx` | 主应用 | B.2, B.3 |
| `index.css` | 全局样式 | B.1 (新建) |
| `components/EmptyState.tsx` | 空状态组件 | B.4 (新建) |
| `components/SpriteRenderer.tsx` | 精灵渲染 | C.3 |
