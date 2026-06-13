import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { WSEvent, WSClientMessage } from '../types.js';
import type { LinkHandler } from '../core/link-handler.js';

// ==================== 入站消息 Schema 校验（MAJ-06 修复） ====================

const WSClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), content: z.string().max(50_000), id: z.string().optional() }),
  z.object({ type: z.literal('pet'), id: z.string().optional() }),
  z.object({ type: z.literal('command'), command: z.string().max(1000), args: z.string().max(10_000).optional(), id: z.string().optional() }),
  z.object({ type: z.literal('status_request'), id: z.string().optional() }),
  z.object({ type: z.literal('ping'), ts: z.number().optional(), configHash: z.string().optional(), id: z.string().optional() }),
  z.object({ type: z.literal('visual_seed'), id: z.string().optional() }),
  z.object({ type: z.literal('orchestrate'), content: z.string().max(50_000), id: z.string().optional() }),
  z.object({ type: z.literal('evolution_log'), limit: z.number().max(1000).optional(), id: z.string().optional() }),
  z.object({ type: z.literal('sensor_update'), data: z.unknown().optional(), id: z.string().optional() }),
  z.object({ type: z.literal('tool_panel_request'), id: z.string().optional() }),
  z.object({ type: z.literal('memory_panel_request'), id: z.string().optional() }),
  z.object({ type: z.literal('tool_confirm_response'), confirmId: z.string(), allowed: z.boolean(), id: z.string().optional() }),
  z.object({ type: z.literal('ack'), id: z.string() }),
  z.object({ type: z.literal('pong'), ts: z.number(), configHash: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal('resume'), lastSeq: z.number(), id: z.string().optional() }),
  z.object({ type: z.literal('multi_expert'), content: z.string().max(50_000), id: z.string().optional() }),
  z.object({ type: z.literal('emotion_source'), source: z.string().max(100), mood: z.string().max(50).optional(), confidence: z.number().min(0).max(1).optional(), features: z.unknown().optional(), id: z.string().optional() }),
  z.object({ type: z.literal('knowledge_panel_request'), id: z.string().optional() }),
]);

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
type RouteKey = `${string} ${string}`; // "METHOD /path"

/**
 * WebSocket 服务器 - 前后端实时通信
 * 支持双向消息：后端推送事件 + 前端发送指令
 * 支持 Token 认证 + REST API 路由
 * 支持消息序列号 + 重放缓冲区（断连恢复）
 */
export class EventBus {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private messageHandler?: (msg: WSClientMessage, ws?: WebSocket) => void;
  private connectHandler?: () => void;
  private disconnectHandler?: () => void;
  private routes = new Map<RouteKey, RouteHandler>();
  private token: string;
  // Rate limiting: 每个客户端的消息时间戳队列
  private rateLimits = new Map<WebSocket, number[]>();
  private readonly RATE_WINDOW_MS = 10_000; // 10 秒窗口
  private readonly RATE_MAX_MESSAGES = 30;  // 窗口内最多 30 条
  // LinkHandler 引用 — 用于注入 seq 和写入重放缓冲区
  private linkHandler: LinkHandler | null = null;

  // 服务端心跳：主动探测客户端存活
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly SERVER_HEARTBEAT_INTERVAL_MS = 45_000; // 45 秒发一次 ping
  private clientLastPong = new Map<WebSocket, number>();

  constructor(port: number, token: string) {
    this.token = token;

    // HTTP 服务器 — 路由分发 + Token 认证
    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const origin = req.headers.origin ?? '';

      // CORS preflight — 仅允许本地来源
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': this.isLocalOrigin(origin) ? origin : '',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Vary': 'Origin',
        });
        res.end();
        return;
      }

      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      const routeKey = `${method} ${url.split('?')[0]}` as RouteKey;

      // 通用 CORS header（仅本地）
      const corsHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Vary': 'Origin',
      };
      if (this.isLocalOrigin(origin)) {
        corsHeaders['Access-Control-Allow-Origin'] = origin;
      }

      // 内置端点：Token 获取（本地来源或同源请求免认证，远程需认证）
      if (routeKey === 'GET /api/ws-token') {
        const origin = req.headers.origin ?? '';
        const host = req.headers.host ?? '';
        const isLocal = !origin || this.isLocalOrigin(origin) || this.isLocalHost(host);
        if (!isLocal && !this.verifyToken(req)) {
          res.writeHead(401, corsHeaders);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ token: this.token }));
        return;
      }

      // 内置端点：公开配置（无需认证）
      if (routeKey === 'GET /api/config' || routeKey === 'GET /api/model-pool') {
        const handler = this.routes.get(routeKey);
        if (handler) {
          try {
            const result = handler(req, res);
            if (result instanceof Promise) result.catch(err => console.warn('[WS] 路由处理异常:', (err as Error).message));
          } catch (err) { console.warn('[WS] 路由处理异常:', (err as Error).message); }
        }
        return;
      }

      // REST 路由：需要 Token 认证
      const handler = this.routes.get(routeKey);
      if (handler) {
        // Token 验证
        if (!this.verifyToken(req)) {
          res.writeHead(401, corsHeaders);
          res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing token' }));
          return;
        }
        try {
          const result = handler(req, res);
          if (result instanceof Promise) {
            result.catch((err) => {
              if (!res.headersSent) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ error: (err as Error).message }));
              }
            });
          }
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        }
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    this.wss = new WebSocketServer({
      server: httpServer,
      // permessage-deflate 消息压缩（RFC 7692）
      // 大消息（工具结果、编排进度、三进制数据）自动压缩 60%+
      perMessageDeflate: {
        zlibDeflateOptions: { level: 6 },
        threshold: 1024, // >1KB 才压缩
      },
    });

    // 在 WebSocket 握手前验证 Token（拒绝非法连接）
    // 支持 query param token 和 Authorization: Bearer header 两种方式
    httpServer.on('upgrade', (req, socket) => {
      if (!this.token) return;

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const clientToken = url.searchParams.get('token');

      // 尝试从 Authorization header 获取 token
      const authHeader = req.headers.authorization;
      let headerToken: string | null = null;
      if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) headerToken = match[1];
      }

      if (clientToken !== this.token && headerToken !== this.token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws, req) => {
      // Token 验证（双重检查）
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const clientToken = url.searchParams.get('token');

      const authHeader = req.headers.authorization;
      let headerToken: string | null = null;
      if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) headerToken = match[1];
      }

      if (clientToken !== this.token && headerToken !== this.token) {
        ws.close(4001, 'Unauthorized: invalid token');
        return;
      }

      this.clients.add(ws);
      this.clientLastPong.set(ws, Date.now());
      const count = this.clients.size;
      console.log(`👤 新客户端连接 (当前 ${count} 个)`);
      this.connectHandler?.();

      // 监听 WS 协议层 pong（服务端心跳响应）
      ws.on('pong', () => {
        this.clientLastPong.set(ws, Date.now());
      });

      // 发送欢迎事件
      this.sendTo(ws, { type: 'status', data: { connected: true, clients: count } });

      ws.on('message', (data) => {
        // Rate limiting
        if (!this.checkRate(ws)) {
          this.sendTo(ws, { type: 'error', message: '消息太频繁，请稍后再试' });
          return;
        }
        try {
          const raw = data.toString();
          const parsed = JSON.parse(raw) as unknown;
          // MAJ-06 修复: 用 Zod 校验入站消息结构
          const result = WSClientMessageSchema.safeParse(parsed);
          if (!result.success) {
            const errMsg = result.error.issues[0];
            this.sendTo(ws, { type: 'error', message: `消息格式错误: ${errMsg?.path?.join('.')} ${errMsg?.message ?? ''}` });
            return;
          }
          if (this.messageHandler) {
            this.messageHandler(result.data as WSClientMessage, ws);
          }
        } catch {
          // 非 JSON 消息，当纯文本处理
          if (this.messageHandler) {
            this.messageHandler({ type: 'chat', content: data.toString() }, ws);
          }
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.rateLimits.delete(ws);
        console.log(`👋 客户端断开 (当前 ${this.clients.size} 个)`);
        this.disconnectHandler?.();
      });

      ws.on('error', (err) => {
        console.error('WebSocket 错误:', err.message);
        this.clients.delete(ws);
      });
    });

    httpServer.listen(port, () => {
      console.log(`🔌 HTTP+WS 服务器启动: http://localhost:${port}`);
      this.startServerHeartbeat();
    });
  }

  /** 设置 LinkHandler（用于 seq 注入 + 重放缓冲区） */
  setLinkHandler(lh: LinkHandler): void {
    this.linkHandler = lh;
  }

  /** 注册 REST 路由 */
  addRoute(method: string, path: string, handler: RouteHandler): void {
    const key = `${method.toUpperCase()} ${path}` as RouteKey;
    this.routes.set(key, handler);
  }

  /** 验证请求 Token（Authorization header 或 ?token= query param） */
  private verifyToken(req: IncomingMessage): boolean {
    if (!this.token) return true;

    // 1. 检查 Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1] === this.token) return true;
    }

    // 2. 检查 query param
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken === this.token) return true;

    return false;
  }

  /** 判断是否为本地来源（防止 CSRF） */
  private isLocalOrigin(origin: string): boolean {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    } catch {
      return false;
    }
  }

  /** 判断 Host 头是否为本地地址（同源请求无 Origin 头时使用） */
  private isLocalHost(host: string): boolean {
    if (!host) return false;
    const hostname = host.split(':')[0];
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  }

  /** 广播事件给所有连接的客户端（自动注入 seq + 写入重放缓冲区） */
  emit(event: WSEvent): void {
    // 注入 seq（心跳 pong 不注入，避免缓冲区膨胀）
    let seq: number | undefined;
    if (this.linkHandler && event.type !== 'pong') {
      seq = this.linkHandler.nextSeq();
      (event as Record<string, unknown>).seq = seq;
    }

    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }

    // 写入重放缓冲区（仅需要可靠送达的事件）
    if (seq !== undefined && this.linkHandler && this.shouldReplay(event.type)) {
      this.linkHandler.addToReplayBuffer(seq, event as Record<string, unknown>);
    }
  }

  /** 发送事件给特定客户端（自动注入 seq + 写入重放缓冲区） */
  sendTo(ws: WebSocket, event: WSEvent): void {
    if (this.linkHandler && event.type !== 'pong') {
      const seq = this.linkHandler.nextSeq();
      (event as Record<string, unknown>).seq = seq;
      if (this.shouldReplay(event.type)) {
        this.linkHandler.addToReplayBuffer(seq, event as Record<string, unknown>);
      }
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /** 判断消息类型是否需要重放 */
  private shouldReplay(type: string): boolean {
    // 流式响应、工具结果、情绪、编排进度等需要可靠送达
    // 注意：thinking/confirm_required 等瞬态事件不入重放缓冲区
    const replayTypes = new Set([
      'llm_response', 'stream_chunk', 'error',
      'tool_call', 'tool_result', 'tool_confirm_request',
      'emotion', 'status', 'evolution', 'achievement',
      'orch_start', 'orch_task_start', 'orch_task_done', 'orch_task_fail',
      'orch_progress', 'orch_done', 'orch_fail',
      'ternary_train_start', 'ternary_train_progress', 'ternary_train_complete',
      'ternary_inference', 'model_installed',
      'bubble', 'idle', 'idle_action', 'dreaming', 'dream_complete',
      'cognitive_update', 'experience_matched', 'domain_mature', 'skill_registered',
      'audio', 'tool_panel_data', 'memory_panel_data', 'agent_trace',
    ]);
    return replayTypes.has(type);
  }

  /** 注册客户端消息处理器 */
  onMessage(handler: (msg: WSClientMessage, ws?: WebSocket) => void): void {
    this.messageHandler = handler;
  }

  /** 注册连接/断开回调 */
  onConnect(handler: () => void): void {
    this.connectHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  /** 当前连接数 */
  get clientCount(): number {
    return this.clients.size;
  }

  /** WS 消息频率限制 */
  private checkRate(ws: WebSocket): boolean {
    const now = Date.now();
    let timestamps = this.rateLimits.get(ws);
    if (!timestamps) {
      timestamps = [];
      this.rateLimits.set(ws, timestamps);
    }
    // 清除窗口外的旧记录
    while (timestamps.length > 0 && timestamps[0] < now - this.RATE_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length >= this.RATE_MAX_MESSAGES) return false;
    timestamps.push(now);
    return true;
  }

  close(): void {
    this.stopServerHeartbeat();
    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }

  // ==================== 服务端心跳 ====================

  private startServerHeartbeat(): void {
    this.stopServerHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const client of this.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        // 检查上次 pong 时间，超过 90s 未响应 → 僵尸连接
        const lastPong = this.clientLastPong.get(client) ?? now;
        if (now - lastPong > 90_000) {
          console.log('💀 僵尸连接清理（90s 无 pong 响应）');
          client.terminate();
          this.clients.delete(client);
          this.clientLastPong.delete(client);
          continue;
        }

        // 发送 ping（通过 WS 协议层 ping，非应用层）
        try {
          client.ping();
        } catch {
          // ping 失败，清理
          client.terminate();
          this.clients.delete(client);
          this.clientLastPong.delete(client);
        }
      }
    }, this.SERVER_HEARTBEAT_INTERVAL_MS);
  }

  private stopServerHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
