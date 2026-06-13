/**
 * 感知能力首次告知组件
 *
 * Buddy 引导式通知（不是弹窗）：
 * - 像 Buddy 在说话
 * - 友好、简洁、不强迫
 * - 用户可以选择同意、拒绝、或稍后
 */

import type { SensorType } from '../hooks/useFirstTimeConsent.js';
import { SENSOR_NOTIFICATIONS } from '../hooks/useFirstTimeConsent.js';

interface SensorConsentNotificationProps {
  sensor: SensorType;
  primaryColor?: string;
  onGrant: () => void;
  onDismiss: () => void;
}

export default function SensorConsentNotification({
  sensor,
  primaryColor = '#58a6ff',
  onGrant,
  onDismiss,
}: SensorConsentNotificationProps) {
  const info = SENSOR_NOTIFICATIONS[sensor];

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 10,
      background: 'linear-gradient(135deg, #161b22 0%, #1a2235 100%)',
      border: `1px solid ${primaryColor}33`,
      fontSize: 13,
      lineHeight: 1.6,
      animation: 'fadeIn 0.3s ease',
    }}>
      {/* Buddy 头像 + 话术 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>✨</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#e2e8f0', marginBottom: 4 }}>
            {info.buddySays}
          </div>
          <div style={{ color: '#8b949e', fontSize: 11 }}>
            {info.icon} {info.title} · 仅在本地处理 · 随时可关闭
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginTop: 10,
        justifyContent: 'flex-end',
      }}>
        <button
          onClick={onDismiss}
          style={{
            padding: '5px 14px',
            borderRadius: 6,
            border: '1px solid #30363d',
            background: 'transparent',
            color: '#8b949e',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          稍后
        </button>
        <button
          onClick={onGrant}
          style={{
            padding: '5px 14px',
            borderRadius: 6,
            border: 'none',
            background: primaryColor,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          好的，开启
        </button>
      </div>
    </div>
  );
}
