/**
 * SkillGrowth — Skill 成长追踪系统
 *
 * 追踪每个 Skill 的使用情况：成功率、执行时间、错误模式。
 * 数据持久化到 ~/.buddy/skill-metrics.json，重启不丢失。
 *
 * 成长维度：
 *   1. 健康度 — 成功率趋势
 *   2. 熟练度 — 使用频次
 *   3. 可靠性 — 错误率
 *   4. 效率 — 执行时间趋势
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';

export interface SkillMetric {
  name: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  lastUsed: number;          // timestamp
  lastError?: string;
  errorPatterns: Record<string, number>;  // error message → count
  dailyUsage: Record<string, number>;     // YYYY-MM-DD → count
}

export interface SkillHealth {
  name: string;
  healthScore: number;       // 0-100
  proficiency: number;       // 0-100 (usage frequency)
  reliability: number;       // 0-100 (success rate)
  efficiency: number;        // 0-100 (speed score)
  trend: 'improving' | 'stable' | 'declining';
  suggestion?: string;
}

const METRICS_FILE = path.join(process.env.HOME ?? '/root', '.buddy', 'skill-metrics.json');

export class SkillGrowth {
  private metrics: Map<string, SkillMetric> = new Map();
  private dirty = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownHooksInstalled = false;

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(METRICS_FILE, 'utf-8');
      const parsed = JSON.parse(data) as SkillMetric[];
      for (const m of parsed) {
        this.metrics.set(m.name, m);
      }
    } catch {
      // 文件不存在或损坏，从空开始
    }

    // 安装自动保存
    this._installAutoSave();
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(METRICS_FILE), { recursive: true });
      await fs.writeFile(METRICS_FILE, JSON.stringify([...this.metrics.values()], null, 2));
      this.dirty = false;
    } catch {
      // 保存失败不阻塞
    }
  }

  /** 安装自动保存：定时写入 + 进程退出时保存 */
  private _installAutoSave(): void {
    if (this.shutdownHooksInstalled) return;
    this.shutdownHooksInstalled = true;

    // 每 60 秒自动保存一次
    this.autoSaveTimer = setInterval(() => {
      this.save().catch(() => {});
    }, 60_000);

    // 进程退出时保存
    const flush = () => {
      if (!this.dirty) return;
      try {
        // 同步写入，确保进程退出前完成
        const dir = path.dirname(METRICS_FILE);
        if (!fss.existsSync(dir)) fss.mkdirSync(dir, { recursive: true });
        fss.writeFileSync(METRICS_FILE, JSON.stringify([...this.metrics.values()], null, 2));
        this.dirty = false;
      } catch { /* best effort */ }
    };

    process.on('beforeExit', flush);
    process.on('SIGINT', () => { flush(); process.exit(0); });
    process.on('SIGTERM', () => { flush(); process.exit(0); });
  }

  /** 清理定时器（用于测试或卸载） */
  dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.save().catch(() => {});
  }

  /** 记录一次 Skill 调用 */
  record(name: string, success: boolean, durationMs: number, error?: string): void {
    let m = this.metrics.get(name);
    if (!m) {
      m = {
        name,
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        lastUsed: 0,
        errorPatterns: {},
        dailyUsage: {},
      };
      this.metrics.set(name, m);
    }

    m.totalCalls++;
    if (success) {
      m.successCount++;
    } else {
      m.failureCount++;
      if (error) {
        m.lastError = error;
        // 归类错误模式（取前 50 字符作为 key）
        const pattern = error.slice(0, 50);
        m.errorPatterns[pattern] = (m.errorPatterns[pattern] ?? 0) + 1;
      }
    }
    m.totalDurationMs += durationMs;
    m.lastUsed = Date.now();

    // 按天统计
    const today = new Date().toISOString().slice(0, 10);
    m.dailyUsage[today] = (m.dailyUsage[today] ?? 0) + 1;

    this.dirty = true;
  }

  /** 获取单个 Skill 健康度 */
  getHealth(name: string): SkillHealth | null {
    const m = this.metrics.get(name);
    if (!m) return null;

    const successRate = m.totalCalls > 0 ? m.successCount / m.totalCalls : 0;
    const avgDuration = m.totalCalls > 0 ? m.totalDurationMs / m.totalCalls : 0;

    // 健康度 = 成功率 60% + 效率 20% + 活跃度 20%
    const reliability = Math.round(successRate * 100);
    const efficiency = Math.round(Math.max(0, 100 - avgDuration / 100)); // 100ms 内满分
    const proficiency = Math.round(Math.min(100, m.totalCalls * 5)); // 20 次调用满分
    const healthScore = Math.round(reliability * 0.6 + efficiency * 0.2 + proficiency * 0.2);

    // 趋势：比较最近 7 天 vs 之前
    const recentDays = Object.entries(m.dailyUsage)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7);
    const recentTotal = recentDays.reduce((s, [, v]) => s + v, 0);
    const olderTotal = m.totalCalls - recentTotal;
    const trend = recentTotal > olderTotal * 1.2 ? 'improving'
      : recentTotal < olderTotal * 0.8 ? 'declining'
      : 'stable';

    // 建议
    let suggestion: string | undefined;
    if (reliability < 50) suggestion = '错误率过高，检查参数或依赖';
    else if (efficiency < 30) suggestion = '执行缓慢，考虑优化或设置超时';
    else if (proficiency < 20) suggestion = '使用较少，可能不需要';

    return { name, healthScore, proficiency, reliability, efficiency, trend, suggestion };
  }

  /** 获取全部 Skill 健康报告 */
  getAllHealth(): SkillHealth[] {
    return [...this.metrics.values()]
      .map(m => this.getHealth(m.name)!)
      .sort((a, b) => b.healthScore - a.healthScore);
  }

  /** 获取原始指标 */
  getMetric(name: string): SkillMetric | undefined {
    return this.metrics.get(name);
  }

  /** 获取 Top N 活跃 Skill */
  getTopActive(n = 10): Array<{ name: string; calls: number; successRate: number }> {
    return [...this.metrics.values()]
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, n)
      .map(m => ({
        name: m.name,
        calls: m.totalCalls,
        successRate: m.totalCalls > 0 ? Math.round(m.successCount / m.totalCalls * 100) : 0,
      }));
  }
}
