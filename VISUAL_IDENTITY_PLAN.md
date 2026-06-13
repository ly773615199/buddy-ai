# Buddy 视觉形象系统 — 演进实施计划

> **目标：从 emoji 堆叠演进为"能量凝聚"视觉形象系统。**
> 每个用户的 Buddy 形象独一无二，随使用自然成形。
>
> 基于 `Buddy AI 视觉形象系统设计.md` | 2026-04-10

---

## 一、现状与差距

### 1.1 当前实现

| 模块 | 现状 | 文件 |
|------|------|------|
| 数据层 | 6 阶段进化（egg→legendary），基于功能探索数触发 | `src/pet/types.ts` |
| 渲染层 | PIXI.js + emoji 文本堆叠，按物种显示不同 emoji | `frontend/src/components/SpriteRenderer.tsx` |
| 注册流程 | 随机分配物种 + 稀有度，无用户选择 | `src/pet/manager.ts` |
| 行为影响 | 5 维属性 → 注入 System Prompt，不影响外观 | `src/pet/types.ts` |

### 1.2 设计文档要求

| 维度 | 要求 |
|------|------|
| 成长阶段 | 4 阶段：蛋→孵化→成长→成形（能量凝聚叙事） |
| 用户选择 | 主色调 + 质感（柔软/通透/锋利/温润）+ 气质（温暖/冷静/活泼/神秘） |
| 形象渲染 | Canvas/WebGL 光团 → 轮廓渐现 → 完整生成 |
| 行为映射 | 用户行为数据影响外观（深夜→暗色调，高频→细节丰富等） |
| 成形生成 | Prompt 构建框架 → 预设组件库(MVP) → AI 生图(V2) |

### 1.3 核心差距

```
emoji 堆叠                                          能量凝聚视觉系统
┌─────────┐                                       ┌─────────────────┐
│ 🦊💬    │  ─────── 需要改造 ───────→            │ 光团呼吸动画    │
│ 固定 emoji│                                       │ 轮廓渐现        │
│ 按物种切换│                                       │ 行为驱动外观    │
│ 无阶段感  │                                       │ 阶段性视觉差异  │
└─────────┘                                       └─────────────────┘
```

---

## 二、数据模型设计

### 2.1 VisualIdentity 类型（新增）

```typescript
/** 用户种子选择（注册时选择，影响视觉外观） */
interface VisualSeed {
  /** 主色调 1-2 个 hex 色值 */
  primaryColor: string;       // e.g. '#58a6ff'
  secondaryColor?: string;    // e.g. '#f778ba'

  /** 质感倾向 */
  texture: 'soft' | 'transparent' | 'sharp' | 'warm';
  // soft        → 圆润、柔和渐变、有机形态
  // transparent → 半透明、发光、玻璃质感
  // sharp       → 几何棱角、结晶、边缘分明
  // warm        → 暖色光晕、毛绒感、弥散光

  /** 气质方向 */
  temperament: 'warm' | 'calm' | 'lively' | 'mysterious';
  // warm       → 光的节奏柔和、明暗过渡缓慢
  // calm       → 冷色调为主、光影稳定
  // lively     → 光芒跳跃、颜色活泼、粒子活跃
  // mysterious → 暗色底光、若隐若现、紫/深蓝调

  /** 随机种子（注册时间 + 生日哈希 + 随机数，保证唯一且可复现） */
  seed: number;
}

/** 行为数据对视觉的修正（从使用行为计算，不存储，实时计算） */
interface BehaviorVisualEffect {
  /** 色调偏移 -0.2~0.2（深夜使用→偏暗） */
  brightnessShift: number;
  /** 细节丰富度 0~1（高频使用→更精致） */
  detailLevel: number;
  /** 形态圆润度 0~1（闲聊多→圆润；高效对话→利落） */
  roundness: number;
  /** 有机形态度 0~1（感性话题多→有机；理性→几何） */
  organicness: number;
  /** 粒子活跃度 0~1（活泼气质→粒子更多） */
  particleActivity: number;
}

/** 完整视觉形象数据 */
interface VisualIdentity {
  seed: VisualSeed;
  /** 当前成长阶段 */
  stage: 'egg' | 'hatching' | 'growing' | 'formed';
  /** 形象解锁百分比（0-100，影响细节展示程度） */
  formProgress: number;
}
```

### 2.2 与现有 PetData 的关系

```typescript
// PetData 新增字段
interface PetData {
  // ... 现有字段不变 ...

  /** 视觉形象种子（注册时设定，不可变） */
  visualSeed: VisualSeed;

  /** 形象生成百分比（0-100，随使用增长） */
  formProgress: number;
}
```

### 2.3 SQLite 表扩展

```sql
-- 视觉形象数据（新增表）
CREATE TABLE pet_visual (
  pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
  primary_color TEXT NOT NULL DEFAULT '#58a6ff',
  secondary_color TEXT,
  texture TEXT NOT NULL DEFAULT 'soft',
  temperament TEXT NOT NULL DEFAULT 'warm',
  seed INTEGER NOT NULL DEFAULT 0,
  form_progress REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'egg',
  created_at INTEGER NOT NULL
);
```

---

## 三、渲染层架构（核心改造）

### 3.1 从 Emoji 堆叠到 Canvas 渲染

**改造策略：** 保留 PIXI.js（项目已有依赖），但从 `PIXI.Text`(emoji) 转向 `PIXI.Graphics` + 着色器效果。

```
当前渲染管线：
  PIXI.Text(emoji) → 浮动动画 → 粒子(emoji)

目标渲染管线：
  阶段渲染器 → Canvas 图形绘制 → 光效/粒子系统 → 动画循环
```

### 3.2 四阶段渲染器

#### 🥚 蛋阶段 — 呼吸光团

```
视觉元素：
├── 中心光团（半径 40-60px，呼吸缩放）
│   ├── 主色渐变（从 seed.primaryColor 到透明）
│   ├── 副色微光（seed.secondaryColor，若存在）
│   └── 呼吸节奏（由 temperament 决定：warm=缓慢，lively=快速）
├── 外层光晕（半径 80-120px，柔和弥散）
│   └── 亮度由 texture 决定（transparent=高亮度，sharp=边缘清晰）
└── 微粒（少量，1-3 个缓慢飘浮）
    └── 数量由 particleActivity 决定

Canvas 实现：
- radialGradient(中心→边缘，primaryColor→transparent)
- requestAnimationFrame 控制呼吸周期（2-4 秒一周期）
- sin(t) 控制半径缩放（0.9x-1.1x）和透明度（0.6-1.0）
```

#### 🐣 孵化阶段 — 轮廓初现

```
视觉元素：
├── 蛋的光团（保留，但透明度降低到 60%）
├── 轮廓线（从光团中浮现）
│   ├── 模糊剪影（由 seed 决定形状偏好的随机生成）
│   ├── 轮廓线粗细由 texture 决定（soft=粗柔和，sharp=细清晰）
│   └── 轮廓显现动画（从中心向外扩散，alpha 0→0.7）
└── 呼吸光团中隐约的"生命迹象"（轮廓闪烁）

Canvas 实现：
- 在光团基础上叠加半透明轮廓
- 轮廓用 bezier 曲线绘制，seed 决定控制点
- formProgress 0-25% 区间驱动轮廓 alpha
```

#### 🦊 成长阶段 — 细节渐显

```
视觉元素：
├── 轮廓变清晰（alpha 0.7→1.0）
├── 内部细节填充
│   ├── 眼睛出现（formProgress 30%）
│   ├── 特征纹路出现（formProgress 50%，由 texture 决定风格）
│   ├── 颜色渐变丰富（formProgress 70%）
│   └── 动态表情出现（formProgress 90%）
├── 光团退为背景光晕
└── 粒子增多（陪伴感增强）

Canvas 实现：
- 分层绘制：背景光晕 → 身体轮廓 → 内部细节 → 高光/粒子
- 每层由 formProgress 阈值控制显示
- 细节样式由 texture + temperament 组合决定
```

#### 🐲 成形阶段 — 完整体

```
视觉元素：
├── 完整形象（清晰、精致、有表情变化）
├── 状态响应动画
│   ├── idle    → 轻微浮动 + 呼吸
│   ├── thinking → 轮廓模糊化 + 光团脉冲
│   ├── speaking → 嘴部动画 + 光粒子
│   ├── excited  → 粒子爆发 + 颜色增强
│   └── sleeping → 暗化 + 缓慢呼吸
└── 行为视觉修正完全生效

MVP 方案（预设组件库）：
├── 头部组件 × N（由 texture 决定风格）
├── 身体组件 × N（由 temperament 决定形态）
├── 特征组件 × N（眼睛、纹路、光环等）
└── 排列组合：头部 × 身体 × 特征 × 颜色方案

V2 方案（AI 生图）：
├── 构建 Prompt（见下方 3.3）
├── 调用 Stable Diffusion / DALL-E
├── 生成结果缓存（同一 seed + stage 可复现）
└── 动效层独立（骨骼绑定 or Live2D）
```

### 3.3 Prompt 构建框架（成形阶段 V2）

```
[产品风格框架] + [用户选择] + [用户行为数据] + [随机种子] + [阶段约束] + [质量词]

示例 Prompt：
"A cute glowing creature, blue and soft,
 translucent jellyfish-like body,
 pixar style, 2D illustration,
 adult stage, floating gently,
 high quality, detailed"

各部分来源：
├── 产品风格框架 → 固定前缀，保证风格统一
├── 用户选择     → texture + temperament → 风格描述词
├── 用户行为数据 → behaviorVisualEffect → 形态修饰词
├── 随机种子     → seed → 确定性随机，同一用户永远相同
├── 阶段约束     → 当前 stage → "egg"/"juvenile"/"adult"
└── 质量词       → 固定后缀
```

### 3.4 行为→视觉映射表

| 用户行为特征 | 视觉影响方向 | 实现方式 |
|-------------|-------------|---------|
| 经常深夜使用 | 偏暗色调、安静气质 | brightnessShift -= 0.1 |
| 喜欢高效对话 | 形象利落、简洁线条 | roundness -= 0.2, organicness -= 0.1 |
| 喜欢闲聊 | 形象圆润、柔和质感 | roundness += 0.2, organicness += 0.1 |
| 高频使用 | 细节更丰富、更精致 | detailLevel += 0.3 |
| 偏好理性话题 | 几何感更强 | organicness -= 0.2 |
| 偏好感性话题 | 有机形态更多 | organicness += 0.2 |

---

## 四、注册流程改造

### 4.1 新增 Onboarding 组件

```
流程：
┌──────────────────────────────────────────────┐
│  🥚 欢迎来到 Buddy                           │
│                                              │
│  你的 Buddy 正在等待诞生...                   │
│  让我们为它选择一些初始特质                   │
│                                              │
│  Step 1: 选择主色调                          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐       │
│  │ 🔵 │ │ 🟣 │ │ 🟢 │ │ 🟠 │ │ 🔴 │       │
│  └────┘ └────┘ └────┘ └────┘ └────┘       │
│                                              │
│  Step 2: 选择质感                            │
│  [柔软] [通透] [锋利] [温润]                 │
│                                              │
│  Step 3: 选择气质                            │
│  [温暖] [冷静] [活泼] [神秘]                 │
│                                              │
│  [开启旅程 →]                                │
└──────────────────────────────────────────────┘
```

### 4.2 后端接收

```typescript
// PetManager 新增方法
registerVisualSeed(seed: VisualSeed): void {
  this.db.prepare(`
    INSERT INTO pet_visual (pet_id, primary_color, secondary_color, texture, temperament, seed, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'egg', ?)
  `).run(this.petId, seed.primaryColor, seed.secondaryColor, seed.texture, seed.temperament, seed.seed, Date.now());
}
```

---

## 五、实现步骤

### Step 1：数据层扩展

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 1.1 | 新增 VisualSeed / VisualIdentity 类型 | `src/pet/types.ts` | 颜色、质感、气质、种子 |
| 1.2 | PetData 新增 visualSeed + formProgress | `src/pet/types.ts` | 扩展主类型 |
| 1.3 | SQLite 新增 pet_visual 表 | `src/pet/manager.ts` | initTables 扩展 |
| 1.4 | 新增 registerVisualSeed() | `src/pet/manager.ts` | 注册时调用 |
| 1.5 | 新增 getVisualIdentity() | `src/pet/manager.ts` | 查询视觉数据 |
| 1.6 | 新增 calcBehaviorVisualEffect() | `src/pet/types.ts` | 行为→视觉映射 |
| 1.7 | formProgress 随 trackFeature 增长 | `src/pet/manager.ts` | 每次使用 +0.5~2 |

### Step 2：渲染层重写

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 2.1 | 重写 SpriteRenderer → Canvas 渲染 | `frontend/src/components/SpriteRenderer.tsx` | 核心改造 |
| 2.2 | 实现蛋阶段渲染器 | SpriteRenderer 内 | 呼吸光团 |
| 2.3 | 实现孵化阶段渲染器 | SpriteRenderer 内 | 轮廓浮现 |
| 2.4 | 实现成长阶段渲染器 | SpriteRenderer 内 | 细节渐显 |
| 2.5 | 实现成形阶段渲染器 | SpriteRenderer 内 | 预设组件库 |
| 2.6 | 行为视觉修正集成 | SpriteRenderer 内 | 色调/形态/粒子 |
| 2.7 | 保留 emoji fallback | SpriteRenderer 内 | WebGL 不可用时降级 |

### Step 3：注册流程

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 3.1 | 新增 Onboarding 组件 | `frontend/src/components/Onboarding.tsx` | 三步选择 |
| 3.2 | App.tsx 集成 Onboarding | `frontend/src/App.tsx` | 首次进入展示 |
| 3.3 | 后端接收 seed 数据 | `src/ws/server.ts` | WebSocket 事件处理 |

### Step 4：前端类型对齐

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 4.1 | BuddyState 新增 visualSeed + formProgress | `frontend/src/types/buddy.ts` | 类型扩展 |
| 4.2 | useWebSocket 解析视觉数据 | `frontend/src/hooks/useWebSocket.ts` | 事件解析 |

### 排期总览（4 周 MVP）

```
Week 1          Week 2          Week 3          Week 4
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│ 数据层     │  │ 蛋阶段渲染 │  │ 孵化+成长  │  │ 成形+注册  │
│ + 类型对齐  │  │ + 行为映射 │  │ 渲染器     │  │ + 降级     │
│           │  │           │  │           │  │ + 联调     │
└───────────┘  └───────────┘  └───────────┘  └───────────┘
  1.1-1.7        2.1-2.2        2.3-2.4        2.5-2.7
  4.1-4.2        2.6            2.6            3.1-3.3
                                                  验收
```

#### Sprint 1（Week 1）：数据层 + 类型对齐

| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 1.1 VisualSeed / VisualIdentity 类型定义 | `types.ts` 新增类型 |
| D2 | 1.2 PetData 扩展 + 1.3 SQLite pet_visual 表 | DB schema 变更 |
| D3 | 1.4 registerVisualSeed + 1.5 getVisualIdentity + 1.7 formProgress 增长 | `manager.ts` 新方法 |
| D4 | 1.6 calcBehaviorVisualEffect + 4.1 前端类型扩展 | 行为映射逻辑 + 前端类型 |
| D5 | 4.2 useWebSocket 解析 + 单元测试 | 数据层端到端可跑通 |

**里程碑：** 调用 `pet.registerVisualSeed()` → 查询 `pet.getVisualIdentity()` → formProgress 随使用增长 → 阶段自动推进。数据流全通。

#### Sprint 2（Week 2）：蛋阶段渲染器 + 行为映射

| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 2.1 SpriteRenderer 架构重写 | PIXI.Graphics 替代 PIXI.Text，渲染管线骨架 |
| D2 | 2.2 蛋阶段：中心光团 + 渐变 | 呼吸光团可见 |
| D3 | 2.2 蛋阶段：呼吸动画 + 外层光晕 | 动画流畅 |
| D4 | 2.2 蛋阶段：微粒系统 + temperament 节奏差异 | 4 种气质视觉可区分 |
| D5 | 2.6 行为视觉修正集成（brightnessShift 等） | 深夜使用→色调偏暗可见 |

**里程碑：** 用户选择颜色 → 蛋阶段光团用该颜色渲染 → 不同气质呼吸节奏不同 → 行为影响可见。**这一阶段结束就能 demo。**

#### Sprint 3（Week 3）：孵化 + 成长渲染器

| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 2.3 孵化阶段：光团基础上叠加轮廓 | 轮廓从光团中浮现 |
| D2 | 2.3 孵化阶段：seed 决定轮廓形状 + texture 控制线粗细 | 轮廓个性化 |
| D3 | 2.4 成长阶段：轮廓清晰化 + 眼睛出现 | formProgress 阶段渐进 |
| D4 | 2.4 成长阶段：纹路 + 颜色渐变丰富 + 表情 | 细节层层叠加 |
| D5 | 2.6 行为修正全量接入 + 打磨 | 圆润度/有机感/粒子活跃度生效 |

**里程碑：** 从蛋到成长全流程视觉渐进，formProgress 增长 → 视觉变化实时可见。

#### Sprint 4（Week 4）：成形 + 注册 + 收尾

| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 2.5 成形阶段：SVG 组件库（头部×5 + 身体×5 + 眼睛×4）| 100 种组合 |
| D2 | 2.5 成形阶段：LLM 组装 + 缓存 + 状态动画 | 成形形象可渲染 |
| D3 | 2.7 emoji fallback + 三级降级逻辑 | 极端情况有兜底 |
| D4 | 3.1 Onboarding 组件 + 3.2 App.tsx 集成 + 3.3 后端接收 | 注册流程可走通 |
| D5 | 全流程联调 + 验收标准逐项检查 | MVP 交付 |

**里程碑：** 新用户注册 → Onboarding 选颜色/质感/气质 → 蛋光团 → 使用成长 → 孵化 → 成长 → 成形 SVG。全流程可体验。

#### 后续里程碑

| 时间 | 里程碑 | 内容 |
|------|--------|------|
| Week 5-6 | 打磨期 | 动画调优、性能优化、边界 case 处理、移动端适配 |
| V2（Month 3） | DALL-E 3 接入 | 替换 SVG 组装为 AI 生图，保留 SVG 降级 |
| V3（Month 6） | 微调系统 | 成形后微调 UI + Live2D 动效探索 |
| V4（远期） | SD 自部署 | Stable Diffusion 自部署，成本完全可控 |

---

## 六、技术选型

### 6.1 LLM ≠ 图像生成 — 管线分离

项目已接入文本 LLM（GPT-4 / DeepSeek via `@ai-sdk/openai`），但**文本 LLM 不能生成图像**。图像生成是独立管线：

```
文本 LLM（已有）                      图像生成（需选型）
┌──────────────────┐                ┌──────────────────────┐
│ GPT-4 / DeepSeek │                │ DALL-E 3（OpenAI）   │
│ 对话 + 推理       │                │ Stable Diffusion     │
│ 工具调用          │                │ LLM 生成 SVG 代码 ★  │
│ Prompt 构建       │                │ 纯算法程序化生成      │
└──────────────────┘                └──────────────────────┘
                                          ↑ 不同 API、不同能力
```

### 6.2 图像生成方案对比

#### 方案 A：DALL-E 3 API

```
seed + 行为数据 → 构建 Prompt → 调 DALL-E 3 → 缓存图片 → 前端渲染
```

| 维度 | 评价 |
|------|------|
| 效果质量 | ⭐⭐⭐⭐⭐ 专业级 |
| 实现成本 | ⭐⭐⭐⭐ 项目已有 OpenAI 依赖 |
| 运行成本 | ~$0.04/张，仅成形时生成一次 |
| 确定性 | ❌ 同一 prompt 不能完全复现同一图 |
| 延迟 | 3-5 秒/张 |

#### 方案 B：LLM 生成 SVG 代码 ★ 推荐 MVP

```
seed + 行为数据 → Prompt → LLM 输出 SVG 组件选择 → 组装 SVG → 缓存 → 前端渲染
```

**核心思路：不是让 LLM 从零画，而是让它"组装"。**

```typescript
// 预制 SVG 组件库（20-30 个片段）
interface SVGComponent {
  id: string;
  category: 'head' | 'body' | 'eyes' | 'pattern' | 'aura';
  svg: string;           // SVG 片段
  style: 'soft' | 'transparent' | 'sharp' | 'warm';
  temperament: 'warm' | 'calm' | 'lively' | 'mysterious';
}

// LLM 的工作：根据 seed 选择组件 + 组装 + 调色
// Prompt："从组件库中选择头部、身体、眼睛各一个，组装成完整 SVG，用 #58a6ff 作为主色"
```

| 维度 | 评价 |
|------|------|
| 效果质量 | ⭐⭐⭐ 够用，有风格感 |
| 实现成本 | ⭐⭐⭐⭐⭐ 用现有 LLM，零额外依赖 |
| 运行成本 | 极低（一次 LLM 调用，几百 token） |
| 确定性 | ✅ 可通过 temperature=0 + seed 实现复现 |
| 延迟 | 1-2 秒 |

#### 方案 C：纯算法程序化生成

```
seed → 确定性算法 → 程序化绘制 Canvas/SVG
```

| 维度 | 评价 |
|------|------|
| 效果质量 | ⭐⭐ "算法感"明显，表现力有限 |
| 实现成本 | ⭐⭐ 需要大量图形算法代码 |
| 运行成本 | 零 |
| 确定性 | ✅ 完全确定性 |
| 延迟 | 毫秒级 |

### 6.3 阶段式演进策略 ★ 最终方案

```
MVP（现在 → 第1个月）          V2（第3个月）              V3（远期）
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│ 蛋/孵化/成长阶段    │    │                    │    │                    │
│ → 纯 Canvas 程序化  │    │ 成形阶段            │    │ Stable Diffusion   │
│   渲染（方案 C）    │    │ → DALL-E 3 替换    │    │ 自部署             │
│   光团/轮廓/渐变    │    │   SVG 组装         │    │ 成本可控           │
│   不需要 AI         │    │   （方案 A）       │    │ 效果最佳           │
│                    │    │                    │    │                    │
│ 成形阶段            │    │ SVG 组装降级保留    │    │ DALL-E 3 降级保留  │
│ → LLM + SVG 组件   │    │ API 额度用完时     │    │                    │
│   组装（方案 B）    │    │ 自动 fallback      │    │                    │
│   生成一次并缓存    │    │                    │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
  成本 ≈ ¥0                成本 ≈ $0.04/用户           成本 ≈ 自控
```

**选型理由：**

1. 蛋/孵化/成长阶段：光团、轮廓、渐变这些效果用 Canvas 算法完全够用，不需要 AI
2. 成形阶段才是需要"生成独特形象"的环节，LLM 组装 SVG 是成本最低的方案
3. 缓存机制保证每个用户只生成一次，后续直接加载
4. 三层降级保证任何情况下都有东西显示

### 6.4 渲染引擎选型

| 方案 | 优势 | 劣势 | 阶段 |
|------|------|------|------|
| PIXI.js Graphics | 已有依赖、2D 图形 API | 本质还是 Canvas | ✅ MVP |
| Canvas 2D API | 无额外依赖、直接控制 | 需要手写更多代码 | ✅ MVP 备选 |
| WebGL/Shader | 性能好、效果炫 | 复杂、调试难 | V2 |
| Live2D | 专业 2D 动画 | 商业授权、学习成本 | 远期 |

**MVP 选择：保留 PIXI.js**，从 `PIXI.Text`(emoji) 迁移到 `PIXI.Graphics`(程序化图形)，渐进式改造。

---

## 七、缓存与降级策略（新增）

### 7.1 缓存策略

视觉形象是"一次生成，长期使用"的资源：

```
触发时机                    缓存行为
─────────────────────────────────────────────────
用户注册（蛋阶段）           Canvas 程序化渲染，无需缓存
阶段升级（孵化→成长）        Canvas 程序化渲染，无需缓存
阶段升级（成长→成形）        调用 LLM 生成 SVG → 缓存到 pet_visual
用户微调                    重新生成 → 覆盖缓存
```

```typescript
// pet_visual 表新增字段
ALTER TABLE pet_visual ADD COLUMN svg_cache TEXT;       // SVG 代码缓存
ALTER TABLE pet_visual ADD COLUMN svg_generated_at INTEGER; // 生成时间
ALTER TABLE pet_visual ADD COLUMN image_url TEXT;       // V2: DALL-E 图片 URL
```

**缓存生命周期：**
- 同一用户 + 同一阶段 → 只生成一次
- 前端直接加载缓存的 SVG，不反复请求 LLM
- 只有阶段升级或用户微调时才重新生成

### 7.2 三级降级策略

```
正常流程：LLM 生成 SVG → 渲染
    │
    │ 失败 ↓
降级 1：预设默认 SVG（每个 texture × temperament 组合预制一个）
    │
    │ 不可用 ↓
降级 2：Canvas 程序化光团（蛋阶段效果，永远可用）
    │
    │ 极端情况 ↓
降级 3：emoji 渲染（保留现有 SpriteRenderer 作为最终 fallback）
```

```typescript
function renderVisual(identity: VisualIdentity, fallbackLevel: number): RenderResult {
  if (identity.stage === 'egg' || identity.stage === 'hatching') {
    // 蛋/孵化：Canvas 程序化，不需要 AI
    return renderEggOrHatching(identity);
  }

  if (identity.stage === 'formed' && identity.svgCache) {
    // 有缓存 → 直接用
    return renderSVG(identity.svgCache);
  }

  if (identity.stage === 'formed' && fallbackLevel === 0) {
    // 尝试 LLM 生成
    return await generateAndCacheSVG(identity);
  }

  // 降级
  if (fallbackLevel <= 1) return renderDefaultSVG(identity);
  if (fallbackLevel <= 2) return renderEggOrHatching(identity);
  return renderEmojiFallback(identity);
}
```

---

## 八、成形后微调机制（新增）

设计文档提到成形后允许用户微调。补充实现：

```typescript
/** 视觉微调（成形后可用，不可推翻重来） */
interface VisualAdjustment {
  /** 颜色微调 hex 值 */
  colorTweak?: string;
  /** 大小调整 0.8x - 1.2x */
  sizeModifier?: number;
  /** 细节增减 ±20% */
  detailBoost?: number;
}

// 微调约束
const ADJUSTMENT_LIMITS = {
  sizeModifier: { min: 0.8, max: 1.2 },
  detailBoost: { min: -20, max: 20 },
};

// 微调流程
function applyAdjustment(
  currentSVG: string,
  adjustment: VisualAdjustment
): string {
  // 1. 验证范围
  // 2. 对 SVG 应用调整（CSS filter / transform / 颜色替换）
  // 3. 更新缓存
  // 4. 不重新调用 LLM，仅在现有基础上修改
}
```

**微调 UI：**

```
┌──────────────────────────────────────┐
│  🎨 微调 Buddy 形象                  │
│                                      │
│  颜色  ──●──────── [微调偏蓝]        │
│  大小  ────●────── [1.1x]           │
│  细节  ──●──────── [+10%]           │
│                                      │
│  [预览] [重置] [保存]                │
│                                      │
│  ⚠️ 微调不可推翻重来                 │
└──────────────────────────────────────┘
```

---

## 九、与养成系统的协同

### 9.1 阶段对应关系

| 养成阶段 (pet) | 视觉阶段 (visual) | formProgress |
|----------------|-------------------|-------------|
| egg | 🥚 蛋 — 呼吸光团 | 0-15% |
| baby | 🐣 孵化 — 轮廓初现 | 15-40% |
| growing | 🦊 成长 — 细节渐显 | 40-70% |
| mature | 🐲 成形 — 预设组件 | 70-100% |
| complete | 🐲 成形 — 完整细节 | 100% |
| legendary | 🐲 成形 — 传说特效 | 100% + 特殊粒子 |

### 9.2 formProgress 增长公式

```
增长来源：
├── 首次发现新功能    → +3（每次）
├── 功能使用深度里程碑  → +1（每 10 次使用）
├── 连续使用天数      → +0.5/天
├── 亲密度增长        → 亲密/10（间接）
└── 上限 100

阶段阈值：
├── egg      → 0-15%
├── hatching → 15-40%
├── growing  → 40-70%
└── formed   → 70-100%
```

---

## 十、验收标准

### MVP 完成标准

```
1. 注册时用户选择颜色/质感/气质 → 后端存储
2. 蛋阶段显示呼吸光团（颜色来自用户选择）
3. 随使用 formProgress 增长 → 阶段自动推进
4. 孵化阶段：光团中出现模糊轮廓
5. 成长阶段：轮廓清晰 + 内部细节渐显
6. 成形阶段：基于 texture+temperament 的预设形象
7. 深夜使用 → 光团色调偏暗（行为影响可见）
8. 高频使用 → 细节更丰富（行为影响可见）
9. emoji fallback 可用（Canvas 不支持时）
```

### V2 目标（远期）

```
1. 接入 Stable Diffusion 生成独特形象
2. Prompt 框架自动构建（seed + behavior + stage）
3. 生成结果缓存（同一 seed 复现）
4. 成形后微调（颜色、细节）
5. Live2D 动效适配
```

---

*v1.1 — 2026-04-10*
*从 emoji 到能量凝聚，让每个 Buddy 独一无二。*
*新增：LLM vs 图像生成管线澄清、SVG 组件组装方案、三级降级策略、缓存机制、成形后微调。*
