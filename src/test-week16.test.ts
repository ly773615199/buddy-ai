/**
 * Phase C Week 16 — 能力包评估深化 + 分享网络测试 (vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExperiencePackageManager, type KnowledgeNode } from './skills/package.js';
import { FeedbackLearner } from './skills/feedback.js';
import { ShareNetwork } from './skills/share-network.js';
import { QualityRadar } from './skills/radar.js';
import { ExperienceEvaluator } from './skills/evaluator.js';

// 辅助：创建测试知识
function makeKnowledge(count: number, domain: string): KnowledgeNode[] {
  const types: KnowledgeNode['type'][] = ['decision_rule', 'exception', 'pattern', 'risk', 'human_factor', 'failure'];
  return Array.from({ length: count }, (_, i) => ({
    id: `k_${i}`,
    type: types[i % 6],
    content: `${domain}知识 #${i}`,
    domain,
    confidence: 0.6 + Math.random() * 0.4,
    concepts: [domain, `概念${i % 10}`],
    sourceMessageIds: [`msg_${i}`],
    createdAt: Date.now() - i * 86400000,
    accessedAt: Date.now(),
    importance: 0.4 + Math.random() * 0.6,
  }));
}

describe('Phase C Week 16 — 能力包评估深化 + 分享网络', () => {
  // ==================== 反馈学习器测试 ====================

  describe('反馈学习器', () => {
    let pkgMgr: ExperiencePackageManager;
    let feedback: FeedbackLearner;
    let pkgId: string;

    beforeAll(() => {
      pkgMgr = new ExperiencePackageManager();
      feedback = new FeedbackLearner();

      const pkg = pkgMgr.createPackage({
        name: '骨科知识包',
        domain: '骨科',
        sourceRoom: 'room_ortho',
        knowledge: makeKnowledge(30, '骨科'),
      });
      pkgMgr.updateQuality(pkg.id, 65);
      pkgId = pkg.id;
    });

    it('记录反馈 — ID 格式正确，评分正确', () => {
      const fb1 = feedback.recordFeedback({
        packageId: pkgId,
        query: '骨折怎么办',
        answer: '固定、冰敷、就医',
        rating: 5,
        helpfulKnowledge: ['k_0', 'k_1'],
        unhelpfulKnowledge: [],
      });
      expect(fb1.id.startsWith('fb_')).toBe(true);
      expect(fb1.rating).toBe(5);
    });

    it('记录多条反馈后统计正确', () => {
      feedback.recordFeedback({
        packageId: pkgId,
        query: '韧带拉伤',
        answer: '休息、加压、抬高',
        rating: 2,
        correctedAnswer: '应该先冷敷再热敷',
        helpfulKnowledge: ['k_2'],
        unhelpfulKnowledge: ['k_3', 'k_4'],
      });

      feedback.recordFeedback({
        packageId: pkgId,
        query: '半月板损伤',
        answer: '看医生',
        rating: 4,
        helpfulKnowledge: ['k_0', 'k_5'],
        unhelpfulKnowledge: ['k_3'],
      });

      const stats = feedback.getStats(pkgId);
      expect(stats.totalFeedback).toBe(3);
      expect(stats.averageRating).toBeGreaterThan(3);
      expect(stats.averageRating).toBeLessThan(5);
      expect(stats.correctionCount).toBe(1);
      expect(stats.ratingDistribution[4]).toBe(1);
      expect(stats.ratingDistribution[1]).toBe(1);
      expect(stats.topHelpedKnowledge.length).toBeGreaterThan(0);
      expect(stats.topHurtKnowledge.length).toBeGreaterThan(0);
    });

    it('应用反馈到包 — 知识数量不变，重要度已更新', () => {
      const updatedPkg = feedback.applyFeedbackToPackage(pkgMgr.getPackage(pkgId)!);
      expect(updatedPkg.knowledge.length).toBe(30);
      expect(updatedPkg.knowledge[0].importance).toBeGreaterThan(0);
    });

    it('低评分查询返回正确', () => {
      const lows = feedback.getLowRatings(pkgId);
      expect(lows.length).toBe(1);
      expect(lows[0].correctedAnswer).toBe('应该先冷敷再热敷');
    });

    it('改进建议为数组', () => {
      const suggestions = feedback.generateSuggestions(pkgId);
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('导出成功', () => {
      const exported = feedback.exportFeedback(pkgId);
      expect(exported.length).toBeGreaterThan(0);
    });

    it('清除成功', () => {
      feedback.clearFeedback(pkgId);
      expect(feedback.getStats(pkgId).totalFeedback).toBe(0);
    });
  });

  // ==================== 分享网络测试 ====================

  describe('分享网络', () => {
    let shareNet: ShareNetwork;
    let pkgMgr: ExperiencePackageManager;
    let pkgId: string;

    beforeAll(() => {
      pkgMgr = new ExperiencePackageManager();
      shareNet = new ShareNetwork({ maxConcurrentShares: 20 });

      const pkg = pkgMgr.createPackage({
        name: '骨科知识包',
        domain: '骨科',
        sourceRoom: 'room_ortho',
        knowledge: makeKnowledge(30, '骨科'),
      });
      pkgMgr.updateQuality(pkg.id, 65);
      pkgId = pkg.id;
    });

    afterAll(() => {
      shareNet.destroy();
    });

    it('创建邀请 — ID 格式正确，包名、分享者、权限正确', () => {
      const invite = shareNet.createInvitation(
        pkgMgr.getPackage(pkgId)!,
        'user_alice',
        'editable',
      );
      expect(invite.id.startsWith('invite_')).toBe(true);
      expect(invite.packageName).toBe('骨科知识包');
      expect(invite.fromUser).toBe('user_alice');
      expect(invite.permission).toBe('editable');
      expect(invite.preview).toContain('骨科');
      expect(invite.preview).toContain('sprout');
      expect(invite.expiresAt).toBeGreaterThan(invite.createdAt);
    });

    it('发送分享 — 状态 pending，发送/接收者正确', () => {
      const invite = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'editable');
      const share = shareNet.sendShare(invite.id, 'user_bob');
      expect(share).not.toBeNull();
      expect(share!.status).toBe('pending');
      expect(share!.fromUserId).toBe('user_alice');
      expect(share!.toUserId).toBe('user_bob');
    });

    it('接受分享 — 状态变为 accepted', () => {
      const invite = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'editable');
      const share = shareNet.sendShare(invite.id, 'user_bob');
      expect(shareNet.acceptShare(share!.id)).toBe(true);
      expect(share!.status).toBe('accepted');
    });

    it('权限检查 — editable 可读写但不可再分享', () => {
      const invite = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'editable');
      const share = shareNet.sendShare(invite.id, 'user_bob');
      shareNet.acceptShare(share!.id);
      expect(shareNet.checkPermission(share!.id, 'user_bob', 'read')).toBe(true);
      expect(shareNet.checkPermission(share!.id, 'user_bob', 'edit')).toBe(true);
      expect(shareNet.checkPermission(share!.id, 'user_bob', 'reshare')).toBe(false);
      expect(shareNet.checkPermission(share!.id, 'user_alice', 'read')).toBe(false);
    });

    it('readonly 权限 — 可读不可编辑不可再分享', () => {
      const invite2 = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'readonly');
      const share2 = shareNet.sendShare(invite2.id, 'user_charlie');
      shareNet.acceptShare(share2!.id);
      expect(shareNet.checkPermission(share2!.id, 'user_charlie', 'read')).toBe(true);
      expect(shareNet.checkPermission(share2!.id, 'user_charlie', 'edit')).toBe(false);
      expect(shareNet.checkPermission(share2!.id, 'user_charlie', 'reshare')).toBe(false);
    });

    it('reshareable 权限 — 可读可编辑可再分享', () => {
      const invite3 = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'reshareable');
      const share3 = shareNet.sendShare(invite3.id, 'user_dave');
      shareNet.acceptShare(share3!.id);
      expect(shareNet.checkPermission(share3!.id, 'user_dave', 'read')).toBe(true);
      expect(shareNet.checkPermission(share3!.id, 'user_dave', 'edit')).toBe(true);
      expect(shareNet.checkPermission(share3!.id, 'user_dave', 'reshare')).toBe(true);
    });

    it('查询 — 发出/收到/待处理', () => {
      const outgoing = shareNet.getOutgoingShares('user_alice');
      expect(outgoing.length).toBeGreaterThanOrEqual(3);

      const incoming = shareNet.getIncomingShares('user_bob');
      expect(incoming.length).toBeGreaterThanOrEqual(1);

      const pending = shareNet.getPendingShares('user_charlie');
      expect(pending.length).toBe(0);
    });

    it('撤销 — 状态变为 revoked，权限失效', () => {
      const invite = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice', 'editable');
      const share = shareNet.sendShare(invite.id, 'user_bob');
      expect(share).not.toBeNull();
      shareNet.acceptShare(share!.id);
      expect(shareNet.revokeShare(share!.id)).toBe(true);
      expect(share!.status).toBe('revoked');
      expect(shareNet.checkPermission(share!.id, 'user_bob', 'read')).toBe(false);
    });

    it('拒绝 — 状态变为 rejected', () => {
      const invite4 = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice');
      const share4 = shareNet.sendShare(invite4.id, 'user_eve');
      expect(shareNet.rejectShare(share4!.id)).toBe(true);
      expect(share4!.status).toBe('rejected');
    });

    it('统计 — 发出/活跃/撤销', () => {
      const shareStats = shareNet.getShareStats('user_alice');
      expect(shareStats.outgoing).toBeGreaterThanOrEqual(5);
      expect(shareStats.revoked).toBeGreaterThanOrEqual(1);
    });

    it('超过并发限制时发送失败', () => {
      // 当前已有若干活跃分享，继续创建直到达到限制
      const currentActive = Array.from((shareNet as any).shares.values())
        .filter((s: any) => s.fromUserId === 'user_alice' && s.status !== 'revoked').length;
      const remaining = 20 - currentActive;
      for (let i = 0; i < remaining; i++) {
        const inv = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice');
        shareNet.sendShare(inv.id, `user_extra_${i}`);
      }
      const overLimit = shareNet.createInvitation(pkgMgr.getPackage(pkgId)!, 'user_alice');
      const overShare = shareNet.sendShare(overLimit.id, 'user_overflow');
      expect(overShare).toBeNull();
    });
  });

  // ==================== 质量雷达测试 ====================

  describe('质量雷达', () => {
    let radar: QualityRadar;
    let pkgMgr: ExperiencePackageManager;
    let pkgId: string;
    let pkgId2: string;

    beforeAll(() => {
      radar = new QualityRadar();
      pkgMgr = new ExperiencePackageManager();

      const pkg = pkgMgr.createPackage({
        name: '骨科知识包',
        domain: '骨科',
        sourceRoom: 'room_ortho',
        knowledge: makeKnowledge(30, '骨科'),
      });
      pkgMgr.updateQuality(pkg.id, 65);
      pkgId = pkg.id;

      const pkg2 = pkgMgr.createPackage({
        name: '骨科进阶包',
        domain: '骨科',
        sourceRoom: 'room_ortho2',
        knowledge: makeKnowledge(60, '骨科'),
      });
      pkgMgr.updateQuality(pkg2.id, 80);
      pkgId2 = pkg2.id;
    });

    it('报告包含正确包 ID 和领域', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      expect(report.packageId).toBe(pkgId);
      expect(report.domain).toBe('骨科');
    });

    it('综合分在有效范围', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      expect(report.overallScore).toBeGreaterThan(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
    });

    it('6 个维度', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      expect(report.dimensions.length).toBe(6);
      expect(typeof report.comparedToAverage).toBe('number');
      expect(Array.isArray(report.strengths)).toBe(true);
      expect(Array.isArray(report.weaknesses)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('维度名称正确', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      const dimNames = report.dimensions.map(d => d.name);
      expect(dimNames).toContain('知识覆盖');
      expect(dimNames).toContain('知识一致');
      expect(dimNames).toContain('专业深度');
      expect(dimNames).toContain('知识新鲜');
      expect(dimNames).toContain('概念多样');
      expect(dimNames).toContain('置信水平');
    });

    it('每个维度都有分数、权重和详情', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      for (const dim of report.dimensions) {
        expect(dim.score).toBeGreaterThanOrEqual(0);
        expect(dim.score).toBeLessThanOrEqual(100);
        expect(dim.weight).toBeGreaterThan(0);
        expect(dim.details.length).toBeGreaterThan(0);
      }
    });

    it('雷达图数据正确', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      const chartData = radar.toChartData(report);
      expect(chartData.labels.length).toBe(6);
      expect(chartData.data.length).toBe(6);
      expect(chartData.average).toBe(report.overallScore);
    });

    it('对比两个报告', () => {
      const report = radar.generateReport(pkgMgr.getPackage(pkgId)!);
      const report2 = radar.generateReport(pkgMgr.getPackage(pkgId2)!);
      const comparison = radar.compareReports(report, report2);
      expect(comparison.length).toBe(6);
      expect(comparison[0].dimension).toBe('知识覆盖');
      expect(typeof comparison[0].diff).toBe('number');
    });

    afterAll(() => {
      pkgMgr.deletePackage(pkgId);
      pkgMgr.deletePackage(pkgId2);
    });
  });
});
