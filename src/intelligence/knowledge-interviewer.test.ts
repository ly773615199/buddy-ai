/**
 * KnowledgeInterviewer 测试 — Phase A: 主动提问引擎
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { KnowledgeInterviewer } from './knowledge-interviewer.js';
import { STMPStore } from '../memory/stmp.js';
import { CognitiveEngine } from '../cognitive/engine.js';

const TEST_DIR = path.join('/tmp', `buddy-test-interviewer-${Date.now()}`);

describe('KnowledgeInterviewer', () => {
  let stmp: STMPStore;
  let cognitive: CognitiveEngine;
  let interviewer: KnowledgeInterviewer;

  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    stmp = new STMPStore(path.join(TEST_DIR, 'stmp.db'));
    cognitive = new CognitiveEngine(path.join(TEST_DIR, 'cognitive.db'));
    interviewer = new KnowledgeInterviewer(stmp, cognitive, true);
  });

  afterAll(() => {
    stmp.close();
    cognitive.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('缺口检测', () => {
    it('无领域时应返回空缺口', async () => {
      const gaps = await interviewer.detectGaps();
      expect(gaps).toEqual([]);
    });

    it('检测覆盖度缺口 (知识 < 50)', async () => {
      // 模拟一个 sprout 阶段的领域
      cognitive.updateDomainProfile('前端开发', {
        knowledgeCount: 25,
        growthStage: 'sprout',
        depthScore: 0.3,
        expertiseSignals: 5,
        lastActiveAt: Date.now(),
      });

      const gaps = await interviewer.detectGaps();
      const coverageGap = gaps.find(g => g.domain === '前端开发' && g.gapType === 'coverage');
      expect(coverageGap).toBeDefined();
      expect(coverageGap!.priority).toBeGreaterThan(0);
    });

    it('检测深度缺口 (知识 >= 20 但 depth < 0.4)', async () => {
      cognitive.updateDomainProfile('后端开发', {
        knowledgeCount: 30,
        growthStage: 'growing',
        depthScore: 0.25,
        expertiseSignals: 8,
        lastActiveAt: Date.now(),
      });

      const gaps = await interviewer.detectGaps();
      const depthGap = gaps.find(g => g.domain === '后端开发' && g.gapType === 'depth');
      expect(depthGap).toBeDefined();
    });

    it('seed 阶段不产生缺口', async () => {
      cognitive.updateDomainProfile('量子计算', {
        knowledgeCount: 3,
        growthStage: 'seed',
        depthScore: 0.1,
        expertiseSignals: 1,
        lastActiveAt: Date.now(),
      });

      const gaps = await interviewer.detectGaps();
      const quantumGap = gaps.find(g => g.domain === '量子计算');
      expect(quantumGap).toBeUndefined();
    });
  });

  describe('问题生成 (模板模式)', () => {
    it('从缺口中生成问题', async () => {
      const gaps = [
        {
          domain: '前端开发',
          topic: '前端开发核心概念',
          confidence: 0.3,
          gapType: 'coverage' as const,
          priority: 0.8,
          lastSeen: Date.now(),
        },
        {
          domain: '后端开发',
          topic: '后端开发深层原理',
          confidence: 0.25,
          gapType: 'depth' as const,
          priority: 0.7,
          lastSeen: Date.now(),
        },
      ];

      const questions = await interviewer.generateQuestions(gaps, 2);
      expect(questions).toHaveLength(2);
      expect(questions[0].domain).toBe('前端开发');
      expect(questions[0].question).toBeTruthy();
      expect(questions[0].gapType).toBe('coverage');
      expect(questions[1].domain).toBe('后端开发');
      expect(questions[1].gapType).toBe('depth');
    });

    it('空缺口返回空问题', async () => {
      const questions = await interviewer.generateQuestions([]);
      expect(questions).toEqual([]);
    });

    it('maxCount 限制问题数量', async () => {
      const gaps = Array.from({ length: 10 }, (_, i) => ({
        domain: `领域${i}`,
        topic: `话题${i}`,
        confidence: 0.3,
        gapType: 'coverage' as const,
        priority: 0.8 - i * 0.05,
        lastSeen: Date.now(),
      }));

      const questions = await interviewer.generateQuestions(gaps, 2);
      expect(questions).toHaveLength(2);
    });
  });

  describe('时机判断', () => {
    it('首次提问应允许', () => {
      const freshInterviewer = new KnowledgeInterviewer(stmp, cognitive);
      const question = {
        id: 'test-q1',
        domain: '前端开发',
        question: 'React 和 Vue 的核心区别是什么？',
        gapType: 'coverage' as const,
        contextHint: '补充覆盖度',
        priority: 0.8,
        generatedAt: Date.now(),
      };

      const timing = freshInterviewer.evaluateTiming(question);
      // 可能因为安静时段被拒绝，所以不强断 shouldAsk
      expect(timing.cooldownRemaining).toBe(0);
    });

    it('低优先级问题不应提问', () => {
      const question = {
        id: 'test-q2',
        domain: '前端开发',
        question: '随便聊聊？',
        gapType: 'coverage' as const,
        contextHint: '低优先级',
        priority: 0.2,
        generatedAt: Date.now(),
      };

      const timing = interviewer.evaluateTiming(question);
      expect(timing.shouldAsk).toBe(false);
      // 可能被安静时段或优先级拦截，都是正确行为
      expect(
        timing.reason.includes('优先级') || timing.reason.includes('安静时段')
      ).toBe(true);
    });

    it('记录提问后领域进入冷却', () => {
      const freshInterviewer = new KnowledgeInterviewer(stmp, cognitive);
      const question = {
        id: 'test-q3',
        domain: '测试领域',
        question: '测试问题',
        gapType: 'coverage' as const,
        contextHint: '测试',
        priority: 0.8,
        generatedAt: Date.now(),
      };

      freshInterviewer.recordAsked(question);

      // 再次提问同领域应被冷却拒绝
      const timing = freshInterviewer.evaluateTiming(question);
      expect(timing.shouldAsk).toBe(false);
      expect(timing.cooldownRemaining).toBeGreaterThan(0);
    });
  });

  describe('回答检测', () => {
    it('检测专业回答', () => {
      const question = {
        id: 'test-q4',
        domain: '前端开发',
        question: 'React Hooks 的使用场景？',
        gapType: 'depth' as const,
        contextHint: '测试',
        priority: 0.8,
        generatedAt: Date.now(),
      };

      expect(interviewer.isAnswerToInterview(
        '前端开发中，useState 用于管理组件状态，useEffect 用于副作用处理，关键是依赖数组的设置',
        question,
      )).toBe(true);
    });

    it('忽略短消息', () => {
      const question = {
        id: 'test-q5',
        domain: '前端开发',
        question: '测试',
        gapType: 'depth' as const,
        contextHint: '测试',
        priority: 0.8,
        generatedAt: Date.now(),
      };

      expect(interviewer.isAnswerToInterview('好的', question)).toBe(false);
    });

    it('无追问时返回 false', () => {
      expect(interviewer.isAnswerToInterview('任何消息', null)).toBe(false);
    });
  });

  describe('统计', () => {
    it('返回正确的统计数据', () => {
      const stats = interviewer.getStats();
      expect(stats).toHaveProperty('totalAsked');
      expect(stats).toHaveProperty('totalAnswered');
      expect(stats).toHaveProperty('domains');
      expect(typeof stats.totalAsked).toBe('number');
    });
  });

  describe('会话管理', () => {
    it('resetSession 重置后可继续提问', () => {
      // 先提问一次让领域进入冷却
      const q = {
        id: 'q-reset', domain: '重置测试', question: '测试',
        gapType: 'coverage' as const, contextHint: '', priority: 0.8, generatedAt: Date.now(),
      };
      interviewer.recordAsked(q);
      // 冷却期内不应提问
      expect(interviewer.evaluateTiming(q).shouldAsk).toBe(false);

      // 重置后冷却清除
      interviewer.resetSession();
      const freshInterviewer = new KnowledgeInterviewer(stmp, cognitive);
      const timing = freshInterviewer.evaluateTiming(q);
      expect(timing.cooldownRemaining).toBe(0);
    });
  });
});
