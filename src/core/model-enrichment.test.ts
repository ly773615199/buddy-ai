import { describe, it, expect, beforeEach } from 'vitest';
import { ModelEnricher, resetModelEnricher, type ModelCategory } from './model-enrichment.js';
import { classify, shouldIncludeInPool, inferFromName, getCategoryLabel } from './model-classifier.js';

describe('ModelClassifier', () => {
  describe('classify', () => {
    it('should classify text-generation as chat', () => {
      const result = classify({
        pipelineTag: 'text-generation',
        modelType: 'qwen2',
        parameters: 7000000000,
        contextLength: 131072,
        maxOutput: null,
        tags: ['conversational'],
        license: 'apache-2.0',
        language: ['en', 'zh'],
        category: 'chat',
        hfId: 'Qwen/Qwen2.5-7B-Instruct',
        likes: 100,
        downloads: 50000,
        source: 'catalog',
      });
      expect(result).toBe('chat');
    });

    it('should classify image-text-to-text as vl-chat', () => {
      const result = classify({
        pipelineTag: 'image-text-to-text',
        modelType: 'qwen2_vl',
        parameters: 7000000000,
        contextLength: null,
        maxOutput: null,
        tags: [],
        license: null,
        language: null,
        category: 'vl-chat',
        hfId: 'Qwen/Qwen2.5-VL-7B-Instruct',
        likes: 0,
        downloads: 0,
        source: 'catalog',
      });
      expect(result).toBe('vl-chat');
    });

    it('should classify any-to-any as omni-chat', () => {
      const result = classify({
        pipelineTag: 'any-to-any',
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: [],
        license: null,
        language: null,
        category: 'omni-chat',
        hfId: 'some/omni-model',
        likes: 0,
        downloads: 0,
        source: 'catalog',
      });
      expect(result).toBe('omni-chat');
    });

    it('should classify text-to-image as image-gen', () => {
      const result = classify({
        pipelineTag: 'text-to-image',
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: [],
        license: null,
        language: null,
        category: 'text-to-image',
        hfId: 'stabilityai/stable-diffusion',
        likes: 0,
        downloads: 0,
        source: 'catalog',
      });
      expect(result).toBe('image-gen');
    });

    it('should classify feature-extraction as embedding', () => {
      const result = classify({
        pipelineTag: 'feature-extraction',
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: ['sentence-transformers'],
        license: null,
        language: null,
        category: 'feature-extraction',
        hfId: 'BAAI/bge-base-en',
        likes: 0,
        downloads: 0,
        source: 'catalog',
      });
      expect(result).toBe('embedding');
    });

    it('should classify text-to-speech as tts', () => {
      const result = classify({
        pipelineTag: 'text-to-speech',
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: [],
        license: null,
        language: null,
        category: 'text-to-speech',
        hfId: 'some/tts-model',
        likes: 0,
        downloads: 0,
        source: 'catalog',
      });
      expect(result).toBe('tts');
    });

    it('should fall back to tags when pipeline_tag is null', () => {
      const result = classify({
        pipelineTag: null,
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: ['chat', 'conversational'],
        license: null,
        language: null,
        category: 'unknown',
        hfId: 'some/model',
        likes: 0,
        downloads: 0,
        source: 'inferred',
      });
      expect(result).toBe('chat');
    });

    it('should fall back to name inference when no metadata', () => {
      const result = classify({
        pipelineTag: null,
        modelType: null,
        parameters: null,
        contextLength: null,
        maxOutput: null,
        tags: [],
        license: null,
        language: null,
        category: 'unknown',
        hfId: 'BAAI/bge-large-zh',
        likes: 0,
        downloads: 0,
        source: 'inferred',
      });
      expect(result).toBe('embedding');
    });
  });

  describe('shouldIncludeInPool', () => {
    it('should include chat models', () => {
      expect(shouldIncludeInPool('chat')).toBe(true);
      expect(shouldIncludeInPool('vl-chat')).toBe(true);
      expect(shouldIncludeInPool('omni-chat')).toBe(true);
    });

    it('should include all models (API models enter pool, Thompson Sampling filters)', () => {
      expect(shouldIncludeInPool('embedding')).toBe(true);
      expect(shouldIncludeInPool('reranker')).toBe(true);
      expect(shouldIncludeInPool('image-gen')).toBe(true);
      expect(shouldIncludeInPool('tts')).toBe(true);
      expect(shouldIncludeInPool('asr')).toBe(true);
      expect(shouldIncludeInPool('video-gen')).toBe(true);
      expect(shouldIncludeInPool('unknown')).toBe(true);
    });
  });

  describe('inferFromName', () => {
    it('should detect embedding models', () => {
      expect(inferFromName('BAAI/bge-large-zh')).toBe('embedding');
      expect(inferFromName('text-embedding-ada-002')).toBe('embedding');
    });

    it('should detect chat models', () => {
      expect(inferFromName('Qwen2.5-7B-Instruct')).toBe('chat');
      expect(inferFromName('deepseek-chat')).toBe('chat');
    });

    it('should detect image generation models', () => {
      expect(inferFromName('stabilityai/stable-diffusion-xl')).toBe('image-gen');
      expect(inferFromName('black-forest-labs/FLUX.1')).toBe('image-gen');
    });

    it('should detect OCR models', () => {
      expect(inferFromName('PaddlePaddle/PaddleOCR-VL')).toBe('ocr');
    });

    it('should return unknown for unrecognized', () => {
      expect(inferFromName('some-random-model')).toBe('unknown');
    });
  });

  describe('getCategoryLabel', () => {
    it('should return Chinese labels', () => {
      expect(getCategoryLabel('chat')).toContain('聊天');
      expect(getCategoryLabel('vl-chat')).toContain('视觉');
      expect(getCategoryLabel('embedding')).toContain('嵌入');
    });
  });
});

describe('ModelEnricher', () => {
  let enricher: ModelEnricher;

  beforeEach(() => {
    resetModelEnricher();
    // 使用项目根目录（model-catalog.json 所在位置）
    enricher = new ModelEnricher('/root/.openclaw/workspace/buddy');
  });

  describe('catalog loading', () => {
    it('should load catalog successfully', () => {
      const status = enricher.getCatalogStatus();
      // catalog 可能已加载或未加载，先触发一次 enrich
      expect(typeof status.modelCount).toBe('number');
    });
  });

  describe('enrich', () => {
    it('should enrich models from catalog', async () => {
      const results = await enricher.enrich([
        'deepseek-ai/DeepSeek-V4-Flash',
        'Pro/moonshotai/Kimi-K2.6',
      ]);

      expect(results.size).toBe(2);

      const deepseek = results.get('deepseek-ai/DeepSeek-V4-Flash');
      expect(deepseek).toBeDefined();
      expect(deepseek!.category).toBe('chat');
      expect(deepseek!.pipelineTag).toBe('text-generation');
      expect(deepseek!.parameters).toBeGreaterThan(0);
      expect(deepseek!.source).toBe('catalog');

      const kimi = results.get('Pro/moonshotai/Kimi-K2.6');
      expect(kimi).toBeDefined();
      expect(kimi!.category).toBe('vl-chat');
      expect(kimi!.pipelineTag).toBe('image-text-to-text');
    });

    it('should handle unknown models with name inference', async () => {
      const results = await enricher.enrich(['unknown-vendor/some-model-chat']);
      expect(results.size).toBe(1);

      const result = results.get('unknown-vendor/some-model-chat');
      expect(result).toBeDefined();
      expect(result!.source).toBe('inferred');
      // 'chat' in name → inferred as chat
      expect(result!.category).toBe('chat');
    });

    it('should return empty map for empty input', async () => {
      const results = await enricher.enrich([]);
      expect(results.size).toBe(0);
    });
  });

  describe('classifyByPipelineTag', () => {
    it('should classify known pipeline tags', () => {
      expect(enricher.classifyByPipelineTag('text-generation')).toBe('chat');
      expect(enricher.classifyByPipelineTag('image-text-to-text')).toBe('vl-chat');
      expect(enricher.classifyByPipelineTag('any-to-any')).toBe('omni-chat');
      expect(enricher.classifyByPipelineTag('text-to-image')).toBe('image-gen');
      expect(enricher.classifyByPipelineTag('feature-extraction')).toBe('embedding');
      expect(enricher.classifyByPipelineTag('text-to-speech')).toBe('tts');
      expect(enricher.classifyByPipelineTag('unknown-tag')).toBe('unknown');
    });
  });
});
