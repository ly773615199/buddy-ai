import { z } from 'zod';
import type { EmotionVector, PersonalityTraits, GrowthBias, Mood } from './emotion/engine.js';
import type { ProviderCapabilities } from './core/provider-adapter.js';

// ==================== 性格系统（涌现式） ====================
// 人格不再预设，从使用行为中自然涌现。
// Attributes = PersonalityTraits 的别名，统一为一套数值。

export const AttributesSchema = z.object({
  snark: z.number().min(0).max(100),      // 毒舌
  wisdom: z.number().min(0).max(100),      // 智慧
  chaos: z.number().min(0).max(100),       // 混乱
  patience: z.number().min(0).max(100),    // 耐心
  debugging: z.number().min(0).max(100),   // 调试
});

export type Attributes = z.infer<typeof AttributesSchema>;

// 兼容旧代码：预设改为"初始倾向"，不再是固定值
// 实际人格由 BehaviorSignals 涌现决定
export const PRESET_PERSONALITIES: Record<string, Attributes> = {
  sharp_mentor: { snark: 75, wisdom: 85, chaos: 15, patience: 40, debugging: 90 },
  warm_companion: { snark: 15, wisdom: 70, chaos: 25, patience: 85, debugging: 60 },
  chaotic_friend: { snark: 50, wisdom: 45, chaos: 85, patience: 35, debugging: 30 },
};

// ==================== 情绪系统 v2 导出 ====================
export type { EmotionVector, PersonalityTraits, GrowthBias, Mood } from './emotion/engine.js';

/** 物种成长倾向表 */
export const SPECIES_GROWTH_BIAS: Record<string, GrowthBias> = {
  '光灵':   { snark: 1.0, wisdom: 1.2, chaos: 1.0, patience: 1.0, debugging: 1.0 },
  '猫':     { snark: 1.3, wisdom: 1.1, chaos: 1.0, patience: 0.8, debugging: 1.0 },
  '鸭子':   { snark: 0.9, wisdom: 1.0, chaos: 0.9, patience: 1.2, debugging: 1.0 },
  '大鹅':   { snark: 1.4, wisdom: 0.9, chaos: 1.1, patience: 0.7, debugging: 0.9 },
  '幽灵':   { snark: 1.0, wisdom: 1.0, chaos: 1.3, patience: 0.9, debugging: 0.9 },
  '蘑菇':   { snark: 0.9, wisdom: 0.9, chaos: 1.2, patience: 1.1, debugging: 1.0 },
  '胖胖':   { snark: 0.8, wisdom: 1.0, chaos: 0.9, patience: 1.3, debugging: 1.0 },
  '机器人': { snark: 0.9, wisdom: 1.1, chaos: 0.7, patience: 1.0, debugging: 1.3 },
  '龙':     { snark: 1.1, wisdom: 1.2, chaos: 1.0, patience: 0.9, debugging: 1.2 },
  '凤凰':   { snark: 0.9, wisdom: 1.3, chaos: 0.8, patience: 1.1, debugging: 1.1 },
};

/** 兼容：从旧预设迁移到新系统（预设只占 30% 权重） */
export function migratePresetToPersonality(preset: Attributes, species: string): PersonalityTraits & { growthBias: GrowthBias } {
  return {
    snark: preset.snark * 0.3 + 50 * 0.7,
    wisdom: preset.wisdom * 0.3 + 50 * 0.7,
    chaos: preset.chaos * 0.3 + 50 * 0.7,
    patience: preset.patience * 0.3 + 50 * 0.7,
    debugging: preset.debugging * 0.3 + 50 * 0.7,
    growthBias: SPECIES_GROWTH_BIAS[species] ?? SPECIES_GROWTH_BIAS['光灵'],
  };
}

// ==================== 信任度（保留映射，对齐五阶段） ====================

export type TrustLevel = 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'soulmate';

// ==================== 亲密度五阶段（灵伴之旅） ====================

export type IntimacyStageName = '初见' | '相识' | '相知' | '相伴' | '灵犀';

export interface IntimacyStage {
  name: IntimacyStageName;
  min: number;
  max: number;
  trust: TrustLevel;
  description: string;
  theme: string;
}

export const INTIMACY_STAGES: IntimacyStage[] = [
  { name: '初见', min: 0,  max: 15, trust: 'stranger',      description: '陌生，试探中',       theme: '这个 AI 不一样' },
  { name: '相识', min: 16, max: 40, trust: 'acquaintance',   description: '好奇，开始依赖',     theme: '原来它能帮我做事' },
  { name: '相知', min: 41, max: 65, trust: 'friend',         description: '信任建立',           theme: '它能独立帮我处理事情' },
  { name: '相伴', min: 66, max: 85, trust: 'close_friend',   description: '情感连接',           theme: '它有自己的记忆和成长' },
  { name: '灵犀', min: 86, max: 100, trust: 'soulmate',      description: '默契，不言而喻',     theme: '默契不言而喻' },
];

/** 从亲密度分数获取阶段信息 */
export function getIntimacyStage(score: number): IntimacyStage {
  for (let i = INTIMACY_STAGES.length - 1; i >= 0; i--) {
    if (score >= INTIMACY_STAGES[i].min) return INTIMACY_STAGES[i];
  }
  return INTIMACY_STAGES[0];
}

/** 从阶段名获取阶段信息 */
export function getIntimacyStageByName(name: IntimacyStageName): IntimacyStage {
  return INTIMACY_STAGES.find(s => s.name === name) ?? INTIMACY_STAGES[0];
}

export function getTrustLevel(score: number): TrustLevel {
  return getIntimacyStage(score).trust;
}

export function getPermissions(level: TrustLevel): string[] {
  switch (level) {
    case 'stranger': return ['chat'];
    case 'acquaintance': return ['chat', 'read_files', 'list_files', 'search_files', 'git_status', 'git_diff', 'git_log', 'search_web', 'fetch_url'];
    case 'friend': return ['chat', 'read_files', 'list_files', 'search_files', 'git_status', 'git_diff', 'git_log', 'search_web', 'fetch_url', 'write_files', 'exec', 'analyze_file', 'scan_project', 'buddy_learn'];
    case 'close_friend': return ['chat', 'read_files', 'list_files', 'search_files', 'git_status', 'git_diff', 'git_log', 'search_web', 'fetch_url', 'write_files', 'exec', 'analyze_file', 'scan_project', 'buddy_learn', 'stmp_retrieve', 'dream_consolidate', 'knowledge_extract', 'experience_compile', 'camera', 'microphone'];
    case 'soulmate': return ['chat', 'read_files', 'list_files', 'search_files', 'git_status', 'git_diff', 'git_log', 'search_web', 'fetch_url', 'write_files', 'exec', 'analyze_file', 'scan_project', 'buddy_learn', 'stmp_retrieve', 'dream_consolidate', 'knowledge_extract', 'experience_compile', 'camera', 'microphone', 'package_create', 'package_share'];
  }
}

// ==================== 消息类型 ====================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

// ==================== 情绪类型 ====================
// Mood 已从 emotion/engine.ts 重导出，此处不再重复定义

export type IdleAction = 'blink' | 'look_around' | 'yawn' | 'stretch' | 'wave' | 'think' | 'sleep' | 'peek';

// ==================== WebSocket 事件 ====================

export type WSEvent =
  | { type: 'user_message' }
  | { type: 'thinking' }
  | { type: 'tool_call'; tool: string; args?: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; preview?: string }
  | { type: 'llm_response'; content: string; streaming?: boolean }
  | { type: 'stream_chunk'; content: string }
  | { type: 'idle' }
  | { type: 'error'; message: string }
  | { type: 'emotion'; mood: Mood; energy: number; satisfaction: number; intensity?: number; isAuthentic?: boolean }
  | { type: 'idle_action'; action: IdleAction; duration?: number; intensity?: number }
  | { type: 'status'; data: Record<string, unknown> }
  | { type: 'typing'; active: boolean }
  | { type: 'bubble'; text: string }
  | { type: 'tool_confirm_request'; id: string; tool: string; description: string; trustLevel: string }
  | { type: 'audio'; data: string; format: string; sentenceId?: string }
  | { type: 'audio_ready'; id: string; format: string }
  | { type: 'evolution'; from: string; to: string }
  | { type: 'evolution_log'; events: unknown[]; stagnation: unknown; count: number }
  | { type: 'orch_task'; taskId: string; name: string; status: string; tool?: string; result?: string; error?: string }
  | { type: 'orch_progress'; completed: number; total: number; current: string }
  | { type: 'orch_complete'; summary: string; taskCount: number; successCount: number }
  | { type: 'orch_error'; taskId: string; name: string; error: string }
  | { type: 'orch_start'; dagId: string; description: string; taskCount: number }
  | { type: 'orch_task_ready'; dagId: string; taskId: string; taskName: string }
  | { type: 'orch_task_start'; dagId: string; taskId: string }
  | { type: 'orch_task_done'; dagId: string; taskId: string; result: string }
  | { type: 'orch_task_fail'; dagId: string; taskId: string; error: string }
  | { type: 'orch_done'; dagId: string; summary: string; totalMs: number }
  | { type: 'orch_fail'; dagId: string; error: string }
  // Phase 5: 认知可视化事件
  | { type: 'cognitive_update'; profile: Record<string, unknown> }
  | { type: 'experience_matched'; unitName: string; confidence: number; path: string }
  | { type: 'dream_complete'; journal: string; timestamp: number }
  | { type: 'skill_registered'; name: string; description: string; source: string }
  | { type: 'domain_mature'; domain: string; knowledgeCount: number }
  // Phase 4: 诊断事件
  | { type: 'diagnostic'; data: import('./brain/types.js').DiagnosticReport }
  // Phase E: 测试 & 响应事件
  | { type: 'response_end'; content: string; toolCalls: number }
  // Expert Pool 事件
  | { type: 'expert_pool_start'; taskId: string; experts: string[] }
  | { type: 'expert_start'; taskId: string; expertId: string; modelId: string }
  | { type: 'expert_done'; taskId: string; expertId: string; latencyMs: number; success: boolean; error?: string }
  // 编排补充事件
  | { type: 'orch_task_retry'; dagId: string; taskId: string; attempt: number; maxRetry: number; delayMs: number }
  | { type: 'orch_task_skipped'; dagId: string; taskId: string; reason: string }
  | { type: 'orch_task_timeout'; dagId: string; taskId: string; timeoutMs: number }
  // Phase 2: 三进制训练事件
  | { type: 'ternary_train_complete'; domain: string; success: boolean; initialLoss: number; finalLoss: number; steps: number; timestamp: number }
  // 三进制扩展事件
  | { type: 'ternary_models'; models: Record<string, unknown>[] }
  | { type: 'ternary_train_start'; domain: string; steps: number }
  | { type: 'ternary_train_progress'; domain: string; step: number; totalSteps: number; loss: number }
  | { type: 'ternary_inference'; domain: string; confidence: number }
  | { type: 'model_installed'; domain: string; success: boolean }
  // 通信层 ACK/pong
  | { type: 'ack'; id: string }
  | { type: 'pong'; ts: number; configHash: string; serverTime: number }
  // BuddyClock 自主时钟事件
  | { type: 'clock_heartbeat'; phase: ClockPhase; desires: Record<string, number>; timestamp: number }
  | { type: 'clock_proactive'; intentType: ProactiveType; content: string; channel: string }
  | { type: 'clock_reminder'; reminderId: string; content: string }
  | { type: 'clock_phase_change'; from: ClockPhase; to: ClockPhase }
  // Sprint 2: 工具面板 & 记忆面板
  | { type: 'tool_panel_data'; data: ToolPanelData }
  | { type: 'memory_panel_data'; data: MemoryPanelData }
  | { type: 'agent_trace'; trace: AgentTraceStep[] }
  // Phase 3-4: 多专家并行 + 融合事件
  | { type: 'expert_pool_start'; taskId: string; experts: string[] }
  | { type: 'expert_start'; taskId: string; expertId: string; modelId: string }
  | { type: 'expert_done'; taskId: string; expertId: string; latencyMs: number; success: boolean; error?: string }
  | { type: 'multi_expert_complete'; experts: number; fusion: { merged: number; contradictions: number; associations: number; durationMs: number } }
  | { type: 'multi_expert_result'; taskId: string; experts: Array<{ id: string; success: boolean; latencyMs: number }> }
  | { type: 'confirm_required'; question: string }
  | { type: 'clarify'; question: string }
  // Phase 2: 三脑决策信号流可观测事件
  | { type: 'brain_trace'; phase: 'signal' | 'resource' | 'decision' | 'execution' | 'outcome'; traceId: string; timestamp: number; data: Record<string, unknown> }
  // 统一模型池决策事件
  | { type: 'model_decision'; modelId: string; displayName: string; tier: string; reason: string; layer: number; candidateCount: number; tsSample?: number; taskType: string; timestamp: number }
  // 感知事件推送
  | { type: 'perception_event'; id: string; category: string; source: string; data: Record<string, unknown>; timestamp: number }
  // 知识面板数据
  | { type: 'knowledge_panel_data'; data: Record<string, unknown> }
  | { type: 'narration'; narrationType: string; content: string; urgency: number; visual: { expression?: string; particleBurst: boolean; action?: string }; timestamp: number };

// ==================== 工具定义 ====================

export interface ToolDef {
  name: string;
  description: string;
  parameters: z.ZodType;
  permission: string;
  /** 工具来源 */
  source?: 'builtin' | 'mcp' | 'skill' | 'plugin';
  /** 输出结构校验（可选） */
  outputSchema?: z.ZodType;
  /** 输出格式提示：text=纯文本, json=JSON, lines=逐行 */
  outputFormat?: 'text' | 'json' | 'lines';
  /** 结果缓存 TTL（秒），0 或不填表示不缓存 */
  cacheTtlSec?: number;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** 工具执行记录 */
export interface ToolExecutionRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
  timestamp: number;
}

/** 工具面板数据 */
export interface ToolPanelData {
  tools: Array<{
    name: string;
    description: string;
    source: string;
    usageCount: number;
    successRate: number;
  }>;
  recentExecutions: ToolExecutionRecord[];
}

/** 记忆面板数据 */
export interface MemoryPanelData {
  domains: Array<{
    domain: string;
    domainType: string;
    knowledgeCount: number;
    depthScore: number;
    growthStage: string;
    confidence: number;
    conversationCount: number;
    lastActiveAt: number;
  }>;
  stats: {
    totalNodes: number;
    totalDomains: number;
    activeDomains: number;
  };
}

/** Agent 执行轨迹步骤 */
export interface AgentTraceStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  content: string;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  durationMs?: number;
  timestamp: number;
}

// ==================== LLM 连接配置（独立类型，不依赖 BuddyConfig） ====================

/** 独立的 LLM 连接配置 — 新代码统一使用此类型 */
export interface LLMConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
}

// ==================== Buddy 配置 ====================

export interface BuddyConfig {
  name: string;
  species: string;
  personality: Attributes;
  /**
   * @deprecated 已被 `models`（统一模型池）替代。
   * 仅为加载旧 config.json 时自动迁移而保留，运行时不应读取此字段。
   * 迁移后此字段会被清空。
   */
  llm?: {
    /** Provider ID — 内置: openai, deepseek, ollama, anthropic, google, siliconflow, mimo, custom */
    /** 也支持任意 string，未知 Provider 会自动按 OpenAI 兼容模式处理（需提供 baseUrl） */
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    /** 轻量模型（可选）— 闲聊/后台任务自动用，不填全走主模型 */
    lightweight?: {
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    };
    /** Fallback 链（可选）— 主模型不可用时按顺序尝试 */
    fallbacks?: Array<{
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    }>;
  };
  ws: {
    port: number;
    token?: string;
    /** 最大并发消息处理数（默认 3，仅作为冷启动值，自适应系统会自动调整） */
    maxConcurrent?: number;
    /** 单条消息最大处理时间 ms（默认 120000） */
    processingTimeoutMs?: number;
  };
  sandbox: {
    timeout: number; // ms
    workspace: string;
  };
  idle: {
    enabled: boolean;
    blinkMs: number;
    actionMs: number;
  };
  tts: {
    enabled: boolean;
    backend: 'edge' | 'openai' | 'disabled';
    voice?: string;           // 音色 ID，不填按物种自动选
    rate?: string;            // 语速
    pitch?: string;           // 音调
    openaiApiKey?: string;    // OpenAI TTS Key（可选）
  };
  mcp: {
    servers: Array<{
      name: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
      description?: string;
      autoConnect?: boolean;  // 是否自动连接
    }>;
  };
  platforms: {
    telegram?: {
      enabled: boolean;
      token: string;
    };
    discord?: {
      enabled: boolean;
      token: string;
      /** 监听的频道 ID（可选，不填则监听所有） */
      channelIds?: string[];
    };
    feishu?: {
      enabled: boolean;
      appId: string;
      appSecret: string;
      webhookPort?: number;     // 默认 9876
    };
    wecom?: {
      enabled: boolean;
      corpId: string;
      agentId: number;
      secret: string;
      token: string;
      encodingAESKey: string;
      webhookPort?: number;     // 默认 9877
    };
    wechat_mp?: {
      enabled: boolean;
      appId: string;
      appSecret: string;
      token: string;
      encodingAESKey: string;
      webhookPort?: number;     // 默认 9878
    };
    dingtalk?: {
      enabled: boolean;
      appKey: string;
      appSecret: string;
      robotCode?: string;
      mode?: 'stream' | 'webhook';  // 默认 stream
      webhookPort?: number;         // webhook 模式用，默认 9879
    };
  };
  /**
   * @deprecated 旧版 ModelPool 配置，已被 `models`（统一模型池）替代。
   * 保留仅为向后兼容，新代码应使用 `config.models`。
   */
  pool?: ModelPoolConfig;
  /** 统一模型池配置（新版本，替代 llm + pool） */
  models?: UnifiedModelsConfig;
  /** BuddyClock 自主时钟配置（可选） */
  clock?: {
    /** 是否启用自主时钟 */
    enabled: boolean;
    /** 心跳间隔（毫秒），默认 5 分钟 */
    heartbeatMs?: number;
    /** 每日最大主动行为次数，默认 5 */
    maxProactivesPerDay?: number;
    /** 主动行为最小间隔（毫秒），默认 30 分钟 */
    minProactiveIntervalMs?: number;
  };
  /** 三脑架构配置（可选，Phase 1-4 逐步启用） */
  threeBrain?: {
    /** 左脑配置 */
    left?: {
      distillIntervalMs?: number;
      enableLearnedRules?: boolean;
      maxLearnedRules?: number;
    };
    /** 右脑配置 */
    right?: {
      learningRate?: number;
      batchSize?: number;
      replayBufferSize?: number;
      lprLambda?: number;
    };
    /** 小脑配置 */
    cerebellum?: {
      maxActionsPerHour?: number;
    };
  };
  /** 知识源配置（可选） */
  knowledge?: {
    /** 本地知识源 */
    local?: {
      watchFolders: string[];
      fileTypes?: string[];
      syncIntervalMs?: number;
    };
    /** 网络知识源 */
    web?: {
      searchEngine?: 'searxng' | 'duckduckgo' | 'bing' | 'google' | 'local';
      /** SearXNG 实例地址 */
      searxngUrl?: string;
      apiKey?: string;
      /** 本地搜索索引路径 */
      localIndexPath?: string;
      maxResults?: number;
      cooldownMs?: number;
      /** 请求超时（ms），国内网络建议 15000+ */
      requestTimeoutMs?: number;
    };
    /** 飞书知识源 */
    feishu?: {
      appId: string;
      appSecret: string;
      spaces: Array<{ spaceId: string; name: string }>;
      syncIntervalMs?: number;
    };
  };
  /** 自定义工具端点（可选）— 用于接入本地 HTTP 服务（ComfyUI、Whisper 等） */
  customTools?: Array<{
    /** 工具唯一 ID */
    id: string;
    /** 显示名称 */
    name: string;
    /** 工具描述（LLM 看到的） */
    description: string;
    /** HTTP 端点地址 */
    endpoint: string;
    /** HTTP 方法，默认 POST */
    method?: 'GET' | 'POST' | 'PUT';
    /** 请求头（可选，如认证） */
    headers?: Record<string, string>;
    /** 参数 schema（JSON Schema 格式，LLM 用来理解参数） */
    parameters?: Record<string, unknown>;
    /** 超时 ms，默认 30000 */
    timeoutMs?: number;
  }>;
}

// ==================== ModelPool 类型 ====================

/** 模型池配置 */
export interface ModelPoolConfig {
  /** 调度策略 */
  strategy: 'task_match' | 'cost_optimized' | 'quality_first';
  /** 预算约束 */
  budget?: {
    maxCostPerHour?: number;
    maxCostPerDay?: number;
  };
  /** 池内节点列表 */
  nodes: PoolNodeConfig[];
}

/** 统一模型池配置（新版本，替代 llm + pool） */
export interface UnifiedModelsConfig {
  /** API 端点列表（用户只需填这些） */
  providers: Array<{
    id: string;
    type: 'siliconflow' | 'openrouter' | 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio' | 'custom';
    /** 默认模型名，如 'deepseek-chat'、'gpt-4o-mini'（可选，不填则自动发现） */
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    /** 用户自定义定价覆盖（¥/千token），可选 */
    costPer1kInput?: number;
    costPer1kOutput?: number;
  }>;
  /** 用户偏好（可选，不填就全自动） */
  preferences?: {
    excluded?: string[];
    preferFree?: boolean;
    preferLocal?: boolean;
    maxCostPer1k?: number;
    maxCostPerHour?: number;
    taskPreferences?: Record<string, { prefer?: string[]; avoid?: string[] }>;
  };
  /** 调度策略 */
  strategy?: 'task_match' | 'cost_optimized' | 'quality_first';
}

/** 节点能力标记 */
export interface NodeCapabilities {
  toolCalling: boolean;
  /** 工具调用模式：native=原生函数调用，prompt=prompt 模拟，none=不支持 */
  toolCallingMode: 'native' | 'prompt' | 'none';
  vision: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  preferredToolFormat: string;
  parallelToolCalls: boolean;
}

/** 池内节点配置（持久化） */
export interface PoolNodeConfig {
  id: string;
  type: 'cloud' | 'local_expert' | 'lora';
  /** 云端模型 */
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** 本地专家 */
  domain?: string;
  /** 通用 */
  tags: string[];
  tier: 'premium' | 'standard' | 'budget' | 'free';
  /** 成本（每 1k token） */
  costPer1kInput?: number;
  costPer1kOutput?: number;
  /** 手动覆盖的能力值（可选） */
  capabilities?: Partial<NodeCapabilities>;
}

/** 池内节点（运行时） */
export interface PoolNode {
  id: string;
  type: 'cloud' | 'local_expert' | 'lora';
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  domain?: string;
  tags: string[];
  tier: 'premium' | 'standard' | 'budget' | 'free';
  warm: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  stats: PoolNodeStats;
  /** 模型能力标记（从 ProviderAdapter 获取 + 手动覆盖） */
  capabilities: NodeCapabilities;
}

/** 节点运行时统计 */
export interface PoolNodeStats {
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  consecutiveFailures: number;
  /** 按任务类型分维度统计（避免 collapse 的关键） */
  byTaskType: Record<string, {
    attempts: number;
    successes: number;
    avgLatency: number;
  }>;
}

/** 决策记录 — 每次调度都记录，这是智能的燃料 */
export interface DecisionRecord {
  /** 输入 */
  input: string;
  inputHash: string;
  timestamp: number;
  /** 决策前的信号 */
  intent: string;
  domain: string | null;
  novelty: number;
  complexity: 'simple' | 'medium' | 'complex';
  /** 决策 */
  selectedNode: string;
  selectionReason: string;
  selectionLayer: 1 | 2 | 3;
  outputTokenLimit: number;
  /** 结果 */
  success: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  userFeedback?: 'good' | 'bad';
  fallbackTriggered: boolean;
  fallbackFrom?: string;
  /** 编排决策扩展（orchestrate 新增） */
  collaborationMode?: import('./types.js').CollaborationMode;
  localCoverageRatio?: number;
  localConfidence?: number;
}

// ==================== BuddyClock 自主时钟类型 ====================

/** 主人日常规律（从对话历史学习，非硬编码） */
export interface UserRoutine {
  id: string;
  name: string;                    // "morning_work" / "lunch_break" / "evening_coding"
  /** 时间特征（从历史数据学习） */
  typicalStart: { hour: number; minute: number; confidence: number };
  typicalEnd: { hour: number; minute: number; confidence: number };
  weekdays: number[];              // 0-6，周几常见
  /** 行为特征 */
  commonTopics: string[];          // 这个时段常聊的话题
  preferredChannel: string;        // 常用的通道
  moodTrend: string;               // 情绪趋势
  /** 学习数据 */
  observations: number;            // 观察次数
  lastSeen: number;                // 最后观察时间
}

/** 自主意图类型 */
export type ProactiveType = 'greeting' | 'care' | 'maintenance' | 'learning' | 'reminder' | 'reflection';

/** 自主意图 */
export interface ProactiveIntent {
  id: string;
  type: ProactiveType;
  /** 为什么要做这个 */
  reason: {
    desire: string;                // 来自 DesireEngine 的哪个欲望
    trigger: string;               // 什么触发了它
    confidence: number;            // 有多确信应该做
  };
  /** 做什么 */
  action: {
    channel: string;               // 通过哪个通道
    content: string;               // 说什么 / 做什么
    silent: boolean;               // 是否静默执行（不打扰主人）
  };
  /** 什么时候做 */
  timing: {
    earliest: number;              // 最早执行时间
    deadline: number;              // 最晚执行时间（过期就放弃）
    priority: number;              // 优先级（1-10）
  };
  /** 状态 */
  status: 'pending' | 'executed' | 'expired' | 'cancelled';
  createdAt: number;
  executedAt?: number;
}

/** 提醒触发类型 */
export type ReminderTriggerType = 'once' | 'recurring' | 'pattern';

/** 提醒 */
export interface Reminder {
  id: string;
  content: string;                 // 提醒内容
  createdBy: 'user' | 'buddy';    // 谁创建的
  /** 触发条件 */
  trigger: {
    type: ReminderTriggerType;
    /** once: 具体时间戳 */
    at?: number;
    /** recurring: cron 表达式 */
    cron?: string;
    /** pattern: 基于主人规律的模式名 */
    pattern?: string;              // "every_workday_morning"
  };
  /** 渠道 */
  channel: string;
  chatId?: string;
  /** 状态 */
  active: boolean;
  lastTriggered?: number;
  nextTrigger?: number;
}

/** 时钟阶段 */
export type ClockPhase = 'active' | 'idle' | 'sleeping' | 'away';

/** 时钟状态 */
export interface ClockState {
  /** 当前阶段 */
  phase: ClockPhase;
  /** 最后活动 */
  lastInteraction: number;
  lastProactive: number;
  lastDream: number;
  /** 今日统计 */
  todayInteractions: number;
  todayProactives: number;
  todayDreams: number;
  /** 学到的规律 */
  routines: UserRoutine[];
  /** 待执行意图队列 */
  intentQueue: ProactiveIntent[];
  /** 提醒列表 */
  reminders: Reminder[];
}

// ==================== WebSocket 客户端消息 ====================

export type WSClientMessage =
  | { type: 'chat'; content: string; id?: string }
  | { type: 'pet'; id?: string }
  | { type: 'command'; command: string; args?: string; id?: string }
  | { type: 'status_request'; id?: string }
  | { type: 'ping'; ts?: number; configHash?: string; id?: string }
  | { type: 'visual_seed'; id?: string }
  | { type: 'orchestrate'; content: string; id?: string }
  | { type: 'evolution_log'; limit?: number; id?: string }
  | { type: 'sensor_update'; data?: unknown; id?: string }
  | { type: 'tool_panel_request'; id?: string }
  | { type: 'memory_panel_request'; id?: string }
  | { type: 'tool_confirm_response'; confirmId: string; allowed: boolean; id?: string }
  | { type: 'ack'; id: string }
  | { type: 'pong'; ts: number; configHash: string; id?: string }
  | { type: 'resume'; lastSeq: number; id?: string }
  | { type: 'multi_expert'; content: string; id?: string }
  | { type: 'emotion_source'; source: string; mood?: string; confidence?: number; features?: unknown; id?: string }
  | { type: 'knowledge_panel_request'; id?: string };

/** LLM 提供商 RPM（每分钟请求数）上限表 */
export const PROVIDER_RPM_TABLE: Record<string, number> = {
  openai: 500,
  deepseek: 60,
  anthropic: 50,
  google: 15,
  ollama: 9999,   // 本地无限制，用大数表示
  mimo: 100,
  custom: 60,
  siliconflow: 100,
};

/**
 * 根据 provider 的 RPM 和平均延迟估算 maxLimit
 * 公式：maxLimit = min(RPM × avgLatencySec / 60, hardCap)
 *
 * @param provider LLM provider 名称
 * @param avgLatencyMs 平均延迟（默认 3000ms）
 * @param hardCap 硬上限（默认 10）
 * @param runtimeRPM 运行时实测 RPM（优先于静态表）
 */
export function estimateMaxLimit(provider: string, avgLatencyMs = 3000, hardCap = 10, runtimeRPM?: number): number {
  const rpm = runtimeRPM && runtimeRPM > 0
    ? runtimeRPM
    : (PROVIDER_RPM_TABLE[provider] ?? PROVIDER_RPM_TABLE.custom);
  const estimated = Math.floor((rpm * avgLatencyMs) / 60_000);
  return Math.max(1, Math.min(hardCap, estimated));
}

// ==================== 编排决策类型 ====================

/** 协作模式 */
export type CollaborationMode =
  | 'local_only'   // 本地专家独立完成
  | 'single'       // 单个外部 LLM
  | 'parallel'     // 多专家同时调用，结果融合
  | 'cascade'      // 先小模型试，质量不够再升级
  | 'sequential'   // 接力传递上下文
  | 'debate'       // 多方论证 + 裁决
  | 'deliberate'   // 审议环：需丰富信息
  | 'clarify'      // 审议环：追问用户
  | 'brainstorm'   // 审议环：头脑风暴生成方案
  | 'direct';      // Step 14: 直接执行工具，跳过 LLM

/** 编排决策节点 */
export interface OrchestrationNode {
  id: string;
  type: 'local_expert' | 'cloud_node' | 'experience';
  model?: string;
  domain?: string;
  /** 统一模型池：provider 标识 */
  provider?: string;
  /** Provider 凭据（由 ModelRouter 从 ModelPool 注入） */
  apiKey?: string;
  baseUrl?: string;
  /** 模型能力（由 ModelRouter.profileToCapabilities 注入） */
  capabilities?: ProviderCapabilities;
  /** 经验单元 ID（ExperienceRouter 路由到已学经验时填充） */
  skillId?: string;
  /** 路由新颖度（0-1，越高越没见过） */
  novelty?: number;
  /** 路由路径 */
  routePath?: import('./intelligence/types.js').RoutePath;
}

/** 编排决策计划 */
export interface OrchestrationPlan {
  /** 用户原始输入 */
  content: string;
  /** 协作模式 */
  mode: CollaborationMode;
  /** 决策理由（可追溯） */
  reason: string;
  /** 检测到的领域 */
  domains: string[];
  /** 任务复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 任务类型（从 signal 透传，避免 LLM 重复推断） */
  taskType?: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain';
  /** 选定的执行节点 */
  selectedNodes: OrchestrationNode[];
  /** 是否需要 DAG 编排 */
  useDAG: boolean;
  /** Phase 2: SkillResolver 解析后的完整可执行 DAG（useDAG=true 时由 resolveDAGPipeline 填充） */
  resolvedDAG?: import('./orchestrate/types.js').TaskDAG;
  /** Phase 2: DAG 骨架（useDAG=true 时由 planSkeleton 生成） */
  dagSkeleton?: import('./orchestrate/types.js').DAGSkeleton;
  /** 经验路由决策（Phase 1: ExperienceRouter 接入） */
  routeDecision?: import('./intelligence/types.js').RouteDecision;
  /** Step 14: 直接执行工具 — 跳过 LLM，直接调用工具返回结果 */
  directTool?: { name: string; args: Record<string, unknown> };
  /** 决策元数据 */
  meta: {
    localCoverageRatio: number;
    localConfidence: number;
    budgetRemaining: number;
    availableNodeCount: number;
    userCorrectionCount: number;
    /** 三脑决策延迟（ms） */
    threeBrainLatencyMs?: number;
    /** 右脑直觉信号 */
    intuition?: unknown;
    /** 小脑稳态调节动作 */
    homeostasisActions?: unknown[];
    /** 决策追踪 ID（用于关联决策与执行结果） */
    traceId?: string;
    /** 审议环元数据 */
    deliberation?: {
      action: 'proceed' | 'refine' | 'brainstorm' | 'concede';
      strategy?: string;
      reason: string;
      clarificationQuestion?: string;
      proposals?: unknown[];
      archiveId?: string;
    };
  };
  /** Phase 2.1: 备选方案 — 主方案失败时切换，无需重新编排 */
  candidates?: Array<{
    mode: CollaborationMode;
    reason: string;
    selectedNodes: OrchestrationNode[];
    confidence: number;
    source: string;
  }>;
}

/** 编排执行结果 */
export interface ExecutionResult {
  text: string;
  source: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  expertResults?: Array<{ nodeId?: string; text: string; success: boolean; latencyMs?: number }>;
}

export const DEFAULT_CONFIG: BuddyConfig = {
  name: 'Buddy',
  species: '光灵',
  personality: PRESET_PERSONALITIES.warm_companion,
  // llm 字段已废弃，新用户通过 models.providers 配置
  ws: { port: 8765, maxConcurrent: 3, processingTimeoutMs: 120_000 },
  sandbox: { timeout: 30000, workspace: '/tmp/buddy-sandbox' },
  idle: { enabled: true, blinkMs: 3000, actionMs: 15000 },
  tts: { enabled: true, backend: 'edge' },
  mcp: { servers: [] },
  platforms: {},
  clock: { enabled: false },
};
