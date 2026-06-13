/**
 * tokenizer.ts 测试 — 三进制模型分词器
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TernaryTokenizer } from './tokenizer.js';

// ═══════════════════════════════════════════════════════

describe('TernaryTokenizer', () => {
  let tokenizer: TernaryTokenizer;

  beforeEach(() => {
    tokenizer = new TernaryTokenizer();
  });

  it('初始状态未加载', () => {
    expect(tokenizer.isLoaded).toBe(false);
  });

  it('initBuiltin 初始化词表', () => {
    tokenizer.initBuiltin();
    expect(tokenizer.isLoaded).toBe(true);
    expect(tokenizer.vocabSize).toBe(32000);
  });

  it('encode 生成 token 数组', () => {
    tokenizer.initBuiltin();
    const ids = tokenizer.encode('hello');

    expect(ids.length).toBeGreaterThan(0);
    // 应包含 BOS 和 EOS
    expect(ids[0]).toBe(1); // BOS
    expect(ids[ids.length - 1]).toBe(2); // EOS
  });

  it('decode 过滤特殊 token', () => {
    tokenizer.initBuiltin();
    const ids = [1, 10, 11, 12, 2]; // BOS + 普通 token + EOS
    const text = tokenizer.decode(ids);

    // 不应包含 BOS/EOS/PAD
    expect(text).not.toContain('<s>');
    expect(text).not.toContain('</s>');
    expect(text).not.toContain('<pad>');
  });

  it('encode/decode roundtrip ASCII', () => {
    tokenizer.initBuiltin();
    const original = 'Hello, World!';
    const ids = tokenizer.encode(original);
    const decoded = tokenizer.decode(ids);

    expect(decoded).toBe(original);
  });

  it('encode/decode roundtrip 中文', () => {
    tokenizer.initBuiltin();
    const original = '你好世界';
    const ids = tokenizer.encode(original);
    const decoded = tokenizer.decode(ids);

    expect(decoded).toBe(original);
  });

  it('encode/decode roundtrip 混合文本', () => {
    tokenizer.initBuiltin();
    const original = 'Hello 你好 123';
    const ids = tokenizer.encode(original);
    const decoded = tokenizer.decode(ids);

    expect(decoded).toBe(original);
  });

  it('空字符串编码只有 BOS + EOS', () => {
    tokenizer.initBuiltin();
    const ids = tokenizer.encode('');
    expect(ids).toEqual([1, 2]);
  });

  it('空 token 数组解码返回空字符串', () => {
    tokenizer.initBuiltin();
    const text = tokenizer.decode([]);
    expect(text).toBe('');
  });

  it('自定义配置', () => {
    const custom = new TernaryTokenizer({
      vocabSize: 1000,
      bosTokenId: 10,
      eosTokenId: 20,
      padTokenId: 0,
      unkTokenId: 30,
    });
    custom.initBuiltin();

    expect(custom.vocabSize).toBe(1000);

    const ids = custom.encode('test');
    expect(ids[0]).toBe(10); // custom BOS
    expect(ids[ids.length - 1]).toBe(20); // custom EOS
  });

  it('未初始化时自动调用 initBuiltin', () => {
    // 直接 encode 不先调用 initBuiltin
    const ids = tokenizer.encode('auto init');
    expect(ids.length).toBeGreaterThan(0);
    expect(tokenizer.isLoaded).toBe(true);
  });

  it('未知字符使用 UNK', () => {
    tokenizer.initBuiltin();
    // emoji 通常不在词表中
    const ids = tokenizer.encode('😀');
    // 应该包含 UNK token (3) 或 UTF-8 字节回退
    expect(ids.length).toBeGreaterThan(2); // 至少 BOS + something + EOS
  });

  it('encode 保留 token ID 一致性', () => {
    tokenizer.initBuiltin();
    // 相同字符应始终编码为相同 ID
    const ids1 = tokenizer.encode('abc');
    const ids2 = tokenizer.encode('abc');
    expect(ids1).toEqual(ids2);
  });

  it('标点符号正确编码', () => {
    tokenizer.initBuiltin();
    const ids = tokenizer.encode('!@#$%');
    expect(ids.length).toBeGreaterThan(2); // BOS + tokens + EOS

    const decoded = tokenizer.decode(ids);
    expect(decoded).toBe('!@#$%');
  });
});
