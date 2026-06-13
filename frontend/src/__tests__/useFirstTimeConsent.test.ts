/**
 * hooks/useFirstTimeConsent.ts 测试
 * 覆盖：getAllSensorConsent、revokeSensorConsent、SENSOR_NOTIFICATIONS、
 *       loadConsentState/saveConsentState 逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllSensorConsent, revokeSensorConsent, SENSOR_NOTIFICATIONS } from '../hooks/useFirstTimeConsent.js';
import type { SensorType } from '../hooks/useFirstTimeConsent.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
  removeItem: vi.fn((k: string) => { delete store[k]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('useFirstTimeConsent', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // ==================== getAllSensorConsent ====================

  describe('getAllSensorConsent', () => {
    it('无存储数据时返回默认状态', () => {
      const state = getAllSensorConsent();
      expect(state.camera.granted).toBe(false);
      expect(state.microphone.granted).toBe(false);
      expect(state.location.granted).toBe(false);
    });

    it('读取已存储的同意状态', () => {
      store['buddy_sensor_consent'] = JSON.stringify({
        camera: { granted: true, grantedAt: 1000 },
        microphone: { granted: false },
        location: { granted: false },
      });
      const state = getAllSensorConsent();
      expect(state.camera.granted).toBe(true);
      expect(state.camera.grantedAt).toBe(1000);
    });

    it('处理损坏的 JSON', () => {
      store['buddy_sensor_consent'] = 'invalid json{';
      const state = getAllSensorConsent();
      expect(state.camera.granted).toBe(false);
    });
  });

  // ==================== revokeSensorConsent ====================

  describe('revokeSensorConsent', () => {
    it('撤回摄像头授权', () => {
      store['buddy_sensor_consent'] = JSON.stringify({
        camera: { granted: true, grantedAt: 1000 },
        microphone: { granted: false },
        location: { granted: false },
      });
      revokeSensorConsent('camera');
      const state = getAllSensorConsent();
      expect(state.camera.granted).toBe(false);
      expect(state.camera.revokedAt).toBeDefined();
    });

    it('撤回麦克风授权', () => {
      revokeSensorConsent('microphone');
      const state = getAllSensorConsent();
      expect(state.microphone.granted).toBe(false);
      expect(state.microphone.revokedAt).toBeDefined();
    });
  });

  // ==================== SENSOR_NOTIFICATIONS ====================

  describe('SENSOR_NOTIFICATIONS', () => {
    const sensors: SensorType[] = ['camera', 'microphone', 'location'];

    it.each(sensors)('$sensor 有完整通知信息', (sensor) => {
      const notif = SENSOR_NOTIFICATIONS[sensor];
      expect(notif.title).toBeTruthy();
      expect(notif.message).toBeTruthy();
      expect(notif.buddySays).toBeTruthy();
      expect(notif.icon).toBeTruthy();
    });

    it('摄像头通知包含正确图标', () => {
      expect(SENSOR_NOTIFICATIONS.camera.icon).toBe('📷');
    });

    it('麦克风通知包含正确图标', () => {
      expect(SENSOR_NOTIFICATIONS.microphone.icon).toBe('🎤');
    });

    it('位置通知包含正确图标', () => {
      expect(SENSOR_NOTIFICATIONS.location.icon).toBe('📍');
    });

    it('话术像朋友聊天，不像系统提示', () => {
      for (const notif of Object.values(SENSOR_NOTIFICATIONS)) {
        expect(notif.buddySays).not.toMatch(/\[SYSTEM\]|ERROR|WARNING/i);
        // 包含中文
        expect(notif.buddySays).toMatch(/[\u4e00-\u9fff]/);
      }
    });
  });
});
