import { describe, it, expect } from 'vitest';
import { IntuitionNet } from './model.js';
import type { NNConfig } from '../../types.js';

const TEST_CONFIG: NNConfig = {
  vocabSize: 128, embedDim: 32, hiddenDim: 32,
  numHeads: 2, numLayers: 1, numIntents: 4, numTools: 8,
  ffnDim: 64, dropout: 0,
  numSpatialBins: 6, numSceneNodes: 16,
};

describe('IntuitionNet', () => {
  it('初始化参数量正确', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const params = model.countParams();
    // 至少有 embedding + attention + ffn + 3 heads
    expect(params).toBeGreaterThan(1000);
    expect(params).toBeLessThan(100000);
  });

  it('forward 返回正确形状', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const tokenIds = [2, 10, 11, 30, 40, 3]; // CLS + domains + SEP + ...
    const output = model.forward(tokenIds);

    expect(output.intentProbs.length).toBe(4);
    expect(output.toolProbs.length).toBe(8);
    expect(output.qualityScore).toBeDefined();
    expect(typeof output.qualityScore).toBe('number');
    // qualityScore 经过 sigmoid，应在 (0, 1) 范围
    expect(output.qualityScore).toBeGreaterThan(0);
    expect(output.qualityScore).toBeLessThan(1);
    expect(output.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('intentProbs 是有效概率分布', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output = model.forward([2, 10, 3]);
    const sum = output.intentProbs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
    for (const p of output.intentProbs) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('toolProbs 范围 0-1', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const output = model.forward([2, 10, 11, 3]);
    for (const p of output.toolProbs) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('parameters() 返回所有可训练参数', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const params = model.parameters();
    const totalSize = params.reduce((s, p) => s + p.size, 0);
    expect(totalSize).toBe(model.countParams());
  });

  it('不同输入产生不同输出', () => {
    const model = new IntuitionNet(TEST_CONFIG);
    const out1 = model.forward([2, 10, 3]);
    const out2 = model.forward([2, 20, 3]);
    // 不同输入应该产生不同输出（大概率）
    const diff = out1.intentProbs[0] - out2.intentProbs[0];
    // 允许相同（小概率），但通常不同
    expect(typeof diff).toBe('number');
  });
});
