/**
 * 实体适配器 — 从各子系统提取实体到 EntityRegistry
 *
 * 数据源：
 * - ProjectIndex → 文件/函数/类/导入依赖
 * - STMPStore → 记忆/概念
 * - ExperienceGraph → 经验节点
 * - KnowledgeExtractor → 知识实体
 */

import {
  EntityRegistry,
  createFileEntity, createFunctionEntity, createClassEntity,
  createToolEntity, createMemoryEntity,
  createDependencyEdge, createCallEdge, createContainsEdge,
  type Entity, type Edge,
} from './entity-registry.js';

// ==================== 类型定义 ====================

/** ProjectIndex 的最小接口（避免循环依赖） */
export interface ProjectIndexSource {
  getFiles(): Array<{
    path: string;
    absPath: string;
    language: string;
    loc: number;
    symbols: Array<{
      name: string;
      kind: string;
      line: number;
      exported: boolean;
      signature?: string;
    }>;
    imports: Array<{
      source: string;
      specifiers: string[];
      resolvedPath?: string;
    }>;
  }>;
  getStats(): {
    totalFiles: number;
    totalLoc: number;
    totalSymbols: number;
    dependencyCount: number;
  };
}

/** STMPStore 的最小接口 */
export interface STMPSource {
  /** 获取指定房间的记忆节点 */
  getMemoriesInRoom(roomId: string, limit?: number): MemoryNodeLite[];
  /** 搜索记忆 */
  searchMemories(query: string, limit?: number): MemoryNodeLite[];
  /** 获取所有房间 */
  getRooms(): RoomLite[];
}

export interface MemoryNodeLite {
  id: string;
  content: string;
  room: string;
  concepts: string[];
  importance: number;
  timestamp: number;
  accessCount: number;
  decay: number;
}

export interface RoomLite {
  id: string;
  name: string;
  tags: string[];
  memoryCount: number;
}

/** ExperienceGraph 的最小接口 */
export interface ExperienceSource {
  getAllNodes(): ExperienceNodeLite[];
  getAllEdges(): ExperienceEdgeLite[];
}

export interface ExperienceNodeLite {
  id: string;
  name: string;
  description: string;
  trigger: {
    keywords: string[];
    contextTags: string[];
  };
  stats: {
    successCount: number;
    failCount: number;
    confidence: number;
  };
}

export interface ExperienceEdgeLite {
  from: string;
  to: string;
  type: string;
  weight: number;
}

/** 知识条目 */
export interface KnowledgeItem {
  type: string;
  content: string;
  domain: string;
  confidence: number;
  concepts: string[];
}

// ==================== 适配器 ====================

/**
 * 从 ProjectIndex 提取实体
 *
 * 提取：文件实体、函数实体、类实体、导入依赖边、包含边
 */
export function extractFromProject(
  registry: EntityRegistry,
  project: ProjectIndexSource,
): { entityCount: number; edgeCount: number } {
  const files = project.getFiles();
  let entityCount = 0;
  let edgeCount = 0;

  for (const file of files) {
    // 文件实体
    const fileEntity = createFileEntity(file.path, file.loc, file.language);
    registry.addEntity(fileEntity);
    entityCount++;

    // 符号实体（函数/类）
    for (const sym of file.symbols) {
      if (sym.kind === 'function' || sym.kind === 'method') {
        const funcEntity = createFunctionEntity(
          sym.name,
          file.path,
          sym.line,
          estimateComplexity(sym),
        );
        registry.addEntity(funcEntity);
        // 包含边：文件 → 函数
        registry.addEdge(createContainsEdge(fileEntity.id, funcEntity.id));
        entityCount++;
        edgeCount++;
      } else if (sym.kind === 'class') {
        const methodCount = file.symbols.filter(
          s => s.kind === 'method' && s.name.startsWith(sym.name),
        ).length || 1;
        const classEntity = createClassEntity(sym.name, file.path, methodCount);
        registry.addEntity(classEntity);
        registry.addEdge(createContainsEdge(fileEntity.id, classEntity.id));
        entityCount++;
        edgeCount++;
      }
    }

    // 导入依赖边
    for (const imp of file.imports) {
      if (imp.resolvedPath) {
        const depId = `file:${imp.resolvedPath}`;
        // 只在目标文件已注册时添加边
        if (registry.getEntity(depId)) {
          registry.addEdge(createDependencyEdge(fileEntity.id, depId));
          edgeCount++;
        }
      }
    }
  }

  return { entityCount, edgeCount };
}

/**
 * 从 STMPStore 提取实体
 *
 * 提取：记忆实体、概念实体、记忆间关联边
 */
export function extractFromSTMP(
  registry: EntityRegistry,
  stmp: STMPSource,
  options?: { roomIds?: string[]; maxMemories?: number },
): { entityCount: number; edgeCount: number } {
  const maxMemories = options?.maxMemories ?? 32;
  let entityCount = 0;
  let edgeCount = 0;

  // 收集记忆
  const rooms = options?.roomIds
    ? options.roomIds.map(id => ({ id } as RoomLite))
    : stmp.getRooms();

  const allMemories: MemoryNodeLite[] = [];
  for (const room of rooms) {
    const memories = stmp.getMemoriesInRoom(room.id, maxMemories);
    allMemories.push(...memories);
    if (allMemories.length >= maxMemories) break;
  }

  // 去重
  const seen = new Set<string>();
  const uniqueMemories = allMemories.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, maxMemories);

  // 创建记忆实体
  for (const mem of uniqueMemories) {
    const memEntity = createMemoryEntity(mem.id, mem.content, mem.importance / 10);
    registry.addEntity(memEntity);
    entityCount++;

    // 概念实体 + 关联边
    for (const concept of mem.concepts) {
      const conceptId = `concept:${concept}`;
      const existing = registry.getEntity(conceptId);
      if (!existing) {
        const conceptEntity: Entity = {
          id: conceptId,
          type: 'concept',
          label: concept,
          position: [hashTo01(concept), 0.5, 0.5],
          state_vector: new Float32Array([0.5, 0, 0, 0, 0, 0, 0, 0]),
          attributes: { memoryCount: 1 },
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        registry.addEntity(conceptEntity);
        entityCount++;
      } else {
        // 增加关联计数
        existing.attributes.memoryCount = (existing.attributes.memoryCount ?? 0) + 1;
      }
      // 记忆 → 概念 关联边
      registry.addEdge({
        source: memEntity.id,
        target: conceptId,
        relation: 'relates_to',
        weight: mem.importance / 10,
        confidence: 0.7,
        created_at: Date.now(),
      });
      edgeCount++;
    }
  }

  // 记忆间的时间序列边（同房间、时间接近）
  const roomGroups = new Map<string, MemoryNodeLite[]>();
  for (const mem of uniqueMemories) {
    if (!roomGroups.has(mem.room)) roomGroups.set(mem.room, []);
    roomGroups.get(mem.room)!.push(mem);
  }

  for (const [, group] of roomGroups) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < group.length - 1; i++) {
      const timeDiff = group[i + 1].timestamp - group[i].timestamp;
      // 5 分钟内的记忆建立时序边
      if (timeDiff < 5 * 60 * 1000) {
        registry.addEdge({
          source: `memory:${group[i].id}`,
          target: `memory:${group[i + 1].id}`,
          relation: 'triggers',
          weight: Math.max(0.3, 1 - timeDiff / (5 * 60 * 1000)),
          confidence: 0.6,
          created_at: Date.now(),
        });
        edgeCount++;
      }
    }
  }

  return { entityCount, edgeCount };
}

/**
 * 从 ExperienceGraph 提取实体
 *
 * 提取：经验实体、经验间关系边
 */
export function extractFromExperience(
  registry: EntityRegistry,
  expGraph: ExperienceSource,
  maxNodes = 32,
): { entityCount: number; edgeCount: number } {
  let entityCount = 0;
  let edgeCount = 0;

  const nodes = expGraph.getAllNodes().slice(0, maxNodes);

  for (const node of nodes) {
    const entity: Entity = {
      id: `experience:${node.id}`,
      type: 'experience',
      label: node.name,
      position: [hashTo01(node.id), node.stats.confidence, 0.5],
      state_vector: createStateVector([
        node.stats.confidence,
        node.stats.successCount / 10,
        node.stats.failCount / 10,
        node.trigger.keywords.length / 10,
        0, 0, 0, 0,
      ]),
      attributes: {
        confidence: node.stats.confidence,
        success: node.stats.successCount,
        fail: node.stats.failCount,
      },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    registry.addEntity(entity);
    entityCount++;

    // 关键词 → 概念关联
    for (const kw of node.trigger.keywords.slice(0, 5)) {
      const conceptId = `concept:${kw}`;
      if (registry.getEntity(conceptId)) {
        registry.addEdge({
          source: entity.id,
          target: conceptId,
          relation: 'relates_to',
          weight: 0.6,
          confidence: 0.5,
          created_at: Date.now(),
        });
        edgeCount++;
      }
    }
  }

  // 经验间关系边
  const allEdges = expGraph.getAllEdges();
  for (const edge of allEdges) {
    const fromId = `experience:${edge.from}`;
    const toId = `experience:${edge.to}`;
    if (registry.getEntity(fromId) && registry.getEntity(toId)) {
      const relation = edgeTypeToRelation(edge.type);
      registry.addEdge({
        source: fromId,
        target: toId,
        relation,
        weight: edge.weight,
        confidence: 0.7,
        created_at: Date.now(),
      });
      edgeCount++;
    }
  }

  return { entityCount, edgeCount };
}

/**
 * 从知识列表提取实体
 */
export function extractFromKnowledge(
  registry: EntityRegistry,
  knowledge: KnowledgeItem[],
  maxItems = 16,
): { entityCount: number; edgeCount: number } {
  let entityCount = 0;
  let edgeCount = 0;

  for (const item of knowledge.slice(0, maxItems)) {
    const id = `knowledge:${hashTo01(item.content).toFixed(4)}`;
    const entity: Entity = {
      id,
      type: 'knowledge',
      label: item.content.slice(0, 30),
      position: [hashTo01(item.domain), item.confidence, 0.5],
      state_vector: createStateVector([
        item.confidence,
        item.content.length / 1000,
        0, 0, 0, 0, 0, 0,
      ]),
      attributes: { confidence: item.confidence, domain: hashTo01(item.domain) },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    registry.addEntity(entity);
    entityCount++;

    // 知识 → 概念关联
    for (const concept of item.concepts.slice(0, 3)) {
      const conceptId = `concept:${concept}`;
      if (registry.getEntity(conceptId)) {
        registry.addEdge({
          source: entity.id,
          target: conceptId,
          relation: 'relates_to',
          weight: item.confidence,
          confidence: 0.6,
          created_at: Date.now(),
        });
        edgeCount++;
      }
    }
  }

  return { entityCount, edgeCount };
}

/**
 * 全量同步 — 从所有数据源填充 Registry
 */
export function syncAllSources(
  registry: EntityRegistry,
  sources: {
    project?: ProjectIndexSource;
    stmp?: STMPSource;
    experience?: ExperienceSource;
    knowledge?: KnowledgeItem[];
  },
): {
  project: { entityCount: number; edgeCount: number };
  stmp: { entityCount: number; edgeCount: number };
  experience: { entityCount: number; edgeCount: number };
  knowledge: { entityCount: number; edgeCount: number };
  totalEntities: number;
  totalEdges: number;
} {
  const project = sources.project
    ? extractFromProject(registry, sources.project)
    : { entityCount: 0, edgeCount: 0 };

  const stmp = sources.stmp
    ? extractFromSTMP(registry, sources.stmp)
    : { entityCount: 0, edgeCount: 0 };

  const experience = sources.experience
    ? extractFromExperience(registry, sources.experience)
    : { entityCount: 0, edgeCount: 0 };

  const knowledge = sources.knowledge
    ? extractFromKnowledge(registry, sources.knowledge)
    : { entityCount: 0, edgeCount: 0 };

  return {
    project,
    stmp,
    experience,
    knowledge,
    totalEntities: registry.entityCount,
    totalEdges: registry.edgeCount,
  };
}

// ==================== 工具函数 ====================

function hashTo01(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function createStateVector(values: number[]): Float32Array {
  const dim = 8;
  const vec = new Float32Array(dim);
  for (let i = 0; i < Math.min(values.length, dim); i++) {
    vec[i] = Math.max(0, Math.min(1, values[i]));
  }
  return vec;
}

function estimateComplexity(sym: { name: string; kind: string; signature?: string }): number {
  // 基于签名长度和名称估算复杂度
  const sigLen = sym.signature?.length ?? 0;
  return Math.min(10, Math.max(1, Math.floor(sigLen / 20) + 1));
}

function edgeTypeToRelation(type: string): Edge['relation'] {
  switch (type) {
    case 'requires': return 'requires';
    case 'enhances': return 'produces';
    case 'alternative': return 'similar_to';
    default: return 'relates_to';
  }
}
