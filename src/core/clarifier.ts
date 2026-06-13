/**
 * I5: 澄清决策器 — 评估不确定性，决定是否主动澄清
 *
 * 基于 MAC (arXiv:2512.13154)：
 * 评估不确定性和风险，决定是否主动澄清。
 * 限制每会话最多 2 次澄清（R2 风险缓解）。
 *
 * 扩展：
 * - 目标冲突检测（多目标互相矛盾）
 * - 资源不足检测（缺少权限/信息）
 * - 理解偏差检测（上下文不一致）
 */

export interface ClarificationDecision {
  shouldClarify: boolean;
  ambiguousAspects: string[];
  clarificationQuestion: string;
  riskIfWrong: 'low' | 'medium' | 'high';
  /** 检测到的问题类型 */
  issueType: 'ambiguity' | 'conflict' | 'resource' | 'deviation' | 'none';
}

const VAGUE_ACTIONS = ['改', '修', '优化', '处理', '弄', '搞', 'fix', 'improve', 'update', 'handle'];
const WRITE_PATTERNS = /写|创建|删除|部署|新建|覆盖|write|create|delete|deploy|overwrite|remove/i;

/** 目标冲突模式 */
const CONFLICT_PATTERNS = [
  { a: /简化|精简|减少|simplify/i, b: /增加|添加|扩展|add|expand/i, desc: '简化 vs 扩展' },
  { a: /加速|优化.*性能|speed up/i, b: /增加.*功能|add.*feature/i, desc: '性能 vs 功能' },
  { a: /删除|remove|delete/i, b: /保留|keep|preserve/i, desc: '删除 vs 保留' },
  { a: /安全|加密|secure/i, b: /便捷|简单|easy/i, desc: '安全 vs 便捷' },
];

export class ClarificationEngine {
  private clarificationsThisSession = 0;
  private readonly maxPerSession: number;

  constructor(maxPerSession = 3) {
    this.maxPerSession = maxPerSession;
  }

  /**
   * 评估是否需要澄清
   */
  assess(content: string, context?: { recentMessages?: string[] }): ClarificationDecision {
    const ambiguities: string[] = [];
    let issueType: ClarificationDecision['issueType'] = 'none';

    // 1. 多个可能的目标文件
    const paths = content.match(/[\w/\\.-]+\.\w+/g) ?? [];
    const uniquePaths = new Set(paths);
    if (uniquePaths.size >= 2) {
      ambiguities.push('多个文件路径，不确定操作哪个');
      issueType = 'ambiguity';
    }

    // 2. 模糊的操作词（有动词但无具体内容）
    const hasVagueAction = VAGUE_ACTIONS.some(v => content.includes(v));
    const hasSpecificTarget = /具体|哪个|哪一|把.*改成|将.*修改/.test(content);
    if (hasVagueAction && !hasSpecificTarget && content.length < 30) {
      ambiguities.push('操作描述不够具体');
      issueType = 'ambiguity';
    }

    // 3. 缺少关键参数
    if (/部署|deploy/i.test(content) && !/到|to|服务器|server|host/i.test(content)) {
      ambiguities.push('部署目标不明确');
      issueType = 'resource';
    }
    if (/发送|send|email|邮件/i.test(content) && !/给|to|收件人|recipient/i.test(content)) {
      ambiguities.push('收件人不明确');
      issueType = 'resource';
    }

    // 4. 多步骤但无顺序
    const stepIndicators = content.match(/然后|接着|再|最后|and then|then|finally/gi) ?? [];
    const actionCount = VAGUE_ACTIONS.filter(v => content.includes(v)).length;
    if (actionCount >= 3 && stepIndicators.length === 0) {
      ambiguities.push('多个操作但缺少执行顺序');
      issueType = 'ambiguity';
    }

    // 5. 目标冲突检测
    const conflict = this.detectConflict(content);
    if (conflict) {
      ambiguities.push(`目标冲突: ${conflict}`);
      issueType = 'conflict';
    }

    // 6. 资源不足检测
    const resourceIssue = this.detectResourceIssue(content);
    if (resourceIssue) {
      ambiguities.push(resourceIssue);
      issueType = 'resource';
    }

    // 7. 理解偏差检测（基于上下文）
    if (context?.recentMessages?.length) {
      const deviation = this.detectDeviation(content, context.recentMessages);
      if (deviation) {
        ambiguities.push(deviation);
        issueType = 'deviation';
      }
    }

    // 8. 评估风险
    const hasWrite = WRITE_PATTERNS.test(content);
    const hasDeploy = /部署|deploy|publish|发布/i.test(content);
    const risk: 'low' | 'medium' | 'high' = hasDeploy ? 'high' : hasWrite ? 'medium' : 'low';

    // 9. 决策：风险调整阈值
    const shouldClarify =
      this.clarificationsThisSession < this.maxPerSession && (
        ambiguities.length >= 2 ||
        (ambiguities.length >= 1 && risk === 'high') ||
        (ambiguities.length >= 1 && risk === 'medium' && content.length < 50) ||
        (ambiguities.length >= 1 && risk === 'low' && content.length < 15) ||
        issueType === 'conflict' // 冲突一律澄清
      );

    if (shouldClarify) {
      this.clarificationsThisSession++;
    }

    return {
      shouldClarify,
      ambiguousAspects: ambiguities,
      clarificationQuestion: shouldClarify ? this.buildQuestion(ambiguities, issueType) : '',
      riskIfWrong: risk,
      issueType,
    };
  }

  /**
   * 重置会话计数（新会话时调用）
   */
  resetSession(): void {
    this.clarificationsThisSession = 0;
  }

  // ── 私有 ──

  /** 检测目标冲突 */
  private detectConflict(content: string): string | null {
    for (const { a, b, desc } of CONFLICT_PATTERNS) {
      if (a.test(content) && b.test(content)) {
        return desc;
      }
    }
    return null;
  }

  /** 检测资源不足 */
  private detectResourceIssue(content: string): string | null {
    // 文件操作但未指定路径
    if (/读取|读一下|查看|打开|read|open|check/i.test(content) && !/[\w/\\.-]+\.\w+/.test(content)) {
      // 如果内容很短且没有文件名
      if (content.length < 15 && !/文件|file|代码|code/.test(content)) {
        return '未指定要操作的文件';
      }
    }
    // API 调用但未指定端点
    if (/调用.*API|请求.*接口|fetch|curl/i.test(content) && !/https?:\/\/|url|地址|endpoint/i.test(content)) {
      return '未指定 API 地址';
    }
    return null;
  }

  /** 检测理解偏差 */
  private detectDeviation(content: string, recentMessages: string[]): string | null {
    if (recentMessages.length < 2) return null;

    // 检查当前消息是否与最近消息主题差异过大
    const lastMessage = recentMessages[recentMessages.length - 1];

    // 简单的关键词重叠检测
    const currentWords = new Set(content.match(/[\u4e00-\u9fff]{2,}|[a-z]{3,}/gi) ?? []);
    const lastWords = new Set(lastMessage.match(/[\u4e00-\u9fff]{2,}|[a-z]{3,}/gi) ?? []);

    if (currentWords.size === 0 || lastWords.size === 0) return null;

    const overlap = [...currentWords].filter(w => lastWords.has(w)).length;
    const overlapRate = overlap / Math.min(currentWords.size, lastWords.size);

    // 重叠率极低且不是新话题开头词
    if (overlapRate < 0.1 && !/对了|另外|还有|btw|also|by the way|顺便/i.test(content)) {
      // 但如果是很短的消息（如"好的"、"继续"），不算偏差
      if (content.length > 10) {
        return '话题跳转较大，可能理解有偏差';
      }
    }
    return null;
  }

  private buildQuestion(aspects: string[], issueType: ClarificationDecision['issueType']): string {
    if (aspects.length === 0) return '';

    const prefix = {
      ambiguity: '我注意到一些需要确认的地方：',
      conflict: '我检测到目标可能存在冲突：',
      resource: '缺少一些必要信息：',
      deviation: '我想确认一下你的意图：',
      none: '需要确认：',
    }[issueType] ?? '需要确认：';

    const parts = aspects.map(a => `- ${a}`).join('\n');
    return `${prefix}\n${parts}\n\n能补充一下细节吗？这样我能更准确地帮你。`;
  }
}
