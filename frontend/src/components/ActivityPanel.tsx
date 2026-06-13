// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState, useEffect } from 'react';
import { t } from '../i18n/t';


// ==================== Types ====================

interface DailyActivity {
  date: string;
  messages: number;
  toolCalls: number;
}

interface DreamLog {
  journal: string;
  timestamp: number;
}

interface PerceptionEvent {
  id?: string;
  category: string;
  source: string;
  data?: unknown;
  timestamp: number;
}

interface SensorData {
  location: {lat: number;lng: number;accuracy: number;} | null;
  motion: {x: number;y: number;z: number;state: string;} | null;
  environment: {light: number;battery: number;online: boolean;} | null;
}

interface ScheduleEvent {
  input: string;
  taskType: string;
  domain?: string;
  selectedNode: string;
  layer: 1 | 2 | 3;
  reason: string;
  outputTokenLimit: number;
  success: boolean;
  latencyMs: number;
  fallbackTriggered: boolean;
  timestamp: number;
  providerStats?: {
    rpm: number;
    rpmLimit: number;
    tpm: number;
    tpmLimit: number;
    inCooldown: boolean;
  };
}

interface ActivityPanelProps {
  petStats: {
    totalMessages: number;
    totalToolCalls: number;
    totalDays: number;
    consecutiveDays: number;
    dailyActivity?: DailyActivity[];
  } | null;
  dreamLogs: DreamLog[];
  sensorData: SensorData | null;
  scheduleEvents?: ScheduleEvent[];
  perceptionEvents?: PerceptionEvent[];
  primaryColor?: string;
  onRequestSensor?: () => void;
}

type SubTab = 'timeline' | 'stats' | 'scheduler' | 'dreams' | 'sensors' | 'perception';

// ==================== Helpers ====================

/** token → 费用估算 (USD, 基于 GPT-4o 价格) */
function estimateCost(tokens: number, model = 'default'): number {
  const rates: Record<string, {input: number;output: number;}> = {
    'default': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    'deepseek-chat': { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },
    'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 }
  };
  const rate = rates[model] || rates['default'];
  // 假设 input:output = 3:1
  return tokens * 0.75 * rate.input + tokens * 0.25 * rate.output;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(1)}¢`;
  return `$${usd.toFixed(3)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ==================== Component ====================

export default function ActivityPanel({
  petStats,
  dreamLogs,
  sensorData,
  scheduleEvents = [],
  perceptionEvents = [],
  primaryColor = '#58a6ff',
  onRequestSensor
}: ActivityPanelProps) {

  const [activeSubTab, setActiveSubTab] = useState<SubTab>('timeline');

  const subTabs: {key: SubTab;icon: string;label: string;}[] = [
  { key: 'timeline', icon: '📋', label: '时间线' },
  { key: 'stats', icon: '📊', label: '统计' },
  { key: 'scheduler', icon: '🤖', label: '调度器' },
  { key: 'dreams', icon: '💭', label: '梦境' },
  { key: 'sensors', icon: '📡', label: '传感器' },
  { key: 'perception', icon: '👁️', label: '感知' }];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto' }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {subTabs.map((tab) =>
        <button
          key={tab.key}
          onClick={() => setActiveSubTab(tab.key)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11,
            background: activeSubTab === tab.key ? `${primaryColor}22` : '#21262d',
            color: activeSubTab === tab.key ? primaryColor : '#8b949e',
            border: `1px solid ${activeSubTab === tab.key ? primaryColor : '#30363d'}`,
            fontFamily: 'inherit',
            transition: 'all 0.15s'
          }}>
          
            {tab.icon} {tab.label}
          </button>
        )}
      </div>

      {/* Content */}
      {activeSubTab === 'timeline' && <TimelineSection petStats={petStats} primaryColor={primaryColor} />}
      {activeSubTab === 'stats' && <StatsSection petStats={petStats} primaryColor={primaryColor} />}
      {activeSubTab === 'scheduler' && <SchedulerSection scheduleEvents={scheduleEvents} primaryColor={primaryColor} />}
      {activeSubTab === 'dreams' && <DreamsSection dreamLogs={dreamLogs} primaryColor={primaryColor} />}
      {activeSubTab === 'sensors' &&
      <SensorsSection
        sensorData={sensorData}
        primaryColor={primaryColor}
        onRequestSensor={onRequestSensor} />

      }
      {activeSubTab === 'perception' &&
      <PerceptionSection events={perceptionEvents} primaryColor={primaryColor} />
      }
    </div>);

}

// ==================== Timeline Section ====================

function TimelineSection({ petStats, primaryColor }: {petStats: ActivityPanelProps['petStats'];primaryColor: string;}) {

  const dailyData = petStats?.dailyActivity ?? [];

  if (dailyData.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>{"\u6682\u65E0\u6D3B\u52A8\u8BB0\u5F55"}</div>);

  }

  // 最近 14 天
  const recent = dailyData.slice(-14);
  const maxVal = Math.max(...recent.map((d) => d.messages + d.toolCalls), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{t('📋 最近 {{count}} 天活动', { count: recent.length })}</div>

      {/* 热力图 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(recent.length, 7)}, 1fr)`,
        gap: 4
      }}>
        {recent.map((day, i) => {
          const total = day.messages + day.toolCalls;
          const intensity = total / maxVal;
          return (
            <div
              key={i}
              title={`${day.date}: ${day.messages} ${"\u6D88\u606F"}, ${day.toolCalls} ${"\u5DE5\u5177"}`}
              style={{
                aspectRatio: '1',
                borderRadius: 4,
                background: total === 0 ?
                '#21262d' :
                `${primaryColor}${Math.round(intensity * 80 + 20).toString(16).padStart(2, '0')}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                color: intensity > 0.5 ? '#fff' : '#8b949e',
                cursor: 'default',
                transition: 'all 0.15s'
              }}>
              
              {formatDate(day.date)}
            </div>);

        })}
      </div>

      {/* 详细列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recent.slice().reverse().slice(0, 7).map((day, i) =>
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            borderRadius: 6,
            background: '#0d1117',
            border: '1px solid #30363d',
            fontSize: 11
          }}>
          
            <span style={{ color: '#c9d1d9' }}>{day.date}</span>
            <div style={{ display: 'flex', gap: 12, color: '#8b949e' }}>
              <span>💬 {day.messages}</span>
              <span>🔧 {day.toolCalls}</span>
            </div>
          </div>
        )}
      </div>
    </div>);

}

// ==================== Stats Section ====================

function StatsSection({ petStats, primaryColor }: {petStats: ActivityPanelProps['petStats'];primaryColor: string;}) {

  if (!petStats) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>{"\u6682\u65E0\u7EDF\u8BA1\u6570\u636E"}</div>);

  }

  // Token 估算
  const estimatedTokens = petStats.totalMessages * 500; // 平均每条消息 ~500 tokens
  const estimatedCost = estimateCost(estimatedTokens);

  const stats = [
  { emoji: '💬', label: "\u603B\u6D88\u606F", value: petStats.totalMessages, color: '#58a6ff' },
  { emoji: '🔧', label: "\u5DE5\u5177\u8C03\u7528", value: petStats.totalToolCalls, color: '#3fb950' },
  { emoji: '📅', label: "\u6D3B\u8DC3\u5929\u6570", value: petStats.totalDays, color: '#d29922' },
  { emoji: '🔥', label: "\u8FDE\u7EED\u5929\u6570", value: petStats.consecutiveDays, color: '#f778ba' },
  { emoji: '🪙', label: "\u9884\u4F30 Tokens", value: estimatedTokens.toLocaleString(), color: '#a371f7' },
  { emoji: '💰', label: "\u9884\u4F30\u8D39\u7528", value: formatCost(estimatedCost), color: '#d29922' }];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{"\uD83D\uDCCA \u4F7F\u7528\u7EDF\u8BA1"}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {stats.map((s, i) =>
        <div
          key={i}
          style={{
            padding: '12px 10px',
            borderRadius: 8,
            background: '#0d1117',
            border: '1px solid #30363d',
            textAlign: 'center'
          }}>
          
            <div style={{ fontSize: 18 }}>{s.emoji}</div>
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        )}
      </div>

      {/* 每日消息量折线图（简易 SVG） */}
      {petStats.dailyActivity && petStats.dailyActivity.length > 1 &&
      <MiniLineChart
        data={petStats.dailyActivity.map((d) => ({ label: formatDate(d.date), value: d.messages + d.toolCalls }))}
        color={primaryColor}
        height={80} />

      }
    </div>);

}

// ==================== Mini Line Chart ====================

function MiniLineChart({ data, color, height = 80 }: {data: {label: string;value: number;}[];color: string;height?: number;}) {
  const recent = data.slice(-14);
  const maxVal = Math.max(...recent.map((d) => d.value), 1);
  const w = 100;
  const h = height;
  const padding = 4;

  const points = recent.map((d, i) => {
    const x = padding + i / (recent.length - 1) * (w - padding * 2);
    const y = h - padding - d.value / maxVal * (h - padding * 2);
    return `${x},${y}`;
  });

  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: '8px 4px 4px' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: `${h}px` }}>
        {/* Grid line */}
        <line x1={padding} y1={h - padding} x2={w - padding} y2={h - padding} stroke="#21262d" strokeWidth="0.5" />
        {/* Line */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round" />
        
        {/* Dots */}
        {recent.map((d, i) => {
          const x = padding + i / (recent.length - 1) * (w - padding * 2);
          const y = h - padding - d.value / maxVal * (h - padding * 2);
          return (
            <circle key={i} cx={x} cy={y} r="2" fill={color} opacity={0.8} />);

        })}
      </svg>
    </div>);

}

// ==================== Scheduler Section ====================

function SchedulerSection({ scheduleEvents, primaryColor }: {scheduleEvents: ScheduleEvent[];primaryColor: string;}) {

  if (scheduleEvents.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>
        {"\uD83E\uDD16 \u6682\u65E0\u8C03\u5EA6\u8BB0\u5F55"}
        <div style={{ fontSize: 11, marginTop: 8, color: '#30363d' }}>{"\u8C03\u5EA6\u5668\u8FD0\u884C\u540E\u4F1A\u5728\u6B64\u5C55\u793A\u51B3\u7B56\u5386\u53F2"}</div>
      </div>);

  }

  // 统计
  const layerCounts = { 1: 0, 2: 0, 3: 0 };
  const successCount = scheduleEvents.filter((e) => e.success).length;
  const avgLatency = scheduleEvents.reduce((a, e) => a + e.latencyMs, 0) / scheduleEvents.length;
  const nodeCounts: Record<string, number> = {};

  for (const e of scheduleEvents) {
    layerCounts[e.layer]++;
    nodeCounts[e.selectedNode] = (nodeCounts[e.selectedNode] ?? 0) + 1;
  }

  const topNodes = Object.entries(nodeCounts).
  sort((a, b) => b[1] - a[1]).
  slice(0, 5);

  const layerLabels = { 1: "\u89C4\u5219\u5FEB\u7B5B", 2: "\u7ECF\u9A8C\u8DEF\u7531", 3: "\u7EA7\u8054\u515C\u5E95" };
  const layerColors = { 1: '#3fb950', 2: primaryColor, 3: '#d29922' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 概览 */}
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{t('🤖 调度概览（最近 {{count}} 次）', { count: scheduleEvents.length })}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <div style={{ padding: '10px 8px', borderRadius: 8, background: '#0d1117', border: '1px solid #30363d', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{"\u6210\u529F\u7387"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: successCount / scheduleEvents.length > 0.8 ? '#3fb950' : '#d29922' }}>
            {Math.round(successCount / scheduleEvents.length * 100)}%
          </div>
        </div>
        <div style={{ padding: '10px 8px', borderRadius: 8, background: '#0d1117', border: '1px solid #30363d', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{"\u5E73\u5747\u5EF6\u8FDF"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: primaryColor }}>
            {avgLatency.toFixed(0)}ms
          </div>
        </div>
        <div style={{ padding: '10px 8px', borderRadius: 8, background: '#0d1117', border: '1px solid #30363d', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{"\u603B\u8C03\u5EA6"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c9d1d9' }}>
            {scheduleEvents.length}
          </div>
        </div>
      </div>

      {/* 层级分布 */}
      <div style={{ padding: '10px 12px', borderRadius: 8, background: '#0d1117', border: '1px solid #30363d' }}>
        <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 6 }}>{"\u8C03\u5EA6\u5C42\u7EA7\u5206\u5E03"}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {([1, 2, 3] as const).map((layer) => {
            const count = layerCounts[layer];
            const pct = scheduleEvents.length > 0 ? count / scheduleEvents.length * 100 : 0;
            return (
              <div key={layer} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: 4,
                  borderRadius: 2,
                  background: layerColors[layer],
                  width: `${pct}%`,
                  margin: '0 auto 4px',
                  minWidth: pct > 0 ? 4 : 0
                }} />
                <div style={{ fontSize: 9, color: '#8b949e' }}>L{layer}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: layerColors[layer] }}>{count}</div>
              </div>);

          })}
        </div>
      </div>

      {/* 热门节点 */}
      {topNodes.length > 0 &&
      <div style={{ padding: '10px 12px', borderRadius: 8, background: '#0d1117', border: '1px solid #30363d' }}>
          <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 6 }}>{"\u70ED\u95E8\u8282\u70B9"}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topNodes.map(([node, count]) =>
          <div key={node} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#c9d1d9', fontFamily: "'Cascadia Code', monospace", fontSize: 10 }}>{node}</span>
                <span style={{ color: primaryColor }}>{count}</span>
              </div>
          )}
          </div>
        </div>
      }

      {/* 最近调度记录 */}
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, marginTop: 4 }}>{"\uD83D\uDCCB \u6700\u8FD1\u8C03\u5EA6"}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scheduleEvents.slice(0, 10).map((event, i) => {
          const time = new Date(event.timestamp);
          const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

          return (
            <div
              key={i}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: '#0d1117',
                border: `1px solid ${event.success ? '#30363d' : '#f8514933'}`
              }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#8b949e' }}>{timeStr}</span>
                  <span style={{
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: `${layerColors[event.layer]}22`,
                    color: layerColors[event.layer]
                  }}>
                    L{event.layer}
                  </span>
                  <span style={{
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: event.success ? '#3fb95022' : '#f8514922',
                    color: event.success ? '#3fb950' : '#f85149'
                  }}>
                    {event.success ? '✓' : '✗'}
                  </span>
                </div>
                <span style={{ fontSize: 10, color: '#8b949e' }}>{event.latencyMs}ms</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: 10,
                  color: '#c9d1d9',
                  fontFamily: "'Cascadia Code', monospace",
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '60%'
                }}>
                  {event.selectedNode}
                </span>
                <span style={{ fontSize: 9, color: '#8b949e' }}>{event.taskType}</span>
              </div>
              {event.reason &&
              <div style={{ fontSize: 9, color: '#484f58', marginTop: 2 }}>
                  {event.reason}
                  {event.fallbackTriggered && " \u26A0\uFE0F \u7EA7\u8054"}
                </div>
              }
              {event.providerStats &&
              <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 9, color: '#8b949e' }}>
                  <span>RPM: {event.providerStats.rpm}/{event.providerStats.rpmLimit}</span>
                  <span>TPM: {event.providerStats.tpm.toLocaleString()}/{event.providerStats.tpmLimit.toLocaleString()}</span>
                  {event.providerStats.inCooldown && <span style={{ color: '#f85149' }}>{"\u51B7\u5374\u4E2D"}</span>}
                </div>
              }
            </div>);

        })}
      </div>
    </div>);

}

// ==================== Dreams Section ====================

function DreamsSection({ dreamLogs, primaryColor: _primaryColor }: {dreamLogs: DreamLog[];primaryColor: string;}) {

  if (dreamLogs.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>
        {"\uD83D\uDCA4 \u8FD8\u6CA1\u6709\u68A6\u5883\u8BB0\u5F55"}
        <div style={{ fontSize: 11, marginTop: 8, color: '#30363d' }}>{"\u5149\u7075\u4F1A\u5728\u7A7A\u95F2\u65F6\u8FDB\u5165\u68A6\u5883\uFF0C\u5DE9\u56FA\u8BB0\u5FC6"}</div>
      </div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{"💭 梦境日志 ("}{dreamLogs.length}{")"}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dreamLogs.map((dream, i) => {
          const time = new Date(dream.timestamp);
          const timeStr = time.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });

          return (
            <div
              key={i}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: '#0d1117',
                border: '1px solid #30363d'
              }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#8b949e' }}>🌙 {timeStr}</span>
                <span style={{ fontSize: 9, color: '#484f58' }}>#{dreamLogs.length - i}</span>
              </div>
              <div style={{
                fontSize: 12,
                color: '#c9d1d9',
                lineHeight: 1.5,
                maxHeight: 80,
                overflow: 'hidden',
                whiteSpace: 'pre-wrap'
              }}>
                {dream.journal.slice(0, 300)}{dream.journal.length > 300 ? '...' : ''}
              </div>
            </div>);

        })}
      </div>
    </div>);

}

// ==================== Sensors Section ====================

function SensorsSection({
  sensorData,
  primaryColor: _primaryColor,
  onRequestSensor




}: {sensorData: SensorData | null;primaryColor: string;onRequestSensor?: () => void;}) {

  const [envInfo, setEnvInfo] = useState(() => ({
    userAgent: navigator.userAgent.slice(0, 60),
    language: navigator.language,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency || 0,
    memory: (navigator as any).deviceMemory || 0,
    screen: `${screen.width}×${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine
  }));

  useEffect(() => {
    const handleOnline = () => setEnvInfo((prev) => ({ ...prev, online: true }));
    const handleOffline = () => setEnvInfo((prev) => ({ ...prev, online: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const envItems = [
  { icon: '🌐', label: "\u7F51\u7EDC", value: envInfo.online ? "\u5728\u7EBF" : "\u79BB\u7EBF", color: envInfo.online ? '#3fb950' : '#f85149' },
  { icon: '🗣️', label: "\u8BED\u8A00", value: envInfo.language },
  { icon: '💻', label: "\u5E73\u53F0", value: envInfo.platform },
  { icon: '⚡', label: "CPU \u6838\u5FC3", value: envInfo.cores || "\u672A\u77E5" },
  { icon: '🧠', label: "\u5185\u5B58", value: envInfo.memory ? `${envInfo.memory} GB` : "\u672A\u77E5" },
  { icon: '📺', label: "\u5C4F\u5E55", value: envInfo.screen },
  { icon: '🕐', label: "\u65F6\u533A", value: envInfo.timezone }];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 环境信息 */}
      <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>{"\uD83C\uDF0D \u73AF\u5883\u4FE1\u606F"}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {envItems.map((item, i) =>
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            borderRadius: 6,
            background: '#0d1117',
            border: '1px solid #30363d',
            fontSize: 11
          }}>
          
            <span style={{ color: '#8b949e' }}>{item.icon} {item.label}</span>
            <span style={{ color: (item as any).color || '#c9d1d9', fontFamily: "'Cascadia Code', monospace", fontSize: 10 }}>
              {item.value}
            </span>
          </div>
        )}
      </div>

      {/* 传感器数据（如果可用） */}
      {sensorData &&
      <>
          <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, marginTop: 8 }}>{"\uD83D\uDCE1 \u8BBE\u5907\u4F20\u611F\u5668"}</div>

          {sensorData.location &&
        <div style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0d1117',
          border: '1px solid #30363d',
          fontSize: 11
        }}>
              <div style={{ color: '#8b949e', marginBottom: 4 }}>{"\uD83D\uDCCD \u4F4D\u7F6E"}</div>
              <div style={{ color: '#c9d1d9', fontFamily: "'Cascadia Code', monospace", fontSize: 10 }}>
                {sensorData.location.lat.toFixed(5)}, {sensorData.location.lng.toFixed(5)}
                <span style={{ color: '#8b949e', marginLeft: 8 }}>±{sensorData.location.accuracy.toFixed(0)}m</span>
              </div>
            </div>
        }

          {sensorData.motion &&
        <div style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0d1117',
          border: '1px solid #30363d',
          fontSize: 11
        }}>
              <div style={{ color: '#8b949e', marginBottom: 4 }}>{"\uD83D\uDCF3 \u8FD0\u52A8\u72B6\u6001"}</div>
              <div style={{ color: '#c9d1d9', fontSize: 10 }}>
                {sensorData.motion.state}
                <span style={{ color: '#8b949e', marginLeft: 8 }}>
                  x:{sensorData.motion.x.toFixed(1)} y:{sensorData.motion.y.toFixed(1)} z:{sensorData.motion.z.toFixed(1)}
                </span>
              </div>
            </div>
        }

          {sensorData.environment &&
        <div style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0d1117',
          border: '1px solid #30363d',
          fontSize: 11
        }}>
              <div style={{ color: '#8b949e', marginBottom: 4 }}>{"\uD83D\uDD0B \u73AF\u5883"}</div>
              <div style={{ display: 'flex', gap: 12, color: '#c9d1d9', fontSize: 10 }}>
                <span>💡 {sensorData.environment.light.toFixed(0)} lux</span>
                <span>🔋 {sensorData.environment.battery}%</span>
                <span>{sensorData.environment.online ? "\uD83D\uDFE2 \u5728\u7EBF" : "\uD83D\uDD34 \u79BB\u7EBF"}</span>
              </div>
            </div>
        }
        </>
      }

      {/* 获取传感器按钮 */}
      <button
        onClick={onRequestSensor}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 11,
          background: '#21262d',
          color: '#8b949e',
          border: '1px solid #30363d',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
          marginTop: 4
        }}>
        {"\uD83D\uDCE1 \u5237\u65B0\u4F20\u611F\u5668\u6570\u636E"}</button>
    </div>);

}

// ==================== Perception Section ====================

const CATEGORY_ICONS: Record<string, string> = {
  fs: '📁',
  environment: '🌡️',
  network: '🌐',
  process: '⚙️',
  user: '👤',
  system: '💻'
};

const CATEGORY_COLORS: Record<string, string> = {
  fs: '#58a6ff',
  environment: '#d29922',
  network: '#3fb950',
  process: '#f85149',
  user: '#bc8cff',
  system: '#8b949e'
};

function PerceptionSection({ events, primaryColor }: {events: PerceptionEvent[];primaryColor: string;}) {

  if (events.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>{"\u6682\u65E0\u611F\u77E5\u4E8B\u4EF6\u3002Buddy \u6B63\u5728\u76D1\u542C\u6587\u4EF6\u53D8\u66F4\u548C\u73AF\u5883\u53D8\u5316..."}</div>);

  }

  // 按时间倒序
  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{t('共 {{count}} 个感知事件', { count: sorted.length })}</div>
      {sorted.slice(0, 50).map((event, i) => {
        const icon = CATEGORY_ICONS[event.category] ?? '❓';
        const color = CATEGORY_COLORS[event.category] ?? '#8b949e';
        const time = new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // 格式化 data
        let dataStr = '';
        if (event.data && typeof event.data === 'object') {
          const d = event.data as Record<string, unknown>;
          if (d.path) dataStr = String(d.path);else
          if (d.relativePath) dataStr = String(d.relativePath);else
          if (d.type) dataStr = String(d.type);else
          dataStr = JSON.stringify(d).slice(0, 80);
        }

        return (
          <div key={event.id ?? i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            fontSize: 12
          }}>
            <span style={{ fontSize: 14 }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dataStr || event.category}
              </div>
              <div style={{ color: '#484f58', fontSize: 10 }}>
                {event.source} · {event.category}
              </div>
            </div>
            <span style={{ color: '#484f58', fontSize: 10, flexShrink: 0 }}>{time}</span>
          </div>);

      })}
      {events.length > 50 &&
      <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center', padding: 6 }}>{t('还有 {{count}} 个事件...', { count: events.length - 50 })}</div>
      }
    </div>);

}