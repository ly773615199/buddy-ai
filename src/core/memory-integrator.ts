/**
 * MemoryIntegrator — 记忆整合层
 *
 * 职责：
 * 1. L2 情节记忆 + L3 语义记忆统一检索
 * 2. 对话 → 知识自动提取写入 L3
 * 3. 上下文预算管理（替代 getRecentMessages(20)）
 */

import type { Message } from '../types.js';
import type { MemoryStore } from '../memory/store.js';

export interface UnifiedSearchResult {
  key: string;
  value: string;
  score: number;
  source: 'fts' | 'semantic' | 'embedding' | 'stmp';
}

/**
 * 记忆整合器
 */
export class MemoryIntegrator {
  private memory: MemoryStore;
  private stmp: any | null = null;
  private verbose: boolean;

  constructor(options: {
    memory: MemoryStore;
    stmp?: any;
    verbose?: boolean;
  }) {
    this.memory = options.memory;
    this.stmp = options.stmp ?? null;
    this.verbose = options.verbose ?? false;
  }

  /**
   * 统一检索：FTS5 + 语义 + Embedding + STMP
   *
   * 四路结果加权合并，按相关性排序。
   */
  async unifiedSearch(query: string, limit = 5): Promise<UnifiedSearchResult[]> {
    const results = new Map<string, UnifiedSearchResult>();

    // 路径 1: FTS5 全文搜索（精确匹配）
    try {
      const ftsResults = this.memory.searchMemories(query, limit * 2);
      for (const r of ftsResults) {
        results.set(r.key, {
          key: r.key,
          value: r.value,
          score: Math.abs(r.rank) * 0.4,
          source: 'fts',
        });
      }
    } catch { /* 静默失败 */ }

    // 路径 2: TF-IDF 语义检索（模糊匹配）
    try {
      const semanticResults = this.memory.searchMemoriesSemantic(query, limit * 2);
      for (const r of semanticResults) {
        const existing = results.get(r.key);
        if (existing) {
          existing.score += r.similarity * 0.3;
        } else {
          results.set(r.key, {
            key: r.key,
            value: r.value,
            score: r.similarity * 0.3,
            source: 'semantic',
          });
        }
      }
    } catch { /* 静默失败 */ }

    // 路径 3: Embedding 向量检索（语义相似）
    try {
      const embeddingResults = this.memory.searchMemoriesEmbedding(query, limit * 2);
      for (const r of embeddingResults) {
        const existing = results.get(r.key);
        if (existing) {
          existing.score += r.similarity * 0.2;
        } else {
          results.set(r.key, {
            key: r.key,
            value: r.value,
            score: r.similarity * 0.2,
            source: 'embedding',
          });
        }
      }
    } catch { /* 静默失败 */ }

    // 路径 4: STMP 结构化记忆
    if (this.stmp) {
      try {
        const stmpResult = await this.stmp.retrieve(query, { maxPrimary: 2, maxAssociative: 1 });
        for (const node of stmpResult.primary) {
          const key = `[STMP] ${node.content.slice(0, 50)}`;
          results.set(key, {
            key,
            value: node.content,
            score: 0.15,
            source: 'stmp',
          });
        }
      } catch { /* 静默失败 */ }
    }

    // 排序并返回 top-k
    const sorted = [...results.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (this.verbose && sorted.length > 0) {
      console.log(`  [MemoryIntegrator] 统一检索 "${query.slice(0, 30)}" → ${sorted.length} 条 (${sorted.map(r => r.source).join('+')})`);
    }

    return sorted;
  }

  /**
   * 动态获取消息数（替代 getRecentMessages(20)）
   *
   * 根据 token 预算自适应决定取多少条消息。
   */
  getDynamicMessageCount(
    maxTokens: number,
    systemPromptTokens: number,
    avgMessageTokens: number,
    reservedTokens: number = 2000,
  ): number {
    const available = maxTokens - systemPromptTokens - reservedTokens;
    return Math.max(5, Math.floor(available / Math.max(avgMessageTokens, 50)));
  }

  /**
   * 获取优化后的最近消息
   *
   * 替代 memory.getRecentMessages(20)：
   * 1. 动态计算消息数
   * 2. 早期消息压缩
   * 3. 保留上下文连贯性
   */
  getOptimizedRecentMessages(
    maxTokens: number,
    systemPromptTokens: number,
    sessionId = 'default',
  ): Array<{ role: string; content: string; timestamp: number }> {
    // 估算平均每条消息的 token 数
    const avgMsgTokens = 150; // 保守估计
    const count = this.getDynamicMessageCount(maxTokens, systemPromptTokens, avgMsgTokens);

    // 获取原始消息
    const messages = this.memory.getRecentMessages(count, sessionId);

    // 早期消息压缩
    return this.compressEarlyMessages(messages, maxTokens - systemPromptTokens);
  }

  /**
   * 压缩早期消息
   *
   * 最近 keepRecent 条保持原样，更早的消息截断。
   */
  private compressEarlyMessages(
    messages: Array<{ role: string; content: string; timestamp: number }>,
    tokenBudget: number,
  ): Array<{ role: string; content: string; timestamp: number }> {
    if (messages.length <= 5) return messages;

    // 计算当前总 token
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg.content);
    }

    // 如果在预算内，直接返回
    if (totalTokens <= tokenBudget) return messages;

    // 从最旧的消息开始压缩
    const keepRecent = 10;
    return messages.map((msg, i) => {
      const isRecent = i >= messages.length - keepRecent;
      if (isRecent) return msg;

      // 旧消息：截断到 200 字符
      if (msg.content.length > 200) {
        return { ...msg, content: msg.content.slice(0, 200) + '... [已压缩]' };
      }
      return msg;
    });
  }

  /**
   * Token 估算
   */
  private estimateTokens(text: string): number {
    const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const english = (text.match(/[a-zA-Z]+/g) ?? []).length;
    const code = text.length - chinese - english;
    return Math.ceil(chinese * 1.5 + english * 1.3 + code * 0.4);
  }

  // ==================== 对话→知识自动提取 ====================

  private llmCall: ((prompt: string) => Promise<string>) | null = null;
  private lastExtractionTime = 0;
  private extractionIntervalMs = 60_000;

  setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    this.llmCall = caller;
  }

  /**
   * 从对话中自动提取知识，写入 L3 语义记忆
   */
  async extractAndStore(messages: Array<{ role: string; content: string }>): Promise<number> {
    if (!this.llmCall) return 0;
    if (messages.length < 3) return 0;

    const now = Date.now();
    if (now - this.lastExtractionTime < this.extractionIntervalMs) return 0;
    this.lastExtractionTime = now;

    const conversationText = messages
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const prompt = `从以下对话中提取值得长期记住的信息：\n${conversationText}\n\n提取格式（JSON 数组）：\n[{"key": "主题", "value": "具体信息", "importance": 0.8, "category": "decision|fact|preference|task"}]\n\n只提取用户明确表达的偏好、决策、事实和待办。不要提取闲聊内容。如果没有值得提取的信息，返回空数组 []。`;

    try {
      const result = await this.llmCall(prompt);
      const items = JSON.parse(result);

      let extracted = 0;
      for (const item of items) {
        if (item.key && item.value && item.category) {
          this.memory.setMemory(
            item.category,
            item.key,
            item.value,
            item.importance ?? 0.5,
          );
          extracted++;
        }
      }

      if (extracted > 0 && this.verbose) {
        console.log(`  [MemoryIntegrator] 从对话中提取了 ${extracted} 条知识`);
      }

      return extracted;
    } catch (err) {
      if (this.verbose) {
        console.warn('  [MemoryIntegrator] 知识提取失败:', (err as Error).message);
      }
      return 0;
    }
  }

  shouldExtract(messageCount: number, lastExtractAt: number, userMentionedRemember: boolean): boolean {
    if (userMentionedRemember) return true;
    if (messageCount - lastExtractAt >= 10) return true;
    return false;
  }
}
