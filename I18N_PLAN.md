# Buddy 国际化方案（修订版）

> 生成时间：2026-04-22
> 修订时间：2026-04-23
> 核心修订：i18n 仅针对前端 UI，后端/CLI/Prompt 不需要翻译

---

## 一、范围界定

### 需要 i18n 的

| 层 | 文件 | 硬编码行数 | 原因 |
|---|---|---|---|
| **前端 UI 组件** | 14 个 .tsx 文件 | 396 行 | 用户直接看到 |
| **合计** | | **396 行** | |

### 不需要 i18n 的

| 层 | 原因 |
|---|---|
| System Prompt | LLM 不挑语言，中英都能理解 |
| 工具描述 | LLM 读的，不是用户读的 |
| .skillmate 文件 | LLM 读的 |
| 养成系统（后端） | 通过 API 传给前端，前端自己翻译 |

### 待定（当前不需要，后续国际化时再评估）

| 层 | 现状 | 待定原因 |
|---|---|---|
| CLI（main.ts） | 开发者用的，中文即可 | 如果开源/海外开发者使用，需要英文 |
| 错误消息（后端） | 开发者看的 | 如果开源，错误信息需要英文 |
| 情绪/行为描述 | 间接影响 LLM 输出 | 如果英文 Prompt 下需要英文描述 |

**原则：后端随便写中文，LLM 不在乎。只有用户肉眼看到的文字需要翻译。CLI 和错误消息留待后续评估。**

---

## 二、前端组件中文分布

| 组件 | 中文行数 | 内容类型 |
|------|---------|---------|
| SpriteRenderer.tsx | 114 | 进化阶段名/物种名/状态文案 |
| Experts.tsx | 54 | 专家面板文案 |
| PetStats.tsx | 43 | 属性名/状态/引导提示 |
| VisionPanel.tsx | 40 | 视觉模块标签/状态 |
| Onboarding.tsx | 35 | 引导流程文案 |
| SensorPanel.tsx | 28 | 传感器标签/描述 |
| CognitiveDashboard.tsx | 23 | 认知模块标签 |
| App.tsx | 14 | Tab 标签 |
| InputBar.tsx | 14 | 输入占位符/按钮 |
| ExplorationMap.tsx | 11 | 功能节点名 |
| 其他 (4 个) | 20 | 零散 |
| **合计** | **396** | |

---

## 三、技术方案

### 库选型：`react-i18next` + `i18next`

```
npm install react-i18next i18next
```

### 目录结构

```
frontend/src/
├── i18n/
│   ├── index.ts              — i18next 初始化配置
│   ├── zh-CN.json            — 中文翻译（主语言）
│   └── en.json               — 英文翻译
├── components/
│   └── ...                   — 使用 t('key') 替代硬编码
```

### key 命名规范

```
component.组件名.用途

示例：
chat.title            → "对话"
chat.inputPlaceholder → "输入消息..."
pet.energy            → "精力"
pet.stages.egg        → "蛋"
vision.camera         → "摄像头"
tab.chat              → "对话"
tab.tools             → "工具"
```

### 使用示例

```tsx
// Before
<div>对话</div>
<input placeholder="输入消息..." />

// After
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
<div>{t('chat.title')}</div>
<input placeholder={t('chat.inputPlaceholder')} />
```

---

## 四、实施策略

**不做独立项目，随前端组件改造顺手做。**

### Step 1：基建（半天）

| 任务 | 文件 | 耗时 |
|------|------|------|
| 安装 react-i18next + i18next | package.json | 10 min |
| 创建 i18n/index.ts 初始化 | i18n/index.ts | 30 min |
| 创建 zh-CN.json 骨架 | zh-CN.json | 30 min |
| 创建 en.json 骨架 | en.json | 30 min |
| App.tsx 引入 I18nextProvider | main.tsx | 10 min |

### Step 2：语言切换 UI（已完成）

在 App.tsx Header 右上角添加临时语言切换按钮（🌐 EN / 🌐 中）。
点击切换 zh-CN ↔ en，持久化到 localStorage。
等设置面板（Sprint 1）做好后迁移到设置面板外观区。

### Step 3：新代码走 i18n（持续）

从今天开始，所有新增组件用 `t('key')`，不再硬编码中文。
存量不变，增量不再增长。

### Step 4：存量逐步迁移（随组件改造）

在 UI_REQUIREMENTS.md 的 Sprint 计划中，每个 Sprint 改组件时顺手迁移：

| Sprint | 组件 | 中文行数 |
|--------|------|---------|
| Sprint 1 | App.tsx + InputBar | 28 |
| Sprint 2 | Onboarding.tsx + PetStats.tsx + ExplorationMap.tsx | 89 |
| Sprint 3 | SpriteRenderer.tsx | 114 |
| Sprint 4 | CognitiveDashboard.tsx | 23 |
| Sprint 5 | VisionPanel.tsx + SensorPanel.tsx | 68 |
| Sprint 6 | Experts.tsx + 其他 | 74 |
| **合计** | | **396** |

---

## 五、验收标准

- [ ] `language: 'zh'` 时，所有 UI 与改造前一致
- [ ] `language: 'en'` 时，前端 UI 全部英文
- [ ] 语言切换无需重启（前端热切换）
- [ ] 无中文残留的硬编码（通过 `grep -rn "[一-龥]" frontend/src/components/` 验证）
- [ ] 全部前端测试通过

---

## 六、翻译文件示例

**zh-CN.json：**
```json
{
  "chat": {
    "title": "对话",
    "inputPlaceholder": "输入消息... (Shift+Enter 换行)",
    "empty": "打个招呼吧！"
  },
  "pet": {
    "energy": "精力",
    "intimacy": "亲密度",
    "stages": {
      "egg": "蛋",
      "hatching": "孵化",
      "growing": "成长",
      "formed": "成形",
      "mature": "成熟",
      "complete": "完全体",
      "legendary": "传说"
    }
  },
  "tab": {
    "chat": "对话",
    "tools": "工具",
    "memory": "记忆",
    "activity": "活动",
    "settings": "设置",
    "explore": "探索",
    "vision": "视觉",
    "experts": "专家"
  }
}
```

**en.json：**
```json
{
  "chat": {
    "title": "Chat",
    "inputPlaceholder": "Type a message... (Shift+Enter for new line)",
    "empty": "Say hello!"
  },
  "pet": {
    "energy": "Energy",
    "intimacy": "Intimacy",
    "stages": {
      "egg": "Egg",
      "hatching": "Hatching",
      "growing": "Growing",
      "formed": "Formed",
      "mature": "Mature",
      "complete": "Complete",
      "legendary": "Legendary"
    }
  },
  "tab": {
    "chat": "Chat",
    "tools": "Tools",
    "memory": "Memory",
    "activity": "Activity",
    "settings": "Settings",
    "explore": "Explore",
    "vision": "Vision",
    "experts": "Experts"
  }
}
```
