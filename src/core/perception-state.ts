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

  // === 语义向量（可选） ===
  embedding?: Float32Array;     // TextEncoder 输出的池化向量（供下游复用）

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
 * 基于意图 + 内容评估复杂度
 */
export function assessComplexity(
  content: string,
  intent: { category: string; confidence: number },
): 'simple' | 'medium' | 'complex' {
  if (intent.category === 'complex_task' || content.length > 200) {
    return 'complex';
  }
  if (intent.category !== 'conversation' || content.length > 80) {
    return 'medium';
  }
  return 'simple';
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
  };
  return CATEGORY_TO_TASK[category] ?? 'chat';
}
