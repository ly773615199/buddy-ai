import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FusionBuffer, type FusionEntry } from './fusion-buffer.js';

// Mock STMPStore
const mockStmp = {
  insertNode: vi.fn(),
  searchByConcepts: vi.fn().mockReturnValue([]),
  searchSemantic: vi.fn().mockReturnValue([]),
  getStats: vi.fn().mockReturnValue({ nodes: 0, rooms: 0 }),
};

// Mock CognitiveEngine
const mockCognitive = {
  updateDomainProfile: vi.fn(),
  recordInteraction: vi.fn(),
};

function makeEntry(overrides: Partial<FusionEntry> = {}): FusionEntry {
  return {
    source: 'test',
    content: 'test content',
    concepts: ['test'],
    timestamp: Date.now(),
    confidence: 0.8,
    relations: [],
    ...overrides,
  };
}

describe('FusionBuffer 多源记忆融合', () => {
  let buffer: FusionBuffer;

  beforeEach(() => {
    vi.clearAllMocks();
    buffer = new FusionBuffer(mockStmp as any, mockCognitive as any, 100);
  });

  // ==================== 写入 ====================

  describe('ingest() 写入', () => {
    it('单条写入增加缓冲', () => {
      buffer.ingest(makeEntry());
      const status = buffer.getStatus();
      expect(status.buffered).toBe(1);
      expect(status.totalIngested).toBe(1);
    });

    it('批量写入增加缓冲', () => {
      buffer.ingestBatch([makeEntry(), makeEntry({ source: 'b' })]);
      const status = buffer.getStatus();
      expect(status.buffered).toBe(2);
      expect(status.totalIngested).toBe(2);
    });
  });

  // ==================== 关联检测 ====================

  describe('关联检测', () => {
    it('高概念重叠 (>0.5) 生成 supports 关系', () => {
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x', 'y', 'z'] }));
      buffer.ingest(makeEntry({ source: 'b', concepts: ['x', 'y', 'z'] }));
      // 通过 flush 检查关联数
      const result = buffer.flush();
      expect(result.associations).toBeGreaterThan(0);
    });

    it('中等概念重叠 (>0.3) 生成 extends 关系', () => {
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x', 'y'] }));
      buffer.ingest(makeEntry({ source: 'b', concepts: ['y', 'z'] }));
      const result = buffer.flush();
      expect(result.associations).toBeGreaterThan(0);
    });

    it('同源条目不关联', () => {
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x'] }));
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x'] }));
      const result = buffer.flush();
      // 同源不产生关联
      expect(result.associations).toBe(0);
    });
  });

  // ==================== 矛盾检测 ====================

  describe('矛盾检测', () => {
    it('共享概念 + 置信度差异大 → 矛盾', () => {
      // 注意：矛盾关系只记录在后写入的条目上
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x', 'y'], confidence: 0.1 }));
      buffer.ingest(makeEntry({ source: 'b', concepts: ['x', 'y'], confidence: 0.9 }));
      const result = buffer.flush();
      expect(result.contradictions).toBe(1);
    });

    it('无共享概念不矛盾', () => {
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x'], confidence: 0.9 }));
      buffer.ingest(makeEntry({ source: 'b', concepts: ['y'], confidence: 0.1 }));
      const result = buffer.flush();
      expect(result.contradictions).toBe(0);
    });
  });

  // ==================== 融合 ====================

  describe('flush() 融合', () => {
    it('空缓冲返回零结果', () => {
      const result = buffer.flush();
      expect(result.merged).toBe(0);
      expect(result.contradictions).toBe(0);
      expect(result.associations).toBe(0);
      expect(result.durationMs).toBe(0);
    });

    it('写入 STMP', () => {
      buffer.ingest(makeEntry());
      buffer.flush();
      expect(mockStmp.insertNode).toHaveBeenCalledTimes(1);
    });

    it('融合后清空缓冲', () => {
      buffer.ingest(makeEntry());
      buffer.flush();
      expect(buffer.getStatus().buffered).toBe(0);
    });

    it('多条合并后写入 STMP', () => {
      // 高重叠会合并
      buffer.ingest(makeEntry({ source: 'a', concepts: ['x', 'y', 'z'] }));
      buffer.ingest(makeEntry({ source: 'b', concepts: ['x', 'y', 'z'] }));
      buffer.flush();
      // 合并为 1 条
      expect(mockStmp.insertNode).toHaveBeenCalledTimes(1);
    });

    it('updateCognitiveDomains 多概念更新认知', () => {
      buffer.ingest(makeEntry({ concepts: ['ai', 'ml'] }));
      buffer.ingest(makeEntry({ concepts: ['ai', 'ml'] }));
      buffer.flush();
      // 2 个条目共享 ai 和 ml → 更新
      expect(mockCognitive.updateDomainProfile).toHaveBeenCalled();
    });
  });

  // ==================== 生命周期 ====================

  describe('生命周期', () => {
    it('clear() 清空缓冲和定时器', () => {
      buffer.ingest(makeEntry());
      buffer.clear();
      expect(buffer.getStatus().buffered).toBe(0);
    });

    it('getStatus 返回完整状态', () => {
      buffer.ingest(makeEntry());
      buffer.flush();
      buffer.ingest(makeEntry());
      const status = buffer.getStatus();
      expect(status.totalIngested).toBe(2);
      expect(status.flushCount).toBe(1);
      expect(status.buffered).toBe(1);
      expect(status.windowMs).toBe(100);
    });
  });
});
