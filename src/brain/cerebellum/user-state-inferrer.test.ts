import { describe, it, expect } from 'vitest';
import { UserStateInferrer, type UserStateContext } from './user-state-inferrer.js';

describe('UserStateInferrer', () => {
  const inferrer = new UserStateInferrer();
  const now = Date.now();

  // 基础上下文：最近有消息（避免 idle 误触发）
  const recentMsg = { role: 'user' as const, content: '你好', timestamp: now - 60_000 };
  const baseCtx: UserStateContext = {
    content: '你好',
    recentMessages: [recentMsg],
    recentToolCalls: 0,
    now,
  };

  it('空闲 > 30 分钟 → idle', () => {
    const result = inferrer.infer({
      ...baseCtx,
      recentMessages: [
        { role: 'user', content: '你好', timestamp: now - 35 * 60 * 1000 },
      ],
    });
    expect(result.state).toBe('idle');
    expect(result.recommendAction).toBe('wait');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('否定词 → frustrated', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '不对不对，你搞错了',
      recentMessages: [
        { role: 'user', content: '帮我写个函数', timestamp: now - 120_000 },
        { role: 'assistant', content: '好的', timestamp: now - 60_000 },
      ],
    });
    expect(result.state).toBe('frustrated');
    expect(result.signals.some(s => s.includes('否定词'))).toBe(true);
  });

  it('连续失败 + 否定词 → frustrated (高置信度)', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '不对，又错了',
      consecutiveFailures: 3,
      recentMessages: [
        { role: 'user', content: '测试', timestamp: now - 60_000 },
      ],
    });
    expect(result.state).toBe('frustrated');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('催促词 + 短消息 → rushed', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '快点！',
    });
    expect(result.state).toBe('rushed');
    expect(result.recommendAction).toBe('brief');
  });

  it('工具密集 + 短消息 → focused', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '读那个文件',
      recentToolCalls: 5,
      recentMessages: [
        { role: 'user', content: '第一步', timestamp: now - 10_000 },
      ],
    });
    expect(result.state).toBe('focused');
    expect(result.recommendAction).toBe('proceed');
  });

  it('为什么 + 怎么 → learning', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '为什么 TypeScript 的泛型这么复杂？怎么理解条件类型？',
    });
    expect(result.state).toBe('learning');
    expect(result.recommendAction).toBe('detailed');
  });

  it('有什么 + 长消息 → exploring', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '有什么好的 React 状态管理方案推荐吗？我在考虑 Redux、Zustand 和 Jotai，想了解一下它们各自的优缺点',
    });
    expect(result.state).toBe('exploring');
  });

  it('短消息 + 表情 → chatting', () => {
    const result = inferrer.infer({
      ...baseCtx,
      content: '好的谢谢 😊',
    });
    expect(result.state).toBe('chatting');
    expect(result.recommendAction).toBe('proceed');
  });

  it('默认状态 → chatting', () => {
    const result = inferrer.infer(baseCtx);
    expect(result.state).toBe('chatting');
  });
});
