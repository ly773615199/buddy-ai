import { describe, it, expect, beforeEach } from 'vitest';
import { BodyStateManager } from './brain/cerebellum/body-state.js';
import { migrateFromLegacy } from './personality/ocean.js';

describe('情绪引擎 (BodyStateManager)', () => {
  let emotion: BodyStateManager;

  beforeEach(() => {
    emotion = new BodyStateManager();
  });

  describe('初始状态', () => {
    it('getMood 返回字符串', () => {
      const mood = emotion.getMood();
      expect(typeof mood).toBe('string');
      expect(mood.length).toBeGreaterThan(0);
    });

    it('初始 energy > 0', () => {
      const state = emotion.getState();
      expect(state.energy).toBeGreaterThan(0);
    });

    it('返回 EmotionVector 含 8 维', () => {
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

    it('getLegacyState 返回兼容格式', () => {
      const state = emotion.getLegacyState();
      expect(state).toHaveProperty('mood');
      expect(state).toHaveProperty('energy');
      expect(state).toHaveProperty('satisfaction');
      expect(state).toHaveProperty('intensity');
      expect(state).toHaveProperty('isAuthentic');
      expect(typeof state.satisfaction).toBe('number');
      expect(typeof state.intensity).toBe('number');
      expect(typeof state.isAuthentic).toBe('boolean');
    });
  });

  describe('Buff 叠加', () => {
    it('用户发来消息 → 改变情绪向量', () => {
      const before = { ...emotion.getVector() };
      emotion.onUserMessage();
      const after = emotion.getVector();
      // 消息会触发 buff，情绪应有变化
      const changed = Object.keys(before).some(k =>
        before[k as keyof typeof before] !== after[k as keyof typeof after]
      );
      expect(changed).toBe(true);
    });

    it('工具成功 → 改变情绪向量', () => {
      const before = { ...emotion.getVector() };
      emotion.onToolSuccess();
      const after = emotion.getVector();
      const changed = Object.keys(before).some(k =>
        before[k as keyof typeof before] !== after[k as keyof typeof after]
      );
      expect(changed).toBe(true);
    });

    it('工具失败 → sadness/anger 增加', () => {
      const before = emotion.getVector();
      emotion.onToolError();
      const after = emotion.getVector();
      // tool_error buff: sadness +15, anger +35
      expect(after.sadness).toBeGreaterThanOrEqual(before.sadness);
      expect(after.anger).toBeGreaterThanOrEqual(before.anger);
    });

    it('摸头 → 改变情绪', () => {
      const before = { ...emotion.getVector() };
      emotion.onPet();
      const after = emotion.getVector();
      const changed = Object.keys(before).some(k =>
        before[k as keyof typeof before] !== after[k as keyof typeof after]
      );
      expect(changed).toBe(true);
    });

    it('多次同类事件可叠加', () => {
      emotion.onToolSuccess();
      const afterOne = emotion.getVector().joy;
      emotion.onToolSuccess();
      const afterTwo = emotion.getVector().joy;
      expect(afterTwo).toBeGreaterThanOrEqual(afterOne);
    });

    it('发现新知识 → 改变情绪', () => {
      const before = { ...emotion.getVector() };
      emotion.onDiscovery();
      const after = emotion.getVector();
      const changed = Object.keys(before).some(k =>
        before[k as keyof typeof before] !== after[k as keyof typeof after]
      );
      expect(changed).toBe(true);
    });
  });

  describe('人格修正', () => {
    it('高毒舌放大负面 Buff', () => {
      const emotion1 = new BodyStateManager();
      const emotion2 = new BodyStateManager();
      emotion1.setPersonality(migrateFromLegacy({ snark: 10, wisdom: 50, chaos: 50, patience: 50, debugging: 50 }));
      emotion2.setPersonality(migrateFromLegacy({ snark: 90, wisdom: 50, chaos: 50, patience: 50, debugging: 50 }));

      emotion1.onToolError();
      emotion2.onToolError();

      expect(emotion2.getVector().anger).toBeGreaterThanOrEqual(emotion1.getVector().anger);
    });

    it('高耐心缩小负面 Buff', () => {
      const emotion1 = new BodyStateManager();
      const emotion2 = new BodyStateManager();
      emotion1.setPersonality(migrateFromLegacy({ snark: 50, wisdom: 50, chaos: 50, patience: 10, debugging: 50 }));
      emotion2.setPersonality(migrateFromLegacy({ snark: 50, wisdom: 50, chaos: 50, patience: 90, debugging: 50 }));

      emotion1.onToolError();
      emotion2.onToolError();

      expect(emotion2.getVector().sadness).toBeLessThanOrEqual(emotion1.getVector().sadness);
    });
  });

  describe('自主表达', () => {
    it('高亲密度时 isAuthentic 为 true', () => {
      emotion.setIntimacy(80);
      emotion.onToolSuccess();
      const state = emotion.getLegacyState();
      expect(state.isAuthentic).toBe(true);
    });

    it('intensity 在 0-1 范围内', () => {
      emotion.onDiscovery();
      const state = emotion.getLegacyState();
      expect(state.intensity).toBeGreaterThanOrEqual(0);
      expect(state.intensity).toBeLessThanOrEqual(1);
    });
  });

  describe('向后兼容', () => {
    it('getLegacyState 返回完整兼容状态', () => {
      const state = emotion.getLegacyState();
      expect(typeof state.mood).toBe('string');
      expect(typeof state.energy).toBe('number');
      expect(typeof state.satisfaction).toBe('number');
      expect(state.vector).toHaveProperty('joy');
    });

    it('getMoodEmoji 返回 emoji', () => {
      const emoji = emotion.getMoodEmoji();
      expect(emoji.length).toBeGreaterThan(0);
    });

    it('getMoodDescription 返回描述', () => {
      const desc = emotion.getMoodDescription();
      expect(desc.length).toBeGreaterThan(0);
    });

    it('getPromptInjection 返回包含情绪的字符串', () => {
      const prompt = emotion.getPromptInjection();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('人格更新', () => {
    it('setPersonality 更新人格特质', () => {
      emotion.setPersonality(migrateFromLegacy({ snark: 90, wisdom: 10, chaos: 10, patience: 10, debugging: 10 }));
      emotion.onToolError();
      const v = emotion.getVector();
      expect(v.anger).toBeGreaterThan(0);
    });

    it('setIntimacy 更新亲密度', () => {
      emotion.setIntimacy(90);
      expect(emotion.getState().intimacyLevel).toBe(90);
    });
  });
});
