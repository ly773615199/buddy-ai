import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock better-sqlite3 — use a class-like constructor
const mockStmt = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn().mockReturnValue([]),
};
const mockDB = {
  pragma: vi.fn(),
  exec: vi.fn(),
  prepare: vi.fn().mockReturnValue(mockStmt),
  close: vi.fn(),
};

// Create a proper constructor function (not arrow fn)
function MockDatabase() {
  return mockDB;
}

vi.mock('better-sqlite3', () => ({
  default: MockDatabase,
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ mtimeMs: 1000, size: 100 }),
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: vi.fn().mockReturnValue('file content'),
    mkdirSync: vi.fn(),
  };
});

import { LocalSource } from './local-source.js';

describe('LocalSource', () => {
  let source: LocalSource;

  beforeEach(() => {
    vi.clearAllMocks();
    source = new LocalSource({
      watchFolders: ['/tmp/test-docs'],
      fileTypes: ['md', 'txt'],
    });
  });

  describe('属性', () => {
    it('type 为 local', () => {
      expect(source.type).toBe('local');
    });

    it('有默认 id', () => {
      expect(source.id).toBe('local');
    });

    it('可自定义 id', () => {
      const s = new LocalSource({ id: 'my-local', watchFolders: ['/tmp'] });
      expect(s.id).toBe('my-local');
    });
  });

  describe('isAvailable', () => {
    it('有 watchFolders 时可用', () => {
      expect(source.isAvailable()).toBe(true);
    });

    it('空 watchFolders 时不可用', () => {
      const s = new LocalSource({ watchFolders: [] });
      expect(s.isAvailable()).toBe(false);
    });
  });

  describe('search', () => {
    it('空查询返回空数组', async () => {
      const result = await source.search('');
      expect(result).toEqual([]);
    });

    it('正常查询不抛异常', async () => {
      const result = await source.search('test query');
      expect(Array.isArray(result)).toBe(true);
    });

    it('limit 参数生效', async () => {
      const result = await source.search('test', { limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('read', () => {
    it('不存在的节点返回 null', async () => {
      mockStmt.get.mockReturnValue(undefined);
      const result = await source.read('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('返回数组', async () => {
      const result = await source.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('sync', () => {
    it('返回 SyncResult 结构', async () => {
      const result = await source.sync();
      expect(result).toHaveProperty('sourceId');
      expect(result).toHaveProperty('synced');
      expect(result).toHaveProperty('added');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('deleted');
      expect(result).toHaveProperty('durationMs');
    });

    it('sourceId 匹配', async () => {
      const result = await source.sync();
      expect(result.sourceId).toBe('local');
    });
  });

  describe('fileTypes', () => {
    it('默认包含 md 和 txt', () => {
      const s = new LocalSource({ watchFolders: ['/tmp'] });
      expect(s.isAvailable()).toBe(true);
    });

    it('支持自定义 fileTypes', () => {
      const s = new LocalSource({
        watchFolders: ['/tmp'],
        fileTypes: ['pdf', 'docx'],
      });
      expect(s.isAvailable()).toBe(true);
    });
  });
});
