/**
 * 首次感知能力告知 hook
 *
 * 设计原则（来自 INTIMACY_SYSTEM_DESIGN.md）：
 * - 不是弹窗，是 Buddy 引导式告知
 * - 用户同意后记住，不再重复
 * - 可在设置中随时撤回
 */

import { useState, useCallback, useEffect } from 'react';

export type SensorType = 'camera' | 'microphone' | 'location';

export interface SensorConsent {
  granted: boolean;
  grantedAt?: number;
  revokedAt?: number;
}

export interface FirstTimeConsentResult {
  /** 是否已授权 */
  hasConsent: boolean;
  /** 是否需要告知（首次使用） */
  needsNotification: boolean;
  /** 授予同意 */
  grant: () => void;
  /** 撤回同意 */
  revoke: () => void;
  /** 关闭通知（不授权也不拒绝，下次还会提示） */
  dismiss: () => void;
  /** 是否显示通知 */
  showNotification: boolean;
  /** 关闭通知 */
  closeNotification: () => void;
}

const STORAGE_KEY = 'buddy_sensor_consent';

/** 读取所有传感器同意状态 */
function loadConsentState(): Record<SensorType, SensorConsent> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    camera: { granted: false },
    microphone: { granted: false },
    location: { granted: false },
  };
}

/** 保存传感器同意状态 */
function saveConsentState(state: Record<SensorType, SensorConsent>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/**
 * 首次感知能力告知 hook
 */
export function useFirstTimeConsent(sensor: SensorType): FirstTimeConsentResult {
  const [consentState, setConsentState] = useState(loadConsentState);
  const [showNotification, setShowNotification] = useState(false);

  const consent = consentState[sensor];
  const hasConsent = consent.granted && !consent.revokedAt;
  const needsNotification = !consent.granted && !consent.revokedAt;

  // 检查是否需要显示通知
  const checkAndNotify = useCallback(() => {
    if (needsNotification) {
      setShowNotification(true);
    }
  }, [needsNotification]);

  const grant = useCallback(() => {
    const newState = { ...consentState };
    newState[sensor] = { granted: true, grantedAt: Date.now() };
    saveConsentState(newState);
    setConsentState(newState);
    setShowNotification(false);
  }, [consentState, sensor]);

  const revoke = useCallback(() => {
    const newState = { ...consentState };
    newState[sensor] = { granted: false, revokedAt: Date.now() };
    saveConsentState(newState);
    setConsentState(newState);
  }, [consentState, sensor]);

  const dismiss = useCallback(() => {
    setShowNotification(false);
  }, []);

  const closeNotification = useCallback(() => {
    setShowNotification(false);
  }, []);

  return {
    hasConsent,
    needsNotification,
    grant,
    revoke,
    dismiss,
    showNotification,
    closeNotification,
  };
}

/**
 * 获取所有传感器的同意状态（用于设置页面）
 */
export function getAllSensorConsent(): Record<SensorType, SensorConsent> {
  return loadConsentState();
}

/**
 * 撤回指定传感器的同意
 */
export function revokeSensorConsent(sensor: SensorType): void {
  const state = loadConsentState();
  state[sensor] = { granted: false, revokedAt: Date.now() };
  saveConsentState(state);
}

/**
 * Buddy 引导式告知话术
 */
export const SENSOR_NOTIFICATIONS: Record<SensorType, {
  title: string;
  message: string;
  buddySays: string;
  icon: string;
}> = {
  camera: {
    title: '摄像头权限',
    message: 'Buddy 想通过摄像头看看你周围的世界。',
    buddySays: '我想看看你那边！画面只在内存中处理，不会存储。你随时可以关掉。',
    icon: '📷',
  },
  microphone: {
    title: '麦克风权限',
    message: 'Buddy 想通过麦克风听到你的声音。',
    buddySays: '想试试和我语音对话吗？音频只在识别时使用，不会录音。',
    icon: '🎤',
  },
  location: {
    title: '位置权限',
    message: 'Buddy 想知道你在哪，提供更相关的帮助。',
    buddySays: '你在哪？我可以给你更本地化的建议。位置数据只存在你设备上。',
    icon: '📍',
  },
};
