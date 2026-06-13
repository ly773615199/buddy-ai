import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeExporter, type KnowledgePack } from './knowledge-export.js';
import type { ExperienceUnit } from './types.js';

// ==================== Mocks ====================

function makeMockCognitive() {
  const profiles: Record<string, any> = {
    'Docker': { domain: 'Docker', domainType: 'rule_based', depthScore: 0.8, growthStage: 'mature', knowledgeCount: 20 },
    'Git': { domain: 'Git', domainType: 'pattern_recognition', depthScore: 0.5, growthStage: 'growing', knowledgeCount: 8 },
    '新手领域': { domain: '新手领域', domainType: 'rule_based', depthScore: 0.1, growthStage: 'seed', knowledgeCount: 1 },
  };
  return {
    getDomainProfile: vi.fn((domain: string) => profiles[domain] ?? { domain, domainType: 'rule_based', depthScore: 0, growthStage: 'seed', knowledgeCount: 0 }),
    getAllDomainProfiles: vi.fn(() => Object.values(profiles)),
  };
}

function makeExp(overrides: Partial<ExperienceUnit> = {}): ExperienceUnit {
  return {
    id: 'exp-test',
    name: '测试技能',
    description: '用于测试',
    abstractionLevel: 'concrete',
    trigger: {
      intent: 'test',
      keywords: ['测试', 'Docker'],
      contextTags: ['Docker'],
      patterns: [],
    },
    steps: [{ tool: 'exec', args: { command: 'docker ps' } }],
    replyTemplate: { sharp: '{_step_0}', warm: '{_step_0}', chaotic: '{_step_0}', default: '{_step_0}' },
    stats: {
      successCount: 5, failCount: 0, confidence: 0.9, avgExecutionMs: 100,
      lastUsed: Date.now(), createdAt: Date.now(), extractedFrom: [],
      consolidatedAt: Date.now(), evolved: false,
    },
    ...overrides,
  };
}

// ==================== Tests ====================

describe('KnowledgeExporter', () => {
  let exporter: KnowledgeExporter;
  let mockCognitive: ReturnType<typeof makeMockCognitive>;
  let experiences: ExperienceUnit[];

  beforeEach(() => {
    mockCognitive = makeMockCognitive();
    experiences = [makeExp()];
    exporter = new KnowledgeExporter(mockCognitive as any, () => experiences);
  });

  // ── 导出 ──

  describe('exportDomainPack', () => {
    it('导出成熟领域', () => {
      const pack = exporter.exportDomainPack('Docker');
      expect(pack).not.toBeNull();
      expect(pack!.domain).toBe('Docker');
      expect(pack!.experiences.length).toBeGreaterThanOrEqual(1);
      expect(pack!.domainProfile.growthStage).toBe('mature');
      expect(pack!.version).toBe(1);
    });

    it('seed 领域返回 null', () => {
      const pack = exporter.exportDomainPack('新手领域');
      expect(pack).toBeNull();
    });

    it('无相关经验返回 null', () => {
      const pack = exporter.exportDomainPack('不存在的领域');
      expect(pack).toBeNull();
    });

    it('growing 领域也可以导出', () => {
      // Git 是 growing，knowledgeCount=8，可以导出
      experiences.push(makeExp({
        id: 'exp-git',
        trigger: { intent: 'git_op', keywords: ['Git'], contextTags: ['Git'], patterns: [] },
      }));
      const pack = exporter.exportDomainPack('Git');
      expect(pack).not.toBeNull();
    });
  });

  describe('exportAllMature', () => {
    it('导出所有成熟领域', () => {
      const packs = exporter.exportAllMature();
      // Docker 是 mature，Git 是 growing
      expect(packs.length).toBeGreaterThanOrEqual(1);
      expect(packs.some(p => p.domain === 'Docker')).toBe(true);
    });
  });

  // ── 导入 ──

  describe('importDomainPack', () => {
    it('导入新经验', () => {
      const pack: KnowledgePack = {
        domain: 'K8s',
        version: 1,
        experiences: [makeExp({ id: 'exp-k8s-new' })],
        domainProfile: { domainType: 'rule_based', depthScore: 0.6, growthStage: 'growing', knowledgeCount: 10 },
        extractedAt: Date.now(),
        source: 'test',
      };
      const result = exporter.importDomainPack(pack);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('跳过已存在的经验', () => {
      const pack: KnowledgePack = {
        domain: 'Docker',
        version: 1,
        experiences: [makeExp({ id: 'exp-test' })], // 同 experiences 中的 id
        domainProfile: { domainType: 'rule_based', depthScore: 0.8, growthStage: 'mature', knowledgeCount: 20 },
        extractedAt: Date.now(),
        source: 'test',
      };
      const result = exporter.importDomainPack(pack);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('不兼容版本全部跳过', () => {
      const pack: KnowledgePack = {
        domain: 'X',
        version: 99,
        experiences: [makeExp()],
        domainProfile: { domainType: 'rule_based', depthScore: 0, growthStage: 'seed', knowledgeCount: 0 },
        extractedAt: Date.now(),
        source: 'test',
      };
      const result = exporter.importDomainPack(pack);
      expect(result.imported).toBe(0);
    });
  });

  // ── 序列化 ──

  describe('serialize / deserialize', () => {
    it('往返序列化保持数据', () => {
      const pack = exporter.exportDomainPack('Docker')!;
      const json = exporter.serialize(pack);
      const restored = exporter.deserialize(json);
      expect(restored).not.toBeNull();
      expect(restored!.domain).toBe('Docker');
      expect(restored!.experiences.length).toBe(pack.experiences.length);
    });

    it('无效 JSON 返回 null', () => {
      expect(exporter.deserialize('not json')).toBeNull();
    });

    it('缺少必要字段返回 null', () => {
      expect(exporter.deserialize('{}')).toBeNull();
    });
  });
});
