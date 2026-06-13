/**
 * TextEncoder 全局单例
 *
 * 解决: 5 个独立 ByteEncoder 实例各自维护 LRU 缓存和权重副本
 * 方案: 全局单例 + 共享 LRU 缓存，同样文本只编码一次
 */

import { TextEncoder, type TextEncoderConfig } from './text-encoder.js';

let _instance: TextEncoder | null = null;
let _refCount = 0;

// LRU 缓存：pooled output (Float32Array[128])
const CACHE_MAX = 256;
const _cache = new Map<string, Float32Array>();

/**
 * 获取全局 TextEncoder 单例
 * 首次调用时创建，后续返回同一实例
 */
export function getGlobalTextEncoder(config?: Partial<TextEncoderConfig>): TextEncoder {
  if (!_instance) {
    _instance = new TextEncoder(config);
  }
  _refCount++;
  return _instance;
}

/**
 * 获取单例的池化编码（带 LRU 缓存）
 * 同样文本只编码一次，命中缓存直接返回
 */
export function encodePooled(text: string): Float32Array {
  const cached = _cache.get(text);
  if (cached) return cached;

  const encoder = getGlobalTextEncoder();
  const tensor = encoder.forwardPooled(text);
  const vec = new Float32Array(tensor.data);

  // LRU 淘汰
  if (_cache.size >= CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(text, vec);
  return vec;
}

/**
 * 销毁全局单例（测试用）
 */
export function destroyGlobalTextEncoder(): void {
  _instance = null;
  _refCount = 0;
  _cache.clear();
}

/**
 * 当前是否有活跃单例
 */
export function hasGlobalTextEncoder(): boolean {
  return _instance !== null;
}
