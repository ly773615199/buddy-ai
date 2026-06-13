// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
/**
 * 专家商城前端组件
 *
 * 展示可用的三进制领域专家模型，
 * 支持浏览、安装、卸载、启用/禁用。
 * 已接入后端 REST API + WS 实时事件。
 */

import { useState, useEffect, useCallback } from 'react';
import { t } from '../i18n/t';
import type { ExpertModel } from '../types/buddy';


interface ExpertsProps {
  /** 从 WS 接收的实时专家列表 */
  wsExperts?: ExpertModel[];
  /** WS 训练进度 */
  trainProgress?: Record<string, {step: number;total: number;loss: number;}>;
  /** REST API base（默认从当前 host 推断） */
  apiBase?: string;
}

interface InstallState {
  domain: string;
  status: 'idle' | 'installing' | 'uninstalling';
  progress: number;
  message: string;
}

// ── 成长阶段配置（工厂函数，延迟 t() 到组件作用域）──

function getStageConfig(t: (key: string) => string) {
  return {
    seed: { emoji: '🌱', label: "\u79CD\u5B50", color: '#8BC34A' },
    sprout: { emoji: '🌿', label: "\u840C\u82BD", color: '#4CAF50' },
    growing: { emoji: '🌳', label: "\u6210\u957F\u4E2D", color: '#2196F3' },
    trainable: { emoji: '🔬', label: "\u53EF\u8BAD\u7EC3", color: '#9C27B0' },
    mature: { emoji: '🏆', label: "\u6210\u719F", color: '#FF9800' }
  };
}

// ── Token 获取 ──

async function getApiHeaders(): Promise<HeadersInit> {
  try {
    const base = window.location.protocol === 'https:' ? `https://${window.location.host}` : `http://${window.location.host}`;
    const res = await fetch(`${base}/api/ws-token`);
    const data = await res.json();
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` };
  } catch {
    return { 'Content-Type': 'application/json' };
  }
}

// ── 主组件 ──

export default function Experts({
  wsExperts, trainProgress, apiBase }: ExpertsProps) {

  const STAGE_CONFIG = getStageConfig(t);
  const [experts, setExperts] = useState<ExpertModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [selectedExpert, setSelectedExpert] = useState<ExpertModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = apiBase || `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.host}`;

  // 加载专家列表（REST API）
  const loadExperts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getApiHeaders();
      const res = await fetch(`${base}/api/ternary/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExperts(data.models || data || []);
    } catch (err: any) {
      console.error('Failed to load experts:', err);
      setError("\u65E0\u6CD5\u52A0\u8F7D\u4E13\u5BB6\u5217\u8868\uFF0C\u8BF7\u786E\u8BA4\u540E\u7AEF\u5DF2\u542F\u52A8");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {loadExperts();}, [loadExperts]);

  // WS 推送的专家列表实时更新
  useEffect(() => {
    if (wsExperts && wsExperts.length > 0) {
      setExperts(wsExperts);
      setLoading(false);
    }
  }, [wsExperts]);

  // 安装
  const handleInstall = useCallback(async (expert: ExpertModel) => {
    setInstallStates((prev) => ({
      ...prev,
      [expert.domain]: { domain: expert.domain, status: 'installing', progress: 10, message: "\u8FDE\u63A5\u5546\u57CE..." }
    }));

    try {
      const headers = await getApiHeaders();
      const res = await fetch(`${base}/api/ternary/install/${encodeURIComponent(expert.domain)}`, {
        method: 'POST', headers
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setInstallStates((prev) => ({
        ...prev,
        [expert.domain]: { ...prev[expert.domain], progress: 100, message: "\u5B89\u88C5\u5B8C\u6210" }
      }));

      // 重新加载列表
      await loadExperts();
    } catch (err: any) {
      setInstallStates((prev) => ({
        ...prev,
        [expert.domain]: { ...prev[expert.domain], status: 'idle', message: `${"\u5B89\u88C5\u5931\u8D25"}: ${err.message}` }
      }));
    }

    setTimeout(() => {
      setInstallStates((prev) => {
        const next = { ...prev };
        delete next[expert.domain];
        return next;
      });
    }, 2000);
  }, [base, loadExperts]);

  // 卸载
  const handleUninstall = useCallback(async (expert: ExpertModel) => {
    setInstallStates((prev) => ({
      ...prev,
      [expert.domain]: { domain: expert.domain, status: 'uninstalling', progress: 50, message: "\u5378\u8F7D\u4E2D..." }
    }));

    try {
      const headers = await getApiHeaders();
      const res = await fetch(`${base}/api/ternary/uninstall/${encodeURIComponent(expert.domain)}`, {
        method: 'POST', headers
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadExperts();
    } catch (err: any) {
      console.error('Uninstall failed:', err);
    }

    setInstallStates((prev) => {
      const next = { ...prev };
      delete next[expert.domain];
      return next;
    });
  }, [base, loadExperts]);

  // 启用/禁用
  const handleToggle = useCallback(async (expert: ExpertModel) => {
    try {
      const headers = await getApiHeaders();
      const action = expert.enabled ? 'disable' : 'enable';
      await fetch(`${base}/api/ternary/${action}/${encodeURIComponent(expert.domain)}`, {
        method: 'POST', headers
      });
      // 乐观更新
      setExperts((prev) => prev.map((e) =>
      e.domain === expert.domain ? { ...e, enabled: !e.enabled } : e
      ));
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }, [base]);

  // 过滤 + 搜索
  const filtered = experts.filter((e) => {
    if (filter === 'installed' && !e.installed) return false;
    if (filter === 'available' && e.installed) return false;
    if (filter === 'enabled' && !e.enabled) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return e.name.toLowerCase().includes(q) ||
      e.domain.toLowerCase().includes(q) ||
      (e.tags || []).some((t) => t.includes(q));
    }
    return true;
  });

  // ── 渲染 ──

  return (
    <div style={styles.container}>
      {/* 标题 */}
      <div style={styles.header}>
        <h2 style={styles.title}>{"\uD83E\uDDE0 \u4E13\u5BB6\u5546\u57CE"}</h2>
        <p style={styles.subtitle}>{"\u5B89\u88C5\u9886\u57DF\u4E13\u5BB6\u6A21\u578B\uFF0C\u8BA9 Buddy \u66F4\u61C2\u4F60"}</p>
      </div>

      {/* 错误提示 */}
      {error &&
      <div style={styles.errorBar}>
          ⚠️ {error}
          <button onClick={loadExperts} style={styles.retryBtn}>{"\u91CD\u8BD5"}</button>
        </div>
      }

      {/* 搜索 + 过滤 */}
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder={"\u641C\u7D22\u4E13\u5BB6..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput} />
        
        <div style={styles.filters}>
          {[
          { key: 'all', label: "\u5168\u90E8" },
          { key: 'installed', label: "\u5DF2\u5B89\u88C5" },
          { key: 'available', label: "\u53EF\u5B89\u88C5" },
          { key: 'enabled', label: "\u5DF2\u542F\u7528" }].
          map((f) =>
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              ...styles.filterBtn,
              ...(filter === f.key ? styles.filterBtnActive : {})
            }}>
            
              {f.label}
            </button>
          )}
        </div>
      </div>

      {/* 专家列表 */}
      {loading ?
      <div style={styles.loading}>{"\u52A0\u8F7D\u4E2D..."}</div> :
      filtered.length === 0 ?
      <div style={styles.loading}>{"\u6682\u65E0\u4E13\u5BB6\u6A21\u578B"}</div> :

      <div style={styles.grid}>
          {filtered.map((expert) => {
          const stage = STAGE_CONFIG[expert.growthStage] ?? STAGE_CONFIG.seed;
          const installState = installStates[expert.domain];
          const training = trainProgress?.[expert.domain];
          const isBusy = installState != null;

          return (
            <div
              key={expert.domain}
              style={styles.card}
              onClick={() => setSelectedExpert(expert)}>
              
                {/* 卡片头部 */}
                <div style={styles.cardHeader}>
                  <span style={styles.stageEmoji}>{stage.emoji}</span>
                  <div>
                    <h3 style={styles.cardTitle}>{expert.name}</h3>
                    <span style={{ ...styles.stageBadge, backgroundColor: stage.color }}>
                      {stage.label}
                    </span>
                  </div>
                </div>

                {/* 描述 */}
                <p style={styles.cardDesc}>{expert.description}</p>

                {/* 标签 */}
                <div style={styles.tagRow}>
                  {(expert.tags || []).map((tag) =>
                <span key={tag} style={styles.tag}>#{tag}</span>
                )}
                </div>

                {/* 元信息 */}
                <div style={styles.metaRow}>
                  <span>📐 {expert.architecture}</span>
                  <span>📊 {expert.trainSteps} {"\u6B65"}</span>
                  <span>💾 {expert.fileSize}</span>
                </div>

                {/* 训练进度条 */}
                {training &&
              <div style={styles.trainBar}>
                    <div style={styles.progressWrap}>
                      <div style={{
                    ...styles.progressBar,
                    width: `${training.total > 0 ? training.step / training.total * 100 : 0}%`
                  }} />
                      <span style={styles.progressText}>{t('训练中 {{step}}/{{total}} (loss: {{loss}})', { step: training.step, total: training.total, loss: training.loss })}</span>
                    </div>
                  </div>
              }

                {/* 操作按钮 */}
                <div style={styles.cardActions}>
                  {isBusy ?
                <div style={styles.progressWrap}>
                      <div style={{ ...styles.progressBar, width: `${installState.progress}%` }} />
                      <span style={styles.progressText}>{installState.message}</span>
                    </div> :
                expert.installed ?
                <>
                      <button
                    onClick={(e) => {e.stopPropagation();handleToggle(expert);}}
                    style={{
                      ...styles.toggleBtn,
                      backgroundColor: expert.enabled ? '#4CAF50' : '#9E9E9E'
                    }}>
                    
                        {expert.enabled ? "\u2713 \u5DF2\u542F\u7528" : "\u25CB \u672A\u542F\u7528"}
                      </button>
                      <button
                    onClick={(e) => {e.stopPropagation();handleUninstall(expert);}}
                    style={styles.uninstallBtn}>
                    {"\u5378\u8F7D"}</button>
                    </> :

                <button
                  onClick={(e) => {e.stopPropagation();handleInstall(expert);}}
                  style={styles.installBtn}>
                  {"\u5B89\u88C5"}</button>
                }
                </div>
              </div>);

        })}
        </div>
      }

      {/* 详情面板 */}
      {selectedExpert &&
      <div style={styles.overlay} onClick={() => setSelectedExpert(null)}>
          <div style={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
            <button style={styles.closeBtn} onClick={() => setSelectedExpert(null)}>✕</button>
            <h2>{STAGE_CONFIG[selectedExpert.growthStage]?.emoji} {selectedExpert.name}</h2>
            <p>{selectedExpert.description}</p>
            <div style={styles.detailGrid}>
              <div><strong>{"\u9886\u57DF\uFF1A"}</strong>{selectedExpert.domain}</div>
              <div><strong>{"\u67B6\u6784\uFF1A"}</strong>{selectedExpert.architecture}</div>
              <div><strong>{"\u7248\u672C\uFF1A"}</strong>{selectedExpert.version}</div>
              <div><strong>{"\u4F5C\u8005\uFF1A"}</strong>{selectedExpert.author}</div>
              <div><strong>{"\u8BAD\u7EC3\u6B65\u6570\uFF1A"}</strong>{selectedExpert.trainSteps}</div>
              <div><strong>{"\u5927\u5C0F\uFF1A"}</strong>{selectedExpert.fileSize}</div>
              <div><strong>{"\u9636\u6BB5\uFF1A"}</strong>{STAGE_CONFIG[selectedExpert.growthStage]?.label}</div>
              <div><strong>{"\u72B6\u6001\uFF1A"}</strong>{selectedExpert.installed ? selectedExpert.enabled ? '已启用' : '已安装' : '未安装'}</div>
            </div>
          </div>
        </div>
      }
    </div>);

}

// ── 样式 ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  header: { marginBottom: '20px' },
  title: { margin: 0, fontSize: '24px', color: '#1a1a1a' },
  subtitle: { margin: '4px 0 0', color: '#666', fontSize: '14px' },
  errorBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8,
    color: '#856404', fontSize: 13, marginBottom: 12
  },
  retryBtn: {
    marginLeft: 'auto', padding: '4px 12px', borderRadius: 4,
    border: '1px solid #856404', background: 'transparent', cursor: 'pointer',
    color: '#856404', fontSize: 12
  },
  toolbar: { display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' },
  searchInput: {
    flex: 1, minWidth: '200px', padding: '8px 12px', borderRadius: '8px',
    border: '1px solid #ddd', fontSize: '14px', outline: 'none'
  },
  filters: { display: 'flex', gap: '6px' },
  filterBtn: {
    padding: '6px 14px', borderRadius: '16px', border: '1px solid #ddd',
    backgroundColor: '#fff', cursor: 'pointer', fontSize: '13px', transition: 'all 0.2s'
  },
  filterBtnActive: { backgroundColor: '#1a73e8', color: '#fff', borderColor: '#1a73e8' },
  loading: { textAlign: 'center', padding: '40px', color: '#999' },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px'
  },
  card: {
    border: '1px solid #e8e8e8', borderRadius: '12px', padding: '16px',
    cursor: 'pointer', transition: 'box-shadow 0.2s, transform 0.2s',
    backgroundColor: '#fff'
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' },
  stageEmoji: { fontSize: '32px' },
  cardTitle: { margin: 0, fontSize: '16px', color: '#1a1a1a' },
  stageBadge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
    color: '#fff', fontSize: '11px', marginTop: '2px'
  },
  cardDesc: { margin: '8px 0', fontSize: '13px', color: '#555', lineHeight: '1.4' },
  tagRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' },
  tag: { fontSize: '12px', color: '#1a73e8', backgroundColor: '#e8f0fe', padding: '2px 8px', borderRadius: '10px' },
  metaRow: { display: 'flex', gap: '12px', fontSize: '12px', color: '#888', marginBottom: '12px' },
  cardActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  trainBar: { marginBottom: 8 },
  installBtn: {
    padding: '6px 20px', borderRadius: '6px', border: 'none',
    backgroundColor: '#1a73e8', color: '#fff', cursor: 'pointer', fontSize: '13px'
  },
  toggleBtn: {
    padding: '6px 14px', borderRadius: '6px', border: 'none',
    color: '#fff', cursor: 'pointer', fontSize: '13px'
  },
  uninstallBtn: {
    padding: '6px 14px', borderRadius: '6px', border: '1px solid #ddd',
    backgroundColor: '#fff', color: '#d32f2f', cursor: 'pointer', fontSize: '13px'
  },
  progressWrap: {
    position: 'relative', flex: 1, height: '28px', backgroundColor: '#f0f0f0',
    borderRadius: '6px', overflow: 'hidden'
  },
  progressBar: { position: 'absolute', height: '100%', backgroundColor: '#1a73e8', transition: 'width 0.3s' },
  progressText: { position: 'absolute', width: '100%', textAlign: 'center', lineHeight: '28px', fontSize: '12px', color: '#333' },
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 1000
  },
  detailPanel: {
    backgroundColor: '#fff', borderRadius: '16px', padding: '24px',
    maxWidth: '500px', width: '90%', position: 'relative'
  },
  closeBtn: {
    position: 'absolute', top: '12px', right: '12px', border: 'none',
    backgroundColor: 'transparent', fontSize: '18px', cursor: 'pointer', color: '#999'
  },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px', fontSize: '14px' }
};