/**
 * 钉钉适配器 — 实现 PlatformAdapter 接口
 *
 * 支持 Stream 模式（无需公网地址）和 Webhook 模式
 * 依赖：无（原生 fetch）
 */

import type {
  PlatformAdapter, PlatformCapabilities, PlatformMessage, SendOptions,
} from './platform.js';

// ==================== 类型 ====================

export interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  robotCode?: string;
  mode?: 'stream' | 'webhook';    // 默认 stream
  webhookPort?: number;            // webhook 模式用，默认 9879
}

// ==================== DingTalkAdapter ====================

export class DingTalkAdapter implements PlatformAdapter {
  readonly platform = 'dingtalk' as const;
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

  private appKey: string;
  private appSecret: string;
  private robotCode: string;
  private mode: 'stream' | 'webhook';
  private webhookPort: number;
  private accessToken = '';
  private accessTokenExpireAt = 0;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private lastConversationId: string | null = null;
  private lastSenderStaffId: string | null = null;
  private streamClient: any = null;
  private server: any = null;

  constructor(config: DingTalkConfig) {
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.robotCode = config.robotCode ?? config.appKey;
    this.mode = config.mode ?? 'stream';
    this.webhookPort = config.webhookPort ?? 9879;
  }

  // ==================== 生命周期 ====================

  async connect(): Promise<void> {
    await this._refreshToken();

    if (this.mode === 'stream') {
      await this._connectStream();
    } else {
      await this._startWebhook();
    }

    this.connected = true;
    console.log(`[DingTalk] 已连接 (${this.mode} 模式)`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.streamClient) {
      try { this.streamClient.close(); } catch { /* ignore */ }
      this.streamClient = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ==================== 发送消息 ====================

  async send(message: string, options?: SendOptions): Promise<void> {
    if (!this.connected) return;

    await this._ensureToken();

    const conversationId = options?.replyTo ?? this.lastConversationId;
    if (!conversationId) return;

    // 群聊消息
    await fetch(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': this.accessToken,
        },
        body: JSON.stringify({
          msgParam: JSON.stringify({ content: message }),
          msgKey: 'sampleText',
          openConversationId: conversationId,
          robotCode: this.robotCode,
        }),
      },
    );
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  // ==================== Token 管理 ====================

  private async _refreshToken(): Promise<void> {
    const res = await fetch(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appKey: this.appKey,
          appSecret: this.appSecret,
        }),
      },
    );

    const data = await res.json() as any;
    if (!data.accessToken) {
      throw new Error(`钉钉 token 获取失败: ${JSON.stringify(data)}`);
    }

    this.accessToken = data.accessToken;
    this.accessTokenExpireAt = Date.now() + (data.expireIn - 300) * 1000;
  }

  private async _ensureToken(): Promise<void> {
    if (Date.now() >= this.accessTokenExpireAt) {
      await this._refreshToken();
    }
  }

  // ==================== Stream 模式 ====================

  private async _connectStream(): Promise<void> {
    // Stream 模式使用钉钉 SDK 的长连接
    // 由于不引入 SDK，这里实现一个简化的轮询版本
    // 生产环境建议使用 @openim/dingtalk SDK

    console.log('[DingTalk] Stream 模式：使用消息轮询（生产环境建议用官方 SDK）');

    // 轮询消息
    this._startPolling();
  }

  private async _startPolling(): Promise<void> {
    // Stream 模式下的简化实现：定时检查新消息
    // 实际生产中应该用钉钉的 Stream SDK 建立 WebSocket 长连接
    const poll = async () => {
      if (!this.connected) return;

      try {
        // 钉钉 Stream 模式通常需要官方 SDK
        // 这里提供接口框架，实际消息接收依赖 SDK 回调
      } catch (err) {
        console.warn('[DingTalk] 轮询错误:', (err as Error).message);
      }
    };

    // 每 5 秒检查一次（仅作为 fallback）
    setInterval(poll, 5000);
  }

  /**
   * 供外部 SDK 回调调用的方法
   * 当使用钉钉官方 SDK 时，通过此方法注入消息
   */
  handleStreamMessage(data: {
    text: { content: string };
    senderStaffId: string;
    conversationId: string;
    conversationType: string;
    msgId: string;
  }): void {
    this.lastConversationId = data.conversationId;
    this.lastSenderStaffId = data.senderStaffId;

    this.messageCallback?.({
      role: 'user',
      content: data.text.content.trim(),
      timestamp: Date.now(),
      metadata: {
        conversationId: data.conversationId,
        senderStaffId: data.senderStaffId,
        conversationType: data.conversationType,
        msgId: data.msgId,
      },
    });
  }

  // ==================== Webhook 模式 ====================

  private async _startWebhook(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as any;

        if (body.text?.content && body.conversationId) {
          this.lastConversationId = body.conversationId;
          this.lastSenderStaffId = body.senderStaffId;

          this.messageCallback?.({
            role: 'user',
            content: body.text.content.trim(),
            timestamp: Date.now(),
            metadata: {
              conversationId: body.conversationId,
              senderStaffId: body.senderStaffId,
              conversationType: body.conversationType,
              msgId: body.msgId,
            },
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400);
        res.end('invalid json');
      }
    });

    this.server.listen(this.webhookPort);
  }
}
