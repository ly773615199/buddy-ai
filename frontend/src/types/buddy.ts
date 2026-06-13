// Buddy WebSocket Event Types v2 — discriminated union（编译期类型安全）
export type BuddyEvent =
  // 对话
  | { type: 'user_message' }
  | { type: 'thinking'; message?: string }
  | { type: 'llm_response'; content: string; streaming?: boolean }
  | { type: 'stream_chunk'; content: string }
  | { type: 'error'; message: string }
  | { type: 'bubble'; text?: string; message?: string }
  | { type: 'response_end'; content: string; toolCalls: number }
  // 工具
  | { type: 'tool_call'; tool: string; args?: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; preview?: string; result?: string }
  | { type: 'tool_confirm_request'; id: string; tool: string; description: string; trustLevel: string }
  | { type: 'confirm_required'; id?: string; question: string }
  | { type: 'clarify'; question: string }
  | { type: 'tool_panel_data'; data: ToolPanelData }
  | { type: 'memory_panel_data'; data: MemoryPanelData }
  | { type: 'knowledge_panel_data'; data: KnowledgePanelData }
  | { type: 'agent_trace'; trace: AgentTraceStep[] }
  // 状态 & 情绪
  | { type: 'status'; data: Record<string, unknown> }
  | { type: 'emotion'; mood: string; energy: number; satisfaction: number; intensity?: number; isAuthentic?: boolean }
  | { type: 'idle' }
  | { type: 'idle_action'; action: string; duration?: number; intensity?: number }
  | { type: 'dreaming' }
  | { type: 'typing'; active: boolean }
  // 进化 & 成就
  | { type: 'evolution'; from: string; to: string }
  | { type: 'achievement'; name: string }
  | { type: 'evolution_log'; events: unknown[]; stagnation: unknown; count: number }
  // 音频
  | { type: 'audio'; data: string; format: string; sentenceId?: string }
  | { type: 'audio_ready'; id: string; format: string }
  // 传感器
  | { type: 'sensor_update'; data?: unknown }
  // 内心独白（叙事引擎）
  | { type: 'narration'; narrationType: string; content: string; urgency: number; visual?: { expression?: string; particleBurst?: boolean; action?: string }; timestamp: number }
  // 编排
  | { type: 'orch_start'; description?: string; taskCount?: number; dagId?: string }
  | { type: 'orch_task_start'; taskName?: string; taskId?: string; dagId?: string }
  | { type: 'orch_task_done'; taskName?: string; taskId?: string; dagId?: string }
  | { type: 'orch_task_fail'; taskName?: string; taskId?: string; error?: string; dagId?: string }
  | { type: 'orch_progress'; done?: number; total?: number; completed?: number; current?: string; dagId?: string }
  | { type: 'orch_done'; totalMs?: number; summary?: string; dagId?: string }
  | { type: 'orch_fail'; error?: string; dagId?: string }
  | { type: 'orch_task'; taskId: string; name: string; status: string; tool?: string; result?: string; error?: string }
  | { type: 'orch_complete'; summary: string; taskCount: number; successCount: number }
  | { type: 'orch_error'; taskId: string; name: string; error: string }
  | { type: 'orch_task_ready'; dagId: string; taskId: string; taskName: string }
  | { type: 'orch_task_retry'; dagId: string; taskId: string; attempt: number; maxRetry: number; delayMs: number }
  | { type: 'orch_task_skipped'; dagId: string; taskId: string; reason: string }
  | { type: 'orch_task_timeout'; dagId: string; taskId: string; timeoutMs: number }
  // 认知可视化
  | { type: 'dream_complete'; journal?: string; timestamp?: number }
  | { type: 'dream_logs'; logs: { journal: string; timestamp: number }[] }
  | { type: 'cognitive_update'; profile?: Record<string, unknown> }
  | { type: 'experience_matched'; unitName?: string; confidence?: number; path?: string }
  | { type: 'domain_mature'; domain?: string; knowledgeCount?: number }
  | { type: 'skill_registered'; name?: string; description?: string; source?: string }
  // Phase 5: 诊断事件
  | { type: 'diagnostic'; data: DiagnosticReport }
  | { type: 'redecide'; reflection?: string }
  // 三进制
  | { type: 'ternary_models'; models?: unknown[] }
  | { type: 'ternary_train_start'; domain: string; steps?: number }
  | { type: 'ternary_train_progress'; domain: string; step?: number; totalSteps?: number; loss?: number }
  | { type: 'ternary_train_complete'; domain: string; success?: boolean; initialLoss?: number; finalLoss?: number; steps?: number; timestamp?: number }
  | { type: 'ternary_inference'; domain?: string; confidence?: number }
  | { type: 'model_installed'; domain?: string; success?: boolean }
  // 统一模型池决策
  | { type: 'model_decision'; modelId: string; displayName: string; tier: string; reason: string; layer: number; candidateCount: number; tsSample?: number; taskType: string; timestamp: number }
  // 三脑决策信号流
  | { type: 'brain_trace'; phase: 'signal' | 'resource' | 'decision' | 'execution' | 'outcome'; traceId: string; timestamp: number; data: Record<string, unknown> }
  // 配置
  | { type: 'config_mismatch'; local?: string; remote?: string }
  // 调度事件
  | { type: 'schedule_event'; data: ScheduleEvent }
  // 通信层
  | { type: 'ack'; id: string }
  | { type: 'pong'; ts: number; configHash?: string; serverTime?: number }
  // 兜底：未来新增的事件类型（编译不报错，运行时仍可用）
  | { type: string } & Record<string, unknown>;

// ==================== Phase 5: 诊断报告 ====================

export interface DiagnosticReport {
  category: 'no_provider' | 'auth_expired' | 'no_native_tools' | 'all_models_weak' | 'token_limit' | 'unknown';
  message: string;
  detail: string;
  suggestions: Array<{
    action: 'add_provider' | 'update_key' | 'reduce_tools' | 'switch_model' | 'retry';
    label: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  attempted: string[];
  failedReasons: string[];
  mood: 'frustrated' | 'confused' | 'tired';
}

// ==================== 养成 v2 数据类型 ====================

export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export type EvolutionStage = 'egg' | 'hatching' | 'growing' | 'formed' | 'mature' | 'complete' | 'legendary';
export type FeatureCategory = 'basic' | 'advanced' | 'expert' | 'hidden';

// ==================== 视觉形象系统 ====================

export type VisualStage = 'egg' | 'hatching' | 'growing' | 'formed' | 'mature' | 'complete' | 'legendary';
export type TextureType = 'soft' | 'transparent' | 'sharp' | 'warm';
export type TemperamentType = 'warm' | 'calm' | 'lively' | 'mysterious';

export interface VisualSeed {
  primaryColor: string;
  secondaryColor?: string;
  texture: TextureType;
  temperament: TemperamentType;
  seed: number;
}

export interface VisualStageInfo {
  stage: VisualStage;
  name: string;
  emoji: string;
  description: string;
  minProgress: number;
  maxProgress: number;
}

/** 质感选项 */
export const TEXTURE_OPTIONS: Array<{ id: TextureType; label: string; desc: string }> = [
  { id: 'soft',        label: '柔软', desc: '圆润、柔和渐变、有机形态' },
  { id: 'transparent', label: '通透', desc: '半透明、发光、玻璃质感' },
  { id: 'sharp',       label: '锋利', desc: '几何棱角、结晶、边缘分明' },
  { id: 'warm',        label: '温润', desc: '暖色光晕、毛绒感、弥散光' },
];

/** 气质选项 */
export const TEMPERAMENT_OPTIONS: Array<{ id: TemperamentType; label: string; desc: string }> = [
  { id: 'warm',       label: '温暖', desc: '光的节奏柔和、明暗过渡缓慢' },
  { id: 'calm',       label: '冷静', desc: '冷色调为主、光影稳定' },
  { id: 'lively',     label: '活泼', desc: '光芒跳跃、颜色活泼、粒子活跃' },
  { id: 'mysterious', label: '神秘', desc: '暗色底光、若隐若现、紫/深蓝调' },
];

/** 预设主色调 */
export const COLOR_PRESETS = [
  { id: 'blue',   hex: '#58a6ff', label: '蓝' },
  { id: 'purple', hex: '#a371f7', label: '紫' },
  { id: 'green',  hex: '#3fb950', label: '绿' },
  { id: 'orange', hex: '#d29922', label: '橙' },
  { id: 'red',    hex: '#f85149', label: '红' },
  { id: 'pink',   hex: '#f778ba', label: '粉' },
  { id: 'cyan',   hex: '#39d2c0', label: '青' },
  { id: 'gold',   hex: '#f0883e', label: '金' },
];

/** 功能探索节点 */
export interface FeatureNode {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  discovered: boolean;
  firstUsedAt?: number;
  useCount: number;
  lastUsedAt?: number;
  mastery: number;           // 0-100
  emoji: string;
}

/** 行为信号（5维属性涌现） */
export interface BehaviorSignals {
  snark: number;
  wisdom: number;
  chaos: number;
  patience: number;
  debugging: number;
  lastComputedAt: number;
  sampleCount: number;
}

/** OCEAN 大五人格 */
export interface OceanPersonality {
  openness: number;          // 0-100 开放性
  conscientiousness: number; // 0-100 尽责性
  extraversion: number;      // 0-100 外倾性
  agreeableness: number;     // 0-100 宜人性
  neuroticism: number;       // 0-100 神经质
}

/** 探索地图汇总 */
export interface Exploration {
  discovered: number;
  total: number;
  basic: number;
  advanced: number;
  expert: number;
  hidden: number;
  basicTotal: number;
  advancedTotal: number;
  expertTotal: number;
  hiddenTotal: number;
}

/** 引导任务 */
export interface Guidance {
  id: string;
  title: string;
  description: string;
  hint: string;
  targetFeature: string;
}

// ==================== 基因系统 ====================

/** 灵伴基因组 — 30 个参数，全部从交互行为涌现 */
export interface BuddyGenome {
  // 体型 (5 维)
  bodyHeight: number;
  bodyWidth: number;
  bodyDepth: number;
  bodyRoundness: number;
  headSize: number;
  // 面部 (6 维)
  eyeSize: number;
  eyeSpacing: number;
  eyeShape: number;
  eyeAngle: number;
  pupilSize: number;
  eyeHighlight: number;
  // 耳朵 (4 维)
  earSize: number;
  earPosition: number;
  earShape: number;
  earAngle: number;
  // 嘴巴 (2 维)
  mouthSize: number;
  mouthShape: number;
  // 附属物 (5 维)
  tailLength: number;
  tailCurve: number;
  wingSize: number;
  hornSize: number;
  hornStyle: number;
  // 纹路 (3 维)
  patternDensity: number;
  patternStyle: number;
  patternSpread: number;
  // 颜色 (1 维)
  secondaryColor: string;
  colorGradient: number;
  // 动态 (2 维)
  breatheSpeed: number;
  swayAmount: number;
}

// ==================== 完整 Buddy 状态 ====================

export interface BuddyState {
  id?: string;
  name: string;
  species: string;
  emoji: string;
  rarity: Rarity;
  rarityColor: string;

  // 进化阶段（取代 level/exp）
  evolutionStage: EvolutionStage;
  stageName: string;
  stageEmoji: string;
  stageDescription: string;

  // 亲密度（取代旧 trust）
  intimacy: number;
  intimacyDescription: string;

  // 5维行为信号（旧系统，向后兼容）
  behaviorSignals: BehaviorSignals;

  // OCEAN 大五人格 + 成长系统
  ocean?: OceanPersonality;
  personalityStrength?: number;  // PS: 0→1，人格对行为的控制力

  // 基因系统（30 参数涌现）
  genome?: BuddyGenome;

  // 战斗属性
  stats: {
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    intelligence: number;
  };

  // 功能探索图谱
  features: FeatureNode[];
  exploration: Exploration;

  // 引导
  guidance: Guidance | null;

  // 统计
  petStats: {
    totalMessages: number;
    totalToolCalls: number;
    totalDays: number;
    consecutiveDays: number;
    dailyActivity?: { date: string; messages: number; toolCalls: number }[];
  };

  // 情绪
  emotion: {
    mood: string;
    energy: number;
    satisfaction: number;
    curiosity?: number;
  };

  // 视觉形象
  visualSeed: VisualSeed;
  formProgress: number;
  visualStage: VisualStageInfo;

  // 商城装备
  equippedItems?: Array<{
    id: string;
    name: string;
    type: string;
    rarity: string;
  }>;
}

// ==================== 聊天消息 ====================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error' | 'bubble' | 'guidance' | 'diagnostic';
  content: string;
  timestamp: number;
  toolName?: string;
  toolPreview?: string;
  streaming?: boolean;
  guidance?: Guidance;
  /** 三进制推理来源标记 */
  ternarySource?: { domain: string; confidence: number };
  /** 关联的任务 ID（用于多任务区分） */
  taskId?: string;
  /** 编排任务折叠组 ID */
  orchGroup?: string;
  /** 消息子类型（用于区分 thinking / orch 等系统消息） */
  subtype?: 'thinking' | 'orch' | 'info';
  /** 诊断报告数据 */
  diagnostic?: DiagnosticReport;
  /** 确认请求 ID（用于 confirm_required 消息） */
  confirmId?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  success?: boolean;
}

// ==================== 精灵动画状态 ====================

export type SpriteState = 'idle' | 'thinking' | 'speaking' | 'executing' | 'error' | 'sleeping' | 'excited';

/** 自主行为视觉状态 — 叠加在 spriteState 之上 */
export type ActionState =
  | 'none'        // 无特殊行为
  | 'blink'       // 眨眼 — 眼睛快速闭合→张开 (0.2s)
  | 'look_around' // 东张西望 — 整体轻微摆动 + 眼球偏移
  | 'yawn'        // 打哈欠 — 呼吸幅度突然增大→缓慢恢复
  | 'stretch'     // 伸懒腰 — 身体拉伸 (scaleY 变化) → 回弹
  | 'wave'        // 挥手 — 一侧粒子爆发
  | 'think'       // 思考 — 呼吸减缓 + 头顶 "..." 粒子
  | 'peek';       // 偷看 — 身体小幅位移 + 一侧眼睛变大

/** 自主行为参数 */
export interface ActionMeta {
  state: ActionState;
  startTime: number;
  duration: number;    // ms
  intensity: number;   // 0-1
}

// ==================== 进化阶段表（前端展示用）====================

export const EVOLUTION_STAGES: Array<{
  stage: EvolutionStage;
  name: string;
  emoji: string;
  description: string;
}> = [
  { stage: 'egg',       name: '蛋',   emoji: '🥚', description: '沉睡中的生命' },
  { stage: 'hatching',  name: '孵化', emoji: '🐣', description: '破壳而出，好奇世界' },
  { stage: 'growing',   name: '成长', emoji: '🦊', description: '开始独立思考' },
  { stage: 'formed',    name: '成形', emoji: '🦎', description: '形态初现' },
  { stage: 'mature',    name: '成熟', emoji: '🐺', description: '强大的伙伴' },
  { stage: 'complete',  name: '完全', emoji: '🐲', description: '释放全部潜能' },
  { stage: 'legendary', name: '传说', emoji: '🌟', description: '超越物种的存在' },
];

// ==================== 稀有度颜色 ====================

export const RARITY_COLORS: Record<Rarity, string> = {
  Common: '#8b949e',
  Uncommon: '#3fb950',
  Rare: '#d29922',
  Epic: '#f778ba',
  Legendary: '#f0883e',
};

// ==================== 分类标签 ====================

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  basic: '基础功能',
  advanced: '进阶功能',
  expert: '专家功能',
  hidden: '隐藏功能',
};

export const CATEGORY_COLORS: Record<FeatureCategory, string> = {
  basic: '#3fb950',
  advanced: '#58a6ff',
  expert: '#d29922',
  hidden: '#f778ba',
};

// ==================== 三进制专家模型 ====================

export interface ExpertModel {
  domain: string;
  name: string;
  description: string;
  architecture: string;
  version: string;
  author: string;
  tags: string[];
  installed: boolean;
  enabled: boolean;
  growthStage: string;
  trainSteps: number;
  fileSize: string;
}

export interface TernaryTrainCompleteEvent {
  type: 'ternary_train_complete';
  domain: string;
  success: boolean;
  initialLoss: number;
  finalLoss: number;
  steps: number;
  timestamp: number;
}

// ==================== 5维属性标签 ====================

export const PERSONALITY_LABELS: Record<string, string> = {
  snark: '😏 毒舌',
  wisdom: '🦉 智慧',
  chaos: '🌀 混乱',
  patience: '🧘 耐心',
  debugging: '🔧 调试',
};

export const PERSONALITY_COLORS: Record<string, string> = {
  snark: '#f778ba',
  wisdom: '#58a6ff',
  chaos: '#d29922',
  patience: '#3fb950',
  debugging: '#f0883e',
};

// ==================== OCEAN 大五人格标签 ====================

export const OCEAN_LABELS: Record<string, string> = {
  openness: '🔮 开放性',
  conscientiousness: '📐 尽责性',
  extraversion: '🗣️ 外倾性',
  agreeableness: '🤝 宜人性',
  neuroticism: '🌊 神经质',
};

export const OCEAN_COLORS: Record<string, string> = {
  openness: '#a371f7',
  conscientiousness: '#58a6ff',
  extraversion: '#f0883e',
  agreeableness: '#3fb950',
  neuroticism: '#f85149',
};

/** OCEAN 维度描述（简短） */
export const OCEAN_SHORT_DESC: Record<string, string[]> = {
  openness: ['保守', '谨慎', '开放', '好奇', '探索'],
  conscientiousness: ['随性', '灵活', '有序', '自律', '完美'],
  extraversion: ['内敛', '安静', '均衡', '外向', '话痨'],
  agreeableness: ['直率', '独立', '友善', '温和', '温柔'],
  neuroticism: ['淡定', '平稳', '正常', '敏感', '情绪化'],
};

// ==================== Sprint 2: 工具面板 & 记忆面板 ====================

export interface ToolInfo {
  name: string;
  description: string;
  source: string;
  usageCount: number;
  successRate: number;
}

export interface ToolExecution {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
  timestamp: number;
}

export interface ToolPanelData {
  tools: ToolInfo[];
  recentExecutions: ToolExecution[];
}

export interface DomainInfo {
  domain: string;
  domainType: string;
  knowledgeCount: number;
  depthScore: number;
  growthStage: string;
  confidence: number;
  conversationCount: number;
  lastActiveAt: number;
}

export interface MemoryPanelData {
  domains: DomainInfo[];
  stats: {
    totalNodes: number;
    totalDomains: number;
    activeDomains: number;
  };
}

export interface KnowledgePanelData {
  nodes: Array<{
    id: string;
    label: string;
    count: number;
    domains: string[];
    types: string[];
    size: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
  }>;
  knowledge: Array<{
    key: string;
    value: string;
    importance: number;
  }>;
  files: Array<{ key: string; value: string }>;
  stats: {
    totalKnowledge: number;
    totalFiles: number;
    totalDomains: number;
    totalSTMPNodes: number;
  };
}

export interface AgentTraceStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'model_decision' | 'brain_trace';
  content: string;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  timestamp: number;
  /** model_decision 扩展字段 */
  modelId?: string;
  displayName?: string;
  tier?: string;
  reason?: string;
  layer?: number;
  candidateCount?: number;
  taskType?: string;
  /** brain_trace 扩展字段 */
  phase?: string;
  traceId?: string;
  data?: Record<string, unknown>;
}

// ==================== 调度事件 ====================

export interface ScheduleEvent {
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
