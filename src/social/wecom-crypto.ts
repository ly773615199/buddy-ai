/**
 * 企业微信加解密模块
 *
 * 企微消息是 AES-256-CBC 加密的
 * 参考：https://developer.work.weixin.qq.com/document/path/90968
 */

import * as crypto from 'crypto';

export class WeComCrypto {
  private aesKey: Buffer;
  private token: string;
  private corpId: string;

  constructor(token: string, encodingAESKey: string, corpId: string) {
    this.token = token;
    this.corpId = corpId;
    // EncodingAESKey 是 Base64 编码的 43 字符，解码后 32 字节
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  }

  /**
   * 验证签名
   */
  verify(timestamp: string, nonce: string, encrypt: string, signature: string): boolean {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    const str = arr.join('');
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    return hash === signature;
  }

  /**
   * 解密消息
   */
  decrypt(encrypt: string): string {
    const encrypted = Buffer.from(encrypt, 'base64');
    const iv = this.aesKey.subarray(0, 16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, iv);

    let decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    // 前 16 字节随机数 + 4 字节消息长度
    const msgLen = decrypted.readUInt32BE(16);
    // 接下来 msgLen 字节 = 明文
    const msg = decrypted.subarray(20, 20 + msgLen).toString('utf-8');

    return msg;
  }

  /**
   * 加密消息
   */
  encrypt(reply: string): string {
    const msgBuf = Buffer.from(reply, 'utf-8');
    const msgLen = Buffer.alloc(4);
    msgLen.writeUInt32BE(msgBuf.length, 0);

    // 随机 16 字节
    const random = crypto.randomBytes(16);

    // 明文 = random + msgLen + msg + corpId
    const corpIdBuf = Buffer.from(this.corpId, 'utf-8');
    const plaintext = Buffer.concat([random, msgLen, msgBuf, corpIdBuf]);

    const iv = this.aesKey.subarray(0, 16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    return encrypted.toString('base64');
  }

  /**
   * 生成回复签名
   */
  generateSignature(timestamp: string, nonce: string, encrypt: string): string {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    const str = arr.join('');
    return crypto.createHash('sha1').update(str).digest('hex');
  }
}
