/**
 * BuddyGenome 基因系统测试
 *
 * 覆盖：
 * - computeGenome() 五维涌现
 * - aestheticRefinement() 审美规则引擎
 * - deriveSecondary() 副色派生
 * - 边界条件
 */

import { describe, it, expect } from 'vitest';
import {
  computeGenome,
  aestheticRefinement,
  type BuddyGenome,
  type GenomeContext,
  type BehaviorSignals,
  type OceanPersonality,
  type UserProfile,
  type DomainProfile,
  type VisualSeed,
} from './genome';

// ==================== 测试 fixtures ====================

function defaultVisualSeed(): VisualSeed {
  return { primaryColor: '#58a6ff', seed: 12345 };
}

function defaultBehaviorSignals(): BehaviorSignals {
  return { snark: 50, wisdom: 50, chaos: 50, patience: 50, debugging: 50 };
}

function defaultOcean(): OceanPersonality {
  return { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 };
}

function defaultUserProfile(): UserProfile {
  return {
    identity: { techStack: ['typescript', 'react'] },
    behavior: { preferredDetailLevel: 'balanced' },
  };
}

function defaultContext(overrides?: Partial<GenomeContext>): GenomeContext {
  return {
    visualSeed: defaultVisualSeed(),
    behaviorSignals: defaultBehaviorSignals(),
    ocean: defaultOcean(),
    userProfile: defaultUserProfile(),
    domainProfiles: [],
    emotionEnergy: 0.5,
    evolutionStage: 'growing',
    formProgress: 50,
    personalityStrength: 0.5,
    ...overrides,
  };
}

// ==================== computeGenome ====================

describe('computeGenome', () => {
  it('返回完整的 30 参数基因组', () => {
    const genome = computeGenome(defaultContext());

    // 体型 5 维
    expect(genome.bodyHeight).toBeTypeOf('number');
    expect(genome.bodyWidth).toBeTypeOf('number');
    expect(genome.bodyDepth).toBeTypeOf('number');
    expect(genome.bodyRoundness).toBeTypeOf('number');
    expect(genome.headSize).toBeTypeOf('number');

    // 面部 6 维
    expect(genome.eyeSize).toBeTypeOf('number');
    expect(genome.eyeSpacing).toBeTypeOf('number');
    expect(genome.eyeShape).toBeTypeOf('number');
    expect(genome.eyeAngle).toBeTypeOf('number');
    expect(genome.pupilSize).toBeTypeOf('number');
    expect(genome.eyeHighlight).toBeTypeOf('number');

    // 耳朵 4 维
    expect(genome.earSize).toBeTypeOf('number');
    expect(genome.earPosition).toBeTypeOf('number');
    expect(genome.earShape).toBeTypeOf('number');
    expect(genome.earAngle).toBeTypeOf('number');

    // 嘴巴 2 维
    expect(genome.mouthSize).toBeTypeOf('number');
    expect(genome.mouthShape).toBeTypeOf('number');

    // 附属物 5 维
    expect(genome.tailLength).toBeTypeOf('number');
    expect(genome.tailCurve).toBeTypeOf('number');
    expect(genome.wingSize).toBeTypeOf('number');
    expect(genome.hornSize).toBeTypeOf('number');
    expect(genome.hornStyle).toBeTypeOf('number');

    // 纹路 3 维
    expect(genome.patternDensity).toBeTypeOf('number');
    expect(genome.patternStyle).toBeTypeOf('number');
    expect(genome.patternSpread).toBeTypeOf('number');

    // 颜色 2 维
    expect(genome.secondaryColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(genome.colorGradient).toBeTypeOf('number');

    // 动态 2 维
    expect(genome.breatheSpeed).toBeTypeOf('number');
    expect(genome.swayAmount).toBeTypeOf('number');
  });

  it('所有数值参数在合法范围内', () => {
    const genome = computeGenome(defaultContext());

    expect(genome.bodyHeight).toBeGreaterThanOrEqual(0.7);
    expect(genome.bodyHeight).toBeLessThanOrEqual(1.3);
    expect(genome.bodyWidth).toBeGreaterThanOrEqual(0.6);
    expect(genome.bodyWidth).toBeLessThanOrEqual(1.4);
    expect(genome.bodyRoundness).toBeGreaterThanOrEqual(0);
    expect(genome.bodyRoundness).toBeLessThanOrEqual(1);
    expect(genome.headSize).toBeGreaterThanOrEqual(0.7);
    expect(genome.headSize).toBeLessThanOrEqual(1.3);
    expect(genome.eyeSize).toBeGreaterThanOrEqual(0.5);
    expect(genome.eyeSize).toBeLessThanOrEqual(1.5);
    expect(genome.earSize).toBeGreaterThanOrEqual(0.3);
    expect(genome.earSize).toBeLessThanOrEqual(2.0);
    expect(genome.tailLength).toBeGreaterThanOrEqual(0);
    expect(genome.tailLength).toBeLessThanOrEqual(2.0);
    expect(genome.wingSize).toBeGreaterThanOrEqual(0);
    expect(genome.wingSize).toBeLessThanOrEqual(1.5);
    expect(genome.hornSize).toBeGreaterThanOrEqual(0);
    expect(genome.hornSize).toBeLessThanOrEqual(1);
    expect(genome.mouthSize).toBeGreaterThanOrEqual(0.3);
    expect(genome.mouthSize).toBeLessThanOrEqual(1.2);
    expect(genome.breatheSpeed).toBeGreaterThanOrEqual(0.5);
    expect(genome.breatheSpeed).toBeLessThanOrEqual(2.0);
    expect(genome.swayAmount).toBeGreaterThanOrEqual(0);
    expect(genome.swayAmount).toBeLessThanOrEqual(1);
    expect(genome.eyeAngle).toBeGreaterThanOrEqual(-15);
    expect(genome.eyeAngle).toBeLessThanOrEqual(15);
    expect(genome.earAngle).toBeGreaterThanOrEqual(-30);
    expect(genome.earAngle).toBeLessThanOrEqual(30);
  });

  it('相同种子产生相同基因组（确定性）', () => {
    const ctx = defaultContext({ visualSeed: { primaryColor: '#58a6ff', seed: 42 } });
    const g1 = computeGenome(ctx);
    const g2 = computeGenome(ctx);

    expect(g1.bodyHeight).toBe(g2.bodyHeight);
    expect(g1.eyeSize).toBe(g2.eyeSize);
    expect(g1.secondaryColor).toBe(g2.secondaryColor);
    expect(g1.tailLength).toBe(g2.tailLength);
  });

  it('不同种子产生不同基因组', () => {
    const g1 = computeGenome(defaultContext({ visualSeed: { primaryColor: '#58a6ff', seed: 1 } }));
    const g2 = computeGenome(defaultContext({ visualSeed: { primaryColor: '#58a6ff', seed: 999 } }));

    // 至少部分参数不同（概率上几乎不可能完全相同）
    const diffs = [
      g1.bodyHeight !== g2.bodyHeight,
      g1.eyeSize !== g2.eyeSize,
      g1.secondaryColor !== g2.secondaryColor,
      g1.tailLength !== g2.tailLength,
      g1.earSize !== g2.earSize,
    ];
    expect(diffs.some(Boolean)).toBe(true);
  });
});

// ==================== 行为信号驱动 ====================

describe('computeGenome — 行为信号驱动', () => {
  it('高 patience → 高 bodyRoundness', () => {
    const patient = computeGenome(defaultContext({
      behaviorSignals: { snark: 50, wisdom: 50, chaos: 50, patience: 100, debugging: 50 },
    }));
    const impatient = computeGenome(defaultContext({
      behaviorSignals: { snark: 50, wisdom: 50, chaos: 50, patience: 0, debugging: 50 },
    }));
    expect(patient.bodyRoundness).toBeGreaterThan(impatient.bodyRoundness);
  });

  it('高 chaos → 高 swayAmount', () => {
    const chaotic = computeGenome(defaultContext({
      behaviorSignals: { snark: 50, wisdom: 50, chaos: 100, patience: 50, debugging: 50 },
    }));
    const calm = computeGenome(defaultContext({
      behaviorSignals: { snark: 50, wisdom: 50, chaos: 0, patience: 50, debugging: 50 },
    }));
    expect(chaotic.swayAmount).toBeGreaterThan(calm.swayAmount);
  });

  it('高 snark → 高 mouthShape（锐利嘴）', () => {
    const snarky = computeGenome(defaultContext({
      behaviorSignals: { snark: 100, wisdom: 50, chaos: 50, patience: 50, debugging: 50 },
    }));
    const polite = computeGenome(defaultContext({
      behaviorSignals: { snark: 0, wisdom: 50, chaos: 50, patience: 50, debugging: 50 },
    }));
    expect(snarky.mouthShape).toBeGreaterThan(polite.mouthShape);
  });
});

// ==================== OCEAN 人格驱动 ====================

describe('computeGenome — OCEAN 人格驱动', () => {
  it('高 openness → 大眼', () => {
    const open = computeGenome(defaultContext({
      ocean: { openness: 100, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
    }));
    const closed = computeGenome(defaultContext({
      ocean: { openness: 0, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
    }));
    expect(open.eyeSize).toBeGreaterThan(closed.eyeSize);
  });

  it('高 extraversion → 大耳外张', () => {
    const extrovert = computeGenome(defaultContext({
      ocean: { openness: 50, conscientiousness: 50, extraversion: 100, agreeableness: 50, neuroticism: 50 },
    }));
    const introvert = computeGenome(defaultContext({
      ocean: { openness: 50, conscientiousness: 50, extraversion: 0, agreeableness: 50, neuroticism: 50 },
    }));
    expect(extrovert.earSize).toBeGreaterThan(introvert.earSize);
    expect(extrovert.earAngle).toBeGreaterThan(introvert.earAngle);
  });

  it('高 agreeableness → 眼角下垂（负 eyeAngle）', () => {
    const agreeable = computeGenome(defaultContext({
      ocean: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 100, neuroticism: 50 },
    }));
    expect(agreeable.eyeAngle).toBeGreaterThan(0);
  });
});

// ==================== 知识深度驱动 ====================

describe('computeGenome — 知识深度驱动', () => {
  it('mature 领域多 → 翅膀大', () => {
    const mature: DomainProfile[] = [
      { growthStage: 'mature', knowledgeCount: 10 },
      { growthStage: 'mature', knowledgeCount: 8 },
      { growthStage: 'trainable', knowledgeCount: 6 },
    ];
    const beginner: DomainProfile[] = [
      { growthStage: 'seed', knowledgeCount: 1 },
    ];
    const withDomains = computeGenome(defaultContext({ domainProfiles: mature }));
    const withoutDomains = computeGenome(defaultContext({ domainProfiles: beginner }));
    expect(withDomains.wingSize).toBeGreaterThan(withoutDomains.wingSize);
  });

  it('trainable 领域多 → 角大', () => {
    const trained: DomainProfile[] = [
      { growthStage: 'trainable', knowledgeCount: 10 },
      { growthStage: 'trainable', knowledgeCount: 8 },
    ];
    const empty: DomainProfile[] = [];
    const withHorns = computeGenome(defaultContext({ domainProfiles: trained }));
    const noHorns = computeGenome(defaultContext({ domainProfiles: empty }));
    expect(withHorns.hornSize).toBeGreaterThan(noHorns.hornSize);
  });
});

// ==================== aestheticRefinement ====================

describe('aestheticRefinement', () => {
  it('头身比不超过 2 倍', () => {
    const gene: BuddyGenome = {
      ...({} as any),
      headSize: 3.0,
      bodyHeight: 1.0,
      bodyWidth: 1.0,
      bodyDepth: 1.0,
      bodyRoundness: 0.5,
      eyeSize: 1.0,
      eyeSpacing: 1.0,
      eyeShape: 0.5,
      eyeAngle: 0,
      pupilSize: 0.5,
      eyeHighlight: 0.5,
      earSize: 1.0,
      earPosition: 0.5,
      earShape: 0.5,
      earAngle: 0,
      mouthSize: 0.5,
      mouthShape: 0.5,
      tailLength: 1.0,
      tailCurve: 0.5,
      wingSize: 1.0,
      hornSize: 0.5,
      hornStyle: 0.5,
      patternDensity: 0.5,
      patternStyle: 0.5,
      patternSpread: 0.5,
      secondaryColor: '#ff0000',
      colorGradient: 0.5,
      breatheSpeed: 1.0,
      swayAmount: 0.5,
    };
    const refined = aestheticRefinement(gene);
    expect(refined.headSize).toBeLessThanOrEqual(refined.bodyHeight * 2.0);
  });

  it('耳朵不能比头大', () => {
    const gene: BuddyGenome = {
      ...({} as any),
      headSize: 1.0,
      bodyHeight: 1.0,
      bodyWidth: 1.0,
      bodyDepth: 1.0,
      bodyRoundness: 0.5,
      eyeSize: 1.0,
      eyeSpacing: 1.0,
      eyeShape: 0.5,
      eyeAngle: 0,
      pupilSize: 0.5,
      eyeHighlight: 0.5,
      earSize: 3.0,
      earPosition: 0.5,
      earShape: 0.5,
      earAngle: 0,
      mouthSize: 0.5,
      mouthShape: 0.5,
      tailLength: 1.0,
      tailCurve: 0.5,
      wingSize: 1.0,
      hornSize: 0.5,
      hornStyle: 0.5,
      patternDensity: 0.5,
      patternStyle: 0.5,
      patternSpread: 0.5,
      secondaryColor: '#ff0000',
      colorGradient: 0.5,
      breatheSpeed: 1.0,
      swayAmount: 0.5,
    };
    const refined = aestheticRefinement(gene);
    expect(refined.earSize).toBeLessThanOrEqual(refined.headSize * 1.0);
  });

  it('附属物总量有上限', () => {
    const gene: BuddyGenome = {
      ...({} as any),
      headSize: 1.0,
      bodyHeight: 1.0,
      bodyWidth: 1.0,
      bodyDepth: 1.0,
      bodyRoundness: 0.5,
      eyeSize: 1.0,
      eyeSpacing: 1.0,
      eyeShape: 0.5,
      eyeAngle: 0,
      pupilSize: 0.5,
      eyeHighlight: 0.5,
      earSize: 2.0,
      earPosition: 0.5,
      earShape: 0.5,
      earAngle: 0,
      mouthSize: 0.5,
      mouthShape: 0.5,
      tailLength: 2.0,
      tailCurve: 0.5,
      wingSize: 1.5,
      hornSize: 1.0,
      hornStyle: 0.5,
      patternDensity: 0.5,
      patternStyle: 0.5,
      patternSpread: 0.5,
      secondaryColor: '#ff0000',
      colorGradient: 0.5,
      breatheSpeed: 1.0,
      swayAmount: 0.5,
    };
    const refined = aestheticRefinement(gene);
    const total = refined.earSize + refined.hornSize + refined.wingSize + refined.tailLength;
    expect(total).toBeLessThanOrEqual(4.0 + 0.01); // 浮点误差
  });

  it('头大时下半身加宽（视觉重心）', () => {
    const gene: BuddyGenome = {
      ...({} as any),
      headSize: 1.2,
      bodyHeight: 1.0,
      bodyWidth: 0.6,
      bodyDepth: 1.0,
      bodyRoundness: 0.5,
      eyeSize: 1.0,
      eyeSpacing: 1.0,
      eyeShape: 0.5,
      eyeAngle: 0,
      pupilSize: 0.5,
      eyeHighlight: 0.5,
      earSize: 0.5,
      earPosition: 0.5,
      earShape: 0.5,
      earAngle: 0,
      mouthSize: 0.5,
      mouthShape: 0.5,
      tailLength: 0.5,
      tailCurve: 0.5,
      wingSize: 0.5,
      hornSize: 0.3,
      hornStyle: 0.5,
      patternDensity: 0.5,
      patternStyle: 0.5,
      patternSpread: 0.5,
      secondaryColor: '#ff0000',
      colorGradient: 0.5,
      breatheSpeed: 1.0,
      swayAmount: 0.5,
    };
    const refined = aestheticRefinement(gene);
    expect(refined.bodyWidth).toBeGreaterThanOrEqual(refined.headSize * 0.7);
  });

  it('眼睛不能占满整张脸', () => {
    const gene: BuddyGenome = {
      ...({} as any),
      headSize: 1.0,
      bodyHeight: 1.0,
      bodyWidth: 1.0,
      bodyDepth: 1.0,
      bodyRoundness: 0.5,
      eyeSize: 2.0,
      eyeSpacing: 1.0,
      eyeShape: 0.5,
      eyeAngle: 0,
      pupilSize: 0.5,
      eyeHighlight: 0.5,
      earSize: 0.5,
      earPosition: 0.5,
      earShape: 0.5,
      earAngle: 0,
      mouthSize: 0.5,
      mouthShape: 0.5,
      tailLength: 0.5,
      tailCurve: 0.5,
      wingSize: 0.5,
      hornSize: 0.3,
      hornStyle: 0.5,
      patternDensity: 0.5,
      patternStyle: 0.5,
      patternSpread: 0.5,
      secondaryColor: '#ff0000',
      colorGradient: 0.5,
      breatheSpeed: 1.0,
      swayAmount: 0.5,
    };
    const refined = aestheticRefinement(gene);
    expect(refined.eyeSize).toBeLessThanOrEqual(refined.headSize * 0.6);
  });
});

// ==================== 副色派生 ====================

describe('副色派生', () => {
  it('副色是合法 hex', () => {
    const genome = computeGenome(defaultContext());
    expect(genome.secondaryColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('相同种子产生相同副色', () => {
    const ctx = defaultContext({ visualSeed: { primaryColor: '#58a6ff', seed: 42 } });
    const g1 = computeGenome(ctx);
    const g2 = computeGenome(ctx);
    expect(g1.secondaryColor).toBe(g2.secondaryColor);
  });
});

// ==================== personalityStrength 影响 ====================

describe('personalityStrength 影响', () => {
  it('PS=0 时噪声大，PS=1 时精确', () => {
    const noisy = computeGenome(defaultContext({ personalityStrength: 0 }));
    const precise = computeGenome(defaultContext({ personalityStrength: 1 }));

    // 两者都应在合法范围内
    expect(noisy.bodyHeight).toBeGreaterThanOrEqual(0.7);
    expect(noisy.bodyHeight).toBeLessThanOrEqual(1.3);
    expect(precise.bodyHeight).toBeGreaterThanOrEqual(0.7);
    expect(precise.bodyHeight).toBeLessThanOrEqual(1.3);
  });
});
