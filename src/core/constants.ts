import type { Attributes } from '../types.js';

// ==================== 降级策略 ====================

export const FALLBACK_REPLIES: Record<string, string[]> = {
  sharp_mentor: [
    'LLM 挂了。你以为我是万能的？重启试试。',
    '网络出了问题。这种低级故障你该自己会处理吧。',
    'AI 后端没响应。先检查你的 API Key 和网络。',
  ],
  warm_companion: [
    '哎呀，AI 后端暂时连不上了。等一下再试试吧～',
    '网络好像有点问题，我暂时帮不了你。稍后再试好吗？',
    'LLM 服务不可用。请检查 API 配置哦。',
  ],
  chaotic_friend: [
    '完蛋！我的大脑掉线了！💥 是不是该充点电了？',
    '啊哦，后端炸了。这一定不是我的锅吧？？',
    '404 智力未找到。LLM 好像罢工了。',
  ],
};

export function getPersonalityKey(attrs: Attributes): string {
  if (attrs.snark > 60 && attrs.wisdom > 60) return 'sharp_mentor';
  if (attrs.chaos > 60) return 'chaotic_friend';
  return 'warm_companion';
}

export function getFallbackReply(attrs: Attributes): string {
  const key = getPersonalityKey(attrs);
  const replies = FALLBACK_REPLIES[key];
  return replies[Math.floor(Math.random() * replies.length)];
}

// ==================== 行为追踪 ====================

export const BEHAVIOR_COMPUTE_INTERVAL = 20;

export const TOOL_CATEGORIES: Record<string, string> = {
  chat: 'basic', read_file: 'basic', list_files: 'basic', write_file: 'basic', exec: 'basic', git_status: 'basic', get_time: 'basic', search_files: 'advanced', git_diff: 'advanced', git_log: 'advanced',
  search_web: 'advanced', fetch_url: 'advanced', analyze_file: 'advanced', find_references: 'advanced',
  buddy_learn: 'advanced', scan_project: 'advanced',
  stmp_retrieve: 'expert', dream_consolidate: 'expert', knowledge_extract: 'expert',
  experience_compile: 'expert', package_create: 'expert', package_share: 'expert',
  pet_headpat: 'hidden', midnight_chat: 'hidden', morning_bird: 'hidden',
};

export const NEGATION_PATTERNS = /^(别说了|够了|烦了|少说点|停|闭嘴|stop|enough|shut up)/i;

export interface BehaviorAccumulator {
  toolCategories: Record<string, number>;
  correctionCount: number;
  encourageCount: number;
  negationCount: number;
  repeatQuestionCount: number;
  uniqueTools: Set<string>;
  totalInteractions: number;
}

export function createAccumulator(): BehaviorAccumulator {
  return {
    toolCategories: {},
    correctionCount: 0,
    encourageCount: 0,
    negationCount: 0,
    repeatQuestionCount: 0,
    uniqueTools: new Set(),
    totalInteractions: 0,
  };
}

// ==================== 敏感操作检查 ====================
// CONFIRMATION_MAP + needsConfirmation 已迁移至 capability-gate.ts
// 使用 needsConfirmationCompat 替代

export function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'exec':
      return `执行命令: ${String(args.command ?? '').slice(0, 120)}`;
    case 'write_file':
      return `写入文件: ${String(args.path ?? '')}`;
    case 'search_files':
      return `搜索文件: "${String(args.pattern ?? '')}" in ${String(args.path ?? '')}`;
    default:
      return `${toolName}(${JSON.stringify(args).slice(0, 100)})`;
  }
}

// ==================== 工具结果截断 ====================

const TOOL_RESULT_MAX_LINES = 100;
const TOOL_RESULT_MAX_CHARS = 10000;

/** 工具结果截断阈值（统一配置） */
export const TOOL_RESULT_LIMITS = {
  maxRaw: TOOL_RESULT_MAX_CHARS,        // 工具原始结果上限
  maxCompressed: 200,                   // P7 压缩后保留长度
  maxPrompt: 5_000,                     // 注入 prompt 的上限
} as const;

export function formatToolResult(result: string): string {
  if (!result) return '';
  if (result.length <= TOOL_RESULT_MAX_CHARS) return result;
  const lines = result.split('\n');
  if (lines.length > TOOL_RESULT_MAX_LINES) {
    return lines.slice(0, TOOL_RESULT_MAX_LINES).join('\n')
      + `\n... (共 ${lines.length} 行，已截断至 ${TOOL_RESULT_MAX_LINES} 行)`;
  }
  return result.slice(0, TOOL_RESULT_MAX_CHARS) + `\n... (已截断，共 ${result.length} 字符)`;
}

// ==================== 共享停用词表 ====================

export const SHARED_STOP_WORDS = new Set([
  // 中文
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '请', '帮', '能', '吗', '呢', '吧', '啊', '哈', '嗯',
  // 英文
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'of', 'and', 'or',
  'it', 'this', 'that', 'please', 'help', 'can', 'could', 'would', 'you',
]);
