/**
 * O6: 资源画像面板 — 展示资源画像实时状态
 *
 * 支持按类型筛选、按状态排序、健康度进度条、漂移告警
 */

import { useState, useEffect, useCallback } from 'react';

interface ResourceCapability {
  value: boolean | number | string;
  verified: boolean;
}

interface ResourceProfile {
  id: string;
  type: string;
  name: string;
  state: string;
  healthScore: number;
  stats: {
    totalCalls: number;
    successRate: string;
    avgLatencyMs: number;
  };
  capabilities: Record<string, ResourceCapability>;
  driftAlerts: number;
  marginalDelta: string;
}

interface ProfileData {
  total: number;
  byState: Record<string, number>;
  byType: Record<string, number>;
  resources: ResourceProfile[];
}

const STATE_COLORS: Record<string, string> = {
  active: '#4caf50',
  degraded: '#ff9800',
  deprecated: '#f44336',
  discovered: '#2196f3',
  rejected: '#9e9e9e',
  deceased: '#616161',
};

const STATE_LABELS: Record<string, string> = {
  active: '活跃',
  degraded: '降级',
  deprecated: '废弃',
  discovered: '发现',
  rejected: '拒绝',
  deceased: '已移除',
};

function ResourceCard({ resource }: { resource: ResourceProfile }) {
  const [expanded, setExpanded] = useState(false);
  const stateColor = STATE_COLORS[resource.state] ?? '#9e9e9e';

  return (
    <div
      style={{
        border: '1px solid #e0e0e0',
        borderLeft: `4px solid ${stateColor}`,
        borderRadius: 8,
        padding: '12px 16px',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
        background: '#fff',
      }}
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            background: `${stateColor}18`, color: stateColor, fontWeight: 600,
          }}>
            {resource.type}
          </span>
          <span style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            background: `${stateColor}18`, color: stateColor,
          }}>
            {STATE_LABELS[resource.state] ?? resource.state}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {resource.name}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#666', flexShrink: 0 }}>
          <span>调用: {resource.stats.totalCalls}</span>
          <span>成功率: {resource.stats.successRate}</span>
          <span>{resource.stats.avgLatencyMs}ms</span>
        </div>
      </div>

      {/* 健康度进度条 */}
      <div style={{ marginTop: 8, height: 4, background: '#f0f0f0', borderRadius: 2 }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, resource.healthScore))}%`,
          height: '100%',
          borderRadius: 2,
          background: resource.healthScore >= 70 ? '#4caf50' : resource.healthScore >= 30 ? '#ff9800' : '#f44336',
          transition: 'width 0.3s',
        }} />
      </div>

      {/* 标记 */}
      <div style={{ marginTop: 6, display: 'flex', gap: 8, fontSize: 11 }}>
        {resource.driftAlerts > 0 && (
          <span style={{ color: '#f44336' }}>⚠️ {resource.driftAlerts} 漂移</span>
        )}
        {resource.marginalDelta !== 'N/A' && (
          <span style={{ color: '#666' }}>边际: {resource.marginalDelta}</span>
        )}
      </div>

      {/* 展开：能力详情 */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>能力画像</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(resource.capabilities).map(([key, cap]) => (
              <span key={key} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: cap.value ? '#e8f5e9' : '#ffebee',
                color: cap.value ? '#2e7d32' : '#c62828',
              }}>
                {key}: {String(cap.value)}{cap.verified ? ' ✓' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ResourceProfilePanel() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch('/api/resource-profiles');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30_000); // 30s 刷新
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading) return <div style={{ padding: 20, color: '#999' }}>加载资源画像...</div>;
  if (error) return <div style={{ padding: 20, color: '#f44336' }}>加载失败: {error}</div>;
  if (!data) return null;

  const types = ['all', ...Object.keys(data.byType ?? {})];
  const filtered = filter === 'all'
    ? data.resources
    : data.resources.filter(r => r.type === filter);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>📊 资源画像</h3>
        <div style={{ fontSize: 12, color: '#666' }}>
          共 {data.total} 个资源
          {data.byState && Object.entries(data.byState).map(([state, count]) => (
            <span key={state} style={{ marginLeft: 8, color: STATE_COLORS[state] }}>
              {STATE_LABELS[state] ?? state}: {count}
            </span>
          ))}
        </div>
      </div>

      {/* 类型筛选 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {types.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 16, border: 'none',
              cursor: 'pointer',
              background: filter === t ? '#1976d2' : '#f0f0f0',
              color: filter === t ? '#fff' : '#333',
              transition: 'all 0.2s',
            }}
          >
            {t === 'all' ? '全部' : t} ({t === 'all' ? data.total : (data.byType?.[t] ?? 0)})
          </button>
        ))}
      </div>

      {/* 资源列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(r => (
          <ResourceCard key={r.id} resource={r} />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>无匹配资源</div>
        )}
      </div>
    </div>
  );
}
