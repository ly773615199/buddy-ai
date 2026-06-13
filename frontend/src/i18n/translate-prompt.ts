/**
 * 翻译 Prompt 模板 — 构建时/运行时共享
 *
 * 用于 i18n-sync 脚本（批量翻译）和 translate-engine（运行时 LLM 降级）
 */

export interface TranslatePromptOptions {
  /** 目标语言代码 */
  targetLang: string;
  /** 目标语言英文名 */
  targetLangName: string;
  /** 源文本数组 */
  texts: string[];
  /** 术语表（中文 → 目标语言映射） */
  glossary?: Record<string, string>;
}

/** 语言代码 → 英文名映射 */
export const LANG_NAMES: Record<string, string> = {
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'fr': 'French',
  'de': 'German',
  'es': 'Spanish',
  'zh-CN': 'Chinese (Simplified)',
  'zh': 'Chinese (Simplified)',
};

/**
 * 构建翻译系统 prompt
 */
export function buildSystemPrompt(options: TranslatePromptOptions): string {
  const { targetLangName, glossary } = options;

  let prompt = `You are a professional translator for a pet simulation game called "Buddy".
Translate the following Chinese texts to ${targetLangName}.
Rules:
- Preserve any {{variable}} placeholders exactly as-is
- Preserve any HTML tags or JSX expressions
- Keep translations natural and conversational (not robotic)
- Keep the same tone and style as the source
- For game-specific terms, use the glossary below
- Return ONLY a JSON array of translated strings, same order as input
- Do NOT add explanations or markdown`;

  if (glossary && Object.keys(glossary).length > 0) {
    prompt += `\n\nGlossary (MUST follow these translations):\n`;
    for (const [zh, translated] of Object.entries(glossary)) {
      prompt += `- "${zh}" → "${translated}"\n`;
    }
  }

  return prompt;
}

/**
 * 构建翻译用户 prompt
 */
export function buildUserPrompt(texts: string[]): string {
  return `Translate these Chinese texts:\n\n${JSON.stringify(texts, null, 2)}`;
}

/**
 * 解析 LLM 响应为翻译数组
 */
export function parseTranslationResponse(response: string, expectedCount: number): string[] {
  // 尝试从响应中提取 JSON 数组
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length === expectedCount) {
        return parsed;
      }
    } catch { /* fall through */ }
  }

  // 降级：按行解析
  const lines = response.split('\n').filter(l => l.trim());
  if (lines.length >= expectedCount) {
    return lines.slice(0, expectedCount);
  }

  // 最终降级：返回空数组
  return [];
}
