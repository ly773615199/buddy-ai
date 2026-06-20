/**
 * 经验图谱 — 存储 + 节点/边管理 + 路径查找
 *
 * 经验之间有 requires/enhances/alternative 关系，
 * 形成有向图。匹配时沿图导航找到最优经验链。
 *
 * v2: 持久化从 JSON 文件迁移到 SQLite，与项目其他模块一致
 */

import type { ExperienceUnit, ExperienceEdge, EdgeType } from './types.js';
import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

// ── Migrations ──
import { runMigrations, type Migration } from '../core/migration.js';

const EXP_GRAPH_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '经验图谱 SQLite 存储',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exp_nodes (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          keywords TEXT NOT NULL,
          patterns TEXT NOT NULL,
          context_tags TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exp_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_id TEXT NOT NULL,
          to_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 0.5,
          FOREIGN KEY(from_id) REFERENCES exp_nodes(id) ON DELETE CASCADE,
          FOREIGN KEY(to_id) REFERENCES exp_nodes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_exp_edges_from ON exp_edges(from_id);
        CREATE INDEX IF NOT EXISTS idx_exp_edges_to ON exp_edges(to_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_exp_edges_unique ON exp_edges(from_id, to_id, edge_type);
      `);
    },
  },
];

export class ExperienceGraph {
  private nodes = new Map<string, ExperienceUnit>();
  private edges: ExperienceEdge[] = [];
  private db: Database.Database | null = null;
  private dbPath: string;

  // ── P3: 倒排索引 + 预编译正则 ──
  private keywordIndex = new Map<string, Set<string>>();  // keyword → expId 集合
  private compiledPatterns = new Map<string, RegExp[]>();  // expId → 预编译 RegExp[]

  // ── 变更追踪（增量保存） ──
  private dirtyNodes = new Set<string>();
  private dirtyEdges = false;

  constructor(dataDir?: string) {
    this.dbPath = dataDir
      ? path.join(dataDir, 'experience-graph.db')
      : path.join(process.env.HOME ?? '/tmp', '.buddy', 'experience-graph.db');
  }

  // ── 节点操作 ──

  addNode(skill: ExperienceUnit): void {
    this.nodes.set(skill.id, skill);
    this.dirtyNodes.add(skill.id);
    this.buildIndexForNode(skill);
    // 立即持久化
    this._persistNode(skill);
  }

  getNode(id: string): ExperienceUnit | undefined {
    return this.nodes.get(id);
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    this.nodes.delete(id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
    this.removeFromIndex(id);
    // 立即持久化
    this._deleteNodeFromDB(id);
    return true;
  }

  getAllNodes(): ExperienceUnit[] {
    return Array.from(this.nodes.values());
  }

  get size(): number {
    return this.nodes.size;
  }

  // ── P3: 倒排索引构建 ──

  /** 为单个节点构建倒排索引 + 预编译正则 */
  private buildIndexForNode(skill: ExperienceUnit): void {
    // 关键词倒排
    for (const kw of skill.trigger.keywords) {
      const key = kw.toLowerCase();
      if (!this.keywordIndex.has(key)) this.keywordIndex.set(key, new Set());
      this.keywordIndex.get(key)!.add(skill.id);
    }
    // 上下文标签也加入倒排索引（用于 contextTag 匹配）
    for (const tag of skill.trigger.contextTags) {
      const key = tag.toLowerCase();
      if (!this.keywordIndex.has(key)) this.keywordIndex.set(key, new Set());
      this.keywordIndex.get(key)!.add(skill.id);
    }
    // 预编译正则（只编译一次，避免每次 match 重复 new RegExp）
    const patterns = skill.trigger.patterns
      .map(p => { try { return new RegExp(p, 'i'); } catch { return null; } })
      .filter(Boolean) as RegExp[];
    this.compiledPatterns.set(skill.id, patterns);
  }

  /** 从倒排索引中移除节点 */
  private removeFromIndex(id: string): void {
    for (const [kw, ids] of this.keywordIndex) {
      ids.delete(id);
      if (ids.size === 0) this.keywordIndex.delete(kw);
    }
    this.compiledPatterns.delete(id);
  }

  /** 重建全部索引（用于从数据库加载后） */
  private rebuildIndex(): void {
    this.keywordIndex.clear();
    this.compiledPatterns.clear();
    for (const skill of this.nodes.values()) {
      this.buildIndexForNode(skill);
    }
  }

  // ── 边操作 ──

  addEdge(from: string, to: string, type: EdgeType, weight = 0.5): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return;
    // 避免重复边
    const existing = this.edges.find(e => e.from === from && e.to === to && e.type === type);
    if (existing) {
      existing.weight = Math.min(1, existing.weight + 0.1);
      this._persistEdge(from, to, type, existing.weight);
      return;
    }
    this.edges.push({ from, to, type, weight });
    this._persistEdge(from, to, type, weight);
  }

  getEdges(nodeId: string): ExperienceEdge[] {
    return this.edges.filter(e => e.from === nodeId || e.to === nodeId);
  }

  getSuccessors(nodeId: string): Array<{ node: ExperienceUnit; edge: ExperienceEdge }> {
    return this.edges
      .filter(e => e.from === nodeId)
      .map(e => ({ node: this.nodes.get(e.to)!, edge: e }))
      .filter(x => x.node);
  }

  getPredecessors(nodeId: string): Array<{ node: ExperienceUnit; edge: ExperienceEdge }> {
    return this.edges
      .filter(e => e.to === nodeId)
      .map(e => ({ node: this.nodes.get(e.from)!, edge: e }))
      .filter(x => x.node);
  }

  // ── 匹配（P3: 倒排索引 + 预编译正则优化）──

  match(input: string, contextTags: string[] = []): ExperienceUnit[] {
    const inputLower = input.toLowerCase();
    const inputTokens = inputLower.split(/[^\w\u4e00-\u9fff]+/).filter(t => t.length >= 2);

    // 1. 倒排索引快速筛选候选（O(候选) 替代 O(n) 全量遍历）
    const candidateIds = new Set<string>();
    for (const token of inputTokens) {
      const ids = this.keywordIndex.get(token);
      if (ids) for (const id of ids) candidateIds.add(id);
    }

    // 1b. 子串匹配：处理多词关键词（如 'git push' 包含 token 'push'）
    //     单字符关键词跳过子串匹配，避免性能退化和误匹配
    for (const [kw, ids] of this.keywordIndex) {
      if (kw.length <= 1) continue;
      if (inputLower.includes(kw)) {
        for (const id of ids) candidateIds.add(id);
      }
    }

    // 1c. 模式匹配：预编译正则对原始输入做匹配
    for (const [id, patterns] of this.compiledPatterns) {
      if (patterns.length > 0 && patterns.some(re => re.test(input))) {
        candidateIds.add(id);
      }
    }

    // 2. 只对候选节点做精确匹配
    const results: Array<{ skill: ExperienceUnit; score: number }> = [];
    for (const id of candidateIds) {
      const skill = this.nodes.get(id);
      if (!skill) continue;
      let score = 0;

      // 关键词匹配
      for (const kw of skill.trigger.keywords) {
        if (inputLower.includes(kw.toLowerCase())) score += 2;
      }

      // 预编译正则匹配（不再每次 new RegExp）
      const patterns = this.compiledPatterns.get(id) ?? [];
      for (const re of patterns) {
        if (re.test(input)) score += 3;
      }

      // 上下文标签匹配
      for (const tag of skill.trigger.contextTags) {
        if (contextTags.includes(tag)) score += 1;
      }

      // 置信度加权
      score *= (0.5 + skill.stats.confidence * 0.5);

      if (score > 0) {
        results.push({ skill, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.skill);
  }

  // ── 图谱路径查找 ──

  findPath(fromId: string, toId: string, maxDepth = 4): ExperienceUnit[] | null {
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];

    while (queue.length > 0) {
      const { id, path: currentPath } = queue.shift()!;
      if (id === toId) {
        return currentPath.map(pid => this.nodes.get(pid)!).filter(Boolean);
      }
      if (visited.has(id) || currentPath.length > maxDepth) continue;
      visited.add(id);

      for (const { node } of this.getSuccessors(id)) {
        if (!visited.has(node.id)) {
          queue.push({ id: node.id, path: [...currentPath, node.id] });
        }
      }
    }
    return null;
  }

  // ── 自动发现边关系 ──

  discoverEdges(): number {
    let discovered = 0;
    const skills = this.getAllNodes();

    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const a = skills[i];
        const b = skills[j];

        // 共享关键词 → enhances
        const sharedKw = a.trigger.keywords.filter(k =>
          b.trigger.keywords.some(bk => bk.toLowerCase() === k.toLowerCase())
        );
        if (sharedKw.length >= 2) {
          this.addEdge(a.id, b.id, 'enhances', sharedKw.length * 0.15);
          this.addEdge(b.id, a.id, 'enhances', sharedKw.length * 0.15);
          discovered++;
        }

        // 同意图不同实现 → alternative
        if (a.trigger.intent === b.trigger.intent && a.id !== b.id) {
          this.addEdge(a.id, b.id, 'alternative', 0.3);
          discovered++;
        }

        // 一个技能的输出是另一个的输入 → requires
        for (const step of a.steps) {
          if (step.outputVar && b.steps.some(bs => bs.condition === step.outputVar)) {
            this.addEdge(b.id, a.id, 'requires', 0.8);
            discovered++;
          }
        }
      }
    }
    return discovered;
  }

  // ── 查找相似技能 ──

  findSimilar(threshold = 0.6): ExperienceUnit[][] {
    const skills = this.getAllNodes();
    const groups: ExperienceUnit[][] = [];
    const visited = new Set<string>();

    for (const skill of skills) {
      if (visited.has(skill.id)) continue;
      const group: ExperienceUnit[] = [skill];
      visited.add(skill.id);

      for (const other of skills) {
        if (visited.has(other.id)) continue;
        const similarity = this.calcSimilarity(skill, other);
        if (similarity >= threshold) {
          group.push(other);
          visited.add(other.id);
        }
      }

      if (group.length > 1) groups.push(group);
    }
    return groups;
  }

  private calcSimilarity(a: ExperienceUnit, b: ExperienceUnit): number {
    const kwA = new Set(a.trigger.keywords.map(k => k.toLowerCase()));
    const kwB = new Set(b.trigger.keywords.map(k => k.toLowerCase()));
    const intersection = [...kwA].filter(k => kwB.has(k)).length;
    const union = new Set([...kwA, ...kwB]).size;
    if (union === 0) return 0;

    let keywordScore = intersection / union;
    if (a.trigger.intent === b.trigger.intent) keywordScore += 0.2;

    // 语义相似度（使用 ByteEncoder）
    let semanticScore = 0;
    try {
      // 懒加载 TextEncoder 单例
      const { getGlobalTextEncoder } = require('../brain/right/features/text-encoder-singleton.js');
      const encoder = getGlobalTextEncoder();
      const textA = `${a.name} ${a.trigger.keywords.join(' ')} ${a.trigger.intent}`;
      const textB = `${b.name} ${b.trigger.keywords.join(' ')} ${b.trigger.intent}`;
      const vecA = encoder.forwardPooled(textA);
      const vecB = encoder.forwardPooled(textB);
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < vecA.data.length; i++) {
        dot += vecA.data[i] * vecB.data[i];
        na += vecA.data[i] * vecA.data[i];
        nb += vecB.data[i] * vecB.data[i];
      }
      semanticScore = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    } catch { /* 降级到纯关键词 */ }

    // 融合：关键词(0.4) + 语义(0.6)
    return Math.min(1, keywordScore * 0.4 + semanticScore * 0.6);
  }

  // ── 序列化（SQLite） ──

  async save(): Promise<void> {
    // SQLite 已在 addNode/addEdge 时增量写入
    // 此方法仅用于兼容接口
  }

  async load(): Promise<void> {
    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });

    // 初始化数据库
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'experience_graph', EXP_GRAPH_MIGRATIONS);

    // 尝试从旧 JSON 文件迁移
    await this._migrateFromJsonIfNeeded();

    // 从 SQLite 加载节点
    this._loadAllNodes();

    // 从 SQLite 加载边
    this._loadAllEdges();

    // 重建倒排索引
    this.rebuildIndex();
  }

  // ── SQLite 内部方法 ──

  private _ensureDB(): Database.Database {
    if (!this.db) {
      // 懒初始化：如果 load() 未调用，自动创建内存数据库
      const dir = path.dirname(this.dbPath);
      try { fsSync.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      runMigrations(this.db, 'experience_graph', EXP_GRAPH_MIGRATIONS);
    }
    return this.db;
  }

  private _persistNode(skill: ExperienceUnit): void {
    const db = this._ensureDB();
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO exp_nodes (id, data, keywords, patterns, context_tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      skill.id,
      JSON.stringify(skill),
      skill.trigger.keywords.join(','),
      JSON.stringify(skill.trigger.patterns),
      skill.trigger.contextTags.join(','),
      now,
      now,
    );
  }

  private _deleteNodeFromDB(id: string): void {
    const db = this._ensureDB();
    db.prepare('DELETE FROM exp_nodes WHERE id = ?').run(id);
    db.prepare('DELETE FROM exp_edges WHERE from_id = ? OR to_id = ?').run(id, id);
  }

  private _persistEdge(from: string, to: string, type: EdgeType, weight: number): void {
    const db = this._ensureDB();
    db.prepare(`
      INSERT OR REPLACE INTO exp_edges (from_id, to_id, edge_type, weight)
      VALUES (?, ?, ?, ?)
    `).run(from, to, type, weight);
  }

  private _loadAllNodes(): void {
    const db = this._ensureDB();
    const rows = db.prepare('SELECT data FROM exp_nodes').all() as { data: string }[];
    for (const row of rows) {
      try {
        const skill = JSON.parse(row.data) as ExperienceUnit;
        this.nodes.set(skill.id, skill);
      } catch { /* skip corrupted */ }
    }
  }

  private _loadAllEdges(): void {
    const db = this._ensureDB();
    const rows = db.prepare('SELECT from_id, to_id, edge_type, weight FROM exp_edges').all() as Array<{
      from_id: string; to_id: string; edge_type: string; weight: number;
    }>;
    this.edges = rows.map(r => ({
      from: r.from_id,
      to: r.to_id,
      type: r.edge_type as EdgeType,
      weight: r.weight,
    }));
  }

  /** 从旧 JSON 文件迁移到 SQLite（一次性） */
  private async _migrateFromJsonIfNeeded(): Promise<void> {
    const db = this._ensureDB();
    // 检查是否已有数据
    const count = (db.prepare('SELECT COUNT(*) as c FROM exp_nodes').get() as { c: number }).c;
    if (count > 0) return; // 已有数据，跳过迁移

    // 尝试读取旧 JSON 文件
    const jsonPath = this.dbPath.replace(/\.db$/, '.json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const data = JSON.parse(raw);
      const oldNodes: [string, ExperienceUnit][] = data.nodes ?? [];
      const oldEdges: ExperienceEdge[] = data.edges ?? [];

      if (oldNodes.length === 0) return;

      // 迁移节点
      const insertNode = db.prepare(`
        INSERT OR IGNORE INTO exp_nodes (id, data, keywords, patterns, context_tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertEdge = db.prepare(`
        INSERT OR IGNORE INTO exp_edges (from_id, to_id, edge_type, weight)
        VALUES (?, ?, ?, ?)
      `);

      const migrate = db.transaction(() => {
        for (const [id, skill] of oldNodes) {
          const now = Date.now();
          insertNode.run(
            id,
            JSON.stringify(skill),
            skill.trigger.keywords.join(','),
            JSON.stringify(skill.trigger.patterns),
            skill.trigger.contextTags.join(','),
            now,
            now,
          );
        }
        for (const edge of oldEdges) {
          insertEdge.run(edge.from, edge.to, edge.type, edge.weight);
        }
      });
      migrate();

      // 重命名旧文件为 .bak
      await fs.rename(jsonPath, jsonPath + '.bak');
      console.log(`[ExperienceGraph] 已从 JSON 迁移到 SQLite: ${oldNodes.length} 节点, ${oldEdges.length} 边`);
    } catch {
      // 旧文件不存在，正常启动
    }
  }

  // ── 统计 ──

  stats(): { nodes: number; edges: number; avgConfidence: number; highConfidence: number } {
    const all = this.getAllNodes();
    const avgConf = all.length > 0
      ? all.reduce((s, n) => s + n.stats.confidence, 0) / all.length
      : 0;
    return {
      nodes: this.nodes.size,
      edges: this.edges.length,
      avgConfidence: Math.round(avgConf * 100) / 100,
      highConfidence: all.filter(n => n.stats.confidence >= 0.8).length,
    };
  }
}
