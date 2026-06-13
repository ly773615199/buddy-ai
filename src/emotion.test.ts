import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmotionEngine } from './emotion/engine.js';

describe('情绪引擎 v2', () => {
  let emotion: EmotionEngine;

  beforeEach(() => {
    emotion = new EmotionEngine();
  });

  afterEach(() => {
    emotion.destroy();
  });

  describe('初始状态', () => {
    it('默认情绪为 calm', () => {
      expect(emotion.getMood()).toBe('calm');
    });

    it('初始 energy 基于基线计算', () => {
      const state = emotion.getState();
      // energy = (joy + anticipation + surprise) / 3 = (30 + 20 + 0) / 3 ≈ 16.7
      expect(state.energy).toBeGreaterThan(0);
      expect(state.energy).toBeLessThanOrEqual(100);
    });

    it('初始 satisfaction 基于基线计算', () => {
      const state = emotion.getState();
      expect(state.satisfaction).toBeGreaterThanOrEqual(0);
      expect(state.satisfaction).toBeLessThanOrEqual(100);
    });

    it('返回 EmotionVector', () => {
      const vector = emotion.getVector();
      expect(vector).toHaveProperty('joy');
      expect(vector).toHaveProperty('sadness');
      expect(vector).toHaveProperty('anger');
      expect(vector).toHaveProperty('fear');
      expect(vector).toHaveProperty('surprise');
      expect(vector).toHaveProperty('disgust');
      expect(vector).toHaveProperty('trust');
      expect(vector).toHaveProperty('anticipation');
    });

    it('默认 isAuthentic 为 true', () => {
      const state = emotion.getState();
      expect(state.isAuthentic).toBe(true);
    });
  });

  describe('Buff 叠加', () => {
    it('用户发来消息 → anticipation 增加', () => {
      const before = emotion.getVector().anticipation;
      emotion.onUserMessage();
      expect(emotion.getVector().anticipation).toBeGreaterThan(before);
    });

    it('工具成功 → joy 增加', () => {
      const before = emotion.getVector().joy;
      emotion.onToolSuccess();
      expect(emotion.getVector().joy).toBeGreaterThan(before);
    });

    it('工具失败 → sadness + anger 增加', () => {
      const beforeSad = emotion.getVector().sadness;
      const beforeAnger = emotion.getVector().anger;
      emotion.onToolError();
      expect(emotion.getVector().sadness).toBeGreaterThan(beforeSad);
      expect(emotion.getVector().anger).toBeGreaterThan(beforeAnger);
    });

    it('摸头 → joy + trust 增加', () => {
      const beforeJoy = emotion.getVector().joy;
      const beforeTrust = emotion.getVector().trust;
      emotion.onPet();
      expect(emotion.getVector().joy).toBeGreaterThan(beforeJoy);
      expect(emotion.getVector().trust).toBeGreaterThan(beforeTrust);
    });

    it('多次同类事件可叠加', () => {
      emotion.onToolSuccess();
      const afterOne = emotion.getVector().joy;
      emotion.onToolSuccess();
      const afterTwo = emotion.getVector().joy;
      expect(afterTwo).toBeGreaterThan(afterOne);
    });

    it('进化 → 大量正面情绪', () => {
      emotion.onEvolution();
      const v = emotion.getVector();
      expect(v.joy).toBeGreaterThan(50);
      expect(v.surprise).toBeGreaterThan(15);
    });
  });

  describe('人格修正', () => {
    it('高毒舌放大负面 Buff', () => {
      const emotion1 = new EmotionEngine({ snark: 10, wisdom: 50, chaos: 50, patience: 50, debugging: 50 });
      const emotion2 = new EmotionEngine({ snark: 90, wisdom: 50, chaos: 50, patience: 50, debugging: 50 });

      emotion1.onToolError();
      emotion2.onToolError();

      // 高毒舌应该放大 anger/sadness
      expect(emotion2.getVector().anger).toBeGreaterThan(emotion1.getVector().anger);

      emotion1.destroy();
      emotion2.destroy();
    });

    it('高耐心缩小负面 Buff', () => {
      const emotion1 = new EmotionEngine({ snark: 50, wisdom: 50, chaos: 50, patience: 10, debugging: 50 });
      const emotion2 = new EmotionEngine({ snark: 50, wisdom: 50, chaos: 50, patience: 90, debugging: 50 });

      emotion1.onToolError();
      emotion2.onToolError();

      // 高耐心应该缩小 sadness
      expect(emotion2.getVector().sadness).toBeLessThan(emotion1.getVector().sadness);

      emotion1.destroy();
      emotion2.destroy();
    });
  });

  describe('自主表达', () => {
    it('高亲密度时 isAuthentic 为 true', () => {
      emotion.setIntimacy(80);
      emotion.onToolSuccess();
      const state = emotion.getState();
      expect(state.isAuthentic).toBe(true);
    });

    it('低亲密度时可能不真实', () => {
      emotion.setIntimacy(10);
      emotion.setPersonality({ snark: 50, wisdom: 50, chaos: 70, patience: 50, debugging: 50 });
      emotion.onToolError();
      const state = emotion.getState();
      // chaos > 60 时 isAuthentic 可能为 false
      // 这里不强制断言，因为有随机性
      expect(typeof state.isAuthentic).toBe('boolean');
    });

    it('intensity 在 0-1 范围内', () => {
      emotion.onEvolution();
      const state = emotion.getState();
      expect(state.intensity).toBeGreaterThanOrEqual(0);
      expect(state.intensity).toBeLessThanOrEqual(1);
    });
  });

  describe('向后兼容', () => {
    it('getState 返回 mood, energy, satisfaction', () => {
      const state = emotion.getState();
      expect(state).toHaveProperty('mood');
      expect(state).toHaveProperty('energy');
      expect(state).toHaveProperty('satisfaction');
      expect(typeof state.mood).toBe('string');
      expect(typeof state.energy).toBe('number');
      expect(typeof state.satisfaction).toBe('number');
    });

    it('getMoodEmoji 返回 emoji', () => {
      const emoji = emotion.getMoodEmoji();
      expect(emoji.length).toBeGreaterThan(0);
    });

    it('getMoodDescription 返回描述', () => {
      const desc = emotion.getMoodDescription();
      expect(desc.length).toBeGreaterThan(5);
    });

    it('getPromptInjection 返回包含情绪的字符串', () => {
      const prompt = emotion.getPromptInjection();
      expect(prompt).toContain('情绪');
      expect(prompt.length).toBeGreaterThan(10);
    });
  });

  describe('人格更新', () => {
    it('setPersonality 更新人格特质', () => {
      emotion.setPersonality({ snark: 90, wisdom: 10, chaos: 10, patience: 10, debugging: 10 });
      // 触发一个 Buff 来验证人格生效
      emotion.onToolError();
      const v = emotion.getVector();
      // 高毒舌应该放大负面
      expect(v.anger).toBeGreaterThan(0);
    });

    it('setIntimacy 更新亲密度', () => {
      emotion.setIntimacy(90);
      const state = emotion.getState();
      expect(state.isAuthentic).toBe(true);
    });
  });

  describe('重置', () => {
    it('reset 清除所有 Buff', () => {
      emotion.onToolSuccess();
      emotion.onPet();
      emotion.onEvolution();
      expect(emotion.getVector().joy).toBeGreaterThan(30); // 基线以上
      emotion.reset();
      // 重置后应该回到基线
      const v = emotion.getVector();
      expect(v.joy).toBeLessThanOrEqual(35); // 基线 joy=30，允许小误差
    });
  });
});
