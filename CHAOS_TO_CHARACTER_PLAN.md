# 从混沌到个性：Buddy 成长系统改造计划

> **核心理念**：每只 Buddy 天生是混沌体，通过用户交互逐渐形成独一无二的性格。
> 物种是先天基因，行为是后天塑造，随机初始扰动保证个体差异。

---

## 一、设计原理

### 1.1 研究依据

- **行为遗传学**（Bouchard, 1994）：大五人格遗传贡献 40-60%，非共享环境 40-50%
- **气质理论**（Thomas & Chess, 1977）：婴儿出生带先天气质，但后天可塑
- **进化算法**：有偏向的随机初始化 > 纯随机 > 固定初始化

### 1.2 公式

```
每只 Buddy 的性格 = 物种基因 × 用户行为 × 随机初始扰动
```

三条路径叠加，不可能有两只一样的 Buddy。

### 1.3 与现有系统的关系

不推翻现有架构，**在现有三层系统上叠加成长权重**：

| 现有系统 | 改造方式 |
|---|---|
| OCEAN 人格（`personality/ocean.ts`） | 初始值随机化 + 惯性系数动态化 |
| 情绪引擎（`emotion/engine.ts`） | 调制系数乘以成长权重 |
| 欲望引擎（`desire/engine.ts`） | 基线插值：物种默认 ↔ 人格驱动 |
| 空闲行为（`behavior/idle.ts`） | 权重插值：均匀随机 ↔ 人格驱动 |
| 人格 Prompt（`personality/prompt.ts`） | 注入精度随成长阶段变化 |
| 进化阶段（`pet/types.ts`） | 已有 7 阶段，直接映射成长权重 |

---

## 二、核心变量：personalityStrength

### 2.1 定义

`personalityStrength`（简称 PS）是 0→1 的浮点数，表示"人格对行为的控制力"。

- PS = 0：纯混沌，人格对行为无影响
- PS = 1：完全人格驱动，行为可预测

### 2.2 计算方式

从已有的进化阶段 + formProgress 直接算出，**不需要新增数据库字段**。

```typescript
function getPersonalityStrength(stage: EvolutionStage, formProgress: number): number {
  const stageBase: Record<EvolutionStage, number> = {
    egg:       0.0,
    hatching:  0.1,
    growing:   0.3,
    formed:    0.5,
    mature:    0.7,
    complete:  0.85,
    legendary: 0.95,
  };
  const base = stageBase[stage] ?? 0;
  // 同一阶段内，formProgress 提供微调（0~0.05）
  const micro = (formProgress % 15) / 15 * 0.05;
  return clamp(base + micro, 0, 1);
}
```

### 2.3 各阶段表现

| 阶段 | PS 范围 | 人格调制 | mood 选择 | Prompt 注入 | 欲望基线 |
|---|---|---|---|---|---|
| 🥚 蛋 | 0.0~0.1 | ≈ 0（不调制） | 纯随机 | 不注入 | 物种默认 |
| 🐣 孵化 | 0.1~0.3 | 微弱 | 80% 随机 | 模糊描述 | 接近默认 |
| 🦊 成长 | 0.3~0.5 | 中等偏弱 | 60% 随机 | 模糊描述 | 开始偏移 |
| 🦎 成形 | 0.5~0.7 | 中等 | 40% 随机 | 精确描述 | 明显偏移 |
| 🐺 成熟 | 0.7~0.85 | 较强 | 20% 随机 | 精确描述 | 接近人格驱动 |
| 🐲 完全 | 0.85~0.95 | 接近满载 | 10% 随机 | 精确描述 | 人格驱动 |
| 🌟 传说 | 0.95~1.0 | 满载 | 0% 随机 | 精确描述 | 完全人格驱动 |

---

## 三、改造清单

### 3.1 OCEAN 初始值随机化

**文件**：`src/personality/ocean.ts`

**现状**：
```typescript
export function defaultOcean(): OceanPersonality {
  return { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };
}
```

**改造**：
```typescript
export function speciesInitialOcean(species: string): OceanPersonality {
  const base = SPECIES_OCEAN_BASE[species] ?? SPECIES_OCEAN_BASE['光灵'];
  const jitter = () => 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
  return {
    openness:          clamp(base.openness          * jitter(), 0, 100),
    conscientiousness: clamp(base.conscientiousness * jitter(), 0, 100),
    extraversion:      clamp(base.extraversion      * jitter(), 0, 100),
    agreeableness:     clamp(base.agreeableness     * jitter(), 0, 100),
    neuroticism:       clamp(base.neuroticism       * jitter(), 0, 100),
  };
}
```

**新增物种基线表**（区别于现有的 bias 乘数表）：
```typescript
export const SPECIES_OCEAN_BASE: Record<string, OceanPersonality> = {
  '光灵':   { openness: 55, conscientiousness: 50, extraversion: 50, agreeableness: 55, neuroticism: 45 },
  '猫':     { openness: 60, conscientiousness: 40, extraversion: 35, agreeableness: 35, neuroticism: 55 },
  '鸭子':   { openness: 45, conscientiousness: 55, extraversion: 55, agreeableness: 60, neuroticism: 45 },
  '大鹅':   { openness: 40, conscientiousness: 45, extraversion: 60, agreeableness: 30, neuroticism: 50 },
  '幽灵':   { openness: 65, conscientiousness: 35, extraversion: 30, agreeableness: 45, neuroticism: 60 },
  '蘑菇':   { openness: 60, conscientiousness: 40, extraversion: 40, agreeableness: 50, neuroticism: 55 },
  '胖胖':   { openness: 40, conscientiousness: 50, extraversion: 45, agreeableness: 65, neuroticism: 40 },
  '机器人': { openness: 45, conscientiousness: 65, extraversion: 35, agreeableness: 45, neuroticism: 30 },
  '龙':     { openness: 55, conscientiousness: 55, extraversion: 50, agreeableness: 40, neuroticism: 45 },
  '凤凰':   { openness: 60, conscientiousness: 60, extraversion: 55, agreeableness: 55, neuroticism: 35 },
};
```

### 3.2 computeOcean 惯性系数动态化

**文件**：`src/personality/ocean.ts`

**现状**：
```typescript
const INERTIA = 0.85;
```

**改造**：
```typescript
export function computeOcean(
  ctx: PersonalityContext,
  current: OceanPersonality,
  speciesBias: Partial<OceanPersonality>,
  personalityStrength: number = 1,  // 新增参数
): OceanPersonality {
  // 早期变化大（INERTIA 低），后期变化小（INERTIA 高）
  const INERTIA = 0.5 + personalityStrength * 0.4;  // 0.5 ~ 0.9
  // ... 其余逻辑不变
}
```

### 3.3 情绪调制权重

**文件**：`src/personality/ocean.ts`

**现状**：`oceanEmotionModulation()` 返回固定系数。

**改造**：调制效果按 PS 缩放。
```typescript
export function oceanEmotionModulation(
  p: OceanPersonality,
  dim: keyof EmotionVector,
  valence: 'positive' | 'negative' | 'neutral',
  personalityStrength: number = 1,  // 新增参数
): number {
  let factor = 1.0;
  // ... 原有计算逻辑不变 ...

  // 按 PS 缩放：PS=0 时 factor=1（不调制），PS=1 时 factor=原始值
  return 1.0 + (factor - 1.0) * personalityStrength;
}
```

### 3.4 mood 选择引入随机

**文件**：`src/emotion/engine.ts` 的 `chooseExpression()`

**改造**：
```typescript
private chooseExpression(vector: EmotionVector, personalityStrength: number = 1): ExpressionChoice {
  // ... 原有 energy/satisfaction 计算 ...

  // ── mood 选择 ──
  let mood: Mood;
  if (Math.random() > personalityStrength) {
    // 混沌阶段：随机 mood（允许矛盾）
    const moods: Mood[] = ['calm', 'happy', 'tired', 'excited', 'frustrated', 'thinking', 'confused', 'energetic'];
    mood = moods[Math.floor(Math.random() * moods.length)];
  } else {
    // 人格驱动：原逻辑
    // ... 原有 topKey/topVal 映射逻辑 ...
  }

  // ── 人格微调也按 PS 缩放 ──
  if ('openness' in this.personality) {
    const op = this.personality as OceanPersonality;
    // 原有的 E/A/N/C 调整，但乘以 personalityStrength
    if (op.extraversion > 70 && mood === 'calm' && Math.random() < personalityStrength) mood = 'energetic';
    // ... 其余类似 ...
  }

  return { mood, intensity, isAuthentic, vector, energy, satisfaction };
}
```

### 3.5 人格 Prompt 注入精度

**文件**：`src/personality/prompt.ts`

**改造**：`buildSystemPrompt` 接收 PS 参数。
```typescript
export function buildSystemPrompt(
  config: BuddyConfig,
  availableToolNames?: string[],
  dynamicPersonality?: Attributes,
  intimacyLevel?: string,
  ocean?: OceanPersonality,
  personalityStrength: number = 1,  // 新增
): string {
  // ...

  if (ocean) {
    if (personalityStrength < 0.3) {
      // 混沌体：不注入人格，或注入模糊描述
      prompt += '\n\n## 你的性格\n你刚来到这个世界，还不太了解自己。你的性格正在形成中。';
    } else if (personalityStrength < 0.6) {
      // 初步成形：模糊描述
      prompt += '\n\n## 你的性格\n' + buildVagueOceanPrompt(ocean);
    } else {
      // 稳定期：精确描述
      prompt += '\n\n## 你的性格\n' + buildOceanPrompt(ocean);
    }
  }
}
```

**新增模糊描述函数**：
```typescript
function buildVagueOceanPrompt(p: OceanPersonality): string {
  const parts: string[] = [];
  if (p.openness > 60) parts.push('你似乎对新事物有些好奇');
  else if (p.openness < 40) parts.push('你似乎偏好熟悉的东西');
  if (p.extraversion > 60) parts.push('你偶尔想多说几句');
  else if (p.extraversion < 40) parts.push('你有时候更想安静待着');
  // ... 每个维度只给模糊暗示 ...
  return parts.length > 0 ? parts.join('，') + '。' : '你还在摸索自己是什么样的存在。';
}
```

### 3.6 欲望基线插值

**文件**：`src/personality/ocean.ts`

**现状**：`oceanDesireBaseline()` 直接用 OCEAN 值计算。

**改造**：在物种默认和人格驱动之间插值。
```typescript
export function oceanDesireBaseline(
  p: OceanPersonality,
  personalityStrength: number = 1,
): { curiosity: number; social: number; expression: number; safety: number; rest: number } {
  // 人格驱动的基线
  const personalityDriven = {
    curiosity:  15 + p.openness * 0.4,
    social:     10 + p.extraversion * 0.35,
    expression: 10 + p.extraversion * 0.3,
    safety:     5  + p.neuroticism * 0.3,
    rest:       15 + (50 - Math.abs(p.conscientiousness - 50)) * 0.3,
  };

  // 物种默认基线（中间值）
  const speciesDefault = { curiosity: 30, social: 25, expression: 20, safety: 15, rest: 20 };

  // 按 PS 插值
  return {
    curiosity:  speciesDefault.curiosity  + (personalityDriven.curiosity  - speciesDefault.curiosity)  * personalityStrength,
    social:     speciesDefault.social     + (personalityDriven.social     - speciesDefault.social)     * personalityStrength,
    expression: speciesDefault.expression + (personalityDriven.expression - speciesDefault.expression) * personalityStrength,
    safety:     speciesDefault.safety     + (personalityDriven.safety     - speciesDefault.safety)     * personalityStrength,
    rest:       speciesDefault.rest       + (personalityDriven.rest       - speciesDefault.rest)       * personalityStrength,
  };
}
```

### 3.7 空闲行为随机化

**文件**：`src/behavior/idle.ts`

**改造**：`pickAction()` 按 PS 混合权重。
```typescript
private pickAction(): IdleAction | null {
  const actions: IdleAction[] = ['blink', 'look_around', 'yawn', 'stretch', 'wave', 'think', 'sleep', 'peek'];

  // 人格驱动权重（原逻辑）
  const personalityWeights: Record<IdleAction, number> = { ...MOOD_ACTION_WEIGHTS[this.currentMood] };
  if (this.ocean) { /* OCEAN 修正 */ }
  if (this.desires) { /* 欲望修正 */ }

  // 均匀权重（混沌）
  const uniformWeight = 1;

  // 按 PS 混合
  const ps = this.personalityStrength ?? 1;
  const finalWeights: Record<IdleAction, number> = {} as any;
  for (const a of actions) {
    finalWeights[a] = personalityWeights[a] * ps + uniformWeight * (1 - ps);
  }

  // 按 finalWeights 随机选择
  // ...
}
```

**新增**：`setPersonalityStrength(ps: number)` 方法。

---

## 四、文件改动汇总

| 文件 | 改动内容 | 改动量 |
|---|---|---|
| `src/personality/ocean.ts` | 新增 `SPECIES_OCEAN_BASE`、`speciesInitialOcean()`、PS 参数传入 `computeOcean`/`oceanEmotionModulation`/`oceanDesireBaseline` | 中 |
| `src/emotion/engine.ts` | `chooseExpression` 引入 PS 参数，随机 mood 分支 | 中 |
| `src/personality/prompt.ts` | `buildSystemPrompt` 引入 PS 参数，分级 Prompt 注入 | 小 |
| `src/behavior/idle.ts` | `pickAction` 引入 PS 混合权重，新增 `setPersonalityStrength` | 小 |
| `src/desire/engine.ts` | `DesireEngine` 接收 PS 参数，传给 `oceanDesireBaseline` | 小 |
| `src/core/subsystems.ts` | 初始化时用 `speciesInitialOcean` 替代 `defaultOcean` | 小 |
| `src/pet/manager.ts` | `getOcean` 首次创建时用 `speciesInitialOcean`；新增 `getPersonalityStrength` 方法 | 中 |
| `src/core/message-processor.ts` | 传递 PS 给 `buildSystemPrompt` | 小 |
| `src/core/ws-handler.ts` | `syncPersonalityToEmotion` 传递 PS | 小 |
| `src/emotion/engine.ts` | `applyPersonality` 接收 PS 参数 | 小 |
| `src/personality/ocean.ts` | 导出 `getPersonalityStrength()` 工具函数 | 小 |

**总计**：10 个文件，约 150 行新增/修改代码。

---

## 五、执行阶段

### Phase 1：核心变量 + OCEAN 初始化（基础设施）

1. `src/personality/ocean.ts`：新增 `SPECIES_OCEAN_BASE`、`speciesInitialOcean()`、`getPersonalityStrength()`
2. `src/pet/manager.ts`：`getOcean()` 首次创建时用 `speciesInitialOcean`；新增 `getPersonalityStrength()`
3. `src/core/subsystems.ts`：初始化时传入 species

### Phase 2：人格层成长化

4. `src/personality/ocean.ts`：`computeOcean` 加入 PS 参数控制惯性
5. `src/personality/prompt.ts`：`buildSystemPrompt` 分级 Prompt 注入

### Phase 3：情绪层成长化

6. `src/personality/ocean.ts`：`oceanEmotionModulation` 按 PS 缩放
7. `src/emotion/engine.ts`：`chooseExpression` 引入随机 mood 分支
8. `src/emotion/engine.ts`：`applyPersonality` 传递 PS

### Phase 4：欲望层 + 空闲行为成长化

9. `src/personality/ocean.ts`：`oceanDesireBaseline` 按 PS 插值
10. `src/behavior/idle.ts`：`pickAction` 按 PS 混合权重
11. `src/desire/engine.ts`：传递 PS 给欲望基线

### Phase 5：管线串联 + 测试

12. `src/core/message-processor.ts`：传递 PS 到 Prompt 构建
13. `src/core/ws-handler.ts`：同步 PS 到情绪/空闲行为
14. 更新现有测试，新增成长路径测试

---

## 六、风险评估

| 风险 | 影响 | 应对 |
|---|---|---|
| 蛋阶段 mood 纯随机导致体验差 | 用户觉得 Buddy 不可控 | 保留基础行为（眨眼等）不受影响 |
| PS 计算依赖进化阶段 | 进化快的 Buddy 更早"成形" | 符合预期：探索多=成长快 |
| 旧测试断言值变化 | 测试失败 | 每个 Phase 跑全量测试 |
| 性能 | PS 计算开销 | 纯数学运算，< 0.01ms |
| 旧数据迁移 | 已有 Buddy 的 OCEAN 值 | 保留现有值，只对新建的 Buddy 生效 |

---

## 七、验证标准

- [ ] 新建 Buddy 的 OCEAN 初始值因物种不同而不同，同物种也有随机差异
- [ ] 蛋阶段：mood 随机跳跃，人格 Prompt 不注入，空闲行为均匀分布
- [ ] 成长阶段：OCEAN 值开始收敛，mood 逐渐稳定，Prompt 逐渐精确
- [ ] 传说阶段：行为完全由人格驱动，与蛋阶段形成鲜明对比
- [ ] 同物种两只 Buddy 因用户行为不同走向不同性格
- [ ] 全量测试通过（923/923）
