import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BeliefStore } from './belief-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('BeliefStore', () => {
  let store: BeliefStore;

  beforeEach(() => {
    store = new BeliefStore();
  });

  // ── 添加信念 ──

  describe('addBelief', () => {
    it('创建新信念（inferred 低置信度）', () => {
      const belief = store.addBelief('用户偏好 TypeScript', 'inferred');
      expect(belief.statement).toBe('用户偏好 TypeScript');
      expect(belief.confidence).toBe(0.3);
      expect(belief.source).toBe('inferred');
      expect(store.size).toBe(1);
    });

    it('创建新信念（told 高置信度）', () => {
      const belief = store.addBelief('项目使用 React', 'told');
      expect(belief.confidence).toBe(0.7);
    });

    it('创建新信念（observed 中置信度）', () => {
      const belief = store.addBelief('用户喜欢简洁风格', 'observed');
      expect(belief.confidence).toBe(0.5);
    });

    it('重复信念增加置信度', () => {
      store.addBelief('A 是真的', 'inferred');
      store.addBelief('A 是真的', 'inferred');
      const beliefs = store.retrieve('A');
      expect(beliefs.length).toBe(1);
      expect(beliefs[0].confidence).toBeGreaterThan(0.3);
    });
  });

  // ── 证据 ──

  describe('addEvidence', () => {
    it('添加支撑证据', () => {
      store.addBelief('用户喜欢 dark mode');
      store.addEvidence('用户喜欢 dark mode', '用户之前选择了暗色主题');
      const beliefs = store.retrieve('dark mode');
      expect(beliefs[0].evidence).toContain('用户之前选择了暗色主题');
      expect(beliefs[0].confidence).toBeGreaterThan(0.3);
    });

    it('不添加重复证据', () => {
      store.addBelief('X');
      store.addEvidence('X', '证据1');
      store.addEvidence('X', '证据1');
      const beliefs = store.retrieve('X');
      expect(beliefs[0].evidence.length).toBe(1);
    });

    it('对不存在的信念不报错', () => {
      expect(() => store.addEvidence('不存在', '证据')).not.toThrow();
    });
  });

  // ── 反驳 ──

  describe('addContradiction', () => {
    it('添加反驳证据降低置信度', () => {
      store.addBelief('Python 是最佳语言');
      const before = store.retrieve('Python')[0].confidence;
      store.addContradiction('Python 是最佳语言', '用户说 Rust 更好');
      const after = store.retrieve('Python')[0].confidence;
      expect(after).toBeLessThan(before);
      expect(store.retrieve('Python')[0].contradictedBy).toContain('用户说 Rust 更好');
    });

    it('置信度低于 0.1 自动删除', () => {
      store.addBelief('假命题', 'inferred'); // confidence = 0.3
      // 多次反驳
      for (let i = 0; i < 5; i++) {
        store.addContradiction('假命题', `反驳${i}`);
      }
      const beliefs = store.retrieve('假命题');
      expect(beliefs.length).toBe(0);
    });
  });

  // ── 检索 ──

  describe('retrieve', () => {
    it('关键词匹配', () => {
      store.addBelief('React 组件化开发模式');
      store.addBelief('Python 数据分析');
      const results = store.retrieve('React');
      expect(results.length).toBe(1);
      expect(results[0].statement).toContain('React');
    });

    it('按置信度排序', () => {
      store.addBelief('A 是事实', 'told');       // 0.7
      store.addBelief('A 很重要', 'inferred');    // 0.3
      const results = store.retrieve('A');
      expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence);
    });

    it('最多返回 5 条', () => {
      for (let i = 0; i < 10; i++) {
        store.addBelief(`测试信念${i}`);
      }
      const results = store.retrieve('测试');
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  // ── Prompt 注入 ──

  describe('buildPromptInjection', () => {
    it('空信念返回空', () => {
      expect(store.buildPromptInjection([])).toBe('');
    });

    it('低于 0.3 置信度不注入', () => {
      const belief = store.addBelief('不确定的事', 'inferred'); // 0.3
      const prompt = store.buildPromptInjection([belief]);
      expect(prompt).toBe('');
    });

    it('高置信度生成注入', () => {
      const belief = store.addBelief('项目使用 React', 'told'); // 0.7
      const prompt = store.buildPromptInjection([belief]);
      expect(prompt).toContain('已知信念');
      expect(prompt).toContain('React');
      expect(prompt).toContain('70%');
    });
  });

  // ── 淘汰 ──

  it('超过 MAX_BELIEFS 淘汰最低置信度', () => {
    for (let i = 0; i < 105; i++) {
      store.addBelief(`信念${i}`, 'inferred');
    }
    expect(store.size).toBeLessThanOrEqual(100);
  });

  // ── Sprint 4: 持久化 ──

  describe('Sprint 4: saveToDisk / loadFromDisk 持久化', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belief-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('保存后文件存在', () => {
      store.addBelief('React 是好框架');
      store.saveToDisk(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'belief-store.json'))).toBe(true);
    });

    it('保存后恢复数据', () => {
      store.addBelief('TypeScript 比 JavaScript 好', 'told');
      store.addBelief('Python 适合数据分析', 'observed');
      store.saveToDisk(tmpDir);

      const newStore = new BeliefStore();
      newStore.loadFromDisk(tmpDir);

      expect(newStore.size).toBe(store.size);
      const beliefs = newStore.retrieve('TypeScript');
      expect(beliefs.length).toBe(1);
      expect(beliefs[0].confidence).toBe(0.7);
    });

    it('恢复后证据保持', () => {
      store.addBelief('dark mode 更护眼');
      store.addEvidence('dark mode 更护眼', '医学研究证明');
      store.saveToDisk(tmpDir);

      const newStore = new BeliefStore();
      newStore.loadFromDisk(tmpDir);
      const beliefs = newStore.retrieve('dark mode');
      expect(beliefs[0].evidence).toContain('医学研究证明');
    });

    it('无快照文件时不报错', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
      const newStore = new BeliefStore();
      expect(() => newStore.loadFromDisk(emptyDir)).not.toThrow();
      expect(newStore.size).toBe(0);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('损坏的 JSON 不崩溃', () => {
      fs.writeFileSync(path.join(tmpDir, 'belief-store.json'), '{broken}');
      const newStore = new BeliefStore();
      expect(() => newStore.loadFromDisk(tmpDir)).not.toThrow();
      expect(newStore.size).toBe(0);
    });
  });
});
