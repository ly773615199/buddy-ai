/**
 * SpringPhysics 单元测试
 *
 * 覆盖：SpringValue / SpringVec3 / SPRING_PRESETS
 */
import { describe, it, expect } from 'vitest';
import { SpringValue, SpringVec3, SPRING_PRESETS } from '../renderer/physics/spring-physics';

describe('SpringValue', () => {
  it('初始值正确', () => {
    const s = new SpringValue(0.5);
    expect(s.getValue()).toBe(0.5);
    expect(s.getVelocity()).toBe(0);
    expect(s.isAtRest()).toBe(true);
  });

  it('update 向目标收敛', () => {
    const s = new SpringValue(0, { stiffness: 0.2, damping: 0.8 });
    let val = 0;
    // 模拟 200 帧（约 3.3 秒 @60fps）
    for (let i = 0; i < 200; i++) {
      val = s.update(1.0, 1 / 60);
    }
    expect(val).toBeGreaterThan(0.95);
    expect(val).toBeLessThanOrEqual(1.02); // 允许微小 overshoot
  });

  it('弹簧有 overshoot（回弹特性）', () => {
    const s = new SpringValue(0, { stiffness: 0.15, damping: 0.4 }); // 低阻尼
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(s.update(1.0, 1 / 60));
    }
    // 应该有某个时刻超过目标值 1.0
    const maxVal = Math.max(...values);
    expect(maxVal).toBeGreaterThan(1.0);
  });

  it('高阻尼无 overshoot', () => {
    const s = new SpringValue(0, { stiffness: 0.15, damping: 1.0 });
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(s.update(1.0, 1 / 60));
    }
    const maxVal = Math.max(...values);
    expect(maxVal).toBeLessThanOrEqual(1.01); // 几乎无 overshoot
  });

  it('set 立即跳到目标', () => {
    const s = new SpringValue(0, { stiffness: 0.1, damping: 0.5 });
    s.update(1.0, 1 / 60); // 开始运动
    s.set(5.0);
    expect(s.getValue()).toBe(5.0);
    expect(s.getVelocity()).toBe(0);
    expect(s.isAtRest()).toBe(true);
  });

  it('impulse 施加脉冲力', () => {
    const s = new SpringValue(0, { stiffness: 0, damping: 0 }); // 无弹簧无阻尼
    s.impulse(10);
    expect(s.getVelocity()).toBe(10);
    s.update(0, 1 / 60);
    expect(s.getValue()).toBeGreaterThan(0);
  });

  it('静止检测：速度低于阈值自动停止', () => {
    const s = new SpringValue(0, { stiffness: 0.01, damping: 0.99, restThreshold: 0.001 });
    // 推到接近目标
    for (let i = 0; i < 500; i++) {
      s.update(1.0, 1 / 60);
    }
    expect(s.isAtRest()).toBe(true);
    expect(s.getValue()).toBeCloseTo(1.0, 2);
  });

  it('位移限制生效', () => {
    const s = new SpringValue(0, { stiffness: 0.5, damping: 0.1, maxDisplacement: 0.3 });
    // 强力推向远超限制的目标
    for (let i = 0; i < 20; i++) {
      s.update(10.0, 1 / 60);
    }
    // 位移不应超过 maxDisplacement
    expect(Math.abs(s.getValue() - 10.0)).toBeLessThanOrEqual(0.35); // 0.3 + 小余量
  });

  it('dt 过大时 clamp 到 0.05', () => {
    const s = new SpringValue(0, { stiffness: 0.15, damping: 0.7 });
    // 传入巨大 dt（比如切 tab 回来）
    const val = s.update(1.0, 10.0); // 10 秒间隔
    expect(Number.isFinite(val)).toBe(true);
    expect(val).toBeGreaterThan(0);
  });
});

describe('SpringVec3', () => {
  it('初始值正确', () => {
    const sv = new SpringVec3([1, 2, 3]);
    expect(sv.x.getValue()).toBe(1);
    expect(sv.y.getValue()).toBe(2);
    expect(sv.z.getValue()).toBe(3);
  });

  it('update 收敛到目标', () => {
    const sv = new SpringVec3([0, 0, 0], { stiffness: 0.2, damping: 0.8 });
    let result: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 200; i++) {
      result = sv.update([1, -1, 0.5], 1 / 60);
    }
    expect(result[0]).toBeCloseTo(1, 1);
    expect(result[1]).toBeCloseTo(-1, 1);
    expect(result[2]).toBeCloseTo(0.5, 1);
  });

  it('set 重置所有分量', () => {
    const sv = new SpringVec3([0, 0, 0]);
    sv.set([5, -3, 7]);
    expect(sv.x.getValue()).toBe(5);
    expect(sv.y.getValue()).toBe(-3);
    expect(sv.z.getValue()).toBe(7);
  });

  it('impulse 各分量独立', () => {
    const sv = new SpringVec3([0, 0, 0], { stiffness: 0, damping: 0 });
    sv.impulse([1, -2, 3]);
    expect(sv.x.getVelocity()).toBe(1);
    expect(sv.y.getVelocity()).toBe(-2);
    expect(sv.z.getVelocity()).toBe(3);
  });
});

describe('SPRING_PRESETS', () => {
  it('所有预设参数合理', () => {
    for (const [name, preset] of Object.entries(SPRING_PRESETS)) {
      expect(preset.stiffness, `${name}.stiffness`).toBeGreaterThan(0);
      expect(preset.stiffness, `${name}.stiffness`).toBeLessThanOrEqual(1);
      expect(preset.damping, `${name}.damping`).toBeGreaterThan(0);
      expect(preset.damping, `${name}.damping`).toBeLessThanOrEqual(1);
      expect(preset.maxDisplacement, `${name}.maxDisplacement`).toBeGreaterThan(0);
    }
  });

  it('尾巴比耳朵更松软（stiffness 更低）', () => {
    expect(SPRING_PRESETS.tail.stiffness).toBeLessThan(SPRING_PRESETS.ear.stiffness);
    expect(SPRING_PRESETS.tail.damping).toBeLessThan(SPRING_PRESETS.ear.damping);
  });

  it('身体比附属物更紧（stiffness 更高）', () => {
    expect(SPRING_PRESETS.body.stiffness).toBeGreaterThan(SPRING_PRESETS.ear.stiffness);
    expect(SPRING_PRESETS.body.stiffness).toBeGreaterThan(SPRING_PRESETS.tail.stiffness);
  });
});
