import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from './i18n/useTranslation';
import { changeLanguage } from './i18n';
import { useAudio } from './audio/use-audio.js';
import { playSFX } from './audio/sfx-player.js';
import { getEmotionTransitionSFX } from './emotion/emotion-sound.js';
import BuddyCanvas from './components/BuddyCanvas';
import ChatPanel from './components/ChatPanel';
import PetStats from './components/PetStats';
import Onboarding from './components/Onboarding';
import VisionPanel from './components/VisionPanel';
import Experts from './components/Experts';
import ErrorBoundary from './components/ErrorBoundary';
import ActivityPanel from './components/ActivityPanel';
import Settings from './components/Settings';
import ToolPanel from './components/ToolPanel';
import MemoryPanel from './components/MemoryPanel';
import KnowledgePanel from './components/KnowledgePanel';
import AgentTrace from './components/AgentTrace';
import { CognitiveDashboard } from './components/CognitiveDashboard';
import { ResourceProfilePanel } from './components/ResourceProfilePanel';
import SensorPanel from './components/SensorPanel';
import { IconLogo, TAB_ICONS, IconMic } from './components/Icons';
import { useWebSocket } from './hooks/useWebSocket';
import { useVoiceEmotion } from './hooks/useVoiceEmotion';
import type { VisualSeed } from './types/buddy';

// 自动选择 ws/wss 协议，支持 Vite proxy 和直连
const WS_BASE = import.meta.env.VITE_WS_URL ||
`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const STORAGE_KEY = 'buddy_visual_seed';

type Tab = 'chat' | 'tools' | 'memory' | 'knowledge' | 'activity' | 'stats' | 'vision' | 'sensors' | 'experts' | 'cognitive' | 'resources' | 'settings';

function App() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [lastPet, setLastPet] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [visualSeed, setVisualSeed] = useState<VisualSeed | null>(null);
  const [wsUrl, setWsUrl] = useState<string>('');
  const prevMoodRef = useRef<string>('neutral'); // Sprint 3: 情绪过渡音效追踪

  // 获取 WS Token 后构建连接 URL
  useEffect(() => {
    const tokenUrl = WS_BASE.replace(/^ws/, 'http').replace(/\/ws$/, '') + '/api/ws-token';
    fetch(tokenUrl).
    then((r) => r.json()).
    then((data) => {
      const sep = WS_BASE.includes('?') ? '&' : '?';
      setWsUrl(`${WS_BASE}${sep}token=${encodeURIComponent(data.token)}`);
    }).
    catch(() => {
      // token 端点不可用（旧版后端），直接连接
      setWsUrl(WS_BASE);
    });
  }, []);

  // 检查本地是否已有视觉种子
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 从 localStorage 恢复初始状态，仅首次 mount 时执行
        setVisualSeed(JSON.parse(stored));
      } catch {/* ignore */}
    } else {
      // 没有种子 → 显示 Onboarding
      setShowOnboarding(true);
    }
  }, []);

  const { playClick, playReceive, playTabSwitch, playSuccess, playError, playMood, playEvent } = useAudio();

  const handleWsEvent = useCallback((event: {type: string;success?: boolean;mood?: string;}) => {
    if (import.meta.env.DEV) console.log('[Buddy]', event);
    switch (event.type) {
      case 'llm_response':playReceive();break;
      case 'tool_call':playEvent('toolStart');break;
      case 'tool_result':if (event.success) playSuccess();else playError();break;
      case 'evolution':playEvent('evolution');break;
      case 'dream_complete':playEvent('dreamComplete');break;
      case 'bubble':playEvent('notification');break;
      case 'emotion':playMood(event.mood);break;
      case 'error':playError();break;
    }
  }, [playReceive, playEvent, playSuccess, playError, playMood]);

  const { connected, messages, spriteState, buddyState, send, sendPet, sendVisualSeed, sendToolConfirm, ternaryExperts, trainProgress, toolPanelData, memoryPanelData, knowledgePanelData, perceptionEvents, agentTrace, dreamLogs, registeredSkills, scheduleEvents, sensorData, requestToolPanel, requestMemoryPanel, requestKnowledgePanel, clearMessages, activeTaskCount, maxConcurrent, actionMeta, narration, ws } = useWebSocket({
    url: wsUrl,
    onEvent: handleWsEvent
  });

  // 语音情绪检测 → 发送 emotion_source 到后端
  const voiceEmotion = useVoiceEmotion({
    analysisIntervalMs: 3000,
    onEmotion: (result) => {
      if (connected && ws) {
        ws.send(JSON.stringify({
          type: 'emotion_source',
          source: 'user_voice',
          mood: result.emotion,
          confidence: result.confidence,
          features: result.features
        }));
      }
    }
  });

  // 连接后发送视觉种子
  useEffect(() => {
    if (connected && visualSeed) {
      sendVisualSeed(visualSeed);
    }
  }, [connected, visualSeed, sendVisualSeed]);

  // Sprint 3: 情绪变化时播放过渡音效
  useEffect(() => {
    if (!buddyState?.emotion) return;
    const currentMood = buddyState.emotion.mood || 'neutral';
    const prevMood = prevMoodRef.current;
    if (currentMood !== prevMood) {
      const transition = getEmotionTransitionSFX(prevMood, currentMood);
      if (transition) {
        playSFX(transition, `emotion-transition-${currentMood}`);
      }
      prevMoodRef.current = currentMood;
    }
  }, [buddyState?.emotion]);

  // Sprint 4: 同步状态到 Electron 浮窗
  useEffect(() => {
    if (!buddyState) return;
    // Electron IPC（通过 preload 桥接）
    if (window.electronAPI?.buddyStateSync) {
      window.electronAPI.buddyStateSync({
        mood: buddyState.emotion?.mood || 'neutral',
        energy: buddyState.emotion?.energy ?? 0.5,
        satisfaction: buddyState.emotion?.satisfaction ?? 0.5,
        curiosity: buddyState.emotion?.curiosity ?? 0.3,
        stage: buddyState.visualStage?.stage || 'formed',
        primaryColor: buddyState.visualSeed?.primaryColor || '#58a6ff',
        secondaryColor: buddyState.visualSeed?.secondaryColor || '#a371f7',
        texture: buddyState.visualSeed?.texture || 'soft',
        temperament: buddyState.visualSeed?.temperament || 'warm'
      });
    }
    // 通用 postMessage（非 Electron 环境降级）
    window.postMessage({
      type: 'state_update',
      state: {
        mood: buddyState.emotion?.mood || 'neutral',
        energy: buddyState.emotion?.energy ?? 0.5,
        satisfaction: buddyState.emotion?.satisfaction ?? 0.5,
        curiosity: buddyState.emotion?.curiosity ?? 0.3,
        stage: buddyState.visualStage?.stage || 'formed',
        primaryColor: buddyState.visualSeed?.primaryColor || '#58a6ff',
        secondaryColor: buddyState.visualSeed?.secondaryColor || '#a371f7'
      }
    }, '*');
  }, [buddyState]);

  // Token 自动刷新：连接失败时重新获取 ws-token
  useEffect(() => {
    if (!connected && wsUrl) {
      const timer = setTimeout(() => {
        const tokenUrl = WS_BASE.replace(/^ws/, 'http').replace(/\/ws$/, '') + '/api/ws-token';
        fetch(tokenUrl).
        then((r) => r.json()).
        then((data) => {
          const sep = WS_BASE.includes('?') ? '&' : '?';
          setWsUrl(`${WS_BASE}${sep}token=${encodeURIComponent(data.token)}`);
        }).
        catch(() => {/* ignore */});
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [connected, wsUrl]);

  const handleOnboardingComplete = useCallback((seed: VisualSeed) => {
    setVisualSeed(seed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    setShowOnboarding(false);
    // 立即发送到后端
    sendVisualSeed(seed);
  }, [sendVisualSeed]);

  const handlePet = useCallback(() => {
    const now = Date.now();
    if (now - lastPet < 500) return;
    setLastPet(now);
    playClick();
    sendPet();
  }, [lastPet, sendPet, playClick]);

  // Retry handler: resend last user message
  const handleRetry = useCallback((messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (msg && msg.role === 'user') {
      send(msg.content);
    }
  }, [messages, send]);

  // Delete handler: remove message (local only, or could call API)
  const handleDelete = useCallback((_messageId: string) => {
    // For now, this is a placeholder — the backend would need a delete endpoint
    // The visual removal would happen through re-fetching messages
    console.log('[Chat] Delete requested for:', _messageId);
  }, []);

  // Onboarding
  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  const tabs: {key: Tab;label: string;}[] = [
  { key: 'chat', label: "聊天" },
  { key: 'tools', label: "工具" },
  { key: 'memory', label: "记忆" },
  { key: 'knowledge', label: "知识" },
  { key: 'activity', label: "活动" },
  { key: 'stats', label: "探索" },
  { key: 'vision', label: "视觉" },
  { key: 'sensors', label: "传感" },
  { key: 'experts', label: "专家" },
  { key: 'cognitive', label: "认知" },
  { key: 'resources', label: "资源" },
  { key: 'settings', label: "设置" }];


  return (
    <div className="app-root" style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-mono)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 16
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12, position: 'relative', width: '100%', maxWidth: 1200 }}>
        <h1 style={{ fontSize: '1.4em', margin: 0, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}><IconLogo size={28} color="var(--accent-blue)" /> {"光灵"}</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{"\u4F60\u7684 AI \u4F19\u4F34"}</div>
        {/* 语音情绪检测开关 */}
        <button
          onClick={voiceEmotion.toggle}
          title={voiceEmotion.isAnalyzing ? `情绪检测中: ${voiceEmotion.currentEmotion}` : '开启语音情绪检测'}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: voiceEmotion.isAnalyzing ? 'var(--accent-green, #3fb950)' : 'var(--bg-tertiary)',
            color: voiceEmotion.isAnalyzing ? '#fff' : 'var(--text-muted)',
            border: 'none',
            borderRadius: '50%',
            width: 32,
            height: 32,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            boxShadow: voiceEmotion.isAnalyzing ? '0 0 8px rgba(63,185,80,.4)' : 'none'
          }}>
          
          <IconMic size={16} color={voiceEmotion.isAnalyzing ? '#fff' : 'var(--text-muted)'} active={voiceEmotion.isAnalyzing} />
        </button>
        {voiceEmotion.isAnalyzing && voiceEmotion.currentEmotion !== 'none' &&
        <div style={{
          position: 'absolute',
          top: 36,
          right: 0,
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--bg-secondary)',
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid var(--border-primary)'
        }}>
            检测到: {voiceEmotion.currentEmotion}
          </div>
        }
        {voiceEmotion.error &&
        <div style={{
          position: 'absolute',
          top: 36,
          right: 0,
          fontSize: 11,
          color: 'var(--accent-red)'
        }}>
            {voiceEmotion.error}
          </div>
        }
      </div>

      {/* Main Layout */}
      <div className="app-main-layout" style={{
        display: 'flex',
        gap: 20,
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 1200,
        width: '100%'
      }}>
        {/* Left: Sprite + Compact Stats */}
        <div className="app-sprite-col" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minWidth: 280
        }}>
          <BuddyCanvas
            state={spriteState}
            buddyState={buddyState}
            onClick={handlePet}
            actionMeta={actionMeta} />
          

          {/* Visual stage indicator */}
          {buddyState?.visualStage &&
          <div style={{
            display: 'flex',
            gap: 12,
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 8,
            alignItems: 'center'
          }}>
              <span>{buddyState.visualStage.emoji} {buddyState.visualStage.name}</span>
              <span style={{
              display: 'inline-block',
              width: 60,
              height: 4,
              background: 'var(--bg-tertiary)',
              borderRadius: 2,
              overflow: 'hidden',
              position: 'relative' as const
            }}>
                <span style={{
                position: 'absolute' as const,
                left: 0, top: 0, bottom: 0,
                width: `${buddyState.formProgress || 0}%`,
                background: buddyState.visualSeed?.primaryColor || 'var(--accent-blue)',
                borderRadius: 2,
                transition: 'width 0.5s'
              }} />
              </span>
              <span>{buddyState.formProgress || 0}%</span>
            </div>
          }

          {/* Compact stats below sprite */}
          {buddyState &&
          <div style={{
            display: 'flex',
            gap: 16,
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 4,
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
              {buddyState.visualStage &&
            <span>{buddyState.visualStage.emoji} {buddyState.visualStage.name}</span>
            }
              <span>❤️ {buddyState.intimacy}</span>
              {buddyState.rarity !== 'Common' &&
            <span style={{ color: buddyState.rarityColor || 'var(--text-muted)' }}>
                  {buddyState.rarity}
                </span>
            }
            </div>
          }
        </div>

        {/* Right: Tabbed Panel */}
        <div className="app-tab-panel" style={{
          flex: 1,
          minWidth: 340,
          maxWidth: 640,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden'
        }}>
          {/* Tabs */}
          <div style={{
            display: 'flex',
            gap: 2,
            padding: '8px 8px 0',
            borderBottom: '1px solid var(--border-primary)',
            flexWrap: 'wrap'
          }}>
            {tabs.map((t) =>
            <button
              key={t.key}
              onClick={() => {setActiveTab(t.key);playTabSwitch();}}
              style={{
                padding: '6px 14px',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                fontSize: 12,
                background: activeTab === t.key ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                color: activeTab === t.key ? 'var(--text-secondary)' : 'var(--text-muted)',
                border: 'none',
                borderTop: activeTab === t.key ? '2px solid var(--accent-blue)' : '2px solid transparent',
                fontFamily: 'inherit',
                transition: 'all 0.15s'
              }}>
              
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {(() => {
                  const IconComp = TAB_ICONS[t.key];
                  return IconComp ? <IconComp size={15} active={activeTab === t.key} color={activeTab === t.key ? 'var(--text-secondary)' : 'var(--text-muted)'} /> : null;
                })()}
                {t.label}
              </span>
              </button>
            )}
          </div>

          {/* Tab Content — B.3: All tabs rendered, visibility toggled via display */}
          <div style={{ padding: 12 }}>
            <div style={{ display: activeTab === 'chat' ? 'block' : 'none' }}>
              <ErrorBoundary name="对话">
                <div>
                  <ChatPanel
                    messages={messages}
                    onSend={send}
                    onClear={clearMessages}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                    onConfirm={sendToolConfirm}
                    connected={connected}
                    primaryColor={visualSeed?.primaryColor}
                    activeTaskCount={activeTaskCount}
                    maxConcurrent={maxConcurrent}
                    narration={narration} />
                  
                  {agentTrace.length > 0 &&
                  <div style={{ marginTop: 8, padding: '8px 0', borderTop: '1px solid var(--border-primary)' }}>
                      <AgentTrace trace={agentTrace} primaryColor={visualSeed?.primaryColor} />
                    </div>
                  }
                </div>
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'tools' ? 'block' : 'none' }}>
              <ErrorBoundary name="工具">
                <ToolPanel data={toolPanelData} onRequestData={requestToolPanel} primaryColor={visualSeed?.primaryColor} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'memory' ? 'block' : 'none' }}>
              <ErrorBoundary name="记忆">
                <MemoryPanel data={memoryPanelData} onRequestData={requestMemoryPanel} primaryColor={visualSeed?.primaryColor} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'knowledge' ? 'block' : 'none' }}>
              <ErrorBoundary name="知识">
                <KnowledgePanel data={knowledgePanelData} onRequestData={requestKnowledgePanel} primaryColor={visualSeed?.primaryColor} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'activity' ? 'block' : 'none' }}>
              <ErrorBoundary name="活动">
                <ActivityPanel
                  petStats={buddyState?.petStats ?? null}
                  dreamLogs={dreamLogs}
                  sensorData={sensorData}
                  scheduleEvents={scheduleEvents}
                  perceptionEvents={perceptionEvents}
                  primaryColor={visualSeed?.primaryColor} />
                
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'stats' ? 'block' : 'none' }}>
              <ErrorBoundary name="探索">
                <PetStats buddyState={buddyState} spriteState={spriteState} onPet={handlePet} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'vision' ? 'block' : 'none' }}>
              <ErrorBoundary name="视觉">
                <VisionPanel primaryColor={visualSeed?.primaryColor} onResult={(r) => {
                  if (import.meta.env.DEV) console.log('[Vision]', r);
                  const { type: _ignored, ...rest } = r;
                  send(JSON.stringify({ ...rest, type: 'vision_result' }));
                }} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'sensors' ? 'block' : 'none' }}>
              <ErrorBoundary name="传感">
                <SensorPanel
                  primaryColor={visualSeed?.primaryColor}
                  onSensorUpdate={(data) => {
                    send(JSON.stringify({ type: 'sensor_update', data }));
                  }} />
                
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'experts' ? 'block' : 'none' }}>
              <ErrorBoundary name="专家">
                <Experts wsExperts={ternaryExperts} trainProgress={trainProgress} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'cognitive' ? 'block' : 'none' }}>
              <ErrorBoundary name="认知">
                <CognitiveDashboard ws={ws} connected={connected} skills={registeredSkills} />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'resources' ? 'block' : 'none' }}>
              <ErrorBoundary name="资源画像">
                <ResourceProfilePanel />
              </ErrorBoundary>
            </div>

            <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
              <ErrorBoundary name="设置">
                <Settings
                  primaryColor={visualSeed?.primaryColor}
                  language={currentLang}
                  onLanguageChange={(lang) => {
                    changeLanguage(lang as any);
                  }} />
                
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>

      {/* B.2: Responsive layout media queries */}
      <style>{`
        @media (max-width: 768px) {
          .app-main-layout {
            flex-direction: column !important;
            align-items: center !important;
          }
          .app-sprite-col {
            min-width: unset !important;
            width: 100% !important;
          }
          .app-tab-panel {
            min-width: unset !important;
            max-width: 100% !important;
            width: 100% !important;
          }
        }
        @media (max-width: 480px) {
          .app-root {
            padding: 4px !important;
          }
          .app-root h1 {
            font-size: 1.1em !important;
          }
          .app-tab-panel {
            border-radius: var(--radius-md) !important;
          }
        }
      `}</style>
    </div>);

}

export default App;