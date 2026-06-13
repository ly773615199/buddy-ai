// V3 i18n: 组件直接写中文，构建时 Vite 插件自动提取并替换为 t() 调用
import { useEffect, useState, useRef, useCallback } from 'react';
import { t } from '../i18n/t';


// ── 类型定义 ──

interface ConceptNode {
  id: string;
  label: string;
  count: number;
  domains: string[];
  types: string[];
  size: number;
}

interface ConceptEdge {
  source: string;
  target: string;
  weight: number;
}

interface KnowledgeItem {
  key: string;
  value: string;
  importance: number;
}

interface KnowledgePanelData {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  knowledge: KnowledgeItem[];
  files: Array<{key: string;value: string;}>;
  stats: {
    totalKnowledge: number;
    totalFiles: number;
    totalDomains: number;
    totalSTMPNodes: number;
  };
}

interface KnowledgePanelProps {
  data: KnowledgePanelData | null;
  onRequestData: () => void;
  primaryColor?: string;
}

// ── 力导向图布局 ──

interface LayoutNode extends ConceptNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function forceLayout(nodes: ConceptNode[], edges: ConceptEdge[], width: number, height: number): LayoutNode[] {
  const layoutNodes: LayoutNode[] = nodes.map((n, i) => {
    const angle = 2 * Math.PI * i / nodes.length;
    const r = Math.min(width, height) * 0.3;
    return {
      ...n,
      x: width / 2 + r * Math.cos(angle),
      y: height / 2 + r * Math.sin(angle),
      vx: 0,
      vy: 0
    };
  });

  const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

  // 简单力导向迭代
  for (let iter = 0; iter < 100; iter++) {
    const k = 0.1; // 弹簧系数

    // 排斥力（所有节点对）
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const a = layoutNodes[i];
        const b = layoutNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 500 / (dist * dist);
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 吸引力（有边的节点对）
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 80) * k * edge.weight;
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 中心引力
    for (const node of layoutNodes) {
      node.vx += (width / 2 - node.x) * 0.005;
      node.vy += (height / 2 - node.y) * 0.005;
    }

    // 应用速度（带阻尼）
    for (const node of layoutNodes) {
      node.vx *= 0.8;
      node.vy *= 0.8;
      node.x += node.vx;
      node.y += node.vy;
      // 边界约束
      node.x = Math.max(30, Math.min(width - 30, node.x));
      node.y = Math.max(30, Math.min(height - 30, node.y));
    }
  }

  return layoutNodes;
}

// ── 颜色映射 ──

const TYPE_COLORS: Record<string, string> = {
  rule_based: '#58a6ff',
  pattern_recognition: '#3fb950',
  creative: '#d29922',
  relational: '#f85149',
  general: '#8b949e'
};

function getTypeColor(types: string[]): string {
  for (const t of types) {
    if (TYPE_COLORS[t]) return TYPE_COLORS[t];
  }
  return '#8b949e';
}

// ── 主组件 ──

export default function KnowledgePanel({
  data, onRequestData, primaryColor = '#58a6ff' }: KnowledgePanelProps) {

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    onRequestData();
  }, [onRequestData]);

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: 30, color: '#8b949e', fontSize: 13 }}>{"\u52A0\u8F7D\u77E5\u8BC6\u56FE\u8C31..."}</div>);

  }

  const { nodes, edges, knowledge, files, stats } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 560, overflowY: 'auto' }}>
      {/* 统计概览 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <StatCard emoji="📚" label={"\u77E5\u8BC6\u6761\u76EE"} value={stats.totalKnowledge} color="#58a6ff" />
        <StatCard emoji="📁" label={"\u5B66\u4E60\u6587\u4EF6"} value={stats.totalFiles} color="#d29922" />
        <StatCard emoji="🏷️" label={"\u9886\u57DF"} value={stats.totalDomains} color="#3fb950" />
        <StatCard emoji="🧠" label={"STMP \u8282\u70B9"} value={stats.totalSTMPNodes} color="#f85149" />
      </div>

      {/* 切换按钮 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => setShowList(false)}
          style={tabStyle(!showList, primaryColor)}>
          {"\uD83D\uDD78\uFE0F \u6982\u5FF5\u56FE"}</button>
        <button
          onClick={() => setShowList(true)}
          style={tabStyle(showList, primaryColor)}>
          {"\uD83D\uDCCB \u77E5\u8BC6\u5217\u8868"}</button>
      </div>

      {showList ? (
      /* 知识列表视图 */
      <KnowledgeListView knowledge={knowledge} files={files} />) : (

      /* 概念图视图 */
      <ConceptGraphView
        nodes={nodes}
        edges={edges}
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
        primaryColor={primaryColor}
        svgRef={svgRef} />)

      }

      {/* 选中节点详情 */}
      {selectedNode &&
      <NodeDetail
        node={nodes.find((n) => n.id === selectedNode) ?? null}
        knowledge={knowledge}
        onClose={() => setSelectedNode(null)} />

      }
    </div>);

}

// ── 概念图视图 ──

function ConceptGraphView({
  nodes, edges, selectedNode, onSelectNode, primaryColor, svgRef







}: {nodes: ConceptNode[];edges: ConceptEdge[];selectedNode: string | null;onSelectNode: (id: string | null) => void;primaryColor: string;svgRef: React.RefObject<SVGSVGElement | null>;}) {
  const width = 360;
  const height = 280;

  const layoutNodes = useRef<LayoutNode[]>([]);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (nodes.length > 0) {
      layoutNodes.current = forceLayout(nodes, edges, width, height);
      forceUpdate((n) => n + 1);
    }
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>{"\u6682\u65E0\u6982\u5FF5\u6570\u636E\u3002\u4F7F\u7528 /learn \u8BA9 Buddy \u5B66\u4E60\u77E5\u8BC6\u540E\u4F1A\u81EA\u52A8\u751F\u6210\u6982\u5FF5\u56FE\u3002"}</div>);

  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 10,
        cursor: 'grab'
      }}>
      
      {/* 边 */}
      {edges.map((edge, i) => {
        const source = layoutNodes.current.find((n) => n.id === edge.source);
        const target = layoutNodes.current.find((n) => n.id === edge.target);
        if (!source || !target) return null;
        return (
          <line
            key={i}
            x1={source.x} y1={source.y}
            x2={target.x} y2={target.y}
            stroke="#30363d"
            strokeWidth={Math.min(3, edge.weight)}
            opacity={0.6} />);


      })}

      {/* 节点 */}
      {layoutNodes.current.map((node) => {
        const isSelected = selectedNode === node.id;
        const color = getTypeColor(node.types);
        return (
          <g
            key={node.id}
            onClick={() => onSelectNode(isSelected ? null : node.id)}
            style={{ cursor: 'pointer' }}>
            
            {/* 选中光晕 */}
            {isSelected &&
            <circle
              cx={node.x} cy={node.y}
              r={node.size / 2 + 6}
              fill="none"
              stroke={primaryColor}
              strokeWidth={2}
              opacity={0.5} />

            }
            {/* 节点圆 */}
            <circle
              cx={node.x} cy={node.y}
              r={node.size / 2}
              fill={color}
              fillOpacity={0.2}
              stroke={color}
              strokeWidth={isSelected ? 2 : 1} />
            
            {/* 标签 */}
            <text
              x={node.x}
              y={node.y + node.size / 2 + 12}
              textAnchor="middle"
              fill="#c9d1d9"
              fontSize={10}
              fontFamily="'Cascadia Code', monospace">
              
              {node.label.length > 8 ? node.label.slice(0, 8) + '…' : node.label}
            </text>
            {/* 计数 */}
            <text
              x={node.x}
              y={node.y + 3}
              textAnchor="middle"
              fill={color}
              fontSize={9}
              fontWeight="bold">
              
              {node.count}
            </text>
          </g>);

      })}
    </svg>);

}

// ── 知识列表视图 ──

function KnowledgeListView({ knowledge, files


}: {knowledge: KnowledgeItem[];files: Array<{key: string;value: string;}>;}) {
  if (knowledge.length === 0 && files.length === 0) {
    return (
      <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: 30 }}>{"\u6682\u65E0\u5DF2\u5B66\u4E60\u7684\u77E5\u8BC6\u3002\u4F7F\u7528 /learn \u547D\u4EE4\u8BA9 Buddy \u5B66\u4E60\u6587\u4EF6\u6216\u7F51\u5740\u3002"}</div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 已学习文件 */}
      {files.length > 0 &&
      <div>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6, fontWeight: 600 }}>{"📁 已学习文件 ("}{files.length}{")"}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {files.map((f) =>
          <div key={f.key} style={{
            padding: '6px 10px',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            fontSize: 12,
            color: '#c9d1d9'
          }}>
                <span style={{ color: primaryColor }}>{f.key}</span>
                <span style={{ color: '#484f58', marginLeft: 8, fontSize: 10 }}>{f.value}</span>
              </div>
          )}
          </div>
        </div>
      }

      {/* 知识条目 */}
      {knowledge.length > 0 &&
      <div>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6, fontWeight: 600 }}>{"📚 知识条目 ("}{knowledge.length}{")"}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {knowledge.slice(0, 50).map((k) =>
          <div key={k.key} style={{
            padding: '6px 10px',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            fontSize: 12,
            color: '#c9d1d9'
          }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: '#58a6ff', fontSize: 11 }}>{k.key}</span>
                  <span style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 3,
                background: importanceColor(k.importance) + '22',
                color: importanceColor(k.importance)
              }}>
                    ★{k.importance}
                  </span>
                </div>
                <div style={{ color: '#8b949e', fontSize: 11, lineHeight: 1.4 }}>
                  {k.value.length > 120 ? k.value.slice(0, 120) + '…' : k.value}
                </div>
              </div>
          )}
            {knowledge.length > 50 &&
          <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center', padding: 6 }}>{"还有 "}{knowledge.length - 50}{" 条..."}</div>
          }
          </div>
        </div>
      }
    </div>);

}

// ── 节点详情面板 ──

function NodeDetail({ node, knowledge, onClose



}: {node: ConceptNode | null;knowledge: KnowledgeItem[];onClose: () => void;}) {
  if (!node) return null;

  // 找到相关知识
  const related = knowledge.filter((k) =>
  k.key.toLowerCase().includes(node.id.toLowerCase()) ||
  k.value.toLowerCase().includes(node.id.toLowerCase())
  ).slice(0, 5);

  return (
    <div style={{
      padding: 10,
      background: '#161b22',
      border: `1px solid ${getTypeColor(node.types)}`,
      borderRadius: 8
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: '#c9d1d9', fontSize: 13 }}>{node.label}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 14 }}>
          
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
        <span>📊 {node.count} {"\u6761\u77E5\u8BC6"}</span>
        <span>🏷️ {node.domains.join(', ')}</span>
      </div>
      {related.length > 0 &&
      <div style={{ fontSize: 11, color: '#484f58' }}>{t('相关知识：{{list}}', { list: related.map(k => k.key).join('、') })}</div>
      }
    </div>);

}

// ── 统计卡片 ──

function StatCard({ emoji, label, value, color

}: {emoji: string;label: string;value: number;color: string;}) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '8px 4px',
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 8
    }}>
      <div style={{ fontSize: 16 }}>{emoji}</div>
      <div style={{ color: '#8b949e', fontSize: 9, marginTop: 2 }}>{label}</div>
      <div style={{ color, fontSize: 13, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>);

}

// ── 工具函数 ──

const primaryColor = '#58a6ff';

function tabStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    border: `1px solid ${active ? color : '#30363d'}`,
    background: active ? `${color}22` : '#21262d',
    color: active ? color : '#c9d1d9',
    fontFamily: 'inherit',
    transition: 'all 0.15s'
  };
}

function importanceColor(importance: number): string {
  if (importance >= 8) return '#f85149';
  if (importance >= 6) return '#d29922';
  if (importance >= 4) return '#58a6ff';
  return '#8b949e';
}