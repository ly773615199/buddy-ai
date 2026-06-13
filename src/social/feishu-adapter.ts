/**
 * 飞书适配器 — 实现 PlatformAdapter 接口
 *
 * 通过飞书开放平台 API 收发消息
 * 依赖：无（原生 fetch）
 */

import type {
  PlatformAdapter, PlatformCapabilities, PlatformMessage, SendOptions,
} from './platform.js';

// ==================== 类型 ====================

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  webhookPort?: number;     // 默认 9876
}

interface FeishuEvent {
  schema?: string;
  header?: {
    event_type: string;
    token: string;
  };
  event?: {
    message?: {
      chat_id: string;
      message_id: string;
      content: string;
      message_type: string;
      chat_type: string;
    };
    sender?: {
      sender_id?: { user_id?: string; open_id?: string };
      sender_type: string;
    };
  };
  challenge?: string;
  type?: string;
}

// ==================== FeishuAdapter ====================

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
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

  private appId: string;
  private appSecret: string;
  private webhookPort: number;
  private token = '';
  private tokenExpireAt = 0;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private lastChatId: string | null = null;
  private server: any = null;

  constructor(config: FeishuConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.webhookPort = config.webhookPort ?? 9876;
  }

  // ==================== 生命周期 ====================

  async connect(): Promise<void> {
    await this._refreshToken();
    await this._startWebhook();
    this.connected = true;
    console.log(`[Feishu] 已连接，webhook 端口 ${this.webhookPort}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  isConnected(): boolean {
    return this.connected && Date.now() < this.tokenExpireAt;
  }

  // ==================== 发送消息 ====================

  async send(message: string, options?: SendOptions): Promise<void> {
    if (!this.connected) return;

    await this._ensureToken();

    const chatId = options?.replyTo ?? this.lastChatId;
    if (!chatId) return;

    const msgType = 'text';
    const content = JSON.stringify({ text: message });

    if (options?.replyTo) {
      // 回复特定消息
      await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${options.replyTo}/reply`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ msg_type: msgType, content }),
        },
      );
    } else {
      // 新消息
      await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: msgType,
            content,
          }),
        },
      );
    }
  }

  // ==================== 接收消息 ====================

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  // ==================== Token 管理 ====================

  private async _refreshToken(): Promise<void> {
    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const data = await res.json() as any;
    if (data.code !== 0) {
      throw new Error(`飞书 token 获取失败: ${data.msg}`);
    }

    this.token = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + (data.expire - 300) * 1000; // 提前 5 分钟刷新
  }

  private async _ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpireAt) {
      await this._refreshToken();
    }
  }

  // ==================== Webhook 服务 ====================

  private async _startWebhook(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      // 读取 body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as FeishuEvent;

      // Challenge 验证
      if (body.type === 'url_verification' && body.challenge) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: body.challenge }));
        return;
      }

      // 事件处理
      if (body.header?.event_type === 'im.message.receive_v1' && body.event?.message) {
        const msg = body.event.message;
        const sender = body.event.sender;

        // 忽略机器人消息
        if (sender?.sender_type === 'app') {
          res.writeHead(200);
          res.end();
          return;
        }

        let textContent = '';
        try {
          const parsed = JSON.parse(msg.content);
          textContent = parsed.text ?? '';
        } catch {
          textContent = msg.content;
        }

        this.lastChatId = msg.chat_id;

        this.messageCallback?.({
          role: 'user',
          content: textContent,
          timestamp: Date.now(),
          metadata: {
            chatId: msg.chat_id,
            messageId: msg.message_id,
            chatType: msg.chat_type,
            senderId: sender?.sender_id?.user_id ?? sender?.sender_id?.open_id,
          },
        });
      }

      res.writeHead(200);
      res.end();
    });

    this.server.listen(this.webhookPort);
  }
}
