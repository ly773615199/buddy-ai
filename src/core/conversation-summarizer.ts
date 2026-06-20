/**
 * ConversationSummarizer — 对话摘要引擎
 *
 * 核心思想：旧消息不截断，而是生成语义摘要保留关键信息。
 *
 * 增量摘要：只摘要新消息，与旧摘要合并，避免每次全量重算。
 * 触发条件：L1 占用 >70% 或每 N 轮对话。
 *
 * 存储：SQLite conversation_summaries 表。
 */

import type { Message } from '../types.js';

export interface SummaryEntry {
  id: number;
  sessionId: string;
  summary: string;
  messageCount: number;
  createdAt: number;
}

/**
 * 对话摘要器
 */
export class ConversationSummarizer {
  private llmCall: ((prompt: string) => Promise<string>) | null = null;
  private db: any | null = null; // better-sqlite3 Database

  constructor(options?: {
    llmCall?: (prompt: string) => Promise<string>;
    db?: any;
  }) {
    this.llmCall = options?.llmCall ?? null;
    this.db = options?.db ?? null;
  }

  /**
   * 初始化摘要存储表
   */
  initStorage(db: any): void {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        summary TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_summary_session ON conversation_summaries(session_id);
    `);
  }

  /**
   * 增量摘要：旧摘要 + 新消息 → 更新后的摘要
   *
   * @param existingSummary 之前的摘要（可为空）
   * @param newMessages 新的对话消息
   * @returns 更新后的摘要
   */
  async incrementalSummarize(
    existingSummary: string,
    newMessages: Message[],
  ): Promise<string> {
    if (newMessages.length === 0) return existingSummary;

    // 如果没有 LLM，使用截断式摘要
    if (!this.llmCall) {
      return this.fallbackSummarize(existingSummary, newMessages);
    }

    const messagesText = newMessages
      .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
      .join('\n');

    const prompt = existingSummary
      ? `之前的对话摘要：\n${existingSummary}\n\n新的对话内容：\n${messagesText}\n\n请生成更新后的对话摘要，保留：\n1. 关键决策和结论\n2. 未完成的任务\n3. 重要的上下文信息（文件名、代码位置、配置等）\n4. 用户的偏好和要求\n\n摘要应该简洁（200字以内），但不能丢失重要细节。`
      : `以下是一段对话内容，请生成简洁摘要（200字以内），保留关键决策、未完成任务和重要上下文：\n${messagesText}`;

    try {
      return await this.llmCall(prompt);
    } catch {
      return this.fallbackSummarize(existingSummary, newMessages);
    }
  }

  /**
   * 降级摘要：无 LLM 时用截断 + 关键信息提取
   */
  private fallbackSummarize(
    existingSummary: string,
    newMessages: Message[],
  ): string {
    const parts: string[] = [];

    if (existingSummary) {
      parts.push(existingSummary.slice(0, 200));
    }

    // 提取关键信息
    for (const msg of newMessages.slice(-10)) {
      const content = msg.content;

      // 提取文件路径
      const paths = content.match(/[\w/\\.-]+\.\w{1,5}/g);
      if (paths && paths.length > 0) {
        parts.push(`涉及文件: ${paths.slice(0, 3).join(', ')}`);
      }

      // 提取决策/结论句
      const conclusions = content.match(/[^。！？]*(?:因此|所以|总结|结论|建议|已|完成|修改|创建)[^。！？]*/g);
      if (conclusions) {
        parts.push(...conclusions.slice(0, 2));
      }

      // 提取任务相关
      const tasks = content.match(/[^。！？]*(?:待办|TODO|需要|下一步|计划)[^。！？]*/g);
      if (tasks) {
        parts.push(...tasks.slice(0, 2));
      }
    }

    const summary = parts.join('；').slice(0, 300);
    return summary || '（无摘要）';
  }

  /**
   * 保存摘要到数据库
   */
  saveSummary(sessionId: string, summary: string, messageCount: number): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO conversation_summaries (session_id, summary, message_count, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, summary, messageCount, Date.now());
  }

  /**
   * 获取最新摘要
   */
  getLatestSummary(sessionId = 'default'): SummaryEntry | null {
    if (!this.db) return null;

    const row = this.db.prepare(`
      SELECT id, session_id as sessionId, summary, message_count as messageCount, created_at as createdAt
      FROM conversation_summaries
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(sessionId) as SummaryEntry | undefined;

    return row ?? null;
  }

  /**
   * 判断是否需要生成摘要
   *
   * @param currentMessageCount 当前消息数
   * @param l1Usage L1 上下文占用率 (0-1)
   * @param lastSummaryAt 上次摘要时的消息数
   * @returns 是否需要摘要
   */
  shouldSummarize(
    currentMessageCount: number,
    l1Usage: number,
    lastSummaryAt: number,
  ): boolean {
    // L1 占用 >70% 触发
    if (l1Usage > 0.7) return true;

    // 每 20 条新消息触发
    if (currentMessageCount - lastSummaryAt >= 20) return true;

    return false;
  }
}
