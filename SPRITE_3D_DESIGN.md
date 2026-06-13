# 灵伴 3D 精灵形象系统 — 设计方案

> 版本: v4.1  
> 日期: 2026-05-01  
> 状态: 设计阶段  
> v4.0 变更：去掉"物种"概念，形态完全涌现，人形基底  
> v4.1 变更：性别方案——装饰定义，涌现确认

---

## 1. 核心设计原则

### 1.1 一个模型，连续变形

**灵伴的视觉呈现就是一套 Three.js 3D 模型。从球体到完整人形，是一个连续的变形过程。**

```
formProgress 0%   → 发光球体（看起来像光团）
formProgress 30%  → 球体开始变形，隐约有凸起
formProgress 60%  → 五官/肢体逐步出现
formProgress 100% → 完整人形伙伴
```

- 一个渲染器，一个场景，一个模型
- formProgress 驱动 morph target weights（0=球体，1=目标形态）
- 基因参数决定"最终长什么样"，formProgress 决定"现在长到什么程度"

### 1.2 没有物种，形态完全涌现

**灵伴没有预设物种。不是猫、不是龙、不是机器人。它是一个人形伙伴，具体形态从用户的交互行为中涌现。**

Onboarding 只确定三件事（不可变）：
- **主色调** — 光芒颜色
- **质感** — 光滑/通透/锋利/温润
- **气质** — 温暖/冷静/活泼/神秘

其余所有形态特征全部涌现：

```
涌现来源                    → 影响的形态维度
─────────────────────────────────────────────
行为信号（5维）              → 身材比例、嘴巴形态
OCEAN 大五人格              → 五官特征、表情倾向
认知模型（用户画像）         → 纹路/装饰风格
知识深度（领域成长）         → 附属物（角/翅膀/光环）
情绪系统                    → 动态特征（呼吸/摇摆/光晕）
进化阶段 + formProgress     → 整体发育程度
```

- 没有预设模板，没有物种表
- 基因空间完全开放，由交互决定最终形态
- 不同用户的灵伴外观天然不同

### 1.3 人形基底

**灵伴是人形的，不是动物。** 这决定了：
- 形态基础是人形骨架（头/躯干/四肢）
- 表情系统基于人脸（眼睛/眉毛/嘴角）
- 肢体语言基于人体（手势/姿态/点头）
- 不是宠物，是有独立人格的伙伴

人形程度是连续的，不是二选一：
- 可以偏卡通（大头/大眼/圆润）
- 可以偏写实（正常比例/细腻五官）
- 可以偏抽象（简化轮廓/几何感）
- 具体偏哪个方向，由基因参数决定

### 1.4 3D 质感

- 实时 3D 渲染（Three.js / WebGL）
- PBR 材质（物理正确的光照/反射/粗糙度）
- 程序化网格生成（不存模型文件，运行时从参数生成）
- 程序化材质生成（不存贴图文件，Shader 实时计算）

### 1.5 资源不爆炸

- 不存储 3D 模型文件
- 不存储贴图文件
- 基因组就是全部数据
- 总资源量 < 200KB（代码 + Shader）

### 1.6 性别：装饰定义，涌现确认

**灵伴没有预设性别。** 性别不是 Onboarding 的选项，不是基因的参数，不是一个需要提前决定的东西。

性别通过两个阶段自然浮现：

**阶段一：装饰定义（用户主导）**

用户通过给灵伴挑选服饰、配饰来表达性别倾向。买裙子还是铠甲，选蝴蝶结还是领带——这些装饰选择就是用户对灵伴性别表达的定义。商城不需要分"男款/女款"，同一件服饰在不同灵伴身上自然呈现不同效果。

**阶段二：涌现确认（灵伴自主）**

随着灵伴人格的成熟（personalityStrength 增长），它的行为偏好、服饰选择倾向、表情模式会逐渐稳定。当灵伴有了足够的自主性，它会通过自己的行为"告诉"用户它是什么——不是被定义的，是它自己长成的。

这意味着：
- 起点：无性别，光团
- 中期：用户通过装饰表达倾向
- 后期：灵伴自身人格确认

**不设性别选项，不设 softness 参数，不设风格原型。** 一切从装饰和行为中涌现。

---

## 2. 进化阶段体系

### 2.1 阶段定义（对接现有 pet/types.ts EVOLUTION_TABLE）

进化阶段与现有养成系统完全对齐。视觉表现由 formProgress 连续驱动，阶段只是语义标签。

| 阶段 | 英文 | Emoji | formProgress | 视觉特征 |
|------|------|-------|:---:|----------|
| 混沌 | egg | ◌ | 0-15 | 发光球体，无形态特征 |
| 初现 | hatching | ◎ | 15-40 | 球体开始变形，隐约凸起 |
| 成长 | growing | ◉ | 40-70 | 耳朵/眼睛/尾巴逐步出现 |
| 成形 | formed | ● | 70-85 | 完整形态，细节填充 |
| 成熟 | mature | ✦ | 85-92 | 纹路精致，光环初现 |
| 圆满 | complete | ✧ | 92-98 | 翅膀出现，光环稳定 |
| 传说 | legendary | ★ | 98-100 | 双重光环，环绕粒子 |

### 2.2 formProgress 驱动的连续视觉变化

```typescript
/**
 * formProgress → morph target weights
 * 这是整个系统的核心映射
 *
 * formProgress 0%   → 所有 weights = 0 → 输出球体
 * formProgress 100% → 所有 weights = 目标值 → 完整生物
 */
function formProgressToWeights(progress: number, gene: BuddyGenome): number[] {
  const t = progress / 100; // 0→1

  // S 曲线：早期慢，中期快，后期慢（更自然的成长感）
  const ease = t < 0.3 ? t * t / 0.18 :      // 0~0.3: 加速
               t < 0.7 ? (t - 0.15) / 0.7 :   // 0.3~0.7: 线性
               1 - (1 - t) * (1 - t) / 0.18;  // 0.7~1: 减速

  return [
    // morph target 0: 耳朵 — 从 30% 开始出现
    clamp((ease - 0.3) / 0.5, 0, 1) * gene.earSize,
    // morph target 1: 眼睛 — 从 40% 开始出现
    clamp((ease - 0.4) / 0.4, 0, 1) * gene.eyeSize,
    // morph target 2: 尾巴 — 从 35% 开始出现
    clamp((ease - 0.35) / 0.5, 0, 1) * gene.tailLength,
    // morph target 3: 身体比例 — 从 20% 开始
    clamp((ease - 0.2) / 0.6, 0, 1) * gene.bodyWidth,
    // morph target 4: 嘴巴 — 从 50% 开始
    clamp((ease - 0.5) / 0.3, 0, 1) * gene.mouthSize,
    // morph target 5: 纹路 — 从 60% 开始
    clamp((ease - 0.6) / 0.3, 0, 1) * gene.patternDensity,
    // morph target 6: 角 — 从 70% 开始（需要知识深度）
    clamp((ease - 0.7) / 0.2, 0, 1) * gene.hornSize,
    // morph target 7: 翅膀 — 从 80% 开始（高进化阶段）
    clamp((ease - 0.8) / 0.15, 0, 1) * gene.wingSize,
  ];
}
```

### 2.3 进化阶段的附加视觉效果

formProgress 驱动 morph weights 是核心。进化阶段在此基础上叠加附加效果：

| 阶段 | 附加效果 |
|------|---------|
| egg/hatching | 表面有微弱光晕（Shader uniform 控制） |
| growing | 光晕减弱，形态清晰 |
| formed | 形态稳定，开始有纹路 |
| mature | 光环出现（额外的 Three.js 圆环） |
| complete | 翅膀有光泽，光环稳定 |
| legendary | 双重光环 + 环绕粒子（粒子系统） |

这些附加效果通过 Shader uniform 和 Three.js 对象叠加，不影响核心 morph 流程。

---

## 3. 基因组系统 (BuddyGenome)

### 3.1 基因来源：Onboarding 锚点 + 五维涌现

**Onboarding 确定三个锚点（不可变）：**

```
Onboarding 选择 → VisualSeed
  ├── primaryColor: string    主色调
  ├── texture: TextureType    质感（光滑/通透/锋利/温润）
  └── temperament: TemperamentType  气质（温暖/冷静/活泼/神秘）
```

**其余全部从交互行为中涌现，没有预设模板：**

```
涌现维度 1: 行为信号（PetManager.computeBehaviorSignals）
  → 身材比例、嘴巴形态、动态特征
  → 映射：patience→圆润度, chaos→摇摆幅度, snark→嘴巴曲线

涌现维度 2: OCEAN 大五人格（PetManager.getOcean）
  → 五官特征、表情倾向、耳朵形态
  → 映射：openness→眼睛大小, extraversion→耳朵外张, agreeableness→眼角弧度

涌现维度 3: 认知模型（CognitiveEngine.getUserProfile）
  → 纹路/装饰风格
  → 映射：techStack→纹路密度, askStyle→纹路样式, detailLevel→装饰量

涌现维度 4: 知识深度（CognitiveEngine.getAllDomainProfiles）
  → 附属物（角/翅膀/光环）
  → 映射：trainable领域数→角, mature领域数→翅膀, 领域总数→装饰复杂度

涌现维度 5: 情绪/欲望（BodyStateManager）
  → 动态特征（呼吸/摇摆/光晕强度）
  → 映射：energy→呼吸频率, rest→光晕衰减, expression→粒子密度
```

### 3.2 参数空间定义

```typescript
interface BuddyGenome {
  // ===== 体型 (5 维) — 来源：行为信号 =====
  bodyHeight: number;       // 0.7 ~ 1.3    高挑↔矮壮
  bodyWidth: number;        // 0.6 ~ 1.4    纤细↔宽厚
  bodyDepth: number;        // 0.7 ~ 1.3    前后厚度
  bodyRoundness: number;    // 0 ~ 1        棱角↔圆润
  headSize: number;         // 0.7 ~ 1.3    头身比

  // ===== 面部 (6 维) — 来源：OCEAN 人格 =====
  eyeSize: number;          // 0.5 ~ 1.5    眼睛大小
  eyeSpacing: number;       // 0.7 ~ 1.3    眼距
  eyeShape: number;         // 0 ~ 1        圆眼→杏仁眼
  eyeAngle: number;         // -15 ~ 15°    眼角倾斜
  pupilSize: number;        // 0.3 ~ 0.8    瞳孔占比
  eyeHighlight: number;     // 0 ~ 1        高光强度

  // ===== 耳朵 (4 维) — 来源：OCEAN 外倾性 =====
  earSize: number;          // 0.3 ~ 2.0    耳朵大小
  earPosition: number;      // 0 ~ 1        位置(头顶→侧面)
  earShape: number;         // 0 ~ 1        圆耳→尖耳
  earAngle: number;         // -30 ~ 30°    外张角度

  // ===== 嘴巴 (2 维) — 来源：行为信号(snark) =====
  mouthSize: number;        // 0.3 ~ 1.2    嘴巴大小
  mouthShape: number;       // 0 ~ 1        圆润→锐利

  // ===== 附属物 (5 维) — 来源：知识深度 =====
  tailLength: number;       // 0 ~ 2.0      尾巴长度(0=无尾巴)
  tailCurve: number;        // 0 ~ 1        弯曲度
  wingSize: number;         // 0 ~ 1.5      翅膀大小(0=无翅膀)
  hornSize: number;         // 0 ~ 1        角大小(0=无角)
  hornStyle: number;        // 0 ~ 1        角→触须→光角

  // ===== 纹路 (3 维) — 来源：认知模型 =====
  patternDensity: number;   // 0 ~ 1        纹路密度
  patternStyle: number;     // 0 ~ 1        点→条纹→环→星
  patternSpread: number;    // 0 ~ 1        集中→分散

  // ===== 颜色 (1 维) — 来源：Onboarding 种子派生 =====
  secondaryColor: string;   // 副色 hex
  colorGradient: number;    // 0 ~ 1        渐变方向

  // ===== 动态 (2 维) — 来源：行为信号 + 情绪 =====
  breatheSpeed: number;     // 0.5 ~ 2.0    呼吸频率
  swayAmount: number;       // 0 ~ 1        摇摆幅度
}
```

**总计 30 个参数。没有物种模板，没有预设基线，全部由涌现维度计算。**

### 3.3 基因涌现流程

```typescript
/**
 * 从交互上下文计算基因组
 * 不依赖任何物种表/模板，纯粹从涌现维度推导
 */
function computeGenome(ctx: {
  // Onboarding 锚点（不可变）
  visualSeed: VisualSeed;
  
  // 涌现维度（持续变化）
  behaviorSignals: BehaviorSignals;
  ocean: OceanPersonality;
  userProfile: UserProfile;
  domainProfiles: DomainProfile[];
  emotionEnergy: number;
  desires: DesireVector;
  
  // 成长状态
  evolutionStage: EvolutionStage;
  formProgress: number;
  personalityStrength: number;
}): BuddyGenome {
  
  const rng = seedrandom(ctx.visualSeed.seed.toString());
  const gauss = () => {
    const u1 = rng(); const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  
  // PS 控制基因凝聚度：PS=0 时噪声大（混沌），PS=1 时精确
  const ps = ctx.personalityStrength;
  const noise = (base: number, spread: number) => 
    base + gauss() * spread * (1 - ps * 0.8);
  
  const bs = ctx.behaviorSignals;
  const ocean = ctx.ocean;
  const profile = ctx.userProfile;
  const domains = ctx.domainProfiles;
  
  // ── 体型：行为信号驱动 ──
  // patience 高 → 圆润稳重；chaos 高 → 瘦削灵活
  const bodyRoundness = clamp(0.5 + (bs.patience - 50) / 200 - (bs.chaos - 50) / 300, 0, 1);
  // wisdom 高 → 标准身材；chaos 高 → 瘦小
  const bodyHeight = noise(1.0 + (bs.wisdom - 50) / 400, 0.1);
  // debugging 高 → 壮实；snark 高 → 纤细
  const bodyWidth = noise(1.0 + (bs.debugging - 50) / 300 - (bs.snark - 50) / 400, 0.1);
  const bodyDepth = noise(1.0, 0.1);
  // 头身比：openness 高 → 大头（卡通感），conscientiousness 高 → 小头（写实感）
  const headSize = noise(1.0 + (ocean.openness - 50) / 300 - (ocean.conscientiousness - 50) / 400, 0.1);
  
  // ── 面部：OCEAN 驱动 ──
  // openness 高 → 大眼（好奇），低 → 小眼（内敛）
  const eyeSize = noise(1.0 + (ocean.openness - 50) / 200, 0.15);
  // extraversion 高 → 眼距宽（外向），低 → 眼距窄（聚焦）
  const eyeSpacing = noise(1.0 + (ocean.extraversion - 50) / 300, 0.1);
  // openness 高 → 圆眼，conscientiousness 高 → 杏仁眼
  const eyeShape = clamp(ocean.openness / 100, 0, 1);
  // agreeableness 高 → 眼角下垂（温和），低 → 眼角上挑（锐利）
  const eyeAngle = (ocean.agreeableness - 50) * 0.3;
  const pupilSize = noise(0.5 + ocean.openness / 300, 0.1);
  const eyeHighlight = noise(0.5 + ocean.extraversion / 300, 0.1);
  
  // ── 耳朵：extraversion 驱动 ──
  // extraversion 高 → 大耳外张，低 → 小耳贴头
  const earSize = noise(0.8 + ocean.extraversion / 200, 0.2);
  const earPosition = noise(0.5, 0.15);
  const earShape = clamp(ocean.extraversion / 100, 0, 1);
  const earAngle = ocean.extraversion * 0.6 - 30;
  
  // ── 嘴巴：snark 驱动 ──
  // snark 高 → 锐利嘴，低 → 圆润嘴
  const mouthShape = clamp(bs.snark / 100, 0, 1);
  const mouthSize = noise(0.5 + bs.snark / 300, 0.1);
  
  // ── 附属物：知识深度驱动 ──
  const matureDomains = domains.filter(d => 
    d.growthStage === 'mature' || d.growthStage === 'trainable'
  ).length;
  const trainableDomains = domains.filter(d => 
    d.growthStage === 'trainable' || d.growthStage === 'mature'
  ).length;
  const totalDomains = domains.filter(d => d.knowledgeCount >= 5).length;
  
  // 尾巴：neuroticism 高 → 长尾（情绪外露），agreeableness 高 → 短尾
  const tailLength = clamp(
    (ocean.neuroticism - 30) / 100 + (100 - ocean.agreeableness) / 300,
    0, 2.0
  );
  const tailCurve = clamp(ocean.neuroticism / 100, 0, 1);
  
  // 翅膀：mature 领域数（知识深度的视觉表达）
  const wingSize = clamp(matureDomains * 0.3, 0, 1.5);
  
  // 角：trainable 领域数（专业深度的视觉表达）
  const hornSize = clamp(trainableDomains * 0.2, 0, 1);
  const hornStyle = clamp(totalDomains / 10, 0, 1);
  
  // ── 纹路：认知模型驱动 ──
  const techStackCount = profile.identity.techStack.length;
  const patternDensity = clamp(techStackCount * 0.1 + bs.wisdom / 200, 0, 1);
  const patternStyle = clamp(
    profile.behavior.preferredDetailLevel === 'thorough' ? 0.8 :
    profile.behavior.preferredDetailLevel === 'brief' ? 0.2 : 0.5,
    0, 1
  );
  const patternSpread = noise(0.5, 0.2);
  
  // ── 颜色：种子派生 ──
  const secondaryColor = deriveSecondary(ctx.visualSeed.seed, ctx.visualSeed.primaryColor);
  const colorGradient = noise(0.5, 0.2);
  
  // ── 动态：行为信号 + 情绪 ──
  const breatheSpeed = noise(1.0 + (bs.patience - 50) / 200, 0.1);
  const swayAmount = noise(bs.chaos / 100, 0.1);
  
  const raw = {
    bodyHeight, bodyWidth, bodyDepth, bodyRoundness, headSize,
    eyeSize, eyeSpacing, eyeShape, eyeAngle, pupilSize, eyeHighlight,
    earSize, earPosition, earShape, earAngle,
    mouthSize, mouthShape,
    tailLength, tailCurve, wingSize, hornSize, hornStyle,
    patternDensity, patternStyle, patternSpread,
    secondaryColor, colorGradient,
    breatheSpeed, swayAmount,
  };
  
  // 审美修正：确保输出好看
  return aestheticRefinement(raw);
}

// ── 审美规则引擎 ──

/**
 * 对涌现基因做审美修正
 * 两层约束：
 *   第一层 — 不残（硬约束）：比例不失调
 *   第二层 — 好看（软约束）：推向审美区间
 */
function aestheticRefinement(gene: BuddyGenome): BuddyGenome {
  const g = { ...gene };

  // ══════════════════════════════════════════
  // 第一层：不残（硬约束）
  // ══════════════════════════════════════════

  // 头不能超过身体的 2 倍
  g.headSize = clamp(g.headSize, g.bodyHeight * 0.5, g.bodyHeight * 2.0);
  // 耳朵不能比头大
  g.earSize = clamp(g.earSize, 0.3, g.headSize * 1.0);
  // 尾巴和身体协调
  g.tailLength = clamp(g.tailLength, 0, g.bodyHeight * 2.0);
  // 翅膀和躯干协调
  g.wingSize = clamp(g.wingSize, 0, g.bodyWidth * 2.5);
  // 眼距在合理范围
  g.eyeSpacing = clamp(g.eyeSpacing, 0.7, 1.3);
  // 角不能比头大
  g.hornSize = clamp(g.hornSize, 0, g.headSize * 1.0);

  // ══════════════════════════════════════════
  // 第二层：好看（软约束）
  // ══════════════════════════════════════════

  // 1. 头身比：推向最近的"好看区间"
  //    可爱区间：headRatio 0.25-0.35（大头卡通）
  //    写实区间：headRatio 0.12-0.17（正常比例）
  //    中间地带 0.17-0.25 不好看，推向最近端
  const headRatio = g.headSize / g.bodyHeight;
  if (headRatio > 0.17 && headRatio < 0.25) {
    g.headSize = headRatio < 0.2
      ? g.bodyHeight * 0.15   // 推向写实
      : g.bodyHeight * 0.30;  // 推向可爱
  }

  // 2. 左右对称：眼睛/耳朵基本镜像，保留轻微不对称的有机感
  g.eyeSpacing = clamp(g.eyeSpacing, 0.85, 1.15);

  // 3. 细节密度一致：附属物总量有上限
  //    不能身体很简洁，头上插满装饰
  const accessoryLoad = g.earSize + g.hornSize + g.wingSize + g.tailLength;
  const accessoryCap = 4.0;
  if (accessoryLoad > accessoryCap) {
    const scale = accessoryCap / accessoryLoad;
    g.earSize *= scale;
    g.hornSize *= scale;
    g.wingSize *= scale;
    g.tailLength *= scale;
  }

  // 4. 视觉重心：头大→下半身加宽，保持稳定感
  if (g.headSize > 1.1) {
    g.bodyWidth = Math.max(g.bodyWidth, g.headSize * 0.7);
  }

  // 5. 眼睛大小和头协调：眼睛不能占满整张脸
  g.eyeSize = clamp(g.eyeSize, 0.5, g.headSize * 0.6);

  // 6. 嘴巴不能比脸宽
  g.mouthSize = clamp(g.mouthSize, 0.3, 0.8);

  return g;
}
```

---

## 4. 基础网格与 Morph Targets

### 4.1 基础形态

基础网格是一个光滑的椭球体（SphereGeometry 变形），细分 64×32。所有 morph target 共享同一拓扑。

```
基础网格 (morph weights 全 = 0)
  └── 光滑椭球体 ← 就是"光团"的形态

morph target 0: 大耳朵
morph target 1: 尖耳朵
morph target 2: 大圆眼
morph target 3: 杏仁眼
morph target 4: 胖身体
morph target 5: 瘦身体
morph target 6: 长尾巴
morph target 7: 蓬松尾巴
morph target 8: 弯尾巴
morph target 9: 尖角
morph target 10: 触须
morph target 11: 大翅膀
morph target 12: 锐利翅膀
morph target 13: 厚嘴唇
morph target 14: 三角嘴
morph target 15: 密纹路
morph target 16: 条纹纹路
...
```

### 4.2 Morph Target 生成

每个 morph target 是基础网格的一个变形版本，由基因参数定义：

```typescript
/**
 * 生成一个 morph target 的顶点位置
 * 基于基础球体 + 基因参数驱动的变形
 */
function generateMorphTarget(
  basePositions: Float32Array,  // 基础球体顶点
  gene: BuddyGenome,
  target: MorphTargetType,
): Float32Array {
  const positions = new Float32Array(basePositions.length);
  
  for (let i = 0; i < positions.length; i += 3) {
    let x = basePositions[i];
    let y = basePositions[i + 1];
    let z = basePositions[i + 2];
    
    switch (target) {
      case 'bigEars': {
        // 耳朵区域的顶点向外拉伸
        const earZone = smoothstep(-0.3, 0.3, y) * (1 - smoothstep(0.1, 0.5, Math.abs(x)));
        const earDir = normalize(vec3(x, y + 0.5, z));
        const earLen = gene.earSize * 0.3;
        x += earDir.x * earLen * earZone;
        y += earDir.y * earLen * earZone;
        z += earDir.z * earLen * earZone;
        break;
      }
      case 'bigEyes': {
        // 眼睛区域凹陷 + 眼球凸起
        const eyeZoneL = 1 - smoothstep(0, 0.15, length(vec3(x + 0.15, y - 0.1, z - 0.4)));
        const eyeZoneR = 1 - smoothstep(0, 0.15, length(vec3(x - 0.15, y - 0.1, z - 0.4)));
        const eyeScale = gene.eyeSize * 0.1;
        z += (eyeZoneL + eyeZoneR) * eyeScale;
        break;
      }
      case 'longTail': {
        // 后部顶点向后拉伸
        const tailZone = smoothstep(0.2, -0.8, z) * smoothstep(-0.5, 0.5, y);
        z -= gene.tailLength * 0.5 * tailZone;
        break;
      }
      // ... 其他 morph targets
    }
    
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
  
  return positions;
}
```

### 4.3 Three.js Morph Attributes 集成

```typescript
class BuddyModel {
  private mesh: THREE.SkinnedMesh;
  private morphWeights: number[];
  
  constructor(gene: BuddyGenome) {
    // 基础网格：光滑椭球体
    const baseGeo = new THREE.SphereGeometry(1, 64, 32);
    
    // 生成所有 morph targets
    const morphTargets = [
      'bigEars', 'pointyEars', 'bigRoundEyes', 'almondEyes',
      'fatBody', 'slimBody', 'longTail', 'fluffyTail', 'curvedTail',
      'horns', 'antennae', 'bigWings', 'sharpWings',
      'thickLips', 'triangleMouth', 'densePattern', 'stripePattern',
    ];
    
    baseGeo.morphAttributes.position = morphTargets.map(target => 
      new THREE.Float32BufferAttribute(
        generateMorphTarget(baseGeo.attributes.position.array, gene, target),
        3
      )
    );
    
    // 材质
    const material = createPBRMaterial(gene);
    
    // 骨骼
    this.skeleton = createSkeleton(gene);
    
    // 创建 mesh
    this.mesh = new THREE.SkinnedMesh(baseGeo, material);
    this.mesh.add(this.skeleton.bones[0]);
    this.mesh.bind(this.skeleton);
    
    // 初始 weights = 0（球体）
    this.morphWeights = morphTargets.map(() => 0);
  }
  
  /**
   * 更新 formProgress → 更新 morph weights
   * 每次 formProgress 变化时调用
   */
  updateProgress(progress: number, gene: BuddyGenome) {
    const weights = formProgressToWeights(progress, gene);
    weights.forEach((w, i) => {
      this.mesh.morphTargetInfluences[i] = w;
    });
    this.morphWeights = weights;
  }
  
  /**
   * 基因变化时重新生成 morph targets
   * 只在基因参数显著变化时调用（不是每帧）
   */
  rebuildMorphTargets(gene: BuddyGenome) {
    const geo = this.mesh.geometry;
    const morphTargets = [...]; // 同上
    
    geo.morphAttributes.position = morphTargets.map(target =>
      new THREE.Float32BufferAttribute(
        generateMorphTarget(geo.attributes.position.array, gene, target),
        3
      )
    );
    
    // 重新应用当前 weights
    this.updateProgress(/* current progress */, gene);
  }
  
  getMesh(): THREE.SkinnedMesh { return this.mesh; }
}
```

---

## 5. 程序化材质系统

### 5.1 PBR Shader

```glsl
// buddy-material.vert
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

```glsl
// buddy-material.frag
uniform vec3 u_primaryColor;
uniform vec3 u_secondaryColor;
uniform float u_seed;
uniform float u_textureStyle;   // 0=光滑 1=毛绒 2=鳞片 3=岩石
uniform float u_colorGradient;
uniform float u_patternStyle;
uniform float u_patternDensity;
uniform float u_time;
uniform float u_energy;
uniform float u_glowIntensity;  // 早期阶段更强的发光

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

float snoise(vec3 v);

void main() {
  // 基础颜色
  float gradient = mix(vUv.y, vUv.x, u_colorGradient);
  vec3 baseColor = mix(u_primaryColor, u_secondaryColor, gradient * 0.6);

  // 程序化纹理
  float texNoise = snoise(vWorldPos * (5.0 + u_patternDensity * 15.0) + u_seed);
  
  float roughness, metallic;
  
  if (u_textureStyle < 0.5) {
    roughness = 0.3 + texNoise * 0.05;
    metallic = 0.0;
  } else if (u_textureStyle < 1.5) {
    roughness = 0.75 + texNoise * 0.1;
    metallic = 0.0;
    vec3 furDir = normalize(vec3(
      snoise(vWorldPos * 20.0 + vec3(0, 0, u_seed)),
      snoise(vWorldPos * 20.0 + vec3(100, 0, u_seed)),
      snoise(vWorldPos * 20.0 + vec3(0, 100, u_seed))
    ));
    vNormal = normalize(vNormal + furDir * 0.15);
  } else if (u_textureStyle < 2.5) {
    vec2 scaleUV = vUv * (10.0 + u_patternDensity * 20.0);
    float checker = step(0.5, fract(scaleUV.x)) * step(0.5, fract(scaleUV.y));
    roughness = 0.15 + checker * 0.3;
    metallic = 0.2 + checker * 0.2;
  } else {
    roughness = 0.6 + texNoise * 0.2;
    metallic = 0.1;
  }

  // 纹路叠加
  if (u_patternStyle < 0.25) {
    vec2 dotUV = fract(vUv * (5.0 + u_patternDensity * 10.0));
    float dot = smoothstep(0.3, 0.35, length(dotUV - 0.5));
    baseColor = mix(u_secondaryColor, baseColor, dot);
  } else if (u_patternStyle < 0.5) {
    float stripe = smoothstep(0.4, 0.5, fract(vUv.y * (8.0 + u_patternDensity * 15.0)));
    baseColor = mix(u_secondaryColor, baseColor, stripe);
  }

  // PBR 光照
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(2.0, 3.0, 4.0));
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);

  vec3 diffuse = baseColor * NdotL * 0.8;
  vec3 specular = vec3(1.0) * pow(NdotH, 32.0 / (roughness + 0.01)) * (1.0 - roughness);
  vec3 ambient = baseColor * 0.25;

  // 情绪发光
  vec3 emission = u_primaryColor * u_energy * 0.15;

  // 早期阶段更强的边缘发光（光团感）
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 fresnelGlow = u_primaryColor * fresnel * u_glowIntensity;

  vec3 finalColor = ambient + diffuse + specular + emission + fresnelGlow;
  gl_FragColor = vec4(finalColor, 1.0);
}
```

### 5.2 材质创建

```typescript
function createPBRMaterial(gene: BuddyGenome, visualSeed: VisualSeed): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: buddyVertexShader,
    fragmentShader: buddyFragmentShader,
    uniforms: {
      u_primaryColor:   { value: new THREE.Color(visualSeed.primaryColor) },
      u_secondaryColor: { value: new THREE.Color(gene.secondaryColor) },
      u_seed:           { value: gene.bodyRoundness },
      u_textureStyle:   { value: textureToNumber(visualSeed.texture) },
      u_colorGradient:  { value: gene.colorGradient },
      u_patternStyle:   { value: gene.patternStyle },
      u_patternDensity: { value: gene.patternDensity },
      u_time:           { value: 0 },
      u_energy:         { value: 0.5 },
      u_glowIntensity:  { value: 1.0 }, // 由 formProgress 驱动
    },
  });
}
```

---

## 6. 渲染管线

### 6.1 渲染引擎：Three.js WebGPU

使用 Three.js r170+ 的 WebGPU 渲染器，自动 fallback 到 WebGL2。

```typescript
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';

async function createRenderer(container: HTMLElement): Promise<THREE.WebGLRenderer | WebGPURenderer> {
  // 优先 WebGPU
  if (navigator.gpu) {
    try {
      const renderer = new WebGPURenderer({ alpha: true, antialias: true });
      await renderer.init();
      return renderer;
    } catch { /* fallback */ }
  }
  // 回退 WebGL2
  return new THREE.WebGLRenderer({ alpha: true, antialias: true });
}
```

WebGPU 优势：compute shader（粒子系统）、更好的多线程、更高效的 draw call。

### 6.2 形态方案：程序化顶点位移 + Morph Targets 混合

**程序化位移（Vertex Shader）** 驱动连续形态变化：
- 身材比例（高矮胖瘦）— 30 个基因参数中的连续值，每帧在 GPU 上算
- 人形程度（卡通↔写实）— 一个 uniform 控制全局比例

**Morph Targets** 驱动离散细节变化：
- 面部表情（微笑/皱眉/惊讶）
- 耳朵形状变化
- 嘴型变化

```typescript
// 身材比例：Vertex Shader 内的程序化位移
const bodyProportionUniforms = {
  u_bodyHeight:    { value: 1.0 },  // 基因参数
  u_bodyWidth:     { value: 1.0 },
  u_bodyRoundness: { value: 0.5 },
  u_headSize:      { value: 1.0 },
  u_earSize:       { value: 0.8 },
  u_earAngle:      { value: 0.0 },
  u_tailLength:    { value: 0.0 },
  // ... 所有连续参数都是 uniform
};

// 面部表情：Morph Targets
const facialMorphs = [
  'smile', 'frown', 'surprise', 'squint',
  'mouthOpen', 'browUp', 'browDown',
];
```

Vertex Shader 核心：
```glsl
// buddy.vert — 程序化身材变形
uniform float u_bodyHeight;
uniform float u_bodyWidth;
uniform float u_bodyRoundness;
uniform float u_headSize;
uniform float u_earSize;
uniform float u_earAngle;
uniform float u_tailLength;
uniform float u_wingSize;
uniform float u_hornSize;
uniform float u_time;
uniform float u_breatheSpeed;
uniform float u_swayAmount;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 pos = position;
  
  // 1. 身材比例缩放
  pos.y *= u_bodyHeight;
  pos.x *= u_bodyWidth;
  pos.z *= mix(1.0, u_bodyWidth, 0.3); // 前后厚度关联宽度
  
  // 2. 圆润度：棱角→圆润（法线方向偏移）
  float roundFactor = u_bodyRoundness * 0.15;
  pos += normal * roundFactor * (1.0 - abs(normal.y) * 0.5);
  
  // 3. 头身比：头部区域独立缩放
  float headZone = smoothstep(0.3, 0.8, pos.y);
  pos.y += headZone * (u_headSize - 1.0) * 0.5;
  pos.xz *= 1.0 + headZone * (u_headSize - 1.0) * 0.3;
  
  // 4. 耳朵区域拉伸
  float earZone = smoothstep(0.5, 1.0, pos.y) * (1.0 - smoothstep(0.0, 0.5, abs(pos.x)));
  vec3 earDir = normalize(vec3(pos.x, 0.8, 0.0));
  pos += earDir * u_earSize * 0.2 * earZone;
  
  // 5. 尾巴区域拉伸
  float tailZone = smoothstep(0.2, -0.8, pos.z) * smoothstep(-0.3, 0.3, pos.y);
  pos.z -= u_tailLength * 0.5 * tailZone;
  
  // 6. 翅膀区域扩展
  float wingZone = smoothstep(0.2, 0.8, abs(pos.x)) * smoothstep(0.0, 0.5, pos.y);
  pos.x += sign(pos.x) * u_wingSize * 0.3 * wingZone;
  
  // 7. 角区域拉伸
  float hornZone = smoothstep(0.7, 1.0, pos.y) * (1.0 - smoothstep(0.0, 0.3, abs(pos.x)));
  pos.y += u_hornSize * 0.3 * hornZone;
  
  // 8. 呼吸动画
  float breath = sin(u_time * u_breatheSpeed) * 0.02;
  pos.y *= 1.0 + breath;
  
  // 9. 摇摆动画
  pos.x += sin(u_time * 0.5) * u_swayAmount * 0.02;
  
  // 输出
  vNormal = normalize(normalMatrix * normal);
  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

### 6.3 材质：MeshStandardMaterial + onBeforeCompile 扩展

**用 Three.js 内置 PBR，只注入自定义逻辑。** 不从零写 Shader。

```typescript
function createBuddyMaterial(gene: BuddyGenome, visualSeed: VisualSeed): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(visualSeed.primaryColor),
    roughness: 0.4,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    // 注入自定义 uniforms
    shader.uniforms.u_primaryColor = { value: new THREE.Color(visualSeed.primaryColor) };
    shader.uniforms.u_secondaryColor = { value: new THREE.Color(gene.secondaryColor) };
    shader.uniforms.u_seed = { value: gene.bodyRoundness };
    shader.uniforms.u_textureStyle = { value: textureToNumber(visualSeed.texture) };
    shader.uniforms.u_patternStyle = { value: gene.patternStyle };
    shader.uniforms.u_patternDensity = { value: gene.patternDensity };
    shader.uniforms.u_colorGradient = { value: gene.colorGradient };
    shader.uniforms.u_time = { value: 0 };
    shader.uniforms.u_energy = { value: 0.5 };
    shader.uniforms.u_glowIntensity = { value: 1.0 };

    // 注入 vertex shader：程序化身材变形
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      // 程序化变形（同 buddy.vert 逻辑）
      transformed.y *= u_bodyHeight;
      transformed.x *= u_bodyWidth;
      // ... 其余变形
      `
    );

    // 注入 fragment shader：程序化纹路 + 发光
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // 程序化纹路
      float texNoise = snoise3D(vWorldPos * (5.0 + u_patternDensity * 15.0) + u_seed);
      vec3 patternColor = mix(u_primaryColor, u_secondaryColor, texNoise * 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, patternColor, u_patternDensity * 0.5);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `
      #include <output_fragment>
      // 情绪发光
      vec3 emission = u_primaryColor * u_energy * 0.15;
      // 早期阶段边缘发光（光团感）
      float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(cameraPosition - vWorldPos)), 0.0), 3.0);
      emission += u_primaryColor * fresnel * u_glowIntensity * 0.3;
      gl_FragColor.rgb += emission;
      `
    );

    // 存 shader 引用，后续更新 uniform
    material.userData.shader = shader;
  };

  return material;
}
```

**优势**：
- Three.js 处理光照、阴影、环境贴图、tonemapping — 不用自己写
- 只注入纹路、发光、身材变形 — 自定义部分最小化
- 自动兼容 Three.js 后处理管线

### 6.4 骨骼系统：完整人形骨架

```typescript
function createHumanoidSkeleton(gene: BuddyGenome): THREE.Skeleton {
  const bones: THREE.Bone[] = [];

  // 根骨骼
  const root = new THREE.Bone(); root.name = 'root';
  
  // 躯干
  const spine = new THREE.Bone(); spine.name = 'spine';
  const chest = new THREE.Bone(); chest.name = 'chest';
  const neck = new THREE.Bone(); neck.name = 'neck';
  const head = new THREE.Bone(); head.name = 'head';
  
  // 面部骨骼
  const jaw = new THREE.Bone(); jaw.name = 'jaw';           // 下巴
  const browL = new THREE.Bone(); browL.name = 'brow_l';    // 左眉
  const browR = new THREE.Bone(); browR.name = 'brow_r';    // 右眉
  const eyeLidL = new THREE.Bone(); eyeLidL.name = 'eyelid_l'; // 左眼皮
  const eyeLidR = new THREE.Bone(); eyeLidR.name = 'eyelid_r'; // 右眼皮
  const lipL = new THREE.Bone(); lipL.name = 'lip_l';       // 左嘴角
  const lipR = new THREE.Bone(); lipR.name = 'lip_r';       // 右嘴角
  
  // 耳朵
  const earL = new THREE.Bone(); earL.name = 'ear_l';
  const earR = new THREE.Bone(); earR.name = 'ear_r';
  
  // 上肢
  const shoulderL = new THREE.Bone(); shoulderL.name = 'shoulder_l';
  const elbowL = new THREE.Bone(); elbowL.name = 'elbow_l';
  const handL = new THREE.Bone(); handL.name = 'hand_l';
  const shoulderR = new THREE.Bone(); shoulderR.name = 'shoulder_r';
  const elbowR = new THREE.Bone(); elbowR.name = 'elbow_r';
  const handR = new THREE.Bone(); handR.name = 'hand_r';
  
  // 下肢
  const hipL = new THREE.Bone(); hipL.name = 'hip_l';
  const kneeL = new THREE.Bone(); kneeL.name = 'knee_l';
  const footL = new THREE.Bone(); footL.name = 'foot_l';
  const hipR = new THREE.Bone(); hipR.name = 'hip_r';
  const kneeR = new THREE.Bone(); kneeR.name = 'knee_r';
  const footR = new THREE.Bone(); footR.name = 'foot_r';
  
  // 附属物（基因驱动，可能不存在）
  const tail = gene.tailLength > 0 ? new THREE.Bone() : null;
  if (tail) tail.name = 'tail';
  const wingL = gene.wingSize > 0 ? new THREE.Bone() : null;
  if (wingL) wingL.name = 'wing_l';
  const wingR = gene.wingSize > 0 ? new THREE.Bone() : null;
  if (wingR) wingR.name = 'wing_r';

  // 骨骼层级
  root.add(spine);
  spine.add(chest);
  chest.add(neck);
  neck.add(head);
  head.add(jaw);
  head.add(browL); head.add(browR);
  head.add(eyeLidL); head.add(eyeLidR);
  head.add(lipL); head.add(lipR);
  head.add(earL); head.add(earR);
  chest.add(shoulderL); chest.add(shoulderR);
  shoulderL.add(elbowL); elbowL.add(handL);
  shoulderR.add(elbowR); elbowR.add(handR);
  spine.add(hipL); spine.add(hipR);
  hipL.add(kneeL); kneeL.add(footL);
  hipR.add(kneeR); kneeR.add(footR);
  if (tail) spine.add(tail);
  if (wingL) chest.add(wingL);
  if (wingR) chest.add(wingR);

  // 骨骼位置由基因参数决定
  const h = gene.bodyHeight;
  const w = gene.bodyWidth;
  
  spine.position.set(0, 0, 0);
  chest.position.set(0, 0.3 * h, 0);
  neck.position.set(0, 0.25 * h, 0);
  head.position.set(0, 0.2 * h, 0);
  
  // 面部
  jaw.position.set(0, -0.08 * gene.headSize, 0.05);
  browL.position.set(-0.04 * gene.eyeSpacing, 0.06, 0.08);
  browR.position.set(0.04 * gene.eyeSpacing, 0.06, 0.08);
  eyeLidL.position.set(-0.04 * gene.eyeSpacing, 0.02, 0.08);
  eyeLidR.position.set(0.04 * gene.eyeSpacing, 0.02, 0.08);
  lipL.position.set(-0.02, -0.04, 0.08);
  lipR.position.set(0.02, -0.04, 0.08);
  earL.position.set(-0.08 * gene.earSize, 0.05, 0);
  earR.position.set(0.08 * gene.earSize, 0.05, 0);
  earL.rotation.z = -gene.earAngle * Math.PI / 180;
  earR.rotation.z = gene.earAngle * Math.PI / 180;
  
  // 上肢
  shoulderL.position.set(-0.15 * w, 0.2 * h, 0);
  elbowL.position.set(-0.12 * w, -0.12 * h, 0);
  handL.position.set(0, -0.12 * h, 0);
  shoulderR.position.set(0.15 * w, 0.2 * h, 0);
  elbowR.position.set(0.12 * w, -0.12 * h, 0);
  handR.position.set(0, -0.12 * h, 0);
  
  // 下肢
  hipL.position.set(-0.06 * w, -0.15 * h, 0);
  kneeL.position.set(0, -0.15 * h, 0);
  footL.position.set(0, -0.15 * h, 0.03);
  hipR.position.set(0.06 * w, -0.15 * h, 0);
  kneeR.position.set(0, -0.15 * h, 0);
  footR.position.set(0, -0.15 * h, 0.03);
  
  // 附属物
  if (tail) {
    tail.position.set(0, -0.05 * h, -0.15 * gene.bodyDepth);
  }
  if (wingL) {
    wingL.position.set(-0.12 * w, 0.15 * h, -0.05);
  }
  if (wingR) {
    wingR.position.set(0.12 * w, 0.15 * h, -0.05);
  }

  bones.push(root, spine, chest, neck, head,
    jaw, browL, browR, eyeLidL, eyeLidR, lipL, lipR, earL, earR,
    shoulderL, elbowL, handL, shoulderR, elbowR, handR,
    hipL, kneeL, footL, hipR, kneeR, footR);
  if (tail) bones.push(tail);
  if (wingL) bones.push(wingL);
  if (wingR) bones.push(wingR);

  return new THREE.Skeleton(bones);
}
```

### 6.5 面部表情系统

面部骨骼 + morph targets 驱动表情，对接情绪系统：

```typescript
interface FacialExpression {
  browL: number;      // -1 皱眉 ~ +1 挑眉
  browR: number;
  eyeLidL: number;    // 0 睁眼 ~ 1 闭眼
  eyeLidR: number;
  jaw: number;        // 0 闭嘴 ~ 1 张嘴
  lipL: number;       // -1 下拉 ~ +1 上扬
  lipR: number;
}

/** 情绪 → 面部表情映射 */
const EMOTION_FACIAL: Record<string, FacialExpression> = {
  happy:     { browL: 0.3, browR: 0.3, eyeLidL: 0.1, eyeLidR: 0.1, jaw: 0.2, lipL: 0.8, lipR: 0.8 },
  sad:       { browL: -0.5, browR: -0.5, eyeLidL: 0.3, eyeLidR: 0.3, jaw: 0, lipL: -0.5, lipR: -0.5 },
  angry:     { browL: -0.8, browR: -0.8, eyeLidL: 0.2, eyeLidR: 0.2, jaw: 0.1, lipL: -0.3, lipR: -0.3 },
  surprised: { browL: 0.8, browR: 0.8, eyeLidL: 0, eyeLidR: 0, jaw: 0.6, lipL: 0, lipR: 0 },
  thinking:  { browL: 0.2, browR: -0.3, eyeLidL: 0.2, eyeLidR: 0.1, jaw: 0, lipL: 0, lipR: 0.1 },
  tired:     { browL: -0.2, browR: -0.2, eyeLidL: 0.5, eyeLidR: 0.5, jaw: 0.1, lipL: -0.2, lipR: -0.2 },
  calm:      { browL: 0, browR: 0, eyeLidL: 0, eyeLidR: 0, jaw: 0, lipL: 0.1, lipR: 0.1 },
};

/** 应用面部表情到骨骼 */
function applyFacialExpression(skeleton: THREE.Skeleton, expression: FacialExpression) {
  const getBone = (name: string) => skeleton.bones.find(b => b.name === name);
  
  getBone('brow_l')?.rotation.z.set(expression.browL * 0.15);
  getBone('brow_r')?.rotation.z.set(expression.browR * 0.15);
  getBone('eyelid_l')?.rotation.x.set(expression.eyeLidL * 0.3);
  getBone('eyelid_r')?.rotation.x.set(expression.eyeLidR * 0.3);
  getBone('jaw')?.rotation.x.set(expression.jaw * 0.2);
  getBone('lip_l')?.rotation.z.set(expression.lipL * 0.1);
  getBone('lip_r')?.rotation.z.set(expression.lipR * 0.1);
}
```

### 6.6 后处理管线

```typescript
function setupPostProcessing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer);
  
  // Render pass
  composer.addPass(new RenderPass(scene, camera));
  
  // SSAO（环境遮蔽）— 增加体积感
  const ssaoPass = new SSAOPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
  ssaoPass.kernelRadius = 0.5;
  ssaoPass.minDistance = 0.001;
  ssaoPass.maxDistance = 0.1;
  composer.addPass(ssaoPass);
  
  // Bloom（辉光）— 发光效果
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(renderer.domElement.width, renderer.domElement.height),
    0.5,  // strength
    0.4,  // radius
    0.85  // threshold
  );
  composer.addPass(bloomPass);
  
  // Tone Mapping
  const toneMappingPass = new ShaderPass(ToneMapShader);
  composer.addPass(toneMappingPass);
  
  // 色彩校正
  const colorCorrectionPass = new ShaderPass(ColorCorrectionShader);
  composer.addPass(colorCorrectionPass);
  
  return { composer, bloomPass, ssaoPass };
}
```

### 6.7 粒子系统

```typescript
class ParticleSystem {
  private points: THREE.Points;
  private particleCount: number;
  
  constructor(scene: THREE.Scene, gene: BuddyGenome, stage: VisualStage) {
    this.particleCount = stage === 'legendary' ? 200 : stage === 'complete' ? 100 : 50;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);
    
    // 初始化粒子位置（围绕身体散布）
    for (let i = 0; i < this.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.5 + Math.random() * 1.5;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      sizes[i] = 1 + Math.random() * 3;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    // 粒子材质：圆形 + 主色
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(gene.secondaryColor),
      size: 0.03,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }
  
  update(time: number, mood: string) {
    const positions = this.points.geometry.attributes.position;
    
    for (let i = 0; i < this.particleCount; i++) {
      let x = positions.getX(i);
      let y = positions.getY(i);
      let z = positions.getZ(i);
      
      // 上升
      y += 0.005;
      // 绕中心旋转
      const angle = Math.atan2(z, x) + 0.003;
      const radius = Math.sqrt(x * x + z * z);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      // 轻微摇摆
      x += Math.sin(time * 0.01 + i) * 0.002;
      
      // 超出范围重置
      if (y > 2) {
        const newAngle = Math.random() * Math.PI * 2;
        const newRadius = 0.5 + Math.random() * 1.0;
        x = Math.cos(newAngle) * newRadius;
        y = -1;
        z = Math.sin(newAngle) * newRadius;
      }
      
      positions.setXYZ(i, x, y, z);
    }
    
    positions.needsUpdate = true;
  }
}
```

### 6.8 GPU 能力检测 + 自动降级

```typescript
type RenderTier = 'webgpu' | 'high' | 'medium' | 'low' | 'fallback';

async function detectRenderTier(): Promise<RenderTier> {
  // WebGPU
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch { /* fallback */ }
  }
  
  // WebGL
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  if (gl2) {
    const maxTex = gl2.getParameter(gl2.MAX_TEXTURE_SIZE);
    const ext = gl2.getExtension('EXT_color_buffer_float');
    if (maxTex >= 4096 && ext) return 'high';
    return 'medium';
  }
  const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (gl1) return 'low';
  
  return 'fallback';
}
```

| 档次 | 渲染器 | 材质 | 后处理 | 粒子 | 面数 | 骨骼 | 表情 |
|------|--------|------|--------|------|------|------|------|
| webgpu | WebGPU | PBR + 自定义 | Bloom+SSAO+色彩校正 | 200 | 64×32 | 完整人形 | 全部 |
| high | WebGL2 | PBR + 自定义 | Bloom+SSAO | 150 | 64×32 | 完整人形 | 全部 |
| medium | WebGL2 | PBR | Bloom | 80 | 32×16 | 简化 | 基础 |
| low | WebGL2 | Phong | 无 | 30 | 16×8 | 简化 | 无 |
| fallback | Canvas2D | 无 | 无 | 30 | N/A | N/A | Emoji |

### 6.9 统一渲染器

```typescript
class BuddyRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | WebGPURenderer;
  private buddyMesh: THREE.SkinnedMesh;
  private skeleton: THREE.Skeleton;
  private material: THREE.MeshStandardMaterial;
  private particleSystem: ParticleSystem;
  private postProcessing: ReturnType<typeof setupPostProcessing> | null;
  private tier: RenderTier;
  private currentGene: BuddyGenome;
  private currentProgress: number = 0;

  constructor(container: HTMLElement) {
    this.tier = await detectRenderTier();
    
    if (this.tier === 'fallback') {
      this.initCanvas2D(container);
      return;
    }

    // 创建渲染器
    this.renderer = await createRenderer(container);
    
    // 场景
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 3);
    
    // 灯光
    this.scene.add(new THREE.AmbientLight(0x404040, 0.6));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(2, 3, 4);
    mainLight.castShadow = this.tier !== 'low';
    this.scene.add(mainLight);
    
    // 后处理
    if (this.tier === 'webgpu' || this.tier === 'high') {
      this.postProcessing = setupPostProcessing(this.renderer, this.scene, this.camera);
    }
  }

  /** 初始化模型（首次收到基因数据时） */
  initModel(gene: BuddyGenome) {
    this.currentGene = gene;
    
    // 基础网格：人形体
    const geo = this.createHumanoidGeometry(gene);
    
    // 骨骼
    this.skeleton = createHumanoidSkeleton(gene);
    
    // 材质
    this.material = createBuddyMaterial(gene, this.visualSeed);
    
    // Mesh
    this.buddyMesh = new THREE.SkinnedMesh(geo, this.material);
    this.buddyMesh.add(this.skeleton.bones[0]);
    this.buddyMesh.bind(this.skeleton);
    this.scene.add(this.buddyMesh);
    
    // 粒子
    this.particleSystem = new ParticleSystem(this.scene, gene, this.currentStage);
  }

  /** 更新 formProgress → 驱动形态变化 */
  updateProgress(progress: number) {
    this.currentProgress = progress;
    
    // 更新 shader uniforms（身材变形量由 formProgress 调制）
    const shader = this.material.userData.shader;
    if (shader) {
      // 早期：形态模糊（接近球体）
      // 后期：形态精确（基因参数完全体现）
      const t = progress / 100;
      shader.uniforms.u_bodyHeight.value = lerp(1.0, this.currentGene.bodyHeight, t);
      shader.uniforms.u_bodyWidth.value = lerp(1.0, this.currentGene.bodyWidth, t);
      shader.uniforms.u_bodyRoundness.value = lerp(0.8, this.currentGene.bodyRoundness, t);
      shader.uniforms.u_headSize.value = lerp(1.0, this.currentGene.headSize, t);
      shader.uniforms.u_earSize.value = lerp(0, this.currentGene.earSize, Math.max(0, (t - 0.3) / 0.7));
      shader.uniforms.u_tailLength.value = lerp(0, this.currentGene.tailLength, Math.max(0, (t - 0.35) / 0.65));
      shader.uniforms.u_wingSize.value = lerp(0, this.currentGene.wingSize, Math.max(0, (t - 0.7) / 0.3));
      shader.uniforms.u_hornSize.value = lerp(0, this.currentGene.hornSize, Math.max(0, (t - 0.6) / 0.4));
      // 早期发光更强（光团感）
      shader.uniforms.u_glowIntensity.value = Math.max(0, 1 - t);
    }
  }

  /** 更新情绪 → 面部表情 + 粒子 */
  updateEmotion(mood: string, energy: number) {
    const expression = EMOTION_FACIAL[mood] ?? EMOTION_FACIAL.calm;
    applyFacialExpression(this.skeleton, expression);
    this.material.userData.shader?.uniforms.u_energy.value = energy;
    this.particleSystem.updateMood(mood);
  }

  /** 更新基因（基因变化时重建 morph targets） */
  updateGene(gene: BuddyGenome) {
    this.currentGene = gene;
    // 重建 morph targets
    // 更新材质 uniforms
  }

  /** 主动画循环 */
  animate(time: number) {
    requestAnimationFrame(this.animate.bind(this));
    
    const gene = this.currentGene;
    const mesh = this.buddyMesh;
    
    // 呼吸
    const breathScale = 1 + Math.sin(time * gene.breatheSpeed) * 0.02;
    mesh.scale.y = this.baseScale * breathScale;
    
    // 摇摆
    mesh.rotation.z = Math.sin(time * 0.5) * gene.swayAmount * 0.05;
    
    // 骨骼动画（尾巴/翅膀/耳朵）
    this.updateSkeleton(time);
    
    // Shader 时间
    if (this.material.userData.shader) {
      this.material.userData.shader.uniforms.u_time.value = time;
    }
    
    // 粒子
    this.particleSystem.update(time, this.currentMood);
    
    // 渲染
    if (this.postProcessing) {
      this.postProcessing.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
```

### 6.10 服饰与装饰系统

#### 6.10.1 设计原则

服饰是独立于身体 mesh 的附加层，不是身体变形的延伸。

```
身体层（基底）           服饰层（附加）
━━━━━━━━━━━━━           ━━━━━━━━━━━━
程序化 mesh 变形         独立 mesh，挂载到骨骼
Shader 程序化纹路       贴图/独立 Shader
基因参数驱动            商城数据驱动
所有用户共享同一套生成逻辑   每个用户可自由搭配
```

#### 6.10.2 挂载点系统

在骨骼上定义 attach point，服饰 mesh 绑定到对应骨骼：

```typescript
/** 挂载点定义 */
interface AttachPoint {
  boneName: string;       // 绑定的骨骼名
  offset: THREE.Vector3;  // 相对骨骼的偏移
  rotation: THREE.Euler;  // 默认旋转
  scale: number;          // 默认缩放（相对于身体比例）
}

/** 标准挂载点表 */
const ATTACH_POINTS: Record<string, AttachPoint> = {
  // 头部
  head_top:     { boneName: 'head',  offset: [0, 0.12, 0],     rotation: [0, 0, 0], scale: 1.0 },  // 帽子/头饰
  head_front:   { boneName: 'head',  offset: [0, 0.04, 0.08],  rotation: [0, 0, 0], scale: 1.0 },  // 面具/眼镜
  ear_l:        { boneName: 'ear_l', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 耳饰
  ear_r:        { boneName: 'ear_r', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 耳饰

  // 躯干
  chest:        { boneName: 'chest', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 上衣/铠甲
  spine:        { boneName: 'spine', offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 下装/裙子
  neck:         { boneName: 'neck',  offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 围巾/项链

  // 四肢
  shoulder_l:   { boneName: 'shoulder_l', offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },  // 肩饰
  shoulder_r:   { boneName: 'shoulder_r', offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },
  hand_l:       { boneName: 'hand_l',     offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },  // 手持物
  hand_r:       { boneName: 'hand_r',     offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },
  foot_l:       { boneName: 'foot_l',     offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },  // 鞋子
  foot_r:       { boneName: 'foot_r',     offset: [0, 0, 0],   rotation: [0, 0, 0], scale: 1.0 },

  // 背部
  back_upper:   { boneName: 'chest', offset: [0, 0, -0.08],    rotation: [0, 0, 0], scale: 1.0 },  // 背包/披风
  back_lower:   { boneName: 'spine', offset: [0, 0, -0.06],    rotation: [0, 0, 0], scale: 1.0 },

  // 尾巴（如果有）
  tail:         { boneName: 'tail',  offset: [0, 0, 0],        rotation: [0, 0, 0], scale: 1.0 },  // 尾饰

  // 翅膀（如果有）
  wing_l:       { boneName: 'wing_l', offset: [0, 0, 0],       rotation: [0, 0, 0], scale: 1.0 },  // 翅膀装饰
  wing_r:       { boneName: 'wing_r', offset: [0, 0, 0],       rotation: [0, 0, 0], scale: 1.0 },
};
```

#### 6.10.3 服饰数据结构

```typescript
/** 服饰类型 */
type CostumeSlot = 'head' | 'face' | 'upper' | 'lower' | 'back' | 'hands' | 'feet' | 'accessory';

/** 服饰定义（商城数据 → 3D 渲染） */
interface CostumeDef {
  id: string;                   // 'hat_crown', 'costume_wizard'
  slot: CostumeSlot;            // 穿戴槽位
  attachPoints: string[];       // 使用的挂载点（可多个，如披风=背+肩）
  meshType: 'procedural' | 'template';

  // procedural: 从参数程序化生成（适合简单配饰）
  procedural?: {
    shape: 'box' | 'sphere' | 'cylinder' | 'torus' | 'custom';
    params: Record<string, number>;  // 形状参数
    material: {
      color: string;
      roughness: number;
      metalness: number;
      emissive?: string;       // 自发光（适合传说级）
    };
  };

  // template: 预定义 mesh（适合复杂服饰，如铠甲、翅膀装饰）
  template?: {
    meshUrl: string;           // glb/fbx 模板路径
    textureUrl?: string;       // 贴图路径
    morphTargets?: string[];   // 可用的变形目标
  };
}
```

#### 6.10.4 服饰渲染流程

```typescript
class CostumeRenderer {
  private costumeMeshes: Map<string, THREE.Mesh> = new Map();

  /** 装备服饰 */
  equip(costume: CostumeDef, skeleton: THREE.Skeleton, gene: BuddyGenome): void {
    for (const pointName of costume.attachPoints) {
      const point = ATTACH_POINTS[pointName];
      if (!point) continue;

      // 跳过不存在的挂载点（如没尾巴时挂尾饰）
      const bone = skeleton.bones.find(b => b.name === point.boneName);
      if (!bone) continue;

      let mesh: THREE.Mesh;

      if (costume.meshType === 'procedural' && costume.procedural) {
        mesh = this.createProceduralMesh(costume.procedural, gene);
      } else if (costume.template) {
        mesh = this.loadTemplateMesh(costume.template);
      } else {
        continue;
      }

      // 挂载到骨骼
      mesh.position.set(...point.offset);
      mesh.rotation.set(...point.rotation);
      mesh.scale.setScalar(point.scale * this.getGeneScale(gene));
      bone.add(mesh);

      this.costumeMeshes.set(`${costume.id}_${pointName}`, mesh);
    }
  }

  /** 卸下服饰 */
  unequip(costumeId: string): void {
    for (const [key, mesh] of this.costumeMeshes) {
      if (key.startsWith(costumeId)) {
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.costumeMeshes.delete(key);
      }
    }
  }

  /** 程序化生成简单配饰 mesh */
  private createProceduralMesh(proc: CostumeDef['procedural'], gene: BuddyGenome): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    const p = proc!.params;

    switch (proc!.shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(p.width ?? 0.1, p.height ?? 0.1, p.depth ?? 0.1);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(p.radius ?? 0.05, 16, 16);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(p.radiusTop ?? 0.03, p.radiusBottom ?? 0.05, p.height ?? 0.1, 16);
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(p.radius ?? 0.06, p.tube ?? 0.015, 8, 24);
        break;
      default:
        geometry = new THREE.SphereGeometry(0.05, 8, 8);
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(proc!.material.color),
      roughness: proc!.material.roughness,
      metalness: proc!.material.metalness,
      emissive: proc!.material.emissive ? new THREE.Color(proc!.material.emissive) : undefined,
    });

    return new THREE.Mesh(geometry, material);
  }

  /** 根据基因参数计算缩放（服饰要跟身体比例协调） */
  private getGeneScale(gene: BuddyGenome): number {
    return (gene.bodyHeight + gene.bodyWidth) / 2;
  }
}
```

#### 6.10.5 出生默认服装

formProgress 到 70%（成形阶段）时自动装备默认基础款：

```typescript
/** 默认服饰（成形时自动装备，不可卸下） */
const DEFAULT_COSTUMES: CostumeDef[] = [
  {
    id: 'default_basic',
    slot: 'upper',
    attachPoints: ['chest'],
    meshType: 'procedural',
    procedural: {
      shape: 'custom',  // 贴合身体轮廓的薄壳
      params: { thickness: 0.005 },
      material: {
        color: '{{primaryColor}}',  // 继承 Onboarding 主色调
        roughness: 0.6,
        metalness: 0.0,
      },
    },
  },
];

/**
 * 成形阶段自动装备逻辑：
 * 1. formProgress < 70%：无服饰（球体/变形中）
 * 2. formProgress >= 70%：装备默认基础款
 * 3. 用户购买商城服饰：覆盖默认款对应槽位
 * 4. 卸下商城服饰：回退到默认基础款
 */
```

#### 6.10.6 槽位冲突规则

```typescript
/** 每个槽位同时只能装备一件 */
const SLOT_RULES: Record<CostumeSlot, {
  maxEquipped: number;
  conflictsWith: CostumeSlot[];  // 互斥槽位
}> = {
  head:      { maxEquipped: 1, conflictsWith: [] },
  face:      { maxEquipped: 1, conflictsWith: [] },
  upper:     { maxEquipped: 1, conflictsWith: [] },
  lower:     { maxEquipped: 1, conflictsWith: [] },
  back:      { maxEquipped: 1, conflictsWith: [] },
  hands:     { maxEquipped: 2, conflictsWith: [] },  // 左右手各一
  feet:      { maxEquipped: 2, conflictsWith: [] },  // 左右脚各一
  accessory: { maxEquipped: 3, conflictsWith: [] },  // 最多 3 个配饰
};
```

#### 6.10.7 与现有商城系统对接

```
src/shop/catalog.ts 现有数据            3D 渲染层映射
━━━━━━━━━━━━━━━━━━━━━                  ━━━━━━━━━━━━━
type: 'costume'          →             CostumeSlot: 'upper'/'lower'
type: 'accessory'        →             CostumeSlot: 'head'/'face'/'hands'
type: 'effect'           →             粒子系统参数（不走服饰 mesh）
type: 'background'       →             场景背景（不走服饰 mesh）
type: 'pet_skin'         →             全身材质覆盖（Shader uniform）
rarity: 'legendary'      →             emissive 自发光 + 粒子拖尾
```

---

## 7. 与现有系统的集成

### 7.1 后端改动

```
src/pet/types.ts:
  - 保留现有 EVOLUTION_TABLE / VISUAL_STAGE_TABLE
  - 删除 SPECIES_TABLE 对形态的影响（物种不再决定外观）
  - 新增 BuddyGenome 类型定义
  - 新增 computeGenome() 函数

src/pet/manager.ts:
  - 保留现有 trackFeature() / computeBehaviorSignals() / getOcean()
  - 新增 getGenome() 方法：从 BehaviorSignals + OCEAN + UserProfile + DomainProfiles 计算基因
  - 修改 getSummary()：返回 genome 数据给前端
  - species 字段保留（用于进化条件判定），但不再影响形态

src/pet/index.ts:
  - WS 事件新增 'genome_update'：基因参数或 formProgress 变化时推送给前端
```

### 7.2 前端改动

```
frontend/src/components/SpriteRenderer.tsx:
  - 替换 PixiJS 为 Three.js
  - 新增 BuddyModel 类：基础网格 + morph targets + PBR 材质
  - formProgress 驱动 morph weights（核心映射）
  - 保留粒子系统、鼠标追踪、拖拽交互

frontend/src/components/Onboarding.tsx:
  - 保留现有 4 步流程（颜色/质感/气质/LLM）
  - Onboarding 完成后进入初始状态（morph weights = 0，即球体）

frontend/src/types/buddy.ts:
  - 新增 BuddyGenome 类型
  - BuddyState 新增 genome 字段
```

### 7.3 Electron 改动

```
electron/sprite-window.html:
  - PixiJS 替换为 Three.js 轻量渲染器
  - 同步 morph weights（通过 IPC）
  - 保留 IPC 通信、感知事件、行为事件

electron/floating-window.cjs:
  - 无结构性改动
```

---

## 8. 实施路线

### Phase 1: Three.js 基础渲染器（5 天）

- [ ] Three.js WebGPU 渲染器 + WebGL2 fallback
- [ ] GPU 能力检测（5 档降级）
- [ ] 基础人形网格（程序化生成）
- [ ] MeshStandardMaterial + onBeforeCompile 扩展
- [ ] 灯光 + 阴影
- [ ] Canvas2D fallback

### Phase 2: 基因系统（3 天）

- [ ] 定义 BuddyGenome 类型
- [ ] 实现 computeGenome()（五维涌现）
- [ ] 实现 aestheticRefinement()（审美规则引擎）
- [ ] 后端 getGenome() API + WS 推送
- [ ] 单元测试

### Phase 3: 程序化形态变形（5 天）

- [ ] Vertex Shader 身材变形（bodyHeight/Width/Roundness/HeadSize）
- [ ] 耳朵/尾巴/翅膀/角的区域拉伸
- [ ] formProgress → 形态调制（球体→人形连续过渡）
- [ ] 基因参数变化时平滑过渡

### Phase 4: 骨骼与表情（5 天）

- [ ] 完整人形骨架（脊柱/四肢/面部）
- [ ] 面部表情系统（眉/眼皮/嘴角/下巴）
- [ ] 情绪→表情映射
- [ ] 尾巴/翅膀/耳朵骨骼动画
- [ ] 呼吸/摇摆持续动画

### Phase 5: 材质与后处理（3 天）

- [ ] 程序化纹路注入（onBeforeCompile）
- [ ] 4 种质感（光滑/毛绒/鳞片/岩石）
- [ ] Bloom + SSAO 后处理管线
- [ ] 情绪发光 + 早期光团感

### Phase 6: 粒子与集成（4 天）

- [ ] 粒子系统（情绪粒子 + 进化粒子）
- [ ] 替换 SpriteRenderer（PixiJS → Three.js）
- [ ] 桌面浮窗 Three.js 改造
- [ ] 基因参数实时同步（WS 推送）
- [ ] 进化阶段附加效果（光环/环绕粒子）

**总计: ~25 人天**

---

## 9. 依赖清单

```json
{
  "dependencies": {
    "three": "^0.170.0",
    "seedrandom": "^3.0.5"
  },
  "devDependencies": {
    "@types/three": "^0.170.0"
  }
}
```

- Three.js: 3D 渲染引擎（~150KB gzip）
- seedrandom: 确定性随机数生成（~3KB）

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 低端设备 WebGL 不支持 | ~5% 用户 | Canvas2D fallback |
| Morph targets 数量过多 | GPU 内存 | 按需生成，只保留当前阶段需要的 |
| 涌现太慢，早期形态单调 | 体验空洞 | 前 30% formProgress 加速 + Onboarding 锚点提供初始差异 |
| 涌现太快，失去成长感 | 缺乏期待 | 70% 后减速 |
| 形态差异不够 | 同质化 | 30 个基因参数 × 5 个涌现维度 = 足够的组合空间 |
| Three.js 包体积 | 首屏加载 | 按需引入 + tree-shaking |
| Morph target 接缝 | 视觉质量 | 同拓扑 = 无穿模，平滑法线 |
| 人形形态表达力不足 | 情绪传达 | 骨骼动画（表情/手势/姿态）弥补 |
