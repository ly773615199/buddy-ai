/**
 * MultiPathRecall — 多路召回融合
 *
 * 多个 EmbeddingProvider 独立召回，取长补短，RRF 融合排序。
 * 弱的或不可用的自动跳过，不影响其他路。
 *
 * 设计原则：
 * - 每个 provider 独立工作，互不干扰
 * - 质量不达标的 provider 自动过滤（不参与融合）
 * - 结果用 RRF (Reciprocal Rank Fusion) 合并
 * - 最终与 FTS5 + TF-IDF 再做一轮融合
 */

import type { EmbeddingProvider } from './onnx-provider.js';

// ==================== 类型 ====================

export interface ProviderConfig {
  /** provider 实例 */
  provider: EmbeddingProvider;
  /** 搜索权重（用于最终融合），默认 1.0 */
  weight?: number;
  /** 最小相似度门槛，低于此值的结果被过滤，默认 0.01 */
  minSimilarity?: number;
  /** 标签（日志用） */
  label?: string;
}

export interface RecallResult {
  key: string;
  value: string;
  /** 融合后的分数 */
  score: number;
  /** 每路的排名（用于调试） */
  ranks: Record<string, number>;
  /** 每路的原始相似度（用于调试） */
  similarities: Record<string, number>;
}

interface ProviderResult {
  key: string;
  value: string;
  similarity: number;
  rank: number;
}

// ==================== 余弦相似度 ====================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

// ==================== RRF 融合 ====================

/**
 * Reciprocal Rank Fusion (RRF)
 *
 * 论文: Cormack et al., 2009
 * 公式: score(d) = Σ_r 1 / (k + rank_r(d))
 *
 * k = 60 是论文推荐的默认值。
 * RRF 的优势：不需要归一化不同 provider 的分数，只看排名。
 *
 * @param resultLists 每路的排序结果
 * @param k RRF 参数，默认 60
 * @returns 融合后的结果
 */
export function rrfFusion(
  resultLists: Map<string, ProviderResult[]>,
  k = 60,
): RecallResult[] {
  const scoreMap = new Map<string, RecallResult>();

  for (const [label, results] of resultLists) {
    for (const r of results) {
      const existing = scoreMap.get(r.key);
      if (existing) {
        existing.score += 1 / (k + r.rank);
        existing.ranks[label] = r.rank;
        existing.similarities[label] = r.similarity;
      } else {
        scoreMap.set(r.key, {
          key: r.key,
          value: r.value,
          score: 1 / (k + r.rank),
          ranks: { [label]: r.rank },
          similarities: { [label]: r.similarity },
        });
      }
    }
  }

  const results = [...scoreMap.values()];
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ==================== MultiPathRecall ====================

export interface MultiPathRecallConfig {
  /** 每路召回的候选数量 */
  topK?: number;
  /** RRF 的 k 参数 */
  rrfK?: number;
  /** 是否打印详细日志 */
  verbose?: boolean;
}

const DEFAULT_CONFIG: MultiPathRecallConfig = {
  topK: 20,
  rrfK: 60,
  verbose: false,
};

/**
 * 多路召回融合引擎
 *
 * 使用方式：
 * ```ts
 * const recall = new MultiPathRecall();
 * recall.addProvider({ provider: onnxProvider, weight: 1.0, label: 'ONNX' });
 * recall.addProvider({ provider: tfidfProvider, weight: 0.8, label: 'TF-IDF' });
 * recall.addProvider({ provider: byteEncoder, weight: 0.5, label: 'ByteEncoder' });
 *
 * // 每路独立召回，RRF 融合
 * const results = await recall.search(query, documents);
 * ```
 */
export class MultiPathRecall {
  private providers: ProviderConfig[] = [];
  private config: MultiPathRecallConfig;

  constructor(config?: Partial<MultiPathRecallConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 添加一路 provider
   */
  addProvider(config: ProviderConfig): void {
    this.providers.push(config);
  }

  /**
   * 移除一路 provider（按 label）
   */
  removeProvider(label: string): void {
    this.providers = this.providers.filter(p => p.label !== label);
  }

  /**
   * 获取当前可用的 provider 列表
   */
  getAvailableProviders(): string[] {
    return this.providers
      .filter(p => p.provider.isAvailable())
      .map(p => p.label ?? p.provider.name);
  }

  /**
   * 多路召回搜索
   *
   * @param query 查询文本
   * @param documents 要搜索的文档列表，支持每路独立的预计算向量:
   *   - `vector`: 单路向量（向后兼容）
   *   - `vectors`: 多路向量 { label: number[] }，按 provider 标签索引
   *   - 无向量：实时计算（慢，仅作降级）
   * @returns RRF 融合后的排序结果
   */
  async search(
    query: string,
    documents: Array<{ key: string; value: string; vector?: number[]; vectors?: Record<string, number[]> }>,
  ): Promise<RecallResult[]> {
    const { topK, rrfK, verbose } = this.config;
    const resultLists = new Map<string, ProviderResult[]>();
    const activeProviders: string[] = [];

    // 每路独立召回
    for (const pc of this.providers) {
      const label = pc.label ?? pc.provider.name;

      // 检查可用性
      if (!pc.provider.isAvailable()) {
        if (verbose) console.log(`[MultiPath] ${label}: 不可用，跳过`);
        continue;
      }

      try {
        // 查询向量
        const queryVec = await pc.provider.embed(query);

        // 对所有文档计算相似度
        const scored: Array<{ key: string; value: string; similarity: number }> = [];

        for (const doc of documents) {
          let similarity: number;

          // 优先用多路缓存向量
          const cachedVec = doc.vectors?.[label];
          if (cachedVec && cachedVec.length === queryVec.length) {
            similarity = cosineSimilarity(queryVec, cachedVec);
          } else if (doc.vector && doc.vector.length === queryVec.length) {
            // 单路向量（向后兼容）
            similarity = cosineSimilarity(queryVec, doc.vector);
          } else {
            // 没有预计算向量，实时计算
            const docVec = await pc.provider.embed(doc.value);
            similarity = cosineSimilarity(queryVec, docVec);
          }

          // 过滤低于门槛的结果
          const minSim = pc.minSimilarity ?? 0.01;
          if (similarity >= minSim) {
            scored.push({ key: doc.key, value: doc.value, similarity });
          }
        }

        // 按相似度排序
        scored.sort((a, b) => b.similarity - a.similarity);
        const topResults = scored.slice(0, topK);

        // 添加排名
        const ranked: ProviderResult[] = topResults.map((r, i) => ({
          ...r,
          rank: i + 1,
        }));

        resultLists.set(label, ranked);
        activeProviders.push(label);

        if (verbose) {
          console.log(`[MultiPath] ${label}: ${ranked.length} 条结果, top similarity=${ranked[0]?.similarity.toFixed(4) ?? 'N/A'}`);
        }
      } catch (err) {
        if (verbose) console.warn(`[MultiPath] ${label}: 搜索失败 -`, (err as Error).message);
        // 某路失败不影响其他路
      }
    }

    // 没有任何路返回结果
    if (resultLists.size === 0) {
      return [];
    }

    // RRF 融合
    const fused = rrfFusion(resultLists, rrfK);

    // 应用 provider 权重
    for (const result of fused) {
      let weightedScore = 0;
      let totalWeight = 0;
      for (const pc of this.providers) {
        const label = pc.label ?? pc.provider.name;
        const rank = result.ranks[label];
        if (rank !== undefined) {
          const weight = pc.weight ?? 1.0;
          weightedScore += (result.score * weight);
          totalWeight += weight;
        }
      }
      result.score = totalWeight > 0 ? weightedScore / totalWeight : result.score;
    }

    // 重新排序（加权后）
    fused.sort((a, b) => b.score - a.score);

    if (verbose) {
      console.log(`[MultiPath] 融合完成: ${activeProviders.join('+')} → ${fused.length} 条结果`);
    }

    return fused;
  }

  /**
   * 多路嵌入生成（用于存储）
   *
   * 返回每路 provider 的向量，调用方可以按 provider 分别存储。
   */
  async embedAll(text: string): Promise<Map<string, { vector: number[]; dimensions: number; model: string }>> {
    const results = new Map<string, { vector: number[]; dimensions: number; model: string }>();

    for (const pc of this.providers) {
      const label = pc.label ?? pc.provider.name;
      if (!pc.provider.isAvailable()) continue;

      try {
        const vector = await pc.provider.embed(text);
        results.set(label, {
          vector,
          dimensions: vector.length,
          model: pc.provider.name,
        });
      } catch {
        // 某路失败不影响其他路
      }
    }

    return results;
  }
}
