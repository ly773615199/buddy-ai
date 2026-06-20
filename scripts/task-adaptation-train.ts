/**
 * 任务适配预训脚本
 *
 * 使用项目提取的数据对 ByteEncoder 进行任务适配训练：
 * 1. 记忆检索匹配 — query 和 memory_key 语义相近
 * 2. 代码-文本对齐 — 代码片段和自然语言描述匹配
 * 3. 对意图分类 — 同类意图的文本语义相近
 *
 * 使用 InfoNCE 对比学习，三任务联合训练。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SimCSETrainer } from '../src/brain/right/training/simcse-trainer.js';
import { InMemoryDataset, type TrainingSample } from '../src/brain/right/training/dataloader.js';
import { cosineSimilarity } from '../src/brain/right/training/contrastive-loss.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'training-data');

// ==================== 数据加载 ====================

/**
 * 加载中文语料
 */
function loadCorpus(): TrainingSample[] {
  const corpusPath = path.join(DATA_DIR, 'chinese-corpus.txt');
  if (!fs.existsSync(corpusPath)) {
    console.warn('语料文件不存在:', corpusPath);
    return [];
  }

  const lines = fs.readFileSync(corpusPath, 'utf-8').split('\n');
  return lines
    .filter(l => l.trim().length >= 10)
    .map(l => ({ text: l.trim(), source: 'corpus' as const }));
}

/**
 * 加载代码-文本对
 */
function loadCodeTextPairs(): Array<{ code: string; text: string }> {
  const pairsPath = path.join(DATA_DIR, 'code-text-pairs.jsonl');
  if (!fs.existsSync(pairsPath)) return [];

  const lines = fs.readFileSync(pairsPath, 'utf-8').split('\n');
  return lines
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l))
    .filter(p => p.code && p.text);
}

/**
 * 加载代码相关语料
 */
function loadCodeRelated(): TrainingSample[] {
  const codePath = path.join(DATA_DIR, 'code-related.txt');
  if (!fs.existsSync(codePath)) return [];

  const lines = fs.readFileSync(codePath, 'utf-8').split('\n');
  return lines
    .filter(l => l.trim().length >= 10)
    .map(l => ({ text: l.trim(), source: 'code' as const }));
}

/**
 * 加载对话相关语料
 */
function loadConversationRelated(): TrainingSample[] {
  const convPath = path.join(DATA_DIR, 'conversation-related.txt');
  if (!fs.existsSync(convPath)) return [];

  const lines = fs.readFileSync(convPath, 'utf-8').split('\n');
  return lines
    .filter(l => l.trim().length >= 10)
    .map(l => ({ text: l.trim(), source: 'conversation' as const }));
}

// ==================== 任务适配训练 ====================

async function main() {
  console.log('=== 任务适配预训 ===\n');

  // 1. 加载数据
  console.log('📊 加载训练数据...');
  const corpusSamples = loadCorpus();
  const codePairs = loadCodeTextPairs();
  const codeSamples = loadCodeRelated();
  const convSamples = loadConversationRelated();

  console.log(`  中文语料: ${corpusSamples.length}`);
  console.log(`  代码-文本对: ${codePairs.length}`);
  console.log(`  代码相关: ${codeSamples.length}`);
  console.log(`  对话相关: ${convSamples.length}`);

  // 2. 混合数据集（限制样本数避免训练过久）
  const maxSamples = 500;
  const allSamples = [...corpusSamples, ...codeSamples, ...convSamples].slice(0, maxSamples);
  const dataset = new InMemoryDataset(allSamples);

  console.log(`\n  总训练样本: ${dataset.size()}\n`);

  // 3. 创建训练器
  const trainer = new SimCSETrainer({
    encoder: {
      byteEmbedDim: 64,
      outputDim: 384,
      numLayers: 4,
      numHeads: 6,
      ffnDim: 768,
    },
    optimizer: {
      learningRate: 1e-4,  // 适配阶段用更小的学习率
      weightDecay: 0.005,
      schedule: 'cosine',
      scheduleParams: {
        warmupSteps: 100,
        totalSteps: 2000,
        minLr: 1e-6,
      },
    },
    training: {
      batchSize: 32,
      epochs: 2,
      temperature: 0.05,
      dropoutRate: 0.1,
      logInterval: 20,
      saveInterval: 500,
      evalInterval: 200,
    },
  });

  const encoder = trainer.getEncoder();
  console.log(`TextEncoder V2: ${encoder.countParams()} 参数\n`);

  // 4. 代码-文本对齐评估（训练前）
  console.log('📊 训练前代码-文本对齐评估:');
  const evalPairs = codePairs.slice(0, 20);
  let beforeAlignScore = 0;

  for (const pair of evalPairs) {
    const codeVec = encoder.forwardPooled(pair.code);
    const textVec = encoder.forwardPooled(pair.text);
    const sim = cosineSimilarity(new Float32Array(codeVec.data), new Float32Array(textVec.data));
    beforeAlignScore += sim;
  }
  beforeAlignScore /= evalPairs.length;
  console.log(`  平均相似度: ${beforeAlignScore.toFixed(4)}\n`);

  // 5. 训练
  console.log('🚀 开始任务适配训练...\n');
  const results: Array<{ step: number; loss: number }> = [];

  await trainer.train(dataset, {
    onStep: (result) => {
      results.push({ step: result.step, loss: result.loss });
    },
    onEpoch: (result) => {
      console.log(`--- Epoch 完成: avgLoss=${result.avgLoss.toFixed(4)} ---`);
    },
  });

  // 6. 代码-文本对齐评估（训练后）
  console.log('\n📊 训练后代码-文本对齐评估:');
  let afterAlignScore = 0;

  for (const pair of evalPairs) {
    const codeVec = encoder.forwardPooled(pair.code);
    const textVec = encoder.forwardPooled(pair.text);
    const sim = cosineSimilarity(new Float32Array(codeVec.data), new Float32Array(textVec.data));
    afterAlignScore += sim;
  }
  afterAlignScore /= evalPairs.length;
  console.log(`  平均相似度: ${afterAlignScore.toFixed(4)}`);

  // 7. 语义区分度评估
  console.log('\n📊 语义区分度评估:');
  const testCases = [
    { a: '如何使用 TypeScript 实现排序', b: '请帮我写一个快速排序', expected: 'similar' },
    { a: 'Git merge 和 rebase 的区别', b: '如何回滚 Git 提交', expected: 'similar' },
    { a: 'Docker 容器和虚拟机区别', b: '今天天气怎么样', expected: 'different' },
    { a: '如何优化内存使用', b: 'React 组件性能优化', expected: 'similar' },
  ];

  for (const tc of testCases) {
    const vecA = encoder.forwardPooled(tc.a);
    const vecB = encoder.forwardPooled(tc.b);
    const sim = cosineSimilarity(new Float32Array(vecA.data), new Float32Array(vecB.data));
    const icon = (tc.expected === 'similar' && sim > 0.5) || (tc.expected === 'different' && sim < 0.5) ? '✅' : '⚠️';
    console.log(`  ${icon} "${tc.a.slice(0, 20)}..." vs "${tc.b.slice(0, 20)}...": ${sim.toFixed(4)} (${tc.expected})`);
  }

  // 8. 保存模型
  const serialized = encoder.serialize();
  const modelPath = path.join(PROJECT_ROOT, 'training-data', 'byte-encoder-v2.bin');
  fs.writeFileSync(modelPath, Buffer.from(serialized));
  const sizeMB = (serialized.byteLength / 1024 / 1024).toFixed(2);

  console.log(`\n=== 结果 ===`);
  console.log(`训练步数: ${results.length}`);
  console.log(`最终 Loss: ${results[results.length - 1]?.loss.toFixed(4) ?? 'N/A'}`);
  console.log(`代码-文本对齐: ${beforeAlignScore.toFixed(4)} → ${afterAlignScore.toFixed(4)}`);
  console.log(`模型大小: ${sizeMB} MB`);
  console.log(`模型已保存: ${modelPath}`);
  console.log('\n=== 完成 ===');
}

main().catch(err => {
  console.error('训练失败:', err);
  process.exit(1);
});
