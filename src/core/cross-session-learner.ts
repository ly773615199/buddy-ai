/**
 * CrossSessionLearner — 跨会话学习迁移
 *
 * 持久化 Thompson Sampling 参数到全局文件，
 * 新 session 启动时自动加载作为 prior，
 * 每次 recordFeedback 时同步写入全局。
 *
 * 增强（前沿调研补充 7.5）：
 * - 多粒度衰减：短期 (24h) 快速遗忘，长期 (7d) 缓慢保留
 * - 多 session 并发写入安全（原子 rename）
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface GlobalThompsonParams {
  /** 按 (taskType, modelId) 聚合 */
  key: string;
  alpha: number;
  beta: number;
  totalSamples: number;
  lastUpdated: number;
  /** 来源 session 列表（最多保留最近 10 个） */
  sourceSessions: string[];
  /** 衰减粒度 */
  decayProfile: {
    shortTerm: { halfLifeMs: number; alpha: number };
    longTerm: { halfLifeMs: number; alpha: number };
  };
}

export interface LearningTransfer {
  /** 从全局参数初始化本地 Thompson */
  initializeLocal(globalKey: string): { alpha: number; beta: number } | null;
  /** 将本地结果上报全局 */
  reportOutcome(taskType: string, modelId: string, success: boolean, latencyMs: number): void;
  /** 获取全局统计 */
  getGlobalStats(): { totalKeys: number; totalSamples: number };
}

// ==================== 默认衰减配置 ====================

const DEFAULT_DECAY_PROFILE = {
  shortTerm: { halfLifeMs: 24 * 60 * 60 * 1000, alpha: 0.5 },   // 24 小时
  longTerm:  { halfLifeMs: 7 * 24 * 60 * 60 * 1000, alpha: 0.1 }, // 7 天
};

const MAX_SOURCE_SESSIONS = 10;

// ==================== 跨会话学习器 ====================

export class CrossSessionLearner implements LearningTransfer {
  private params = new Map<string, GlobalThompsonParams>();
  private readonly dataFile: string;
  private readonly sessionId: string;
  private verbose: boolean;

  constructor(dataDir: string, sessionId?: string, verbose = false) {
    this.dataFile = path.join(dataDir, 'global-thompson.json');
    this.sessionId = sessionId ?? `session-${Date.now()}`;
    this.verbose = verbose;
    this.load();
  }

  // ==================== LearningTransfer 接口 ====================

  /** 从全局参数初始化本地 Thompson */
  initializeLocal(globalKey: string): { alpha: number; beta: number } | null {
    const global = this.params.get(globalKey);
    if (!global) return null;

    // 应用衰减
    const decayed = this.applyDecay(global);
    return { alpha: decayed.alpha, beta: decayed.beta };
  }

  /** 将本地结果上报全局 */
  reportOutcome(taskType: string, modelId: string, success: boolean, latencyMs: number): void {
    const key = `${taskType}:${modelId}`;
    let params = this.params.get(key);

    if (!params) {
      params = {
        key,
        alpha: 1,
        beta: 1,
        totalSamples: 0,
        lastUpdated: Date.now(),
        sourceSessions: [this.sessionId],
        decayProfile: { ...DEFAULT_DECAY_PROFILE },
      };
      this.params.set(key, params);
    }

    // 多维加权成功分（与 ModelPool.recordFeedback 一致）
    let weightedSuccess = 0;
    if (success) {
      weightedSuccess = 1.0;
      if (latencyMs > 5000) weightedSuccess *= 0.7;
      else if (latencyMs > 2000) weightedSuccess *= 0.85;
    }

    params.alpha += weightedSuccess;
    params.beta += (1 - weightedSuccess);
    params.totalSamples++;
    params.lastUpdated = Date.now();

    // 记录来源 session
    if (!params.sourceSessions.includes(this.sessionId)) {
      params.sourceSessions.push(this.sessionId);
      if (params.sourceSessions.length > MAX_SOURCE_SESSIONS) {
        params.sourceSessions.shift();
      }
    }

    this.save();
  }

  /** 获取全局统计 */
  getGlobalStats(): { totalKeys: number; totalSamples: number } {
    let totalSamples = 0;
    for (const p of this.params.values()) {
      totalSamples += p.totalSamples;
    }
    return { totalKeys: this.params.size, totalSamples };
  }

  // ==================== 查询 ====================

  /** 获取指定 key 的全局参数 */
  getParams(key: string): GlobalThompsonParams | null {
    return this.params.get(key) ?? null;
  }

  /** 获取所有全局参数 */
  getAllParams(): GlobalThompsonParams[] {
    return [...this.params.values()];
  }

  /** 获取所有 key（供 ModelPool 初始化时遍历） */
  getKeys(): string[] {
    return [...this.params.keys()];
  }

  // ==================== 衰减 ====================

  /** 应用多粒度衰减 */
  private applyDecay(params: GlobalThompsonParams): { alpha: number; beta: number } {
    const elapsed = Date.now() - params.lastUpdated;
    const profile = params.decayProfile;

    let decayFactor: number;
    if (elapsed < profile.shortTerm.halfLifeMs) {
      // 短期衰减（快速遗忘过时偏好）
      decayFactor = Math.exp(-Math.LN2 * elapsed / profile.shortTerm.halfLifeMs);
      decayFactor = Math.max(decayFactor, profile.shortTerm.alpha);
    } else {
      // 长期衰减（缓慢保留稳定模式）
      decayFactor = Math.exp(-Math.LN2 * elapsed / profile.longTerm.halfLifeMs);
      decayFactor = Math.max(decayFactor, profile.longTerm.alpha);
    }

    // 衰减 alpha 和 beta（向先验 1,1 回归）
    const decayedAlpha = 1 + (params.alpha - 1) * decayFactor;
    const decayedBeta = 1 + (params.beta - 1) * decayFactor;

    return {
      alpha: Math.max(1, decayedAlpha),
      beta: Math.max(1, decayedBeta),
    };
  }

  // ==================== 持久化 ====================

  /** 原子写入（写临时文件后 rename，避免多 session 并发写入损坏） */
  private save(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data: Record<string, GlobalThompsonParams> = {};
      for (const [key, params] of this.params) {
        data[key] = params;
      }

      const tmpFile = this.dataFile + `.tmp-${process.pid}`;
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, this.dataFile);
    } catch {
      // 持久化失败不影响运行
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.dataFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      for (const [key, params] of Object.entries(raw)) {
        this.params.set(key, params as GlobalThompsonParams);
      }
      if (this.verbose) console.log(`[CrossSession] 加载 ${this.params.size} 个全局 Thompson 参数`);
    } catch {
      // 加载失败不影响运行
    }
  }
}
