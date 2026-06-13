import { describe, it, expect, beforeEach } from 'vitest';
import { PerceptionEventBus, getPerceptionEventBus } from './perception/event-bus.js';
import { PrivacyManager, getPrivacyManager } from './perception/privacy.js';
import type { PerceptionEvent, PerceptionCategory } from './perception/types.js';
import type { TrustLevel } from './types.js';

// ═══════════════════════════════════════════
// PerceptionEventBus
// ═══════════════════════════════════════════

describe('perception/event-bus', () => {
  let bus: PerceptionEventBus;

  beforeEach(() => {
    bus = new PerceptionEventBus(100);
  });

  it('publish 返回完整事件结构', () => {
    const event = bus.publish('vision', 'image', { description: 'test' });
    expect(event.id).toMatch(/^pev-/);
    expect(event.category).toBe('vision');
    expect(event.source).toBe('image');
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.data).toEqual({ description: 'test' });
  });

  it('publish 附带 metadata', () => {
    const event = bus.publish('audio', 'mic', {}, { confidence: 0.9 });
    expect(event.metadata).toEqual({ confidence: 0.9 });
  });

  it('onPerception 接收所有事件', () => {
    const received: PerceptionEvent[] = [];
    bus.onPerception(e => received.push(e));

    bus.publish('vision', 'image', {});
    bus.publish('audio', 'mic', {});
    bus.publish('sensor', 'gps', {});

    expect(received).toHaveLength(3);
    expect(received.map(e => e.category)).toEqual(['vision', 'audio', 'sensor']);
  });

  it('onCategory 只接收指定类别', () => {
    const vision: PerceptionEvent[] = [];
    bus.onCategory('vision', e => vision.push(e));

    bus.publish('vision', 'image', {});
    bus.publish('audio', 'mic', {});
    bus.publish('vision', 'camera', {});

    expect(vision).toHaveLength(2);
    expect(vision.every(e => e.category === 'vision')).toBe(true);
  });

  it('onSource 只接收指定来源', () => {
    const micEvents: PerceptionEvent[] = [];
    bus.onSource('mic', e => micEvents.push(e));

    bus.publish('audio', 'mic', {});
    bus.publish('audio', 'stream', {});
    bus.publish('audio', 'mic', {});

    expect(micEvents).toHaveLength(2);
    expect(micEvents.every(e => e.source === 'mic')).toBe(true);
  });

  it('取消订阅后不再接收', () => {
    const received: PerceptionEvent[] = [];
    const unsub = bus.onPerception(e => received.push(e));

    bus.publish('vision', 'image', {});
    unsub();
    bus.publish('audio', 'mic', {});

    expect(received).toHaveLength(1);
  });

  it('getRecent 返回最近 N 条', () => {
    for (let i = 0; i < 10; i++) bus.publish('vision', 'image', { i });

    const recent = bus.getRecent(3);
    expect(recent).toHaveLength(3);
    expect((recent[0].data as any).i).toBe(7);
    expect((recent[2].data as any).i).toBe(9);
  });

  it('getRecent 按类别过滤', () => {
    bus.publish('vision', 'image', { n: 1 });
    bus.publish('audio', 'mic', { n: 2 });
    bus.publish('vision', 'camera', { n: 3 });

    const vision = bus.getRecent(10, 'vision');
    expect(vision).toHaveLength(2);
    expect(vision.every(e => e.category === 'vision')).toBe(true);
  });

  it('getInTimeRange 按时间过滤', () => {
    const base = Date.now();
    // publish 事件，它们的 timestamp 接近当前时间
    bus.publish('vision', 'image', {});
    bus.publish('audio', 'mic', {});

    const events = bus.getInTimeRange(base - 1000, base + 1000);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('getInTimeRange 按类别 + 时间过滤', () => {
    const base = Date.now();
    bus.publish('vision', 'image', {});
    bus.publish('audio', 'mic', {});

    const events = bus.getInTimeRange(base - 1000, base + 1000, 'vision');
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('vision');
  });

  it('clearHistory 清空历史', () => {
    bus.publish('vision', 'image', {});
    bus.publish('audio', 'mic', {});
    expect(bus.getStats().total).toBe(2);

    bus.clearHistory();
    expect(bus.getStats().total).toBe(0);
  });

  it('getStats 统计正确', () => {
    bus.publish('vision', 'image', {});
    bus.publish('vision', 'camera', {});
    bus.publish('audio', 'mic', {});

    const stats = bus.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory['vision']).toBe(2);
    expect(stats.byCategory['audio']).toBe(1);
    expect(stats.bySource['image']).toBe(1);
    expect(stats.bySource['camera']).toBe(1);
    expect(stats.bySource['mic']).toBe(1);
  });

  it('maxHistory 限制历史长度', () => {
    const smallBus = new PerceptionEventBus(5);
    for (let i = 0; i < 10; i++) smallBus.publish('vision', 'image', { i });

    const stats = smallBus.getStats();
    expect(stats.total).toBe(5);
    // 应保留最后 5 条
    const recent = smallBus.getRecent(10);
    expect((recent[0].data as any).i).toBe(5);
    expect((recent[4].data as any).i).toBe(9);
  });

  it('getPerceptionEventBus 返回单例', () => {
    const a = getPerceptionEventBus();
    const b = getPerceptionEventBus();
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════
// PrivacyManager
// ═══════════════════════════════════════════

describe('perception/privacy', () => {
  let pm: PrivacyManager;

  beforeEach(() => {
    pm = new PrivacyManager();
  });

  // ── 权限管理 ──

  it('初始化所有权限为 prompt', () => {
    const types = ['camera', 'microphone', 'location', 'motion', 'ambient_light', 'screen'] as const;
    for (const t of types) {
      expect(pm.getPermission(t).state).toBe('prompt');
    }
  });

  it('grantPermission 授权成功', () => {
    pm.grantPermission('camera');
    expect(pm.getPermission('camera').state).toBe('granted');
    expect(pm.getPermission('camera').grantedAt).toBeGreaterThan(0);
  });

  it('revokePermission 撤销成功', () => {
    pm.grantPermission('camera');
    pm.revokePermission('camera');
    expect(pm.getPermission('camera').state).toBe('revoked');
    expect(pm.getPermission('camera').revokedAt).toBeGreaterThan(0);
  });

  it('permission:changed 事件触发', () => {
    const changes: string[] = [];
    pm.on('permission:changed', (r: any) => changes.push(r.state));

    pm.grantPermission('camera');
    pm.revokePermission('camera');

    expect(changes).toEqual(['granted', 'revoked']);
  });

  // ── canUse ──

  it('canUse: 隐私模式下全部拒绝', () => {
    pm.grantPermission('camera');
    pm.togglePrivacyMode();
    expect(pm.canUse('camera', 'friend')).toBe(false);
  });

  it('canUse: stranger 全部拒绝', () => {
    pm.grantPermission('camera');
    expect(pm.canUse('camera', 'stranger')).toBe(false);
  });

  it('canUse: 已授权 + 信任度够 = 允许', () => {
    pm.grantPermission('camera');
    expect(pm.canUse('camera', 'friend')).toBe(true);
  });

  it('canUse: 未授权 = 拒绝', () => {
    expect(pm.canUse('camera', 'friend')).toBe(false);
  });

  // ── getMinTrustLevel ──

  it('getMinTrustLevel: camera 需要 friend', () => {
    expect(pm.getMinTrustLevel('camera')).toBe('friend');
  });

  it('getMinTrustLevel: microphone 需要 acquaintance', () => {
    expect(pm.getMinTrustLevel('microphone')).toBe('acquaintance');
  });

  it('getMinTrustLevel: location 需要 acquaintance', () => {
    expect(pm.getMinTrustLevel('location')).toBe('acquaintance');
  });

  // ── checkAccess ──

  it('checkAccess: 隐私模式拒绝', () => {
    pm.grantPermission('camera');
    pm.togglePrivacyMode();
    const result = pm.checkAccess('camera', 'friend');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('隐私模式');
  });

  it('checkAccess: 信任度不足拒绝', () => {
    pm.grantPermission('camera');
    const result = pm.checkAccess('camera', 'stranger');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('信任度');
  });

  it('checkAccess: 未授权拒绝', () => {
    const result = pm.checkAccess('camera', 'friend');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('未授权');
  });

  it('checkAccess: 全部条件满足 = 允许', () => {
    pm.grantPermission('camera');
    const result = pm.checkAccess('camera', 'friend');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('checkAccess: screen 需要 friend', () => {
    pm.grantPermission('screen');
    expect(pm.checkAccess('screen', 'acquaintance').allowed).toBe(false);
    expect(pm.checkAccess('screen', 'friend').allowed).toBe(true);
  });

  // ── 隐私模式 ──

  it('togglePrivacyMode 切换状态', () => {
    expect(pm.isPrivacyMode()).toBe(false);
    pm.togglePrivacyMode();
    expect(pm.isPrivacyMode()).toBe(true);
    pm.togglePrivacyMode();
    expect(pm.isPrivacyMode()).toBe(false);
  });

  it('隐私模式事件触发', () => {
    const modes: boolean[] = [];
    pm.on('privacy:mode', (m: boolean) => modes.push(m));
    pm.togglePrivacyMode();
    pm.togglePrivacyMode();
    expect(modes).toEqual([true, false]);
  });

  // ── 状态指示 ──

  it('getActiveIndicators 只显示已授权硬件', () => {
    pm.grantPermission('camera');
    pm.grantPermission('location');
    // microphone not granted

    const indicators = pm.getActiveIndicators();
    expect(indicators.map(i => i.type).sort()).toEqual(['camera', 'location']);
  });

  it('getActiveIndicators 隐私模式下为空', () => {
    pm.grantPermission('camera');
    pm.togglePrivacyMode();
    expect(pm.getActiveIndicators()).toHaveLength(0);
  });

  // ── 审计日志 ──

  it('审计日志记录授权操作', () => {
    pm.grantPermission('camera');
    pm.revokePermission('camera');

    const log = pm.getAuditLog();
    expect(log.some(e => e.action === 'grant' && e.target === 'camera')).toBe(true);
    expect(log.some(e => e.action === 'revoke' && e.target === 'camera')).toBe(true);
  });

  it('审计日志记录隐私模式切换', () => {
    pm.togglePrivacyMode();
    const log = pm.getAuditLog();
    expect(log.some(e => e.action === 'privacy_mode' && e.target === 'enabled')).toBe(true);
  });

  it('getAuditLog 限制返回数量', () => {
    for (let i = 0; i < 20; i++) pm.grantPermission('camera');
    expect(pm.getAuditLog(5)).toHaveLength(5);
  });

  // ── 持久化 ──

  it('exportState / importState 权限恢复', () => {
    pm.grantPermission('camera');
    pm.revokePermission('microphone');
    pm.togglePrivacyMode();

    const state = pm.exportState();
    expect(state.privacyMode).toBe(true);
    expect(state.permissions['camera'].state).toBe('granted');

    const pm2 = new PrivacyManager();
    pm2.importState(state);
    expect(pm2.getPermission('camera').state).toBe('granted');
    expect(pm2.getPermission('microphone').state).toBe('revoked');
    expect(pm2.isPrivacyMode()).toBe(true);
  });

  it('getPrivacyManager 返回单例', () => {
    const a = getPrivacyManager();
    const b = getPrivacyManager();
    expect(a).toBe(b);
  });
});
