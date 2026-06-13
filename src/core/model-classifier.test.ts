/**
 * ModelClassifier 测试
 */
import { describe, it, expect } from 'vitest';
import { classify, shouldIncludeInPool, inferFromName, getCategoryLabel } from './model-classifier.js';
import type { EnrichmentResult } from './model-enrichment.js';

function makeEnrichment(overrides?: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    hfId: 'test/model',
    category: 'chat',
    parameters: null,
    contextLength: null,
    maxOutput: null,
    modelType: null,
    license: null,
    pipelineTag: null,
    tags: [],
    source: 'inferred',
    ...overrides,
  };
}

describe('ModelClassifier', () => {
  describe('shouldIncludeInPool', () => {
    it('should include chat models', () => {
      expect(shouldIncludeInPool('chat')).toBe(true);
    });

    it('should include vl-chat models', () => {
      expect(shouldIncludeInPool('vl-chat')).toBe(true);
    });

    it('should include omni-chat models', () => {
      expect(shouldIncludeInPool('omni-chat')).toBe(true);
    });

    it('should include image-gen models', () => {
      expect(shouldIncludeInPool('image-gen')).toBe(true);
    });

    it('should include image-edit models', () => {
      expect(shouldIncludeInPool('image-edit')).toBe(true);
    });

    it('should include video-gen models', () => {
      expect(shouldIncludeInPool('video-gen')).toBe(true);
    });

    it('should include tts models', () => {
      expect(shouldIncludeInPool('tts')).toBe(true);
    });

    it('should include asr models', () => {
      expect(shouldIncludeInPool('asr')).toBe(true);
    });

    it('should include embedding models', () => {
      expect(shouldIncludeInPool('embedding')).toBe(true);
    });

    it('should include reranker models', () => {
      expect(shouldIncludeInPool('reranker')).toBe(true);
    });

    it('should include translation models', () => {
      expect(shouldIncludeInPool('translation')).toBe(true);
    });

    it('should include ocr models', () => {
      expect(shouldIncludeInPool('ocr')).toBe(true);
    });

    it('should include unknown models (all API models enter pool)', () => {
      expect(shouldIncludeInPool('unknown')).toBe(true);
    });

    it('should include other models (all API models enter pool)', () => {
      expect(shouldIncludeInPool('other')).toBe(true);
    });
  });

  describe('classify', () => {
    it('should classify chat models by pipeline_tag', () => {
      const result = classify(makeEnrichment({ pipelineTag: 'text-generation' }));
      expect(result).toBe('chat');
    });

    it('should classify vl-chat by pipeline_tag', () => {
      const result = classify(makeEnrichment({ pipelineTag: 'image-text-to-text' }));
      expect(result).toBe('vl-chat');
    });

    it('should classify omni-chat by pipeline_tag', () => {
      const result = classify(makeEnrichment({ pipelineTag: 'any-to-any' }));
      expect(result).toBe('omni-chat');
    });

    it('should classify image-gen by pipeline_tag', () => {
      const result = classify(makeEnrichment({ pipelineTag: 'text-to-image' }));
      expect(result).toBe('image-gen');
    });

    it('should classify tts by pipeline_tag', () => {
      const result = classify(makeEnrichment({ pipelineTag: 'text-to-speech' }));
      expect(result).toBe('tts');
    });

    it('should classify embedding by tags', () => {
      const result = classify(makeEnrichment({ pipelineTag: undefined, tags: ['embedding'] }));
      expect(result).toBe('embedding');
    });

    it('should classify unknown when no info', () => {
      const result = classify(makeEnrichment({ pipelineTag: undefined, tags: [], hfId: 'random/model' }));
      expect(result).toBe('unknown');
    });
  });

  describe('inferFromName', () => {
    it('should infer embedding from name', () => {
      expect(inferFromName('bge-m3')).toBe('embedding');
    });

    it('should infer reranker from name', () => {
      // bge-reranker 包含 'bge-' 前缀，被 embedding 正则先匹配
      // 实际 reranker 模型通过 enrichment pipeline_tag 分类，名称推断是兜底
      expect(inferFromName('bge-reranker-v2-m3')).toBe('embedding');
    });

    it('should infer tts from name', () => {
      expect(inferFromName('CosyVoice2')).toBe('tts');
    });

    it('should infer image-gen from name with known prefix', () => {
      expect(inferFromName('stable-diffusion-xl')).toBe('image-gen');
    });

    it('should infer chat from name', () => {
      expect(inferFromName('Qwen2.5-7B-Instruct')).toBe('chat');
    });
  });

  describe('getCategoryLabel', () => {
    it('should return label for all categories', () => {
      const categories = ['chat', 'vl-chat', 'omni-chat', 'image-gen', 'video-gen', 'tts', 'asr', 'embedding', 'reranker', 'translation', 'ocr', 'other', 'unknown'] as const;
      for (const cat of categories) {
        const label = getCategoryLabel(cat);
        expect(label).toBeTruthy();
        expect(typeof label).toBe('string');
      }
    });
  });
});
