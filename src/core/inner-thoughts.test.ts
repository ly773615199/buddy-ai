import { describe, it, expect, beforeEach } from 'vitest';
import { InnerThoughtsEngine } from './inner-thoughts.js';

describe('InnerThoughtsEngine', () => {
  let engine: InnerThoughtsEngine;

  beforeEach(() => {
    engine = new InnerThoughtsEngine();
  });

  // ── 困惑检测 ──

  describe('用户困惑检测', () => {
    it('检测不确定表达', () => {
      const thoughts = engine.onUserMessage('这个可能是 API 的问题吧', []);
      const confusion = thoughts.filter(t => t.category === 'confusion');
      expect(confusion.length).toBeGreaterThanOrEqual(1);
    });

    it('确定表达不触发', () => {
      const thoughts = engine.onUserMessage('读取 src/main.ts 文件', []);
      const confusion = thoughts.filter(t => t.category === 'confusion');
      expect(confusion.length).toBe(0);
    });
  });

  // ── 技术术语检测 ──

  describe('技术术语检测', () => {
    it('检测技术术语', () => {
      const thoughts = engine.onUserMessage('怎么配置 Docker 和 K8s', []);
      const gaps = thoughts.filter(t => t.category === 'knowledge_gap');
      expect(gaps.length).toBeGreaterThanOrEqual(1);
      expect(gaps[0].content).toContain('Docker');
    });

    it('无术语不触发', () => {
      const thoughts = engine.onUserMessage('今天天气怎么样', []);
      const gaps = thoughts.filter(t => t.category === 'knowledge_gap');
      expect(gaps.length).toBe(0);
    });
  });

  // ── 连续同类问题检测 ──

  describe('连续同类问题', () => {
    it('连续 3 次同类问题触发总结', () => {
      // 使用相同的话题词，让 extractTopic 产生相同的 topic
      engine.onUserMessage('Docker 安装', []);
      engine.onUserMessage('Docker 镜像', []);
      const thoughts = engine.onUserMessage('Docker 容器', []);
      const patterns = thoughts.filter(t => t.category === 'pattern');
      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(patterns[0].urgency).toBeGreaterThan(0.6);
    });
  });

  // ── 错误信息检测 ──

  describe('错误信息检测', () => {
    it('检测 HTML 是编程语言的说法', () => {
      const thoughts = engine.onUserMessage('HTML 是最好的编程语言', []);
      const corrections = thoughts.filter(t => t.category === 'correction');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 思考队列 ──

  describe('思考队列', () => {
    it('高紧急度进入队列', () => {
      // 连续问同类问题触发高紧急度
      engine.onUserMessage('Git 用法', []);
      engine.onUserMessage('Git 提交', []);
      engine.onUserMessage('Git 推送', []);
      const interjection = engine.getInterjection();
      expect(interjection).toBeTruthy();
      expect(interjection).toContain('💭');
    });

    it('低紧急度不进入队列', () => {
      engine.onUserMessage('读取文件', []);
      const interjection = engine.getInterjection();
      expect(interjection).toBeNull();
    });

    it('队列消耗后清空', () => {
      engine.onUserMessage('Git 用法', []);
      engine.onUserMessage('Git 提交', []);
      engine.onUserMessage('Git 推送', []);
      engine.getInterjection();
      const second = engine.getInterjection();
      expect(second).toBeNull();
    });
  });

  // ── 统计 ──

  describe('getStats', () => {
    it('返回队列状态', () => {
      const stats = engine.getStats();
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('pending');
    });
  });
});
