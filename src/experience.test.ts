import { describe, it, expect, beforeEach } from 'vitest';
import { ExperienceGraph } from './intelligence/experience-graph.js';
import { ExperienceRouter } from './intelligence/experience-router.js';
import type { ExperienceUnit } from './intelligence/types.js';

function makeSkill(
  id: string,
  keywords: string[],
  patterns: string[] = [],
  contextTags: string[] = [],
): ExperienceUnit {
  return {
    id,
    name: id,
    description: `Skill ${id}`,
    abstractionLevel: 'concrete',
    trigger: { intent: 'general', keywords, patterns, contextTags },
    steps: [{ tool: 'exec', args: { command: `echo ${id}` } }],
    replyTemplate: { sharp: '', warm: '', chaotic: '', default: `执行 ${id}` },
    stats: {
      confidence: 0.5,
      successCount: 1,
      failCount: 0,
      avgExecutionMs: 100,
      lastUsed: 0,
      createdAt: Date.now(),
      extractedFrom: [],
      consolidatedAt: 0,
      evolved: false,
    },
  };
}

describe('经验图谱', () => {
  let graph: ExperienceGraph;

  beforeEach(() => {
    graph = new ExperienceGraph('/tmp/buddy-test-graph');
  });

  describe('节点操作', () => {
    it('添加和获取节点', () => {
      const skill = makeSkill('s1', ['hello']);
      graph.addNode(skill);
      expect(graph.getNode('s1')).toBeDefined();
      expect(graph.getNode('s1')!.name).toBe('s1');
    });

    it('获取不存在的节点返回 undefined', () => {
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    it('删除节点并清理关联边', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      graph.addEdge('a', 'b', 'requires');
      graph.removeNode('a');
      expect(graph.getNode('a')).toBeUndefined();
      expect(graph.getEdges('b')).toHaveLength(0);
    });

    it('获取所有节点', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      expect(graph.getAllNodes()).toHaveLength(2);
    });

    it('size 返回节点数量', () => {
      expect(graph.size).toBe(0);
      graph.addNode(makeSkill('a', ['x']));
      expect(graph.size).toBe(1);
    });
  });

  describe('边操作', () => {
    it('添加边', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      graph.addEdge('a', 'b', 'requires', 0.8);
      expect(graph.getEdges('a')).toHaveLength(1);
      expect(graph.getEdges('b')).toHaveLength(1);
    });

    it('重复边增加权重', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      graph.addEdge('a', 'b', 'requires', 0.5);
      graph.addEdge('a', 'b', 'requires', 0.5);
      const edges = graph.getEdges('a');
      expect(edges).toHaveLength(1);
      expect(edges[0].weight).toBeGreaterThan(0.5);
    });

    it('不存在的节点添加边无效', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addEdge('a', 'nonexistent', 'requires');
      expect(graph.getEdges('a')).toHaveLength(0);
    });

    it('获取后继节点', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      graph.addEdge('a', 'b', 'enhances');
      const successors = graph.getSuccessors('a');
      expect(successors).toHaveLength(1);
      expect(successors[0].node.id).toBe('b');
    });

    it('获取前驱节点', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      graph.addEdge('a', 'b', 'requires');
      const predecessors = graph.getPredecessors('b');
      expect(predecessors).toHaveLength(1);
      expect(predecessors[0].node.id).toBe('a');
    });
  });

  describe('匹配', () => {
    it('按 keyword 匹配', () => {
      graph.addNode(makeSkill('git', ['git push', 'git commit']));
      graph.addNode(makeSkill('test', ['run test', 'npm test']));
      const results = graph.match('帮我 git push 一下');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('git');
    });

    it('无匹配返回空', () => {
      graph.addNode(makeSkill('git', ['git commit']));
      const results = graph.match('今天天气怎么样');
      expect(results).toHaveLength(0);
    });

    it('按 contextTag 匹配', () => {
      graph.addNode(makeSkill('docker', ['deploy'], [], ['容器', '部署']));
      const results = graph.match('帮我部署', ['部署']);
      expect(results.length).toBeGreaterThan(0);
    });

    it('按 pattern 正则匹配', () => {
      graph.addNode(makeSkill('calc', [], ['\\d+\\s*[+\\-*\\/]\\s*\\d+']));
      const results = graph.match('帮我算 3 + 5');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('路径查找', () => {
    it('找到两个节点之间的路径', () => {
      graph.addNode(makeSkill('a', ['start']));
      graph.addNode(makeSkill('b', ['mid']));
      graph.addNode(makeSkill('c', ['end']));
      graph.addEdge('a', 'b', 'requires');
      graph.addEdge('b', 'c', 'requires');
      const path = graph.findPath('a', 'c');
      expect(path).not.toBeNull();
      expect(path!.map(n => n.id)).toEqual(['a', 'b', 'c']);
    });

    it('无法到达时返回 null', () => {
      graph.addNode(makeSkill('a', ['x']));
      graph.addNode(makeSkill('b', ['y']));
      expect(graph.findPath('a', 'b')).toBeNull();
    });
  });

  describe('序列化', () => {
    it('save 和 load 保持数据', async () => {
      graph.addNode(makeSkill('a', ['hello']));
      await graph.save();

      const graph2 = new ExperienceGraph('/tmp/buddy-test-graph');
      await graph2.load();
      expect(graph2.getNode('a')).toBeDefined();
      expect(graph2.getNode('a')!.trigger.keywords).toContain('hello');
    });
  });
});

describe('技能路由器', () => {
  let graph: ExperienceGraph;
  let router: ExperienceRouter;

  beforeEach(() => {
    graph = new ExperienceGraph('/tmp/buddy-test-router');
    router = new ExperienceRouter(graph);
  });

  describe('路由决策', () => {
    it('无匹配技能 → llm', () => {
      const decision = router.route('随便说句话');
      expect(decision.path).toBe('llm_only');
      expect(decision.reason).toBe('no_exp_matched');
    });

    it('高置信度 + 足够成功次数 → skill_direct', () => {
      graph.addNode({
        ...makeSkill('s1', ['git status']),
        stats: { confidence: 0.9, successCount: 10, failCount: 0, avgExecutionMs: 50, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      const decision = router.route('git status');
      expect(decision.path).toBe('exp_direct');
    });

    it('中置信度 → skill_verified', () => {
      graph.addNode({
        ...makeSkill('s1', ['run test']),
        stats: { confidence: 0.6, successCount: 2, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      const decision = router.route('run test');
      expect(decision.path).toBe('exp_verified');
    });

    it('低置信度 → llm_with_hint', () => {
      graph.addNode({
        ...makeSkill('s1', ['something']),
        stats: { confidence: 0.3, successCount: 1, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      const decision = router.route('something');
      expect(decision.path).toBe('llm_with_hint');
    });
  });

  describe('canHandleLocally', () => {
    it('高置信度技能返回 true', () => {
      graph.addNode({
        ...makeSkill('s1', ['git status']),
        stats: { confidence: 0.9, successCount: 10, failCount: 0, avgExecutionMs: 50, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      expect(router.canHandleLocally('git status')).toBe(true);
    });

    it('无匹配返回 false', () => {
      expect(router.canHandleLocally('随便说')).toBe(false);
    });
  });

  describe('getCandidates', () => {
    it('返回排序后的候选列表', () => {
      graph.addNode({
        ...makeSkill('s1', ['test']),
        stats: { confidence: 0.9, successCount: 10, failCount: 0, avgExecutionMs: 50, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      graph.addNode({
        ...makeSkill('s2', ['test']),
        stats: { confidence: 0.3, successCount: 1, failCount: 0, avgExecutionMs: 200, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      const candidates = router.getCandidates('test');
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      expect(candidates[0].stats.confidence).toBeGreaterThan(candidates[1].stats.confidence);
    });
  });

  // ── Phase 6: Reasoning 增强 ──

  describe('Phase 6: Reasoning 增强编译', () => {
    it('reasoning 字段加分 — 有 reasoning 的经验在语义匹配时排名更高', () => {
      // 两个经验都有相同的关键词，一个有 reasoning 一个没有
      graph.addNode(makeSkill('no_reason', ['查看', '文件', '结构']));
      graph.addNode({
        ...makeSkill('has_reason', ['查看', '文件', '结构']),
        reasoning: '通过 read_file 工具读取文件内容来分析代码结构',
      });

      const candidates = router.getCandidates('查看文件结构');
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      // 有 reasoning 的经验应该排名更高（语义匹配加分）
      expect(candidates[0].id).toBe('has_reason');
    });

    it('reasoning 不影响无关输入的排名', () => {
      graph.addNode({
        ...makeSkill('skill_a', ['部署', 'deploy']),
        stats: { confidence: 0.95, successCount: 20, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      graph.addNode({
        ...makeSkill('skill_b', ['部署', 'deploy']),
        reasoning: '通过 Docker 容器部署到生产环境',
        stats: { confidence: 0.5, successCount: 2, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });

      const candidates = router.getCandidates('帮我部署一下');
      // 置信度高的仍然排在前面
      expect(candidates[0].id).toBe('skill_a');
    });

    it('LLM 增强编译 — enhanceWithReasoning 正常添加 reasoning', async () => {
      const { ExperienceCompiler } = await import('./intelligence/experience-compiler.js');

      const compiler = new ExperienceCompiler();
      const mockLLM = async () => '通过读取配置文件来确定项目结构和依赖关系';
      compiler.setLLMCaller(mockLLM);

      const conv = {
        id: 'conv-test',
        userMessage: '帮我看看这个项目的结构',
        assistantReply: '项目使用 TypeScript + Node.js 构建',
        toolCalls: [
          { name: 'read_file', args: { path: 'package.json' }, result: '{"name": "test"}' },
          { name: 'list_files', args: { dir: 'src/' }, result: 'main.ts, types.ts' },
        ],
        timestamp: Date.now(),
        wasSuccessful: true,
      };

      const baseUnit = compiler.compile(conv);
      expect(baseUnit).not.toBeNull();

      const enhanced = await compiler.enhanceWithReasoning(baseUnit!, conv);
      expect(enhanced.reasoning).toBe('通过读取配置文件来确定项目结构和依赖关系');
    });

    it('LLM 增强编译 — LLM 返回空或太短时保持原样', async () => {
      const { ExperienceCompiler } = await import('./intelligence/experience-compiler.js');

      const compiler = new ExperienceCompiler();
      // LLM 返回太短的内容
      compiler.setLLMCaller(async () => 'OK');

      const conv = {
        id: 'conv-short',
        userMessage: '读取文件',
        assistantReply: '好的',
        toolCalls: [{ name: 'read_file', args: { path: 'test.ts' }, result: 'content' }],
        timestamp: Date.now(),
        wasSuccessful: true,
      };

      const baseUnit = compiler.compile(conv)!;
      const enhanced = await compiler.enhanceWithReasoning(baseUnit, conv);
      expect(enhanced.reasoning).toBeUndefined();
    });

    it('LLM 增强编译 — 无 LLM caller 时直接返回原单元', async () => {
      const { ExperienceCompiler } = await import('./intelligence/experience-compiler.js');

      const compiler = new ExperienceCompiler();
      // 不设置 LLM caller

      const conv = {
        id: 'conv-nollm',
        userMessage: '运行测试',
        assistantReply: '测试通过',
        toolCalls: [{ name: 'exec', args: { command: 'npm test' }, result: 'passed' }],
        timestamp: Date.now(),
        wasSuccessful: true,
      };

      const baseUnit = compiler.compile(conv)!;
      const enhanced = await compiler.enhanceWithReasoning(baseUnit, conv);
      expect(enhanced.reasoning).toBeUndefined();
      expect(enhanced.id).toBe(baseUnit.id);
    });

    it('LLM 增强编译 — LLM 抛错时静默降级', async () => {
      const { ExperienceCompiler } = await import('./intelligence/experience-compiler.js');

      const compiler = new ExperienceCompiler();
      compiler.setLLMCaller(async () => { throw new Error('LLM timeout'); });

      const conv = {
        id: 'conv-error',
        userMessage: '搜索文件',
        assistantReply: '找到 5 个文件',
        toolCalls: [{ name: 'search_files', args: { pattern: '*.ts' }, result: '5 files' }],
        timestamp: Date.now(),
        wasSuccessful: true,
      };

      const baseUnit = compiler.compile(conv)!;
      const enhanced = await compiler.enhanceWithReasoning(baseUnit, conv);
      // 静默降级，返回原单元
      expect(enhanced.reasoning).toBeUndefined();
      expect(enhanced.id).toBe(baseUnit.id);
    });
  });
});
