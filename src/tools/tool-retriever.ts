/**
 * 工具语义检索器 — 当工具数量过多时，按用户意图筛选最相关的工具
 *
 * 使用关键词匹配 + TF-IDF 风格评分，不需要嵌入向量或外部依赖。
 */

import type { ToolDef } from '../types.js';

export interface ToolRetrieverConfig {
  maxTools: number;          // 最多返回工具数
  minScore: number;          // 最低相关度分数
}

export interface ToolScore {
  name: string;
  score: number;             // 0-1 相关度
  reason: string;            // 匹配原因
}

interface ToolDoc {
  name: string;
  description: string;
  keywords: string[];
  toolDef: ToolDef;
}

// ==================== 分词 ====================

/** 中英文停用词 */
const STOP_WORDS = new Set([
  // 英文
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'about', 'up', 'out', 'if', 'or',
  'and', 'but', 'not', 'no', 'this', 'that', 'it', 'its',
  // 中文
  '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '我', '吗',
  '什么', '怎么', '那个', '这个', '可以', '把', '被', '让', '给', '从',
]);

/** Intl.Segmenter 实例（Node 22 内置，零依赖中文分词） */
let zhSegmenter: Intl.Segmenter | null = null;
try {
  zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
} catch { /* 不支持时降级到 2-gram */ }

function simpleTokenize(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ');

  // 英文词
  const englishWords = cleaned.match(/[a-z]{2,}/g) ?? [];
  tokens.push(...englishWords.filter(w => !STOP_WORDS.has(w)));

  // 中文分词
  const chineseBlocks = cleaned.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const block of chineseBlocks) {
    if (zhSegmenter) {
      // Intl.Segmenter 精确分词
      for (const seg of zhSegmenter.segment(block)) {
        if (seg.isWordLike && seg.segment.length >= 2 && !STOP_WORDS.has(seg.segment)) {
          tokens.push(seg.segment);
        }
      }
      // 同时保留全词
      if (block.length >= 2 && !STOP_WORDS.has(block)) {
        tokens.push(block);
      }
    } else {
      // 降级：2-gram
      for (let i = 0; i < block.length - 1; i++) {
        const bigram = block.slice(i, i + 2);
        if (!STOP_WORDS.has(bigram)) tokens.push(bigram);
      }
      if (block.length > 0 && !STOP_WORDS.has(block)) tokens.push(block);
    }
  }

  return [...new Set(tokens)];
}

// ==================== 评分 ====================

function scoreTool(query: string, doc: ToolDoc, contextTags: string[]): { score: number; reason: string } {
  const queryTokens = simpleTokenize(query);
  if (queryTokens.length === 0) return { score: 0, reason: '无有效查询词' };

  let rawScore = 0;
  const reasons: string[] = [];

  // 1. 名称匹配（权重 3）
  for (const q of queryTokens) {
    if (doc.name.toLowerCase().includes(q)) {
      rawScore += 3;
      if (!reasons.includes('名称匹配')) reasons.push('名称匹配');
    }
  }

  // 2. 描述关键词匹配（权重 1）
  for (const q of queryTokens) {
    for (const k of doc.keywords) {
      if (k.includes(q) || q.includes(k)) {
        rawScore += 1;
        if (!reasons.includes('描述匹配')) reasons.push('描述匹配');
        break;
      }
    }
  }

  // 3. 上下文标签匹配（权重 2）
  for (const tag of contextTags) {
    const tagLower = tag.toLowerCase();
    if (doc.keywords.some(k => k.includes(tagLower) || tagLower.includes(k))) {
      rawScore += 2;
      if (!reasons.includes('标签匹配')) reasons.push('标签匹配');
    }
  }

  // 归一化
  const maxScore = queryTokens.length * 3 + queryTokens.length + contextTags.length * 2;
  const normalized = Math.min(rawScore / Math.max(maxScore, 1), 1);

  return {
    score: Math.round(normalized * 100) / 100,
    reason: reasons.join(' + ') || '无匹配',
  };
}

// ==================== 检索器 ====================

const DEFAULT_CONFIG: ToolRetrieverConfig = {
  maxTools: 15,
  minScore: 0.05,
};

export class ToolRetriever {
  private docs: Map<string, ToolDoc> = new Map();
  private config: ToolRetrieverConfig;
  /** 使用频率追踪（工具名 → 最近使用时间戳列表） */
  private usageLog: Map<string, number[]> = new Map();

  constructor(config?: Partial<ToolRetrieverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 记录工具使用（用于频率权重） */
  recordUsage(toolName: string): void {
    const now = Date.now();
    const log = this.usageLog.get(toolName) ?? [];
    log.push(now);
    // 只保留最近 24 小时的记录
    const cutoff = now - 24 * 60 * 60 * 1000;
    this.usageLog.set(toolName, log.filter(t => t > cutoff));
  }

  /** 计算频率权重（24h 内使用次数，衰减加权） */
  private getFrequencyBoost(toolName: string): number {
    const log = this.usageLog.get(toolName);
    if (!log || log.length === 0) return 0;
    const now = Date.now();
    // 最近 1 小时权重 1.0，之后指数衰减
    const boost = log.reduce((sum, t) => {
      const hoursAgo = (now - t) / (60 * 60 * 1000);
      return sum + Math.exp(-hoursAgo);
    }, 0);
    return Math.min(boost, 2); // 最多加 2 分
  }

  /** 索引工具列表 */
  indexTools(tools: ToolDef[]): void {
    for (const tool of tools) {
      if (this.docs.has(tool.name)) continue;

      const descText = `${tool.name} ${tool.description}`;
      const keywords = simpleTokenize(descText);

      this.docs.set(tool.name, {
        name: tool.name,
        description: tool.description,
        keywords,
        toolDef: tool,
      });
    }
  }

  /** 根据用户意图检索最相关的工具 */
  retrieve(query: string, contextTags: string[] = []): ToolScore[] {
    const scores: ToolScore[] = [];

    for (const [name, doc] of this.docs) {
      const { score, reason } = scoreTool(query, doc, contextTags);
      const freqBoost = this.getFrequencyBoost(name);
      const finalScore = score + freqBoost;
      if (finalScore >= this.config.minScore) {
        const reasons: string[] = [reason];
        if (freqBoost > 0.1) reasons.push(`高频使用+${freqBoost.toFixed(1)}`);
        scores.push({ name, score: finalScore, reason: reasons.join(', ') });
      }
    }

    // 按分数降序
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, this.config.maxTools);
  }

  /** 获取推荐注入 prompt 的工具定义列表 */
  getToolsForPrompt(query: string, contextTags: string[] = []): ToolDef[] {
    const scored = this.retrieve(query, contextTags);
    return scored
      .map(s => this.docs.get(s.name)?.toolDef)
      .filter((t): t is ToolDef => t !== undefined);
  }

  /** 已索引工具数 */
  get size(): number {
    return this.docs.size;
  }

  /** 清空索引 */
  clear(): void {
    this.docs.clear();
  }
}
