import { describe, it, expect } from 'vitest';
import { DecisionExplainer } from './decision-explainer.js';

describe('DecisionExplainer', () => {
  it('记录和查询 trace', () => {
    const explainer = new DecisionExplainer();
    explainer.record({
      id: 'trace-1',
      timestamp: Date.now(),
      input: { taskType: 'tools', complexity: 'medium', domains: [] },
      layers: [
        { name: 'static_filter', inputCount: 40, outputCount: 35, filters: [], durationMs: 0 },
        { name: 'metadata_filter', inputCount: 35, outputCount: 10, filters: [], durationMs: 0 },
        { name: 'thompson_select', inputCount: 10, outputCount: 1, filters: [], durationMs: 0 },
      ],
      result: { modelId: 'deepseek/chat', provider: 'deepseek', reason: 'Thompson', confidence: 0.8, source: 'thompson' },
      filtered: [],
      totalMs: 0.5,
    });

    expect(explainer.count()).toBe(1);
    expect(explainer.getRecent(1)).toHaveLength(1);
    expect(explainer.getBySelectedModel('deepseek/chat')).toHaveLength(1);
    expect(explainer.getByTaskType('tools')).toHaveLength(1);
  });

  it('maxTraces 限制', () => {
    const explainer = new DecisionExplainer(5);
    for (let i = 0; i < 10; i++) {
      explainer.record({
        id: `trace-${i}`,
        timestamp: Date.now(),
        input: { taskType: 'chat', complexity: 'simple', domains: [] },
        layers: [],
        result: { modelId: 'test', provider: 'test', reason: '', confidence: 0, source: '' },
        filtered: [],
        totalMs: 0,
      });
    }
    expect(explainer.count()).toBe(5);
    expect(explainer.getRecent(1)[0].id).toBe('trace-9');
  });

  it('formatRecent 输出可读文本', () => {
    const explainer = new DecisionExplainer();
    explainer.record({
      id: 'trace-1',
      timestamp: Date.now(),
      input: { taskType: 'tools', complexity: 'medium', domains: [] },
      layers: [
        { name: 'static_filter', inputCount: 40, outputCount: 35, filters: [], durationMs: 0 },
        { name: 'thompson_select', inputCount: 10, outputCount: 1, filters: [], durationMs: 0 },
      ],
      result: { modelId: 'deepseek/chat', provider: 'deepseek', reason: 'Thompson', confidence: 0.8, source: 'thompson' },
      filtered: [],
      totalMs: 0.5,
    });

    const text = explainer.formatRecent(1);
    expect(text).toContain('tools');
    expect(text).toContain('static_filter');
    expect(text).toContain('deepseek/chat');
    expect(text).toContain('0.50ms');
  });

  it('平均延迟计算', () => {
    const explainer = new DecisionExplainer();
    for (let i = 0; i < 3; i++) {
      explainer.record({
        id: `trace-${i}`,
        timestamp: Date.now(),
        input: { taskType: 'chat', complexity: 'simple', domains: [] },
        layers: [],
        result: { modelId: 'test', provider: 'test', reason: '', confidence: 0, source: '' },
        filtered: [],
        totalMs: (i + 1) * 10,
      });
    }
    expect(explainer.getAverageLatencyMs()).toBe(20); // (10+20+30)/3
  });

  it('空 trace 格式化', () => {
    const explainer = new DecisionExplainer();
    expect(explainer.formatRecent()).toBe('无决策记录');
  });
});
