/**
 * OCR 识别模块
 * 支持多后端：云端 API / 浏览器原生 / 本地 Tesseract
 */

// ── 类型定义 ──

export type OCRBackend = 'cloud' | 'browser' | 'tesseract';

export interface OCRResult {
  /** 提取的文本 */
  text: string;
  /** 分段结果（含位置信息） */
  segments: OCRSegment[];
  /** 检测到的语言 */
  detectedLanguages: string[];
  /** 整体置信度 0-1 */
  confidence: number;
  /** 处理耗时 ms */
  processingMs: number;
  /** 使用的后端 */
  backend: OCRBackend;
}

export interface OCRSegment {
  /** 文本内容 */
  text: string;
  /** 边界框 */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** 置信度 */
  confidence: number;
  /** 行号 */
  lineNumber?: number;
}

export interface OCROptions {
  /** 优先使用的后端 */
  preferredBackend?: OCRBackend;
  /** API Key（云端后端需要） */
  apiKey?: string;
  /** API endpoint */
  apiEndpoint?: string;
  /** 识别语言提示 */
  languageHint?: string[];
  /** 是否保留位置信息 */
  preserveLayout?: boolean;
}

// ── 主类 ──

export class OCRProcessor {
  private backend: OCRBackend;
  private apiKey: string | undefined;
  private apiEndpoint: string | undefined;
  private options: OCROptions;

  constructor(options: OCROptions = {}) {
    this.options = options;
    this.backend = options.preferredBackend || 'cloud';
    this.apiKey = options.apiKey;
    this.apiEndpoint = options.apiEndpoint;
  }

  /** 从 base64 图片中提取文字 */
  async recognize(base64Image: string, prompt?: string): Promise<OCRResult> {
    const startTime = Date.now();

    // 移除 data URL 前缀（如有）
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

    try {
      const result = await this.recognizeWithBackend(cleanBase64, this.backend, prompt);
      return {
        ...result,
        processingMs: Date.now() - startTime,
        backend: this.backend,
      };
    } catch (error) {
      // 降级到其他后端
      const fallbackOrder: OCRBackend[] = (
        ['cloud', 'browser', 'tesseract'] as OCRBackend[]
      ).filter(b => b !== this.backend);

      for (const fallback of fallbackOrder) {
        try {
          const result = await this.recognizeWithBackend(cleanBase64, fallback, prompt);
          return {
            ...result,
            processingMs: Date.now() - startTime,
            backend: fallback,
          };
        } catch {
          continue;
        }
      }

      throw new Error(`所有 OCR 后端均失败: ${error}`, { cause: error });
    }
  }

  /** 从文件路径识别 */
  async recognizeFile(filePath: string, prompt?: string): Promise<OCRResult> {
    // 动态导入 fs（Node.js 环境）
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    return this.recognize(base64, prompt);
  }

  /** 提取纯文本（忽略位置信息） */
  async extractText(base64Image: string): Promise<string> {
    const result = await this.recognize(base64Image);
    return result.text;
  }

  /** 识别代码截图 */
  async recognizeCode(base64Image: string): Promise<{ code: string; language: string }> {
    const result = await this.recognize(
      base64Image,
      '识别图片中的代码。输出格式：语言名称 + 代码内容。不要添加解释。'
    );

    // 尝试从结果推断语言
    const language = this.detectCodeLanguage(result.text);

    return {
      code: result.text,
      language,
    };
  }

  /** 批量识别 */
  async recognizeBatch(
    images: string[],
    concurrency = 3
  ): Promise<OCRResult[]> {
    const results: OCRResult[] = [];

    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(img => this.recognize(img).catch(() => ({
          text: '',
          segments: [],
          detectedLanguages: [],
          confidence: 0,
          processingMs: 0,
          backend: this.backend,
        })))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ── 私有方法 ──

  private async recognizeWithBackend(
    base64: string,
    backend: OCRBackend,
    prompt?: string
  ): Promise<Omit<OCRResult, 'processingMs' | 'backend'>> {
    switch (backend) {
      case 'cloud':
        return this.cloudOCR(base64, prompt);
      case 'browser':
        return this.browserOCR(base64);
      case 'tesseract':
        return this.tesseractOCR(base64);
      default:
        throw new Error(`不支持的 OCR 后端: ${backend}`);
    }
  }

  /** 云端 OCR（GPT-4o Vision / 通用 API） */
  private async cloudOCR(
    base64: string,
    prompt?: string
  ): Promise<Omit<OCRResult, 'processingMs' | 'backend'>> {
    if (!this.apiKey) {
      throw new Error('云端 OCR 需要 API Key');
    }

    const endpoint = this.apiEndpoint || 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt || '请提取图片中的所有文字，保持原始格式。只输出文字内容，不要添加任何解释。',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`云端 OCR 请求失败: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices[0]?.message?.content || '';

    return {
      text,
      segments: [{ text, boundingBox: { x: 0, y: 0, width: 0, height: 0 }, confidence: 0.9 }],
      detectedLanguages: this.detectLanguages(text),
      confidence: 0.9,
    };
  }

  /** 浏览器原生 OCR（实验性 API） */
  private async browserOCR(
    _base64: string
  ): Promise<Omit<OCRResult, 'processingMs' | 'backend'>> {
    // 检查浏览器环境
    if (typeof window === 'undefined') {
      throw new Error('浏览器 OCR 仅在前端环境可用');
    }

    throw new Error('浏览器 OCR API 尚未广泛支持，请使用云端后端');
  }

  /** 本地 Tesseract OCR */
  private async tesseractOCR(
    _base64: string
  ): Promise<Omit<OCRResult, 'processingMs' | 'backend'>> {
    try {
      // 动态导入 tesseract.js（如果已安装）
      const tesseract = await import('tesseract.js' as any);
      const worker = await tesseract.createWorker();

      const buffer = Buffer.from(_base64, 'base64');
      const { data } = await worker.recognize(buffer);
      await worker.terminate();

      return {
        text: data.text.trim(),
        segments: [{
          text: data.text.trim(),
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          confidence: data.confidence / 100,
        }],
        detectedLanguages: [],
        confidence: data.confidence / 100,
      };
    } catch {
      throw new Error('Tesseract OCR 不可用，请安装 tesseract.js');
    }
  }

  /** 检测文本中的语言 */
  private detectLanguages(text: string): string[] {
    const languages: string[] = [];
    if (/[\u4e00-\u9fff]/.test(text)) languages.push('zh');
    if (/[a-zA-Z]/.test(text)) languages.push('en');
    if (/[ぁ-んァ-ヶ]/.test(text)) languages.push('ja');
    if (/[가-힣]/.test(text)) languages.push('ko');
    return languages.length > 0 ? languages : ['unknown'];
  }

  /** 从代码文本推断编程语言 */
  private detectCodeLanguage(code: string): string {
    const patterns: Array<[RegExp, string]> = [
      [/import\s+.*from\s+['"]|export\s+(default|const|function)/, 'TypeScript/JavaScript'],
      [/def\s+\w+\(|import\s+\w+|print\(/, 'Python'],
      [/func\s+\w+|package\s+main|fmt\./, 'Go'],
      [/fn\s+\w+|let\s+mut|println!/, 'Rust'],
      [/public\s+(static\s+)?void|System\.out/, 'Java'],
      [/#include|printf\(|int\s+main/, 'C/C++'],
      [/SELECT\s+.*FROM|INSERT\s+INTO|CREATE\s+TABLE/i, 'SQL'],
      [/<\w+[^>]*>|<!DOCTYPE/i, 'HTML'],
      [/\.\w+\s*\{|:\s*(hover|active)/, 'CSS'],
    ];

    for (const [pattern, lang] of patterns) {
      if (pattern.test(code)) return lang;
    }
    return 'unknown';
  }
}
