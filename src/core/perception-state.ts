/**
 * PerceptionState — 统一感知结果容器
 *
 * 一次计算，全链路共享
 * 替代 detectDomains() + assessTaskComplexity() 各自独立调用 classifyFromText()
 * 信号采集阶段只算一次，后续决策/执行/反馈全部复用
 */

import type { TaskSignal } from '../brain/types.js';

export interface PerceptionState {
  // === 意图 ===
  intent: {
    category: string;           // 统一分类（来自 classifyFromText）
    confidence: number;         // 0-1
    hit: boolean;               // 是否命中规则
    suggestedTools: string[];   // 推荐工具
    /** 原型匹配结果（四信号融合） */
    protoMatch?: { prototypeId: string; distance: number; confidence: number };
  };
  domains: string[];            // 任务域标签
  complexity: 'simple' | 'medium' | 'complex';
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
  shouldUseDAG: boolean;
  dagReason: string;
  intentConfidence: number;     // 兼容 TaskSignal 的 intentConfidence
  criticality: 'low' | 'normal' | 'high';  // 任务关键性

  // === 语义向量（可选） ===
  embedding?: Float32Array;     // TextEncoder 输出的池化向量（供下游复用）

  // === 对话上下文（来自状态机） ===
  conversationContext?: import('./conversation-state-machine.js').ConversationContext;

  // === 元信息 ===
  timestamp: number;
  computeMs: number;            // 计算耗时
}

/**
 * 从意图分类推断领域标签
 */
export function inferDomains(intent: { category: string; suggestedTools: string[] }): string[] {
  const CATEGORY_TO_DOMAINS: Record<string, string[]> = {
    file_operations: ['file'],
    code_operations: ['code'],
    git_operations: ['git'],
    web_operations: ['web'],
    system_operations: ['system'],
    knowledge_query: ['knowledge'],
    conversation: ['conversation'],
    complex_task: ['complex'],
    data_analysis: ['data', 'code'],
    devops: ['system', 'devops'],
    writing: ['writing', 'knowledge'],
    debugging: ['code', 'debug'],
    planning: ['planning', 'knowledge'],
  };

  const domains = CATEGORY_TO_DOMAINS[intent.category] ?? ['conversation'];

  // 从推荐工具补充领域
  const TOOL_TO_DOMAIN: Record<string, string> = {
    read_file: 'file', write_file: 'file', list_files: 'file', search_files: 'file',
    exec: 'system', git_status: 'git', git_log: 'git', git_diff: 'git',
    web_fetch: 'web', search_web: 'web',
  };

  for (const tool of (intent.suggestedTools ?? [])) {
    const domain = TOOL_TO_DOMAIN[tool];
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }
  }

  return domains;
}

/**
 * 基于意图 + 语义密度评估复杂度（不再纯靠长度）
 *
 * 语义密度 = 技术关键词命中数 / 内容长度
 * 高密度短文本（如“用Rust写分布式Raft”）→ complex
 * 低密度长文本（如闲聊扩展）→ simple
 */
export function assessComplexity(
  content: string,
  intent: { category: string; confidence: number },
): 'simple' | 'medium' | 'complex' {
  // 意图分类直接判定
  if (intent.category === 'complex_task') return 'complex';

  // 语义密度：技术关键词命中数
  const techKeywords = [
    '架构', '系统', '设计', '重构', '优化', '实现', '分布式', '微服务', '并发', '算法',
    '数据库', '缓存', '消息队列', '负载均衡', '容器', '部署', 'pipeline', 'CI/CD',
    'architecture', 'system', 'design', 'refactor', 'implement', 'distributed',
    'microservice', 'concurrency', 'algorithm', 'database', 'cache', 'deploy',
    '写一个', '实现一个', 'build a', 'create a', 'develop',
  ];
  const lower = content.toLowerCase();
  const hits = techKeywords.filter(k => lower.includes(k)).length;
  const density = content.length > 0 ? hits / (content.length / 50) : 0; // 每 50 字符命中数

  // 高密度短文本 → complex
  if (density >= 0.3 || hits >= 3) return 'complex';
  // 低密度 + 意图是对话 → simple
  if (intent.category === 'conversation' && density < 0.1) return 'simple';
  // 其余 → medium
  return 'medium';
}

/**
 * 判断是否应使用 DAG 编排
 */
export function assessDAG(content: string): { shouldUseDAG: boolean; dagReason: string } {
  const dagKeywords = ['然后', '接着', '最后', '先', '步骤', '第一步', '首先',
    'then', 'after that', 'finally', 'first', 'step'];

  const lower = content.toLowerCase();
  const hits = dagKeywords.filter(k => lower.includes(k));

  if (hits.length >= 2) {
    return { shouldUseDAG: true, dagReason: `多步关键词: ${hits.join(', ')}` };
  }

  return { shouldUseDAG: false, dagReason: '' };
}

/**
 * 评估任务关键性
 *
 * 高关键性：复杂任务 + 长内容 + 开发/设计关键词
 * 低关键性：短消息、闲聊
 * 其余：普通
 */
export function assessCriticality(
  content: string,
  intent: { category: string; confidence: number },
): 'low' | 'normal' | 'high' {
  // 高关键性：复杂任务 + 开发设计关键词
  if (intent.category === 'complex_task' && content.length > 100) return 'high';
  if (content.length > 100 && /架构|系统设计|重构|优化方案|分布式|微服务|architecture|system design|refactor|distributed|microservice/i.test(content)) return 'high';
  if (intent.category === 'code_operations' && content.length > 80 && /重构|优化|设计|架构|refactor|optimize|design|architect/i.test(content)) return 'high';

  // 低关键性：短消息、闲聊
  if (content.length < 30 && intent.category === 'conversation') return 'low';
  if (content.length < 15) return 'low';

  return 'normal';
}

/**
 * 意图分类 → 任务类型映射
 */
export function mapTaskType(category: string): PerceptionState['taskType'] {
  const CATEGORY_TO_TASK: Record<string, PerceptionState['taskType']> = {
    file_operations: 'tools',
    code_operations: 'tools',
    git_operations: 'tools',
    web_operations: 'tools',
    system_operations: 'tools',
    knowledge_query: 'reasoning',
    conversation: 'chat',
    complex_task: 'domain',
    data_analysis: 'tools',
    devops: 'tools',
    writing: 'domain',
    debugging: 'tools',
    planning: 'reasoning',
  };
  return CATEGORY_TO_TASK[category] ?? 'chat';
}
