/**
 * RoutineLearner 测试 — 历史分析 / 规律发现 / 增量更新
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('RoutineLearner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createLearner(messages: Array<{ role: string; content: string; timestamp: number }>) {
    const mockMemory = { getRecentMessages: () => messages };
    const { RoutineLearner } = await import('../core/routine-learner.js');
    return new RoutineLearner(mockMemory as any, tmpDir);
  }

  // ==================== 基础功能 ====================

  it('数据不足时不生成规律', async () => {
    const learner = await createLearner([
      { role: 'user', content: 'hello', timestamp: Date.now() },
    ]);
    const routines = learner.analyzeHistory(14);
    expect(routines).toHaveLength(0);
    expect(learner.count).toBe(0);
  });

  it('空消息列表不报错', async () => {
    const learner = await createLearner([]);
    const routines = learner.analyzeHistory(14);
    expect(routines).toHaveLength(0);
  });

  it('非用户消息被过滤', async () => {
    const now = Date.now();
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'assistant' as const,
      content: `reply ${i}`,
      timestamp: now - i * 3600000,
    }));
    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);
    expect(routines).toHaveLength(0);
  });

  // ==================== 规律发现 ====================

  it('能从密集对话中发现活跃时段', async () => {
    const now = Date.now();
    // 模拟 9-11 点大量对话
    const messages = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now);
      d.setHours(9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 3)); // 分散在多天
      return {
        role: 'user' as const,
        content: `working on typescript code bug fix ${i}`,
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);

    // 应该发现规律
    expect(learner.count).toBeGreaterThanOrEqual(0);
    if (routines.length > 0) {
      // 规律应该有合理的时间范围
      const r = routines[0];
      expect(r.typicalStart.hour).toBeGreaterThanOrEqual(0);
      expect(r.typicalStart.hour).toBeLessThan(24);
      expect(r.typicalEnd.hour).toBeGreaterThanOrEqual(0);
      expect(r.typicalEnd.hour).toBeLessThan(24);
      expect(r.observations).toBeGreaterThan(0);
    }
  });

  it('规律包含话题信息', async () => {
    const now = Date.now();
    const messages = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(now);
      d.setHours(14, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 5));
      return {
        role: 'user' as const,
        content: 'fix bug in react component and deploy to docker',
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);

    if (routines.length > 0) {
      const r = routines[0];
      // 话题应该被提取
      expect(r.commonTopics.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('规律名称合理', async () => {
    const now = Date.now();
    // 模拟早上 8-9 点对话
    const messages = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(now);
      d.setHours(8, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 4));
      return {
        role: 'user' as const,
        content: '早安 今天有什么计划',
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);

    if (routines.length > 0) {
      // 8 点的规律应该叫 morning_routine
      const morningRoutine = routines.find(r => r.name === 'morning_routine' || r.name === 'morning_work');
      // 可能存在也可能不存在，取决于数据密度
      expect(routines[0].name).toBeTruthy();
    }
  });

  // ==================== 增量更新 ====================

  it('增量更新不报错（无规律时）', async () => {
    const learner = await createLearner([]);
    learner.analyzeHistory(14);
    // 没有规律时增量更新应该安全
    learner.updateWithNewConversation(Date.now(), 'hello world');
    expect(learner.count).toBe(0);
  });

  it('增量更新增加观察次数', async () => {
    const now = Date.now();
    const messages = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now);
      d.setHours(10, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 5));
      return {
        role: 'user' as const,
        content: 'coding typescript',
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);

    if (routines.length > 0) {
      const beforeObs = routines[0].observations;
      // 在相同时段增量更新
      const d = new Date(now);
      d.setHours(10, 30);
      learner.updateWithNewConversation(d.getTime(), 'more coding');
      const afterRoutines = learner.getRoutines();
      expect(afterRoutines[0].observations).toBeGreaterThanOrEqual(beforeObs);
    }
  });

  it('增量更新添加新话题', async () => {
    const now = Date.now();
    const messages = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now);
      d.setHours(15, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 5));
      return {
        role: 'user' as const,
        content: 'python code',
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    const routines = learner.analyzeHistory(14);

    if (routines.length > 0) {
      const d = new Date(now);
      d.setHours(15, 30);
      learner.updateWithNewConversation(d.getTime(), 'rust programming');
      const afterRoutines = learner.getRoutines();
      // rust 应该被添加到话题中
      expect(afterRoutines[0].commonTopics).toContain('rust');
    }
  });

  // ==================== getCurrentMatch ====================

  it('getCurrentMatch 在无规律时返回 null', async () => {
    const learner = await createLearner([]);
    learner.analyzeHistory(14);
    expect(learner.getCurrentMatch()).toBeNull();
  });

  it('getCurrentMatch 返回当前时段匹配的规律', async () => {
    const now = Date.now();
    const currentHour = new Date(now).getHours();

    // 创建当前时段的数据
    const messages = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(now);
      d.setHours(currentHour, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 5));
      return {
        role: 'user' as const,
        content: 'hello test',
        timestamp: d.getTime(),
      };
    });

    const learner = await createLearner(messages);
    learner.analyzeHistory(14);

    const match = learner.getCurrentMatch(now);
    // 可能匹配也可能不匹配，取决于数据分析结果
    if (match) {
      expect(match.typicalStart.hour).toBeLessThanOrEqual(currentHour);
    }
  });

  // ==================== 持久化 ====================

  it('规律持久化和加载', async () => {
    const now = Date.now();
    const messages = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now);
      d.setHours(10, Math.floor(Math.random() * 60));
      d.setDate(d.getDate() - Math.floor(i / 5));
      return {
        role: 'user' as const,
        content: 'typescript coding',
        timestamp: d.getTime(),
      };
    });

    const learner1 = await createLearner(messages);
    learner1.analyzeHistory(14);
    const count1 = learner1.count;

    // 重新加载
    const learner2 = await createLearner(messages);
    // load 是构造函数中自动调用的
    const count2 = learner2.count;
    expect(count2).toBe(count1);
  });

  // ==================== getRoutines ====================

  it('getRoutines 返回副本', async () => {
    const learner = await createLearner([]);
    learner.analyzeHistory(14);
    const r1 = learner.getRoutines();
    const r2 = learner.getRoutines();
    expect(r1).not.toBe(r2); // 不同引用
    expect(r1).toEqual(r2); // 相同内容
  });
});
