/**
 * LinkHandler 后端通信层类型定义
 */

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

// ==================== ACK 消息 ====================

export interface AckMessage {
  type: 'ack';
  id: string;
}

// ==================== Pong 消息 ====================

export interface PongMessage {
  type: 'pong';
  ts: number;
  configHash: string;
  serverTime: number;
}

// ==================== Ping 消息（来自客户端） ====================

export interface PingMessage {
  type: 'ping';
  ts: number;
  configHash: string;
}

// ==================== 待处理消息记录（幂等检查） ====================

export interface ProcessedMsg {
  id: string;
  processedAt: number;
  result?: string;
}
