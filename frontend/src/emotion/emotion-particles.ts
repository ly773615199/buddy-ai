/**
 * Sprint 3: 情绪 → 粒子参数映射引擎
 *
 * 光灵的情绪状态（mood/energy/satisfaction/curiosity）
 * 驱动粒子系统的颜色、速度、密度、光晕等参数。
 *
 * 设计原则：
 * - 情绪只通过光灵自身表达（粒子/颜色/运动/光晕）
 * - 不侵入 UI 控件
 * - 平滑过渡，不突变
 */

import type { BuddyState } from '../types/buddy';

// ==================== 情绪粒子参数 ====================

export interface EmotionParticleParams {
  // 颜色偏移
  hueShift: number;         // -60 ~ +60 度色相偏移
  saturationMul: number;    // 0.5 ~ 1.5 饱和度倍率
  brightnessMul: number;    // 0.6 ~ 1.4 亮度倍率

  // 粒子行为
  velocityMul: number;      // 0.3 ~ 2.0 速度倍率
  spreadMul: number;        // 0.5 ~ 2.0 扩散范围倍率
  spawnRateMul: number;     // 0.3 ~ 3.0 生成频率倍率（越小越快）
  lifetimeMul: number;      // 0.5 ~ 2.0 生命周期倍率

  // 光晕
  glowIntensityMul: number; // 0.5 ~ 2.0 光晕强度倍率
  glowPulseSpeed: number;   // 0.005 ~ 0.04 光晕脉冲速度

  // 特殊效果
  trailEnabled: boolean;    // 是否启用拖尾
  wobbleAmount: number;     // 0 ~ 3 粒子晃动幅度
  clusterTendency: number;  // 0 ~ 1 粒子聚集倾向（0=均匀扩散, 1=趋向中心）
}

// ==================== 默认参数（neutral） ====================

const DEFAULT_PARAMS: EmotionParticleParams = {
  hueShift: 0,
  saturationMul: 1,
  brightnessMul: 1,
  velocityMul: 1,
  spreadMul: 1,
  spawnRateMul: 1,
  lifetimeMul: 1,
  glowIntensityMul: 1,
  glowPulseSpeed: 0.02,
  trailEnabled: false,
  wobbleAmount: 0.5,
  clusterTendency: 0.3,
};

// ==================== 情绪预设 ====================

const MOOD_PRESETS: Record<string, Partial<EmotionParticleParams>> = {
  // 开心 — 暖色调、活跃、扩散
  happy: {
    hueShift: 15,
    saturationMul: 1.3,
    brightnessMul: 1.2,
    velocityMul: 1.4,
    spreadMul: 1.3,
    spawnRateMul: 0.7,
    glowIntensityMul: 1.3,
    glowPulseSpeed: 0.03,
    wobbleAmount: 1.5,
  },
  // 兴奋 — 极活跃、高亮、快速
  excited: {
    hueShift: 25,
    saturationMul: 1.5,
    brightnessMul: 1.4,
    velocityMul: 1.8,
    spreadMul: 1.5,
    spawnRateMul: 0.4,
    lifetimeMul: 0.8,
    glowIntensityMul: 1.6,
    glowPulseSpeed: 0.04,
    trailEnabled: true,
    wobbleAmount: 2.5,
  },
  // 平静 — 柔和、慢速、稳定
  calm: {
    hueShift: -10,
    saturationMul: 0.8,
    brightnessMul: 0.9,
    velocityMul: 0.6,
    spreadMul: 0.8,
    spawnRateMul: 1.5,
    lifetimeMul: 1.5,
    glowIntensityMul: 0.8,
    glowPulseSpeed: 0.01,
    wobbleAmount: 0.2,
    clusterTendency: 0.5,
  },
  // 好奇 — 轻微偏移、中速、探索性
  curious: {
    hueShift: 20,
    saturationMul: 1.1,
    brightnessMul: 1.1,
    velocityMul: 1.2,
    spreadMul: 1.6,
    spawnRateMul: 0.8,
    lifetimeMul: 1.2,
    glowIntensityMul: 1.1,
    glowPulseSpeed: 0.025,
    wobbleAmount: 2.0,
    clusterTendency: 0.1, // 向外探索
  },
  // 疲惫 — 暗淡、慢速、收缩
  tired: {
    hueShift: -20,
    saturationMul: 0.6,
    brightnessMul: 0.7,
    velocityMul: 0.4,
    spreadMul: 0.6,
    spawnRateMul: 2.0,
    lifetimeMul: 2.0,
    glowIntensityMul: 0.6,
    glowPulseSpeed: 0.008,
    wobbleAmount: 0.1,
    clusterTendency: 0.7,
  },
  // 悲伤 — 冷色调、极慢、内敛
  sad: {
    hueShift: -30,
    saturationMul: 0.5,
    brightnessMul: 0.6,
    velocityMul: 0.3,
    spreadMul: 0.5,
    spawnRateMul: 2.5,
    lifetimeMul: 2.0,
    glowIntensityMul: 0.5,
    glowPulseSpeed: 0.005,
    wobbleAmount: 0.1,
    clusterTendency: 0.8,
  },
  // 沮丧 — 红色调、快速、震颤 (后端 mood: frustrated)
  frustrated: {
    hueShift: -40,
    saturationMul: 1.5,
    brightnessMul: 1.3,
    velocityMul: 2.0,
    spreadMul: 1.8,
    spawnRateMul: 0.3,
    lifetimeMul: 0.6,
    glowIntensityMul: 1.8,
    glowPulseSpeed: 0.04,
    trailEnabled: true,
    wobbleAmount: 3.0,
  },
  // 思考 — 微冷色调、慢速、内敛收缩
  thinking: {
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
  },
  // 困惑 — 轻微偏色、扩散探索
  confused: {
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
  },
  // 精力充沛 — 暖色调、极活跃、高亮
  energetic: {
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
  },
  // 中性 — 默认
  neutral: {},
  // 默认兜底
  default: {},
};

// ==================== 核心计算 ====================

/**
 * 从 buddy 情绪状态计算粒子参数
 */
export function computeEmotionParams(emotion: BuddyState['emotion']): EmotionParticleParams {
  const mood = emotion.mood || 'neutral';
  const energy = Math.max(0, Math.min(1, emotion.energy ?? 0.5));
  const satisfaction = Math.max(0, Math.min(1, emotion.satisfaction ?? 0.5));
  const curiosity = Math.max(0, Math.min(1, emotion.curiosity ?? 0.3));

  // 获取 mood 预设
  const preset = MOOD_PRESETS[mood] || MOOD_PRESETS.neutral;

  // 用 energy/satisfaction/curiosity 调制预设
  const params: EmotionParticleParams = {
    ...DEFAULT_PARAMS,
    ...preset,
  };

  // energy 调制：高能量 → 更快/更亮/更多粒子
  const energyFactor = 0.5 + energy * 1.0; // 0.5 ~ 1.5
  params.velocityMul *= energyFactor;
  params.brightnessMul *= 0.7 + energy * 0.6;
  params.spawnRateMul /= energyFactor;
  params.glowIntensityMul *= 0.7 + energy * 0.6;

  // satisfaction 调制：高满足 → 更饱和/更稳定
  const satFactor = 0.7 + satisfaction * 0.6; // 0.7 ~ 1.3
  params.saturationMul *= satFactor;
  params.glowIntensityMul *= satFactor;
  params.wobbleAmount *= 1.2 - satisfaction * 0.4; // 满足时晃动减少

  // curiosity 调制：高好奇 → 更扩散/更探索
  const curiosityFactor = 0.8 + curiosity * 0.4; // 0.8 ~ 1.2
  params.spreadMul *= curiosityFactor;
  params.lifetimeMul *= curiosityFactor;
  params.clusterTendency *= 1.0 - curiosity * 0.5; // 好奇时更向外扩散

  // 限制范围
  params.velocityMul = clamp(params.velocityMul, 0.2, 2.5);
  params.spawnRateMul = clamp(params.spawnRateMul, 0.2, 3.0);
  params.glowIntensityMul = clamp(params.glowIntensityMul, 0.3, 2.5);
  params.wobbleAmount = clamp(params.wobbleAmount, 0, 4);

  return params;
}

/**
 * 平滑过渡两组参数
 */
export function lerpEmotionParams(
  from: EmotionParticleParams,
  to: EmotionParticleParams,
  t: number,
): EmotionParticleParams {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return {
    hueShift: lerp(from.hueShift, to.hueShift, t),
    saturationMul: lerp(from.saturationMul, to.saturationMul, t),
    brightnessMul: lerp(from.brightnessMul, to.brightnessMul, t),
    velocityMul: lerp(from.velocityMul, to.velocityMul, t),
    spreadMul: lerp(from.spreadMul, to.spreadMul, t),
    spawnRateMul: lerp(from.spawnRateMul, to.spawnRateMul, t),
    lifetimeMul: lerp(from.lifetimeMul, to.lifetimeMul, t),
    glowIntensityMul: lerp(from.glowIntensityMul, to.glowIntensityMul, t),
    glowPulseSpeed: lerp(from.glowPulseSpeed, to.glowPulseSpeed, t),
    trailEnabled: t > 0.5 ? to.trailEnabled : from.trailEnabled,
    wobbleAmount: lerp(from.wobbleAmount, to.wobbleAmount, t),
    clusterTendency: lerp(from.clusterTendency, to.clusterTendency, t),
  };
}

/**
 * 将色相偏移应用到 hex 颜色
 */
export function applyHueShift(hex: string, shift: number, satMul: number, brightMul: number): number {
  const { r, g, b } = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);

  h = (h + shift / 360 + 1) % 1;
  s = clamp(s * satMul, 0, 1);
  l = clamp(l * brightMul, 0, 1);

  const [nr, ng, nb] = hslToRgb(h, s, l);
  return (nr << 16) | (ng << 8) | nb;
}

// ==================== 颜色工具 ====================

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ==================== 情绪描述（UI 展示用） ====================

export const EMOTION_LABELS: Record<string, string> = {
  happy: '😊 开心',
  excited: '🤩 兴奋',
  calm: '😌 平静',
  tired: '😴 疲惫',
  frustrated: '😤 沮丧',
  thinking: '🤔 思考',
  confused: '😵‍💫 困惑',
  energetic: '⚡ 精力充沛',
  neutral: '😐 平淡',
};

export const EMOTION_COLORS: Record<string, string> = {
  happy: '#ffd700',
  excited: '#ff6b35',
  calm: '#58a6ff',
  tired: '#8b949e',
  frustrated: '#f85149',
  thinking: '#d29922',
  confused: '#a371f7',
  energetic: '#3fb950',
  neutral: '#c9d1d9',
};
