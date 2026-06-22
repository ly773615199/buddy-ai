import { describe, it, expect, vi } from 'vitest';
import { UnifiedResourceHub } from '../unified-resource-hub.js';
import { BatchProbeScheduler } from '../batch-probe-scheduler.js';
import type { ResourceProber, UnifiedResource, CapabilitySnapshot, ResourceType } from '../types.js';

function makeProber(type: ResourceType, result?: Partial<CapabilitySnapshot>): ResourceProber {
  return {
    resourceType: type,
    probeIntervalMs: 60_000,
    probeTimeoutMs: 5_000,
    probe: vi.fn(async (_resource: UnifiedResource): Promise<CapabilitySnapshot> => ({
      timestamp: Date.now(),
      source: 'probe',
      capabilities: {
        reachable: { value: true, verified: true, sourcePriority: 4, lastVerifiedAt: Date.now() },
      },
      confidence: 1,
      latencyMs: 50,
      ...result,
    })),
  };
}

describe('BatchProbeScheduler', () => {
  it('probeOne calls prober and updates hub', async () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const prober = makeProber('model');
    const probers = new Map<ResourceType, ResourceProber>();
    probers.set('model', prober);

    const scheduler = new BatchProbeScheduler(hub, probers);
    const snapshot = await scheduler.probeOne(hub.get('m1')!);

    expect(prober.probe).toHaveBeenCalledOnce();
    expect(snapshot).not.toBeNull();
    expect(hub.get('m1')!.state).toBe('active');
  });

  it('probeAll processes all resources', async () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'model1' });
    hub.register({ id: 't1', type: 'tool', name: 'tool1' });

    const modelProber = makeProber('model');
    const toolProber = makeProber('tool');
    const probers = new Map<ResourceType, ResourceProber>();
    probers.set('model', modelProber);
    probers.set('tool', toolProber);

    const scheduler = new BatchProbeScheduler(hub, probers, { delayBetweenMs: 0 });
    await scheduler.probeAll();

    expect(modelProber.probe).toHaveBeenCalledOnce();
    expect(toolProber.probe).toHaveBeenCalledOnce();
  });

  it('probeOne handles prober errors gracefully', async () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'test' });

    const prober: ResourceProber = {
      resourceType: 'model',
      probeIntervalMs: 60_000,
      probeTimeoutMs: 5_000,
      probe: vi.fn(async () => { throw new Error('connection refused'); }),
    };
    const probers = new Map<ResourceType, ResourceProber>();
    probers.set('model', prober);

    const scheduler = new BatchProbeScheduler(hub, probers);
    const snapshot = await scheduler.probeOne(hub.get('m1')!);

    expect(snapshot).toBeNull();
    expect(hub.get('m1')!.state).toBe('rejected');
  });

  it('prioritize puts degraded before active', async () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'active-model' });
    hub.register({ id: 'm2', type: 'model', name: 'degraded-model' });
    hub.markState('m1', 'active');
    hub.markState('m2', 'active');
    hub.markState('m2', 'degraded');

    const probeOrder: string[] = [];
    const prober: ResourceProber = {
      resourceType: 'model',
      probeIntervalMs: 60_000,
      probeTimeoutMs: 5_000,
      probe: vi.fn(async (r: UnifiedResource) => {
        probeOrder.push(r.id);
        return {
          timestamp: Date.now(),
          source: 'probe',
          capabilities: {},
          confidence: 1,
          latencyMs: 10,
        };
      }),
    };
    const probers = new Map<ResourceType, ResourceProber>();
    probers.set('model', prober);

    const scheduler = new BatchProbeScheduler(hub, probers, { concurrency: 1, delayBetweenMs: 0 });
    await scheduler.probeAll();

    // degraded should be probed first
    expect(probeOrder[0]).toBe('m2');
  });

  it('probeByType only probes specified type', async () => {
    const hub = new UnifiedResourceHub();
    hub.register({ id: 'm1', type: 'model', name: 'model' });
    hub.register({ id: 't1', type: 'tool', name: 'tool' });
    hub.markState('m1', 'active');
    hub.markState('t1', 'active');

    const modelProber = makeProber('model');
    const toolProber = makeProber('tool');
    const probers = new Map<ResourceType, ResourceProber>();
    probers.set('model', modelProber);
    probers.set('tool', toolProber);

    const scheduler = new BatchProbeScheduler(hub, probers, { delayBetweenMs: 0 });
    await scheduler.probeByType('model');

    expect(modelProber.probe).toHaveBeenCalledOnce();
    expect(toolProber.probe).not.toHaveBeenCalled();
  });
});
