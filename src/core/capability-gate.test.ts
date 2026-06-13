/**
 * core/capability-gate.ts 测试
 * 覆盖：CAPABILITY_GATE 结构完整性、isCapabilityAvailable、needsCapabilityConfirmation、
 *       getDiscoverableCapabilities、getCapabilityStage、needsConfirmationCompat
 */
import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_GATE,
  isCapabilityAvailable,
  needsCapabilityConfirmation,
  getDiscoverableCapabilities,
  getCapabilityStage,
  needsConfirmationCompat,
} from './capability-gate.js';

// ==================== CAPABILITY_GATE 结构完整性 ====================

describe('CAPABILITY_GATE', () => {
  it('所有能力都有必填字段', () => {
    for (const [id, cap] of Object.entries(CAPABILITY_GATE)) {
      expect(cap.id).toBe(id);
      expect(cap.stage).toBeDefined();
      expect(cap.discovery).toBeDefined();
      expect(['初见', '相识', '相知', '相伴', '灵犀']).toContain(cap.stage);
    }
  });

  it('初见阶段的能力是 default 发现方式', () => {
    const chuJianCaps = Object.values(CAPABILITY_GATE).filter(c => c.stage === '初见');
    for (const cap of chuJianCaps) {
      expect(cap.discovery).toBe('default');
    }
  });

  it('相知阶段的写操作需要确认', () => {
    expect(CAPABILITY_GATE.write_file.confirm).toBe(true);
    expect(CAPABILITY_GATE.exec.confirm).toBe(true);
  });

  it('感知能力标记为 separate', () => {
    expect(CAPABILITY_GATE.camera.separate).toBe(true);
    expect(CAPABILITY_GATE.microphone.separate).toBe(true);
    expect(CAPABILITY_GATE.location.separate).toBe(true);
  });

  it('每个能力的 requires 引用的能力都存在', () => {
    for (const [id, cap] of Object.entries(CAPABILITY_GATE)) {
      if (cap.requires) {
        for (const req of cap.requires) {
          expect(CAPABILITY_GATE[req]).toBeDefined();
        }
      }
    }
  });

  it('能力数量 >= 20', () => {
    expect(Object.keys(CAPABILITY_GATE).length).toBeGreaterThanOrEqual(20);
  });
});

// ==================== isCapabilityAvailable ====================

describe('isCapabilityAvailable', () => {
  it('chat 在初见阶段可用', () => {
    expect(isCapabilityAvailable('chat', 0)).toBe(true);
    expect(isCapabilityAvailable('chat', 10)).toBe(true);
  });

  it('read_file 在初见阶段不可用', () => {
    expect(isCapabilityAvailable('read_file', 10)).toBe(false);
  });

  it('read_file 在相识阶段可用', () => {
    expect(isCapabilityAvailable('read_file', 20)).toBe(true);
    expect(isCapabilityAvailable('read_file', 40)).toBe(true);
  });

  it('write_file 在相识阶段不可用', () => {
    expect(isCapabilityAvailable('write_file', 30)).toBe(false);
  });

  it('write_file 在相知阶段可用', () => {
    expect(isCapabilityAvailable('write_file', 50)).toBe(true);
  });

  it('camera 在相伴阶段可用', () => {
    expect(isCapabilityAvailable('camera', 70)).toBe(true);
  });

  it('camera 在相知阶段不可用', () => {
    expect(isCapabilityAvailable('camera', 50)).toBe(false);
  });

  it('package_create 在灵犀阶段可用', () => {
    expect(isCapabilityAvailable('package_create', 90)).toBe(true);
  });

  it('package_create 在相伴阶段不可用', () => {
    expect(isCapabilityAvailable('package_create', 80)).toBe(false);
  });

  it('未知能力默认不可用', () => {
    expect(isCapabilityAvailable('nonexistent', 100)).toBe(false);
  });

  it('高阶段自动包含低阶段能力', () => {
    // 灵犀阶段应有所有能力
    for (const capId of Object.keys(CAPABILITY_GATE)) {
      expect(isCapabilityAvailable(capId, 100)).toBe(true);
    }
  });
});

// ==================== needsCapabilityConfirmation ====================

describe('needsCapabilityConfirmation', () => {
  it('write_file 在初见阶段需要确认', () => {
    expect(needsCapabilityConfirmation('write_file', 10)).toBe(true);
  });

  it('write_file 在相识阶段需要确认', () => {
    expect(needsCapabilityConfirmation('write_file', 30)).toBe(true);
  });

  it('write_file 在相伴阶段不需要确认', () => {
    expect(needsCapabilityConfirmation('write_file', 80)).toBe(false);
  });

  it('write_file 在灵犀阶段不需要确认', () => {
    expect(needsCapabilityConfirmation('write_file', 100)).toBe(false);
  });

  it('exec 在初见阶段需要确认', () => {
    expect(needsCapabilityConfirmation('exec', 10)).toBe(true);
  });

  it('exec 在相伴阶段不需要确认', () => {
    expect(needsCapabilityConfirmation('exec', 80)).toBe(false);
  });

  it('chat 不需要确认（无 confirm 标记）', () => {
    expect(needsCapabilityConfirmation('chat', 0)).toBe(false);
  });

  it('read_file 不需要确认（无 confirm 标记）', () => {
    expect(needsCapabilityConfirmation('read_file', 30)).toBe(false);
  });

  it('未知能力不需要确认', () => {
    expect(needsCapabilityConfirmation('nonexistent', 10)).toBe(false);
  });
});

// ==================== getDiscoverableCapabilities ====================

describe('getDiscoverableCapabilities', () => {
  it('初见阶段可发现初见能力', () => {
    const caps = getDiscoverableCapabilities(10, new Set());
    const stages = caps.map(c => c.stage);
    expect(stages).toContain('初见');
  });

  it('已发现的能力不返回', () => {
    const caps = getDiscoverableCapabilities(100, new Set(['chat', 'read_file']));
    const ids = caps.map(c => c.id);
    expect(ids).not.toContain('chat');
    expect(ids).not.toContain('read_file');
  });

  it('灵犀阶段可发现所有未发现能力', () => {
    const caps = getDiscoverableCapabilities(100, new Set());
    // 所有能力都应可发现
    expect(caps.length).toBe(Object.keys(CAPABILITY_GATE).length);
  });

  it('初见阶段只能发现初见能力', () => {
    const caps = getDiscoverableCapabilities(5, new Set());
    for (const cap of caps) {
      expect(cap.stage).toBe('初见');
    }
  });

  it('相识阶段可发现初见+相识能力', () => {
    const caps = getDiscoverableCapabilities(30, new Set());
    const stages = new Set(caps.map(c => c.stage));
    expect(stages.has('初见')).toBe(true);
    expect(stages.has('相识')).toBe(true);
    expect(stages.has('相知')).toBe(false);
  });
});

// ==================== getCapabilityStage ====================

describe('getCapabilityStage', () => {
  it('返回正确阶段', () => {
    expect(getCapabilityStage('chat')).toBe('初见');
    expect(getCapabilityStage('read_file')).toBe('相识');
    expect(getCapabilityStage('write_file')).toBe('相知');
    expect(getCapabilityStage('camera')).toBe('相伴');
    expect(getCapabilityStage('package_create')).toBe('灵犀');
  });

  it('未知能力返回 null', () => {
    expect(getCapabilityStage('nonexistent')).toBe(null);
  });
});

// ==================== needsConfirmationCompat ====================

describe('needsConfirmationCompat', () => {
  it('无亲密度分数时按信任等级判断 write_file', () => {
    expect(needsConfirmationCompat('write_file', 'stranger')).toBe(true);
    expect(needsConfirmationCompat('write_file', 'acquaintance')).toBe(true);
    expect(needsConfirmationCompat('write_file', 'friend')).toBe(false);
  });

  it('无亲密度分数时按信任等级判断 exec', () => {
    expect(needsConfirmationCompat('exec', 'stranger')).toBe(true);
    expect(needsConfirmationCompat('exec', 'acquaintance')).toBe(true);
    expect(needsConfirmationCompat('exec', 'friend')).toBe(true);
    expect(needsConfirmationCompat('exec', 'close_friend')).toBe(false);
  });

  it('无 confirm 标记的工具不需要确认', () => {
    expect(needsConfirmationCompat('read_file', 'stranger')).toBe(false);
    expect(needsConfirmationCompat('chat', 'stranger')).toBe(false);
  });

  it('有亲密度分数时使用新系统', () => {
    // 80 = 相伴，write_file/exec 不需要确认
    expect(needsConfirmationCompat('write_file', 'stranger', 80)).toBe(false);
    expect(needsConfirmationCompat('exec', 'stranger', 80)).toBe(false);
    // 10 = 初见，需要确认
    expect(needsConfirmationCompat('write_file', 'stranger', 10)).toBe(true);
    expect(needsConfirmationCompat('exec', 'stranger', 10)).toBe(true);
  });
});
