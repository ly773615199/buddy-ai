// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
/**
 * 认知仪表盘 — Phase 5
 *
 * 显示 Buddy 的认知状态：
 * - 领域知识概览
 * - 经验图谱统计
 * - 梦境日志
 * - 已安装 Skill 列表
 * - LoRA 权重状态
 * - 并发控制状态（自适应车道）
 */

import { useState, useEffect, useCallback } from 'react';
import { t } from '../i18n/t';


interface DomainInfo {
  domain: string;
  growthStage: string;
  knowledgeCount: number;
  depthScore: number;
}

interface SkillInfo {
  name: string;
  description: string;
  version: string;
}

interface DreamLog {
  journal: string;
  timestamp: number;
}

interface ConcurrencyStatus {
  running: number;
  pending: number;
  maxConcurrent: number;
  adaptive: boolean;
  limiter: {
    currentLimit: number;
    minRTT: number;
    avgRTT: number;
    sampleCount: number;
    lastScaleAction: 'up' | 'down' | 'none';
    lastScaleActionAt: number;
    algorithm: string;
  } | null;
}

interface CognitiveDashboardProps {
  ws: WebSocket | null;
  connected: boolean;
  apiBase?: string;
  skills?: SkillInfo[];
}

export function CognitiveDashboard({
  ws, connected, apiBase = '', skills: externalSkills }: CognitiveDashboardProps) {

  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [dreamLogs, setDreamLogs] = useState<DreamLog[]>([]);
  const [concurrency, setConcurrency] = useState<ConcurrencyStatus | null>(null);
  const [modelPool, setModelPool] = useState<{
    initialized: boolean;
    modelCount: number;
    models: Array<{
      id: string;displayName: string;tier: string;
      capabilities: Record<string, unknown>;
      stats: {totalCalls: number;successes: number;avgLatencyMs: number;byTaskType: Record<string, {attempts: number;successes: number;}>;};
      costPer1kInput: number;
    }>;
    preferences: Record<string, unknown>;
    thompsonParams: Record<string, {alpha: number;beta: number;}>;
  } | null>(null);
  const [modelDecisions, setModelDecisions] = useState<Array<{
    modelId: string;displayName: string;tier: string;reason: string;
    layer: number;candidateCount: number;taskType: string;timestamp: number;
  }>>([]);
  const [activeTab, setActiveTab] = useState<'domains' | 'skills' | 'dreams' | 'system' | 'models'>('domains');

  // 监听 WS 事件
  useEffect(() => {
    if (!ws) return;

    const handler = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        switch (event.type) {
          case 'dream_complete':
            setDreamLogs((prev) => [{
              journal: event.journal,
              timestamp: event.timestamp
            }, ...prev].slice(0, 20));
            break;
          case 'domain_mature':
            setDomains((prev) => {
              const idx = prev.findIndex((d) => d.domain === event.domain);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], growthStage: 'mature', knowledgeCount: event.knowledgeCount };
                return updated;
              }
              return prev;
            });
            break;
          case 'model_decision':
            setModelDecisions((prev) => [{
              modelId: event.modelId,
              displayName: event.displayName,
              tier: event.tier,
              reason: event.reason,
              layer: event.layer,
              candidateCount: event.candidateCount,
              taskType: event.taskType,
              timestamp: event.timestamp
            }, ...prev].slice(0, 20));
            break;
        }
      } catch {/* ignore */}
    };

    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws]);

  // 获取模型池状态
  const fetchModelPool = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/model-pool`);
      if (res.ok) {
        const data = await res.json();
        setModelPool(data);
      }
    } catch {/* ignore */}
  }, [apiBase]);

  useEffect(() => {
    fetchModelPool();
  }, [fetchModelPool]);

  // 定期轮询并发状态
  const fetchConcurrency = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/concurrency`);
      if (res.ok) {
        const data = await res.json();
        setConcurrency(data);
      }
    } catch {/* ignore */}
  }, [apiBase]);

  useEffect(() => {
    fetchConcurrency();
    const timer = setInterval(fetchConcurrency, 5000); // 每 5 秒刷新
    return () => clearInterval(timer);
  }, [fetchConcurrency]);

  const stageEmoji: Record<string, string> = {
    seed: '🌱', sprout: '🌿', growing: '🌳', mature: '🎯'
  };

  const stageLabel: Record<string, string> = {
    seed: "\u79CD\u5B50", sprout: "\u840C\u82BD", growing: "\u6210\u957F", mature: "\u7CBE\u901A"
  };

  return (
    <div style={{
      background: 'rgba(0,0,0,0.3)',
      borderRadius: 12,
      padding: 16,
      color: '#e0e0e0',
      fontSize: 13
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#58a6ff' }}>{"\uD83E\uDDE0 \u8BA4\u77E5\u4EEA\u8868\u76D8"}</h3>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
        { key: 'domains' as const, label: "\uD83D\uDCDA \u9886\u57DF\u77E5\u8BC6" },
        { key: 'skills' as const, label: "\uD83D\uDD27 \u5DE5\u5177 Skill" },
        { key: 'dreams' as const, label: "\uD83D\uDCAD \u68A6\u5883\u65E5\u5FD7" },
        { key: 'system' as const, label: "\uD83D\uDE97 \u5E76\u53D1\u63A7\u5236" },
        { key: 'models' as const, label: "\uD83E\uDDE0 \u6A21\u578B\u51B3\u7B56" }].
        map((tab) =>
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          style={{
            background: activeTab === tab.key ? 'rgba(88,166,255,0.2)' : 'transparent',
            border: `1px solid ${activeTab === tab.key ? '#58a6ff' : '#444'}`,
            borderRadius: 6,
            padding: '4px 10px',
            color: activeTab === tab.key ? '#58a6ff' : '#999',
            cursor: 'pointer',
            fontSize: 12
          }}>
          
            {tab.label}
          </button>
        )}
      </div>

      {/* 领域知识 */}
      {activeTab === 'domains' &&
      <div>
          {domains.length === 0 ?
        <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u6682\u65E0\u9886\u57DF\u77E5\u8BC6\uFF0C\u5F00\u59CB\u5BF9\u8BDD\u540E\u81EA\u52A8\u79EF\u7D2F"}</p> :

        domains.map((d) =>
        <div key={d.domain} style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', padding: '6px 0',
          borderBottom: '1px solid #333'
        }}>
                <span>
                  {stageEmoji[d.growthStage] ?? '❓'} {d.domain}
                </span>
                <span style={{ color: '#888', fontSize: 11 }}>
                  {stageLabel[d.growthStage] ?? d.growthStage} · {d.knowledgeCount} {"\u6761"}
                </span>
              </div>
        )
        }
        </div>
      }

      {/* 工具 Skill */}
      {activeTab === 'skills' &&
      <div>
          {(externalSkills ?? []).length === 0 ?
        <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u6682\u65E0\u52A8\u6001\u52A0\u8F7D\u7684 Skill"}</p> :

        (externalSkills ?? []).map((s) =>
        <div key={s.name} style={{
          padding: '6px 0', borderBottom: '1px solid #333'
        }}>
                <strong style={{ color: '#7ee787' }}>{s.name}</strong>
                <span style={{ color: '#888', marginLeft: 8 }}>{s.description}</span>
              </div>
        )
        }
        </div>
      }

      {/* 梦境日志 */}
      {activeTab === 'dreams' &&
      <div>
          {dreamLogs.length === 0 ?
        <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u6682\u65E0\u68A6\u5883\u8BB0\u5F55"}</p> :

        dreamLogs.map((d, i) =>
        <div key={i} style={{
          padding: '8px 0', borderBottom: '1px solid #333'
        }}>
                <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>
                  {new Date(d.timestamp).toLocaleString('zh-CN')}
                </div>
                <div style={{ lineHeight: 1.5 }}>
                  {d.journal.slice(0, 150)}{d.journal.length > 150 ? '...' : ''}
                </div>
              </div>
        )
        }
        </div>
      }

      {/* 并发控制状态 */}
      {activeTab === 'system' &&
      <div>
          {!concurrency ?
        <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u52A0\u8F7D\u4E2D..."}</p> :

        <div>
              {/* 核心指标 */}
              <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8, marginBottom: 12
          }}>
                <MetricCard
              label={"\u5F53\u524D\u8F66\u9053"}
              value={`${concurrency.running}/${concurrency.limiter?.currentLimit ?? concurrency.maxConcurrent}`}
              color="#58a6ff" />
            
                <MetricCard
              label={"\u6392\u961F\u7B49\u5F85"}
              value={String(concurrency.pending)}
              color={concurrency.pending > 0 ? '#d29922' : '#7ee787'} />
            
                <MetricCard
              label={"\u6A21\u5F0F"}
              value={concurrency.adaptive ? "\u81EA\u9002\u5E94" : "\u56FA\u5B9A"}
              color={concurrency.adaptive ? '#7ee787' : '#888'} />
            
              </div>

              {/* 自适应详情 */}
              {concurrency.limiter &&
          <div style={{
            background: 'rgba(88,166,255,0.05)',
            borderRadius: 8, padding: 10, marginBottom: 8
          }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#888' }}>{"\u7B97\u6CD5"}</span>
                    <span>{concurrency.limiter.algorithm}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#888' }}>{"\u57FA\u51C6\u5EF6\u8FDF (minRTT)"}</span>
                    <span>{concurrency.limiter.minRTT > 0 ? `${concurrency.limiter.minRTT.toFixed(0)}ms` : "\u91C7\u96C6\u4E2D..."}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#888' }}>{"\u5E73\u5747\u5EF6\u8FDF (avgRTT)"}</span>
                    <span>{concurrency.limiter.avgRTT > 0 ? `${concurrency.limiter.avgRTT.toFixed(0)}ms` : "\u91C7\u96C6\u4E2D..."}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#888' }}>{"\u91C7\u6837\u6B21\u6570"}</span>
                    <span>{concurrency.limiter.sampleCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>{"\u6700\u8FD1\u8C03\u6574"}</span>
                    <span>
                      {concurrency.limiter.lastScaleAction === 'up' && '📈 ' + "\u52A0\u901F"}
                      {concurrency.limiter.lastScaleAction === 'down' && '📉 ' + "\u51CF\u901F"}
                      {concurrency.limiter.lastScaleAction === 'none' && '➖ ' + "\u7A33\u5B9A"}
                    </span>
                  </div>
                </div>
          }

              {/* 车道可视化 */}
              <LaneVisualizer
            running={concurrency.running}
            limit={concurrency.limiter?.currentLimit ?? concurrency.maxConcurrent} />
          
            </div>
        }
        </div>
      }

      {/* 模型决策 Tab */}
      {activeTab === 'models' &&
      <div>
          {/* 模型池概览 */}
          {modelPool && modelPool.initialized ?
        <div>
              {/* 指标卡 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <MetricCard label={"\u6A21\u578B\u603B\u6570"} value={String(modelPool.modelCount)} color="#a371f7" />
                <MetricCard label={"\u4ECA\u65E5\u51B3\u7B56"} value={String(modelDecisions.length)} color="#58a6ff" />
                <MetricCard label={"\u7B56\u7565"} value={String(modelPool.preferences?.strategy ?? 'task_match')} color="#7ee787" />
              </div>

              {/* 最近决策记录 */}
              <div style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 600, marginBottom: 8 }}>{"\u26A1 \u6700\u8FD1\u6A21\u578B\u9009\u62E9"}</div>
              {modelDecisions.length === 0 ?
          <p style={{ color: '#666', fontStyle: 'italic', fontSize: 12 }}>{"\u6682\u65E0\u51B3\u7B56\u8BB0\u5F55\uFF0C\u5F00\u59CB\u5BF9\u8BDD\u540E\u81EA\u52A8\u8BB0\u5F55"}</p> :

          modelDecisions.map((d, i) =>
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '5px 0', borderBottom: '1px solid #222', fontSize: 11
          }}>
                    <span style={{ color: '#a371f7' }}>🧠 {d.displayName}</span>
                    <span style={{ color: '#888' }}>[{d.tier}] L{d.layer} · {d.candidateCount}{"\u5019\u9009"}</span>
                    <span style={{ color: '#666' }}>#{d.taskType}</span>
                    <span style={{ color: '#555' }}>{new Date(d.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
          )
          }

              {/* 模型池列表 */}
              <div style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 600, margin: '12px 0 8px' }}>{t('🏊 活跃模型池（{{count}}）', { count: modelPool.models.length })}</div>
              {modelPool.models.slice(0, 20).map((m) => {
            const tsKey = Object.keys(modelPool.thompsonParams).find((k) => k.includes(m.id));
            const ts = tsKey ? modelPool.thompsonParams[tsKey] : null;
            const successRate = m.stats.totalCalls > 0 ?
            (m.stats.successes / m.stats.totalCalls * 100).toFixed(0) :
            '-';
            return (
              <div key={m.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', borderBottom: '1px solid #1a1a1a', fontSize: 11
              }}>
                    <span style={{ color: '#e0e0e0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.displayName}
                    </span>
                    <span style={{ color: '#888', marginLeft: 8, flexShrink: 0 }}>
                      [{m.tier}]
                    </span>
                    <span style={{ color: m.stats.totalCalls > 0 ? '#7ee787' : '#555', marginLeft: 8, flexShrink: 0 }}>
                      {successRate}%
                    </span>
                    <span style={{ color: '#888', marginLeft: 8, flexShrink: 0 }}>
                      {m.stats.totalCalls}{"\u6B21"}
                    </span>
                    {ts &&
                <span style={{ color: '#a371f7', marginLeft: 8, flexShrink: 0, fontSize: 10 }}>
                        α={ts.alpha.toFixed(1)} β={ts.beta.toFixed(1)}
                      </span>
                }
                    {m.costPer1kInput > 0 &&
                <span style={{ color: '#d29922', marginLeft: 8, flexShrink: 0 }}>
                        ¥{m.costPer1kInput}/k
                      </span>
                }
                  </div>);

          })}
              {modelPool.models.length > 20 &&
          <div style={{ color: '#555', fontSize: 10, marginTop: 4 }}>{t('...还有 {{count}} 个模型', { count: modelPool.models.length - 20 })}</div>
          }
            </div> :

        <p style={{ color: '#666', fontStyle: 'italic' }}>
              {modelPool === null ? "\u52A0\u8F7D\u4E2D..." : "\u7EDF\u4E00\u6A21\u578B\u6C60\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5728\u914D\u7F6E\u4E2D\u6DFB\u52A0 models.providers"}
            </p>
        }
        </div>
      }

      {/* 连接状态 */}
      <div style={{
        marginTop: 12, paddingTop: 8,
        borderTop: '1px solid #333',
        fontSize: 11, color: '#666'
      }}>
        {connected ? '🟢 ' + t("\u5DF2\u8FDE\u63A5") : '🔴 ' + t("\u672A\u8FDE\u63A5")}
      </div>
    </div>);

}

/** 小型指标卡片 */
function MetricCard({ label, value, color }: {label: string;value: string;color: string;}) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.2)',
      borderRadius: 8, padding: '8px 10px',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{label}</div>
    </div>);

}

/** 车道可视化条 */
function LaneVisualizer({ running, limit }: {running: number;limit: number;}) {
  const lanes = [];
  for (let i = 0; i < limit; i++) {
    lanes.push(
      <div
        key={i}
        style={{
          flex: 1,
          height: 24,
          borderRadius: 4,
          background: i < running ?
          'linear-gradient(135deg, #58a6ff, #3b82f6)' :
          'rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: i < running ? '#fff' : '#555',
          transition: 'all 0.3s ease'
        }}>
        
        {i < running ? '🚗' : '·'}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{"\u8F66\u9053\u72B6\u6001\uFF08{running} \u5728\u8DD1 / {limit} \u603B\u5BB9\u91CF\uFF09"}</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {lanes}
      </div>
    </div>);

}