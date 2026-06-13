# E2E 测试修复计划

> 生成时间：2026-05-08 19:30
> 基于全量 E2E 测试运行结果（346 tests, 239 passed, 94 failed, 13 skipped）

---

## 一、测试基线

```
总计: 346 | 通过: 239 (69.1%) | 失败: 94 (27.2%) | 跳过: 13 (3.8%)
耗时: 22.6m | 1 worker | chromium (/usr/bin/chromium)
环境: npm install (npmmirror), better-sqlite3 rebuilt, Playwright v1.59.1
```

---

## 二、根因分析

### 核心发现：46/94 个失败共享同一根因

页面快照（Playwright error-context.md）显示多个面板同时崩溃：

```
😵 活动 出错了
t is not defined
🔄 刷新重试
```

受影响组件：ActivityPanel、ChatPanel、ExplorationMap、KnowledgePanel、
MemoryPanel、PetStats、SpriteRenderer 等 — 共 46 个测试。

### 根因 ①：模块级 `t()` 调用

组件在模块顶层（函数体外）调用 `t()`，但 `t` 来自 `useTranslation()` hook，
仅在组件函数体内可用。模块加载时 i18n 上下文未就绪，`t` 为 undefined。

**已修复文件（4 个）：**

| 文件 | 受影响变量 | 修复方式 |
|------|-----------|---------|
| `InputBar.tsx` | `SLASH_COMMANDS` | 工厂函数 `getSlashCommands(t)` |
| `PetStats.tsx` | `STAT_LABELS` | 工厂函数 `getStatLabels(t)` |
| `Experts.tsx` | `STAGE_CONFIG` | 工厂函数 `getStageConfig(t)` |
| `Onboarding.tsx` | `STEP_TITLES` | 工厂函数 `getStepTitles(t)` |

**修复模式：**
```tsx
// ❌ Before: 模块级调用，t 未定义
const SLASH_COMMANDS = [
  { cmd: '/help', desc: t('查看帮助信息') },
];

// ✅ After: 工厂函数，延迟到组件内调用
function getSlashCommands(t: (key: string) => string) {
  return [
    { cmd: '/help', desc: t('查看帮助信息') },
  ];
}

export default function InputBar() {
  const { t } = useTranslation();
  const SLASH_COMMANDS = getSlashCommands(t);
}
```

### 根因 ②：App.tsx 使用英文 key 而非中文文本

```tsx
// App.tsx 当前写法（错误）：
t('tab.chat')      → 返回 'tab.chat'（原始 key，无翻译）
t('app.title')     → 返回 'app.title'
t('tab.activity')  → 返回 'tab.activity'

// i18n 系统设计（正确）：
t('💬 聊天')       → zh-CN 返回 '💬 聊天'
t('🏠 光灵')       → zh-CN 返回 '🏠 光灵'
```

**影响范围：** 所有 Tab 名称、App 标题/副标题、Settings 面板标题

**页面快照确认：**
```
💬 tab.chat  🔧 tab.tools  🧠 tab.memory  📊 tab.activity
app.title  app.subtitle  settings.behavior.title  settings.appearance.title
```

### 根因 ③：视觉回归基线缺失

~25 个 visual-regression 测试失败，分两类：
- **快照不存在**（首次运行）：`writing actual` — 需生成基线
- **像素差异**（>1%）：字体渲染差异 — 需在当前环境重新生成

### 根因 ④：WS Mock LLM 链路断裂

```
⚠️ LLM 流式调用失败 [unknown]: Cannot read properties of undefined (reading 'length')
Agent 处理错误: 出了点问题: 未知错误
```

Mock LLM 的 `_mockResponse()` 正则不匹配中文自然语言输入，
导致工具调用解析失败 → 响应链路断裂 → 8 个 chat-flow / three-brain 测试失败。

（详见 E2E_FIX_PLAN.md 中的 MockLLM 正则分析）

---

## 三、失败分类明细

| 类别 | 数量 | 根因 | 优先级 |
|------|------|------|--------|
| `t is not defined` 崩溃 | 46 | 模块级 t() 调用 | P0 |
| i18n 英文 key 未翻译 | ~15 | App.tsx/Settings.tsx 用英文 key | P0 |
| 视觉回归截图差异 | ~25 | 基线缺失/字体差异 | P1 |
| WS Mock 链路断裂 | ~8 | 正则不匹配中文 | P1 |
| SpriteRenderer canvas | ~6 | headless WebGL 兼容 | P2 |
| i18n 测试选择器 | 4 | 选择器不适配 | P2 |
| 其他零散 | ~10 | 各种超时 | P2 |

---

## 四、修复计划

### Step 1：清缓存 + 重跑确认基线（P0）

```bash
rm -rf frontend/node_modules/.vite
BUDDY_MOCK_LLM=1 npx playwright test --reporter=list
```

**预期：** 46 个 `t is not defined` 错误中，已修复的 4 个组件相关测试应全部通过。
若仍有 `t is not defined`，说明存在未发现的模块级 t() 调用，需补充修复。

### Step 2：App.tsx + Settings.tsx 英文 key → 中文文本（P0）

**App.tsx 修改清单：**

```tsx
// 当前 → 目标
t('tab.chat')      → t('💬 聊天')
t('tab.tools')     → t('🔧 工具')
t('tab.memory')    → t('🧠 记忆')
t('tab.activity')  → t('📊 活动')
t('tab.explore')   → t('🗺️ 探索')
t('tab.vision')    → t('👁️ 视觉')
t('tab.experts')   → t('🎓 专家')
t('tab.settings')  → t('⚙️ 设置')
t('app.title')     → t('🏠 光灵')
t('app.subtitle')  → t('你的 AI 伙伴')
```

**ActivityPanel 子标签修改：**

```tsx
// 当前 → 目标
t('activity.timeline')  → t('时间线')
t('activity.stats')     → t('统计')
t('activity.scheduler') → t('调度')
t('activity.dreams')    → t('梦境')
t('activity.sensors')   → t('传感')
```

**Settings.tsx 修改：** 同理将 `settings.behavior.title` 等英文 key 改为中文。

### Step 3：重跑 i18n + activity-panel 测试（P0）

```bash
BUDDY_MOCK_LLM=1 npx playwright test e2e/i18n.spec.ts e2e/activity-panel.spec.ts e2e/app.spec.ts --reporter=list
```

**预期：** i18n 4 个 + activity-panel 12 个 + app 4 个 = 20 个测试修复。

### Step 4：更新视觉回归基线（P1）

```bash
BUDDY_MOCK_LLM=1 npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```

在当前环境生成新的基线快照，后续以此为准。

### Step 5：修 WS Mock 链路（P1）

修改 `src/mock/llm.ts` 的 `_mockResponse()` 正则，覆盖中文自然语言表达：

| 测试输入 | 期望工具 | 当前正则 | 修复 |
|---------|---------|---------|------|
| `帮我列一下当前目录` | list_files | `/列出\|列表\|看看/` | 加 `列一下` |
| `执行命令 echo hello` | exec | `/执行\|运行\|跑\s+/` | 改 `/执行\|运行\|跑/` |
| `读取文件 package.json` | read_file | `/读取\|读\|打开/` | 改 `/读取\|读\|打开\|查看/` |
| `搜索文件 test` | search_files | `/搜索\|查找\|找/` | 改 `/搜索\|查找\|找\|搜/` |

### Step 6：修 i18n 测试选择器（P2）

i18n 测试检查切英文后 Tab 文本，但当前 Tab 用英文 key 显示。
Step 2 修复后需同步更新测试中的选择器。

---

## 五、预期结果

| Step | 修复测试数 | 累计通过率 |
|------|-----------|-----------|
| 基线 | — | 239/346 (69.1%) |
| Step 1 (清缓存) | +10~20 | ~75% |
| Step 2 (英文 key) | +15~20 | ~81% |
| Step 3 (验证) | 确认 | ~81% |
| Step 4 (视觉基线) | +20~25 | ~88% |
| Step 5 (Mock 链路) | +5~8 | ~90% |
| Step 6 (i18n 选择器) | +3~4 | ~91% |

**最终预期通过率：~90%+**（剩余失败主要为环境差异和未覆盖场景）

---

## 六、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| ✅ 已修改 | `frontend/src/components/InputBar.tsx` | SLASH_COMMANDS 工厂函数 |
| ✅ 已修改 | `frontend/src/components/PetStats.tsx` | STAT_LABELS 工厂函数 |
| ✅ 已修改 | `frontend/src/components/Experts.tsx` | STAGE_CONFIG 工厂函数 |
| ✅ 已修改 | `frontend/src/components/Onboarding.tsx` | STEP_TITLES 工厂函数 |
| 🔲 待修改 | `frontend/src/App.tsx` | 英文 key → 中文文本 |
| 🔲 待修改 | `frontend/src/components/Settings.tsx` | 英文 key → 中文文本 |
| 🔲 待修改 | `frontend/src/components/ActivityPanel.tsx` | 子标签英文 key → 中文 |
| 🔲 待修改 | `src/mock/llm.ts` | Mock 正则扩展 |
| 🔲 待更新 | `e2e/visual-regression.spec.ts-snapshots/` | 基线截图 |
| 🔲 待修改 | `e2e/i18n.spec.ts` | 选择器适配 |
