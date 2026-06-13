/**
 * 审议存档 — 持久化审议过程，供后续复盘和学习
 *
 * 存储在内存中（Map），可选持久化到文件
 */

import type { DeliberationArchive } from './types.js';

export class DeliberationArchiveStore {
  private store: Map<string, DeliberationArchive> = new Map();
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  save(archive: DeliberationArchive): void {
    // 超出上限时淘汰最旧的
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(archive.id, archive);
  }

  get(id: string): DeliberationArchive | undefined {
    return this.store.get(id);
  }

  getAll(): DeliberationArchive[] {
    return [...this.store.values()];
  }

  getRecent(count: number): DeliberationArchive[] {
    return [...this.store.values()].slice(-count);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
