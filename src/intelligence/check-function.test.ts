import { describe, it, expect } from 'vitest';
import { CheckFunction, type CheckContext } from './check-function.js';
import type { ExperienceUnit } from './types.js';

const check = new CheckFunction();

function makeExp(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'test-exp',
    name: 'test',
    abstractionLevel: 'tool',
    steps: [
      { tool: 'file_read', args: { path: '{{filePath}}' }, description: 'read' },
      { tool: 'file_write', args: { path: '{{filePath}}', content: 'data' }, description: 'write' },
    ],
    stats: { confidence: 0.9, successCount: 5, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now() },
    ...overrides,
  } as ExperienceUnit;
}

function makeCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    inputArgs: { filePath: '/tmp/test.txt' },
    stepResults: [
      { stepIndex: 0, success: true, result: 'file content' },
      { stepIndex: 1, success: true, result: 'written' },
    ],
    toolNames: new Set(['file_read', 'file_write', 'search']),
    ...overrides,
  };
}

describe('CheckFunction 工作流完整性检查', () => {

  // ==================== Pre-check ====================

  describe('preCheck() 执行前验证', () => {
    it('正常经验通过', () => {
      const result = check.preCheck(makeExp(), makeCtx());
      expect(result.passed).toBe(true);
      expect(result.stage).toBe('pre');
    });

    it('空步骤失败', () => {
      const result = check.preCheck(makeExp({ steps: [] }), makeCtx());
      expect(result.passed).toBe(false);
      expect(result.message).toContain('没有可执行的步骤');
    });

    it('工具不存在失败', () => {
      const ctx = makeCtx({ toolNames: new Set(['file_read']) }); // 缺少 file_write
      const result = check.preCheck(makeExp(), ctx);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('file_write');
      expect(result.failedStep).toBe(1);
    });

    it('必需参数缺失失败', () => {
      const ctx = makeCtx({ inputArgs: {} }); // 缺少 filePath
      const result = check.preCheck(makeExp(), ctx);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('filePath');
    });

    it('非模板参数不要求输入', () => {
      const exp = makeExp({
        steps: [{ tool: 'search', args: { query: 'hello' }, description: 'search' }],
      });
      const result = check.preCheck(exp, makeCtx());
      expect(result.passed).toBe(true);
    });

    it('strategy 级别无 reasoning 失败', () => {
      const exp = makeExp({ abstractionLevel: 'strategy', reasoning: undefined });
      const result = check.preCheck(exp, makeCtx());
      expect(result.passed).toBe(false);
      expect(result.message).toContain('reasoning');
    });

    it('strategy 级别有 reasoning 通过', () => {
      const exp = makeExp({ abstractionLevel: 'strategy', reasoning: 'because...' });
      const result = check.preCheck(exp, makeCtx());
      expect(result.passed).toBe(true);
    });
  });

  // ==================== Step-check ====================

  describe('stepCheck() 单步验证', () => {
    const step = { tool: 'file_read', args: {}, description: 'read' };

    it('正常结果通过', () => {
      const result = check.stepCheck(step, 0, 'file content here');
      expect(result.passed).toBe(true);
    });

    it('空结果失败', () => {
      expect(check.stepCheck(step, 0, '').passed).toBe(false);
      expect(check.stepCheck(step, 0, '  ').passed).toBe(false);
    });

    it('错误标记失败 — Error:', () => {
      const result = check.stepCheck(step, 0, 'Error: something went wrong');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('步骤 1');
    });

    it('错误标记失败 — EACCES', () => {
      expect(check.stepCheck(step, 0, 'EACCES: permission denied').passed).toBe(false);
    });

    it('错误标记失败 — ENOENT', () => {
      expect(check.stepCheck(step, 0, 'ENOENT: no such file').passed).toBe(false);
    });

    it('错误标记失败 — [工具执行错误', () => {
      expect(check.stepCheck(step, 0, '[工具执行错误] timeout').passed).toBe(false);
    });

    it('错误标记失败 — [已拦截', () => {
      expect(check.stepCheck(step, 0, '[已拦截] 安全策略').passed).toBe(false);
    });
  });

  // ==================== Post-check ====================

  describe('postCheck() 执行后验证', () => {
    it('全部步骤完成通过', () => {
      const result = check.postCheck(makeExp(), makeCtx());
      expect(result.passed).toBe(true);
      expect(result.message).toContain('2/2');
    });

    it('步骤未全部完成失败', () => {
      const ctx = makeCtx({ stepResults: [{ stepIndex: 0, success: true, result: 'ok' }] });
      const result = check.postCheck(makeExp(), ctx);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('预期 2 步，实际完成 1 步');
    });

    it('超过 1 步失败失败', () => {
      const ctx = makeCtx({
        stepResults: [
          { stepIndex: 0, success: false, result: 'err' },
          { stepIndex: 1, success: false, result: 'err' },
        ],
      });
      const result = check.postCheck(makeExp(), ctx);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('2 个步骤失败');
    });

    it('1 步失败容忍通过', () => {
      const ctx = makeCtx({
        stepResults: [
          { stepIndex: 0, success: true, result: 'ok' },
          { stepIndex: 1, success: false, result: 'err' },
        ],
      });
      const result = check.postCheck(makeExp(), ctx);
      expect(result.passed).toBe(true);
    });

    it('workflow 级别少于 2 步失败', () => {
      const exp = makeExp({
        abstractionLevel: 'workflow',
        steps: [{ tool: 'search', args: {}, description: 'only one' }],
      });
      const ctx = makeCtx({
        stepResults: [{ stepIndex: 0, success: true, result: 'ok' }],
      });
      const result = check.postCheck(exp, ctx);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('至少包含 2 个步骤');
    });
  });

  // ==================== runAll ====================

  describe('runAll() 完整流程', () => {
    it('pre-check 通过返回结果', () => {
      const results = check.runAll(makeExp(), makeCtx());
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('pre-check 失败中断', () => {
      const results = check.runAll(makeExp({ steps: [] }), makeCtx());
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });
  });
});
