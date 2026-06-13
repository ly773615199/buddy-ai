/**
 * 三进制模型管理器 — 本地模型的增删查改
 *
 * 存储路径: ~/.buddy/models/{domain}.ta
 * 索引文件: ~/.buddy/models/index.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { TernaryModel, TernaryModelMeta, GrowthStage } from './format.js';
import { createModelMeta, ARCHITECTURE_PRESETS } from './format.js';
import { encode, decode, estimateSizeFromParams, formatSize } from './codec.js';

// ── 索引结构 ──

interface ModelIndex {
  version: string;
  models: Record<string, TernaryModelMeta>;
}

// ── 模型详情（含体积信息）──

export interface ModelInfo extends TernaryModelMeta {
  filePath: string;
  fileSize: number;
  fileSizeFormatted: string;
  exists: boolean;
}

// ── 管理器 ──

export class TernaryModelManager {
  private modelsDir: string;
  private index: ModelIndex | null = null;

  constructor(modelsDir?: string) {
    this.modelsDir = modelsDir || path.join(os.homedir(), '.buddy', 'models');
  }

  /**
   * 初始化：创建目录 + 加载索引
   */
  async init(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true });

    const indexPath = this.indexPath;
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(data);
    } catch {
      this.index = { version: '1.0.0', models: {} };
      await this.saveIndex();
    }
  }

  /**
   * 列出所有模型元数据
   */
  list(): TernaryModelMeta[] {
    this.ensureInit();
    return Object.values(this.index!.models);
  }

  /**
   * 获取指定领域的模型元数据
   */
  get(domain: string): TernaryModelMeta | null {
    this.ensureInit();
    return this.index!.models[domain] ?? null;
  }

  /**
   * 获取模型详情（含文件信息）
   */
  async getInfo(domain: string): Promise<ModelInfo | null> {
    const meta = this.get(domain);
    if (!meta) return null;

    const filePath = this.modelPath(domain);
    let fileSize = 0;
    let exists = false;

    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
      exists = true;
    } catch {
      // 文件不存在
    }

    return {
      ...meta,
      filePath,
      fileSize,
      fileSizeFormatted: formatSize(fileSize),
      exists,
    };
  }

  /**
   * 保存模型（编码 + 写入磁盘 + 更新索引）
   */
  async save(model: TernaryModel): Promise<void> {
    this.ensureInit();
    await fs.mkdir(this.modelsDir, { recursive: true });

    // 编码为 .ta 二进制
    const buffer = encode(model);

    // 写入文件
    const filePath = this.modelPath(model.meta.domain);
    await fs.writeFile(filePath, Buffer.from(buffer));

    // 更新索引
    const meta = { ...model.meta, lastUpdated: Date.now() };
    this.index!.models[model.meta.domain] = meta;
    await this.saveIndex();
  }

  /**
   * 删除模型
   */
  async delete(domain: string): Promise<boolean> {
    this.ensureInit();

    const filePath = this.modelPath(domain);
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件可能不存在
    }

    if (this.index!.models[domain]) {
      delete this.index!.models[domain];
      await this.saveIndex();
      return true;
    }

    return false;
  }

  /**
   * 加载完整模型（从 .ta 文件解码）
   */
  async load(domain: string): Promise<TernaryModel | null> {
    const filePath = this.modelPath(domain);
    try {
      const buffer = await fs.readFile(filePath);
      return decode(buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ));
    } catch {
      return null;
    }
  }

  /**
   * 创建新的空模型并保存
   */
  async create(domain: string, architecture = 'ternary-transformer-100m'): Promise<TernaryModel> {
    const preset = ARCHITECTURE_PRESETS[architecture];
    if (!preset) {
      throw new Error(`Unknown architecture: ${architecture}`);
    }

    const meta = createModelMeta(domain, {
      architecture,
      inFeatures: preset.hiddenSize,
      outFeatures: preset.hiddenSize,
      totalParams: preset.totalParams,
      numLayers: preset.numLayers,
    });

    // 创建空层（所有权重为 0）
    const layers = Array.from({ length: meta.numLayers }, (_, i) => ({
      layerIndex: i,
      A: new Int8Array(meta.inFeatures * meta.rank),
      B: new Int8Array(meta.rank * meta.outFeatures),
    }));

    const model: TernaryModel = { meta, layers };
    await this.save(model);
    return model;
  }

  /**
   * 更新元数据（不重新编码权重）
   */
  async updateMeta(domain: string, patch: Partial<TernaryModelMeta>): Promise<void> {
    this.ensureInit();

    const existing = this.index!.models[domain];
    if (!existing) {
      throw new Error(`Model not found: ${domain}`);
    }

    this.index!.models[domain] = { ...existing, ...patch, lastUpdated: Date.now() };
    await this.saveIndex();
  }

  /**
   * 更新成长阶段
   */
  async setGrowthStage(domain: string, stage: GrowthStage): Promise<void> {
    await this.updateMeta(domain, { growthStage: stage });
  }

  /**
   * 获取模型体积估算
   */
  getModelSizeEstimate(domain: string): string {
    const meta = this.get(domain);
    if (!meta) return 'N/A';
    return formatSize(estimateSizeFromParams(meta.totalParams));
  }

  // ── 内部方法 ──

  private get indexPath(): string {
    return path.join(this.modelsDir, 'index.json');
  }

  private modelPath(domain: string): string {
    // 域名中的特殊字符替换为下划线
    const safeName = domain.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    return path.join(this.modelsDir, `${safeName}.ta`);
  }

  private async saveIndex(): Promise<void> {
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(this.index, null, 2),
      'utf-8',
    );
  }

  private ensureInit(): void {
    if (!this.index) {
      throw new Error('TernaryModelManager not initialized. Call init() first.');
    }
  }
}
