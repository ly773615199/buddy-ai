import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CognitiveEngine } from './cognitive/engine.js';
import * as fs from 'fs';

const TEST_DB = '/tmp/buddy-cognitive-test.db';

describe('认知引擎 CognitiveEngine', () => {
  let engine: CognitiveEngine;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    engine = new CognitiveEngine(TEST_DB);
  });

  afterEach(() => {
    engine.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // ==================== 用户模型 ====================

  describe('getUserProfile() 用户画像', () => {
    it('返回完整默认结构', () => {
      const p = engine.getUserProfile();
      expect(p.identity.role).toBe('未知');
      expect(p.identity.techStack).toEqual([]);
      expect(p.identity.experience).toBe('mid');
      expect(p.identity.primaryLanguage).toBe('zh-CN');
      expect(p.behavior.activeHours).toEqual([9, 23]);
      expect(p.behavior.workPattern).toBe('focused');
      expect(p.behavior.askStyle).toBe('direct');
      expect(p.behavior.preferredDetailLevel).toBe('balanced');
      expect(p.behavior.errorTolerance).toBe('normal');
      expect(p.preferences.communicationStyle).toBe('简洁直接');
      expect(p.relationship.humorResponse).toBe(0.5);
      expect(p.evolution).toEqual([]);
    });
  });

  describe('updateUserField() 字段更新', () => {
    it('更新身份字段', () => {
      engine.updateUserField('identity', {
        role: '前端开发',
        techStack: ['React'],
        experience: 'senior',
        primaryLanguage: 'zh-CN',
      });
      const p = engine.getUserProfile();
      expect(p.identity.role).toBe('前端开发');
      expect(p.identity.techStack).toContain('React');
      expect(p.identity.experience).toBe('senior');
    });

    it('更新记录演化历史', () => {
      engine.updateUserField('identity', { role: '初学者', techStack: [], experience: 'junior', primaryLanguage: 'zh-CN' });
      engine.updateUserField('identity', { role: '前端开发', techStack: ['Vue'], experience: 'mid', primaryLanguage: 'zh-CN' }, '用户说在学前端');
      const p = engine.getUserProfile();
      expect(p.evolution.length).toBeGreaterThan(0);
      const latest = p.evolution[p.evolution.length - 1];
      expect(latest.field).toBe('identity');
      expect(latest.reason).toBe('用户说在学前端');
    });

    it('演化历史不超 100 条', () => {
      for (let i = 0; i < 110; i++) {
        engine.updateUserField('test_field', { value: i });
      }
      const p = engine.getUserProfile();
      expect(p.evolution.length).toBeLessThanOrEqual(100);
    });
  });

  describe('inferFromMessage() 对话推断', () => {
    it('检测 React 技术栈', () => {
      engine.inferFromMessage('我用 React 写了个组件', []);
      const p = engine.getUserProfile();
      expect(p.identity.techStack).toContain('React');
    });

    it('检测 Python 技术栈', () => {
      engine.inferFromMessage('我在写一个 Python 脚本处理数据', []);
      const p = engine.getUserProfile();
      expect(p.identity.techStack).toContain('Python');
    });

    it('检测探索式提问风格', () => {
      engine.inferFromMessage('为什么这个 CORS 会报错？', []);
      const p = engine.getUserProfile();
      expect(p.behavior.askStyle).toBe('exploratory');
    });

    it('短消息推断 brief 偏好', () => {
      engine.inferFromMessage('OK', []);
      const p = engine.getUserProfile();
      expect(p.behavior.preferredDetailLevel).toBe('brief');
    });

    it('通过 toolCalls 检测技术栈', () => {
      engine.inferFromMessage('运行一下', ['npm run build']);
      const p = engine.getUserProfile();
      expect(p.identity.techStack).toContain('Node.js');
    });
  });

  describe('getUserPromptFragment() Prompt 片段', () => {
    it('默认状态返回非空', () => {
      const frag = engine.getUserPromptFragment();
      expect(frag).toBeTruthy();
      expect(frag).toContain('提问风格');
      expect(frag).toContain('详细偏好');
    });

    it('有角色时包含角色信息', () => {
      engine.updateUserField('identity', { role: '全栈', techStack: [], experience: 'mid', primaryLanguage: 'zh-CN' });
      const frag = engine.getUserPromptFragment();
      expect(frag).toContain('全栈');
    });

    it('有技术栈时包含技术栈', () => {
      engine.inferFromMessage('用 TypeScript 和 Go 写后端', []);
      const frag = engine.getUserPromptFragment();
      expect(frag).toContain('TypeScript');
    });
  });

  // ==================== 自我模型 ====================

  describe('getSelfModel() 自我模型', () => {
    it('返回完整默认结构', () => {
      const m = engine.getSelfModel();
      expect(m.competence.strengths).toEqual([]);
      expect(m.competence.weaknesses).toEqual([]);
      expect(m.competence.confidence).toEqual({});
      expect(m.narrative.milestones).toEqual([]);
      expect(m.emotionalState.mood).toBe('calm');
      expect(m.emotionalState.recentSatisfaction).toBe(50);
      expect(m.reflections).toEqual([]);
    });
  });

  describe('updateSelfField() 自我字段更新', () => {
    it('更新能力信息', () => {
      engine.updateSelfField('competence', {
        strengths: ['TypeScript', '调试'],
        weaknesses: ['运维'],
        confidence: { TypeScript: 0.9, DevOps: 0.3 },
        learnedSkills: ['CORS配置'],
      });
      const m = engine.getSelfModel();
      expect(m.competence.strengths).toContain('TypeScript');
      expect(m.competence.weaknesses).toContain('运维');
      expect(m.competence.confidence['TypeScript']).toBe(0.9);
    });
  });

  describe('addMilestone() 里程碑', () => {
    it('添加里程碑', () => {
      engine.addMilestone('第一次完成代码审查', 0.8);
      const m = engine.getSelfModel();
      expect(m.narrative.milestones).toHaveLength(1);
      expect(m.narrative.milestones[0].event).toBe('第一次完成代码审查');
      expect(m.narrative.milestones[0].emotional).toBe(0.8);
    });

    it('里程碑不超 50 条', () => {
      for (let i = 0; i < 55; i++) {
        engine.addMilestone(`事件${i}`, 0.5);
      }
      const m = engine.getSelfModel();
      expect(m.narrative.milestones.length).toBeLessThanOrEqual(50);
    });
  });

  describe('updateConfidence() 置信度更新', () => {
    it('成功时置信度增加', () => {
      engine.updateConfidence('TypeScript', true);
      const m = engine.getSelfModel();
      expect(m.competence.confidence['TypeScript']).toBeGreaterThan(0.5);
    });

    it('失败时置信度减少', () => {
      engine.updateConfidence('运维', false);
      const m = engine.getSelfModel();
      expect(m.competence.confidence['运维']).toBeLessThan(0.5);
    });

    it('置信度不超边界 0-1', () => {
      for (let i = 0; i < 100; i++) {
        engine.updateConfidence('test', true);
      }
      const m = engine.getSelfModel();
      expect(m.competence.confidence['test']).toBeLessThanOrEqual(1);
    });
  });

  describe('getSelfPromptFragment() 自我 Prompt', () => {
    it('默认状态返回非空', () => {
      const frag = engine.getSelfPromptFragment();
      expect(frag).toBeTruthy();
      expect(frag).toContain('当前情绪');
    });

    it('有优势时包含优势信息', () => {
      engine.updateSelfField('competence', {
        strengths: ['调试'],
        weaknesses: [],
        confidence: {},
        learnedSkills: [],
      });
      const frag = engine.getSelfPromptFragment();
      expect(frag).toContain('调试');
    });

    it('有置信度时包含自信领域', () => {
      engine.updateConfidence('TypeScript', true);
      engine.updateConfidence('TypeScript', true);
      const frag = engine.getSelfPromptFragment();
      expect(frag).toContain('TypeScript');
    });
  });

  // ==================== 意图引擎 ====================

  describe('addMicroGoal() 微目标', () => {
    it('添加并获取待处理目标', () => {
      engine.addMicroGoal('理解项目架构', 7, '用户询问结构');
      const goals = engine.getPendingGoals();
      expect(goals).toHaveLength(1);
      expect(goals[0].goal).toBe('理解项目架构');
      expect(goals[0].priority).toBe(7);
      expect(goals[0].status).toBe('pending');
    });

    it('目标按优先级排序', () => {
      engine.addMicroGoal('低优先级', 3, 'test');
      engine.addMicroGoal('高优先级', 9, 'test');
      engine.addMicroGoal('中优先级', 5, 'test');
      const goals = engine.getPendingGoals();
      expect(goals[0].priority).toBe(9);
      expect(goals[1].priority).toBe(5);
      expect(goals[2].priority).toBe(3);
    });

    it('完成目标', () => {
      engine.addMicroGoal('目标1', 5, 'test');
      const goals = engine.getPendingGoals();
      engine.completeGoal(goals[0].id);
      const after = engine.getPendingGoals();
      expect(after).toHaveLength(0);
    });

    it('limit 参数生效', () => {
      for (let i = 0; i < 10; i++) {
        engine.addMicroGoal(`目标${i}`, i, 'test');
      }
      const goals = engine.getPendingGoals(3);
      expect(goals).toHaveLength(3);
    });
  });

  describe('addCuriosity() 好奇心', () => {
    it('添加好奇心问题', () => {
      engine.addCuriosity('为什么 WebSocket 要用心跳？');
      const curiosities = engine.getCuriosities();
      expect(curiosities).toHaveLength(1);
      expect(curiosities[0].question).toBe('为什么 WebSocket 要用心跳？');
    });

    it('重复问题不重复添加（IGNORE）', () => {
      engine.addCuriosity('为什么？');
      engine.addCuriosity('为什么？');
      const curiosities = engine.getCuriosities();
      expect(curiosities).toHaveLength(1);
    });

    it('按时间倒序排列', async () => {
      engine.addCuriosity('问题A');
      await new Promise(r => setTimeout(r, 5)); // 确保时间戳不同
      engine.addCuriosity('问题B');
      const curiosities = engine.getCuriosities();
      expect(curiosities[0].question).toBe('问题B');
    });
  });

  describe('shouldSpeak() 主动发言判断', () => {
    it('深夜不主动（23点后）', () => {
      const result = engine.shouldSpeak({
        idleMinutes: 60, recentErrors: 0,
        userMood: 'normal', hasNewInsight: false, hour: 23,
      });
      expect(result).toBe(false);
    });

    it('凌晨不主动（8点前）', () => {
      const result = engine.shouldSpeak({
        idleMinutes: 60, recentErrors: 0,
        userMood: 'normal', hasNewInsight: false, hour: 3,
      });
      expect(result).toBe(false);
    });

    it('用户烦躁时不主动', () => {
      const result = engine.shouldSpeak({
        idleMinutes: 60, recentErrors: 0,
        userMood: 'frustrated', hasNewInsight: false, hour: 14,
      });
      expect(result).toBe(false);
    });

    it('有新洞察时主动', () => {
      const result = engine.shouldSpeak({
        idleMinutes: 0, recentErrors: 0,
        userMood: 'normal', hasNewInsight: true, hour: 14,
      });
      expect(result).toBe(true);
    });

    it('用户多次报错时主动', () => {
      const result = engine.shouldSpeak({
        idleMinutes: 0, recentErrors: 3,
        userMood: 'normal', hasNewInsight: false, hour: 14,
      });
      expect(result).toBe(true);
    });
  });

  describe('inferGoals() 目标推断', () => {
    it('检测错误 → 调试协助目标', () => {
      engine.inferGoals('这里报错了 error: Cannot find module', []);
      const goals = engine.getPendingGoals();
      expect(goals.some(g => g.goal.includes('解决当前错误'))).toBe(true);
    });

    it('检测部署 → 了解部署流程', () => {
      engine.inferGoals('帮我部署到 k8s 上', []);
      const goals = engine.getPendingGoals();
      expect(goals.some(g => g.goal.includes('部署流程'))).toBe(true);
    });

    it('检测性能 → 性能分析', () => {
      engine.inferGoals('这个页面太慢了，需要优化', []);
      const goals = engine.getPendingGoals();
      expect(goals.some(g => g.goal.includes('性能瓶颈'))).toBe(true);
    });
  });

  // ==================== 领域画像 ====================

  describe('领域画像 DomainProfile', () => {
    it('默认领域画像结构', () => {
      const p = engine.getDomainProfile('前端开发');
      expect(p.domain).toBe('前端开发');
      expect(p.knowledgeCount).toBe(0);
      expect(p.depthScore).toBe(0);
      expect(p.growthStage).toBe('seed');
      expect(p.isActive).toBe(true);
    });

    it('更新领域画像', () => {
      engine.updateDomainProfile('前端开发', {
        knowledgeCount: 25,
        depthScore: 0.4,
        growthStage: 'sprout',
      });
      const p = engine.getDomainProfile('前端开发');
      expect(p.knowledgeCount).toBe(25);
      expect(p.growthStage).toBe('sprout');
    });

    it('获取所有活跃领域', () => {
      engine.updateDomainProfile('前端', { knowledgeCount: 10 });
      engine.updateDomainProfile('后端', { knowledgeCount: 5 });
      const all = engine.getAllDomainProfiles();
      expect(all.length).toBeGreaterThanOrEqual(2);
      // 按 knowledgeCount 降序
      expect(all[0].knowledgeCount).toBeGreaterThanOrEqual(all[1].knowledgeCount);
    });

    it('领域 Prompt 片段（knowledgeCount >= 5）', () => {
      engine.updateDomainProfile('React', { knowledgeCount: 10 });
      engine.updateDomainProfile('CSS', { knowledgeCount: 2 }); // 不够
      const frag = engine.getDomainPromptFragment();
      expect(frag).toContain('React');
      expect(frag).not.toContain('CSS');
    });

    it('无领域时返回空字符串', () => {
      const frag = engine.getDomainPromptFragment();
      expect(frag).toBe('');
    });
  });

  // ==================== 统计 ====================

  describe('getStats() 统计', () => {
    it('返回统计数据', () => {
      const stats = engine.getStats();
      expect(stats.userProfileFields).toBeGreaterThanOrEqual(0);
      expect(stats.milestones).toBeGreaterThanOrEqual(0);
      expect(stats.pendingGoals).toBeGreaterThanOrEqual(0);
      expect(stats.curiosities).toBeGreaterThanOrEqual(0);
      expect(stats.domains).toBeGreaterThanOrEqual(0);
    });

    it('添加数据后统计更新', () => {
      engine.addMicroGoal('测试', 5, 'test');
      engine.addCuriosity('好奇？');
      engine.addMilestone('里程碑', 0.5);
      engine.updateDomainProfile('TS', { knowledgeCount: 5 });

      const stats = engine.getStats();
      expect(stats.pendingGoals).toBe(1);
      expect(stats.curiosities).toBe(1);
      expect(stats.milestones).toBe(1);
      expect(stats.domains).toBe(1);
    });
  });
});
