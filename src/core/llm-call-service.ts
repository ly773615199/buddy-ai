/**
 * LLMCallService — 统一子系统 LLM 调用接口
 *
 * Phase 4: 替代 callLLMPrompt / callLLMMessages / callLLMForPlanning 闭包
 * 子系统通过注入 LLMCallService 调用 LLM，不再直接依赖 LLMAdapter
 */

import type { Message } from '../types.js';
import type { LLMAdapter } from './llm.js';
import type { TaskType } from './model-router.js';

export class LLMCallService {
  constructor(private llm: LLMAdapter) {}

  /**
   * 简单调用：systemPrompt + userPrompt → response text
   */
  async call(prompt: string, options?: {
    systemPrompt?: string;
    taskType?: TaskType;
    maxSteps?: number;
  }): Promise<string> {
    const messages: Message[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt, timestamp: Date.now() });
    }
    messages.push({ role: 'user', content: prompt, timestamp: Date.now() });

    const result = await this.llm.chat(
      messages,
      [],
      options?.maxSteps ?? 1,
      { taskType: options?.taskType ?? 'background' },
    );
    return result.text;
  }

  /**
   * 消息列表调用：直接传入消息数组 → response text
   */
  async callMessages(msgs: Array<{ role: string; content: string }>, options?: {
    taskType?: TaskType;
  }): Promise<string> {
    const messages: Message[] = msgs.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
      timestamp: Date.now(),
    }));
    const result = await this.llm.chat(
      messages,
      [],
      1,
      { taskType: options?.taskType ?? 'background' },
    );
    return result.text;
  }

  /**
   * 规划调用：使用 reasoning 任务类型（强模型）
   */
  async callForPlanning(msgs: Array<{ role: string; content: string }>): Promise<string> {
    return this.callMessages(msgs, { taskType: 'reasoning' });
  }
}
