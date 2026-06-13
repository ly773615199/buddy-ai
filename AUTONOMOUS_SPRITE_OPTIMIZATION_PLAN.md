# 自主形象优化计划

> 生成时间: 2026-04-27
> 状态: 待执行
> 优先级: P0 — 核心体验

## 背景

Buddy 的形象是一个有自主行动能力的角色，不是被动的 UI 元素。后端 `IdleBehavior` 系统会根据情绪/人格/欲望自主选择 8 种行为（blink、look_around、yawn、stretch、wave、think、sleep、peek），但前端 **7/8 种行为没有独特视觉反馈**，只有 `sleep` 有眼睛闭合 + Z 粒子效果。

这导致用户看到的光灵永远以相同方式呼吸，自主行为系统的价值被严重浪费。

## 完整数据链路

```
后端 IdleBehavior (情绪+人格+欲望 → 行为选择)
    ↓ WS idle_action 事件
前端 useWebSocket (spriteState 更新)
    ↓
SpriteRenderer (PIXI.js 渲染)
    ├─ 呼吸动画 (质感/气质驱动)
    ├─ 粒子系统 (emotion-particles.ts 参数驱动)
    ├─ 眼睛状态 (STATE_ANIM 映射)
    └─ 进化形态 (7 阶段)
```

## 当前状态审计

### 自主行为 → 视觉映射 (现状)

| 后端行为 | 前端 spriteState | 视觉差异 | 问题 |
|---------|-----------------|---------|------|
| blink | idle (不变) | ❌ 无 | 眨眼没有视觉表现 |
| look_around | idle (不变) | ❌ 无 | 东张西望没有视觉表现 |
| yawn | idle (不变) | ❌ 无 | 打哈欠没有视觉表现 |
| stretch | idle (不变) | ❌ 无 | 伸懒腰没有视觉表现 |
| wave | idle (不变) | ❌ 无 | 挥手没有视觉表现 |
| think | idle (不变) | ❌ 无 | 思考没有视觉表现 |
| peek | idle (不变) | ❌ 无 | 偷看没有视觉表现 |
| sleeping | sleeping | ✅ 有 | 眼睛闭合 + Z 粒子 |

### 情绪系统映射 (现状)

| 后端 Mood | 前端粒子预设 | 状态 |
|-----------|------------|------|
| happy | happy | ✅ |
| excited | excited | ✅ |
| calm | calm | ✅ |
| tired | tired | ✅ |
| frustrated | angry (近似) | ⚠️ 语义不一致 |
| thinking | (无专属) | ❌ |
| confused | (无专属) | ❌ |
| energetic | (无专属) | ❌ |
| — | curious | ⚠️ 前端有但后端不产生 |
| — | sad | ⚠️ 前端有但后端不产生 |
| — | anxious | ⚠️ 前端有但后端不产生 |

---

## 优化计划

### Phase 1: 自主行为视觉反馈 (P0)

**目标**: 让每种自主行为都有独特的视觉表现，让光灵"活起来"。

#### 1.1 新增 SpriteActionState 系统

当前 SpriteRenderer 只有 7 种 spriteState（idle/thinking/speaking/executing/error/sleeping/excited），不够区分自主行为。

**方案**: 在现有 spriteState 之上叠加 `actionState`，两者独立驱动：

```typescript
type ActionState = 
  | 'none'        // 无特殊行为
  | 'blink'       // 眨眼 — 眼睛快速闭合→张开 (0.2s)
  | 'look_around' // 东张西望 — 整体轻微摆动 + 眼球偏移
  | 'yawn'        // 打哈欠 — 呼吸幅度突然增大→缓慢恢复
  | 'stretch'     // 伸懒腰 — 身体拉伸 (scaleY 变化) → 回弹
  | 'wave'        // 挥手 — 一侧粒子爆发
  | 'think'       // 思考 — 呼吸减缓 + 头顶 "..." 粒子
  | 'peek'        // 偷看 — 身体小幅位移 + 一侧眼睛变大
```

**实现要点**:
- `useWebSocket` 将 `idle_action` 事件映射为 `actionState`
- `SpriteRenderer` 读取 `actionState`，叠加到现有动画上
- 每种行为有独立的时长和过渡曲线
- 行为完成后自动回到 `'none'`

#### 1.2 各行为视觉实现

**blink (眨眼)**
- 眼睛 scaleY 从 1→0→1，总时长 200ms
- 不影响其他动画层

**look_around (东张西望)**
- 整体 x 偏移 ±3px，周期 2s，持续 4s
- 眼球 (瞳孔位置) 左右偏移
- 粒子扩散方向跟随偏移

**yawn (打哈欠)**
- 呼吸幅度从当前值突增到 1.5x，然后缓慢恢复 (3s)
- 粒子颜色偏暖 (hueShift +10)
- 嘴部区域出现小的张合动画 (detailLayer)

**stretch (伸懒腰)**
- scaleY 从 1→1.15→1，总时长 1.5s
- 粒子向上爆发 (vy 方向偏移)
- 光晕亮度短暂增强

**wave (挥手)**
- 右侧粒子爆发 (单侧 8-10 个粒子)
- 整体轻微向左倾斜 (rotation ±0.05)
- 持续 1s

**think (思考)**
- 呼吸频率降低 50%
- 头顶出现 3 个小圆点粒子，缓慢上升
- 光晕脉动速度降低
- 持续直到下一个行为触发

**peek (偷看)**
- 整体 x 偏移 +5px (向右探)
- 右眼比左眼大 20%
- 粒子偏向右侧
- 持续 2s 后弹回

#### 1.3 后端事件扩展

当前 `idle_action` 事件只发送 action 名称。需要扩展为携带参数：

```typescript
// 现状
{ type: 'idle_action', action: 'yawn' }

// 优化: 携带持续时间和强度
{ type: 'idle_action', action: 'yawn', duration: 3000, intensity: 0.8 }
```

`duration` 让前端知道行为持续多久，`intensity` 让行为强度随情绪变化（兴奋时 wave 更剧烈，疲惫时 stretch 更缓慢）。

---

### Phase 2: 精灵自主移动 (P1)

**目标**: 精灵不再永远固定在画布中央，能在画布内缓慢漂移。

#### 2.1 Perlin 噪声漂移

- 使用简化的 Perlin 噪声生成平滑的 x/y 轨迹
- 漂移速度受情绪影响（excited 更快，calm 更慢）
- 漂移范围限制在画布内 (边距 40px)
- 每帧更新 position，叠加到现有渲染逻辑

#### 2.2 弹性回归

- 精灵远离中央时产生回归力 (spring force)
- `F = -k * distance`，k 值约 0.01
- 松手后自动弹回中央附近

#### 2.3 移动时粒子拖尾

- 精灵移动速度 > 阈值时，每帧额外生成 1-2 个拖尾粒子
- 拖尾粒子颜色与主色相同但透明度更低
- 粒子生命周期更短 (30 帧)

---

### Phase 3: 精灵交互增强 (P1)

**目标**: 精灵对用户鼠标/触摸有反应，增强"活的感觉"。

#### 3.1 眼球追踪

- 鼠标在画布内时，瞳孔位置朝鼠标方向偏移
- 偏移量限制在 ±2px，平滑过渡
- 鼠标离开画布后瞳孔回到中央

#### 3.2 鼠标接近反应

- 鼠标靠近精灵 (距离 < 80px) 时：
  - 低亲密度：精灵微微退让 (x 偏移远离鼠标)
  - 高亲密度：精灵微微靠近 (x 偏移靠近鼠标)
  - 反应强度与距离成反比

#### 3.3 拖拽交互

- 鼠标按下并拖拽时，精灵跟随鼠标移动
- 拖拽时粒子增加 (兴奋反应)
- 松手后弹性弹回

#### 3.4 状态菜单 (右键/长按)

- 右键点击精灵显示快速状态菜单
- 菜单项：当前情绪 / 进化阶段 / 亲密度 / 最近行为
- 点击其他地方关闭菜单

---

### Phase 4: 情绪粒子补全 (P2)

**目标**: 统一前后端 mood 映射，补全缺失的粒子预设。

#### 4.1 统一 Mood 名称

| 后端 Mood | 前端粒子预设 | 操作 |
|-----------|------------|------|
| happy | happy | ✅ 保持 |
| excited | excited | ✅ 保持 |
| calm | calm | ✅ 保持 |
| tired | tired | ✅ 保持 |
| frustrated | frustrated | 🔧 重命名 angry→frustrated |
| thinking | thinking | 🆕 新增预设 |
| confused | confused | 🆕 新增预设 |
| energetic | energetic | 🆕 新增预设 |

删除前端独有的 `curious`、`sad`、`anxious` 预设（后端不产生这些 mood），或保留在后端扩展时使用。

#### 4.2 新增预设参数

**thinking (思考)**
```typescript
{
  hueShift: -5,
  saturationMul: 0.9,
  brightnessMul: 0.95,
  velocityMul: 0.5,
  spreadMul: 0.7,
  spawnRateMul: 1.8,
  lifetimeMul: 1.5,
  glowIntensityMul: 0.9,
  glowPulseSpeed: 0.012,
  wobbleAmount: 0.3,
  clusterTendency: 0.6,
}
```

**confused (困惑)**
```typescript
{
  hueShift: 10,
  saturationMul: 1.1,
  brightnessMul: 1.0,
  velocityMul: 1.0,
  spreadMul: 1.4,
  spawnRateMul: 0.9,
  lifetimeMul: 1.0,
  glowIntensityMul: 1.1,
  glowPulseSpeed: 0.028,
  wobbleAmount: 2.0,
  clusterTendency: 0.2,
}
```

**energetic (精力充沛)**
```typescript
{
  hueShift: 20,
  saturationMul: 1.4,
  brightnessMul: 1.3,
  velocityMul: 1.6,
  spreadMul: 1.3,
  spawnRateMul: 0.5,
  lifetimeMul: 0.9,
  glowIntensityMul: 1.4,
  glowPulseSpeed: 0.035,
  trailEnabled: true,
  wobbleAmount: 1.8,
}
```

---

### Phase 5: 梦境视觉效果 (P2)

**目标**: 梦境状态有独特的视觉效果，区分于普通 sleeping。

#### 5.1 梦境光环

- 3 层同心圆缓慢旋转
- 颜色：主色 + 副色 + 白色，交替出现
- 旋转速度：0.005 rad/frame（比呼吸慢 4x）

#### 5.2 记忆碎片粒子

- 每 60 帧生成 1 个特殊粒子
- 粒子形状：小正方形而非圆形
- 颜色随机从主色/副色中选
- 粒子缓慢上升并逐渐消失

#### 5.3 梦境完成光爆发

- 收到 `dream_complete` 事件时触发
- 20 个粒子从中心向外爆发
- 光晕亮度短暂增强到 2x
- 1s 后恢复

---

### Phase 6: 进化形态差异化 (P3)

**目标**: 不同进化阶段的精灵有更明显的形态差异。

#### 6.1 形态参数表

| 阶段 | 身体比例 | 耳朵 | 尾巴 | 附加特征 |
|------|---------|------|------|---------|
| egg | 圆形 (1:1) | 无 | 无 | 光晕 |
| hatching | 椭圆 (1:1.1) | 隐约 | 无 | 裂纹 |
| growing | 椭圆 (1:1.3) | 明显 | 小尾 | 眼睛 |
| formed | 椭圆 (1:1.4) | 完整 | 中尾 | 纹路 |
| mature | 椭圆 (1:1.5) | 大耳 | 长尾 | 光环 |
| complete | 椭圆 (1:1.6) | 翅膀 | 华丽尾 | 星尘 |
| legendary | 任意 | 光翼 | 光尾 | 全特效 |

#### 6.2 实现方式

- 每个阶段有独立的绘制函数
- 阶段过渡时播放 morph 动画 (60 帧)
- 高阶段精灵有更多细节层

---

## 执行顺序

```
Phase 1 (P0) — 自主行为视觉反馈
  ├─ 1.1 新增 ActionState 系统
  ├─ 1.2 实现 7 种行为视觉
  └─ 1.3 后端事件扩展
         ↓
Phase 2 (P1) — 精灵自主移动
  ├─ 2.1 Perlin 噪声漂移
  ├─ 2.2 弹性回归
  └─ 2.3 移动拖尾
         ↓
Phase 3 (P1) — 精灵交互增强
  ├─ 3.1 眼球追踪
  ├─ 3.2 鼠标接近反应
  ├─ 3.3 拖拽交互
  └─ 3.4 状态菜单
         ↓
Phase 4 (P2) — 情绪粒子补全
  ├─ 4.1 统一 Mood 名称
  └─ 4.2 新增预设参数
         ↓
Phase 5 (P2) — 梦境视觉效果
  ├─ 5.1 梦境光环
  ├─ 5.2 记忆碎片粒子
  └─ 5.3 梦境完成光爆发
         ↓
Phase 6 (P3) — 进化形态差异化
  ├─ 6.1 形态参数表
  └─ 6.2 阶段绘制函数
```

## 预估工作量

| Phase | 文件数 | 预估行数 | 难度 |
|-------|--------|---------|------|
| Phase 1 | 3 | ~400 | 中 |
| Phase 2 | 1 | ~200 | 中 |
| Phase 3 | 2 | ~250 | 中 |
| Phase 4 | 2 | ~100 | 低 |
| Phase 5 | 1 | ~150 | 中 |
| Phase 6 | 1 | ~300 | 高 |

## 技术约束

- **不改变精灵独立性**: 所有行为仍由后端驱动，前端只负责视觉表达
- **向后兼容**: 新增字段为可选，旧后端仍能工作
- **性能优先**: 粒子总数不超过 100，每帧渲染时间 < 16ms
- **WebGL 降级**: 无 WebGL 时用 CSS 动画降级（已实现）

## 关键文件

| 文件 | 作用 | Phase |
|------|------|-------|
| `frontend/src/components/SpriteRenderer.tsx` | 精灵渲染主逻辑 | 1,2,3,5,6 |
| `frontend/src/hooks/useWebSocket.ts` | 事件处理 + 状态映射 | 1 |
| `frontend/src/types/buddy.ts` | 类型定义 | 1,4 |
| `frontend/src/emotion/emotion-particles.ts` | 情绪→粒子参数 | 4 |
| `frontend/src/emotion/emotion-sound.ts` | 情绪→声音参数 | 4 |
| `src/behavior/idle.ts` | 空闲行为触发 | 1.3 |
| `src/core/ws-handler.ts` | 事件广播 | 1.3 |
