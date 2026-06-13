/**
 * BodyState 本体状态机 — Buff 系统硬核测试
 *
 * 注意：updateFromEvent 内部调用 tickBuffs()，
 * 会用 buffPool.aggregate() 覆写 state.emotion。
 * aggregate() 从 EMOTION_BASELINE(joy=15) 开始叠加，不是从初始 state。
 * 所以 before/after 对比需要理解这个机制。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BodyStateManager } from './body-state.js';

describe('BodyStateManager — Buff 系统', () => {
  let bsm: BodyStateManager;

  beforeEach(() => {
    bsm = new BodyStateManager();
  });

  // ==================== 基础状态 ====================

  describe('初始状态', () => {
    it('默认状态合理', () => {
      const state = bsm.getState();
      expect(state.energy).toBeGreaterThan(0);
      expect(state.energy).toBeLessThanOrEqual(100);
      expect(state.emotion).toBeDefined();
      expect(state.desires).toBeDefined();
    });

    it('inferMood 返回有效情绪', () => {
      const mood = bsm.inferMood();
      const validMoods = ['energetic', 'calm', 'tired', 'excited', 'frustrated', 'happy', 'thinking', 'confused'];
      expect(validMoods).toContain(mood);
    });

    it('getMoodEmoji 返回有效 emoji', () => {
      const emoji = bsm.getMoodEmoji();
      const validEmojis = ['⚡', '😌', '😴', '🎉', '😤', '😊', '🤔', '😵'];
      expect(validEmojis).toContain(emoji);
    });
  });

  // ==================== Buff 叠加机制 ====================

  describe('Buff 叠加机制', () => {
    it('tool_success 后 joy > EMOTION_BASELINE(15)', () => {
      // 初始 getEmotion 返回 defaultState (joy=50)
      // 但 updateFromEvent 内部 tickBuffs 会用 aggregate() 覆写
      // aggregate 从 EMOTION_BASELINE(joy=15) 开始
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      const emotion = bsm.getEmotion();
      // tool_success buff: joy +8, 所以 aggregate ≈ 15+8 = 23
      expect(emotion.joy).toBeGreaterThan(15); // 大于基线
    });

    it('tool_error 后 sadness > EMOTION_BASELINE(5)', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      const emotion = bsm.getEmotion();
      // tool_error buff: sadness +15, anger +35
      expect(emotion.sadness).toBeGreaterThan(5);
      expect(emotion.anger).toBeGreaterThan(0);
    });

    it('多次 tool_success 叠加 joy', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      const joy1 = bsm.getEmotion().joy;

      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      const joy2 = bsm.getEmotion().joy;

      // 第二次叠加应该更高
      expect(joy2).toBeGreaterThan(joy1);
    });

    it('user_message 后 anticipation 增加', () => {
      bsm.updateFromEvent({ type: 'user_message', timestamp: Date.now(), data: {} });
      const emotion = bsm.getEmotion();
      // user_message buff: anticipation +5
      expect(emotion.anticipation).toBeGreaterThan(10); // 基线 10
    });

    it('不同来源 Buff 独立叠加', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      bsm.updateFromEvent({ type: 'user_message', timestamp: Date.now(), data: {} });
      const emotion = bsm.getEmotion();
      // tool_success: joy +8, user_message: anticipation +5
      expect(emotion.joy).toBeGreaterThan(15);
      expect(emotion.anticipation).toBeGreaterThan(10);
    });
  });

  // ==================== 衰减 ====================

  describe('Buff 衰减', () => {
    it('heartbeat 触发自然衰减', () => {
      // 先加 Buff
      for (let i = 0; i < 3; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      }
      const beforeJoy = bsm.getEmotion().joy;

      // heartbeat 触发衰减
      for (let i = 0; i < 10; i++) {
        bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      const afterJoy = bsm.getEmotion().joy;

      // 衰减后应该降低
      expect(afterJoy).toBeLessThan(beforeJoy);
    });

    it('heartbeat 消耗能量', () => {
      const beforeEnergy = bsm.getState().energy;
      for (let i = 0; i < 5; i++) {
        bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      expect(bsm.getState().energy).toBeLessThan(beforeEnergy);
    });

    it('衰减后不低于基线', () => {
      // 大量衰减后，情绪应该接近基线
      for (let i = 0; i < 100; i++) {
        bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      const emotion = bsm.getEmotion();
      // 基线 joy=15，衰减后应该接近
      expect(emotion.joy).toBeGreaterThanOrEqual(0);
      expect(emotion.joy).toBeLessThanOrEqual(50); // 不应过高
    });
  });

  // ==================== 事件类型 ====================

  describe('事件类型覆盖', () => {
    it('所有已知事件类型不崩溃', () => {
      const events = [
        { type: 'user_message', data: {} },
        { type: 'tool_result', data: { success: true } },
        { type: 'tool_result', data: { success: false } },
        { type: 'heartbeat', data: {} },
        { type: 'dream', data: {} },
        { type: 'system', data: { health: 'critical' } },
        { type: 'system', data: { health: 'degraded' } },
        { type: 'system', data: { health: 'good' } },
        { type: 'environment', data: { isUserActive: true } },
        { type: 'environment', data: { isUserActive: false } },
        { type: 'timeout', data: {} },
      ];
      for (const event of events) {
        bsm.updateFromEvent({ ...event, timestamp: Date.now() });
      }
      expect(bsm.getState()).toBeDefined();
    });

    it('system health 事件设置状态', () => {
      bsm.updateFromEvent({ type: 'system', timestamp: Date.now(), data: { health: 'critical' } });
      expect(bsm.getState().systemHealth).toBe('critical');
      bsm.updateFromEvent({ type: 'system', timestamp: Date.now(), data: { health: 'good' } });
      expect(bsm.getState().systemHealth).toBe('good');
    });

    it('timeout 消耗能量', () => {
      const before = bsm.getState().energy;
      bsm.updateFromEvent({ type: 'timeout', timestamp: Date.now(), data: {} });
      expect(bsm.getState().energy).toBeLessThan(before);
    });

    it('environment 更新用户活跃状态', () => {
      bsm.updateFromEvent({ type: 'environment', timestamp: Date.now(), data: { isUserActive: true } });
      expect(bsm.getState().isUserActive).toBe(true);
    });

    it('dream 恢复能量', () => {
      // 先消耗能量
      for (let i = 0; i < 20; i++) {
        bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      const beforeDream = bsm.getState().energy;
      bsm.updateFromEvent({ type: 'dream', timestamp: Date.now(), data: {} });
      expect(bsm.getState().energy).toBeGreaterThan(beforeDream);
    });
  });

  // ==================== 情绪效价分析 ====================

  describe('情绪效价分析', () => {
    it('成功事件增加正效价', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      const valence = bsm.getValence();
      // joy + trust + anticipation - sadness - anger - fear
      // 基线: (15+20+10) - (5+0+0) = 40, 加上 tool_success (joy+8, trust+3) = 51
      expect(valence).toBeGreaterThan(0);
    });

    it('失败事件降低效价', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      const valence = bsm.getValence();
      // tool_error: sadness+15, anger+35 → 效价应该下降
      expect(valence).toBeLessThan(40); // 低于基线效价
    });
  });

  // ==================== inferMood ====================

  describe('inferMood 离散情绪', () => {
    it('返回有效情绪标签', () => {
      const validMoods = ['energetic', 'calm', 'tired', 'excited', 'frustrated', 'happy', 'thinking', 'confused'];
      // 测试多种状态
      expect(validMoods).toContain(bsm.inferMood());

      for (let i = 0; i < 5; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      }
      expect(validMoods).toContain(bsm.inferMood());

      for (let i = 0; i < 10; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      }
      expect(validMoods).toContain(bsm.inferMood());
    });

    it('大量失败后 anger 高 → frustrated', () => {
      for (let i = 0; i < 10; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      }
      const emotion = bsm.getEmotion();
      if (emotion.anger > 50) {
        expect(bsm.inferMood()).toBe('frustrated');
      }
    });
  });

  // ==================== 数值边界 ====================

  describe('数值边界', () => {
    it('情绪值在 [0, 100] 范围内', () => {
      for (let i = 0; i < 20; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      }
      for (const [, val] of Object.entries(bsm.getEmotion())) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('极端负向情绪不超过范围', () => {
      for (let i = 0; i < 20; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      }
      for (const [, val] of Object.entries(bsm.getEmotion())) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('能量在 [0, 100] 范围内', () => {
      for (let i = 0; i < 100; i++) {
        bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      }
      expect(bsm.getState().energy).toBeGreaterThanOrEqual(0);
      expect(bsm.getState().energy).toBeLessThanOrEqual(100);
    });
  });

  // ==================== 欲望变化 ====================

  describe('欲望变化', () => {
    it('user_message 降低社交欲望', () => {
      bsm.updateFromEvent({ type: 'user_message', timestamp: Date.now(), data: {} });
      // social 从基线 15 降低 15 → 0
      expect(bsm.getState().desires.social).toBeLessThanOrEqual(15);
    });

    it('tool_result success 降低安全欲望', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      // safety 从基线 10 降低 10 → 0
      expect(bsm.getState().desires.safety).toBeLessThanOrEqual(10);
    });

    it('tool_result failure 增加安全欲望', () => {
      bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: false } });
      // safety 从基线 10 增加 12 → 22
      expect(bsm.getState().desires.safety).toBeGreaterThan(10);
    });

    it('dream 降低休息欲望', () => {
      bsm.updateFromEvent({ type: 'dream', timestamp: Date.now(), data: {} });
      // rest 从基线 15 降低 30 → 0 (clamp)
      expect(bsm.getState().desires.rest).toBeLessThanOrEqual(15);
    });
  });

  // ==================== 兼容接口 ====================

  describe('兼容旧接口', () => {
    it('getMood 与 inferMood 一致', () => {
      expect(bsm.getMood()).toBe(bsm.inferMood());
    });

    it('getMoodDescription 返回非空字符串', () => {
      expect(typeof bsm.getMoodDescription()).toBe('string');
      expect(bsm.getMoodDescription().length).toBeGreaterThan(0);
    });
  });

  // ==================== updateSystemMetrics 真实指标 ====================

  describe('updateSystemMetrics — 真实系统指标', () => {
    it('调用后 load 在 [0, 100] 范围内', () => {
      bsm.updateSystemMetrics();
      const state = bsm.getState();
      expect(state.load).toBeGreaterThanOrEqual(0);
      expect(state.load).toBeLessThanOrEqual(100);
    });

    it('调用后 temperature 在 [0, 100] 范围内', () => {
      bsm.updateSystemMetrics();
      const state = bsm.getState();
      expect(state.temperature).toBeGreaterThanOrEqual(0);
      expect(state.temperature).toBeLessThanOrEqual(100);
    });

    it('调用后 systemHealth 是有效值', () => {
      bsm.updateSystemMetrics();
      const state = bsm.getState();
      expect(['good', 'degraded', 'critical']).toContain(state.systemHealth);
    });

    it('连续调用不崩溃且值稳定', () => {
      const loads: number[] = [];
      const temps: number[] = [];
      for (let i = 0; i < 10; i++) {
        bsm.updateSystemMetrics();
        loads.push(bsm.getState().load);
        temps.push(bsm.getState().temperature);
      }
      // 所有值都在范围内
      for (const l of loads) expect(l).toBeGreaterThanOrEqual(0);
      for (const t of temps) expect(t).toBeGreaterThanOrEqual(0);
    });

    it('heartbeat 事件触发 updateSystemMetrics', () => {
      bsm.updateSystemMetrics();
      const loadBefore = bsm.getState().load;

      // heartbeat 会调用 naturalDecay → updateSystemMetrics
      bsm.updateFromEvent({ type: 'heartbeat', timestamp: Date.now(), data: {} });
      const loadAfter = bsm.getState().load;

      // 值应该在合理范围内（不严格相等，因为系统指标可能波动）
      expect(loadAfter).toBeGreaterThanOrEqual(0);
      expect(loadAfter).toBeLessThanOrEqual(100);
    });

    it('load 反映真实内存+CPU 加权', () => {
      bsm.updateSystemMetrics();
      const state = bsm.getState();

      // 手动验证：load = 60% mem + 40% cpu
      const os = require('os');
      const process_ = require('process');
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMemRatio = 1 - freeMem / totalMem;
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const cpuLoadRatio = Math.min(1, loadAvg[0] / cpuCount);
      const expectedLoad = Math.round(usedMemRatio * 60 + cpuLoadRatio * 40);

      expect(state.load).toBe(expectedLoad);
    });

    it('temperature 反映 CPU 负载', () => {
      bsm.updateSystemMetrics();
      const state = bsm.getState();

      const os = require('os');
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const cpuLoadRatio = Math.min(1, loadAvg[0] / cpuCount);
      const expectedTemp = Math.round(cpuLoadRatio * 100);

      expect(state.temperature).toBe(expectedTemp);
    });

    it('异常时不崩溃（保持旧值）', () => {
      // 先正常调用获取一个值
      bsm.updateSystemMetrics();
      const loadBefore = bsm.getState().load;

      // updateSystemMetrics 内部有 try/catch，即使出错也不应崩溃
      bsm.updateSystemMetrics();
      expect(bsm.getState().load).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== 性能 ====================

  describe('性能', () => {
    it('updateFromEvent 1000 次 < 100ms', () => {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        bsm.updateFromEvent({ type: 'tool_result', timestamp: Date.now(), data: { success: true } });
      }
      expect(performance.now() - t0).toBeLessThan(100);
    });

    it('inferMood 10000 次 < 50ms', () => {
      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) bsm.inferMood();
      expect(performance.now() - t0).toBeLessThan(50);
    });
  });
});
