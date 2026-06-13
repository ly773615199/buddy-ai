/**
 * 意图分类器 — 快速轻量的用户意图判断
 *
 * 用于动态工具裁剪：根据意图只暴露相关工具子集，
 * 减少 Prompt 长度 + 降低模型选择工具的困惑度。
 *
 * 两种策略：
 * 1. 关键词规则匹配（零延迟，兜底）
 * 2. LLM Output.choice（准确率高，需要调用）
 */

// ==================== 意图定义 ====================

export type IntentCategory =
  | 'file_operations'     // 文件读写、目录操作
  | 'code_operations'     // 代码分析、搜索、执行
  | 'git_operations'      // Git 相关
  | 'web_operations'      // 网页抓取、搜索
  | 'system_operations'   // 系统命令、状态查询
  | 'knowledge_query'     // 知识问答（不需要工具）
  | 'conversation'        // 闲聊（不需要工具）
  | 'complex_task';       // 复杂任务（需要多工具）

export interface IntentResult {
  category: IntentCategory;
  confidence: number;         // 0-1
  matchedKeywords: string[];
  suggestedTools: string[];   // 推荐的工具子集
}

// ==================== 关键词规则 ====================

interface IntentRule {
  category: IntentCategory;
  keywords: string[];
  tools: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    category: 'file_operations',
    keywords: ['读', '查看', '打开', '写', '创建', '保存', '删除', '移动', '复制',
               'read', 'cat', 'write', 'create', 'save', 'delete', 'move', 'copy',
               '文件', 'file', '目录', 'folder', 'ls', 'dir'],
    tools: ['read_file', 'write_file', 'list_files', 'exec'],
  },
  {
    category: 'code_operations',
    keywords: ['代码', 'code', '函数', 'function', '类', 'class', '模块', 'module',
               '分析', 'analyze', '重构', 'refactor', '搜索', 'search', 'grep',
               '测试', 'test', '构建', 'build', '编译', 'compile', 'lint'],
    tools: ['read_file', 'write_file', 'exec', 'search_files', 'code_intel'],
  },
  {
    category: 'git_operations',
    keywords: ['git', '提交', 'commit', '分支', 'branch', '合并', 'merge',
               '推送', 'push', '拉取', 'pull', 'diff', 'log', '状态', 'status',
               'checkout', 'stash', 'rebase'],
    tools: ['git_status', 'git_diff', 'git_commit', 'git_branch', 'exec'],
  },
  {
    category: 'web_operations',
    keywords: ['搜', '搜索', '搜索', 'search', 'google', '百度', 'bing',
               '网页', 'web', 'url', '链接', 'link', '抓取', 'fetch', '爬',
               '打开网页', '访问', 'visit', 'browse'],
    tools: ['search_web', 'fetch_url', 'browse'],
  },
  {
    category: 'system_operations',
    keywords: ['运行', 'run', '执行', 'exec', '命令', 'command', '进程', 'process',
               '端口', 'port', '服务', 'service', '安装', 'install', '配置', 'config',
               '环境', 'environment', '系统', 'system', '状态', 'status'],
    tools: ['exec', 'get_time'],
  },
  {
    category: 'knowledge_query',
    keywords: ['是什么', '什么是', '为什么', '怎么', '如何', '区别', '原理',
               'what is', 'why', 'how to', 'explain', '区别', 'difference',
               '推荐', 'recommend', '建议', 'suggest', '最好', 'best'],
    tools: ['search_web'],
  },
  {
    category: 'conversation',
    keywords: ['你好', 'hello', 'hi', '谢谢', 'thanks', '再见', 'bye',
               '在吗', '在不在', '聊聊', '聊天', '心情', '怎么样'],
    tools: [],
  },
];

// ==================== 主类 ====================

export class IntentClassifier {
  /**
   * 基于关键词规则的快速分类（零延迟）
   */
  classify(input: string): IntentResult {
    const inputLower = input.toLowerCase();
    const scores = new Map<IntentCategory, { score: number; matched: string[] }>();

    for (const rule of INTENT_RULES) {
      let score = 0;
      const matched: string[] = [];

      for (const kw of rule.keywords) {
        if (inputLower.includes(kw.toLowerCase())) {
          score++;
          matched.push(kw);
        }
      }

      if (score > 0) {
        scores.set(rule.category, { score, matched });
      }
    }

    // 没有任何匹配 → conversation
    if (scores.size === 0) {
      return {
        category: 'conversation',
        confidence: 0.5,
        matchedKeywords: [],
        suggestedTools: [],
      };
    }

    // 选择得分最高的意图
    let bestCategory: IntentCategory = 'conversation';
    let bestScore = 0;
    let bestMatched: string[] = [];

    for (const [cat, { score, matched }] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
        bestMatched = matched;
      }
    }

    // 检测是否为复杂任务（匹配到多个不同类别的意图）
    const matchedCategories = Array.from(scores.keys()).filter(c => c !== 'conversation' && c !== 'knowledge_query');
    if (matchedCategories.length >= 2) {
      // 合并多个类别的工具
      const combinedTools = new Set<string>();
      for (const cat of matchedCategories) {
        const rule = INTENT_RULES.find(r => r.category === cat);
        if (rule) rule.tools.forEach(t => combinedTools.add(t));
      }
      return {
        category: 'complex_task',
        confidence: 0.7,
        matchedKeywords: bestMatched,
        suggestedTools: Array.from(combinedTools),
      };
    }

    // 查找对应规则的推荐工具
    const rule = INTENT_RULES.find(r => r.category === bestCategory);
    const suggestedTools = rule?.tools ?? [];

    // 置信度 = min(1, 匹配词数 / 3)
    const confidence = Math.min(1, bestScore / 3);

    return {
      category: bestCategory,
      confidence,
      matchedKeywords: bestMatched,
      suggestedTools,
    };
  }

  /**
   * 根据意图裁剪工具列表
   *
   * @param allTools 完整工具列表
   * @param input 用户输入
   * @returns 裁剪后的工具子集
   */
  filterTools<T extends { name: string }>(allTools: T[], input: string): T[] {
    const intent = this.classify(input);

    // confidence < 0.3 → 不确定，返回全部工具
    if (intent.confidence < 0.3 || intent.category === 'complex_task') {
      return allTools;
    }

    // conversation → 返回空
    if (intent.category === 'conversation' && intent.suggestedTools.length === 0) {
      return [];
    }

    // 按推荐工具筛选，但至少保留 search_web 和 get_time（通用工具）
    const alwaysInclude = ['search_web', 'get_time'];
    const toolNames = new Set([...intent.suggestedTools, ...alwaysInclude]);
    const filtered = allTools.filter(t => toolNames.has(t.name));

    // 如果筛选后太少（<2），返回全部
    return filtered.length >= 2 ? filtered : allTools;
  }

  /**
   * 获取意图描述（用于调试/日志）
   */
  describe(intent: IntentResult): string {
    return `意图: ${intent.category} (置信度: ${(intent.confidence * 100).toFixed(0)}%) | 关键词: ${intent.matchedKeywords.join(', ') || '无'} | 工具: ${intent.suggestedTools.join(', ') || '无'}`;
  }
}
