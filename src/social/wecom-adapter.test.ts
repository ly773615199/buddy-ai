/**
 * 企业微信适配器 + 加解密测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WeComAdapter } from './wecom-adapter.js';
import { WeComCrypto } from './wecom-crypto.js';
import * as crypto from 'crypto';

describe('WeComCrypto', () => {
  // 生成一个有效的 43 字符 EncodingAESKey
  const encodingAESKey = crypto.randomBytes(32).toString('base64').replace(/=/g, '').substring(0, 43);
  const token = 'test_token_123';
  const corpId = 'wx1234567890';
  const crypto1 = new WeComCrypto(token, encodingAESKey, corpId);

  it('构造函数不报错', () => {
    expect(crypto1).toBeDefined();
  });

  it('加密然后解密还原', () => {
    const plaintext = '你好世界 Hello World 12345';
    const encrypted = crypto1.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = crypto1.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('解密随机内容不崩溃', () => {
    // 不同密钥解密应该失败或返回乱码，但不应崩溃
    const crypto2 = new WeComCrypto(token, crypto.randomBytes(32).toString('base64').replace(/=/g, '').substring(0, 43), corpId);
    const encrypted = crypto1.encrypt('test');

    try {
      crypto2.decrypt(encrypted);
    } catch {
      // 预期可能抛错
    }
  });

  it('签名验证正确', () => {
    const timestamp = '1234567890';
    const nonce = 'nonce123';
    const encrypted = crypto1.encrypt('test');

    const signature = crypto1.generateSignature(timestamp, nonce, encrypted);
    expect(crypto1.verify(timestamp, nonce, encrypted, signature)).toBe(true);
  });

  it('签名验证失败（篡改）', () => {
    const timestamp = '1234567890';
    const nonce = 'nonce123';
    const encrypted = crypto1.encrypt('test');

    const signature = crypto1.generateSignature(timestamp, nonce, encrypted);
    expect(crypto1.verify(timestamp, nonce, encrypted, 'tampered')).toBe(false);
  });

  it('空字符串加解密', () => {
    const encrypted = crypto1.encrypt('');
    const decrypted = crypto1.decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('中文加解密', () => {
    const text = '你好世界！这是一段中文消息。';
    const encrypted = crypto1.encrypt(text);
    const decrypted = crypto1.decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('长消息加解密', () => {
    const text = 'x'.repeat(10000);
    const encrypted = crypto1.encrypt(text);
    const decrypted = crypto1.decrypt(encrypted);
    expect(decrypted).toBe(text);
  });
});

describe('WeComAdapter', () => {
  const config = {
    corpId: 'wx1234567890',
    agentId: 1000002,
    secret: 'test_secret',
    token: 'test_token',
    encodingAESKey: crypto.randomBytes(32).toString('base64').replace(/=/g, '').substring(0, 43),
  };

  it('platform 类型正确', () => {
    const adapter = new WeComAdapter(config);
    expect(adapter.platform).toBe('wecom');
  });

  it('capabilities 包含预期能力', () => {
    const adapter = new WeComAdapter(config);
    expect(adapter.capabilities.markdown).toBe(false);
    expect(adapter.capabilities.richContent).toBe(true);
    expect(adapter.capabilities.reactions).toBe(false);
    expect(adapter.capabilities.buttons).toBe(true);
    expect(adapter.capabilities.voice).toBe(true);
    expect(adapter.capabilities.images).toBe(true);
    expect(adapter.capabilities.threads).toBe(false);
  });

  it('初始状态未连接', () => {
    const adapter = new WeComAdapter(config);
    expect(adapter.isConnected()).toBe(false);
  });

  it('disconnect 不报错', async () => {
    const adapter = new WeComAdapter(config);
    await adapter.disconnect();
  });

  it('onMessage 注册回调', () => {
    const adapter = new WeComAdapter(config);
    adapter.onMessage(vi.fn());
  });

  it('未连接时不发送消息', async () => {
    const adapter = new WeComAdapter(config);
    await adapter.send('test');
  });
});
