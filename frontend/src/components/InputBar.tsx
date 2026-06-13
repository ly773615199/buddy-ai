// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useRef, useCallback, useState, useEffect } from 'react';
import { t } from '../i18n/t';


interface InputBarProps {
  onSend: (msg: string) => void;
  connected: boolean;
  primaryColor?: string;
  activeTaskCount?: number;
  maxConcurrent?: number;
}

/** Available slash commands — factory to defer t() into component scope */
function getSlashCommands(t: (key: string) => string) {
  return [
  { cmd: '/help', desc: "\u67E5\u770B\u5E2E\u52A9\u4FE1\u606F" },
  { cmd: '/clear', desc: "\u6E05\u7A7A\u5BF9\u8BDD\u5386\u53F2" },
  { cmd: '/status', desc: "\u67E5\u770B\u5F53\u524D\u72B6\u6001" },
  { cmd: '/think', desc: "\u5207\u6362\u601D\u8003\u6A21\u5F0F" },
  { cmd: '/model', desc: "\u67E5\u770B/\u5207\u6362\u6A21\u578B" },
  { cmd: '/export', desc: "\u5BFC\u51FA\u5BF9\u8BDD\u8BB0\u5F55" }];

}

export default function InputBar({
  onSend, connected, primaryColor = 'var(--accent-blue)', activeTaskCount = 0, maxConcurrent = 3 }: InputBarProps) {

  const SLASH_COMMANDS = getSlashCommands(t);
  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // History navigation
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const currentInputRef = useRef<string>('');

  // 检测 Web Speech API 支持
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSttSupported(!!SpeechRecognition);
  }, []);

  // 清理录音
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {recognitionRef.current.stop();} catch {/* ignore */}
      }
    };
  }, []);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !connected) return;
    // Save to history
    if (!historyRef.current.length || historyRef.current[historyRef.current.length - 1] !== text) {
      historyRef.current.push(text);
      // Keep last 50 entries
      if (historyRef.current.length > 50) historyRef.current.shift();
    }
    historyIndexRef.current = -1;
    currentInputRef.current = '';
    onSend(text);
    setInput('');
    setInterimText('');
    setShowCommands(false);
    // Reset height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    inputRef.current?.focus();
  }, [input, connected, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Enter to send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showCommands) {
        // Select first visible command
        const filtered = SLASH_COMMANDS.filter((c) => c.cmd.includes(commandFilter));
        if (filtered.length > 0) {
          setInput(filtered[0].cmd + ' ');
          setShowCommands(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }
      handleSend();
      return;
    }

    // Arrow Up/Down for history
    if (e.key === 'ArrowUp' && !showCommands) {
      e.preventDefault();
      const history = historyRef.current;
      if (history.length === 0) return;

      if (historyIndexRef.current === -1) {
        // Save current input before navigating
        currentInputRef.current = input;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }
      setInput(history[historyIndexRef.current]);
      setTimeout(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
        adjustHeight();
      }, 0);
      return;
    }

    if (e.key === 'ArrowDown' && !showCommands) {
      e.preventDefault();
      if (historyIndexRef.current === -1) return;

      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current++;
        setInput(historyRef.current[historyIndexRef.current]);
      } else {
        // Restore saved input
        historyIndexRef.current = -1;
        setInput(currentInputRef.current);
      }
      setTimeout(adjustHeight, 0);
      return;
    }

    // ESC to close command panel
    if (e.key === 'Escape' && showCommands) {
      e.preventDefault();
      setShowCommands(false);
      return;
    }
  }, [handleSend, showCommands, commandFilter, input, adjustHeight]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Slash command detection
    if (val.startsWith('/') && !val.includes(' ')) {
      setShowCommands(true);
      setCommandFilter(val);
    } else {
      setShowCommands(false);
    }

    // Reset history navigation when typing
    if (historyIndexRef.current !== -1) {
      historyIndexRef.current = -1;
      currentInputRef.current = val;
    }

    // Auto-resize
    setTimeout(adjustHeight, 0);
  }, [adjustHeight]);

  const handleCommandClick = useCallback((cmd: string) => {
    setInput(cmd + ' ');
    setShowCommands(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // 开始/停止语音识别
  const toggleRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setRecording(false);
      setInterimText('');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (finalText) {
        setInput((prev) => prev + finalText);
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      console.error('[STT] Error:', event.error);
      setRecording(false);
      setInterimText('');
    };

    recognition.onend = () => {
      setRecording(false);
      setInterimText('');
    };

    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
  }, [recording]);

  const charCount = input.length;
  const showCount = charCount > 500;

  // Filtered slash commands
  const filteredCommands = showCommands ?
  SLASH_COMMANDS.filter((c) => c.cmd.includes(commandFilter)) :
  [];

  return (
    <div style={{
      borderTop: '1px solid var(--border-primary)',
      background: 'var(--bg-secondary)',
      borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
      position: 'relative'
    }}>
      {/* Slash command panel */}
      {showCommands && filteredCommands.length > 0 &&
      <div style={{
        position: 'absolute',
        bottom: '100%',
        left: 12,
        right: 12,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        maxHeight: 200,
        overflowY: 'auto',
        zIndex: 10,
        boxShadow: '0 -4px 12px rgba(0,0,0,.3)',
        animation: 'fadeIn 0.15s ease-out'
      }}>
          {filteredCommands.map((c) =>
        <div
          key={c.cmd}
          onClick={() => handleCommandClick(c.cmd)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            borderBottom: '1px solid var(--border-primary)',
            transition: 'background 0.1s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          
              <span style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {c.cmd}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{c.desc}</span>
            </div>
        )}
        </div>
      }

      {/* 输入区域 */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px',
        alignItems: 'flex-end'
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
          recording ? `🎤 ${"\u6B63\u5728\u8046\u542C..."}` :
          !connected ? "\u8FDE\u63A5\u4E2D..." :
          activeTaskCount >= maxConcurrent ? `⏳ ${"\u4EFB\u52A1\u961F\u5217\u5DF2\u6EE1"} (${activeTaskCount}/${maxConcurrent})...` :
          activeTaskCount > 0 ? `${t("\u8F93\u5165\u6D88\u606F...")} (${activeTaskCount} ${t("\u4E2A\u4EFB\u52A1\u5904\u7406\u4E2D")})` :
          `${t("\u8F93\u5165\u6D88\u606F...")} (Shift+Enter ${t("\u6362\u884C")}, ↑↓ ${t("\u5386\u53F2")})`
          }
          disabled={!connected}
          rows={1}
          style={{
            flex: 1,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-secondary)',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            outline: 'none',
            resize: 'none',
            minHeight: 36,
            maxHeight: 120,
            lineHeight: 1.5,
            transition: 'border-color 0.15s',
            overflow: 'auto'
          }}
          onFocus={(e) => e.target.style.borderColor = typeof primaryColor === 'string' && primaryColor.startsWith('#') ? primaryColor : 'var(--accent-blue)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--border-primary)'} />
        
        {sttSupported &&
        <button
          onClick={toggleRecording}
          title={recording ? "\u505C\u6B62\u5F55\u97F3" : "\u8BED\u97F3\u8F93\u5165"}
          style={{
            background: recording ? 'var(--accent-red)' : 'var(--bg-tertiary)',
            color: recording ? '#fff' : 'var(--text-muted)',
            border: recording ? 'none' : '1px solid var(--border-primary)',
            padding: '8px 10px',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 16,
            transition: 'all 0.15s',
            flexShrink: 0,
            minHeight: 36,
            animation: recording ? 'sttPulse 1.5s infinite' : 'none'
          }}>
          
            {recording ? '🔴' : '🎤'}
          </button>
        }
        <button
          onClick={handleSend}
          disabled={!connected || !input.trim()}
          style={{
            background: connected && input.trim() ? primaryColor : 'var(--bg-tertiary)',
            color: '#fff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: 'var(--radius-md)',
            cursor: connected && input.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.15s',
            flexShrink: 0,
            minHeight: 36
          }}>
          {"\u53D1\u9001"}</button>
      </div>

      {/* 状态栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 14px 6px',
        fontSize: 11,
        color: 'var(--text-faint)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
            boxShadow: connected ? '0 0 6px rgba(63,185,80,.4)' : 'none'
          }} />
          {connected ? t("\u5DF2\u8FDE\u63A5") : t("\u672A\u8FDE\u63A5")}
          {activeTaskCount > 0 &&
          <span style={{ color: 'var(--accent-yellow)', marginLeft: 4 }}>
              · ⚙️ {activeTaskCount}/{maxConcurrent}
            </span>
          }
        </div>
        {showCount &&
        <span style={{ color: charCount > 2000 ? 'var(--accent-red)' : 'var(--text-faint)' }}>
            {charCount}/2000
          </span>
        }
        {recording &&
        <span style={{ color: 'var(--accent-red)', animation: 'sttPulse 1.5s infinite' }}>{"\uD83C\uDFA4 \u8BED\u97F3\u8BC6\u522B\u4E2D..."}</span>
        }
      </div>

      {/* 临时识别文本 */}
      {interimText &&
      <div style={{
        padding: '2px 14px 6px',
        fontSize: 12,
        color: 'var(--text-muted)',
        fontStyle: 'italic'
      }}>
          {interimText}
        </div>
      }
    </div>);

}