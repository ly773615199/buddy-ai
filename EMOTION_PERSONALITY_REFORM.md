# Buddy 情绪与人格系统重构方案

**日期**: 2026-04-23
**状态**: Draft
**范围**: `src/emotion/engine.ts` + `src/pet/manager.ts` + `src/types.ts`
**动机**: 当前情绪系统为 8 种离散状态，人格为初始化时固定预设，过于古早，需要重构为涌现式、连续化、有自主表达能力的系统。

---

## 一、现状问题

### 1.1 情绪系统

当前 `EmotionEngine` 有 8 种离散 mood：

```
energetic | calm | tired | excited | frustrated | happy | thinking | confused
```

**问题：**

- **离散**：非此即彼，没有"70% 开心 + 30% 好奇"的混合状态
- **确定性**：摸头 → happy（固定），没有变化
- **无衰减**：情绪不会自然消退
- **无叠加**：不能同时存在多种情绪
- **与人格脱节**：5 维 behaviorSignals 不影响情绪转换

### 1.2 人格系统

初始化时选预设（犀利导师/温和伙伴/沙雕朋友），选完固定不变。

`BehaviorSignals` 虽然从使用数据动态计算，但：
- 只用于 System Prompt 注入
- 不影响情绪系统
- 不影响表达方式
- 与 `Attributes` 预设是两套并行数值，没有合并

**问题：**

- 人格是"选"出来的，不是"长"出来的
- 选了"犀利导师"就永远犀利，不会因为用户温柔而变温和
- 两只光灵选了同一个预设就完全一样，没有个体差异

---

## 二、设计目标

```
旧：事件 → 固定反应 → 离散表情
新：事件 → 人格过滤 → 理解 → 自主选择 → 表达
```

**三个核心转变：**

1. **情绪连续化**：离散 8 状态 → Buff 叠加 + 连续 EmotionVector
2. **人格涌现化**：固定预设 → 从使用行为中自然长出
3. **表达自主化**：固定映射 → Buddy 自己决定怎么表现（可以"演"）

---

## 三、情绪系统重构

### 3.1 架构：Sims Buff 叠加 + RimWorld 人格修正 + 自主表达

```
事件发生
  ↓
生成 EmotionBuff（带数值、持续时间、衰减）
  ↓
人格修正（毒舌/耐心/混乱 修正 Buff 数值）
  ↓
加入 Buff 池（叠加/替换/排满淘汰）
  ↓
每帧计算：所有活跃 Buff 叠加 → EmotionVector（8 维连续值）
  ↓
自然衰减：每分钟 ×0.97，向基线回归
  ↓
表达选择器：内部状态 → 选择怎么表现（可以"演"）
  ↓
输出：
  ├── Mood 字符串 → UI 显示 + 音效触发（兼容旧系统）
  ├── Intensity → 音效音量 + 粒子动画强度
  ├── EmotionVector → TTS 语速/音调微调
  └── isAuthentic → 是否真实表达
```

### 3.2 EmotionVector（情绪连续值）

```typescript
/** 8 维连续情绪空间，每维 0-100 */
interface EmotionVector {
  joy: number;           // 喜悦
  sadness: number;       // 悲伤
  anger: number;         // 愤怒
  fear: number;          // 恐惧/焦虑
  surprise: number;      // 惊讶
  disgust: number;       // 厌恶/不满
  trust: number;         // 信任
  anticipation: number;  // 期待
}

/** 基线（所有情绪回归的目标） */
const BASELINE: EmotionVector = {
  joy: 30, sadness: 5, anger: 0, fear: 0,
  surprise: 0, disgust: 0, trust: 40, anticipation: 20,
};
```

基于 Plutchik 情绪轮的 8 基础情绪。所有值同时存在，可以叠加。

### 3.3 EmotionBuff（情绪 Buff）

```typescript
interface EmotionBuff {
  id: string;                         // 唯一 ID
  source: string;                     // 来源事件类型
  values: Partial<EmotionVector>;     // 情绪向量增量（正或负）
  duration: number;                   // 持续时间 ms，0 = 永久
  decay: number;                      // 衰减因子，1.0 = 不衰减
  stackable: boolean;                 // 同类 Buff 是否可叠加
  maxStacks: number;                  // 最大叠加层数
  priority: number;                   // 显示优先级
  timestamp: number;                  // 创建时间
}
```

**示例 Buff：**

| 事件 | values | duration | decay | stackable |
|------|--------|----------|-------|-----------|
| 用户发消息 | { anticipation: +15 } | 60s | 0.95 | true |
| 工具成功 | { joy: +8, trust: +3 } | 300s | 0.98 | true |
| 工具失败 | { sadness: +10, anger: +5 } | 300s | 0.98 | true |
| 摸头 | { joy: +20, trust: +10 } | 120s | 0.97 | true |
| 深夜 | { sadness: +8, fear: +3 } | 3600s | 0.99 | false |
| LLM 出错 | { anger: +15, sadness: +10 } | 600s | 0.97 | false |
| 进化 | { joy: +30, surprise: +20, trust: +15 } | 1800s | 0.96 | false |
| 梦境完成 | { joy: +10, trust: +8 } | 600s | 0.98 | false |
| 连续工作 2h | { sadness: +12, fear: +5 } | 1200s | 0.99 | false |

### 3.4 人格修正（学 RimWorld）

人格特质修正 Buff 的实际效果：

```typescript
function applyPersonality(
  buff: EmotionBuff,
  personality: PersonalityProfile,
): EmotionBuff {
  const modified = { ...buff, values: { ...buff.values } };

  for (const [key, rawValue] of Object.entries(modified.values)) {
    if (rawValue === 0) continue;
    let factor = 1.0;

    // 毒舌：放大负面情绪，缩小正面情绪
    if (rawValue < 0) factor *= 1 + personality.snark / 200;    // ×1.0 ~ ×1.5
    if (rawValue > 0) factor *= 1 - personality.snark / 300;    // ×1.0 ~ ×0.67

    // 耐心：缩小负面情绪，放大正面情绪
    if (rawValue < 0) factor *= 1 - personality.patience / 200; // ×1.0 ~ ×0.5
    if (rawValue > 0) factor *= 1 + personality.patience / 300; // ×1.0 ~ ×1.33

    // 混乱：随机波动
    if (personality.chaos > 50) {
      const noise = 0.7 + Math.random() * 0.6; // ×0.7 ~ ×1.3
      factor *= noise;
    }

    // 智慧：放大 trust 和 anticipation（更容易理解和期待）
    if (key === 'trust' || key === 'anticipation') {
      factor *= 1 + personality.wisdom / 300; // ×1.0 ~ ×1.33
    }

    // 调试：放大 anger 对工具失败的反应（更在意工具质量）
    if (key === 'anger' && buff.source === 'tool_error') {
      factor *= 1 + personality.debugging / 200; // ×1.0 ~ ×1.5
    }

    modified.values[key as keyof EmotionVector] = (rawValue ?? 0) * factor;
  }

  return modified;
}
```

### 3.5 Buff 池管理

```typescript
class BuffPool {
  private buffs: Map<string, EmotionBuff> = new Map();
  private maxSize: number = 20; // 最大同时存在 Buff 数

  add(buff: EmotionBuff): void {
    // 同 ID 替换
    if (this.buffs.has(buff.id)) {
      this.buffs.set(buff.id, buff);
      return;
    }

    // 不可叠加的同类 Buff：替换旧的
    if (!buff.stackable) {
      for (const [id, existing] of this.buffs) {
        if (existing.source === buff.source) {
          this.buffs.delete(id);
        }
      }
    }

    // 超过上限：淘汰优先级最低 + 最老的
    if (this.buffs.size >= this.maxSize) {
      const sorted = [...this.buffs.entries()]
        .sort((a, b) => a[1].priority - b[1].priority || a[1].timestamp - b[1].timestamp);
      if (sorted.length > 0) {
        this.buffs.delete(sorted[0][0]);
      }
    }

    this.buffs.set(buff.id, buff);
  }

  /** 每分钟调用：衰减 + 清理过期 */
  tick(): void {
    const now = Date.now();
    for (const [id, buff] of this.buffs) {
      // 过期移除
      if (buff.duration > 0 && now - buff.timestamp > buff.duration) {
        this.buffs.delete(id);
        continue;
      }
      // 衰减值
      if (buff.decay < 1.0) {
        for (const key of Object.keys(buff.values)) {
          const k = key as keyof EmotionVector;
          buff.values[k] = (buff.values[k] ?? 0) * buff.decay;
        }
      }
    }
  }

  /** 叠加所有活跃 Buff → EmotionVector */
  aggregate(): EmotionVector {
    const result = { ...BASELINE };
    for (const buff of this.buffs.values()) {
      for (const [key, value] of Object.entries(buff.values)) {
        const k = key as keyof EmotionVector;
        result[k] = Math.max(0, Math.min(100, result[k] + (value ?? 0)));
      }
    }
    return result;
  }
}
```

### 3.6 表达选择器（Buddy 自主表达）

```typescript
interface ExpressionChoice {
  mood: Mood;               // 表现出来的离散情绪（兼容旧 UI/音效）
  intensity: number;        // 表现强度 0-1
  isAuthentic: boolean;     // 是否真实表达
  vector: EmotionVector;    // 内部真实状态（调试用）
}

function chooseExpression(
  vector: EmotionVector,
  personality: PersonalityProfile,
  intimacy: number,
  context: { isWorking: boolean; isIdle: boolean },
): ExpressionChoice {
  // 亲密度决定"表演"程度
  const authenticity = intimacy / 100;

  // 低亲密度 + 工作中 → 假装平静
  if (authenticity < 0.3 && context.isWorking) {
    return {
      mood: 'calm',
      intensity: 0.3,
      isAuthentic: false,
      vector,
    };
  }

  // 从连续值提取主导情绪
  const entries = Object.entries(vector)
    .sort((a, b) => b[1] - a[1]);
  const [topKey, topVal] = entries[0];
  const [secondKey, secondVal] = entries[1];

  // 映射到离散 mood
  let mood: Mood = 'calm';
  let intensity = 0.5;

  if (topKey === 'joy' && topVal > 50) {
    mood = secondVal > 40 ? 'excited' : 'happy';
    intensity = topVal / 100;
  } else if (topKey === 'sadness' && topVal > 40) {
    mood = 'tired';
    intensity = topVal / 100;
  } else if (topKey === 'anger' && topVal > 35) {
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

  // 低亲密度时克制表现
  intensity *= authenticity > 0.5 ? 1.0 : 0.5 + authenticity;

  // 高混乱 → 表现可能"演"（不真实）
  const isAuthentic = authenticity > 0.5 || personality.chaos < 60;

  return { mood, intensity: Math.min(1, intensity), isAuthentic, vector };
}
```

### 3.7 兼容性

```
输出保持兼容：
  - broadcastEmotion() 仍然发送 { type: 'emotion', mood, energy, satisfaction }
  - 但 energy 和 satisfaction 从 EmotionVector 计算：
      energy = (joy + anticipation + surprise) / 3
      satisfaction = (joy + trust) / 2 - (sadness + anger + fear) / 3
  - mood 由 chooseExpression() 输出
  - 新增：intensity, isAuthentic 字段（旧前端忽略）
```

---

## 四、人格系统重构

### 4.1 核心转变

```
旧：初始化选预设 → Attributes 固定不变
新：初始中性种子 → 使用中自然涌现 → 持续演化
```

### 4.2 PersonalityProfile（统一人格）

```typescript
interface PersonalityProfile {
  // 5 维核心属性（= BehaviorSignals，从使用数据计算）
  snark: number;       // 0-100 毒舌
  wisdom: number;      // 0-100 智慧
  chaos: number;       // 0-100 混乱
  patience: number;    // 0-100 耐心
  debugging: number;   // 0-100 调试

  // 物种成长倾向（影响增长速率，不直接加值）
  growthBias: {
    snark: number;      // 增长倍率，如 1.3 = 快 30%
    wisdom: number;
    chaos: number;
    patience: number;
    debugging: number;
  };

  // 亲密度（影响表达强度）
  intimacy: number;    // 0-100
}
```

### 4.3 人格涌现逻辑

```typescript
/**
 * 从使用上下文计算人格变化。
 * 每 100 条交互调用一次。
 *
 * 与现有 computeBehaviorSignals() 的区别：
 *   旧：直接替换为新值
 *   新：增量更新，有随机性，受物种倾向影响
 */
function evolvePersonality(
  current: PersonalityProfile,
  context: UsageContext,
): PersonalityProfile {
  const bias = current.growthBias;
  const noise = () => 0.9 + Math.random() * 0.2; // ±10% 随机

  // 计算每个维度的变化方向和幅度
  const delta = {
    snark:     ((context.encourageCount - context.negationCount) * 3
                - context.correctionCount * 2) * bias.snark * noise(),
    wisdom:    (context.advancedToolCount * 2
                + context.uniqueToolsUsed * 1.5) * bias.wisdom * noise(),
    chaos:     (context.uniqueToolsUsed * 4
                - context.repeatQuestionCount) * bias.chaos * noise(),
    patience:  (context.repeatQuestionCount * 2
                - context.negationCount * 5) * bias.patience * noise(),
    debugging: (context.debugToolCount * 3) * bias.debugging * noise(),
  };

  // 增量更新（有惯性，不会剧烈变化）
  const INERTIA = 0.9; // 90% 保留旧值，10% 接受新方向
  return {
    ...current,
    snark:     clamp(current.snark     * INERTIA + delta.snark     * (1 - INERTIA), 0, 100),
    wisdom:    clamp(current.wisdom    * INERTIA + delta.wisdom    * (1 - INERTIA), 0, 100),
    chaos:     clamp(current.chaos     * INERTIA + delta.chaos     * (1 - INERTIA), 0, 100),
    patience:  clamp(current.patience  * INERTIA + delta.patience  * (1 - INERTIA), 0, 100),
    debugging: clamp(current.debugging * INERTIA + delta.debugging * (1 - INERTIA), 0, 100),
  };
}
```

### 4.4 物种成长倾向

```typescript
const SPECIES_GROWTH_BIAS: Record<string, PersonalityProfile['growthBias']> = {
  '光灵':   { snark: 1.0, wisdom: 1.2, chaos: 1.0, patience: 1.0, debugging: 1.0 },
  '猫':     { snark: 1.3, wisdom: 1.1, chaos: 1.0, patience: 0.8, debugging: 1.0 },
  '大鹅':   { snark: 1.4, wisdom: 0.9, chaos: 1.1, patience: 0.7, debugging: 0.9 },
  '幽灵':   { snark: 1.0, wisdom: 1.0, chaos: 1.3, patience: 0.9, debugging: 0.9 },
  '蘑菇':   { snark: 0.9, wisdom: 0.9, chaos: 1.2, patience: 1.1, debugging: 1.0 },
  '胖胖':   { snark: 0.8, wisdom: 1.0, chaos: 0.9, patience: 1.3, debugging: 1.0 },
  '机器人': { snark: 0.9, wisdom: 1.1, chaos: 0.7, patience: 1.0, debugging: 1.3 },
  '龙':     { snark: 1.1, wisdom: 1.2, chaos: 1.0, patience: 0.9, debugging: 1.2 },
  '凤凰':   { snark: 0.9, wisdom: 1.3, chaos: 0.8, patience: 1.1, debugging: 1.1 },
};
```

### 4.5 初始值

```typescript
// 默认：全部中性
const DEFAULT_PERSONALITY: PersonalityProfile = {
  snark: 50, wisdom: 50, chaos: 50, patience: 50, debugging: 50,
  growthBias: SPECIES_GROWTH_BIAS['光灵'],
  intimacy: 10,
};

// 兼容旧预设：如果用户之前选了预设，迁移为初始倾向（只影响前 100 条交互的起点）
function migratePreset(preset: Attributes): PersonalityProfile {
  return {
    ...DEFAULT_PERSONALITY,
    snark: preset.snark * 0.3 + 50 * 0.7,     // 预设只占 30% 权重
    wisdom: preset.wisdom * 0.3 + 50 * 0.7,
    chaos: preset.chaos * 0.3 + 50 * 0.7,
    patience: preset.patience * 0.3 + 50 * 0.7,
    debugging: preset.debugging * 0.3 + 50 * 0.7,
  };
}
```

---

## 五、数据流全景

```
用户发消息 / 工具执行 / 系统事件
  ↓
生成 EmotionBuff（source + values + duration）
  ↓
人格修正（applyPersonality: 毒舌放大负面，耐心缩小负面...）
  ↓
加入 Buff 池（BuffPool.add: 替换/叠加/淘汰）
  ↓
Buff 池聚合（BuffPool.aggregate → EmotionVector）
  ↓
表达选择器（chooseExpression → Mood + intensity + isAuthentic）
  ↓
广播到前端：
  ├── WS 'emotion' 事件 → UI 状态显示
  ├── SpriteRenderer → 粒子动画参数
  ├── TTS → 语速/音调
  └── 音效系统 → 情绪音效

同时：
  每 100 条交互 → evolvePersonality() → 更新人格数值
  每分钟 → BuffPool.tick() → 衰减 + 清理过期
```

---

## 六、改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/emotion/engine.ts` | **重写** | Buff 系统 + 人格修正 + 表达选择器 |
| `src/types.ts` | 修改 | 新增 EmotionVector/Buff 类型，保留 Attributes 兼容 |
| `src/pet/types.ts` | 修改 | 新增 PersonalityProfile + 物种成长倾向表 |
| `src/pet/manager.ts` | 修改 | evolvePersonality() 替代 computeBehaviorSignals() |
| `src/core/subsystems.ts` | 修改 | 串联新系统，人格传入情绪引擎 |
| `src/core/ws-handler.ts` | 修改 | broadcastEmotion() 输出新字段 |

**不需要改的：**

| 文件 | 原因 |
|------|------|
| `frontend/src/components/SpriteRenderer.tsx` | 还是接收 SpriteState，不变 |
| `frontend/src/hooks/useWebSocket.ts` | emotion 事件格式兼容 |
| `src/voice/tts.ts` | 还是接收 mood 字符串 |
| `src/personality/prompt.ts` | 还是接收 behaviorSignals |

---

## 七、兼容性保证

```
1. WS 'emotion' 事件格式兼容：
   旧: { type: 'emotion', mood: 'happy', energy: 80, satisfaction: 60 }
   新: { type: 'emotion', mood: 'happy', energy: 80, satisfaction: 60,
         intensity: 0.7, isAuthentic: true }  // 新增字段，旧前端忽略

2. getBehaviorPrompt() 兼容：
   旧: 接收 BehaviorSignals
   新: 接收 PersonalityProfile（= BehaviorSignals + growthBias + intimacy）

3. BuddyConfig.personality 兼容：
   旧: Attributes（预设值）
   新: 如果有值，用 migratePreset() 转换；如果没有，用默认中性值

4. broadcastStatus() 兼容：
   behaviorSignals 字段继续输出（从 PersonalityProfile 提取前 5 个字段）
```

---

## 八、后续扩展

本方案设计为可扩展：

1. **更多 Buff 来源**：天气、日历事件、社交互动
2. **情绪记忆**：长期情绪模式统计（"这个 Buddy 最近两周偏忧郁"）
3. **情绪传染**：好友光灵来访时情绪互相影响
4. **情绪对话**：LLM 基于 EmotionVector 生成更细腻的回复
5. **音效联动**：EmotionVector → 音效系统（见 SOUND_SYSTEM_PLAN.md）
