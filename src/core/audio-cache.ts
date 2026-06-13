/**
 * 音频缓存 — 大音频走 REST，WS 只发通知
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 3）
 * 职责：TTS 音频的临时缓存管理
 */

interface AudioEntry {
  data: string;
  format: string;
  createdAt: number;
}

export class AudioCache {
  private cache = new Map<string, AudioEntry>();
  private readonly maxAgeMs: number;
  private readonly restThresholdBytes: number;

  constructor(
    maxAgeMs = 60_000,
    restThresholdBytes = 4096,
  ) {
    this.maxAgeMs = maxAgeMs;
    this.restThresholdBytes = restThresholdBytes;
  }

  /** 判断是否应走 REST（数据量大于阈值） */
  shouldUseREST(dataSize: number): boolean {
    return dataSize > this.restThresholdBytes;
  }

  /** 缓存音频数据 */
  set(id: string, data: string, format: string): void {
    this.cache.set(id, { data, format, createdAt: Date.now() });
    this.purge();
  }

  /** 获取并移除缓存的音频（一次性消费） */
  get(id: string): { data: string; format: string } | null {
    const entry = this.cache.get(id);
    if (!entry) return null;
    this.cache.delete(id);
    return { data: entry.data, format: entry.format };
  }

  /** 清理过期缓存 */
  purge(): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, entry] of this.cache) {
      if (now - entry.createdAt > this.maxAgeMs) {
        this.cache.delete(id);
        purged++;
      }
    }
    return purged;
  }

  /** 当前缓存数量 */
  get size(): number {
    return this.cache.size;
  }
}
