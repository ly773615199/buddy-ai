/**
 * HardwarePermissionGuard — 后端硬件权限框架
 *
 * 职责：控制 LLM 工具调用链中的硬件访问权限
 * - 摄像头/麦克风/屏幕等硬件，需用户授权 + 信任度达标
 * - 被 agent.ts 的工具拦截器调用
 *
 * 与 capability-gate.ts 的关系：
 * - capability-gate → "AI 在这个亲密度阶段能不能用这个工具"（阶段门控）
 * - 本模块 → "用户有没有授权这个硬件"（权限门控）
 * - 两层都要过，缺一不可
 *
 * 与前端 VisionPrivacyManager 的关系：
 * - VisionPrivacyManager → 数据层（帧脱敏/过期/审计）
 * - 本模块 → 权限层（硬件能不能用）
 */

import { EventEmitter } from 'events';
import type { PermissionType, PermissionState, PermissionRecord } from './types.js';
import type { TrustLevel } from '../types.js';

export class PrivacyManager extends EventEmitter {
  private permissions: Map<PermissionType, PermissionRecord> = new Map();
  private privacyMode = false;
  private auditLog: AuditEntry[] = [];
  private maxAuditLog = 1000;

  constructor() {
    super();
    // 初始化所有权限为 prompt
    const types: PermissionType[] = ['camera', 'microphone', 'location', 'motion', 'ambient_light', 'screen'];
    for (const t of types) {
      this.permissions.set(t, { type: t, state: 'prompt' });
    }
  }

  // ==================== 权限管理 ====================

  /**
   * 获取权限状态
   */
  getPermission(type: PermissionType): PermissionRecord {
    return this.permissions.get(type) ?? { type, state: 'prompt' };
  }

  /**
   * 授权
   */
  grantPermission(type: PermissionType): void {
    const record: PermissionRecord = {
      type,
      state: 'granted',
      grantedAt: Date.now(),
    };
    this.permissions.set(type, record);
    this.addAudit('grant', type);
    this.emit('permission:changed', record);
  }

  /**
   * 撤销
   */
  revokePermission(type: PermissionType): void {
    const record: PermissionRecord = {
      type,
      state: 'revoked',
      revokedAt: Date.now(),
    };
    this.permissions.set(type, record);
    this.addAudit('revoke', type);
    this.emit('permission:changed', record);
  }

  /**
   * 检查是否可以使用某项硬件
   * 考虑：权限状态 + 隐私模式 + 信任度
   */
  canUse(type: PermissionType, trustLevel: TrustLevel): boolean {
    // 隐私模式下，所有硬件感知关闭
    if (this.privacyMode) return false;

    // 低信任度禁止所有硬件感知
    if (trustLevel === 'stranger') return false;

    const record = this.permissions.get(type);
    return record?.state === 'granted';
  }

  /**
   * 信任度要求检查
   * 不同硬件对信任度有不同最低要求
   */
  getMinTrustLevel(type: PermissionType): TrustLevel {
    switch (type) {
      case 'camera':
      case 'screen':
        return 'friend';       // 摄像头/屏幕需要朋友以上
      case 'microphone':
        return 'acquaintance'; // 麦克风认识了就行
      case 'location':
      case 'motion':
      case 'ambient_light':
        return 'acquaintance'; // 传感器认识了就行
    }
  }

  /**
   * 完整权限检查（权限 + 隐私模式 + 信任度）
   */
  checkAccess(type: PermissionType, trustLevel: TrustLevel): AccessResult {
    if (this.privacyMode) {
      return { allowed: false, reason: '隐私模式已开启' };
    }

    const minTrust = this.getMinTrustLevel(type);
    const trustOrder: TrustLevel[] = ['stranger', 'acquaintance', 'friend', 'close_friend', 'soulmate'];
    if (trustOrder.indexOf(trustLevel) < trustOrder.indexOf(minTrust)) {
      return { allowed: false, reason: `需要信任度 ${minTrust} 以上（当前: ${trustLevel}）` };
    }

    const record = this.permissions.get(type);
    if (!record || record.state !== 'granted') {
      return { allowed: false, reason: `权限 ${type} 未授权（当前: ${record?.state ?? 'prompt'}）` };
    }

    return { allowed: true };
  }

  // ==================== 隐私模式 ====================

  /**
   * 开启/关闭隐私模式
   */
  togglePrivacyMode(): boolean {
    this.privacyMode = !this.privacyMode;
    this.addAudit('privacy_mode', this.privacyMode ? 'enabled' : 'disabled');
    this.emit('privacy:mode', this.privacyMode);
    return this.privacyMode;
  }

  isPrivacyMode(): boolean {
    return this.privacyMode;
  }

  // ==================== UI 状态指示 ====================

  /**
   * 获取所有需要显示状态指示器的硬件
   * 返回当前正在使用的硬件列表
   */
  getActiveIndicators(): ActiveIndicator[] {
    const indicators: ActiveIndicator[] = [];

    if (this.canUseBasic('camera')) {
      indicators.push({ type: 'camera', icon: '🔴', label: '摄像头', color: 'red' });
    }
    if (this.canUseBasic('microphone')) {
      indicators.push({ type: 'microphone', icon: '🎤', label: '麦克风', color: 'green' });
    }
    if (this.canUseBasic('location')) {
      indicators.push({ type: 'location', icon: '📍', label: '定位', color: 'blue' });
    }
    if (this.canUseBasic('screen')) {
      indicators.push({ type: 'screen', icon: '🖥️', label: '屏幕录制', color: 'orange' });
    }

    return indicators;
  }

  private canUseBasic(type: PermissionType): boolean {
    if (this.privacyMode) return false;
    const record = this.permissions.get(type);
    return record?.state === 'granted';
  }

  // ==================== 审计日志 ====================

  private addAudit(action: string, target: string): void {
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      target,
    });
    if (this.auditLog.length > this.maxAuditLog) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLog);
    }
  }

  getAuditLog(count = 50): AuditEntry[] {
    return this.auditLog.slice(-count);
  }

  /** 清除审计日志 */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /** 获取隐私状态摘要 */
  getStatus(): {
    privacyMode: boolean;
    permissions: Record<string, string>;
    auditCount: number;
  } {
    const perms: Record<string, string> = {};
    for (const [key, val] of this.permissions) {
      perms[key] = val.state;
    }
    return {
      privacyMode: this.privacyMode,
      permissions: perms,
      auditCount: this.auditLog.length,
    };
  }

  // ==================== 持久化 ====================

  /**
   * 导出权限状态（用于持久化到配置文件）
   */
  exportState(): SerializedPrivacyState {
    return {
      permissions: Object.fromEntries(this.permissions),
      privacyMode: this.privacyMode,
    };
  }

  /**
   * 从持久化数据恢复
   */
  importState(state: SerializedPrivacyState): void {
    for (const [key, value] of Object.entries(state.permissions)) {
      this.permissions.set(key as PermissionType, value);
    }
    this.privacyMode = state.privacyMode;
  }
}

// ==================== 辅助类型 ====================

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

export interface ActiveIndicator {
  type: PermissionType;
  icon: string;
  label: string;
  color: string;
}

export interface AuditEntry {
  timestamp: number;
  action: string;
  target: string;
}

export interface SerializedPrivacyState {
  permissions: Record<string, PermissionRecord>;
  privacyMode: boolean;
}

// 全局单例
let _instance: PrivacyManager | null = null;

export function getPrivacyManager(): PrivacyManager {
  if (!_instance) {
    _instance = new PrivacyManager();
  }
  return _instance;
}
