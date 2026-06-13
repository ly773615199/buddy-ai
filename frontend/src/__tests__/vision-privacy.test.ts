/**
 * vision/privacy.ts 测试
 * 覆盖：VisionPrivacyManager 权限检查、帧管理、脱敏、配置、审计日志
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisionPrivacyManager } from '../vision/privacy.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
  removeItem: vi.fn((k: string) => { delete store[k]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock setInterval/clearInterval for cleanup timer
vi.stubGlobal('setInterval', vi.fn(() => 42));
vi.stubGlobal('clearInterval', vi.fn());

describe('VisionPrivacyManager', () => {
  let pm: VisionPrivacyManager;

  beforeEach(() => {
    pm = new VisionPrivacyManager();
  });

  afterEach(() => {
    pm.destroy();
  });

  // ==================== 权限检查 ====================

  describe('canCapture', () => {
    it('disabled 模式不允许捕获', () => {
      pm.setPermissionLevel('disabled');
      expect(pm.canCapture(100)).toBe(false);
    });

    it('manual 模式总是允许', () => {
      pm.setPermissionLevel('manual');
      expect(pm.canCapture(0)).toBe(true);
      expect(pm.canCapture(100)).toBe(true);
    });

    it('auto 模式需要信任度达标', () => {
      pm.setPermissionLevel('auto');
      expect(pm.canCapture(30)).toBe(false);
      expect(pm.canCapture(50)).toBe(true);
      expect(pm.canCapture(80)).toBe(true);
    });

    it('full 模式总是允许', () => {
      pm.setPermissionLevel('full');
      expect(pm.canCapture(0)).toBe(true);
    });
  });

  describe('canAutoAnalyze', () => {
    it('disabled 模式不允许自动分析', () => {
      pm.setPermissionLevel('disabled');
      expect(pm.canAutoAnalyze(100)).toBe(false);
    });

    it('需要信任度达标', () => {
      pm.setPermissionLevel('auto');
      expect(pm.canAutoAnalyze(30)).toBe(false);
      expect(pm.canAutoAnalyze(60)).toBe(true);
    });
  });

  describe('canStore', () => {
    it('默认不允许存储', () => {
      expect(pm.canStore()).toBe(false);
    });

    it('persistFrames=true 时允许', () => {
      pm.updateConfig({ persistFrames: true });
      expect(pm.canStore()).toBe(true);
    });
  });

  // ==================== 帧管理 ====================

  describe('帧管理', () => {
    it('canStore=false 时不存储帧', () => {
      pm.storeFrameTemporarily('f1', 'base64data');
      expect(pm.getFrame('f1')).toBe(null);
    });

    it('存储和获取帧', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'base64data');
      expect(pm.getFrame('f1')).toBe('base64data');
    });

    it('获取不存在的帧返回 null', () => {
      expect(pm.getFrame('nonexistent')).toBe(null);
    });

    it('删除帧', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      expect(pm.deleteFrame('f1')).toBe(true);
      expect(pm.getFrame('f1')).toBe(null);
    });

    it('删除不存在的帧返回 false', () => {
      expect(pm.deleteFrame('nonexistent')).toBe(false);
    });

    it('清除所有帧', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'd1');
      pm.storeFrameTemporarily('f2', 'd2');
      pm.clearAllFrames();
      expect(pm.getFrame('f1')).toBe(null);
      expect(pm.getFrame('f2')).toBe(null);
    });
  });

  // ==================== 脱敏 ====================

  describe('anonymizeResult', () => {
    it('stripLocation 移除位置信息', () => {
      pm.updateConfig({ anonymize: { blurFaces: false, redactText: false, stripLocation: true } });
      const result = pm.anonymizeResult({ text: 'hello', location: 'NYC', gps: { lat: 40 }, address: '123 st' });
      expect(result.location).toBeUndefined();
      expect(result.gps).toBeUndefined();
      expect(result.address).toBeUndefined();
      expect(result.text).toBe('hello');
    });

    it('redactText 脱敏文本', () => {
      pm.updateConfig({ anonymize: { blurFaces: false, redactText: true, stripLocation: false } });
      const result = pm.anonymizeResult({ text: 'sensitive data', other: 'keep' });
      expect(result.text).toBe('[已脱敏]');
      expect(result.other).toBe('keep');
    });

    it('不修改原对象', () => {
      const original = { text: 'hello', location: 'NYC' };
      pm.updateConfig({ anonymize: { blurFaces: false, redactText: true, stripLocation: true } });
      const result = pm.anonymizeResult(original);
      expect(original.text).toBe('hello');
      expect(original.location).toBe('NYC');
      expect(result.text).toBe('[已脱敏]');
      expect(result.location).toBeUndefined();
    });
  });

  describe('anonymizeFrame', () => {
    it('blurFaces=false 时返回原图', () => {
      pm.updateConfig({ anonymize: { blurFaces: false, redactText: false, stripLocation: false } });
      expect(pm.anonymizeFrame('base64data')).toBe('base64data');
    });

    it('无 faceRegions 时返回原图', () => {
      pm.updateConfig({ anonymize: { blurFaces: true, redactText: false, stripLocation: false } });
      expect(pm.anonymizeFrame('base64data')).toBe('base64data');
    });

    it('空 faceRegions 时返回原图', () => {
      pm.updateConfig({ anonymize: { blurFaces: true, redactText: false, stripLocation: false } });
      expect(pm.anonymizeFrame('base64data', [])).toBe('base64data');
    });
  });

  // ==================== 配置管理 ====================

  describe('配置管理', () => {
    it('默认配置正确', () => {
      const cfg = pm.getConfig();
      expect(cfg.permissionLevel).toBe('manual');
      expect(cfg.persistFrames).toBe(false);
      expect(cfg.showIndicator).toBe(true);
      expect(cfg.retentionMs).toBe(300000);
    });

    it('updateConfig 合并配置', () => {
      pm.updateConfig({ persistFrames: true, retentionMs: 60000 });
      const cfg = pm.getConfig();
      expect(cfg.persistFrames).toBe(true);
      expect(cfg.retentionMs).toBe(60000);
      expect(cfg.permissionLevel).toBe('manual'); // 保留
    });

    it('setPermissionLevel 更新级别', () => {
      pm.setPermissionLevel('auto');
      expect(pm.getConfig().permissionLevel).toBe('auto');
    });

    it('enablePrivacyMode 禁用并清除帧', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      pm.enablePrivacyMode();
      expect(pm.getConfig().permissionLevel).toBe('disabled');
      expect(pm.getFrame('f1')).toBe(null);
    });

    it('disablePrivacyMode 恢复', () => {
      pm.enablePrivacyMode();
      pm.disablePrivacyMode('auto');
      expect(pm.getConfig().permissionLevel).toBe('auto');
    });
  });

  // ==================== 审计日志 ====================

  describe('审计日志', () => {
    it('默认无日志', () => {
      expect(pm.getAuditLog()).toHaveLength(0);
    });

    it('存储帧产生审计', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      const log = pm.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].action).toBe('store');
    });

    it('删除帧产生审计', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      pm.deleteFrame('f1');
      const log = pm.getAuditLog();
      expect(log.some(e => e.action === 'delete')).toBe(true);
    });

    it('清除审计日志', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      pm.clearAuditLog();
      expect(pm.getAuditLog()).toHaveLength(0);
    });

    it('导出审计日志为 JSON', () => {
      pm.updateConfig({ persistFrames: true });
      pm.storeFrameTemporarily('f1', 'data');
      const exported = pm.exportAuditLog();
      expect(() => JSON.parse(exported)).not.toThrow();
    });
  });

  // ==================== 状态 ====================

  describe('getStatus', () => {
    it('返回正确状态', () => {
      const status = pm.getStatus();
      expect(status.level).toBe('manual');
      expect(status.tempFrames).toBe(0);
      expect(status.auditEntries).toBe(0);
      expect(status.indicator).toBe(true);
    });
  });
});
