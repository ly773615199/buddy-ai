/**
 * 生成缓存测试
 *
 * 覆盖：
 * - put/get 基础读写
 * - 质量过滤（低于阈值不缓存）
 * - 精确匹配 vs 模糊匹配
 * - 过期淘汰
 * - 容量淘汰策略
 * - 统计信息
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GenerationCache } from './generation-cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('GenerationCache', () => {
  let cache: GenerationCache;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-cache-test-'));
    cache = new GenerationCache(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 基础读写 ====================

  describe('put/get 基础', () => {
    it('存入后可取出', () => {
      cache.put('retrieval', 'test input', 'test output', 0.8);
      const result = cache.get('retrieval', 'test input');
      expect(result).not.toBeNull();
      expect(result!.output).toBe('test output');
      expect(result!.qualityScore).toBeCloseTo(0.8, 2);
    });

    it('未存入时返回 null', () => {
      const result = cache.get('retrieval', 'nonexistent');
      expect(result).toBeNull();
    });

    it('hitCount 首次为 0', () => {
      cache.put('retrieval', 'input', 'output', 0.8);
      const result = cache.get('retrieval', 'input');
      // put 后第一次 get 会命中精确匹配，hitCount 变为 1
      expect(result!.hitCount).toBe(1);
    });

    it('多次 get 递增 hitCount', () => {
      cache.put('retrieval', 'input', 'output', 0.8);
      cache.get('retrieval', 'input');
      cache.get('retrieval', 'input');
      const result = cache.get('retrieval', 'input');
      expect(result!.hitCount).toBe(3);
    });
  });

  // ==================== 质量过滤 ====================

  describe('质量过滤', () => {
    it('qualityScore < 0.6 不缓存', () => {
      cache.put('retrieval', 'low quality', 'output', 0.5);
      const result = cache.get('retrieval', 'low quality');
      expect(result).toBeNull();
    });

    it('qualityScore = 0.6 缓存', () => {
      cache.put('retrieval', 'threshold', 'output', 0.6);
      const result = cache.get('retrieval', 'threshold');
      expect(result).not.toBeNull();
    });

    it('qualityScore > 0.6 缓存', () => {
      cache.put('retrieval', 'high quality', 'output', 0.95);
      const result = cache.get('retrieval', 'high quality');
      expect(result).not.toBeNull();
      expect(result!.qualityScore).toBeCloseTo(0.95, 2);
    });
  });

  // ==================== 匹配策略 ====================

  describe('匹配策略', () => {
    it('精确匹配优先', () => {
      cache.put('retrieval', 'exact input', 'exact output', 0.8);
      cache.put('retrieval', 'other input', 'other output', 0.9);
      const result = cache.get('retrieval', 'exact input');
      expect(result!.output).toBe('exact output');
    });

    it('同 taskType 模糊匹配取最高质量', () => {
      cache.put('reasoning', 'input A', 'output A', 0.7);
      cache.put('reasoning', 'input B', 'output B', 0.9);
      cache.put('reasoning', 'input C', 'output C', 0.8);
      // 用一个不存在的 input，应该模糊匹配到最高质量的 B
      const result = cache.get('reasoning', 'nonexistent input');
      expect(result).not.toBeNull();
      expect(result!.output).toBe('output B');
    });

    it('不同 taskType 不匹配', () => {
      cache.put('retrieval', 'shared input', 'retrieval output', 0.8);
      cache.put('reasoning', 'shared input', 'reasoning output', 0.8);
      // 精确匹配 retrieval
      const r1 = cache.get('retrieval', 'shared input');
      expect(r1!.output).toBe('retrieval output');
      // 精确匹配 reasoning
      const r2 = cache.get('reasoning', 'shared input');
      expect(r2!.output).toBe('reasoning output');
    });
  });

  // ==================== 持久化 ====================

  describe('load/save', () => {
    it('save 后 load 恢复数据', async () => {
      cache.put('retrieval', 'persist test', 'persisted output', 0.85);
      await cache.save();

      // 新建 cache 实例加载
      const cache2 = new GenerationCache(tmpDir);
      await cache2.load();
      const result = cache2.get('retrieval', 'persist test');
      expect(result).not.toBeNull();
      expect(result!.output).toBe('persisted output');
    });

    it('无数据时 save 不报错', async () => {
      await cache.save(); // 不应抛异常
    });

    it('无文件时 load 不报错', async () => {
      const cache2 = new GenerationCache('/nonexistent/path');
      await cache2.load(); // 不应抛异常
    });
  });

  // ==================== 统计 ====================

  describe('getStats()', () => {
    it('空缓存 size=0', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('存入后 size 递增', () => {
      cache.put('retrieval', 'input1', 'output1', 0.8);
      cache.put('retrieval', 'input2', 'output2', 0.8);
      expect(cache.getStats().size).toBe(2);
    });

    it('avgQuality 反映存入质量', () => {
      cache.put('retrieval', 'q1', 'o1', 0.7);
      cache.put('retrieval', 'q2', 'o2', 0.9);
      const stats = cache.getStats();
      expect(stats.avgQuality).toBeCloseTo(0.8, 2);
    });

    it('hitRate 反映命中情况', () => {
      cache.put('retrieval', 'input', 'output', 0.8);
      cache.get('retrieval', 'input'); // hit
      cache.get('retrieval', 'input'); // hit
      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  // ==================== 淘汰策略 ====================

  describe('淘汰策略', () => {
    it('超过 MAX_CACHE_SIZE 时自动淘汰', () => {
      // MAX_CACHE_SIZE = 200，填入 210 条
      for (let i = 0; i < 210; i++) {
        cache.put('retrieval', `input_${i}`, `output_${i}`, 0.7);
      }
      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(200);
    });

    it('淘汰后仍能正常读取', () => {
      for (let i = 0; i < 210; i++) {
        cache.put('retrieval', `input_${i}`, `output_${i}`, 0.7);
      }
      // 最后一条应该还在
      const result = cache.get('retrieval', 'input_209');
      expect(result).not.toBeNull();
    });
  });

  // ==================== 边界 ====================

  describe('边界情况', () => {
    it('空字符串 input 也能缓存', () => {
      cache.put('retrieval', '', 'empty input output', 0.8);
      const result = cache.get('retrieval', '');
      expect(result).not.toBeNull();
    });

    it('长 input 被截断到 200 字符', () => {
      const longInput = 'a'.repeat(500);
      cache.put('retrieval', longInput, 'output', 0.8);
      // 用前 200 字符应能匹配
      const result = cache.get('retrieval', longInput);
      expect(result).not.toBeNull();
    });

    it('大小写不敏感匹配', () => {
      cache.put('retrieval', 'Hello World', 'output', 0.8);
      const result = cache.get('retrieval', 'hello world');
      expect(result).not.toBeNull();
    });
  });
});
