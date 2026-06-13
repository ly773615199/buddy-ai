import { describe, it, expect } from 'vitest';
import {
  lookupModelKnowledge,
  inferTier,
  inferCapabilities,
  type CapabilityKey,
} from './model-knowledge.js';

describe('ModelKnowledge', () => {
  describe('lookupModelKnowledge', () => {
    it('should find known models by full id', () => {
      const gpt4o = lookupModelKnowledge('openai/gpt-4o');
      expect(gpt4o).not.toBeNull();
      expect(gpt4o!.displayName).toBe('GPT-4o');
      expect(gpt4o!.tier).toBe('premium');
      expect(gpt4o!.capabilities.reasoning).toBeGreaterThan(0.8);
      expect(gpt4o!.capabilities.toolCalling).toBe(true);
      expect(gpt4o!.capabilities.vision).toBe(true);
    });

    it('should find DeepSeek models', () => {
      const ds = lookupModelKnowledge('deepseek/deepseek-chat');
      expect(ds).not.toBeNull();
      expect(ds!.capabilities.chinese).toBeGreaterThan(0.8);
    });

    it('should find SiliconFlow models', () => {
      const qwen = lookupModelKnowledge('siliconflow/Qwen2.5-7B-Instruct');
      expect(qwen).not.toBeNull();
      expect(qwen!.tier).toBeDefined();
    });

    it('should return null for unknown models', () => {
      const unknown = lookupModelKnowledge('foobar/nonexistent-model-xyz');
      expect(unknown).toBeNull();
    });

    it('should return valid capabilities structure', () => {
      const model = lookupModelKnowledge('openai/gpt-4o');
      expect(model).not.toBeNull();
      const caps = model!.capabilities;
      expect(typeof caps.reasoning).toBe('number');
      expect(typeof caps.code).toBe('number');
      expect(typeof caps.chinese).toBe('number');
      expect(typeof caps.english).toBe('number');
      expect(typeof caps.math).toBe('number');
      expect(typeof caps.creative).toBe('number');
      expect(typeof caps.toolCalling).toBe('boolean');
      expect(typeof caps.vision).toBe('boolean');
      expect(typeof caps.streaming).toBe('boolean');
    });

    it('should have contextWindow for major models (Task 8.2)', () => {
      const models = [
        { id: 'openai/gpt-4o', expected: 128000 },
        { id: 'openai/gpt-4o-mini', expected: 128000 },
        { id: 'anthropic/claude-3-5-sonnet-20241022', expected: 200000 },
        { id: 'google/gemini-2.5-pro', expected: 1000000 },
        { id: 'deepseek/deepseek-chat', expected: 64000 },
        { id: 'qwen/qwen-2.5-72b-instruct', expected: 131072 },
      ];
      for (const { id, expected } of models) {
        const model = lookupModelKnowledge(id);
        expect(model, `${id} should exist`).not.toBeNull();
        expect(model!.contextWindow, `${id} contextWindow`).toBe(expected);
      }
    });

    it('contextWindow should be a positive number when present', () => {
      const model = lookupModelKnowledge('openai/gpt-4o');
      expect(model).not.toBeNull();
      expect(model!.contextWindow).toBeDefined();
      expect(model!.contextWindow!).toBeGreaterThan(0);
    });

    it('should have valid capability data', () => {
      const model = lookupModelKnowledge('openai/gpt-4o');
      expect(model).not.toBeNull();
      expect(model!.capabilities.reasoning).toBeGreaterThan(0);
      expect(model!.capabilities.code).toBeGreaterThan(0);
      expect(model!.tier).toBe('premium');
      expect(model!.displayName).toBe('GPT-4o');
    });
  });

  describe('inferTier', () => {
    it('should infer premium for gpt-4o', () => {
      expect(inferTier('gpt-4o')).toBe('premium');
    });

    it('should infer budget for mini models', () => {
      expect(inferTier('gpt-4o-mini')).toBe('budget');
    });

    it('should infer free for known free models', () => {
      expect(inferTier('GLM-4-9B')).toBe('free');
    });

    it('should infer standard for unknown models', () => {
      expect(inferTier('some-unknown-model')).toBe('standard');
    });
  });

  describe('inferCapabilities', () => {
    it('should return capability structure for any model name', () => {
      const caps = inferCapabilities('some-random-model');
      expect(typeof caps.reasoning).toBe('number');
      expect(typeof caps.code).toBe('number');
      expect(typeof caps.chinese).toBe('number');
      expect(typeof caps.english).toBe('number');
      expect(typeof caps.math).toBe('number');
      expect(typeof caps.creative).toBe('number');
      expect(typeof caps.toolCalling).toBe('boolean');
      expect(typeof caps.vision).toBe('boolean');
      expect(typeof caps.streaming).toBe('boolean');
    });

    it('should infer higher capabilities for large models', () => {
      const large = inferCapabilities('Qwen2.5-72B-Instruct');
      const small = inferCapabilities('Qwen2.5-1B-Instruct');
      // 72B should generally have higher reasoning than 1B
      expect(large.reasoning).toBeGreaterThanOrEqual(small.reasoning);
    });

    it('should detect tool calling support from model name', () => {
      const caps = inferCapabilities('gpt-4o');
      expect(caps.toolCalling).toBe(true);
    });

    it('should detect vision from model name', () => {
      const caps = inferCapabilities('gpt-4o');
      expect(caps.vision).toBe(true);
    });
  });
});
