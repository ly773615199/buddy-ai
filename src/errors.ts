/**
 * 错误分类器
 * 将不同类型的错误分类，返回标准化的错误信息和建议操作
 * 
 * 规则：按优先级从高到低匹配，使用精确模式避免误判
 */

export type ErrorCategory =
  | 'network'      // 网络错误（超时、连接失败）
  | 'auth'         // 认证错误（API Key 无效、过期）
  | 'permission'   // 权限不足
  | 'syntax'       // 语法/参数错误
  | 'timeout'      // 超时
  | 'not_found'    // 文件/资源不存在
  | 'tool_error'   // 工具执行错误
  | 'llm_error'    // LLM 调用错误
  | 'unknown';     // 未知错误

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  original: string;
  recoverable: boolean;
  suggestion: string;
}

/**
 * 分类错误
 * 优先级：network > timeout > auth > permission > not_found > syntax > llm_error > unknown
 */
export function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // 网络错误（精确模式）
  if (/econnrefused|econnreset|enotfound|etimedout|fetch failed|socket hang up|EPIPE/.test(lower) ||
      /\bnetwork\b.*\b(error|fail\w*|unreachable)\b/.test(lower)) {
    return {
      category: 'network',
      message: '网络连接失败',
      original: msg,
      recoverable: true,
      suggestion: '检查网络连接，或稍后重试',
    };
  }

  // 超时（精确：只匹配超时相关，不匹配 "signal" 本身）
  if (/\btimeout\b|\btimed?\s*out\b|\bETIMEDOUT\b/.test(lower)) {
    return {
      category: 'timeout',
      message: '操作超时',
      original: msg,
      recoverable: true,
      suggestion: '操作耗时过长，可以尝试简化请求或增加超时时间',
    };
  }

  // 认证错误（精确）
  if (/\b401\b|\b403\b|\bunauthorized\b|\bforbidden\b|\binvalid_token\b/.test(lower) ||
      /\bapi\s*key\b.*\b(invalid|expired|missing)\b/.test(lower) ||
      /\bauthentication\s*(failed|error)\b/.test(lower)) {
    return {
      category: 'auth',
      message: '认证失败',
      original: msg,
      recoverable: false,
      suggestion: '检查 API Key 是否正确或已过期',
    };
  }

  // 权限错误
  if (/\beaccess\b|\beperm\b|\baccess\s*denied\b|\bpermission\s*denied\b/.test(lower)) {
    return {
      category: 'permission',
      message: '权限不足',
      original: msg,
      recoverable: false,
      suggestion: '检查文件/目录权限，或使用更高权限运行',
    };
  }

  // 文件/资源不存在
  if (/\benoent\b|\bno such file\b|\bfile not found\b/.test(lower) ||
      /\b404\b/.test(lower)) {
    return {
      category: 'not_found',
      message: '文件或资源不存在',
      original: msg,
      recoverable: false,
      suggestion: '检查路径是否正确',
    };
  }

  // 语法/参数错误（精确：不匹配 "json" 这种通用词）
  if (/\bsyntax\s*error\b|\bunexpected\s*token\b/.test(lower) ||
      /\bparse\s*(error|failed)\b/.test(lower) ||
      /\binvalid\s*(argument|parameter|input|format|request)\b/.test(lower)) {
    return {
      category: 'syntax',
      message: '语法或参数错误',
      original: msg,
      recoverable: false,
      suggestion: '检查输入格式是否正确',
    };
  }

  // LLM 错误（精确）
  if (/\brate\s*limit\b|\b429\b/.test(lower) ||
      /\bmodel\s*(not\s*found|unavailable|does\s*not\s*exist)\b/.test(lower) ||
      /\bllm\b.*\b(error|fail)\b/.test(lower) ||
      /\bgpt\b|\bopenai\b|\bdeepseek\b/.test(lower) && /\b(error|fail)\b/.test(lower) ||
      /\b5[0-9]{2}\b/.test(lower)) {
    return {
      category: 'llm_error',
      message: 'LLM 服务错误',
      original: msg,
      recoverable: true,
      suggestion: 'LLM 服务暂时不可用，稍后重试',
    };
  }

  return {
    category: 'unknown',
    message: '未知错误',
    original: msg,
    recoverable: false,
    suggestion: '请检查输入或联系开发者',
  };
}

/**
 * 根据错误分类生成用户友好的回复
 */
export function getUserFriendlyMessage(classified: ClassifiedError, toolName?: string): string {
  const prefix = toolName ? `[${toolName}] ` : '';

  switch (classified.category) {
    case 'network':
      return `${prefix}网络出了问题 😵 ${classified.suggestion}`;
    case 'auth':
      return `${prefix}认证失败 🔑 ${classified.suggestion}`;
    case 'permission':
      return `${prefix}权限不够 🚫 ${classified.suggestion}`;
    case 'not_found':
      return `${prefix}找不到这个文件/资源 📂 ${classified.suggestion}`;
    case 'timeout':
      return `${prefix}超时了 ⏱️ ${classified.suggestion}`;
    case 'syntax':
      return `${prefix}参数有误 📝 ${classified.suggestion}`;
    case 'llm_error':
      return `${prefix}AI 后端出了点问题 🧠 ${classified.suggestion}`;
    default:
      return `${prefix}出了点问题: ${classified.message}`;
  }
}
