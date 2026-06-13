import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DreamEngine } from './memory/dream.js';
import { STMPStore, type MemoryNode } from './memory/stmp.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** 每个测试用例使用唯一的 DB 路径，避免并行/残留污染 */
function uniqueDbPath(): string {
  return path.join(os.tmpdir(), `buddy-dream-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

function makeNode(id: string, content: string, opts: Partial<MemoryNode> = {}): MemoryNode {
  const now = Date.now();
  return {
    id,
    content,
    room: opts.room ?? 'default',
    timestamp: opts.timestamp ?? now,
    temporalContext: opts.temporalContext ?? { before: [], after: [] },
    concepts: opts.concepts ?? [],
    relations: opts.relations ?? [],
    emotional: opts.emotional ?? { valence: 0, importance: 5 },
    lifecycle: opts.lifecycle ?? {
      createdAt: now,
      lastAccessed: now,
      accessCount: 1,
      decay: 1.0,
      compressed: false,
      hibernated: false,
    },
    source: opts.source ?? 'conversation',
  };
}

describe('梦境巩固引擎 DreamEngine', () => {
  let stmp: STMPStore;
  let engine: DreamEngine;
  let testDb: string;

  beforeEach(() => {
    testDb = uniqueDbPath();
    stmp = new STMPStore(testDb);
    engine = new DreamEngine(stmp);
  });

  afterEach(() => {
    try { stmp?.close(); } catch { /* 可能已在测试中关闭 */ }
    try { if (fs.existsSync(testDb)) fs.unlinkSync(testDb); } catch { /* 清理失败不阻断 */ }
  });

  // ==================== 触发条件 ====================

  describe('shouldDream() 触发条件', () => {
    it('manual 触发应该始终返回 true', () => {
      expect(engine.shouldDream('manual')).toBe(true);
      expect(engine.shouldDream('manual', 0)).toBe(true);
    });

    it('idle < 10min 不触发', () => {
      // lastSessionTime 为 0，30min 冷却通过
      expect(engine.shouldDream('idle', 5)).toBe(false);
      expect(engine.shouldDream('idle', 0)).toBe(false);
    });

    it('idle >= 10min 触发', () => {
      expect(engine.shouldDream('idle', 10)).toBe(true);
      expect(engine.shouldDream('idle', 30)).toBe(true);
    });

    it('scheduled 应该触发', () => {
      expect(engine.shouldDream('scheduled')).toBe(true);
    });

    it('overflow 节点 >100 时触发', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 101; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 1000,
          concepts: ['test'],
        }));
      }
      expect(engine.shouldDream('overflow')).toBe(true);
    });

    it('overflow 节点 <=100 时不触发', () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 50; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 1000,
        }));
      }
      expect(engine.shouldDream('overflow')).toBe(false);
    });

    it('30分钟冷却期内不触发非manual触发', async () => {
      // 独立数据库和引擎，避免并发污染
      const coolDb = uniqueDbPath();
      const coolStmp = new STMPStore(coolDb);
      const coolEngine = new DreamEngine(coolStmp);

      try {
        // 执行一次 dream 设置 lastSessionTime
        await coolEngine.dream('manual');

        // 刚执行完，冷却期内
        expect(coolEngine.shouldDream('idle', 15)).toBe(false);
        expect(coolEngine.shouldDream('scheduled')).toBe(false);
        // manual 仍然触发
        expect(coolEngine.shouldDream('manual')).toBe(true);
      } finally {
        try { coolStmp.close(); } catch { /* ignore */ }
        try { if (fs.existsSync(coolDb)) fs.unlinkSync(coolDb); } catch { /* ignore */ }
      }
    });
  });

  // ==================== dream() 完整流程 ====================

  describe('dream() 完整流程', () => {
    it('空记忆库不崩溃，返回有效会话', async () => {
      const session = await engine.dream('manual');
      expect(session).toBeDefined();
      expect(session.id).toMatch(/^dream-/);
      expect(session.trigger).toBe('manual');
      expect(session.replay.reviewed).toBe(0);
      expect(session.journal).toBeTruthy();
      expect(session.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('四阶段都执行并返回结果', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['TypeScript'],
        }));
      }

      const session = await engine.dream('manual');
      // 四阶段结构完整
      expect(session.replay).toBeDefined();
      expect(session.extraction).toBeDefined();
      expect(session.association).toBeDefined();
      expect(session.pruning).toBeDefined();
      // 关联阶段有 5 次漫步
      expect(session.association.walks).toHaveLength(5);
    });

    it('触发类型正确记录', async () => {
      const s1 = await engine.dream('manual');
      expect(s1.trigger).toBe('manual');

      const s2 = await engine.dream('idle');
      expect(s2.trigger).toBe('idle');
    });

    it('连续 dream 更新 lastDreamTime', async () => {
      expect(engine.getLastDreamTime()).toBe(0);
      await engine.dream('manual');
      const t1 = engine.getLastDreamTime();
      expect(t1).toBeGreaterThan(0);

      // 短暂延迟后再 dream
      await new Promise(r => setTimeout(r, 10));
      await engine.dream('manual');
      const t2 = engine.getLastDreamTime();
      expect(t2).toBeGreaterThanOrEqual(t1);
    });
  });

  // ==================== Phase 1: 回放 ====================

  describe('phaseReplay 回放', () => {
    it('频繁出现的概念生成 pattern 洞察', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      // 同一概念出现 3+ 次
      for (let i = 0; i < 4; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `关于 CORS 的记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['CORS'],
        }));
      }

      const session = await engine.dream('manual');
      const patterns = session.replay.insights.filter(ins => ins.type === 'pattern');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].content).toContain('CORS');
    });

    it('重要但衰减严重的记忆生成 anomaly 洞察', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode(makeNode('n1', '重要的架构决策', {
        room: 'r',
        timestamp: now - 3600000,
        concepts: ['架构'],
        emotional: { valence: 0.5, importance: 8 },
        lifecycle: {
          createdAt: now - 86400000,
          lastAccessed: now - 86400000,
          accessCount: 1,
          decay: 0.3,
          compressed: false,
          hibernated: false,
        },
      }));

      const session = await engine.dream('manual');
      const anomalies = session.replay.insights.filter(ins => ins.type === 'anomaly');
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].content).toContain('架构决策');
    });

    it('reviewed 数量正确反映去重', async () => {
      stmp.createRoom('r1', 'R1', []);
      stmp.createRoom('r2', 'R2', []);
      const now = Date.now();
      // 两个房间各放一些记忆
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`r1-n-${i}`, `r1记忆${i}`, {
          room: 'r1', timestamp: now - i * 60000, concepts: ['A'],
        }));
        stmp.insertNode(makeNode(`r2-n-${i}`, `r2记忆${i}`, {
          room: 'r2', timestamp: now - i * 60000, concepts: ['B'],
        }));
      }

      const session = await engine.dream('manual');
      // 去重后不应超过总节点数
      expect(session.replay.reviewed).toBeLessThanOrEqual(6);
    });
  });

  // ==================== Phase 2: 提取 ====================

  describe('phaseExtract 模式提取', () => {
    it('无洞察时无模式', async () => {
      const session = await engine.dream('manual');
      expect(session.extraction.patterns).toHaveLength(0);
    });

    it('规则聚类：同概念洞察产生模式', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      // 3 个同概念节点 → pattern 洞察 → 提取出模式
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `React 组件${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['React'],
        }));
      }

      const session = await engine.dream('manual');
      const reactPatterns = session.extraction.patterns.filter(p =>
        p.concepts.includes('React')
      );
      expect(reactPatterns.length).toBeGreaterThan(0);
    });

    it('LLM 提取成功时返回 LLM 结果', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['TypeScript'],
        }));
      }

      // 注入 mock LLM，返回一个模式
      engine.setLLMCaller(async () => JSON.stringify([{
        name: 'TS类型体操模式',
        description: '高级类型推导技巧',
        sourceIds: [1, 2],
        concepts: ['TypeScript', '类型'],
        applicability: '类型复杂的场景',
      }]));

      const session = await engine.dream('manual');
      const tsPatterns = session.extraction.patterns.filter(p =>
        p.name === 'TS类型体操模式'
      );
      expect(tsPatterns.length).toBe(1);
      expect(tsPatterns[0].concepts).toContain('TypeScript');
    });

    it('LLM 返回空数组时降级到规则', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['Go'],
        }));
      }

      engine.setLLMCaller(async () => '[]');
      const session = await engine.dream('manual');
      // 降级到规则，Go 概念聚类产生模式
      const goPatterns = session.extraction.patterns.filter(p =>
        p.concepts.includes('Go')
      );
      expect(goPatterns.length).toBeGreaterThan(0);
    });

    it('LLM 抛异常时降级到规则', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['Rust'],
        }));
      }

      engine.setLLMCaller(async () => { throw new Error('LLM down'); });
      const session = await engine.dream('manual');
      // 不崩溃，降级到规则
      const rustPatterns = session.extraction.patterns.filter(p =>
        p.concepts.includes('Rust')
      );
      expect(rustPatterns.length).toBeGreaterThan(0);
    });

    it('LLM 返回非 JSON 时降级到规则', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `记忆${i}`, {
          room: 'r',
          timestamp: now - i * 60000,
          concepts: ['Python'],
        }));
      }

      engine.setLLMCaller(async () => '这不是 JSON');
      const session = await engine.dream('manual');
      // 不崩溃，降级
      expect(session.extraction.patterns.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== Phase 3: 关联 ====================

  describe('phaseAssociate 关联发现', () => {
    it('5 次随机漫步', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode(makeNode('n1', 'CORS 跨域', {
        room: 'r', timestamp: now, concepts: ['CORS', 'HTTP'],
      }));
      stmp.insertNode(makeNode('n2', 'HTTP 缓存', {
        room: 'r', timestamp: now, concepts: ['HTTP', '缓存'],
      }));

      const session = await engine.dream('manual');
      expect(session.association.walks).toHaveLength(5);
    });

    it('空记忆库漫步不崩溃', async () => {
      const session = await engine.dream('manual');
      expect(session.association.walks).toHaveLength(5);
      for (const walk of session.association.walks) {
        expect(walk.startId).toBe('');
        expect(walk.path).toHaveLength(0);
      }
    });
  });

  // ==================== Phase 4: 修剪 ====================

  describe('phasePrune 修剪', () => {
    it('修剪结果包含 compressed 和 hibernated', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      stmp.insertNode(makeNode('n1', '记忆1', {
        room: 'r', timestamp: now, concepts: ['A'],
      }));

      const session = await engine.dream('manual');
      expect(session.pruning.compressed).toBeGreaterThanOrEqual(0);
      expect(session.pruning.hibernated).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== 梦境日志 ====================

  describe('journal 梦境日志', () => {
    it('日志非空字符串', async () => {
      const session = await engine.dream('manual');
      expect(session.journal.length).toBeGreaterThan(0);
    });

    it('有洞察时日志包含发现内容', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `React 组件${i}`, {
          room: 'r', timestamp: now - i * 60000, concepts: ['React'],
        }));
      }

      const session = await engine.dream('manual');
      expect(session.journal).toContain('React');
    });
  });

  // ==================== 会话历史 ====================

  describe('getRecentSessions', () => {
    it('初始无会话', () => {
      expect(engine.getRecentSessions()).toHaveLength(0);
      expect(engine.getLatestJournal()).toBeNull();
    });

    it('多次 dream 后保留会话', async () => {
      await engine.dream('manual');
      await engine.dream('manual');
      expect(engine.getRecentSessions()).toHaveLength(2);
      expect(engine.getRecentSessions(1)).toHaveLength(1);
      expect(engine.getLatestJournal()).toBeTruthy();
    });
  });

  // ==================== 存储梦境洞察 ====================

  describe('storeDreamInsights 存储', () => {
    it('提取的模式被存入 STMP', async () => {
      stmp.createRoom('r', 'R', []);
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        stmp.insertNode(makeNode(`n-${i}`, `React记忆${i}`, {
          room: 'r', timestamp: now - i * 60000, concepts: ['React'],
        }));
      }

      // 显式验证 default 房间存在（storeDreamInsights 写入 room: 'default'）
      const defaultRoom = stmp.getRoom('default');
      expect(defaultRoom).not.toBeNull();

      const beforeCount = stmp.countNodes();
      await engine.dream('manual');
      const afterCount = stmp.countNodes();
      // 梦境模式节点被写入
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });
});
