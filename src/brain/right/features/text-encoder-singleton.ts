/**
 * TextEncoder 全局单例
 *
 * 解决: 5 个独立 ByteEncoder 实例各自维护 LRU 缓存和权重副本
 * 方案: 全局单例 + 共享 LRU 缓存，同样文本只编码一次
 */

import { TextEncoder, type TextEncoderConfig } from './text-encoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _instance: TextEncoder | null = null;
let _refCount = 0;

// LRU 缓存：pooled output (Float32Array[384])
const CACHE_MAX = 256;
const _cache = new Map<string, Float32Array>();

/**
 * 获取全局 TextEncoder 单例
 * 首次调用时创建，后续返回同一实例
 *
 * 加载优先级：
 * 1. 训练权重文件 byte-encoder-v2.bin（项目根目录 training-data/）
 * 2. 不存在则用随机初始化（未训练状态）
 */
export function getGlobalTextEncoder(config?: Partial<TextEncoderConfig>): TextEncoder {
  if (!_instance) {
    // 尝试加载训练权重
    const weightPaths = [
      path.resolve(__dirname, '../../../../../training-data/byte-encoder-v2.bin'),
      path.resolve(__dirname, '../../../../training-data/byte-encoder-v2.bin'),
    ];

    let loaded = false;
    for (const wp of weightPaths) {
      if (fs.existsSync(wp)) {
        try {
          const buf = fs.readFileSync(wp).buffer;
          _instance = TextEncoder.deserialize(buf) as TextEncoder;
          console.log(`[ByteEncoder] 已加载训练权重: ${wp} (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`);
          loaded = true;
          break;
        } catch (e) {
          console.warn(`[ByteEncoder] 加载权重失败: ${wp}`, e);
        }
      }
    }

    if (!loaded) {
      _instance = new TextEncoder(config);
      console.log('[ByteEncoder] 未找到训练权重，使用随机初始化');
    }
  }
  _refCount++;
  return _instance!;
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
