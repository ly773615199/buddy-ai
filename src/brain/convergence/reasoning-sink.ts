/**
 * ReasoningSink — 将推理链转为训练样本
 *
 * 数据源: ReasoningChainStore.conclude()
 * 优先级: ×1.5（推理结论有参考价值但未经完整验证）
 */

import type { TrainingSample } from '../types.js';
import type { SignalSink } from './types.js';

/** 推理链信号（从 ReasoningChainStore 接入） */
export interface ReasoningSignal {
  /** 推理主题 */
  topic: string;
  /** 结论列表 */
  conclusions: string[];
  /** 整体置信度 0-1 */
  confidence: number;
  /** 上下文特征（可选） */
  contextFeatures?: Float32Array;
}

/** 从主题推断意图 */
function inferIntentFromTopic(topic: string): { intent: number; tools: number[] } {
  const lower = topic.toLowerCase();
  if (/文件|读写|file|read|write/.test(lower)) return { intent: 0, tools: [0, 1] };
  if (/代码|函数|重构|code|function/.test(lower)) return { intent: 1, tools: [0, 4] };
  if (/git|提交|分支/.test(lower)) return { intent: 2, tools: [5, 8] };
  if (/搜索|网页|web|search/.test(lower)) return { intent: 3, tools: [12, 13] };
  if (/命令|系统|exec|system/.test(lower)) return { intent: 4, tools: [4] };
  if (/是什么|为什么|what|why|how/.test(lower)) return { intent: 5, tools: [12] };
  return { intent: 6, tools: [] };
}

export class ReasoningSink implements SignalSink {
  readonly source = 'reasoning' as const;
  readonly priorityMultiplier = 1.5;

  convert(input: unknown): TrainingSample[] {
    const signal = input as ReasoningSignal;
    if (!signal || !signal.conclusions || signal.conclusions.length === 0) return [];

    // 低置信度推理不学
    if (signal.confidence < 0.5) return [];

    const now = Date.now();
    const inferred = inferIntentFromTopic(signal.topic);

    return [{
      features: signal.contextFeatures ?? new Float32Array(0),
      labelIntent: inferred.intent,
      labelTools: inferred.tools,
      labelQuality: signal.confidence,
      outcome: signal.confidence > 0.7,
      timestamp: now,
      weight: 1.0, // 基础权重，优先级乘数由 Prioritizer 应用
    }];
  }
}
