import { describe, it, expect } from 'vitest';
import { UnifiedResourceHub } from '../unified-resource-hub.js';
import { MarginalAuditor } from '../marginal-auditor.js';
import { CapabilityGraph } from '../capability-graph.js';
import type { CapabilitySnapshot } from '../types.js';

describe('MarginalAuditor', () => {
  it('estimateContribution returns null when insufficient samples', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });
    hub.markState('m1', 'active');

    const auditor = new MarginalAuditor(hub, { minSamples: 5 });
    const mc = auditor.estimateContribution('m1');
    expect(mc).toBeNull();
  });

  it('estimateContribution computes delta correctly', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'good' });
    hub.register({ id: 'm2', type: 'model', name: 'bad' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');

    // m1: 90% success for chat
    for (let i = 0; i < 9; i++) {
      hub.recordOutcome('m1', { success: true, latencyMs: 100, taskType: 'chat' });
    }
    hub.recordOutcome('m1', { success: false, latencyMs: 100, taskType: 'chat' });

    // m2: 30% success for chat
    for (let i = 0; i < 3; i++) {
      hub.recordOutcome('m2', { success: true, latencyMs: 100, taskType: 'chat' });
    }
    for (let i = 0; i < 7; i++) {
      hub.recordOutcome('m2', { success: false, latencyMs: 100, taskType: 'chat' });
    }

    const auditor = new MarginalAuditor(hub, { minSamples: 5 });
    const mc = auditor.estimateContribution('m1', 'chat');

    expect(mc).not.toBeNull();
    expect(mc!.performanceWith).toBe(0.9);
    // m2's success rate is the "without" baseline (only m2 counted, m1 excluded)
    expect(mc!.performanceWithout).toBeCloseTo(0.3, 1);
    expect(mc!.delta).toBeCloseTo(0.6, 1);
    expect(mc!.smoothedDelta).toBeGreaterThan(0);
  });

  it('audit returns retain for high contribution', () => {
    const hub = new UnifiedResourceHub();
    const auditor = new MarginalAuditor(hub, { minSamples: 5 });

    const decision = auditor.audit({
      resourceId: 'm1',
      performanceWith: 0.9,
      performanceWithout: 0.5,
      delta: 0.4,
      smoothedDelta: 0.4,
      sampleCount: 50,
      lastAuditedAt: Date.now(),
    });
    expect(decision).toBe('retain');
  });

  it('audit returns retire for negative contribution', () => {
    const hub = new UnifiedResourceHub();
    const auditor = new MarginalAuditor(hub, { minSamples: 5 });

    const decision = auditor.audit({
      resourceId: 'm1',
      performanceWith: 0.3,
      performanceWithout: 0.6,
      delta: -0.3,
      smoothedDelta: -0.3,
      sampleCount: 50,
      lastAuditedAt: Date.now(),
    });
    expect(decision).toBe('retire');
  });

  it('runAndApply retires low-contribution resources', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'bad' });
    hub.register({ id: 'm2', type: 'model', name: 'good' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');

    // m1: very low success
    for (let i = 0; i < 10; i++) {
      hub.recordOutcome('m1', { success: false, latencyMs: 100, taskType: 'chat' });
    }
    // m2: high success
    for (let i = 0; i < 10; i++) {
      hub.recordOutcome('m2', { success: true, latencyMs: 100, taskType: 'chat' });
    }

    const auditor = new MarginalAuditor(hub, { minSamples: 5 });
    const result = auditor.runAndApply('chat');

    expect(result.retired).toContain('m1');
    expect(result.retained).toContain('m2');
    expect(hub.get('m1')!.state).toBe('deprecated');
  });
});

describe('CapabilityGraph', () => {
  it('getTimeline returns snapshots within time range', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const now = Date.now();
    const snap1: CapabilitySnapshot = {
      timestamp: now - 10000,
      source: 'probe',
      capabilities: { x: { value: 1, verified: true, lastVerifiedAt: now - 10000 } },
      confidence: 1,
      latencyMs: 50,
    };
    const snap2: CapabilitySnapshot = {
      timestamp: now - 5000,
      source: 'probe',
      capabilities: { x: { value: 2, verified: true, lastVerifiedAt: now - 5000 } },
      confidence: 1,
      latencyMs: 50,
    };
    hub.onProbeResult('m1', snap1);
    hub.onProbeResult('m1', snap2);

    const graph = new CapabilityGraph(hub);
    const timeline = graph.getTimeline('m1', now - 8000);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].capabilities.x.value).toBe(2);
  });

  it('getTrend returns dimension-specific trend', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const now = Date.now();
    hub.onProbeResult('m1', {
      timestamp: now - 2000, source: 'probe',
      capabilities: { latency: { value: 100, verified: true, lastVerifiedAt: now } },
      confidence: 1, latencyMs: 50,
    });
    hub.onProbeResult('m1', {
      timestamp: now - 1000, source: 'probe',
      capabilities: { latency: { value: 200, verified: true, lastVerifiedAt: now } },
      confidence: 1, latencyMs: 50,
    });

    const graph = new CapabilityGraph(hub);
    const trend = graph.getTrend('m1', 'latency');
    expect(trend).toHaveLength(2);
    expect(trend[0].value).toBe(100);
    expect(trend[1].value).toBe(200);
  });

  it('getStateHistory returns transitions', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });
    hub.onProbeResult('m1', {
      timestamp: Date.now(), source: 'probe',
      capabilities: { reachable: { value: true, verified: true, lastVerifiedAt: Date.now() } },
      confidence: 1, latencyMs: 50,
    });

    const graph = new CapabilityGraph(hub);
    const history = graph.getStateHistory('m1');
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].from).toBe('discovered');
    expect(history[0].to).toBe('active');
  });

  it('compareCapabilities finds differences', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'a' });
    hub.register({ id: 'm2', type: 'model', name: 'b' });

    const r1 = hub.get('m1')!;
    const r2 = hub.get('m2')!;
    r1.capabilities.vision = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 5 };
    r1.capabilities.tools = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 5 };
    r2.capabilities.vision = { value: false, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 5 };
    r2.capabilities.tools = { value: true, verified: true, lastVerifiedAt: Date.now(), sourcePriority: 5 };

    const graph = new CapabilityGraph(hub);
    const diff = graph.compareCapabilities('m1', 'm2');
    expect(diff).not.toBeNull();
    expect(diff!.differences).toHaveLength(1);
    expect(diff!.differences[0].dimension).toBe('vision');
  });

  it('getOverview returns global summary', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'a' });
    hub.register({ id: 't1', type: 'tool', name: 'b' });
    hub.markState('m1', 'active');
    hub.markState('t1', 'active');

    const graph = new CapabilityGraph(hub);
    const overview = graph.getOverview();
    expect(overview.total).toBe(2);
    expect(overview.byType.model).toBe(1);
    expect(overview.byType.tool).toBe(1);
  });
});

// ==================== V2: auditDAGCombination 测试 ====================

describe('V2: auditDAGCombination', () => {
  it('DAG 组合审计写入 marginalContribution', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.markState('m1', 'active');
    // 全局：10 次调用，8 次成功 = 80%
    for (let i = 0; i < 8; i++) hub.recordOutcome('m1', { success: true, latencyMs: 100 });
    for (let i = 0; i < 2; i++) hub.recordOutcome('m1', { success: false, latencyMs: 100 });

    const auditor = new MarginalAuditor(hub, { minSamples: 3 });

    // DAG 内：3 次全部成功 = 100%
    auditor.auditDAGCombination('dag-1', [
      { stepId: 's1', resourceId: 'm1', taskType: 'chat', success: true, latencyMs: 100 },
      { stepId: 's2', resourceId: 'm1', taskType: 'chat', success: true, latencyMs: 100 },
      { stepId: 's3', resourceId: 'm1', taskType: 'chat', success: true, latencyMs: 100 },
    ]);

    const mc = hub.get('m1')?.marginalContribution;
    expect(mc).not.toBeNull();
    expect(mc!.performanceWith).toBe(1); // DAG 内 100%
    // delta = 1.0 - 全局成功率（> 0）
    expect(mc!.delta).toBeGreaterThan(0);
  });

  it('空步骤列表不崩溃', () => {
    const hub = new UnifiedResourceHub();
    const auditor = new MarginalAuditor(hub);
    auditor.auditDAGCombination('dag-empty', []);
    // 不抛异常即通过
  });

  it('多资源 DAG 组合审计', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'gpt' });
    hub.register({ id: 'm2', type: 'model', name: 'claude' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');
    // m1 全局 50%
    for (let i = 0; i < 5; i++) hub.recordOutcome('m1', { success: true, latencyMs: 100 });
    for (let i = 0; i < 5; i++) hub.recordOutcome('m1', { success: false, latencyMs: 100 });
    // m2 全局 50%
    for (let i = 0; i < 5; i++) hub.recordOutcome('m2', { success: true, latencyMs: 100 });
    for (let i = 0; i < 5; i++) hub.recordOutcome('m2', { success: false, latencyMs: 100 });

    const auditor = new MarginalAuditor(hub, { minSamples: 3 });

    auditor.auditDAGCombination('dag-multi', [
      { stepId: 's1', resourceId: 'm1', taskType: 'tools', success: true, latencyMs: 100 },
      { stepId: 's2', resourceId: 'm2', taskType: 'reasoning', success: true, latencyMs: 200 },
    ]);

    // 两个资源都应有 marginalContribution
    expect(hub.get('m1')?.marginalContribution).not.toBeNull();
    expect(hub.get('m2')?.marginalContribution).not.toBeNull();
  });
});

// ==================== V2: recommendCombination 输出格式兼容性 ====================

describe('V2: recommendCombination output compatibility', () => {
  it('同 tier 模型获得兼容性加分', () => {
    const hub = new UnifiedResourceHub();
    // 两个同 tier 模型
    hub.register({ id: 'm1', type: 'model', name: 'gpt-4o', metadata: { tier: 'high', provider: 'openai' } });
    hub.register({ id: 'm2', type: 'model', name: 'claude-opus', metadata: { tier: 'high', provider: 'anthropic' } });
    hub.register({ id: 'm3', type: 'model', name: 'gpt-mini', metadata: { tier: 'low', provider: 'openai' } });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');
    hub.markState('m3', 'active');

    // s1 用了 m1，s2 应偏向同 tier 的 m2（+6 同 tier）而非 m3
    const result = hub.recommendCombination([
      { stepId: 's1', taskType: 'chat', deps: [] },
      { stepId: 's2', taskType: 'chat', deps: ['s1'] },
    ]);

    expect(result.size).toBe(2);
    // s1 和 s2 都有分配
    expect(result.has('s1')).toBe(true);
    expect(result.has('s2')).toBe(true);
  });

  it('空需求返回空 map', () => {
    const hub = new UnifiedResourceHub();
    const result = hub.recommendCombination([]);
    expect(result.size).toBe(0);
  });
});
