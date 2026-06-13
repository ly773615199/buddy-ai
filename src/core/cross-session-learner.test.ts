import { describe, it, expect } from 'vitest';
import { CrossSessionLearner } from './cross-session-learner.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CrossSessionLearner', () => {
  const tmpDir = path.join(os.tmpdir(), `buddy-test-${Date.now()}`);

  it('上报和查询全局参数', () => {
    const learner = new CrossSessionLearner(tmpDir, 'test-session');
    learner.reportOutcome('tools', 'deepseek/chat', true, 500);
    learner.reportOutcome('tools', 'deepseek/chat', true, 300);
    learner.reportOutcome('tools', 'deepseek/chat', false, 1000);

    const params = learner.getParams('tools:deepseek/chat');
    expect(params).not.toBeNull();
    expect(params!.totalSamples).toBe(3);
    expect(params!.alpha).toBeGreaterThan(2); // 2 次成功
    expect(params!.beta).toBeGreaterThan(1);  // 1 次失败
    expect(params!.sourceSessions).toContain('test-session');
  });

  it('initializeLocal 返回衰减后的参数', () => {
    const learner = new CrossSessionLearner(tmpDir, 'test-session-2');
    learner.reportOutcome('chat', 'openai/gpt-4o', true, 200);

    const local = learner.initializeLocal('chat:openai/gpt-4o');
    expect(local).not.toBeNull();
    expect(local!.alpha).toBeGreaterThan(1);
    expect(local!.beta).toBeGreaterThanOrEqual(1);
  });

  it('不存在的 key → null', () => {
    const learner = new CrossSessionLearner(tmpDir, 'test-session-3');
    expect(learner.initializeLocal('nonexistent:key')).toBeNull();
  });

  it('全局统计', () => {
    const learner = new CrossSessionLearner(tmpDir, 'test-session-4');
    learner.reportOutcome('tools', 'a', true, 100);
    learner.reportOutcome('chat', 'b', false, 200);

    const stats = learner.getGlobalStats();
    expect(stats.totalKeys).toBeGreaterThanOrEqual(2);
    expect(stats.totalSamples).toBeGreaterThanOrEqual(2);
  });

  it('持久化后重新加载', () => {
    const dir = path.join(tmpDir, 'persist-test');
    const learner1 = new CrossSessionLearner(dir, 'session-1');
    learner1.reportOutcome('tools', 'test/model', true, 100);

    // 新实例加载
    const learner2 = new CrossSessionLearner(dir, 'session-2');
    const params = learner2.getParams('tools:test/model');
    expect(params).not.toBeNull();
    expect(params!.totalSamples).toBe(1);
  });
});
