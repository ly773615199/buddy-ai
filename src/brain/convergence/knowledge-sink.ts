/**
 * KnowledgeSink — 将学习到的知识转为训练样本
 *
 * 数据源: BuddyLearn.learnFromText/File/Url()
 * 优先级: ×2（知识未经实践验证，低于纠正）
 */

import type { TrainingSample } from '../types.js';
import type { SignalSink } from './types.js';

/** 知识信号（从 BuddyLearn 接入） */
export interface KnowledgeSignal {
  /** 知识内容 */
  content: string;
  /** 来源类型 */
  sourceType: 'file' | 'url' | 'text';
  /** 来源标识 */
  source: string;
  /** 领域标签（可选） */
  domain?: string;
  /** 上下文特征（可选） */
  contextFeatures?: Float32Array;
}

/** 领域 → 意图/工具映射 */
const DOMAIN_MAP: Record<string, { intent: number; tools: number[] }> = {
  'file': { intent: 0, tools: [0, 1, 2] },
  'code': { intent: 1, tools: [0, 4, 3] },
  'git': { intent: 2, tools: [5, 8] },
  'web': { intent: 3, tools: [12, 13] },
  'system': { intent: 4, tools: [4] },
  'knowledge': { intent: 5, tools: [12] },
  'conversation': { intent: 6, tools: [] },
};

/** 从内容推断领域 */
function inferDomain(content: string): string {
  const lower = content.toLowerCase();
  if (/\.(ts|js|py|java|go|rs|cpp|c)\b/.test(lower) || /function|class|import|export/.test(lower)) return 'code';
  if (/git|commit|branch|merge|push|pull/.test(lower)) return 'git';
  if (/http|url|网页|web|api/.test(lower)) return 'web';
  if (/系统|system|config|部署|deploy/.test(lower)) return 'system';
  if (/文件|file|目录|folder|path/.test(lower)) return 'file';
  return 'knowledge';
}

export class KnowledgeSink implements SignalSink {
  readonly source = 'knowledge' as const;
  readonly priorityMultiplier = 2.0;

  convert(input: unknown): TrainingSample[] {
    const signal = input as KnowledgeSignal;
    if (!signal || !signal.content) return [];

    const now = Date.now();
    const domain = signal.domain ?? inferDomain(signal.content);
    const mapping = DOMAIN_MAP[domain] ?? DOMAIN_MAP['knowledge'];

    // 知识样本：质量中等（未经实践验证），outcome=true
    return [{
      features: signal.contextFeatures ?? new Float32Array(0),
      labelIntent: mapping.intent,
      labelTools: mapping.tools,
      labelQuality: 0.7,
      outcome: true,
      timestamp: now,
      weight: 1.0, // 基础权重，优先级乘数由 Prioritizer 应用
    }];
  }
}
