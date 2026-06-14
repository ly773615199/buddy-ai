import { describe, it, expect, vi } from 'vitest';
import { LifecycleManager } from '../lifecycle-manager.js';
import { DriftDetector } from '../drift-detector.js';
import type { UnifiedResource, CapabilitySnapshot } from '../types.js';

function makeResource(overrides?: Partial<UnifiedResource>): UnifiedResource {
  return {
    id: 'test/model-1',
    type: 'model',
    name: 'test-model',
    state: 'discovered',
    capabilities: {},
    capabilityTimeline: [],
    driftAlerts: [],
    stats: { totalCalls: 0, successes: 0, failures: 0, avgLatencyMs: 0, totalCost: 0, lastUsedAt: 0, byTaskType: {}, byDomain: {} },
    healthScore: 50,
    consecutiveProbeFailures: 0,
    consecutiveExecFailures: 0,
    marginalContribution: null,
    createdAt: Date.now(),
    lastStateChange: Date.now(),
    lastProbeAt: 0,
    metadata: {},
    ...overrides,
  };
}

describe('LifecycleManager', () => {
  it('discovered → active on probe success', () => {
    const lm = new LifecycleManager();
    const r = makeResource();
    lm.onProbeSucceeded(r);
    expect(r.state).toBe('active');
  });

  it('discovered → rejected on probe failure', () => {
    const lm = new LifecycleManager();
    const r = makeResource();
    lm.onProbeFailed(r, 'timeout');
    expect(r.state).toBe('rejected');
  });

  it('active → degraded after 3 consecutive failures', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'active' });
    lm.onProbeFailed(r);
    expect(r.state).toBe('active'); // 1 failure
    lm.onProbeFailed(r);
    expect(r.state).toBe('active'); // 2 failures
    lm.onProbeFailed(r);
    expect(r.state).toBe('degraded'); // 3 failures
  });

  it('degraded → active on probe success', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'degraded', consecutiveProbeFailures: 3 });
    lm.onProbeSucceeded(r);
    expect(r.state).toBe('active');
    expect(r.consecutiveProbeFailures).toBe(0);
  });

  it('degraded → deprecated after 5 consecutive failures', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'degraded', consecutiveProbeFailures: 3 });
    lm.onProbeFailed(r);
    lm.onProbeFailed(r);
    expect(r.state).toBe('deprecated');
  });

  it('deprecated → active on audit revive', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'deprecated' });
    lm.onAuditRevive(r);
    expect(r.state).toBe('active');
  });

  it('deprecated → deceased on cleanup', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'deprecated' });
    lm.onCleanup(r);
    expect(r.state).toBe('deceased');
  });

  it('deceased is terminal', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'deceased' });
    expect(lm.transition(r, 'active')).toBe(false);
    expect(r.state).toBe('deceased');
  });

  it('rejected → discovered on retry', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'rejected' });
    lm.onProbeSucceeded(r);
    expect(r.state).toBe('discovered');
  });

  it('fires event handlers on transition', () => {
    const lm = new LifecycleManager();
    const handler = vi.fn();
    lm.on(handler);
    const r = makeResource();
    lm.onProbeSucceeded(r);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: 'test/model-1',
      from: 'discovered',
      to: 'active',
    }));
  });

  it('audit retire transitions to deprecated', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'active' });
    lm.onAuditRetire(r, 'low marginal contribution');
    expect(r.state).toBe('deprecated');
  });

  it('execution failure triggers degraded after 3 failures', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'active' });
    lm.onExecutionFailed(r);
    lm.onExecutionFailed(r);
    expect(r.state).toBe('active');
    lm.onExecutionFailed(r);
    expect(r.state).toBe('degraded');
  });

  it('execution success recovers from degraded', () => {
    const lm = new LifecycleManager();
    const r = makeResource({ state: 'degraded' });
    lm.onExecutionSucceeded(r);
    expect(r.state).toBe('active');
  });
});

describe('DriftDetector', () => {
  it('no drift with stable boolean values', () => {
    const dd = new DriftDetector();
    const rid = 'test/model-1';
    for (let i = 0; i < 5; i++) {
      const alert = dd.detect(rid, 'toolCalling', true);
      expect(alert).toBeNull();
    }
  });

  it('detects drift on boolean flip', () => {
    const dd = new DriftDetector({ windowSize: 10, warningThreshold: 0.3, criticalThreshold: 0.6 });
    const rid = 'test/model-1';
    // Fill window with true
    for (let i = 0; i < 5; i++) dd.detect(rid, 'toolCalling', true);
    // Now flip to false — 5/6 = 0.83 drift
    const alert = dd.detect(rid, 'toolCalling', false);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe('critical');
  });

  it('detects warning level drift on partial flip', () => {
    const dd = new DriftDetector({ windowSize: 10, warningThreshold: 0.3, criticalThreshold: 0.6 });
    const rid = 'test/model-1';
    // Mix values
    dd.detect(rid, 'latency', 100);
    dd.detect(rid, 'latency', 100);
    dd.detect(rid, 'latency', 100);
    dd.detect(rid, 'latency', 100);
    // Spike — CV should be moderate
    const alert = dd.detect(rid, 'latency', 500);
    // CV = std/mean — with [100,100,100,100,500] mean=180 std≈160 CV≈0.89
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe('critical');
  });

  it('returns null when insufficient data', () => {
    const dd = new DriftDetector();
    const alert = dd.detect('r1', 'dim', 42);
    expect(alert).toBeNull();
  });

  it('batch detectSnapshot returns alerts for drifted dimensions', () => {
    const dd = new DriftDetector({ windowSize: 10, warningThreshold: 0.2, criticalThreshold: 0.5 });
    const rid = 'test/model-1';
    // Pre-fill
    for (let i = 0; i < 5; i++) {
      dd.detect(rid, 'vision', true);
      dd.detect(rid, 'maxContext', 4096);
    }
    const snapshot: CapabilitySnapshot = {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {
        vision: { value: false, verified: true, lastVerifiedAt: Date.now() },
        maxContext: { value: 4096, verified: true, lastVerifiedAt: Date.now() },
      },
      confidence: 1,
      latencyMs: 100,
    };
    const alerts = dd.detectSnapshot(rid, snapshot);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some(a => a.dimension === 'vision')).toBe(true);
  });

  it('clear removes all data for resource', () => {
    const dd = new DriftDetector();
    dd.detect('r1', 'a', true);
    dd.detect('r1', 'b', 42);
    dd.clear('r1');
    expect(dd.getHistory('r1', 'a')).toHaveLength(0);
    expect(dd.getHistory('r1', 'b')).toHaveLength(0);
  });
});
