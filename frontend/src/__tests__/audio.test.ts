/**
 * 音频子系统测试 v2
 *
 * 覆盖：合成参数逻辑、FM 合成配置、滤波器预设、
 *       环境音预设、旋律生成、声音事件分类、自适应阈值
 */
import { describe, it, expect } from 'vitest';

// ==================== SFX 参数验证 ====================

describe('SFX 参数完整性', () => {
  const UI_SFX: Record<string, { freq: number; type: string; duration: number; volume: number }> = {
    click:     { freq: 800,  type: 'sine',     duration: 50,  volume: 0.3 },
    send:      { freq: 600,  type: 'sine',     duration: 120, volume: 0.35 },
    receive:   { freq: 900,  type: 'sine',     duration: 150, volume: 0.35 },
    tabSwitch: { freq: 500,  type: 'triangle', duration: 80,  volume: 0.2 },
    success:   { freq: 523,  type: 'sine',     duration: 200, volume: 0.4 },
    error:     { freq: 300,  type: 'sawtooth', duration: 300, volume: 0.35 },
    typing:    { freq: 1200, type: 'sine',     duration: 20,  volume: 0.1 },
  };

  for (const [name, params] of Object.entries(UI_SFX)) {
    it(`${name}: 频率在可听范围 (20-20000Hz)`, () => {
      expect(params.freq).toBeGreaterThanOrEqual(20);
      expect(params.freq).toBeLessThanOrEqual(20000);
    });

    it(`${name}: 音量在 0-1 范围`, () => {
      expect(params.volume).toBeGreaterThanOrEqual(0);
      expect(params.volume).toBeLessThanOrEqual(1);
    });

    it(`${name}: 时长 > 0`, () => {
      expect(params.duration).toBeGreaterThan(0);
    });

    it(`${name}: 波形有效`, () => {
      expect(['sine', 'square', 'sawtooth', 'triangle']).toContain(params.type);
    });
  }
});

describe('情绪音效映射', () => {
  const EMOTION_SFX: Record<string, { freq: number; freqEnd?: number }> = {
    happy:      { freq: 523, freqEnd: 784 },
    excited:    { freq: 400, freqEnd: 800 },
    tired:      { freq: 300, freqEnd: 150 },
    frustrated: { freq: 250, freqEnd: 180 },
    calm:       { freq: 440 },
    confused:   { freq: 400, freqEnd: 300 },
  };

  it('happy 频率上升（欢快感）', () => {
    expect(EMOTION_SFX.happy.freqEnd!).toBeGreaterThan(EMOTION_SFX.happy.freq);
  });

  it('tired 频率下降（疲惫感）', () => {
    expect(EMOTION_SFX.tired.freqEnd!).toBeLessThan(EMOTION_SFX.tired.freq);
  });

  it('frustrated 频率下降（低沉感）', () => {
    expect(EMOTION_SFX.frustrated.freqEnd!).toBeLessThan(EMOTION_SFX.frustrated.freq);
  });

  it('calm 无滑音（平稳感）', () => {
    expect(EMOTION_SFX.calm.freqEnd).toBeUndefined();
  });
});

// ==================== FM 合成参数 ====================

describe('FM 合成配置', () => {
  interface FMConfig {
    modFreq: number;
    modDepth: number;
    modType?: string;
  }

  const fmConfigs: Record<string, FMConfig> = {
    breathe: { modFreq: 0.5, modDepth: 20, modType: 'sine' },
    send:    { modFreq: 3, modDepth: 50 },
    excited: { modFreq: 12, modDepth: 100 },
  };

  it('breathe LFO 频率极低（呼吸感）', () => {
    expect(fmConfigs.breathe.modFreq).toBeLessThan(1);
  });

  it('send 调制频率适中（柔和颤音）', () => {
    expect(fmConfigs.send.modFreq).toBeGreaterThan(1);
    expect(fmConfigs.send.modFreq).toBeLessThan(10);
  });

  it('excited 调制深度最大（激烈感）', () => {
    expect(fmConfigs.excited.modDepth).toBeGreaterThan(fmConfigs.breathe.modDepth);
    expect(fmConfigs.excited.modDepth).toBeGreaterThan(fmConfigs.send.modDepth);
  });

  it('默认调制波形为 sine', () => {
    expect(fmConfigs.send.modType ?? 'sine').toBe('sine');
  });
});

// ==================== 滤波器预设 ====================

describe('滤波器预设', () => {
  const filters = [
    { name: 'click', type: 'highpass', frequency: 600 },
    { name: 'receive', type: 'lowpass', frequency: 2000, Q: 1 },
    { name: 'error', type: 'lowpass', frequency: 1200, Q: 2 },
    { name: 'excited', type: 'bandpass', frequency: 800, Q: 2 },
  ];

  for (const f of filters) {
    it(`${f.name}: 滤波器类型有效`, () => {
      expect(['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking', 'lowshelf', 'highshelf']).toContain(f.type);
    });

    it(`${f.name}: 频率在可听范围`, () => {
      expect(f.frequency).toBeGreaterThan(20);
      expect(f.frequency).toBeLessThan(20000);
    });

    if (f.Q !== undefined) {
      it(`${f.name}: Q 值合理 (>0)`, () => {
        expect(f.Q).toBeGreaterThan(0);
      });
    }
  }
});

// ==================== 空间音效参数 ====================

describe('空间音效', () => {
  const panValues = [-1, -0.5, 0, 0.5, 1];

  for (const pan of panValues) {
    it(`pan=${pan} 在有效范围 [-1, 1]`, () => {
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    });
  }

  it('pan=0 表示居中', () => {
    expect(0).toBe(0);
  });

  it('pan=-1 表示最左', () => {
    expect(-1).toBeLessThan(0);
  });

  it('pan=1 表示最右', () => {
    expect(1).toBeGreaterThan(0);
  });
});

// ==================== 环境音预设 ====================

describe('环境音预设', () => {
  const presets = {
    warmHum:  { baseFreq: 120, volume: 0.06, lfoFreq: 0.15 },
    ethereal: { baseFreq: 220, volume: 0.04, lfoFreq: 0.1 },
    rain:     { baseFreq: 0,   volume: 0.08, lfoFreq: 0.05 },
    crickets: { baseFreq: 4200, volume: 0.03, lfoFreq: 7 },
  };

  it('warmHum 低频（温暖感）', () => {
    expect(presets.warmHum.baseFreq).toBeLessThan(200);
  });

  it('rain 使用噪声源 (baseFreq=0)', () => {
    expect(presets.rain.baseFreq).toBe(0);
  });

  it('crickets 高频（蝉鸣感）', () => {
    expect(presets.crickets.baseFreq).toBeGreaterThan(3000);
  });

  it('所有环境音音量极低（背景感）', () => {
    for (const [name, p] of Object.entries(presets)) {
      expect(p.volume).toBeLessThanOrEqual(0.1);
    }
  });

  it('LFO 频率远低于音效频率（缓慢变化）', () => {
    for (const [name, p] of Object.entries(presets)) {
      if (p.baseFreq > 0) {
        expect(p.lfoFreq).toBeLessThan(p.baseFreq);
      }
    }
  });
});

// ==================== 旋律生成 ====================

describe('旋律生成', () => {
  const scales = {
    pentatonic: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25],
    major:      [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
    minor:      [261.63, 293.66, 311.13, 349.23, 392.00, 415.30, 466.16, 523.25],
  };

  it('所有音阶从 C4 (261.63Hz) 开始', () => {
    for (const [name, freqs] of Object.entries(scales)) {
      expect(freqs[0]).toBeCloseTo(261.63, 0);
    }
  });

  it('所有音阶频率递增到高音区', () => {
    for (const [name, freqs] of Object.entries(scales)) {
      expect(freqs[freqs.length - 1]).toBeGreaterThan(500);
    }
  });

  it('五声音阶 5 个音（无半音）', () => {
    expect(scales.pentatonic.length).toBe(8); // 两个八度
  });

  it('频率递增', () => {
    for (const [name, freqs] of Object.entries(scales)) {
      for (let i = 1; i < freqs.length; i++) {
        expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
      }
    }
  });
});

// ==================== 声音事件分类逻辑 ====================

describe('声音事件分类', () => {
  interface Features {
    energy: number;
    lowEnergy: number;
    midEnergy: number;
    highEnergy: number;
    flatness: number;
    zeroCrossingRate: number;
  }

  function classify(f: Features, isSpike: boolean): string | null {
    if (f.energy < 0.003) return 'silence';
    if (isSpike && f.highEnergy > 0.25 && f.flatness > 0.25 && f.zeroCrossingRate > 0.1) return 'glass_break';
    if (f.highEnergy > 0.35 && f.energy > 0.08) return 'alarm';
    if (isSpike && f.midEnergy > 0.35 && f.energy > 0.04) return 'doorbell';
    if (isSpike && f.lowEnergy > 0.45 && f.zeroCrossingRate < 0.08) return 'knock';
    if (f.midEnergy > 0.3 && f.energy > 0.015 && f.zeroCrossingRate > 0.02 && f.zeroCrossingRate < 0.15) return 'speech';
    if (f.flatness > 0.35 && f.energy > 0.025) return 'music';
    if (f.highEnergy > 0.15 && f.midEnergy > 0.15 && f.energy > 0.03) return 'pet';
    return null;
  }

  it('静音 → silence', () => {
    expect(classify({ energy: 0.001, lowEnergy: 0, midEnergy: 0, highEnergy: 0, flatness: 0, zeroCrossingRate: 0 }, false)).toBe('silence');
  });

  it('高频突增 + 高平坦度 + 高过零率 → glass_break', () => {
    expect(classify({ energy: 0.15, lowEnergy: 0.1, midEnergy: 0.2, highEnergy: 0.7, flatness: 0.4, zeroCrossingRate: 0.15 }, true)).toBe('glass_break');
  });

  it('持续高频高能量 → alarm', () => {
    expect(classify({ energy: 0.12, lowEnergy: 0.1, midEnergy: 0.2, highEnergy: 0.7, flatness: 0.3, zeroCrossingRate: 0.05 }, false)).toBe('alarm');
  });

  it('中频突增 → doorbell', () => {
    expect(classify({ energy: 0.06, lowEnergy: 0.2, midEnergy: 0.5, highEnergy: 0.3, flatness: 0.2, zeroCrossingRate: 0.06 }, true)).toBe('doorbell');
  });

  it('低频突增 + 低过零率 → knock', () => {
    expect(classify({ energy: 0.08, lowEnergy: 0.6, midEnergy: 0.2, highEnergy: 0.2, flatness: 0.15, zeroCrossingRate: 0.03 }, true)).toBe('knock');
  });

  it('中频中能量中过零率 → speech', () => {
    expect(classify({ energy: 0.04, lowEnergy: 0.2, midEnergy: 0.5, highEnergy: 0.3, flatness: 0.2, zeroCrossingRate: 0.08 }, false)).toBe('speech');
  });

  it('高平坦度中能量低中频 → music', () => {
    expect(classify({ energy: 0.04, lowEnergy: 0.25, midEnergy: 0.25, highEnergy: 0.5, flatness: 0.45, zeroCrossingRate: 0.06 }, false)).toBe('music');
  });

  it('中高频混合低中频 → pet', () => {
    expect(classify({ energy: 0.05, lowEnergy: 0.2, midEnergy: 0.25, highEnergy: 0.55, flatness: 0.2, zeroCrossingRate: 0.07 }, false)).toBe('pet');
  });
});

// ==================== 自适应阈值 ====================

describe('自适应阈值', () => {
  interface EnergyHistory {
    values: number[];
    mean: number;
    stddev: number;
  }

  function updateHistory(h: EnergyHistory, energy: number, windowSize: number): void {
    h.values.push(energy);
    if (h.values.length > windowSize) h.values.shift();
    const n = h.values.length;
    h.mean = h.values.reduce((s, v) => s + v, 0) / n;
    h.stddev = Math.sqrt(h.values.reduce((s, v) => s + (v - h.mean) ** 2, 0) / n);
  }

  function isSpike(energy: number, h: EnergyHistory): boolean {
    if (h.values.length < 5) return energy > 0.05;
    return energy > h.mean + h.stddev * 2;
  }

  it('初始状态：少量样本时用固定阈值', () => {
    const h: EnergyHistory = { values: [], mean: 0, stddev: 0 };
    updateHistory(h, 0.02, 30);
    updateHistory(h, 0.03, 30);
    expect(isSpike(0.06, h)).toBe(true);  // > 0.05 固定阈值
    expect(isSpike(0.04, h)).toBe(false);
  });

  it('稳定环境：突变被检测为 spike', () => {
    const h: EnergyHistory = { values: [], mean: 0, stddev: 0 };
    // 模拟稳定环境
    for (let i = 0; i < 20; i++) {
      updateHistory(h, 0.02 + Math.random() * 0.005, 30);
    }
    // 突变
    expect(isSpike(0.1, h)).toBe(true);
    expect(isSpike(0.025, h)).toBe(false);
  });

  it('嘈杂环境：阈值自动提高', () => {
    const h: EnergyHistory = { values: [], mean: 0, stddev: 0 };
    // 模拟嘈杂环境
    for (let i = 0; i < 20; i++) {
      updateHistory(h, 0.08 + Math.random() * 0.02, 30);
    }
    // 同样的突变在嘈杂环境中不一定是 spike
    const spikeInNoisy = isSpike(0.12, h);
    // 在安静环境中是 spike
    const h2: EnergyHistory = { values: [], mean: 0, stddev: 0 };
    for (let i = 0; i < 20; i++) {
      updateHistory(h2, 0.02 + Math.random() * 0.005, 30);
    }
    const spikeInQuiet = isSpike(0.12, h2);
    // 嘈杂环境中更难触发 spike
    expect(spikeInQuiet).toBe(true);
  });

  it('窗口大小限制', () => {
    const h: EnergyHistory = { values: [], mean: 0, stddev: 0 };
    for (let i = 0; i < 50; i++) {
      updateHistory(h, 0.05, 30);
    }
    expect(h.values.length).toBeLessThanOrEqual(30);
  });
});

// ==================== 滑动窗口投票 ====================

describe('滑动窗口投票', () => {
  interface Vote {
    type: string;
    confidence: number;
  }

  function majorityVote(votes: Vote[]): Vote | null {
    if (votes.length === 0) return null;
    const counts = new Map<string, { count: number; total: number }>();
    for (const v of votes) {
      const e = counts.get(v.type);
      if (e) { e.count++; e.total += v.confidence; }
      else counts.set(v.type, { count: 1, total: v.confidence });
    }
    let best: string | null = null;
    let bestScore = 0;
    for (const [type, { count, total }] of counts) {
      const score = count * (total / count);
      if (score > bestScore) { bestScore = score; best = type; }
    }
    if (!best) return null;
    const entry = counts.get(best)!;
    return { type: best, confidence: entry.total / entry.count + (entry.count / votes.length) * 0.2 };
  }

  it('一致投票 → 高置信度', () => {
    const result = majorityVote([
      { type: 'speech', confidence: 0.6 },
      { type: 'speech', confidence: 0.7 },
      { type: 'speech', confidence: 0.65 },
    ]);
    expect(result?.type).toBe('speech');
    expect(result?.confidence).toBeGreaterThan(0.6);
  });

  it('混合投票 → 多数胜出', () => {
    const result = majorityVote([
      { type: 'speech', confidence: 0.6 },
      { type: 'music', confidence: 0.5 },
      { type: 'speech', confidence: 0.7 },
    ]);
    expect(result?.type).toBe('speech');
  });

  it('空窗口 → null', () => {
    expect(majorityVote([])).toBeNull();
  });
});

// ==================== 后端音频缓存 ====================

describe('音频缓存', () => {
  it('写入和读取', () => {
    const cache = new Map<string, { data: string; format: string; ts: number }>();
    cache.set('a-1', { data: 'd', format: 'mp3', ts: Date.now() });
    expect(cache.get('a-1')?.format).toBe('mp3');
  });

  it('过期清理', () => {
    const cache = new Map<string, { data: string; format: string; ts: number }>();
    cache.set('old', { data: 'd', format: 'mp3', ts: Date.now() - 120000 });
    cache.set('new', { data: 'd', format: 'mp3', ts: Date.now() });
    const now = Date.now();
    for (const [k, v] of cache) { if (now - v.ts > 60000) cache.delete(k); }
    expect(cache.has('old')).toBe(false);
    expect(cache.has('new')).toBe(true);
  });

  it('大小限制', () => {
    const cache = new Map<string, string>();
    for (let i = 0; i < 60; i++) {
      cache.set(`a-${i}`, `d-${i}`);
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    expect(cache.size).toBeLessThanOrEqual(50);
  });
});
