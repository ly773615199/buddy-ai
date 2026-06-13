/**
 * 微信公众号适配器测试
 */

import { describe, it, expect, vi } from 'vitest';
import { WeChatMPAdapter } from './wechat-mp-adapter.js';
import * as crypto from 'crypto';

describe('WeChatMPAdapter', () => {
  const config = {
    appId: 'wx1234567890',
    appSecret: 'test_secret',
    token: 'test_token',
    encodingAESKey: crypto.randomBytes(32).toString('base64').replace(/=/g, '').substring(0, 43),
  };

  it('platform 类型正确', () => {
    const adapter = new WeChatMPAdapter(config);
    expect(adapter.platform).toBe('wechat_mp');
  });

  it('capabilities 包含预期能力', () => {
    const adapter = new WeChatMPAdapter(config);
    expect(adapter.capabilities.markdown).toBe(false);
    expect(adapter.capabilities.richContent).toBe(false);
    expect(adapter.capabilities.reactions).toBe(false);
    expect(adapter.capabilities.buttons).toBe(false);
    expect(adapter.capabilities.files).toBe(false);
    expect(adapter.capabilities.voice).toBe(true);
    expect(adapter.capabilities.images).toBe(true);
    expect(adapter.capabilities.threads).toBe(false);
  });

  it('初始状态未连接', () => {
    const adapter = new WeChatMPAdapter(config);
    expect(adapter.isConnected()).toBe(false);
  });

  it('disconnect 不报错', async () => {
    const adapter = new WeChatMPAdapter(config);
    await adapter.disconnect();
  });

  it('onMessage 注册回调', () => {
    const adapter = new WeChatMPAdapter(config);
    adapter.onMessage(vi.fn());
  });

  it('未连接时不发送消息', async () => {
    const adapter = new WeChatMPAdapter(config);
    await adapter.send('test');
  });
});
