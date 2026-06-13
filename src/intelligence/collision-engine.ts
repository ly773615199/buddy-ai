/**
 * 碰撞引擎 — 候选方案工厂
 *
 * 三种碰撞策略（基于向量相似度）：
 * - fuse (sim > 0.85): 相似知识去重合并
 * - emerge (sim < 0.3): 差异知识涌现新组合
 * - scatter (0.3 ≤ sim ≤ 0.85): 中等相似度，互补拼接
 *
 * 优先跨来源碰撞（跨来源知识更可能产生有价值的组合）
 */

// ==================== 类型定义 ====================

export interface CollisionNode {
  id: string;
  content: string;
  vector: Float32Array;
  source: string;           // 来源: 'local' | 'web' | 'feishu' | 'experience' | 'stmp' | 'ternary' | 'tool' | 'conversation'
  score: number;            // 相关性得分 0-1
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface CollisionResult {
  id: string;
  content: string;          // 融合/涌现/互补后的文本
  sources: string[];         // 参与碰撞的来源
  strategy: 'fuse' | 'emerge' | 'scatter';
  novelty: number;           // 新颖度 0-1
  confidence: number;        // 置信度 0-1
  reasoning: string;         // 碰撞理由
  concepts: string[];        // 关联概念
}

export type EditIntent = 'synthesize' | 'compare' | 'explain' | 'execute' | 'report' | 'chat';

export interface EditResult {
  edited: CollisionResult[];
  intent: EditIntent;
  explanation: string;
}

// ==================== CollisionEngine ====================

export class CollisionEngine {
  /**
   * 碰撞主入口
   *
   * @param nodes 汇聚的知识节点（来自所有来源）
   * @param inputVector 输入的向量
   * @param temperature 碰撞温度（越高越激进）
   */
  collide(nodes: CollisionNode[], inputVector: Float32Array,
          temperature: number = 0.5): CollisionResult[] {
    if (nodes.length < 2) return [];

    const results: CollisionResult[] = [];

    // 生成碰撞对（优先跨来源碰撞）
    const pairs = this.generateCollisionPairs(nodes, temperature);

    for (const [a, b] of pairs) {
      const sim = this.cosineSim(a.vector, b.vector);

      if (sim > 0.85) {
        results.push(this.fuse(a, b));
      } else if (sim < 0.3) {
        results.push(this.emerge(a, b, inputVector, temperature));
      } else {
        results.push(this.scatter(a, b, inputVector, temperature));
      }
    }

    // 跨来源碰撞加权（优先保留跨来源的结果）
    results.sort((a, b) => {
      const crossA = a.sources.length > 1 ? 1.5 : 1.0;
      const crossB = b.sources.length > 1 ? 1.5 : 1.0;
      return (b.novelty * crossB) - (a.novelty * crossA);
    });

    return results;
  }

  /**
   * 编辑入口 — 按意图选择碰撞策略
   */
  edit(nodes: CollisionNode[], intent: EditIntent, inputVector?: Float32Array): EditResult {
    const vec = inputVector ?? new Float32Array(128);
    const temperature = intent === 'synthesize' ? 0.3 : intent === 'compare' ? 0.5 : 0.7;

    let edited = this.collide(nodes, vec, temperature);

    // 按意图过滤
    if (intent === 'compare') {
      // 对比：保留冲突/互补，去掉合并
      edited = edited.filter(r => r.strategy !== 'fuse');
    } else if (intent === 'execute') {
      // 执行：只保留高置信度
      edited = edited.filter(r => r.confidence > 0.5);
    }

    return {
      edited,
      intent,
      explanation: `${intent} 模式: ${edited.length} 个碰撞结果 (来源: ${[...new Set(nodes.map(n => n.source))].join('+')})`,
    };
  }

  /**
   * 生成碰撞对 — 优先跨来源碰撞
   */
  private generateCollisionPairs(
    nodes: CollisionNode[], temperature: number
  ): Array<[CollisionNode, CollisionNode]> {
    const pairs: Array<[CollisionNode, CollisionNode]> = [];
    const maxPairs = Math.min(15, Math.ceil(nodes.length * (1 + temperature)));

    // 优先：跨来源对
    for (let i = 0; i < nodes.length && pairs.length < maxPairs; i++) {
      for (let j = i + 1; j < nodes.length && pairs.length < maxPairs; j++) {
        if (nodes[i].source !== nodes[j].source) {
          pairs.push([nodes[i], nodes[j]]);
        }
      }
    }

    // 补充：同来源对（如果跨来源对不够）
    for (let i = 0; i < nodes.length && pairs.length < maxPairs; i++) {
      for (let j = i + 1; j < nodes.length && pairs.length < maxPairs; j++) {
        if (nodes[i].source === nodes[j].source) {
          pairs.push([nodes[i], nodes[j]]);
        }
      }
    }

    return pairs;
  }

  /**
   * 融合 — 相似知识去重合并 (sim > 0.85)
   */
  private fuse(a: CollisionNode, b: CollisionNode): CollisionResult {
    // 取更长的作为基础，补充另一个的独特信息
    const base = a.content.length >= b.content.length ? a : b;
    const other = base === a ? b : a;

    return {
      id: `fuse-${a.id}-${b.id}`,
      content: base.content,
      sources: [...new Set([a.source, b.source])],
      strategy: 'fuse',
      novelty: 0.2,
      confidence: Math.max(a.score, b.score),
      reasoning: `相似知识合并: ${a.source} + ${b.source}`,
      concepts: [],
    };
  }

  /**
   * 涌现 — 差异知识产生新组合 (sim < 0.3)
   */
  private emerge(a: CollisionNode, b: CollisionNode, inputVector: Float32Array, temperature: number): CollisionResult {
    // 差异大的知识组合可能产生新见解
    const relevanceA = this.cosineSim(a.vector, inputVector);
    const relevanceB = this.cosineSim(b.vector, inputVector);

    // 更相关的放前面
    const [first, second] = relevanceA >= relevanceB ? [a, b] : [b, a];

    return {
      id: `emerge-${a.id}-${b.id}`,
      content: `${first.content}\n\n参考补充（${second.source}）: ${second.content}`,
      sources: [...new Set([a.source, b.source])],
      strategy: 'emerge',
      novelty: 0.8 * temperature,
      confidence: (relevanceA + relevanceB) / 2,
      reasoning: `跨来源涌现: ${a.source} × ${b.source} (差异大，组合新颖)`,
      concepts: [],
    };
  }

  /**
   * 互补 — 中等相似度，拼接完整画面 (0.3 ≤ sim ≤ 0.85)
   */
  private scatter(a: CollisionNode, b: CollisionNode, inputVector: Float32Array, temperature: number): CollisionResult {
    const relevanceA = this.cosineSim(a.vector, inputVector);
    const relevanceB = this.cosineSim(b.vector, inputVector);

    const [first, second] = relevanceA >= relevanceB ? [a, b] : [b, a];

    return {
      id: `scatter-${a.id}-${b.id}`,
      content: `${first.content}\n\n补充信息: ${second.content}`,
      sources: [...new Set([a.source, b.source])],
      strategy: 'scatter',
      novelty: 0.5,
      confidence: (a.score + b.score) / 2,
      reasoning: `互补拼接: ${a.source} + ${b.source}`,
      concepts: [],
    };
  }

  /**
   * 余弦相似度
   */
  private cosineSim(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * 冲突检测：不同来源对同一话题给出矛盾信息
   *
   * 基于向量相似度 + 来源差异判断：
   * - 内容相似但来源不同 → 可能冲突
   * - 用关键词检测显式矛盾词
   */
  detectConflicts(nodes: CollisionNode[]): Array<{
    nodeA: CollisionNode;
    nodeB: CollisionNode;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }> {
    const conflicts: Array<{ nodeA: CollisionNode; nodeB: CollisionNode; reason: string; severity: 'low' | 'medium' | 'high' }> = [];
    const conflictKeywords = ['不是', '不对', '错误', '实际上', '相反', '然而', '但是', '不同', '矛盾',
      'not', 'incorrect', 'actually', 'however', 'but', 'different', 'contradict'];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        if (a.source === b.source) continue; // 同源不检查冲突

        const sim = this.cosineSim(a.vector, b.vector);
        if (sim > 0.6) {
          // 内容相似但来源不同 → 检查是否有矛盾词
          const combined = (a.content + b.content).toLowerCase();
          const hasConflictWord = conflictKeywords.some(kw => combined.includes(kw));

          if (hasConflictWord) {
            conflicts.push({
              nodeA: a, nodeB: b,
              reason: `${a.source} 与 ${b.source} 对相似话题可能有矛盾`,
              severity: sim > 0.8 ? 'high' : 'medium',
            });
          } else if (sim > 0.85) {
            // 高度相似但不同来源 → 低严重度冲突（可能是重复信息）
            conflicts.push({
              nodeA: a, nodeB: b,
              reason: `${a.source} 与 ${b.source} 高度重复`,
              severity: 'low',
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * 按与输入的相关性排序
   */
  rankByRelevance(nodes: CollisionNode[], inputVector: Float32Array): CollisionNode[] {
    if (inputVector.length === 0 || inputVector.every(v => v === 0)) {
      return [...nodes].sort((a, b) => b.score - a.score);
    }

    const sim = this.cosineSim.bind(this);
    return [...nodes].sort((a, b) => {
      const simA = sim(a.vector, inputVector);
      const simB = sim(b.vector, inputVector);
      const scoreA = a.score * 0.4 + simA * 0.6;
      const scoreB = b.score * 0.4 + simB * 0.6;
      return scoreB - scoreA;
    });
  }

  /**
   * 按与输入的相关性排序 CollisionResult
   */
  rankResultsByRelevance(results: CollisionResult[], inputVector: Float32Array): CollisionResult[] {
    if (inputVector.length === 0 || inputVector.every(v => v === 0)) {
      return [...results].sort((a, b) => b.confidence - a.confidence);
    }

    // 用 novelty + confidence 作为相关性代理（CollisionResult 没有 vector）
    return [...results].sort((a, b) => {
      const scoreA = a.confidence * 0.5 + a.novelty * 0.3 + (a.sources.length > 1 ? 0.2 : 0);
      const scoreB = b.confidence * 0.5 + b.novelty * 0.3 + (b.sources.length > 1 ? 0.2 : 0);
      return scoreB - scoreA;
    });
  }

  /**
   * 完整编辑流程：碰撞 → 冲突检测 → 排序
   */
  fullEdit(nodes: CollisionNode[], intent: EditIntent, inputVector?: Float32Array): EditResult & { conflicts: Array<{ nodeA: CollisionNode; nodeB: CollisionNode; reason: string; severity: 'low' | 'medium' | 'high' }> } {
    const vec = inputVector ?? new Float32Array(128);

    // 1. 碰撞/融合/涌现
    const editResult = this.edit(nodes, intent, vec);

    // 2. 冲突检测
    const conflicts = this.detectConflicts(nodes);

    // 3. 按相关性排序
    editResult.edited = this.rankResultsByRelevance(editResult.edited, vec);

    return { ...editResult, conflicts };
  }
}
