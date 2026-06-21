/**
 * 监督对比学习数据加载器
 *
 * 从 code-text-pairs.jsonl 加载有标注的正样本对
 * 每条记录：{ code, text, type, source }
 * - code: 代码片段
 * - text: 自然语言描述
 *
 * 正样本对 = (code, text) 同一条记录
 * 负样本 = batch 内其他样本（in-batch negatives）
 */

import type { TrainingSample } from './dataloader.js';
import { InMemoryDataset } from './dataloader.js';

/**
 * 带配对信息的训练样本
 */
export interface PairedSample {
  /** 代码片段（anchor） */
  code: string;
  /** 自然语言描述（positive） */
  text: string;
  /** 来源类型 */
  type: string;
  /** 文件来源 */
  source: string;
}

/**
 * 从 JSONL 文件加载配对数据
 */
export async function loadPairedDataset(filePath: string): Promise<PairedSample[]> {
  const fsMod = await import('fs');
  const content = fsMod.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l: string) => l.trim().length > 0);

  const pairs: PairedSample[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.code && obj.text &&
          obj.code.length >= 10 && obj.text.length >= 5 &&
          obj.code.length <= 4000 && obj.text.length <= 1000) {
        pairs.push({
          code: obj.code,
          text: obj.text,
          type: obj.type || 'unknown',
          source: obj.source || 'unknown',
        });
      }
    } catch {
      // 跳过解析失败的行
    }
  }

  return pairs;
}

/**
 * 监督对比学习的数据集
 *
 * 每个样本包含 anchor (代码) 和 positive (描述) 两个视图
 * 训练时 batch 内其他样本的 positive 自动成为负样本
 */
export class PairedDataset {
  private pairs: PairedSample[];

  constructor(pairs: PairedSample[]) {
    this.pairs = [...pairs];
  }

  size(): number {
    return this.pairs.length;
  }

  getPairs(): PairedSample[] {
    return this.pairs;
  }

  /**
   * 打乱顺序
   */
  shuffle(): void {
    for (let i = this.pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.pairs[i], this.pairs[j]] = [this.pairs[j], this.pairs[i]];
    }
  }

  /**
   * 切分为训练集和验证集
   */
  split(ratio = 0.9): [PairedDataset, PairedDataset] {
    const splitIdx = Math.floor(this.pairs.length * ratio);
    const shuffled = [...this.pairs];
    // Fisher-Yates
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return [
      new PairedDataset(shuffled.slice(0, splitIdx)),
      new PairedDataset(shuffled.slice(splitIdx)),
    ];
  }

  /**
   * 批量迭代器
   */
  *batches(batchSize: number, shuffle = true): Generator<PairedSample[]> {
    const data = [...this.pairs];
    if (shuffle) {
      for (let i = data.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }
    }
    for (let i = 0; i < data.length; i += batchSize) {
      yield data.slice(i, i + batchSize);
    }
  }
}

/**
 * 将 PairedSample 转换为普通 TrainingSample（用于兼容旧代码）
 */
export function pairedToTrainingSamples(pairs: PairedSample[]): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (const p of pairs) {
    // code 和 text 各自作为独立样本
    samples.push({ text: p.code, source: 'code' });
    samples.push({ text: p.text, source: 'corpus' });
  }
  return samples;
}
