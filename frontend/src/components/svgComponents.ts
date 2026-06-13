import type { TextureType, TemperamentType } from '../types/buddy';

/** SVG 组件定义 */
export interface SVGComponent {
  id: string;
  category: 'body' | 'ears' | 'eyes' | 'mouth' | 'pattern' | 'aura';
  style: TextureType;
  /** 生成 SVG 片段，color 为主色 hex */
  render: (color: string, secondary?: string) => string;
}

// ==================== 身体组件 ====================

const BODIES: SVGComponent[] = [
  {
    id: 'body-round', category: 'body', style: 'soft',
    render: (c) => `<ellipse cx="100" cy="120" rx="45" ry="55" fill="${c}" opacity="0.85"/>
      <ellipse cx="100" cy="120" rx="45" ry="55" fill="url(#bodyGrad)" />`,
  },
  {
    id: 'body-crystal', category: 'body', style: 'sharp',
    render: (c) => `<polygon points="100,60 140,100 130,160 70,160 60,100" fill="${c}" opacity="0.85"/>
      <polygon points="100,60 140,100 130,160 70,160 60,100" fill="url(#bodyGrad)" />`,
  },
  {
    id: 'body-jelly', category: 'body', style: 'transparent',
    render: (c) => `<ellipse cx="100" cy="115" rx="40" ry="58" fill="${c}" opacity="0.5"/>
      <ellipse cx="100" cy="115" rx="35" ry="50" fill="${c}" opacity="0.3"/>
      <ellipse cx="100" cy="115" rx="40" ry="58" fill="url(#bodyGrad)" />`,
  },
  {
    id: 'body-fluffy', category: 'body', style: 'warm',
    render: (c) => `<ellipse cx="100" cy="120" rx="50" ry="55" fill="${c}" opacity="0.8"/>
      <circle cx="65" cy="100" r="18" fill="${c}" opacity="0.6"/>
      <circle cx="135" cy="100" r="18" fill="${c}" opacity="0.6"/>
      <ellipse cx="100" cy="120" rx="50" ry="55" fill="url(#bodyGrad)" />`,
  },
  {
    id: 'body-slim', category: 'body', style: 'sharp',
    render: (c) => `<ellipse cx="100" cy="115" rx="32" ry="50" fill="${c}" opacity="0.85"/>
      <ellipse cx="100" cy="115" rx="32" ry="50" fill="url(#bodyGrad)" />`,
  },
];

// ==================== 耳朵组件 ====================

const EARS: SVGComponent[] = [
  {
    id: 'ears-pointy', category: 'ears', style: 'soft',
    render: (c) => `<path d="M70,80 Q65,45 80,65" fill="${c}" opacity="0.7"/>
      <path d="M130,80 Q135,45 120,65" fill="${c}" opacity="0.7"/>`,
  },
  {
    id: 'ears-long', category: 'ears', style: 'warm',
    render: (c) => `<path d="M68,85 Q55,35 82,70" fill="${c}" opacity="0.65"/>
      <path d="M132,85 Q145,35 118,70" fill="${c}" opacity="0.65"/>`,
  },
  {
    id: 'ears-round', category: 'ears', style: 'soft',
    render: (c) => `<circle cx="65" cy="72" r="14" fill="${c}" opacity="0.6"/>
      <circle cx="135" cy="72" r="14" fill="${c}" opacity="0.6"/>`,
  },
  {
    id: 'ears-horns', category: 'ears', style: 'sharp',
    render: (c) => `<path d="M72,78 L65,48 L82,72" fill="${c}" opacity="0.75"/>
      <path d="M128,78 L135,48 L118,72" fill="${c}" opacity="0.75"/>`,
  },
  {
    id: 'ears-antenna', category: 'ears', style: 'transparent',
    render: (c) => `<line x1="80" y1="72" x2="70" y2="42" stroke="${c}" stroke-width="2" opacity="0.6"/>
      <circle cx="70" cy="40" r="4" fill="${c}" opacity="0.7"/>
      <line x1="120" y1="72" x2="130" y2="42" stroke="${c}" stroke-width="2" opacity="0.6"/>
      <circle cx="130" cy="40" r="4" fill="${c}" opacity="0.7"/>`,
  },
];

// ==================== 眼睛组件 ====================

const EYES: SVGComponent[] = [
  {
    id: 'eyes-round', category: 'eyes', style: 'soft',
    render: () => `<ellipse cx="85" cy="108" rx="7" ry="8" fill="white" opacity="0.95"/>
      <circle cx="85" cy="107" r="4.5" fill="#111"/>
      <circle cx="83" cy="105" r="2" fill="white" opacity="0.9"/>
      <ellipse cx="115" cy="108" rx="7" ry="8" fill="white" opacity="0.95"/>
      <circle cx="115" cy="107" r="4.5" fill="#111"/>
      <circle cx="113" cy="105" r="2" fill="white" opacity="0.9"/>`,
  },
  {
    id: 'eyes-sparkle', category: 'eyes', style: 'transparent',
    render: () => `<ellipse cx="85" cy="108" rx="8" ry="9" fill="white" opacity="0.9"/>
      <circle cx="85" cy="107" r="5" fill="#111"/>
      <circle cx="82" cy="104" r="2.5" fill="white" opacity="0.95"/>
      <circle cx="88" cy="110" r="1.2" fill="white" opacity="0.7"/>
      <ellipse cx="115" cy="108" rx="8" ry="9" fill="white" opacity="0.9"/>
      <circle cx="115" cy="107" r="5" fill="#111"/>
      <circle cx="112" cy="104" r="2.5" fill="white" opacity="0.95"/>
      <circle cx="118" cy="110" r="1.2" fill="white" opacity="0.7"/>`,
  },
  {
    id: 'eyes-sharp', category: 'eyes', style: 'sharp',
    render: () => `<path d="M75,108 Q85,100 95,108 Q85,113 75,108Z" fill="white" opacity="0.9"/>
      <circle cx="85" cy="107" r="3.5" fill="#111"/>
      <path d="M105,108 Q115,100 125,108 Q115,113 105,108Z" fill="white" opacity="0.9"/>
      <circle cx="115" cy="107" r="3.5" fill="#111"/>`,
  },
  {
    id: 'eyes-sleepy', category: 'eyes', style: 'warm',
    render: () => `<path d="M78,108 Q85,104 92,108" stroke="#111" stroke-width="2" fill="none" opacity="0.7"/>
      <path d="M108,108 Q115,104 122,108" stroke="#111" stroke-width="2" fill="none" opacity="0.7"/>`,
  },
];

// ==================== 嘴巴组件 ====================

const MOUTHS: SVGComponent[] = [
  {
    id: 'mouth-smile', category: 'mouth', style: 'soft',
    render: () => `<path d="M92,122 Q100,130 108,122" stroke="#333" stroke-width="1.5" fill="none" opacity="0.5"/>`,
  },
  {
    id: 'mouth-open', category: 'mouth', style: 'lively' as TextureType,
    render: () => `<ellipse cx="100" cy="124" rx="5" ry="4" fill="#333" opacity="0.4"/>`,
  },
  {
    id: 'mouth-cat', category: 'mouth', style: 'sharp',
    render: () => `<path d="M95,122 L100,126 L105,122" stroke="#333" stroke-width="1.2" fill="none" opacity="0.5"/>`,
  },
  {
    id: 'mouth-dot', category: 'mouth', style: 'warm',
    render: () => `<circle cx="100" cy="123" r="2" fill="#333" opacity="0.4"/>`,
  },
];

// ==================== 纹路组件 ====================

const PATTERNS: SVGComponent[] = [
  {
    id: 'pattern-dots', category: 'pattern', style: 'soft',
    render: (_c, s) => `<circle cx="88" cy="135" r="2.5" fill="${s || '#fff'}" opacity="0.3"/>
      <circle cx="100" cy="138" r="2.5" fill="${s || '#fff'}" opacity="0.3"/>
      <circle cx="112" cy="135" r="2.5" fill="${s || '#fff'}" opacity="0.3"/>`,
  },
  {
    id: 'pattern-stripe', category: 'pattern', style: 'sharp',
    render: (_c, s) => `<line x1="100" y1="85" x2="100" y2="150" stroke="${s || '#fff'}" stroke-width="1.5" opacity="0.25"/>
      <line x1="88" y1="90" x2="88" y2="145" stroke="${s || '#fff'}" stroke-width="1" opacity="0.15"/>
      <line x1="112" y1="90" x2="112" y2="145" stroke="${s || '#fff'}" stroke-width="1" opacity="0.15"/>`,
  },
  {
    id: 'pattern-wave', category: 'pattern', style: 'warm',
    render: (_c, s) => `<path d="M75,130 Q88,124 100,130 Q112,136 125,130" stroke="${s || '#fff'}" stroke-width="1.5" fill="none" opacity="0.25"/>
      <path d="M78,140 Q90,134 100,140 Q110,146 122,140" stroke="${s || '#fff'}" stroke-width="1" fill="none" opacity="0.2"/>`,
  },
  {
    id: 'pattern-rings', category: 'pattern', style: 'transparent',
    render: (_c, s) => `<circle cx="100" cy="115" r="25" stroke="${s || '#fff'}" stroke-width="1" fill="none" opacity="0.15"/>
      <circle cx="100" cy="115" r="35" stroke="${s || '#fff'}" stroke-width="0.8" fill="none" opacity="0.1"/>`,
  },
];

// ==================== 光环组件 ====================

const AURAS: SVGComponent[] = [
  {
    id: 'aura-soft', category: 'aura', style: 'soft',
    render: (c) => `<circle cx="100" cy="115" r="70" fill="${c}" opacity="0.06"/>
      <circle cx="100" cy="115" r="55" fill="${c}" opacity="0.08"/>`,
  },
  {
    id: 'aura-ring', category: 'aura', style: 'transparent',
    render: (c) => `<circle cx="100" cy="115" r="65" stroke="${c}" stroke-width="1.5" fill="none" opacity="0.15"/>
      <circle cx="100" cy="115" r="58" stroke="${c}" stroke-width="0.8" fill="none" opacity="0.1"/>`,
  },
  {
    id: 'aura-sparkle', category: 'aura', style: 'lively' as TextureType,
    render: (c) => `<circle cx="100" cy="115" r="60" fill="${c}" opacity="0.05"/>
      ${[0,60,120,180,240,300].map(deg => {
        const rad = deg * Math.PI / 180;
        const x = 100 + Math.cos(rad) * 62;
        const y = 115 + Math.sin(rad) * 62;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${c}" opacity="0.2"/>`;
      }).join('\n      ')}`,
  },
  {
    id: 'aura-dark', category: 'aura', style: 'warm',
    render: (c) => `<circle cx="100" cy="115" r="75" fill="${c}" opacity="0.04"/>
      <circle cx="100" cy="115" r="50" fill="${c}" opacity="0.1"/>`,
  },
];

// ==================== 组装 ====================

/** 按 style 从组件数组中选最匹配的 */
function pickByStyle(comps: SVGComponent[], style: TextureType): SVGComponent {
  const match = comps.find(c => c.style === style);
  return match || comps[0];
}

/** 从 seed 构建确定性选择索引 */
function seededIndex(seed: number, max: number): number {
  return seed % max;
}

/** 组装完整 SVG */
export function assembleSVG(opts: {
  primaryColor: string;
  secondaryColor?: string;
  texture: TextureType;
  temperament: TemperamentType;
  seed: number;
}): string {
  const { primaryColor, secondaryColor, texture, seed } = opts;

  // 选择组件：质感优先匹配，seed 控制具体选择
  const body = BODIES[seededIndex(seed, BODIES.length)];
  const earStyle = pickByStyle(EARS, texture);
  const eyeStyle = pickByStyle(EYES, texture);
  const mouth = MOUTHS[seededIndex(seed + 1, MOUTHS.length)];
  const pattern = PATTERNS[seededIndex(seed + 2, PATTERNS.length)];
  const aura = pickByStyle(AURAS, texture);

  const c = primaryColor;
  const s = secondaryColor || primaryColor;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="bodyGrad" cx="40%" cy="35%">
      <stop offset="0%" stop-color="white" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- 光环 -->
  ${aura.render(c, s)}
  <!-- 身体 -->
  ${body.render(c, s)}
  <!-- 耳朵 -->
  ${earStyle.render(c, s)}
  <!-- 纹路 -->
  ${pattern.render(c, s)}
  <!-- 眼睛 -->
  ${eyeStyle.render(c, s)}
  <!-- 嘴巴 -->
  ${mouth.render(c, s)}
</svg>`;
}
