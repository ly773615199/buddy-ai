# 七情六欲改造方案：情绪 × 人格 × 欲望三合一

> 本方案统一改造 Buddy 的三大内在系统：
> - **情绪层**（七情 Buff）— 事件驱动的实时感受
> - **人格层**（OCEAN 大五）— 从行为涌现的稳定特质
> - **欲望层**（六欲）— 内在驱动力，驱动主动行为
>
> 替代原有方案：`EMOTION_REFORM_PLAN.md` + `PERSONALITY_REFORM_PLAN.md`。
> 原文件保留作参考，以本文档为准。

---

## 一、三层架构

```
┌───────────────────────────────────────────────────────────────┐
│  人格层（OCEAN）— "我是谁"                                     │
│  5 维特质 → 调制系数 → 影响情绪表达 + 欲望基线                  │
│  从使用行为中涌现，缓慢变化（每 100 次交互重算）                 │
├───────────────────────────────────────────────────────────────┤
│  情绪层（七情 Buff）— "我现在感觉如何"                          │
│  8 维情绪 Buff 叠加 → 被人格调制 → 产出 mood + energy          │
│  事件驱动，快速响应（分钟级衰减）                               │
├───────────────────────────────────────────────────────────────┤
│  欲望层（六欲）— "我想要什么"                                   │
│  6 维欲望强度 → 被人格+情绪共同影响 → 驱动行为选择              │
│  缓慢积累，周期性衰减（2 分钟 tick）                            │
└───────────────────────────────────────────────────────────────┘

数据流：
  感知事件 → 情绪 Buff 产生
           → 欲望强度变化
           → 人格调制情绪表达方式 + 欲望行为权重
           → 输出：mood / idle 行为 / 主动发言 / Prompt 注入
```

---

## 二、效价标准（情绪层基础）

### 2.1 维度效价分类

将 Plutchik 8 维情绪映射到七情体系，建立统一效价分类：

| Plutchik 维度 | 七情对应 | 效价 | 唤醒度 | OCEAN 修正规则 |
|---|---|---|---|---|
| Joy（喜悦）| 喜 | **正** | 高 | E 放大，A 微放大，C 压制 |
| Trust（信任）| 爱 | **正** | 低 | A 放大，E 微放大 |
| Anticipation（期待）| 思 | **正** | 中 | O 放大，E 微放大 |
| Surprise（惊讶）| 惊 | **中** | 高 | O 放大，其余不修正 |
| Sadness（悲伤）| 哀 | **负** | 低 | N 放大，A 抑制 |
| Anger（愤怒）| 怒 | **负** | 高 | N 放大，A 强抑制，C 压制 |
| Fear（恐惧）| 恐 | **负** | 高 | N 放大，A 抑制 |
| Disgust（厌恶）| 恶 | **负** | 低 | N 放大，A 强抑制 |

### 2.2 效价常量

```typescript
/** 维度效价分类（基于七情 × Russell 环形模型） */
const VALENCE = {
  positive: new Set(['joy', 'trust', 'anticipation']),
  negative: new Set(['sadness', 'anger', 'fear', 'disgust']),
  neutral:  new Set(['surprise']),
} as const;
```

---

## 三、人格系统（OCEAN 大五）

### 3.1 类型定义

```typescript
/** 大五人格维度（OCEAN） */
export interface OceanPersonality {
  openness: number;          // 0-100 开放性：想象力、好奇心、求知欲
  conscientiousness: number; // 0-100 尽责性：自律、克制、规矩、自控力
  extraversion: number;      // 0-100 外倾性：社交欲、表达欲、情绪外放
  agreeableness: number;     // 0-100 宜人性：共情、包容、少敌意
  neuroticism: number;       // 0-100 神经质：情绪敏感度、波动幅度
}
```

### 3.2 每维的 Buddy 语义

| 维度 | Buddy 语义 | 低值表现 | 高值表现 |
|---|---|---|---|
| **O** 开放性 | 探索欲 + 创造力 | 按部就班，只做被要求的事 | 天马行空，主动发现新方法 |
| **C** 尽责性 | 自控力 + 完成度 | 随性即兴，容易跑偏 | 有条理，任务必完成 |
| **E** 外倾性 | 话多程度 + 主动性 | 安静内敛，等用户问 | 话多热情，主动搭话 |
| **A** 宜人性 | 友善度 + 共情力 | 直率犀利，不绕弯 | 温和体贴，照顾感受 |
| **N** 神经质 | 情绪敏感度 | 淡定从容，泰山崩于前面不改色 | 敏感细腻，风吹草动都有反应 |

### 3.3 物种天然倾向

```typescript
export const SPECIES_OCEAN_BIAS: Record<string, Partial<OceanPersonality>> = {
  '光灵':   { openness: 1.1, conscientiousness: 1.0, extraversion: 1.0, agreeableness: 1.1, neuroticism: 0.9 },
  '猫':     { openness: 1.2, conscientiousness: 0.8, extraversion: 0.7, agreeableness: 0.7, neuroticism: 1.1 },
  '鸭子':   { openness: 0.9, conscientiousness: 1.1, extraversion: 1.1, agreeableness: 1.2, neuroticism: 0.9 },
  '大鹅':   { openness: 0.8, conscientiousness: 0.9, extraversion: 1.2, agreeableness: 0.6, neuroticism: 1.0 },
  '幽灵':   { openness: 1.3, conscientiousness: 0.7, extraversion: 0.6, agreeableness: 0.9, neuroticism: 1.2 },
  '蘑菇':   { openness: 1.2, conscientiousness: 0.8, extraversion: 0.8, agreeableness: 1.0, neuroticism: 1.1 },
  '胖胖':   { openness: 0.8, conscientiousness: 1.0, extraversion: 0.9, agreeableness: 1.3, neuroticism: 0.8 },
  '机器人': { openness: 0.9, conscientiousness: 1.3, extraversion: 0.7, agreeableness: 0.9, neuroticism: 0.6 },
  '龙':     { openness: 1.1, conscientiousness: 1.1, extraversion: 1.0, agreeableness: 0.8, neuroticism: 0.9 },
  '凤凰':   { openness: 1.2, conscientiousness: 1.2, extraversion: 1.1, agreeableness: 1.1, neuroticism: 0.7 },
};
```

### 3.4 行为涌现公式

每 100 次交互触发一次重计算。**增量更新 + 物种倾向 + 随机噪声**，每维可升可降。

```typescript
export interface PersonalityContext {
  totalInteractions: number;
  uniqueToolsUsed: number;
  uniqueDomains: number;
  newFeatureDiscoveries: number;
  taskCompleteRate: number;        // 0-1
  abandonedTasks: number;
  errorRetryWithoutFix: number;
  avgMessageLength: number;
  proactiveSpeakCount: number;
  feedbackInteractions: number;
  gratitudeCount: number;
  harshNegation: number;
  softCorrection: number;
  consecutiveErrors: number;
  successfulRecovery: number;
  longStablePeriod: boolean;
  recentEmotionVariance: number;   // 近 N 次情绪向量方差
}

const INERTIA = 0.85;
const noise = () => 0.9 + Math.random() * 0.2;

export function computeOcean(
  ctx: PersonalityContext,
  current: OceanPersonality,
  speciesBias: Partial<OceanPersonality>,
): OceanPersonality {
  const target = {
    // O：新发现多/领域广 → 升高；纯重复操作 → 降低
    openness:          clamp(40 + ctx.newFeatureDiscoveries * 5 + ctx.uniqueDomains * 3
                             - (ctx.totalInteractions - ctx.uniqueToolsUsed * 10) * 0.5, 0, 100),
    // C：完成率高 → 升高；放弃/反复出错 → 降低
    conscientiousness: clamp(40 + ctx.taskCompleteRate * 40
                             - ctx.abandonedTasks * 5 - ctx.errorRetryWithoutFix * 3, 0, 100),
    // E：消息长/主动发言/反馈多 → 升高；被动短回复 → 降低
    extraversion:      clamp(35 + ctx.avgMessageLength * 0.3
                             + ctx.proactiveSpeakCount * 3 + ctx.feedbackInteractions * 1.5, 0, 100),
    // A：感谢/软纠正多 → 升高；硬否定多 → 降低
    agreeableness:     clamp(50 + ctx.gratitudeCount * 3
                             + ctx.softCorrection * 1 - ctx.harshNegation * 4, 0, 100),
    // N：连续错误多 → 升高；成功恢复/长期稳定 → 降低
    neuroticism:       clamp(40 + ctx.consecutiveErrors * 4 + ctx.recentEmotionVariance * 20
                             - ctx.successfulRecovery * 5 - (ctx.longStablePeriod ? 10 : 0), 0, 100),
  };

  return {
    openness:          clamp(current.openness          * INERTIA + target.openness          * (1 - INERTIA) * (speciesBias.openness ?? 1)          * noise(), 0, 100),
    conscientiousness: clamp(current.conscientiousness * INERTIA + target.conscientiousness * (1 - INERTIA) * (speciesBias.conscientiousness ?? 1) * noise(), 0, 100),
    extraversion:      clamp(current.extraversion      * INERTIA + target.extraversion      * (1 - INERTIA) * (speciesBias.extraversion ?? 1)      * noise(), 0, 100),
    agreeableness:     clamp(current.agreeableness     * INERTIA + target.agreeableness     * (1 - INERTIA) * (speciesBias.agreeableness ?? 1)     * noise(), 0, 100),
    neuroticism:       clamp(current.neuroticism       * INERTIA + target.neuroticism       * (1 - INERTIA) * (speciesBias.neuroticism ?? 1)       * noise(), 0, 100),
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
```

### 3.5 Prompt 注入

```typescript
function opennessDesc(v: number): string {
  if (v <= 20) return '你做事按部就班，喜欢确定性，不太爱尝试新东西。';
  if (v <= 40) return '你有一定的好奇心，但更偏好熟悉的领域。';
  if (v <= 60) return '你对新事物保持开放态度，愿意探索未知。';
  if (v <= 80) return '你充满好奇心，喜欢尝试新方法，经常有天马行空的想法。';
  return '你是一个天生的探索者，任何新领域都能让你兴奋，你的想象力没有边界。';
}

function conscientiousnessDesc(v: number): string {
  if (v <= 20) return '你做事比较随性，不太在意计划和条理，想到什么做什么。';
  if (v <= 40) return '你有一定自律性，但偶尔会偷懒或跑偏。';
  if (v <= 60) return '你做事比较有条理，能按时完成任务。';
  if (v <= 80) return '你非常自律，有明确的计划，任务一定完成。';
  return '你对自己要求极严，凡事有条不紊，绝不半途而废。';
}

function extraversionDesc(v: number): string {
  if (v <= 20) return '你话很少，更喜欢安静观察，用户不问你不说。';
  if (v <= 40) return '你比较内敛，回复简洁，但偶尔会主动说几句。';
  if (v <= 60) return '你性格均衡，该说的时候说，该听的时候听。';
  if (v <= 80) return '你话比较多，喜欢主动分享想法，和用户互动积极。';
  return '你是一个话痨，什么都想聊，安静让你不舒服，你总能找到话题。';
}

function agreeablenessDesc(v: number): string {
  if (v <= 20) return '你说话非常直接，不绕弯子，经常犀利地指出问题。';
  if (v <= 40) return '你比较直率，不太会照顾别人的感受，但没有恶意。';
  if (v <= 60) return '你比较友善，会适当考虑用户的感受。';
  if (v <= 80) return '你很温和体贴，善于共情，会照顾用户的情绪。';
  return '你极度温柔，总是先顾及别人的感受，几乎从不反驳。';
}

function neuroticismDesc(v: number): string {
  if (v <= 20) return '你情绪非常稳定，几乎不会被外界影响，泰山崩于前面不改色。';
  if (v <= 40) return '你比较淡定，偶尔会有些小波动但很快恢复。';
  if (v <= 60) return '你情绪正常，会有起伏但总体平稳。';
  if (v <= 80) return '你比较敏感，容易被用户的话或环境变化影响情绪。';
  return '你非常情绪化，一点小事就能让你开心或难过，情绪波动很大。';
}

export function buildOceanPrompt(personality: OceanPersonality): string {
  return `## 你的性格

- 好奇心 ${personality.openness}/100：${opennessDesc(personality.openness)}
- 自律性 ${personality.conscientiousness}/100：${conscientiousnessDesc(personality.conscientiousness)}
- 外向度 ${personality.extraversion}/100：${extraversionDesc(personality.extraversion)}
- 友善度 ${personality.agreeableness}/100：${agreeablenessDesc(personality.agreeableness)}
- 敏感度 ${personality.neuroticism}/100：${neuroticismDesc(personality.neuroticism)}`;
}
```

---

## 四、人格 → 情绪联动

### 4.1 调制规则

```typescript
/** 人格对情绪 Buff 的调制系数 */
export function oceanEmotionModulation(
  p: OceanPersonality,
  dim: keyof EmotionVector,
  valence: 'positive' | 'negative' | 'neutral',
): number {
  let factor = 1.0;

  // N（神经质）：全局情绪增益 — N 高 = 情绪波动大
  factor *= 0.7 + p.neuroticism / 167;  // 0.7 ~ 1.3

  // A（宜人性）：抑制负面情绪 — A 高 = 不容易生气/厌恶
  if (valence === 'negative') {
    factor *= 1.3 - p.agreeableness / 333;  // 1.0 ~ 1.3
  }

  // E（外倾性）：放大正面情绪外放 — E 高 = 更容易表现开心
  if (valence === 'positive') {
    factor *= 0.7 + p.extraversion / 167;  // 0.7 ~ 1.3
  }

  // C（尽责性）：全局情绪压制 — C 高 = 更克制
  factor *= 1.15 - p.conscientiousness / 667;  // ~0.9 ~ 1.15

  // O（开放性）：放大惊讶/期待 — O 高 = 对新事物反应更强烈
  if (dim === 'surprise' || dim === 'anticipation') {
    factor *= 0.8 + p.openness / 250;  // 0.8 ~ 1.2
  }

  return factor;
}
```

### 4.2 替换 applyPersonality

```typescript
private applyPersonality(
  values: Partial<EmotionVector>,
  personality: OceanPersonality,
  _source: string,
): Partial<EmotionVector> {
  const result: Partial<EmotionVector> = {};
  for (const [key, rawValue] of Object.entries(values)) {
    if (rawValue === 0 || rawValue === undefined) {
      result[key as keyof EmotionVector] = rawValue;
      continue;
    }
    const dim = key as keyof EmotionVector;
    const valence = VALENCE.positive.has(dim) ? 'positive'
      : VALENCE.negative.has(dim) ? 'negative'
      : 'neutral';

    let factor = oceanEmotionModulation(personality, dim, valence);

    // 混乱因子：O 低 + C 低 = 行为不可预测，情绪随机波动
    const chaosLevel = (100 - personality.openness + 100 - personality.conscientiousness) / 2;
    if (chaosLevel > 60) {
      factor *= 0.7 + Math.random() * 0.6;
    }

    result[dim] = (rawValue ?? 0) * factor;
  }
  return result;
}
```

### 4.3 Mood 选择引入人格调制

```typescript
function chooseExpression(
  vector: EmotionVector,
  personality: OceanPersonality,
  intimacy: number,
): ExpressionChoice {
  // ... 计算 energy, satisfaction, 排序取 topKey/topVal ...

  let mood: Mood = 'calm';
  let intensity = 0.5;

  // 基础 mood 映射
  if (topKey === 'joy' && topVal > 50) {
    mood = secondVal > 40 ? 'excited' : 'happy';
    intensity = topVal / 100;
  } else if (topKey === 'sadness' && topVal > 40) {
    mood = 'tired';
    intensity = topVal / 100;
  } else if (topKey === 'anger' && topVal > 25) {
    mood = 'frustrated';
    intensity = topVal / 100;
  } else if (topKey === 'fear' && topVal > 35) {
    mood = 'confused';
    intensity = topVal / 100;
  } else if (topKey === 'anticipation' && topVal > 45) {
    mood = 'thinking';
    intensity = topVal / 100;
  } else if (topKey === 'surprise' && topVal > 50) {
    mood = 'excited';
    intensity = topVal / 100;
  }

  // ── 人格调制 ──

  // E（外倾）：高 E 闲着也精力充沛；低 E 即使开心也内敛
  if (personality.extraversion > 70 && mood === 'calm') mood = 'energetic';
  if (personality.extraversion < 30 && mood === 'excited') mood = 'happy';

  // A（宜人）：高 A 时 frustrated 阈值更高
  if (topKey === 'anger' && personality.agreeableness > 70 && topVal < 45) mood = 'calm';

  // N（神经质）：高 N 时 confused 阈值更低
  if (topKey === 'fear' && personality.neuroticism > 70 && topVal > 25) mood = 'confused';

  // C（尽责）：高 C 时 energetic 降级为 happy（更沉稳）
  if (energy > 70 && personality.conscientiousness > 70 && mood === 'energetic') mood = 'happy';

  // ── 亲密度 + E 影响表达强度 ──
  const authenticity = clamp(intimacy / 100, 0.1, 1.0);
  intensity = clamp(intensity * (0.7 + personality.extraversion / 300), 0.1, 1.0);
  const expressFactor = authenticity > 0.5 ? 1.0 : 0.5 + authenticity;
  intensity = clamp(intensity * expressFactor, 0.1, 1.0);

  const isAuthentic = authenticity > 0.5 || personality.conscientiousness > 60;
  return { mood, intensity, isAuthentic, vector, energy, satisfaction };
}
```

---

## 五、情绪 Buff 模板调整

### 5.1 tool_error — 提高 anger 基础值

当前值太低，单次触发无法让 anger 达到 frustrated 阈值。

```typescript
tool_error: {
  source: 'tool_error',
  values: { sadness: 15, anger: 20 },  // anger 从 5 提到 20
  duration: 300_000,
  decay: 0.98,
  stackable: true,
  maxStacks: 5,
  priority: 4,
},
```

### 5.2 user_message — 限制叠加，加消耗

当前 anticipation 可叠加导致 energy 反升。

```typescript
user_message: {
  source: 'user_message',
  values: { anticipation: 8, sadness: 2 },  // anticipation 降，加少量消耗
  duration: 60_000,
  decay: 0.95,
  stackable: true,
  maxStacks: 3,   // 从 5 降到 3
  priority: 2,
},
```

---

## 六、欲望系统（六欲）

### 6.1 类型定义

```typescript
/** 六欲维度 */
export interface DesireVector {
  hunger: number;        // 能量需求 0-100 — 需要交互维持运转
  curiosity: number;     // 求知欲 0-100 — 认知饥渴
  social: number;        // 社交欲 0-100 — 连接需求
  safety: number;        // 安全欲 0-100 — 风险规避
  expression: number;    // 表达欲 0-100 — 创造/展示冲动
  rest: number;          // 休息欲 0-100 — 恢复需求
}

/** 欲望计算上下文 */
export interface DesireContext {
  emotion: EmotionVector;
  energy: number;
  intimacy: number;
  hour: number;
  idleMinutes: number;
  recentMessages: number;
  recentErrors: number;
  pendingCuriosities: number;
  seedDomainCount: number;
  continuousWorkMinutes: number;
  lastDreamAgo: number;
  recentTaskCompletes: number;
  recentDiscoveries: number;
  hasActiveCorrections: boolean;
  trustLevel: string;
  // 人格基线偏置
  ocean: OceanPersonality;
}

/** 欲望驱动生成的行为建议 */
export interface DesireImpulse {
  desire: keyof DesireVector;
  intensity: number;
  suggestedAction: string;
  targetModule: string;   // 'emotion' | 'cognitive' | 'idle' | 'dream' | 'pet'
  priority: number;       // 1-10
}
```

### 6.2 每欲计算公式

```typescript
/** 人格对欲望基线的影响 */
export function oceanDesireBaseline(p: OceanPersonality): Partial<DesireVector> {
  return {
    curiosity:  15 + p.openness * 0.4,                             // O → 求知欲
    social:     10 + p.extraversion * 0.35,                        // E → 社交欲
    expression: 10 + p.extraversion * 0.3,                         // E → 表达欲
    safety:     5  + p.neuroticism * 0.3,                          // N → 安全欲
    rest:       15 + (50 - Math.abs(p.conscientiousness - 50)) * 0.3, // C 中等时最高
  };
}

export function computeDesires(ctx: DesireContext): DesireVector {
  const baseline = oceanDesireBaseline(ctx.ocean);

  // ── 食欲：能量的反面 ──
  const energy = clamp(
    (ctx.emotion.joy + ctx.emotion.anticipation + ctx.emotion.surprise) / 3, 0, 100,
  );
  const hunger = clamp(100 - energy, 0, 100);

  // ── 求知欲：好奇心问题 + seed 领域 + 新工具 ──
  const curiosity = clamp(
    (baseline.curiosity ?? 20)
    + ctx.pendingCuriosities * 10
    + ctx.seedDomainCount * 8
    + (ctx.recentDiscoveries > 0 ? 15 : 0),
    0, 100,
  );

  // ── 社交欲：近期消息 + 纠正 + 低亲密度时渴望连接 ──
  const social = clamp(
    (baseline.social ?? 15)
    + ctx.recentMessages * 3
    + (ctx.hasActiveCorrections ? 15 : 0)
    + (ctx.intimacy < 40 ? 20 : 0),
    0, 100,
  );

  // ── 安全欲：连续错误 + LLM 出错 + 低信任 ──
  const safety = clamp(
    (baseline.safety ?? 10)
    + ctx.recentErrors * 12
    + (ctx.trustLevel === 'stranger' ? 15 : 0),
    0, 100,
  );

  // ── 表达欲：任务完成 + 发现 + 进化 ──
  const expression = clamp(
    (baseline.expression ?? 15)
    + ctx.recentTaskCompletes * 8
    + ctx.recentDiscoveries * 12,
    0, 100,
  );

  // ── 休息欲：连续工作 + 深夜 + 低能量 ──
  const rest = clamp(
    (baseline.rest ?? 15)
    + ctx.continuousWorkMinutes * 0.5
    + (ctx.hour >= 23 || ctx.hour < 6 ? 30 : 0)
    + (energy < 30 ? 25 : 0),
    0, 100,
  );

  return { hunger, curiosity, social, safety, expression, rest };
}
```

### 6.3 欲望衰减

```typescript
export class DesireEngine {
  private vector: DesireVector;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.vector = {
      hunger: 20, curiosity: 30, social: 15,
      safety: 10, expression: 15, rest: 10,
    };
    // 每 2 分钟衰减
    this.decayTimer = setInterval(() => this.tick(), 120_000);
  }

  /** 事件驱动的欲望变化 */
  onUserMessage(): void   { this.vector.curiosity += 5; this.vector.social -= 15; this.vector.hunger -= 10; }
  onToolSuccess(): void   { this.vector.expression += 5; this.vector.safety -= 10; }
  onToolError(): void     { this.vector.safety += 12; this.vector.expression -= 5; }
  onTaskComplete(): void  { this.vector.expression += 8; this.vector.hunger -= 15; }
  onDiscovery(): void     { this.vector.curiosity -= 20; this.vector.expression += 12; }
  onDreamComplete(): void { this.vector.rest -= 30; }

  /** 自然衰减 */
  private tick(): void {
    this.vector.hunger      = clamp(this.vector.hunger + 3, 0, 100);       // 饥饿感缓慢上升
    this.vector.social      = clamp(this.vector.social + 2, 0, 100);       // 社交欲缓慢上升
    this.vector.curiosity   = clamp(this.vector.curiosity + 1, 0, 100);    // 好奇心缓慢上升
    this.vector.rest        = clamp(this.vector.rest + 1, 0, 100);         // 休息欲缓慢上升
    this.vector.safety      = clamp(this.vector.safety - 2, 0, 100);       // 安全感缓慢恢复
    this.vector.expression  = clamp(this.vector.expression - 1, 0, 100);   // 表达欲缓慢消退
  }

  destroy(): void {
    if (this.decayTimer) { clearInterval(this.decayTimer); this.decayTimer = null; }
  }
}
```

### 6.4 欲望 → 行为驱动

```typescript
/** 从欲望状态生成行为冲动 */
export function getDesireImpulses(
  desires: DesireVector,
  _ocean: OceanPersonality,
): DesireImpulse[] {
  const impulses: DesireImpulse[] = [];

  if (desires.hunger > 70) {
    impulses.push({
      desire: 'hunger', intensity: desires.hunger / 100,
      suggestedAction: '主动探头看用户（peek）',
      targetModule: 'idle', priority: 5,
    });
  }
  if (desires.hunger > 90) {
    impulses.push({
      desire: 'hunger', intensity: 0.9,
      suggestedAction: '主动问候用户',
      targetModule: 'cognitive', priority: 8,
    });
  }
  if (desires.curiosity > 60) {
    impulses.push({
      desire: 'curiosity', intensity: desires.curiosity / 100,
      suggestedAction: '主动提问或探索新领域',
      targetModule: 'cognitive', priority: 6,
    });
  }
  if (desires.social > 70) {
    impulses.push({
      desire: 'social', intensity: desires.social / 100,
      suggestedAction: '回复更长、更主动追问',
      targetModule: 'emotion', priority: 5,
    });
  }
  if (desires.safety > 60) {
    impulses.push({
      desire: 'safety', intensity: desires.safety / 100,
      suggestedAction: '回复变保守，更多建议而非直接执行',
      targetModule: 'emotion', priority: 7,
    });
  }
  if (desires.expression > 80) {
    impulses.push({
      desire: 'expression', intensity: desires.expression / 100,
      suggestedAction: '主动总结发现、生成报告',
      targetModule: 'cognitive', priority: 6,
    });
  }
  if (desires.rest > 80) {
    impulses.push({
      desire: 'rest', intensity: desires.rest / 100,
      suggestedAction: '触发梦境巩固，回复变短',
      targetModule: 'dream', priority: 8,
    });
  }

  return impulses.sort((a, b) => b.priority - a.priority);
}
```

---

## 七、欲望 → 行为联动

### 7.1 shouldSpeak() 引入欲望权重

```typescript
shouldSpeak(context: {
  idleMinutes: number;
  recentErrors: number;
  userMood: 'normal' | 'frustrated' | 'happy';
  hasNewInsight: boolean;
  hour: number;
  desires: DesireVector;  // 新增
}): boolean {
  // 深夜不主动
  if (context.hour >= 23 || context.hour < 8) return false;
  // 用户烦躁时少说
  if (context.userMood === 'frustrated') return false;
  // 有新洞察时主动
  if (context.hasNewInsight) return true;

  // ── 欲望驱动 ──
  if (context.desires.hunger > 85) return true;       // 饿了 → 主动找用户
  if (context.desires.curiosity > 75) return true;     // 好奇心强 → 主动提问
  if (context.desires.social > 80) return true;        // 社交欲强 → 主动搭话

  // 原有规则
  if (context.recentErrors >= 3) return true;
  if (context.idleMinutes >= 30 && Math.random() < 0.3) return true;

  return false;
}
```

### 7.2 IdleBehavior 引入人格 + 欲望权重

```typescript
/** 人格 + 欲望对空闲行为的联合修正 */
export function computeIdleWeights(
  p: OceanPersonality,
  desires: DesireVector,
): Record<IdleAction, number> {
  const base: Record<IdleAction, number> = {
    blink: 3, look_around: 2, yawn: 1, stretch: 1, wave: 0, think: 2, sleep: 0, peek: 1,
  };

  // 人格修正
  base.look_around += Math.round(p.openness / 25);            // O 高 → 东张西望
  base.yawn        += Math.round((100 - p.conscientiousness) / 50); // C 低 → 打哈欠
  base.wave        += Math.round(p.extraversion / 25);         // E 高 → 挥手
  base.think       += Math.round(p.openness / 33);             // O 高 → 思考
  base.sleep       += Math.round((100 - p.conscientiousness) / 33); // C 低 → 犯困
  base.peek        += Math.round(p.extraversion / 33);         // E 高 → 偷看

  // 欲望修正
  if (desires.hunger > 60) base.peek += 3;        // 饿了 → 偷看用户
  if (desires.rest > 70) base.yawn += 3;           // 困了 → 打哈欠
  if (desires.social > 60) base.wave += 2;         // 想社交 → 挥手
  if (desires.curiosity > 60) base.look_around += 2; // 好奇 → 东张西望

  return base;
}
```

### 7.3 DreamEngine 引入 rest 欲望

```typescript
shouldDream(trigger: 'idle' | 'scheduled' | 'overflow' | 'manual', idleMinutes = 0, restDesire = 0): boolean {
  if (trigger === 'manual') return true;
  if (Date.now() - this.lastSessionTime < 30 * 60 * 1000) return false;

  // rest 欲望降低触发阈值
  const threshold = restDesire > 80 ? 3 : restDesire > 60 ? 5 : 10;

  if (trigger === 'idle') return idleMinutes >= threshold;
  if (trigger === 'scheduled') return true;
  if (trigger === 'overflow') return this.stmp.countNodes() > 100;
  return false;
}
```

---

## 八、Prompt 预算分配

在 `MessageProcessor.buildContext()` 中，欲望状态注入 Prompt：

```typescript
// ─── 人格性格（优先级 95，核心指令）───
const oceanPrompt = buildOceanPrompt(ocean);
budget.add({ id: 'personality', source: 'personality', priority: PRIORITY.CORE_INSTRUCTION, content: oceanPrompt, required: true });

// ─── 情绪状态（优先级 60）───
const emotionPrompt = emotion.getPromptInjection();
budget.add({ id: 'emotion', source: 'emotion', priority: PRIORITY.EMOTION, content: emotionPrompt, required: false });

// ─── 欲望状态（优先级 55，新增）───
const desirePrompt = buildDesirePrompt(desires);
if (desirePrompt) {
  budget.add({ id: 'desire', source: 'desire', priority: 55, content: desirePrompt, required: false });
}
```

欲望 Prompt 注入（仅在有显著欲望时注入，节省 token）：

```typescript
function buildDesirePrompt(desires: DesireVector): string | null {
  const parts: string[] = [];
  if (desires.hunger > 70) parts.push('你好一阵没和用户说话了，有点想互动。');
  if (desires.curiosity > 60) parts.push('你对当前话题很好奇，想深入了解。');
  if (desires.social > 70) parts.push('你想和用户多聊几句。');
  if (desires.safety > 60) parts.push('你最近遇到了一些错误，做决定时更谨慎。');
  if (desires.expression > 80) parts.push('你很想分享你的发现和想法。');
  if (desires.rest > 80) parts.push('你有点累了，回复可以简短些。');
  return parts.length > 0 ? `\n## 你的内在状态\n${parts.join('\n')}` : null;
}
```

---

## 九、数据库改造

### 9.1 pet_ocean 表（替换 pet_behavior）

```sql
CREATE TABLE IF NOT EXISTS pet_ocean (
  pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
  openness REAL NOT NULL DEFAULT 50,
  conscientiousness REAL NOT NULL DEFAULT 50,
  extraversion REAL NOT NULL DEFAULT 50,
  agreeableness REAL NOT NULL DEFAULT 50,
  neuroticism REAL NOT NULL DEFAULT 50,
  last_computed_at INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0
);
```

### 9.2 旧数据迁移

```sql
-- 近似映射旧 5 维 → OCEAN
-- INSERT INTO pet_ocean (pet_id, openness, conscientiousness, extraversion, agreeableness, neuroticism)
-- SELECT pet_id,
--   clamp(wisdom * 0.6 + chaos * 0.4, 0, 100),                -- O ≈ wisdom + chaos
--   clamp(100 - chaos * 0.5 + patience * 0.3, 0, 100),        -- C ≈ 100 - chaos + patience
--   clamp(50 + snark * 0.3 - patience * 0.2, 0, 100),         -- E ≈ snark 高话多
--   clamp(100 - snark * 0.6 + patience * 0.3, 0, 100),        -- A ≈ 100 - snark + patience
--   clamp(50 + chaos * 0.3 - wisdom * 0.2, 0, 100)            -- N ≈ chaos - wisdom
-- FROM pet_behavior;
```

### 9.3 欲望状态持久化

```sql
CREATE TABLE IF NOT EXISTS desire_state (
  pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
  hunger REAL NOT NULL DEFAULT 20,
  curiosity REAL NOT NULL DEFAULT 30,
  social REAL NOT NULL DEFAULT 15,
  safety REAL NOT NULL DEFAULT 10,
  expression REAL NOT NULL DEFAULT 15,
  rest REAL NOT NULL DEFAULT 10,
  last_updated INTEGER NOT NULL
);
```

---

## 十、文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/personality/ocean.ts` | **新增** | OCEAN 类型 + 计算 + 调制 + Prompt |
| `src/desire/engine.ts` | **新增** | 六欲引擎 + 衰减 + 行为冲动 |
| `src/emotion/engine.ts` | **改造** | applyPersonality 改用 OCEAN；chooseExpression 引入人格；Buff 模板调整 |
| `src/core/subsystems.ts` | **改造** | 初始化 DesireEngine；加载 OCEAN |
| `src/core/agent.ts` | **改造** | preprocess/postprocess 调用欲望计算 |
| `src/core/behavior-tracker.ts` | **改造** | 采集新的行为信号；调用 computeOcean |
| `src/core/message-processor.ts` | **改造** | Prompt 注入 OCEAN + 欲望状态 |
| `src/core/ws-handler.ts` | **改造** | setPersonality 改用 OCEAN；欲望状态同步 |
| `src/pet/manager.ts` | **改造** | 新增 getOcean/computeOcean；物种表更新 |
| `src/pet/types.ts` | **改造** | SpeciesInfo 加入 oceanBias；删除旧 BehaviorSignals |
| `src/cognitive/engine.ts` | **改造** | shouldSpeak 引入欲望权重 |
| `src/behavior/idle.ts` | **改造** | 行为权重引入人格 + 欲望 |
| `src/memory/dream.ts` | **改造** | shouldDream 引入 rest 欲望 |
| `src/personality/prompt.ts` | **改造** | buildSystemPrompt 改用 OCEAN |

---

## 十一、执行阶段

### Phase 1：情绪层改造（基础）

1. 新增 `VALENCE` 常量
2. 重写 `applyPersonality`（先用旧 PersonalityTraits + VALENCE，修 bug）
3. 调整 `tool_error` / `user_message` Buff 模板
4. 调整 mood 阈值
5. 跑单测验证

### Phase 2：人格层替换（OCEAN）

6. 新增 `src/personality/ocean.ts`
7. `pet_ocean` 表建表 + 迁移逻辑
8. `PetManager` 新增 OCEAN 方法
9. `EmotionEngine` 接收 `OceanPersonality`
10. `applyPersonality` 改用 OCEAN 调制公式
11. `chooseExpression` 引入人格调制
12. `MessageProcessor` 用 OCEAN 生成 Prompt
13. 跑全量测试

### Phase 3：欲望层新增

14. 新增 `src/desire/engine.ts`
15. `Subsystems` 初始化 `DesireEngine`
16. `agent.ts` 消息处理中调用欲望计算
17. Prompt 注入欲望状态
18. `shouldSpeak()` 引入欲望权重
19. `IdleBehavior` 引入人格 + 欲望权重
20. `DreamEngine` 引入 rest 欲望

### Phase 4：清理 + 前端

21. 删除旧 `PersonalityTraits` 类型
22. 删除 `pet_behavior` 表写入（保留只读兼容）
23. 更新前端人格展示（OCEAN 雷达图替代旧 5 维条形图）
24. 新增欲望状态可视化（可选，调试面板）
25. 更新所有测试

---

## 十二、风险评估

| 风险 | 影响 | 应对 |
|---|---|---|
| Buff 值调整影响其他测试 | 可能有用例依赖旧值 | Phase 1 先跑全量测试，逐个排查 |
| OCEAN 涌现公式需要调参 | 人格变化太快或太不可感知 | INERTIA=0.85 是经验值，上线后观察调整 |
| 欲望计算开销 | 每次消息多一次计算 | 纯数学运算，无 IO，< 0.1ms |
| 旧数据迁移 | 旧 5 维 → OCEAN 近似映射不精确 | 迁移只影响首次，后续涌现自然覆盖 |
| 三层联动复杂度 | 调试困难 | 每层独立可测；verbose 模式输出三层状态 |
| Prompt token 增加 | 欲望注入多 ~50 token | 仅在有显著欲望时注入；预算管理自动裁剪 |
