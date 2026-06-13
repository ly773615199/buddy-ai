/**
 * 知识-训练桥接器 — 将提取的知识转为世界模型训练样本
 *
 * 连接 KnowledgeExtractor → knowledgeToTrainingSample() → ReplayBuffer
 *
 * 数据流：
 *   对话 → KnowledgeExtractor → ExtractedKnowledge[]
 *     → KnowledgeBridge → WorldModelTrainingSample[]
 *       → ReplayBuffer → OnlineLearner
 */

import {
  knowledgeToTrainingSample,
  type WorldModelTrainingSample,
} from './scene-training.js';

// ==================== 类型 ====================

/** 知识提取器输出的最小接口 */
export interface ExtractedKnowledgeLite {
  type: string;
  content: string;
  domain: string;
  confidence: number;
  concepts: string[];
  sourceMessages?: string[];
}

/** 桥接器配置 */
export interface KnowledgeBridgeConfig {
  /** 最小置信度阈值 */
  minConfidence: number;
  /** 每批最大处理数 */
  maxBatchSize: number;
  /** 是否自动推断关系 */
  inferRelations: boolean;
}

const DEFAULT_CONFIG: KnowledgeBridgeConfig = {
  minConfidence: 0.3,
  maxBatchSize: 20,
  inferRelations: true,
};

export interface KnowledgeBridgeStats {
  totalProcessed: number;
  totalConverted: number;
  skippedLowConfidence: number;
  skippedDuplicate: number;
}

// ==================== KnowledgeBridge ====================

export class KnowledgeBridge {
  private config: KnowledgeBridgeConfig;
  private seen = new Set<string>(); // 去重
  private stats: KnowledgeBridgeStats = {
    totalProcessed: 0,
    totalConverted: 0,
    skippedLowConfidence: 0,
    skippedDuplicate: 0,
  };

  constructor(config?: Partial<KnowledgeBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 将一批提取的知识转为世界模型训练样本
   */
  convert(knowledge: ExtractedKnowledgeLite[]): WorldModelTrainingSample[] {
    const samples: WorldModelTrainingSample[] = [];

    for (const item of knowledge.slice(0, this.config.maxBatchSize)) {
      this.stats.totalProcessed++;

      // 置信度过滤
      if (item.confidence < this.config.minConfidence) {
        this.stats.skippedLowConfidence++;
        continue;
      }

      // 去重
      const dedupeKey = `${item.type}:${item.domain}:${item.content.slice(0, 50)}`;
      if (this.seen.has(dedupeKey)) {
        this.stats.skippedDuplicate++;
        continue;
      }
      this.seen.add(dedupeKey);

      // 转换
      const relations = this.config.inferRelations
        ? this.inferRelations(item)
        : undefined;

      const sample = knowledgeToTrainingSample({
        pattern: item.content,
        entities: item.concepts,
        relations,
        label: this.inferLabel(item),
        suggestion: undefined,
      });

      samples.push(sample);
      this.stats.totalConverted++;
    }

    return samples;
  }

  /**
   * 单条转换
   */
  convertOne(knowledge: ExtractedKnowledgeLite): WorldModelTrainingSample | null {
    const results = this.convert([knowledge]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * 获取统计
   */
  getStats(): KnowledgeBridgeStats {
    return { ...this.stats };
  }

  /**
   * 清空去重缓存
   */
  clearSeen(): void {
    this.seen.clear();
  }

  // ==================== 内部方法 ====================

  /**
   * 从知识内容推断实体关系
   */
  private inferRelations(
    knowledge: ExtractedKnowledgeLite,
  ): Array<{ from: string; to: string; type: string }> | undefined {
    if (knowledge.concepts.length < 2) return undefined;

    const relations: Array<{ from: string; to: string; type: string }> = [];

    // 相邻概念建立 relates_to 关系
    for (let i = 0; i < knowledge.concepts.length - 1; i++) {
      relations.push({
        from: knowledge.concepts[i],
        to: knowledge.concepts[i + 1],
        type: 'relates_to',
      });
    }

    // 基于知识类型推断更强的关系
    if (knowledge.type === 'decision_rule' || knowledge.type === 'exception') {
      // 决策规则/例外 → requires 关系
      if (knowledge.concepts.length >= 2) {
        relations.push({
          from: knowledge.concepts[0],
          to: knowledge.concepts[1],
          type: 'requires',
        });
      }
    }

    return relations.length > 0 ? relations : undefined;
  }

  /**
   * 从知识推断标签
   */
  private inferLabel(
    knowledge: ExtractedKnowledgeLite,
  ): 'good' | 'bad' | 'neutral' {
    // 失败经验 → bad
    if (knowledge.type === 'failure_experience') return 'bad';
    // 风险判断 → bad (标记风险)
    if (knowledge.type === 'risk_judgment') return 'bad';
    // 高置信度 → good
    if (knowledge.confidence > 0.7) return 'good';
    return 'neutral';
  }

  /**
   * 限制去重缓存大小
   */
  private evictSeen(): void {
    if (this.seen.size > 1000) {
      const entries = [...this.seen];
      this.seen = new Set(entries.slice(-500));
    }
  }
}
