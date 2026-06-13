// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useEffect } from 'react';
import type { ToolPanelData, ToolInfo, ToolExecution } from '../types/buddy';


interface ToolPanelProps {
  data: ToolPanelData | null;
  onRequestData: () => void;
  primaryColor?: string;
}

export default function ToolPanel({ data, onRequestData, primaryColor = '#58a6ff' }: ToolPanelProps) {


  useEffect(() => {
    onRequestData();
  }, [onRequestData]);

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: 30, color: '#8b949e', fontSize: 13 }}>
        加载中...
      </div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 560, overflowY: 'auto' }}>
      {/* 工具列表 */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>
          🔧 工具列表 ({data.tools.length})
        </div>
        {data.tools.length === 0 ?
        <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 16 }}>
            暂无工具
          </div> :

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.tools.map((tool) =>
          <ToolCard key={tool.name} tool={tool} primaryColor={primaryColor} />
          )}
          </div>
        }
      </div>

      {/* 执行日志 */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>
          📋 执行历史
        </div>
        {data.recentExecutions.length === 0 ?
        <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 16 }}>
            暂无执行记录
          </div> :

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.recentExecutions.map((exec, i) =>
          <ExecutionCard key={i} execution={exec} primaryColor={primaryColor} />
          )}
          </div>
        }
      </div>
    </div>);

}

function ToolCard({ tool, primaryColor: _primaryColor }: {tool: ToolInfo;primaryColor: string;}) {
  const sourceColors: Record<string, string> = {
    builtin: '#58a6ff',
    mcp: '#3fb950',
    skill: '#d29922',
    plugin: '#f778ba'
  };
  const sourceColor = sourceColors[tool.source] || '#8b949e';

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 8,
      background: '#0d1117',
      border: '1px solid #30363d'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>
          {tool.name}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 4,
            background: `${sourceColor}22`,
            color: sourceColor
          }}>
            {tool.source}
          </span>
          <span style={{ fontSize: 10, color: '#8b949e' }}>
            ×{tool.usageCount}
          </span>
          {tool.successRate >= 0 &&
          <span style={{
            fontSize: 10,
            color: tool.successRate >= 80 ? '#3fb950' : tool.successRate >= 50 ? '#d29922' : '#f85149'
          }}>
              {Math.round(tool.successRate)}%
            </span>
          }
        </div>
      </div>
      {tool.description &&
      <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.4 }}>
          {tool.description.slice(0, 80)}{tool.description.length > 80 ? '...' : ''}
        </div>
      }
    </div>);

}

function ExecutionCard({ execution, primaryColor: _primaryColor }: {execution: ToolExecution;primaryColor: string;}) {
  const time = new Date(execution.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 8,
      background: '#0d1117',
      border: '1px solid #30363d'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>{execution.success ? '✅' : '❌'}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>{execution.tool}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#8b949e' }}>
          <span>{execution.durationMs}ms</span>
          <span>{timeStr}</span>
        </div>
      </div>
      {execution.result &&
      <div style={{
        fontSize: 10,
        color: '#8b949e',
        fontFamily: "'Cascadia Code', monospace",
        background: '#161b22',
        padding: '4px 6px',
        borderRadius: 4,
        marginTop: 4,
        maxHeight: 40,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
      }}>
          {execution.result}
        </div>
      }
    </div>);

}