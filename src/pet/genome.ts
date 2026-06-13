/**
 * BuddyGenome — 灵伴基因系统
 *
 * 30 个参数，全部从交互行为中涌现。
 * 无物种模板，无预设基线。
 *
 * 来源：SPRITE_3D_DESIGN.md v4.0 §3
 */

import seedrandom from 'seedrandom';

// ==================== 类型定义 ====================

export interface BuddyGenome {
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

// ==================== 输入类型 ====================

export interface BehaviorSignals {
  snark: number;
  wisdom: number;
  chaos: number;
  patience: number;
  debugging: number;
}

export interface OceanPersonality {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface UserProfile {
  identity: {
    techStack: string[];
  };
  behavior: {
    preferredDetailLevel: 'thorough' | 'brief' | 'balanced';
  };
}

export interface DomainProfile {
  growthStage: string;
  knowledgeCount: number;
}

export interface VisualSeed {
  primaryColor: string;
  seed: number;
}

export interface GenomeContext {
  visualSeed: VisualSeed;
  behaviorSignals: BehaviorSignals;
  ocean: OceanPersonality;
  userProfile: UserProfile;
  domainProfiles: DomainProfile[];
  emotionEnergy: number;
  evolutionStage: string;
  formProgress: number;
  personalityStrength: number;
}

// ==================== 核心计算 ====================

/**
 * 从交互上下文计算基因组
 * 不依赖任何物种表/模板，纯粹从涌现维度推导
 */
export function computeGenome(ctx: GenomeContext): BuddyGenome {
  const rng = seedrandom(ctx.visualSeed.seed.toString());
  const gauss = () => {
    const u1 = rng();
    const u2 = rng();
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
  const bodyRoundness = clamp(
    0.5 + (bs.patience - 50) / 200 - (bs.chaos - 50) / 300, 0, 1,
  );
  const bodyHeight = noise(1.0 + (bs.wisdom - 50) / 400, 0.1);
  const bodyWidth = noise(
    1.0 + (bs.debugging - 50) / 300 - (bs.snark - 50) / 400, 0.1,
  );
  const bodyDepth = noise(1.0, 0.1);
  const headSize = noise(
    1.0 + (ocean.openness - 50) / 300 - (ocean.conscientiousness - 50) / 400,
    0.1,
  );

  // ── 面部：OCEAN 驱动 ──
  const eyeSize = noise(1.0 + (ocean.openness - 50) / 200, 0.15);
  const eyeSpacing = noise(1.0 + (ocean.extraversion - 50) / 300, 0.1);
  const eyeShape = clamp(ocean.openness / 100, 0, 1);
  const eyeAngle = (ocean.agreeableness - 50) * 0.3;
  const pupilSize = noise(0.5 + ocean.openness / 300, 0.1);
  const eyeHighlight = noise(0.5 + ocean.extraversion / 300, 0.1);

  // ── 耳朵：extraversion 驱动 ──
  const earSize = noise(0.8 + ocean.extraversion / 200, 0.2);
  const earPosition = noise(0.5, 0.15);
  const earShape = clamp(ocean.extraversion / 100, 0, 1);
  const earAngle = ocean.extraversion * 0.6 - 30;

  // ── 嘴巴：snark 驱动 ──
  const mouthShape = clamp(bs.snark / 100, 0, 1);
  const mouthSize = noise(0.5 + bs.snark / 300, 0.1);

  // ── 附属物：知识深度驱动 ──
  const matureDomains = domains.filter(
    d => d.growthStage === 'mature' || d.growthStage === 'trainable',
  ).length;
  const trainableDomains = domains.filter(
    d => d.growthStage === 'trainable' || d.growthStage === 'mature',
  ).length;
  const totalDomains = domains.filter(d => d.knowledgeCount >= 5).length;

  const tailLength = clamp(
    (ocean.neuroticism - 30) / 100 + (100 - ocean.agreeableness) / 300,
    0, 2.0,
  );
  const tailCurve = clamp(ocean.neuroticism / 100, 0, 1);
  const wingSize = clamp(matureDomains * 0.3, 0, 1.5);
  const hornSize = clamp(trainableDomains * 0.2, 0, 1);
  const hornStyle = clamp(totalDomains / 10, 0, 1);

  // ── 纹路：认知模型驱动 ──
  const techStackCount = profile.identity.techStack.length;
  const patternDensity = clamp(techStackCount * 0.1 + bs.wisdom / 200, 0, 1);
  const patternStyle = clamp(
    profile.behavior.preferredDetailLevel === 'thorough' ? 0.8 :
    profile.behavior.preferredDetailLevel === 'brief' ? 0.2 : 0.5,
    0, 1,
  );
  const patternSpread = noise(0.5, 0.2);

  // ── 颜色：种子派生 ──
  const secondaryColor = deriveSecondary(ctx.visualSeed.seed, ctx.visualSeed.primaryColor);
  const colorGradient = noise(0.5, 0.2);

  // ── 动态：行为信号 + 情绪 ──
  const breatheSpeed = noise(1.0 + (bs.patience - 50) / 200, 0.1);
  const swayAmount = noise(bs.chaos / 100, 0.1);

  const raw: BuddyGenome = {
    bodyHeight: clamp(bodyHeight, 0.7, 1.3),
    bodyWidth: clamp(bodyWidth, 0.6, 1.4),
    bodyDepth: clamp(bodyDepth, 0.7, 1.3),
    bodyRoundness,
    headSize: clamp(headSize, 0.7, 1.3),
    eyeSize: clamp(eyeSize, 0.5, 1.5),
    eyeSpacing: clamp(eyeSpacing, 0.7, 1.3),
    eyeShape,
    eyeAngle: clamp(eyeAngle, -15, 15),
    pupilSize: clamp(pupilSize, 0.3, 0.8),
    eyeHighlight,
    earSize: clamp(earSize, 0.3, 2.0),
    earPosition,
    earShape,
    earAngle: clamp(earAngle, -30, 30),
    mouthSize: clamp(mouthSize, 0.3, 1.2),
    mouthShape,
    tailLength,
    tailCurve,
    wingSize,
    hornSize,
    hornStyle,
    patternDensity,
    patternStyle,
    patternSpread,
    secondaryColor,
    colorGradient,
    breatheSpeed: clamp(breatheSpeed, 0.5, 2.0),
    swayAmount: clamp(swayAmount, 0, 1),
  };

  // 审美修正
  return aestheticRefinement(raw);
}

// ==================== 审美规则引擎 ====================

/**
 * 对涌现基因做审美修正
 * 两层约束：
 *   第一层 — 不残（硬约束）：比例不失调
 *   第二层 — 好看（软约束）：推向审美区间
 */
export function aestheticRefinement(gene: BuddyGenome): BuddyGenome {
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

// ==================== 工具函数 ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * 从种子派生副色
 * 确保和主色有足够色相差，避免同色系
 */
function deriveSecondary(seed: number, primaryHex: string): string {
  const rng = seedrandom((seed + 12345).toString());

  // 解析主色 HSL
  const primary = hexToHsl(primaryHex);

  // 副色：色相偏移 60-180 度，饱和度和亮度微调
  const hueShift = 60 + rng() * 120; // 60-180 度
  const newHue = (primary.h + hueShift / 360) % 1;
  const newSat = clamp(primary.s + (rng() - 0.5) * 0.2, 0.3, 1.0);
  const newLight = clamp(primary.l + (rng() - 0.5) * 0.15, 0.3, 0.7);

  return hslToHex(newHue, newSat, newLight);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
