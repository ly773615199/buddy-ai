import * as fs from 'fs';
import * as path from 'path';

/**
 * I7a: 实体记忆存储 — 四层记忆网络的实体层
 *
 * 基于 Hindsight — Entity Summaries：
 * 从对话中提取实体（人名/项目名/技术栈），累积事实。
 *
 * 持久化：定期 JSON 快照写入磁盘，重启后自动恢复
 */

export interface EntitySummary {
  name: string;
  type: 'person' | 'project' | 'technology' | 'concept' | 'location' | 'organization';
  facts: string[];
  lastMentionedAt: number;
  mentionCount: number;
  sentiment: number;         // -1 到 1
}

const MAX_ENTITIES = 200;
const MAX_FACTS_PER_ENTITY = 20;

// 实体类型识别模式
const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: EntitySummary['type'] }> = [
  { pattern: /(?:React|Vue|Angular|Next\.?js|Nuxt|Svelte|TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|Swift|Kotlin)\b/i, type: 'technology' },
  { pattern: /(?:Docker|K8s|Kubernetes|AWS|Azure|GCP|Vercel|Netlify|GitHub|GitLab)\b/i, type: 'technology' },
  { pattern: /(?:API|SDK|SDK|REST|GraphQL|gRPC|WebSocket|HTTP|HTTPS)\b/i, type: 'concept' },
];

export class EntityStore {
  private entities = new Map<string, EntitySummary>();

  /**
   * 从对话内容中提取并更新实体
   */
  extractAndUpdate(content: string): EntitySummary[] {
    const extracted = this.extractEntities(content);
    const updated: EntitySummary[] = [];

    for (const { name, type } of extracted) {
      const key = name.toLowerCase();
      const existing = this.entities.get(key);

      if (existing) {
        existing.mentionCount++;
        existing.lastMentionedAt = Date.now();
        // 从新内容中提取事实
        const newFacts = this.extractFacts(content, name);
        for (const fact of newFacts) {
          if (!existing.facts.includes(fact) && existing.facts.length < MAX_FACTS_PER_ENTITY) {
            existing.facts.push(fact);
          }
        }
        updated.push(existing);
      } else {
        this.evictIfNeeded();
        const facts = this.extractFacts(content, name);
        const entity: EntitySummary = {
          name,
          type,
          facts,
          lastMentionedAt: Date.now(),
          mentionCount: 1,
          sentiment: 0,
        };
        this.entities.set(key, entity);
        updated.push(entity);
      }
    }

    return updated;
  }

  /**
   * 更新实体情感
   */
  updateSentiment(name: string, delta: number): void {
    const entity = this.entities.get(name.toLowerCase());
    if (entity) {
      entity.sentiment = Math.max(-1, Math.min(1, entity.sentiment + delta));
    }
  }

  /**
   * 查询实体
   */
  get(name: string): EntitySummary | undefined {
    return this.entities.get(name.toLowerCase());
  }

  /**
   * 模糊搜索实体
   */
  search(query: string): EntitySummary[] {
    const q = query.toLowerCase();
    return Array.from(this.entities.values())
      .filter(e => e.name.toLowerCase().includes(q) || e.facts.some(f => f.toLowerCase().includes(q)))
      .sort((a, b) => b.mentionCount - a.mentionCount);
  }

  /**
   * 获取所有实体（按提及次数排序）
   */
  getAll(limit = 50): EntitySummary[] {
    return Array.from(this.entities.values())
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, limit);
  }

  /**
   * 构建 prompt 注入
   */
  buildPromptInjection(entities: EntitySummary[]): string {
    if (entities.length === 0) return '';
    const parts = entities.slice(0, 10).map(e => {
      const facts = e.facts.slice(0, 3).join('; ');
      return `- **${e.name}** (${e.type}): ${facts}（提及 ${e.mentionCount} 次）`;
    });
    return '\n## 已知实体\n' + parts.join('\n');
  }

  get size(): number { return this.entities.size; }

  // ── 私有 ──

  private extractEntities(content: string): Array<{ name: string; type: EntitySummary['type'] }> {
    const results: Array<{ name: string; type: EntitySummary['type'] }> = [];
    const seen = new Set<string>();

    // 1. 技术栈匹配
    for (const { pattern, type } of ENTITY_PATTERNS) {
      const matches = content.match(new RegExp(pattern, 'gi')) ?? [];
      for (const m of matches) {
        const key = m.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name: m, type });
        }
      }
    }

    // 2. 引号中的名词
    const quoted = content.match(/["「『]([^"」』]{2,30})["」』]/g) ?? [];
    for (const q of quoted) {
      const name = q.slice(1, -1);
      const key = name.toLowerCase();
      if (!seen.has(key) && name.length >= 2) {
        seen.add(key);
        results.push({ name, type: 'concept' });
      }
    }

    // 3. 大写开头的英文名词（可能是项目名/人名）
    const capitalized = content.match(/\b[A-Z][a-z]{2,20}(?:\s[A-Z][a-z]{2,20})?\b/g) ?? [];
    const stopWords = new Set(['The', 'This', 'That', 'What', 'When', 'Where', 'How', 'Can', 'Could', 'Would', 'Should', 'Please', 'Help', 'Need', 'Want', 'Make']);
    for (const c of capitalized) {
      if (!stopWords.has(c) && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        results.push({ name: c, type: 'project' });
      }
    }

    return results.slice(0, 10); // 每次最多提取 10 个
  }

  private extractFacts(content: string, entityName: string): string[] {
    const facts: string[] = [];
    const sentences = content.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 5);

    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(entityName.toLowerCase())) {
        const fact = sentence.trim().slice(0, 100);
        if (fact.length > 5) facts.push(fact);
      }
    }

    return facts.slice(0, 5);
  }

  private evictIfNeeded(): void {
    if (this.entities.size < MAX_ENTITIES) return;
    // 淘汰最久未提及的
    let oldest: EntitySummary | null = null;
    for (const entity of this.entities.values()) {
      if (!oldest || entity.lastMentionedAt < oldest.lastMentionedAt) {
        oldest = entity;
      }
    }
    if (oldest) this.entities.delete(oldest.name.toLowerCase());
  }

  // ── 持久化 ──

  /** 保存到 JSON 快照 */
  saveToDisk(dataDir: string): void {
    try {
      const filePath = path.join(dataDir, 'entity-store.json');
      const data = JSON.stringify(Array.from(this.entities.entries()), null, 2);
      fs.writeFileSync(filePath, data, 'utf-8');
    } catch (err) {
      // 静默失败
    }
  }

  /** 从 JSON 快照恢复 */
  loadFromDisk(dataDir: string): void {
    try {
      const filePath = path.join(dataDir, 'entity-store.json');
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: [string, EntitySummary][] = JSON.parse(raw);
      this.entities.clear();
      for (const [key, entity] of entries) {
        this.entities.set(key, entity);
      }
    } catch (err) {
      // 静默失败，从空状态开始
    }
  }
}
