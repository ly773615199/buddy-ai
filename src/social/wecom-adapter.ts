/**
 * 企业微信适配器 — 实现 PlatformAdapter 接口
 *
 * 通过企微 API 收发消息，消息加解密用 WeComCrypto
 * 依赖：无（原生 fetch + crypto）
 */

import type {
  PlatformAdapter, PlatformCapabilities, PlatformMessage, SendOptions,
} from './platform.js';
import { WeComCrypto } from './wecom-crypto.js';

// ==================== 类型 ====================

export interface WeComConfig {
  corpId: string;
  agentId: number;
  secret: string;
  token: string;
  encodingAESKey: string;
  webhookPort?: number;     // 默认 9877
}

// ==================== WeComAdapter ====================

export class WeComAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: false,
    richContent: true,
    reactions: false,
    buttons: true,
    files: true,
    voice: true,
    images: true,
    threads: false,
  };

  private corpId: string;
  private agentId: number;
  private secret: string;
  private webhookPort: number;
  private crypto: WeComCrypto;
  private accessToken = '';
  private accessTokenExpireAt = 0;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private lastUserId: string | null = null;
  private server: any = null;

  constructor(config: WeComConfig) {
    this.corpId = config.corpId;
    this.agentId = config.agentId;
    this.secret = config.secret;
    this.webhookPort = config.webhookPort ?? 9877;
    this.crypto = new WeComCrypto(config.token, config.encodingAESKey, config.corpId);
  }

  // ==================== 生命周期 ====================

  async connect(): Promise<void> {
    await this._refreshToken();
    await this._startCallback();
    this.connected = true;
    console.log(`[WeCom] 已连接，回调端口 ${this.webhookPort}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  isConnected(): boolean {
    return this.connected && Date.now() < this.accessTokenExpireAt;
  }

  // ==================== 发送消息 ====================

  async send(message: string, options?: SendOptions): Promise<void> {
    if (!this.connected) return;

    await this._ensureToken();

    const toUser = options?.replyTo ?? this.lastUserId;
    if (!toUser) return;

    await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: toUser,
          msgtype: 'text',
          agentid: this.agentId,
          text: { content: message },
        }),
      },
    );
  }

  // ==================== 接收消息 ====================

  onMessage(callback: (msg: PlatformMessage) => void): void {
    this.messageCallback = callback;
  }

  // ==================== Token 管理 ====================

  private async _refreshToken(): Promise<void> {
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.secret}`,
    );
    const data = await res.json() as any;

    if (data.errcode !== 0) {
      throw new Error(`企微 token 获取失败: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.accessTokenExpireAt = Date.now() + (data.expires_in - 300) * 1000;
  }

  private async _ensureToken(): Promise<void> {
    if (Date.now() >= this.accessTokenExpireAt) {
      await this._refreshToken();
    }
  }

  // ==================== 回调服务 ====================

  private async _startCallback(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.webhookPort}`);
      const timestamp = url.searchParams.get('timestamp') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      const msgSignature = url.searchParams.get('msg_signature') ?? '';

      // GET 请求 = 首次验证
      if (req.method === 'GET') {
        const echostr = url.searchParams.get('echostr') ?? '';
        if (this.crypto.verify(timestamp, nonce, echostr, msgSignature)) {
          // 解密 echostr 并返回明文
          const decrypted = this.crypto.decrypt(echostr);
          res.writeHead(200);
          res.end(decrypted);
        } else {
          res.writeHead(403);
          res.end('signature mismatch');
        }
        return;
      }

      // POST 请求 = 消息推送
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString()) as any;
        const encrypt = body.Encrypt;

        if (!encrypt || !this.crypto.verify(timestamp, nonce, encrypt, msgSignature)) {
          res.writeHead(403);
          res.end();
          return;
        }

        // 解密
        const xml = this.crypto.decrypt(encrypt);

        // 简单解析 XML（不用 xml 库）
        const content = this._xmlValue(xml, 'Content');
        const fromUser = this._xmlValue(xml, 'FromUserName');
        const msgType = this._xmlValue(xml, 'MsgType');
        const msgId = this._xmlValue(xml, 'MsgId');

        if (msgType === 'text' && content && fromUser) {
          this.lastUserId = fromUser;

          this.messageCallback?.({
            role: 'user',
            content,
            timestamp: Date.now(),
            metadata: {
              userId: fromUser,
              msgId,
              msgType,
            },
          });
        }

        // 返回 "success"（企微要求）
        res.writeHead(200);
        res.end('success');
        return;
      }

      res.writeHead(405);
      res.end();
    });

    this.server.listen(this.webhookPort);
  }

  /** 简单的 XML 标签值提取 */
  private _xmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`);
    const match = xml.match(regex);
    return match ? (match[1] ?? match[2]) : null;
  }
}
