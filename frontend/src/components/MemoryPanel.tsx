// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useEffect } from 'react';
import type { MemoryPanelData, DomainInfo } from '../types/buddy';


interface MemoryPanelProps {
  data: MemoryPanelData | null;
  onRequestData: () => void;
  primaryColor?: string;
}

export default function MemoryPanel({ data, onRequestData, primaryColor = '#58a6ff' }: MemoryPanelProps) {


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
      {/* 统计概览 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8
      }}>
        <StatCard emoji="🧩" label="总节点" value={data.stats.totalNodes} color="#58a6ff" />
        <StatCard emoji="📚" label="知识域" value={data.stats.totalDomains} color="#d29922" />
        <StatCard emoji="🔥" label="活跃域" value={data.stats.activeDomains} color="#3fb950" />
      </div>

      {/* 领域知识树 */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>
          📚 知识域 ({data.domains.length})
        </div>
        {data.domains.length === 0 ?
        <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 20 }}>
            暂无知识域
          </div> :

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.domains.
          sort((a, b) => b.knowledgeCount - a.knowledgeCount).
          map((domain) =>
          <DomainCard key={domain.domain} domain={domain} primaryColor={primaryColor} />
          )}
          </div>
        }
      </div>
    </div>);

}

function DomainCard({ domain, primaryColor }: {domain: DomainInfo;primaryColor: string;}) {
  const stageColors: Record<string, string> = {
    seed: '#8b949e',
    sprout: '#3fb950',
    growing: '#58a6ff',
    mature: '#d29922',
    expert: '#f778ba'
  };
  const stageColor = stageColors[domain.growthStage] || '#8b949e';
  const depthPercent = Math.round(domain.depthScore * 100);

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      background: '#0d1117',
      border: '1px solid #30363d'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>
          {domain.domain}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 4,
            background: `${stageColor}22`,
            color: stageColor
          }}>
            {domain.growthStage}
          </span>
        </div>
      </div>

      {/* 知识量 + 深度 */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
        <span>📝 {domain.knowledgeCount} {"\u6761\u77E5\u8BC6"}</span>
        <span>{"🎯 深度 "}{depthPercent}{"%"}</span>
        <span>💬 {domain.conversationCount} {"\u6B21\u5BF9\u8BDD"}</span>
      </div>

      {/* 深度条 */}
      <div style={{
        width: '100%',
        height: 3,
        background: '#21262d',
        borderRadius: 2,
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${depthPercent}%`,
          height: '100%',
          background: primaryColor,
          borderRadius: 2,
          transition: 'width 0.5s'
        }} />
      </div>
    </div>);

}

function StatCard({ emoji, label, value, color }: {emoji: string;label: string;value: number;color: string;}) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '10px 6px',
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 8
    }}>
      <div style={{ fontSize: 18 }}>{emoji}</div>
      <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>{label}</div>
      <div style={{ color, fontSize: 14, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>);

}