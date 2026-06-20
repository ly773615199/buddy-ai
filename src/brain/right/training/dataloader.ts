/**
 * 训练数据加载器 — 对比学习用
 *
 * 支持数据源：
 * 1. 中文语料（逐行读取）
 * 2. 对话日志（从 MemoryStore 提取）
 * 3. 代码片段（从项目文件提取）
 *
 * 数据格式：每个样本是一段文本，SimCSE 会自动构造正样本对。
 */

/**
 * 训练样本
 */
export interface TrainingSample {
  text: string;
  source: 'corpus' | 'conversation' | 'code';
}

/**
 * 数据集接口
 */
export interface Dataset {
  /** 获取所有样本 */
  getSamples(): TrainingSample[];
  /** 样本数量 */
  size(): number;
}

/**
 * 内存数据集 — 全部加载到内存
 */
export class InMemoryDataset implements Dataset {
  private samples: TrainingSample[];

  constructor(samples: TrainingSample[]) {
    this.samples = samples;
  }

  getSamples(): TrainingSample[] {
    return this.samples;
  }

  size(): number {
    return this.samples.length;
  }
}

/**
 * 批量迭代器
 */
export class BatchIterator {
  private samples: TrainingSample[];
  private batchSize: number;
  private shuffle: boolean;
  private index = 0;

  constructor(samples: TrainingSample[], batchSize: number, shuffle = true) {
    this.samples = [...samples];
    this.batchSize = batchSize;
    this.shuffle = shuffle;
    if (shuffle) this.shuffleArray(this.samples);
  }

  /**
   * 获取下一个 batch
   * @returns null 如果已遍历完
   */
  next(): TrainingSample[] | null {
    if (this.index >= this.samples.length) return null;

    const batch = this.samples.slice(this.index, this.index + this.batchSize);
    this.index += this.batchSize;
    return batch;
  }

  /**
   * 重置迭代器（新 epoch）
   */
  reset(): void {
    this.index = 0;
    if (this.shuffle) this.shuffleArray(this.samples);
  }

  /**
   * 是否已遍历完
   */
  hasNext(): boolean {
    return this.index < this.samples.length;
  }

  private shuffleArray(arr: TrainingSample[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

/**
 * 从文本行创建数据集
 */
export function createDatasetFromLines(lines: string[], source: 'corpus' | 'conversation' | 'code' = 'corpus'): InMemoryDataset {
  const samples: TrainingSample[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // 过滤太短或太长的行
    if (trimmed.length >= 10 && trimmed.length <= 2000) {
      samples.push({ text: trimmed, source });
    }
  }
  return new InMemoryDataset(samples);
}

/**
 * 混合多个数据源
 */
export function mixDatasets(...datasets: Dataset[]): InMemoryDataset {
  const allSamples: TrainingSample[] = [];
  for (const ds of datasets) {
    allSamples.push(...ds.getSamples());
  }
  // 打乱顺序
  for (let i = allSamples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSamples[i], allSamples[j]] = [allSamples[j], allSamples[i]];
  }
  return new InMemoryDataset(allSamples);
}

/**
 * 从文件加载中文语料
 * 每行一个样本，跳过空行和太短的行
 */
export async function loadChineseCorpus(filePath: string): Promise<InMemoryDataset> {
  const fs = await import('fs');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  return createDatasetFromLines(lines, 'corpus');
}

/**
 * 从 MemoryStore 提取对话数据
 * 提取最近的 assistant 回复作为训练样本
 */
export function extractConversationSamples(
  getRecentMessages: (count: number) => Array<{ role: string; content: string }>,
  count = 1000,
): InMemoryDataset {
  const messages = getRecentMessages(count);
  const samples: TrainingSample[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.content.length >= 20 && msg.content.length <= 2000) {
      // 清理工具调用结果等噪声
      const cleaned = msg.content
        .replace(/工具 \w+ 执行结果[\s\S]*?结果：/g, '')
        .replace(/\[已截断\]/g, '')
        .replace(/\[已压缩\]/g, '')
        .trim();

      if (cleaned.length >= 10) {
        samples.push({ text: cleaned, source: 'conversation' });
      }
    }
  }

  return new InMemoryDataset(samples);
}

/**
 * 生成合成训练数据（用于无真实数据时的测试）
 */
export function generateSyntheticData(count = 100): InMemoryDataset {
  const templates = [
    '如何使用 TypeScript 实现一个高效的排序算法？',
    '请帮我分析这段代码的性能瓶颈在哪里。',
    'Git merge 和 rebase 的区别是什么？',
    'Docker 容器和虚拟机有什么本质区别？',
    '解释一下什么是 Transformer 架构中的自注意力机制。',
    '如何优化 Node.js 应用的内存使用？',
    'RESTful API 和 GraphQL 各自的优缺点是什么？',
    '什么是微服务架构？它解决了什么问题？',
    '如何实现一个高性能的缓存系统？',
    '解释 CAP 定理以及它对分布式系统的影响。',
    '请帮我写一个 React 组件实现无限滚动。',
    '什么是 WebSocket？它和 HTTP 长轮询有什么区别？',
    '如何设计一个高并发的消息队列？',
    '解释一下 Linux 的进程和线程的区别。',
    '什么是 SQL 注入？如何防御？',
    '如何使用正则表达式提取文本中的邮箱地址？',
    '请解释一下 OAuth 2.0 的授权流程。',
    '什么是函数式编程？它有什么优势？',
    '如何实现一个简单的搜索引擎？',
    '解释一下 CDN 的工作原理。',
  ];

  const samples: TrainingSample[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i % templates.length;
    // 添加随机变体
    const variants = [
      templates[idx],
      `请问${templates[idx]}`,
      `我想了解${templates[idx].replace('？', '。')}`,
      `关于这个问题：${templates[idx].slice(0, 30)}...`,
    ];
    samples.push({
      text: variants[Math.floor(Math.random() * variants.length)],
      source: 'corpus',
    });
  }

  return new InMemoryDataset(samples);
}
