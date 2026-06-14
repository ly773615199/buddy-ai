import { describe, it, expect, vi } from 'vitest';
import { UnifiedResourceHub } from '../unified-resource-hub.js';
import { ResourceHubAdapter } from '../resource-hub-adapter.js';
import type { CapabilitySnapshot } from '../types.js';

describe('UnifiedResourceHub', () => {
  it('register creates resource in discovered state', () => {
    const hub = new UnifiedResourceHub();
    const r = hub.register({ id: 'm1', type: 'model', name: 'test' });
    expect(r.state).toBe('discovered');
    expect(r.type).toBe('model');
  });

  it('register same id returns existing without duplicating', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'v1' });
    hub.register({ id: 'm1', type: 'model', name: 'v2' });
    expect(hub.getAll()).toHaveLength(1);
    expect(hub.get('m1')!.name).toBe('v2');
  });

  it('onProbeResult transitions discovered → active on success', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const snap: CapabilitySnapshot = {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {
        toolCalling: { value: true, verified: true, lastVerifiedAt: Date.now() },
      },
      confidence: 1,
      latencyMs: 100,
    };
    hub.onProbeResult('m1', snap);

    expect(hub.get('m1')!.state).toBe('active');
    expect(hub.get('m1')!.capabilities.toolCalling.value).toBe(true);
  });

  it('onProbeResult transitions discovered → rejected on error', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const snap: CapabilitySnapshot = {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {},
      confidence: 0,
      latencyMs: 0,
      error: 'connection refused',
    };
    hub.onProbeResult('m1', snap);

    expect(hub.get('m1')!.state).toBe('rejected');
  });

  it('recordOutcome updates stats and health', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });
    hub.markState('m1', 'active');

    hub.recordOutcome('m1', { success: true, latencyMs: 100, taskType: 'chat' });
    hub.recordOutcome('m1', { success: true, latencyMs: 200, taskType: 'chat' });
    hub.recordOutcome('m1', { success: false, latencyMs: 500, taskType: 'tools' });

    const r = hub.get('m1')!;
    expect(r.stats.totalCalls).toBe(3);
    expect(r.stats.successes).toBe(2);
    expect(r.stats.failures).toBe(1);
    expect(r.stats.byTaskType.chat.attempts).toBe(2);
    expect(r.stats.byTaskType.chat.successes).toBe(2);
    expect(r.stats.byTaskType.tools.attempts).toBe(1);
  });

  it('recordOutcome triggers degraded after 3 failures', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });
    hub.markState('m1', 'active');

    hub.recordOutcome('m1', { success: false, latencyMs: 100 });
    hub.recordOutcome('m1', { success: false, latencyMs: 100 });
    expect(hub.get('m1')!.state).toBe('active');

    hub.recordOutcome('m1', { success: false, latencyMs: 100 });
    expect(hub.get('m1')!.state).toBe('degraded');
  });

  it('recommend sorts by task match + health', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'good' });
    hub.register({ id: 'm2', type: 'model', name: 'bad' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');

    // m1 has high success rate for 'chat'
    for (let i = 0; i < 5; i++) {
      hub.recordOutcome('m1', { success: true, latencyMs: 100, taskType: 'chat' });
    }
    // m2 has low success rate for 'chat'
    hub.recordOutcome('m2', { success: false, latencyMs: 100, taskType: 'chat' });

    const ranked = hub.recommend('chat');
    expect(ranked[0].id).toBe('m1');
  });

  it('getActive filters by state and type', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'model1' });
    hub.register({ id: 't1', type: 'tool', name: 'tool1' });
    hub.register({ id: 'm2', type: 'model', name: 'model2' });
    hub.markState('m1', 'active');
    hub.markState('t1', 'active');
    // m2 stays discovered

    expect(hub.getActive()).toHaveLength(2);
    expect(hub.getActive('model')).toHaveLength(1);
    expect(hub.getActive('tool')).toHaveLength(1);
  });

  it('capability merging: probe overrides static', () => {
    const hub = new UnifiedResourceHub();
    const r = hub.register({ id: 'm1', type: 'model', name: 'test' });

    // Set initial static capability (sourcePriority 0)
    r.capabilities.toolCalling = { value: true, verified: false, lastVerifiedAt: 0, sourcePriority: 0 };

    // Probe says false — should override
    const snap: CapabilitySnapshot = {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {
        toolCalling: { value: false, verified: true, lastVerifiedAt: Date.now() },
      },
      confidence: 1,
      latencyMs: 100,
    };
    hub.onProbeResult('m1', snap);

    expect(hub.getCapability('m1', 'toolCalling')!.value).toBe(false);
    expect(hub.getCapability('m1', 'toolCalling')!.verified).toBe(true);
  });

  it('getHealthSummary aggregates correctly', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'a' });
    hub.register({ id: 't1', type: 'tool', name: 'b' });
    hub.register({ id: 'm2', type: 'model', name: 'c' });
    hub.markState('m1', 'active');
    hub.markState('t1', 'active');
    hub.markState('m2', 'active');
    hub.markState('m2', 'deprecated');

    const summary = hub.getHealthSummary();
    expect(summary.total).toBe(3);
    expect(summary.byState.active).toBe(2);
    expect(summary.byState.deprecated).toBe(1);
    expect(summary.byType.model).toBe(2);
    expect(summary.byType.tool).toBe(1);
  });

  it('runAudit retires low-contribution resources', () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });
    hub.markState('m1', 'active');

    hub.updateMarginalContribution('m1', {
      resourceId: 'm1',
      performanceWith: 0.3,
      performanceWithout: 0.5,
      delta: -0.2,
      smoothedDelta: -0.2,
      sampleCount: 50,
      lastAuditedAt: Date.now(),
    });

    const report = hub.runAudit();
    expect(report.retired).toContain('m1');
    expect(hub.get('m1')!.state).toBe('deprecated');
  });

  it('migrateFromLegacy converts old ResourceProfile', () => {
    const hub = new UnifiedResourceHub();
    const r = hub.migrateFromLegacy({
      id: 'model/old',
      type: 'model',
      name: 'old-model',
      status: 'active',
      healthScore: 85,
      lastHealthCheck: Date.now(),
      stats: { totalCalls: 100, successCount: 90, failureCount: 10, avgLatencyMs: 200, totalCost: 1.5, lastUsedAt: Date.now() },
      strengths: { taskTypes: { chat: { attempts: 50, successes: 45 } }, domains: {} },
    });

    expect(r.state).toBe('active');
    expect(r.stats.totalCalls).toBe(100);
    expect(r.stats.byTaskType.chat.attempts).toBe(50);
  });

  it('lifecycle event handler fires on transitions', () => {
    const hub = new UnifiedResourceHub();
    const handler = vi.fn();
    hub.onLifecycleEvent(handler);

    hub.register({ id: 'm1', type: 'model', name: 'test' });
    const snap: CapabilitySnapshot = {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {},
      confidence: 1,
      latencyMs: 50,
    };
    hub.onProbeResult('m1', snap);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      from: 'discovered',
      to: 'active',
    }));
  });
});

describe('ResourceHubAdapter', () => {
  it('register and getActive work with legacy interface', () => {
    const hub = new UnifiedResourceHub();
    const adapter = new ResourceHubAdapter(hub);

    adapter.register({ id: 'm1', type: 'model', name: 'test', status: 'active', healthScore: 80, lastHealthCheck: Date.now() });

    const active = adapter.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('m1');
    expect(active[0].status).toBe('active');
  });

  it('getActive filters by type', () => {
    const hub = new UnifiedResourceHub();
    const adapter = new ResourceHubAdapter(hub);

    adapter.register({ id: 'm1', type: 'model', name: 'model', status: 'active', healthScore: 80, lastHealthCheck: Date.now() });
    adapter.register({ id: 't1', type: 'tool', name: 'tool', status: 'active', healthScore: 80, lastHealthCheck: Date.now() });

    expect(adapter.getActive('model')).toHaveLength(1);
    expect(adapter.getActive('tool')).toHaveLength(1);
  });

  it('getUnifiedHub returns underlying hub', () => {
    const hub = new UnifiedResourceHub();
    const adapter = new ResourceHubAdapter(hub);
    expect(adapter.getUnifiedHub()).toBe(hub);
  });
});
