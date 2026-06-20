/**
 * Embedding Providers — 统一导出
 *
 * 可用 provider：
 * - ONNXEmbeddingProvider: 本地 ONNX 推理（需 @huggingface/transformers）
 * - ByteEncoderEmbeddingProvider: 本地 ByteEncoder（零依赖，持续学习）
 * - TfIdfEmbedding: 始终可用的降级方案（字符级 TF-IDF）
 */

export { ONNXEmbeddingProvider, type EmbeddingProvider } from './onnx-provider.js';
export { ByteEncoderEmbeddingProvider } from './byte-encoder-provider.js';
export { EnhancedTfIdf } from './enhanced-tfidf.js';

/**
 * TF-IDF Embedding 降级方案
 * 纯计算，零依赖，质量有限但始终可用
 */
export class TfIdfEmbedding {
  name = 'tfidf-fallback';
  dimensions = 128;
  private readonly dim: number;

  constructor(dim = 128) {
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dim).fill(0);
    const chars = text.toLowerCase().split('');
    const tokens: string[] = [];

    // bigram
    for (let i = 0; i < chars.length - 1; i++) {
      tokens.push(chars[i] + chars[i + 1]);
    }
    // 空格分词
    for (const word of text.toLowerCase().split(/\s+/)) {
      if (word.length > 1) tokens.push(word);
    }
    if (tokens.length === 0) return vec;

    // TF 统计
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    // 哈希到向量
    for (const [token, count] of tf) {
      let h = 42;
      for (let i = 0; i < token.length; i++) {
        h = ((h << 5) - h + token.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(h) % this.dim;
      vec[idx] += Math.log(1 + count);
    }

    // L2 归一化
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) vec[i] /= norm;

    return vec;
  }

  isAvailable(): boolean {
    return true; // 始终可用
  }
}
