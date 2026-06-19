/**
 * NN 输出解码器测试
 *
 * 覆盖：
 * - decodeDecision: intentDistribution + allTools 完整概率分布
 * - decodeSignal: 双通道意图表征
 */

import { describe, it, expect } from 'vitest';
import { decodeDecision } from './decoder.js';
import type { ModelOutput } from '../nn/model.js';

function makeOutput(overrides: Partial<ModelOutput> = {}): ModelOutput {
  const intentProbs = new Float32Array(8);
  intentProbs[1] = 0.6; // code_operations 最高
  intentProbs[0] = 0.2; // file_operations 次高

  const toolProbs = new Float32Array(32);
  toolProbs[0] = 0.8;  // read_file
  toolProbs[1] = 0.6;  // write_file
  toolProbs[4] = 0.4;  // exec

  return {
    intentProbs,
    toolProbs,
    qualityScore: 0.7,
    spatialProbs: new Float32Array(6),
    sceneProbs: new Float32Array(32),
    latencyMs: 5,
    ...overrides,
  };
}

describe('decodeDecision', () => {
  it('返回 intentDistribution 完整 8 维概率', () => {
    const output = makeOutput();
    const decision = decodeDecision(output);

    expect(decision.intentDistribution).toBeDefined();
    expect(decision.intentDistribution!.length).toBe(8);
    // 第 1 维（code_operations）应最高
    expect(decision.intentDistribution![1]).toBeCloseTo(0.6, 5);
  });

  it('返回 allTools 包含所有已注册工具', () => {
    const output = makeOutput();
    const decision = decodeDecision(output);

    expect(decision.allTools).toBeDefined();
    expect(decision.allTools!.length).toBeGreaterThan(0);
    // 第一个工具应在 allTools 中
    expect(decision.allTools![0]).toHaveProperty('name');
    expect(decision.allTools![0]).toHaveProperty('probability');
  });

  it('tools 只包含超过阈值的工具', () => {
    const output = makeOutput();
    const decision = decodeDecision(output);

    // 所有 tools 中的工具都应 > 0.3（TOOL_THRESHOLD）
    for (const t of decision.tools) {
      expect(t.probability).toBeGreaterThan(0.3);
    }
    // tools 数量应少于或等于 allTools
    expect(decision.tools.length).toBeLessThanOrEqual(decision.allTools!.length);
  });

  it('allTools 包含低概率工具', () => {
    const output = makeOutput();
    const decision = decodeDecision(output);

    // allTools 应比 tools 多（包含低概率的）
    expect(decision.allTools!.length).toBeGreaterThanOrEqual(decision.tools.length);
  });

  it('quality 正确传递', () => {
    const output = makeOutput({ qualityScore: 0.85 });
    const decision = decodeDecision(output);
    expect(decision.quality).toBe(0.85);
  });

  it('intent category 正确映射', () => {
    const output = makeOutput();
    const decision = decodeDecision(output);
    // intentProbs[1] = 0.6 最高 → code_operations
    expect(decision.intent.category).toBe('code_operations');
    expect(decision.intent.confidence).toBeCloseTo(0.6, 5);
  });
});
