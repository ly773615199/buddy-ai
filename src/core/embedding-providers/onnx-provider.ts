/**
 * ONNX Embedding Provider — 本地推理，零外部 API 依赖
 *
 * 使用 @huggingface/transformers 加载 ONNX 模型，在本地 CPU 上运行。
 * 首次运行自动下载模型到 ~/.buddy/models/，后续直接加载缓存。
 *
 * 支持模型：BAAI/bge-small-zh-v1.5（512维，中文优化）
 *
 * 使用方式：
 *   const provider = new ONNXEmbeddingProvider();
 *   await provider.init();  // 首次下载 + 加载模型
 *   const vec = await provider.embed('你好世界');
 */

export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
  isAvailable(): boolean;
}

export class ONNXEmbeddingProvider implements EmbeddingProvider {
  name = 'onnx-bge-small-zh';
  dimensions = 512;
  private pipe: any = null;
  private initPromise: Promise<void> | null = null;
  private initError: string | null = null;

  // 模型配置
  private readonly modelId: string;
  private readonly modelDir: string;
  private readonly verbose: boolean;

  constructor(options?: { modelId?: string; modelDir?: string; verbose?: boolean }) {
    this.modelId = options?.modelId ?? 'BAAI/bge-small-zh-v1.5';
    this.modelDir = options?.modelDir ?? '';
    this.verbose = options?.verbose ?? false;
  }

  /**
   * 初始化模型（首次运行下载，后续加载缓存）
   * 幂等：多次调用只初始化一次
   */
  async init(): Promise<void> {
    if (this.pipe) return;
    if (this.initPromise) return this.initPromise;
    if (this.initError) throw new Error(this.initError);

    this.initPromise = this._doInit();
    await this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // 动态导入（避免未安装时启动报错）
      // @ts-ignore — 模块可能未安装
      const { pipeline, env } = await import('@huggingface/transformers' as string);

      // 配置模型缓存目录
      if (this.modelDir) {
        env.cacheDir = this.modelDir;
      }

      // 国内镜像支持：优先用 HF_ENDPOINT 环境变量，否则默认 hf-mirror.com
      if (!env.HF_ENDPOINT && !process.env.HF_ENDPOINT) {
        // 检测是否需要镜像（简单策略：国内环境默认用镜像）
        const useMirror = process.env.HF_MIRROR !== '0'; // 默认启用，HF_MIRROR=0 关闭
        if (useMirror) {
          env.HF_ENDPOINT = 'https://hf-mirror.com';
          if (this.verbose) console.log('[ONNXEmbedding] 使用 HuggingFace 国内镜像');
        }
      }

      // 禁用远程模型检查（离线友好）
      env.allowRemoteModels = true;
      env.allowLocalModels = true;

      console.log(`[ONNXEmbedding] 加载模型: ${this.modelId}...`);
      const t0 = Date.now();

      this.pipe = await pipeline('feature-extraction', this.modelId, {
        device: 'cpu',
        dtype: 'fp32',
      });

      console.log(`[ONNXEmbedding] 模型就绪 (${Date.now() - t0}ms)`);
    } catch (err) {
      this.initError = (err as Error).message;
      this.initPromise = null;
      throw new Error(`[ONNXEmbedding] 初始化失败: ${this.initError}`);
    }
  }

  /**
   * 生成文本的 embedding 向量
   */
  async embed(text: string): Promise<number[]> {
    if (!this.pipe) {
      await this.init();
    }

    // 截断过长文本
    const input = text.slice(0, 2000);

    const output = await this.pipe(input, {
      pooling: 'mean',
      normalize: true,
    });

    // 提取向量数据
    const data = output.data;
    if (data instanceof Float32Array) {
      return Array.from(data);
    }
    // 某些版本返回嵌套结构
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      return data[0] as number[];
    }
    return Array.from(data as ArrayLike<number>);
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.pipe) {
      await this.init();
    }

    const results: number[][] = [];
    // 逐条处理（ONNX 模型通常不支持真正的 batch）
    for (const text of texts) {
      const vec = await this.embed(text);
      results.push(vec);
    }
    return results;
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return this.pipe !== null;
  }

  /**
   * 检查是否可以初始化（依赖是否安装）
   */
  static async canInit(): Promise<boolean> {
    try {
      // @ts-ignore — 模块可能未安装
      await import('@huggingface/transformers' as string);
      return true;
    } catch {
      return false;
    }
  }
}
