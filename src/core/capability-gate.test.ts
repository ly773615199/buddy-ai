/**
 * core/capability-gate.ts 测试
 * 覆盖：CAPABILITY_GATE 结构完整性、风险确认模型、感知能力检查
 */
import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_GATE,
  needsConfirmation,
  getRiskLevel,
  isSensoryCapability,
  needsConfirmationCompat,
  isCapabilityAvailable,
} from './capability-gate.js';

// ==================== CAPABILITY_GATE 结构完整性 ====================

describe('CAPABILITY_GATE', () => {
  it('所有能力都有必填字段', () => {
    for (const [id, cap] of Object.entries(CAPABILITY_GATE)) {
      expect(cap.id).toBe(id);
      expect(cap.risk).toBeDefined();
      expect(['none', 'low', 'medium', 'high']).toContain(cap.risk);
    }
  });

  it('能力数量 >= 20', () => {
    expect(Object.keys(CAPABILITY_GATE).length).toBeGreaterThanOrEqual(20);
  });

  it('只读操作风险为 none', () => {
    expect(CAPABILITY_GATE.read_file.risk).toBe('none');
    expect(CAPABILITY_GATE.list_files.risk).toBe('none');
    expect(CAPABILITY_GATE.search_files.risk).toBe('none');
    expect(CAPABILITY_GATE.git_status.risk).toBe('none');
  });

  it('写文件风险为 low', () => {
    expect(CAPABILITY_GATE.write_file.risk).toBe('low');
  });

  it('执行命令风险为 medium', () => {
    expect(CAPABILITY_GATE.exec.risk).toBe('medium');
  });

  it('感知能力标记为 sensory', () => {
    expect(CAPABILITY_GATE.camera.sensory).toBe(true);
    expect(CAPABILITY_GATE.microphone.sensory).toBe(true);
    expect(CAPABILITY_GATE.location.sensory).toBe(true);
  });
});

// ==================== 风险确认模型 ====================

describe('needsConfirmation', () => {
  it('只读操作不需要确认', () => {
    expect(needsConfirmation('read_file')).toBe(false);
    expect(needsConfirmation('list_files')).toBe(false);
    expect(needsConfirmation('search_web')).toBe(false);
  });

  it('写文件需要确认', () => {
    expect(needsConfirmation('write_file')).toBe(true);
  });

  it('执行命令需要确认', () => {
    expect(needsConfirmation('exec')).toBe(true);
  });

  it('感知能力不需要确认（走 PrivacyManager）', () => {
    expect(needsConfirmation('camera')).toBe(false);
    expect(needsConfirmation('microphone')).toBe(false);
  });

  it('未知工具默认需要确认', () => {
    expect(needsConfirmation('unknown_tool')).toBe(true);
  });
});

describe('getRiskLevel', () => {
  it('返回正确的风险等级', () => {
    expect(getRiskLevel('read_file')).toBe('none');
    expect(getRiskLevel('write_file')).toBe('low');
    expect(getRiskLevel('exec')).toBe('medium');
    expect(getRiskLevel('unknown')).toBe('high');
  });
});

describe('isSensoryCapability', () => {
  it('感知能力返回 true', () => {
    expect(isSensoryCapability('camera')).toBe(true);
    expect(isSensoryCapability('microphone')).toBe(true);
    expect(isSensoryCapability('location')).toBe(true);
  });

  it('非感知能力返回 false', () => {
    expect(isSensoryCapability('read_file')).toBe(false);
    expect(isSensoryCapability('exec')).toBe(false);
  });
});

// ==================== 兼容接口 ====================

describe('兼容接口', () => {
  it('isCapabilityAvailable 始终返回 true', () => {
    expect(isCapabilityAvailable('read_file', 0)).toBe(true);
    expect(isCapabilityAvailable('exec', 100)).toBe(true);
    expect(isCapabilityAvailable('anything', 50)).toBe(true);
  });

  it('needsConfirmationCompat 兼容旧签名', () => {
    expect(needsConfirmationCompat('read_file')).toBe(false);
    expect(needsConfirmationCompat('write_file', 'stranger', 5)).toBe(true);
    expect(needsConfirmationCompat('exec', 'soulmate', 100)).toBe(true);
  });
});
