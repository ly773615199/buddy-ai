// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useState } from 'react';
import type { FeatureNode, Exploration, FeatureCategory, Guidance } from '../types/buddy';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../types/buddy';


interface ExplorationMapProps {
  features: FeatureNode[];
  exploration: Exploration;
  guidance: Guidance | null;
}

const CAT_ORDER: FeatureCategory[] = ['basic', 'advanced', 'expert', 'hidden'];
const CAT_ICONS: Record<FeatureCategory, string> = {
  basic: '🌱', advanced: '🔥', expert: '💎', hidden: '🔮'
};

export default function ExplorationMap({
  features, exploration, guidance }: ExplorationMapProps) {

  const [expandedCat, setExpandedCat] = useState<FeatureCategory | null>('basic');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 总览卡片 */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 14
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{"\uD83D\uDDFA\uFE0F \u529F\u80FD\u63A2\u7D22\u56FE\u8C31"}</span>
          <span style={{
            fontSize: 11,
            color: exploration.discovered >= exploration.total ? '#3fb950' : '#c9d1d9',
            background: '#21262d',
            padding: '3px 10px',
            borderRadius: 12,
            fontWeight: 600
          }}>
            {exploration.discovered} / {exploration.total} {"\u5DF2\u53D1\u73B0"}
          </span>
        </div>

        {/* 总体进度条 */}
        <div style={{
          height: 6,
          background: '#21262d',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 14
        }}>
          <div style={{
            height: '100%',
            width: `${exploration.total > 0 ? exploration.discovered / exploration.total * 100 : 0}%`,
            background: 'linear-gradient(90deg, #58a6ff, #a371f7)',
            borderRadius: 3,
            transition: 'width 0.8s ease'
          }} />
        </div>

        {/* 分类环形进度 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          gap: 8
        }}>
          {CAT_ORDER.map((cat) => {
            const current = exploration[cat];
            const total = exploration[`${cat}Total` as keyof Exploration] as number;
            const pct = total > 0 ? current / total : 0;
            const color = CATEGORY_COLORS[cat];
            const radius = 22;
            const circumference = 2 * Math.PI * radius;
            const dashOffset = circumference * (1 - pct);
            const done = current >= total && total > 0;

            return (
              <div
                key={cat}
                onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                style={{
                  textAlign: 'center',
                  cursor: 'pointer',
                  opacity: total > 0 ? 1 : 0.3,
                  transition: 'transform 0.15s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                
                <svg width={56} height={56} style={{ display: 'block', margin: '0 auto' }}>
                  <circle cx={28} cy={28} r={radius} fill="none" stroke="#21262d" strokeWidth={4} />
                  <circle
                    cx={28} cy={28} r={radius}
                    fill="none"
                    stroke={done ? '#3fb950' : color}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 28 28)"
                    style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                  
                  <text
                    x={28} y={28}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={16}
                    fill="#e6edf3">
                    
                    {CAT_ICONS[cat]}
                  </text>
                </svg>
                <div style={{
                  fontSize: 10,
                  color: done ? '#3fb950' : '#8b949e',
                  marginTop: 2,
                  fontWeight: expandedCat === cat ? 700 : 400
                }}>
                  {CATEGORY_LABELS[cat]} {current}/{total}
                </div>
              </div>);

          })}
        </div>
      </div>

      {/* 展开的分类节点网格 */}
      {CAT_ORDER.map((cat) => {
        const catFeatures = features.filter((f) => f.category === cat);
        if (catFeatures.length === 0 || expandedCat !== cat) return null;

        return (
          <div key={cat} style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 10,
            padding: 12,
            animation: 'msgIn 0.3s ease-out'
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              color: CATEGORY_COLORS[cat],
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>{CAT_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
              <button
                onClick={() => setExpandedCat(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#484f58',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '0 4px'
                }}>
                ×</button>
            </div>

            {/* 节点网格 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 8
            }}>
              {catFeatures.map((f) =>
              <FeatureNode key={f.id} feature={f} />
              )}
            </div>
          </div>);

      })}

      {/* 引导 */}
      {guidance &&
      <div style={{
        background: 'linear-gradient(135deg, rgba(88,166,255,.06) 0%, rgba(163,113,247,.06) 100%)',
        border: '1px solid rgba(88,166,255,.2)',
        borderRadius: 10,
        padding: 12
      }}>
          <div style={{ fontSize: 11, color: '#58a6ff', marginBottom: 6, fontWeight: 600 }}>{"\uD83D\uDCA1 \u4E0B\u4E00\u6B65\u5F15\u5BFC"}</div>
          <div style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.5 }}>
            {guidance.hint}
          </div>
        </div>
      }
    </div>);

}

/** 单个功能节点 — 带掌握度环形指示器 */
function FeatureNode({ feature: f }: {feature: FeatureNode;}) {
  const discovered = f.discovered;
  const mastery = f.mastery;
  const color = CATEGORY_COLORS[f.category];
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - mastery / 100);
  const masteryColor = mastery >= 80 ? '#3fb950' : mastery >= 40 ? '#d29922' : '#58a6ff';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '10px 4px 8px',
      background: discovered ? '#161b22' : '#0d1117',
      border: `1px solid ${discovered ? color + '33' : '#21262d'}`,
      borderRadius: 8,
      opacity: discovered ? 1 : 0.25,
      transition: 'all 0.2s',
      position: 'relative'
    }}>
      {/* 掌握度环 */}
      <svg width={44} height={44} style={{ marginBottom: 4 }}>
        <circle cx={22} cy={22} r={radius} fill="none" stroke="#21262d" strokeWidth={3} />
        {discovered &&
        <circle
          cx={22} cy={22} r={radius}
          fill="none"
          stroke={masteryColor}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 22 22)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />

        }
        <text
          x={22} y={22}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={18}
          fill="#e6edf3">
          
          {discovered ? f.emoji : '❓'}
        </text>
      </svg>

      <div style={{
        fontSize: 10,
        color: discovered ? '#c9d1d9' : '#484f58',
        textAlign: 'center',
        lineHeight: 1.3,
        maxWidth: 90,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {discovered ? f.name : '???'}
      </div>

      {discovered &&
      <div style={{
        fontSize: 9,
        color: '#8b949e',
        marginTop: 2,
        display: 'flex',
        gap: 6
      }}>
          <span>×{f.useCount}</span>
          <span style={{ color: masteryColor }}>{mastery}%</span>
        </div>
      }
    </div>);

}