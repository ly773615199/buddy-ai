/**
 * STT 语音识别适配层
 * 统一接口，支持多个 STT 后端
 */

export interface STTOptions {
  language?: string;        // 语言代码，如 'zh-CN', 'en-US'
  continuous?: boolean;     // 是否连续识别
  interimResults?: boolean; // 是否返回中间结果
  maxAlternatives?: number; // 最大候选数
}

export interface STTResult {
  success: boolean;
  text: string;
  confidence: number;       // 0-1
  language?: string;
  isFinal: boolean;         // 是否最终结果
  alternatives?: { text: string; confidence: number }[];
  error?: string;
}

export interface STTBackend {
  name: string;
  /** 识别音频数据 */
  recognize(audio: Blob | Buffer | string, options?: STTOptions): Promise<STTResult>;
  /** 开始实时识别流 */
  startStreaming(options?: STTOptions): Promise<STTStream>;
  /** 是否可用 */
  isAvailable(): Promise<boolean>;
}

export interface STTStream {
  /** 推送音频数据 */
  push(audio: Blob | Buffer): void;
  /** 结束流 */
  end(): void;
  /** 识别结果回调 */
  onResult: ((result: STTResult) => void) | null;
  /** 错误回调 */
  onError: ((error: Error) => void) | null;
}

// ==================== Web Speech API 后端 ====================

export class WebSpeechSTT implements STTBackend {
  name = 'web-speech';
  private recognition: SpeechRecognition | null = null;

  async recognize(_audio: Blob | Buffer | string, options?: STTOptions): Promise<STTResult> {
    // Web Speech API 不支持离线音频识别，使用流式方式
    return this._recognizeOnce(options);
  }

  async startStreaming(options?: STTOptions): Promise<STTStream> {
    const SpeechRecognition = globalThis.SpeechRecognition
      || globalThis.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error('Web Speech API 不可用');
    }

    const recognition = new SpeechRecognition();
    recognition.lang = options?.language ?? 'zh-CN';
    recognition.continuous = options?.continuous ?? true;
    recognition.interimResults = options?.interimResults ?? true;
    recognition.maxAlternatives = options?.maxAlternatives ?? 1;

    let resultCallback: ((result: STTResult) => void) | null = null;
    let errorCallback: ((error: Error) => void) | null = null;

    const stream: STTStream = {
      push: () => {}, // Web Speech API 使用麦克风直接输入
      end: () => { recognition.stop(); },
      get onResult() { return resultCallback; },
      set onResult(cb) { resultCallback = cb; },
      get onError() { return errorCallback; },
      set onError(cb) { errorCallback = cb; },
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const sttResult: STTResult = {
          success: true,
          text: result[0].transcript,
          confidence: result[0].confidence,
          language: recognition.lang,
          isFinal: result.isFinal,
          alternatives: Array.from({ length: result.length - 1 }, (_, j) => ({
            text: result[j + 1].transcript,
            confidence: result[j + 1].confidence,
          })),
        };
        resultCallback?.(sttResult);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      errorCallback?.(new Error(`STT 错误: ${event.error}`));
    };

    recognition.start();
    this.recognition = recognition;
    return stream;
  }

  async isAvailable(): Promise<boolean> {
    const SpeechRecognition = globalThis.SpeechRecognition
      || globalThis.webkitSpeechRecognition;
    return !!SpeechRecognition;
  }

  private async _recognizeOnce(options?: STTOptions): Promise<STTResult> {
    const SpeechRecognition = globalThis.SpeechRecognition
      || globalThis.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return { success: false, text: '', confidence: 0, isFinal: true, error: 'Web Speech API 不可用' };
    }

    return new Promise((resolve) => {
      const recognition = new SpeechRecognition();
      recognition.lang = options?.language ?? 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const result = event.results[0][0];
        resolve({
          success: true,
          text: result.transcript,
          confidence: result.confidence,
          language: recognition.lang,
          isFinal: true,
        });
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        resolve({ success: false, text: '', confidence: 0, isFinal: true, error: event.error });
      };

      recognition.start();
    });
  }

  destroy(): void {
    this.recognition?.stop();
    this.recognition = null;
  }
}

// ==================== Whisper API 后端 ====================

export class WhisperSTT implements STTBackend {
  name = 'whisper';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async recognize(audio: Blob | Buffer | string, options?: STTOptions): Promise<STTResult> {
    try {
      const formData = new FormData();

      if (typeof audio === 'string') {
        // base64 → Blob
        const binaryStr = atob(audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        formData.append('file', new Blob([bytes], { type: 'audio/webm' }), 'audio.webm');
      } else if (audio instanceof Buffer) {
        formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm');
      } else {
        formData.append('file', audio as Blob, 'audio.webm');
      }

      formData.append('model', 'whisper-1');
      if (options?.language) formData.append('language', options.language.slice(0, 2));

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, text: '', confidence: 0, isFinal: true, error: `Whisper API 错误: ${err}` };
      }

      const data = await response.json() as { text: string };
      return {
        success: true,
        text: data.text,
        confidence: 0.9, // Whisper 不返回置信度，默认高
        language: options?.language,
        isFinal: true,
      };
    } catch (err) {
      return {
        success: false,
        text: '',
        confidence: 0,
        isFinal: true,
        error: `Whisper 调用失败: ${(err as Error).message}`,
      };
    }
  }

  async startStreaming(_options?: STTOptions): Promise<STTStream> {
    // Whisper API 不支持真正的流式，使用分段提交
    let resultCallback: ((result: STTResult) => void) | null = null;
    let errorCallback: ((error: Error) => void) | null = null;
    const chunks: Blob[] = [];

    return {
      push: (audio: Blob | Buffer) => {
        if (audio instanceof Buffer) {
          chunks.push(new Blob([new Uint8Array(audio)], { type: 'audio/webm' }));
        } else {
          chunks.push(audio as Blob);
        }
      },
      end: async () => {
        if (chunks.length === 0) return;
        const merged = new Blob(chunks, { type: 'audio/webm' });
        const result = await this.recognize(merged, _options);
        if (result.success) resultCallback?.(result);
        else errorCallback?.(new Error(result.error ?? '识别失败'));
      },
      get onResult() { return resultCallback; },
      set onResult(cb) { resultCallback = cb; },
      get onError() { return errorCallback; },
      set onError(cb) { errorCallback = cb; },
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}

// ==================== STT 管理器 ====================

export class STTManager {
  private backends: Map<string, STTBackend> = new Map();
  private activeBackend: string = 'web-speech';
  private enabled: boolean = true;
  private currentStream: STTStream | null = null;

  /** 注册 STT 后端 */
  registerBackend(backend: STTBackend): void {
    this.backends.set(backend.name, backend);
  }

  /** 设置活跃后端 */
  setActiveBackend(name: string): void {
    if (!this.backends.has(name)) {
      throw new Error(`STT 后端 "${name}" 未注册`);
    }
    this.activeBackend = name;
  }

  /** 获取活跃后端 */
  getBackend(): STTBackend {
    const backend = this.backends.get(this.activeBackend);
    if (!backend) throw new Error(`STT 后端 "${this.activeBackend}" 未找到`);
    return backend;
  }

  /** 识别单条音频 */
  async recognize(audio: Blob | Buffer | string, options?: STTOptions): Promise<STTResult> {
    if (!this.enabled) {
      return { success: false, text: '', confidence: 0, isFinal: true, error: 'STT 已禁用' };
    }

    // 尝试活跃后端，失败则降级
    try {
      const result = await this.getBackend().recognize(audio, options);
      if (result.success) return result;
    } catch { /* fallthrough */ }

    // 降级：尝试其他后端
    for (const [name, backend] of this.backends) {
      if (name === this.activeBackend) continue;
      try {
        if (await backend.isAvailable()) {
          return await backend.recognize(audio, options);
        }
      } catch { /* continue */ }
    }

    return { success: false, text: '', confidence: 0, isFinal: true, error: '所有 STT 后端不可用' };
  }

  /** 开始实时识别 */
  async startStreaming(options?: STTOptions): Promise<STTStream> {
    if (!this.enabled) throw new Error('STT 已禁用');

    const backend = this.getBackend();
    if (!(await backend.isAvailable())) throw new Error(`STT 后端 "${this.activeBackend}" 不可用`);

    this.currentStream = await backend.startStreaming(options);
    return this.currentStream;
  }

  /** 停止实时识别 */
  stopStreaming(): void {
    this.currentStream?.end();
    this.currentStream = null;
  }

  /** 启用/禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopStreaming();
  }

  /** 检查是否有可用后端 */
  async hasAvailableBackend(): Promise<boolean> {
    for (const backend of this.backends.values()) {
      if (await backend.isAvailable()) return true;
    }
    return false;
  }

  /** 列出所有注册的后端 */
  listBackends(): string[] {
    return Array.from(this.backends.keys());
  }
}
