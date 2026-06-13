/**
 * LoRA 微调服务 — 云端训练对接 + 本地权重管理
 *
 * 流程：
 * 1. 从 STMP 导出领域知识 → 脱敏 → JSONL
 * 2. 提交到云端微调服务
 * 3. 轮询/Webhook 获取训练进度
 * 4. 下载权重到本地 ~/.buddy/weights/
 * 5. 支持权重列表、删除、加载
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  LoRAConfig, LoRATrainingRequest, LoRATrainingJob,
  LoRAWeights, KnowledgeExport, ILoRAService, LoRAHyperparameters,
} from '../billing/lora-interface.js';
import { DEFAULT_HYPERPARAMETERS } from '../billing/lora-interface.js';
import type { STMPStore } from '../memory/stmp.js';
import type { CognitiveEngine } from '../cognitive/engine.js';
import { TrainingExporter } from '../intelligence/training-exporter.js';

// ── 本地权重元数据 ──

interface LocalWeightMeta {
  id: string;
  domain: string;
  jobId: string;
  version: string;
  sizeBytes: number;
  checksum: string;
  localPath: string;
  loadedAt: number;
  metrics?: {
    loss: number;
    accuracy: number;
    perplexity: number;
  };
}

// ── 训练状态轮询配置 ──

interface PollConfig {
  intervalMs: number;
  maxAttempts: number;
}

const DEFAULT_POLL: PollConfig = {
  intervalMs: 10_000,
  maxAttempts: 360,  // 1 小时
};

/**
 * LoRA 微调服务实现
 */
export class LoRAService implements ILoRAService {
  private config: LoRAConfig;
  private stmp: STMPStore;
  private cognitive: CognitiveEngine;
  private exporter: TrainingExporter;
  private weightsDir: string;
  private jobsFile: string;
  private verbose: boolean;

  // 内存中缓存的训练任务
  private jobs: Map<string, LoRATrainingJob> = new Map();
  // 本地权重元数据
  private localWeights: Map<string, LocalWeightMeta> = new Map();
  // 等待重试的任务队列
  private pendingJobs: Map<string, { job: LoRATrainingJob; request: LoRATrainingRequest; retryCount: number }> = new Map();
  // 重试定时器
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    stmp: STMPStore,
    cognitive: CognitiveEngine,
    config?: Partial<LoRAConfig>,
    verbose = false,
  ) {
    this.stmp = stmp;
    this.cognitive = cognitive;
    this.verbose = verbose;

    const dbDir = path.join(process.env.HOME ?? '/tmp', '.buddy');
    this.weightsDir = path.join(dbDir, 'weights');
    this.jobsFile = path.join(dbDir, 'lora-jobs.json');

    this.config = {
      apiEndpoint: config?.apiEndpoint ?? '',
      apiKey: config?.apiKey ?? '',
      baseModel: config?.baseModel ?? 'buddy-base-v1',
      enabled: config?.enabled ?? false,
    };

    this.exporter = new TrainingExporter(stmp, cognitive, {
      outputDir: path.join(dbDir, 'training-data'),
    }, verbose);
  }

  /**
   * 初始化（加载本地权重和任务记录）
   */
  async init(): Promise<void> {
    await fs.mkdir(this.weightsDir, { recursive: true });
    await fs.mkdir(path.join(process.env.HOME ?? '/tmp', '.buddy', 'training-data'), { recursive: true });
    await this.loadJobs();
    await this.scanLocalWeights();
    this.startRetryTimer();
  }

  /**
   * 手动重试等待中的任务
   */
  async retryJob(jobId: string): Promise<LoRATrainingJob> {
    const pending = this.pendingJobs.get(jobId);
    if (!pending) throw new Error(`任务 ${jobId} 不在等待队列中`);
    this.pendingJobs.delete(jobId);
    return this.submitTraining(pending.request);
  }

  /**
   * 获取等待重试的任务列表
   */
  listPendingJobs(): Array<{ jobId: string; domain: string; retryCount: number; error?: string }> {
    return [...this.pendingJobs.values()].map(p => ({
      jobId: p.job.id,
      domain: p.job.domain,
      retryCount: p.retryCount,
      error: p.job.error,
    }));
  }

  /**
   * 启动重试定时器（每 60 秒检查一次等待队列）
   */
  private startRetryTimer(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(async () => {
      if (!this.config.enabled || !this.config.apiEndpoint) return;
      for (const [id, pending] of this.pendingJobs) {
        if (pending.retryCount >= 3) continue;
        try {
          this.pendingJobs.delete(id);
          await this.submitTraining(pending.request);
        } catch {
          pending.retryCount++;
        }
      }
    }, 60_000);
  }

  // ── ILoRAService 接口实现 ──

  /**
   * 提交训练任务
   */
  async submitTraining(request: LoRATrainingRequest): Promise<LoRATrainingJob> {
    if (!this.config.enabled || !this.config.apiEndpoint) {
      // 不抛异常，返回 queued 状态，等待云端配置后重试
      const jobId = `lora-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const job: LoRATrainingJob = {
        id: jobId,
        status: 'queued',
        domain: request.domain,
        progress: 0,
        createdAt: Date.now(),
        error: '云端服务未配置，任务已入队等待',
      };
      this.pendingJobs.set(jobId, { job, request, retryCount: 0 });
      this.jobs.set(jobId, job);
      await this.saveJobs();
      if (this.verbose) console.log(`[LoRA] 训练任务已入队（云端未配置）: ${jobId} (${request.domain})`);
      return job;
    }

    const jobId = `lora-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const job: LoRATrainingJob = {
      id: jobId,
      status: 'queued',
      domain: request.domain,
      progress: 0,
      createdAt: Date.now(),
    };

    // 调用云端 API
    try {
      const response = await fetch(`${this.config.apiEndpoint}/v1/training/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          job_id: jobId,
          domain: request.domain,
          base_model: this.config.baseModel,
          training_data: request.trainingData,
          hyperparameters: request.hyperparameters,
          callback_url: request.callbackUrl,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 错误 ${response.status}: ${errText}`);
      }

      const data = await response.json() as { job_id?: string; status?: string };
      if (data.job_id) job.id = data.job_id;
      if (data.status) job.status = data.status as LoRATrainingJob['status'];
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      // 失败时加入重试队列
      this.pendingJobs.set(job.id, { job, request, retryCount: 1 });
      if (this.verbose) console.warn(`[LoRA] 提交训练失败，已加入重试队列: ${(err as Error).message}`);
    }

    this.jobs.set(job.id, job);
    await this.saveJobs();

    if (this.verbose) console.log(`[LoRA] 训练任务已提交: ${job.id} (${request.domain})`);
    return job;
  }

  /**
   * 查询训练状态
   */
  async getJobStatus(jobId: string): Promise<LoRATrainingJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`训练任务不存在: ${jobId}`);

    // 如果已完成/失败，直接返回缓存
    if (job.status === 'completed' || job.status === 'failed') return job;

    // 轮询云端 API
    if (this.config.enabled && this.config.apiEndpoint) {
      try {
        const response = await fetch(
          `${this.config.apiEndpoint}/v1/training/status/${jobId}`,
          { headers: { 'Authorization': `Bearer ${this.config.apiKey}` } }
        );

        if (response.ok) {
          const data = await response.json() as {
            status?: string;
            progress?: number;
            error?: string;
            weights_url?: string;
            metrics?: { loss: number; accuracy: number; perplexity: number };
          };

          job.status = (data.status as LoRATrainingJob['status']) ?? job.status;
          job.progress = data.progress ?? job.progress;
          if (data.error) job.error = data.error;
          if (data.weights_url) job.weightsUrl = data.weights_url;
          if (data.metrics) job.metrics = data.metrics;
          if (job.status === 'completed') job.completedAt = Date.now();

          this.jobs.set(jobId, job);
          await this.saveJobs();
        }
      } catch (err) {
        if (this.verbose) console.warn(`[LoRA] 查询状态失败: ${(err as Error).message}`);
      }
    }

    return job;
  }

  /**
   * 取消训练
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (this.config.enabled && this.config.apiEndpoint && job.status === 'training') {
      try {
        await fetch(
          `${this.config.apiEndpoint}/v1/training/cancel/${jobId}`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
          }
        );
      } catch { /* ignore */ }
    }

    job.status = 'failed';
    job.error = '用户取消';
    this.jobs.set(jobId, job);
    await this.saveJobs();
    return true;
  }

  /**
   * 下载训练好的权重
   */
  async downloadWeights(jobId: string): Promise<LoRAWeights> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`训练任务不存在: ${jobId}`);
    if (job.status !== 'completed') throw new Error(`训练未完成: ${job.status}`);
    if (!job.weightsUrl) throw new Error('权重下载地址不存在');

    const weightsId = `w-${jobId}`;
    const fileName = `${job.domain}_${jobId}.safetensors`;
    const localPath = path.join(this.weightsDir, fileName);

    // 下载
    const response = await fetch(job.weightsUrl);
    if (!response.ok) throw new Error(`下载失败: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(localPath, buffer);

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    const weights: LoRAWeights = {
      id: weightsId,
      jobId,
      domain: job.domain,
      sizeBytes: buffer.length,
      checksum,
      downloadUrl: job.weightsUrl,
      localPath,
      version: '1.0.0',
    };

    // 保存元数据
    const meta: LocalWeightMeta = {
      id: weightsId,
      domain: job.domain,
      jobId,
      version: weights.version,
      sizeBytes: buffer.length,
      checksum,
      localPath,
      loadedAt: Date.now(),
      metrics: job.metrics,
    };
    this.localWeights.set(weightsId, meta);
    await this.saveLocalWeightsMeta();

    if (this.verbose) console.log(`[LoRA] 权重已下载: ${fileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return weights;
  }

  /**
   * 列出用户的所有权重
   */
  async listWeights(domain?: string): Promise<LoRAWeights[]> {
    const results: LoRAWeights[] = [];
    for (const meta of this.localWeights.values()) {
      if (domain && meta.domain !== domain) continue;
      results.push({
        id: meta.id,
        jobId: meta.jobId,
        domain: meta.domain,
        sizeBytes: meta.sizeBytes,
        checksum: meta.checksum,
        downloadUrl: '',
        localPath: meta.localPath,
        version: meta.version,
      });
    }
    return results;
  }

  /**
   * 删除权重
   */
  async deleteWeights(weightsId: string): Promise<boolean> {
    const meta = this.localWeights.get(weightsId);
    if (!meta) return false;

    try {
      await fs.unlink(meta.localPath);
    } catch { /* 文件可能已删除 */ }

    this.localWeights.delete(weightsId);
    await this.saveLocalWeightsMeta();
    return true;
  }

  /**
   * 导出脱敏知识数据
   */
  async exportKnowledgeForTraining(domain: string): Promise<KnowledgeExport[]> {
    const nodes = await this.fetchDomainNodes(domain);
    return nodes
      .filter(n => n.confidence >= 0.7 && n.content.length >= 10)
      .map(n => ({
        id: n.id,
        content: this.anonymize(n.content),
        domain,
        type: n.sourceType ?? 'general',
        confidence: n.confidence,
      }));
  }

  // ── 扩展方法 ──

  /**
   * 一键流程：导出 → 提交训练
   */
  async startTraining(domain: string, hyperparams?: Partial<LoRAHyperparameters>): Promise<LoRATrainingJob> {
    const trainingData = await this.exportKnowledgeForTraining(domain);
    if (trainingData.length === 0) {
      throw new Error(`领域「${domain}」没有足够的知识可用于训练`);
    }

    return this.submitTraining({
      trainingData,
      domain,
      hyperparameters: { ...DEFAULT_HYPERPARAMETERS, ...hyperparams },
    });
  }

  /**
   * 获取训练任务列表
   */
  listJobs(): LoRATrainingJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取本地权重元数据列表
   */
  getLocalWeightsMeta(): LocalWeightMeta[] {
    return [...this.localWeights.values()];
  }

  /**
   * 获取领域是否已有本地权重
   */
  hasLocalWeights(domain: string): boolean {
    for (const meta of this.localWeights.values()) {
      if (meta.domain === domain) return true;
    }
    return false;
  }

  /**
   * 更新配置
   */
  updateConfig(patch: Partial<LoRAConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /**
   * 获取配置（不含敏感信息）
   */
  getConfig(): { enabled: boolean; baseModel: string; hasEndpoint: boolean; hasApiKey: boolean } {
    return {
      enabled: this.config.enabled,
      baseModel: this.config.baseModel,
      hasEndpoint: !!this.config.apiEndpoint,
      hasApiKey: !!this.config.apiKey,
    };
  }

  // ── 私有方法 ──

  private async fetchDomainNodes(domain: string): Promise<Array<{
    id: string;
    content: string;
    confidence: number;
    sourceType?: string;
  }>> {
    const nodes: Array<{ id: string; content: string; confidence: number; sourceType?: string }> = [];
    try {
      const result = await this.stmp.retrieve(domain, { maxPrimary: 50, maxAssociative: 20 });
      for (const node of [...result.primary, ...result.associative]) {
        nodes.push({
          id: node.id,
          content: node.content,
          confidence: node.emotional?.importance ? node.emotional.importance / 10 : 0.5,
          sourceType: node.source,
        });
      }
    } catch { /* ignore */ }
    return nodes;
  }

  private anonymize(content: string): string {
    return content
      .replace(/\/[\w/.-]+\.\w{1,5}/g, '[PATH]')
      .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[IP]')
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
      .replace(/\b(sk-|sk_|ghp_|gho_|Bearer\s+)[\w-]{20,}/gi, '[TOKEN]');
  }

  private async loadJobs(): Promise<void> {
    try {
      const raw = await fs.readFile(this.jobsFile, 'utf-8');
      const data = JSON.parse(raw) as LoRATrainingJob[];
      for (const job of data) {
        this.jobs.set(job.id, job);
      }
    } catch { /* 文件不存在 */ }
  }

  private async saveJobs(): Promise<void> {
    const data = [...this.jobs.values()];
    await fs.writeFile(this.jobsFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async scanLocalWeights(): Promise<void> {
    try {
      const metaFile = path.join(this.weightsDir, 'meta.json');
      const raw = await fs.readFile(metaFile, 'utf-8');
      const data = JSON.parse(raw) as LocalWeightMeta[];
      for (const meta of data) {
        // 验证文件是否存在
        if (fss.existsSync(meta.localPath)) {
          this.localWeights.set(meta.id, meta);
        }
      }
    } catch { /* 文件不存在 */ }
  }

  private async saveLocalWeightsMeta(): Promise<void> {
    const metaFile = path.join(this.weightsDir, 'meta.json');
    const data = [...this.localWeights.values()];
    await fs.writeFile(metaFile, JSON.stringify(data, null, 2), 'utf-8');
  }
}
