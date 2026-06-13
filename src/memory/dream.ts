/**
 * 梦幻记忆巩固引擎 — Buddy 的"做梦"系统
 *
 * 人脑在空闲/睡眠时做记忆巩固：回放、提取、关联、修剪。
 * 目前没有 AI Agent 做了这件事。
 *
 * 四阶段流程：回放 → 提取 → 关联 → 修剪
 */

import { STMPStore, type MemoryNode } from './stmp.js';

// ==================== 巩固结果 ====================

export interface DreamSession {
  id: string;
  startedAt: number;
  finishedAt: number;
  trigger: 'idle' | 'scheduled' | 'overflow' | 'manual';

  // 四阶段结果
  replay: {
    reviewed: number;       // 回放的记忆数
    insights: DreamInsight[];
  };
  extraction: {
    patterns: ExtractedPattern[];
  };
  association: {
    newEdges: number;       // 新建关联边数
    crossRoomLinks: number; // 跨房间关联数
    walks: RandomWalk[];
  };
  pruning: {
    compressed: number;     // 压缩的记忆数
    hibernated: number;     // 休眠的记忆数
  };

  // 梦境日志
  journal: string;

  // 统计
  stats: {
    totalProcessed: number;
    durationMs: number;
  };
}

export interface DreamInsight {
  type: 'pattern' | 'connection' | 'anomaly' | 'knowledge';
  content: string;
  sourceIds: string[];
  importance: number;       // 1-10
  concepts: string[];
}

export interface ExtractedPattern {
  name: string;
  description: string;
  sourceIds: string[];
  concepts: string[];
  applicability: string;    // 什么时候适用
}

export interface RandomWalk {
  startId: string;
  path: string[];
  discovery: string | null;
  crossRoom: boolean;
}

// ==================== 梦幻巩固引擎 ====================

/** LLM 调用类型 */
type LLMCaller = (messages: Array<{ role: string; content: string }>) => Promise<string>;

export class DreamEngine {
  private stmp: STMPStore;
  private lastSessionTime = 0;
  private sessions: DreamSession[] = [];
  private llmCaller: LLMCaller | null = null;

  constructor(stmp: STMPStore) {
    this.stmp = stmp;
  }

  /** 设置 LLM 调用器（用于梦境提取阶段的深度分析） */
  setLLMCaller(caller: LLMCaller): void {
    this.llmCaller = caller;
  }

  // ==================== 触发条件 ====================

  /** 检查是否应该触发巩固（三合一改造：引入 rest 欲望） */
  shouldDream(trigger: 'idle' | 'scheduled' | 'overflow' | 'manual', idleMinutes = 0, restDesire = 0): boolean {
    if (trigger === 'manual') return true;

    // 距离上次巩固至少 30 分钟
    if (Date.now() - this.lastSessionTime < 30 * 60 * 1000) return false;

    // rest 欲望降低触发阈值
    const threshold = restDesire > 80 ? 3 : restDesire > 60 ? 5 : 10;

    if (trigger === 'idle') return idleMinutes >= threshold;
    if (trigger === 'scheduled') return true;
    if (trigger === 'overflow') return this.stmp.countNodes() > 100;

    return false;
  }

  // ==================== 执行巩固 ====================

  /**
   * 执行完整的梦幻巩固流程
   */
  async dream(trigger: DreamSession['trigger'] = 'idle'): Promise<DreamSession> {
    const startTime = Date.now();
    const sessionId = `dream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    console.log(`  💤 梦境巩固开始 [${trigger}]...`);

    // Phase 1: 回放
    const replay = await this.phaseReplay();

    // Phase 2: 提取
    const extraction = await this.phaseExtract(replay.insights);

    // Phase 3: 关联
    const association = this.phaseAssociate();

    // Phase 4: 修剪
    const pruning = this.phasePrune();

    // 生成梦境日志
    const journal = this.composeJournal(replay, extraction, association, pruning, trigger);

    const session: DreamSession = {
      id: sessionId,
      startedAt: startTime,
      finishedAt: Date.now(),
      trigger,
      replay,
      extraction,
      association,
      pruning,
      journal,
      stats: {
        totalProcessed: replay.reviewed,
        durationMs: Date.now() - startTime,
      },
    };

    this.sessions.push(session);
    this.lastSessionTime = Date.now();

    // 将梦境洞察存入 STMP
    this.storeDreamInsights(session);

    console.log(`  💤 梦境巩固完成: ${replay.reviewed} 条回放, ${extraction.patterns.length} 个模式, ${association.newEdges} 条新关联`);
    return session;
  }

  // ==================== Phase 1: 回放 ====================

  private async phaseReplay(): Promise<DreamSession['replay']> {
    const insights: DreamInsight[] = [];

    // 选取近期记忆（24h内）+ 高重要度但久未访问的记忆
    const recent = this.getRecentMemories(50);
    const staleImportant = this.getStaleImportant(10);
    const pool = [...recent, ...staleImportant];

    // 去重
    const seen = new Set<string>();
    const unique = pool.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    // 分析记忆，生成洞察
    const conceptMap = new Map<string, MemoryNode[]>();
    for (const node of unique) {
      for (const concept of node.concepts) {
        if (!conceptMap.has(concept)) conceptMap.set(concept, []);
        conceptMap.get(concept)!.push(node);
      }
    }

    // 发现 1：频繁出现的概念
    for (const [concept, nodes] of conceptMap) {
      if (nodes.length >= 3) {
        insights.push({
          type: 'pattern',
          content: `概念「${concept}」在近期出现 ${nodes.length} 次，是活跃主题`,
          sourceIds: nodes.map(n => n.id),
          importance: Math.min(8, nodes.length + 2),
          concepts: [concept],
        });
      }
    }

    // 发现 2：同一房间内时间相近但无关联的记忆
    const rooms = this.stmp.listRooms();
    for (const room of rooms) {
      const roomNodes = unique.filter(n => n.room === room.id);
      for (let i = 0; i < roomNodes.length - 1; i++) {
        const a = roomNodes[i];
        const b = roomNodes[i + 1];
        const timeDiff = Math.abs(a.timestamp - b.timestamp);

        // 时间相近（1小时内）但没有直接关联
        if (timeDiff < 3600000) {
          const hasRelation = a.relations.some(r => r.target === b.id);
          if (!hasRelation) {
            const sharedConcepts = a.concepts.filter(c => b.concepts.includes(c));
            if (sharedConcepts.length > 0) {
              insights.push({
                type: 'connection',
                content: `「${a.content.slice(0, 30)}」和「${b.content.slice(0, 30)}」共享概念 [${sharedConcepts.join(', ')}]，可能有关联`,
                sourceIds: [a.id, b.id],
                importance: 5,
                concepts: sharedConcepts,
              });
            }
          }
        }
      }
    }

    // 发现 3：重要但衰减严重的记忆
    for (const node of unique) {
      if (node.emotional.importance >= 7 && node.lifecycle.decay < 0.5) {
        insights.push({
          type: 'anomaly',
          content: `重要记忆（${node.emotional.importance}/10）正在衰减：「${node.content.slice(0, 50)}」`,
          sourceIds: [node.id],
          importance: node.emotional.importance,
          concepts: node.concepts,
        });
      }
    }

    return { reviewed: unique.length, insights };
  }

  // ==================== Phase 2: 提取 ====================

  private async phaseExtract(insights: DreamInsight[]): Promise<DreamSession['extraction']> {
    // 优先使用 LLM 深度提取，降级到规则聚类
    if (this.llmCaller && insights.length >= 2) {
      try {
        const llmPatterns = await this._extractWithLLM(insights);
        if (llmPatterns.length > 0) {
          return { patterns: llmPatterns };
        }
      } catch {
        // LLM 失败降级到规则
      }
    }
    return this._extractWithRules(insights);
  }

  /** 使用 LLM 从洞察中提取深层模式 */
  private async _extractWithLLM(insights: DreamInsight[]): Promise<ExtractedPattern[]> {
    const insightSummary = insights
      .slice(0, 15) // 最多 15 条避免 token 过多
      .map((ins, i) => `${i + 1}. [${ins.type}] ${ins.content} (概念: ${ins.concepts.join(', ')}, 重要度: ${ins.importance})`)
      .join('\n');

    const prompt = `你是一个记忆分析专家。以下是从近期对话记忆中提取的洞察片段，请从中提炼出 2-5 个有价值的模式或知识。

洞察列表：
${insightSummary}

请以 JSON 数组格式返回提取的模式，每个模式包含：
- name: 模式名称（简短）
- description: 模式描述（一句话说明这个模式是什么）
- sourceIds: 来源洞察的编号数组（如 [1, 3, 5]）
- concepts: 相关概念数组
- applicability: 适用场景描述

只返回 JSON 数组，不要其他内容。如果没有值得提取的模式，返回空数组 []。`;

    const response = await this.llmCaller!([
      { role: 'system', content: '你是记忆模式提取专家。只返回 JSON，不要解释。' },
      { role: 'user', content: prompt },
    ]);

    // 解析 LLM 返回的 JSON
    const cleaned = response.replace(/```json\n?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return [];

    return parsed.map((p: any) => ({
      name: p.name ?? '未命名模式',
      description: p.description ?? '',
      sourceIds: (p.sourceIds ?? []).map((idx: number) =>
        insights[idx - 1]?.sourceIds ?? []
      ).flat(),
      concepts: p.concepts ?? [],
      applicability: p.applicability ?? '',
    })).filter((p: ExtractedPattern) => p.name && p.description);
  }

  /** 规则聚类提取（降级方案） */
  private _extractWithRules(insights: DreamInsight[]): DreamSession['extraction'] {
    const patterns: ExtractedPattern[] = [];

    // 按概念聚类
    const clusters = new Map<string, DreamInsight[]>();
    for (const insight of insights) {
      for (const concept of insight.concepts) {
        if (!clusters.has(concept)) clusters.set(concept, []);
        clusters.get(concept)!.push(insight);
      }
    }

    // 每个聚类提取模式
    for (const [concept, clusterInsights] of clusters) {
      if (clusterInsights.length >= 2) {
        const allSourceIds = [...new Set(clusterInsights.flatMap(i => i.sourceIds))];
        const allConcepts = [...new Set(clusterInsights.flatMap(i => i.concepts))];

        patterns.push({
          name: `${concept}模式`,
          description: `围绕「${concept}」的 ${clusterInsights.length} 个洞察提炼：${clusterInsights.map(i => i.content.slice(0, 30)).join('；')}`,
          sourceIds: allSourceIds,
          concepts: allConcepts,
          applicability: `涉及 ${concept} 的场景`,
        });
      }
    }

    return { patterns };
  }

  // ==================== Phase 3: 关联 ====================

  private phaseAssociate(): DreamSession['association'] {
    const walks: RandomWalk[] = [];
    let newEdges = 0;
    let crossRoomLinks = 0;

    // 5 次随机漫步
    for (let i = 0; i < 5; i++) {
      const walk = this.randomWalk();
      walks.push(walk);
      if (walk.crossRoom) crossRoomLinks++;

      if (walk.discovery) {
        newEdges++;
      }
    }

    return { newEdges, crossRoomLinks, walks };
  }

  /**
   * 随机漫步 — "梦幻"的关键
   * 不按权重选边，而是随机选 — 这是创造性联想
   */
  private randomWalk(steps = 4, crossRoomProb = 0.3): RandomWalk {
    const allNodes = this.getActiveNodes(20);
    if (allNodes.length === 0) {
      return { startId: '', path: [], discovery: null, crossRoom: false };
    }

    const start = allNodes[Math.floor(Math.random() * allNodes.length)];
    const path: string[] = [start.id];
    let current = start;
    let crossRoom = false;
    let discovery: string | null = null;

    for (let step = 0; step < steps; step++) {
      // 获取当前节点的概念
      const concepts = current.concepts;
      if (concepts.length === 0) break;

      // 随机选一个概念
      const concept = concepts[Math.floor(Math.random() * concepts.length)];

      // 获取关联概念
      const related = this.stmp.getRelatedConcepts(concept, 5);
      if (related.length === 0) break;

      // 随机选一个关联（不按权重）
      const target = related[Math.floor(Math.random() * related.length)];

      // 跨房间？
      const targetRooms = target.rooms;
      if (targetRooms.length > 0 && !targetRooms.includes(current.room)) {
        if (Math.random() < crossRoomProb) {
          crossRoom = true;
        } else {
          continue;
        }
      }

      // 找到关联概念对应的记忆
      const nodes = this.stmp.findByConcept(target.concept, 3);
      if (nodes.length === 0) continue;

      const next = nodes[Math.floor(Math.random() * nodes.length)];
      path.push(next.id);

      // 检查发现：当前记忆和下一步记忆是否有隐藏关联
      if (current.room !== next.room) {
        const sharedConcepts = current.concepts.filter(c => next.concepts.includes(c));
        if (sharedConcepts.length > 0 && !discovery) {
          discovery = `跨房间发现共同概念 [${sharedConcepts.join(', ')}]：${current.content.slice(0, 20)} ↔ ${next.content.slice(0, 20)}`;

          // 写入星图
          this.stmp.upsertEdge(current.concepts[0], next.concepts[0], 0.6, [current.room, next.room]);
        }
      }

      current = next;
    }

    return { startId: start.id, path, discovery, crossRoom };
  }

  // ==================== Phase 4: 修剪 ====================

  private phasePrune(): DreamSession['pruning'] {
    let compressed = 0;
    let hibernated = 0;

    // 衰减更新
    const decayResult = this.stmp.applyDecay();
    hibernated += decayResult.hibernated;

    // 各房间压缩
    const rooms = this.stmp.listRooms();
    for (const room of rooms) {
      compressed += this.stmp.compress(room.id, 3);
    }

    return { compressed, hibernated };
  }

  // ==================== 梦境日志 ====================

  private composeJournal(
    replay: DreamSession['replay'],
    extraction: DreamSession['extraction'],
    association: DreamSession['association'],
    pruning: DreamSession['pruning'],
    trigger: string,
  ): string {
    const parts: string[] = [];

    // 开场
    const openings = [
      '做了一个梦...',
      '刚才闭眼了一会儿，脑子里闪过一些画面...',
      '趁你不在的时候，我整理了一下记忆...',
      '打了个盹，梦里走过了几个房间...',
    ];
    parts.push(openings[Math.floor(Math.random() * openings.length)]);

    // 回放
    if (replay.insights.length > 0) {
      const topInsights = replay.insights
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 3);

      parts.push('\n回放时发现：');
      for (const insight of topInsights) {
        switch (insight.type) {
          case 'pattern':
            parts.push(`🔸 ${insight.content}`);
            break;
          case 'connection':
            parts.push(`🔗 ${insight.content}`);
            break;
          case 'anomaly':
            parts.push(`⚠️ ${insight.content}`);
            break;
        }
      }
    }

    // 提取的模式
    if (extraction.patterns.length > 0) {
      parts.push('\n提炼出了一些模式：');
      for (const p of extraction.patterns.slice(0, 2)) {
        parts.push(`📌 ${p.name}: ${p.description.slice(0, 80)}`);
      }
    }

    // 随机漫步发现
    const discoveries = association.walks.filter(w => w.discovery);
    if (discoveries.length > 0) {
      parts.push('\n梦里走着走着，发现了一些意外的联系：');
      for (const d of discoveries) {
        parts.push(`💡 ${d.discovery}`);
      }
    }

    // 修剪结果
    if (pruning.compressed > 0 || pruning.hibernated > 0) {
      const actions: string[] = [];
      if (pruning.compressed > 0) actions.push(`整理了 ${pruning.compressed} 条碎片记忆`);
      if (pruning.hibernated > 0) actions.push(`让 ${pruning.hibernated} 条旧记忆安静休息`);
      parts.push(`\n做完了之后，${actions.join('，')}。`);
    }

    // 收尾
    const closings = [
      '梦醒了，感觉清晰了不少。',
      '醒来后觉得脑子里更有条理了。',
      '好了，醒了。有什么需要帮忙的吗？',
      '嗯...伸个懒腰，整理完毕。',
    ];
    parts.push(closings[Math.floor(Math.random() * closings.length)]);

    return parts.join('\n');
  }

  // ==================== 辅助方法 ====================

  private getRecentMemories(count: number): MemoryNode[] {
    // 从所有房间获取最近的记忆
    const rooms = this.stmp.listRooms();
    const all: MemoryNode[] = [];
    for (const room of rooms) {
      all.push(...this.stmp.getRecentInRoom(room.id, count));
    }
    return all
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  private getStaleImportant(count: number): MemoryNode[] {
    // 重要但久未访问的记忆
    const all = this.getActiveNodes(100);
    return all
      .filter(n => n.emotional.importance >= 6 && n.lifecycle.accessCount <= 2)
      .sort((a, b) => a.lifecycle.lastAccessed - b.lifecycle.lastAccessed)
      .slice(0, count);
  }

  private getActiveNodes(count: number): MemoryNode[] {
    const rooms = this.stmp.listRooms();
    const all: MemoryNode[] = [];
    for (const room of rooms) {
      const nodes = this.stmp.getRecentInRoom(room.id, count);
      all.push(...nodes.filter(n => !n.lifecycle.hibernated));
    }
    return all;
  }

  /** 将梦境洞察存入 STMP */
  private storeDreamInsights(session: DreamSession): void {
    try {
      // 存储提取的模式
      for (const pattern of session.extraction.patterns) {
        const node: MemoryNode = {
          id: `dream-pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: `[梦境模式] ${pattern.name}: ${pattern.description}`,
          room: 'default',
          timestamp: Date.now(),
          temporalContext: { before: [], after: [] },
          concepts: pattern.concepts,
          relations: pattern.sourceIds.map(id => ({ target: id, type: 'supports' as const, strength: 0.5 })),
          emotional: { valence: 0.2, importance: 6 },
          lifecycle: {
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 1,
            decay: 1.0,
            compressed: false,
            hibernated: false,
          },
          source: 'dream',
        };
        this.stmp.insertNode(node);
      }
    } catch {
      // 存储失败不影响主流程
    }
  }

  // ==================== 公开接口 ====================

  /** 获取最近的梦境会话 */
  getRecentSessions(count = 5): DreamSession[] {
    return this.sessions.slice(-count);
  }

  /** 获取最近的梦境日志 */
  getLatestJournal(): string | null {
    if (this.sessions.length === 0) return null;
    return this.sessions[this.sessions.length - 1].journal;
  }

  /** 获取上次巩固时间 */
  getLastDreamTime(): number {
    return this.lastSessionTime;
  }
}
