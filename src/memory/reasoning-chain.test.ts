import { describe, it, expect, beforeEach } from 'vitest';
import { ReasoningChainStore } from './reasoning-chain.js';

describe('ReasoningChainStore', () => {
  let store: ReasoningChainStore;

  beforeEach(() => {
    store = new ReasoningChainStore();
  });

  // ── 基础操作 ──

  describe('conclude', () => {
    it('创建新推理链', () => {
      store.conclude('Docker 部署', '需要先构建镜像再推送');
      expect(store.size).toBe(1);
      const chains = store.retrieve('Docker');
      expect(chains.length).toBe(1);
      expect(chains[0].topic).toBe('Docker 部署');
      expect(chains[0].conclusions).toContain('需要先构建镜像再推送');
    });

    it('同一主题追加结论', () => {
      store.conclude('Docker', '构建镜像');
      store.conclude('Docker', '推送到 registry');
      const chains = store.retrieve('Docker');
      expect(chains.length).toBe(1);
      expect(chains[0].conclusions.length).toBe(2);
      expect(chains[0].confidence).toBeGreaterThan(0.6);
    });

    it('不同主题创建不同链', () => {
      store.conclude('Docker', '构建镜像');
      store.conclude('Git', '分支管理');
      expect(store.size).toBe(2);
    });
  });

  describe('addOpenQuestion', () => {
    it('记录未解决问题', () => {
      store.addOpenQuestion('部署', '目标服务器是什么系统？');
      const chains = store.retrieve('部署');
      expect(chains.length).toBe(1);
      expect(chains[0].openQuestions).toContain('目标服务器是什么系统？');
    });

    it('不重复添加相同问题', () => {
      store.addOpenQuestion('部署', '目标是什么？');
      store.addOpenQuestion('部署', '目标是什么？');
      const chains = store.retrieve('部署');
      expect(chains[0].openQuestions.length).toBe(1);
    });
  });

  // ── 检索 ──

  describe('retrieve', () => {
    it('关键词匹配主题', () => {
      store.conclude('TypeScript 类型系统', '泛型约束很强大');
      store.conclude('Python 装饰器', '用于元编程');
      const results = store.retrieve('TypeScript');
      expect(results.length).toBe(1);
      expect(results[0].topic).toBe('TypeScript 类型系统');
    });

    it('token 匹配结论', () => {
      store.conclude('部署流程', '需要配置 nginx 反向代理');
      const results = store.retrieve('部署流程');
      expect(results.length).toBe(1);
    });

    it('无匹配返回空', () => {
      store.conclude('Docker', '构建镜像');
      const results = store.retrieve('量子计算');
      expect(results.length).toBe(0);
    });

    it('最多返回 MAX_INJECT 条', () => {
      for (let i = 0; i < 10; i++) {
        store.conclude(`主题${i}`, `结论${i}`);
      }
      const results = store.retrieve('主题');
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ── Prompt 注入 ──

  describe('buildPromptInjection', () => {
    it('空链返回空字符串', () => {
      expect(store.buildPromptInjection([])).toBe('');
    });

    it('生成结构化注入', () => {
      store.conclude('Docker', '使用多阶段构建减小镜像');
      const chains = store.retrieve('Docker');
      const prompt = store.buildPromptInjection(chains);
      expect(prompt).toContain('跨轮推理上下文');
      expect(prompt).toContain('Docker');
      expect(prompt).toContain('多阶段构建');
    });
  });

  // ── 清理 ──

  describe('purge', () => {
    it('清理过期链', () => {
      store.conclude('旧主题', '旧结论');
      // 手动设置过期时间
      const chains = store.retrieve('旧主题');
      if (chains.length > 0) {
        (chains[0] as any).expiresAt = Date.now() - 1000;
      }
      const purged = store.purge();
      expect(purged).toBe(1);
      expect(store.size).toBe(0);
    });

    it('保留未过期链', () => {
      store.conclude('新主题', '新结论');
      const purged = store.purge();
      expect(purged).toBe(0);
      expect(store.size).toBe(1);
    });
  });

  // ── 淘汰 ──

  it('超过 MAX_CHAINS 淘汰最旧的', () => {
    for (let i = 0; i < 52; i++) {
      store.conclude(`主题${i}`, `结论${i}`);
    }
    expect(store.size).toBeLessThanOrEqual(50);
  });
});
