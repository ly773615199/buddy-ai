/**
 * DriftDetector — 能力漂移检测器
 *
 * 对每个资源的每个能力维度，维护滑动窗口统计。
 * 当新探测值与历史值偏离超过阈值时，发出漂移告警。
 *
 * 布尔值：计算翻转率（连续 true→false 或 false→true 的比例）
 * 数值：计算变异系数（标准差 / 均值）
 */

import type { CapabilitySnapshot, DriftAlert, DriftSeverity, ResourceType } from './types.js';

interface DriftWindow {
  dimension: string;
  values: Array<{ value: boolean | number | string; timestamp: number }>;
}

interface DriftTypeConfig {
  windowSize: number;
  warningThreshold: number;
  criticalThreshold: number;
}

interface DriftDetectorConfig {
  model: DriftTypeConfig;
  tool: DriftTypeConfig;
  knowledge_source: DriftTypeConfig;
  default: DriftTypeConfig;
  [key: string]: DriftTypeConfig;
}

const DEFAULT_CONFIG: DriftDetectorConfig = {
  model:            { windowSize: 10, warningThreshold: 0.4, criticalThreshold: 0.7 },  // 模型: 大窗口低敏感
  tool:             { windowSize: 30, warningThreshold: 0.2, criticalThreshold: 0.5 },  // 工具: 小窗口高敏感
  knowledge_source: { windowSize: 15, warningThreshold: 0.3, criticalThreshold: 0.6 },
  default:          { windowSize: 20, warningThreshold: 0.3, criticalThreshold: 0.6 },
};

export class DriftDetector {
  private windows: Map<string, DriftWindow> = new Map();
  private readonly config: DriftDetectorConfig;

  constructor(config?: Partial<DriftDetectorConfig>) {
    this.config = {
      model: config?.model ?? DEFAULT_CONFIG.model,
      tool: config?.tool ?? DEFAULT_CONFIG.tool,
      knowledge_source: config?.knowledge_source ?? DEFAULT_CONFIG.knowledge_source,
      default: config?.default ?? DEFAULT_CONFIG.default,
    };
  }

  /**
   * 从 resourceId 推断资源类型（model/siliconflow/... → model, tool/... → tool）
   */
  private resolveType(resourceId: string): ResourceType | 'default' {
    const prefix = resourceId.split('/')[0];
    if (prefix === 'model' || prefix === 'tool' || prefix === 'knowledge_source') return prefix;
    return 'default';
  }

  /**
   * 记录新的探测值并检测漂移
   * @returns 漂移告警（无漂移返回 null）
   */
  detect(
    resourceId: string,
    dimension: string,
    newValue: boolean | number | string,
    timestamp: number = Date.now(),
  ): DriftAlert | null {
    const key = `${resourceId}:${dimension}`;
    const resType = this.resolveType(resourceId);
    const cfg = this.config[resType];

    let window = this.windows.get(key);
    if (!window) {
      window = { dimension, values: [] };
      this.windows.set(key, window);
    }

    // 计算漂移分数（在添加新值之前）
    const driftScore = this.computeDriftScore(window.values.map(v => v.value), newValue);

    // 添加新值到窗口（字符串值不做漂移检测，直接返回 null）
    if (typeof newValue === 'string') return null;
    window.values.push({ value: newValue, timestamp });
    if (window.values.length > cfg.windowSize) {
      window.values.shift();
    }

    // 数据不足时不做判断
    if (window.values.length < 3) return null;

    // 判断是否漂移（使用类型对应的阈值）
    if (driftScore > cfg.criticalThreshold) {
      return {
        dimension,
        driftScore,
        timestamp,
        severity: 'critical',
        message: `${dimension} 严重漂移 (score=${driftScore.toFixed(2)}, type=${resType})`,
      };
    }
    if (driftScore > cfg.warningThreshold) {
      return {
        dimension,
        driftScore,
        timestamp,
        severity: 'warning',
        message: `${dimension} 轻度漂移 (score=${driftScore.toFixed(2)}, type=${resType})`,
      };
    }

    return null;
  }

  /**
   * 批量检测一个快照的所有维度
   */
  detectSnapshot(
    resourceId: string,
    snapshot: CapabilitySnapshot,
  ): DriftAlert[] {
    const alerts: DriftAlert[] = [];
    for (const [dim, capVal] of Object.entries(snapshot.capabilities)) {
      const alert = this.detect(resourceId, dim, capVal.value, snapshot.timestamp);
      if (alert) alerts.push(alert);
    }
    return alerts;
  }

  /**
   * 获取某维度的历史值
   */
  getHistory(resourceId: string, dimension: string): Array<{ value: boolean | number | string; timestamp: number }> {
    return this.windows.get(`${resourceId}:${dimension}`)?.values ?? [];
  }

  /**
   * 清除某资源的所有漂移数据
   */
  clear(resourceId: string): void {
    for (const key of this.windows.keys()) {
      if (key.startsWith(`${resourceId}:`)) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * 获取当前漂移分数（不记录新值）
   */
  getDriftScore(resourceId: string, dimension: string, newValue: boolean | number | string): number {
    const window = this.windows.get(`${resourceId}:${dimension}`);
    if (!window || window.values.length < 3) return 0;
    return this.computeDriftScore(window.values.map(v => v.value), newValue);
  }

  // ==================== 内部 ====================

  private computeDriftScore(historical: Array<boolean | number | string>, newValue: boolean | number | string): number {
    if (historical.length < 2) return 0;

    // 字符串值不做漂移检测
    if (typeof newValue === 'string') return 0;

    // 布尔值：翻转率
    if (typeof newValue === 'boolean') {
      const flips = historical.filter(h => h !== newValue).length;
      return flips / historical.length;
    }

    // 数值：新值与历史均值的偏离程度（归一化到 0-1）
    const numValues = historical.filter(h => typeof h === 'number') as number[];
    if (numValues.length < 2) return 0;

    const mean = numValues.reduce((a, b) => a + b, 0) / numValues.length;
    const variance = numValues.reduce((a, b) => a + (b - mean) ** 2, 0) / numValues.length;
    const stdDev = Math.sqrt(variance);

    // 如果历史值完全一致（stdDev=0），用新值与均值的比例判断
    if (stdDev === 0) {
      if (mean === 0) return 0;
      const ratio = Math.abs(newValue - mean) / Math.abs(mean);
      return Math.min(1, ratio); // 归一化到 0-1
    }

    // z-score 归一化：z = |new - mean| / stdDev，然后压缩到 0-1
    const zscore = Math.abs((newValue as number) - mean) / stdDev;
    return Math.min(1, zscore / 3); // z-score 3 = 3σ → 归一化为 1
  }
}
