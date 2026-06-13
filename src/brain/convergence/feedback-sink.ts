/**
 * FeedbackSink — 将用户纠正转为训练样本
 *
 * 数据源: FeedbackLearner.detectCorrection() + applyCorrection()
 * 优先级: ×3（最高，用户纠正是最直接的外部信号）
 */

import type { TrainingSample } from '../types.js';
import type { SignalSink } from './types.js';

/** 纠正信号（从 FeedbackLearner 接入） */
export interface FeedbackSignal {
  type: 'correction' | 'remember' | 'preference' | 'encouragement';
  content: string;
  importance: number;
  negative?: boolean;
  /** 当前对话的上下文特征（可选，用于构造 features） */
  contextFeatures?: Float32Array;
  /** 当前意图分类 */
  currentIntent?: number;
  /** 当前工具选择 */
  currentTools?: number[];
}

/** 意图关键词映射（从纠正内容推断正确意图） */
const INTENT_KEYWORDS: Array<{ patterns: RegExp[]; intent: number; tools: number[] }> = [
  { patterns: [/文件|读|写|创建|删除|保存|file|read|write/i], intent: 0, tools: [0, 1] },
  { patterns: [/代码|函数|重构|测试|code|function|test/i], intent: 1, tools: [0, 4, 3] },
  { patterns: [/git|提交|分支|commit|branch/i], intent: 2, tools: [5, 8, 9] },
  { patterns: [/搜索|网页|search|web|url/i], intent: 3, tools: [12, 13] },
  { patterns: [/命令|运行|执行|系统|exec|run|system/i], intent: 4, tools: [4] },
  { patterns: [/是什么|为什么|怎么|原理|what|why|how/i], intent: 5, tools: [12] },
];

export class FeedbackSink implements SignalSink {
  readonly source = 'feedback' as const;
  readonly priorityMultiplier = 3.0;

  convert(input: unknown): TrainingSample[] {
    const signal = input as FeedbackSignal;
    if (!signal || !signal.content) return [];

    const now = Date.now();

    // 鼓励信号 → 正样本，但权重较低
    if (signal.type === 'encouragement') {
      return [{
        features: signal.contextFeatures ?? new Float32Array(0),
        labelIntent: signal.currentIntent ?? 6,
        labelTools: signal.currentTools ?? [],
        labelQuality: 0.9,
        outcome: true,
        timestamp: now,
        weight: 0.5, // 基础权重较低，Prioritizer 会乘以 3.0 → 最终 1.5
      }];
    }

    // 负面纠正 → 构造反事实样本（"不应该这样做"）
    if (signal.negative) {
      return [{
        features: signal.contextFeatures ?? new Float32Array(0),
        labelIntent: signal.currentIntent ?? 6,
        labelTools: signal.currentTools ?? [],
        labelQuality: 0.1,
        outcome: false,
        timestamp: now,
        weight: 1.0, // 基础权重，优先级乘数由 Prioritizer 应用
      }];
    }

    // 正面纠正/记住 → 从内容推断正确做法
    const inferred = this.inferFromContent(signal.content);
    return [{
      features: signal.contextFeatures ?? new Float32Array(0),
      labelIntent: inferred.intent,
      labelTools: inferred.tools,
      labelQuality: 0.85,
      outcome: true,
      timestamp: now,
      weight: 1.0, // 基础权重，优先级乘数由 Prioritizer 应用
    }];
  }

  /**
   * 从纠正内容推断正确的意图和工具
   */
  private inferFromContent(content: string): { intent: number; tools: number[] } {
    for (const mapping of INTENT_KEYWORDS) {
      for (const pattern of mapping.patterns) {
        if (pattern.test(content)) {
          return { intent: mapping.intent, tools: mapping.tools };
        }
      }
    }
    // 默认：对话意图
    return { intent: 6, tools: [] };
  }
}
