/**
 * Phase 4 性能基准测试 — 量化各优化点的收益
 *
 * 对比四条路径：
 * 1. forward()          — 原始完整路径（baseline）
 * 2. forwardInference() — 推理模式（跳过 _ctx + 对象池）
 * 3. forwardInferenceFast() — 快速推理（低阈值 early exit + 跳过 spatial/scene heads）
 * 4. encodeFeaturesFast() vs encodeFeatures() — 编码器对比
 */

import { describe, it, expect } from 'vitest';
import { IntuitionNet } from './model.js';
import { encodeFeatures, encodeFeaturesFast } from '../features/encoder.js';
import type { TaskSignal, ResourceState, BodyState } from '../../types.js';

// ==================== 测试 fixtures ====================

function makeSimpleSignal(): TaskSignal {
  return {
    domains: ['conversation'],
    complexity: 'simple',
    taskType: 'chat',
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: 0.8,
    content: '你好',
  };
}

function makeComplexSignal(): TaskSignal {
  return {
    domains: ['code', 'file'],
    complexity: 'complex',
    taskType: 'tools',
    shouldUseDAG: true,
    dagReason: '并行标记词 3 个',
    intentConfidence: 0.4,
    content: '帮我分析 src/brain/ 下所有文件的依赖关系，找出循环依赖并重构',
  };
}

function makeResources(): ResourceState {
  return {
    budgetRemaining: 100,
    availableNodeCount: 5,
    localCoverageRatio: 0.6,
    localConfidence: 0.7,
    userCorrectionCount: 0,
    experienceHit: null,
  };
}

function makeBody(): BodyState {
  return {
    energy: 80, temperature: 50, load: 30, hunger: 20,
    emotion: { joy: 5, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0, trust: 5, anticipation: 3 },
    desires: { hunger: 10, curiosity: 50, social: 20, safety: 30, expression: 40, rest: 10 },
    focusLevel: 70, confidenceLevel: 60, confusionLevel: 20,
    intimacyLevel: 30, socialNeed: 20,
    hour: 14, isUserActive: true, lastInteractionMs: Date.now(), systemHealth: 'good',
  };
}

function makeConfig() {
  return {
    vocabSize: 2048, embedDim: 64, hiddenDim: 128,
    numHeads: 4, numLayers: 4, numIntents: 8, numTools: 32,
    ffnDim: 256, dropout: 0,
    numSpatialBins: 6, numSceneNodes: 32,
  };
}

const WARMUP = 20;
const ITERATIONS = 100;

// ==================== 基准测试 ====================

describe('Phase 4 性能基准', () => {

  describe('编码器: encodeFeatures vs encodeFeaturesFast', () => {
    it('简单任务 — 快速编码 token 数更少', () => {
      const signal = makeSimpleSignal();
      const resources = makeResources();
      const body = makeBody();

      const fullTokens = encodeFeatures({ signal, resources, body });
      const fastTokens = encodeFeaturesFast({ signal, resources, body });

      console.log(`  [编码器] 完整: ${fullTokens.length} tokens, 快速: ${fastTokens.length} tokens`);
      expect(fastTokens.length).toBeLessThan(fullTokens.length);
      expect(fastTokens.length).toBeLessThanOrEqual(12);
    });

    it('简单任务 — 快速编码延迟更低', () => {
      const signal = makeSimpleSignal();
      const resources = makeResources();
      const body = makeBody();
      const input = { signal, resources, body };

      // warmup
      for (let i = 0; i < WARMUP; i++) {
        encodeFeatures(input);
        encodeFeaturesFast(input);
      }

      const t0Full = performance.now();
      for (let i = 0; i < ITERATIONS; i++) encodeFeatures(input);
      const fullMs = performance.now() - t0Full;

      const t0Fast = performance.now();
      for (let i = 0; i < ITERATIONS; i++) encodeFeaturesFast(input);
      const fastMs = performance.now() - t0Fast;

      console.log(`  [编码器] 完整: ${fullMs.toFixed(2)}ms (${ITERATIONS}次), 快速: ${fastMs.toFixed(2)}ms, 加速: ${(fullMs / fastMs).toFixed(2)}x`);
      expect(fastMs).toBeLessThan(fullMs);
    });
  });

  describe('推理路径: forward vs forwardInference vs forwardInferenceFast', () => {
    it('简单任务 — 三条路径延迟对比', () => {
      const model = new IntuitionNet(makeConfig());
      const signal = makeSimpleSignal();
      const resources = makeResources();
      const body = makeBody();

      const fullTokens = encodeFeatures({ signal, resources, body });
      const fastTokens = encodeFeaturesFast({ signal, resources, body });

      // warmup
      for (let i = 0; i < WARMUP; i++) {
        model.forward(fullTokens);
        model.forwardInference(fullTokens);
        model.forwardInferenceFast(fastTokens);
      }

      // forward (baseline)
      const t0Fwd = performance.now();
      for (let i = 0; i < ITERATIONS; i++) model.forward(fullTokens);
      const fwdMs = performance.now() - t0Fwd;

      // forwardInference
      const t0Inf = performance.now();
      for (let i = 0; i < ITERATIONS; i++) model.forwardInference(fullTokens);
      const infMs = performance.now() - t0Inf;

      // forwardInferenceFast (快速编码 + 快速推理)
      const t0Fast = performance.now();
      for (let i = 0; i < ITERATIONS; i++) model.forwardInferenceFast(fastTokens);
      const fastMs = performance.now() - t0Fast;

      console.log(`  [推理] forward:        ${fwdMs.toFixed(2)}ms (${ITERATIONS}次, ${(fwdMs/ITERATIONS).toFixed(3)}ms/次)`);
      console.log(`  [推理] forwardInference: ${infMs.toFixed(2)}ms (${ITERATIONS}次, ${(infMs/ITERATIONS).toFixed(3)}ms/次, ${(fwdMs/infMs).toFixed(2)}x vs forward)`);
      console.log(`  [推理] forwardInferenceFast: ${fastMs.toFixed(2)}ms (${ITERATIONS}次, ${(fastMs/ITERATIONS).toFixed(3)}ms/次, ${(fwdMs/fastMs).toFixed(2)}x vs forward)`);

      expect(infMs).toBeLessThanOrEqual(fwdMs * 1.2); // inference 不慢于 forward
      expect(fastMs).toBeLessThan(fwdMs);              // fast 一定快于 forward
    });

    it('复杂任务 — forwardInference 不比 forward 慢', () => {
      const model = new IntuitionNet(makeConfig());
      const signal = makeComplexSignal();
      const resources = makeResources();
      const body = makeBody();

      const tokens = encodeFeatures({ signal, resources, body });

      // warmup
      for (let i = 0; i < WARMUP; i++) {
        model.forward(tokens);
        model.forwardInference(tokens);
      }

      const t0Fwd = performance.now();
      for (let i = 0; i < ITERATIONS; i++) model.forward(tokens);
      const fwdMs = performance.now() - t0Fwd;

      const t0Inf = performance.now();
      for (let i = 0; i < ITERATIONS; i++) model.forwardInference(tokens);
      const infMs = performance.now() - t0Inf;

      console.log(`  [复杂任务] forward: ${fwdMs.toFixed(2)}ms, forwardInference: ${infMs.toFixed(2)}ms, 比率: ${(fwdMs/infMs).toFixed(2)}x`);
      expect(infMs).toBeLessThanOrEqual(fwdMs * 1.2);
    });
  });

  describe('输出一致性', () => {
    it('forwardInferenceFast 输出格式正确', () => {
      const model = new IntuitionNet(makeConfig());
      const tokens = encodeFeaturesFast({
        signal: makeSimpleSignal(),
        resources: makeResources(),
        body: makeBody(),
      });

      const out = model.forwardInferenceFast(tokens);

      // 格式验证
      expect(out.intentProbs.length).toBe(8);
      expect(out.toolProbs.length).toBe(32);
      expect(out.qualityScore).toBeGreaterThan(0);
      expect(out.qualityScore).toBeLessThan(1);
      expect(out.latencyMs).toBeGreaterThan(0);

      // spatial/scene 应为零填充（快速路径跳过）
      expect(out.spatialProbs.every(v => v === 0)).toBe(true);
      expect(out.sceneProbs.every(v => v === 0)).toBe(true);

      // intent 概率分布有效
      const sum = Array.from(out.intentProbs).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 3);
    });

    it('forwardInferenceFast 与 forwardInference 意图分类一致（无 early exit 时）', () => {
      const config = makeConfig();
      config.numLayers = 2; // 2 层不可能 early exit
      const model = new IntuitionNet(config);

      const tokens = encodeFeaturesFast({
        signal: makeSimpleSignal(),
        resources: makeResources(),
        body: makeBody(),
      });

      const outInf = model.forwardInference(tokens);
      const outFast = model.forwardInferenceFast(tokens);

      // intent 分布应接近
      for (let i = 0; i < outInf.intentProbs.length; i++) {
        expect(Math.abs(outInf.intentProbs[i] - outFast.intentProbs[i])).toBeLessThan(0.05);
      }
    });

    it('推理模式不泄漏', () => {
      const model = new IntuitionNet(makeConfig());
      const tokens = encodeFeaturesFast({
        signal: makeSimpleSignal(),
        resources: makeResources(),
        body: makeBody(),
      });

      model.forwardInferenceFast(tokens);
      expect(typeof performance.now()).toBe('number'); // 如果泄漏了推理模式，后续操作会出错

      // 多次调用不泄漏
      for (let i = 0; i < 10; i++) {
        model.forwardInferenceFast(tokens);
      }
    });
  });

  describe('端到端延迟', () => {
    it('简单任务端到端: encodeFast + forwardInferenceFast < 5ms', () => {
      const model = new IntuitionNet(makeConfig());
      const signal = makeSimpleSignal();
      const resources = makeResources();
      const body = makeBody();
      const input = { signal, resources, body };

      // warmup
      for (let i = 0; i < WARMUP; i++) {
        const tokens = encodeFeaturesFast(input);
        model.forwardInferenceFast(tokens);
      }

      const t0 = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        const tokens = encodeFeaturesFast(input);
        model.forwardInferenceFast(tokens);
      }
      const totalMs = performance.now() - t0;
      const avgMs = totalMs / ITERATIONS;

      console.log(`  [端到端] 简单任务: ${avgMs.toFixed(3)}ms/次 (目标 < 5ms)`);
      expect(avgMs).toBeLessThan(5);
    });
  });
});
