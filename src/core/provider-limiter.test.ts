import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderLimiter } from './provider-limiter.js';

describe('ProviderLimiter 速率限制', () => {
  let limiter: ProviderLimiter;

  beforeEach(() => {
    limiter = new ProviderLimiter();
  });

  // ==================== 基础检查 ====================

  describe('check() 基础检查', () => {
    it('无限制时允许请求', () => {
      const result = limiter.check('openai', 'gpt-4');
      expect(result.allowed).toBe(true);
    });

    it('不同 provider/model 独立计数', () => {
      // ollama 默认 rpm=999，几乎不会超限
      const r1 = limiter.check('ollama', 'llama3');
      expect(r1.allowed).toBe(true);
      const r2 = limiter.check('openai', 'gpt-4');
      expect(r2.allowed).toBe(true);
    });

    it('自定义限制覆盖默认值', () => {
      const custom = new ProviderLimiter({ openai: { rpm: 1 } });
      // 第一次允许
      custom.record('openai', 'gpt-4', 100);
      // 第二次应超限
      const result = custom.check('openai', 'gpt-4');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('RPM');
    });
  });

  // ==================== 记录与超限 ====================

  describe('record() 与超限', () => {
    it('record 增加 RPM 和 TPM 计数', () => {
      limiter.record('openai', 'gpt-4', 1000);
      limiter.record('openai', 'gpt-4', 2000);
      const stats = limiter.getStats('openai', 'gpt-4');
      expect(stats.rpm).toBe(2);
      expect(stats.tpm).toBe(3000);
    });

    it('RPM 超限返回 allowed=false', () => {
      // openai 默认 rpm=500
      for (let i = 0; i < 500; i++) {
        limiter.record('openai', 'gpt-4', 10);
      }
      const result = limiter.check('openai', 'gpt-4');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('RPM');
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('TPM 超限返回 allowed=false', () => {
      // openai 默认 tpm=300000
      limiter.record('openai', 'gpt-4', 300001);
      const result = limiter.check('openai', 'gpt-4');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TPM');
    });
  });

  // ==================== 冷却 ====================

  describe('冷却机制', () => {
    it('recordLimitHit 触发冷却', () => {
      limiter.recordLimitHit('openai', 'gpt-4');
      const result = limiter.check('openai', 'gpt-4');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('冷却');
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('成功请求清除冷却', () => {
      limiter.recordLimitHit('openai', 'gpt-4');
      limiter.record('openai', 'gpt-4', 100);
      const result = limiter.check('openai', 'gpt-4');
      expect(result.allowed).toBe(true);
    });

    it('getStats 报告冷却状态', () => {
      limiter.recordLimitHit('openai', 'gpt-4');
      const stats = limiter.getStats('openai', 'gpt-4');
      expect(stats.inCooldown).toBe(true);
      expect(stats.cooldownRemainingMs).toBeGreaterThan(0);
    });
  });

  // ==================== 统计 ====================

  describe('getStats() / getAllStats()', () => {
    it('getStats 返回完整统计', () => {
      limiter.record('openai', 'gpt-4', 5000);
      const stats = limiter.getStats('openai', 'gpt-4');
      expect(stats).toEqual({
        rpm: 1,
        rpmLimit: 500,
        tpm: 5000,
        tpmLimit: 300000,
        inCooldown: false,
        cooldownRemainingMs: 0,
      });
    });

    it('getAllStats 列出所有被追踪的组合', () => {
      limiter.record('openai', 'gpt-4', 100);
      limiter.record('deepseek', 'deepseek-chat', 200);
      const all = limiter.getAllStats();
      expect(all.length).toBe(2);
      expect(all.map(s => s.provider).sort()).toEqual(['deepseek', 'openai']);
    });
  });

  // ==================== Provider 默认值 ====================

  describe('Provider 默认限制', () => {
    it('ollama 本地无限', () => {
      const stats = limiter.getStats('ollama', 'llama3');
      expect(stats.rpmLimit).toBe(999);
      expect(stats.tpmLimit).toBe(999999);
    });

    it('未知 provider 使用通用默认值', () => {
      const stats = limiter.getStats('unknown-provider', 'model');
      expect(stats.rpmLimit).toBe(60);
      expect(stats.tpmLimit).toBe(100000);
    });
  });
});
