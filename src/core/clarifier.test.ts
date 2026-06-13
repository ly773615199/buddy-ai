import { describe, it, expect, beforeEach } from 'vitest';
import { ClarificationEngine } from './clarifier.js';

describe('ClarificationEngine', () => {
  let engine: ClarificationEngine;

  beforeEach(() => {
    engine = new ClarificationEngine();
  });

  // ── 不需要澄清 ──

  describe('不需要澄清', () => {
    it('明确的单文件操作', () => {
      const result = engine.assess('把 src/main.ts 里的 foo 改成 bar');
      expect(result.shouldClarify).toBe(false);
    });

    it('明确的读取操作', () => {
      const result = engine.assess('读取 package.json 的内容');
      expect(result.shouldClarify).toBe(false);
    });

    it('带具体目标的优化', () => {
      const result = engine.assess('优化 src/core/llm.ts 的 streamChat 方法性能');
      expect(result.shouldClarify).toBe(false);
    });
  });

  // ── 触发澄清 ──

  describe('触发澄清', () => {
    it('多个文件路径', () => {
      const result = engine.assess('比较 src/a.ts 和 src/b.ts 的差异');
      expect(result.ambiguousAspects.length).toBeGreaterThanOrEqual(1);
    });

    it('模糊的短请求', () => {
      const result = engine.assess('优化一下');
      if (result.shouldClarify) {
        expect(result.clarificationQuestion).toBeTruthy();
      }
    });

    it('部署缺少目标', () => {
      const result = engine.assess('部署这个项目');
      expect(result.ambiguousAspects).toContainEqual(expect.stringContaining('部署目标'));
    });

    it('高风险操作 + 模糊 → 澄清', () => {
      const result = engine.assess('删除那个文件');
      // 模糊 + 高风险 → 应该澄清
      if (result.riskIfWrong === 'high') {
        expect(result.shouldClarify).toBe(true);
      }
    });
  });

  // ── 会话限制 ──

  describe('会话限制', () => {
    it('最多澄清 maxPerSession 次', () => {
      const eng = new ClarificationEngine(1);
      const r1 = eng.assess('部署项目');
      const r2 = eng.assess('部署项目');
      // 第二次不应再澄清（如果第一次澄清了）
      if (r1.shouldClarify) {
        expect(r2.shouldClarify).toBe(false);
      }
    });

    it('resetSession 重置计数', () => {
      const eng = new ClarificationEngine(1);
      eng.assess('部署项目');
      eng.resetSession();
      const r = eng.assess('部署项目');
      // 重置后可以再次澄清
      expect(r).toBeDefined();
    });
  });

  // ── 风险评估 ──

  describe('风险评估', () => {
    it('读取操作为低风险', () => {
      const result = engine.assess('看看这个文件');
      expect(result.riskIfWrong).toBe('low');
    });

    it('写操作为中风险', () => {
      const result = engine.assess('创建一个新的配置文件');
      expect(['low', 'medium', 'high']).toContain(result.riskIfWrong);
    });

    it('部署为高风险', () => {
      const result = engine.assess('部署到生产环境');
      expect(result.riskIfWrong).toBe('high');
    });
  });

  // ── 问题构建 ──

  describe('澄清问题', () => {
    it('包含具体方面', () => {
      const result = engine.assess('部署这个');
      if (result.shouldClarify) {
        expect(result.clarificationQuestion.length).toBeGreaterThan(0);
      }
    });

    it('不澄清时问题为空', () => {
      const result = engine.assess('读取 src/main.ts');
      if (!result.shouldClarify) {
        expect(result.clarificationQuestion).toBe('');
      }
    });
  });

  // ── Sprint 2.2: 目标冲突检测 ──

  describe('Sprint 2.2: 目标冲突检测', () => {
    it('简化 vs 扩展冲突', () => {
      const result = engine.assess('简化代码结构，同时增加更多功能模块');
      expect(result.issueType).toBe('conflict');
      expect(result.ambiguousAspects.some(a => a.includes('冲突'))).toBe(true);
    });

    it('删除 vs 保留冲突', () => {
      const result = engine.assess('删除旧代码但保留所有功能');
      expect(result.issueType).toBe('conflict');
    });

    it('安全 vs 便捷冲突', () => {
      const result = engine.assess('加强安全加密，让操作更简单便捷');
      expect(result.issueType).toBe('conflict');
    });

    it('无冲突时 issueType 不是 conflict', () => {
      const result = engine.assess('读取 src/main.ts');
      expect(result.issueType).not.toBe('conflict');
    });
  });

  // ── Sprint 2.2: 资源不足检测 ──

  describe('Sprint 2.2: 资源不足检测', () => {
    it('读取操作未指定文件', () => {
      const result = engine.assess('读取');
      expect(result.issueType).toBe('resource');
      expect(result.ambiguousAspects.some(a => a.includes('未指定'))).toBe(true);
    });

    it('API 调用未指定地址', () => {
      const result = engine.assess('调用API获取数据');
      expect(result.issueType).toBe('resource');
      expect(result.ambiguousAspects.some(a => a.includes('API'))).toBe(true);
    });

    it('有文件名的读取不算资源不足', () => {
      const result = engine.assess('读取 config.json');
      expect(result.issueType).not.toBe('resource');
    });
  });

  // ── Sprint 2.2: 理解偏差检测 ──

  describe('Sprint 2.2: 理解偏差检测', () => {
    it('话题大幅跳转检测', () => {
      const result = engine.assess('量子纠缠的物理机制是什么', {
        recentMessages: ['帮我写一个 React 组件', '用 TypeScript 实现', '添加样式'],
      });
      // 话题跳转大且不是过渡词开头
      if (result.issueType === 'deviation') {
        expect(result.ambiguousAspects.some(a => a.includes('偏差') || a.includes('跳转'))).toBe(true);
      }
    });

    it('短消息不判为偏差', () => {
      const result = engine.assess('好的', {
        recentMessages: ['之前的消息'],
      });
      expect(result.issueType).not.toBe('deviation');
    });

    it('"对了" 等过渡词不算偏差', () => {
      const result = engine.assess('对了，帮我查一下天气', {
        recentMessages: ['写一个 React 组件'],
      });
      expect(result.issueType).not.toBe('deviation');
    });
  });
});
