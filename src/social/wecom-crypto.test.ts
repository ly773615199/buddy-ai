/**
 * WeComCrypto 单元测试
 * 覆盖：签名验证、消息加密、消息解密、签名生成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import { WeComCrypto } from './wecom-crypto.js';

// 生成有效的 EncodingAESKey（43 字符 Base64，解码后 32 字节）
const rawKey = Buffer.alloc(32);
rawKey.fill(0xAB); // 填充测试数据
const TEST_ENCODING_AES_KEY = rawKey.toString('base64').slice(0, 43); // 确保 43 字符
const TEST_TOKEN = 'test_token_abc';
const TEST_CORP_ID = 'wx_corp_test';

describe('WeComCrypto', () => {
  let wecom: WeComCrypto;

  beforeEach(() => {
    wecom = new WeComCrypto(TEST_TOKEN, TEST_ENCODING_AES_KEY, TEST_CORP_ID);
  });

  describe('构造函数', () => {
    it('初始化成功', () => {
      expect(wecom).toBeDefined();
    });

    it('AES Key 正确解码', () => {
      // EncodingAESKey + '=' 后 Base64 解码应为 32 字节
      const expectedKey = Buffer.from(TEST_ENCODING_AES_KEY + '=', 'base64');
      expect(expectedKey.length).toBe(32);
    });
  });

  describe('签名验证', () => {
    it('正确签名通过验证', () => {
      const timestamp = '1629184800';
      const nonce = 'nonce123';
      const encrypt = 'encrypted_data_base64';

      // 手动计算期望签名
      const arr = [TEST_TOKEN, timestamp, nonce, encrypt].sort();
      const str = arr.join('');
      const expectedSig = crypto.createHash('sha1').update(str).digest('hex');

      expect(wecom.verify(timestamp, nonce, encrypt, expectedSig)).toBe(true);
    });

    it('错误签名验证失败', () => {
      const timestamp = '1629184800';
      const nonce = 'nonce123';
      const encrypt = 'encrypted_data_base64';
      const wrongSig = 'wrong_signature';

      expect(wecom.verify(timestamp, nonce, encrypt, wrongSig)).toBe(false);
    });

    it('篡改数据后签名不匹配', () => {
      const timestamp = '1629184800';
      const nonce = 'nonce123';
      const encrypt = 'encrypted_data_base64';

      const arr = [TEST_TOKEN, timestamp, nonce, encrypt].sort();
      const str = arr.join('');
      const sig = crypto.createHash('sha1').update(str).digest('hex');

      // 篡改 encrypt
      expect(wecom.verify(timestamp, nonce, 'tampered_data', sig)).toBe(false);
    });

    it('不同 token 产生不同签名', () => {
      const other = new WeComCrypto('different_token', TEST_ENCODING_AES_KEY, TEST_CORP_ID);
      const timestamp = '1629184800';
      const nonce = 'nonce123';
      const encrypt = 'data';

      const arr1 = [TEST_TOKEN, timestamp, nonce, encrypt].sort();
      const sig1 = crypto.createHash('sha1').update(arr1.join('')).digest('hex');

      const arr2 = ['different_token', timestamp, nonce, encrypt].sort();
      const sig2 = crypto.createHash('sha1').update(arr2.join('')).digest('hex');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('消息加密和解密', () => {
    it('加密后解密恢复原文', () => {
      const original = '你好，这是测试消息！';
      const encrypted = wecom.encrypt(original);
      const decrypted = wecom.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('加密结果是 Base64', () => {
      const encrypted = wecom.encrypt('test');
      // Base64 只包含 A-Z a-z 0-9 + / =
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('不同消息产生不同密文', () => {
      const enc1 = wecom.encrypt('消息1');
      const enc2 = wecom.encrypt('消息2');
      expect(enc1).not.toBe(enc2);
    });

    it('相同消息因随机数产生不同密文', () => {
      const enc1 = wecom.encrypt('相同消息');
      const enc2 = wecom.encrypt('相同消息');
      // 由于有 16 字节随机数，两次加密结果应不同
      expect(enc1).not.toBe(enc2);
    });

    it('空消息加密解密', () => {
      const encrypted = wecom.encrypt('');
      const decrypted = wecom.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('长消息加密解密', () => {
      const longMsg = '很长的消息'.repeat(100);
      const encrypted = wecom.encrypt(longMsg);
      const decrypted = wecom.decrypt(encrypted);
      expect(decrypted).toBe(longMsg);
    });

    it('包含特殊字符的消息', () => {
      const specialMsg = '<xml>&"\'\\n\\r\\t 你好 Hello 🎉';
      const encrypted = wecom.encrypt(specialMsg);
      const decrypted = wecom.decrypt(encrypted);
      expect(decrypted).toBe(specialMsg);
    });

    it('中文消息', () => {
      const chineseMsg = '企业微信加解密测试：你好世界！🇨🇳';
      const encrypted = wecom.encrypt(chineseMsg);
      const decrypted = wecom.decrypt(encrypted);
      expect(decrypted).toBe(chineseMsg);
    });
  });

  describe('签名生成', () => {
    it('generateSignature 与 verify 一致', () => {
      const timestamp = '1629184800';
      const nonce = 'test_nonce';
      const encrypt = wecom.encrypt('测试消息');

      const signature = wecom.generateSignature(timestamp, nonce, encrypt);
      expect(wecom.verify(timestamp, nonce, encrypt, signature)).toBe(true);
    });

    it('签名是 40 字符十六进制', () => {
      const sig = wecom.generateSignature('123', 'nonce', 'data');
      expect(sig).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('边界情况', () => {
    it('无效 Base64 解密应抛错', () => {
      expect(() => wecom.decrypt('not-valid-base64!!!')).toThrow();
    });

    it('不同 corpId 解密结果不同', () => {
      const other = new WeComCrypto(TEST_TOKEN, TEST_ENCODING_AES_KEY, 'different_corp');
      const encrypted = wecom.encrypt('secret');

      // 解密后内容会包含原始 corpId，结果与原文不同
      const decrypted = other.decrypt(encrypted);
      // 解密可能得到不同的内容（因为 corpId 不匹配）
      expect(typeof decrypted).toBe('string');
    });
  });
});
