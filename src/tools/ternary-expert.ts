/**
 * 三进制专家模型 — Buddy 工具集成
 *
 * 将本地三进制推理引擎注册为 Buddy 工具。
 * 用户提问时，自动选择合适的领域专家模型回答。
 */

import { z } from 'zod';
import { TernaryEngine } from '../ternary/engine.js';
import { TernaryModelManager } from '../ternary/manager.js';
import type { TernaryModelMeta } from '../ternary/format.js';
import type { ToolDef } from '../types.js';

// ── 领域路由器 ──

export interface DomainRoute {
  domain: string;
  engine: TernaryEngine;
  meta: TernaryModelMeta;
}

/**
 * 三进制专家路由器
 *
 * 管理多个领域专家模型，根据问题选择合适的模型。
 */
export class TernaryExpertRouter {
  private manager: TernaryModelManager;
  private engines: Map<string, TernaryEngine> = new Map();

  constructor(modelsDir?: string) {
    this.manager = new TernaryModelManager(modelsDir);
  }

  /**
   * 初始化：扫描本地模型
   */
  async init(): Promise<void> {
    await this.manager.init();

    // 预加载成熟模型
    const models = this.manager.list();
    for (const meta of models) {
      if (meta.growthStage === 'mature' || meta.growthStage === 'trainable') {
        await this.loadEngine(meta.domain);
      }
    }
  }

  /**
   * 列出可用专家
   */
  listExperts(): TernaryModelMeta[] {
    return this.manager.list();
  }

  /**
   * 根据问题选择领域
   *
   * 简化实现：关键词匹配。
   * 生产环境应由 LLM 做意图分类。
   */
  selectDomain(question: string): string | null {
    const models = this.manager.list();
    const lowerQ = question.toLowerCase();

    let bestMatch: { domain: string; score: number } | null = null;

    for (const meta of models) {
      if (meta.growthStage === 'seed') continue;

      const domain = meta.domain.toLowerCase();
      let score = 0;

      // 直接匹配领域名
      if (lowerQ.includes(domain)) score += 10;

      // 成熟度加分
      if (meta.growthStage === 'mature') score += 3;
      else if (meta.growthStage === 'trainable') score += 2;
      else score += 1;

      // 知识量加分
      score += Math.min(meta.trainSteps / 100, 2);

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { domain: meta.domain, score };
      }
    }

    return bestMatch?.domain ?? null;
  }

  /**
   * 获取模型可用性状态
   *
   * 返回详细的诊断信息，而非简单的 null。
   */
  getModelStatus(): {
    available: boolean;
    totalModels: number;
    readyModels: number;
    seedModels: number;
    message: string;
  } {
    const models = this.manager.list();
    const ready = models.filter(m => m.growthStage !== 'seed');
    const seeds = models.filter(m => m.growthStage === 'seed');

    if (models.length === 0) {
      return {
        available: false,
        totalModels: 0,
        readyModels: 0,
        seedModels: 0,
        message: '暂无三进制模型。请先执行 /train-ternary <领域> 训练模型，或使用 /learn 让 Buddy 学习领域知识后再训练。',
      };
    }

    if (ready.length === 0) {
      return {
        available: false,
        totalModels: models.length,
        readyModels: 0,
        seedModels: seeds.length,
        message: `有 ${seeds.length} 个种子模型尚未成熟。等待自动成长或手动执行 /train-ternary <领域> 加速训练。`,
      };
    }

    return {
      available: true,
      totalModels: models.length,
      readyModels: ready.length,
      seedModels: seeds.length,
      message: `就绪：${ready.map(m => m.domain).join(', ')}`,
    };
  }

  /**
   * 使用专家模型回答问题
   */
  async query(domain: string, question: string): Promise<{
    answer: string;
    domain: string;
    confidence: number;
    tokPerSec: number;
    memoryMB: number;
  }> {
    const engine = await this.getOrLoadEngine(domain);
    if (!engine) {
      const status = this.getModelStatus();
      throw new Error(
        `未找到「${domain}」领域的专家模型。${status.message}`
      );
    }

    const prompt = `### 指令\n作为${domain}领域的专家，请回答以下问题。\n\n### 问题\n${question}\n\n### 回答\n`;

    const { text, confidence } = await engine.completeWithStats(prompt, { maxTokens: 256 });
    const stats = engine.getStats();

    return {
      answer: text,
      domain,
      confidence,
      tokPerSec: stats.tokPerSec,
      memoryMB: stats.memoryMB,
    };
  }

  /**
   * 自动路由：根据问题选择领域并回答
   *
   * 无可用模型时返回 null（调用方应降级到 LLM）
   */
  async autoRoute(question: string): Promise<{
    answer: string;
    domain: string;
    confidence: number;
    tokPerSec: number;
  } | null> {
    const status = this.getModelStatus();
    if (!status.available) return null;

    const domain = this.selectDomain(question);
    if (!domain) return null;

    const result = await this.query(domain, question);
    return {
      answer: result.answer,
      domain: result.domain,
      confidence: result.confidence,
      tokPerSec: result.tokPerSec,
    };
  }

  /**
   * 卸载指定领域的引擎
   */
  unload(domain: string): void {
    const engine = this.engines.get(domain);
    if (engine) {
      engine.unload();
      this.engines.delete(domain);
    }
  }

  /**
   * 卸载所有引擎
   */
  unloadAll(): void {
    for (const [domain] of this.engines) {
      this.unload(domain);
    }
  }

  // ── 内部方法 ──

  private async getOrLoadEngine(domain: string): Promise<TernaryEngine | null> {
    let engine = this.engines.get(domain);
    if (engine?.isLoaded) return engine;

    return this.loadEngine(domain);
  }

  private async loadEngine(domain: string): Promise<TernaryEngine | null> {
    const info = await this.manager.getInfo(domain);
    if (!info?.exists) return null;

    const engine = new TernaryEngine();
    await engine.load(info.filePath);
    this.engines.set(domain, engine);
    return engine;
  }
}

// ── Buddy 工具定义 ──

/**
 * 创建三进制专家工具集
 * @param router TernaryExpertRouter 实例
 */
export function createTernaryTools(router: TernaryExpertRouter): ToolDef[] {
  const ternary_expert_query: ToolDef = {
    name: 'ternary_expert_query',
    description: '使用本地三进制专家模型回答领域问题。先用 ternary_models_list 查询可用模型，无可用模型时不要调用此工具。',
    parameters: z.object({
      domain: z.string().describe('领域名称（如 "Go开发", "法务"）'),
      question: z.string().describe('要提问的问题'),
    }),
    permission: 'basic',
    outputFormat: 'text',
    execute: async (args) => {
      const status = router.getModelStatus();
      if (!status.available) {
        return `⚠️ 三进制专家不可用：${status.message}`;
      }
      try {
        const result = await router.query(args.domain as string, args.question as string);
        return `[${result.domain} 专家 | ${result.tokPerSec} tok/s | 置信度 ${(result.confidence * 100).toFixed(1)}%]\n${result.answer}`;
      } catch (err) {
        return `⚠️ ${(err as Error).message}`;
      }
    },
  };

  const ternary_models_list: ToolDef = {
    name: 'ternary_models_list',
    description: '列出所有本地三进制专家模型及其可用状态。调用 ternary_expert_query 前应先调用此工具确认模型可用。',
    parameters: z.object({}),
    permission: 'basic',
    outputFormat: 'text',
    execute: async () => {
      const status = router.getModelStatus();
      const models = router.listExperts();

      if (models.length === 0) {
        return `⚠️ ${status.message}`;
      }

      const lines = models.map(m => {
        const ready = m.growthStage !== 'seed';
        const icon = ready ? '✅' : '🌱';
        return `${icon} ${m.domain} | ${m.growthStage} | ${m.totalParams} params | 训练 ${m.trainSteps} 步`;
      });

      lines.unshift(`共 ${status.totalModels} 个模型，${status.readyModels} 个就绪：`);
      if (status.seedModels > 0) {
        lines.push(`\n🌱 = 种子阶段（不可用于推理） | ✅ = 可用`);
      }
      return lines.join('\n');
    },
  };

  return [ternary_expert_query, ternary_models_list];
}
