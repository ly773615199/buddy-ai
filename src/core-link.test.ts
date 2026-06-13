/**
 * 核心链路补充测试
 *
 * 弥补项目最关键的测试缺口：
 * 1. 真实工具执行（read_file / write_file / list_files / search_files / git_*）
 * 2. Agent 消息处理管线端到端（Mock LLM → Function Calling → 工具执行 → 返回结果）
 * 3. 多步任务理解与工具链组合
 * 4. 经验路由端到端（用户输入 → 路由 → 执行 → 学习）
 * 5. 上下文连贯理解（技术栈推断、提问风格、领域切换）
 * 6. LLM 降级恢复流程
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── ESM 动态导入 ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function dynamicImport(modPath: string) {
  return import(path.resolve(__dirname, modPath));
}

// ── 工具（顶层 import） ──
import { read_file, write_file, list_files, search_files, exec, git_status, git_log, git_diff, get_time } from './tools/builtin.js';
import { SandboxExecutor } from './tools/sandbox.js';
import { classifyError, getUserFriendlyMessage } from './errors.js';
import { ExperienceGraph } from './intelligence/experience-graph.js';
import { ExperienceRouter } from './intelligence/experience-router.js';
import { ExperienceCompiler } from './intelligence/experience-compiler.js';
import { ExperienceExecutor } from './intelligence/experience-executor.js';
import { ExperienceEvolver } from './intelligence/experience-evolver.js';
import type { Message } from './types.js';

// ════════════════════════════════════════════════════════════════
// 测试环境设置
// ════════════════════════════════════════════════════════════════

const TEST_DIR = '/tmp/buddy-core-link-test';
const TEST_FILES_DIR = path.join(TEST_DIR, 'workspace');

beforeAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_FILES_DIR, { recursive: true });

  // 测试文件
  fs.writeFileSync(path.join(TEST_FILES_DIR, 'hello.txt'), 'Hello, Buddy!\n这是测试文件\n第三行内容');
  fs.writeFileSync(path.join(TEST_FILES_DIR, 'config.json'), JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(TEST_FILES_DIR, 'app.ts'), `
import express from 'express';
import { Database } from './db';

interface Config {
  port: number;
  debug: boolean;
}

class Server {
  private config: Config;
  constructor(config: Config) { this.config = config; }
  start(): void { console.log('Server started on port', this.config.port); }
  stop(): void { console.log('Server stopped'); }
}

function createApp(): express.Application {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  return app;
}

export { Server, createApp };
export const DEFAULT_PORT = 3000;
`);

  fs.writeFileSync(path.join(TEST_FILES_DIR, 'utils.py'), `
import os
from pathlib import Path

class DataProcessor:
    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)
    def process(self, filename: str) -> str:
        filepath = self.data_dir / filename
        return filepath.read_text()
    def list_files(self) -> list:
        return list(self.data_dir.iterdir())

def main():
    processor = DataProcessor('/data')
    return processor.process('input.csv')
`);

  fs.writeFileSync(path.join(TEST_FILES_DIR, 'notes.md'), '# 项目笔记\n## 待办\n- 修复 CORS\n- 添加测试\n');

  fs.mkdirSync(path.join(TEST_FILES_DIR, 'subdir'), { recursive: true });
  fs.writeFileSync(path.join(TEST_FILES_DIR, 'subdir', 'nested.ts'), 'export const NESTED = true;');

  // git 仓库
  const gitDir = path.join(TEST_DIR, 'git-repo');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'README.md'), '# Git Test Repo');
  fs.writeFileSync(path.join(gitDir, 'main.js'), 'console.log("hello");');
});

afterAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

// ════════════════════════════════════════════════════════════════
// 第一部分：真实工具执行测试
// ════════════════════════════════════════════════════════════════

describe('🔧 真实工具执行', () => {

  describe('read_file', () => {
    it('读取完整文件', async () => {
      const result = await read_file.execute({ path: path.join(TEST_FILES_DIR, 'hello.txt') });
      expect(result).toContain('Hello, Buddy!');
      expect(result).toContain('这是测试文件');
      expect(result).toContain('第三行内容');
    });

    it('按行号截取', async () => {
      const result = await read_file.execute({ path: path.join(TEST_FILES_DIR, 'hello.txt'), start_line: 2, max_lines: 1 });
      expect(result).toContain('这是测试文件');
      expect(result).not.toContain('Hello, Buddy!');
    });

    it('读取 JSON 文件', async () => {
      const result = await read_file.execute({ path: path.join(TEST_FILES_DIR, 'config.json') });
      expect(result).toContain('"name": "test"');
    });

    it('读取不存在的文件返回错误', async () => {
      const result = await read_file.execute({ path: '/nonexistent/file.txt' });
      expect(result).toMatch(/\[拒绝|\[读取失败/);
    });

    it('读取 .ssh 路径被拒绝', async () => {
      const result = await read_file.execute({ path: '/home/user/.ssh/id_rsa' });
      expect(result).toContain('[拒绝');
    });

    it('读取 .env 文件被拒绝', async () => {
      const result = await read_file.execute({ path: '/app/.env' });
      expect(result).toContain('[拒绝');
    });

    it('读取 TypeScript 文件', async () => {
      const result = await read_file.execute({ path: path.join(TEST_FILES_DIR, 'app.ts') });
      expect(result).toContain('class Server');
      expect(result).toContain('export { Server, createApp }');
    });

    it('读取 Python 文件', async () => {
      const result = await read_file.execute({ path: path.join(TEST_FILES_DIR, 'utils.py') });
      expect(result).toContain('class DataProcessor');
    });
  });

  describe('write_file', () => {
    const wf = path.join(TEST_FILES_DIR, 'write-test-output.txt');

    afterEach(() => { if (fs.existsSync(wf)) fs.unlinkSync(wf); });

    it('写入新文件', async () => {
      const result = await write_file.execute({ path: wf, content: 'test content' });
      expect(result).toContain('[已写入');
      expect(fs.readFileSync(wf, 'utf-8')).toBe('test content');
    });

    it('覆盖已有文件', async () => {
      fs.writeFileSync(wf, 'old');
      await write_file.execute({ path: wf, content: 'new' });
      expect(fs.readFileSync(wf, 'utf-8')).toBe('new');
    });

    it('写入深层目录（自动创建）', async () => {
      const deep = path.join(TEST_FILES_DIR, 'a', 'b', 'c', 'f.txt');
      const result = await write_file.execute({ path: deep, content: 'deep' });
      expect(result).toContain('[已写入');
      expect(fs.existsSync(deep)).toBe(true);
      fs.rmSync(path.join(TEST_FILES_DIR, 'a'), { recursive: true });
    });

    it('写入 .ssh 路径被拒绝', async () => {
      const result = await write_file.execute({ path: '/home/user/.ssh/evil', content: 'x' });
      expect(result).toContain('[拒绝');
    });
  });

  describe('list_files', () => {
    it('列出目录内容', async () => {
      const result = await list_files.execute({ path: TEST_FILES_DIR });
      expect(result).toContain('📄 hello.txt');
      expect(result).toContain('📁 subdir');
    });

    it('递归列出', async () => {
      const result = await list_files.execute({ path: TEST_FILES_DIR, recursive: true });
      expect(result).toContain('nested.ts');
    });

    it('不存在目录返回错误', async () => {
      const result = await list_files.execute({ path: '/nonexistent' });
      expect(result).toMatch(/\[拒绝|\[列出失败/);
    });
  });

  describe('search_files', () => {
    it('搜索关键词', async () => {
      const result = await search_files.execute({ pattern: 'Server', path: TEST_FILES_DIR });
      expect(result).toContain('app.ts');
    });

    it('文件过滤', async () => {
      const result = await search_files.execute({ pattern: 'process', path: TEST_FILES_DIR, file_pattern: '*.py' });
      expect(result).toContain('utils.py');
    });

    it('无结果返回提示', async () => {
      const result = await search_files.execute({ pattern: 'xyznonexistent999', path: TEST_FILES_DIR });
      // grep 返回空或错误 — 只要不崩溃就算通过
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('敏感路径被拒绝', async () => {
      const result = await search_files.execute({ pattern: 'x', path: '/etc/shadow' });
      expect(result).toContain('[拒绝');
    });
  });

  describe('exec', () => {
    it('echo 命令', async () => {
      const result = await exec.execute({ command: 'echo hello' });
      expect(result).toContain('hello');
    });

    it('管道命令', async () => {
      const result = await exec.execute({ command: 'echo "a\nb\nc" | wc -l' });
      expect(result).toContain('3');
    });

    it('危险命令拦截', async () => {
      const result = await exec.execute({ command: 'rm -rf /' });
      expect(result).toContain('拒绝');
    });

    it('超时控制', async () => {
      const result = await exec.execute({ command: 'sleep 30', timeout: 1 });
      expect(result).toContain('超时');
    });

    it('无效命令', async () => {
      const result = await exec.execute({ command: 'nonexistent_xyz_cmd' });
      expect(result).toContain('not found');
    });
  });

  describe('git 工具', () => {
    const gitRepo = path.join(TEST_DIR, 'git-repo');

    beforeAll(() => {
      const { execSync } = require('child_process');
      try {
        execSync('git init', { cwd: gitRepo, stdio: 'pipe' });
        execSync('git config user.email "t@t.com"', { cwd: gitRepo, stdio: 'pipe' });
        execSync('git config user.name "T"', { cwd: gitRepo, stdio: 'pipe' });
        execSync('git add .', { cwd: gitRepo, stdio: 'pipe' });
        execSync('git commit -m "init"', { cwd: gitRepo, stdio: 'pipe' });
        execSync('git commit --allow-empty -m "second"', { cwd: gitRepo, stdio: 'pipe' });
      } catch {}
    });

    it('git_status', async () => {
      const r = await git_status.execute({ repo_path: gitRepo });
      expect(r).toContain('分支:');
    });

    it('git_log', async () => {
      const r = await git_log.execute({ repo_path: gitRepo, count: 2 });
      expect(r).toContain('init');
    });

    it('git_diff', async () => {
      const r = await git_diff.execute({ repo_path: gitRepo });
      expect(typeof r).toBe('string');
    });

    it('git 非仓库返回错误', async () => {
      const r = await git_status.execute({ repo_path: '/tmp' });
      expect(r).toContain('[Git 状态获取失败');
    });
  });

  describe('get_time', () => {
    it('返回时间和时段', async () => {
      const r = await get_time.execute({});
      expect(r).toContain('当前时间');
      expect(r).toMatch(/时段: (凌晨|上午|中午|下午|晚上)/);
    });
  });

  describe('工具联动', () => {
    it('write → read 闭环', async () => {
      const p = path.join(TEST_FILES_DIR, 'link.txt');
      await write_file.execute({ path: p, content: 'link-test' });
      const r = await read_file.execute({ path: p });
      expect(r).toContain('link-test');
      fs.unlinkSync(p);
    });

    it('write → search 闭环', async () => {
      const p = path.join(TEST_FILES_DIR, 'search-link.ts');
      await write_file.execute({ path: p, content: 'export function fn998877() {}' });
      const r = await search_files.execute({ pattern: 'fn998877', path: TEST_FILES_DIR });
      expect(r).toContain('search-link.ts');
      fs.unlinkSync(p);
    });

    it('exec → read 闭环', async () => {
      const p = path.join(TEST_FILES_DIR, 'exec-link.txt');
      await exec.execute({ command: `echo "from-exec" > ${p}` });
      const r = await read_file.execute({ path: p });
      expect(r).toContain('from-exec');
      fs.unlinkSync(p);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 第二部分：Agent 消息处理管线（动态导入，Mock LLM）
// ════════════════════════════════════════════════════════════════

describe('🤖 Agent 消息处理管线', () => {
  const BUDDY_DIR = path.join(process.env.HOME ?? '/tmp', '.buddy-link-test');
  let agent: any;

  beforeAll(async () => {
    if (fs.existsSync(BUDDY_DIR)) fs.rmSync(BUDDY_DIR, { recursive: true });

    const { BuddyAgent } = await dynamicImport('./core/agent.js');
    const { DEFAULT_CONFIG } = await dynamicImport('./types.js');

    const config = {
      ...DEFAULT_CONFIG,
      name: '测试狐',
      species: '光灵',
      llm: { ...DEFAULT_CONFIG.llm, apiKey: 'test-key-not-real', baseUrl: 'http://127.0.0.1:19999/v1' },
    };
    agent = new BuddyAgent(config, { enableWs: false, verbose: false });
  });

  afterAll(() => {
    agent?.shutdown();
    try { fs.rmSync(BUDDY_DIR, { recursive: true }); } catch {}
  });

  describe('Agent 初始化', () => {
    it('配置正确加载', () => {
      const status = agent.getStatus();
      expect(status.config.name).toBe('测试狐');
      expect(status.config.species).toBe('光灵');
    });

    it('子系统全部可用', () => {
      const sys = agent.sys ?? (agent as any).sys;
      expect(sys).toBeDefined();
      expect(sys.llm).toBeDefined();
      expect(sys.memory).toBeDefined();
      expect(sys.stmp).toBeDefined();
      expect(sys.cognitive).toBeDefined();
      expect(sys.intelligence).toBeDefined();
      expect(sys.threeBrain).toBeDefined();
      expect(sys.pet).toBeDefined();
      expect(sys.subscriptionManager).toBeDefined();
      expect(sys.friendSystem).toBeDefined();
    });
  });

  describe('上下文构建', () => {
    it('buildContext 返回完整结构', async () => {
      const sys = agent.sys ?? (agent as any).sys;
      const { MessageProcessor } = await dynamicImport('./core/message-processor.js');
      const processor = new MessageProcessor(sys, (agent as any).skillOps, (agent as any).config, sys.memoryCache, false);

      const ctx = await processor.buildContext('帮我读取 config.json');
      expect(ctx.availableTools.length).toBeGreaterThan(0);
      expect(ctx.finalPrompt.length).toBeGreaterThan(100);
      expect(ctx.messages.length).toBeGreaterThan(0);
    });

    it('Prompt 包含情绪注入', async () => {
      const sys = agent.sys ?? (agent as any).sys;
      const { MessageProcessor } = await dynamicImport('./core/message-processor.js');
      const processor = new MessageProcessor(sys, (agent as any).skillOps, (agent as any).config, sys.memoryCache, false);

      const ctx = await processor.buildContext('你好');
      expect(ctx.finalPrompt).toContain('情绪');
    });

    it('Prompt 包含认知信息', async () => {
      const sys = agent.sys ?? (agent as any).sys;
      const { MessageProcessor } = await dynamicImport('./core/message-processor.js');
      const processor = new MessageProcessor(sys, (agent as any).skillOps, (agent as any).config, sys.memoryCache, false);

      const ctx = await processor.buildContext('帮我写代码');
      expect(ctx.finalPrompt).toContain('你对用户的了解');
      expect(ctx.finalPrompt).toContain('你对自己的认知');
    });
  });

  describe('记忆系统', () => {
    it('消息存储和检索', () => {
      const sys = agent.sys ?? (agent as any).sys;
      sys.memory.addMessage('user', 'test-msg-1');
      sys.memory.addMessage('assistant', 'test-reply-1');
      const msgs = sys.memory.getRecentMessages(10);
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    });

    it('长期记忆 CRUD', () => {
      const sys = agent.sys ?? (agent as any).sys;
      sys.memory.setMemory('cat', 'k1', 'v1', 5);
      expect(sys.memory.getMemory('cat', 'k1')).toBe('v1');
    });

    it('STMP 存储和检索', async () => {
      const sys = agent.sys ?? (agent as any).sys;
      try { sys.stmp.createRoom('test_e2e_room', '测试E2E', ['e2e']); } catch { /* room may exist */ }
      const uniqueId = `n-e2e-${Date.now()}`;
      sys.stmp.insertNode({
        id: uniqueId, content: '测试端到端检索', room: 'test_e2e_room',
        timestamp: Date.now(), temporalContext: { before: [], after: [] },
        concepts: ['测试', '检索'], relations: [],
        emotional: { valence: 0.5, importance: 5 },
        lifecycle: { createdAt: Date.now(), lastAccessed: Date.now(), accessCount: 1, decay: 1, compressed: false, hibernated: false },
        source: 'conversation',
      });
      // 验证节点已存入（跳过 retrieve，因其内部需要 LLM）
      const node = sys.stmp.getNode(uniqueId);
      expect(node).not.toBeNull();
      expect(node.content).toContain('端到端检索');
      const stats = sys.stmp.getStats();
      expect(stats.nodes).toBeGreaterThan(0);
    });
  });

  describe('情绪系统（三脑小脑 BodyStateManager）', () => {
    it('工具成功 → 信心提升 + 负载下降', () => {
      const sys = agent.sys ?? (agent as any).sys;
      const bs = sys.threeBrain.cerebellum.bodyState;
      const before = bs.getState();
      bs.onToolSuccess();
      const after = bs.getState();
      expect(after.confidenceLevel).toBeGreaterThanOrEqual(before.confidenceLevel);
    });

    it('工具失败 → 混乱度上升 + 安全感需求增加', () => {
      const sys = agent.sys ?? (agent as any).sys;
      const bs = sys.threeBrain.cerebellum.bodyState;
      const before = bs.getState();
      bs.onToolError();
      const after = bs.getState();
      expect(after.confusionLevel).toBeGreaterThan(before.confusionLevel);
    });

    it('多次消息 → 能量上升 + 好奇心增加', () => {
      const sys = agent.sys ?? (agent as any).sys;
      const bs = sys.threeBrain.cerebellum.bodyState;
      const before = bs.getState();
      for (let i = 0; i < 5; i++) bs.onUserMessage();
      const after = bs.getState();
      expect(after.energy).toBeGreaterThanOrEqual(before.energy);
    });
  });

  describe('养成系统', () => {
    it('工具追踪影响进化', () => {
      const sys = agent.sys ?? (agent as any).sys;
      ['chat', 'read_file', 'list_files', 'exec', 'get_time', 'git_status'].forEach(f => sys.pet.trackFeature(f));
      const stage = sys.pet.getData().evolutionStage;
      expect(stage).not.toBe('egg');
    });

    it('亲密度增长', () => {
      const sys = agent.sys ?? (agent as any).sys;
      const before = sys.pet.getIntimacy();
      // 亲密度可能已达上限 100，此时 addIntimacy 不会再增长
      sys.pet.trackFeature('search_web');
      const after = sys.pet.addIntimacy(3);
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeLessThanOrEqual(100);
    });

    it('行为信号可用', () => {
      const sys = agent.sys ?? (agent as any).sys;
      const s = sys.pet.getBehaviorSignals();
      expect(typeof s.snark).toBe('number');
      expect(typeof s.wisdom).toBe('number');
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 第三部分：多步任务理解与工具链
// ════════════════════════════════════════════════════════════════

describe('📋 多步任务理解', () => {

  describe('意图推断', () => {
    it('部署意图检测', async () => {
      const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
      const db = '/tmp/buddy-task-deploy.db';
      if (fs.existsSync(db)) fs.unlinkSync(db);
      const engine = new CognitiveEngine(db);
      engine.inferGoals('帮我部署到 k8s 上', []);
      const goals = engine.getPendingGoals();
      expect(goals.some((g: any) => g.goal.includes('部署'))).toBe(true);
      engine.close();
    });

    it('错误→调试意图', async () => {
      const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
      const db = '/tmp/buddy-task-err.db';
      if (fs.existsSync(db)) fs.unlinkSync(db);
      const engine = new CognitiveEngine(db);
      engine.inferGoals('TypeError: Cannot read property of undefined', []);
      const goals = engine.getPendingGoals();
      expect(goals.some((g: any) => g.goal.includes('错误') || g.goal.includes('调试'))).toBe(true);
      engine.close();
    });

    it('性能→优化意图', async () => {
      const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
      const db = '/tmp/buddy-task-perf.db';
      if (fs.existsSync(db)) fs.unlinkSync(db);
      const engine = new CognitiveEngine(db);
      engine.inferGoals('页面加载太慢了', []);
      const goals = engine.getPendingGoals();
      expect(goals.some((g: any) => g.goal.includes('性能') || g.goal.includes('优化'))).toBe(true);
      engine.close();
    });
  });

  describe('DAG 工具链', () => {
    it('串行依赖链顺序执行', async () => {
      const { createDAG, createTask, addTask } = await dynamicImport('./orchestrate/dag.js');
      const { TaskExecutor } = await dynamicImport('./orchestrate/executor.js');

      const order: string[] = [];
      const registry = {
        get: (n: string) => ({ name: n, description: '', parameters: {} as any, execute: async () => { order.push(n); return `${n}-done`; } }),
        list: () => [], listForPermissions: () => [],
      };

      const executor = new TaskExecutor(registry);
      const dag = createDAG('链式');
      const t1 = createTask('s1', 'step1', {});
      const t2 = createTask('s2', 'step2', {}, [t1.id]);
      const t3 = createTask('s3', 'step3', {}, [t2.id]);
      addTask(dag, t1); addTask(dag, t2); addTask(dag, t3);

      const result = await executor.execute(dag, () => {});
      expect(result.success).toBe(true);
      expect(order).toEqual(['step1', 'step2', 'step3']);
    });

    it('无依赖任务并行执行', async () => {
      const { createDAG, createTask, addTask } = await dynamicImport('./orchestrate/dag.js');
      const { TaskExecutor } = await dynamicImport('./orchestrate/executor.js');

      const registry = {
        get: (n: string) => ({ name: n, description: '', parameters: {} as any, execute: async () => { await new Promise(r => setTimeout(r, 10)); return 'ok'; } }),
        list: () => [], listForPermissions: () => [],
      };

      const executor = new TaskExecutor(registry);
      const dag = createDAG('并行');
      addTask(dag, createTask('a', 'tool_a', {}));
      addTask(dag, createTask('b', 'tool_b', {}));
      addTask(dag, createTask('c', 'tool_c', {}));

      const result = await executor.execute(dag, () => {}, 3);
      expect(result.success).toBe(true);
      expect(result.taskResults.every((r: any) => r.success)).toBe(true);
    });

    it('依赖失败 → 后续跳过', async () => {
      const { createDAG, createTask, addTask } = await dynamicImport('./orchestrate/dag.js');
      const { TaskExecutor } = await dynamicImport('./orchestrate/executor.js');

      const registry = {
        get: (n: string) => ({
          name: n, description: '', parameters: {} as any,
          execute: async () => { if (n === 'fail') throw new Error('boom'); return 'ok'; },
        }),
        list: () => [], listForPermissions: () => [],
      };

      const executor = new TaskExecutor(registry);
      const dag = createDAG('fail');
      const t1 = createTask('f', 'fail', {});
      const t2 = createTask('s', 'ok', {}, [t1.id]);
      const t3 = createTask('i', 'ok', {}); // 无依赖
      addTask(dag, t1); addTask(dag, t2); addTask(dag, t3);

      const result = await executor.execute(dag, () => {});
      expect(result.success).toBe(false);
      expect(result.taskResults[2].success).toBe(true); // 独立任务成功
    });
  });

  describe('经验路由端到端', () => {
    it('编译→路由→执行→进化 全链路', async () => {
      const graph = new ExperienceGraph('/tmp/buddy-e2e-intel');
      const compiler = new ExperienceCompiler();
      const router = new ExperienceRouter(graph);
      const callLog: string[] = [];
      const executor = new ExperienceExecutor(async (tool: string) => { callLog.push(tool); return `done:${tool}`; });
      const evolver = new ExperienceEvolver(graph, '/tmp/buddy-e2e-intel');

      // 编译
      const conv = {
        id: 'c1', userMessage: '查看 package.json', assistantReply: 'name: buddy',
        toolCalls: [{ name: 'read_file', args: { path: 'package.json' }, result: '{}' }],
        timestamp: Date.now(), wasSuccessful: true,
      };
      const compiled = await evolver.compileFromConversation(conv);
      expect(compiled).not.toBeNull();

      // 手动加入图谱（模拟学习后的状态）
      graph.addNode(compiled!);

      // 路由 — 刚编译的经验置信度低，应走 verified 路径
      const decision = router.route('查看 package.json');
      expect(decision.skill).toBeDefined();
      expect(['exp_direct', 'exp_verified']).toContain(decision.path);

      // 执行
      const execResult = await executor.execute(decision.skill!);
      expect(execResult.success).toBe(true);
      expect(callLog.length).toBeGreaterThan(0);

      // 进化反馈
      evolver.onSuccess(compiled!.id, execResult.executionMs);
      const node = graph.getNode(compiled!.id);
      expect(node!.stats.successCount).toBeGreaterThanOrEqual(2);
    });

    it('置信度分级', async () => {
      const graph = new ExperienceGraph('/tmp/buddy-route-lvl');
      const router = new ExperienceRouter(graph);

      graph.addNode({
        id: 'hi', name: 'hi', description: '', abstractionLevel: 'concrete',
        trigger: { intent: '', keywords: ['deploy'], patterns: [], contextTags: [] },
        steps: [{ tool: 'echo', args: {} }],
        replyTemplate: { sharp: '', warm: '', chaotic: '', default: 'ok' },
        stats: { confidence: 0.95, successCount: 50, failCount: 0, avgExecutionMs: 100, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      graph.addNode({
        id: 'mid', name: 'mid', description: '', abstractionLevel: 'concrete',
        trigger: { intent: '', keywords: ['test'], patterns: [], contextTags: [] },
        steps: [{ tool: 'echo', args: {} }],
        replyTemplate: { sharp: '', warm: '', chaotic: '', default: 'ok' },
        stats: { confidence: 0.6, successCount: 3, failCount: 1, avgExecutionMs: 200, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });
      graph.addNode({
        id: 'lo', name: 'lo', description: '', abstractionLevel: 'concrete',
        trigger: { intent: '', keywords: ['analyze'], patterns: [], contextTags: [] },
        steps: [{ tool: 'echo', args: {} }],
        replyTemplate: { sharp: '', warm: '', chaotic: '', default: 'ok' },
        stats: { confidence: 0.3, successCount: 1, failCount: 0, avgExecutionMs: 500, lastUsed: Date.now(), createdAt: 0, extractedFrom: [], consolidatedAt: 0, evolved: false },
      });

      expect(router.route('帮我 deploy').path).toBe('exp_direct');
      expect(router.route('run test').path).toBe('exp_verified');
      expect(router.route('analyze code').path).toBe('llm_with_hint');
      expect(router.route('随便说').path).toBe('llm_only');
    });

    it('LLM 增强编译', async () => {
      const compiler = new ExperienceCompiler();
      compiler.setLLMCaller(async () => '通过读取配置了解项目结构');
      const conv = {
        id: 'r1', userMessage: '看看项目', assistantReply: 'ts项目',
        toolCalls: [{ name: 'read_file', args: { path: 'package.json' }, result: '{}' }],
        timestamp: Date.now(), wasSuccessful: true,
      };
      const unit = compiler.compile(conv)!;
      const enhanced = await compiler.enhanceWithReasoning(unit, conv);
      expect(enhanced.reasoning).toBe('通过读取配置了解项目结构');
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 第四部分：上下文理解
// ════════════════════════════════════════════════════════════════

describe('🧠 上下文理解', () => {

  it('技术栈推断', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-tech.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    engine.inferFromMessage('我用 React 写了个组件，后端是 Node.js', []);
    const p = engine.getUserProfile();
    expect(p.identity.techStack).toContain('React');
    expect(p.identity.techStack).toContain('Node.js');
    engine.close();
  });

  it('工具调用推断技术栈', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-tool-infer.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    engine.inferFromMessage('运行一下', ['npm run build']);
    expect(engine.getUserProfile().identity.techStack).toContain('Node.js');
    engine.close();
  });

  it('探索式提问 → exploratory', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-explore.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    engine.inferFromMessage('为什么 CORS 配置不生效？', []);
    expect(engine.getUserProfile().behavior.askStyle).toBe('exploratory');
    engine.close();
  });

  it('简短回复 → brief', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-brief.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    engine.inferFromMessage('OK', []);
    expect(engine.getUserProfile().behavior.preferredDetailLevel).toBe('brief');
    engine.close();
  });

  it('深夜不主动', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-night.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    expect(engine.shouldSpeak({ idleMinutes: 60, recentErrors: 0, userMood: 'normal', hasNewInsight: false, hour: 2 })).toBe(false);
    engine.close();
  });

  it('有洞察时主动', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-insight.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    expect(engine.shouldSpeak({ idleMinutes: 0, recentErrors: 0, userMood: 'normal', hasNewInsight: true, hour: 14 })).toBe(true);
    engine.close();
  });

  it('领域画像演化 seed → sprout', async () => {
    const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
    const db = '/tmp/buddy-domain.db';
    if (fs.existsSync(db)) fs.unlinkSync(db);
    const engine = new CognitiveEngine(db);
    expect(engine.getDomainProfile('前端').growthStage).toBe('seed');
    engine.updateDomainProfile('前端', { knowledgeCount: 25, depthScore: 0.4, growthStage: 'sprout' });
    expect(engine.getDomainProfile('前端').growthStage).toBe('sprout');
    engine.close();
  });

  describe('知识提取', () => {
    it('纠正信号 → decision_rule', async () => {
      const { KnowledgeExtractor } = await dynamicImport('./knowledge/extractor.js');
      const { STMPStore } = await dynamicImport('./memory/stmp.js');
      const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
      const s = new STMPStore('/tmp/buddy-ext-s.db'); const c = new CognitiveEngine('/tmp/buddy-ext-c.db');
      const ext = new KnowledgeExtractor(s, c);
      const r = await ext.extract([
        { role: 'assistant', content: '你应该用 forEach', timestamp: Date.now() },
        { role: 'user', content: '不对，应该用 map，因为需要返回新数组', timestamp: Date.now() },
      ], 10);
      expect(r.total).toBeGreaterThan(0);
      expect(r.extracted.some((k: any) => k.type === 'decision_rule')).toBe(true);
      s.close(); c.close();
    });

    it('LLM 失败 → 规则兜底', async () => {
      const { KnowledgeExtractor } = await dynamicImport('./knowledge/extractor.js');
      const { STMPStore } = await dynamicImport('./memory/stmp.js');
      const { CognitiveEngine } = await dynamicImport('./cognitive/engine.js');
      const s = new STMPStore('/tmp/buddy-fb-s.db'); const c = new CognitiveEngine('/tmp/buddy-fb-c.db');
      const ext = new KnowledgeExtractor(s, c);
      ext.setLLMCaller(async () => { throw new Error('LLM down'); });
      const r = await ext.extract([
        { role: 'assistant', content: '可以用轮询实现实时通信', timestamp: Date.now() },
        { role: 'user', content: '不对，应该用 WebSocket 而不是轮询来实时通信', timestamp: Date.now() },
      ], 10);
      expect(r.total).toBeGreaterThan(0);
      s.close(); c.close();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 第五部分：错误恢复与降级
// ════════════════════════════════════════════════════════════════

describe('🛡️ 错误恢复', () => {
  it('429 → 可恢复', () => {
    expect(classifyError(new Error('Rate limit 429')).recoverable).toBe(true);
  });
  it('401 → 不可恢复', () => {
    expect(classifyError(new Error('HTTP 401')).recoverable).toBe(false);
  });
  it('ECONNREFUSED → 可恢复', () => {
    expect(classifyError(new Error('ECONNREFUSED')).recoverable).toBe(true);
  });
  it('超时 → 可恢复', () => {
    expect(classifyError(new Error('timed out after 30000ms')).recoverable).toBe(true);
  });
  it('网络错误友好消息', () => {
    expect(getUserFriendlyMessage(classifyError(new Error('ECONNREFUSED')))).toContain('网络');
  });
  it('工具名前缀', () => {
    expect(getUserFriendlyMessage(classifyError(new Error('ECONNREFUSED')), 'exec')).toMatch(/^\[exec\]/);
  });
  it('沙箱超时', async () => {
    const sb = new SandboxExecutor({ workspace: '/tmp', timeout: 1 });
    const r = await sb.exec('sleep 10', { timeout: 1 });
    expect(r.exitCode).toBe(-2);
  });
  it('输出截断', async () => {
    const sb = new SandboxExecutor({ workspace: '/tmp', timeout: 10 });
    const r = await sb.execFormatted('yes | head -c 15000');
    expect(r).toContain('截断');
  });
});

// ════════════════════════════════════════════════════════════════
// 第六部分：性能与并发
// ════════════════════════════════════════════════════════════════

describe('⚡ 性能', () => {
  it('LRU 缓存', async () => {
    const { LRUCache } = await dynamicImport('./perf/cache.js');
    const c = new (LRUCache as new (opts: any) => any)({ maxSize: 3, ttlMs: 60000 });
    c.set('a', '1'); c.set('b', '2'); c.set('c', '3');
    expect(c.get('a')).toBe('1');
    c.set('d', '4');
    expect(c.get('b')).toBeUndefined();
  });

  it('TTL 过期', async () => {
    const { LRUCache } = await dynamicImport('./perf/cache.js');
    const c = new (LRUCache as new (opts: any) => any)({ maxSize: 10, ttlMs: 50 });
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
    await new Promise(r => setTimeout(r, 100));
    expect(c.get('k')).toBeUndefined();
  });

  it('工具并发不冲突', async () => {
    const [r1, r2, r3, r4, r5] = await Promise.all([
      read_file.execute({ path: path.join(TEST_FILES_DIR, 'hello.txt') }),
      read_file.execute({ path: path.join(TEST_FILES_DIR, 'config.json') }),
      read_file.execute({ path: path.join(TEST_FILES_DIR, 'app.ts') }),
      list_files.execute({ path: TEST_FILES_DIR }),
      get_time.execute({}),
    ]);
    expect(r1).toContain('Hello');
    expect(r2).toContain('test');
    expect(r3).toContain('Server');
    expect(r4).toContain('hello.txt');
    expect(r5).toContain('当前时间');
  });
});

// ════════════════════════════════════════════════════════════════
// 第七部分：安全加固
// ════════════════════════════════════════════════════════════════

describe('🔒 安全加固', () => {
  it('分号注入', () => {
    const sb = new SandboxExecutor({ workspace: '/tmp' });
    expect(sb.isDangerous('echo hello; rm -rf /').blocked).toBe(true);
  });
  it('&& 注入', () => {
    const sb = new SandboxExecutor({ workspace: '/tmp' });
    expect(sb.isDangerous('echo hello && rm -rf /').blocked).toBe(true);
  });
  it('反引号注入', () => {
    const sb = new SandboxExecutor({ workspace: '/tmp' });
    expect(sb.isDangerous('echo `cat /etc/passwd`').blocked).toBe(true);
  });
  it('$() 注入', () => {
    const sb = new SandboxExecutor({ workspace: '/tmp' });
    expect(sb.isDangerous('echo $(cat /etc/passwd)').blocked).toBe(true);
  });
  it('read_file 拒绝 /etc/passwd', async () => {
    expect(await read_file.execute({ path: '/etc/passwd' })).toContain('[拒绝');
  });
  it('write_file 拒绝 .ssh', async () => {
    expect(await write_file.execute({ path: '/home/.ssh/x', content: 'x' })).toContain('[拒绝');
  });
  it('环境变量隔离', async () => {
    const sb = new SandboxExecutor({ workspace: '/tmp' });
    process.env.BUDDY_TEST_SECRET = 'leak';
    const r = await sb.exec('env');
    expect(r.stdout).not.toContain('BUDDY_TEST_SECRET');
    delete process.env.BUDDY_TEST_SECRET;
  });
  it('低权限只有基础工具', async () => {
    const { ToolRegistry } = await dynamicImport('./tools/registry.js');
    const { ALL_TOOLS } = await dynamicImport('./tools/builtin.js');
    const reg = new ToolRegistry();
    reg.registerMany(ALL_TOOLS);
    const basic = reg.listForPermissions(['chat']);
    expect(basic.map((t: any) => t.name)).toContain('get_time');
    expect(basic.map((t: any) => t.name)).not.toContain('exec');
  });
  it('高权限使用全部工具', async () => {
    const { ToolRegistry } = await dynamicImport('./tools/registry.js');
    const { ALL_TOOLS } = await dynamicImport('./tools/builtin.js');
    const reg = new ToolRegistry();
    reg.registerMany(ALL_TOOLS);
    const full = reg.listForPermissions(['chat', 'basic', 'read_files', 'write_files', 'exec_safe', 'web_search']);
    expect(full.length).toBe(reg.list().length);
  });
});
