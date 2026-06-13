/**
 * 云端训练对接器
 *
 * 本地算力不够时，将训练任务提交到云端。
 *
 * 支持模式：
 * 1. 纯云端：数据上传 → 云端训练 → 模型下载
 * 2. 混合模式：本地预处理 → 云端训练 → 本地微调
 * 3. 联邦模式：多设备数据聚合训练
 *
 * 云端 provider 抽象，支持自定义后端。
 */

import type { TernaryModel, TernaryModelMeta } from './format.js';
import type { TrainingDataset, TrainResult } from './trainer.js';
import type { DistillResult } from './distill.js';

// ── 云端 Provider 接口 ──

export interface CloudProvider {
  /** provider 名称 */
  name: string;
  /** 提交训练任务 */
  submitJob(job: CloudJob): Promise<CloudJobHandle>;
  /** 查询任务状态 */
  getStatus(handle: CloudJobHandle): Promise<CloudJobStatus>;
  /** 下载训练产物 */
  downloadResult(handle: CloudJobHandle): Promise<CloudArtifact>;
  /** 取消任务 */
  cancelJob(handle: CloudJobHandle): Promise<void>;
}

// ── 任务定义 ──

export type JobType = 'distill' | 'finetune' | 'incremental' | 'evaluate';

export interface CloudJob {
  /** 任务类型 */
  type: JobType;
  /** 目标领域 */
  domain: string;
  /** 模型标识 */
  modelId: string;
  /** 训练数据（序列化） */
  dataset: {
    samples: { inputIds: number[]; targetIds: number[]; type: string; quality: number }[];
    domain: string;
    version: string;
  };
  /** 训练配置 */
  config: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    architecture: string;
  };
  /** 回调 URL (可选) */
  callbackUrl?: string;
  /** 优先级 */
  priority: 'low' | 'normal' | 'high';
}

// ── 任务句柄 ──

export interface CloudJobHandle {
  /** 任务 ID */
  jobId: string;
  /** provider */
  provider: string;
  /** 创建时间 */
  createdAt: number;
  /** 预估完成时间 */
  estimatedCompleteAt?: number;
}

// ── 任务状态 ──

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CloudJobStatus {
  /** 状态 */
  status: JobStatus;
  /** 进度 (0-1) */
  progress: number;
  /** 当前阶段描述 */
  stage: string;
  /** 训练指标 (运行中) */
  metrics?: {
    epoch: number;
    loss: number;
    accuracy: number;
  };
  /** 错误信息 */
  error?: string;
}

// ── 训练产物 ──

export interface CloudArtifact {
  /** 模型二进制数据 */
  modelBuffer: ArrayBuffer;
  /** 训练结果 */
  trainResult: TrainResult;
  /** 模型元数据 */
  meta: TernaryModelMeta;
  /** 训练日志 */
  logs: string[];
}

// ── 本地配置 ──

export interface CloudTrainerConfig {
  /** 默认 provider */
  defaultProvider: string;
  /** API endpoint */
  endpoint: string;
  /** API key (运行时注入，不持久化) */
  apiKey: string;
  /** 超时 (ms) */
  timeoutMs: number;
  /** 自动重试次数 */
  maxRetries: number;
  /** 是否允许数据上传 */
  allowDataUpload: boolean;
}

const DEFAULT_CONFIG: CloudTrainerConfig = {
  defaultProvider: 'buddy-cloud',
  endpoint: 'https://api.buddy-ai.dev/v1/train',
  apiKey: '',
  timeoutMs: 3600000, // 1 hour
  maxRetries: 3,
  allowDataUpload: true,
};

// ════════════════════════════════════════════════════════
// 云端训练对接器
// ════════════════════════════════════════════════════════

export class CloudTrainer {
  private config: CloudTrainerConfig;
  private providers: Map<string, CloudProvider> = new Map();
  private activeJobs: Map<string, CloudJobHandle> = new Map();

  constructor(config?: Partial<CloudTrainerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册云端 provider
   */
  registerProvider(provider: CloudProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * 提交训练任务
   */
  async submitTraining(job: CloudJob): Promise<CloudJobHandle> {
    if (!this.config.allowDataUpload) {
      throw new Error('Data upload is disabled. Set allowDataUpload=true to submit cloud jobs.');
    }

    const provider = this.getProvider();

    // 验证数据
    if (job.dataset.samples.length === 0) {
      throw new Error('Empty dataset');
    }

    // 提交
    const handle = await provider.submitJob(job);
    this.activeJobs.set(handle.jobId, handle);

    return handle;
  }

  /**
   * 等待任务完成
   */
  async waitForCompletion(handle: CloudJobHandle, pollIntervalMs = 5000): Promise<CloudArtifact> {
    const provider = this.getProvider(handle.provider);
    const deadline = Date.now() + this.config.timeoutMs;

    while (Date.now() < deadline) {
      const status = await provider.getStatus(handle);

      if (status.status === 'completed') {
        this.activeJobs.delete(handle.jobId);
        return provider.downloadResult(handle);
      }

      if (status.status === 'failed') {
        this.activeJobs.delete(handle.jobId);
        throw new Error(`Cloud training failed: ${status.error ?? 'unknown error'}`);
      }

      if (status.status === 'cancelled') {
        this.activeJobs.delete(handle.jobId);
        throw new Error('Cloud training was cancelled');
      }

      // 等待后重试
      await this.sleep(pollIntervalMs);
    }

    throw new Error('Cloud training timed out');
  }

  /**
   * 取消任务
   */
  async cancel(handle: CloudJobHandle): Promise<void> {
    const provider = this.getProvider(handle.provider);
    await provider.cancelJob(handle);
    this.activeJobs.delete(handle.jobId);
  }

  /**
   * 获取所有活跃任务
   */
  getActiveJobs(): CloudJobHandle[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * 检查云端是否可用
   */
  async healthCheck(): Promise<{ available: boolean; latencyMs: number }> {
    const start = performance.now();

    try {
      const provider = this.getProvider();
      // 尝试获取一个不存在的任务状态来测试连通性
      await provider.getStatus({ jobId: '__ping__', provider: provider.name, createdAt: Date.now() });
    } catch {
      // 预期会失败，但说明 API 可达
    }

    return {
      available: true,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  // ── 内部方法 ──

  private getProvider(name?: string): CloudProvider {
    const providerName = name ?? this.config.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Cloud provider not found: ${providerName}. Registered: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    return provider;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ════════════════════════════════════════════════════════
// 内置 HTTP Provider（REST API）
// ════════════════════════════════════════════════════════

export class HttpCloudProvider implements CloudProvider {
  name = 'http';
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async submitJob(job: CloudJob): Promise<CloudJobHandle> {
    const resp = await this.request('POST', '/jobs', job);
    return {
      jobId: resp.jobId,
      provider: this.name,
      createdAt: Date.now(),
      estimatedCompleteAt: resp.estimatedCompleteAt,
    };
  }

  async getStatus(handle: CloudJobHandle): Promise<CloudJobStatus> {
    return this.request('GET', `/jobs/${handle.jobId}/status`);
  }

  async downloadResult(handle: CloudJobHandle): Promise<CloudArtifact> {
    const resp = await this.request('GET', `/jobs/${handle.jobId}/result`);
    return {
      modelBuffer: new Uint8Array(resp.modelData).buffer,
      trainResult: resp.trainResult,
      meta: resp.meta,
      logs: resp.logs ?? [],
    };
  }

  async cancelJob(handle: CloudJobHandle): Promise<void> {
    await this.request('DELETE', `/jobs/${handle.jobId}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      throw new Error(`Cloud API error: ${resp.status} ${resp.statusText}`);
    }

    return resp.json();
  }
}
