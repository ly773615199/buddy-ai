/**
 * useVoiceEmotion — 用户语音情绪检测 Hook
 *
 * 将 VoiceEmotionAnalyzer 接入 React 生命周期：
 * - 开始分析：获取麦克风 → 频谱分析 → 情绪分类
 * - 结果通过回调发送到后端（WS emotion_source 事件）
 * - 组件卸载时自动清理
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { VoiceEmotionAnalyzer, type VoiceEmotionResult, type VoiceEmotion } from '../voice/emotion-voice.js';

export interface UseVoiceEmotionOptions {
  /** 分析间隔（ms），默认 2000 */
  analysisIntervalMs?: number;
  /** 情绪变化回调（用于发送到后端） */
  onEmotion?: (result: VoiceEmotionResult) => void;
  /** 是否自动开始 */
  autoStart?: boolean;
}

export interface UseVoiceEmotionReturn {
  /** 是否正在分析 */
  isAnalyzing: boolean;
  /** 最近一次情绪结果 */
  lastResult: VoiceEmotionResult | null;
  /** 当前情绪标签 */
  currentEmotion: VoiceEmotion | 'none';
  /** 开始分析 */
  start: () => Promise<void>;
  /** 停止分析 */
  stop: () => void;
  /** 切换 */
  toggle: () => Promise<void>;
  /** 错误信息 */
  error: string | null;
}

export function useVoiceEmotion(options: UseVoiceEmotionOptions = {}): UseVoiceEmotionReturn {
  const { analysisIntervalMs = 2000, onEmotion, autoStart = false } = options;

  const analyzerRef = useRef<VoiceEmotionAnalyzer | null>(null);
  const onEmotionRef = useRef(onEmotion);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceEmotionResult | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<VoiceEmotion | 'none'>('none');
  const [error, setError] = useState<string | null>(null);

  // 回调透传
  useEffect(() => { onEmotionRef.current = onEmotion; }, [onEmotion]);

  const start = useCallback(async () => {
    if (analyzerRef.current?.isAnalyzing) return;

    try {
      setError(null);
      const analyzer = new VoiceEmotionAnalyzer({ analysisIntervalMs });
      analyzer.onEmotion((result) => {
        setLastResult(result);
        setCurrentEmotion(result.emotion);
        onEmotionRef.current?.(result);
      });

      await analyzer.start();
      analyzerRef.current = analyzer;
      setIsAnalyzing(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '麦克风访问失败';
      setError(msg);
      setIsAnalyzing(false);
    }
  }, [analysisIntervalMs]);

  const stop = useCallback(() => {
    if (analyzerRef.current) {
      analyzerRef.current.stop();
      analyzerRef.current.destroy();
      analyzerRef.current = null;
    }
    setIsAnalyzing(false);
    setCurrentEmotion('none');
  }, []);

  const toggle = useCallback(async () => {
    if (isAnalyzing) {
      stop();
    } else {
      await start();
    }
  }, [isAnalyzing, start, stop]);

  // 清理
  useEffect(() => {
    return () => {
      if (analyzerRef.current) {
        analyzerRef.current.stop();
        analyzerRef.current.destroy();
        analyzerRef.current = null;
      }
    };
  }, []);

  // 自动开始
  useEffect(() => {
    if (autoStart && !isAnalyzing && !analyzerRef.current) {
      start();
    }
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isAnalyzing,
    lastResult,
    currentEmotion,
    start,
    stop,
    toggle,
    error,
  };
}
