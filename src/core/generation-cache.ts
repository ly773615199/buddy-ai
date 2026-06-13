/**
 * 生成缓存 — LLM 可用时预生成，不可用时复用
 *
 * 缓存 LLM 的"组织模式"，断线时作为能力储备。
 * 不是直接复用文本，而是作为模板填充新数据。
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** 缓存条目 */
interface CachedGeneration {
  /** 任务类型 (intent 或 taskType) */
  taskType: string;
  /** 输入指纹 (用于相似度匹配) */
  inputFingerprint: string;
  /** LLM 生成的结果 */
  output: string;
  /** 当时的质量评分 */
  qualityScore: number;
  /** 生成时间 */
  createdAt: number;
  /** 被复用次数 */
  hitCount: number;
}

const MAX_CACHE_SIZE = 200;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const MIN_QUALITY_TO_CACHE = 0.6;

export class GenerationCache {
  private cache: Map<string, CachedGeneration> = new Map();
  private dataDir: string;
  private dirty = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /** 从磁盘加载缓存 */
  async load(): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, 'generation-cache.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.inputFingerprint) {
            this.cache.set(entry.inputFingerprint, entry);
          }
        }
      }
    } catch { /* 文件不存在则忽略 */ }
  }

  /** 持久化到磁盘 */
  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      const filePath = path.join(this.dataDir, 'generation-cache.json');
      const data = [...this.cache.values()];
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch { /* 写入失败不阻塞主流程 */ }
  }

  /** 缓存一次 LLM 生成结果 */
  put(taskType: string, input: string, output: string, qualityScore: number): void {
    if (qualityScore < MIN_QUALITY_TO_CACHE) return;

    const fingerprint = this.fingerprint(taskType, input);
    this.cache.set(fingerprint, {
      taskType,
      inputFingerprint: fingerprint,
      output,
      qualityScore,
      createdAt: Date.now(),
      hitCount: 0,
    });
    this.dirty = true;

    // 淘汰策略：超过容量时淘汰低命中率 + 过期条目
    if (this.cache.size > MAX_CACHE_SIZE) {
      this.evict();
    }
  }

  /** 查找最相似的缓存结果 */
  get(taskType: string, input: string): CachedGeneration | null {
    const fingerprint = this.fingerprint(taskType, input);

    // 精确匹配
    const exact = this.cache.get(fingerprint);
    if (exact && !this.isExpired(exact)) {
      exact.hitCount++;
      this.dirty = true;
      return exact;
    }

    // 模糊匹配：同 taskType 的最近高质量条目
    let best: CachedGeneration | null = null;
    for (const entry of this.cache.values()) {
      if (entry.taskType !== taskType) continue;
      if (this.isExpired(entry)) continue;
      if (!best || entry.qualityScore > best.qualityScore) {
        best = entry;
      }
    }
    if (best) {
      best.hitCount++;
      this.dirty = true;
    }
    return best;
  }

  /** 获取缓存统计 */
  getStats(): { size: number; hitRate: number; avgQuality: number } {
    const entries = [...this.cache.values()];
    const totalHits = entries.reduce((s, e) => s + e.hitCount, 0);
    const totalRequests = totalHits + entries.length; // 粗略估计
    return {
      size: entries.length,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      avgQuality: entries.length > 0
        ? entries.reduce((s, e) => s + e.qualityScore, 0) / entries.length
        : 0,
    };
  }

  private fingerprint(taskType: string, input: string): string {
    // 简单指纹：taskType + 输入的关键信息
    const normalized = input.toLowerCase().trim().slice(0, 200);
    return `${taskType}:${normalized}`;
  }

  private isExpired(entry: CachedGeneration): boolean {
    return Date.now() - entry.createdAt > MAX_AGE_MS;
  }

  private evict(): void {
    const entries = [...this.cache.entries()]
      .sort((a, b) => {
        // 优先淘汰：过期 > 低命中率 > 低质量
        const aExpired = this.isExpired(a[1]) ? 1 : 0;
        const bExpired = this.isExpired(b[1]) ? 1 : 0;
        if (aExpired !== bExpired) return bExpired - aExpired;
        if (a[1].hitCount !== b[1].hitCount) return a[1].hitCount - b[1].hitCount;
        return a[1].qualityScore - b[1].qualityScore;
      });

    // 淘汰前 20%
    const toRemove = Math.ceil(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
    this.dirty = true;
  }
}
