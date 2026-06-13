/**
 * 核心系统测试 — vitest 格式
 * 覆盖：类型系统、性格Prompt、记忆存储、工具系统、消息构建
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryStore } from './memory/store.js';
import { buildSystemPrompt, buildMessages } from './personality/prompt.js';
import { ToolRegistry } from './tools/registry.js';
import { ALL_TOOLS } from './tools/builtin.js';
import { DEFAULT_CONFIG, PRESET_PERSONALITIES, getTrustLevel, getPermissions } from './types.js';
import * as fs from 'fs';

const TEST_DB = '/tmp/buddy-test-memory-vitest.db';

describe('类型系统', () => {
  it('getTrustLevel 返回正确级别', () => {
    expect(getTrustLevel(10)).toBe('stranger');
    expect(getTrustLevel(30)).toBe('acquaintance');
    expect(getTrustLevel(60)).toBe('friend');
    expect(getTrustLevel(85)).toBe('close_friend');
    expect(getTrustLevel(100)).toBe('soulmate');
  });

  it('stranger 权限正确', () => {
    const perms = getPermissions('stranger');
    expect(perms).toContain('chat');
    expect(perms).not.toContain('exec_safe');
  });

  it('friend 权限正确', () => {
    const perms = getPermissions('friend');
    expect(perms).toContain('read_files');
    expect(perms).toContain('write_files');
  });
});

describe('性格 Prompt 生成', () => {
  it('sharp_mentor 包含名字和物种', () => {
    const config = { ...DEFAULT_CONFIG, personality: PRESET_PERSONALITIES.sharp_mentor };
    const prompt = buildSystemPrompt(config);
    expect(prompt).toContain('Buddy');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('warm_companion 自定义名字和物种', () => {
    const config = { ...DEFAULT_CONFIG, personality: PRESET_PERSONALITIES.warm_companion, name: '暖暖', species: '胖胖' };
    const prompt = buildSystemPrompt(config);
    expect(prompt).toContain('暖暖');
    expect(prompt).toContain('胖胖');
  });
});

describe('记忆存储', () => {
  let memory: MemoryStore;

  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    memory = new MemoryStore(TEST_DB);
  });

  afterAll(() => {
    memory.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('消息存储和读取', () => {
    memory.addMessage('user', '你好');
    memory.addMessage('assistant', '你好！有什么需要帮忙的吗？');
    memory.addMessage('user', '帮我看看 package.json');

    const msgs = memory.getRecentMessages(10);
    expect(msgs.length).toBe(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[2].content).toBe('帮我看看 package.json');
  });

  it('长期记忆 CRUD', () => {
    memory.setMemory('user_profile', 'language', 'TypeScript', 5);
    memory.setMemory('user_profile', 'framework', 'React', 3);
    memory.setMemory('preference', 'style', '简洁', 2);

    expect(memory.getMemory('user_profile', 'language')).toBe('TypeScript');
    expect(memory.getMemory('user_profile', 'framework')).toBe('React');

    const profiles = memory.getMemoriesByCategory('user_profile');
    expect(profiles.length).toBe(2);
  });

  it('FTS5 搜索', () => {
    memory.setMemory('knowledge', 'cors_fix', 'CORS 跨域问题通过配置 Access-Control-Allow-Origin 解决');
    memory.setMemory('knowledge', 'react_hooks', 'React Hooks 只能在函数组件顶层调用');

    const results = memory.searchMemories('CORS');
    expect(results.length).toBeGreaterThan(0);
  });

  it('日记写入和读取', () => {
    memory.addDiaryEntry('今天第一次见面！帮用户修了个 bug。', 'happy');
    const diary = memory.getDiaryEntry(new Date().toISOString().split('T')[0]);
    expect(diary).not.toBeNull();
    expect(diary!.mood).toBe('happy');
  });

  it('关系系统数值边界', () => {
    memory.setRelation('trust', 10);
    expect(memory.getRelation('trust')).toBe(10);

    memory.addRelation('trust', 5);
    expect(memory.getRelation('trust')).toBe(15);

    memory.addRelation('trust', 100);
    expect(memory.getRelation('trust')).toBe(100);

    memory.addRelation('trust', -200);
    expect(memory.getRelation('trust')).toBe(0);
  });

  it('统计信息正确', () => {
    const stats = memory.getStats();
    expect(stats.messages).toBe(3);
    expect(stats.memories).toBeGreaterThan(0);
  });
});

describe('工具系统', () => {
  let registry: ToolRegistry;

  beforeAll(() => {
    registry = new ToolRegistry();
    registry.registerMany(ALL_TOOLS);
  });

  it('注册所有工具', () => {
    expect(registry.list().length).toBe(ALL_TOOLS.length);
    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('exec')).toBeDefined();
    expect(registry.get('git_status')).toBeDefined();
    expect(registry.get('get_time')).toBeDefined();
  });

  it('权限过滤', () => {
    const basicTools = registry.listForPermissions(['chat']);
    expect(basicTools.length).toBeLessThan(registry.list().length);

    const fullTools = registry.listForPermissions(['chat', 'read_files', 'write_files', 'exec_safe', 'web_search']);
    expect(fullTools.length).toBe(registry.list().length);
  });

  it('get_time 工具执行', async () => {
    const tool = registry.get('get_time')!;
    const result = await tool.execute({});
    expect(result).toContain('当前时间');
  });

  it('list_files 工具执行', async () => {
    const tool = registry.list().find(t => t.name === 'list_files')!;
    const result = await tool.execute({ path: '/tmp' });
    expect(result.length).toBeGreaterThan(0);
  });

  it('exec 工具执行', async () => {
    const tool = registry.list().find(t => t.name === 'exec')!;
    const result = await tool.execute({ command: 'echo hello' });
    expect(result).toContain('hello');
  });

  it('危险命令拦截', async () => {
    const tool = registry.list().find(t => t.name === 'exec')!;
    const result = await tool.execute({ command: 'rm -rf /' });
    expect(result).toContain('拒绝');
  });
});

describe('消息构建', () => {
  it('构建正确消息列表', () => {
    const messages = buildMessages(
      '你是测试助手',
      [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！' },
      ],
      [{ key: '语言', value: 'TypeScript' }],
    );

    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('TypeScript');
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
  });
});
