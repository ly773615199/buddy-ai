// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState } from 'react';


interface ToolCallCardProps {
  toolName: string;
  args?: string;
  result?: string;
  success?: boolean;
  timestamp: number;
}

/** 工具调用卡片 */
export function ToolCallCard({
  toolName, args, result, success, timestamp: _timestamp }: ToolCallCardProps) {

  const [expanded, setExpanded] = useState(false);

  const statusIcon = success === undefined ? '⏳' : success ? '✅' : '❌';
  const borderColor = success === undefined ? '#d29922' : success ? '#3fb950' : '#f85149';

  // 解析参数，提取关键信息
  let argPreview = '';
  if (args) {
    try {
      const parsed = JSON.parse(args);
      const keys = Object.keys(parsed);
      argPreview = keys.slice(0, 3).map((k) => {
        const v = String(parsed[k]);
        return `${k}: ${v.length > 30 ? v.slice(0, 30) + '...' : v}`;
      }).join(', ');
    } catch {
      argPreview = args.slice(0, 60);
    }
  }

  return (
    <div style={{
      background: '#0d1117',
      border: `1px solid ${borderColor}`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 8,
      margin: '6px 0',
      overflow: 'hidden',
      animation: 'msgIn 0.3s ease-out',
      maxWidth: '100%'
    }}>
      {/* Header - clickable */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: 12,
          color: '#c9d1d9'
        }}>
        
        <span style={{ fontSize: 14 }}>{statusIcon}</span>
        <span style={{
          fontFamily: "'Cascadia Code', monospace",
          color: '#f0883e',
          fontWeight: 600
        }}>{toolName}</span>
        {argPreview && !expanded &&
        <span style={{ color: '#8b949e', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ({argPreview})
          </span>
        }
        <span style={{
          color: '#484f58',
          fontSize: 10,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s'
        }}>▶</span>
      </div>

      {/* Expanded content */}
      {expanded &&
      <div style={{
        padding: '0 12px 10px',
        borderTop: '1px solid #21262d'
      }}>
          {args &&
        <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4, textTransform: 'uppercase' }}>{"\u53C2\u6570"}</div>
              <pre style={{
            margin: 0,
            padding: '6px 10px',
            background: '#161b22',
            borderRadius: 4,
            fontSize: 11,
            overflowX: 'auto',
            color: '#c9d1d9',
            fontFamily: "'Cascadia Code', monospace",
            maxHeight: 120
          }}>
                {(() => {
              try {return JSON.stringify(JSON.parse(args), null, 2);}
              catch {return args;}
            })()}
              </pre>
            </div>
        }
          {result &&
        <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4, textTransform: 'uppercase' }}>{"\u7ED3\u679C"}</div>
              <pre style={{
            margin: 0,
            padding: '6px 10px',
            background: '#161b22',
            borderRadius: 4,
            fontSize: 11,
            overflowX: 'auto',
            color: success ? '#3fb950' : '#f85149',
            fontFamily: "'Cascadia Code', monospace",
            maxHeight: 200,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
                {result}
              </pre>
            </div>
        }
        </div>
      }
    </div>);

}