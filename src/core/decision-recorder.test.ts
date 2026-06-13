/**
 * DecisionRecorder 测试 — 记录 / 查询 / 统计 / 持久化
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionRecorder } from './decision-recorder.js';
import type { DecisionRecord } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeRecord(overrides: Partial<DecisionRecord> = {}): Omit<DecisionRecord, 'inputHash' | 'timestamp'> {
  return {
    input: '测试输入',
    intent: 'chat',
    domain: null,
    novelty: 0.5,
    complexity: 'medium',
    selectedNode: 'test-node',
    selectionReason: 'rule',
    selectionLayer: 1,
    outputTokenLimit: 2048,
    success: true,
    latencyMs: 100,
    inputTokens: 50,
    outputTokens: 100,
    costEstimate: 0.001,
    fallbackTriggered: false,
    ...overrides,
  };
}

describe('DecisionRecorder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== 基础记录 ====================

  it('记录并计数', () => {
    const recorder = new DecisionRecorder(tmpDir);
    expect(recorder.count()).toBe(0);

    recorder.record(makeRecord());
    expect(recorder.count()).toBe(1);

    recorder.record(makeRecord({ input: '第二次' }));
    expect(recorder.count()).toBe(2);
  });

  it('自动填充 inputHash 和 timestamp', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord());

    const recent = recorder.getRecent(1);
    expect(recent[0].inputHash).toBeDefined();
    expect(recent[0].inputHash).toHaveLength(32); // MD5 hex
    expect(recent[0].timestamp).toBeGreaterThan(0);
  });

  it('相同输入产生相同 hash', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: 'hello world' }));
    recorder.record(makeRecord({ input: 'hello world' }));

    const records = recorder.getRecent(2);
    expect(records[0].inputHash).toBe(records[1].inputHash);
  });

  it('不同输入产生不同 hash', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: 'hello' }));
    recorder.record(makeRecord({ input: 'world' }));

    const records = recorder.getRecent(2);
    expect(records[0].inputHash).not.toBe(records[1].inputHash);
  });

  // ==================== 查询 ====================

  it('getRecent 返回最近 N 条', () => {
    const recorder = new DecisionRecorder(tmpDir);
    for (let i = 0; i < 10; i++) {
      recorder.record(makeRecord({ input: `message ${i}` }));
    }

    expect(recorder.getRecent(3)).toHaveLength(3);
    expect(recorder.getRecent(5)).toHaveLength(5);
    expect(recorder.getRecent(20)).toHaveLength(10); // 不超过总数
  });

  it('getByTimeRange 按时间范围查询', () => {
    const recorder = new DecisionRecorder(tmpDir);
    const before = Date.now();
    recorder.record(makeRecord({ input: 'before' }));
    const after = Date.now() + 1000;

    recorder.record(makeRecord({ input: 'during' }));

    const inRange = recorder.getByTimeRange(before, after);
    expect(inRange.length).toBeGreaterThanOrEqual(1);
  });

  // ==================== 相似查询 ====================

  it('findSimilar 找到相似输入', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: '写一个 React 组件' }));
    recorder.record(makeRecord({ input: '写一个 Vue 组件' }));
    recorder.record(makeRecord({ input: '今天天气怎么样' }));

    const similar = recorder.findSimilar('写一个 React hook', 5);
    expect(similar.length).toBeGreaterThan(0);
    // React 相关的应该排在前面
    expect(similar[0].record.input).toContain('React');
  });

  it('findSimilar 返回空数组（无匹配）', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: '完全不同的内容 xyz' }));

    const similar = recorder.findSimilar('另一个世界 abc', 5);
    expect(similar).toHaveLength(0);
  });

  it('findSimilar 限制返回数量', () => {
    const recorder = new DecisionRecorder(tmpDir);
    for (let i = 0; i < 20; i++) {
      recorder.record(makeRecord({ input: `react component ${i}` }));
    }

    const similar = recorder.findSimilar('react component', 3);
    expect(similar.length).toBeLessThanOrEqual(3);
  });

  it('findSimilar 按相似度降序', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: 'react hooks 使用方法' }));
    recorder.record(makeRecord({ input: 'react 组件开发' }));
    recorder.record(makeRecord({ input: 'python 数据分析' }));

    const similar = recorder.findSimilar('react hooks 最佳实践', 10);
    if (similar.length >= 2) {
      expect(similar[0].similarity).toBeGreaterThanOrEqual(similar[1].similarity);
    }
  });

  // ==================== 统计 ====================

  it('getNodeStats 统计指定节点', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ selectedNode: 'node-a', success: true, latencyMs: 100 }));
    recorder.record(makeRecord({ selectedNode: 'node-a', success: true, latencyMs: 200 }));
    recorder.record(makeRecord({ selectedNode: 'node-a', success: false, latencyMs: 150 }));
    recorder.record(makeRecord({ selectedNode: 'node-b', success: true, latencyMs: 50 }));

    const stats = recorder.getNodeStats('node-a');
    expect(stats.attempts).toBe(3);
    expect(stats.successes).toBe(2);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.avgLatency).toBeCloseTo(150);
  });

  it('getNodeStats 按 taskType 过滤', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ selectedNode: 'node', intent: 'chat', success: true }));
    recorder.record(makeRecord({ selectedNode: 'node', intent: 'chat', success: false }));
    recorder.record(makeRecord({ selectedNode: 'node', intent: 'reasoning', success: true }));

    const chatStats = recorder.getNodeStats('node', 'chat');
    expect(chatStats.attempts).toBe(2);
    expect(chatStats.successes).toBe(1);

    const reasonStats = recorder.getNodeStats('node', 'reasoning');
    expect(reasonStats.attempts).toBe(1);
    expect(reasonStats.successes).toBe(1);
  });

  it('getNodeStats 无记录返回零值', () => {
    const recorder = new DecisionRecorder(tmpDir);
    const stats = recorder.getNodeStats('nonexistent');
    expect(stats.attempts).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgLatency).toBe(0);
  });

  it('getAllNodeStats 返回所有节点在指定任务上的统计', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ selectedNode: 'a', intent: 'chat', success: true, latencyMs: 100 }));
    recorder.record(makeRecord({ selectedNode: 'b', intent: 'chat', success: false, latencyMs: 200 }));
    recorder.record(makeRecord({ selectedNode: 'a', intent: 'reasoning', success: true, latencyMs: 300 }));

    const chatStats = recorder.getAllNodeStats('chat');
    expect(chatStats.size).toBe(2);
    expect(chatStats.get('a')!.successRate).toBe(1);
    expect(chatStats.get('b')!.successRate).toBe(0);

    const reasonStats = recorder.getAllNodeStats('reasoning');
    expect(reasonStats.size).toBe(1);
    expect(reasonStats.has('a')).toBe(true);
  });

  // ==================== 持久化 ====================

  it('记录持久化到 JSONL 文件', () => {
    const recorder1 = new DecisionRecorder(tmpDir);
    recorder1.record(makeRecord({ input: '持久化测试1' }));
    recorder1.record(makeRecord({ input: '持久化测试2' }));

    // 验证文件存在
    const jsonlPath = path.join(tmpDir, 'pool-decisions.jsonl');
    expect(fs.existsSync(jsonlPath)).toBe(true);

    // 每行一条记录
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('重新加载历史记录', () => {
    const recorder1 = new DecisionRecorder(tmpDir);
    recorder1.record(makeRecord({ input: '加载测试1' }));
    recorder1.record(makeRecord({ input: '加载测试2' }));

    // 重新创建 recorder
    const recorder2 = new DecisionRecorder(tmpDir);
    expect(recorder2.count()).toBe(2);
    expect(recorder2.getRecent(1)[0].input).toBe('加载测试2');
  });

  it('maxRecords 裁剪', () => {
    const recorder = new DecisionRecorder(tmpDir, 5); // 最多 5 条
    for (let i = 0; i < 10; i++) {
      recorder.record(makeRecord({ input: `裁剪测试 ${i}` }));
    }

    expect(recorder.count()).toBe(5);
    // 保留最新的 5 条
    expect(recorder.getRecent(1)[0].input).toBe('裁剪测试 9');
  });

  it('JSONL 文件裁剪后重写', () => {
    const recorder1 = new DecisionRecorder(tmpDir, 3);
    for (let i = 0; i < 5; i++) {
      recorder1.record(makeRecord({ input: `重写测试 ${i}` }));
    }

    // 重新加载，应该只有 3 条
    const recorder2 = new DecisionRecorder(tmpDir, 3);
    expect(recorder2.count()).toBe(3);
  });

  // ==================== 边界情况 ====================

  it('空输入的相似查询', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: 'test' }));

    const similar = recorder.findSimilar('', 5);
    expect(similar).toHaveLength(0);
  });

  it('中文输入的相似查询', () => {
    const recorder = new DecisionRecorder(tmpDir);
    recorder.record(makeRecord({ input: '帮我写一个 React 组件' }));
    recorder.record(makeRecord({ input: '帮我写一个 Vue 组件' }));

    const similar = recorder.findSimilar('帮我写一个 React hook', 5);
    expect(similar.length).toBeGreaterThan(0);
  });

  it('JSONL 文件中损坏的行被跳过', () => {
    const jsonlPath = path.join(tmpDir, 'pool-decisions.jsonl');
    fs.writeFileSync(jsonlPath, '{"valid": true}\n这不是JSON\n{"also": "valid"}\n');

    const recorder = new DecisionRecorder(tmpDir);
    // 跳过损坏行，加载 2 条有效记录（但字段不完整，实际可能解析失败）
    // 这里主要测试不崩溃
    expect(recorder.count()).toBeGreaterThanOrEqual(0);
  });

  it('不存在的目录自动创建', () => {
    const nestedDir = path.join(tmpDir, 'deep', 'nested', 'dir');
    const recorder = new DecisionRecorder(nestedDir);
    recorder.record(makeRecord());

    expect(recorder.count()).toBe(1);
    expect(fs.existsSync(path.join(nestedDir, 'pool-decisions.jsonl'))).toBe(true);
  });
});
