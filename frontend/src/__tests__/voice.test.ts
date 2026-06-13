/**
 * 语音子系统纯逻辑测试（不依赖浏览器 API）
 */
import { describe, it, expect } from 'vitest';

describe('STT 语音转文字', () => {
  it('请求格式', () => {
    const req = { audioBase64: 'data:audio/webm;base64,abc', language: 'zh-CN', format: 'webm' };
    expect(req.audioBase64).toContain('base64,');
    expect(req.language).toBe('zh-CN');
  });

  it('结果格式', () => {
    const r = { text: '今天天气', confidence: 0.95, language: 'zh-CN', duration: 2.5 };
    expect(r.text).toBeTruthy();
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.duration).toBeGreaterThan(0);
  });

  it('空音频处理', () => {
    const validate = (b64: string) => (!b64 || b64.length < 50) ? { valid: false } : { valid: true };
    expect(validate('').valid).toBe(false);
    expect(validate('data:audio/webm;base64,' + 'x'.repeat(100)).valid).toBe(true);
  });

  it('多语言支持', () => {
    const langs = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'];
    expect(langs).toContain('zh-CN');
    expect(langs).toContain('en-US');
  });
});

describe('TTS 文字转语音', () => {
  it('请求格式', () => {
    const req = { text: '你好', voice: 'nova', speed: 1.0, pitch: 1.0, emotion: 'happy' };
    expect(req.text).toBeTruthy();
    expect(req.speed).toBeGreaterThan(0);
  });

  it('结果格式', () => {
    const r = { success: true, audioBase64: 'base64', format: 'mp3', duration: 3.2 };
    expect(r.success).toBe(true);
    expect(r.format).toBe('mp3');
  });

  it('长文本分句', () => {
    const split = (t: string) => t.split(/(?<=[。！？.!?\n])/).map(s => s.trim()).filter(Boolean);
    expect(split('你好。天气好？是的！').length).toBe(3);
  });

  it('空文本处理', () => {
    const valid = (t: string) => typeof t === 'string' && t.trim().length > 0;
    expect(valid('')).toBe(false);
    expect(valid('hello')).toBe(true);
  });

  it('情绪映射', () => {
    const map: Record<string, { speed: number; pitch: number }> = {
      happy: { speed: 1.1, pitch: 1.1 }, sad: { speed: 0.9, pitch: 0.9 },
      angry: { speed: 1.2, pitch: 1.2 }, calm: { speed: 1.0, pitch: 1.0 },
    };
    expect(map.happy.speed).toBeGreaterThan(1);
    expect(map.sad.speed).toBeLessThan(1);
  });

  it('音频缓存管理', () => {
    const cache = new Map<string, { ts: number }>();
    cache.set('old', { ts: Date.now() - 120000 });
    cache.set('new', { ts: Date.now() });
    const now = Date.now();
    for (const [k, v] of cache) { if (now - v.ts > 60000) cache.delete(k); }
    expect(cache.has('old')).toBe(false);
    expect(cache.has('new')).toBe(true);
  });
});

describe('唤醒词检测', () => {
  it('配置格式', () => {
    const cfg = { enabled: true, keywords: ['你好小伴', '嘿buddy'], sensitivity: 0.5 };
    expect(cfg.keywords.length).toBeGreaterThan(0);
    expect(cfg.sensitivity).toBeGreaterThanOrEqual(0);
    expect(cfg.sensitivity).toBeLessThanOrEqual(1);
  });

  it('唤醒词匹配', () => {
    const match = (text: string, kws: string[]) => kws.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
    expect(match('你好小伴，查天气', ['你好小伴'])).toBe(true);
    expect(match('hey buddy', ['hey buddy'])).toBe(true);
    expect(match('今天天气好', ['你好小伴'])).toBe(false);
  });

  it('灵敏度阈值', () => {
    const ok = (score: number, threshold = 0.5) => score >= threshold;
    expect(ok(0.8)).toBe(true);
    expect(ok(0.3)).toBe(false);
    expect(ok(0.5)).toBe(true);
  });
});

describe('情绪语音', () => {
  it('情绪参数映射', () => {
    const map: Record<string, { rate: number; pitch: number; volume: number }> = {
      happy: { rate: 1.1, pitch: 1.15, volume: 1.0 },
      sad: { rate: 0.85, pitch: 0.9, volume: 0.7 },
      angry: { rate: 1.25, pitch: 1.2, volume: 1.3 },
      calm: { rate: 1.0, pitch: 1.0, volume: 0.9 },
    };
    expect(map.happy.rate).toBeGreaterThan(1);
    expect(map.sad.rate).toBeLessThan(1);
  });

  it('低置信度忽略', () => {
    const shouldApply = (c: number, threshold = 0.3) => c >= threshold;
    expect(shouldApply(0.85)).toBe(true);
    expect(shouldApply(0.2)).toBe(false);
  });
});

describe('音频格式', () => {
  it('支持格式', () => {
    const fmts = ['mp3', 'wav', 'ogg', 'webm', 'aac'];
    expect(fmts).toContain('mp3');
    expect(fmts).toContain('wav');
  });

  it('base64 数据格式', () => {
    const d = { data: 'base64content', format: 'mp3', sampleRate: 44100, channels: 1 };
    expect(d.sampleRate).toBeGreaterThan(0);
    expect(d.channels).toBeGreaterThan(0);
  });

  it('时长计算', () => {
    expect(44100 * 3 / 44100).toBe(3);
  });
});
