import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryStore } from '../memory/store.js';
import type { KnowledgeSignal } from '../brain/convergence/knowledge-sink.js';

/**
 * Buddy Learn — 从文件/URL/文本中学习，存入记忆
 */

export class BuddyLearn {
  private memory: MemoryStore;
  /** 信号汇聚层回调（v3.1） */
  private onConverge: ((signal: KnowledgeSignal) => void) | null = null;

  constructor(memory: MemoryStore) {
    this.memory = memory;
  }

  /** 注入信号汇聚层回调（v3.1） */
  setConvergenceCallback(callback: (signal: KnowledgeSignal) => void): void {
    this.onConverge = callback;
  }

  /**
   * 从文件学习
   */
  async learnFromFile(filePath: string): Promise<LearnResult> {
    try {
      const resolved = path.resolve(filePath);
      const content = await fs.readFile(resolved, 'utf-8');
      const ext = path.extname(resolved).slice(1);
      const fileName = path.basename(resolved);

      // 按类型分块
      const chunks = this.chunkContent(content, ext);
      let saved = 0;

      for (const chunk of chunks) {
        const summary = this.extractSummary(chunk.content, ext);
        this.memory.setMemory(
          'learned_knowledge',
          `${fileName}#${chunk.index}`,
          summary,
          6,
        );
        saved++;
      }

      // 记录学习事件
      this.memory.addDiaryEntry(`从文件学习了: ${fileName} (${chunks.length} 块)`, 'learning');
      this.memory.setMemory('learned_files', fileName, `学习于 ${new Date().toLocaleString('zh-CN')}，${chunks.length} 块`, 4);

      // v3.1: 接入信号汇聚层
      this.onConverge?.({
        content: content.slice(0, 2000),
        sourceType: 'file',
        source: resolved,
      });

      return {
        success: true,
        source: resolved,
        chunks: saved,
        message: `从 ${fileName} 学习了 ${saved} 个知识块`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, source: filePath, chunks: 0, message: `学习失败: ${msg}` };
    }
  }

  /**
   * 从 URL 学习
   */
  async learnFromUrl(url: string): Promise<LearnResult> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Buddy/1.0)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { success: false, source: url, chunks: 0, message: `抓取失败: HTTP ${res.status}` };
      }

      const contentType = res.headers.get('content-type') ?? '';
      let content: string;

      if (contentType.includes('application/json')) {
        const json = await res.json();
        content = JSON.stringify(json, null, 2);
      } else {
        const html = await res.text();
        content = this.extractReadable(html);
      }

      if (!content.trim()) {
        return { success: false, source: url, chunks: 0, message: '页面无可提取内容' };
      }

      const chunks = this.chunkContent(content, 'md');
      let saved = 0;

      for (const chunk of chunks) {
        const summary = this.extractSummary(chunk.content, 'md');
        this.memory.setMemory('learned_knowledge', `url:${url}#${chunk.index}`, summary, 6);
        saved++;
      }

      this.memory.addDiaryEntry(`从网页学习了: ${url} (${chunks.length} 块)`, 'learning');

      // v3.1: 接入信号汇聚层
      this.onConverge?.({
        content: content.slice(0, 2000),
        sourceType: 'url',
        source: url,
      });

      return {
        success: true,
        source: url,
        chunks: saved,
        message: `从网页学习了 ${saved} 个知识块`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, source: url, chunks: 0, message: `学习失败: ${msg}` };
    }
  }

  /**
   * 从文本直接学习
   */
  learnFromText(text: string, source: string = 'user_input'): LearnResult {
    const summary = this.extractSummary(text, 'txt');
    this.memory.setMemory('learned_knowledge', `${source}#${Date.now()}`, summary, 8);
    this.memory.addDiaryEntry(`用户教了我: ${text.slice(0, 80)}...`, 'learning');

    // v3.1: 接入信号汇聚层
    this.onConverge?.({
      content: text,
      sourceType: 'text',
      source,
    });

    return {
      success: true,
      source,
      chunks: 1,
      message: '已记住',
    };
  }

  /**
   * 查看已学习的知识
   */
  getLearnedKnowledge(): Array<{ key: string; value: string; importance: number }> {
    return this.memory.getMemoriesByCategory('learned_knowledge');
  }

  /**
   * 查看已学习的文件列表
   */
  getLearnedFiles(): Array<{ key: string; value: string }> {
    return this.memory.getMemoriesByCategory('learned_files').map(m => ({ key: m.key, value: m.value }));
  }

  // ==================== 内部方法 ====================

  private chunkContent(content: string, fileType: string): Array<{ index: number; content: string }> {
    const maxChunkSize = 2000; // 每块最大字符数
    const chunks: Array<{ index: number; content: string }> = [];

    if (fileType === 'md' || fileType === 'txt') {
      // 按标题分块
      const sections = content.split(/\n(?=#)/);
      let currentIndex = 0;
      for (const section of sections) {
        if (section.trim()) {
          chunks.push({ index: currentIndex++, content: section.trim().slice(0, maxChunkSize) });
        }
      }
    } else if (fileType === 'ts' || fileType === 'js' || fileType === 'py') {
      // 按函数/类分块（简单按空行分割）
      const blocks = content.split(/\n\n+/);
      let currentIndex = 0;
      let buffer = '';
      for (const block of blocks) {
        if (buffer.length + block.length > maxChunkSize && buffer) {
          chunks.push({ index: currentIndex++, content: buffer.trim() });
          buffer = block;
        } else {
          buffer += (buffer ? '\n\n' : '') + block;
        }
      }
      if (buffer.trim()) chunks.push({ index: currentIndex++, content: buffer.trim() });
    } else {
      // 等分
      const totalChunks = Math.ceil(content.length / maxChunkSize);
      for (let i = 0; i < totalChunks; i++) {
        chunks.push({ index: i, content: content.slice(i * maxChunkSize, (i + 1) * maxChunkSize) });
      }
    }

    return chunks.length > 0 ? chunks : [{ index: 0, content: content.slice(0, maxChunkSize) }];
  }

  private extractSummary(content: string, fileType: string): string {
    // 如果内容较短，直接返回
    if (content.length <= 500) return content;

    // 提取前 500 字符作为摘要 + 保留完整内容的标签
    const preview = content.slice(0, 500);
    const lineCount = content.split('\n').length;
    return `${preview}\n... (${lineCount} 行，共 ${content.length} 字符)`;
  }

  private extractReadable(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export interface LearnResult {
  success: boolean;
  source: string;
  chunks: number;
  message: string;
}
