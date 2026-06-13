/**
 * 能力包分享网络
 * 好友间 P2P 分享 / 权限控制 / 隐私保护
 */

import type { SkillPackage, KnowledgeNode } from './package.js';
import type { ExportedPackage } from './export.js';
import { ExperienceExporter } from './export.js';

export type SharePermission = 'readonly' | 'editable' | 'reshareable';

export interface ShareRecord {
  id: string;
  packageId: string;
  packageName: string;
  fromUserId: string;
  toUserId: string;
  permission: SharePermission;
  sharedAt: number;
  expiresAt?: number;
  status: 'pending' | 'accepted' | 'rejected' | 'revoked';
}

export interface ShareInvitation {
  id: string;
  packageId: string;
  packageName: string;
  fromUser: string;
  permission: SharePermission;
  preview: string;         // 包摘要，不含敏感内容
  createdAt: number;
  expiresAt: number;
}

export interface ShareConfig {
  /** 默认分享权限 */
  defaultPermission: SharePermission;
  /** 邀请有效期（ms），默认 7 天 */
  invitationExpiryMs: number;
  /** 是否自动脱敏 */
  autoAnonymize: boolean;
  /** 最大同时分享数 */
  maxConcurrentShares: number;
}

const DEFAULT_CONFIG: ShareConfig = {
  defaultPermission: 'readonly',
  invitationExpiryMs: 7 * 24 * 60 * 60 * 1000,
  autoAnonymize: true,
  maxConcurrentShares: 20,
};

export class ShareNetwork {
  private config: ShareConfig;
  private exporter: ExperienceExporter;
  private shares: Map<string, ShareRecord> = new Map();
  private invitations: Map<string, ShareInvitation> = new Map();
  private incomingQueue: ShareInvitation[] = [];

  constructor(config?: Partial<ShareConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.exporter = new ExperienceExporter();
  }

  // ==================== 分享操作 ====================

  /** 创建分享邀请 */
  createInvitation(
    pkg: SkillPackage,
    fromUserId: string,
    permission?: SharePermission,
  ): ShareInvitation {
    const perm = permission ?? this.config.defaultPermission;
    const id = `invite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 生成脱敏预览
    const preview = this._generateAnonymizedPreview(pkg);

    const invitation: ShareInvitation = {
      id,
      packageId: pkg.id,
      packageName: pkg.name,
      fromUser: fromUserId,
      permission: perm,
      preview,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.invitationExpiryMs,
    };

    this.invitations.set(id, invitation);
    return invitation;
  }

  /** 发送分享（从邀请） */
  sendShare(invitationId: string, toUserId: string): ShareRecord | null {
    const invite = this.invitations.get(invitationId);
    if (!invite || Date.now() > invite.expiresAt) return null;

    // 检查并发限制
    const activeShares = Array.from(this.shares.values())
      .filter(s => s.fromUserId === invite.fromUser && s.status !== 'revoked');
    if (activeShares.length >= this.config.maxConcurrentShares) return null;

    const record: ShareRecord = {
      id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      packageId: invite.packageId,
      packageName: invite.packageName,
      fromUserId: invite.fromUser,
      toUserId,
      permission: invite.permission,
      sharedAt: Date.now(),
      status: 'pending',
    };

    this.shares.set(record.id, record);
    this.invitations.delete(invitationId);

    return record;
  }

  /** 接收分享邀请 */
  receiveInvitation(invitation: ShareInvitation): void {
    // 验证有效性
    if (Date.now() > invitation.expiresAt) return;
    this.incomingQueue.push(invitation);
  }

  /** 接受分享 */
  acceptShare(shareId: string): boolean {
    const record = this.shares.get(shareId);
    if (!record || record.status !== 'pending') return false;
    record.status = 'accepted';
    return true;
  }

  /** 拒绝分享 */
  rejectShare(shareId: string): boolean {
    const record = this.shares.get(shareId);
    if (!record || record.status !== 'pending') return false;
    record.status = 'rejected';
    return true;
  }

  /** 撤销分享 */
  revokeShare(shareId: string): boolean {
    const record = this.shares.get(shareId);
    if (!record || record.status === 'revoked') return false;
    record.status = 'revoked';
    return true;
  }

  // ==================== 查询 ====================

  /** 获取我发出的分享 */
  getOutgoingShares(userId: string): ShareRecord[] {
    return Array.from(this.shares.values())
      .filter(s => s.fromUserId === userId)
      .sort((a, b) => b.sharedAt - a.sharedAt);
  }

  /** 获取发给我的分享 */
  getIncomingShares(userId: string): ShareRecord[] {
    return Array.from(this.shares.values())
      .filter(s => s.toUserId === userId)
      .sort((a, b) => b.sharedAt - a.sharedAt);
  }

  /** 获取待处理的邀请 */
  getPendingInvitations(): ShareInvitation[] {
    return this.incomingQueue.filter(
      i => Date.now() < i.expiresAt,
    );
  }

  /** 获取待处理的分享 */
  getPendingShares(userId: string): ShareRecord[] {
    return Array.from(this.shares.values())
      .filter(s => s.toUserId === userId && s.status === 'pending')
      .sort((a, b) => b.sharedAt - a.sharedAt);
  }

  /** 获取分享的包数据（考虑权限） */
  getSharedPackageData(shareId: string, userId: string): ExportedPackage | null {
    const record = this.shares.get(shareId);
    if (!record) return null;
    if (record.status !== 'accepted') return null;
    if (record.toUserId !== userId && record.fromUserId !== userId) return null;

    // 权限检查在调用方处理
    return null; // 实际数据由包管理器提供
  }

  /** 检查用户对包的权限 */
  checkPermission(shareId: string, userId: string, action: 'read' | 'edit' | 'reshare'): boolean {
    const record = this.shares.get(shareId);
    if (!record || record.status !== 'accepted') return false;
    if (record.toUserId !== userId) return false;

    switch (record.permission) {
      case 'readonly':
        return action === 'read';
      case 'editable':
        return action === 'read' || action === 'edit';
      case 'reshareable':
        return true;
    }
  }

  // ==================== 统计 ====================

  /** 分享统计 */
  getShareStats(userId: string): {
    outgoing: number;
    incoming: number;
    active: number;
    revoked: number;
  } {
    const allShares = Array.from(this.shares.values());
    const outgoing = allShares.filter(s => s.fromUserId === userId);
    const incoming = allShares.filter(s => s.toUserId === userId);

    return {
      outgoing: outgoing.length,
      incoming: incoming.length,
      active: [...outgoing, ...incoming].filter(s => s.status === 'accepted').length,
      revoked: [...outgoing, ...incoming].filter(s => s.status === 'revoked').length,
    };
  }

  /** 获取待过期的分享 */
  getExpiringSoon(days = 3): ShareRecord[] {
    const cutoff = Date.now() + days * 24 * 60 * 60 * 1000;
    return Array.from(this.shares.values())
      .filter(s => s.status === 'accepted' && s.expiresAt && s.expiresAt < cutoff);
  }

  // ==================== 配置 ====================

  updateConfig(partial: Partial<ShareConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): ShareConfig {
    return { ...this.config };
  }

  /** 清理 */
  destroy(): void {
    this.shares.clear();
    this.invitations.clear();
    this.incomingQueue = [];
  }

  // ==================== 内部方法 ====================

  private _generateAnonymizedPreview(pkg: SkillPackage): string {
    const types = new Set(pkg.knowledge.map(k => k.type));
    return [
      `📦 ${pkg.name}`,
      `   领域: ${pkg.domain}`,
      `   阶段: ${pkg.growthStage} | 质量: ${pkg.qualityScore}% | 知识: ${pkg.knowledgeCount} 条`,
      `   类型覆盖: ${types.size}/6`,
    ].join('\n');
  }
}
