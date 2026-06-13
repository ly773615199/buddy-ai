/**
 * 飞书适配器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeishuAdapter } from './feishu-adapter.js';

describe('FeishuAdapter', () => {
  it('platform 类型正确', () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    expect(adapter.platform).toBe('feishu');
  });

  it('capabilities 包含预期能力', () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    expect(adapter.capabilities.markdown).toBe(true);
    expect(adapter.capabilities.richContent).toBe(true);
    expect(adapter.capabilities.reactions).toBe(true);
    expect(adapter.capabilities.buttons).toBe(true);
    expect(adapter.capabilities.files).toBe(true);
    expect(adapter.capabilities.voice).toBe(true);
    expect(adapter.capabilities.images).toBe(true);
    expect(adapter.capabilities.threads).toBe(false);
  });

  it('初始状态未连接', () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    expect(adapter.isConnected()).toBe(false);
  });

  it('disconnect 不报错', async () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it('onMessage 注册回调', () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    const callback = vi.fn();
    adapter.onMessage(callback);
    // 不报错即通过
  });

  it('未连接时不发送消息', async () => {
    const adapter = new FeishuAdapter({ appId: 'test', appSecret: 'test' });
    // 不应抛出错误
    await adapter.send('test');
  });
});
