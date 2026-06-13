/**
 * STMP — 时空记忆宫殿 (Spatial-Temporal Memory Palace)
 *
 * 不是向量搜索，而是房间 + 时间轴 + 语义星图的四步导航检索。
 * 记忆不是靠相似度捞出来的，而是靠位置关系"走"出来的。
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, type Migration } from '../core/migration.js';

// ==================== 数据结构 ====================

export interface Room {
  id: string;
  name: string;
  description: string;
  tags: string[];           // 关联关键词，用于定位
  createdAt: number;
  lastAccessed: number;
  memoryCount: number;
  isDefault: boolean;
}

export interface MemoryNode {
  id: string;
  content: string;
  room: string;             // 所属房间 ID

  // 时间坐标
  timestamp: number;
  temporalContext: {
    before: string[];       // 前序记忆 ID
    after: string[];        // 后续记忆 ID
    duration?: number;      // 持续事件时长 ms
  };

  // 语义坐标
  concepts: string[];       // 关联概念标签
  relations: Array<{
    target: string;         // 目标记忆 ID 或概念
    type: 'causes' | 'follows' | 'contradicts' | 'supports' | 'is_example_of' | 'relates_to';
    strength: number;       // 0-1
  }>;

  // 情绪/重要度
  emotional: {
    valence: number;        // -1 到 1
    importance: number;     // 1-10
    userMarked?: 'important' | 'interesting' | 'todo' | 'resolved';
  };

  // 生命周期
  lifecycle: {
    createdAt: number;
    lastAccessed: number;
    accessCount: number;
    decay: number;          // 0-1
    compressed: boolean;
    hibernated: boolean;
  };

  // 元数据
  source: 'conversation' | 'learned' | 'observed' | 'dream' | 'extracted';
  sessionId?: string;
}

export interface ConstellationEdge {
  id: string;
  sourceConcept: string;
  targetConcept: string;
  weight: number;           // 共现频率 / 关联度
  roomIds: string[];        // 跨房间关联
  lastUpdated: number;
}

export interface STMPResult {
  primary: MemoryNode[];      // 定位 + 时间导航找到的记忆
  associative: MemoryNode[];  // 语义星图扩展找到的记忆
  narrative: string;          // LLM 组装的叙事（暂由原始拼接替代）
  room: Room | null;          // 所在房间
}

// SQLite 行类型
interface RoomRow {
  id: string; name: string; description: string; tags: string;
  created_at: number; last_accessed: number; memory_count: number; is_default: number;
}

interface NodeRow {
  id: string; content: string; room: string; timestamp: number;
  temporal_before: string; temporal_after: string; temporal_duration: number | null;
  concepts: string; relations: string;
  valence: number; importance: number; user_marked: string | null;
  created_at: number; last_accessed: number; access_count: number;
  decay: number; compressed: number; hibernated: number;
  source: string; session_id: string | null;
}

interface EdgeRow {
  id: string; source_concept: string; target_concept: string;
  weight: number; room_ids: string; last_updated: number;
}

interface CountRow { c: number }
interface RoomIdRow { room: string; cnt: number }
interface TemporalRow { id: string }
interface DomainStatRow { roomId: string; roomName: string; totalNodes: number; extractedNodes: number }

// ==================== STMP 存储引擎 ====================

export class STMPStore {
  private db: Database.Database;
  private llmCaller?: (prompt: string) => Promise<string>;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
    runMigrations(this.db, 'stmp', STMP_MIGRATIONS);
  }

  private init(): void {
    // 房间表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stmp_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        memory_count INTEGER DEFAULT 0,
        is_default INTEGER DEFAULT 0
      );
    `);

    // 记忆节点表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stmp_nodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        room TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        temporal_before TEXT DEFAULT '[]',
        temporal_after TEXT DEFAULT '[]',
        temporal_duration INTEGER,
        concepts TEXT DEFAULT '[]',
        relations TEXT DEFAULT '[]',
        valence REAL DEFAULT 0,
        importance INTEGER DEFAULT 5,
        user_marked TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        decay REAL DEFAULT 1.0,
        compressed INTEGER DEFAULT 0,
        hibernated INTEGER DEFAULT 0,
        source TEXT DEFAULT 'conversation',
        session_id TEXT,
        FOREIGN KEY (room) REFERENCES stmp_rooms(id)
      );
    `);

    // 语义星图边表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stmp_edges (
        id TEXT PRIMARY KEY,
        source_concept TEXT NOT NULL,
        target_concept TEXT NOT NULL,
        weight REAL DEFAULT 0.5,
        room_ids TEXT DEFAULT '[]',
        last_updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON stmp_edges(source_concept);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON stmp_edges(target_concept);
    `);

    // FTS5 搜索索引
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS stmp_nodes_fts USING fts5(
        content, concepts, content='stmp_nodes', content_rowid='rowid'
      );
    `);

    // 创建默认房间
    const defaultRoom = this.db.prepare('SELECT id FROM stmp_rooms WHERE is_default = 1').get();
    if (!defaultRoom) {
      this.createRoom('default', '默认房间', ['通用', '聊天'], true);
    }
  }

  /** 设置 LLM 调用器（用于叙事组装） */
  setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    this.llmCaller = caller;
  }

  // ==================== 房间管理 ====================

  createRoom(id: string, name: string, tags: string[] = [], isDefault = false): Room {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO stmp_rooms (id, name, description, tags, created_at, last_accessed, is_default)
      VALUES (?, ?, '', ?, ?, ?, ?)
    `).run(id, name, JSON.stringify(tags), now, now, isDefault ? 1 : 0);

    return { id, name, description: '', tags, createdAt: now, lastAccessed: now, memoryCount: 0, isDefault };
  }

  getRoom(id: string): Room | null {
    const row = this.db.prepare('SELECT * FROM stmp_rooms WHERE id = ?').get(id) as RoomRow | undefined;
    if (!row) return null;
    return this.rowToRoom(row);
  }

  listRooms(): Room[] {
    const rows = this.db.prepare('SELECT * FROM stmp_rooms ORDER BY last_accessed DESC').all() as RoomRow[];
    return rows.map(r => this.rowToRoom(r));
  }

  touchRoom(id: string): void {
    this.db.prepare('UPDATE stmp_rooms SET last_accessed = ?, memory_count = memory_count + 1 WHERE id = ?')
      .run(Date.now(), id);
  }

  /** 根据关键词/实体定位房间 */
  locateRoom(query: string): Room | null {
    const lower = query.toLowerCase();
    const rooms = this.listRooms();

    // 精确标签匹配
    for (const room of rooms) {
      for (const tag of room.tags) {
        if (lower.includes(tag.toLowerCase())) {
          return room;
        }
      }
    }

    // 名称匹配
    for (const room of rooms) {
      if (lower.includes(room.name.toLowerCase())) {
        return room;
      }
    }

    // FTS5 全文搜索找最相关房间
    try {
      const safeQuery = this.fts5Escape(query);
      if (safeQuery) {
        const result = this.db.prepare(`
          SELECT room, COUNT(*) as cnt FROM stmp_nodes_fts fts
          JOIN stmp_nodes n ON n.rowid = fts.rowid
          WHERE stmp_nodes_fts MATCH ?
          GROUP BY room ORDER BY cnt DESC LIMIT 1
        `).get(safeQuery) as RoomIdRow | undefined;
        if (result?.room) {
          return this.getRoom(result.room);
        }
      }
    } catch (e) { console.debug('[stmp] FTS query fail', e); }

    return null;
  }

  /** FTS5 安全查询：移除 emoji/特殊字符，用双引号包裹词项 */
  private fts5Escape(input: string): string {
    // 移除 emoji 和特殊字符，保留中文/英文/数字/空格
    const cleaned = input.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '').trim();
    if (!cleaned) return '';
    // 按空格分词，每项用双引号包裹
    return cleaned.split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => `"${t.replace(/"/g, '""')}"`)
      .join(' OR ');
  }

  // ==================== 记忆节点 ====================

  insertNode(node: MemoryNode): void {
    this.db.prepare(`
      INSERT INTO stmp_nodes (
        id, content, room, timestamp,
        temporal_before, temporal_after, temporal_duration,
        concepts, relations,
        valence, importance, user_marked,
        created_at, last_accessed, access_count, decay, compressed, hibernated,
        source, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id, node.content, node.room, node.timestamp,
      JSON.stringify(node.temporalContext.before),
      JSON.stringify(node.temporalContext.after),
      node.temporalContext.duration ?? null,
      JSON.stringify(node.concepts),
      JSON.stringify(node.relations),
      node.emotional.valence, node.emotional.importance, node.emotional.userMarked ?? null,
      node.lifecycle.createdAt, node.lifecycle.lastAccessed,
      node.lifecycle.accessCount, node.lifecycle.decay,
      node.lifecycle.compressed ? 1 : 0, node.lifecycle.hibernated ? 1 : 0,
      node.source, node.sessionId ?? null,
    );

    // 更新 FTS
    this.db.prepare(`
      INSERT INTO stmp_nodes_fts(rowid, content, concepts)
      VALUES ((SELECT rowid FROM stmp_nodes WHERE id = ?), ?, ?)
    `).run(node.id, node.content, node.concepts.join(' '));

    // 更新房间计数和时间关联
    this.touchRoom(node.room);
    this.linkTemporal(node);
  }

  getNode(id: string): MemoryNode | null {
    const row = this.db.prepare('SELECT * FROM stmp_nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? this.rowToNode(row) : null;
  }

  /** 获取房间内最近的 N 条记忆 */
  getRecentInRoom(roomId: string, count = 20): MemoryNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM stmp_nodes WHERE room = ? AND hibernated = 0
      ORDER BY timestamp DESC LIMIT ?
    `).all(roomId, count) as NodeRow[];
    return rows.map(r => this.rowToNode(r));
  }

  /** 按概念标签查找记忆 */
  findByConcept(concept: string, limit = 10): MemoryNode[] {
    // SQLite JSON 搜索
    const rows = this.db.prepare(`
      SELECT * FROM stmp_nodes
      WHERE concepts LIKE ? AND hibernated = 0
      ORDER BY importance DESC, timestamp DESC
      LIMIT ?
    `).all(`%"${concept}"%`, limit) as NodeRow[];
    return rows.map(r => this.rowToNode(r));
  }

  /** FTS5 全文搜索 */
  searchNodes(query: string, limit = 10): MemoryNode[] {
    try {
      const safeQuery = this.fts5Escape(query);
      if (!safeQuery) return [];
      const rows = this.db.prepare(`
        SELECT n.* FROM stmp_nodes_fts fts
        JOIN stmp_nodes n ON n.rowid = fts.rowid
        WHERE stmp_nodes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeQuery, limit) as NodeRow[];
      return rows.map(r => this.rowToNode(r));
    } catch {
      return [];
    }
  }

  /** 更新访问计数和衰减刷新 */
  touchNode(id: string): void {
    this.db.prepare(`
      UPDATE stmp_nodes SET
        last_accessed = ?,
        access_count = access_count + 1,
        decay = 1.0
      WHERE id = ?
    `).run(Date.now(), id);
  }

  /** 标记休眠 */
  hibernateNode(id: string): void {
    this.db.prepare('UPDATE stmp_nodes SET hibernated = 1 WHERE id = ?').run(id);
  }

  /** 获取节点总数 */
  countNodes(roomId?: string): number {
    if (roomId) {
      return (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes WHERE room = ?').get(roomId) as CountRow).c;
    }
    return (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes').get() as CountRow).c;
  }

  /** 按 source 类型统计节点数 */
  countNodesBySource(source: string): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes WHERE source = ?').get(source) as CountRow).c;
  }

  /** 按领域（房间）统计提取的知识数量 */
  countExtractedInRoom(roomId: string): number {
    return (this.db.prepare(
      'SELECT COUNT(*) as c FROM stmp_nodes WHERE room = ? AND source = ?'
    ).get(roomId, 'extracted') as CountRow).c;
  }

  /** 获取所有领域及其知识统计 */
  getDomainStats(): Array<{ roomId: string; roomName: string; totalNodes: number; extractedNodes: number }> {
    const rows = this.db.prepare(`
      SELECT 
        r.id as roomId,
        r.name as roomName,
        COUNT(n.id) as totalNodes,
        SUM(CASE WHEN n.source = 'extracted' THEN 1 ELSE 0 END) as extractedNodes
      FROM stmp_rooms r
      LEFT JOIN stmp_nodes n ON n.room = r.id
      WHERE r.is_default = 0
      GROUP BY r.id
      ORDER BY extractedNodes DESC, totalNodes DESC
    `).all() as DomainStatRow[];
    return rows.map(r => ({
      roomId: r.roomId,
      roomName: r.roomName,
      totalNodes: r.totalNodes,
      extractedNodes: r.extractedNodes,
    }));
  }

  /** 检查某条内容是否已存在（近似去重） */
  hasSimilarContent(content: string, roomId?: string): boolean {
    const truncated = content.slice(0, 50);
    const query = roomId
      ? 'SELECT COUNT(*) as c FROM stmp_nodes WHERE room = ? AND content LIKE ?'
      : 'SELECT COUNT(*) as c FROM stmp_nodes WHERE content LIKE ?';
    const params = roomId ? [roomId, `%${truncated}%`] : [`%${truncated}%`];
    return (this.db.prepare(query).get(...params) as CountRow).c > 0;
  }

  // ==================== 语义星图 ====================

  upsertEdge(source: string, target: string, weight: number, roomIds: string[] = []): void {
    const existing = this.db.prepare(`
      SELECT * FROM stmp_edges WHERE source_concept = ? AND target_concept = ?
    `).get(source, target) as EdgeRow | undefined;

    if (existing) {
      const newWeight = Math.min(1, existing.weight + weight * 0.1);
      this.db.prepare(`
        UPDATE stmp_edges SET weight = ?, last_updated = ?, room_ids = ?
        WHERE id = ?
      `).run(newWeight, Date.now(), JSON.stringify([...new Set([...JSON.parse(existing.room_ids), ...roomIds])]), existing.id);
    } else {
      const id = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.db.prepare(`
        INSERT INTO stmp_edges (id, source_concept, target_concept, weight, room_ids, last_updated)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, source, target, weight, JSON.stringify(roomIds), Date.now());
    }
  }

  /** 获取概念的关联概念 */
  getRelatedConcepts(concept: string, limit = 10): Array<{ concept: string; weight: number; rooms: string[] }> {
    const rows = this.db.prepare(`
      SELECT * FROM stmp_edges
      WHERE source_concept = ? OR target_concept = ?
      ORDER BY weight DESC LIMIT ?
    `).all(concept, concept, limit) as EdgeRow[];

    return rows.map(r => ({
      concept: r.source_concept === concept ? r.target_concept : r.source_concept,
      weight: r.weight,
      rooms: JSON.parse(r.room_ids),
    }));
  }

  // ==================== 四步检索 ====================

  /**
   * STMP 四步检索
   * 1. 定位房间 → 2. 时间轴导航 → 3. 语义星图扩展 → 4. 组装结果
   */
  async retrieve(query: string, options?: {
    maxPrimary?: number;
    maxAssociative?: number;
    recencyBias?: number;
    crossRoom?: boolean;
  }): Promise<STMPResult> {
    const maxPrimary = options?.maxPrimary ?? 5;
    const maxAssoc = options?.maxAssociative ?? 3;
    const recencyBias = options?.recencyBias ?? 0.3;
    const crossRoom = options?.crossRoom ?? true;

    // Step 1: 定位房间
    const room = this.locateRoom(query);

    // Step 2: 时间轴导航 — 在目标房间内找相关记忆
    let primary: MemoryNode[] = [];
    if (room) {
      // 房间内搜索 + 时间排序
      const inRoom = this.searchNodes(query, maxPrimary * 2);
      primary = inRoom
        .filter(n => n.room === room.id)
        .slice(0, maxPrimary);

      // 如果房间内结果不足，补充时间最近的
      if (primary.length < maxPrimary) {
        const recent = this.getRecentInRoom(room.id, maxPrimary - primary.length);
        for (const r of recent) {
          if (!primary.find(p => p.id === r.id)) {
            primary.push(r);
          }
        }
      }
    }

    // 无房间匹配或房间内无结果 → 全局搜索
    if (primary.length === 0) {
      primary = this.searchNodes(query, maxPrimary);
    }

    // Step 3: 语义星图扩展
    const concepts = this.extractConcepts(query);
    const associative: MemoryNode[] = [];
    const seenIds = new Set(primary.map(p => p.id));

    for (const concept of concepts) {
      const related = this.getRelatedConcepts(concept, 3);
      for (const rel of related) {
        // 找到关联概念对应的记忆
        const nodes = this.findByConcept(rel.concept, 2);
        for (const node of nodes) {
          if (!seenIds.has(node.id) && associative.length < maxAssoc) {
            if (crossRoom || !room || node.room === room.id) {
              seenIds.add(node.id);
              associative.push(node);
            }
          }
        }
      }
    }

    // Step 4: 叙事组装（LLM 增强版，降级为字符串拼接）
    const narrative = await this.composeNarrative(primary, associative, query, room);

    // 刷新访问
    for (const node of [...primary, ...associative]) {
      this.touchNode(node.id);
    }

    return { primary, associative, narrative, room };
  }

  // ==================== 生命周期管理 ====================

  /**
   * Ebbinghaus 衰减计算
   * 半衰期 = 1 周 (168 小时)
   */
  calculateDecay(node: MemoryNode): number {
    const hoursSinceAccess = (Date.now() - node.lifecycle.lastAccessed) / 3600000;
    const baseDecay = Math.exp(-hoursSinceAccess / 168);

    // 被访问过就刷新
    const accessBoost = Math.log(node.lifecycle.accessCount + 1) * 0.1;

    // 重要记忆衰减更慢
    const importanceBoost = node.emotional.importance * 0.05;

    return Math.max(0, Math.min(1, baseDecay + accessBoost + importanceBoost));
  }

  /** 批量衰减更新 */
  applyDecay(): { decayed: number; hibernated: number } {
    const nodes = this.db.prepare('SELECT * FROM stmp_nodes WHERE compressed = 0').all() as NodeRow[];
    let decayed = 0;
    let hibernated = 0;

    const updateStmt = this.db.prepare('UPDATE stmp_nodes SET decay = ? WHERE id = ?');
    const hibernateStmt = this.db.prepare('UPDATE stmp_nodes SET hibernated = 1, decay = 0 WHERE id = ?');

    for (const row of nodes) {
      const node = this.rowToNode(row);
      const newDecay = this.calculateDecay(node);

      if (newDecay < 0.05) {
        hibernateStmt.run(node.id);
        hibernated++;
      } else {
        updateStmt.run(newDecay, node.id);
        if (newDecay < node.lifecycle.decay) decayed++;
      }
    }

    return { decayed, hibernated };
  }

  /** 压缩：将同房间同时期的碎片记忆合并 */
  compress(roomId: string, minGroupSize = 3): number {
    const nodes = this.getRecentInRoom(roomId, 100)
      .filter(n => !n.lifecycle.compressed && !n.lifecycle.hibernated && n.emotional.importance <= 4);

    if (nodes.length < minGroupSize) return 0;

    // 按时间段分组（同一天的放一起）
    const groups = new Map<string, MemoryNode[]>();
    for (const node of nodes) {
      const day = new Date(node.timestamp).toISOString().split('T')[0];
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(node);
    }

    let compressed = 0;
    for (const [day, group] of groups) {
      if (group.length >= minGroupSize) {
        // 创建压缩记忆
        const summary = group.map(n => n.content).join('\n');
        const compressedNode: MemoryNode = {
          id: `compressed-${roomId}-${day}-${Date.now()}`,
          content: `[压缩] ${day}: ${group.length} 条记忆合并\n${summary.slice(0, 500)}`,
          room: roomId,
          timestamp: group[0].timestamp,
          temporalContext: { before: [], after: [] },
          concepts: [...new Set(group.flatMap(n => n.concepts))],
          relations: [],
          emotional: {
            valence: group.reduce((s, n) => s + n.emotional.valence, 0) / group.length,
            importance: Math.max(...group.map(n => n.emotional.importance)),
          },
          lifecycle: {
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 1,
            decay: 1.0,
            compressed: true,
            hibernated: false,
          },
          source: 'conversation',
        };

        this.insertNode(compressedNode);

        // 标记原始节点为已压缩
        for (const n of group) {
          this.db.prepare('UPDATE stmp_nodes SET compressed = 1 WHERE id = ?').run(n.id);
        }
        compressed += group.length;
      }
    }

    return compressed;
  }

  // ==================== 内部方法 ====================

  private extractConcepts(text: string): string[] {
    // 简单概念提取：分词 + 过滤停用词
    const stopwords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'in', 'on', 'at', 'to', 'for',
      'of', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'it', 'i', 'you', 'he', 'she']);

    // 提取中文词组和英文单词
    const tokens = text
      .replace(/[，。！？、；：""''（）\[\]{}<>《》,.!?;:()\[\]{}<>]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !stopwords.has(t.toLowerCase()));

    return [...new Set(tokens)].slice(0, 10);
  }

  private linkTemporal(node: MemoryNode): void {
    // 找到同一房间中时间最接近的前一条记忆
    const prev = this.db.prepare(`
      SELECT id FROM stmp_nodes
      WHERE room = ? AND timestamp < ? AND id != ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(node.room, node.timestamp, node.id) as TemporalRow | undefined;

    if (prev) {
      // 更新前一条的 after
      const prevNode = this.getNode(prev.id);
      if (prevNode) {
        const after = [...prevNode.temporalContext.after, node.id];
        this.db.prepare('UPDATE stmp_nodes SET temporal_after = ? WHERE id = ?')
          .run(JSON.stringify(after), prev.id);

        // 更新当前节点的 before
        const before = [prev.id, ...node.temporalContext.before];
        this.db.prepare('UPDATE stmp_nodes SET temporal_before = ? WHERE id = ?')
          .run(JSON.stringify(before), node.id);
      }
    }
  }

  private async composeNarrative(primary: MemoryNode[], associative: MemoryNode[], query: string, room: Room | null): Promise<string> {
    const allNodes = [...primary, ...associative];

    // 降级：无 LLM 或无记忆时用字符串拼接
    if (!this.llmCaller || allNodes.length === 0) {
      return this._composeNarrativeFallback(primary, associative, query, room);
    }

    const memories = allNodes
      .map((n, i) => {
        const time = new Date(n.timestamp).toLocaleString('zh-CN');
        return `[${i + 1}] ${time} | ${n.content.slice(0, 200)}`;
      })
      .join('\n');

    const roomContext = room ? `（来自「${room.name}」房间）` : '';

    const prompt = `你是记忆叙述组装器。以下是与用户问题"${query}"${roomContext}相关的记忆片段，请用自然语言将它们组装成一段简洁有逻辑的叙述（100字以内），不要逐条列举：

${memories}`;

    try {
      const narrative = await this.llmCaller(prompt);
      return narrative.trim() || this._composeNarrativeFallback(primary, associative, query, room);
    } catch {
      return this._composeNarrativeFallback(primary, associative, query, room);
    }
  }

  /** 叙事组装降级：字符串拼接 */
  private _composeNarrativeFallback(primary: MemoryNode[], associative: MemoryNode[], _query: string, room: Room | null): string {
    const parts: string[] = [];

    if (room) {
      parts.push(`在「${room.name}」房间中找到了以下相关记忆：`);
    } else {
      parts.push('全局搜索到以下相关记忆：');
    }

    if (primary.length > 0) {
      parts.push('\n直接相关：');
      for (const p of primary) {
        const time = new Date(p.timestamp).toLocaleString('zh-CN');
        parts.push(`- [${time}] ${p.content.slice(0, 100)}`);
      }
    }

    if (associative.length > 0) {
      parts.push('\n关联记忆：');
      for (const a of associative) {
        const time = new Date(a.timestamp).toLocaleString('zh-CN');
        parts.push(`- [${time}] ${a.content.slice(0, 100)} (概念关联)`);
      }
    }

    if (primary.length === 0 && associative.length === 0) {
      parts.push('暂无相关记忆。');
    }

    return parts.join('\n');
  }

  private rowToRoom(row: RoomRow): Room {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: JSON.parse(row.tags),
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      memoryCount: row.memory_count,
      isDefault: row.is_default === 1,
    };
  }

  private rowToNode(row: NodeRow): MemoryNode {
    return {
      id: row.id,
      content: row.content,
      room: row.room,
      timestamp: row.timestamp,
      temporalContext: {
        before: JSON.parse(row.temporal_before),
        after: JSON.parse(row.temporal_after),
        duration: row.temporal_duration ?? undefined,
      },
      concepts: JSON.parse(row.concepts),
      relations: JSON.parse(row.relations),
      emotional: {
        valence: row.valence,
        importance: row.importance,
        userMarked: (row.user_marked ?? undefined) as MemoryNode['emotional']['userMarked'],
      },
      lifecycle: {
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count,
        decay: row.decay,
        compressed: row.compressed === 1,
        hibernated: row.hibernated === 1,
      },
      source: row.source as MemoryNode['source'],
      sessionId: row.session_id ?? undefined,
    };
  }

  /** 统计信息 */
  getStats(): { rooms: number; nodes: number; edges: number; activeNodes: number; hibernatedNodes: number } {
    return {
      rooms: (this.db.prepare('SELECT COUNT(*) as c FROM stmp_rooms').get() as CountRow).c,
      nodes: (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes').get() as CountRow).c,
      edges: (this.db.prepare('SELECT COUNT(*) as c FROM stmp_edges').get() as CountRow).c,
      activeNodes: (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes WHERE hibernated = 0').get() as CountRow).c,
      hibernatedNodes: (this.db.prepare('SELECT COUNT(*) as c FROM stmp_nodes WHERE hibernated = 1').get() as CountRow).c,
    };
  }

  close(): void {
    this.db.close();
  }
}

// ==================== Schema Migrations ====================

const STMP_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '为 stmp_nodes 添加 room_timestamp 索引',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_stmp_nodes_room_ts ON stmp_nodes(room, timestamp)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_stmp_nodes_importance ON stmp_nodes(importance DESC)');
    },
  },
];
