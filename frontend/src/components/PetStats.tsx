// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import type { BuddyState, SpriteState } from '../types/buddy';
import { PERSONALITY_LABELS, PERSONALITY_COLORS, OCEAN_LABELS, OCEAN_COLORS } from '../types/buddy';
import ExplorationMap from './ExplorationMap';

import { t } from '../i18n/index';

interface PetStatsProps {
  buddyState: BuddyState | null;
  spriteState: SpriteState;
  onPet?: () => void;
}

const MOOD_EMOJI: Record<string, string> = {
  energetic: '⚡', calm: '😌', tired: '😴', excited: '🎉',
  frustrated: '😤', happy: '😊', thinking: '🤔', confused: '😵‍💫'
};

function getStatLabels(t: (key: string) => string): Record<string, string> {
  return {
    hp: '❤️ HP', maxHp: '💚 MaxHP', attack: "\u2694\uFE0F \u653B\u51FB",
    defense: "\uD83D\uDEE1\uFE0F \u9632\u5FA1", speed: "\uD83D\uDCA8 \u901F\u5EA6", intelligence: "\uD83E\uDDE0 \u667A\u529B"
  };
}

export default function PetStats({
  buddyState, onPet }: PetStatsProps) {

  const STAT_LABELS = getStatLabels(t);
  if (!buddyState) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: '#8b949e', fontSize: 13 }}>{"\u7B49\u5F85 Buddy \u6570\u636E..."}</div>);

  }

  const {
    name = 'Buddy',
    rarity = 'Common',
    rarityColor = '#8b949e',
    intimacy = 0,
    intimacyDescription = '',
    behaviorSignals,
    stats,
    features = [],
    exploration,
    guidance = null,
    petStats,
    visualSeed,
    visualStage,
    formProgress = 0,
    emotion
  } = buddyState;

  // 安全兜底：后端可能发不完整的 status，各子对象需防 undefined
  const safeExploration = exploration ?? { discovered: 0, total: 0, basic: 0, advanced: 0, expert: 0, hidden: 0, basicTotal: 0, advancedTotal: 0, expertTotal: 0, hiddenTotal: 0 };
  const safePetStats = petStats ?? { totalMessages: 0, totalToolCalls: 0, totalDays: 0, consecutiveDays: 0 };
  const safeStats = stats ?? { hp: 0, maxHp: 0, attack: 0, defense: 0, speed: 0, intelligence: 0 };
  const safeEmotion = emotion ?? { mood: 'neutral', energy: 0.5, satisfaction: 0.5 };

  // 提取5维数据（behaviorSignals 可能未初始化，用空对象兜底）
  const signals = behaviorSignals ?? {} as Record<string, number>;
  const radarKeys = ['snark', 'wisdom', 'chaos', 'patience', 'debugging'] as const;
  const radarData = radarKeys.map((k) => ({
    key: k,
    label: PERSONALITY_LABELS[k] || k,
    value: signals[k] ?? 0,
    color: PERSONALITY_COLORS[k] || '#58a6ff'
  }));

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      maxHeight: 560,
      overflowY: 'auto',
      padding: 4
    }}>
      {/* 头部：名称 + 阶段 */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 'bold' }}>{name}</div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          marginTop: 4,
          flexWrap: 'wrap'
        }}>
          {rarity !== 'Common' &&
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 4,
            background: `${rarityColor}22`, color: rarityColor
          }}>{rarity}</span>
          }
          {visualStage &&
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 4,
            background: `${visualSeed?.primaryColor || '#58a6ff'}22`,
            color: visualSeed?.primaryColor || '#58a6ff'
          }}>
              {visualStage.emoji} {visualStage.name} {formProgress}%
            </span>
          }
        </div>
        {visualStage &&
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
            {visualStage.description}
          </div>
        }
      </div>

      {/* 成长进度：personalityStrength */}
      {buddyState.personalityStrength != null &&
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 12
      }}>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>{"\uD83C\uDF31 \u6210\u957F\u8FDB\u5EA6 \u2014 \u4EBA\u683C\u63A7\u5236\u529B"}</div>
          <GrowthBar ps={buddyState.personalityStrength} stage={buddyState.evolutionStage} />
        </div>
      }

      {/* OCEAN 大五人格雷达 */}
      {buddyState.ocean &&
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 12
      }}>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>{"\uD83E\uDDEC OCEAN \u5927\u4E94\u4EBA\u683C"}</div>
          <RadarChart
          data={['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'].map((k) => ({
            key: k,
            label: OCEAN_LABELS[k] || k,
            value: (buddyState.ocean as any)?.[k] ?? 0,
            color: OCEAN_COLORS[k] || '#58a6ff'
          }))}
          size={200} />
        
          {buddyState.personalityStrength != null && buddyState.personalityStrength < 0.6 &&
        <div style={{ fontSize: 10, color: '#484f58', textAlign: 'center', marginTop: 6 }}>{"\u6027\u683C\u6B63\u5728\u5F62\u6210\u4E2D\uFF0C\u6570\u503C\u4F1A\u968F\u4EA4\u4E92\u9010\u6E10\u7A33\u5B9A"}</div>
        }
        </div>
      }

      {/* 旧 5维性格雷达（向后兼容） */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 12
      }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>{"\uD83E\uDDED \u6027\u683C\u96F7\u8FBE\uFF08\u884C\u4E3A\u6D8C\u73B0\uFF09"}</div>
        <RadarChart data={radarData} size={200} />
      </div>

      {/* 亲密度 + 心情 + 统计 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8
      }}>
        <StatCard emoji="❤️" label={"\u4EB2\u5BC6\u5EA6"} value={`${intimacy}/100`} sub={intimacyDescription} color="#f85149" />
        <StatCard
          emoji={MOOD_EMOJI[emotion?.mood] || '😌'}
          label={"\u5FC3\u60C5"}
          value={safeEmotion.mood || 'calm'}
          sub={`${"\u7CBE\u529B"} ${safeEmotion.energy ?? 0}`}
          color="#d29922" />
        
        <StatCard emoji="💬" label={"\u5BF9\u8BDD"} value={`${safePetStats.totalMessages} ${"\u6761"}`} sub={`${"\u8FDE\u7EED"} ${safePetStats.consecutiveDays} ${"\u5929"}`} color="#58a6ff" />
      </div>

      {/* 战斗属性网格 */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 10
      }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>{"\u2694\uFE0F \u6218\u6597\u5C5E\u6027"}</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6
        }}>
          {Object.entries(safeStats).map(([key, val]) =>
          <div key={key} style={{
            textAlign: 'center',
            padding: '6px 4px',
            background: '#161b22',
            borderRadius: 6,
            border: '1px solid #21262d'
          }}>
              <div style={{ color: '#8b949e', fontSize: 10 }}>{STAT_LABELS[key] || key}</div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{val}</div>
            </div>
          )}
        </div>
      </div>

      {/* 活动热力图 */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 10
      }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, fontWeight: 600 }}>{"\uD83D\uDCCA \u6D3B\u52A8\u8BB0\u5F55"}</div>
        <ActivityHeatMap
          totalDays={safePetStats.totalDays}
          consecutiveDays={safePetStats.consecutiveDays}
          totalMessages={safePetStats.totalMessages}
          totalToolCalls={safePetStats.totalToolCalls}
          dailyActivity={safePetStats.dailyActivity} />
        
      </div>

      {/* 探索图谱 */}
      <ExplorationMap features={features} exploration={safeExploration} guidance={guidance} />

      {/* 摸头按钮 */}
      <button
        onClick={onPet}
        style={{
          background: '#21262d',
          border: '1px solid #30363d',
          color: '#c9d1d9',
          padding: '10px',
          borderRadius: 8,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          transition: 'all 0.15s'
        }}
        onMouseOver={(e) => {(e.target as HTMLButtonElement).style.background = '#30363d';}}
        onMouseOut={(e) => {(e.target as HTMLButtonElement).style.background = '#21262d';}}>
        {"\uD83E\uDD17 \u6478\u6478\u5934 (+\u4EB2\u5BC6\u5EA6)"}</button>
    </div>);

}

// ==================== SVG 雷达图 ====================

interface RadarDataPoint {
  key: string;
  label: string;
  value: number;
  color: string;
}

function RadarChart({ data, size = 200 }: {data: RadarDataPoint[];size?: number;}) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const n = data.length;

  // 计算每个轴的顶点
  const getPoint = (index: number, value: number) => {
    const angle = Math.PI * 2 * index / n - Math.PI / 2;
    const r = value / 100 * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle)
    };
  };

  // 背景网格层
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        {/* 网格线 */}
        {gridLevels.map((level, i) => {
          const points = data.map((_, j) => {
            const p = getPoint(j, level * 100);
            return `${p.x},${p.y}`;
          }).join(' ');
          return (
            <polygon
              key={i}
              points={points}
              fill="none"
              stroke="#30363d"
              strokeWidth={level === 1 ? 1 : 0.5}
              opacity={level === 1 ? 0.8 : 0.4} />);


        })}

        {/* 轴线 */}
        {data.map((_, i) => {
          const p = getPoint(i, 100);
          return (
            <line
              key={i}
              x1={cx} y1={cy}
              x2={p.x} y2={p.y}
              stroke="#30363d"
              strokeWidth={0.5}
              opacity={0.5} />);


        })}

        {/* 数据多边形 */}
        <polygon
          points={data.map((d, i) => {
            const p = getPoint(i, d.value);
            return `${p.x},${p.y}`;
          }).join(' ')}
          fill="rgba(88,166,255,.15)"
          stroke="#58a6ff"
          strokeWidth={2}
          strokeLinejoin="round" />
        

        {/* 数据点 */}
        {data.map((d, i) => {
          const p = getPoint(i, d.value);
          return (
            <circle
              key={i}
              cx={p.x} cy={p.y}
              r={4}
              fill={d.color}
              stroke="#0d1117"
              strokeWidth={2} />);


        })}

        {/* 标签 */}
        {data.map((d, i) => {
          const p = getPoint(i, 120);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#8b949e"
              fontSize={10}
              fontFamily="'Cascadia Code', monospace">
              
              {d.label} {Math.round(d.value)}
            </text>);

        })}
      </svg>
    </div>);

}

// ==================== 活动热力图 ====================

function ActivityHeatMap({
  totalDays,
  consecutiveDays,
  totalMessages,
  totalToolCalls,
  dailyActivity






}: {totalDays: number;consecutiveDays: number;totalMessages: number;totalToolCalls: number;dailyActivity?: {date: string;messages: number;toolCalls: number;}[];}) {
  // 使用真实数据生成热力图
  const weeks = 4;
  const daysPerWeek = 7;
  const cells: {level: number;day: number;date: string;activity: number;}[] = [];

  // 构建日期 → 活动量映射
  const activityMap = new Map<string, number>();
  if (dailyActivity && dailyActivity.length > 0) {
    for (const d of dailyActivity) {
      activityMap.set(d.date, d.messages + d.toolCalls);
    }
  }

  // 生成最近 28 天的数据
  const today = new Date();
  for (let i = weeks * daysPerWeek - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const activity = activityMap.get(dateStr) ?? 0;

    // 根据真实活动量计算等级
    let level = 0;
    if (activity > 0) {
      if (activity >= 20) level = 3;else
      if (activity >= 8) level = 2;else
      level = 1;
    }

    cells.push({ level, day: weeks * daysPerWeek - 1 - i, date: dateStr, activity });
  }

  const levelColors = ['#161b22', '#0e4429', '#006d32', '#39d353'];
  const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 10, color: '#8b949e' }}>
        <span>{"\uD83D\uDCC5 \u5171 {totalDays} \u5929"}</span>
        <span>{"\uD83D\uDD25 \u8FDE\u7EED {consecutiveDays} \u5929"}</span>
        <span>💬 {totalMessages} {"\u6761\u6D88\u606F"}</span>
        <span>🔧 {totalToolCalls} {"\u6B21\u5DE5\u5177"}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* 日期标签 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {dayLabels.map((label, i) =>
          <div key={i} style={{
            width: 12,
            height: 12,
            fontSize: 8,
            color: '#484f58',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
              {label}
            </div>
          )}
        </div>

        {/* 热力网格 */}
        <div style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: weeks }).map((_, w) =>
          <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Array.from({ length: daysPerWeek }).map((_, d) => {
              const cell = cells[w * 7 + d];
              return (
                <div
                  key={d}
                  title={`${cell.date}${cell.activity > 0 ? ` (${cell.activity} ${"\u6B21\u6D3B\u52A8"})` : ` (${"\u65E0\u6D3B\u52A8"})`}`}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: levelColors[cell.level],
                    border: '1px solid #21262d',
                    transition: 'background 0.3s'
                  }} />);


            })}
            </div>
          )}
        </div>
      </div>

      {/* 图例 */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginTop: 6,
        alignItems: 'center',
        justifyContent: 'flex-end'
      }}>
        <span style={{ fontSize: 9, color: '#484f58' }}>{"\u5C11"}</span>
        {levelColors.map((c, i) =>
        <div key={i} style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: c,
          border: '1px solid #21262d'
        }} />
        )}
        <span style={{ fontSize: 9, color: '#484f58' }}>{"\u591A"}</span>
      </div>
    </div>);

}

// ==================== 成长进度条 ====================

const GROWTH_STAGES: Array<{min: number;label: string;desc: string;color: string;}> = [
{ min: 0, label: '混沌', desc: '人格对行为无控制', color: '#484f58' },
{ min: 0.1, label: '萌芽', desc: '性格开始浮现', color: '#8b949e' },
{ min: 0.3, label: '成长', desc: '性格逐渐清晰', color: '#58a6ff' },
{ min: 0.5, label: '成形', desc: '性格基本稳定', color: '#3fb950' },
{ min: 0.7, label: '成熟', desc: '性格明显可辨', color: '#d29922' },
{ min: 0.85, label: '圆满', desc: '性格完全展现', color: '#f0883e' },
{ min: 0.95, label: '传说', desc: '独一无二的性格', color: '#f85149' }];


function GrowthBar({ ps, stage: _stage }: {ps: number;stage: string;}) {

  const current = [...GROWTH_STAGES].reverse().find((s) => ps >= s.min) || GROWTH_STAGES[0];
  const nextStage = GROWTH_STAGES.find((s) => s.min > ps);

  // 翻译阶段标签和描述
  const tr = (s: {label: string;desc: string;}) => ({ label: t(s.label), desc: t(s.desc) });
  const currentTr = tr(current);

  return (
    <div>
      {/* PS 数值 + 阶段标签 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: current.color, fontWeight: 600 }}>
          {currentTr.label}
        </span>
        <span style={{ fontSize: 11, color: '#8b949e' }}>
          {(ps * 100).toFixed(0)}%
        </span>
      </div>

      {/* 进度条 */}
      <div style={{
        height: 6,
        background: '#161b22',
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid #21262d'
      }}>
        <div style={{
          height: '100%',
          width: `${ps * 100}%`,
          background: `linear-gradient(90deg, #484f58, ${current.color})`,
          borderRadius: 3,
          transition: 'width 0.5s ease'
        }} />
      </div>

      {/* 阶段描述 */}
      <div style={{ fontSize: 10, color: '#484f58', marginTop: 4 }}>
        {currentTr.desc}
        {nextStage && ` → ${"\u4E0B\u4E00\u9636\u6BB5"}: ${t(nextStage.label)} (${(nextStage.min * 100).toFixed(0)}%)`}
      </div>

      {/* 阶段指示点 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {GROWTH_STAGES.map((s, i) =>
        <div key={i} style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ps >= s.min ? s.color : '#21262d',
          border: `1px solid ${ps >= s.min ? s.color : '#30363d'}`,
          transition: 'all 0.3s'
        }} title={t(s.label)} />
        )}
      </div>
    </div>);

}

// ==================== 统计卡片 ====================

function StatCard({ emoji, label, value, sub, color

}: {emoji: string;label: string;value: string;sub?: string;color: string;}) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '10px 6px',
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 8
    }}>
      <div style={{ fontSize: 20 }}>{emoji}</div>
      <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>{label}</div>
      <div style={{ color, fontSize: 13, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ color: '#484f58', fontSize: 9, marginTop: 1 }}>{sub}</div>}
    </div>);

}