/**
 * 三进制模型安装器
 *
 * 管理模型的安装、卸载、更新。
 * 与 ShopCatalog 协同：商城购买 → 安装器下载安装。
 *
 * 模型包格式：.ta 文件 + manifest.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { TernaryModel, TernaryModelMeta } from '../ternary/format.js';
import type { TernaryModelManager } from '../ternary/manager.js';
import { decode as decodeTA } from '../ternary/codec.js';

// ── 模型包 manifest ──

export interface ModelManifest {
  /** 包名 */
  name: string;
  /** 版本 */
  version: string;
  /** 领域 */
  domain: string;
  /** 描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 模型架构 */
  architecture: string;
  /** 文件列表 */
  files: { name: string; sha256: string; size: number }[];
  /** 依赖 */
  dependencies: string[];
  /** 标签 */
  tags: string[];
  /** 最低 Buddy 版本 */
  minBuddyVersion: string;
  /** 许可证 */
  license: string;
  /** 发布时间 */
  publishedAt: number;
}

// ── 安装状态 ──

export type InstallStatus = 'not_installed' | 'installing' | 'installed' | 'updating' | 'error';

export interface InstalledModel {
  /** 模型 manifest */
  manifest: ModelManifest;
  /** 安装路径 */
  installPath: string;
  /** 安装时间 */
  installedAt: number;
  /** 文件大小 (bytes) */
  fileSize: number;
  /** 状态 */
  status: InstallStatus;
  /** 是否启用 */
  enabled: boolean;
}

// ── 安装结果 ──

export interface InstallResult {
  success: boolean;
  modelId: string;
  message: string;
  /** 已安装文件 */
  installedFiles: string[];
  /** 耗时 (ms) */
  elapsedMs: number;
  error?: string;
}

// ── 安装器配置 ──

export interface InstallerConfig {
  /** 安装目录 */
  installDir: string;
  /** 缓存目录 */
  cacheDir: string;
  /** 最大并行下载数 */
  maxConcurrent: number;
  /** 是否验证校验和 */
  verifyChecksum: boolean;
}

const DEFAULT_CONFIG: InstallerConfig = {
  installDir: path.join(os.homedir(), '.buddy', 'experts'),
  cacheDir: path.join(os.homedir(), '.buddy', 'cache'),
  maxConcurrent: 3,
  verifyChecksum: true,
};

// ════════════════════════════════════════════════════════
// 模型安装器
// ════════════════════════════════════════════════════════

export class ModelInstaller {
  private config: InstallerConfig;
  private manager: TernaryModelManager | null = null;
  private installed: Map<string, InstalledModel> = new Map();

  constructor(config?: Partial<InstallerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 绑定模型管理器
   */
  setManager(manager: TernaryModelManager): void {
    this.manager = manager;
  }

  /**
   * 初始化：扫描已安装模型
   */
  async init(): Promise<void> {
    await fs.mkdir(this.config.installDir, { recursive: true });
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    await this.scanInstalled();
  }

  /**
   * 安装模型（从本地 .ta 文件）
   */
  async installFromFile(taFilePath: string, manifest: Partial<ModelManifest> = {}): Promise<InstallResult> {
    const startTime = performance.now();

    try {
      // 读取 .ta 文件
      const buffer = await fs.readFile(taFilePath);
      const model = decodeTA(buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ));

      // 构建 manifest
      const fullManifest: ModelManifest = {
        name: manifest.name ?? model.meta.domain,
        version: manifest.version ?? model.meta.version,
        domain: model.meta.domain,
        description: manifest.description ?? `${model.meta.domain} 专家模型`,
        author: manifest.author ?? 'community',
        architecture: model.meta.architecture,
        files: [{ name: path.basename(taFilePath), sha256: '', size: buffer.length }],
        dependencies: manifest.dependencies ?? [],
        tags: manifest.tags ?? [],
        minBuddyVersion: manifest.minBuddyVersion ?? '0.1.0',
        license: manifest.license ?? 'MIT',
        publishedAt: Date.now(),
      };

      // 安装目录
      const installPath = path.join(this.config.installDir, fullManifest.domain);
      await fs.mkdir(installPath, { recursive: true });

      // 复制文件
      const destPath = path.join(installPath, path.basename(taFilePath));
      await fs.copyFile(taFilePath, destPath);

      // 写入 manifest
      await fs.writeFile(
        path.join(installPath, 'manifest.json'),
        JSON.stringify(fullManifest, null, 2),
      );

      // 注册到管理器
      if (this.manager) {
        await this.manager.save(model);
      }

      // 记录安装信息
      const installed: InstalledModel = {
        manifest: fullManifest,
        installPath,
        installedAt: Date.now(),
        fileSize: buffer.length,
        status: 'installed',
        enabled: true,
      };
      this.installed.set(fullManifest.domain, installed);

      return {
        success: true,
        modelId: fullManifest.domain,
        message: `已安装 ${fullManifest.name} v${fullManifest.version}`,
        installedFiles: [destPath, path.join(installPath, 'manifest.json')],
        elapsedMs: Math.round(performance.now() - startTime),
      };
    } catch (err) {
      return {
        success: false,
        modelId: '',
        message: '安装失败',
        installedFiles: [],
        elapsedMs: Math.round(performance.now() - startTime),
        error: String(err),
      };
    }
  }

  /**
   * 安装模型（从内存中的 TernaryModel）
   */
  async installFromModel(model: TernaryModel, meta?: Partial<ModelManifest>): Promise<InstallResult> {
    const startTime = performance.now();

    try {
      if (!this.manager) {
        throw new Error('Model manager not set. Call setManager() first.');
      }

      // 保存到管理器
      await this.manager.save(model);

      // 构建 manifest
      const manifest: ModelManifest = {
        name: meta?.name ?? model.meta.domain,
        version: meta?.version ?? model.meta.version,
        domain: model.meta.domain,
        description: meta?.description ?? `${model.meta.domain} 专家模型`,
        author: meta?.author ?? 'local',
        architecture: model.meta.architecture,
        files: [],
        dependencies: meta?.dependencies ?? [],
        tags: meta?.tags ?? [],
        minBuddyVersion: meta?.minBuddyVersion ?? '0.1.0',
        license: meta?.license ?? 'MIT',
        publishedAt: Date.now(),
      };

      this.installed.set(manifest.domain, {
        manifest,
        installPath: this.config.installDir,
        installedAt: Date.now(),
        fileSize: 0,
        status: 'installed',
        enabled: true,
      });

      return {
        success: true,
        modelId: manifest.domain,
        message: `已安装 ${manifest.name}`,
        installedFiles: [],
        elapsedMs: Math.round(performance.now() - startTime),
      };
    } catch (err) {
      return {
        success: false,
        modelId: model.meta.domain,
        message: '安装失败',
        installedFiles: [],
        elapsedMs: Math.round(performance.now() - startTime),
        error: String(err),
      };
    }
  }

  /**
   * 卸载模型
   */
  async uninstall(domain: string): Promise<InstallResult> {
    const startTime = performance.now();

    try {
      const installed = this.installed.get(domain);

      // 删除安装目录
      if (installed) {
        await fs.rm(installed.installPath, { recursive: true, force: true });
      }

      // 从管理器删除
      if (this.manager) {
        await this.manager.delete(domain);
      }

      this.installed.delete(domain);

      return {
        success: true,
        modelId: domain,
        message: `已卸载 ${domain}`,
        installedFiles: [],
        elapsedMs: Math.round(performance.now() - startTime),
      };
    } catch (err) {
      return {
        success: false,
        modelId: domain,
        message: '卸载失败',
        installedFiles: [],
        elapsedMs: Math.round(performance.now() - startTime),
        error: String(err),
      };
    }
  }

  /**
   * 启用/禁用模型
   */
  setEnabled(domain: string, enabled: boolean): boolean {
    const installed = this.installed.get(domain);
    if (!installed) return false;
    installed.enabled = enabled;
    return true;
  }

  /**
   * 列出已安装模型
   */
  listInstalled(): InstalledModel[] {
    return Array.from(this.installed.values());
  }

  /**
   * 获取已安装模型信息
   */
  getInstalled(domain: string): InstalledModel | null {
    return this.installed.get(domain) ?? null;
  }

  /**
   * 检查是否已安装
   */
  isInstalled(domain: string): boolean {
    return this.installed.has(domain);
  }

  /**
   * 获取已安装模型总数
   */
  get installedCount(): number {
    return this.installed.size;
  }

  // ── 内部方法 ──

  private async scanInstalled(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.installDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(this.config.installDir, entry.name, 'manifest.json');
        try {
          const data = await fs.readFile(manifestPath, 'utf-8');
          const manifest: ModelManifest = JSON.parse(data);

          // 计算目录大小
          let fileSize = 0;
          const dirPath = path.join(this.config.installDir, entry.name);
          const files = await fs.readdir(dirPath);
          for (const f of files) {
            const stat = await fs.stat(path.join(dirPath, f));
            fileSize += stat.size;
          }

          this.installed.set(manifest.domain, {
            manifest,
            installPath: dirPath,
            installedAt: manifest.publishedAt,
            fileSize,
            status: 'installed',
            enabled: true,
          });
        } catch {
          // 无效的 manifest，跳过
        }
      }
    } catch {
      // 安装目录不存在
    }
  }
}
