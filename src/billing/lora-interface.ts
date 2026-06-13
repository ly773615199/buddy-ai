/**
 * 云端 LoRA 微调接口预留
 * 不启用，只做架构准备。等用户规模达到后正式启用。
 *
 * 流程：
 * 1. 用户本地知识 → 脱敏导出
 * 2. 上传到云端微调服务
 * 3. LoRA 权重下载到本地推理
 * 4. 本地模型加载 LoRA 权重进行推理
 */

// ── 类型定义（接口合同）──

export interface LoRAConfig {
  /** 微调服务 API 地址 */
  apiEndpoint: string;
  /** API Key */
  apiKey: string;
  /** 基础模型名称 */
  baseModel: string;
  /** 是否启用（架构预留，默认 false） */
  enabled: boolean;
}

export interface LoRATrainingRequest {
  /** 训练数据（脱敏后的知识节点） */
  trainingData: KnowledgeExport[];
  /** 目标领域 */
  domain: string;
  /** 微调参数 */
  hyperparameters: LoRAHyperparameters;
  /** Webhook 回调地址 */
  callbackUrl?: string;
}

export interface LoRAHyperparameters {
  rank: number;             // LoRA rank (default: 16)
  alpha: number;            // LoRA alpha (default: 32)
  epochs: number;           // 训练轮数 (default: 3)
  batchSize: number;        // 批次大小 (default: 4)
  learningRate: number;     // 学习率 (default: 2e-4)
}

export interface LoRATrainingJob {
  id: string;
  status: 'queued' | 'training' | 'completed' | 'failed';
  domain: string;
  progress: number;         // 0-100
  createdAt: number;
  completedAt?: number;
  error?: string;
  /** 训练完成后的权重下载地址 */
  weightsUrl?: string;
  /** 模型评估指标 */
  metrics?: {
    loss: number;
    accuracy: number;
    perplexity: number;
  };
}

export interface LoRAWeights {
  /** 权重 ID */
  id: string;
  /** 关联的训练任务 */
  jobId: string;
  /** 领域 */
  domain: string;
  /** 权重文件大小（字节） */
  sizeBytes: number;
  /** 校验和 */
  checksum: string;
  /** 下载地址 */
  downloadUrl: string;
  /** 本地缓存路径 */
  localPath?: string;
  /** 版本 */
  version: string;
}

export interface KnowledgeExport {
  /** 知识节点 ID */
  id: string;
  /** 内容（已脱敏） */
  content: string;
  /** 领域 */
  domain: string;
  /** 知识类型 */
  type: string;
  /** 置信度 */
  confidence: number;
}

// ── 接口定义（不实现，供后续填充）──

/**
 * LoRA 微调服务接口
 *
 * 实际部署时需要：
 * 1. 配置云端 GPU 服务（如 AutoDL、AWS SageMaker）
 * 2. 实现数据脱敏管道
 * 3. 实现权重上传/下载
 * 4. 实现本地模型加载 LoRA 权重
 */
export interface ILoRAService {
  /** 提交训练任务 */
  submitTraining(request: LoRATrainingRequest): Promise<LoRATrainingJob>;

  /** 查询训练状态 */
  getJobStatus(jobId: string): Promise<LoRATrainingJob>;

  /** 取消训练 */
  cancelJob(jobId: string): Promise<boolean>;

  /** 下载训练好的权重 */
  downloadWeights(jobId: string): Promise<LoRAWeights>;

  /** 列出用户的所有权重 */
  listWeights(domain?: string): Promise<LoRAWeights[]>;

  /** 删除权重 */
  deleteWeights(weightsId: string): Promise<boolean>;

  /** 导出脱敏知识数据 */
  exportKnowledgeForTraining(domain: string): Promise<KnowledgeExport[]>;
}

/** 默认 LoRA 配置（未启用） */
export const DEFAULT_LORA_CONFIG: LoRAConfig = {
  apiEndpoint: '',
  apiKey: '',
  baseModel: 'buddy-base-v1',
  enabled: false,  // ← 架构预留，默认关闭
};

/** 默认超参数 */
export const DEFAULT_HYPERPARAMETERS: LoRAHyperparameters = {
  rank: 16,
  alpha: 32,
  epochs: 3,
  batchSize: 4,
  learningRate: 2e-4,
};
