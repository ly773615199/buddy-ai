/**
 * LLMCallService 测试 — Phase 8
 *
 * 验证统一子系统 LLM 调用接口：
 * - call(): systemPrompt + userPrompt → response text
 * - callMessages(): 消息列表 → response text
 * - callForPlanning(): reasoning 任务类型
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMCallService } from './llm-call-service.js';

// Mock LLMAdapter
function createMockLLM() {
  return {
    chat: vi.fn().mockResolvedValue({ text: 'mock response', toolCalls: [] }),
  } as any;
}

describe('LLMCallService', () => {
  let mockLLM: ReturnType<typeof createMockLLM>;
  let service: LLMCallService;

  beforeEach(() => {
    mockLLM = createMockLLM();
    service = new LLMCallService(mockLLM);
  });

  // ==================== call() ====================

  describe('call()', () => {
    it('should send user prompt and return response text', async () => {
      const result = await service.call('你好');

      expect(result).toBe('mock response');
      expect(mockLLM.chat).toHaveBeenCalledTimes(1);

      const [messages, , maxSteps, options] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('你好');
      expect(maxSteps).toBe(1);
      expect(options.taskType).toBe('background');
    });

    it('should prepend systemPrompt when provided', async () => {
      await service.call('分析代码', { systemPrompt: '你是代码助手' });

      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('你是代码助手');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('分析代码');
    });

    it('should pass taskType option', async () => {
      await service.call('推理任务', { taskType: 'reasoning' });

      const [, , , options] = mockLLM.chat.mock.calls[0];
      expect(options.taskType).toBe('reasoning');
    });

    it('should pass maxSteps option', async () => {
      await service.call('多步任务', { maxSteps: 5 });

      const [, , maxSteps] = mockLLM.chat.mock.calls[0];
      expect(maxSteps).toBe(5);
    });

    it('should default to background taskType and maxSteps=1', async () => {
      await service.call('默认任务');

      const [, , maxSteps, options] = mockLLM.chat.mock.calls[0];
      expect(maxSteps).toBe(1);
      expect(options.taskType).toBe('background');
    });

    it('should propagate LLM errors', async () => {
      mockLLM.chat.mockRejectedValueOnce(new Error('LLM 服务不可用'));

      await expect(service.call('会失败')).rejects.toThrow('LLM 服务不可用');
    });
  });

  // ==================== callMessages() ====================

  describe('callMessages()', () => {
    it('should convert message array and return response', async () => {
      const msgs = [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '用户消息' },
      ];

      const result = await service.callMessages(msgs);

      expect(result).toBe('mock response');
      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('系统提示');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('用户消息');
    });

    it('should handle assistant messages', async () => {
      const msgs = [
        { role: 'user', content: '问题' },
        { role: 'assistant', content: '回答' },
        { role: 'user', content: '追问' },
      ];

      await service.callMessages(msgs);

      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(3);
      expect(messages[1].role).toBe('assistant');
    });

    it('should default taskType to background', async () => {
      await service.callMessages([{ role: 'user', content: 'test' }]);

      const [, , , options] = mockLLM.chat.mock.calls[0];
      expect(options.taskType).toBe('background');
    });

    it('should pass custom taskType', async () => {
      await service.callMessages(
        [{ role: 'user', content: 'test' }],
        { taskType: 'tools' },
      );

      const [, , , options] = mockLLM.chat.mock.calls[0];
      expect(options.taskType).toBe('tools');
    });

    it('should handle empty message array', async () => {
      const result = await service.callMessages([]);

      expect(result).toBe('mock response');
      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(0);
    });
  });

  // ==================== callForPlanning() ====================

  describe('callForPlanning()', () => {
    it('should use reasoning taskType', async () => {
      const msgs = [{ role: 'user', content: '规划任务' }];

      const result = await service.callForPlanning(msgs);

      expect(result).toBe('mock response');
      const [, , , options] = mockLLM.chat.mock.calls[0];
      expect(options.taskType).toBe('reasoning');
    });

    it('should pass through message array correctly', async () => {
      const msgs = [
        { role: 'system', content: '你是规划助手' },
        { role: 'user', content: '制定计划' },
      ];

      await service.callForPlanning(msgs);

      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('你是规划助手');
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should add timestamp to all messages', async () => {
      const before = Date.now();
      await service.call('test');
      const after = Date.now();

      const [messages] = mockLLM.chat.mock.calls[0];
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(messages[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle very long prompt', async () => {
      const longPrompt = 'x'.repeat(100000);
      mockLLM.chat.mockResolvedValueOnce({ text: 'ok', toolCalls: [] });

      const result = await service.call(longPrompt);
      expect(result).toBe('ok');
    });

    it('should handle concurrent calls', async () => {
      const results = await Promise.all([
        service.call('请求1'),
        service.call('请求2'),
        service.call('请求3'),
      ]);

      expect(results).toEqual(['mock response', 'mock response', 'mock response']);
      expect(mockLLM.chat).toHaveBeenCalledTimes(3);
    });
  });
});
