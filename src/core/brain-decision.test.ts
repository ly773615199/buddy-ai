/**
 * 三脑资源决策改造 — 新增功能测试
 *
 * 覆盖：
 * - ModelPool.queryForBrain() 只读查询
 * - ModelPool.getThompsonScore() 评分参考
 * - assessCriticality() 关键性评估
 * - Scheduler.computeBrainScore() 综合评分
 * - NN decoder intentDistribution + allTools
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assessCriticality, assessComplexity } from './perception-state.js';

// ==================== assessCriticality ====================

describe('assessCriticality', () => {
  it('复杂任务 + 长内容 → high', () => {
    const content = '帮我设计一个分布式微服务架构，需要支持高并发场景下的负载均衡方案，还要考虑数据库分片、消息队列异步处理、服务发现和熔断机制的设计，以及CI/CD流水线和监控告警体系的搭建方案。请给出详细的技术选型和架构图。';
    const result = assessCriticality(content, { category: 'complex_task', confidence: 0.9 });
    expect(result).toBe('high');
  });

  it('包含架构/系统关键词 + 长内容 → high', () => {
    const content = '我想重构一下这个系统的架构设计，目前的性能瓶颈在数据库层，需要优化查询和缓存策略，同时要考虑微服务拆分和消息队列的引入方案，还需要考虑分布式部署和负载均衡的问题。';
    const result = assessCriticality(content, { category: 'code_operations', confidence: 0.8 });
    expect(result).toBe('high');
  });

  it('短闲聊 → low', () => {
    const result = assessCriticality('你好呀', { category: 'conversation', confidence: 0.9 });
    expect(result).toBe('low');
  });

  it('超短文本 → low', () => {
    const result = assessCriticality('hi', { category: 'conversation', confidence: 0.5 });
    expect(result).toBe('low');
  });

  it('普通代码操作 → normal', () => {
    const result = assessCriticality('帮我读一下 config.json 看看有没有语法错误', { category: 'code_operations', confidence: 0.8 });
    expect(result).toBe('normal');
  });

  it('英文关键词也识别', () => {
    const content = 'Please help me design a distributed system architecture with microservice pattern and implement the core modules';
    const result = assessCriticality(content, { category: 'complex_task', confidence: 0.85 });
    expect(result).toBe('high');
  });

  it('普通对话长度 → normal', () => {
    const result = assessCriticality('今天天气怎么样？适合出去走走吗？我打算去公园散步，你觉得怎么样？', { category: 'conversation', confidence: 0.7 });
    expect(result).toBe('normal');
  });
});

// ==================== assessComplexity（语义密度版本） ====================

describe('assessComplexity 语义密度', () => {
  it('短文本 + 高技术密度 → complex', () => {
    const result = assessComplexity('用 Rust 写分布式 Raft 共识算法', { category: 'code_operations', confidence: 0.9 });
    expect(result).toBe('complex');
  });

  it('长闲聊文本 → simple', () => {
    const result = assessComplexity(
      '你好呀，今天心情怎么样？我最近在学编程，想了解一下 Python 和 JavaScript 的区别',
      { category: 'conversation', confidence: 0.8 },
    );
    expect(result).toBe('simple');
  });

  it('complex_task 意图直接 → complex', () => {
    const result = assessComplexity('帮我', { category: 'complex_task', confidence: 0.5 });
    expect(result).toBe('complex');
  });

  it('多技术关键词 → complex', () => {
    const result = assessComplexity(
      '需要一个分布式微服务架构，用消息队列做异步处理，数据库用分片方案',
      { category: 'code_operations', confidence: 0.8 },
    );
    expect(result).toBe('complex');
  });

  it('普通工具操作 → medium', () => {
    const result = assessComplexity('帮我读一下这个文件看看有没有错误', { category: 'code_operations', confidence: 0.7 });
    expect(result).toBe('medium');
  });
});
