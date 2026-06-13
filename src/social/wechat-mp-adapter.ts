/**
 * 微信公众号适配器 — 实现 PlatformAdapter 接口
 *
 * 被动回复（5秒内响应）+ 客服消息主动推送
 * 依赖：无（原生 fetch + crypto）
 */

import type {
  PlatformAdapter, PlatformCapabilities, PlatformMessage, SendOptions,
} from './platform.js';
import * as crypto from 'crypto';

// ==================== 类型 ====================

export interface WeChatMPConfig {
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey: string;
  webhookPort?: number;     // 默认 9878
}

// ==================== WeChatMPAdapter ====================

export class WeChatMPAdapter implements PlatformAdapter {
  readonly platform = 'wechat_mp' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: false,
    richContent: false,
    reactions: false,
    buttons: false,
    files: false,
    voice: true,
    images: true,
    threads: false,
  };

  private appId: string;
  private appSecret: string;
  private token: string;
  private encodingAESKey: string;
  private webhookPort: number;
  private accessToken = '';
  private accessTokenExpireAt = 0;
  private connected = false;
  private messageCallback: ((msg: PlatformMessage) => void) | null = null;
  private lastOpenId: string | null = null;
  // 用户最后交互时间（48 小时窗口）
  private userLastInteraction = new Map<string, number>();
  // 待回复队列（被动回复超时后用客服消息补发）
  private pendingReplies = new Map<string, { reply: string; timestamp: number }>();
  private server: any = null;

  constructor(config: WeChatMPConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.token = config.token;
    this.encodingAESKey = config.encodingAESKey;
    this.webhookPort = config.webhookPort ?? 9878;
  }

  // ==================== 生命周期 ====================

  async connect(): Promise<void> {
    await this._refreshToken();
    await this._startWebhook();
    this.connected = true;
    console.log(`[WeChatMP] 已连接，webhook 端口 ${this.webhookPort}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
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

    const openId = options?.replyTo ?? this.lastOpenId;
    if (!openId) return;

    // 检查 48 小时窗口
    const lastInteraction = this.userLastInteraction.get(openId) ?? 0;
    const hoursSinceInteraction = (Date.now() - lastInteraction) / (1000 * 60 * 60);

    if (hoursSinceInteraction > 48) {
      console.warn(`[WeChatMP] 用户 ${openId} 超过 48 小时无交互，无法发送客服消息`);
      return;
    }

    // 客服消息
    await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openId,
          msgtype: 'text',
          text: { content: message },
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
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`,
    );
    const data = await res.json() as any;

    if (data.errcode) {
      throw new Error(`公众号 token 获取失败: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.accessTokenExpireAt = Date.now() + (data.expires_in - 300) * 1000;
  }

  private async _ensureToken(): Promise<void> {
    if (Date.now() >= this.accessTokenExpireAt) {
      await this._refreshToken();
    }
  }

  // ==================== Webhook 服务 ====================

  private async _startWebhook(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.webhookPort}`);

      // GET = 验证请求
      if (req.method === 'GET') {
        const signature = url.searchParams.get('signature') ?? '';
        const timestamp = url.searchParams.get('timestamp') ?? '';
        const nonce = url.searchParams.get('nonce') ?? '';
        const echostr = url.searchParams.get('echostr') ?? '';

        if (this._verifySignature(signature, timestamp, nonce)) {
          res.writeHead(200);
          res.end(echostr);
        } else {
          res.writeHead(403);
          res.end();
        }
        return;
      }

      // POST = 消息推送
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString();

        // 解密（如果加密）
        let xml = rawBody;
        if (rawBody.includes('<Encrypt>')) {
          const encrypt = this._xmlValue(rawBody, 'Encrypt') ?? '';
          xml = this._decrypt(encrypt);
        }

        // 解析消息
        const msgType = this._xmlValue(xml, 'MsgType');
        const fromUser = this._xmlValue(xml, 'FromUserName');
        const content = this._xmlValue(xml, 'Content');
        const msgId = this._xmlValue(xml, 'MsgId');

        if (fromUser) {
          this.lastOpenId = fromUser;
          this.userLastInteraction.set(fromUser, Date.now());
        }

        if (msgType === 'text' && content && fromUser) {
          // 设置 5 秒超时回复
          const replyPromise = new Promise<string>((resolve) => {
            this.pendingReplies.set(fromUser, { reply: '', timestamp: Date.now() });

            this.messageCallback?.({
              role: 'user',
              content,
              timestamp: Date.now(),
              metadata: {
                openId: fromUser,
                msgId,
                resolveReply: resolve,
              },
            });
          });

          // 等待最多 5 秒
          try {
            const reply = await Promise.race([
              replyPromise,
              new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
            ]);

            // 5 秒内回复成功 → 被动回复
            const replyXml = this._buildReplyXml(fromUser, this.appId, reply);
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(replyXml);
          } catch {
            // 超时 → 返回空响应（之后用客服消息补发）
            res.writeHead(200);
            res.end('success');
          }
          return;
        }

        res.writeHead(200);
        res.end('success');
        return;
      }

      res.writeHead(405);
      res.end();
    });

    this.server.listen(this.webhookPort);
  }

  // ==================== 工具方法 ====================

  private _verifySignature(signature: string, timestamp: string, nonce: string): boolean {
    const arr = [this.token, timestamp, nonce].sort();
    const str = arr.join('');
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    return hash === signature;
  }

  private _decrypt(encrypt: string): string {
    const aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const encrypted = Buffer.from(encrypt, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    // PKCS7 去 padding
    const pad = decrypted[decrypted.length - 1];
    if (pad >= 1 && pad <= 32) {
      decrypted = decrypted.subarray(0, decrypted.length - pad);
    }

    // 前 16 字节随机 + 4 字节长度 + 内容 + AppId
    const msgLen = decrypted.readUInt32BE(16);
    return decrypted.subarray(20, 20 + msgLen).toString('utf-8');
  }

  private _buildReplyXml(toUser: string, fromUser: string, content: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${timestamp}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
  }

  private _xmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`);
    const match = xml.match(regex);
    return match ? (match[1] ?? match[2]) : null;
  }
}
