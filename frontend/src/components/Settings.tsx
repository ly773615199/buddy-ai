// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useCallback, useEffect } from 'react';
import { t } from '../i18n/t';
import { getRegisteredLanguages, getAvailableLanguages, registerLanguage, changeLanguage } from '../i18n/index';

// ==================== Types ====================

interface SettingsProps {
  primaryColor?: string;
  language?: string;
  onLanguageChange?: (lang: string) => void;
}

type SettingsTab = 'models' | 'tools' | 'behavior' | 'appearance' | 'platform' | 'data';

// ==================== Component ====================

export default function Settings({ primaryColor = '#58a6ff', language = 'zh-CN', onLanguageChange }: SettingsProps) {

  const [activeTab, setActiveTab] = useState<SettingsTab>('models');

  // Behavior State
  const [replyStyle, setReplyStyle] = useState(() => localStorage.getItem('buddy_reply_style') || 'balanced');
  const [confirmStrategy, setConfirmStrategy] = useState(() => localStorage.getItem('buddy_confirm_strategy') || 'dangerous');

  // Appearance State
  const [theme, setTheme] = useState(() => localStorage.getItem('buddy_theme') || 'dark');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('buddy_font_size') || 'medium');

  // Save behavior
  useEffect(() => {
    localStorage.setItem('buddy_reply_style', replyStyle);
  }, [replyStyle]);

  useEffect(() => {
    localStorage.setItem('buddy_confirm_strategy', confirmStrategy);
  }, [confirmStrategy]);

  // Save appearance
  useEffect(() => {
    localStorage.setItem('buddy_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('buddy_font_size', fontSize);
    const sizes = { small: '13px', medium: '14px', large: '16px' };
    document.documentElement.style.setProperty('--buddy-font-size', sizes[fontSize as keyof typeof sizes] || '14px');
  }, [fontSize]);

  // ==================== Tabs ====================

  const tabs: {key: SettingsTab;icon: string;label: string;}[] = [
  { key: 'models', icon: '🏊', label: "\u6A21\u578B\u6C60" },
  { key: 'tools', icon: '🔧', label: "\u5DE5\u5177\u7AEF\u70B9" },
  { key: 'behavior', icon: '🎯', label: "\u884C\u4E3A\u8BBE\u7F6E" },
  { key: 'appearance', icon: '🎨', label: "\u5916\u89C2\u8BBE\u7F6E" },
  { key: 'platform', icon: '📡', label: "\u5E73\u53F0\u8BBE\u7F6E" },
  { key: 'data', icon: '💾', label: "\u6570\u636E\u7BA1\u7406" }];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto' }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {tabs.map((tab) =>
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11,
            background: activeTab === tab.key ? `${primaryColor}22` : '#21262d',
            color: activeTab === tab.key ? primaryColor : '#8b949e',
            border: `1px solid ${activeTab === tab.key ? primaryColor : '#30363d'}`,
            fontFamily: 'inherit',
            transition: 'all 0.15s'
          }}>
          
            {tab.icon} {tab.label}
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === 'models' &&
      <ModelsSection apiBase="" primaryColor={primaryColor} />
      }
      {activeTab === 'tools' &&
      <CustomToolsSection apiBase="" primaryColor={primaryColor} />
      }
      {activeTab === 'behavior' &&
      <BehaviorSection
        replyStyle={replyStyle}
        setReplyStyle={setReplyStyle}
        confirmStrategy={confirmStrategy}
        setConfirmStrategy={setConfirmStrategy}
        primaryColor={primaryColor} />

      }
      {activeTab === 'appearance' &&
      <AppearanceSection
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        primaryColor={primaryColor}
        language={language}
        onLanguageChange={onLanguageChange} />

      }
      {activeTab === 'platform' && <PlatformSection />}
      {activeTab === 'data' && <DataSection primaryColor={primaryColor} />}
    </div>);

}

// ==================== Models Section (统一模型池) ====================

interface ModelPoolModel {
  id: string;
  platform: string;
  displayName: string;
  tier: string;
  category?: string;
  active?: boolean;
  variantCount?: number;
  capabilities: Record<string, unknown>;
  stats: {totalCalls: number;successes: number;avgLatencyMs: number;};
  costPer1kInput: number;
  source: string;
  accessStatus?: 'unknown' | 'available' | 'denied' | 'broken';
  failureStreak?: number;
  failureType?: string | null;
}

function ModelsSection({ apiBase, primaryColor }: {apiBase: string;primaryColor: string;}) {
  const PROVIDERS_LIST = [
  { value: 'openai', label: 'OpenAI', icon: '🤖', defaultUrl: 'https://api.openai.com/v1', needKey: true, needUrl: false },
  { value: 'deepseek', label: 'DeepSeek', icon: '🔮', defaultUrl: 'https://api.deepseek.com/v1', needKey: true, needUrl: false },
  { value: 'anthropic', label: 'Anthropic', icon: '🧠', defaultUrl: '', needKey: true, needUrl: false },
  { value: 'google', label: 'Google', icon: '🔍', defaultUrl: '', needKey: true, needUrl: false },
  { value: 'siliconflow', label: "\u7845\u57FA\u6D41\u52A8", icon: '🌊', defaultUrl: 'https://api.siliconflow.cn/v1', needKey: true, needUrl: false },
  { value: 'openrouter', label: 'OpenRouter', icon: '🌐', defaultUrl: 'https://openrouter.ai/api/v1', needKey: true, needUrl: false },
  { value: 'mimo', label: 'MiMo', icon: '🤖', defaultUrl: 'https://api.xiaomimimo.com/v1', needKey: true, needUrl: false },
  { value: 'ollama', label: `Ollama (${t("\u672C\u5730")})`, icon: '🦙', defaultUrl: 'http://localhost:11434/v1', needKey: false, needUrl: true },
  { value: 'lmstudio', label: `LM Studio (${t("\u672C\u5730")})`, icon: '🏠', defaultUrl: 'http://localhost:1234/v1', needKey: false, needUrl: true },
  { value: 'custom', label: "\u81EA\u5B9A\u4E49", icon: '⚙️', defaultUrl: '', needKey: false, needUrl: true }];


  const [pool, setPool] = useState<{
    initialized: boolean;
    modelCount: number;
    activeCount: number;
    models: ModelPoolModel[];
    preferences: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [excludeInput, setExcludeInput] = useState('');
  const [inactiveExpanded, setInactiveExpanded] = useState(false);
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());

  // API 端点管理状态
  const [providers, setProviders] = useState<Array<{id: string;type: string;apiKey?: string;baseUrl?: string;}>>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [addProviderType, setAddProviderType] = useState('siliconflow');
  const [addProviderId, setAddProviderId] = useState('');
  const [addProviderKey, setAddProviderKey] = useState('');
  const [addProviderUrl, setAddProviderUrl] = useState('');
  const [addProviderCostInput, setAddProviderCostInput] = useState('');
  const [addProviderCostOutput, setAddProviderCostOutput] = useState('');
  const [providerLoading, setProviderLoading] = useState(false);
  const [providersFetching, setProvidersFetching] = useState(true);
  const [providerError, setProviderError] = useState('');

  // 带认证的 fetch（自动获取 WS token）
  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    try {
      const tokenRes = await fetch(`${apiBase}/api/ws-token`);
      const { token } = await tokenRes.json();
      return fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
    } catch {
      return fetch(url, init);
    }
  }, [apiBase]);

  const fetchPool = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/model-pool`);
      if (res.ok) setPool(await res.json());
    } catch {/* ignore */}
    setLoading(false);
  }, [apiBase]);

  // 从后端配置加载 providers 列表
  const fetchProviders = useCallback(async () => {
    setProvidersFetching(true);
    try {
      const res = await fetch(`${apiBase}/api/config`);
      if (res.ok) {
        const config = await res.json();
        // models.providers 来自后端配置
        setProviders(config.models?.providers ?? []);
      }
    } catch {/* ignore */}
    setProvidersFetching(false);
  }, [apiBase]);

  useEffect(() => {fetchPool();fetchProviders();}, [fetchPool, fetchProviders]);

  const addExclude = async () => {
    if (!excludeInput.trim()) return;
    await authFetch(`${apiBase}/api/model-pool/exclude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: excludeInput.trim() })
    });
    setExcludeInput('');
    fetchPool();
  };

  const removeExclude = async (pattern: string) => {
    await authFetch(`${apiBase}/api/model-pool/exclude`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern })
    });
    fetchPool();
  };

  const updateStrategy = async (strategy: string) => {
    await authFetch(`${apiBase}/api/model-pool/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy })
    });
    fetchPool();
  };

  // 切换单个模型激活状态
  const toggleModel = async (id: string, active: boolean) => {
    await authFetch(`${apiBase}/api/model-pool/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active })
    });
    fetchPool();
  };

  // 按平台批量激活
  const batchActivateByPlatform = async (platform: string) => {
    await authFetch(`${apiBase}/api/model-pool/batch-toggle-by-platform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, active: true })
    });
    fetchPool();
  };

  // 全部激活
  const batchActivateAll = async () => {
    const inactiveIds = pool?.models?.filter((m) => m.active === false).map((m) => m.id) ?? [];
    if (inactiveIds.length === 0) return;
    await authFetch(`${apiBase}/api/model-pool/batch-toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: inactiveIds, active: true })
    });
    fetchPool();
  };

  // 添加 API 端点
  const addProvider = async () => {
    if (!addProviderId.trim() || !addProviderType) return;
    setProviderLoading(true);
    setProviderError('');
    try {
      const res = await authFetch(`${apiBase}/api/model-pool/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: addProviderId.trim(),
          type: addProviderType,
          apiKey: addProviderKey.trim() || undefined,
          baseUrl: addProviderUrl.trim() || undefined,
          costPer1kInput: addProviderCostInput ? parseFloat(addProviderCostInput) : undefined,
          costPer1kOutput: addProviderCostOutput ? parseFloat(addProviderCostOutput) : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setProviderError(data.error || t("\u6DFB\u52A0\u5931\u8D25"));
      } else {
        setShowAddProvider(false);
        setAddProviderId('');
        setAddProviderKey('');
        setAddProviderUrl('');
        setAddProviderCostInput('');
        setAddProviderCostOutput('');
        fetchProviders();
        fetchPool();
      }
    } catch (err) {
      setProviderError((err as Error).message);
    }
    setProviderLoading(false);
  };

  // 删除 API 端点
  const removeProvider = async (id: string) => {
    setProviderLoading(true);
    try {
      await authFetch(`${apiBase}/api/model-pool/providers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchProviders();
      fetchPool();
    } catch {/* ignore */}
    setProviderLoading(false);
  };

  // Provider 类型选择时自动填充
  const handleProviderTypeChange = (type: string) => {
    setAddProviderType(type);
    const preset = PROVIDERS_LIST.find((p) => p.value === type);
    if (preset) {
      if (!addProviderId) setAddProviderId(preset.value);
      setAddProviderUrl(preset.defaultUrl);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d',
    background: '#0d1117', color: '#c9d1d9', fontSize: 12, fontFamily: 'inherit', outline: 'none'
  };

  const btnStyle = (color = primaryColor): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
    background: `${color}22`, color, border: `1px solid ${color}44`, fontFamily: 'inherit', transition: 'all 0.15s'
  });

  if (loading) return <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u52A0\u8F7D\u4E2D..."}</p>;

  const prefs = (pool?.preferences ?? {}) as Record<string, unknown>;
  const excluded = (prefs.excluded ?? []) as string[];
  const strategy = (prefs.strategy ?? 'task_match') as string;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>

      {/* ── 📡 API 端点管理 ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{"\uD83D\uDCE1 API \u7AEF\u70B9"}</span>
          <button
            style={btnStyle()}
            onClick={() => setShowAddProvider(!showAddProvider)}>
            
            {showAddProvider ? t("\u53D6\u6D88") : t("+ \u6DFB\u52A0 API \u7AEF\u70B9")}
          </button>
        </div>

        {/* 已添加的端点列表 */}
        {providersFetching ?
        <div style={{ color: '#555', fontSize: 11, padding: '8px 0' }}>{"\u52A0\u8F7D\u4E2D..."}</div> :
        providers.length === 0 && !showAddProvider ?
        <div style={{ color: '#555', fontSize: 11, padding: '8px 0' }}>{"\u6682\u65E0 API \u7AEF\u70B9\u3002\u6DFB\u52A0\u7AEF\u70B9\u540E\u7CFB\u7EDF\u5C06\u81EA\u52A8\u53D1\u73B0\u53EF\u7528\u6A21\u578B\u3002"}</div> :

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: showAddProvider ? 8 : 0 }}>
            {providers.map((p) => {
            // 查找该平台在模型池中的模型数
            const platformModels = pool?.models?.filter((m) => m.platform === p.id) ?? [];
            const hasKey = !!p.apiKey;
            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 6,
                background: '#0d1117', border: '1px solid #30363d'
              }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>
                      {p.type === 'siliconflow' ? '🌊' : p.type === 'ollama' ? '🦙' : p.type === 'lmstudio' ? '🏠' : p.type === 'openai' ? '🤖' : p.type === 'deepseek' ? '🔮' : p.type === 'anthropic' ? '🧠' : p.type === 'google' ? '🔍' : p.type === 'openrouter' ? '🌐' : '📡'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#c9d1d9', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.id}
                        <span style={{ color: '#666', fontWeight: 400, marginLeft: 6 }}>({p.type})</span>
                      </div>
                      <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
                        {hasKey ? `Key: ${p.apiKey!.slice(0, 6)}***` : t("\u65E0\u9700 Key")}
                        {platformModels.length > 0 && <span style={{ color: '#7ee787', marginLeft: 8 }}>✓ {platformModels.length} {t("\u4E2A\u6A21\u578B")}</span>}
                        {(p as any).costPer1kInput !== undefined && <span style={{ color: '#d29922', marginLeft: 8 }}>💰 ¥{(p as any).costPer1kInput}/k</span>}
                      </div>
                    </div>
                  </div>
                  <button
                  onClick={() => removeProvider(p.id)}
                  disabled={providerLoading}
                  style={{
                    background: 'none', border: 'none', color: '#f85149',
                    cursor: providerLoading ? 'not-allowed' : 'pointer', fontSize: 14, padding: '2px 6px',
                    opacity: providerLoading ? 0.4 : 1
                  }}
                  title={"\u5220\u9664\u7AEF\u70B9"}>
                  ×</button>
                </div>);

          })}
          </div>
        }

        {/* 添加端点表单 */}
        {showAddProvider && (() => {
          const selectedProv = PROVIDERS_LIST.find((p) => p.value === addProviderType);
          // 动态判断必填：Ollama 不需要 Key 需要 URL，Anthropic/Google 不需要 URL，Custom 都可选
          const showKeyField = selectedProv?.needKey ?? true;
          const showUrlField = selectedProv?.needUrl ?? false;
          const keyRequired = showKeyField;
          const urlRequired = showUrlField;
          const canSubmit = addProviderId.trim() && (
          !keyRequired || addProviderKey.trim()) && (
          !urlRequired || addProviderUrl.trim());

          return (
            <div style={{
              padding: 12, borderRadius: 8, background: '#161b22',
              border: `1px solid ${primaryColor}44`, display: 'flex', flexDirection: 'column', gap: 10
            }}>
              <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 500 }}>{"\u9009\u62E9 API \u63D0\u4F9B\u5546"}</div>
              {/* Provider 类型选择 */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PROVIDERS_LIST.map((p) =>
                <button
                  key={p.value}
                  onClick={() => handleProviderTypeChange(p.value)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    background: addProviderType === p.value ? `${primaryColor}22` : '#21262d',
                    color: addProviderType === p.value ? primaryColor : '#8b949e',
                    border: `1px solid ${addProviderType === p.value ? primaryColor : '#30363d'}`,
                    fontFamily: 'inherit', transition: 'all 0.15s'
                  }}>
                  
                    {p.icon} {p.label}
                  </button>
                )}
              </div>

              {/* 提示：当前 Provider 需要的字段 */}
              <div style={{ fontSize: 10, color: '#666', lineHeight: 1.5 }}>
                {showKeyField && !showUrlField && t("\u9700\u8981\uFF1AAPI Key + \u6A21\u578B\u540D\u79F0")}
                {!showKeyField && showUrlField && t("\u9700\u8981\uFF1ABase URL + \u6A21\u578B\u540D\u79F0\uFF08\u672C\u5730\u90E8\u7F72\uFF09")}
                {showKeyField && showUrlField && t("\u9700\u8981\uFF1AAPI Key + Base URL + \u6A21\u578B\u540D\u79F0")}
                {!showKeyField && !showUrlField && t("\u9700\u8981\uFF1A\u6A21\u578B\u540D\u79F0")}
              </div>

              {/* 表单字段：端点 ID（始终显示） */}
              <div>
                <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>
                  {"\u7AEF\u70B9 ID"} <span style={{ color: '#f85149' }}>*</span>
                </label>
                <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  value={addProviderId}
                  onChange={(e) => setAddProviderId(e.target.value)}
                  placeholder={selectedProv?.value || 'my-provider'} />
                
              </div>

              {/* API Key（按需显示） */}
              {showKeyField &&
              <div>
                  <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>
                    API Key {keyRequired && <span style={{ color: '#f85149' }}>*</span>}
                  </label>
                  <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  type="password"
                  value={addProviderKey}
                  onChange={(e) => setAddProviderKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxx" />
                
                </div>
              }

              {/* Base URL（按需显示） */}
              {showUrlField &&
              <div>
                  <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>
                    Base URL {urlRequired && <span style={{ color: '#f85149' }}>*</span>}
                  </label>
                  <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  value={addProviderUrl}
                  onChange={(e) => setAddProviderUrl(e.target.value)}
                  placeholder={selectedProv?.defaultUrl || 'http://localhost:11434/v1'} />
                
                </div>
              }

              {/* 高级：非 Ollama/Anthropic/Google 时可选展开 Base URL */}
              {!showUrlField && showKeyField &&
              <details style={{ fontSize: 11 }}>
                  <summary style={{ color: '#666', cursor: 'pointer' }}>{"\u2699\uFE0F \u9AD8\u7EA7\uFF1A\u81EA\u5B9A\u4E49 Base URL"}</summary>
                  <input
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 6 }}
                  value={addProviderUrl}
                  onChange={(e) => setAddProviderUrl(e.target.value)}
                  placeholder={selectedProv?.defaultUrl || 'https://...'} />
                
                </details>
              }

              {/* 可选：自定义定价覆盖 */}
              <details style={{ fontSize: 11 }}>
                <summary style={{ color: '#666', cursor: 'pointer' }}>{"\uD83D\uDCB0 \u81EA\u5B9A\u4E49\u5B9A\u4EF7\uFF08\u53EF\u9009\uFF0C\xA5/\u5343token\uFF09"}</summary>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>{"\u8F93\u5165\u4EF7\u683C"}</label>
                    <input
                      style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                      type="number"
                      step="0.001"
                      min="0"
                      value={addProviderCostInput}
                      onChange={(e) => setAddProviderCostInput(e.target.value)}
                      placeholder="0.001" />
                    
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>{"\u8F93\u51FA\u4EF7\u683C"}</label>
                    <input
                      style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                      type="number"
                      step="0.001"
                      min="0"
                      value={addProviderCostOutput}
                      onChange={(e) => setAddProviderCostOutput(e.target.value)}
                      placeholder="0.002" />
                    
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{"\u7559\u7A7A\u5219\u81EA\u52A8\u4ECE API / LiteLLM \u83B7\u53D6\u5B9A\u4EF7"}</div>
              </details>

              {providerError &&
              <div style={{ color: '#f85149', fontSize: 11 }}>❌ {providerError}</div>
              }

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  style={{ ...btnStyle('#8b949e') }}
                  onClick={() => {setShowAddProvider(false);setProviderError('');}}>
                  {t("\u53D6\u6D88")}</button>
                <button
                  style={{
                    ...btnStyle(),
                    opacity: !canSubmit || providerLoading ? 0.5 : 1,
                    cursor: !canSubmit || providerLoading ? 'not-allowed' : 'pointer'
                  }}
                  disabled={!canSubmit || providerLoading}
                  onClick={addProvider}>
                  
                  {providerLoading ? t("\u6DFB\u52A0\u4E2D...") : t("\u786E\u8BA4\u6DFB\u52A0")}
                </button>
              </div>
            </div>);

        })()}
      </div>

      {/* ── 指标概览 ── */}
      {pool?.initialized &&
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#a371f7' }}>{pool.modelCount}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{"\u6A21\u578B\u603B\u6570"}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#7ee787' }}>
              {pool.activeCount ?? pool.models?.filter((m) => m.active !== false).length ?? 0}
            </div>
            <div style={{ fontSize: 10, color: '#888' }}>{"\u5DF2\u6FC0\u6D3B"}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#f85149' }}>{excluded.length}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{"\u5DF2\u6392\u9664"}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#7ee787' }}>{strategy}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{"\u7B56\u7565"}</div>
          </div>
        </div>
      }

      {/* ── 调度策略 ── */}
      {pool?.initialized &&
      <div>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\uD83D\uDCCA \u8C03\u5EA6\u7B56\u7565"}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
          { key: 'task_match', label: "\u4EFB\u52A1\u5339\u914D" },
          { key: 'cost_optimized', label: "\u6210\u672C\u4F18\u5148" },
          { key: 'quality_first', label: "\u8D28\u91CF\u4F18\u5148" }].
          map((s) =>
          <button key={s.key} style={btnStyle(strategy === s.key ? primaryColor : '#8b949e')} onClick={() => updateStrategy(s.key)}>
                {s.label}
              </button>
          )}
          </div>
        </div>
      }

      {/* ── 模型池列表（激活常驻 + 待激活折叠） ── */}
      {pool?.initialized && (() => {
        const activeModels = pool.models.
        filter((m) => m.active !== false).
        sort((a, b) => {
          const tierOrder: Record<string, number> = { premium: 0, standard: 1, budget: 2, free: 3 };
          return (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9);
        });
        const inactiveModels = pool.models.filter((m) => m.active === false);
        const inactiveByPlatform = inactiveModels.reduce<Record<string, ModelPoolModel[]>>((acc, m) => {
          (acc[m.platform] ??= []).push(m);
          return acc;
        }, {});
        const filteredInactive = inactiveSearch ?
        inactiveModels.filter((m) => m.displayName.toLowerCase().includes(inactiveSearch.toLowerCase())) :
        inactiveModels;
        const activeCount = activeModels.length;
        const inactiveCount = inactiveModels.length;

        const categoryIcon: Record<string, string> = {
          'chat': '💬', 'vl-chat': '👁️', 'omni-chat': '🌐',
          'image-gen': '🎨', 'image-edit': '🖼️', 'video-gen': '🎬',
          'tts': '🔊', 'asr': '🎤', 'embedding': '📐', 'reranker': '📊',
          'translation': '🌐', 'ocr': '👁️'
        };

        const modelRow = (m: ModelPoolModel, isActive: boolean) => {
          const successRate = m.stats.totalCalls > 0 ?
          (m.stats.successes / m.stats.totalCalls * 100).toFixed(0) :
          '-';
          // §2.7: 访问状态指示器
          const statusIcon = m.accessStatus === 'denied' ? '🚫' :
            m.accessStatus === 'broken' ? '⚠️' :
            m.accessStatus === 'available' ? '' : '';
          const statusTitle = m.accessStatus === 'denied' ? `不可用: ${m.failureType ?? '未知错误'}` :
            m.accessStatus === 'broken' ? `故障: 连续 ${m.failureStreak ?? 0} 次失败` :
            m.accessStatus === 'available' ? t('可用') : t('未验证');
          return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 8px', borderBottom: '1px solid #21262d', fontSize: 11,
              opacity: isActive ? 1 : 0.5,
              background: isActive ? 'transparent' : '#0d11170a'
            }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
                onClick={() => toggleModel(m.id, !isActive)}
                title={isActive ? t("\u70B9\u51FB\u53D6\u6D88\u6FC0\u6D3B") : t("\u70B9\u51FB\u6FC0\u6D3B")}>
                
                {isActive ? '✅' : '⬜'}
              </button>
              {statusIcon && <span style={{ flexShrink: 0, fontSize: 12 }} title={statusTitle}>{statusIcon}</span>}
              <span style={{
                color: isActive ? '#c9d1d9' : '#6e7681',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {m.displayName}
              </span>
              <span style={{ color: '#888', flexShrink: 0 }}>[{m.tier}]</span>
              {m.category && m.category !== 'chat' &&
              <span style={{ flexShrink: 0 }}>{categoryIcon[m.category] ?? '📦'}</span>
              }
              {m.variantCount && m.variantCount > 1 &&
              <span style={{ color: '#8b949e', flexShrink: 0 }}>({m.variantCount}{"\u4E2A\u53D8\u4F53"})</span>
              }
              <span style={{ color: isActive && m.stats.totalCalls > 0 ? '#7ee787' : '#555', marginLeft: 4, flexShrink: 0 }}>
                {successRate}%
              </span>
              <span style={{ color: '#888', marginLeft: 4, flexShrink: 0 }}>{m.stats.totalCalls}{"\u6B21"}</span>
              {m.costPer1kInput > 0 && <span style={{ color: '#d29922', marginLeft: 4, flexShrink: 0 }}>¥{m.costPer1kInput}/k</span>}
            </div>);

        };

        return (
          <>
            {/* 激活区 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#7ee787' }}>
                  {t('🏊 模型池（{{poolCount}}）  已激活 {{activeCount}}', { poolCount: pool.models.length, activeCount })}
                  {(() => {
                    const deniedCount = pool.models.filter(m => m.accessStatus === 'denied').length;
                    const brokenCount = pool.models.filter(m => m.accessStatus === 'broken').length;
                    if (deniedCount + brokenCount > 0) {
                      return <span style={{ color: '#d29922', marginLeft: 8 }}>⚠️ {deniedCount + brokenCount} 个不可用</span>;
                    }
                    return null;
                  })()}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {pool.models.some(m => m.accessStatus === 'denied' || m.accessStatus === 'broken') &&
                  <button style={{ ...btnStyle(), fontSize: 10, padding: '2px 6px' }} onClick={async () => {
                    try {
                      await authFetch(`${apiBase}/api/model-pool/retry-denied`, { method: 'POST' });
                      setLoading(true); fetchPool();
                    } catch {}
                  }}>🔄 重试不可用</button>
                  }
                  <button style={btnStyle()} onClick={() => {setLoading(true);fetchPool();}}>{"\uD83D\uDD04 \u5237\u65B0"}</button>
                </div>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 6, border: '1px solid #30363d' }}>
                {activeModels.map((m) => modelRow(m, true))}
                {activeModels.length === 0 &&
                <div style={{ padding: 12, textAlign: 'center', color: '#666', fontSize: 11 }}>{"\u6682\u65E0\u6FC0\u6D3B\u6A21\u578B"}</div>
                }
              </div>
            </div>

            {/* 待激活区 */}
            {inactiveCount > 0 &&
            <div>
                <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 8px', background: '#161b22', borderRadius: 6,
                  cursor: 'pointer', marginBottom: inactiveExpanded ? 6 : 0
                }}
                onClick={() => setInactiveExpanded(!inactiveExpanded)}>
                
                  <span style={{ fontSize: 11, color: '#8b949e' }}>
                    {inactiveExpanded ? '▼' : '▶'} {"\u5F85\u6FC0\u6D3B"}（{inactiveCount}）
                  </span>
                  <button
                  style={{ ...btnStyle('#238636'), fontSize: 10, padding: '2px 8px' }}
                  onClick={(e) => {e.stopPropagation();batchActivateAll();}}>
                  {"\u5168\u90E8\u6FC0\u6D3B"}</button>
                </div>

                {inactiveExpanded &&
              <div style={{ borderRadius: 6, border: '1px solid #21262d', overflow: 'hidden' }}>
                    {/* 搜索框 */}
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>
                      <input
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: 11 }}
                    placeholder={"\uD83D\uDD0D \u641C\u7D22\u6A21\u578B..."}
                    value={inactiveSearch}
                    onChange={(e) => setInactiveSearch(e.target.value)} />
                  
                    </div>

                    {inactiveSearch ?
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filteredInactive.map((m) => modelRow(m, false))}
                        {filteredInactive.length === 0 &&
                  <div style={{ padding: 12, textAlign: 'center', color: '#666', fontSize: 11 }}>{"\u65E0\u5339\u914D"}</div>
                  }
                      </div> :

                <div style={{ maxHeight: 250, overflowY: 'auto' }}>
                        {Object.entries(inactiveByPlatform).map(([platform, models]) => {
                    const platformExpanded = expandedPlatforms.has(platform);
                    return (
                      <div key={platform}>
                              <div
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '4px 8px', background: '#0d1117', cursor: 'pointer',
                            borderBottom: '1px solid #21262d', fontSize: 11, color: '#8b949e'
                          }}
                          onClick={() => {
                            const next = new Set(expandedPlatforms);
                            if (next.has(platform)) next.delete(platform);else
                            next.add(platform);
                            setExpandedPlatforms(next);
                          }}>
                          
                                <span>{platformExpanded ? '▼' : '▶'} {platform}（{models.length}）</span>
                                <button
                            style={{ ...btnStyle('#238636'), fontSize: 9, padding: '1px 6px' }}
                            onClick={(e) => {e.stopPropagation();batchActivateByPlatform(platform);}}>
                            {"\u6279\u91CF\u6FC0\u6D3B"}</button>
                              </div>
                              {platformExpanded && models.map((m) => modelRow(m, false))}
                            </div>);

                  })}
                      </div>
                }
                  </div>
              }
              </div>
            }
          </>);

      })()}

      {/* ── 排除管理 ── */}
      {pool?.initialized &&
      <div>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\uD83D\uDEAB \u6392\u9664\u5217\u8868"}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
            style={{ ...inputStyle, flex: 1 }}
            value={excludeInput}
            onChange={(e) => setExcludeInput(e.target.value)}
            placeholder={"\u6A21\u578B ID \u6216\u901A\u914D\u7B26 (\u5982 meta-llama/*)"}
            onKeyDown={(e) => e.key === 'Enter' && addExclude()} />
          
            <button style={btnStyle('#f85149')} onClick={addExclude}>{"\u6392\u9664"}</button>
          </div>
          {excluded.length === 0 ?
        <span style={{ color: '#555', fontSize: 11 }}>{"\u6682\u65E0\u6392\u9664"}</span> :

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {excluded.map((pat) =>
          <span key={pat} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 4, background: '#da363322',
            border: '1px solid #da363344', color: '#f85149', fontSize: 10
          }}>
                  {pat}
                  <button
              onClick={() => removeExclude(pat)}
              style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}>
              ×</button>
                </span>
          )}
            </div>
        }
        </div>
      }

      {/* 未初始化提示 */}
      {!providersFetching && !pool?.initialized && providers.length === 0 &&
      <div style={{ color: '#8b949e', fontSize: 12, padding: '8px 0' }}>
          <p>{"\u7EDF\u4E00\u6A21\u578B\u6C60\u672A\u521D\u59CB\u5316\u3002\u8BF7\u5148\u6DFB\u52A0 API \u7AEF\u70B9\u3002"}</p>
        </div>
      }
    </div>);

}

// ==================== Custom Tools Section ====================

const TOOL_PRESETS: Record<string, { label: string; icon: string; description: string; defaultEndpoint: string; timeoutMs: number }> = {
  comfyui_generate: { label: 'ComfyUI 文生图', icon: '🎨', description: '通过 ComfyUI 本地部署生成图片', defaultEndpoint: 'http://localhost:8188/api/prompt', timeoutMs: 300000 },
  comfyui_video: { label: 'ComfyUI 文生视频', icon: '🎬', description: '通过 ComfyUI 本地部署生成视频', defaultEndpoint: 'http://localhost:8188/api/prompt', timeoutMs: 600000 },
  whisper_transcribe: { label: 'Whisper 语音转文字', icon: '🎤', description: '通过本地 Whisper 服务转录音频', defaultEndpoint: 'http://localhost:9000/transcribe', timeoutMs: 60000 },
  ollama_generate: { label: 'Ollama 辅助生成', icon: '🦙', description: '通过本地 Ollama 生成文本', defaultEndpoint: 'http://localhost:11434/api/generate', timeoutMs: 120000 },
};

function CustomToolsSection({ apiBase, primaryColor }: { apiBase: string; primaryColor: string }) {
  const [tools, setTools] = useState<Array<{ id: string; name: string; description: string; endpoint: string; method?: string; timeoutMs?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addPreset, setAddPreset] = useState('comfyui_generate');
  const [addId, setAddId] = useState('');
  const [addEndpoint, setAddEndpoint] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    try {
      const tokenRes = await fetch(`${apiBase}/api/ws-token`);
      const { token } = await tokenRes.json();
      return fetch(url, { ...init, headers: { ...init?.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch { return fetch(url, init); }
  }, [apiBase]);

  const fetchTools = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/config/custom-tools`);
      if (res.ok) { const data = await res.json(); setTools(data.tools ?? []); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [authFetch, apiBase]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const handlePresetChange = (preset: string) => {
    setAddPreset(preset);
    const p = TOOL_PRESETS[preset];
    if (p) { if (!addId) setAddId(preset); setAddEndpoint(p.defaultEndpoint); setAddDesc(p.description); }
  };

  const addTool = async () => {
    if (!addId.trim() || !addEndpoint.trim()) return;
    setSaving(true); setError('');
    try {
      const preset = TOOL_PRESETS[addPreset];
      const res = await authFetch(`${apiBase}/api/config/custom-tools`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: addId.trim(), name: preset?.label ?? addId.trim(),
          description: addDesc.trim() || preset?.description || '',
          endpoint: addEndpoint.trim(), method: 'POST',
          timeoutMs: preset?.timeoutMs ?? 30000,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || t('添加失败')); }
      else { setShowAdd(false); setAddId(''); setAddEndpoint(''); setAddDesc(''); fetchTools(); }
    } catch (err) { setError((err as Error).message); }
    setSaving(false);
  };

  const removeTool = async (id: string) => {
    setSaving(true);
    try { await authFetch(`${apiBase}/api/config/custom-tools`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); fetchTools(); }
    catch { /* ignore */ }
    setSaving(false);
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d',
    background: '#0d1117', color: '#c9d1d9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  };
  const btnStyle = (color = primaryColor): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
    background: `${color}22`, color, border: `1px solid ${color}44`, fontFamily: 'inherit', transition: 'all 0.15s',
  });

  if (loading) return <p style={{ color: '#666', fontStyle: 'italic' }}>加载中...</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{t('🔌 本地服务工具')}</span>
          <button style={btnStyle()} onClick={() => { setShowAdd(!showAdd); if (!showAdd) handlePresetChange(addPreset); }}>
            {showAdd ? t('取消') : t('+ 添加工具')}
          </button>
        </div>

        <div style={{ fontSize: 10, color: '#555', marginBottom: 8, lineHeight: 1.5 }}>
          {t('接入本地部署的 AI 服务（ComfyUI 生图/生视频、Whisper 语音转录等）。Buddy 会自动注册为可用工具，LLM 可直接调用。')}
        </div>

        {/* 已添加列表 */}
        {tools.length === 0 && !showAdd ? (
          <div style={{ color: '#555', fontSize: 11, padding: '8px 0' }}>{t('暂无工具端点。添加后 Buddy 可调用本地 AI 服务。')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: showAdd ? 8 : 0 }}>
            {tools.map((t) => {
              const preset = TOOL_PRESETS[t.id];
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: 6, background: '#0d1117', border: '1px solid #30363d',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#c9d1d9', fontWeight: 500 }}>
                      {preset?.icon ?? '🔧'} {t.name || t.id}
                    </div>
                    <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
                      {t.description && <span>{t.description} · </span>}
                      <span style={{ color: '#8b949e' }}>{t.endpoint}</span>
                      {t.timeoutMs && <span style={{ marginLeft: 8 }}>⏱{t.timeoutMs / 1000}s</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => removeTool(t.id)}
                    disabled={saving}
                    style={{ background: 'none', border: 'none', color: '#f85149', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, padding: '2px 6px', opacity: saving ? 0.4 : 1 }}
                    title={t("删除工具")}
                  >×</button>
                </div>
              );
            })}
          </div>
        )}

        {/* 添加表单 */}
        {showAdd && (
          <div style={{ padding: 12, borderRadius: 8, background: '#161b22', border: `1px solid ${primaryColor}44`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 500 }}>选择预设模板</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(TOOL_PRESETS).map(([key, p]) => (
                <button key={key} onClick={() => handlePresetChange(key)} style={{
                  padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  background: addPreset === key ? `${primaryColor}22` : '#21262d',
                  color: addPreset === key ? primaryColor : '#8b949e',
                  border: `1px solid ${addPreset === key ? primaryColor : '#30363d'}`,
                  fontFamily: 'inherit', transition: 'all 0.15s',
                }}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            <div>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>工具 ID <span style={{ color: '#f85149' }}>*</span></label>
              <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={addId} onChange={(e) => setAddId(e.target.value)} placeholder="comfyui_generate" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>服务地址 <span style={{ color: '#f85149' }}>*</span></label>
              <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={addEndpoint} onChange={(e) => setAddEndpoint(e.target.value)} placeholder="http://localhost:8188/api/prompt" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>描述（可选）</label>
              <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder={t("让 LLM 了解这个工具的用途")} />
            </div>

            {error && <div style={{ color: '#f85149', fontSize: 11 }}>❌ {error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnStyle('#8b949e')} onClick={() => { setShowAdd(false); setError(''); }}>{t('取消')}</button>
              <button style={{ ...btnStyle(), opacity: !addId.trim() || !addEndpoint.trim() || saving ? 0.5 : 1, cursor: !addId.trim() || !addEndpoint.trim() || saving ? 'not-allowed' : 'pointer' }} disabled={!addId.trim() || !addEndpoint.trim() || saving} onClick={addTool}>
                {saving ? t('添加中...') : t('确认添加')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Behavior Section ====================

function BehaviorSection({ replyStyle, setReplyStyle, confirmStrategy, setConfirmStrategy, primaryColor






}: {replyStyle: string;setReplyStyle: (v: string) => void;confirmStrategy: string;setConfirmStrategy: (v: string) => void;primaryColor: string;}) {
  const optionBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 11,
    background: active ? `${primaryColor}22` : '#21262d',
    color: active ? primaryColor : '#c9d1d9',
    border: `1px solid ${active ? primaryColor : '#30363d'}`,
    fontFamily: 'inherit',
    transition: 'all 0.15s'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Reply Style */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\u56DE\u590D\u98CE\u683C"}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['concise', 'balanced', 'detailed'].map((s) =>
          <button key={s} style={optionBtnStyle(replyStyle === s)} onClick={() => setReplyStyle(s)}>
              {({ concise: "\u7B80\u6D01", balanced: "\u5747\u8861", detailed: "\u8BE6\u7EC6" } as Record<string, string>)[s] || s}
            </button>
          )}
        </div>
      </div>

      {/* Confirm Strategy */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\u786E\u8BA4\u7B56\u7565"}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['always', 'dangerous', 'never'].map((s) =>
          <button key={s} style={optionBtnStyle(confirmStrategy === s)} onClick={() => setConfirmStrategy(s)}>
              {({ always: "\u603B\u662F", dangerous: "\u4EC5\u5371\u9669", never: "\u4ECE\u4E0D" } as Record<string, string>)[s] || s}
            </button>
          )}
        </div>
      </div>
    </div>);

}

// ==================== Appearance Section ====================

function AppearanceSection({ theme, setTheme, fontSize, setFontSize, primaryColor, language, onLanguageChange








}: {theme: string;setTheme: (v: string) => void;fontSize: string;setFontSize: (v: string) => void;primaryColor: string;language: string;onLanguageChange?: (lang: string) => void;}) {
  const optionBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 11,
    background: active ? `${primaryColor}22` : '#21262d',
    color: active ? primaryColor : '#c9d1d9',
    border: `1px solid ${active ? primaryColor : '#30363d'}`,
    fontFamily: 'inherit',
    transition: 'all 0.15s'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Theme */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\u4E3B\u9898"}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['dark', 'light', 'auto'].map((s) =>
          <button key={s} style={optionBtnStyle(theme === s)} onClick={() => setTheme(s)}>
              {({ dark: "\u6DF1\u8272", light: "\u6D45\u8272", auto: "\u8DDF\u968F\u7CFB\u7EDF" } as Record<string, string>)[s] || s}
            </button>
          )}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{"\u5B57\u4F53\u5927\u5C0F"}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['small', 'medium', 'large'].map((s) =>
          <button key={s} style={optionBtnStyle(fontSize === s)} onClick={() => setFontSize(s)}>
              {({ small: "\u5C0F", medium: "\u4E2D", large: "\u5927" } as Record<string, string>)[s] || s}
            </button>
          )}
        </div>
      </div>

      {/* Language */}
      <div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom:6 }}>{'\u8BED\u8A00'}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {getRegisteredLanguages().map((lang) =>
          <button
            key={lang.code}
            style={optionBtnStyle(language === lang.code)}
            onClick={() => onLanguageChange?.(lang.code)}>
            
              {lang.flag} {lang.label}
            </button>
          )}
          {/* 添加语言按钮 */}
          <AddLanguageButton onAdd={(code) => {
            registerLanguage(code);
            onLanguageChange?.(code);
          }} />
        </div>
      </div>
    </div>);

}

/** 添加语言按钮（下拉选择未注册的语言） */
function AddLanguageButton({ onAdd }: { onAdd: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const available = getAvailableLanguages();

  if (available.length === 0) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        style={{
          background: 'transparent',
          border: '1px dashed #30363d',
          borderRadius: 6,
          padding: '4px 10px',
          color: '#8b949e',
          cursor: 'pointer',
          fontSize: 12,
        }}
        onClick={() => setOpen(!open)}
      >
        + {'\u6DFB\u52A0\u8BED\u8A00'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 4,
            zIndex: 100,
            minWidth: 160,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {available.map((lang) => (
            <button
              key={lang.code}
              style={{
                display: 'block',
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '6px 10px',
                color: '#c9d1d9',
                cursor: 'pointer',
                fontSize: 12,
                textAlign: 'left',
                borderRadius: 4,
              }}
              onClick={() => {
                onAdd(lang.code);
                setOpen(false);
              }}
              onMouseEnter={(e) => (e.currentTarget.background = '#21262d')}
              onMouseLeave={(e) => (e.currentTarget.background = 'transparent')}
            >
              {lang.flag} {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Platform Section (数据驱动) ====================

/** 通道定义 */
const CHANNELS = [
{
  id: 'telegram', icon: '📱', name: 'Telegram',
  fields: [
  { key: 'token', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...', required: true }]

},
{
  id: 'discord', icon: '🎮', name: 'Discord',
  fields: [
  { key: 'token', label: 'Bot Token', type: 'password', placeholder: 'MTxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxx', required: true },
  { key: 'channelIds', label: '监听频道 ID（可选，逗号分隔）', type: 'text', placeholder: '留空监听所有频道' }]

},
{
  id: 'feishu', icon: '📘', name: '飞书',
  fields: [
  { key: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_xxxxxxxxxx', required: true },
  { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: 'xxxxxxxxxx', required: true },
  { key: 'webhookPort', label: 'Webhook 端口', type: 'number', placeholder: '9876' }]

},
{
  id: 'wecom', icon: '🏢', name: '企业微信',
  fields: [
  { key: 'corpId', label: 'Corp ID', type: 'text', placeholder: 'wwxxxxxxxxxx', required: true },
  { key: 'agentId', label: 'Agent ID', type: 'text', placeholder: '1000002', required: true },
  { key: 'secret', label: 'Secret', type: 'password', placeholder: 'xxxxxxxxxx', required: true },
  { key: 'token', label: 'Token', type: 'password', placeholder: 'xxxxxxxxxx', required: true },
  { key: 'encodingAESKey', label: 'EncodingAESKey', type: 'password', placeholder: '43位字符串', required: true }]

},
{
  id: 'wechat_mp', icon: '💚', name: '微信公众号',
  fields: [
  { key: 'appId', label: 'App ID', type: 'text', placeholder: 'wxXXXXXXXXXXXXXX', required: true },
  { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: 'xxxxxxxxxx', required: true },
  { key: 'token', label: 'Token', type: 'password', placeholder: 'xxxxxxxxxx', required: true },
  { key: 'encodingAESKey', label: 'EncodingAESKey', type: 'password', placeholder: '43位字符串' }]

},
{
  id: 'dingtalk', icon: '📌', name: '钉钉',
  fields: [
  { key: 'appKey', label: 'App Key', type: 'text', placeholder: 'dingxxxxxxxxxx', required: true },
  { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: 'xxxxxxxxxx', required: true }]

}] as
const;

function PlatformSection() {
  const [platforms, setPlatforms] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<Record<string, {ok: boolean;text: string;}>>({});

  const apiBase = '';

  // 加载平台配置
  useEffect(() => {
    (async () => {
      try {
        const tokenRes = await fetch(`${apiBase}/api/ws-token`);
        const { token } = await tokenRes.json();
        const res = await fetch(`${apiBase}/api/config`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const config = await res.json();
          setPlatforms(config.platforms ?? {});
        }
      } catch {/* ignore */}
      setLoading(false);
    })();
  }, []);

  // 保存某个通道的配置
  const saveChannel = async (channelId: string) => {
    setSaving(channelId);
    setSaveMsg((prev) => ({ ...prev, [channelId]: undefined as any }));
    try {
      const tokenRes = await fetch(`${apiBase}/api/ws-token`);
      const { token } = await tokenRes.json();
      const res = await fetch(`${apiBase}/api/config/platforms`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ channelId, ...platforms[channelId] })
      });
      if (res.ok) {
        setSaveMsg((prev) => ({ ...prev, [channelId]: { ok: true, text: t("\u2705 \u5DF2\u4FDD\u5B58") } }));
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMsg((prev) => ({ ...prev, [channelId]: { ok: false, text: `❌ ${data.error || t("\u4FDD\u5B58\u5931\u8D25")}` } }));
      }
    } catch (err) {
      setSaveMsg((prev) => ({ ...prev, [channelId]: { ok: false, text: `❌ ${(err as Error).message}` } }));
    }
    setSaving(null);
    setTimeout(() => setSaveMsg((prev) => ({ ...prev, [channelId]: undefined as any })), 3000);
  };

  // 切换通道启用状态
  const toggleEnabled = (channelId: string) => {
    setPlatforms((prev) => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        enabled: !(prev[channelId]?.enabled ?? false)
      }
    }));
  };

  // 更新字段值
  const setField = (channelId: string, key: string, value: string) => {
    setPlatforms((prev) => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        [key]: key === 'webhookPort' ? value ? parseInt(value, 10) : undefined : value || undefined
      }
    }));
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d',
    background: '#0d1117', color: '#c9d1d9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
    width: '100%', boxSizing: 'border-box'
  };

  const btnStyle = (color = '#58a6ff'): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
    background: `${color}22`, color, border: `1px solid ${color}44`, fontFamily: 'inherit', transition: 'all 0.15s'
  });

  if (loading) return <p style={{ color: '#666', fontStyle: 'italic' }}>{"\u52A0\u8F7D\u4E2D..."}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {CHANNELS.map((ch) => {
        const cfg = platforms[ch.id] ?? {};
        const isEnabled = !!cfg.enabled;
        const isExpanded = expanded.has(ch.id);

        return (
          <div key={ch.id} style={{
            borderRadius: 8,
            background: '#0d1117',
            border: `1px solid ${isEnabled ? '#58a6ff44' : '#30363d'}`,
            overflow: 'hidden',
            transition: 'border-color 0.2s'
          }}>
            {/* 头部：图标 + 名称 + 状态 + 展开按钮 */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', cursor: 'pointer'
              }}
              onClick={() => {
                const next = new Set(expanded);
                if (next.has(ch.id)) next.delete(ch.id);else
                next.add(ch.id);
                setExpanded(next);
              }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{ch.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>{ch.name}</span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: isEnabled ? '#23863622' : '#21262d',
                  color: isEnabled ? '#7ee787' : '#8b949e',
                  border: `1px solid ${isEnabled ? '#23863644' : '#30363d'}`
                }}>
                  {isEnabled ? t("\u5DF2\u542F\u7528") : t("\u672A\u542F\u7528")}
                </span>
              </div>
              <span style={{ color: '#8b949e', fontSize: 12 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {/* 展开区域：配置表单 */}
            {isExpanded &&
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 启用开关 */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                  <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleEnabled(ch.id)}
                  style={{ cursor: 'pointer' }} />
                
                  <span style={{ color: '#c9d1d9' }}>{t('启用 {{name}}', { name: ch.name })}</span>
                </label>

                {/* 字段 */}
                {ch.fields.map((field) =>
              <div key={field.key}>
                    <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>
                      {field.label}
                      {field.required && <span style={{ color: '#f85149' }}> *</span>}
                    </label>
                    <input
                  style={inputStyle}
                  type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                  value={String(cfg[field.key] ?? '')}
                  onChange={(e) => setField(ch.id, field.key, e.target.value)}
                  placeholder={field.placeholder} />
                
                  </div>
              )}

                {/* 保存按钮 + 状态 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                  style={{
                    ...btnStyle(),
                    opacity: saving === ch.id ? 0.5 : 1,
                    cursor: saving === ch.id ? 'not-allowed' : 'pointer'
                  }}
                  disabled={saving === ch.id}
                  onClick={(e) => {e.stopPropagation();saveChannel(ch.id);}}>
                  
                    {saving === ch.id ? t("\u4FDD\u5B58\u4E2D...") : '💾 ' + t("\u4FDD\u5B58\u914D\u7F6E")}
                  </button>
                  {saveMsg[ch.id] &&
                <span style={{ fontSize: 11, color: saveMsg[ch.id].ok ? '#7ee787' : '#f85149' }}>
                      {saveMsg[ch.id].text}
                    </span>
                }
                </div>
              </div>
            }
          </div>);

      })}
    </div>);

}

// ==================== Data Section ====================

function DataSection({ primaryColor }: {primaryColor: string;}) {
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [sensorConsent, setSensorConsent] = useState(() => {
    try { return JSON.parse(localStorage.getItem('buddy_sensor_consent') || '{}'); } catch { return {}; }
  });
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<{ok: boolean; text: string} | null>(null);

  const revokeSensor = (sensor: string) => {
    const updated = { ...sensorConsent, [sensor]: { granted: false, revokedAt: Date.now() } };
    localStorage.setItem('buddy_sensor_consent', JSON.stringify(updated));
    setSensorConsent(updated);
  };

  const authFetch = async (url: string, init?: RequestInit) => {
    try {
      const tokenRes = await fetch('/api/ws-token');
      const { token } = await tokenRes.json();
      return fetch(url, {
        ...init,
        headers: { ...init?.headers, ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
    } catch { return fetch(url, init); }
  };

  const exportAllData = async () => {
    setPrivacyLoading(true);
    setPrivacyMsg(null);
    try {
      const res = await authFetch('/api/privacy/export');
      if (res.ok) {
        const serverData = await res.json();
        const localData = {
          visualSeed: localStorage.getItem('buddy_visual_seed'),
          replyStyle: localStorage.getItem('buddy_reply_style'),
          confirmStrategy: localStorage.getItem('buddy_confirm_strategy'),
          theme: localStorage.getItem('buddy_theme'),
          fontSize: localStorage.getItem('buddy_font_size'),
          lang: localStorage.getItem('buddy_lang'),
          sensorConsent: JSON.parse(localStorage.getItem('buddy_sensor_consent') || '{}'),
        };
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), server: serverData, local: localData }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `buddy-data-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setPrivacyMsg({ ok: true, text: '\u2705 \u6570\u636E\u5DF2\u5BFC\u51FA' });
      } else {
        setPrivacyMsg({ ok: false, text: `\u274C \u5BFC\u51FA\u5931\u8D25: ${res.status}` });
      }
    } catch (err) {
      setPrivacyMsg({ ok: false, text: `\u274C ${(err as Error).message}` });
    }
    setPrivacyLoading(false);
  };

  const deleteAllData = async () => {
    setPrivacyLoading(true);
    setPrivacyMsg(null);
    try {
      const res = await authFetch('/api/privacy/data', { method: 'DELETE' });
      if (res.ok) {
        setPrivacyMsg({ ok: true, text: '\u2705 \u670D\u52A1\u7AEF\u6570\u636E\u5DF2\u5220\u9664' });
      } else {
        setPrivacyMsg({ ok: false, text: `\u274C \u5220\u9664\u5931\u8D25: ${res.status}` });
      }
    } catch (err) {
      setPrivacyMsg({ ok: false, text: `\u274C ${(err as Error).message}` });
    }
    setPrivacyLoading(false);
  };

  const dangerBtnStyle: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 6, cursor: privacyLoading ? 'not-allowed' : 'pointer',
    fontSize: 12, background: '#da363322', color: '#f85149', border: '1px solid #da363344',
    fontFamily: 'inherit', transition: 'all 0.15s', width: '100%', textAlign: 'left' as const,
    opacity: privacyLoading ? 0.5 : 1,
  };

  const normalBtnStyle: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 6, cursor: privacyLoading ? 'not-allowed' : 'pointer',
    fontSize: 12, background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d',
    fontFamily: 'inherit', transition: 'all 0.15s', width: '100%', textAlign: 'left' as const,
    opacity: privacyLoading ? 0.5 : 1,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* \u611F\u77E5\u80FD\u529B\u6388\u6743\u7BA1\u7406 */}
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>\uD83D\uDD10 \u611F\u77E5\u80FD\u529B\u6388\u6743</div>
      {[
        { key: 'camera', icon: '\uD83D\uDCF7', label: '\u6444\u50CF\u5934' },
        { key: 'microphone', icon: '\uD83C\uDF99\uFE0F', label: '\u9EA6\u514B\u98CE' },
        { key: 'location', icon: '\uD83D\uDCCD', label: '\u4F4D\u7F6E' },
      ].map(({ key, icon, label }) => {
        const consent = sensorConsent[key];
        const granted = consent?.granted && !consent?.revokedAt;
        return (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', borderRadius: 6, background: '#161b22', border: '1px solid #30363d', fontSize: 12,
          }}>
            <span>{icon} {label}</span>
            {granted ? (
              <button
                style={{ padding: '2px 10px', borderRadius: 4, border: '1px solid #f8514944', background: 'transparent', color: '#f85149', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => revokeSensor(key)}
              >
                \u64A4\u56DE
              </button>
            ) : (
              <span style={{ color: '#8b949e', fontSize: 11 }}>\u672A\u6388\u6743</span>
            )}
          </div>
        );
      })}

      {/* \u72B6\u6001\u6D88\u606F */}
      {privacyMsg && (
        <div style={{
          padding: '6px 12px', borderRadius: 6, fontSize: 11,
          background: privacyMsg.ok ? '#23863622' : '#da363322',
          color: privacyMsg.ok ? '#7ee787' : '#f85149',
          border: `1px solid ${privacyMsg.ok ? '#23863644' : '#da363344'}`,
        }}>
          {privacyMsg.text}
        </div>
      )}

      {/* \u6570\u636E\u7BA1\u7406 */}
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, marginTop: 4 }}>📦 数据管理</div>
      <button style={normalBtnStyle} disabled={privacyLoading} onClick={exportAllData}>
        📦 导出所有数据
      </button>

      <button
        style={dangerBtnStyle}
        disabled={privacyLoading}
        onClick={() => {
          if (confirmAction === 'deleteServer') {
            setConfirmAction(null);
            deleteAllData();
          } else {
            setConfirmAction('deleteServer');
            setTimeout(() => setConfirmAction(null), 5000);
          }
        }}>
        {confirmAction === 'deleteServer' ? t('\u26A0\uFE0F \u786E\u8BA4\u5220\u9664\u670D\u52A1\u7AEF\u6570\u636E\uFF1F') : t('\uD83D\uDDD1\uFE0F \u5220\u9664\u670D\u52A1\u7AEF\u6570\u636E')}
      </button>

      <button
        style={dangerBtnStyle}
        disabled={privacyLoading}
        onClick={() => {
          if (confirmAction === 'clear') {
            setConfirmAction(null);
            window.location.reload();
          } else {
            setConfirmAction('clear');
            setTimeout(() => setConfirmAction(null), 3000);
          }
        }}>
        {confirmAction === 'clear' ? t('\u26A0\uFE0F \u786E\u8BA4\u6E05\u9664\uFF1F') : t('\uD83E\uDDF9 \u6E05\u9664\u672C\u5730\u8BB0\u5FC6')}
      </button>

      <button
        style={dangerBtnStyle}
        disabled={privacyLoading}
        onClick={() => {
          if (confirmAction === 'reset') {
            deleteAllData().then(() => {
              localStorage.clear();
              setConfirmAction(null);
              window.location.reload();
            });
          } else {
            setConfirmAction('reset');
            setTimeout(() => setConfirmAction(null), 5000);
          }
        }}>
        {confirmAction === 'reset' ? t('\u26A0\uFE0F \u786E\u8BA4\u91CD\u7F6E\u6240\u6709\uFF1F\uFF08\u542B\u670D\u52A1\u7AEF\u6570\u636E\uFF09') : t('\uD83D\uDCA5 \u91CD\u7F6E\u6240\u6709')}
      </button>

      {/* \u8BF4\u660E\u6587\u5B57 */}
      <div style={{ fontSize: 10, color: '#484f58', lineHeight: 1.6, marginTop: 4 }}>
        • \u5BFC\u51FA\u5305\u542B\u670D\u52A1\u7AEF\u5BF9\u8BDD\u8BB0\u5F55\u3001\u77E5\u8BC6\u5E93\u548C\u672C\u5730\u914D\u7F6E<br/>
        • \u5220\u9664\u670D\u52A1\u7AEF\u6570\u636E\u4E0D\u53EF\u6062\u590D\uFF0C\u672C\u5730\u914D\u7F6E\u4FDD\u7559<br/>
        • \u91CD\u7F6E\u6240\u6709\u5C06\u6E05\u9664\u670D\u52A1\u7AEF\u6570\u636E + \u6240\u6709\u672C\u5730\u8BBE\u7F6E
      </div>
    </div>
  );

}
