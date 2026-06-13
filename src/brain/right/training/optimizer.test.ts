import { describe, it, expect } from 'vitest';
import { SGD } from './optimizer.js';
import { Tensor, zeros } from '../nn/tensor.js';

function makeParam(values: number[]): Tensor {
  return new Tensor(new Float32Array(values), [values.length]);
}

describe('SGD 优化器', () => {
  it('基础 SGD 更新方向正确', () => {
    const opt = new SGD({ learningRate: 0.1, momentum: 0, weightDecay: 0, maxGradNorm: 0, schedule: 'constant', scheduleParams: {} });
    const p = makeParam([10, 20]);
    p.grad = new Float32Array([1, -2]);

    opt.step_update([p]);

    // w = w - lr * grad → [10-0.1, 20+0.2] = [9.9, 20.2]
    expect(p.data[0]).toBeCloseTo(9.9, 5);
    expect(p.data[1]).toBeCloseTo(20.2, 5);
  });

  it('动量加速收敛', () => {
    const opt = new SGD({ learningRate: 0.01, momentum: 0.9, weightDecay: 0, maxGradNorm: 0, schedule: 'constant', scheduleParams: {} });
    const p = makeParam([0]);
    p.grad = new Float32Array([1]);

    // 连续 10 步，动量应加速
    for (let i = 0; i < 10; i++) {
      p.grad = new Float32Array([1]);
      opt.step_update([p]);
    }

    // 10 步后应该明显移动
    expect(p.data[0]).toBeLessThan(-0.05);
  });

  it('梯度裁剪生效', () => {
    const opt = new SGD({ learningRate: 0.1, momentum: 0, weightDecay: 0, maxGradNorm: 1.0, schedule: 'constant', scheduleParams: {} });
    const p = makeParam([0]);
    p.grad = new Float32Array([100]); // 大梯度

    opt.step_update([p]);

    // 裁剪后 grad = 100 * (1/100) = 1, 更新 = 0.1 * 1 = 0.1
    expect(p.data[0]).toBeCloseTo(-0.1, 3);
  });

  it('学习率衰减', () => {
    const opt = new SGD({
      learningRate: 1.0, momentum: 0, weightDecay: 0, maxGradNorm: 0,
      schedule: 'exponential', scheduleParams: { decayRate: 0.5, minLr: 0.01 },
    });

    const initialLr = opt.lr;
    expect(initialLr).toBe(1.0);

    // 模拟多步
    const p = makeParam([0]);
    for (let i = 0; i < 10; i++) {
      p.grad = new Float32Array([1]);
      opt.step_update([p]);
    }

    expect(opt.lr).toBeLessThan(initialLr);
    expect(opt.lr).toBeGreaterThanOrEqual(0.01); // minLr
  });

  it('L2 正则化', () => {
    const opt = new SGD({ learningRate: 0.1, momentum: 0, weightDecay: 0.1, maxGradNorm: 0, schedule: 'constant', scheduleParams: {} });
    const p = makeParam([10]);
    p.grad = new Float32Array([0]); // 无任务梯度

    opt.step_update([p]);

    // L2 梯度 = 0.1 * 10 = 1, 更新 = 0.1 * 1 = 0.1
    expect(p.data[0]).toBeCloseTo(9.9, 3);
  });
});
