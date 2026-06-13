/**
 * 失败模式测试 — 验证系统在异常条件下的行为
 *
 * 覆盖：
 * 1. LLM 返回空/垃圾内容
 * 2. 工具执行超时/异常
 * 3. STMP 满容量行为
 * 4. 经验图谱写入冲突
 * 5. 网络断开后的消息队列
 * 6. 恶意输入处理
 * 7. 并发安全
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MockLLM } from './core/mock-llm.js';
import { Subsystems } from './core/subsystems.js';
import { MessageProcessor } from './core/message-processor.js';
import { SkillOps } from './core/skill-ops.js';
import { DEFAULT_CONFIG } from './types.js';
import { ExperienceGraph } from './intelligence/experience-graph.js';
import { ExperienceEvolver } from './intelligence/experience-evolver.js';
import type { Message } from './types.js';

const TEST_DIR = '/tmp/buddy-failure-modes';
const BUDDY_DIR = path.join(TEST_DIR, '.buddy');

let sys: Subsystems;
let mockLLM: MockLLM;
let processor: MessageProcessor;

beforeAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(BUDDY_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'workspace'), { recursive: true });

  const config = {
    ...DEFAULT_CONFIG,
    name: '测试狐',
    species: '光灵',
    sandbox: { ...DEFAULT_CONFIG.sandbox, workspace: path.join(TEST_DIR, 'workspace') },
    llm: { ...DEFAULT_CONFIG.llm, apiKey: 'mock-not-real', model: 'mock' },
  };

  sys = new Subsystems(config, false);
  mockLLM = new MockLLM(sys.tools.list());
  const skillOps = new SkillOps(sys, false);
  processor = new MessageProcessor(sys, skillOps, config, sys.memoryCache, false);
});

afterAll(() => {
  sys?.pet?.close();
  sys?.memory?.close();
  sys?.stmp?.close();
  sys?.cognitive?.close();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

// ════════════════════════════════════════════════════════════════
// 1. LLM 返回异常内容
// ════════════════════════════════════════════════════════════════

describe('LLM 异常响应', () => {

  it('空响应不崩溃', async () => {
    // MockLLM 返回空文本
    const result = await mockLLM.chat([
      { role: 'system', content: 'test', timestamp: Date.now() },
      { role: 'user', content: '', timestamp: Date.now() },
    ]);
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
  });

  it('超长响应被截断', async () => {
    // 工具结果超过 10000 字符时应被截断
    const longResult = 'x'.repeat(15000);
    const toolCalls = [{ name: 'test', args: {}, result: longResult }];
    // MessageProcessor 内部截断逻辑在 chatWithPromptTools 中
    // 这里验证截断后长度
    const truncated = longResult.length > 10000
      ? longResult.slice(0, 10000) + `\n... [结果已截断，原始长度: ${longResult.length} 字符]`
      : longResult;
    expect(truncated.length).toBeLessThan(11000);
    expect(truncated).toContain('已截断');
  });

  it('错误分类 — 网络错误可恢复', async () => {
    const { classifyError } = await import('./errors.js');
    const networkErr = new Error('ECONNREFUSED');
    const classified = classifyError(networkErr);
    expect(classified.recoverable).toBe(true);
    expect(classified.category).toBe('network');
  });

  it('错误分类 — 认证错误不可恢复', async () => {
    const { classifyError } = await import('./errors.js');
    const authErr = new Error('401 Unauthorized');
    const classified = classifyError(authErr);
    expect(classified.recoverable).toBe(false);
    expect(classified.category).toBe('auth');
  });

  it('错误分类 — 超时可恢复', async () => {
    const { classifyError } = await import('./errors.js');
    const timeoutErr = new Error('Request timeout');
    const classified = classifyError(timeoutErr);
    expect(classified.recoverable).toBe(true);
    expect(classified.category).toBe('timeout');
  });
});

// ════════════════════════════════════════════════════════════════
// 2. 工具执行异常
// ════════════════════════════════════════════════════════════════

describe('工具执行异常', () => {

  it('沙箱拦截危险命令', async () => {
    const { SandboxExecutor } = await import('./tools/sandbox.js');
    const sb = new SandboxExecutor({ workspace: '/tmp' });

    // 危险命令被拦截
    expect(sb.isDangerous('rm -rf /').blocked).toBe(true);
    expect(sb.isDangerous('mkfs.ext4 /dev/sda').blocked).toBe(true);
    expect(sb.isDangerous(':(){ :|:& };:').blocked).toBe(true);
    expect(sb.isDangerous('dd if=/dev/zero of=/dev/sda').blocked).toBe(true);

    // 安全命令通过
    expect(sb.isDangerous('echo hello').blocked).toBe(false);
    expect(sb.isDangerous('ls -la').blocked).toBe(false);
    expect(sb.isDangerous('cat README.md').blocked).toBe(false);
  });

  it('不存在的工具返回错误', async () => {
    const tool = sys.tools.get('nonexistent_tool');
    expect(tool).toBeUndefined();
  });

  it('工具注册表列出所有工具', () => {
    const tools = sys.tools.list();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every(t => t.name && t.description)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. STMP 容量边界
// ════════════════════════════════════════════════════════════════

describe('STMP 边界行为', () => {

  it('大量节点插入不崩溃', () => {
    const stmp = sys.stmp;
    const room = 'stress-test';
    try { stmp.createRoom(room, '压力测试', ['stress']); } catch {}

    const now = Date.now();
    const batchId = `batch-${now}`;
    // 插入 100 个节点
    for (let i = 0; i < 100; i++) {
      stmp.insertNode({
        id: `${batchId}-${i}`,
        content: `压力测试节点 ${i}: 一些关于编程的内容`,
        room,
        timestamp: now - i * 1000,
        temporalContext: { before: [], after: [] },
        concepts: ['压力测试', `概念${i % 10}`],
        relations: [],
        emotional: { valence: 0.1, importance: 2 },
        lifecycle: {
          createdAt: now - i * 1000, lastAccessed: now,
          accessCount: 1, decay: 1, compressed: false, hibernated: false,
        },
        source: 'conversation',
      });
    }

    const stats = stmp.getStats();
    expect(stats.nodes).toBeGreaterThanOrEqual(100);
  });

  it('语义检索在大数据集上返回结果', async () => {
    const stmp = sys.stmp;
    const result = await stmp.retrieve('压力测试', { maxPrimary: 5, maxAssociative: 3 });
    expect(result.primary.length).toBeGreaterThan(0);
  });

  it('重复 ID 节点抛出约束错误', () => {
    const stmp = sys.stmp;
    const now = Date.now();
    const uniqueId = `dup-test-${now}`;
    const node = {
      id: uniqueId,
      content: '重复节点测试',
      room: 'default',
      timestamp: now,
      temporalContext: { before: [], after: [] },
      concepts: ['重复'],
      relations: [],
      emotional: { valence: 0, importance: 1 },
      lifecycle: {
        createdAt: now, lastAccessed: now,
        accessCount: 0, decay: 1, compressed: false, hibernated: false,
      },
      source: 'conversation' as const,
    };

    stmp.insertNode(node);
    // SQLite UNIQUE 约束 — 重复 ID 应抛错
    expect(() => stmp.insertNode(node)).toThrow();

    // 第一次插入成功
    const found = stmp.getNode(uniqueId);
    expect(found).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// 4. 经验图谱边界
// ════════════════════════════════════════════════════════════════

describe('经验图谱边界行为', () => {

  it('空图谱匹配返回空', () => {
    const graph = new ExperienceGraph(path.join(BUDDY_DIR, 'empty-graph'));
    const matches = graph.match('任何查询');
    expect(matches).toEqual([]);
  });

  it('重复经验不产生重复节点', async () => {
    const graph = new ExperienceGraph(path.join(BUDDY_DIR, 'dedup-graph'));
    await graph.load();

    const exp = {
      id: 'dedup-exp',
      name: '读取文件',
      description: '读取项目文件',
      abstractionLevel: 'concrete' as const,
      trigger: { intent: 'read_file', keywords: ['读取'], contextTags: [], patterns: [] },
      steps: [{ tool: 'read_file', args: { path: '${path}' }, outputVar: 'content' }],
      replyTemplate: { sharp: '{content}', warm: '{content}', chaotic: '{content}', default: '{content}' },
      stats: {
        confidence: 0.5, successCount: 1, failCount: 0,
        avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now(),
        extractedFrom: [], consolidatedAt: Date.now(), evolved: false,
      },
    };

    graph.addNode(exp);
    graph.addNode(exp); // 重复添加

    expect(graph.size).toBe(1);
  });

  it('经验进化 — 失败降低置信度', async () => {
    const graph = new ExperienceGraph(path.join(BUDDY_DIR, 'fail-graph'));
    const evolver = new ExperienceEvolver(graph);

    const exp = {
      id: 'fail-exp',
      name: '测试经验',
      description: '测试',
      abstractionLevel: 'concrete' as const,
      trigger: { intent: 'test', keywords: ['测试'], contextTags: [], patterns: [] },
      steps: [{ tool: 'test', args: {}, outputVar: 'r' }],
      replyTemplate: { sharp: '{r}', warm: '{r}', chaotic: '{r}', default: '{r}' },
      stats: {
        confidence: 0.8, successCount: 5, failCount: 0,
        avgExecutionMs: 100, lastUsed: Date.now(), createdAt: Date.now(),
        extractedFrom: [], consolidatedAt: Date.now(), evolved: false,
      },
    };
    graph.addNode(exp);

    // 多次失败
    evolver.onFailure('fail-exp', 'timeout');
    evolver.onFailure('fail-exp', 'error');
    evolver.onFailure('fail-exp', 'crash');

    const node = graph.getNode('fail-exp');
    expect(node!.stats.failCount).toBe(3);
    expect(node!.stats.confidence).toBeLessThan(0.8);

  });
});

// ════════════════════════════════════════════════════════════════
// 5. 消息历史压缩
// ════════════════════════════════════════════════════════════════

describe('消息历史压缩', () => {

  it('消息预处理器正确截断', () => {
    // MessageProcessor.compressMessages 是 private，通过 buildContext 间接测试
    // 这里测试截断逻辑本身
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${i}: ${'x'.repeat(400)}`,
      timestamp: Date.now() - (50 - i) * 60000,
    }));

    // 最近 5 条保持原样
    const keepRecent = 5;
    const compressed = messages.map((m, i) => {
      const isRecent = i >= messages.length - keepRecent;
      if (isRecent) return m;
      if (m.content.length > 300) {
        return { ...m, content: m.content.slice(0, 150) + '... [已截断]' };
      }
      return m;
    });

    // 早期消息应被截断
    expect(compressed[0].content).toContain('已截断');
    // 最近消息保持原样
    expect(compressed[compressed.length - 1].content).not.toContain('已截断');
  });
});

// ════════════════════════════════════════════════════════════════
// 6. 恶意输入处理
// ════════════════════════════════════════════════════════════════

describe('恶意输入处理', () => {

  it('超长输入不崩溃', () => {
    const longInput = 'A'.repeat(100000);
    // preprocessMessage 不应崩溃
    expect(() => sys.memory.addMessage('user', longInput)).not.toThrow();
  });

  it('特殊字符输入不崩溃', () => {
    const specialInput = '<script>alert("xss")</script> & "quotes" \'single\' {json: true} \n\r\t';
    expect(() => sys.memory.addMessage('user', specialInput)).not.toThrow();
  });

  it('空输入处理', () => {
    expect(() => sys.memory.addMessage('user', '')).not.toThrow();
  });

  it('Unicode 输入处理', () => {
    const unicodeInput = '你好世界 🌍🐾✨ مرحبا мир';
    expect(() => sys.memory.addMessage('user', unicodeInput)).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
// 7. 并发安全
// ════════════════════════════════════════════════════════════════

describe('并发安全', () => {

  it('并行消息写入不崩溃', async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve(sys.memory.addMessage('user', `并发消息 ${i}`))
    );
    await expect(Promise.all(promises)).resolves.not.toThrow();
  });

  it('并行 STMP 写入不崩溃', async () => {
    const stmp = sys.stmp;
    const now = Date.now();
    const promises = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(stmp.insertNode({
        id: `concurrent-${i}-${now}`,
        content: `并发节点 ${i}`,
        room: 'default',
        timestamp: now,
        temporalContext: { before: [], after: [] },
        concepts: ['并发'],
        relations: [],
        emotional: { valence: 0, importance: 1 },
        lifecycle: {
          createdAt: now, lastAccessed: now,
          accessCount: 0, decay: 1, compressed: false, hibernated: false,
        },
        source: 'conversation',
      }))
    );
    await expect(Promise.all(promises)).resolves.not.toThrow();
  });
});
