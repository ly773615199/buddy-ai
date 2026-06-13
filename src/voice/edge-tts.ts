/**
 * Edge TTS 后端实现
 * 使用微软 Edge 浏览器的免费 TTS API
 * 无需 API Key，通过 WebSocket 连接
 */

import type { TTSBackend, TTSResult, TTSOptions, TTSVoice } from './tts.js';

// ==================== Edge TTS 可用音色 ====================

const EDGE_VOICES: TTSVoice[] = [
  // 中文
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（活泼）', language: 'zh-CN', gender: 'female', style: 'cheerful' },
  { id: 'zh-CN-YunxiNeural', name: '云希（年轻男）', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', name: '云健（成熟男）', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓艺（温柔女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunzeNeural', name: '云泽（沉稳男）', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaochenNeural', name: '晓辰（自然女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaohanNeural', name: '晓涵（温暖女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaomengNeural', name: '晓梦（甜美女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaomoNeural', name: '晓墨（知性女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoruiNeural', name: '晓睿（聪慧女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoshuangNeural', name: '晓双（活泼女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoxuanNeural', name: '晓萱（清新女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyanNeural', name: '晓颜（亲切女）', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunhaoNeural', name: '云皓（阳光男）', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏（少年男）', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyisiNeural', name: '云逸思（优雅男）', language: 'zh-CN', gender: 'male' },
  // 英文
  { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' },
  { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
  { id: 'en-US-JennyNeural', name: 'Jenny', language: 'en-US', gender: 'female' },
];

// ==================== SSML 构建 ====================

function buildSSML(text: string, options: TTSOptions): string {
  const voice = options.voice ?? 'zh-CN-XiaoxiaoNeural';
  const rate = options.rate ?? '+0%';
  const pitch = options.pitch ?? '+0Hz';
  const volume = options.volume ?? '+0%';

  // 转义 XML 特殊字符
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
      ${escaped}
    </prosody>
  </voice>
</speak>`;
}

// ==================== 音频格式转换 ====================

/** 从 Edge TTS 返回的二进制数据中提取音频 */
function extractAudioFromMessage(data: Buffer): Buffer | null {
  // Edge TTS 消息格式: 头部 + 音频数据
  // 头部以 \r\n\r\n 分隔
  const headerEnd = data.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const header = data.slice(0, headerEnd).toString('utf-8');
  if (header.includes('Path:audio')) {
    return data.slice(headerEnd + 4);
  }
  return null;
}

// ==================== Edge TTS 后端 ====================

export class EdgeTTSBackend implements TTSBackend {
  name = 'edge';
  private wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  private trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

  listVoices(): TTSVoice[] {
    return EDGE_VOICES;
  }

  async isAvailable(): Promise<boolean> {
    // Edge TTS 始终可用（免费 API）
    // 简单检查网络连通性
    try {
      const response = await fetch('https://speech.platform.bing.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch {
      // 即使 HEAD 请求失败，WebSocket 连接可能仍然可用
      return true;
    }
  }

  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!text.trim()) {
      return { success: false, format: 'mp3', error: '文本为空' };
    }

    // 文本长度限制
    if (text.length > 5000) {
      text = text.slice(0, 5000);
    }

    try {
      const audioBuffer = await this.synthesizeInternal(text, options);
      if (!audioBuffer || audioBuffer.length === 0) {
        return { success: false, format: 'mp3', error: '未获取到音频数据' };
      }

      return {
        success: true,
        audioBase64: audioBuffer.toString('base64'),
        audioBuffer,
        format: 'mp3',
        duration: Math.round(text.length * 120), // 粗略估算：每字 120ms
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, format: 'mp3', error: `Edge TTS 失败: ${msg}` };
    }
  }

  private async synthesizeInternal(text: string, options: TTSOptions): Promise<Buffer | null> {
    // 使用动态 import 加载 ws 模块
    const { WebSocket } = await import('ws');

    const requestId = generateUUID();
    const connId = generateUUID();

    const url = `${this.wsUrl}?TrustedClientToken=${this.trustedClientToken}&ConnectionId=${connId}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        },
      });

      const chunks: Buffer[] = [];
      let timeout: ReturnType<typeof setTimeout>;

      ws.on('open', () => {
        // 发送配置请求
        const configMsg = [
          `X-Timestamp:${new Date().toISOString()}`,
          'Content-Type:application/json; charset=utf-8',
          `X-RequestId:${requestId}`,
          '',
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: false,
                    wordBoundaryEnabled: false,
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          }),
        ].join('\r\n');

        ws.send(configMsg);

        // 发送 SSML
        const ssml = buildSSML(text, options);
        const ssmlMsg = [
          `X-Timestamp:${new Date().toISOString()}`,
          'Content-Type:application/ssml+xml',
          `X-RequestId:${requestId}`,
          '',
          ssml,
        ].join('\r\n');

        ws.send(ssmlMsg);
      });

      ws.on('message', (data: Buffer) => {
        const audioData = extractAudioFromMessage(data);
        if (audioData) {
          chunks.push(audioData);
        }

        // 检查是否收到结束信号
        const header = data.slice(0, Math.min(data.length, 200)).toString('utf-8', 0, Math.min(data.indexOf('\r\n\r\n'), 200));
        if (header.includes('Path:turn.end') || data.toString('utf-8').includes('Path:turn.end')) {
          clearTimeout(timeout);
          ws.close();
          resolve(Buffer.concat(chunks));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        }
      });

      // 30 秒超时
      timeout = setTimeout(() => {
        ws.close();
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error('Edge TTS 超时'));
        }
      }, 30000);
    });
  }
}

// ==================== 工具函数 ====================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
