/**
 * TTS (Text-to-Speech) Manager
 * 后端支持：Edge TTS / Web Speech API / 系统原生
 */

export type TTSBackend = 'edge' | 'webspeech' | 'native';

export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  backend: TTSBackend;
}

export interface TTSOptions {
  voice?: TTSVoice;
  rate?: number;   // 0.5 - 2.0
  pitch?: number;  // 0 - 2
  volume?: number; // 0 - 1
}

export interface TTSResult {
  success: boolean;
  duration?: number;
  error?: string;
}

/** 物种语音映射 */
export const SPECIES_VOICE_MAP: Record<string, string> = {
  cat: 'zh-CN-XiaoxiaoNeural',
  dog: 'zh-CN-YunxiNeural',
  rabbit: 'zh-CN-XiaoyiNeural',
  default: 'zh-CN-XiaoxiaoNeural',
};

export class TTSManager {
  private currentAudio: HTMLAudioElement | null = null;

  async speak(text: string, options?: TTSOptions): Promise<TTSResult> {
    // Stub implementation
    return { success: true };
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }
}
