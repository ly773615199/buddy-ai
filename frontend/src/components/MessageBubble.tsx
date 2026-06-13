// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useMemo, useCallback } from 'react';
import { t } from '../i18n/t';
import { ToolCallCard } from './ToolCallCard';
import { DiagnosticCard } from './DiagnosticCard';
import { renderMarkdown } from '../utils/markdown';
import type { ChatMessage } from '../types/buddy';

interface MessageBubbleProps {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onConfirm?: (allowed: boolean, confirmId?: string) => void;
  isLastUserMessage?: boolean;
}

const formatTime = (ts: number) =>
new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** Message action bar — shown on hover */
function ActionBar({
  content,
  messageId,
  onRetry,
  onDelete,
  isLastUserMessage






}: {content: string;messageId: string;onRetry?: (id: string) => void;onDelete?: (id: string) => void;isLastUserMessage?: boolean;}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap'
  };

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      marginTop: 4,
      opacity: 0,
      transition: 'opacity 0.15s',
      justifyContent: 'flex-end'
    }} className="msg-actions">
      <button
        onClick={handleCopy}
        style={btnStyle}
        onMouseEnter={(e) => {e.currentTarget.style.color = 'var(--accent-blue)';e.currentTarget.style.background = 'rgba(88,166,255,.1)';}}
        onMouseLeave={(e) => {e.currentTarget.style.color = 'var(--text-muted)';e.currentTarget.style.background = 'none';}}>
        
        {copied ? "\u2713 \u5DF2\u590D\u5236" : "\uD83D\uDCCB \u590D\u5236"}
      </button>
      {isLastUserMessage && onRetry &&
      <button
        onClick={() => onRetry(messageId)}
        style={btnStyle}
        onMouseEnter={(e) => {e.currentTarget.style.color = 'var(--accent-yellow)';e.currentTarget.style.background = 'rgba(210,153,34,.1)';}}
        onMouseLeave={(e) => {e.currentTarget.style.color = 'var(--text-muted)';e.currentTarget.style.background = 'none';}}>
        {"\uD83D\uDD04 \u91CD\u8BD5"}</button>
      }
      {onDelete &&
      <button
        onClick={() => onDelete(messageId)}
        style={btnStyle}
        onMouseEnter={(e) => {e.currentTarget.style.color = 'var(--accent-red)';e.currentTarget.style.background = 'rgba(248,81,73,.1)';}}
        onMouseLeave={(e) => {e.currentTarget.style.color = 'var(--text-muted)';e.currentTarget.style.background = 'none';}}>
        {"\uD83D\uDDD1\uFE0F \u5220\u9664"}</button>
      }
    </div>);

}

export default function MessageBubble({
  message, onRetry, onDelete, onConfirm, isLastUserMessage }: MessageBubbleProps) {

  const { role, content, toolName, toolPreview, streaming, timestamp, id } = message;

  // Memoize markdown rendering for assistant messages
  const renderedContent = useMemo(() => {
    if (role === 'assistant' || role === 'error') {
      return renderMarkdown(content);
    }
    return null;
  }, [content, role]);

  // 用户消息
  if (role === 'user') {
    return (
      <div
        className="msg-bubble-wrap"
        style={{
          alignSelf: 'flex-end',
          maxWidth: '80%',
          animation: 'msgIn 0.3s ease-out'
        }}>
        
        <div style={{
          background: 'var(--accent-blue)',
          color: '#fff',
          padding: '8px 14px',
          borderRadius: '12px 12px 2px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          {content}
        </div>
        <div style={{
          fontSize: 10,
          color: 'var(--text-faint)',
          textAlign: 'right',
          marginTop: 2
        }}>{formatTime(timestamp)}</div>
        <ActionBar
          content={content}
          messageId={id}
          onRetry={onRetry}
          onDelete={onDelete}
          isLastUserMessage={isLastUserMessage} />
        
      </div>);

  }

  // 工具调用消息
  if (role === 'tool' && toolName) {
    return (
      <div
        className="msg-bubble-wrap"
        style={{
          alignSelf: 'flex-start',
          maxWidth: '90%',
          animation: 'msgIn 0.3s ease-out'
        }}>
        
        <ToolCallCard
          toolName={toolName}
          args={toolPreview}
          result={toolPreview && !toolPreview.startsWith('{') ? toolPreview : undefined}
          success={content.includes('✅') ? true : content.includes('❌') ? false : undefined}
          timestamp={timestamp} />
        
      </div>);

  }

  // 系统消息（思考中、进化等）
  if (role === 'system') {
    const isConfirm = !!message.confirmId;
    return (
      <div style={{
        alignSelf: 'center',
        maxWidth: '90%',
        padding: '4px 0',
        fontSize: 12,
        color: 'var(--text-muted)',
        fontStyle: isConfirm ? 'normal' : 'italic',
        animation: 'msgIn 0.3s ease-out',
        textAlign: 'center'
      }}>
        <div>{content}</div>
        {isConfirm && onConfirm &&
        <div style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          marginTop: 8
        }}>
          <button
            onClick={() => onConfirm(true, message.confirmId)}
            style={{
              background: 'var(--accent-green, #3fb950)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
            ✅ 确认
          </button>
          <button
            onClick={() => onConfirm(false, message.confirmId)}
            style={{
              background: 'var(--accent-red, #f85149)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
            ❌ 取消
          </button>
        </div>
        }
      </div>);

  }

  // 引导气泡
  if (role === 'bubble' || role === 'guidance') {
    return (
      <div style={{
        alignSelf: 'center',
        maxWidth: '85%',
        animation: 'msgIn 0.3s ease-out'
      }}>
        <div style={{
          background: 'rgba(88,166,255,.08)',
          border: '1px solid rgba(88,166,255,.25)',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--accent-blue)',
          lineHeight: 1.5,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          animation: 'guidancePulse 3s ease-in-out infinite'
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
          <span>{content}</span>
        </div>
      </div>);

  }

  // 错误消息
  if (role === 'error') {
    return (
      <div style={{
        alignSelf: 'center',
        maxWidth: '80%',
        animation: 'msgIn 0.3s ease-out'
      }}>
        <div style={{
          background: 'rgba(248,81,73,.08)',
          border: '1px solid rgba(248,81,73,.3)',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 12,
          color: 'var(--accent-red)',
          lineHeight: 1.5
        }}>
          ❌ {content}
        </div>
      </div>);

  }

  // Phase 5: 诊断卡片
  if (role === 'diagnostic' && message.diagnostic) {
    return (
      <div style={{
        alignSelf: 'center',
        maxWidth: '90%',
        animation: 'msgIn 0.3s ease-out'
      }}>
        <DiagnosticCard diagnostic={message.diagnostic} />
      </div>);

  }

  // 助手消息（默认）— 支持 Markdown
  return (
    <div
      className="msg-bubble-wrap"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        animation: 'msgIn 0.3s ease-out'
      }}>
      
      <div style={{
        background: 'var(--bg-tertiary)',
        border: `1px solid ${message.ternarySource ? 'var(--accent-green)' : 'var(--border-primary)'}`,
        padding: '10px 14px',
        borderRadius: '12px 12px 12px 2px',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        wordBreak: 'break-word'
      }}>
        {renderedContent}
        {streaming &&
        <span style={{
          display: 'inline-block',
          width: 7,
          height: 14,
          background: 'var(--accent-blue)',
          marginLeft: 2,
          verticalAlign: 'text-bottom',
          animation: 'cursorBlink 0.8s step-end infinite'
        }} />
        }
      </div>
      {/* 三进制推理来源标注 */}
      {message.ternarySource &&
      <div style={{
        fontSize: 10,
        color: 'var(--accent-green)',
        marginTop: 2,
        paddingLeft: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 4
      }}>{t('🧠 本地「{{domain}}」专家模型回答 (置信度 {{confidence}}%)', { domain: message.ternarySource.domain, confidence: message.ternarySource.confidence })}</div>
      }
      <div style={{
        fontSize: 10,
        color: 'var(--text-faint)',
        marginTop: 2,
        paddingLeft: 4
      }}>{formatTime(timestamp)}</div>
      <ActionBar
        content={content}
        messageId={id}
        onRetry={onRetry}
        onDelete={onDelete}
        isLastUserMessage={isLastUserMessage} />
      
    </div>);

}