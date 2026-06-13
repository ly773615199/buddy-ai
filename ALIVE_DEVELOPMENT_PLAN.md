# 灵伴"活感"增强开发计划

> 版本: v1.0  
> 日期: 2026-05-01  
> 状态: 规划阶段  
> 目标: 让灵伴从"定时骰子"进化为"有动机的自主生命"

---

## 0. 设计哲学

**核心转变**：

```
当前：定时器 → 随机骰子 → 执行动作 → 结束
目标：需求衰减 → 内在动机 → Utility 打分 → 行为链 → 情绪反馈 → 需求满足
```

**三条原则**：

1. **行为必须有动机** — 每个动作都能追溯到一个或多个"为什么"（需求/情绪/环境/人格）
2. **系统之间必须联动** — 感知→情绪→欲望→行为→反馈，形成闭环
3. **保留随机性的位置** — 不是消灭随机，而是让随机在"合理范围"内（chaos trait 控制随机幅度）

---

## 1. Phase 1: Utility AI 行为选择引擎（核心改造）

### 1.1 目标

替换 `src/behavior/idle.ts` 的加权随机选择，改为 Utility AI 打分系统。

### 1.2 架构设计

```
┌─────────────────────────────────────────────────┐
│                Utility AI Engine                 │
│                                                  │
│  候选行为池                                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │blink│ │yawn │ │wave │ │peek │ │think│ ...   │
│  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘      │
│     │       │       │       │       │           │
│     ▼       ▼       ▼       ▼       ▼           │
│  ┌──────────────────────────────────────┐       │
│  │         Scoring Function             │       │
│  │                                      │       │
│  │  score = needUrgency                 │       │
│  │        × moodAffinity                │       │
│  │        × personalityBias             │       │
│  │        × contextRelevance            │       │
│  │        × noveltyFactor               │       │
│  │        + noise(chaos)                │       │
│  └──────────────────────────────────────┘       │
│     │                                           │
│     ▼                                           │
│  argmax(scores) → 选最高分行为                    │
│  + 5% 概率"冲动选择"（chaos 高时概率上升）         │
└─────────────────────────────────────────────────┘
```

### 1.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/behavior/idle.ts` | **重写** | 核心改造：pickAction() 从加权随机改为 Utility 打分 |
| `src/behavior/utility-scorer.ts` | **新建** | 打分函数：每个行为的 5 维评分逻辑 |
| `src/behavior/action-chains.ts` | **新建** | 行为链定义（Phase 2 用，Phase 1 先留空） |
| `src/behavior/context-provider.ts` | **新建** | 上下文聚合：从各模块收集当前状态 |

### 1.4 打分函数详细设计

```typescript
// src/behavior/utility-scorer.ts

interface ScoringContext {
  // 需求（六欲）
  desires: DesireVector;
  // 情绪
  emotion: EmotionVector;
  mood: Mood;
  // 人格
  ocean: OceanPersonality;
  personalityStrength: number;
  // 环境
  hour: number;              // 当前小时
  idleMinutes: number;       // 空闲分钟数
  lastAction: IdleAction;    // 上一个动作
  lastActionAge: number;     // 距上个动作的秒数
  recentActions: IdleAction[]; // 最近 10 个动作（防重复）
  // 用户
  userPresent: boolean;      // 用户是否在看
  userLastInteraction: number; // 上次交互时间
  // 感知
  soundEvent?: SoundEventType; // 最近检测到的声音
  voiceEmotion?: VoiceEmotion; // 用户语音情绪
  ambientLight?: number;       // 环境光照
}

/** 单个行为的 Utility 打分 */
function scoreAction(action: IdleAction, ctx: ScoringContext): number {
  const scores = {
    needUrgency:      scoreNeed(action, ctx.desires),
    moodAffinity:     scoreMood(action, ctx.mood, ctx.emotion),
    personalityBias:  scorePersonality(action, ctx.ocean),
    contextRelevance: scoreContext(action, ctx),
    noveltyFactor:    scoreNovelty(action, ctx.recentActions),
  };

  // 加权求和
  const raw =
    scores.needUrgency      * 0.35  // 需求最重要
    + scores.moodAffinity   * 0.25  // 情绪次之
    + scores.personalityBias * 0.15 // 人格影响
    + scores.contextRelevance * 0.15 // 环境影响
    + scores.noveltyFactor  * 0.10; // 新鲜感

  // chaos 噪声：chaos 越高，随机性越大
  const chaos = ctx.ocean.neuroticism / 100; // 用 neuroticism 近似 chaos
  const noise = (Math.random() - 0.5) * chaos * 0.3;

  return Math.max(0, raw + noise);
}
```

### 1.5 各行为的打分逻辑

```typescript
function scoreNeed(action: IdleAction, desires: DesireVector): number {
  // 每个行为满足不同的需求
  const needMap: Record<IdleAction, (d: DesireVector) => number> = {
    blink:       () => 0.3,                                    // 基础生理，总是低分
    look_around: (d) => (d.curiosity * 0.6 + d.safety * 0.4) / 100,
    yawn:        (d) => d.rest / 100,                          // 累了就打哈欠
    stretch:     (d) => (d.rest * 0.4 + d.expression * 0.3) / 100,
    wave:        (d) => d.social / 100,                        // 孤独就挥手
    think:       (d) => (d.curiosity * 0.5 + d.expression * 0.3) / 100,
    sleep:       (d) => d.rest > 70 ? d.rest / 100 : 0,       // 极度疲劳才睡
    peek:        (d) => (d.social * 0.4 + d.hunger * 0.3 + d.curiosity * 0.3) / 100,
  };
  return needMap[action](desires);
}

function scoreMood(action: IdleAction, mood: Mood, emotion: EmotionVector): number {
  // 情绪亲和矩阵（复用现有 MOOD_ACTION_WEIGHTS，但归一化到 0-1）
  const affinity = MOOD_ACTION_WEIGHTS[mood][action] / 5;
  // 情绪强度修正：强情绪时行为更夸张
  const intensity = Math.max(...Object.values(emotion)) / 100;
  return affinity * (0.5 + intensity * 0.5);
}

function scoreContext(action: IdleAction, ctx: ScoringContext): number {
  let score = 0.5; // 基线

  // 时间因素
  if (ctx.hour >= 23 || ctx.hour < 6) {
    if (action === 'yawn' || action === 'sleep') score += 0.3;
    if (action === 'wave' || action === 'bounce') score -= 0.2;
  }

  // 空闲时间因素
  if (ctx.idleMinutes > 3) {
    if (action === 'yawn') score += 0.2;
    if (action === 'look_around') score += 0.15;
  }
  if (ctx.idleMinutes > 10) {
    if (action === 'sleep') score += 0.4;
  }

  // 用户在看 → 更活跃
  if (ctx.userPresent) {
    if (action === 'wave' || action === 'peek') score += 0.2;
    if (action === 'sleep') score -= 0.3;
  }

  // 刚检测到声音 → 好奇
  if (ctx.soundEvent && ctx.soundEvent !== 'silence') {
    if (action === 'look_around') score += 0.3;
    if (action === 'peek') score += 0.2;
  }

  // 用户语音兴奋 → 也兴奋
  if (ctx.voiceEmotion === 'excited' || ctx.voiceEmotion === 'happy') {
    if (action === 'wave') score += 0.2;
  }
  if (ctx.voiceEmotion === 'sad' || ctx.voiceEmotion === 'tired') {
    if (action === 'think') score += 0.15;
  }

  return clamp(score, 0, 1);
}

function scoreNovelty(action: IdleAction, recent: IdleAction[]): number {
  // 最近做过的动作降权（避免连续重复）
  const recentCount = recent.filter(a => a === action).length;
  return Math.max(0, 1 - recentCount * 0.3);
}
```

### 1.6 改造后的 IdleBehavior

```typescript
// src/behavior/idle.ts（改造后）

export class IdleBehavior {
  private scorer: UtilityScorer;
  private contextProvider: ContextProvider;
  private recentActions: IdleAction[] = []; // 最近 10 个动作

  private pickAction(): IdleAction | null {
    const ctx = this.contextProvider.getContext();
    const actions: IdleAction[] = ['blink', 'look_around', 'yawn', 'stretch', 'wave', 'think', 'sleep', 'peek'];

    // Utility 打分
    const scores = actions.map(a => ({
      action: a,
      score: this.scorer.score(a, ctx),
    }));

    // 按分数排序
    scores.sort((a, b) => b.score - a.score);

    // 95% 选最高分，5% 选第二高（保留"意外感"）
    const chaos = ctx.ocean.neuroticism / 100;
    const impulseChance = 0.05 + chaos * 0.15; // 神经质越高，冲动概率越大
    const chosen = Math.random() < impulseChance && scores.length > 1
      ? scores[1]
      : scores[0];

    // 记录（防重复）
    this.recentActions.push(chosen.action);
    if (this.recentActions.length > 10) this.recentActions.shift();

    return chosen.action;
  }
}
```

### 1.7 单元测试

```typescript
// src/behavior/utility-scorer.test.ts

describe('UtilityScorer', () => {
  test('高 rest 时 yawn 分数最高', () => {
    const ctx = mockContext({ rest: 85, curiosity: 20, social: 20 });
    const scores = scoreAllActions(ctx);
    expect(argmax(scores)).toBe('yawn');
  });

  test('高 social + 用户在看时 wave 分数上升', () => {
    const ctx = mockContext({ social: 80, userPresent: true });
    const scores = scoreAllActions(ctx);
    expect(scores.wave).toBeGreaterThan(0.6);
  });

  test('深夜时 sleep 分数上升', () => {
    const ctx = mockContext({ hour: 2, rest: 60 });
    const scores = scoreAllActions(ctx);
    expect(scores.sleep).toBeGreaterThan(0.5);
  });

  test('连续重复同一动作会降权', () => {
    const ctx = mockContext({ recentActions: ['yawn', 'yawn', 'yawn'] });
    const scores = scoreAllActions(ctx);
    expect(scores.yawn).toBeLessThan(0.3);
  });

  test('高 neuroticism 时噪声更大（更多意外行为）', () => {
    const ctxLow = mockContext({ neuroticism: 20 });
    const ctxHigh = mockContext({ neuroticism: 90 });
    // 多次运行，高 neuroticism 的方差应该更大
    const variancesLow = runMultipleTimes(ctxLow, 100);
    const variancesHigh = runMultipleTimes(ctxHigh, 100);
    expect(variancesHigh).toBeGreaterThan(variancesLow);
  });
});
```

### 1.8 工作量估算

| 子任务 | 工时 |
|--------|------|
| utility-scorer.ts 打分函数 | 1天 |
| context-provider.ts 上下文聚合 | 0.5天 |
| idle.ts 改造接入 | 0.5天 |
| 单元测试 | 0.5天 |
| 前端调试验证 | 0.5天 |
| **合计** | **3天** |

---

## 2. Phase 2: 需求衰减 + 行为链

### 2.1 需求自然衰减

**问题**：当前 `computeDesires()` 只从上下文实时计算，没有时间维度的"生理驱动力"。

**改造**：在 `buddy-clock.ts` 的心跳(5分钟)中加入需求衰减。

```typescript
// src/desire/decay.ts（新建）

interface DesireDecayConfig {
  /** 每次 tick 各需求增长量 */
  growthPerTick: DesireVector;
  /** 交互后需求降低量 */
  reliefOnInteraction: Partial<DesireVector>;
  /** 完成任务后需求降低量 */
  reliefOnTaskComplete: Partial<DesireVector>;
}

const DEFAULT_DECAY: DesireDecayConfig = {
  growthPerTick: {
    hunger:     2,   // 每 5 分钟 +2 → 约 4 小时满
    curiosity:  1.5, // 每 5 分钟 +1.5 → 约 5.5 小时满
    social:     2.5, // 每 5 分钟 +2.5 → 约 3.3 小时满
    safety:     0.5, // 安全感增长慢
    expression: 1,   // 表达欲中等
    rest:       3,   // 每 5 分钟 +3 → 约 2.8 小时满
  },
  reliefOnInteraction: {
    social: -30,     // 聊天大幅降低社交欲
    hunger: -10,     // 聊天略微降低饥饿感
    curiosity: -15,  // 新知识降低求知欲
  },
  reliefOnTaskComplete: {
    expression: -40, // 完成任务大幅满足表达欲
    curiosity: -20,
    hunger: 5,       // 但做任务消耗精力
    rest: 10,        // 做任务增加疲劳
  },
};
```

**集成点**：`buddy-clock.ts` 的 `onHeartbeat` 回调中调用衰减。

### 2.2 行为链

**问题**：当前每个动作都是独立的，没有前后关联。

**设计**：定义行为之间的转移概率。

```typescript
// src/behavior/action-chains.ts（新建）

interface ActionChain {
  trigger: IdleAction;
  /** 条件满足时的后续动作 */
  followUp: {
    action: IdleAction;
    condition: (ctx: ScoringContext) => boolean;
    delay: number;    // ms
    probability: number; // 0-1
  }[];
}

const ACTION_CHAINS: ActionChain[] = [
  {
    trigger: 'yawn',
    followUp: [
      {
        action: 'stretch',
        condition: (ctx) => ctx.desires.rest > 60,
        delay: 2000,
        probability: 0.6,
      },
      {
        action: 'sleep',
        condition: (ctx) => ctx.desires.rest > 85 && !ctx.userPresent,
        delay: 5000,
        probability: 0.4,
      },
    ],
  },
  {
    trigger: 'look_around',
    followUp: [
      {
        action: 'peek',
        condition: (ctx) => ctx.soundEvent != null && ctx.soundEvent !== 'silence',
        delay: 1000,
        probability: 0.5,
      },
      {
        action: 'think',
        condition: (ctx) => ctx.desires.curiosity > 60,
        delay: 3000,
        probability: 0.3,
      },
    ],
  },
  {
    trigger: 'wave',
    followUp: [
      {
        action: 'peek',
        condition: (ctx) => ctx.userPresent,
        delay: 1500,
        probability: 0.4,
      },
    ],
  },
  {
    trigger: 'think',
    followUp: [
      {
        action: 'look_around',
        condition: (ctx) => ctx.desires.curiosity > 50,
        delay: 4000,
        probability: 0.3,
      },
    ],
  },
];
```

### 2.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/desire/decay.ts` | **新建** | 需求衰减配置 + tick 逻辑 |
| `src/behavior/action-chains.ts` | **新建** | 行为链定义 + 转移逻辑 |
| `src/behavior/idle.ts` | **修改** | 集成行为链：动作执行后检查 followUp |
| `src/core/buddy-clock.ts` | **修改** | 心跳中调用需求衰减 |

### 2.4 工作量估算

| 子任务 | 工时 |
|--------|------|
| desire/decay.ts 需求衰减 | 1天 |
| action-chains.ts 行为链 | 1.5天 |
| idle.ts 集成 | 0.5天 |
| buddy-clock.ts 集成 | 0.5天 |
| 测试 | 0.5天 |
| **合计** | **4天** |

---

## 3. Phase 3: 微动作扩展

### 3.1 目标

让所有骨骼都有持续微动，不只是 root/tail/wing/ear。

### 3.2 当前骨骼动起来的情况

| 骨骼 | 当前状态 | 改造目标 |
|------|----------|----------|
| root | ✅ 呼吸+摇摆 | 保持 |
| spine | ❌ 静止 | 呼吸时微微前后倾 |
| chest | ❌ 静止 | 呼吸时胸腔扩张感 |
| neck | ❌ 静止 | 微微转动（注意力方向） |
| head | ❌ 静止 | 随呼吸微动 + 说话时点头 |
| brow_l/r | ✅ 表情系统驱动 | 保持 |
| eyelid_l/r | ✅ 眨眼 | 保持 |
| jaw | ✅ 表情驱动 | 保持 |
| lip_l/r | ✅ 表情驱动 | 保持 |
| ear_l/r | ✅ 情绪驱动 | 保持 |
| shoulder_l/r | ❌ 静止 | 呼吸起伏 + 叹气下沉 + 耸肩 |
| elbow_l/r | ❌ 静止 | 微微摆动（跟随肩膀） |
| hand_l/r | ❌ 静止 | 微微摆动 + 挥手时动 |
| hip_l/r | ❌ 静止 | 重心微移 |
| knee_l/r | ❌ 静止 | 微微屈伸（呼吸节奏） |
| foot_l/r | ❌ 静止 | 脚尖微踮（开心时） |
| tail | ✅ 摇摆 | 保持 |
| wing_l/r | ✅ 扇动 | 保持 |

### 3.3 实现方案

```typescript
// src/brain/cerebellum/motor-control.ts（扩展）

interface MicroMotionConfig {
  /** 呼吸联动骨骼 */
  breathLinked: Array<{
    bone: string;
    axis: 'x' | 'y' | 'z';
    amplitude: number;    // 振幅
    phaseOffset: number;  // 相位偏移（弧度）
  }>;

  /** 情绪联动骨骼 */
  emotionLinked: Array<{
    bone: string;
    axis: 'x' | 'y' | 'z';
    emotion: keyof EmotionVector;
    amplitude: number;
    direction: number; // 1 或 -1
  }>;

  /** 注意力联动（眼球→头→肩） */
  attentionLinked: Array<{
    bone: string;
    followDelay: number; // 延迟跟随（ms）
    amplitude: number;
  }>;
}

const MICRO_MOTION: MicroMotionConfig = {
  breathLinked: [
    { bone: 'spine',      axis: 'x', amplitude: 0.008, phaseOffset: 0 },
    { bone: 'chest',      axis: 'y', amplitude: 0.012, phaseOffset: 0.2 },
    { bone: 'shoulder_l', axis: 'y', amplitude: 0.006, phaseOffset: 0.3 },
    { bone: 'shoulder_r', axis: 'y', amplitude: 0.006, phaseOffset: 0.3 },
    { bone: 'head',       axis: 'y', amplitude: 0.004, phaseOffset: 0.5 },
    { bone: 'hand_l',     axis: 'z', amplitude: 0.003, phaseOffset: 0.8 },
    { bone: 'hand_r',     axis: 'z', amplitude: 0.003, phaseOffset: 0.8 },
    { bone: 'knee_l',     axis: 'x', amplitude: 0.002, phaseOffset: 0.1 },
    { bone: 'knee_r',     axis: 'x', amplitude: 0.002, phaseOffset: 0.1 },
  ],
  emotionLinked: [
    // 开心时脚尖微踮
    { bone: 'foot_l', axis: 'x', emotion: 'joy', amplitude: 0.02, direction: 1 },
    { bone: 'foot_r', axis: 'x', emotion: 'joy', amplitude: 0.02, direction: 1 },
    // 悲伤时肩膀下沉
    { bone: 'shoulder_l', axis: 'y', emotion: 'sadness', amplitude: -0.015, direction: -1 },
    { bone: 'shoulder_r', axis: 'y', emotion: 'sadness', amplitude: -0.015, direction: -1 },
    // 愤怒时握拳（手指收紧 → hand rotation）
    { bone: 'hand_l', axis: 'x', emotion: 'anger', amplitude: 0.1, direction: 1 },
    { bone: 'hand_r', axis: 'x', emotion: 'anger', amplitude: 0.1, direction: 1 },
    // 恐惧时身体微缩
    { bone: 'chest', axis: 'y', emotion: 'fear', amplitude: -0.01, direction: -1 },
    // 期待时身体前倾
    { bone: 'spine', axis: 'x', emotion: 'anticipation', amplitude: 0.01, direction: 1 },
  ],
  attentionLinked: [
    // 头跟随眼球，延迟 200ms
    { bone: 'head', followDelay: 200, amplitude: 0.3 },
    // 肩膀跟随头部，延迟 500ms
    { bone: 'shoulder_l', followDelay: 500, amplitude: 0.1 },
    { bone: 'shoulder_r', followDelay: 500, amplitude: 0.1 },
  ],
};
```

### 3.4 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/brain/cerebellum/motor-control.ts` | **扩展** | 加入微动作配置 + 驱动逻辑 |
| `frontend/src/renderer/skeleton/humanoid-skeleton.ts` | **扩展** | update() 中加入微动作计算 |
| `frontend/src/renderer/skeleton/facial-expression.ts` | **小改** | 叹气动作（肩膀下沉+呼气） |

### 3.5 工作量估算

| 子任务 | 工时 |
|--------|------|
| motor-control.ts 微动作配置 | 1天 |
| humanoid-skeleton.ts 呼吸联动 | 1天 |
| humanoid-skeleton.ts 情绪联动 | 1天 |
| 注意力跟随 | 0.5天 |
| 调试参数（振幅/相位/延迟） | 1天 |
| **合计** | **4.5天** |

---

## 4. Phase 4: 感知→情绪映射管线

### 4.1 目标

让已有的传感器数据真正影响灵伴的情绪状态。

### 4.2 当前传感器→情绪的断点

```
voice/emotion-voice.ts  → 检测到用户情绪 → ❌ 没有注入 EmotionEngine
sensors/environment.ts  → 检测到环境数据 → ❌ 没有注入
sound-events.ts         → 检测到声音事件 → ❌ 没有注入
vision/face-detect.ts   → 检测到人脸     → ❌ 没有注入
buddy-clock.ts          → 深夜/清晨     → ✅ 已有 late_night buff
```

### 4.3 设计

```typescript
// src/emotion/perception-bridge.ts（新建）

/**
 * 感知→情绪映射管线
 * 将各传感器数据转换为 EmotionBuff，注入 EmotionEngine
 */

interface PerceptionEvent {
  source: string;        // 'voice' | 'sound' | 'environment' | 'vision' | 'clock'
  type: string;          // 具体事件类型
  data: any;             // 事件数据
  timestamp: number;
}

/** 事件→Buff 映射表 */
const PERCEPTION_BUFF_MAP: Record<string, BuffTemplate> = {
  // 用户语音情绪
  'voice.excited':   { source: 'perception', values: { joy: 8, anticipation: 5 },     duration: 60_000,  decay: 0.96, stackable: false, priority: 3 },
  'voice.happy':     { source: 'perception', values: { joy: 5 },                      duration: 60_000,  decay: 0.96, stackable: false, priority: 2 },
  'voice.sad':       { source: 'perception', values: { sadness: 8, trust: 3 },        duration: 120_000, decay: 0.97, stackable: false, priority: 3 },
  'voice.angry':     { source: 'perception', values: { fear: 10, anger: 3 },          duration: 90_000,  decay: 0.95, stackable: false, priority: 4 },
  'voice.tired':     { source: 'perception', values: { sadness: 5 },                  duration: 120_000, decay: 0.98, stackable: false, priority: 2 },

  // 环境声音
  'sound.doorbell':  { source: 'perception', values: { surprise: 15, anticipation: 10 }, duration: 30_000, decay: 0.93, stackable: false, priority: 4 },
  'sound.alarm':     { source: 'perception', values: { fear: 20, surprise: 10 },       duration: 60_000,  decay: 0.95, stackable: false, priority: 5 },
  'sound.music':     { source: 'perception', values: { joy: 5, trust: 3 },             duration: 180_000, decay: 0.99, stackable: false, priority: 1 },
  'sound.silence':   { source: 'perception', values: { sadness: 2 },                   duration: 60_000,  decay: 0.98, stackable: false, priority: 1 },

  // 环境数据
  'env.dark':        { source: 'perception', values: { sadness: 3, fear: 2 },          duration: 300_000, decay: 0.99, stackable: false, priority: 1 },
  'env.bright':      { source: 'perception', values: { joy: 2 },                       duration: 300_000, decay: 0.99, stackable: false, priority: 1 },
  'env.noisy':       { source: 'perception', values: { fear: 3, anger: 2 },            duration: 120_000, decay: 0.97, stackable: false, priority: 2 },

  // 用户交互
  'user.praise':     { source: 'perception', values: { joy: 15, trust: 10 },           duration: 300_000, decay: 0.98, stackable: true, maxStacks: 3, priority: 3 },
  'user.correction': { source: 'perception', values: { fear: 10, anticipation: 5 },    duration: 180_000, decay: 0.97, stackable: true, maxStacks: 5, priority: 3 },
  'user.absent':     { source: 'perception', values: { sadness: 5 },                   duration: 600_000, decay: 0.995, stackable: false, priority: 1 },
};

export class PerceptionBridge {
  private emotionEngine: EmotionEngine;
  private recentEvents: PerceptionEvent[] = [];

  constructor(emotionEngine: EmotionEngine) {
    this.emotionEngine = emotionEngine;
  }

  /** 处理感知事件 */
  onPerception(event: PerceptionEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 50) this.recentEvents.shift();

    const buffKey = `${event.source}.${event.type}`;
    const template = PERCEPTION_BUFF_MAP[buffKey];
    if (template) {
      this.emotionEngine.addBuff(buffKey);
    }
  }

  /** 定期检查（每分钟）：综合感知状态生成情绪倾向 */
  tick(): void {
    // 用户长时间不在 → 孤独感
    const lastUserEvent = this.recentEvents
      .filter(e => e.source === 'user')
      .pop();
    if (lastUserEvent && Date.now() - lastUserEvent.timestamp > 30 * 60_000) {
      this.emotionEngine.addBuff('user.absent');
    }
  }
}
```

### 4.4 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/emotion/perception-bridge.ts` | **新建** | 感知→情绪映射管线 |
| `src/core/ws-handler.ts` | **修改** | WS 事件中转发感知事件到 bridge |
| `src/core/agent.ts` | **修改** | 初始化 PerceptionBridge，注入依赖 |
| `frontend/src/hooks/useWebSocket.ts` | **修改** | 语音情绪/声音事件 WS 推送 |

### 4.5 工作量估算

| 子任务 | 工时 |
|--------|------|
| perception-bridge.ts 映射表 | 1天 |
| ws-handler.ts 事件转发 | 0.5天 |
| 前端 WS 推送 | 0.5天 |
| 测试 | 0.5天 |
| **合计** | **2.5天** |

---

## 5. Phase 5: 内在叙事外化

### 5.1 目标

让灵伴的"想法"可见——不只是做动作，还有内心独白和好奇心表达。

### 5.2 设计

```typescript
// src/behavior/narrator.ts（新建）

interface NarrationEvent {
  type: 'thought' | 'curiosity' | 'memory' | 'realization' | 'mood_comment';
  content: string;
  urgency: number;     // 0-1
  visual: {
    expression: string;  // 面部表情
    particleBurst: boolean;
    action?: IdleAction; // 配套动作
  };
}

export class NarratorEngine {
  private innerThoughts: InnerThoughtsEngine;
  private cognitive: CognitiveEngine;

  /** 从内心独白生成叙述事件 */
  checkForNarration(ctx: ScoringContext): NarrationEvent | null {
    // 1. 内心独白检测到困惑
    const thoughts = this.innerThoughts.getPendingThoughts();
    if (thoughts.length > 0 && thoughts[0].urgency > 0.5) {
      return {
        type: 'thought',
        content: thoughts[0].content,
        urgency: thoughts[0].urgency,
        visual: {
          expression: 'thinking',
          particleBurst: false,
          action: 'think',
        },
      };
    }

    // 2. 好奇心问题
    const curiosities = this.cognitive.getPendingCuriosities();
    if (curiosities.length > 0 && Math.random() < 0.1) {
      return {
        type: 'curiosity',
        content: `好奇：${curiosities[0].question}`,
        urgency: 0.4,
        visual: {
          expression: 'curious',
          particleBurst: true,
          action: 'look_around',
        },
      };
    }

    // 3. 情绪自评
    if (ctx.mood !== 'calm' && Math.random() < 0.05) {
      return {
        type: 'mood_comment',
        content: this.generateMoodComment(ctx.mood),
        urgency: 0.3,
        visual: {
          expression: ctx.mood,
          particleBurst: false,
        },
      };
    }

    return null;
  }

  private generateMoodComment(mood: Mood): string {
    const comments: Record<Mood, string[]> = {
      happy: ['心情不错~', '感觉很好'],
      tired: ['有点累了...', '需要休息一下'],
      excited: ['好兴奋！', '感觉充满能量！'],
      thinking: ['让我想想...', '嗯，有意思'],
      confused: ['嗯？', '这个有点奇怪'],
      calm: ['...', '安静'],
      energetic: ['精力充沛！', '来吧！'],
      frustrated: ['有点烦...', '这个不太顺利'],
    };
    const pool = comments[mood] || ['...'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
```

### 5.3 前端展示

在聊天面板中用灰色小字显示内心独白，不作为正式消息：

```tsx
// 前端：内心独白气泡
{narration && (
  <div className="inner-thought" style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 12 }}>
    💭 {narration.content}
  </div>
)}
```

### 5.4 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/behavior/narrator.ts` | **新建** | 内在叙事引擎 |
| `src/behavior/idle.ts` | **修改** | 集成 narrator：行为选择前检查是否有叙事事件 |
| `src/core/ws-handler.ts` | **修改** | WS 推送 narration 事件 |
| `frontend/src/components/ChatPanel.tsx` | **修改** | 显示内心独白气泡 |
| `frontend/src/types/buddy.ts` | **修改** | 新增 narration 事件类型 |

### 5.5 工作量估算

| 子任务 | 工时 |
|--------|------|
| narrator.ts | 1天 |
| idle.ts 集成 | 0.5天 |
| WS 推送 | 0.5天 |
| 前端展示 | 0.5天 |
| 测试 | 0.5天 |
| **合计** | **3天** |

---

## 6. 总体时间线

```
Week 1:  Phase 1 (Utility AI) + Phase 2 (需求衰减 + 行为链)
         ──────────────────────────────────────
         Day 1-3: utility-scorer + context-provider + idle.ts 改造
         Day 4-5: desire/decay.ts + action-chains.ts
         Day 6-7: 集成 + 测试

Week 2:  Phase 3 (微动作) + Phase 4 (感知→情绪)
         ──────────────────────────────────────
         Day 1-4: motor-control 微动作 + humanoid-skeleton 扩展
         Day 5-6: perception-bridge + WS 事件转发
         Day 7:   测试 + 参数调优

Week 3:  Phase 5 (内在叙事) + 整体联调
         ──────────────────────────────────────
         Day 1-3: narrator.ts + 前端展示
         Day 4-5: 全链路联调
         Day 6-7: 参数调优 + 体验打磨
```

| Phase | 内容 | 工时 | 依赖 |
|-------|------|------|------|
| 1 | Utility AI 行为选择 | 3天 | 无 |
| 2 | 需求衰减 + 行为链 | 4天 | Phase 1 |
| 3 | 微动作扩展 | 4.5天 | 无（可并行） |
| 4 | 感知→情绪映射 | 2.5天 | 无（可并行） |
| 5 | 内在叙事外化 | 3天 | Phase 1 |
| **合计** | | **17天** | |

---

## 7. 验收标准

### Phase 1 验收
- [ ] 灵伴在高 rest 时更倾向于打哈欠/睡觉
- [ ] 灵伴在高 social + 用户在看时更倾向于挥手
- [ ] 灵伴在深夜时更倾向于犯困
- [ ] 灵伴不会连续 3 次做同一个动作
- [ ] 高 neuroticism 时行为更不可预测

### Phase 2 验收
- [ ] 长时间不交互 → 需求自然增长 → 行为变化
- [ ] 聊天后 social 需求显著下降
- [ ] 完成任务后 expression 需求下降
- [ ] 打哈欠后 60% 概率跟着伸懒腰
- [ ] 东张西望后检测到声音时 50% 概率偷看

### Phase 3 验收
- [ ] 呼吸时肩膀/胸腔/头部有微动
- [ ] 开心时脚尖微踮
- [ ] 悲伤时肩膀下沉
- [ ] 眼球转动后头部延迟跟随
- [ ] 所有微动幅度不夸张（< 0.02 单位）

### Phase 4 验收
- [ ] 用户语音兴奋时灵伴情绪上升
- [ ] 检测到门铃时灵伴惊讶
- [ ] 深夜环境光照暗时灵伴略有不安
- [ ] 用户长时间不互动时灵伴略有失落

### Phase 5 验收
- [ ] 检测到知识缺口时头顶冒出"?"气泡
- [ ] 好奇心问题偶尔外化为内心独白
- [ ] 情绪变化时偶尔自评（灰色小字）
- [ ] 内心独白不影响正常对话流程
