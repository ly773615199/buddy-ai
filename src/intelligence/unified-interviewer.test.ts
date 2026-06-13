/**
 * intelligence/unified-interviewer.ts 测试
 * 覆盖：模块导出、类型结构、类继承关系
 */
import { describe, it, expect } from 'vitest';
import { UnifiedInterviewer } from './unified-interviewer.js';
import type { CapabilityQuestion, EmotionalQuestion, UserBehaviorContext, UnifiedQuestion } from './unified-interviewer.js';
import { KnowledgeInterviewer } from './knowledge-interviewer.js';

// ==================== 模块导出 ====================

describe('UnifiedInterviewer 模块', () => {
  it('UnifiedInterviewer 类存在', () => {
    expect(UnifiedInterviewer).toBeDefined();
    expect(typeof UnifiedInterviewer).toBe('function');
  });

  it('UnifiedInterviewer 继承 KnowledgeInterviewer', () => {
    expect(UnifiedInterviewer.prototype).toBeInstanceOf(KnowledgeInterviewer);
  });

  it('类有 generateCapabilityQuestion 方法', () => {
    expect(typeof UnifiedInterviewer.prototype.generateCapabilityQuestion).toBe('function');
  });

  it('类有 analyzeAndDecideV2 方法', () => {
    expect(typeof UnifiedInterviewer.prototype.analyzeAndDecideV2).toBe('function');
  });
});

// ==================== 类型结构验证 ====================

describe('UserBehaviorContext 类型', () => {
  it('可以构造有效的 context', () => {
    const ctx: UserBehaviorContext = {
      intimacyScore: 30,
      discoveredCapabilities: new Set(['chat']),
      recentMessages: [{ role: 'user', content: '帮我看看文件', timestamp: Date.now() }],
      recentToolCalls: [],
      currentStage: '相识',
      discoveredCount: 1,
      sessionDurationMs: 60000,
    };
    expect(ctx.intimacyScore).toBe(30);
    expect(ctx.discoveredCapabilities.has('chat')).toBe(true);
  });
});
