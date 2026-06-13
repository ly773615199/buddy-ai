/**
 * 音频 React Hook — 在组件中使用音频系统
 */

import { useCallback, useEffect, useState } from 'react';
import { getAudioEngine, type VolumeState } from './engine.js';
import { playSFX, playMoodSFX, playEventSFX, UI_SFX, SPRITE_SFX } from './sfx-player.js';

/**
 * 音频控制 Hook
 * 返回音效播放函数 + 音量控制 + 状态
 */
export function useAudio() {
  const engine = getAudioEngine();
  const [volume, setVolumeState] = useState<VolumeState>(engine.getVolume());
  const [initialized, setInitialized] = useState(engine.isInitialized());

  // 首次交互时初始化 AudioContext
  const initAudio = useCallback(async () => {
    await engine.ensureContext();
    setInitialized(true);
  }, []);

  // 监听全局点击，自动初始化
  useEffect(() => {
    if (initialized) return;

    const handler = async () => {
      await initAudio();
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };

    document.addEventListener('click', handler, { once: true });
    document.addEventListener('keydown', handler, { once: true });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [initialized, initAudio]);

  // 音效播放
  const playClick = useCallback(() => playSFX(UI_SFX.click, 'ui-click'), []);
  const playSend = useCallback(() => playSFX(UI_SFX.send, 'ui-send'), []);
  const playReceive = useCallback(() => playSFX(UI_SFX.receive, 'ui-receive'), []);
  const playTabSwitch = useCallback(() => playSFX(UI_SFX.tabSwitch, 'ui-tab'), []);
  const playSuccess = useCallback(() => playSFX(UI_SFX.success, 'ui-success'), []);
  const playError = useCallback(() => playSFX(UI_SFX.error, 'ui-error'), []);
  const playTyping = useCallback(() => playSFX(UI_SFX.typing, 'ui-typing'), []);

  // 光灵状态音效
  const playBreathe = useCallback(() => playSFX(SPRITE_SFX.breathe, 'sprite-breathe'), []);
  const playWake = useCallback(() => playSFX(SPRITE_SFX.wake, 'sprite-wake'), []);
  const playSleep = useCallback(() => playSFX(SPRITE_SFX.sleep, 'sprite-sleep'), []);

  // 情绪音效
  const playMood = useCallback((mood: string) => playMoodSFX(mood), []);

  // 事件音效
  const playEvent = useCallback((event: string) => playEventSFX(event), []);

  // 通用播放
  const play = useCallback((name: string) => playSFX(name, name), []);

  // 音量控制
  const setMasterVolume = useCallback((value: number) => {
    engine.setMasterVolume(value);
    setVolumeState(engine.getVolume());
    engine.saveVolume();
  }, []);

  const setCategoryVolume = useCallback((category: 'sfx' | 'ambient' | 'voice' | 'music', value: number) => {
    engine.setCategoryVolume(category, value);
    setVolumeState(engine.getVolume());
    engine.saveVolume();
  }, []);

  const toggleMute = useCallback(() => {
    const muted = engine.toggleMute();
    setVolumeState(engine.getVolume());
    engine.saveVolume();
    return muted;
  }, []);

  return {
    // 状态
    initialized,
    volume,
    // UI 音效
    playClick,
    playSend,
    playReceive,
    playTabSwitch,
    playSuccess,
    playError,
    playTyping,
    // 光灵音效
    playBreathe,
    playWake,
    playSleep,
    // 情绪/事件
    playMood,
    playEvent,
    play,
    // 音量
    setMasterVolume,
    setCategoryVolume,
    toggleMute,
  };
}
