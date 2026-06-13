/**
 * BuddyLink 通信层类型定义
 * 事件驱动管道架构 — 类型约束状态
 */

// ==================== 连接状态（类型约束） ====================

export type LinkState =
  | { tag: 'idle' }
  | { tag: 'connecting'; ws: WebSocket; attempt: number; since: number }
  | { tag: 'live'; ws: WebSocket; since: number; rtt: number }
  | { tag: 'degraded'; ws: WebSocket; since: number; reason: string; failCount: number }
  | { tag: 'offline'; since: number; queueSize: number }
  | { tag: 'dead'; reason: string; since: number; attempts: number };

// ==================== 通信事件（诊断用） ====================

export interface CommEvent {
  timestamp: number;
  type:
    | 'send' | 'ack' | 'retry' | 'timeout' | 'connect' | 'disconnect'
    | 'heartbeat' | 'fallback' | 'queue' | 'flush' | 'error' | 'config_sync';
  success: boolean;
  cause?: {
    category: 'network' | 'auth' | 'config' | 'timeout' | 'protocol' | 'unknown';
    detail: string;
  };
  context?: Record<string, unknown>;
}

// ==================== 故障模式（从诊断派生） ====================

export interface FaultPattern {
  cause: string;
  count: number;
  lastSeen: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

// ==================== 自适应参数 ====================

export interface CommParams {
  timeoutMs: number;
  maxRetries: number;
  heartbeatIntervalMs: number;
  tokenRefreshFirst: boolean;
}

// ==================== 待确认消息 ====================

export interface PendingMsg {
  id: string;
  payload: string;
  sentAt: number;
  retries: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

// ==================== 连接质量指标 ====================

export interface LinkMetrics {
  rtt: number;
  reconnectCount: number;
  messagesSent: number;
  messagesFailed: number;
  pendingCount: number;
  queueSize: number;
  uptime: number;
  quality: 'good' | 'degraded' | 'poor';
}

// ==================== 离线队列项 ====================

export interface QueueItem {
  id: string;
  payload: string;
  priority: number;
  createdAt: number;
  retryCount: number;
}

// ==================== 优先级常量 ====================

export const Priority = {
  CRITICAL: 3, // LLM 配置、认证
  HIGH: 2,     // 用户聊天消息
  NORMAL: 1,   // 视觉种子、状态请求
  LOW: 0,      // 心跳、统计
} as const;

// ==================== 管道扩展 ====================

/** 管道上下文 — 在管道层之间传递 */
export interface PipelineContext {
  /** 操作类型 */
  type: 'send' | 'receive' | 'state_change';
  /** 当前阶段 */
  stage: 'before' | 'state' | 'reliability' | 'transport' | 'observe' | 'after';
  /** 发送时的消息 payload（JSON 字符串） */
  payload?: string;
  /** 接收时的消息对象 */
  msg?: unknown;
  /** 优先级 */
  priority?: number;
  /** 设为 true 跳过后续核心逻辑 */
  skip?: boolean;
  /** 任意扩展数据 */
  meta?: Record<string, unknown>;
}

/**
 * 管道层处理函数
 * 调用 next() 继续执行后续层，不调用则中断管道
 */
export type PipelineLayer = (
  ctx: PipelineContext,
  next: () => Promise<unknown>,
) => Promise<unknown> | unknown;
