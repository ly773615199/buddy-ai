/**
 * Phase C Week 13 — 视觉模块测试 — vitest 格式
 * Camera / FrameCapture / FaceDetect / SceneAnalyze / Privacy
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FrameCaptureManager, ManualCapture, IntervalCapture, MotionCapture } from '../frontend/src/vision/frame-capture.js';
import { FaceDetector } from '../frontend/src/vision/face-detect.js';
import { SceneAnalyzer } from '../frontend/src/vision/scene-analyze.js';
import { VisionPrivacyManager } from '../frontend/src/vision/privacy.js';

// ==================== 帧捕获策略测试 ====================

describe('帧捕获策略管理器', () => {
  let captureMgr: InstanceType<typeof FrameCaptureManager>;

  beforeAll(() => {
    captureMgr = new FrameCaptureManager();
  });

  it('默认包含 manual 策略', () => {
    expect(captureMgr.list()).toContain('manual');
  });

  it('手动策略名称正确', () => {
    expect(captureMgr.getManual().name).toBe('manual');
  });

  it('手动策略初始未运行', () => {
    expect(captureMgr.getManual().isRunning()).toBe(false);
  });

  it('添加定时策略', () => {
    const interval = captureMgr.addInterval('timer', { intervalMs: 1000 });
    expect(interval.name).toBe('interval');
    expect(interval.isRunning()).toBe(false);
  });

  it('添加运动检测策略', () => {
    const motion = captureMgr.addMotion('motion', { threshold: 25, minChangePercent: 3 });
    expect(motion.name).toBe('motion');
    expect(motion.isRunning()).toBe(false);
  });

  it('列出 3 个策略', () => {
    expect(captureMgr.list().length).toBe(3);
    expect(captureMgr.list()).toContain('manual');
    expect(captureMgr.list()).toContain('timer');
    expect(captureMgr.list()).toContain('motion');
  });

  it('手动策略 start/stop 和 trigger', async () => {
    let capturedFrame: string | null = null;
    let capturedTime = 0;

    captureMgr.getManual().start((frame, ts) => {
      capturedFrame = frame;
      capturedTime = ts;
    });
    expect(captureMgr.getManual().isRunning()).toBe(true);

    await captureMgr.getManual().trigger(async () => 'dGVzdGZyYW1l');
    expect(capturedFrame).toBe('dGVzdGZyYW1l');
    expect(capturedTime).toBeGreaterThan(0);

    captureMgr.getManual().stop();
    expect(captureMgr.getManual().isRunning()).toBe(false);
  });

  it('停止所有策略', () => {
    captureMgr.stopAll();
    const interval = captureMgr.addInterval('timer2', { intervalMs: 1000 });
    captureMgr.stopAll();
    expect(interval.isRunning()).toBe(false);
  });
});

// ==================== 人脸检测器测试 ====================

describe('人脸检测器', () => {
  it('默认后端为 fallback 且总是可用', () => {
    const faceDetector = new FaceDetector({
      minConfidence: 0.6,
      maxFaces: 3,
    });
    expect(faceDetector.getBackend()).toBe('fallback');
    expect(faceDetector.isAvailable()).toBe(true);
    faceDetector.destroy();
  });

  it('fallback 后端检测空图片返回空人脸列表', async () => {
    const faceDetector = new FaceDetector({
      minConfidence: 0.6,
      maxFaces: 3,
    });
    const result = await faceDetector.detect('iVBORw0KGgo');
    expect(result.faces.length).toBe(0);
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
    faceDetector.destroy();
  });

  it('无 API Key 时云端返回空', async () => {
    const cloudDetector = new FaceDetector();
    cloudDetector.init('cloud');
    const result = await cloudDetector.detect('dGVzdA==');
    expect(result.faces.length).toBe(0);
    cloudDetector.destroy();
  });
});

// ==================== 场景分析器测试 ====================

describe('场景分析器', () => {
  it('无 API Key 不可用', () => {
    const analyzer = new SceneAnalyzer({ apiKey: '' });
    expect(analyzer.isAvailable()).toBe(false);
  });

  it('设置 API Key 后可用', () => {
    const analyzer = new SceneAnalyzer({ apiKey: '' });
    analyzer.setApiKey('test-key');
    expect(analyzer.isAvailable()).toBe(true);
  });

  it('切换后端后仍可用', () => {
    const analyzer = new SceneAnalyzer({ apiKey: '' });
    analyzer.setApiKey('test-key');
    analyzer.setBackend('openai', { model: 'gpt-4o-mini' });
    expect(analyzer.isAvailable()).toBe(true);
  });
});

// ==================== 视觉隐私管理器测试 ====================

describe('视觉隐私管理器', () => {
  let privacy: InstanceType<typeof VisionPrivacyManager>;

  beforeAll(() => {
    privacy = new VisionPrivacyManager();
  });

  afterAll(() => {
    privacy.destroy();
  });

  describe('权限检查', () => {
    it('disabled 级别下信任度 0 不可捕获', () => {
      privacy.setPermissionLevel('disabled');
      expect(privacy.canCapture(0)).toBe(false);
    });

    it('manual 级别下信任度 0 可手动捕获', () => {
      privacy.setPermissionLevel('manual');
      expect(privacy.canCapture(0)).toBe(true);
    });

    it('manual + 信任度 30 不可自动分析', () => {
      privacy.setPermissionLevel('manual');
      expect(privacy.canAutoAnalyze(30)).toBe(false);
    });

    it('manual + 信任度 60 可自动分析', () => {
      privacy.setPermissionLevel('manual');
      expect(privacy.canAutoAnalyze(60)).toBe(true);
    });

    it('auto + 信任度 30 不可自动分析', () => {
      privacy.setPermissionLevel('auto');
      expect(privacy.canAutoAnalyze(30)).toBe(false);
    });

    it('auto + 信任度 60 可自动分析', () => {
      privacy.setPermissionLevel('auto');
      expect(privacy.canAutoAnalyze(60)).toBe(true);
    });

    it('disabled 级别信任度 100 也不可捕获', () => {
      privacy.setPermissionLevel('disabled');
      expect(privacy.canCapture(100)).toBe(false);
    });
  });

  describe('临时存储', () => {
    it('允许存储后 canStore=true', () => {
      privacy.setPermissionLevel('manual');
      privacy.updateConfig({ persistFrames: true });
      expect(privacy.canStore()).toBe(true);
    });

    it('临时帧存储和读取', () => {
      privacy.storeFrameTemporarily('frame1', 'base64data');
      expect(privacy.getFrame('frame1')).toBe('base64data');
      expect(privacy.getFrame('nonexistent')).toBeNull();
    });

    it('帧删除成功', () => {
      privacy.deleteFrame('frame1');
      expect(privacy.getFrame('frame1')).toBeNull();
    });
  });

  describe('脱敏', () => {
    it('文字脱敏、位置移除、非敏感字段保留', () => {
      privacy.updateConfig({
        anonymize: { blurFaces: true, redactText: true, stripLocation: true },
      });

      const anonymized = privacy.anonymizeResult({
        text: 'secret text',
        location: 'Beijing',
        description: 'a photo',
      });
      expect(anonymized.text).toBe('[已脱敏]');
      expect(Object.keys(anonymized)).not.toContain('location');
      expect(anonymized.description).toBe('a photo');
    });
  });

  describe('隐私模式', () => {
    it('启用隐私模式后级别为 disabled', () => {
      privacy.enablePrivacyMode();
      expect(privacy.getConfig().permissionLevel).toBe('disabled');
      expect(privacy.getStatus().level).toBe('disabled');
    });

    it('退出隐私模式', () => {
      privacy.disablePrivacyMode('manual');
      expect(privacy.getConfig().permissionLevel).toBe('manual');
    });
  });

  describe('审计日志', () => {
    it('审计记录包含 store 和 delete', () => {
      privacy.setPermissionLevel('manual');
      privacy.updateConfig({ persistFrames: true });
      privacy.storeFrameTemporarily('audit_test', 'data');
      privacy.deleteFrame('audit_test');

      const auditLog = privacy.getAuditLog();
      expect(auditLog.length).toBeGreaterThanOrEqual(2);
      expect(auditLog[auditLog.length - 2].action).toBe('store');
      expect(auditLog[auditLog.length - 1].action).toBe('delete');
    });

    it('审计日志导出成功', () => {
      const exportedAudit = privacy.exportAuditLog();
      expect(exportedAudit.length).toBeGreaterThan(0);
    });
  });

  describe('状态摘要', () => {
    it('状态级别正确，指示器开启，无临时帧', () => {
      const status = privacy.getStatus();
      expect(status.level).toBe('manual');
      expect(status.indicator).toBe(true);
      expect(status.tempFrames).toBe(0);
    });
  });
});
