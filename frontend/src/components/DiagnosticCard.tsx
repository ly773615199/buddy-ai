// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useCallback } from 'react';
import type { DiagnosticReport } from '../types/buddy';


interface DiagnosticCardProps {
  diagnostic: DiagnosticReport;
  onAction?: (action: string) => void;
}

const moodEmoji: Record<DiagnosticReport['mood'], string> = {
  frustrated: '😤',
  confused: '😕',
  tired: '😫'
};

const moodLabel: Record<DiagnosticReport['mood'], string> = {
  frustrated: '有点沮丧',
  confused: '有点困惑',
  tired: '有点累了'
};

const priorityBadge: Record<string, {bg: string;text: string;}> = {
  high: { bg: '#fee2e2', text: '#dc2626' },
  medium: { bg: '#fef3c7', text: '#d97706' },
  low: { bg: '#e0e7ff', text: '#4f46e5' }
};

const actionIcon: Record<string, string> = {
  add_provider: '➕',
  update_key: '🔑',
  reduce_tools: '🔧',
  switch_model: '🔄',
  retry: '🔁'
};

/**
 * 诊断卡片 — 结构化展示错误原因 + 可操作建议
 *
 * 替代 "出了点问题" 的 generic error bubble
 */
export function DiagnosticCard({
  diagnostic, onAction }: DiagnosticCardProps) {

  const [expanded, setExpanded] = useState(false);

  const handleAction = useCallback((action: string) => {
    onAction?.(action);
  }, [onAction]);

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)',
      border: '1px solid #fca5a5',
      borderRadius: 12,
      padding: 16,
      margin: '8px 0',
      maxWidth: 480,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header: mood + message */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>{moodEmoji[diagnostic.mood]}</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b' }}>
            {diagnostic.message}
          </div>
          <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>
            {moodLabel[diagnostic.mood]}
          </div>
        </div>
      </div>

      {/* Detail (collapsible) */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer',
          fontSize: 12,
          color: '#6b7280',
          padding: '6px 10px',
          background: '#f9fafb',
          borderRadius: 6,
          marginBottom: 12,
          userSelect: 'none'
        }}>
        
        {expanded ? '▼ ' : '▶ '}
        {"\u6280\u672F\u7EC6\u8282"}
        {expanded &&
        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11 }}>
            {diagnostic.detail}
            {diagnostic.attempted.length > 0 &&
          <div style={{ marginTop: 4 }}>{"已尝试: "}{diagnostic.attempted.join(', ')}</div>
          }
            {diagnostic.failedReasons.length > 0 &&
          <div style={{ marginTop: 4 }}>{"失败原因: "}{diagnostic.failedReasons.join(', ')}</div>
          }
          </div>
        }
      </div>

      {/* Suggestions */}
      {diagnostic.suggestions.length > 0 &&
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{"\u5EFA\u8BAE\u64CD\u4F5C\uFF1A"}</div>
          {diagnostic.suggestions.map((s, i) =>
        <button
          key={i}
          onClick={() => handleAction(s.action)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fff',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3b82f6';
            e.currentTarget.style.background = '#eff6ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e5e7eb';
            e.currentTarget.style.background = '#fff';
          }}>
          
              <span style={{ fontSize: 16 }}>{actionIcon[s.action] ?? '⚡'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {s.description}
                </div>
              </div>
              <span style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: priorityBadge[s.priority]?.bg ?? '#f3f4f6',
            color: priorityBadge[s.priority]?.text ?? '#6b7280',
            fontWeight: 600
          }}>
                {s.priority === 'high' ? "\u9AD8" : s.priority === 'medium' ? "\u4E2D" : "\u4F4E"}
              </span>
            </button>
        )}
        </div>
      }
    </div>);

}