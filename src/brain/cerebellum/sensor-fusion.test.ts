import { describe, it, expect } from 'vitest';
import { SensorFusion } from './sensor-fusion.js';

describe('SensorFusion', () => {
  it('ingest + getStatus', () => {
    const sf = new SensorFusion({ autoFlush: false });
    expect(sf.getStatus().buffered).toBe(0);

    sf.ingest({ source: 'user', content: 'hello', concepts: ['greeting'], confidence: 1 });
    expect(sf.getStatus().buffered).toBe(1);
    expect(sf.getStatus().totalIngested).toBe(1);

    sf.destroy();
  });

  it('maxEntries FIFO 淘汰', () => {
    const sf = new SensorFusion({ maxEntries: 3, autoFlush: false });
    for (let i = 0; i < 5; i++) {
      sf.ingest({ source: 'test', content: `msg-${i}`, concepts: ['test'], confidence: 1 });
    }
    expect(sf.getStatus().buffered).toBe(3);
    sf.destroy();
  });

  it('ingestUserMessage 提取概念', () => {
    const sf = new SensorFusion({ autoFlush: false });
    sf.ingestUserMessage('帮我搜索天气预报');
    expect(sf.getStatus().buffered).toBe(1);
    sf.destroy();
  });

  it('ingestToolResult 记录成功/失败', () => {
    const sf = new SensorFusion({ autoFlush: false });
    sf.ingestToolResult('exec', true, 'output');
    sf.ingestToolResult('exec', false, 'error');
    expect(sf.getStatus().buffered).toBe(2);
    sf.destroy();
  });

  it('flush 融合并通知监听器', () => {
    const sf = new SensorFusion({ autoFlush: false, fusionWindowMs: 60000 });
    sf.ingest({ source: 'user', content: 'hello', concepts: ['greeting'], confidence: 1 });

    let received = 0;
    sf.onFused(() => received++);

    const result = sf.flush();
    expect(result.merged).toBe(1);
    expect(received).toBe(1);
    expect(sf.getStatus().flushCount).toBe(1);

    sf.destroy();
  });

  it('自动关联检测', () => {
    const sf = new SensorFusion({ autoFlush: false, associationThreshold: 0.3 });
    sf.ingest({ source: 'a', content: 'x', concepts: ['code', 'git'], confidence: 1 });
    sf.ingest({ source: 'b', content: 'y', concepts: ['code', 'test'], confidence: 1 });

    // 第二条应检测到与第一条的关联
    const recent = sf.getRecent(1);
    expect(recent[0].relations.some(r => r.type === 'supports')).toBe(true);

    sf.destroy();
  });

  it('onFused 返回取消函数', () => {
    const sf = new SensorFusion({ autoFlush: false });
    let count = 0;
    const unsub = sf.onFused(() => count++);

    sf.ingest({ source: 'test', content: 'x', concepts: [], confidence: 1 });
    sf.flush();
    expect(count).toBe(1);

    unsub(); // 取消订阅
    sf.ingest({ source: 'test', content: 'y', concepts: [], confidence: 1 });
    sf.flush();
    expect(count).toBe(1); // 不再增加

    sf.destroy();
  });
});
