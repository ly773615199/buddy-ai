/**
 * TTS 语音合成适配层
 * 统一接口，支持多个 TTS 后端
 */

export interface TTSOptions {
  voice?: string;       // 音色名称
  rate?: string;        // 语速，如 "+20%"
  pitch?: string;       // 音调，如 "+5Hz"
  volume?: string;      // 音量，如 "+0%"
  emotion?: string;     // 情绪（部分后端支持）
}

export interface TTSResult {
  success: boolean;
  audioBase64?: string; // base64 编码的音频数据
  audioBuffer?: Buffer; // 原始音频 buffer
  format: string;       // 音频格式 (mp3/ogg/wav)
  duration?: number;    // 预估时长 ms
  error?: string;
}

export interface TTSBackend {
  name: string;
  /** 合成语音，返回音频数据 */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
  /** 可用音色列表 */
  listVoices(): TTSVoice[];
  /** 是否可用（检查配置/依赖） */
  isAvailable(): Promise<boolean>;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style?: string;       // 风格，如 "cheerful", "sad"
}

// ==================== 音色预设 ====================

/** 按物种匹配的默认音色 */
export const SPECIES_VOICE_MAP: Record<string, { edge: string; openai: string }> = {
  '光灵': { edge: 'zh-CN-XiaoxiaoNeural', openai: 'nova' },
  '大鹅':   { edge: 'zh-CN-YunxiNeural', openai: 'onyx' },
  '猫':     { edge: 'zh-CN-XiaoyiNeural', openai: 'shimmer' },
  '龙':     { edge: 'zh-CN-YunjianNeural', openai: 'fable' },
  '幽灵':   { edge: 'zh-CN-YunxiNeural', openai: 'echo' },
  '机器人': { edge: 'zh-CN-YunxiNeural', openai: 'alloy' },
  '蘑菇':   { edge: 'zh-CN-XiaoxiaoNeural', openai: 'nova' },
  '胖胖':   { edge: 'zh-CN-YunzeNeural', openai: 'onyx' },
};

// ==================== TTS 管理器 ====================

export class TTSManager {
  private backends: Map<string, TTSBackend> = new Map();
  private activeBackend: string = 'edge';
  private enabled: boolean = true;
  private defaultOptions: TTSOptions = {};

  constructor() {
    this.defaultOptions = {
      rate: '+0%',
      pitch: '+0Hz',
      volume: '+0%',
    };
  }

  /** 注册 TTS 后端 */
  registerBackend(backend: TTSBackend): void {
    this.backends.set(backend.name, backend);
  }

  /** 设置活跃后端 */
  setActiveBackend(name: string): void {
    if (!this.backends.has(name)) {
      throw new Error(`TTS 后端 "${name}" 未注册`);
    }
    this.activeBackend = name;
  }

  /** 获取活跃后端 */
  getActiveBackend(): TTSBackend | null {
    return this.backends.get(this.activeBackend) ?? null;
  }

  /** 列出所有已注册后端 */
  listBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /** 启用/禁用 TTS */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 设置默认选项 */
  setDefaultOptions(options: Partial<TTSOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  /** 根据物种获取推荐音色 */
  getVoiceForSpecies(species: string): string | null {
    const mapping = SPECIES_VOICE_MAP[species];
    if (!mapping) return null;
    return this.activeBackend === 'openai' ? mapping.openai : mapping.edge;
  }

  /** 合成语音 */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!this.enabled) {
      return { success: false, format: 'mp3', error: 'TTS 已禁用' };
    }

    const backend = this.backends.get(this.activeBackend);
    if (!backend) {
      return { success: false, format: 'mp3', error: `TTS 后端 "${this.activeBackend}" 未找到` };
    }

    const available = await backend.isAvailable();
    if (!available) {
      // 尝试降级到其他后端
      for (const [name, fallback] of this.backends) {
        if (name !== this.activeBackend && await fallback.isAvailable()) {
          console.log(`  [TTS] ${this.activeBackend} 不可用，降级到 ${name}`);
          const merged = { ...this.defaultOptions, ...options };
          return fallback.synthesize(text, merged);
        }
      }
      return { success: false, format: 'mp3', error: '所有 TTS 后端不可用' };
    }

    const merged = { ...this.defaultOptions, ...options };
    return backend.synthesize(text, merged);
  }

  /** 根据情绪调整 TTS 选项（Sprint 3: 增强版） */
  static emotionToOptions(mood: string, energy?: number): Partial<TTSOptions> {
    const e = Math.max(0, Math.min(1, energy ?? 0.5));
    const energyBonus = Math.round((e - 0.5) * 10); // -5 ~ +5

    const adjustPercent = (base: string, bonus: number) => {
      const match = base.match(/([+-]?\d+)%/);
      if (!match) return base;
      return `${parseInt(match[1]) + bonus >= 0 ? '+' : ''}${parseInt(match[1]) + bonus}%`;
    };
    const adjustHz = (base: string, bonus: number) => {
      const match = base.match(/([+-]?\d+)Hz/);
      if (!match) return base;
      return `${parseInt(match[1]) + bonus >= 0 ? '+' : ''}${parseInt(match[1]) + bonus}Hz`;
    };

    const presets: Record<string, Partial<TTSOptions>> = {
      happy:      { rate: adjustPercent('+12%', energyBonus), pitch: adjustHz('+6Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('+8%', Math.round(energyBonus * 0.6)) },
      excited:    { rate: adjustPercent('+20%', energyBonus), pitch: adjustHz('+10Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('+15%', Math.round(energyBonus * 0.6)) },
      calm:       { rate: adjustPercent('-8%', energyBonus), pitch: adjustHz('-2Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('-5%', Math.round(energyBonus * 0.6)) },
      curious:    { rate: adjustPercent('+5%', energyBonus), pitch: adjustHz('+4Hz', Math.round(energyBonus * 0.5)) },
      tired:      { rate: adjustPercent('-18%', energyBonus), pitch: adjustHz('-8Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('-12%', Math.round(energyBonus * 0.6)) },
      sad:        { rate: adjustPercent('-15%', energyBonus), pitch: adjustHz('-10Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('-15%', Math.round(energyBonus * 0.6)) },
      angry:      { rate: adjustPercent('+10%', energyBonus), pitch: adjustHz('-5Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('+20%', Math.round(energyBonus * 0.6)) },
      anxious:    { rate: adjustPercent('+15%', energyBonus), pitch: adjustHz('+8Hz', Math.round(energyBonus * 0.5)), volume: adjustPercent('+10%', Math.round(energyBonus * 0.6)) },
      thinking:   { rate: '-10%' },
      confused:   { rate: '-5%', pitch: '-2Hz' },
      frustrated: { rate: '+5%', pitch: '-3Hz' },
    };
    return presets[mood] ?? {};
  }
}
