/**
 * I3: 推理链持久化 — 跨轮对话的结构化推理记忆
 *
 * 基于 Hindsight (arXiv:2512.12818)：
 * 在 STMP 之上加轻量级推理链存储，支持跨轮推理。
 */

import type { ReasoningSignal } from '../brain/convergence/reasoning-sink.js';

export interface ReasoningChain {
  id: string;
  topic: string;               // 推理主题
  conclusions: string[];        // 已得出的结论
  openQuestions: string[];      // 未解决的问题
  confidence: number;           // 整体置信度 0-1
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;            // 默认 2 小时过期
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const MAX_CHAINS = 50;
const MAX_INJECT = 3;           // prompt 最多注入 3 条
const MAX_INJECT_CHARS = 200;   // 每条最多 200 字符

export class ReasoningChainStore {
  private chains = new Map<string, ReasoningChain>();
  /** 信号汇聚层回调（v3.1） */
  private onConverge: ((signal: ReasoningSignal) => void) | null = null;

  /** 注入信号汇聚层回调（v3.1） */
  setConvergenceCallback(callback: (signal: ReasoningSignal) => void): void {
    this.onConverge = callback;
  }

  /**
   * 记录一条结论
   */
  conclude(topic: string, conclusion: string, confidence = 0.6): void {
    const id = this.normalizeTopic(topic);
    const existing = this.chains.get(id);

    if (existing) {
      existing.conclusions.push(conclusion);
      existing.confidence = Math.min(0.99, existing.confidence + 0.1);
      existing.lastAccessedAt = Date.now();
      existing.expiresAt = Date.now() + DEFAULT_TTL_MS;
    } else {
      this.evictIfNeeded();
      this.chains.set(id, {
        id,
        topic,
        conclusions: [conclusion],
        openQuestions: [],
        confidence,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_TTL_MS,
      });
    }

    // v3.1: 接入信号汇聚层
    const chain = this.chains.get(id);
    if (chain) {
      this.onConverge?.({
        topic,
        conclusions: chain.conclusions,
        confidence: chain.confidence,
      });
    }
  }

  /**
   * 记录一个未解决的问题
   */
  addOpenQuestion(topic: string, question: string): void {
    const id = this.normalizeTopic(topic);
    const existing = this.chains.get(id);

    if (existing) {
      if (!existing.openQuestions.includes(question)) {
        existing.openQuestions.push(question);
      }
      existing.lastAccessedAt = Date.now();
    } else {
      this.evictIfNeeded();
      this.chains.set(id, {
        id,
        topic,
        conclusions: [],
        openQuestions: [question],
        confidence: 0.3,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_TTL_MS,
      });
    }
  }

  /**
   * 检索相关推理链（关键词匹配）
   */
  retrieve(query: string): ReasoningChain[] {
    const queryLower = query.toLowerCase();
    const queryTokens = queryLower.split(/[^\w\u4e00-\u9fff]+/).filter(t => t.length >= 2);

    const results: Array<{ chain: ReasoningChain; score: number }> = [];

    for (const chain of this.chains.values()) {
      // 过期清理
      if (Date.now() > chain.expiresAt) {
        this.chains.delete(chain.id);
        continue;
      }

      const topicLower = chain.topic.toLowerCase();
      let score = 0;

      // 主题包含查询词
      if (topicLower.includes(queryLower)) score += 3;

      // token 匹配
      for (const token of queryTokens) {
        if (topicLower.includes(token)) score += 1;
        if (chain.conclusions.some(c => c.toLowerCase().includes(token))) score += 0.5;
        if (chain.openQuestions.some(q => q.toLowerCase().includes(token))) score += 0.5;
      }

      // 时间衰减
      const hoursSinceAccess = (Date.now() - chain.lastAccessedAt) / 3600000;
      score *= Math.exp(-hoursSinceAccess / 4); // 4h 半衰期

      if (score > 0.5) {
        chain.lastAccessedAt = Date.now();
        results.push({ chain, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INJECT)
      .map(r => r.chain);
  }

  /**
   * 构建 prompt 注入段
   */
  buildPromptInjection(chains: ReasoningChain[]): string {
    if (chains.length === 0) return '';

    const parts = chains.map(c => {
      const conclusions = c.conclusions.slice(-3).join('; ');
      const questions = c.openQuestions.slice(-2).join('; ');
      let text = `### 之前的推理: ${c.topic}\n结论: ${conclusions}`;
      if (questions) text += `\n待解决: ${questions}`;
      return text.slice(0, MAX_INJECT_CHARS);
    });

    return '\n## 跨轮推理上下文\n' + parts.join('\n\n');
  }

  /**
   * 清理过期链
   */
  purge(): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, chain] of this.chains) {
      if (now > chain.expiresAt) {
        this.chains.delete(id);
        purged++;
      }
    }
    return purged;
  }

  /** 当前链数量 */
  get size(): number { return this.chains.size; }

  // ── 私有 ──

  private normalizeTopic(topic: string): string {
    return topic.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 60);
  }

  private evictIfNeeded(): void {
    if (this.chains.size < MAX_CHAINS) return;
    // 淘汰最久未访问的
    let oldest: ReasoningChain | null = null;
    for (const chain of this.chains.values()) {
      if (!oldest || chain.lastAccessedAt < oldest.lastAccessedAt) {
        oldest = chain;
      }
    }
    if (oldest) this.chains.delete(oldest.id);
  }
}
