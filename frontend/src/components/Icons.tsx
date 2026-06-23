/**
 * 光灵自绘 SVG 图标系统
 *
 * 设计语言：线条 + 光点 + 断口
 * 画布 24×24，stroke-width 1.5，圆角端点
 * 所有图标共享"光点"元素——光灵的化身
 */

import { type CSSProperties } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  active?: boolean;
  style?: CSSProperties;
  className?: string;
}

const baseStyle: CSSProperties = {
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0,
};

// ==================== Tab 图标 ====================

/** 💬 聊天 — 气泡 + 三点光 */
export function IconChat({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-4 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <circle cx="9" cy="10" r="1.2" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.7} />
      <circle cx="12" cy="10" r="1.2" fill={active ? color : 'currentColor'} opacity={active ? 0.8 : 0.5} />
      <circle cx="15" cy="10" r="1.2" fill={active ? color : 'currentColor'} opacity={active ? 0.6 : 0.3} />
    </svg>
  );
}

/** 🔧 工具 — 齿轮 + 中心光点 */
export function IconTools({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
    </svg>
  );
}

/** 🧠 记忆 — 神经节点网络 */
export function IconMemory({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 连接线 */}
      <path d="M8 8c2 0 4 2 4 4" />
      <path d="M16 8c-2 0-4 2-4 4" />
      <path d="M8 16c2 0 4-2 4-4" />
      <path d="M16 16c-2 0-4-2-4-4" />
      <path d="M8 8h8" />
      <path d="M8 16h8" />
      {/* 节点光点 */}
      <circle cx="8" cy="8" r="2" fill={active ? color : 'currentColor'} opacity={active ? 0.9 : 0.6} />
      <circle cx="16" cy="8" r="2" fill={active ? color : 'currentColor'} opacity={active ? 0.7 : 0.4} />
      <circle cx="12" cy="12" r="2.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.7} />
      <circle cx="8" cy="16" r="2" fill={active ? color : 'currentColor'} opacity={active ? 0.7 : 0.4} />
      <circle cx="16" cy="16" r="2" fill={active ? color : 'currentColor'} opacity={active ? 0.9 : 0.6} />
    </svg>
  );
}

/** 📚 知识 — 翻开的书 + 光线 */
export function IconKnowledge({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 书本 */}
      <path d="M2 4h6c1.1 0 2 .9 2 2v14c-.6-.5-1.2-.8-2-1H2V4z" />
      <path d="M22 4h-6c-1.1 0-2 .9-2 2v14c.6-.5 1.2-.8 2-1h6V4z" />
      {/* 光线 */}
      <line x1="9" y1="2" x2="9" y2="5" opacity={active ? 1 : 0.5} />
      <line x1="12" y1="1" x2="12" y2="5" opacity={active ? 0.8 : 0.4} />
      <line x1="15" y1="2" x2="15" y2="5" opacity={active ? 0.6 : 0.3} />
      {/* 光点 */}
      <circle cx="12" cy="1" r="1" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.4} />
    </svg>
  );
}

/** 📊 活动 — 脉搏线 */
export function IconActivity({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <path d="M3 12h4l2-4 3 8 2-4h7" />
      {/* 波峰光点 */}
      <circle cx="9" cy="8" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
      <circle cx="14" cy="12" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 0.8 : 0.4} />
    </svg>
  );
}

/** 🗺️ 探索 — 指南针 + 发散线 */
export function IconExplore({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <circle cx="12" cy="12" r="8" />
      {/* 指南针 */}
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      {/* 发散光点 */}
      <circle cx="12" cy="3" r="1" fill={active ? color : 'currentColor'} opacity={active ? 0.8 : 0.3} />
      <circle cx="21" cy="12" r="1" fill={active ? color : 'currentColor'} opacity={active ? 0.6 : 0.2} />
      <circle cx="12" cy="21" r="1" fill={active ? color : 'currentColor'} opacity={active ? 0.4 : 0.2} />
      <circle cx="3" cy="12" r="1" fill={active ? color : 'currentColor'} opacity={active ? 0.6 : 0.2} />
    </svg>
  );
}

/** 👁️ 视觉 — 眼睛 + 光瞳 */
export function IconVision({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 眼睛轮廓 */}
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      {/* 瞳孔 */}
      <circle cx="12" cy="12" r="3" />
      {/* 光瞳 */}
      <circle cx="12" cy="12" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
    </svg>
  );
}

/** 📡 传感 — 信号波 */
export function IconSensors({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 信号弧 */}
      <path d="M6.3 6.3a9 9 0 0 1 11.4 0" opacity={active ? 0.4 : 0.25} />
      <path d="M8.5 8.5a5 5 0 0 1 7 0" opacity={active ? 0.6 : 0.4} />
      <path d="M10.7 10.7a2 2 0 0 1 2.6 0" opacity={active ? 0.8 : 0.55} />
      {/* 中心光点 */}
      <circle cx="12" cy="14" r="2" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.7} />
    </svg>
  );
}

/** 🎓 专家 — 星形 + 光芒 */
export function IconExperts({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 星形 */}
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      {/* 中心光点 */}
      <circle cx="12" cy="11" r="2" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
    </svg>
  );
}

/** 🧩 认知 — 拼图 + 连接光点 */
export function IconCognitive({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 左半 */}
      <path d="M4 4h7v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V4h5v7h-3a2 2 0 0 0-2 2h0a2 2 0 0 0 2 2h3v5H4v-5h3a2 2 0 0 0 2-2h0a2 2 0 0 0-2-2H4V4z" />
      {/* 连接光点 */}
      <circle cx="11" cy="9" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
      <circle cx="15" cy="13" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 0.8 : 0.4} />
    </svg>
  );
}

/** 📊 资源 — 圆环图 */
export function IconResources({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 圆环 */}
      <circle cx="12" cy="12" r="9" />
      {/* 扇区分隔线 */}
      <line x1="12" y1="3" x2="12" y2="12" />
      <line x1="12" y1="12" x2="18.4" y2="8" />
      <line x1="12" y1="12" x2="7.5" y2="18.2" />
      {/* 光点 */}
      <circle cx="12" cy="3" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.6} />
      <circle cx="18.4" cy="8" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 0.8 : 0.4} />
      <circle cx="7.5" cy="18.2" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 0.6 : 0.3} />
    </svg>
  );
}

/** ⚙️ 设置 — 齿轮嵌套 + 中心光点 */
export function IconSettings({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      {/* 外齿轮 */}
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2m0 18v2m-9-11h2m18 0h2m-4.2-6.8-1.4 1.4M5.6 18.4l-1.4 1.4m0-13.6 1.4 1.4m12.8 12.8 1.4 1.4" />
      {/* 中心光点 */}
      <circle cx="12" cy="12" r="1.5" fill={active ? color : 'currentColor'} opacity={active ? 1 : 0.5} />
    </svg>
  );
}

// ==================== 功能图标 ====================

/** 🏠 Logo — 光团 */
export function IconLogo({ size = 24, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" style={{ ...baseStyle, ...style }} className={className}
    >
      <defs>
        <radialGradient id="logoGlow" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="60%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* 光晕 */}
      <circle cx="12" cy="11" r="10" fill="url(#logoGlow)" opacity="0.15" />
      {/* 核心光团 */}
      <circle cx="12" cy="11" r="6" fill={color} opacity="0.2" />
      <circle cx="12" cy="11" r="3.5" fill={color} opacity="0.5" />
      <circle cx="12" cy="11" r="1.5" fill={color} opacity="0.9" />
      {/* 底座弧线 */}
      <path d="M7 19c0-3 2.5-5 5-5s5 2 5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

/** 🎤 麦克风 */
export function IconMic({ size = 20, color = 'currentColor', active, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
      {active && <circle cx="12" cy="8" r="1.5" fill={color} opacity="0.8" />}
    </svg>
  );
}

/** 🔍 搜索 */
export function IconSearch({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
      <circle cx="11" cy="11" r="2" fill={color} opacity="0.3" />
    </svg>
  );
}

/** ✈️ 发送 */
export function IconSend({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

/** 📋 复制 */
export function IconCopy({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** 🔄 重试 */
export function IconRetry({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <path d="M1 4v6h6" />
      <path d="M3.5 15a9 9 0 1 0 2.1-9.3L1 10" />
    </svg>
  );
}

/** 🗑️ 删除 */
export function IconDelete({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** ❌ 关闭 */
export function IconClose({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** ✓ 勾选 */
export function IconCheck({ size = 20, color = 'currentColor', style, className }: Omit<IconProps, 'active'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ ...baseStyle, ...style }}
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ==================== Tab 图标映射 ====================

export const TAB_ICONS: Record<string, React.FC<IconProps>> = {
  chat: IconChat,
  tools: IconTools,
  memory: IconMemory,
  knowledge: IconKnowledge,
  activity: IconActivity,
  stats: IconExplore,
  vision: IconVision,
  sensors: IconSensors,
  experts: IconExperts,
  cognitive: IconCognitive,
  resources: IconResources,
  settings: IconSettings,
};
