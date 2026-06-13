/**
 * 场景分析模块
 * 多模态图像分析：场景识别 / 物体检测 / 文字 OCR
 *
 * 支持后端：
 * - GPT-4o Vision（通用）
 * - MiMo Omni（小米多模态）
 * - 本地模型（llava）
 */

export interface SceneAnalysisResult {
  description: string;
  scene: string;              // 如 "office", "outdoor", "home"
  objects: DetectedObject[];
  text?: string;              // OCR 结果
  actions?: string[];         // 识别到的动作
  mood?: string;              // 画面氛围
  confidence: number;
  timestamp: number;
  processingMs: number;
  backend: string;
}

export interface DetectedObject {
  name: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface SceneAnalyzerOptions {
  backend?: 'openai' | 'mimo' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;          // OCR 语言
  maxTokens?: number;
}

const SCENE_CATEGORIES = [
  'office', 'home', 'outdoor', 'street', 'park', 'restaurant',
  'classroom', 'laboratory', 'hospital', 'gym', 'bedroom', 'kitchen',
  'library', 'airport', 'station', 'shop',
];

export class SceneAnalyzer {
  private backend: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;

  constructor(options: SceneAnalyzerOptions = {}) {
    this.backend = options.backend ?? 'openai';
    this.apiKey = options.apiKey ?? '';
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.model = options.model ?? 'gpt-4o-mini';
    this.maxTokens = options.maxTokens ?? 800;
  }

  /** 分析图片场景 */
  async analyze(base64Image: string, prompt?: string): Promise<SceneAnalysisResult> {
    const startMs = Date.now();

    const systemPrompt = `你是一个图像分析专家。分析给定的图片，返回 JSON 格式结果：
{
  "description": "一段话描述图片内容",
  "scene": "场景类别（${SCENE_CATEGORIES.join('/')}）",
  "objects": [{"name": "物体名", "confidence": 0.9}],
  "text": "如果图片中有文字，提取出来",
  "actions": ["识别到的动作，如 'typing', 'walking'"],
  "mood": "画面氛围，如 'busy', 'calm', 'dark'"
}
只返回 JSON，不要 markdown 代码块。`;

    const userPrompt = prompt ?? '分析这张图片的内容、场景、物体和文字。';

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'auto' } },
              ],
            },
          ],
          max_tokens: this.maxTokens,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return this._errorResult(errText, startMs);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '{}';
      const parsed = this._parseJson(content);

      return {
        description: parsed.description ?? '无法分析',
        scene: parsed.scene ?? 'unknown',
        objects: parsed.objects ?? [],
        text: parsed.text,
        actions: parsed.actions,
        mood: parsed.mood,
        confidence: 0.85,
        timestamp: Date.now(),
        processingMs: Date.now() - startMs,
        backend: this.backend,
      };
    } catch (err) {
      return this._errorResult((err as Error).message, startMs);
    }
  }

  /** 纯 OCR 提取文字 */
  async extractText(base64Image: string): Promise<string> {
    const result = await this.analyze(base64Image, '只提取图片中的所有文字，不要分析其他内容。');
    return result.text ?? '';
  }

  /** 分析视频帧 */
  async analyzeVideo(video: HTMLVideoElement): Promise<SceneAnalysisResult | null> {
    if (video.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

    return this.analyze(base64);
  }

  /** 代码截图分析 */
  async analyzeScreenshot(base64Image: string): Promise<SceneAnalysisResult> {
    return this.analyze(base64Image,
      '这是一个屏幕截图。分析：1) 这是什么应用/网站？2) 用户在做什么？3) 提取所有可见文字。',
    );
  }

  /** 设置 API Key */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** 设置后端 */
  setBackend(backend: string, options?: { baseUrl?: string; model?: string }): void {
    this.backend = backend;
    if (options?.baseUrl) this.baseUrl = options.baseUrl;
    if (options?.model) this.model = options.model;
  }

  /** 是否可用 */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  // ==================== 内部方法 ====================

  private _parseJson(content: string): any {
    try {
      return JSON.parse(content.replace(/```json\n?|```/g, '').trim());
    } catch {
      return {};
    }
  }

  private _errorResult(error: string, startMs: number): SceneAnalysisResult {
    return {
      description: `分析失败: ${error}`,
      scene: 'unknown',
      objects: [],
      confidence: 0,
      timestamp: Date.now(),
      processingMs: Date.now() - startMs,
      backend: this.backend,
    };
  }
}
