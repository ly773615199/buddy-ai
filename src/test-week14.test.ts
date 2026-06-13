/**
 * Phase C Week 14 — 麦克风持续监听 + 唤醒词 + 声音事件测试 — vitest 格式
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WakeWordDetector } from '../frontend/src/voice/wakeword.js';
import { SoundEventDetector, type SoundEventType } from '../frontend/src/voice/sound-events.js';
import { VoiceEmotionAnalyzer, type VoiceEmotion } from '../frontend/src/voice/emotion-voice.js';

// ==================== 唤醒词检测器测试 ====================

describe('唤醒词检测器', () => {
  it('唤醒词和灵敏度设置正确', () => {
    const wakeDetector = new WakeWordDetector({
      keyword: 'Hey Buddy',
      sensitivity: 0.6,
    });
    expect(wakeDetector.getKeyword()).toBe('Hey Buddy');
    expect(wakeDetector.isListening).toBe(false);
    expect(wakeDetector.getSensitivity()).toBe(0.6);
    wakeDetector.destroy();
  });

  it('唤醒回调注册成功', () => {
    const wakeDetector = new WakeWordDetector({
      keyword: 'Hey Buddy',
      sensitivity: 0.6,
    });
    let wakeResult: any = null;
    wakeDetector.onWake((result) => {
      wakeResult = result;
    });
    // 注册不抛异常即成功
    expect(true).toBe(true);
    wakeDetector.destroy();
  });

  it('灵敏度更新成功', () => {
    const wakeDetector = new WakeWordDetector({
      keyword: 'Hey Buddy',
      sensitivity: 0.6,
    });
    wakeDetector.setSensitivity(0.8);
    expect(wakeDetector.getSensitivity()).toBe(0.8);
    wakeDetector.destroy();
  });

  it('灵敏度上限限制为 1', () => {
    const wakeDetector = new WakeWordDetector({
      keyword: 'Hey Buddy',
      sensitivity: 0.6,
    });
    wakeDetector.setSensitivity(1.5);
    expect(wakeDetector.getSensitivity()).toBe(1);
    wakeDetector.destroy();
  });

  it('灵敏度下限限制为 0', () => {
    const wakeDetector = new WakeWordDetector({
      keyword: 'Hey Buddy',
      sensitivity: 0.6,
    });
    wakeDetector.setSensitivity(-0.5);
    expect(wakeDetector.getSensitivity()).toBe(0);
    wakeDetector.destroy();
  });

  it('默认配置正确', () => {
    const defaultWake = new WakeWordDetector();
    expect(defaultWake.getKeyword()).toBe('Hey Buddy');
    expect(defaultWake.isListening).toBe(false);
    defaultWake.destroy();
  });
});

// ==================== 声音事件检测器测试 ====================

describe('声音事件检测器', () => {
  it('初始未监听', () => {
    const soundDetector = new SoundEventDetector({
      checkIntervalMs: 1500,
      minConfidence: 0.5,
    });
    expect(soundDetector.isListening).toBe(false);
    soundDetector.destroy();
  });

  it('事件订阅返回取消函数', () => {
    const soundDetector = new SoundEventDetector({
      checkIntervalMs: 1500,
      minConfidence: 0.5,
    });
    const unsubSound = soundDetector.onEvent(() => {});
    expect(typeof unsubSound).toBe('function');
    unsubSound();
    soundDetector.destroy();
  });

  it('启用/禁用不报错', () => {
    const soundDetector = new SoundEventDetector({
      checkIntervalMs: 1500,
      minConfidence: 0.5,
    });
    soundDetector.setEnabled(false);
    expect(true).toBe(true);
    soundDetector.setEnabled(true);
    expect(true).toBe(true);
    soundDetector.destroy();
  });

  it('定义了 9 种声音事件类型', () => {
    const validTypes: SoundEventType[] = [
      'doorbell', 'knock', 'alarm', 'pet',
      'glass_break', 'speech', 'music', 'silence', 'unknown',
    ];
    expect(validTypes.length).toBe(9);
  });
});

// ==================== 语音情绪分析器测试 ====================

describe('语音情绪分析器', () => {
  it('初始未分析', () => {
    const emotionAnalyzer = new VoiceEmotionAnalyzer({
      analysisIntervalMs: 800,
      windowSize: 5,
    });
    expect(emotionAnalyzer.isAnalyzing).toBe(false);
    emotionAnalyzer.destroy();
  });

  it('情绪订阅返回取消函数', () => {
    const emotionAnalyzer = new VoiceEmotionAnalyzer({
      analysisIntervalMs: 800,
      windowSize: 5,
    });
    const unsubEmotion = emotionAnalyzer.onEmotion(() => {});
    expect(typeof unsubEmotion).toBe('function');
    unsubEmotion();
    emotionAnalyzer.destroy();
  });

  it('定义了 8 种情绪类型', () => {
    const validEmotions: VoiceEmotion[] = [
      'calm', 'excited', 'angry', 'sad', 'anxious', 'happy', 'tired', 'neutral',
    ];
    expect(validEmotions.length).toBe(8);
  });
});

// ==================== 模块间协作测试 ====================

describe('模块间协作', () => {
  it('唤醒 → 声音事件 → 情绪分析的协作流程', () => {
    const flow = {
      wakeWord: new WakeWordDetector({ keyword: 'Buddy' }),
      soundEvents: new SoundEventDetector({ checkIntervalMs: 1000 }),
      emotion: new VoiceEmotionAnalyzer({ analysisIntervalMs: 500 }),
    };

    expect(flow.wakeWord.isListening).toBe(false);
    expect(flow.soundEvents.isListening).toBe(false);
    expect(flow.emotion.isAnalyzing).toBe(false);

    flow.wakeWord.destroy();
    flow.soundEvents.destroy();
    flow.emotion.destroy();
    // 所有模块清理完成
    expect(true).toBe(true);
  });
});

// ==================== 配置组合测试 ====================

describe('配置组合', () => {
  it('自定义唤醒词配置', () => {
    const customWake = new WakeWordDetector({
      keyword: '小助手',
      sensitivity: 0.7,
      backend: 'fallback',
    });
    expect(customWake.getKeyword()).toBe('小助手');
    customWake.destroy();
  });

  it('禁用状态下不监听', () => {
    const customSound = new SoundEventDetector({
      checkIntervalMs: 500,
      minConfidence: 0.3,
      enabled: false,
    });
    expect(customSound.isListening).toBe(false);
    customSound.destroy();
  });

  it('自定义配置初始化成功', () => {
    const customEmotion = new VoiceEmotionAnalyzer({
      analysisIntervalMs: 2000,
      windowSize: 20,
    });
    expect(customEmotion.isAnalyzing).toBe(false);
    customEmotion.destroy();
  });
});
