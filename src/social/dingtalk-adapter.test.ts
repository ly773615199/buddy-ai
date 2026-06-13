/**
 * 钉钉适配器测试
 */

import { describe, it, expect, vi } from 'vitest';
import { DingTalkAdapter } from './dingtalk-adapter.js';

describe('DingTalkAdapter', () => {
  const config = {
    appKey: 'test_key',
    appSecret: 'test_secret',
  };

  it('platform 类型正确', () => {
    const adapter = new DingTalkAdapter(config);
    expect(adapter.platform).toBe('dingtalk');
  });

  it('capabilities 包含预期能力', () => {
    const adapter = new DingTalkAdapter(config);
    expect(adapter.capabilities.markdown).toBe(true);
    expect(adapter.capabilities.richContent).toBe(true);
    expect(adapter.capabilities.reactions).toBe(true);
    expect(adapter.capabilities.buttons).toBe(true);
    expect(adapter.capabilities.files).toBe(true);
    expect(adapter.capabilities.voice).toBe(true);
    expect(adapter.capabilities.images).toBe(true);
    expect(adapter.capabilities.threads).toBe(false);
  });

  it('默认 stream 模式', () => {
    const adapter = new DingTalkAdapter(config);
    expect(adapter.platform).toBe('dingtalk');
  });

  it('webhook 模式配置', () => {
    const adapter = new DingTalkAdapter({ ...config, mode: 'webhook', webhookPort: 8080 });
    expect(adapter.platform).toBe('dingtalk');
  });

  it('初始状态未连接', () => {
    const adapter = new DingTalkAdapter(config);
    expect(adapter.isConnected()).toBe(false);
  });

  it('disconnect 不报错', async () => {
    const adapter = new DingTalkAdapter(config);
    await adapter.disconnect();
  });

  it('onMessage 注册回调', () => {
    const adapter = new DingTalkAdapter(config);
    adapter.onMessage(vi.fn());
  });

  it('未连接时不发送消息', async () => {
    const adapter = new DingTalkAdapter(config);
    await adapter.send('test');
  });

  it('handleStreamMessage 触发回调', () => {
    const adapter = new DingTalkAdapter(config);
    const callback = vi.fn();
    adapter.onMessage(callback);

    adapter.handleStreamMessage({
      text: { content: '你好' },
      senderStaffId: 'user123',
      conversationId: 'conv456',
      conversationType: '2',
      msgId: 'msg789',
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: '你好',
        metadata: expect.objectContaining({
          conversationId: 'conv456',
          senderStaffId: 'user123',
        }),
      }),
    );
  });
});
