// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useCallback, useEffect } from 'react';
import { t } from '../i18n/t';
import type { TextureType, TemperamentType, VisualSeed } from '../types/buddy';
import { TEXTURE_OPTIONS, TEMPERAMENT_OPTIONS, COLOR_PRESETS } from '../types/buddy';


interface OnboardingProps {
  onComplete: (seed: VisualSeed) => void;
}

type Step = 'color' | 'texture' | 'temperament' | 'llm';

function getStepTitles(): Record<Step, {title: string;subtitle: string;}> {
  return {
    color: { title: "\u9009\u62E9\u4E3B\u8272\u8C03", subtitle: "\u51B3\u5B9A\u4F60\u7684 Buddy \u6563\u53D1\u7684\u5149\u8292\u989C\u8272" },
    texture: { title: "\u9009\u62E9\u8D28\u611F", subtitle: "\u51B3\u5B9A\u4F60\u7684 Buddy \u7684\u5F62\u6001\u98CE\u683C" },
    temperament: { title: "\u9009\u62E9\u6C14\u8D28", subtitle: "\u51B3\u5B9A\u4F60\u7684 Buddy \u7684\u6027\u683C\u57FA\u8C03" },
    llm: { title: "\u8FDE\u63A5\u5927\u8111", subtitle: "\u914D\u7F6E LLM API \u7AEF\u70B9\uFF0C\u7CFB\u7EDF\u5C06\u81EA\u52A8\u53D1\u73B0\u53EF\u7528\u6A21\u578B" }
  };
}

interface ProviderPreset {
  id: string;
  label: string;
  icon: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  keyUrl: string;
  needKey: boolean;
  needUrl: boolean;
}

const PROVIDERS: ProviderPreset[] = [
{
  id: 'deepseek',
  label: 'DeepSeek',
  icon: '🔮',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  needKey: true,
  needUrl: false
},
{
  id: 'openai',
  label: 'OpenAI',
  icon: '🤖',
  defaultBaseUrl: 'https://api.openai.com/v1',
  keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  keyUrl: 'https://platform.openai.com/api-keys',
  needKey: true,
  needUrl: false
},
{
  id: 'siliconflow',
  label: '硅基流动',
  icon: '🌊',
  defaultBaseUrl: 'https://api.siliconflow.cn/v1',
  keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  needKey: true,
  needUrl: false
},
{
  id: 'ollama',
  label: 'Ollama (本地)',
  icon: '🦙',
  defaultBaseUrl: 'http://localhost:11434/v1',
  keyPlaceholder: '（本地部署无需 Key）',
  keyUrl: '',
  needKey: false,
  needUrl: true
},
{
  id: 'custom',
  label: '自定义',
  icon: '⚙️',
  defaultBaseUrl: '',
  keyPlaceholder: 'API Key',
  keyUrl: '',
  needKey: true,
  needUrl: true
}];


export default function Onboarding({
  onComplete }: OnboardingProps) {

  const STEP_TITLES = getStepTitles();
  const [step, setStep] = useState<Step>('color');
  const [primaryColor, setPrimaryColor] = useState('#58a6ff');
  const [texture, setTexture] = useState<TextureType | null>(null);
  const [temperament, setTemperament] = useState<TemperamentType | null>(null);
  const [previewBreath, setPreviewBreath] = useState(0);

  // LLM 配置状态
  const [selectedProvider, setSelectedProvider] = useState<ProviderPreset>(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].defaultBaseUrl);
  const [submitting, setSubmitting] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<{modelCount?: number;error?: string;} | null>(null);

  // 预览动画
  useEffect(() => {
    const interval = setInterval(() => {
      setPreviewBreath((prev) => (prev + 0.03) % (Math.PI * 2));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const canNext = useCallback((): boolean => {
    if (step === 'color') return true;
    if (step === 'texture') return texture !== null;
    if (step === 'temperament') return temperament !== null;
    if (step === 'llm') {
      const needKey = selectedProvider.needKey ? apiKey.trim() !== '' : true;
      const needUrl = selectedProvider.needUrl ? baseUrl.trim() !== '' : true;
      return needKey && needUrl;
    }
    return false;
  }, [step, texture, temperament, selectedProvider, apiKey, baseUrl]);

  const handleProviderSelect = useCallback((p: ProviderPreset) => {
    setSelectedProvider(p);
    setBaseUrl(p.defaultBaseUrl);
    setApiKey('');
    setDiscoveryResult(null);
  }, []);

  const handleNext = useCallback(async () => {
    if (step === 'color') setStep('texture');else
    if (step === 'texture') setStep('temperament');else
    if (step === 'temperament') setStep('llm');else
    if (step === 'llm' && texture && temperament) {
      // POST /api/model-pool/providers → 自动发现模型
      setSubmitting(true);
      setDiscoveryResult(null);

      // 先保存 visual seed（确保用户配置不丢失）
      const seed = {
        primaryColor,
        texture,
        temperament,
        seed: Math.floor(Math.random() * 1000000)
      };

      try {
        // 超时保护：防止 fetch 挂起导致 onboarding 永远卡住
        const fetchWithTimeout = async (url: string, init: RequestInit = {}, ms = 8000) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), ms);
          try {
            return await fetch(url, { ...init, signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        };

        const tokenRes = await fetchWithTimeout('/api/ws-token', {}, 5000);
        const { token } = await tokenRes.json();
        const res = await fetchWithTimeout('/api/model-pool/providers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            id: selectedProvider.id,
            type: selectedProvider.id,
            apiKey: apiKey.trim() || undefined,
            baseUrl: baseUrl.trim() || undefined
          })
        }, 8000);
        const data = await res.json();
        if (res.ok && data.ok) {
          setDiscoveryResult({ modelCount: data.modelCount });
          // 短暂展示结果后完成
          setTimeout(() => {
            onComplete(seed);
          }, 1200);
        } else {
          setDiscoveryResult({ error: data.discoveryError || data.error || '添加端点失败' });
          setSubmitting(false);
          // API 失败也完成 onboarding（seed 已保存）
          setTimeout(() => {
            onComplete(seed);
          }, 1500);
        }
      } catch (err) {
        setDiscoveryResult({ error: (err as Error).message });
        setSubmitting(false);
        // 网络错误也完成 onboarding（seed 已保存）
        setTimeout(() => {
          onComplete(seed);
        }, 1500);
      }
    }
  }, [step, texture, temperament, primaryColor, selectedProvider, apiKey, baseUrl, onComplete]);

  // 预览光团
  const orbScale = 0.92 + Math.sin(previewBreath) * 0.08;
  const orbAlpha = 0.7 + Math.sin(previewBreath) * 0.3;

  const stepOrder: Step[] = ['color', 'texture', 'temperament', 'llm'];
  const prevStep = stepOrder[stepOrder.indexOf(step) - 1];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#c9d1d9',
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      {/* 预览光团 */}
      <div style={{
        width: 120, height: 120,
        position: 'relative',
        marginBottom: 32
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${primaryColor}88 0%, ${primaryColor}22 50%, transparent 70%)`,
          transform: `scale(${orbScale * 1.3})`,
          opacity: 0.4
        }} />
        <div style={{
          position: 'absolute',
          inset: '15%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${primaryColor} 0%, ${primaryColor}66 60%, transparent 100%)`,
          transform: `scale(${orbScale})`,
          opacity: orbAlpha
        }} />
        <div style={{
          position: 'absolute',
          top: '25%', left: '30%',
          width: 12, height: 8,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.25)'
        }} />
      </div>

      {/* 标题 */}
      <h2 style={{ fontSize: '1.3em', margin: '0 0 4px' }}>
        🥚 {STEP_TITLES[step].title}
      </h2>
      <p style={{ color: '#8b949e', fontSize: 13, margin: '0 0 24px' }}>
        {STEP_TITLES[step].subtitle}
      </p>

      {/* Step 1: 颜色选择 */}
      {step === 'color' &&
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 400 }}>
          {COLOR_PRESETS.map((c) =>
        <button
          key={c.id}
          onClick={() => setPrimaryColor(c.hex)}
          style={{
            width: 48, height: 48,
            borderRadius: '50%',
            background: c.hex,
            border: primaryColor === c.hex ? '3px solid #fff' : '3px solid transparent',
            cursor: 'pointer',
            transition: 'transform 0.15s, border 0.15s',
            transform: primaryColor === c.hex ? 'scale(1.15)' : 'scale(1)',
            boxShadow: primaryColor === c.hex ? `0 0 16px ${c.hex}66` : 'none'
          }}
          title={c.label} />

        )}
        </div>
      }

      {/* Step 2: 质感选择 */}
      {step === 'texture' &&
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360, width: '100%' }}>
          {TEXTURE_OPTIONS.map((t) =>
        <button
          key={t.id}
          onClick={() => setTexture(t.id)}
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            border: texture === t.id ? `2px solid ${primaryColor}` : '2px solid #30363d',
            background: texture === t.id ? `${primaryColor}15` : '#161b22',
            color: '#c9d1d9',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
            transition: 'all 0.15s'
          }}>
          
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
              <div style={{ color: '#8b949e', fontSize: 12, marginTop: 2 }}>{t.desc}</div>
            </button>
        )}
        </div>
      }

      {/* Step 3: 气质选择 */}
      {step === 'temperament' &&
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360, width: '100%' }}>
          {TEMPERAMENT_OPTIONS.map((t) =>
        <button
          key={t.id}
          onClick={() => setTemperament(t.id)}
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            border: temperament === t.id ? `2px solid ${primaryColor}` : '2px solid #30363d',
            background: temperament === t.id ? `${primaryColor}15` : '#161b22',
            color: '#c9d1d9',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
            transition: 'all 0.15s'
          }}>
          
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
              <div style={{ color: '#8b949e', fontSize: 12, marginTop: 2 }}>{t.desc}</div>
            </button>
        )}
        </div>
      }

      {/* Step 4: LLM 配置 */}
      {step === 'llm' &&
      <div style={{ maxWidth: 400, width: '100%' }}>
          {/* Provider 选择 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {PROVIDERS.map((p) =>
          <button
            key={p.id}
            onClick={() => handleProviderSelect(p)}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: selectedProvider.id === p.id ? `2px solid ${primaryColor}` : '2px solid #30363d',
              background: selectedProvider.id === p.id ? `${primaryColor}15` : '#161b22',
              color: '#c9d1d9',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              fontSize: 13,
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 10
            }}>
            
                <span style={{ fontSize: 20 }}>{p.icon}</span>
                <span style={{ fontWeight: 600 }}>{p.label}</span>
              </button>
          )}
          </div>

          {/* 配置表单 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 提示 */}
            <div style={{ fontSize: 11, color: '#666' }}>
              {selectedProvider.needKey && !selectedProvider.needUrl && "\u9700\u8981\uFF1AAPI Key\uFF08\u6A21\u578B\u5C06\u81EA\u52A8\u53D1\u73B0\uFF09"}
              {!selectedProvider.needKey && selectedProvider.needUrl && "\u9700\u8981\uFF1ABase URL\uFF08\u672C\u5730\u90E8\u7F72\uFF09"}
              {selectedProvider.needKey && selectedProvider.needUrl && "\u9700\u8981\uFF1AAPI Key + Base URL"}
              {!selectedProvider.needKey && !selectedProvider.needUrl && "\u81EA\u52A8\u53D1\u73B0\u53EF\u7528\u6A21\u578B"}
            </div>

            {/* Base URL（按需显示） */}
            {selectedProvider.needUrl &&
          <>
                <label style={{ fontSize: 12, color: '#8b949e' }}>API Base URL</label>
                <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selectedProvider.defaultBaseUrl}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #30363d',
                background: '#0d1117',
                color: '#c9d1d9',
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none'
              }} />
            
              </>
          }

            {/* API Key（按需显示） */}
            {selectedProvider.needKey &&
          <>
                <label style={{ fontSize: 12, color: '#8b949e' }}>
                  API Key
                  {selectedProvider.keyUrl &&
              <a
                href={selectedProvider.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: primaryColor, marginLeft: 8, fontSize: 11 }}>
                {"\u83B7\u53D6 Key \u2192"}</a>
              }
                </label>
                <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selectedProvider.keyPlaceholder}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #30363d',
                background: '#0d1117',
                color: '#c9d1d9',
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none'
              }} />
            
              </>
          }

            {/* 发现结果反馈 */}
            {submitting &&
          <div style={{ color: '#8b949e', fontSize: 12, padding: '4px 0' }}>{"\u23F3 \u6B63\u5728\u6DFB\u52A0\u7AEF\u70B9\u5E76\u53D1\u73B0\u6A21\u578B..."}</div>
          }
            {discoveryResult?.modelCount !== undefined &&
          <div style={{ color: '#3fb950', fontSize: 12, padding: '4px 0' }}>{t('✅ 发现 {{count}} 个模型', { count: discoveryResult.modelCount })}</div>
          }
            {discoveryResult?.error &&
          <div style={{ color: '#f85149', fontSize: 12, padding: '4px 0' }}>{t('❌ 连接失败: {{error}}', { error: discoveryResult.error })}</div>
          }
          </div>
        </div>
      }

      {/* 进度指示器 */}
      <div style={{ display: 'flex', gap: 8, margin: '28px 0 16px' }}>
        {stepOrder.map((s) =>
        <div
          key={s}
          style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: s === step ? primaryColor : '#30363d',
            transition: 'background 0.2s'
          }} />

        )}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 12 }}>
        {step !== 'color' &&
        <button
          onClick={() => prevStep && setStep(prevStep)}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: 'transparent',
            color: '#8b949e',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13
          }}>
          {"\u4E0A\u4E00\u6B65"}</button>
        }
        {step === 'llm' &&
        <button
          onClick={() => {
            if (texture && temperament) {
              onComplete({
                primaryColor,
                texture,
                temperament,
                seed: Math.floor(Math.random() * 1000000)
              });
            }
          }}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: 'transparent',
            color: '#8b949e',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13
          }}>
          {"\u7A0D\u540E\u914D\u7F6E"}</button>
        }
        <button
          onClick={handleNext}
          disabled={!canNext() || submitting}
          style={{
            padding: '8px 24px',
            borderRadius: 8,
            border: 'none',
            background: canNext() && !submitting ? primaryColor : '#30363d',
            color: canNext() && !submitting ? '#fff' : '#484f58',
            cursor: canNext() && !submitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.15s'
          }}>
          
          {step === 'llm' ? submitting ? "\u8FDE\u63A5\u4E2D..." : "\u5F00\u542F\u65C5\u7A0B \u2192" : "\u4E0B\u4E00\u6B65"}
        </button>
      </div>
    </div>);

}