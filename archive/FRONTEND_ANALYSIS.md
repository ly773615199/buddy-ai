# 前端缺陷分析报告

> 分析日期：2026-04-11
> 分析范围：`frontend/src/` 全部组件 + WebSocket 通信层 + 后端 `broadcastStatus()` 对比
> 结论：**5 个严重缺陷 + 3 个中等问题**，~~修完后前端→后端链路才能真正跑通~~ **已全部修复** ✅

---

## 一、分析方法

逐层对比三个数据源：

1. **后端广播**：`src/core/agent.ts` → `broadcastStatus()` 实际发送的字段
2. **前端类型**：`frontend/src/types/buddy.ts` → `BuddyState` 接口定义
3. **组件消费**：各 React 组件实际使用的字段

额外检查：WebSocket 事件处理、定时器生命周期、消息流完整性。

---

## 二、数据流对比

### 2.1 后端 broadcastStatus 发送（17 个字段）

```
petSummary.name
petSummary.species
petSummary.emoji
petSummary.rarity
petSummary.rarityColor
petSummary.evolutionStage
petSummary.stageName
petSummary.stageEmoji
petSummary.stageDescription
petSummary.intimacy
petSummary.intimacyDescription
petSummary.behaviorSignals
petSummary.battleStats
petSummary.features
petSummary.exploration
petSummary.guidance
petSummary.stats
emotionState (mood/energy/satisfaction)
```

### 2.2 PetManager.getSummary() 返回（20 个字段）

包含了以上全部，**额外返回 3 个字段**：

```
petSummary.visualSeed      ← 后端未传递
petSummary.formProgress     ← 后端未传递
petSummary.visualStage      ← 后端未传递
```

### 2.3 前端 BuddyState 期望（20 个字段）

```
name, species, emoji, rarity, rarityColor
evolutionStage, stageName, stageEmoji, stageDescription
intimacy, intimacyDescription
behaviorSignals
stats (battleStats)
features
exploration
guidance
petStats
emotion
visualSeed        ← 未收到
formProgress      ← 未收到
visualStage       ← 未收到
```

### 2.4 差异总结

| 字段 | getSummary 返回 | broadcastStatus 发送 | 前端期望 | 状态 |
|------|:-:|:-:|:-:|:-:|
| name ~ stats (17个) | ✅ | ✅ | ✅ | 匹配 |
| visualSeed | ✅ | ❌ | ✅ | **缺失** |
| formProgress | ✅ | ❌ | ✅ | **缺失** |
| visualStage | ✅ | ❌ | ✅ | **缺失** |

---

## 三、缺陷清单

### 🔴 缺陷 1：broadcastStatus() 缺失 3 个关键字段 ✅ 已修复 `c9cc242`

| 属性 | 值 |
|------|-----|
| **严重度** | 严重 |
| **位置** | `src/core/agent.ts` → `broadcastStatus()` |
| **影响** | PixiJS 精灵永远渲染为默认状态（无颜色/质感/形态） |

**详情：**

`getSummary()` 返回了 `visualSeed`、`formProgress`、`visualStage`，但 `broadcastStatus()` 没有传递这三个字段给前端。

**影响链：**
1. `buddyState.visualSeed` 为 `undefined`
2. `SpriteRenderer` 降级为默认灰色蛋形态
3. App.tsx visualStage 进度条永远不显示
4. Onboarding 选的颜色/质感/气质完全无效

**修复方案：**

在 `broadcastStatus()` 的 data 对象中追加：

```typescript
// 视觉形象
visualSeed: petSummary.visualSeed,
formProgress: petSummary.formProgress,
visualStage: petSummary.visualStage,
```

---

### 🔴 缺陷 2：WebSocket URL 硬编码绕过 Vite Proxy ✅ 已修复 `c461295`

| 属性 | 值 |
|------|-----|
| **严重度** | 严重 |
| **位置** | `frontend/src/App.tsx:14` |
| **影响** | 生产部署时前端无法连后端 |

**详情：**

```typescript
// App.tsx — 硬编码直连 8765 端口
const WS_URL = `ws://${window.location.hostname}:8765`;
```

```typescript
// vite.config.ts — 配了 proxy 但没用上
proxy: { '/ws': { target: 'ws://localhost:8765', ws: true } }
```

前端直接连 8765 端口，完全绕过 Vite 代理。

**问题：**
- 生产部署时域名+端口对不上
- 跨域问题（前端 5173 → 后端 8765）
- 如果后端换了端口，前端要改代码

**修复方案：**

```typescript
// 方案 A：使用相对路径（推荐，配合 Vite proxy）
const WS_URL = `ws://${window.location.host}/ws`;

// 方案 B：可配置
const WS_URL = localStorage.getItem('buddy_ws_url')
  || `ws://${window.location.host}/ws`;
```

---

### 🔴 缺陷 3：后端不处理 visual_seed 消息 ✅ 已修复 `006a4e2`

| 属性 | 值 |
|------|-----|
| **严重度** | 严重 |
| **位置** | `src/core/agent.ts` → `setupWebSocket()` |
| **影响** | Onboarding 选择的颜色/质感/气质无法同步到后端 |

**详情：**

前端 Onboarding 完成后发送：

```typescript
ws.send(JSON.stringify({ type: 'visual_seed', ...seed }));
// 即: { type: 'visual_seed', primaryColor, texture, temperament, seed }
```

后端 WS 消息处理器只处理：

```
chat / pet / command / status_request / ping / tool_confirm_response
```

`visual_seed` **被静默丢弃**，后端 PetManager 的 visualSeed 使用默认值。

**修复方案：**

在 `setupWebSocket()` 的 switch 中添加：

```typescript
case 'visual_seed':
  this.handleVisualSeed(msg);
  break;
```

并实现 `handleVisualSeed()` 方法，将 seed 写入 PetManager。

---

### 🟡 缺陷 4：Onboarding 预览动画 Timer 泄漏 ✅ 已修复 `06fd946`

| 属性 | 值 |
|------|-----|
| **严重度** | 中等 |
| **位置** | `frontend/src/components/Onboarding.tsx:37` |
| **影响** | 内存泄漏 + 更新已卸载组件警告 |

**详情：**

```typescript
// 错误写法：useState 的初始化函数返回值被当作初始状态
useState(() => {
  const interval = setInterval(() => {
    setPreviewBreath(prev => (prev + 0.03) % (Math.PI * 2));
  }, 50);
  return () => clearInterval(interval);  // ← cleanup 丢失
});
```

`useState(initializer)` 只在首次渲染时调用 `initializer`，返回值作为初始 state。cleanup 函数被当作初始值存储，永远不会执行。

组件卸载后 interval 继续运行 → React 报 "Can't perform a React state update on an unmounted component"。

**修复方案：**

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setPreviewBreath(prev => (prev + 0.03) % (Math.PI * 2));
  }, 50);
  return () => clearInterval(interval);  // ← cleanup 正确执行
}, []);
```

---

### 🟡 缺陷 5：Emotion 事件不更新 BuddyState ✅ 已修复 `aa06003`

| 属性 | 值 |
|------|-----|
| **严重度** | 中等 |
| **位置** | `frontend/src/hooks/useWebSocket.ts` |
| **影响** | PetStats 情绪显示与实际状态不同步 |

**详情：**

后端每次情绪变化都发 `{ type: 'emotion', mood, energy, satisfaction }`，但前端只用它来临时切换 sprite 动画状态：

```typescript
case 'emotion':
  if (event.mood === 'excited' || event.mood === 'happy') {
    setSprite('excited');
    setTimeout(() => setSprite('idle'), 2000);
  }
  break;  // ← 不更新 buddyState.emotion
```

`buddyState.emotion` 只在 `status` 事件（广播）中更新。单独的情绪变化事件（摸头/工具成功/深夜关怀）不会反映到 PetStats 面板。

**修复方案：**

```typescript
case 'emotion':
  setBuddyState(prev => prev ? {
    ...prev,
    emotion: {
      mood: event.mood || prev.emotion.mood,
      energy: event.energy ?? prev.emotion.energy,
      satisfaction: event.satisfaction ?? prev.emotion.satisfaction,
    },
  } : null);
  if (event.mood === 'excited' || event.mood === 'happy') {
    setSprite('excited');
    setTimeout(() => setSprite('idle'), 2000);
  }
  break;
```

---

## 四、中等问题

### 问题 6：guidance 类型部分不匹配

后端返回的 guidance 包含 `priority`、`shown`、`completedAt`，前端 `Guidance` 接口未定义这些字段。不会报错（JS 容忍额外属性），但将来用 `priority` 排序会 undefined。

### 问题 7：App.tsx 导入了未使用的组件

`AchievementsPanel` 被导入但从未渲染。`ExplorationMap` 被 PetStats 内部使用，App.tsx 不直接使用。

### 问题 8：用户消息乐观更新无回滚

前端 `send()` 立即添加用户消息到 UI，后端如果返回错误，已显示的消息不会被移除。可能导致用户看到不存在的消息。

---

## 五、修复优先级

| 优先级 | 缺陷 | 工作量 | 阻塞其他工作 | 状态 |
|:---:|------|:---:|:---:|:---:|
| P0 | 缺陷 1：broadcastStatus 缺失字段 | 3 行 | ✅ 精灵渲染全挂 | ✅ 已修复 |
| P0 | 缺陷 3：后端不处理 visual_seed | ~20 行 | ✅ Onboarding 无效 | ✅ 已修复 |
| P1 | 缺陷 2：WS URL 硬编码 | 1 行 | 部署时必挂 | ✅ 已修复 |
| P2 | 缺陷 5：Emotion 不更新状态 | ~10 行 | 情绪显示不同步 | ✅ 已修复 |
| P2 | 缺陷 4：Timer 泄漏 | 2 行 | 内存泄漏 | ✅ 已修复 |

**全部 5 个缺陷已修复 ✅**

---

## 六、架构合理性评估

### ✅ 做得好的部分

1. **类型定义完整**：`BuddyState` 接口覆盖了养成 v2 全部字段，与后端数据结构对齐良好
2. **WebSocket 事件处理完整**：`useWebSocket.ts` 处理了 12 种事件类型，流式输出有基础支持
3. **组件分层合理**：SpriteRenderer（PixiJS 渲染）/ ChatPanel（对话）/ PetStats（养成面板）职责清晰
4. **ExplorationMap 组件设计好**：按类别分组、进度条、引导提示，UI 清晰
5. **Onboarding 流程完整**：颜色→质感→气质三步引导，有预览动画

### ⚠️ 需要改进的部分

1. **前后端事件协议未对齐**：visual_seed 无后端处理、emotion 不更新状态
2. **缺少错误边界**：组件没有 ErrorBoundary，PixiJS 初始化失败会导致白屏
3. **缺少 loading 状态**：连接 WebSocket 时没有 loading 指示
4. **App.tsx 有未使用的导入**：AchievementsPanel
5. **无自动重连 UI 反馈**：useWebSocket 有 3 秒重连逻辑，但 UI 只显示"未连接"

---

*v1.0 — 2026-04-11 前端深度分析*
