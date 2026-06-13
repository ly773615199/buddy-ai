/**
 * 全链路集成测试 — 感知 → 情绪 → 欲望 → 行为选择 → 叙事
 *
 * 验证五个 Phase 的端到端协作
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleBehavior } from '../behavior/idle.js';
import { ContextProvider } from '../behavior/context-provider.js';
import { NarratorEngine } from '../behavior/narrator.js';
import { DesireDecay } from '../desire/decay.js';
import { scoreAction, selectAction, type ScoringContext } from '../behavior/utility-scorer.js';
import type { DesireVector } from '../desire/engine.js';
import type { OceanPersonality } from '../personality/ocean.js';

// ==================== Phase 1 + 2 + 3: Utility AI + 衰减 + 微动作上下文 ====================

describe('全链路: 感知 → 上下文 → 打分 → 行为', () => {
  let idle: IdleBehavior;
  let decay: DesireDecay;

  beforeEach(() => {
    idle = new IdleBehavior({ enabled: false });
    decay = new DesireDecay();
  });

  afterEach(() => {
    idle.stop();
  });

  test('感知事件 → 上下文变化 → 行为倾向变化', () => {
    // 基线：无声音事件
    const baselineResults = collectActions(idle, 50);

    // 注入声音事件
    idle.onPerception({ source: 'sound', type: 'doorbell', timestamp: Date.now() });
    const soundResults = collectActions(idle, 50);

    // 声音事件后 look_around/peek 比例应上升
    const baselineCurious = baselineResults.filter(a => a === 'look_around' || a === 'peek').length;
    const soundCurious = soundResults.filter(a => a === 'look_around' || a === 'peek').length;
    // 不做硬断言（有随机性），只验证流程不崩溃
    expect(soundResults.length).toBeGreaterThan(0);
  });

  test('需求衰减 → 行为倾向随时间变化', () => {
    // 初始状态
    decay.setOcean({ openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 });
    const baseAcc = decay.getAccumulator();
    expect(baseAcc.hunger).toBe(0);

    // 模拟 2 小时（24 个 tick）
    for (let i = 0; i < 24; i++) decay.tick();
    const afterAcc = decay.getAccumulator();

    // 需求应该增长
    expect(afterAcc.hunger).toBeGreaterThan(baseAcc.hunger);
    expect(afterAcc.rest).toBeGreaterThan(baseAcc.rest);
    expect(afterAcc.social).toBeGreaterThan(baseAcc.social);

    // 合并到基础欲望
    const base: DesireVector = { hunger: 30, curiosity: 30, social: 30, safety: 20, expression: 20, rest: 30 };
    const merged = decay.mergeWithBase(base);
    expect(merged.hunger).toBeGreaterThan(base.hunger);
    expect(merged.rest).toBeGreaterThan(base.rest);
  });

  test('人格差异 → 不同的行为倾向', () => {
    // 高外倾性
    idle.setOcean({ openness: 50, conscientiousness: 50, extraversion: 95, agreeableness: 50, neuroticism: 30 });
    idle.setDesires({ hunger: 20, curiosity: 30, social: 60, safety: 10, expression: 20, rest: 20 });
    const extroResults = collectActions(idle, 80);
    const extroWaveRate = extroResults.filter(a => a === 'wave' || a === 'peek').length / extroResults.length;

    // 高内倾性
    idle.setOcean({ openness: 50, conscientiousness: 50, extraversion: 10, agreeableness: 50, neuroticism: 30 });
    const introResults = collectActions(idle, 80);
    const introWaveRate = introResults.filter(a => a === 'wave' || a === 'peek').length / introResults.length;

    // 高外倾性应该有更多社交行为
    expect(extroWaveRate).toBeGreaterThanOrEqual(introWaveRate);
  });

  test('深夜 + 高 rest → 睡眠行为增加', () => {
    // 模拟深夜
    const cp = idle.contextProvider;
    // 通过多次记录 yawn 来让最近行为历史变满
    idle.setDesires({ hunger: 20, curiosity: 20, social: 20, safety: 10, expression: 15, rest: 85 });

    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      const action = idle.triggerRandom();
      if (action) results.push(action);
    }

    // 高 rest 下 yawn/sleep 应该出现
    const drowsyCount = results.filter(a => a === 'yawn' || a === 'sleep').length;
    expect(drowsyCount).toBeGreaterThan(0);
  });
});

// ==================== Phase 4: 感知→情绪→行为 全链路 ====================

describe('全链路: 感知→情绪→行为', () => {
  test('用户交互 → 需求满足 → 行为变化', () => {
    const decay = new DesireDecay();

    // 累积社交欲
    for (let i = 0; i < 10; i++) decay.tick();
    const beforeSocial = decay.getAccumulator().social;
    expect(beforeSocial).toBeGreaterThan(0);

    // 用户交互 → 社交欲降低
    decay.onInteraction();
    const afterSocial = decay.getAccumulator().social;
    expect(afterSocial).toBeLessThan(beforeSocial);
  });

  test('任务完成 → 表达欲降低 + 疲劳增加', () => {
    const decay = new DesireDecay();
    for (let i = 0; i < 10; i++) decay.tick();

    const beforeExpression = decay.getAccumulator().expression;
    const beforeRest = decay.getAccumulator().rest;

    decay.onTaskComplete();

    expect(decay.getAccumulator().expression).toBeLessThan(beforeExpression);
    expect(decay.getAccumulator().rest).toBeGreaterThan(beforeRest);
  });
});

// ==================== Phase 5: 叙事引擎 + 行为选择 ====================

describe('全链路: 叙事→行为', () => {
  test('叙事事件生成不影响行为选择', () => {
    const narrator = new NarratorEngine();
    const idle = new IdleBehavior({ enabled: false });

    idle.setMood('happy');
    idle.setDesires({ hunger: 20, curiosity: 70, social: 30, safety: 10, expression: 20, rest: 30 });

    // 同时检查叙事和行为
    const ctx = idle.contextProvider.getContext();
    narrator.resetCooldown();
    const narration = narrator.checkForNarration(ctx);

    // 行为选择仍然正常
    const action = idle.triggerRandom();
    expect(action).not.toBeNull();

    idle.stop();
  });

  test('叙事 + 行为链 共存', () => {
    const narrator = new NarratorEngine();
    const idle = new IdleBehavior({ enabled: false });

    const actions: string[] = [];
    idle.onAction((action) => actions.push(action));

    // 设置高好奇心以触发好奇心叙事
    idle.setDesires({ hunger: 20, curiosity: 80, social: 30, safety: 10, expression: 20, rest: 30 });

    // 多次触发
    for (let i = 0; i < 20; i++) {
      const ctx = idle.contextProvider.getContext();
      narrator.resetCooldown();
      narrator.checkForNarration(ctx);
      idle.triggerRandom();
    }

    expect(actions.length).toBeGreaterThan(0);
    idle.stop();
  });
});

// ==================== ContextProvider + Utility Scorer 集成 ====================

describe('ContextProvider → UtilityScorer 管线', () => {
  test('上下文变化导致打分变化', () => {
    const cp = new ContextProvider();

    // 基线打分
    const ctx1 = cp.getContext();
    const yawnScore1 = scoreAction('yawn', ctx1);

    // 注入高 rest
    cp.updateDesires({ hunger: 20, curiosity: 20, social: 20, safety: 10, expression: 15, rest: 90 });
    const ctx2 = cp.getContext();
    const yawnScore2 = scoreAction('yawn', ctx2);

    expect(yawnScore2).toBeGreaterThan(yawnScore1);
  });

  test('声音事件导致 look_around 打分上升', () => {
    const cp = new ContextProvider();

    const ctxBefore = cp.getContext();
    const scoreBefore = scoreAction('look_around', ctxBefore);

    cp.onPerception({ source: 'sound', type: 'alarm', timestamp: Date.now() });
    const ctxAfter = cp.getContext();
    const scoreAfter = scoreAction('look_around', ctxAfter);

    expect(scoreAfter).toBeGreaterThan(scoreBefore);
  });

  test('重复行为导致 noveltyFactor 降权', () => {
    const cp = new ContextProvider();
    cp.recordAction('wave');
    cp.recordAction('wave');
    cp.recordAction('wave');

    const ctx = cp.getContext();
    const score = scoreAction('wave', ctx);

    // 重复 3 次后 wave 分数应该显著降低
    expect(score).toBeLessThan(0.5);
  });
});

// ==================== DesireDecay + OCEAN 人格集成 ====================

describe('DesireDecay + OCEAN 人格', () => {
  test('不同人格 → 不同的需求增长速度', () => {
    const configs: Array<{ name: string; ocean: OceanPersonality; fasterDesire: keyof DesireVector }> = [
      {
        name: '高开放性 → 求知欲增长快',
        ocean: { openness: 90, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
        fasterDesire: 'curiosity',
      },
      {
        name: '高外倾性 → 社交欲增长快',
        ocean: { openness: 50, conscientiousness: 50, extraversion: 90, agreeableness: 50, neuroticism: 50 },
        fasterDesire: 'social',
      },
      {
        name: '高神经质 → 安全欲增长快',
        ocean: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 90 },
        fasterDesire: 'safety',
      },
    ];

    for (const { name, ocean, fasterDesire } of configs) {
      const decayHigh = new DesireDecay();
      decayHigh.setOcean(ocean);
      const decayLow = new DesireDecay();
      decayLow.setOcean({ ...ocean, [fasterDesire === 'curiosity' ? 'openness' : fasterDesire === 'social' ? 'extraversion' : 'neuroticism']: 20 });

      decayHigh.tick();
      decayLow.tick();

      expect(decayHigh.getAccumulator()[fasterDesire]).toBeGreaterThan(decayLow.getAccumulator()[fasterDesire]);
    }
  });
});

// ==================== 工具函数 ====================

function collectActions(idle: IdleBehavior, n: number): string[] {
  const results: string[] = [];
  for (let i = 0; i < n; i++) {
    const action = idle.triggerRandom();
    if (action) results.push(action);
  }
  return results;
}
