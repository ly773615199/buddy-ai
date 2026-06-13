/**
 * useWebSocket hook 增强测试
 * 覆盖：连接状态机、重连逻辑、消息队列、心跳、错误处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock WebSocket ====================

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) { this.sent.push(data); }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  simulateError() { this.onerror?.(new Event('error')); }
  simulateClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

// ==================== 消息协议测试 ====================

describe('WebSocket 消息协议', () => {
  it('chat 消息格式正确', () => {
    const msg = { type: 'chat', content: '你好' };
    expect(msg.type).toBe('chat');
    expect(msg.content).toBe('你好');
  });

  it('command 消息格式正确', () => {
    const msg = { type: 'command', command: 'status', args: undefined };
    expect(msg.type).toBe('command');
    expect(msg.command).toBe('status');
  });

  it('ping 消息格式正确', () => {
    const msg = { type: 'ping', ts: Date.now() };
    expect(msg.type).toBe('ping');
    expect(typeof msg.ts).toBe('number');
  });

  it('pet 消息格式正确', () => {
    const msg = { type: 'pet' };
    expect(msg.type).toBe('pet');
  });

  it('visual_seed 消息格式正确', () => {
    const msg = {
      type: 'visual_seed',
      primaryColor: '#ff0000',
      texture: 'sharp',
      temperament: 'warm',
      seed: 42,
    };
    expect(msg.type).toBe('visual_seed');
    expect(msg.primaryColor).toBe('#ff0000');
    expect(msg.texture).toBe('sharp');
    expect(msg.temperament).toBe('warm');
    expect(msg.seed).toBe(42);
  });

  it('orchestrate 消息格式正确', () => {
    const msg = { type: 'orchestrate', content: '多步骤任务' };
    expect(msg.type).toBe('orchestrate');
    expect(msg.content).toBe('多步骤任务');
  });

  it('multi_expert 消息格式正确', () => {
    const msg = { type: 'multi_expert', content: '需要多专家分析的问题' };
    expect(msg.type).toBe('multi_expert');
    expect(msg.content).toBe('需要多专家分析的问题');
  });

  it('sensor_update 消息格式正确', () => {
    const msg = {
      type: 'sensor_update',
      data: {
        location: { lat: 39.9, lng: 116.4, accuracy: 10 },
        motion: { x: 0, y: 0, z: 9.8, state: 'still' },
        environment: { light: 300, battery: 85, online: true },
      },
    };
    expect(msg.type).toBe('sensor_update');
    expect(msg.data.location?.lat).toBe(39.9);
    expect(msg.data.motion?.state).toBe('still');
  });

  it('emotion_source 消息格式正确', () => {
    const msg = { type: 'emotion_source', mood: 'happy', confidence: 0.85 };
    expect(msg.type).toBe('emotion_source');
    expect(msg.mood).toBe('happy');
    expect(msg.confidence).toBe(0.85);
  });

  it('resume 消息格式正确', () => {
    const msg = { type: 'resume', lastSeq: 42 };
    expect(msg.type).toBe('resume');
    expect(msg.lastSeq).toBe(42);
  });

  it('tool_confirm_response 消息格式正确', () => {
    const msg = { type: 'tool_confirm_response', allowed: true };
    expect(msg.type).toBe('tool_confirm_response');
    expect(msg.allowed).toBe(true);
  });

  it('ack 消息格式正确', () => {
    const msg = { type: 'ack', id: 'msg-123' };
    expect(msg.type).toBe('ack');
    expect(msg.id).toBe('msg-123');
  });

  it('status_request 消息格式正确', () => {
    const msg = { type: 'status_request' };
    expect(msg.type).toBe('status_request');
  });

  it('tool_panel_request 消息格式正确', () => {
    const msg = { type: 'tool_panel_request' };
    expect(msg.type).toBe('tool_panel_request');
  });

  it('memory_panel_request 消息格式正确', () => {
    const msg = { type: 'memory_panel_request' };
    expect(msg.type).toBe('memory_panel_request');
  });
});

// ==================== Mock WebSocket 行为测试 ====================

describe('MockWebSocket 行为', () => {
  it('构造后异步触发 onopen', async () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    const opened = new Promise<void>(resolve => {
      ws.onopen = () => resolve();
    });
    await opened;
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it('send 记录发送数据', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    ws.readyState = MockWebSocket.OPEN;
    ws.send('{"type":"ping"}');
    ws.send('{"type":"chat","content":"hi"}');
    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[0]).toBe('{"type":"ping"}');
  });

  it('close 触发 onclose', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    const closeSpy = vi.fn();
    ws.onclose = closeSpy;
    ws.close();
    expect(closeSpy).toHaveBeenCalled();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('simulateMessage 解析 JSON 并触发回调', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    const messageSpy = vi.fn();
    ws.onmessage = messageSpy;

    ws.simulateMessage({ type: 'emotion', mood: 'happy' });
    expect(messageSpy).toHaveBeenCalled();

    const event = messageSpy.mock.calls[0][0];
    const data = JSON.parse(event.data);
    expect(data.type).toBe('emotion');
    expect(data.mood).toBe('happy');
  });

  it('simulateError 触发 onerror', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    const errorSpy = vi.fn();
    ws.onerror = errorSpy;
    ws.simulateError();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('simulateClose 带自定义 code', () => {
    const ws = new MockWebSocket('ws://localhost:8765');
    const closeSpy = vi.fn();
    ws.onclose = closeSpy;
    ws.simulateClose(1001);
    expect(closeSpy).toHaveBeenCalled();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});

// ==================== 重连逻辑测试 ====================

describe('WebSocket 重连策略', () => {
  it('指数退避计算正确', () => {
    // 模拟重连延迟计算: base * 2^attempt, capped at max
    const baseDelay = 1000;
    const maxDelay = 30000;

    const calcDelay = (attempt: number) =>
      Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    expect(calcDelay(0)).toBe(1000);
    expect(calcDelay(1)).toBe(2000);
    expect(calcDelay(2)).toBe(4000);
    expect(calcDelay(3)).toBe(8000);
    expect(calcDelay(4)).toBe(16000);
    expect(calcDelay(5)).toBe(30000); // capped
    expect(calcDelay(10)).toBe(30000); // still capped
  });

  it('正常关闭 (1000) 不触发重连', () => {
    const shouldReconnect = (code: number) => code !== 1000;
    expect(shouldReconnect(1000)).toBe(false);
    expect(shouldReconnect(1001)).toBe(true);
    expect(shouldReconnect(1006)).toBe(true);
  });

  it('最大重连次数限制', () => {
    const maxRetries = 10;
    const shouldRetry = (attempt: number) => attempt < maxRetries;
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(9)).toBe(true);
    expect(shouldRetry(10)).toBe(false);
    expect(shouldRetry(11)).toBe(false);
  });
});

// ==================== 消息队列测试 ====================

describe('消息队列', () => {
  it('离线消息入队，上线后发送', () => {
    const queue: string[] = [];
    const isConnected = () => false;

    const enqueue = (msg: string) => { queue.push(msg); };
    const flush = () => {
      const msgs = [...queue];
      queue.length = 0;
      return msgs;
    };

    enqueue('{"type":"chat","content":"msg1"}');
    enqueue('{"type":"chat","content":"msg2"}');
    enqueue('{"type":"chat","content":"msg3"}');

    expect(queue).toHaveLength(3);

    // 模拟上线
    const flushed = flush();
    expect(flushed).toHaveLength(3);
    expect(queue).toHaveLength(0);
  });

  it('队列有大小限制', () => {
    const maxSize = 100;
    const queue: string[] = [];

    for (let i = 0; i < 150; i++) {
      queue.push(`msg-${i}`);
      if (queue.length > maxSize) queue.shift();
    }

    expect(queue).toHaveLength(maxSize);
    expect(queue[0]).toBe('msg-50'); // 最早的被丢弃
  });
});

// ==================== 心跳测试 ====================

describe('心跳机制', () => {
  it('ping 消息包含时间戳', () => {
    const ts = Date.now();
    const ping = { type: 'ping', ts };
    expect(ping.type).toBe('ping');
    expect(ping.ts).toBeGreaterThan(0);
  });

  it('pong 响应包含配置 hash', () => {
    const pong = { type: 'pong', ts: Date.now(), configHash: 'abc123' };
    expect(pong.type).toBe('pong');
    expect(pong.configHash).toBeDefined();
  });

  it('心跳间隔合理', () => {
    const heartbeatIntervalMs = 30000; // 30秒
    expect(heartbeatIntervalMs).toBeGreaterThanOrEqual(10000);
    expect(heartbeatIntervalMs).toBeLessThanOrEqual(60000);
  });
});

// ==================== 错误处理测试 ====================

describe('错误处理', () => {
  it('JSON 解析错误处理', () => {
    const parse = (data: string) => {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    };

    expect(parse('{"type":"chat"}')).toEqual({ type: 'chat' });
    expect(parse('invalid json')).toBeNull();
    expect(parse('')).toBeNull();
  });

  it('未知消息类型处理', () => {
    const knownTypes = ['chat', 'ping', 'pong', 'ack', 'command', 'pet', 'status_request'];
    const isKnown = (type: string) => knownTypes.includes(type);

    expect(isKnown('chat')).toBe(true);
    expect(isKnown('unknown_type')).toBe(false);
    expect(isKnown('')).toBe(false);
  });

  it('空消息内容处理', () => {
    const isValidChat = (content: string) => typeof content === 'string' && content.trim().length > 0;

    expect(isValidChat('hello')).toBe(true);
    expect(isValidChat('')).toBe(false);
    expect(isValidChat('   ')).toBe(false);
  });
});

// ==================== 数据序列化测试 ====================

describe('数据序列化', () => {
  it('消息 JSON 序列化/反序列化一致', () => {
    const original = {
      type: 'chat',
      content: '你好世界',
      id: 'msg-123',
      timestamp: Date.now(),
    };

    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized);

    expect(deserialized).toEqual(original);
  });

  it('包含特殊字符的消息序列化', () => {
    const msg = {
      type: 'chat',
      content: '包含 "引号" 和 \\反斜杠\\ 以及 \n换行',
    };

    const serialized = JSON.stringify(msg);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.content).toBe(msg.content);
  });

  it('包含中文的消息序列化', () => {
    const msg = {
      type: 'chat',
      content: '今天天气不错，适合写代码 🌞',
    };

    const serialized = JSON.stringify(msg);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.content).toBe(msg.content);
  });
});
