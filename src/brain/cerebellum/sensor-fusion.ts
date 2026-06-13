/**
 * 感知融合 — 小脑的多源感知数据融合
 *
 * 整合 FusionBuffer + PerceptionEventBus，提供：
 * - 多源事件统一接收
 * - 自动关联检测（概念重叠 > 0.3 → 关联）
 * - 矛盾信息标记（不覆盖，标 warning）
 * - 重要性加权排序
 * - 融合后输出 BodyEvent 给 BodyState
 *
 * 设计原则：
 * - 异步融合，不阻塞主流程
 * - 矛盾信息保留而非丢弃
 * - 轻量级，纯内存，无外部依赖
 */

import type { BodyEvent } from '../types.js';

// ==================== 类型 ====================

export interface PerceptionEntry {
  /** 来源标识 */
  source: string;
  /** 内容文本 */
  content: string;
  /** 概念标签 */
  concepts: string[];
  /** 时间戳 */
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
    valence: number;    // -1 ~ 1
    importance: number;  // 0-1
  };
}

export interface FusionResult {
  merged: number;
  contradictions: number;
  associations: number;
  durationMs: number;
}

export interface SensorFusionConfig {
  /** 缓冲区最大条目数 */
  maxEntries: number;
  /** 融合窗口（ms）：窗口内的条目一起融合 */
  fusionWindowMs: number;
  /** 概念重叠阈值：超过此值自动关联 */
  associationThreshold: number;
  /** 是否启用自动融合 */
  autoFlush: boolean;
  /** 自动融合间隔（ms） */
  flushIntervalMs: number;
}

const DEFAULT_CONFIG: SensorFusionConfig = {
  maxEntries: 500,
  fusionWindowMs: 5000,
  associationThreshold: 0.3,
  autoFlush: true,
  flushIntervalMs: 10000,
};

// ==================== SensorFusion ====================

export class SensorFusion {
  private entries: PerceptionEntry[] = [];
  private config: SensorFusionConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(event: BodyEvent) => void> = [];
  private stmpWriter: ((entry: PerceptionEntry) => void) | null = null;
  private verbose: boolean;

  // 统计
  private totalIngested = 0;
  private flushCount = 0;
  private totalContradictions = 0;
  private totalAssociations = 0;

  constructor(config?: Partial<SensorFusionConfig>, verbose = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verbose = verbose;

    if (this.config.autoFlush) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    }
  }

  /** 设置 STMP 写入回调（替代 FusionBuffer 的 STMP 集成） */
  setStmpWriter(writer: (entry: PerceptionEntry) => void): void {
    this.stmpWriter = writer;
  }

  // ==================== 写入 ====================

  /** 注入一条感知数据 */
  ingest(entry: Omit<PerceptionEntry, 'timestamp' | 'relations'>): void {
    const full: PerceptionEntry = {
      ...entry,
      timestamp: Date.now(),
      relations: [],
    };

    // 自动关联检测
    this.detectAssociations(full);

    // 矛盾检测
    this.detectContradictions(full);

    this.entries.push(full);
    this.totalIngested++;

    // 超限淘汰（FIFO）
    if (this.entries.length > this.config.maxEntries) {
      this.entries.shift();
    }
  }

  /** 从系统事件注入（快捷方法） */
  ingestSystemEvent(type: string, data: Record<string, unknown>, confidence = 1): void {
    this.ingest({
      source: 'system',
      content: type,
      concepts: [type],
      confidence,
      emotional: data.importance ? { valence: 0, importance: data.importance as number } : undefined,
    });
  }

  /** 从用户消息注入 */
  ingestUserMessage(content: string, concepts: string[] = []): void {
    this.ingest({
      source: 'user',
      content,
      concepts: concepts.length > 0 ? concepts : this.extractConcepts(content),
      confidence: 1,
      emotional: { valence: 0, importance: 0.8 },
    });
  }

  /** 从工具结果注入 */
  ingestToolResult(toolName: string, success: boolean, content: string): void {
    this.ingest({
      source: `tool:${toolName}`,
      content,
      concepts: [toolName, success ? 'success' : 'failure'],
      confidence: success ? 0.9 : 0.5,
      emotional: {
        valence: success ? 0.5 : -0.5,
        importance: success ? 0.3 : 0.6,
      },
    });
  }

  // ==================== 融合 ====================

  /**
   * 执行融合：将缓冲区中的条目融合为 BodyEvent
   *
   * MAPE-K 的 Analyze + Plan 阶段
   */
  flush(): FusionResult {
    const t0 = performance.now();
    if (this.entries.length === 0) {
      return { merged: 0, contradictions: 0, associations: 0, durationMs: 0 };
    }

    const now = Date.now();
    const windowEntries = this.entries.filter(e => now - e.timestamp < this.config.fusionWindowMs);

    // 按重要性加权排序
    windowEntries.sort((a, b) => {
      const impA = a.emotional?.importance ?? 0.5;
      const impB = b.emotional?.importance ?? 0.5;
      return impB - impA;
    });

    // 融合为 BodyEvent
    const events = this.fuseToEvents(windowEntries);

    // 通知监听器
    for (const event of events) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    // 统计
    const contradictions = windowEntries.reduce((sum, e) =>
      sum + e.relations.filter(r => r.type === 'contradicts').length, 0);
    const associations = windowEntries.reduce((sum, e) =>
      sum + e.relations.filter(r => r.type !== 'contradicts').length, 0);

    this.totalContradictions += contradictions;
    this.totalAssociations += associations;
    this.flushCount++;

    // STMP 写入（替代 FusionBuffer 的 STMP 集成）
    if (this.stmpWriter) {
      for (const entry of windowEntries) {
        try { this.stmpWriter(entry); } catch (e) { console.debug('[sensor-fusion] STMP write fail', e); }
      }
    }

    // 清除已融合的条目
    this.entries = this.entries.filter(e => now - e.timestamp >= this.config.fusionWindowMs);

    const durationMs = performance.now() - t0;

    if (this.verbose) {
      console.log(`[SensorFusion] flush: ${windowEntries.length} entries → ${events.length} events, ${durationMs.toFixed(1)}ms`);
    }

    return { merged: windowEntries.length, contradictions, associations, durationMs };
  }

  // ==================== 监听 ====================

  /** 注册融合后的 BodyEvent 监听器 */
  onFused(callback: (event: BodyEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  // ==================== 查询 ====================

  /** 获取缓冲区状态 */
  getStatus(): {
    buffered: number;
    totalIngested: number;
    flushCount: number;
    contradictions: number;
    associations: number;
  } {
    return {
      buffered: this.entries.length,
      totalIngested: this.totalIngested,
      flushCount: this.flushCount,
      contradictions: this.totalContradictions,
      associations: this.totalAssociations,
    };
  }

  /** 获取最近的感知条目 */
  getRecent(count: number): PerceptionEntry[] {
    return this.entries.slice(-count);
  }

  /** 清空 */
  clear(): void {
    this.entries = [];
  }

  /** 销毁（停止自动融合） */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.listeners = [];
    this.entries = [];
  }

  // ==================== 内部 ====================

  /** 自动关联检测 */
  private detectAssociations(entry: PerceptionEntry): void {
    for (const existing of this.entries) {
      const overlap = this.conceptOverlap(entry.concepts, existing.concepts);
      if (overlap >= this.config.associationThreshold) {
        entry.relations.push({
          target: existing.source,
          type: 'supports',
        });
      }
    }
  }

  /** 矛盾检测 */
  private detectContradictions(entry: PerceptionEntry): void {
    for (const existing of this.entries) {
      // 同源不同结论 → 可能矛盾
      if (existing.source === entry.source) continue;
      const overlap = this.conceptOverlap(entry.concepts, existing.concepts);
      if (overlap > 0.5) {
        // 概念高度重叠但情绪极性相反 → 矛盾
        const valenceA = entry.emotional?.valence ?? 0;
        const valenceB = existing.emotional?.valence ?? 0;
        if (Math.abs(valenceA - valenceB) > 1.0) {
          entry.relations.push({
            target: existing.source,
            type: 'contradicts',
          });
        }
      }
    }
  }

  /** 概念重叠度计算 */
  private conceptOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setB = new Set(b);
    let overlap = 0;
    for (const c of a) {
      if (setB.has(c)) overlap++;
    }
    return overlap / Math.max(a.length, b.length);
  }

  /** 从文本提取概念标签（轻量级，无 NLP） */
  private extractConcepts(text: string): string[] {
    const words = text.match(/[\w\u4e00-\u9fff]{2,}/g) || [];
    const unique = [...new Set(words.map(w => w.toLowerCase()))];
    return unique.slice(0, 10);
  }

  /** 将感知条目融合为 BodyEvent */
  private fuseToEvents(entries: PerceptionEntry[]): BodyEvent[] {
    if (entries.length === 0) return [];

    // 按来源分组
    const bySource = new Map<string, PerceptionEntry[]>();
    for (const e of entries) {
      const key = e.source.split(':')[0]; // 'tool:xxx' → 'tool'
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(e);
    }

    const events: BodyEvent[] = [];

    for (const [source, group] of bySource) {
      // 计算融合后的情绪
      let totalValence = 0;
      let totalImportance = 0;
      let weight = 0;

      for (const e of group) {
        const imp = e.emotional?.importance ?? 0.5;
        totalValence += (e.emotional?.valence ?? 0) * imp;
        totalImportance += imp;
        weight += imp;
      }

      const avgValence = weight > 0 ? totalValence / weight : 0;
      const avgImportance = weight > 0 ? totalImportance / group.length : 0.5;

      // 检查是否有矛盾
      const hasContradictions = group.some(e =>
        e.relations.some(r => r.type === 'contradicts'));

      // 映射为 BodyEvent
      const eventType = this.sourceToEventType(source);
      events.push({
        type: eventType,
        timestamp: Date.now(),
        data: {
          source,
          count: group.length,
          valence: avgValence,
          importance: avgImportance,
          hasContradictions,
          concepts: [...new Set(group.flatMap(e => e.concepts))].slice(0, 5),
        },
      });
    }

    return events;
  }

  /** 来源 → BodyEvent 类型映射 */
  private sourceToEventType(source: string): BodyEvent['type'] {
    switch (source) {
      case 'user': return 'user_message';
      case 'tool': return 'tool_result';
      case 'system': return 'system';
      case 'environment': return 'environment';
      default: return 'environment';
    }
  }
}
