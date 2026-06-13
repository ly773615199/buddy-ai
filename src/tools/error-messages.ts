/**
 * Task 7.3: 错误消息用户友好化
 *
 * 将工具返回的原始技术错误翻译为用户可读的中文提示。
 * 在 ToolExecutionMiddleware 和 LLM 工具执行路径中调用。
 */

/** 错误翻译规则：正则匹配 → 用户友好消息 */
const ERROR_TRANSLATIONS: Array<{ pattern: RegExp; message: string }> = [
  // 文件系统
  { pattern: /paths?\[0\].*must be of type string/i, message: '文件路径无效，请检查路径是否正确' },
  { pattern: /ENOENT.*no such file/i, message: '文件或目录不存在，请检查路径' },
  { pattern: /EACCES.*permission denied/i, message: '没有权限访问该文件，请检查文件权限' },
  { pattern: /ENOSPC/i, message: '磁盘空间不足，请清理后重试' },
  { pattern: /EISDIR/i, message: '目标是一个目录，请指定文件路径' },
  { pattern: /ENOTDIR/i, message: '路径中包含不存在的目录' },
  { pattern: /EBUSY/i, message: '文件正被其他进程占用，请稍后重试' },
  { pattern: /EMFILE|ENFILE/i, message: '打开的文件数过多，请关闭一些文件后重试' },

  // 网络与 API
  { pattern: /timeout/i, message: '操作超时，请稍后重试' },
  { pattern: /ECONNREFUSED/i, message: '连接被拒绝，请检查服务是否运行' },
  { pattern: /ECONNRESET/i, message: '连接被重置，请检查网络状况' },
  { pattern: /ENOTFOUND/i, message: '域名解析失败，请检查网络连接' },
  { pattern: /401/, message: 'API 认证失败，请检查 API Key 是否正确' },
  { pattern: /403/, message: 'API 访问被拒绝，请检查权限配置' },
  { pattern: /429/, message: 'API 请求过于频繁，请稍后重试' },
  { pattern: /500/, message: '服务器内部错误，请稍后重试' },
  { pattern: /502/, message: '网关错误，服务可能正在重启' },
  { pattern: /503/, message: '服务暂时不可用，请稍后重试' },

  // 命令执行
  { pattern: /command not found/i, message: '命令不存在，请检查是否已安装' },
  { pattern: /No such file or directory.*executable/i, message: '可执行文件不存在' },

  // 工具与依赖
  { pattern: /MODULE_NOT_FOUND|Cannot find module/i, message: '缺少依赖模块，请运行 npm install 安装' },
  { pattern: /tool.*not found/i, message: '工具不存在，请检查工具名称' },
  { pattern: /参数错误|validation_failed/i, message: '参数校验失败，请检查输入' },

  // 权限
  { pattern: /已拦截|权限不足/i, message: '操作被安全策略拦截' },
  { pattern: /超时.*ms/i, message: '操作执行超时，请简化任务或稍后重试' },
];

/**
 * 将原始错误消息翻译为用户友好的中文提示
 * 无匹配时原样返回
 */
export function friendlyError(raw: string): string {
  for (const { pattern, message } of ERROR_TRANSLATIONS) {
    if (pattern.test(raw)) return message;
  }
  return raw;
}

/**
 * 包装工具执行结果：错误时自动翻译
 * 用于在不改变调用方逻辑的情况下注入友好错误
 */
export function wrapErrorResult(result: string): string {
  // 仅处理已知错误格式
  if (result.startsWith('[') && result.includes('错误') || result.includes('Error') || result.includes('error')) {
    const friendly = friendlyError(result);
    if (friendly !== result) {
      return `${result}\n💡 ${friendly}`;
    }
  }
  return result;
}
