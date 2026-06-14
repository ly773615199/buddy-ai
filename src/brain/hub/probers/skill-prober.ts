/**
 * SkillProber — 技能包探测器
 *
 * 探测技能是否可安装、可运行、兼容当前版本。
 */

import type { ResourceProber, UnifiedResource, CapabilitySnapshot } from '../types.js';

export class SkillProber implements ResourceProber {
  resourceType = 'skill' as const;
  probeIntervalMs = 24 * 60 * 60 * 1000; // 24 小时
  probeTimeoutMs = 10_000;

  async probe(resource: UnifiedResource): Promise<CapabilitySnapshot> {
    const skillPath = resource.metadata.skillPath as string;
    const caps: CapabilitySnapshot['capabilities'] = {};

    if (!skillPath) {
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: {},
        confidence: 0,
        latencyMs: 0,
        error: '缺少 skillPath 元数据',
      };
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // 检查 SKILL.md 是否存在
      const skillMd = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMd);
        caps.installable = { value: true, verified: true, lastVerifiedAt: Date.now() };
      } catch {
        caps.installable = { value: false, verified: true, lastVerifiedAt: Date.now() };
        return {
          timestamp: Date.now(),
          source: 'probe',
          capabilities: caps,
          confidence: 1,
          latencyMs: 0,
          error: 'SKILL.md 不存在',
        };
      }

      // 检查 package.json 是否存在（可运行性）
      const pkgJson = path.join(skillPath, 'package.json');
      try {
        await fs.access(pkgJson);
        const pkg = JSON.parse(await fs.readFile(pkgJson, 'utf-8'));
        caps.runnable = { value: true, verified: true, lastVerifiedAt: Date.now() };
        caps.compatible = {
          value: !pkg.engines?.node || this.checkNodeVersion(pkg.engines.node),
          verified: true,
          lastVerifiedAt: Date.now(),
        };
      } catch {
        caps.runnable = { value: false, verified: false, lastVerifiedAt: Date.now() };
      }
    } catch (e: any) {
      return {
        timestamp: Date.now(),
        source: 'probe',
        capabilities: caps,
        confidence: 0,
        latencyMs: 0,
        error: e.message,
      };
    }

    return {
      timestamp: Date.now(),
      source: 'probe',
      capabilities: caps,
      confidence: 0.9,
      latencyMs: 0,
    };
  }

  private checkNodeVersion(constraint: string): boolean {
    const current = process.version;
    // 简单的 semver 检查
    const match = constraint.match(/(\D+)?(\d+)/);
    if (!match) return true;
    const required = parseInt(match[2]);
    const currentMajor = parseInt(current.replace('v', '').split('.')[0]);
    const op = match[1] ?? '>=';
    if (op === '>=' || op === '^') return currentMajor >= required;
    if (op === '~') return currentMajor === required;
    return true;
  }
}
