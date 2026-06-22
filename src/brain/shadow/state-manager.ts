/**
 * 状态管理器 — 版本存档 + 进化日志 + 能力图谱 + 收敛追踪
 *
 * 版本存档：每次进化保存完整快照（可回滚到任意版本）
 * 进化日志：记录每次改动的 {原因, 方案, 指标, 结果}
 * 能力图谱：当前能力空间 map（哪些会/哪些不会/刚学会）
 * 收敛追踪：距离目标还差多远
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  EvolutionSnapshot, EvolutionLogEntry, CapabilityMap,
  CapabilityEntry, CapabilityStatus,
} from './types.js';

/** 意图注册表条目 */
export interface IntentRegistryEntry {
  label: string;
  description: string;
  registeredAt: number;
  status: 'pending' | 'active';
}

export class EvolutionStateManager {
  private snapshots: EvolutionSnapshot[] = [];
  private log: EvolutionLogEntry[] = [];
  private capabilityMap: Map<string, CapabilityEntry> = new Map();
  private intentRegistry: Map<number, IntentRegistryEntry> = new Map();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.loadIntentRegistry();
  }

  // ==================== 版本存档 ====================

  /**
   * 保存当前状态快照
   */
  async saveSnapshot(snapshot: Omit<EvolutionSnapshot, 'version' | 'timestamp'>): Promise<number> {
    const version = this.snapshots.length + 1;
    const full: EvolutionSnapshot = {
      version,
      timestamp: Date.now(),
      ...snapshot,
    };
    this.snapshots.push(full);
    await this.persistSnapshot(full);
    return version;
  }

  /**
   * 获取指定版本的快照
   */
  getSnapshot(version: number): EvolutionSnapshot | undefined {
    return this.snapshots.find(s => s.version === version);
  }

  /**
   * 获取最新快照
   */
  getLatestSnapshot(): EvolutionSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * 获取当前版本号
   */
  get currentVersion(): number {
    return this.snapshots.length;
  }

  // ==================== 进化日志 ====================

  /**
   * 记录进化日志
   */
  logEvolution(entry: Omit<EvolutionLogEntry, 'version' | 'timestamp'>): void {
    const full: EvolutionLogEntry = {
      version: this.snapshots.length,
      timestamp: Date.now(),
      ...entry,
    };
    this.log.push(full);
    this.persistLog(full);
  }

  /**
   * 获取进化日志
   */
  getLog(limit?: number): EvolutionLogEntry[] {
    return limit ? this.log.slice(-limit) : [...this.log];
  }

  // ==================== 能力图谱 ====================

  /**
   * 更新能力图谱
   *
   * 滑动平均更新成功率，自动判定状态
   */
  updateCapability(fingerprint: string, success: boolean, description: string): void {
    let cap = this.capabilityMap.get(fingerprint);
    if (!cap) {
      cap = {
        fingerprint,
        description,
        status: 'learning',
        successRate: 0,
        lastUpdated: Date.now(),
      };
      this.capabilityMap.set(fingerprint, cap);
    }

    cap.successRate = cap.successRate * 0.9 + (success ? 0.1 : 0);
    cap.lastUpdated = Date.now();

    if (cap.successRate >= 0.8) cap.status = 'mastered';
    else if (cap.successRate >= 0.5) cap.status = 'learning';
    else cap.status = 'gap';
  }

  /**
   * 标记能力为正在进化
   */
  markEvolving(fingerprint: string): void {
    const cap = this.capabilityMap.get(fingerprint);
    if (cap) {
      cap.status = 'evolving';
      cap.lastUpdated = Date.now();
    }
  }

  /**
   * 获取能力图谱
   */
  getCapabilityMap(): CapabilityMap {
    const caps = [...this.capabilityMap.values()];
    return {
      capabilities: caps,
      totalCapabilities: caps.length,
      masteredCount: caps.filter(c => c.status === 'mastered').length,
      gapCount: caps.filter(c => c.status === 'gap').length,
      evolvingCount: caps.filter(c => c.status === 'evolving').length,
    };
  }

  /**
   * 获取指定能力
   */
  getCapability(fingerprint: string): CapabilityEntry | undefined {
    return this.capabilityMap.get(fingerprint);
  }

  // ==================== 进化摘要 ====================

  /**
   * 获取进化历史摘要
   */
  getEvolutionSummary(): {
    totalEvolutions: number;
    successfulEvolutions: number;
    rejectedEvolutions: number;
    rolledBackEvolutions: number;
    avgGdiImprovement: number;
    currentVersion: number;
  } {
    const applied = this.log.filter(e => e.result === 'applied');
    const rejected = this.log.filter(e => e.result === 'rejected');
    const rolledBack = this.log.filter(e => e.result === 'rolled_back');

    return {
      totalEvolutions: this.log.length,
      successfulEvolutions: applied.length,
      rejectedEvolutions: rejected.length,
      rolledBackEvolutions: rolledBack.length,
      avgGdiImprovement: applied.length > 0
        ? applied.reduce((s, e) => s + ((e.metricsBefore['gdi'] ?? 0) - (e.metricsAfter['gdi'] ?? 0)), 0) / applied.length
        : 0,
      currentVersion: this.snapshots.length,
    };
  }

  // ==================== 持久化 ====================

  private async persistSnapshot(snapshot: EvolutionSnapshot): Promise<void> {
    try {
      const dir = path.join(this.dataDir, 'evolution', 'snapshots');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `v${snapshot.version}.json`);
      await fs.promises.writeFile(file, JSON.stringify(snapshot, null, 2));
    } catch {
      // 静默失败，不影响主流程
    }
  }

  private async persistLog(entry: EvolutionLogEntry): Promise<void> {
    try {
      const dir = path.join(this.dataDir, 'evolution');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'log.jsonl');
      await fs.promises.appendFile(file, JSON.stringify(entry) + '\n');
    } catch {
      // 静默失败
    }
  }

  // ==================== 意图注册表 ====================

  /**
   * 注册新意图类别（L2 进化写回）
   * 持久化到 intent-registry.json
   */
  registerNewIntents(intents: Array<{ label: string; description: string }>, baseIndex: number): void {
    for (let i = 0; i < intents.length; i++) {
      this.intentRegistry.set(baseIndex + i, {
        label: intents[i].label,
        description: intents[i].description,
        registeredAt: Date.now(),
        status: 'pending',
      });
    }
    this.persistIntentRegistry();
  }

  /** 标记意图为主动（训练完成后激活） */
  activateIntent(index: number): void {
    const entry = this.intentRegistry.get(index);
    if (entry) {
      entry.status = 'active';
      this.persistIntentRegistry();
    }
  }

  /** 获取所有已注册意图 */
  getIntentRegistry(): Map<number, IntentRegistryEntry> {
    return new Map(this.intentRegistry);
  }

  /** 获取当前意图总数（原始 + 扩展） */
  getTotalIntentCount(baseCount: number): number {
    let max = baseCount;
    for (const key of this.intentRegistry.keys()) {
      if (key >= max) max = key + 1;
    }
    return max;
  }

  private loadIntentRegistry(): void {
    try {
      const file = path.join(this.dataDir, 'evolution', 'intent-registry.json');
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        for (const [key, value] of Object.entries(data)) {
          this.intentRegistry.set(Number(key), value as IntentRegistryEntry);
        }
      }
    } catch {
      // 静默失败
    }
  }

  private persistIntentRegistry(): void {
    try {
      const dir = path.join(this.dataDir, 'evolution');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'intent-registry.json');
      const data: Record<string, IntentRegistryEntry> = {};
      for (const [key, value] of this.intentRegistry) {
        data[String(key)] = value;
      }
      fs.promises.writeFile(file, JSON.stringify(data, null, 2))
        .catch(() => { /* 静默失败 */ });
    } catch {
      // 静默失败
    }
  }
}
