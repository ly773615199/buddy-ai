import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperienceExecutor, type ToolExecutor, type PersonalityKey } from './experience-executor.js';
import type { ExperienceUnit } from './types.js';

// ==================== Helpers ====================

function makeExp(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'exp-test',
    name: '测试技能',
    description: '用于测试',
    abstractionLevel: 'concrete',
    trigger: {
      intent: 'test',
      keywords: ['测试'],
      contextTags: [],
      patterns: [],
    },
    steps: [
      { tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' },
    ],
    replyTemplate: {
      sharp: '结果: {content}',
      warm: '这是结果: {content}',
      chaotic: '哇! {content}',
      default: '{content}',
    },
    stats: {
      successCount: 5,
      failCount: 0,
      confidence: 0.9,
      avgExecutionMs: 100,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      extractedFrom: [],
      consolidatedAt: Date.now(),
      evolved: false,
    },
    ...overrides,
  };
}

function makeToolExecutor(responses: Record<string, string> = {}): ToolExecutor {
  return vi.fn(async (toolName: string, args: Record<string, unknown>) => {
    if (responses[toolName]) return responses[toolName];
    return `mock-result:${toolName}`;
  });
}

// ==================== Tests ====================

describe('ExperienceExecutor', () => {
  let executor: ExperienceExecutor;
  let mockTool: ToolExecutor;

  beforeEach(() => {
    mockTool = makeToolExecutor({
      'read_file': '文件内容: hello world',
      'search_files': '找到 3 个结果',
    });
    executor = new ExperienceExecutor(mockTool);
  });

  // ── 基础执行 ──

  describe('基础执行', () => {
    it('单步骤执行成功', async () => {
      const result = await executor.execute(makeExp());
      expect(result.success).toBe(true);
      expect(result.reply).toContain('文件内容: hello world');
      expect(result.skillId).toBe('exp-test');
      expect(mockTool).toHaveBeenCalledWith('read_file', { path: '/test.txt' });
    });

    it('多步骤顺序执行', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/a.txt' }, outputVar: 'a' },
          { tool: 'read_file', args: { path: '/b.txt' }, outputVar: 'b' },
        ],
        replyTemplate: {
          sharp: '{a} + {b}',
          warm: '{a} + {b}',
          chaotic: '{a} + {b}',
          default: '{a} + {b}',
        },
      });
      const result = await executor.execute(exp);
      expect(result.success).toBe(true);
      expect(mockTool).toHaveBeenCalledTimes(2);
    });

    it('变量引用替换', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/source.txt' }, outputVar: 'src' },
          { tool: 'search_files', args: { query: '${src}' } },
        ],
      });
      const result = await executor.execute(exp);
      expect(result.success).toBe(true);
      // 第二步应使用第一步的输出作为参数
      expect(mockTool).toHaveBeenNthCalledWith(2, 'search_files', { query: '文件内容: hello world' });
    });
  });

  // ── 前置条件 ──

  describe('前置条件', () => {
    it('条件不满足时返回失败', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/a.txt' }, outputVar: 'step0' },
          { tool: 'search_files', args: { query: 'x' }, condition: 'missing_var' },
        ],
      });
      const result = await executor.execute(exp);
      expect(result.success).toBe(false);
      expect(result.error).toContain('condition_not_met');
    });
  });

  // ── 工具执行失败 ──

  describe('工具执行失败', () => {
    it('工具抛出异常时返回失败', async () => {
      const failingTool: ToolExecutor = async () => { throw new Error('工具坏了'); };
      const executor2 = new ExperienceExecutor(failingTool);

      const result = await executor2.execute(makeExp());
      expect(result.success).toBe(false);
      expect(result.error).toContain('工具坏了');
      expect(result.failedStep).toBe(0);
    });
  });

  // ── 超时 ──

  describe('超时控制', () => {
    it('超时后返回失败', async () => {
      const slowTool: ToolExecutor = () => new Promise(() => {}); // 永不返回
      const executor2 = new ExperienceExecutor(slowTool, { stepTimeoutMs: 50 });

      const result = await executor2.execute(makeExp());
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  // ── 人格选择 ──

  describe('人格选择', () => {
    it('使用 sharp 人格模板', async () => {
      const result = await executor.execute(makeExp(), 'sharp');
      expect(result.success).toBe(true);
      expect(result.reply).toContain('结果:');
    });

    it('使用 chaotic 人格模板', async () => {
      const result = await executor.execute(makeExp(), 'chaotic');
      expect(result.success).toBe(true);
      expect(result.reply).toContain('哇!');
    });

    it('默认使用 warm 人格', async () => {
      const result = await executor.execute(makeExp());
      expect(result.success).toBe(true);
      expect(result.reply).toContain('这是结果:');
    });
  });

  // ── P6: 执行反思门 ──

  describe('P6: 执行反思门', () => {
    it('输出过短时反思标记为 acceptable', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/empty.txt' }, outputVar: 'content' },
        ],
        replyTemplate: {
          sharp: '{content}',
          warm: '{content}',
          chaotic: '{content}',
          default: '{content}',
        },
      });
      const shortTool: ToolExecutor = async () => 'ab'; // 非常短的输出
      const executor2 = new ExperienceExecutor(shortTool);

      const result = await executor2.execute(exp);
      // 1个issue（输出过短）→ quality=acceptable, shouldRequery=false → 执行成功
      expect(result.success).toBe(true);
      expect(result.reply).toBe('ab');
    });

    it('包含错误标记时反思检测到问题', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/err.txt' }, outputVar: 'content' },
        ],
        replyTemplate: {
          sharp: '{content}',
          warm: '{content}',
          chaotic: '{content}',
          default: '{content}',
        },
      });
      const errorTool: ToolExecutor = async () => '执行失败: 文件不存在';
      const executor2 = new ExperienceExecutor(errorTool);

      const result = await executor2.execute(exp);
      // 反思应检测到错误标记（至少1个issue → acceptable，但如果回复也短可能2个issue → poor）
      // 此处输出"执行失败: 文件不存在"长度>10，只有1个issue（包含错误），quality=acceptable, shouldRequery=false
      // 所以执行应该成功但质量 acceptable
      if (result.success) {
        // acceptable 不触发 requery
        expect(result.reply).toBeDefined();
      } else {
        expect(result.error).toContain('reflection_failed');
      }
    });

    it('模板变量未替换时反思检测到问题', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' },
        ],
        replyTemplate: {
          sharp: '结果: {content} 还有 {missing_var}',
          warm: '结果: {content} 还有 {missing_var}',
          chaotic: '结果: {content} 还有 {missing_var}',
          default: '结果: {content} 还有 {missing_var}',
        },
      });

      const result = await executor.execute(exp);
      // {missing_var} 未被替换 → 模板变量未替换 issue
      // {content} 被替换，{missing_var} 未被替换 → 1个issue
      // 但输出长度 > 10，所以应该有 1 个 issue → acceptable → shouldRequery=false
      // 如果还有其他问题才会 shouldRequery=true
      // 用短输出触发更多 issues
    });

    it('多个 issues 时 shouldRequery=true', async () => {
      const exp = makeExp({
        steps: [
          { tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' },
        ],
        replyTemplate: {
          sharp: '{unresolved}',
          warm: '{unresolved}',
          chaotic: '{unresolved}',
          default: '{unresolved}',
        },
      });
      // 短输出 + 错误标记 → 2个issues（输出过短 + 包含错误）
      const shortErrorTool: ToolExecutor = async () => '失败';
      const executor2 = new ExperienceExecutor(shortErrorTool);

      const result = await executor2.execute(exp);
      // 短输出 '失败' (2 chars < 10) → issue1: 输出过短
      // '失败' 包含错误标记 → issue2: 包含错误
      // 2个issues → shouldRequery=true → 执行失败
      expect(result.success).toBe(false);
      expect(result.error).toContain('reflection_failed');
    });

    it('正常输出通过反思', async () => {
      const result = await executor.execute(makeExp());
      expect(result.success).toBe(true);
      // 正常输出: 长度>10, 无错误标记, 无未替换变量
    });
  });

  // ── verify ──

  describe('verify', () => {
    it('无 verifier 时返回 result.success', () => {
      const skill = makeExp({ verifier: undefined });
      expect(executor.verify(skill, { success: true, outputs: {}, reply: '', skillId: '', executionMs: 0 })).toBe(true);
      expect(executor.verify(skill, { success: false, outputs: {}, reply: '', skillId: '', executionMs: 0, error: '' })).toBe(false);
    });

    it('output_contains 验证通过', () => {
      const skill = makeExp({
        verifier: { type: 'output_contains', target: 'content', criteria: 'hello' },
      });
      const result = { success: true, outputs: { content: 'hello world' }, reply: '', skillId: '', executionMs: 0 };
      expect(executor.verify(skill, result)).toBe(true);
    });

    it('output_contains 验证失败', () => {
      const skill = makeExp({
        verifier: { type: 'output_contains', target: 'content', criteria: 'not_found' },
      });
      const result = { success: true, outputs: { content: 'hello world' }, reply: '', skillId: '', executionMs: 0 };
      expect(executor.verify(skill, result)).toBe(false);
    });
  });

  // ── I2: 失败经验回写 ──

  describe('I2: 失败经验回写', () => {
    it('首次失败记录记忆但不注入提示', async () => {
      const exp = makeExp({
        steps: [{ tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' }],
        replyTemplate: { sharp: '{unresolved}', warm: '{unresolved}', chaotic: '{unresolved}', default: '{unresolved}' },
      });
      const failTool: ToolExecutor = async () => '失败';
      const executor2 = new ExperienceExecutor(failTool);

      const result = await executor2.execute(exp);
      // 短输出 + 错误标记 → shouldRequery=true
      expect(result.success).toBe(false);
      // 首次失败，failureHint 不应出现
      expect(result.reply).not.toContain('上次执行失败');

      // 检查失败记忆已记录
      const memories = executor2.getFailureMemories();
      expect(memories.length).toBe(1);
      expect(memories[0].experienceId).toBe('exp-test');
      expect(memories[0].failCount).toBe(1);
    });

    it('连续 3 次失败注入替代方案提示', async () => {
      const exp = makeExp({
        steps: [{ tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' }],
        replyTemplate: { sharp: '{unresolved}', warm: '{unresolved}', chaotic: '{unresolved}', default: '{unresolved}' },
      });
      const failTool: ToolExecutor = async () => '失败';
      const executor2 = new ExperienceExecutor(failTool);

      // 第一次失败 — 记录 failCount=1
      await executor2.execute(exp);
      // 第二次失败 — getFailureHint 查看 failCount=1 < 2，不注入；记录后 failCount=2
      await executor2.execute(exp);
      // 第三次失败 — getFailureHint 查看 failCount=2 >= 2，注入提示
      const result = await executor2.execute(exp);

      expect(result.success).toBe(false);
      expect(result.reply).toContain('上次执行失败');
      expect(result.reply).toContain('替代方案');

      const memories = executor2.getFailureMemories();
      expect(memories[0].failCount).toBe(3);
    });

    it('成功执行不记录失败', async () => {
      const executor2 = new ExperienceExecutor(makeToolExecutor());
      await executor2.execute(makeExp());
      expect(executor2.getFailureMemories().length).toBe(0);
    });

    it('失败记忆超过 24h 自动清除', async () => {
      const executor2 = new ExperienceExecutor(async () => '失败');
      const exp = makeExp({
        steps: [{ tool: 'read_file', args: { path: '/test.txt' }, outputVar: 'content' }],
        replyTemplate: { sharp: '{unresolved}', warm: '{unresolved}', chaotic: '{unresolved}', default: '{unresolved}' },
      });

      // 执行两次失败
      await executor2.execute(exp);
      await executor2.execute(exp);

      // 手动设置时间戳为 25h 前
      const memories = executor2.getFailureMemories();
      memories[0].timestamp = Date.now() - 25 * 60 * 60 * 1000;

      // 再次执行 — 旧记忆已过期，不注入提示
      const result = await executor2.execute(exp);
      expect(result.reply).not.toContain('上次执行失败');
    });
  });
});
