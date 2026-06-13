import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityStore } from './entity-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityStore', () => {
  let store: EntityStore;

  beforeEach(() => {
    store = new EntityStore();
  });

  // ── 提取 ──

  describe('extractAndUpdate', () => {
    it('提取技术栈实体', () => {
      const entities = store.extractAndUpdate('我们用 React 和 TypeScript 开发前端');
      const techs = entities.filter(e => e.type === 'technology');
      expect(techs.length).toBeGreaterThanOrEqual(1);
      const names = techs.map(e => e.name.toLowerCase());
      expect(names.some(n => n.includes('react') || n.includes('typescript'))).toBe(true);
    });

    it('提取引号中的概念', () => {
      const entities = store.extractAndUpdate('这个「微服务架构」需要拆分');
      expect(entities.some(e => e.name === '微服务架构')).toBe(true);
    });

    it('提取大写开头名词', () => {
      const entities = store.extractAndUpdate('Buddy 是一个 AI 助手项目');
      expect(entities.some(e => e.name === 'Buddy')).toBe(true);
    });

    it('每次最多提取 10 个', () => {
      const text = 'React Vue Angular TypeScript JavaScript Python Rust Go Java Swift Kotlin';
      const entities = store.extractAndUpdate(text);
      expect(entities.length).toBeLessThanOrEqual(10);
    });
  });

  // ── 更新 ──

  describe('更新已有实体', () => {
    it('重复提及增加计数', () => {
      store.extractAndUpdate('React 很好用');
      store.extractAndUpdate('React 组件化开发');
      const entity = store.get('React');
      expect(entity).toBeDefined();
      expect(entity!.mentionCount).toBe(2);
    });

    it('累积事实', () => {
      store.extractAndUpdate('Docker 用于容器化部署');
      store.extractAndUpdate('Docker 支持多阶段构建');
      const entity = store.get('Docker');
      expect(entity).toBeDefined();
      expect(entity!.facts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 情感 ──

  describe('updateSentiment', () => {
    it('更新实体情感', () => {
      store.extractAndUpdate('Python 很好');
      store.updateSentiment('Python', 0.5);
      const entity = store.get('Python');
      expect(entity!.sentiment).toBe(0.5);
    });

    it('情感值限制在 [-1, 1]', () => {
      store.extractAndUpdate('Java');
      store.updateSentiment('Java', 2);
      const entity = store.get('Java');
      expect(entity!.sentiment).toBe(1);
    });
  });

  // ── 查询 ──

  describe('search', () => {
    it('模糊搜索', () => {
      store.extractAndUpdate('TypeScript 类型系统很强大');
      const results = store.search('TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('搜索事实内容', () => {
      store.extractAndUpdate('Docker 用于容器化');
      const results = store.search('容器化');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAll', () => {
    it('按提及次数排序', () => {
      store.extractAndUpdate('Alpha 和 Beta');
      store.extractAndUpdate('Alpha 再次出现');
      store.extractAndUpdate('Alpha 第三次');
      const all = store.getAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all[0].mentionCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Prompt 注入 ──

  describe('buildPromptInjection', () => {
    it('空实体返回空', () => {
      expect(store.buildPromptInjection([])).toBe('');
    });

    it('生成实体摘要', () => {
      store.extractAndUpdate('React 用于构建 UI');
      const all = store.getAll();
      const prompt = store.buildPromptInjection(all);
      expect(prompt).toContain('已知实体');
      expect(prompt).toContain('React');
    });
  });

  // ── 淘汰 ──

  it('超过 MAX_ENTITIES 淘汰最旧的', () => {
    for (let i = 0; i < 205; i++) {
      store.extractAndUpdate(`Entity${i} 是一个测试实体`);
    }
    expect(store.size).toBeLessThanOrEqual(200);
  });

  // ── Sprint 4: 持久化 ──

  describe('Sprint 4: saveToDisk / loadFromDisk 持久化', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('保存后文件存在', () => {
      store.extractAndUpdate('React 是前端框架');
      store.saveToDisk(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'entity-store.json'))).toBe(true);
    });

    it('保存后恢复数据', () => {
      store.extractAndUpdate('Docker 用于容器化部署');
      store.extractAndUpdate('TypeScript 类型系统');
      store.saveToDisk(tmpDir);

      const newStore = new EntityStore();
      newStore.loadFromDisk(tmpDir);

      expect(newStore.size).toBe(store.size);
      expect(newStore.get('Docker')).toBeDefined();
      expect(newStore.get('TypeScript')).toBeDefined();
    });

    it('恢复后 mentionCount 保持', () => {
      store.extractAndUpdate('React 很好');
      store.extractAndUpdate('React 再次提及');
      store.saveToDisk(tmpDir);

      const newStore = new EntityStore();
      newStore.loadFromDisk(tmpDir);
      const entity = newStore.get('React');
      expect(entity).toBeDefined();
      expect(entity!.mentionCount).toBe(2);
    });

    it('无快照文件时不报错', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
      const newStore = new EntityStore();
      expect(() => newStore.loadFromDisk(emptyDir)).not.toThrow();
      expect(newStore.size).toBe(0);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('损坏的 JSON 不崩溃', () => {
      fs.writeFileSync(path.join(tmpDir, 'entity-store.json'), 'not json');
      const newStore = new EntityStore();
      expect(() => newStore.loadFromDisk(tmpDir)).not.toThrow();
      expect(newStore.size).toBe(0);
    });
  });
});
