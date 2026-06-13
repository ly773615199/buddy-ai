/**
 * EvolutionSink — 将经验进化事件转为训练样本
 *
 * 数据源: ExperienceEvolver.hypothesize() / onSuccess() / onFailure()
 * 优先级: ×1（最低，进化信号是自产的）
 */

import type { TrainingSample } from '../types.js';
import type { SignalSink } from './types.js';

/** 进化信号（从 ExperienceEvolver 接入） */
export interface EvolutionSignal {
  /** 事件类型 */
  eventType: 'success' | 'failure' | 'hypothesis' | 'merged' | 'retired';
  /** 技能 ID */
  skillId: string;
  /** 详情 */
  detail: string;
  /** 相关意图（可选） */
  intent?: number;
  /** 相关工具（可选） */
  tools?: number[];
  /** 上下文特征（可选） */
  contextFeatures?: Float32Array;
}

export class EvolutionSink implements SignalSink {
  readonly source = 'evolution' as const;
  readonly priorityMultiplier = 1.0;

  convert(input: unknown): TrainingSample[] {
    const signal = input as EvolutionSignal;
    if (!signal) return [];

    const now = Date.now();

    switch (signal.eventType) {
      case 'success':
        return [{
          features: signal.contextFeatures ?? new Float32Array(0),
          labelIntent: signal.intent ?? 6,
          labelTools: signal.tools ?? [],
          labelQuality: 0.8,
          outcome: true,
          timestamp: now,
          weight: 1.0,
        }];

      case 'failure':
        return [{
          features: signal.contextFeatures ?? new Float32Array(0),
          labelIntent: signal.intent ?? 6,
          labelTools: signal.tools ?? [],
          labelQuality: 0.2,
          outcome: false,
          timestamp: now,
          weight: 1.0,
        }];

      case 'hypothesis':
        // 假设 = 尝试改进，标记为中性样本
        return [{
          features: signal.contextFeatures ?? new Float32Array(0),
          labelIntent: signal.intent ?? 6,
          labelTools: signal.tools ?? [],
          labelQuality: 0.5,
          outcome: false, // 假设还没验证
          timestamp: now,
          weight: 0.8,
        }];

      case 'merged':
      case 'retired':
        // 合并/淘汰不产生训练样本
        return [];
    }
  }
}
