/**
 * 知识组装器 — 发送层
 *
 * 将编辑后的碰撞结果组装为可注入 prompt 的结构化文本
 * 不生成文本（那是 LLM 的事），只做格式化和组织
 *
 * 5 种输出策略：
 * - report: 结构化汇报（按维度组织）
 * - explain: 解释说明（背景→核心→示例）
 * - compare: 对比分析（并列对比）
 * - execute: 执行确认（操作→结果→建议）
 * - chat: 闲聊（不注入知识）
 */

import type { CollisionResult, EditResult } from './collision-engine.js';

export type OutputIntent = 'report' | 'explain' | 'compare' | 'execute' | 'chat';

interface AssemblyStrategy {
  maxItems: number;
  maxChars: number;
  format: (item: CollisionResult) => string;
  header: string;
}

export class KnowledgeAssembler {
  private strategies: Record<OutputIntent, AssemblyStrategy> = {
    report: {
      maxItems: 5,
      maxChars: 2000,
      header: '## 参考知识',
      format: (item) => {
        const sources = item.sources.join('+');
        const confidence = `${(item.confidence * 100).toFixed(0)}%`;
        return `- [${sources} ${confidence}] ${this.truncate(item.content, 200)}`;
      },
    },
    explain: {
      maxItems: 3,
      maxChars: 1500,
      header: '## 背景知识',
      format: (item) => {
        const sources = item.sources.join('+');
        return `> ${this.truncate(item.content, 300)}\n> — ${sources}`;
      },
    },
    compare: {
      maxItems: 4,
      maxChars: 2000,
      header: '## 多源信息对比',
      format: (item) => {
        const sources = item.sources.join('+');
        const strategy = item.strategy === 'fuse' ? '共识' : item.strategy === 'emerge' ? '新发现' : '补充';
        return `- [${strategy}] (${sources}) ${this.truncate(item.content, 250)}`;
      },
    },
    execute: {
      maxItems: 3,
      maxChars: 1000,
      header: '## 参考经验',
      format: (item) => {
        const confidence = `${(item.confidence * 100).toFixed(0)}%`;
        return `- [${confidence}] ${this.truncate(item.content, 150)}`;
      },
    },
    chat: {
      maxItems: 0,
      maxChars: 0,
      header: '',
      format: () => '',
    },
  };

  /**
   * 组装知识为 prompt 注入文本
   *
   * @param editResult 编辑层输出
   * @param intent 输出意图
   * @param maxChars 最大字符数（覆盖策略默认值）
   * @returns 可注入 prompt 的结构化文本，闲聊返回空字符串
   */
  assemble(editResult: EditResult, intent: OutputIntent, maxChars?: number): string {
    const strategy = this.strategies[intent];
    if (!strategy || strategy.maxItems === 0) return '';

    const items = editResult.edited.slice(0, strategy.maxItems);
    if (items.length === 0) return '';

    const limit = maxChars ?? strategy.maxChars;
    const parts: string[] = [strategy.header];

    for (const item of items) {
      parts.push(strategy.format(item));
    }

    // 添加碰撞摘要
    if (editResult.edited.length > 0) {
      const strategies = editResult.edited.map(e => e.strategy);
      const fuseCount = strategies.filter(s => s === 'fuse').length;
      const emergeCount = strategies.filter(s => s === 'emerge').length;
      const scatterCount = strategies.filter(s => s === 'scatter').length;
      const summary = [
        fuseCount > 0 ? `${fuseCount}条合并` : '',
        emergeCount > 0 ? `${emergeCount}条新发现` : '',
        scatterCount > 0 ? `${scatterCount}条互补` : '',
      ].filter(Boolean).join('，');
      if (summary) parts.push(`\n> 知识融合: ${summary}`);
    }

    const result = parts.join('\n');
    return result.length > limit ? result.slice(0, limit) + '...' : result;
  }

  /**
   * 组装冲突信息（当检测到矛盾时追加）
   */
  assembleConflicts(conflicts: Array<{
    nodeA: { source: string; content: string };
    nodeB: { source: string; content: string };
    reason: string;
    severity: string;
  }>): string {
    if (conflicts.length === 0) return '';

    const parts = ['\n## ⚠️ 信息差异'];
    for (const c of conflicts.slice(0, 3)) {
      parts.push(`- [${c.severity}] ${c.reason}`);
      parts.push(`  - ${c.nodeA.source}: ${this.truncate(c.nodeA.content, 80)}`);
      parts.push(`  - ${c.nodeB.source}: ${this.truncate(c.nodeB.content, 80)}`);
    }

    return parts.join('\n');
  }

  /**
   * 根据输入自动判断意图
   */
  static detectIntent(input: string): OutputIntent {
    const lower = input.toLowerCase();

    // 对比类
    if (/对比|比较|vs|versus|区别|差异|不同/.test(lower)) return 'compare';

    // 执行类
    if (/怎么|如何|执行|运行|操作|步骤|教程/.test(lower)) return 'execute';

    // 解释类
    if (/什么是|解释|原理|为什么|概念|定义/.test(lower)) return 'explain';

    // 汇报类
    if (/报告|总结|汇总|状态|进展|情况/.test(lower)) return 'report';

    // 闲聊
    if (/你好|hi|hello|嗯|哦|哈哈|谢谢/.test(lower)) return 'chat';

    // 默认：汇报
    return 'report';
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  }
}
