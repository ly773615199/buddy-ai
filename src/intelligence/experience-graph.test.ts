import { describe, it, expect, beforeEach } from 'vitest';
import { ExperienceGraph } from './experience-graph.js';
import type { ExperienceUnit } from './types.js';

// ==================== Helpers ====================

function makeExp(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'exp-1',
    name: '读取配置',
    description: '读取项目配置文件',
    abstractionLevel: 'concrete',
    trigger: {
      intent: 'read_config',
      keywords: ['读取', '配置', 'config'],
      contextTags: ['project'],
      patterns: ['读取.*配置'],
    },
    steps: [
      { tool: 'read_file', args: { path: '${configPath}' }, outputVar: 'content' },
    ],
    replyTemplate: {
      sharp: '配置内容: {content}',
      warm: '这是你的配置: {content}',
      chaotic: '配置来了! {content}',
      default: '{content}',
    },
    stats: {
      successCount: 5,
      failCount: 0,
      confidence: 0.9,
      avgExecutionMs: 120,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      extractedFrom: ['conv-1'],
      consolidatedAt: Date.now(),
      evolved: false,
    },
    ...overrides,
  };
}

function makeExp2(): ExperienceUnit {
  return makeExp({
    id: 'exp-2',
    name: '搜索代码',
    description: '搜索项目代码',
    trigger: {
      intent: 'search_code',
      keywords: ['搜索', '代码', 'search', 'code'],
      contextTags: ['project'],
      patterns: ['搜索.*代码', 'search.*code'],
    },
    steps: [
      { tool: 'search_files', args: { query: '${query}' }, outputVar: 'results' },
    ],
    replyTemplate: {
      sharp: '搜索结果: {results}',
      warm: '找到了: {results}',
      chaotic: '代码搜索结果! {results}',
      default: '{results}',
    },
    stats: {
      successCount: 3,
      failCount: 1,
      confidence: 0.7,
      avgExecutionMs: 200,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      extractedFrom: ['conv-2'],
      consolidatedAt: Date.now(),
      evolved: false,
    },
  });
}

// ==================== Tests ====================

describe('ExperienceGraph', () => {
  let graph: ExperienceGraph;

  beforeEach(() => {
    graph = new ExperienceGraph();
  });

  // ── 节点操作 ──

  describe('节点操作', () => {
    it('addNode + getNode 正常工作', () => {
      const exp = makeExp();
      graph.addNode(exp);
      expect(graph.getNode('exp-1')).toEqual(exp);
    });

    it('removeNode 移除节点及关联边', () => {
      const a = makeExp({ id: 'a' });
      const b = makeExp({ id: 'b' });
      graph.addNode(a);
      graph.addNode(b);
      graph.addEdge('a', 'b', 'enhances');

      expect(graph.removeNode('a')).toBe(true);
      expect(graph.getNode('a')).toBeUndefined();
      expect(graph.getEdges('b')).toHaveLength(0);
    });

    it('removeNode 不存在的节点返回 false', () => {
      expect(graph.removeNode('nonexistent')).toBe(false);
    });

    it('getAllNodes 返回所有节点', () => {
      graph.addNode(makeExp({ id: 'x' }));
      graph.addNode(makeExp({ id: 'y' }));
      expect(graph.getAllNodes()).toHaveLength(2);
    });

    it('size 返回节点数', () => {
      expect(graph.size).toBe(0);
      graph.addNode(makeExp());
      expect(graph.size).toBe(1);
    });
  });

  // ── P3: 倒排索引 + 预编译正则 ──

  describe('P3: 倒排索引 + 预编译正则', () => {
    it('addNode 自动构建倒排索引', () => {
      graph.addNode(makeExp()); // keywords: ['读取', '配置', 'config']
      // match 应能通过关键词找到节点
      const results = graph.match('请读取配置');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('exp-1');
    });

    it('removeNode 清理倒排索引', () => {
      graph.addNode(makeExp());
      graph.removeNode('exp-1');
      const results = graph.match('读取配置');
      expect(results).toHaveLength(0);
    });

    it('多个节点的倒排索引独立', () => {
      graph.addNode(makeExp());    // keywords: 读取, 配置, config
      graph.addNode(makeExp2());   // keywords: 搜索, 代码, search, code

      const configResults = graph.match('读取配置');
      expect(configResults.some(e => e.id === 'exp-1')).toBe(true);

      const searchResults = graph.match('搜索代码');
      expect(searchResults.some(e => e.id === 'exp-2')).toBe(true);
    });
  });

  describe('match() 利用倒排索引加速', () => {
    it('通过关键词匹配经验', () => {
      graph.addNode(makeExp());
      const results = graph.match('帮我读取这个配置');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('exp-1');
    });

    it('通过正则模式匹配', () => {
      graph.addNode(makeExp()); // patterns: ['读取.*配置']
      const results = graph.match('读取系统配置');
      expect(results.length).toBeGreaterThan(0);
    });

    it('无匹配时返回空数组', () => {
      graph.addNode(makeExp());
      const results = graph.match('完全不相关的内容 xyz');
      expect(results).toHaveLength(0);
    });

    it('按得分排序（高分在前）', () => {
      const lowConf = makeExp({
        id: 'low',
        trigger: { intent: 'x', keywords: ['配置'], contextTags: [], patterns: [] },
        stats: { ...makeExp().stats, confidence: 0.3 },
      });
      const highConf = makeExp({
        id: 'high',
        trigger: { intent: 'y', keywords: ['配置', '读取', 'config'], contextTags: [], patterns: ['读取.*配置'] },
        stats: { ...makeExp().stats, confidence: 0.95 },
      });
      graph.addNode(lowConf);
      graph.addNode(highConf);

      const results = graph.match('读取配置');
      // 高置信度应在前
      expect(results[0].id).toBe('high');
    });

    it('上下文标签匹配加分', () => {
      graph.addNode(makeExp()); // contextTags: ['project']
      const results = graph.match('读取配置', ['project']);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ── 边操作 ──

  describe('边操作', () => {
    it('addEdge + getEdges 正常工作', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addEdge('a', 'b', 'enhances', 0.7);

      const edges = graph.getEdges('a');
      expect(edges).toHaveLength(1);
      expect(edges[0].from).toBe('a');
      expect(edges[0].to).toBe('b');
      expect(edges[0].type).toBe('enhances');
    });

    it('节点不存在时 addEdge 无操作', () => {
      graph.addEdge('nonexistent', 'also-nonexistent', 'requires');
      expect(graph.getEdges('nonexistent')).toHaveLength(0);
    });

    it('重复边累加权重', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addEdge('a', 'b', 'enhances', 0.5);
      graph.addEdge('a', 'b', 'enhances', 0.5); // 重复

      const edges = graph.getEdges('a');
      expect(edges).toHaveLength(1);
      expect(edges[0].weight).toBeGreaterThan(0.5); // 累加了
    });

    it('getSuccessors 返回后继节点', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addEdge('a', 'b', 'requires');

      const successors = graph.getSuccessors('a');
      expect(successors).toHaveLength(1);
      expect(successors[0].node.id).toBe('b');
    });

    it('getPredecessors 返回前驱节点', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addEdge('a', 'b', 'requires');

      const predecessors = graph.getPredecessors('b');
      expect(predecessors).toHaveLength(1);
      expect(predecessors[0].node.id).toBe('a');
    });
  });

  // ── 路径查找 ──

  describe('findPath', () => {
    it('找到可达路径', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addNode(makeExp({ id: 'c' }));
      graph.addEdge('a', 'b', 'enhances');
      graph.addEdge('b', 'c', 'requires');

      const path = graph.findPath('a', 'c');
      expect(path).not.toBeNull();
      expect(path!.map(n => n.id)).toEqual(['a', 'b', 'c']);
    });

    it('不可达返回 null', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      // 无边连接
      expect(graph.findPath('a', 'b')).toBeNull();
    });

    it('maxDepth 限制深度', () => {
      graph.addNode(makeExp({ id: 'a' }));
      graph.addNode(makeExp({ id: 'b' }));
      graph.addNode(makeExp({ id: 'c' }));
      graph.addEdge('a', 'b', 'enhances');
      graph.addEdge('b', 'c', 'requires');

      const path = graph.findPath('a', 'c', 1); // maxDepth=1
      expect(path).toBeNull(); // 路径长 3，超过深度 1
    });
  });

  // ── 自动发现边 ──

  describe('discoverEdges', () => {
    it('共享关键词建立 enhances 边', () => {
      const a = makeExp({ id: 'a', trigger: { intent: 'x', keywords: ['配置', '读取', '文件'], contextTags: [], patterns: [] } });
      const b = makeExp({ id: 'b', trigger: { intent: 'y', keywords: ['配置', '读取', '搜索'], contextTags: [], patterns: [] } });
      graph.addNode(a);
      graph.addNode(b);

      const discovered = graph.discoverEdges();
      expect(discovered).toBeGreaterThan(0);
      // 应有 enhances 边（共享 '配置' + '读取'）
      const edgesA = graph.getEdges('a');
      expect(edgesA.some(e => e.type === 'enhances' && e.to === 'b')).toBe(true);
    });

    it('同意图建立 alternative 边', () => {
      const a = makeExp({ id: 'a', trigger: { intent: 'same_intent', keywords: ['alpha'], contextTags: [], patterns: [] } });
      const b = makeExp({ id: 'b', trigger: { intent: 'same_intent', keywords: ['beta'], contextTags: [], patterns: [] } });
      graph.addNode(a);
      graph.addNode(b);

      const discovered = graph.discoverEdges();
      expect(discovered).toBeGreaterThan(0);
      const edges = graph.getEdges('a');
      expect(edges.some(e => e.type === 'alternative' && e.to === 'b')).toBe(true);
    });
  });

  // ── 统计 ──

  describe('stats', () => {
    it('空图谱返回零值', () => {
      const s = graph.stats();
      expect(s.nodes).toBe(0);
      expect(s.edges).toBe(0);
      expect(s.avgConfidence).toBe(0);
      expect(s.highConfidence).toBe(0);
    });

    it('正确统计节点和边', () => {
      graph.addNode(makeExp({ id: 'a', stats: { ...makeExp().stats, confidence: 0.9 } }));
      graph.addNode(makeExp({ id: 'b', stats: { ...makeExp().stats, confidence: 0.5 } }));
      graph.addEdge('a', 'b', 'enhances');

      const s = graph.stats();
      expect(s.nodes).toBe(2);
      expect(s.edges).toBe(1);
      expect(s.avgConfidence).toBeCloseTo(0.7, 1);
      expect(s.highConfidence).toBe(1); // 只有 a >= 0.8
    });
  });
});
