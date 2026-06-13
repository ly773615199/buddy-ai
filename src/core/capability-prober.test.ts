import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CapabilityProber, type ProbeResult } from './capability-prober.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CapabilityProber 能力探测器', () => {
  let prober: CapabilityProber;
  let tmpDir: string;

  const mockResult: ProbeResult = {
    reachable: true,
    supportsDeveloperRole: true,
    toolCalling: false,
    structuredOutput: false,
    latencyMs: 150,
    errors: [],
  };

  beforeEach(() => {
    prober = new CapabilityProber();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prober-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== 缓存 ====================

  describe('缓存系统', () => {
    it('saveCache 写入文件，loadCache 读取', () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4', mockResult);
      const loaded = prober.loadCache(tmpDir, 'openai', 'gpt-4');
      expect(loaded).not.toBeNull();
      expect(loaded!.provider).toBe('openai');
      expect(loaded!.model).toBe('gpt-4');
      expect(loaded!.result.reachable).toBe(true);
      expect(loaded!.result.latencyMs).toBe(150);
    });

    it('缓存不存在返回 null', () => {
      const loaded = prober.loadCache(tmpDir, 'openai', 'nonexistent');
      expect(loaded).toBeNull();
    });

    it('过期缓存返回 null', () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4', mockResult);
      // 手动修改 probedAt 为 8 天前（超过默认 7 天 TTL）
      const cachePath = path.join(tmpDir, 'capabilities', 'openai__gpt-4.json');
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      cached.probedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
      fs.writeFileSync(cachePath, JSON.stringify(cached));

      const loaded = prober.loadCache(tmpDir, 'openai', 'gpt-4');
      expect(loaded).toBeNull();
    });

    it('未过期缓存返回结果', () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4', mockResult);
      // 修改 probedAt 为 6 天前（未超过 7 天 TTL）
      const cachePath = path.join(tmpDir, 'capabilities', 'openai__gpt-4.json');
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      cached.probedAt = Date.now() - 6 * 24 * 60 * 60 * 1000;
      fs.writeFileSync(cachePath, JSON.stringify(cached));

      const loaded = prober.loadCache(tmpDir, 'openai', 'gpt-4');
      expect(loaded).not.toBeNull();
    });

    it('模型名特殊字符被安全化', () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4-turbo@2024', mockResult);
      const loaded = prober.loadCache(tmpDir, 'openai', 'gpt-4-turbo@2024');
      expect(loaded).not.toBeNull();
      expect(loaded!.model).toBe('gpt-4-turbo@2024');
    });

    it('不同 provider/model 独立缓存', () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4', mockResult);
      prober.saveCache(tmpDir, 'deepseek', 'deepseek-chat', {
        ...mockResult,
        latencyMs: 300,
      });

      const a = prober.loadCache(tmpDir, 'openai', 'gpt-4');
      const b = prober.loadCache(tmpDir, 'deepseek', 'deepseek-chat');
      expect(a!.result.latencyMs).toBe(150);
      expect(b!.result.latencyMs).toBe(300);
    });
  });

  // ==================== probeOrCache ====================

  describe('probeOrCache()', () => {
    it('有缓存时不探测', async () => {
      prober.saveCache(tmpDir, 'openai', 'gpt-4', mockResult);
      const result = await prober.probeOrCache(
        {} as any, // 不需要真实 model
        tmpDir,
        'openai',
        'gpt-4',
      );
      expect(result.reachable).toBe(true);
      expect(result.latencyMs).toBe(150);
    });

    it('无 dataDir 时不读缓存', async () => {
      // 不传 dataDir，应尝试探测（会因无真实 model 失败）
      const result = await prober.probeOrCache(
        { prompt: 'ping' } as any,
        undefined,
        'openai',
        'gpt-4',
      );
      // 无真实 LLM，probe 会失败
      expect(result.reachable).toBe(false);
    });
  });
});
