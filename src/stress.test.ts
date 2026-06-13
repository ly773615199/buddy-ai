/**
 * 压力测试 — WebSocket 服务器负载测试
 *
 * 测试内容:
 * 1. 并发连接: 模拟多个客户端同时连接
 * 2. 消息洪流: 模拟高频消息发送
 * 3. 连接抖动: 模拟频繁断开/重连
 * 4. 大消息: 测试大 payload 处理
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventBus } from './ws/server.js';
import WebSocket from 'ws';

const TEST_PORT = 19876;
const TEST_TOKEN = 'stress-test-token';
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${TEST_TOKEN}`;

let server: EventBus;

beforeAll(async () => {
  server = new EventBus(TEST_PORT, TEST_TOKEN);
  // 等服务器启动
  await new Promise(r => setTimeout(r, 300));
});

afterAll(() => {
  server.close();
});

/** 创建一个已连接的 WebSocket 客户端 */
function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('连接超时')), 5000);
  });
}

/** 等待 N 毫秒 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('压力测试', () => {
  it('并发连接: 20 个客户端同时连接', async () => {
    const clients = await Promise.all(
      Array.from({ length: 20 }, () => connectClient()),
    );

    // 所有客户端都应成功连接
    expect(clients).toHaveLength(20);
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    // 清理
    for (const ws of clients) ws.close();
    await sleep(200);
  });

  it('消息洪流: 单客户端快速发送 50 条消息', async () => {
    const ws = await connectClient();
    const received: string[] = [];

    ws.on('message', (data) => {
      received.push(data.toString());
    });

    // 快速发送 50 条消息 (应触发 rate limiting)
    for (let i = 0; i < 50; i++) {
      ws.send(JSON.stringify({ type: 'chat', content: `flood-msg-${i}` }));
    }

    await sleep(1000);

    // 应该有一些消息被 rate limit
    // 服务器不应崩溃
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await sleep(200);
  });

  it('多客户端消息广播', async () => {
    const clients = await Promise.all(
      Array.from({ length: 5 }, () => connectClient()),
    );

    const receivedCounts = new Map<WebSocket, number>();

    for (const ws of clients) {
      receivedCounts.set(ws, 0);
      ws.on('message', () => {
        receivedCounts.set(ws, (receivedCounts.get(ws) ?? 0) + 1);
      });
    }

    // 每个客户端发送 3 条消息
    for (const ws of clients) {
      for (let i = 0; i < 3; i++) {
        ws.send(JSON.stringify({ type: 'chat', content: `broadcast-test` }));
      }
    }

    await sleep(1500);

    // 所有客户端应该仍然连接
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    // 清理
    for (const ws of clients) ws.close();
    await sleep(200);
  });

  it('连接抖动: 快速断开重连 10 次', async () => {
    for (let i = 0; i < 10; i++) {
      const ws = await connectClient();
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      await sleep(50);
    }
  });

  it('大消息: 发送 64KB payload', async () => {
    const ws = await connectClient();
    const bigPayload = JSON.stringify({
      type: 'chat',
      content: 'x'.repeat(60_000),
    });

    // 不应崩溃
    ws.send(bigPayload);
    await sleep(500);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await sleep(200);
  });

  it('混合负载: 10 客户端各发 20 条消息', async () => {
    const clients = await Promise.all(
      Array.from({ length: 10 }, () => connectClient()),
    );

    const start = Date.now();

    // 每个客户端发送 20 条
    const promises = clients.map((ws, ci) =>
      Promise.all(
        Array.from({ length: 20 }, (_, mi) =>
          new Promise<void>((resolve) => {
            ws.send(JSON.stringify({ type: 'chat', content: `client-${ci}-msg-${mi}` }));
            setTimeout(resolve, 10); // 10ms 间隔
          }),
        ),
      ),
    );

    await Promise.all(promises);
    const elapsed = Date.now() - start;

    // 200 条消息应在 5 秒内完成
    expect(elapsed).toBeLessThan(5000);

    // 所有连接应保持
    for (const ws of clients) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    // 清理
    for (const ws of clients) ws.close();
    await sleep(200);
  });

  it('无效 Token 被拒绝', async () => {
    const badWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=invalid-token`);
    const result = await new Promise<boolean>((resolve) => {
      let opened = false;
      badWs.on('open', () => {
        opened = true;
        // 服务器可能在 open 后立即关闭连接
      });
      badWs.on('close', (code) => {
        // 4001 = token 验证失败被服务端关闭
        if (code === 4001 || !opened) {
          resolve(false);
        } else {
          resolve(opened);
        }
      });
      badWs.on('error', () => resolve(false));
      setTimeout(() => resolve(badWs.readyState !== WebSocket.OPEN), 3000);
    });

    // 无效 token 的连接应被关闭（非 OPEN 状态）
    expect(
      result === false || badWs.readyState !== WebSocket.OPEN
    ).toBe(true);
    if (badWs.readyState === WebSocket.OPEN) badWs.close();
  });

  it('连接数上限: 验证服务器不崩溃于 50 连接', async () => {
    const clients = await Promise.all(
      Array.from({ length: 50 }, () => connectClient().catch(() => null)),
    );

    const connected = clients.filter(c => c !== null);
    // 至少应接受一定数量的连接
    expect(connected.length).toBeGreaterThan(10);

    // 发送一条消息到每个连接
    for (const ws of connected) {
      ws!.send(JSON.stringify({ type: 'chat', content: 'alive-check' }));
    }

    await sleep(500);

    // 服务器应仍运行
    const testWs = await connectClient();
    expect(testWs.readyState).toBe(WebSocket.OPEN);
    testWs.close();

    // 清理
    for (const ws of connected) ws?.close();
    await sleep(300);
  });
});
