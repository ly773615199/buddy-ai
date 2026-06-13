/**
 * 多平台适配器基类
 * CLI / Telegram / Discord / Chrome Extension 统一接口
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export type PlatformType = 'cli' | 'telegram' | 'discord' | 'chrome' | 'web' | 'feishu' | 'wecom' | 'wechat_mp' | 'dingtalk';

export interface PlatformMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PlatformCapabilities {
  markdown: boolean;       // 支持 Markdown
  richContent: boolean;    // 支持富文本/卡片
  reactions: boolean;      // 支持表情回应
  buttons: boolean;        // 支持按钮
  files: boolean;          // 支持文件收发
  voice: boolean;          // 支持语音
  images: boolean;         // 支持图片
  threads: boolean;        // 支持线程
}

export interface PlatformAdapter {
  readonly platform: PlatformType;
  readonly capabilities: PlatformCapabilities;

  /** 初始化连接 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
  /** 发送消息 */
  send(message: string, options?: SendOptions): Promise<void>;
  /** 接收消息回调 */
  onMessage(callback: (msg: PlatformMessage) => void): void;
  /** 发送输入状态 */
  sendTyping?(): Promise<void>;
  /** 发送反应 */
  react?(channelOrMessageId: string, messageIdOrEmoji: string, emoji?: string): Promise<void>;
  /** 是否已连接 */
  isConnected(): boolean;
}

export interface SendOptions {
  replyTo?: string;
  format?: 'text' | 'markdown' | 'html';
  silent?: boolean;
  parseMode?: string;
}

// ==================== CLI 适配器 ====================

export class CLIAdapter implements PlatformAdapter {
  readonly platform = 'cli' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: true,
    richContent: false,
    reactions: false,
    buttons: false,
    files: true,
    voice: false,
    images: false,
    threads: false,
  };

  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private readline: any = null;

  async connect(): Promise<void> {
    this.connected = true;

    // 动态导入 readline (Node.js)
    const rl = await import('readline');
    this.readline = rl.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🐱 > ',
    });

    this.readline.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) { this.readline.prompt(); return; }

      this.messageCallback?.({
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });

      this.readline.prompt();
    });

    this.readline.prompt();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.readline?.close();
  }

  async send(message: string): Promise<void> {
    // ANSI 彩色输出
    const colored = this._colorize(message);
    console.log(colored);
    this.readline?.prompt();
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  async sendTyping(): Promise<void> {
    process.stdout.write('🤔 思考中...\r');
  }

  isConnected(): boolean {
    return this.connected;
  }

  private _colorize(text: string): string {
    // 简单的 ANSI 着色
    return text
      .replace(/✅/g, '\x1b[32m✅\x1b[0m')
      .replace(/❌/g, '\x1b[31m❌\x1b[0m')
      .replace(/⚠️/g, '\x1b[33m⚠️\x1b[0m');
  }
}

// ==================== Telegram 适配器 ====================

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: true,
    richContent: true,
    reactions: true,
    buttons: true,
    files: true,
    voice: true,
    images: true,
    threads: false,
  };

  private token: string;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private offset = 0;
  private polling = false;
  private lastChatId: string | null = null;

  constructor(token: string) {
    this.token = token;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this._startPolling();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.polling = false;
  }

  async send(message: string, options?: SendOptions): Promise<void> {
    if (!this.connected) return;

    // 优先使用 replyTo，其次使用最后活跃的 chatId
    const chatId = options?.replyTo ?? this.lastChatId;
    if (!chatId) return;

    await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options?.format === 'markdown' ? 'Markdown' : undefined,
      }),
    });
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    await fetch(`https://api.telegram.org/bot${this.token}/setMessageReaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      }),
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async _startPolling(): Promise<void> {
    this.polling = true;

    while (this.polling && this.connected) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=30`,
        );
        const data = await res.json() as any;

        if (data.ok && data.result) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;

            if (update.message?.text) {
              const chatId = String(update.message.chat.id);
              this.lastChatId = chatId; // 记录最后活跃的 chatId

              this.messageCallback?.({
                role: 'user',
                content: update.message.text,
                timestamp: update.message.date * 1000,
                metadata: {
                  chatId,
                  messageId: update.message.message_id,
                  from: update.message.from?.first_name,
                },
              });
            }
          }
        }
      } catch {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

// ==================== Discord 适配器 ====================

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: true,
    richContent: true,
    reactions: true,
    buttons: true,
    files: true,
    voice: false,
    images: true,
    threads: true,
  };

  private token: string;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastChannelId: string | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private lastSequence: number | null = null;

  constructor(token: string) {
    this.token = token;
  }

  async connect(): Promise<void> {
    try {
      // 获取 Gateway URL
      const gwRes = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: { 'Authorization': `Bot ${this.token}` },
      });
      const gwData = await gwRes.json() as { url: string };
      const gatewayUrl = `${gwData.url}?v=10&encoding=json`;

      this._connectGateway(gatewayUrl);
    } catch (err) {
      console.error('Discord gateway 连接失败:', (err as Error).message);
      this.connected = false;
    }
  }

  private _connectGateway(url: string): void {
    // 动态导入 ws（Node.js 环境）
    try {
      const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
      this.ws = new WS(url);
    } catch {
      // Fallback：尝试全局 WebSocket
      this.ws = new WebSocket(url);
    }

    const ws = this.ws;
    if (!ws) return;

    ws.onopen = () => {
      console.log('Discord gateway 已连接');
    };

    ws.onmessage = (event: any) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        this._handleGatewayPayload(payload);
      } catch {
        // 忽略无法解析的消息
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this._stopHeartbeat();
      console.log('Discord gateway 断开，5 秒后重连...');
      setTimeout(() => {
        if (this.resumeGatewayUrl) {
          this._connectGateway(`${this.resumeGatewayUrl}?v=10&encoding=json`);
        }
      }, 5000);
    };

    ws.onerror = (err: any) => {
      console.error('Discord gateway 错误:', err.message ?? 'unknown');
    };
  }

  private _handleGatewayPayload(payload: any): void {
    const { op, t, d, s } = payload;

    if (s) this.lastSequence = s;

    switch (op) {
      case 10: // Hello — 收到心跳间隔 + 发送 Identify
        this._startHeartbeat(d.heartbeat_interval);
        this._sendIdentify();
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        this._handleDispatch(t, d);
        break;

      case 7: // Reconnect
        this.ws?.close();
        break;

      case 9: // Invalid Session
        this.sessionId = null;
        setTimeout(() => this._sendIdentify(), 5000);
        break;
    }
  }

  private _sendIdentify(): void {
    this.ws?.send(JSON.stringify({
      op: 2, // Identify
      d: {
        token: this.token,
        intents: 1 | 2 | 512, // GUILDS + GUILD_MEMBERS + DIRECT_MESSAGES
        properties: { os: 'linux', browser: 'buddy', device: 'buddy' },
      },
    }));
  }

  private _startHeartbeat(interval: number): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.lastSequence }));
    }, interval);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _handleDispatch(eventType: string, data: any): void {
    switch (eventType) {
      case 'READY':
        this.connected = true;
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        console.log(`Discord 已就绪: ${data.user?.username ?? 'bot'}`);
        break;

      case 'MESSAGE_CREATE':
        // 忽略 bot 自己的消息
        if (data.author?.bot) return;

        const channelId = data.channel_id;
        this.lastChannelId = channelId;

        this.messageCallback?.({
          role: 'user',
          content: data.content ?? '',
          timestamp: new Date(data.timestamp).getTime(),
          metadata: {
            chatId: channelId,
            messageId: data.id,
            guildId: data.guild_id,
            from: data.author?.username,
          },
        });
        break;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this._stopHeartbeat();
    if (this.ws) {
      // 发送 Close frame
      try { this.ws.close(1000, 'Disconnecting'); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  async send(message: string, options?: SendOptions): Promise<void> {
    if (!this.connected) return;

    // 优先使用 replyTo（channelId），其次使用最后活跃的频道
    const channelId = options?.replyTo ?? this.lastChannelId;
    if (!channelId) return;

    const body: Record<string, any> = { content: message };
    if (options?.replyTo) {
      body.message_reference = { message_id: options.replyTo };
    }

    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${this.token}`,
      },
      body: JSON.stringify(body),
    });
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<void> {
    await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      { method: 'PUT', headers: { 'Authorization': `Bot ${this.token}` } },
    );
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ==================== 平台管理器 ====================

export class PlatformManager {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map();
  private activePlatform: PlatformType | null = null;

  /** 注册平台 */
  register(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /** 激活平台 */
  async activate(platform: PlatformType): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`平台 "${platform}" 未注册`);

    if (this.activePlatform) {
      await this.adapters.get(this.activePlatform)?.disconnect();
    }

    await adapter.connect();
    this.activePlatform = platform;
  }

  /** 获取活跃平台 */
  getActive(): PlatformAdapter | null {
    return this.activePlatform ? this.adapters.get(this.activePlatform) ?? null : null;
  }

  /** 获取平台能力 */
  getCapabilities(platform: PlatformType): PlatformCapabilities | null {
    return this.adapters.get(platform)?.capabilities ?? null;
  }

  /** 列出已注册平台 */
  list(): PlatformType[] {
    return Array.from(this.adapters.keys());
  }

  /** 断开所有 */
  async disconnectAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
    this.activePlatform = null;
  }

  destroy(): void {
    this.disconnectAll();
    this.adapters.clear();
  }
}
