/**
 * PII 脱敏工具 — 共享模块
 *
 * 用于：
 * - 第三方 API 调用前脱敏
 * - 商城发布前脱敏
 * - 训练数据导出脱敏
 *
 * 脱敏规则：
 * - 文件路径 → [PATH]
 * - IP 地址 → [IP]
 * - 邮箱 → [EMAIL]
 * - Token/Key → [TOKEN]
 * - 用户名/ID → [USER]
 * - 手机号 → [PHONE]
 * - 身份证号 → [ID_CARD]
 */

/** 脱敏选项 */
export interface SanitizeOptions {
  /** 脱敏文件路径（默认 true） */
  paths?: boolean;
  /** 脱敏 IP 地址（默认 true） */
  ips?: boolean;
  /** 脱敏邮箱（默认 true） */
  emails?: boolean;
  /** 脱敏 Token/Key（默认 true） */
  tokens?: boolean;
  /** 脱敏用户名（默认 false，需要提供用户名列表） */
  usernames?: boolean;
  /** 脱敏手机号（默认 true） */
  phones?: boolean;
  /** 脱敏身份证号（默认 true） */
  idCards?: boolean;
  /** 自定义替换词 */
  customPatterns?: Array<{ pattern: RegExp; replacement: string }>;
}

const DEFAULT_OPTIONS: Required<Omit<SanitizeOptions, 'customPatterns'>> = {
  paths: true,
  ips: true,
  emails: true,
  tokens: true,
  usernames: false,
  phones: true,
  idCards: true,
};

/**
 * 脱敏文本内容
 */
export function sanitizeText(content: string, options?: SanitizeOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = content;

  if (opts.ips) {
    // IPv4 地址（在路径之前处理，避免 URL 中的 IP 被 PATH 正则误匹配）
    result = result.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]');
  }

  if (opts.paths) {
    // Unix 文件路径
    result = result.replace(/(?:\/[\w.-]+)+\.\w{1,5}/g, '[PATH]');
    // Windows 文件路径（多级目录用反斜杠分隔）
    result = result.replace(/[A-Z]:\\[\w.-]+(?:\\[\w.-]+)*\.\w{1,5}/gi, '[PATH]');
  }

  if (opts.emails) {
    // 邮箱地址
    result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]');
  }

  if (opts.tokens) {
    // 各类 API Key / Token
    result = result.replace(/\b(?:sk-|sk_|ghp_|gho_|ghu_|ghe_|Bearer\s+|token[:=]\s*|api[_-]?key[:=]\s*)[\w-]{20,}/gi, '[TOKEN]');
    // JWT
    result = result.replace(/\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, '[TOKEN]');
  }

  if (opts.phones) {
    // 中国手机号
    result = result.replace(/\b1[3-9]\d{9}\b/g, '[PHONE]');
    // 国际格式
    result = result.replace(/\+\d{1,3}[-.\s]?\d{6,12}\b/g, '[PHONE]');
  }

  if (opts.idCards) {
    // 中国身份证号
    result = result.replace(/\b\d{17}[\dXx]\b/g, '[ID_CARD]');
    result = result.replace(/\b\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '[ID_CARD]');
  }

  if (opts.usernames && options?.usernames) {
    // 用户名替换需要外部传入具体用户名列表
    // 这里只处理常见的用户标识模式
    result = result.replace(/(?:user(?:name)?|login|account)[:=]\s*[\w.-]+/gi, (match) => {
      const sep = match.match(/[:=]/)?.[0] ?? ':';
      const key = match.split(sep)[0];
      return `${key}${sep}[USER]`;
    });
  }

  // 自定义模式
  if (options?.customPatterns) {
    for (const { pattern, replacement } of options.customPatterns) {
      result = result.replace(pattern, replacement);
    }
  }

  return result;
}

/**
 * 脱敏对象中的指定字段
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  fields: string[],
  options?: SanitizeOptions,
): T {
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === 'string') {
      (result as Record<string, unknown>)[field] = sanitizeText(result[field] as string, options);
    }
  }
  return result;
}

/**
 * 检查文本是否包含 PII
 */
export function containsPII(content: string): boolean {
  return (
    /(?:\/[\w.-]+)+\.\w{1,5}/.test(content) ||
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(content) ||
    /[\w.-]+@[\w.-]+\.\w+/.test(content) ||
    /\b(?:sk-|sk_|ghp_|gho_|Bearer\s+)[\w-]{20,}/gi.test(content) ||
    /\b1[3-9]\d{9}\b/.test(content) ||
    /\b\d{17}[\dXx]\b/.test(content)
  );
}

/**
 * 生成脱敏报告
 */
export function generateSanitizeReport(original: string, sanitized: string): {
  hasPII: boolean;
  replacements: Array<{ type: string; count: number }>;
} {
  const replacements: Array<{ type: string; count: number }> = [];

  const types = [
    { type: 'PATH', pattern: /\[PATH\]/g },
    { type: 'IP', pattern: /\[IP\]/g },
    { type: 'EMAIL', pattern: /\[EMAIL\]/g },
    { type: 'TOKEN', pattern: /\[TOKEN\]/g },
    { type: 'PHONE', pattern: /\[PHONE\]/g },
    { type: 'ID_CARD', pattern: /\[ID_CARD\]/g },
    { type: 'USER', pattern: /\[USER\]/g },
  ];

  for (const { type, pattern } of types) {
    const count = (sanitized.match(pattern) ?? []).length;
    if (count > 0) replacements.push({ type, count });
  }

  return {
    hasPII: replacements.length > 0,
    replacements,
  };
}
