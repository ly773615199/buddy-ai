/**
 * ByteEncoder Embedding Provider — 本地语义引擎
 *
 * 将 ByteEncoder 包装为标准 EmbeddingProvider 接口，
 * 注册到 embedding 降级链：ONNX → ByteEncoder → TF-IDF
 *
 * 优势：零依赖、本地运行、延迟 ~15ms、支持持续学习
 */

import type { EmbeddingProvider } from './onnx-provider.js';
import { getGlobalTextEncoder } from '../../brain/right/features/text-encoder-singleton.js';

export class ByteEncoderEmbeddingProvider implements EmbeddingProvider {
  name = 'byte-encoder-local';
  dimensions = 384; // V2 输出维度

  /**
   * 生成 embedding 向量
   */
  async embed(text: string): Promise<number[]> {
    const encoder = getGlobalTextEncoder();
    const tensor = encoder.forwardPooled(text);
    return Array.from(tensor.data);
  }

  /**
   * 始终可用（零依赖，纯本地计算）
   */
  isAvailable(): boolean {
    return true;
  }
}
