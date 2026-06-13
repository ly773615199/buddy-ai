import type React from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';

// Register supported languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);

/** Copy text to clipboard, returns success boolean */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/** Inline copy button for code blocks */
function CodeCopyButton({ text }: { text: string }) {
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLButtonElement;
    const ok = await copyToClipboard(text);
    if (ok) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    }
  };

  return (
    <button
      onClick={handleClick}
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-muted)',
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
        zIndex: 1,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--accent-blue)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--text-muted)';
        e.currentTarget.style.borderColor = 'var(--border-primary)';
      }}
    >
      复制
    </button>
  );
}

/** Sanitize highlighted HTML — only allow span with class (hljs tokens) */
function sanitizeHighlight(html: string): string {
  // Strip everything except <span class="hljs-*"> ... </span> and safe entities
  return html
    .replace(/<(?!\/?span[\s>])/gi, '&lt;')
    .replace(/(?<!<\/?)span(?![\s>])/gi, 'span')
    .replace(/\bon\w+\s*=/gi, 'data-removed='); // strip on* handlers
}

/** Highlight code with fallback */
function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return sanitizeHighlight(hljs.highlight(code, { language: lang }).value);
    } catch { /* fallback */ }
  }
  // Auto-detect
  try {
    return sanitizeHighlight(hljs.highlightAuto(code).value);
  } catch { /* fallback */ }
  return escapeHtml(code);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 行内元素渲染：inline code, bold, links */
function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/`([^`]+)`/);
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    let earliest = -1;
    let matchType = '';
    let match: RegExpMatchArray | null = null;

    if (codeMatch && (earliest === -1 || codeMatch.index! < earliest)) {
      earliest = codeMatch.index!;
      matchType = 'code';
      match = codeMatch;
    }
    if (boldMatch && (earliest === -1 || boldMatch.index! < earliest)) {
      earliest = boldMatch.index!;
      matchType = 'bold';
      match = boldMatch;
    }
    if (linkMatch && (earliest === -1 || linkMatch.index! < earliest)) {
      earliest = linkMatch.index!;
      matchType = 'link';
      match = linkMatch;
    }

    if (!match || earliest === -1) {
      parts.push(remaining);
      break;
    }

    if (earliest > 0) {
      parts.push(remaining.slice(0, earliest));
    }

    if (matchType === 'code') {
      parts.push(
        <code key={key++} style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          padding: '1px 5px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.9em',
          fontFamily: 'var(--font-mono)',
          color: 'var(--accent-orange)',
        }}>{match[1]}</code>
      );
      remaining = remaining.slice(earliest + match[0].length);
    } else if (matchType === 'bold') {
      parts.push(<strong key={key++}>{match[1]}</strong>);
      remaining = remaining.slice(earliest + match[0].length);
    } else if (matchType === 'link') {
      parts.push(
        <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}
          onMouseEnter={e => (e.target as HTMLElement).style.textDecoration = 'underline'}
          onMouseLeave={e => (e.target as HTMLElement).style.textDecoration = 'none'}
        >{match[1]}</a>
      );
      remaining = remaining.slice(earliest + match[0].length);
    }
  }

  return <>{parts}</>;
}

/** 轻量 Markdown 渲染（无外部依赖） */
export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        const rawCode = codeLines.join('\n');
        const highlighted = highlightCode(rawCode, codeLang.toLowerCase());
        const langLabel = codeLang || 'code';
        elements.push(
          <div key={`cb-${i}`} style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            margin: '8px 0',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Header: language label + copy button */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 12px',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-primary)',
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
            }}>
              <span>{langLabel}</span>
              <CodeCopyButton text={rawCode} />
            </div>
            <pre style={{
              margin: 0,
              padding: '10px 12px',
              overflowX: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
            }}>
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.trim().replace('```', '');
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    elements.push(
      <div key={`l-${i}`} style={{ minHeight: line.trim() === '' ? 8 : undefined }}>
        {renderInline(line)}
      </div>
    );
  }

  if (inCodeBlock && codeLines.length > 0) {
    const rawCode = codeLines.join('\n');
    const highlighted = highlightCode(rawCode, codeLang.toLowerCase());
    const langLabel = codeLang || 'code';
    elements.push(
      <div key="cb-open" style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        margin: '8px 0',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {codeLang && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 12px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-primary)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}>
            <span>{langLabel}</span>
            <CodeCopyButton text={rawCode} />
          </div>
        )}
        <pre style={{
          margin: 0, padding: '10px 12px',
          overflowX: 'auto', fontSize: 12, lineHeight: 1.5,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
        }}>
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    );
  }

  return elements;
}
