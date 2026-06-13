/**
 * ConfidenceCalibrator — 置信度在线校准器
 *
 * 基于 Online Platt Scaling
 * 输入: 模块名 + 原始 confidence + 实际 outcome
 * 输出: 校准后的 confidence（语义统一，可跨模块比较）
 *
 * 解决: 各模块置信度硬编码，跨模块不可比
 */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface CalibratorParams {
  a: number;  // Platt scaling 参数 a
  b: number;  // Platt scaling 参数 b
  count: number; // 样本计数
}

export class ConfidenceCalibrator {
  /** 每个模块的校准参数 */
  private calibrators: Map<string, CalibratorParams> = new Map();

  /** 最小样本数：低于此数不校准，返回原始值 */
  private readonly minSamples: number;

  /** 学习率 */
  private readonly learningRate: number;

  constructor(options?: { minSamples?: number; learningRate?: number }) {
    this.minSamples = options?.minSamples ?? 5;
    this.learningRate = options?.learningRate ?? 0.01;
  }

  /**
   * 校准原始置信度
   * 样本不足时返回原始值（不做校准）
   */
  calibrate(moduleName: string, rawConfidence: number): number {
    const cal = this.calibrators.get(moduleName);
    if (!cal || cal.count < this.minSamples) return rawConfidence;
    return sigmoid(cal.a * rawConfidence + cal.b);
  }

  /**
   * 更新校准模型 — feedback() 中调用
   * 在线 logistic regression 更新
   */
  update(moduleName: string, rawConfidence: number, outcome: boolean): void {
    const cal = this.calibrators.get(moduleName) ?? { a: 1, b: 0, count: 0 };
    const predicted = sigmoid(cal.a * rawConfidence + cal.b);
    const error = (outcome ? 1 : 0) - predicted;
    const lr = this.learningRate;

    // 在线梯度更新
    cal.a += lr * error * rawConfidence;
    cal.b += lr * error;
    cal.count++;

    this.calibrators.set(moduleName, cal);
  }

  /** 是否已校准（至少 minSamples 个样本） */
  isCalibrated(moduleName: string): boolean {
    return (this.calibrators.get(moduleName)?.count ?? 0) >= this.minSamples;
  }

  /** 获取校准参数（调试用） */
  getParams(moduleName: string): { a: number; b: number; count: number } | undefined {
    return this.calibrators.get(moduleName);
  }

  /** 获取所有已校准模块 */
  getCalibratedModules(): string[] {
    const modules: string[] = [];
    for (const [name, cal] of this.calibrators) {
      if (cal.count >= this.minSamples) modules.push(name);
    }
    return modules;
  }

  /** 重置指定模块的校准器 */
  reset(moduleName: string): void {
    this.calibrators.delete(moduleName);
  }

  /** 重置所有校准器 */
  resetAll(): void {
    this.calibrators.clear();
  }
}
