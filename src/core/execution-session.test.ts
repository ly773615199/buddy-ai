import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExecutionSession,
  decideAutonomyLevel,
  assessTaskRisk,
  type AutonomyLevel,
} from './execution-session.js';

// ==================== decideAutonomyLevel ====================

describe('decideAutonomyLevel 自主等级判定', () => {
  it('新用户 → L0', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'low', userCorrectionCount: 0, sessionLength: 5, isFirstSession: true,
    })).toBe(0);
  });

  it('高风险任务 + 纠正少 → L1', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'high', userCorrectionCount: 1, sessionLength: 10, isFirstSession: false,
    })).toBe(1);
  });

  it('高风险任务 + 纠正多 → L0', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'high', userCorrectionCount: 5, sessionLength: 10, isFirstSession: false,
    })).toBe(0);
  });

  it('用户纠正 >= 5 → L0', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'low', userCorrectionCount: 5, sessionLength: 10, isFirstSession: false,
    })).toBe(0);
  });

  it('用户纠正 >= 3 → L1', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'low', userCorrectionCount: 3, sessionLength: 10, isFirstSession: false,
    })).toBe(1);
  });

  it('中等风险 + 纠正少 → L2', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'medium', userCorrectionCount: 0, sessionLength: 10, isFirstSession: false,
    })).toBe(2);
  });

  it('低风险 + 长会话 + 无纠正 → L3', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'low', userCorrectionCount: 0, sessionLength: 30, isFirstSession: false,
    })).toBe(3);
  });

  it('低风险 + 短会话 → L2', () => {
    expect(decideAutonomyLevel({
      taskRisk: 'low', userCorrectionCount: 0, sessionLength: 5, isFirstSession: false,
    })).toBe(2);
  });
});

// ==================== assessTaskRisk ====================

describe('assessTaskRisk 任务风险评估', () => {
  it('删除操作 → high', () => {
    expect(assessTaskRisk('删除旧日志文件')).toBe('high');
  });

  it('部署操作 → high', () => {
    expect(assessTaskRisk('部署到生产环境')).toBe('high');
  });

  it('rm 命令 → high', () => {
    expect(assessTaskRisk('rm -rf /tmp/old')).toBe('high');
  });

  it('修改操作 → medium', () => {
    expect(assessTaskRisk('修改配置文件')).toBe('medium');
  });

  it('创建操作 → medium', () => {
    expect(assessTaskRisk('create new module')).toBe('medium');
  });

  it('读取操作 → low', () => {
    expect(assessTaskRisk('查看项目结构')).toBe('low');
  });

  it('搜索操作 → low', () => {
    expect(assessTaskRisk('搜索代码中的引用')).toBe('low');
  });
});

// ==================== ExecutionSession ====================

describe('ExecutionSession 执行会话管理', () => {
  let session: ExecutionSession;

  beforeEach(() => {
    session = new ExecutionSession({
      id: 'test-1',
      goal: '测试任务',
      autonomyLevel: 2,
      maxRetries: 2,
      maxSteps: 10,
      checkpointInterval: 3,
    });
  });

  // ── 状态管理 ──

  describe('状态管理', () => {
    it('初始状态为 planning', () => {
      expect(session.getStatus()).toBe('planning');
    });

    it('start 后变为 executing', () => {
      session.start();
      expect(session.getStatus()).toBe('executing');
    });

    it('非 planning 状态不能 start', () => {
      session.start();
      expect(() => session.start()).toThrow('只能从 planning 状态开始');
    });

    it('pause 后变为 paused', () => {
      session.start();
      session.pause();
      expect(session.getStatus()).toBe('paused');
    });

    it('resume 后变为 executing', () => {
      session.start();
      session.pause();
      session.resume();
      expect(session.getStatus()).toBe('executing');
    });

    it('非 paused 状态不能 resume', () => {
      session.start();
      expect(() => session.resume()).toThrow('只能从 paused 状态恢复');
    });

    it('complete 后变为 done', () => {
      session.start();
      session.complete();
      expect(session.getStatus()).toBe('done');
    });

    it('fail 后变为 failed', () => {
      session.start();
      session.fail('出错了');
      expect(session.getStatus()).toBe('failed');
    });
  });

  // ── 步骤管理 ──

  describe('步骤管理', () => {
    it('addStep 添加步骤', () => {
      session.start();
      const step = session.addStep('read_file', { path: '/a.txt' });
      expect(step.tool).toBe('read_file');
      expect(step.id).toBe('step-1');
      expect(session.getSteps()).toHaveLength(1);
    });

    it('超过 maxSteps 抛出异常', () => {
      session.start();
      for (let i = 0; i < 10; i++) session.addStep('exec', {});
      expect(() => session.addStep('exec', {})).toThrow('超过最大步骤数');
    });

    it('completeStep 记录结果', () => {
      session.start();
      const step = session.addStep('read_file', { path: '/a.txt' });
      session.completeStep(step.id, 'file content', true);
      const completed = session.getSteps()[0];
      expect(completed.result).toBe('file content');
      expect(completed.success).toBe(true);
      expect(completed.completedAt).toBeDefined();
    });

    it('retryStep 重置步骤状态', () => {
      session.start();
      const step = session.addStep('exec', {});
      session.completeStep(step.id, 'error', false);
      const retried = session.retryStep(step.id);
      expect(retried).toBe(true);
      expect(step.retryCount).toBe(1);
      expect(step.result).toBeUndefined();
    });

    it('retryStep 超过 maxRetries 返回 false', () => {
      session.start();
      const step = session.addStep('exec', {});
      session.retryStep(step.id); // retry 1
      session.retryStep(step.id); // retry 2
      expect(session.retryStep(step.id)).toBe(false); // retry 3 — 超限
    });

    it('verifyStep 标记验证', () => {
      session.start();
      const step = session.addStep('exec', {});
      session.verifyStep(step.id, true);
      expect(step.verified).toBe(true);
    });

    it('getCurrentStep 返回最后一步', () => {
      session.start();
      session.addStep('read_file', {});
      session.addStep('write_file', {});
      expect(session.getCurrentStep()?.tool).toBe('write_file');
    });
  });

  // ── 检查点 ──

  describe('检查点', () => {
    it('每 checkpointInterval 步自动添加检查点', () => {
      session.start();
      session.addStep('exec', {}); // 1
      session.addStep('exec', {}); // 2
      expect(session.getPendingCheckpoints()).toHaveLength(0);
      session.addStep('exec', {}); // 3 → 自动检查点
      expect(session.getPendingCheckpoints()).toHaveLength(1);
    });

    it('confirmCheckpoint 确认检查点', () => {
      session.start();
      session.addStep('exec', {});
      session.addStep('exec', {});
      session.addStep('exec', {}); // checkpoint at index 2
      session.confirmCheckpoint(2);
      expect(session.getPendingCheckpoints()).toHaveLength(0);
    });

    it('hasPendingCheckpoint 检测待确认', () => {
      session.start();
      session.addStep('exec', {});
      session.addStep('exec', {});
      session.addStep('exec', {});
      expect(session.hasPendingCheckpoint()).toBe(true);
    });
  });

  // ── 自主等级决策 ──

  describe('shouldPauseForConfirmation', () => {
    it('L0 每步都确认', () => {
      const l0 = new ExecutionSession({ id: 'l0', goal: 'test', autonomyLevel: 0, maxRetries: 2, maxSteps: 10, checkpointInterval: 3 });
      expect(l0.shouldPauseForConfirmation('read_file', {})).toBe(true);
    });

    it('L3 全自动不暂停', () => {
      const l3 = new ExecutionSession({ id: 'l3', goal: 'test', autonomyLevel: 3, maxRetries: 2, maxSteps: 10, checkpointInterval: 3 });
      expect(l3.shouldPauseForConfirmation('exec', {})).toBe(false);
    });

    it('L1 高风险操作暂停', () => {
      const l1 = new ExecutionSession({ id: 'l1', goal: 'test', autonomyLevel: 1, maxRetries: 2, maxSteps: 10, checkpointInterval: 3 });
      expect(l1.shouldPauseForConfirmation('exec', { cmd: 'rm -rf /' })).toBe(true);
    });

    it('L1 低风险操作不暂停', () => {
      const l1 = new ExecutionSession({ id: 'l1', goal: 'test', autonomyLevel: 1, maxRetries: 2, maxSteps: 10, checkpointInterval: 3 });
      expect(l1.shouldPauseForConfirmation('read_file', { path: '/a.txt' })).toBe(false);
    });

    it('L2 有检查点时暂停', () => {
      session.start();
      session.addStep('exec', {});
      session.addStep('exec', {});
      session.addStep('exec', {}); // checkpoint
      expect(session.shouldPauseForConfirmation('exec', {})).toBe(true);
    });

    it('L2 无检查点时不暂停', () => {
      session.start();
      session.addStep('read_file', {});
      expect(session.shouldPauseForConfirmation('read_file', {})).toBe(false);
    });
  });

  // ── 快照和统计 ──

  describe('快照和统计', () => {
    it('getSnapshot 返回完整快照', () => {
      session.start();
      session.addStep('exec', {});
      const snap = session.getSnapshot();
      expect(snap.id).toBe('test-1');
      expect(snap.goal).toBe('测试任务');
      expect(snap.status).toBe('executing');
      expect(snap.steps).toHaveLength(1);
    });

    it('getStats 统计正确', () => {
      session.start();
      const s1 = session.addStep('exec', {});
      session.completeStep(s1.id, 'ok', true);
      const s2 = session.addStep('exec', {});
      session.completeStep(s2.id, 'fail', false);
      const s3 = session.addStep('exec', {});
      session.retryStep(s3.id);

      const stats = session.getStats();
      expect(stats.totalSteps).toBe(3);
      expect(stats.completedSteps).toBe(2);
      expect(stats.successfulSteps).toBe(1);
      expect(stats.failedSteps).toBe(1);
      expect(stats.retriedSteps).toBe(1);
    });
  });
});
