// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import type { AgentTraceStep } from '../types/buddy';
import { t } from '../i18n/t';


interface AgentTraceProps {
  trace: AgentTraceStep[];
  primaryColor?: string;
}

const STEP_CONFIG: Record<string, {icon: string;color: string;label: string;}> = {
  thinking: { icon: '🤔', color: '#d29922', label: '思考中' },
  tool_call: { icon: '🔧', color: '#58a6ff', label: '工具调用' },
  tool_result: { icon: '📋', color: '#3fb950', label: '工具结果' },
  response: { icon: '💬', color: '#f778ba', label: '回复' },
  model_decision: { icon: '🧠', color: '#a371f7', label: '模型决策' },
  brain_trace: { icon: '⚡', color: '#f0883e', label: '大脑追踪' }
};

export default function AgentTrace({ trace, primaryColor: _primaryColor = '#58a6ff' }: AgentTraceProps) {


  if (trace.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 20 }}>
        暂无追踪记录
      </div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' as const }}>
      {/* Timeline line */}
      <div style={{
        position: 'absolute' as const,
        left: 14,
        top: 8,
        bottom: 8,
        width: 2,
        background: '#30363d'
      }} />

      {trace.map((step, i) => {
        const config = STEP_CONFIG[step.type] || STEP_CONFIG.thinking;
        return (
          <div key={i} style={{ display: 'flex', gap: 10, position: 'relative' as const, padding: '6px 0' }}>
            {/* Timeline dot */}
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#161b22',
              border: `2px solid ${config.color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              flexShrink: 0,
              zIndex: 1
            }}>
              {config.icon}
            </div>

            {/* Content */}
            <div style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 8,
              background: '#0d1117',
              border: '1px solid #30363d'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: config.color, fontWeight: 600 }}>
                  {config.label}
                </span>
                <span style={{ fontSize: 9, color: '#484f58' }}>
                  {new Date(step.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>

              {step.type === 'tool_call' && step.tool &&
              <div style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, marginBottom: 2 }}>
                  {step.tool}
                </div>
              }

              {step.type === 'tool_result' && step.success !== undefined &&
              <div style={{ fontSize: 10, color: step.success ? '#3fb950' : '#f85149', marginBottom: 2 }}>
                  {step.success ? "\u2705 \u6210\u529F" : "\u274C \u5931\u8D25"}
                </div>
              }

              {step.type === 'model_decision' &&
              <div style={{ fontSize: 10, color: '#a371f7', marginBottom: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>🎯 {step.displayName ?? step.modelId}</span>
                  {step.tier && <span style={{ color: '#8b949e' }}>[{step.tier}]</span>}
                  {step.layer !== undefined && <span style={{ color: '#8b949e' }}>Layer {step.layer}</span>}
                  {step.candidateCount !== undefined && <span style={{ color: '#8b949e' }}>{t('{{count}} 候选', { count: step.candidateCount })}</span>}
                  {step.taskType && <span style={{ color: '#8b949e' }}>#{step.taskType}</span>}
                </div>
              }

              {step.type === 'brain_trace' && step.phase &&
              <div style={{ fontSize: 10, color: '#f0883e', marginBottom: 2 }}>
                  <span>📡 {step.phase}</span>
                  {step.traceId && <span style={{ color: '#8b949e', marginLeft: 8 }}>{step.traceId.slice(0, 8)}</span>}
                </div>
              }

              <div style={{
                fontSize: 11,
                color: '#8b949e',
                lineHeight: 1.4,
                maxHeight: 60,
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                {step.content.slice(0, 200)}{step.content.length > 200 ? '...' : ''}
              </div>
            </div>
          </div>);

      })}
    </div>);

}