/**
 * TTS 语音桥接 — 大音频走 REST，WS 只发通知
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 4）
 */

import type { WSEvent } from '../types.js';
import type { EventBus } from '../ws/server.js';
import type { Subsystems } from './subsystems.js';
import type { AudioCache } from './audio-cache.js';

export interface TTSBridgeDeps {
  sys: Subsystems;
  eventBus: EventBus | null;
  audioCache: AudioCache;
  verbose: boolean;
}

export class TTSBridge {
  constructor(private deps: TTSBridgeDeps) {}

  /** TTS 语音合成（大音频走 REST，WS 只发通知） */
  async speak(text: string, sentenceId?: string): Promise<void> {
    if (!this.deps.sys.tts.isEnabled() || !this.deps.eventBus) return;
    const moodOptions = (await import('../voice/tts.js')).TTSManager.emotionToOptions(this.deps.sys.cerebellum?.getMood() ?? 'calm');
    try {
      const result = await this.deps.sys.tts.synthesize(text, moodOptions);
      if (result.success && result.audioBase64) {
        const id = sentenceId ?? `s-${Date.now()}`;
        const audioSize = result.audioBase64.length;

        if (this.deps.audioCache.shouldUseREST(audioSize)) {
          this.deps.audioCache.set(id, result.audioBase64, result.format);
          this.deps.eventBus.emit({ type: 'audio_ready', id, format: result.format } as WSEvent);
        } else {
          this.deps.eventBus.emit({
            type: 'audio', data: result.audioBase64, format: result.format, sentenceId: id,
          });
        }
      }
    } catch (err) {
      if (this.deps.verbose) console.warn('[TTS] 语音合成失败:', (err as Error).message);
    }
  }

  /** 按句子分段合成语音 */
  async speakLongText(text: string): Promise<void> {
    if (!this.deps.sys.tts.isEnabled() || !this.deps.eventBus) return;
    const sentences = text
      .split(/(?<=[。！？.!?\n])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (let i = 0; i < sentences.length; i++) {
      const id = `s-${Date.now()}-${i}`;
      await this.speak(sentences[i], id);
    }
  }
}
