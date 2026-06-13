import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MemoryStore } from './store.js';
import * as fs from 'fs';

const TEST_DB = `/tmp/buddy-test-store-${Date.now()}.db`;
let store: MemoryStore;

beforeAll(() => {
  store = new MemoryStore(TEST_DB);
});

afterAll(() => {
  store.close();
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
});

// ==================== Messages ====================

describe('addMessage & getRecentMessages', () => {
  it('插入消息后可通过 getRecentMessages 读取', () => {
    store.addMessage('user', '你好');
    store.addMessage('assistant', '你好！有什么可以帮你的？');
    const msgs = store.getRecentMessages(10);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[msgs.length - 2].role).toBe('user');
    expect(msgs[msgs.length - 2].content).toBe('你好');
    expect(msgs[msgs.length - 1].role).toBe('assistant');
    expect(msgs[msgs.length - 1].content).toBe('你好！有什么可以帮你的？');
  });

  it('返回顺序是 oldest first（反转的）', () => {
    const msgs = store.getRecentMessages(100);
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].timestamp).toBeGreaterThanOrEqual(msgs[i - 1].timestamp);
    }
  });

  it('count 限制返回数量', () => {
    const msgs = store.getRecentMessages(1);
    expect(msgs.length).toBe(1);
  });

  it('不同 sessionId 隔离', () => {
    store.addMessage('user', 'session-a-msg', 'sessionA');
    store.addMessage('user', 'session-b-msg', 'sessionB');
    const a = store.getRecentMessages(100, 'sessionA');
    const b = store.getRecentMessages(100, 'sessionB');
    expect(a.some(m => m.content === 'session-a-msg')).toBe(true);
    expect(a.some(m => m.content === 'session-b-msg')).toBe(false);
    expect(b.some(m => m.content === 'session-b-msg')).toBe(true);
    expect(b.some(m => m.content === 'session-a-msg')).toBe(false);
  });

  it('默认 sessionId 是 default', () => {
    store.addMessage('user', 'default-session-msg');
    const msgs = store.getRecentMessages(100, 'default');
    expect(msgs.some(m => m.content === 'default-session-msg')).toBe(true);
  });
});

// ==================== Memories ====================

describe('setMemory & getMemory', () => {
  it('插入新记忆', () => {
    store.setMemory('facts', 'capital', '北京');
    expect(store.getMemory('facts', 'capital')).toBe('北京');
  });

  it('upsert 更新已有记忆的 value', () => {
    store.setMemory('facts', 'capital', '北京');
    store.setMemory('facts', 'capital', 'Beijing');
    expect(store.getMemory('facts', 'capital')).toBe('Beijing');
  });

  it('upsert 更新已有记忆的 importance', () => {
    store.setMemory('prefs', 'color', 'blue', 3);
    store.setMemory('prefs', 'color', 'red', 8);
    const mems = store.getMemoriesByCategory('prefs');
    const colorMem = mems.find(m => m.key === 'color');
    expect(colorMem?.value).toBe('red');
    expect(colorMem?.importance).toBe(8);
  });

  it('getMemory 返回 null 用于不存在的 key', () => {
    expect(store.getMemory('nonexistent', 'key')).toBeNull();
  });

  it('默认 importance 是 1', () => {
    store.setMemory('test', 'default-imp', 'val');
    const mems = store.getMemoriesByCategory('test');
    const found = mems.find(m => m.key === 'default-imp');
    expect(found?.importance).toBe(1);
  });
});

describe('getMemoriesByCategory', () => {
  it('按 importance DESC 排序', () => {
    store.setMemory('sorted', 'low', 'a', 1);
    store.setMemory('sorted', 'mid', 'b', 5);
    store.setMemory('sorted', 'high', 'c', 10);
    const mems = store.getMemoriesByCategory('sorted');
    expect(mems.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < mems.length; i++) {
      expect(mems[i].importance).toBeLessThanOrEqual(mems[i - 1].importance);
    }
  });

  it('不存在的 category 返回空数组', () => {
    expect(store.getMemoriesByCategory('empty_cat_xyz')).toEqual([]);
  });
});

describe('searchMemories', () => {
  it('FTS5 全文搜索能找到记忆', () => {
    store.setMemory('search_test', 'sunny', 'the weather is sunny and warm today');
    store.setMemory('search_test', 'noodles', 'had a bowl of noodles for lunch');
    const results = store.searchMemories('weather');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.value.includes('weather'))).toBe(true);
  });

  it('返回结果包含 rank', () => {
    const results = store.searchMemories('noodles');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty('rank');
    expect(typeof results[0].rank).toBe('number');
  });

  it('limit 参数限制返回数量', () => {
    const results = store.searchMemories('weather OR noodles', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('空查询返回空数组（不崩溃）', () => {
    const results = store.searchMemories('');
    expect(Array.isArray(results)).toBe(true);
  });

  it('无匹配返回空数组', () => {
    const results = store.searchMemories('zzzzzznonexistent999');
    expect(results).toEqual([]);
  });
});

// ==================== Diary ====================

describe('diary', () => {
  it('addDiaryEntry 插入日记', () => {
    store.addDiaryEntry('今天很开心', 'happy', '2025-01-01');
    const entry = store.getDiaryEntry('2025-01-01');
    expect(entry).not.toBeNull();
    expect(entry!.content).toBe('今天很开心');
    expect(entry!.mood).toBe('happy');
  });

  it('同一天 upsert 追加内容', () => {
    store.addDiaryEntry('上午学习了', 'neutral', '2025-01-02');
    store.addDiaryEntry('下午跑步了', 'happy', '2025-01-02');
    const entry = store.getDiaryEntry('2025-01-02');
    expect(entry).not.toBeNull();
    expect(entry!.content).toContain('上午学习了');
    expect(entry!.content).toContain('下午跑步了');
    // mood 更新为最新
    expect(entry!.mood).toBe('happy');
  });

  it('默认 mood 是 neutral', () => {
    store.addDiaryEntry('默认心情', undefined, '2025-01-03');
    const entry = store.getDiaryEntry('2025-01-03');
    expect(entry!.mood).toBe('neutral');
  });

  it('getDiaryEntry 不存在的日期返回 null', () => {
    expect(store.getDiaryEntry('1999-12-31')).toBeNull();
  });
});

// ==================== Relationship ====================

describe('relationship', () => {
  it('getRelation 返回 0 对于不存在的 key', () => {
    expect(store.getRelation('nonexistent_rel')).toBe(0);
  });

  it('setRelation 设置值', () => {
    store.setRelation('trust', 42);
    expect(store.getRelation('trust')).toBe(42);
  });

  it('setRelation 可覆盖', () => {
    store.setRelation('trust', 42);
    store.setRelation('trust', 80);
    expect(store.getRelation('trust')).toBe(80);
  });

  it('addRelation 增加 delta', () => {
    store.setRelation('affinity', 10);
    const newVal = store.addRelation('affinity', 5);
    expect(newVal).toBe(15);
    expect(store.getRelation('affinity')).toBe(15);
  });

  it('addRelation 下限为 0', () => {
    store.setRelation('bounded', 5);
    const newVal = store.addRelation('bounded', -100);
    expect(newVal).toBe(0);
    expect(store.getRelation('bounded')).toBe(0);
  });

  it('addRelation 上限为 100', () => {
    store.setRelation('bounded2', 95);
    const newVal = store.addRelation('bounded2', 20);
    expect(newVal).toBe(100);
    expect(store.getRelation('bounded2')).toBe(100);
  });
});

// ==================== Interactions & Stats ====================

describe('incrementInteraction', () => {
  it('递增 total_interactions', () => {
    const before = store.getRelation('total_interactions');
    const result = store.incrementInteraction();
    expect(result).toBe(before + 1);
    expect(store.getRelation('total_interactions')).toBe(before + 1);
  });
});

describe('getStats', () => {
  it('返回正确的统计结构', () => {
    const stats = store.getStats();
    expect(stats).toHaveProperty('messages');
    expect(stats).toHaveProperty('memories');
    expect(stats).toHaveProperty('diaryEntries');
    expect(stats).toHaveProperty('interactions');
    expect(typeof stats.messages).toBe('number');
    expect(typeof stats.memories).toBe('number');
    expect(typeof stats.diaryEntries).toBe('number');
    expect(typeof stats.interactions).toBe('number');
  });

  it('统计数据大于 0（因为前面的测试已经插入了数据）', () => {
    const stats = store.getStats();
    expect(stats.messages).toBeGreaterThan(0);
    expect(stats.memories).toBeGreaterThan(0);
    expect(stats.diaryEntries).toBeGreaterThan(0);
    expect(stats.interactions).toBeGreaterThan(0);
  });
});

// ==================== Close ====================

describe('close', () => {
  it('关闭数据库后操作会报错', () => {
    const tmpStore = new MemoryStore(`/tmp/buddy-test-close-${Date.now()}.db`);
    tmpStore.close();
    expect(() => tmpStore.addMessage('user', 'test')).toThrow();
  });
});
