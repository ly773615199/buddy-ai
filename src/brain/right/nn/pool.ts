/**
 * Tensor 对象池 — 复用 Float32Array 减少 GC 压力
 *
 * 按 shape 分桶，每桶维护一个空闲列表。
 * acquire() 从桶中取一个，release() 归还。
 * 推理时不需要池化（单次分配即可），训练时显著减少 GC。
 */

export class TensorPool {
  private pools: Map<string, Float32Array[]> = new Map();
  private maxPerBucket = 32;
  private stats = { hits: 0, misses: 0 };

  acquire(shape: number[]): Float32Array {
    const key = shape.join('×');
    const bucket = this.pools.get(key);
    if (bucket && bucket.length > 0) {
      this.stats.hits++;
      const buf = bucket.pop()!;
      buf.fill(0);
      return buf;
    }
    this.stats.misses++;
    return new Float32Array(shape.reduce((a, b) => a * b, 1));
  }

  release(shape: number[], buf: Float32Array): void {
    const key = shape.join('×');
    let bucket = this.pools.get(key);
    if (!bucket) {
      bucket = [];
      this.pools.set(key, bucket);
    }
    if (bucket.length < this.maxPerBucket) {
      bucket.push(buf);
    }
  }

  /** 预热：为指定 shape 预分配 n 个 buffer */
  warmup(shape: number[], n: number): void {
    const key = shape.join('×');
    let bucket = this.pools.get(key);
    if (!bucket) {
      bucket = [];
      this.pools.set(key, bucket);
    }
    for (let i = 0; i < n; i++) {
      if (bucket.length >= this.maxPerBucket) break;
      bucket.push(new Float32Array(shape.reduce((a, b) => a * b, 1)));
    }
  }

  /** 回收推理期间所有借出的 buffer（按 shape 归还到对应桶） */
  releaseAll(buffers: Array<{ shape: number[]; data: Float32Array }>): void {
    for (const { shape, data } of buffers) {
      this.release(shape, data);
    }
  }

  clear(): void {
    this.pools.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

/** 全局池实例 */
export const globalPool = new TensorPool();
