// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useRef, useEffect, useState, useCallback, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage } from '../types/buddy';
import MessageBubble from './MessageBubble';
import InputBar from './InputBar';
import EmptyState from './EmptyState';
import { IconSearch, IconClose, IconDelete } from './Icons';


interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  onClear: () => void;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onConfirm?: (allowed: boolean, confirmId?: string) => void;
  connected: boolean;
  primaryColor?: string;
  activeTaskCount?: number;
  maxConcurrent?: number;
  /** 内心独白（叙事引擎） */
  narration?: {content: string;type: string;timestamp: number;} | null;
}

export default function ChatPanel({
  messages,
  onSend,
  onClear,
  onRetry,
  onDelete,
  onConfirm,
  connected,
  primaryColor,
  activeTaskCount = 0,
  maxConcurrent = 3,
  narration
}: ChatPanelProps) {

  const messagesEnd = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showOrchGroup, setShowOrchGroup] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Find last user message ID for retry button
  const lastUserMessageId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id;
    }
    return null;
  })();

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Ctrl+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  // Filter messages based on search
  const filteredMessages = searchQuery.trim() ?
  messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase())) :
  messages;

  // Highlight matching text in content
  const highlightText = useCallback((text: string, query: string) => {
    if (!query.trim()) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx) + '【' + text.slice(idx, idx + query.length) + '】' + text.slice(idx + query.length);
  }, []);

  // 编排消息分组统计
  const orchGroups = new Map<string, {count: number;firstIdx: number;lastIdx: number;}>();
  filteredMessages.forEach((msg, idx) => {
    if (msg.orchGroup) {
      const existing = orchGroups.get(msg.orchGroup);
      if (existing) {
        existing.count++;
        existing.lastIdx = idx;
      } else {
        orchGroups.set(msg.orchGroup, { count: 1, firstIdx: idx, lastIdx: idx });
      }
    }
  });

  const toggleOrchGroup = (groupId: string) => {
    setShowOrchGroup((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);else
      next.add(groupId);
      return next;
    });
  };

  // 渲染消息列表，编排消息按组折叠
  const renderedMessages: JSX.Element[] = [];
  const skipOrchIndices = new Set<number>();

  for (const [groupId, group] of orchGroups) {
    if (!showOrchGroup.has(groupId) && group.count > 3) {
      for (let i = group.firstIdx + 1; i < group.lastIdx; i++) {
        if (filteredMessages[i].orchGroup === groupId) {
          skipOrchIndices.add(i);
        }
      }
    }
  }

  filteredMessages.forEach((msg, idx) => {
    if (msg.orchGroup && orchGroups.has(msg.orchGroup)) {
      const group = orchGroups.get(msg.orchGroup)!;
      if (idx === group.firstIdx && group.count > 3) {
        const isExpanded = showOrchGroup.has(msg.orchGroup);
        renderedMessages.push(
          <MessageBubble
            key={msg.id}
            message={searchQuery ? { ...msg, content: highlightText(msg.content, searchQuery) } : msg}
            onRetry={onRetry}
            onDelete={onDelete}
            onConfirm={onConfirm}
            isLastUserMessage={msg.id === lastUserMessageId} />,

          <div
            key={`orch-toggle-${msg.orchGroup}`}
            onClick={() => toggleOrchGroup(msg.orchGroup!)}
            style={{
              alignSelf: 'center',
              fontSize: 11,
              color: 'var(--accent-blue)',
              cursor: 'pointer',
              padding: '2px 8px',
              opacity: 0.7,
              userSelect: 'none'
            }}>
            
            {isExpanded ? `▲ ${"\u6536\u8D77\u8BE6\u60C5"}` : `▼ ${"\u5C55\u5F00"} ${group.count - 2} ${"\u6761\u4E2D\u95F4\u4E8B\u4EF6"}`}
          </div>
        );
        return;
      }
      if (skipOrchIndices.has(idx)) return;
    }

    renderedMessages.push(
      <MessageBubble
        key={msg.id}
        message={searchQuery ? { ...msg, content: highlightText(msg.content, searchQuery) } : msg}
        onRetry={onRetry}
        onDelete={onDelete}
        onConfirm={onConfirm}
        isLastUserMessage={msg.id === lastUserMessageId} />

    );
  });

  // Virtual scrolling for large message lists
  const useVirtual = filteredMessages.length > 100;
  const virtualizer = useVirtual ?
  useVirtualizer({
    count: renderedMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 80,
    overscan: 10
  }) :
  null;

  return (
    <div style={{
      flex: 1,
      minWidth: 340,
      maxWidth: 640,
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '85vh'
    }}>
      {/* 头部：搜索 + 任务计数 + 清空按钮 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderBottom: '1px solid var(--bg-tertiary)',
        minHeight: 28,
        gap: 8
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', flex: 1 }}>
          {activeTaskCount > 0 &&
          <span style={{ color: 'var(--accent-yellow)' }}>{"\u2699\uFE0F \u5904\u7406\u4E2D {activeTaskCount}/{maxConcurrent}"}</span>
          }
        </div>

        {/* Search bar */}
        {showSearch &&
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 2
        }}>
            <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={"\u641C\u7D22\u6D88\u606F... (ESC \u5173\u95ED)"}
            style={{
              flex: 1,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              outline: 'none'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-primary)'} />
          
            {searchQuery &&
          <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {filteredMessages.length}/{messages.length}
              </span>
          }
            <button
            onClick={() => {setShowSearch(false);setSearchQuery('');}}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 4px'
            }}>
            
              <IconClose size={12} color="var(--text-muted)" />
            </button>
          </div>
        }

        <div style={{ display: 'flex', gap: 4 }}>
          {!showSearch &&
          <button
            onClick={() => {setShowSearch(true);setTimeout(() => searchInputRef.current?.focus(), 50);}}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              fontSize: 11,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'inherit'
            }}
            onMouseEnter={(e) => {e.currentTarget.style.color = 'var(--accent-blue)';e.currentTarget.style.background = 'rgba(88,166,255,.1)';}}
            onMouseLeave={(e) => {e.currentTarget.style.color = 'var(--text-faint)';e.currentTarget.style.background = 'none';}}
            title={"\u641C\u7D22\u6D88\u606F (Ctrl+F)"}>
            
              <IconSearch size={14} color="var(--text-faint)" />
            </button>
          }
          {messages.length > 0 &&
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              fontSize: 11,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'inherit'
            }}
            onMouseEnter={(e) => {e.currentTarget.style.color = 'var(--accent-red)';e.currentTarget.style.background = 'rgba(248,81,73,.1)';}}
            onMouseLeave={(e) => {e.currentTarget.style.color = 'var(--text-faint)';e.currentTarget.style.background = 'none';}}>
            <IconDelete size={12} color="var(--text-faint)" /> 清空</button>
          }
        </div>
      </div>

      {/* 消息列表 */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 200,
          maxHeight: '60vh',
          scrollBehavior: 'smooth'
        }}>
        
        {filteredMessages.length === 0 && !searchQuery &&
        <EmptyState
          emoji="🐾"
          title={"\u6253\u4E2A\u62DB\u547C\u5427\uFF01"}
          desc={"\u8BD5\u8BD5\uFF1A\u5E2E\u6211\u5217\u4E00\u4E0B\u5F53\u524D\u76EE\u5F55\u7684\u6587\u4EF6"} />

        }
        {filteredMessages.length === 0 && searchQuery &&
        <EmptyState
          emoji="🔍"
          title={"\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u6D88\u606F"}
          desc={`${"\u641C\u7D22"} "${searchQuery}" ${"\u65E0\u7ED3\u679C"}`} />

        }

        {useVirtual && virtualizer ?
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((virtualItem) =>
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`
            }}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}>
            
                {renderedMessages[virtualItem.index]}
              </div>
          )}
          </div> :

        renderedMessages
        }

        {/* 内心独白（叙事引擎） */}
        {narration &&
        <div
          style={{
            alignSelf: 'center',
            maxWidth: '80%',
            padding: '6px 14px',
            borderRadius: 16,
            background: 'rgba(136, 136, 136, 0.08)',
            color: 'var(--text-muted)',
            fontSize: 12,
            fontStyle: 'italic',
            opacity: 0.6,
            textAlign: 'center',
            lineHeight: 1.5,
            animation: 'fadeIn 0.5s ease-in',
            userSelect: 'none'
          }}>
          
            💭 {narration.content}
          </div>
        }

        <div ref={messagesEnd} />
      </div>

      {/* 输入栏 */}
      <InputBar
        onSend={onSend}
        connected={connected}
        primaryColor={primaryColor}
        activeTaskCount={activeTaskCount}
        maxConcurrent={maxConcurrent} />
      
    </div>);

}