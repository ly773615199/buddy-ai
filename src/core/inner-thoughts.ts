/**
 * I4: 内心独白线程 — 轻量级后台分析引擎
 *
 * 基于 Inner Thoughts (arXiv:2501.00383)：
 * 纯规则触发（不调 LLM），检测用户困惑/知识缺口/可补充信息。
 */

export interface Thought {
  content: string;
  urgency: number;       // 0-1
  category: 'confusion' | 'knowledge_gap' | 'correction' | 'suggestion' | 'pattern';
  timestamp: number;
}

export class InnerThoughtsEngine {
  private thoughtQueue: Thought[] = [];
  private pendingThoughts: Thought[] = [];
  private recentTopics: string[] = [];

  /**
   * 用户消息后触发异步分析
   */
  onUserMessage(content: string, recentMessages: Array<{ role: string; content: string }>): Thought[] {
    const thoughts: Thought[] = [];

    // 1. 用户不确定词 → 准备补充
    if (/可能|也许|不太确定|不太清楚|是不是|对吗|好像/i.test(content)) {
      thoughts.push({
        content: '用户表达了不确定，如果有相关信息应该主动补充',
        urgency: 0.6,
        category: 'confusion',
        timestamp: Date.now(),
      });
    }

    // 2. 技术术语未解释 → 准备解释
    const techTerms = content.match(/\b(API|SDK|Docker|K8s|CI\/CD|Webhook|JWT|OAuth|REST|GraphQL|gRPC)\b/gi) ?? [];
    if (techTerms.length > 0) {
      thoughts.push({
        content: `对话中出现了技术术语: ${[...new Set(techTerms)].join(', ')}，如果上下文暗示用户不熟悉可以简要解释`,
        urgency: 0.3,
        category: 'knowledge_gap',
        timestamp: Date.now(),
      });
    }

    // 3. 连续问同类问题 → 准备总结
    this.recentTopics.push(this.extractTopic(content));
    if (this.recentTopics.length > 5) this.recentTopics.shift();

    const topicCounts = new Map<string, number>();
    for (const t of this.recentTopics) {
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
    for (const [topic, count] of topicCounts) {
      if (count >= 3 && topic !== 'general') {
        thoughts.push({
          content: `用户连续 ${count} 次询问「${topic}」相关问题，可以主动总结要点`,
          urgency: 0.7,
          category: 'pattern',
          timestamp: Date.now(),
        });
      }
    }

    // 4. 检测可能的错误信息
    const incorrectPatterns = [
      { pattern: /地球是平的|地球是方的/i, msg: '用户可能在开玩笑或测试' },
      { pattern: /HTML.*编程语言|CSS.*编程语言/i, msg: 'HTML/CSS 是标记/样式语言，非编程语言' },
    ];
    for (const { pattern, msg } of incorrectPatterns) {
      if (pattern.test(content)) {
        thoughts.push({
          content: `检测到可能的错误认知: ${msg}`,
          urgency: 0.5,
          category: 'correction',
          timestamp: Date.now(),
        });
      }
    }

    // 5. 用户提到文件/代码但没说做什么
    if (/[\w/\\.-]+\.\w+/.test(content) && content.length < 15 && recentMessages.length < 3) {
      thoughts.push({
        content: '用户提到了文件但没有具体说明操作，可能需要进一步引导',
        urgency: 0.4,
        category: 'suggestion',
        timestamp: Date.now(),
      });
    }

    // 分派到队列
    for (const thought of thoughts) {
      if (thought.urgency > 0.6) {
        this.thoughtQueue.push(thought);
      } else if (thought.urgency > 0.3) {
        this.pendingThoughts.push(thought);
      }
    }

    return thoughts;
  }

  /**
   * 获取待插入的思考（高紧急度）
   */
  getInterjection(): string | null {
    const t = this.thoughtQueue.shift();
    if (!t) return null;
    return `\n\n💭 ${t.content}`;
  }

  /**
   * 获取一个待定思考（中紧急度，合适时机插入）
   */
  getPendingThought(): Thought | null {
    return this.pendingThoughts.shift() ?? null;
  }

  /**
   * 队列状态
   */
  getStats(): { queued: number; pending: number } {
    return { queued: this.thoughtQueue.length, pending: this.pendingThoughts.length };
  }

  // ── 私有 ──

  private extractTopic(content: string): string {
    // 提取核心名词作为话题（取第一个有意义的词）
    const words = content
      .replace(/[？?！!。，,.\s]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
    return words[0] || 'general';
  }
}
