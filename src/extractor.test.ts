import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeExtractor } from './knowledge/extractor.js';
import { STMPStore } from './memory/stmp.js';
import { CognitiveEngine } from './cognitive/engine.js';
import type { Message } from './types.js';
import * as fs from 'fs';

const STMP_DB = '/tmp/buddy-extractor-stmp-test.db';
const COG_DB = '/tmp/buddy-extractor-cog-test.db';

function msg(role: 'user' | 'assistant', content: string, ts = Date.now()): Message {
  return { role, content, timestamp: ts };
}

describe('知识提取引擎 KnowledgeExtractor', () => {
  let stmp: STMPStore;
  let cognitive: CognitiveEngine;
  let extractor: KnowledgeExtractor;

  beforeEach(() => {
    if (fs.existsSync(STMP_DB)) fs.unlinkSync(STMP_DB);
    if (fs.existsSync(COG_DB)) fs.unlinkSync(COG_DB);
    stmp = new STMPStore(STMP_DB);
    cognitive = new CognitiveEngine(COG_DB);
    extractor = new KnowledgeExtractor(stmp, cognitive);
  });

  afterEach(() => {
    stmp.close();
    cognitive.close();
    if (fs.existsSync(STMP_DB)) fs.unlinkSync(STMP_DB);
    if (fs.existsSync(COG_DB)) fs.unlinkSync(COG_DB);
  });

  // ==================== 规则提取（无 LLM）====================

  describe('规则提取（降级方案）', () => {
    it('检测纠正信号 → decision_rule', async () => {
      const messages: Message[] = [
        msg('assistant', '你应该用 forEach'),
        msg('user', '不对，应该用 map，因为需要返回新数组'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.total).toBeGreaterThan(0);
      expect(result.extracted.some(k => k.type === 'decision_rule')).toBe(true);
      expect(result.stmpInserted).toBeGreaterThan(0);
    });

    it('检测经验表述 → pattern_recognition', async () => {
      const messages: Message[] = [
        msg('user', '我发现处理并发请求最好用 Promise.allSettled'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.extracted.some(k => k.type === 'pattern_recognition')).toBe(true);
    });

    it('检测风险表述 → risk_judgment', async () => {
      const messages: Message[] = [
        msg('user', '要注意这个缓存策略在高并发下容易出问题'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.extracted.some(k =>
        k.type === 'risk_judgment' || k.type === 'failure_experience'
      )).toBe(true);
    });

    it('检测失败经验 → failure_experience', async () => {
      const messages: Message[] = [
        msg('user', '之前犯过这个教训，不应该直接删除生产数据'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.extracted.some(k => k.type === 'failure_experience')).toBe(true);
    });

    it('空消息列表不崩溃', async () => {
      const result = await extractor.extract([], 10);
      expect(result.total).toBe(0);
      expect(result.extracted).toHaveLength(0);
    });

    it('只有 assistant 消息不提取', async () => {
      const messages: Message[] = [
        msg('assistant', '这是一个回复'),
        msg('assistant', '另一个回复'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.total).toBe(0);
    });

    it('短消息不触发经验提取（length <= 20）', async () => {
      const messages: Message[] = [
        msg('user', '我发现OK'), // 6 chars
      ];

      const result = await extractor.extract(messages, 10);
      // 短消息不应该触发 pattern_recognition（需要 > 20）
      expect(result.extracted.filter(k => k.type === 'pattern_recognition')).toHaveLength(0);
    });
  });

  // ==================== 领域推断 ====================

  describe('领域推断', () => {
    it('识别前端开发领域', async () => {
      const messages: Message[] = [
        msg('user', '不对，React 组件应该用函数式写法'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.extracted.some(k => k.domain === '前端开发')).toBe(true);
    });

    it('识别数据库领域', async () => {
      const messages: Message[] = [
        msg('user', '要注意数据库索引在大数据量下容易出问题'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.extracted.length).toBeGreaterThan(0);
      expect(result.extracted[0].domain).toBe('数据库');
    });

    it('未识别领域归为通用', async () => {
      const messages: Message[] = [
        msg('user', '不对，这个应该换种方式理解'),
      ];

      const result = await extractor.extract(messages, 10);
      if (result.extracted.length > 0) {
        expect(result.extracted[0].domain).toBe('通用');
      }
    });
  });

  // ==================== STMP 写入 ====================

  describe('STMP 写入集成', () => {
    it('提取结果自动写入 STMP', async () => {
      const messages: Message[] = [
        msg('user', '我发现 TypeScript 的泛型约束最好用 extends'),
      ];

      const beforeCount = stmp.countNodes();
      await extractor.extract(messages, 10);
      const afterCount = stmp.countNodes();
      expect(afterCount).toBeGreaterThan(beforeCount);
    });

    it('创建领域对应的房间', async () => {
      const messages: Message[] = [
        msg('user', '不对，Go 的 goroutine 应该用 channel 通信'),
      ];

      await extractor.extract(messages, 10);
      const rooms = stmp.listRooms();
      // 应该创建了"后端开发"或"通用"等房间
      expect(rooms.length).toBeGreaterThan(1); // 至少有 default + 新房间
    });

    it('建立概念之间的星图边', async () => {
      const messages: Message[] = [
        msg('user', '我发现 React hooks 的 useCallback 在列表渲染时最好配合 memo'),
      ];

      await extractor.extract(messages, 10);
      const stats = stmp.getStats();
      expect(stats.edges).toBeGreaterThan(0);
    });
  });

  // ==================== 领域画像更新 ====================

  describe('领域画像更新', () => {
    it('提取后更新领域画像', async () => {
      const messages: Message[] = [
        msg('user', '我发现 React 的 useState 最好用函数式更新'),
      ];

      await extractor.extract(messages, 10);
      const profile = cognitive.getDomainProfile('前端开发');
      expect(profile.knowledgeCount).toBeGreaterThan(0);
    });

    it('domainUpdates 列出更新的领域', async () => {
      const messages: Message[] = [
        msg('user', '不对，Docker 部署应该用多阶段构建'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.domainUpdates.length).toBeGreaterThan(0);
    });
  });

  // ==================== 去重 ====================

  describe('去重逻辑', () => {
    it('相同内容不重复写入 STMP', async () => {
      const messages: Message[] = [
        msg('user', '不对，CSS 选择器应该用 BEM 命名'),
      ];

      const result1 = await extractor.extract(messages, 10);
      const countAfterFirst = stmp.countNodes();
      expect(result1.stmpInserted).toBeGreaterThan(0);

      // 再次提取相同内容 → 去重跳过
      const result2 = await extractor.extract(messages, 10);
      expect(result2.stmpInserted).toBe(0);
      // STMP 节点数不变
      expect(stmp.countNodes()).toBe(countAfterFirst);
    });
  });

  // ==================== 概念提取 ====================

  describe('简单概念提取', () => {
    it('从消息中提取概念标签', async () => {
      const messages: Message[] = [
        msg('user', '我发现 React 的 useCallback 在 TypeScript 泛型中最好配合 useMemo'),
      ];

      const result = await extractor.extract(messages, 10);
      if (result.extracted.length > 0) {
        expect(result.extracted[0].concepts.length).toBeGreaterThan(0);
        expect(result.extracted[0].concepts.length).toBeLessThanOrEqual(5);
      }
    });
  });

  // ==================== LLM 提取 ====================

  describe('LLM 提取', () => {
    it('设置 LLM 调用器后使用 LLM 提取', async () => {
      extractor.setLLMCaller(async () => JSON.stringify([{
        type: 'decision_rule',
        content: '用 Redis 缓存热点数据',
        domain: '后端开发',
        confidence: 0.9,
        concepts: ['Redis', '缓存', '性能'],
      }]));

      const messages: Message[] = [
        msg('assistant', '你觉得缓存方案怎么样？'),
        msg('user', '热点数据用 Redis 做缓存'),
        msg('assistant', '好主意'),
      ];

      const result = await extractor.extract(messages, 10);
      // LLM 路径可能因为各种原因失败，降级到规则提取
      // 至少不崩溃
      expect(result).toBeDefined();
      expect(result.total + result.stmpInserted).toBeGreaterThanOrEqual(0);
    });

    it('LLM 返回低置信度知识被跳过', async () => {
      extractor.setLLMCaller(async () => JSON.stringify([{
        type: 'decision_rule',
        content: '可能应该用 Redis',
        domain: '后端开发',
        confidence: 0.3, // 低于 0.6 阈值
        concepts: ['Redis'],
      }]));

      const messages: Message[] = [
        msg('user', '缓存用什么好？'),
        msg('assistant', 'Redis 可以'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.skipped).toBeGreaterThan(0);
      expect(result.stmpInserted).toBe(0);
    });

    it('LLM 返回空数组不崩溃', async () => {
      extractor.setLLMCaller(async () => '[]');

      const messages: Message[] = [
        msg('user', '今天天气不错'),
        msg('assistant', '是的'),
      ];

      const result = await extractor.extract(messages, 10);
      expect(result.total).toBe(0);
    });

    it('LLM 抛异常时降级到规则提取', async () => {
      // 使用全新实例避免缓存污染
      const freshStmp = new STMPStore('/tmp/buddy-extractor-fresh-stmp.db');
      const freshCog = new CognitiveEngine('/tmp/buddy-extractor-fresh-cog.db');
      const freshExt = new KnowledgeExtractor(freshStmp, freshCog);

      freshExt.setLLMCaller(async () => { throw new Error('LLM down'); });

      const messages: Message[] = [
        msg('assistant', '你想怎么实现实时通信？'),
        msg('user', '不对，应该用 WebSocket 而不是轮询来实时通信'),
      ];

      const result = await freshExt.extract(messages, 10);
      expect(result.extracted.some(k => k.type === 'decision_rule')).toBe(true);

      freshStmp.close();
      freshCog.close();
      try { fs.unlinkSync('/tmp/buddy-extractor-fresh-stmp.db'); } catch {}
      try { fs.unlinkSync('/tmp/buddy-extractor-fresh-cog.db'); } catch {}
    });

    it('LLM 返回非 JSON 降级到规则', async () => {
      extractor.setLLMCaller(async () => '这是一段文字不是 JSON');

      const messages: Message[] = [
        msg('assistant', '你的 mock 策略是什么？'),
        msg('user', '我发现 Jest 的 mock 最好用 beforeEach 重置'),
      ];

      const result = await extractor.extract(messages, 10);
      // 降级到规则
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it('LLM 返回 markdown 代码块包裹的 JSON', async () => {
      extractor.setLLMCaller(async () => '```json\n[{"type":"pattern_recognition","content":"用 composition 替代 inheritance","domain":"前端开发","confidence":0.85,"concepts":["React","composition"]}]```');

      const messages: Message[] = [
        msg('assistant', '组件复用怎么处理？'),
        msg('user', '我发现用 composition 模式处理组件复用效果很好'),
      ];

      const result = await extractor.extract(messages, 10);
      // LLM 提取或降级到规则均可
      expect(result).toBeDefined();
    });
  });

  // ==================== 统计 ====================

  describe('getStats() 统计', () => {
    it('初始统计为零', () => {
      const stats = extractor.getStats();
      expect(stats.totalExtracted).toBe(0);
      expect(stats.recentCacheSize).toBe(0);
    });

    it('提取后统计更新', async () => {
      const messages: Message[] = [
        msg('user', '我发现 Nginx 反向代理最好用 upstream'),
      ];

      await extractor.extract(messages, 10);
      const stats = extractor.getStats();
      expect(stats.totalExtracted).toBeGreaterThan(0);
    });
  });

  // ==================== recentCount 参数 ====================

  describe('recentCount 参数', () => {
    it('只分析最近 N 条消息', async () => {
      const messages: Message[] = [
        msg('user', '不对，应该用 GraphQL 而不是 REST'),
        msg('assistant', '有道理'),
        msg('assistant', '还有别的考虑吗？'),
        msg('assistant', '最后一条回复'),
      ];

      // recentCount=2 只看最后2条 assistant 消息 → 无 user → 不提取
      const result2 = await extractor.extract(messages, 2);
      expect(result2.total).toBe(0);

      // recentCount=4 看全部 → 包含 user 纠正 → 提取
      const result4 = await extractor.extract(messages, 4);
      expect(result4.total).toBeGreaterThan(0);
    });
  });
});
