/**
 * pet 亲密度系统对齐测试
 * 覆盖：FEATURE_DEFS stage 字段、EVOLUTION_TABLE 与亲密度阶段对齐、INTIMACY_EVOLUTION_MAP
 */
import { describe, it, expect } from 'vitest';
import {
  FEATURE_DEFS,
  EVOLUTION_TABLE,
  INTIMACY_EVOLUTION_MAP,
  getEvolutionStage,
  GUIDANCE_DEFS,
} from './index.js';
import { INTIMACY_STAGES, getIntimacyStage } from '../types.js';

// ==================== FEATURE_DEFS 阶段对齐 ====================

describe('FEATURE_DEFS 阶段对齐', () => {
  it('所有功能都有 stage 字段', () => {
    for (const f of FEATURE_DEFS) {
      expect(f.stage).toBeDefined();
    }
  });

  it('stage 值在进化阶段范围内', () => {
    const validStages = EVOLUTION_TABLE.map(e => e.stage);
    for (const f of FEATURE_DEFS) {
      expect(validStages).toContain(f.stage);
    }
  });

  it('基本功能在早期阶段', () => {
    const basicFeatures = FEATURE_DEFS.filter(f => f.category === 'basic');
    for (const f of basicFeatures) {
      expect(['egg', 'hatching']).toContain(f.stage);
    }
  });

  it('功能数量 >= 20', () => {
    expect(FEATURE_DEFS.length).toBeGreaterThanOrEqual(20);
  });
});

// ==================== EVOLUTION_TABLE 亲密度映射 ====================

describe('EVOLUTION_TABLE 亲密度映射', () => {
  it('进化阶段数量 = 7', () => {
    expect(EVOLUTION_TABLE).toHaveLength(7);
  });

  it('INTIMACY_EVOLUTION_MAP 覆盖所有亲密度阶段', () => {
    // 亲密度 0 → egg, 16 → hatching, 41 → growing, 66 → formed, 86 → mature, 100 → complete
    expect(INTIMACY_EVOLUTION_MAP).toHaveLength(6);
    expect(INTIMACY_EVOLUTION_MAP[0].minIntimacy).toBe(0);
    expect(INTIMACY_EVOLUTION_MAP[0].stage).toBe('egg');
    expect(INTIMACY_EVOLUTION_MAP[1].minIntimacy).toBe(16);
    expect(INTIMACY_EVOLUTION_MAP[1].stage).toBe('hatching');
    expect(INTIMACY_EVOLUTION_MAP[2].minIntimacy).toBe(41);
    expect(INTIMACY_EVOLUTION_MAP[2].stage).toBe('growing');
    expect(INTIMACY_EVOLUTION_MAP[3].minIntimacy).toBe(66);
    expect(INTIMACY_EVOLUTION_MAP[3].stage).toBe('formed');
    expect(INTIMACY_EVOLUTION_MAP[4].minIntimacy).toBe(86);
    expect(INTIMACY_EVOLUTION_MAP[4].stage).toBe('mature');
    expect(INTIMACY_EVOLUTION_MAP[5].minIntimacy).toBe(100);
    expect(INTIMACY_EVOLUTION_MAP[5].stage).toBe('complete');
  });

  it('亲密度阶段阈值与进化阶段对齐', () => {
    // 验证 INTIMACY_EVOLUTION_MAP 的 minIntimacy 与 INTIMACY_STAGES 的 min 一致
    const stageThresholds = INTIMACY_STAGES.map(s => s.min);
    const evoThresholds = INTIMACY_EVOLUTION_MAP.map(e => e.minIntimacy);
    // 0, 16, 41, 66, 86 应匹配
    expect(evoThresholds[0]).toBe(stageThresholds[0]); // 0
    expect(evoThresholds[1]).toBe(stageThresholds[1]); // 16
    expect(evoThresholds[2]).toBe(stageThresholds[2]); // 41
    expect(evoThresholds[3]).toBe(stageThresholds[3]); // 66
    expect(evoThresholds[4]).toBe(stageThresholds[4]); // 86
  });

  it('getEvolutionStage 随亲密度单调递增', () => {
    const stageOrder = EVOLUTION_TABLE.map(e => e.stage);
    let prevIdx = -1;
    for (let score = 0; score <= 100; score += 5) {
      const stage = getEvolutionStage(score);
      const idx = stageOrder.indexOf(stage);
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = idx;
    }
  });
});

// ==================== GUIDANCE_DEFS 阶段对齐 ====================

describe('GUIDANCE_DEFS 阶段对齐', () => {
  it('所有引导任务都有 stage 字段', () => {
    for (const g of GUIDANCE_DEFS) {
      expect(g.stage).toBeDefined();
    }
  });

  it('引导任务数量 >= 5', () => {
    expect(GUIDANCE_DEFS.length).toBeGreaterThanOrEqual(5);
  });
});
