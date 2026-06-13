/**
 * FusionBuffer — 多源记忆融合缓冲区
 *
 * 核心能力：
 * - 多源并发写入（无需加锁，entries.push 天然原子）
 * - 自动关联检测（概念重叠度 > 0.3 自动关联）
 * - 矛盾信息标记（不覆盖，标记为 warning）
 * - 重要性加权排序
 * - 定时融合写入 STMP
 *
 * 设计原则：
 * - 异步融合，不阻塞主流程
 * - 多对多融合模型（非单流串行）
 * - 矛盾信息保留而非丢弃
 */

import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';

// ==================== 类型 ====================

export interface FusionEntry {
  /** 来源标识（expert-arch, expert-code, user, tool-result...） */
  source: string;
  /** 内容文本 */
  content: string;
  /** 概念标签列表 */
  concepts: string[];
  /** 写入时间戳 */
  timestamp: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 关联关系 */
  relations: Array<{
    target: string;
    type: 'supports' | 'contradicts' | 'extends';
  }>;
  /** 情绪信息（可选） */
  emotional?: {
    valence: number;
    importance: number;
  };
}

export interface FusionResult {
  /** 合并后的条目数 */
  merged: number;
  /** 检测到的矛盾数 */
  contradictions: number;
  /** 建立的关联数 */
  associations: number;
  /** 融合耗时（ms） */
  durationMs: number;
}

interface WeightedNode {
  id: string;
  content: string;
  room: string;
  timestamp: number;
  temporalContext: { before: string[]; after: string[] };
  concepts: string[];
  relations: Array<{
    target: string;
    type: 'causes' | 'follows' | 'contradicts' | 'supports' | 'is_example_of' | 'relates_to';
    strength: number;
  }>;
  emotional: { valence: number; importance: number };
  lifecycle: {
    createdAt: number;
    lastAccessed: number;
    accessCount: number;
    decay: number;
    compressed: boolean;
    hibernated: boolean;
  };
  source: 'observed';
}

// ==================== FusionBuffer ====================

export class FusionBuffer {
  private entries: FusionEntry[] = [];
  private readonly windowMs: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushCount = 0;
  private totalIngested = 0;

  constructor(
    private stmp: STMPStore,
    private cognitive: CognitiveEngine,
    windowMs = 30_000,
  ) {
    this.windowMs = windowMs;
  }

  // ==================== 写入 ====================

  /**
   * 多源并发写入 — 无需加锁
   * entries.push 在 Node.js 单线程模型下是原子操作
   */
  ingest(entry: FusionEntry): void {
    this.entries.push(entry);
    this.totalIngested++;
    this.detectRelations(entry);
    this.scheduleFlush();
  }

  /**
   * 批量写入
   */
  ingestBatch(entries: FusionEntry[]): void {
    for (const entry of entries) {
      this.entries.push(entry);
      this.totalIngested++;
      this.detectRelations(entry);
    }
    this.scheduleFlush();
  }

  // ==================== 关联检测 ====================

  /**
   * 新条目与已有条目自动关联
   */
  private detectRelations(entry: FusionEntry): void {
    for (const existing of this.entries) {
      if (existing.source === entry.source) continue;

      const overlap = this.conceptOverlap(entry.concepts, existing.concepts);

      if (overlap > 0.5) {
        // 高重叠 → 支持关系
        entry.relations.push({ target: existing.source, type: 'supports' });
      } else if (overlap > 0.3) {
        // 中等重叠 → 扩展关系
        entry.relations.push({ target: existing.source, type: 'extends' });
      }

      // 矛盾检测：如果两个来源对同一概念给出相反的置信度
      if (this.isContradictory(entry, existing)) {
        entry.relations.push({ target: existing.source, type: 'contradicts' });
      }
    }
  }

  /**
   * 概念重叠度计算（Jaccard 相似度）
   */
  private conceptOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }

  /**
   * 矛盾检测
   * 两个条目共享概念但置信度差异大 → 可能矛盾
   */
  private isContradictory(a: FusionEntry, b: FusionEntry): boolean {
    const sharedConcepts = a.concepts.filter(c => b.concepts.includes(c));
    if (sharedConcepts.length === 0) return false;

    // 置信度差异 > 0.6 且有共享概念 → 可能矛盾
    const confDiff = Math.abs(a.confidence - b.confidence);
    return confDiff > 0.6 && sharedConcepts.length >= 2;
  }

  // ==================== 融合 ====================

  /**
   * 定时融合调度
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.windowMs);
  }

  /**
   * 立即融合所有缓冲条目
   */
  flush(): FusionResult {
    const start = Date.now();
    const entries = [...this.entries];
    this.entries = [];

    if (entries.length === 0) {
      return { merged: 0, contradictions: 0, associations: 0, durationMs: 0 };
    }

    // 1. 合并关联条目
    const merged = this.mergeRelated(entries);

    // 2. 检测矛盾
    const contradictions = this.findContradictions(entries);

    // 3. 重要性加权
    const weighted = this.weightByImportance(merged);

    // 4. 写入 STMP
    for (const node of weighted) {
      try {
        this.stmp.insertNode(node);
      } catch (err) {
        console.warn('[FusionBuffer] STMP 写入失败:', (err as Error).message);
      }
    }

    // 5. 更新认知领域
    this.updateCognitiveDomains(entries);

    this.flushCount++;

    const result: FusionResult = {
      merged: weighted.length,
      contradictions: contradictions.length,
      associations: entries.reduce((sum, e) => sum + e.relations.length, 0),
      durationMs: Date.now() - start,
    };

    return result;
  }

  /**
   * 合并关联条目
   */
  private mergeRelated(entries: FusionEntry[]): Array<{
    content: string;
    concepts: string[];
    importance: number;
    source: string;
    confidence: number;
  }> {
    const groups = new Map<string, FusionEntry[]>();

    // 按关联关系分组
    for (const entry of entries) {
      const supportsRel = entry.relations.find(r => r.type === 'supports');
      const key = supportsRel ? supportsRel.target : entry.source;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const result: Array<{
      content: string;
      concepts: string[];
      importance: number;
      source: string;
      confidence: number;
    }> = [];

    for (const [, group] of groups) {
      if (group.length === 1) {
        const e = group[0];
        result.push({
          content: e.content,
          concepts: e.concepts,
          importance: e.emotional?.importance ?? 5,
          source: e.source,
          confidence: e.confidence,
        });
      } else {
        // 多条合并
        const allConcepts = [...new Set(group.flatMap(e => e.concepts))];
        const avgImportance = group.reduce(
          (s, e) => s + (e.emotional?.importance ?? 5), 0
        ) / group.length;
        const avgConfidence = group.reduce(
          (s, e) => s + e.confidence, 0
        ) / group.length;
        const contents = group
          .map(e => `[${e.source}] ${e.content}`)
          .join('\n');
        result.push({
          content: contents,
          concepts: allConcepts,
          importance: avgImportance,
          source: group.map(e => e.source).join('+'),
          confidence: avgConfidence,
        });
      }
    }

    return result;
  }

  /**
   * 检测矛盾对
   */
  private findContradictions(entries: FusionEntry[]): Array<{
    a: FusionEntry;
    b: FusionEntry;
  }> {
    const contradictions: Array<{ a: FusionEntry; b: FusionEntry }> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        // 检查双向关系（detectRelations 只在后写入的条目上记录）
        const relIJ = entries[i].relations.find(
          r => r.target === entries[j].source && r.type === 'contradicts'
        );
        const relJI = entries[j].relations.find(
          r => r.target === entries[i].source && r.type === 'contradicts'
        );
        if (relIJ || relJI) {
          contradictions.push({ a: entries[i], b: entries[j] });
        }
      }
    }
    return contradictions;
  }

  /**
   * 重要性加权排序
   */
  private weightByImportance(entries: Array<{
    content: string;
    concepts: string[];
    importance: number;
    source: string;
    confidence: number;
  }>): WeightedNode[] {
    return entries
      .sort((a, b) => b.importance - a.importance)
      .map(e => ({
        id: `fusion-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: e.content,
        room: 'perception',
        timestamp: Date.now(),
        temporalContext: { before: [], after: [] },
        concepts: e.concepts,
        relations: [] as Array<{
          target: string;
          type: 'causes' | 'follows' | 'contradicts' | 'supports' | 'is_example_of' | 'relates_to';
          strength: number;
        }>,
        emotional: { valence: 0, importance: e.importance },
        lifecycle: {
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          accessCount: 1,
          decay: 1.0,
          compressed: false,
          hibernated: false,
        },
        source: 'observed' as const,
      }));
  }

  /**
   * 更新认知领域活跃度
   */
  private updateCognitiveDomains(entries: FusionEntry[]): void {
    const domainCounts = new Map<string, number>();
    for (const entry of entries) {
      for (const concept of entry.concepts) {
        domainCounts.set(concept, (domainCounts.get(concept) ?? 0) + 1);
      }
    }
    for (const [domain, count] of domainCounts) {
      if (count >= 2) {
        try {
          (this.cognitive as any).recordInteraction?.(domain) ?? this.cognitive.updateDomainProfile(domain, {});
        } catch (err) {
          // cognitive engine 可能未完全初始化，忽略
        }
      }
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取当前缓冲状态
   */
  getStatus(): {
    buffered: number;
    totalIngested: number;
    flushCount: number;
    windowMs: number;
  } {
    return {
      buffered: this.entries.length,
      totalIngested: this.totalIngested,
      flushCount: this.flushCount,
      windowMs: this.windowMs,
    };
  }

  /**
   * 清空缓冲区（用于关闭/重置）
   */
  clear(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.entries = [];
  }
}
