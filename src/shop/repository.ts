/**
 * 模型仓库服务 — 商品 → 下载 → 安装 的中间层
 *
 * 本地仓库：~/.buddy/registry/ 目录
 * 远程仓库：HTTP API 查询 + 预签名 URL 下载
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ModelManifest } from './installer.js';

// ── 搜索过滤 ──

export interface SearchFilters {
  domain?: string;
  tags?: string[];
  architecture?: string;
  growthStage?: string;
  author?: string;
}

// ── 仓库配置 ──

export interface RepositoryConfig {
  /** 本地仓库路径 */
  localDir: string;
  /** 远程仓库 URL（可选） */
  remoteUrl?: string;
  /** API Key（可选） */
  apiKey?: string;
}

// ── 仓库条目 ──

interface RegistryIndex {
  version: string;
  models: Record<string, ModelManifest>;
  updatedAt: number;
}

/**
 * 模型仓库
 */
export class ModelRepository {
  private config: RepositoryConfig;
  private index: RegistryIndex | null = null;

  constructor(config: RepositoryConfig) {
    this.config = config;
  }

  /**
   * 初始化：创建目录 + 加载索引
   */
  async init(): Promise<void> {
    await fs.mkdir(this.config.localDir, { recursive: true });
    await this.loadIndex();
  }

  // ── 查询 ──

  /**
   * 获取模型 manifest
   */
  async getManifest(modelId: string): Promise<ModelManifest | null> {
    // 本地优先
    const local = this.index?.models[modelId];
    if (local) return local;

    // 远程查询
    if (this.config.remoteUrl) {
      try {
        const res = await fetch(`${this.config.remoteUrl}/models/${modelId}/manifest.json`, {
          headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const manifest = await res.json() as ModelManifest;
          // 缓存到本地索引
          if (this.index) {
            this.index.models[modelId] = manifest;
            await this.saveIndex();
          }
          return manifest;
        }
      } catch { /* 远程不可用 */ }
    }

    return null;
  }

  /**
   * 获取下载 URL
   */
  async getDownloadUrl(modelId: string, version?: string): Promise<string | null> {
    // 检查本地是否有文件
    const localPath = this.getLocalPath(modelId);
    if (fsSync.existsSync(localPath)) {
      return `file://${localPath}`;
    }

    // 远程 URL
    if (this.config.remoteUrl) {
      const v = version ? `?v=${version}` : '';
      return `${this.config.remoteUrl}/models/${modelId}/download${v}`;
    }

    return null;
  }

  /**
   * 搜索模型
   */
  async search(query: string, filters?: SearchFilters): Promise<ModelManifest[]> {
    let results: ModelManifest[] = [];

    // 本地搜索
    if (this.index) {
      for (const manifest of Object.values(this.index.models)) {
        if (this.matchesQuery(manifest, query) && this.matchesFilters(manifest, filters)) {
          results.push(manifest);
        }
      }
    }

    // 远程搜索
    if (this.config.remoteUrl) {
      try {
        const params = new URLSearchParams({ q: query });
        if (filters?.domain) params.set('domain', filters.domain);
        if (filters?.tags) params.set('tags', filters.tags.join(','));

        const res = await fetch(`${this.config.remoteUrl}/search?${params}`, {
          headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const remote = await res.json() as ModelManifest[];
          // 去重合并
          const existingIds = new Set(results.map(r => r.name));
          for (const m of remote) {
            if (!existingIds.has(m.name)) results.push(m);
          }
        }
      } catch { /* 远程不可用 */ }
    }

    return results;
  }

  /**
   * 列出本地已缓存的模型
   */
  listLocal(): ModelManifest[] {
    if (!this.index) return [];
    return Object.values(this.index.models).filter(m => {
      const localPath = this.getLocalPath(m.name);
      return fsSync.existsSync(localPath);
    });
  }

  /**
   * 列出所有已知模型（本地索引中的）
   */
  listAll(): ModelManifest[] {
    if (!this.index) return [];
    return Object.values(this.index.models);
  }

  // ── 发布（本地） ──

  /**
   * 注册模型到本地仓库
   */
  async register(manifest: ModelManifest): Promise<void> {
    if (!this.index) {
      this.index = { version: '1.0.0', models: {}, updatedAt: Date.now() };
    }
    this.index.models[manifest.name] = manifest;
    this.index.updatedAt = Date.now();
    await this.saveIndex();
  }

  /**
   * 注销模型
   */
  async unregister(modelId: string): Promise<boolean> {
    if (!this.index || !this.index.models[modelId]) return false;
    delete this.index.models[modelId];
    this.index.updatedAt = Date.now();
    await this.saveIndex();
    return true;
  }

  // ── 下载 ──

  /**
   * 下载模型到本地缓存
   */
  async download(modelId: string): Promise<{ success: boolean; localPath: string; error?: string }> {
    const localPath = this.getLocalPath(modelId);

    // 已存在
    if (fsSync.existsSync(localPath)) {
      return { success: true, localPath };
    }

    const url = await this.getDownloadUrl(modelId);
    if (!url) {
      return { success: false, localPath, error: '无下载地址' };
    }

    // 本地文件
    if (url.startsWith('file://')) {
      return { success: true, localPath: url.replace('file://', '') };
    }

    // 远程下载
    try {
      const res = await fetch(url, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        return { success: false, localPath, error: `下载失败: HTTP ${res.status}` };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, buffer);

      return { success: true, localPath };
    } catch (err) {
      return { success: false, localPath, error: (err as Error).message };
    }
  }

  /**
   * 删除本地缓存
   */
  async removeLocal(modelId: string): Promise<boolean> {
    const localPath = this.getLocalPath(modelId);
    try {
      await fs.unlink(localPath);
      return true;
    } catch {
      return false;
    }
  }

  // ── 内部方法 ──

  private getLocalPath(modelId: string): string {
    return path.join(this.config.localDir, `${modelId}.ta`);
  }

  private async loadIndex(): Promise<void> {
    const indexPath = path.join(this.config.localDir, 'index.json');
    try {
      const raw = await fs.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(raw);
    } catch {
      this.index = { version: '1.0.0', models: {}, updatedAt: Date.now() };
      await this.saveIndex();
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.index) return;
    const indexPath = path.join(this.config.localDir, 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
  }

  private matchesQuery(manifest: ModelManifest, query: string): boolean {
    const q = query.toLowerCase();
    return (
      manifest.name.toLowerCase().includes(q) ||
      manifest.description.toLowerCase().includes(q) ||
      manifest.domain.toLowerCase().includes(q) ||
      manifest.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  private matchesFilters(manifest: ModelManifest, filters?: SearchFilters): boolean {
    if (!filters) return true;
    if (filters.domain && manifest.domain !== filters.domain) return false;
    if (filters.architecture && manifest.architecture !== filters.architecture) return false;
    if (filters.author && manifest.author !== filters.author) return false;
    if (filters.tags?.length && !filters.tags.some(t => manifest.tags.includes(t))) return false;
    return true;
  }

  /**
   * 获取统计信息
   */
  stats(): { total: number; cached: number; remoteUrl: string | null } {
    const all = this.listAll();
    const cached = all.filter(m => fsSync.existsSync(this.getLocalPath(m.name))).length;
    return {
      total: all.length,
      cached,
      remoteUrl: this.config.remoteUrl ?? null,
    };
  }
}
