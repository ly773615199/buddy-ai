import { describe, it, expect } from 'vitest';
import { backwardPass } from './backward.js';
import { IntuitionNet } from '../nn/model.js';
import type { NNConfig } from '../../types.js';
import type { SpanLossWeights } from './loss.js';

const TEST_CONFIG: NNConfig = {
  vocabSize: 128, embedDim: 32, hiddenDim: 32,
  numHeads: 2, numLayers: 1, numIntents: 4, numTools: 8,
  ffnDim: 64, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

const LOSS_WEIGHTS: SpanLossWeights = { alpha: 0.3, beta: 0.3, gamma: 0.1, delta: 0.15, epsilon: 0.15 };

describe('backwardPass', () => {
  it('返回各项 loss 值', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output = model.forward([2, 10, 11, 3]);

    const loss = backwardPass(model, output, 0, [1, 0, 0, 0, 0, 0, 0, 0], 0.8, LOSS_WEIGHTS);

    expect(loss.total).toBeGreaterThan(0);
    expect(loss.intent).toBeGreaterThan(0);
    expect(loss.tool).toBeGreaterThanOrEqual(0);
    expect(loss.quality).toBeGreaterThanOrEqual(0);
  });

  it('输出头参数有梯度（缓存命中时）', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output = model.forward([2, 10, 3]);

    // 确认缓存已设置
    expect(model.heads.intentHead._cachedH).not.toBeNull();

    backwardPass(model, output, 1, [0, 1, 0, 0, 0, 0, 0, 0], 0.5, LOSS_WEIGHTS);

    // 输出头参数应有梯度
    const headParams = model.heads.parameters();
    let headHasGrad = false;
    for (const p of headParams) {
      if (p.grad && p.grad.some(g => g !== 0)) {
        headHasGrad = true;
        break;
      }
    }
    expect(headHasGrad).toBe(true);
  });

  it('不同标签产生不同 loss', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output1 = model.forward([2, 10, 3]);
    const loss1 = backwardPass(model, output1, 0, [1, 0, 0, 0, 0, 0, 0, 0], 0.8, LOSS_WEIGHTS);

    const output2 = model.forward([2, 10, 3]);
    const loss2 = backwardPass(model, output2, 3, [0, 0, 0, 1, 0, 0, 0, 0], 0.2, LOSS_WEIGHTS);

    expect(loss1.intent).not.toBeCloseTo(loss2.intent, 1);
  });

  it('loss 权重影响总 loss', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output1 = model.forward([2, 10, 3]);
    const w1: SpanLossWeights = { alpha: 1, beta: 0, gamma: 0, delta: 0, epsilon: 0 };
    const loss1 = backwardPass(model, output1, 0, [1, 0, 0, 0, 0, 0, 0, 0], 0.5, w1);

    const output2 = model.forward([2, 10, 3]);
    const w2: SpanLossWeights = { alpha: 0, beta: 1, gamma: 0, delta: 0, epsilon: 0 };
    const loss2 = backwardPass(model, output2, 0, [1, 0, 0, 0, 0, 0, 0, 0], 0.5, w2);

    expect(loss1.total).not.toBeCloseTo(loss2.total, 1);
  });
});
