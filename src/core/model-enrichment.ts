/**
 * ModelEnricher — HuggingFace 元数据增强器
 *
 * 职责：给模型列表补充 HuggingFace 官方元数据
 * 数据源优先级：
 *   L1 本地 model-catalog.json（离线预构建，毫秒级）
 *   L2 HuggingFace API 实时查询（fallback）
 *   L3 名称推断（兜底）
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== 类型 ====================

export interface EnrichmentResult {
  pipelineTag: string | null;       // text-generation, image-text-to-text, ...
  modelType: string | null;         // qwen2, deepseek_v3, ...
  parameters: number | null;        // 参数量
  contextLength: number | null;     // 上下文长度 (tokens)
  maxOutput: number | null;         // 最大输出长度 (tokens)
  tags: string[];                   // HF tags
  license: string | null;           // 许可证
  language: string[] | null;        // 语言
  category: ModelCategory;          // 分类结果
  hfId: string | null;              // 匹配到的 HuggingFace repo
  likes: number;
  downloads: number;
  source: 'catalog' | 'hf_api' | 'hf_readme' | 'inferred';
}

export type ModelCategory =
  | 'chat'        // 纯文本聊天
  | 'vl-chat'     // 视觉语言聊天
  | 'omni-chat'   // 全模态聊天
  | 'embedding'   // 向量嵌入
  | 'reranker'    // 重排序
  | 'image-gen'   // 图像生成
  | 'image-edit'  // 图像编辑
  | 'video-gen'   // 视频生成
  | 'tts'         // 语音合成
  | 'asr'         // 语音识别
  | 'translation' // 翻译
  | 'ocr'         // OCR
  | 'other'       // 其他
  | 'unknown';    // 未识别

// ==================== Catalog 类型 ====================

interface CatalogProfile {
  sfId: string;
  hfId: string | null;
  found: boolean;
  pipeline_tag: string | null;
  tags: string[];
  model_type: string | null;
  library_name: string | null;
  parameters: number | null;
  language: string[] | null;
  license: string | null;
  base_model: string | null;
  likes: number;
  downloads: number;
  lastModified: string | null;
  category: string;
  contextLength: number | null;
  maxOutput: number | null;
  contextSource: string | null;
}

interface CatalogData {
  version: number;
  generatedAt: string;
  platform: string;
  summary: Record<string, unknown>;
  profiles: CatalogProfile[];
}

// ==================== 分类映射 ====================

/** 聊天模型 pipeline_tag 白名单 */
const CHAT_TAGS = new Set([
  'text-generation',
  'image-text-to-text',
  'any-to-any',
  'visual-question-answering',
  'question-answering',
  'conversational',
]);

/** 排除的 pipeline_tag */
const EXCLUDE_TAGS = new Set([
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'text-to-speech', 'audio-to-audio', 'audio-to-text',
  'feature-extraction', 'sentence-similarity', 'sentence-transformers',
  'text-ranking', 'text-classification', 'fill-mask',
  'table-question-answering', 'translation', 'summarization',
  'zero-shot-classification', 'token-classification',
  'object-detection', 'image-segmentation', 'depth-estimation',
  'video-classification', 'reinforcement-learning',
]);

// ==================== ModelEnricher ====================

export class ModelEnricher {
  private catalog: Map<string, CatalogProfile> = new Map();
  private catalogLoaded = false;
  private readonly catalogPath: string;
  private readonly hfBase: string;
  private readonly hfRawBase: string;

  constructor(
    dataDir: string,
    options?: { hfBase?: string; hfRawBase?: string },
  ) {
    this.catalogPath = path.join(dataDir, 'model-catalog.json');
    this.hfBase = options?.hfBase ?? 'https://hf-mirror.com/api/models';
    this.hfRawBase = options?.hfRawBase ?? 'https://hf-mirror.com';
  }

  // ==================== 批量增强 ====================

  /**
   * 批量增强模型元数据
   *
   * 优先从本地 catalog 读取，未命中的尝试 HF API 实时查询
   */
  async enrich(modelIds: string[]): Promise<Map<string, EnrichmentResult>> {
    // 确保 catalog 已加载
    this.ensureCatalogLoaded();

    const result = new Map<string, EnrichmentResult>();
    const missIds: string[] = [];

    // L1: 从 catalog 匹配
    for (const sfId of modelIds) {
      const catalogEntry = this.catalog.get(sfId);
      if (catalogEntry) {
        result.set(sfId, this.catalogToEnrichment(catalogEntry));
      } else {
        missIds.push(sfId);
      }
    }

    // L2: 未命中的尝试 HF API（批量，带并发控制）
    if (missIds.length > 0) {
      console.log(`[ModelEnricher] catalog 命中 ${result.size}/${modelIds.length}, ${missIds.length} 个需要实时查询`);

      const CONCURRENCY = 3;
      const DELAY_MS = 350;

      for (let i = 0; i < missIds.length; i += CONCURRENCY) {
        const batch = missIds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map((id) => this.enrichFromHF(id)),
        );

        for (let j = 0; j < batch.length; j++) {
          const r = batchResults[j];
          if (r.status === 'fulfilled' && r.value) {
            result.set(batch[j], r.value);
          } else {
            // L3: 名称推断兜底
            result.set(batch[j], this.inferFromName(batch[j]));
          }
        }

        if (i + CONCURRENCY < missIds.length) {
          await this.sleep(DELAY_MS);
        }
      }
    }

    return result;
  }

  /**
   * 增强单个模型
   */
  async enrichOne(sfId: string): Promise<EnrichmentResult> {
    this.ensureCatalogLoaded();

    const catalogEntry = this.catalog.get(sfId);
    if (catalogEntry) {
      return this.catalogToEnrichment(catalogEntry);
    }

    const hfResult = await this.enrichFromHF(sfId);
    return hfResult ?? this.inferFromName(sfId);
  }

  // ==================== Catalog 加载 ====================

  private ensureCatalogLoaded(): void {
    if (this.catalogLoaded) return;
    this.catalogLoaded = true;

    try {
      if (!fs.existsSync(this.catalogPath)) {
        console.warn(`[ModelEnricher] catalog 不存在: ${this.catalogPath}`);
        return;
      }

      const raw: CatalogData = JSON.parse(fs.readFileSync(this.catalogPath, 'utf-8'));
      for (const profile of raw.profiles) {
        this.catalog.set(profile.sfId, profile);
      }

      console.log(`[ModelEnricher] 已加载 catalog: ${this.catalog.size} 个模型`);
    } catch (err) {
      console.warn(`[ModelEnricher] 加载 catalog 失败: ${(err as Error).message}`);
    }
  }

  // ==================== Catalog → Enrichment ====================

  private catalogToEnrichment(entry: CatalogProfile): EnrichmentResult {
    return {
      pipelineTag: entry.pipeline_tag,
      modelType: entry.model_type,
      parameters: entry.parameters,
      contextLength: entry.contextLength,
      maxOutput: entry.maxOutput,
      tags: entry.tags ?? [],
      license: entry.license,
      language: entry.language,
      category: this.classifyFromCatalog(entry),
      hfId: entry.hfId,
      likes: entry.likes ?? 0,
      downloads: entry.downloads ?? 0,
      source: 'catalog',
    };
  }

  /**
   * 从 catalog 分类（直接用已有的 category 字段，做标准化映射）
   */
  private classifyFromCatalog(entry: CatalogProfile): ModelCategory {
    const cat = entry.category;

    // catalog 已经分类好了，直接映射
    if (cat === 'chat') return 'chat';
    if (cat === 'vl-chat') return 'vl-chat';
    if (cat === 'omni-chat') return 'omni-chat';
    if (cat === 'embedding' || cat === 'feature-extraction' || cat === 'sentence-similarity') return 'embedding';
    if (cat === 'reranker' || cat === 'text-ranking' || cat === 'text-classification') return 'reranker';
    if (cat === 'text-to-image' || cat === 'image-to-image') return 'image-gen';
    if (cat === 'image-to-video' || cat === 'text-to-video') return 'video-gen';
    if (cat === 'text-to-speech') return 'tts';
    if (cat === 'audio-to-text' || cat === 'audio-to-audio') return 'asr';
    if (cat === 'translation') return 'translation';
    if (cat === 'ocr') return 'ocr';

    // catalog 的 unknown:xxx 格式
    if (cat?.startsWith('unknown:')) return 'unknown';

    // fallback: 用 pipeline_tag 重新分类
    if (entry.pipeline_tag) {
      return this.classifyByPipelineTag(entry.pipeline_tag);
    }

    return 'unknown';
  }

  // ==================== HF API 实时查询 ====================

  private async enrichFromHF(sfId: string): Promise<EnrichmentResult | null> {
    const candidates = this.getHFCandidates(sfId);

    for (const hfId of candidates) {
      try {
        const url = `${this.hfBase}/${hfId}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) continue;

        const data = await res.json() as Record<string, unknown>;
        if (!data?.pipeline_tag) continue;

        // 提取上下文长度（从 README）
        let contextLength: number | null = null;
        let maxOutput: number | null = null;

        try {
          const readmeUrl = `${this.hfRawBase}/${hfId}/raw/main/README.md`;
          const readmeRes = await fetch(readmeUrl, { signal: AbortSignal.timeout(8000) });
          if (readmeRes.ok) {
            const readmeText = await readmeRes.text();
            const extracted = this.extractContextLength(readmeText);
            contextLength = extracted.contextLength;
            maxOutput = extracted.maxOutput;
          }
        } catch { /* README 获取失败不影响 */ }

        const category = this.classifyByPipelineTag(data.pipeline_tag as string);

        return {
          pipelineTag: data.pipeline_tag as string,
          modelType: (data.config as Record<string, unknown>)?.model_type as string ?? null,
          parameters: (data.safetensors as Record<string, unknown>)?.total as number ?? null,
          contextLength,
          maxOutput,
          tags: ((data.tags as string[]) ?? []).filter((t: string) =>
            !t.startsWith('arxiv:') && !t.startsWith('region:') && !t.startsWith('deploy:')
          ),
          license: (data.cardData as Record<string, unknown>)?.license as string ?? null,
          language: (data.cardData as Record<string, unknown>)?.language as string[] ?? null,
          category,
          hfId,
          likes: (data.likes as number) ?? 0,
          downloads: (data.downloads as number) ?? 0,
          source: 'hf_api',
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  // ==================== 分类逻辑 ====================

  /**
   * 根据 pipeline_tag 分类
   */
  classifyByPipelineTag(tag: string): ModelCategory {
    if (CHAT_TAGS.has(tag)) {
      if (tag === 'image-text-to-text') return 'vl-chat';
      if (tag === 'any-to-any') return 'omni-chat';
      return 'chat';
    }

    if (EXCLUDE_TAGS.has(tag)) {
      if (tag.startsWith('text-to-image') || tag === 'image-to-image') return 'image-gen';
      if (tag.includes('video')) return 'video-gen';
      if (tag === 'text-to-speech') return 'tts';
      if (tag.includes('audio')) return 'asr';
      if (tag.includes('embedding') || tag === 'sentence-similarity' || tag === 'sentence-transformers' || tag === 'feature-extraction') return 'embedding';
      if (tag === 'text-ranking' || tag === 'text-classification') return 'reranker';
      if (tag === 'translation') return 'translation';
      return 'other';
    }

    return 'unknown';
  }

  /**
   * 判断是否为聊天模型（应加入模型池）
   */
  isChatModel(category: ModelCategory): boolean {
    return ['chat', 'vl-chat', 'omni-chat'].includes(category);
  }

  // ==================== 名称推断（兜底） ====================

  private inferFromName(sfId: string): EnrichmentResult {
    const lower = sfId.toLowerCase();
    let category: ModelCategory = 'chat';  // 默认 chat，API 返回的模型默认可对话

    // 硬排除（明确非对话）
    if (/bge-|bce-|embed|text-embedding/.test(lower)) category = 'embedding';
    else if (/rerank/.test(lower)) category = 'reranker';
    else if (/tts|cosyvoice|speech/.test(lower)) category = 'tts';
    else if (/asr|sensevoice|whisper/.test(lower)) category = 'asr';
    else if (/dall-e|dalle|stable-diffusion|flux|imagen|kolors|image-edit/.test(lower)) category = 'image-gen';
    else if (/i2v|t2v|wan2|video/.test(lower)) category = 'video-gen';
    else if (/ocr|paddleocr/.test(lower)) category = 'ocr';
    else if (/moderation|text-to-|t2i/.test(lower)) category = 'other';
    // 精确识别（对话子类型）
    else if (/-vl\b|vl-|vision|visual|qwen-vl|internvl|minicpm-v/.test(lower)) category = 'vl-chat';
    else if (/omni|any-to-any|mini-omni/.test(lower)) category = 'omni-chat';
    else if (/instruct|chat|[-_](it|gguf|awq|gptq|fp8|int[48])\b/.test(lower)) category = 'chat';

    return {
      pipelineTag: null,
      modelType: null,
      parameters: null,
      contextLength: null,
      maxOutput: null,
      tags: [],
      license: null,
      language: null,
      category,
      hfId: null,
      likes: 0,
      downloads: 0,
      source: 'inferred',
    };
  }

  // ==================== HF repo 路径解析 ====================

  private getHFCandidates(sfId: string): string[] {
    const candidates = new Set<string>();

    // 原始 ID
    candidates.add(sfId);

    // 去掉 Pro/ LoRA/ 前缀
    for (const prefix of ['Pro/', 'LoRA/']) {
      if (sfId.startsWith(prefix)) candidates.add(sfId.slice(prefix.length));
    }

    // zai-org → THUDM (GLM 系列)
    if (sfId.includes('zai-org/GLM')) {
      const model = sfId.split('/').pop()!;
      candidates.add(`THUDM/${model.toLowerCase()}`);
      candidates.add(`THUDM/${model}`);
    }

    return [...candidates];
  }

  // ==================== 上下文长度提取 ====================

  private extractContextLength(text: string): { contextLength: number | null; maxOutput: number | null } {
    let contextLength: number | null = null;
    let maxOutput: number | null = null;

    // 模式 1: "Context Length: Full 131,072 tokens"
    const m1 = text.match(/context\s*length[:\s]*(?:full\s*)?([\d,]+)\s*tokens?/i);
    if (m1) contextLength = parseInt(m1[1].replace(/,/g, ''));

    // 模式 2: "up to 128K tokens"
    if (!contextLength) {
      const m2 = text.match(/(?:up\s+to|supports?)\s+(\d+)\s*[kK]\s*tokens?/);
      if (m2) contextLength = parseInt(m2[1]) * 1024;
    }

    // 模式 3: "context_window: 131072" 或 "max_position_embeddings: 131072"
    if (!contextLength) {
      const m3 = text.match(/(?:context_window|max_position_embeddings|n_positions)[:\s]*(\d{4,})/i);
      if (m3) contextLength = parseInt(m3[1]);
    }

    // 模式 4: 上下文相关段落中的数字
    if (!contextLength) {
      const ctxSection = text.match(/(?:context|length|sequence)[^\n]{0,200}/gi);
      if (ctxSection) {
        for (const s of ctxSection) {
          const m = s.match(/([\d,]{4,})\s*(?:tokens?|token\s+length)/i);
          if (m) {
            contextLength = parseInt(m[1].replace(/,/g, ''));
            break;
          }
        }
      }
    }

    // 最大输出长度
    const outM = text.match(/(?:generation|generate|output|max_new_tokens?)[:\s]*(?:up\s+to\s+)?([\d,]+)\s*tokens?/i);
    if (outM) maxOutput = parseInt(outM[1].replace(/,/g, ''));

    return { contextLength, maxOutput };
  }

  // ==================== 工具 ====================

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ==================== 缓存管理 ====================

  /** 获取 catalog 状态 */
  getCatalogStatus(): { loaded: boolean; modelCount: number; path: string } {
    this.ensureCatalogLoaded();
    return {
      loaded: this.catalogLoaded,
      modelCount: this.catalog.size,
      path: this.catalogPath,
    };
  }

  /** 清除内存缓存（下次访问会重新加载 catalog） */
  clearCache(): void {
    this.catalog.clear();
    this.catalogLoaded = false;
  }
}

// ==================== 单例 ====================

let defaultEnricher: ModelEnricher | null = null;

/**
 * 获取默认的 ModelEnricher 实例
 */
export function getModelEnricher(dataDir?: string): ModelEnricher {
  if (!defaultEnricher) {
    if (!dataDir) {
      // 自动推断：项目根目录
      dataDir = path.join(import.meta.dirname, '..', '..');
    }
    defaultEnricher = new ModelEnricher(dataDir);
  }
  return defaultEnricher;
}

/**
 * 重置单例（测试用）
 */
export function resetModelEnricher(): void {
  defaultEnricher = null;
}
