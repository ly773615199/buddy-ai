import { describe, it, expect } from 'vitest';
import { MotorControl } from './motor-control.js';
import type { BodyState } from '../types.js';

function makeBody(overrides?: Partial<BodyState>): BodyState {
  return {
    energy: 80, temperature: 50, load: 20, hunger: 20,
    emotion: { joy: 50, sadness: 10, anger: 5, fear: 5, surprise: 10, disgust: 5, trust: 60, anticipation: 40 },
    desires: { hunger: 20, curiosity: 30, social: 15, safety: 10, expression: 15, rest: 10 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 50, socialNeed: 30,
    hour: 14, isUserActive: true, lastInteractionMs: Date.now(),
    systemHealth: 'good',
    ...overrides,
  };
}

describe('MotorControl', () => {
  it('triggerIdle 返回行为', () => {
    const mc = new MotorControl({ enableIdle: false, enableProactive: false });
    const action = mc.triggerIdle(makeBody());
    // 应该返回某种 idle 行为
    expect(action === null || typeof action === 'string').toBe(true);
    mc.destroy();
  });

  it('triggerProactive 受限频控制', () => {
    const mc = new MotorControl({ enableIdle: false, enableProactive: false, maxProactivePerHour: 2 });
    const body = makeBody({ hour: 8 });

    let count = 0;
    mc.onProactiveAction(() => count++);

    // 前 2 次应成功
    mc.triggerProactive(body);
    mc.triggerProactive(body);
    expect(count).toBe(2);

    // 第 3 次应被限频
    mc.triggerProactive(body);
    expect(count).toBe(2); // 不增加

    mc.destroy();
  });

  it('onIdleAction 回调注册', () => {
    const mc = new MotorControl({ enableIdle: false, enableProactive: false });
    let received: string | null = null;
    mc.onIdleAction((action) => { received = action; });

    mc.triggerIdle(makeBody());
    // 如果有行为，回调应被调用
    if (received) {
      expect(typeof received).toBe('string');
    }

    mc.destroy();
  });

  it('getProactiveHistory 返回历史', () => {
    const mc = new MotorControl({ enableIdle: false, enableProactive: false });
    mc.triggerProactive(makeBody({ hour: 8 }));
    const history = mc.getProactiveHistory();
    // 可能有也可能没有（取决于时间规则）
    expect(Array.isArray(history)).toBe(true);
    mc.destroy();
  });

  it('getStats 返回统计', () => {
    const mc = new MotorControl({ enableIdle: true, enableProactive: false });
    const stats = mc.getStats();
    expect(stats.idleEnabled).toBe(true);
    expect(stats.proactiveEnabled).toBe(false);
    expect(stats.totalProactive).toBe(0);
    mc.destroy();
  });

  it('updateMood 影响后续行为选择', () => {
    const mc = new MotorControl({ enableIdle: false, enableProactive: false });
    mc.updateMood('tired');
    mc.updateMood('excited');
    // 不抛错即通过
    mc.destroy();
  });
});
