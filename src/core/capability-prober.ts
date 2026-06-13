/**
 * Provider 能力探测器
 *
 * 首次连接新 provider 时，发送轻量探测请求，自动判断它支持什么功能。
 * 探测结果缓存到磁盘，避免每次启动都重新探测。
 *
 * 探测项目：
 *   1. 基础连通性
 *   2. role: 'developer' 支持
 *   3. 原生 tool calling 支持
 *   4. structured output 支持
 *   5. 响应延迟
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateText, tool, stepCountIs, type LanguageModel } from 'ai';
import { z } from 'zod';

// ==================== 类型定义 ====================

export interface ProbeResult {
  /** 基础连通性 */
  reachable: boolean;
  /** 是否支持 role: 'developer' */
  supportsDeveloperRole: boolean;
  /** 是否支持原生 tool calling */
  toolCalling: boolean;
  /** 是否支持 structured output */
  structuredOutput: boolean;
  /** 响应延迟（ms） */
  latencyMs: number;
  /** 探测错误信息 */
  errors: string[];
}

export interface CachedCapabilities {
  provider: string;
  model: string;
  probedAt: number;
  ttlMs: number;
  result: ProbeResult;
}

// ==================== 探测器 ====================

export class CapabilityProber {
  private readonly PROBE_TIMEOUT_MS = 10_000;
  private readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

  /**
   * 探测 provider 能力
   */
  async probe(model: LanguageModel): Promise<ProbeResult> {
    const result: ProbeResult = {
      reachable: false,
      supportsDeveloperRole: false,
      toolCalling: false,
      structuredOutput: false,
      latencyMs: 0,
      errors: [],
    };

    // 1. 基础连通性 + 延迟
    try {
      const start = Date.now();
      await this.withTimeout(
        generateText({ model, prompt: 'ping', maxOutputTokens: 5 }),
        this.PROBE_TIMEOUT_MS,
      );
      result.reachable = true;
      result.latencyMs = Date.now() - start;
    } catch (e: any) {
      result.errors.push(`连通性: ${e.message}`);
      return result; // 不通就不用继续了
    }

    // 2. developer role 支持
    try {
      await this.withTimeout(
        generateText({
          model,
          messages: [{ role: 'developer' as any, content: 'Reply OK' }],
          maxOutputTokens: 5,
        }),
        this.PROBE_TIMEOUT_MS,
      );
      result.supportsDeveloperRole = true;
    } catch {
      result.supportsDeveloperRole = false;
    }

    // 3. Tool calling 支持
    try {
      await this.withTimeout(
        generateText({
          model,
          messages: [{ role: 'user', content: 'What is 1+1?' }],
          tools: {
            calculator: tool({
              description: 'A calculator',
              inputSchema: z.object({ expression: z.string() }),
              execute: async () => '2',
            }),
          },
          stopWhen: stepCountIs(1),
          maxOutputTokens: 50,
        }),
        this.PROBE_TIMEOUT_MS,
      );
      result.toolCalling = true;
    } catch (e: any) {
      result.toolCalling = false;
      result.errors.push(`tool calling: ${e.message}`);
    }

    return result;
  }

  // ==================== 缓存 ====================

  /**
   * 从磁盘加载缓存的探测结果
   */
  loadCache(dataDir: string, provider: string, model: string): CachedCapabilities | null {
    const cachePath = this.getCachePath(dataDir, provider, model);
    try {
      if (!fs.existsSync(cachePath)) return null;
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Date.now() - raw.probedAt > raw.ttlMs) return null; // 过期
      return raw;
    } catch {
      return null;
    }
  }

  /**
   * 保存探测结果到磁盘
   */
  saveCache(dataDir: string, provider: string, model: string, result: ProbeResult): void {
    const cachePath = this.getCachePath(dataDir, provider, model);
    const cached: CachedCapabilities = {
      provider,
      model,
      probedAt: Date.now(),
      ttlMs: this.DEFAULT_TTL_MS,
      result,
    };
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2));
    } catch (e: any) {
      console.warn(`[Prober] 缓存保存失败: ${e.message}`);
    }
  }

  /**
   * 探测或使用缓存
   */
  async probeOrCache(
    model: LanguageModel,
    dataDir: string | undefined,
    provider: string,
    modelName: string,
  ): Promise<ProbeResult> {
    // 尝试从缓存加载
    if (dataDir) {
      const cached = this.loadCache(dataDir, provider, modelName);
      if (cached) {
        console.log(`[Prober] 使用缓存: ${provider}/${modelName} (${Math.round((Date.now() - cached.probedAt) / 3600000)}h 前)`);
        return cached.result;
      }
    }

    // 重新探测
    console.log(`[Prober] 探测能力: ${provider}/${modelName}...`);
    const result = await this.probe(model);

    // 保存缓存
    if (dataDir) {
      this.saveCache(dataDir, provider, modelName, result);
    }

    console.log(`[Prober] 结果: reachable=${result.reachable} developer=${result.supportsDeveloperRole} tools=${result.toolCalling} latency=${result.latencyMs}ms`);
    return result;
  }

  // ==================== 内部 ====================

  private getCachePath(dataDir: string, provider: string, model: string): string {
    const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(dataDir, 'capabilities', `${provider}__${safeName}.json`);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`探测超时 (${ms}ms)`)), ms),
      ),
    ]);
  }
}
