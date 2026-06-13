/**
 * 多平台适配器测试
 * Phase 6: Telegram / Discord / PlatformManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlatformManager, CLIAdapter, TelegramAdapter, DiscordAdapter } from './social/platform.js';
import type { PlatformAdapter, PlatformMessage } from './social/platform.js';

describe('PlatformManager', () => {
  let manager: PlatformManager;

  beforeEach(() => {
    manager = new PlatformManager();
  });

  it('注册和列出平台', () => {
    manager.register(new CLIAdapter());
    expect(manager.list()).toContain('cli');
  });

  it('重复注册覆盖旧适配器', () => {
    manager.register(new CLIAdapter());
    manager.register(new CLIAdapter());
    expect(manager.list().filter(p => p === 'cli')).toHaveLength(1);
  });

  it('获取未注册平台返回 null', () => {
    expect(manager.getCapabilities('telegram')).toBeNull();
  });

  it('CLI 平台能力正确', () => {
    manager.register(new CLIAdapter());
    const caps = manager.getCapabilities('cli');
    expect(caps).not.toBeNull();
    expect(caps!.markdown).toBe(true);
    expect(caps!.richContent).toBe(false);
    expect(caps!.buttons).toBe(false);
    expect(caps!.files).toBe(true);
  });

  it('getActive 初始为 null', () => {
    expect(manager.getActive()).toBeNull();
  });

  it('激活未注册平台抛错', async () => {
    await expect(manager.activate('telegram')).rejects.toThrow('未注册');
  });

  it('disconnectAll 不抛错', async () => {
    manager.register(new CLIAdapter());
    await expect(manager.disconnectAll()).resolves.toBeUndefined();
  });
});

describe('CLIAdapter', () => {
  it('初始状态未连接', () => {
    const adapter = new CLIAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('平台类型为 cli', () => {
    const adapter = new CLIAdapter();
    expect(adapter.platform).toBe('cli');
  });

  it('能力定义完整', () => {
    const adapter = new CLIAdapter();
    expect(adapter.capabilities).toEqual({
      markdown: true,
      richContent: false,
      reactions: false,
      buttons: false,
      files: true,
      voice: false,
      images: false,
      threads: false,
    });
  });
});

describe('TelegramAdapter', () => {
  it('平台类型为 telegram', () => {
    const adapter = new TelegramAdapter('fake-token');
    expect(adapter.platform).toBe('telegram');
  });

  it('初始状态未连接', () => {
    const adapter = new TelegramAdapter('fake-token');
    expect(adapter.isConnected()).toBe(false);
  });

  it('能力定义完整', () => {
    const adapter = new TelegramAdapter('fake-token');
    expect(adapter.capabilities).toEqual({
      markdown: true,
      richContent: true,
      reactions: true,
      buttons: true,
      files: true,
      voice: true,
      images: true,
      threads: false,
    });
  });

  it('disconnect 设置连接状态', async () => {
    const adapter = new TelegramAdapter('fake-token');
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it('send 未连接时不抛错', async () => {
    const adapter = new TelegramAdapter('fake-token');
    await expect(adapter.send('test')).resolves.toBeUndefined();
  });

  it('onMessage 注册回调', () => {
    const adapter = new TelegramAdapter('fake-token');
    const callback = vi.fn();
    adapter.onMessage(callback);
    // 回调已注册，不会抛错
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('DiscordAdapter', () => {
  it('平台类型为 discord', () => {
    const adapter = new DiscordAdapter('fake-token');
    expect(adapter.platform).toBe('discord');
  });

  it('初始状态未连接', () => {
    const adapter = new DiscordAdapter('fake-token');
    expect(adapter.isConnected()).toBe(false);
  });

  it('能力定义完整', () => {
    const adapter = new DiscordAdapter('fake-token');
    expect(adapter.capabilities).toEqual({
      markdown: true,
      richContent: true,
      reactions: true,
      buttons: true,
      files: true,
      voice: false,
      images: true,
      threads: true,
    });
  });

  it('disconnect 不抛错', async () => {
    const adapter = new DiscordAdapter('fake-token');
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it('send 未连接时不抛错', async () => {
    const adapter = new DiscordAdapter('fake-token');
    await expect(adapter.send('test')).resolves.toBeUndefined();
  });

  it('onMessage 注册回调', () => {
    const adapter = new DiscordAdapter('fake-token');
    const callback = vi.fn();
    adapter.onMessage(callback);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('平台适配器互操作', () => {
  it('多个适配器可注册到同一 Manager', () => {
    const manager = new PlatformManager();
    manager.register(new CLIAdapter());
    manager.register(new TelegramAdapter('fake'));
    manager.register(new DiscordAdapter('fake'));

    const platforms = manager.list();
    expect(platforms).toContain('cli');
    expect(platforms).toContain('telegram');
    expect(platforms).toContain('discord');
  });

  it('各平台能力互不干扰', () => {
    const manager = new PlatformManager();
    manager.register(new CLIAdapter());
    manager.register(new DiscordAdapter('fake'));

    const cliCaps = manager.getCapabilities('cli');
    const dcCaps = manager.getCapabilities('discord');

    expect(cliCaps!.threads).toBe(false);
    expect(dcCaps!.threads).toBe(true);
    expect(cliCaps!.voice).toBe(false);
    expect(dcCaps!.voice).toBe(false);
  });
});
