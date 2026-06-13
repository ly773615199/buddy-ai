/**
 * 音频引擎核心 — Web Audio API 单例
 *
 * 管理 AudioContext 生命周期，提供 SFX/Ambient/Voice 三个播放通道。
 * 浏览器限制：AudioContext 必须在用户交互后才能创建。
 */

export type SoundCategory = 'sfx' | 'ambient' | 'voice' | 'music';

export interface VolumeState {
  master: number;    // 0-1 主音量
  sfx: number;       // 0-1 音效
  ambient: number;   // 0-1 氛围
  voice: number;     // 0-1 语音
  music: number;     // 0-1 音乐
  muted: boolean;    // 全局静音
}

export interface AudioEngineState {
  contextState: 'suspended' | 'running' | 'closed';
  volume: VolumeState;
  activeSources: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private categoryGains: Map<SoundCategory, GainNode> = new Map();
  private volume: VolumeState = {
    master: 0.8,
    sfx: 0.5,
    ambient: 0.2,
    voice: 0.8,
    music: 0.3,
    muted: false,
  };
  private activeSources = 0;
  private initialized = false;

  // ==================== 初始化 ====================

  /** 确保 AudioContext 已创建（首次用户交互时调用） */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.volume.muted ? 0 : this.volume.master;

      // 创建各分类的 GainNode
      const categories: SoundCategory[] = ['sfx', 'ambient', 'voice', 'music'];
      for (const cat of categories) {
        const gain = this.ctx.createGain();
        gain.connect(this.masterGain);
        gain.gain.value = this.volume[cat];
        this.categoryGains.set(cat, gain);
      }

      this.initialized = true;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** 获取 AudioContext（不创建） */
  getContext(): AudioContext | null {
    return this.ctx;
  }

  // ==================== 音量控制 ====================

  getVolume(): VolumeState {
    return { ...this.volume };
  }

  setMasterVolume(value: number): void {
    this.volume.master = clamp(value, 0, 1);
    if (this.masterGain && !this.volume.muted) {
      this.masterGain.gain.value = this.volume.master;
    }
  }

  setCategoryVolume(category: SoundCategory, value: number): void {
    this.volume[category] = clamp(value, 0, 1);
    const gain = this.categoryGains.get(category);
    if (gain) {
      gain.gain.value = this.volume[category];
    }
  }

  setMuted(muted: boolean): void {
    this.volume.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.volume.master;
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.volume.muted);
    return this.volume.muted;
  }

  // ==================== 播放控制 ====================

  /** 获取分类的 GainNode（用于连接音频源） */
  getCategoryGain(category: SoundCategory): GainNode | null {
    return this.categoryGains.get(category) ?? null;
  }

  /** 活跃音频源计数 */
  getActiveSources(): number {
    return this.activeSources;
  }

  /** 增加活跃源计数 */
  incrementSources(): void {
    this.activeSources++;
  }

  /** 减少活跃源计数 */
  decrementSources(): void {
    this.activeSources = Math.max(0, this.activeSources - 1);
  }

  // ==================== 持久化 ====================

  /** 从 localStorage 恢复音量设置 */
  loadVolume(): void {
    try {
      const saved = localStorage.getItem('buddy_volume');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.volume = { ...this.volume, ...parsed };
      }
    } catch { /* ignore */ }
  }

  /** 保存音量设置到 localStorage */
  saveVolume(): void {
    try {
      localStorage.setItem('buddy_volume', JSON.stringify(this.volume));
    } catch { /* ignore */ }
  }

  // ==================== 状态 ====================

  getState(): AudioEngineState {
    return {
      contextState: this.ctx?.state ?? 'closed',
      volume: this.getVolume(),
      activeSources: this.activeSources,
    };
  }

  // ==================== 清理 ====================

  async destroy(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
    this.ctx = null;
    this.masterGain = null;
    this.categoryGains.clear();
    this.initialized = false;
    this.activeSources = 0;
  }
}

// ==================== 单例 ====================

let instance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!instance) {
    instance = new AudioEngine();
    instance.loadVolume();
  }
  return instance;
}

// ==================== 工具函数 ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
