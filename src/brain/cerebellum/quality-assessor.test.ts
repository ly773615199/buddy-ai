import { describe, it, expect } from 'vitest';
import { OutputQualityAssessor, type AssessmentContext } from './quality-assessor.js';

describe('OutputQualityAssessor', () => {
  const assessor = new OutputQualityAssessor({ reflectThreshold: 0.65 });

  const baseCtx: AssessmentContext = {
    userRequest: '帮我写一个排序函数',
    taskType: 'tools',
    output: 'function sort(arr) { return arr.sort((a, b) => a - b); }',
    executionSuccess: true,
    latencyMs: 500,
    toolResults: ['执行成功'],
  };

  it('空输出 → failed', () => {
    const result = assessor.assess({ ...baseCtx, output: '' });
    expect(result.level).toBe('failed');
    expect(result.dimensions.completeness).toBe(0);
    expect(result.score).toBeLessThan(0.3);
  });

  it('正常代码输出 → good/excellent', () => {
    const result = assessor.assess({
      ...baseCtx,
      output: '```typescript\nfunction sort(arr: number[]): number[] {\n  return arr.sort((a, b) => a - b);\n}\n```',
    });
    expect(result.score).toBeGreaterThan(0.6);
    expect(result.level).not.toBe('failed');
    expect(result.shouldReflect).toBe(false);
  });

  it('错误/拒绝模式 → 低准确性', () => {
    const result = assessor.assess({
      ...baseCtx,
      output: 'Sorry, I cannot help with that request.',
    });
    expect(result.dimensions.accuracy).toBeLessThan(0.6);
    expect(result.issues.some(i => i.dimension === 'accuracy')).toBe(true);
  });

  it('过短输出 → 低完整性', () => {
    const result = assessor.assess({
      ...baseCtx,
      userRequest: '请详细解释 TypeScript 的泛型系统，包括约束、默认值、条件类型等高级用法',
      output: '好的',
    });
    expect(result.dimensions.completeness).toBeLessThan(0.8);
  });

  it('执行失败 → 低完整性', () => {
    const result = assessor.assess({ ...baseCtx, executionSuccess: false });
    expect(result.dimensions.completeness).toBeLessThan(0.7);
  });

  it('代码任务无代码块 → 低完整性', () => {
    const result = assessor.assess({
      ...baseCtx,
      output: '排序函数已经写好了，使用了快速排序算法。',
    });
    expect(result.issues.some(i => i.description.includes('代码块'))).toBe(true);
  });

  it('超长输出 → 低简洁性', () => {
    const longOutput = 'x'.repeat(10000);
    const result = assessor.assess({ ...baseCtx, output: longOutput });
    expect(result.dimensions.conciseness).toBeLessThan(1);
  });

  it('低分触发自我反思', () => {
    const result = assessor.assess({
      ...baseCtx,
      output: 'sorry, I cannot help with that',
      executionSuccess: false,
      retryCount: 3,
    });
    expect(result.shouldReflect).toBe(true);
    expect(result.reflectionPrompt).toBeDefined();
    expect(result.reflectionPrompt).toContain('用户请求');
  });

  it('chat 任务权重不同', () => {
    const result = assessor.assess({
      ...baseCtx,
      taskType: 'chat',
      output: '你好！有什么可以帮你的吗？😊',
    });
    expect(result.score).toBeGreaterThan(0);
  });
});
