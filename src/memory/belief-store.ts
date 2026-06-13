import * as fs from 'fs';
import * as path from 'path';

/**
 * I7b: 信念存储 — 四层记忆网络的信念层
 *
 * 基于 Hindsight — Evolving Beliefs：
 * 从对话中产生推断，多次验证提升置信度，矛盾时降低。
 *
 * 持久化：定期 JSON 快照写入磁盘，重启后自动恢复
 */

export interface Belief {
  id: string;
  statement: string;           // 信念陈述
  confidence: number;          // 置信度 0-1
  evidence: string[];          // 支撑证据
  contradictedBy: string[];    // 反驳证据
  updatedAt: number;
  source: 'inferred' | 'told' | 'observed';
}

const MAX_BELIEFS = 100;
const MAX_EVIDENCE = 10;

export class BeliefStore {
  private beliefs = new Map<string, Belief>();

  /**
   * 记录一个新信念（低初始置信度）
   */
  addBelief(statement: string, source: Belief['source'] = 'inferred'): Belief {
    const id = this.normalize(statement);
    const existing = this.beliefs.get(id);

    if (existing) {
      // 已存在，增加一条支撑证据
      existing.confidence = Math.min(0.99, existing.confidence + 0.1);
      existing.updatedAt = Date.now();
      return existing;
    }

    this.evictIfNeeded();

    const initialConfidence = source === 'told' ? 0.7 : source === 'observed' ? 0.5 : 0.3;
    const belief: Belief = {
      id,
      statement,
      confidence: initialConfidence,
      evidence: [],
      contradictedBy: [],
      updatedAt: Date.now(),
      source,
    };
    this.beliefs.set(id, belief);
    return belief;
  }

  /**
   * 添加支撑证据
   */
  addEvidence(statement: string, evidence: string): void {
    const id = this.normalize(statement);
    const belief = this.beliefs.get(id);
    if (!belief) return;

    if (belief.evidence.length < MAX_EVIDENCE && !belief.evidence.includes(evidence)) {
      belief.evidence.push(evidence);
    }
    belief.confidence = Math.min(0.99, belief.confidence + 0.05);
    belief.updatedAt = Date.now();
  }

  /**
   * 添加反驳证据
   */
  addContradiction(statement: string, contradiction: string): void {
    const id = this.normalize(statement);
    const belief = this.beliefs.get(id);
    if (!belief) return;

    if (!belief.contradictedBy.includes(contradiction)) {
      belief.contradictedBy.push(contradiction);
    }
    belief.confidence = Math.max(0.01, belief.confidence - 0.15);
    belief.updatedAt = Date.now();

    // 置信度太低，标记为不可靠
    if (belief.confidence < 0.1) {
      this.beliefs.delete(id);
    }
  }

  /**
   * 检索相关信念
   */
  retrieve(query: string): Belief[] {
    const q = query.toLowerCase();
    const tokens = q.split(/[^\w\u4e00-\u9fff]+/).filter(t => t.length >= 2);

    return Array.from(this.beliefs.values())
      .filter(b => {
        const s = b.statement.toLowerCase();
        return tokens.some(t => s.includes(t)) || s.includes(q);
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * 构建 prompt 注入
   */
  buildPromptInjection(beliefs: Belief[]): string {
    if (beliefs.length === 0) return '';
    const parts = beliefs
      .filter(b => b.confidence > 0.3)
      .map(b => `- ${b.statement}（置信度 ${Math.round(b.confidence * 100)}%）`);
    if (parts.length === 0) return '';
    return '\n## 已知信念\n' + parts.join('\n');
  }

  get size(): number { return this.beliefs.size; }

  /** 获取所有信念（分页） */
  getAll(limit = 20): Belief[] {
    return Array.from(this.beliefs.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  // ── 私有 ──

  private normalize(statement: string): string {
    return statement.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 80);
  }

  private evictIfNeeded(): void {
    if (this.beliefs.size < MAX_BELIEFS) return;
    // 淘汰最低置信度
    let worst: Belief | null = null;
    for (const b of this.beliefs.values()) {
      if (!worst || b.confidence < worst.confidence) {
        worst = b;
      }
    }
    if (worst) this.beliefs.delete(worst.id);
  }

  // ── 持久化 ──

  /** 保存到 JSON 快照 */
  saveToDisk(dataDir: string): void {
    try {
      const filePath = path.join(dataDir, 'belief-store.json');
      const data = JSON.stringify(Array.from(this.beliefs.entries()), null, 2);
      fs.writeFileSync(filePath, data, 'utf-8');
    } catch (err) {
      // 静默失败
    }
  }

  /** 从 JSON 快照恢复 */
  loadFromDisk(dataDir: string): void {
    try {
      const filePath = path.join(dataDir, 'belief-store.json');
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: [string, Belief][] = JSON.parse(raw);
      this.beliefs.clear();
      for (const [key, belief] of entries) {
        this.beliefs.set(key, belief);
      }
    } catch (err) {
      // 静默失败，从空状态开始
    }
  }
}
