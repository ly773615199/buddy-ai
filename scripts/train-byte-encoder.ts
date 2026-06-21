/**
 * ByteEncoder V2 真实数据预训
 *
 * 使用 training-data/ 下的语料进行 SimCSE 对比学习
 * 每个 epoch 结束后做评估，输出语义区分度变化
 */

import { SimCSETrainer } from '../src/brain/right/training/simcse-trainer.js';
import { InMemoryDataset, type TrainingSample } from '../src/brain/right/training/dataloader.js';
import { cosineSimilarity } from '../src/brain/right/training/contrastive-loss.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'training-data');

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function loadSamples(): TrainingSample[] {
  const samples: TrainingSample[] = [];

  // 中文语料
  const corpusPath = path.join(DATA_DIR, 'chinese-corpus.txt');
  if (fs.existsSync(corpusPath)) {
    const lines = fs.readFileSync(corpusPath, 'utf-8').split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t.length >= 10 && t.length <= 2000) samples.push({ text: t, source: 'corpus' });
    }
  }

  // 代码相关
  const codePath = path.join(DATA_DIR, 'code-related.txt');
  if (fs.existsSync(codePath)) {
    const lines = fs.readFileSync(codePath, 'utf-8').split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t.length >= 10 && t.length <= 2000) samples.push({ text: t, source: 'code' });
    }
  }

  // 对话相关
  const convPath = path.join(DATA_DIR, 'conversation-related.txt');
  if (fs.existsSync(convPath)) {
    const lines = fs.readFileSync(convPath, 'utf-8').split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t.length >= 10 && t.length <= 2000) samples.push({ text: t, source: 'conversation' });
    }
  }

  return samples;
}

function evaluate(encoder: any): { accuracy: number; spearman: number; avgSimilar: number; avgDifferent: number } {
  const testPairs: Array<{ a: string; b: string; similar: boolean }> = [
    { a: '如何使用 TypeScript 实现排序算法', b: '请帮我写一个快速排序', similar: true },
    { a: 'Git merge 和 rebase 的区别', b: '如何回滚 Git 提交', similar: true },
    { a: 'Docker 容器和虚拟机区别', b: '今天天气怎么样', similar: false },
    { a: '如何优化内存使用', b: 'React 组件性能优化', similar: true },
    { a: '什么是 WebSocket 协议', b: 'HTTP 长轮询的原理', similar: true },
    { a: 'SQL 注入攻击防御方法', b: '今天中午吃什么', similar: false },
    { a: '机器学习和深度学习的区别', b: '神经网络训练流程', similar: true },
    { a: 'Node.js 事件循环机制', b: 'Python 多线程编程', similar: false },
    { a: '请解释 OAuth 2.0 授权流程', b: 'JWT token 验证机制', similar: true },
    { a: 'CSS Flexbox 布局教程', b: '量子计算基本原理', similar: false },
  ];

  let correct = 0;
  const sims: number[] = [];
  const labels: number[] = [];
  let sumSimilar = 0, sumDiff = 0, cntSimilar = 0, cntDiff = 0;

  for (const p of testPairs) {
    const v1 = encoder.forwardPooled(p.a);
    const v2 = encoder.forwardPooled(p.b);
    const sim = cosineSim(new Float32Array(v1.data), new Float32Array(v2.data));
    sims.push(sim);
    labels.push(p.similar ? 0.8 : 0.2);

    if (p.similar) { sumSimilar += sim; cntSimilar++; } else { sumDiff += sim; cntDiff++; }

    const hit = (p.similar && sim > 0.3) || (!p.similar && sim < 0.3);
    if (hit) correct++;
  }

  // Spearman
  const n = sims.length;
  const rankX = sims.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).map((_, r, arr) => { arr[r] = { ...arr[r], rank: r + 1 }; return arr; });
  const rx = new Array(n), ry = new Array(n);
  for (let r = 0; r < n; r++) { rx[rankX[r].i] = r + 1; }
  const rankY = labels.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  for (let r = 0; r < n; r++) { ry[rankY[r].i] = r + 1; }
  let sumD2 = 0;
  for (let i = 0; i < n; i++) { const d = rx[i] - ry[i]; sumD2 += d * d; }
  const spearman = 1 - (6 * sumD2) / (n * (n * n - 1));

  return {
    accuracy: correct / testPairs.length,
    spearman,
    avgSimilar: cntSimilar > 0 ? sumSimilar / cntSimilar : 0,
    avgDifferent: cntDiff > 0 ? sumDiff / cntDiff : 0,
  };
}

async function main() {
  console.log('=== ByteEncoder V2 预训 (真实数据) ===\n');

  const allSamples = loadSamples();
  console.log(`总训练样本: ${allSamples.length}`);
  console.log(`  corpus: ${allSamples.filter(s => s.source === 'corpus').length}`);
  console.log(`  code: ${allSamples.filter(s => s.source === 'code').length}`);
  console.log(`  conversation: ${allSamples.filter(s => s.source === 'conversation').length}\n`);

  const dataset = new InMemoryDataset(allSamples);

  const trainer = new SimCSETrainer({
    encoder: {
      byteEmbedDim: 64,
      outputDim: 384,
      numLayers: 4,
      numHeads: 6,
      ffnDim: 768,
    },
    optimizer: {
      learningRate: 3e-4,
      weightDecay: 0.01,
      schedule: 'cosine',
      scheduleParams: {
        warmupSteps: 50,
        totalSteps: 500,
        minLr: 1e-5,
      },
    },
    training: {
      batchSize: 16,
      epochs: 5,
      temperature: 0.05,
      dropoutRate: 0.1,
      logInterval: 20,
      saveInterval: 9999,
      evalInterval: 9999,
    },
  });

  const encoder = trainer.getEncoder();
  console.log(`TextEncoder 参数量: ${encoder.countParams()}\n`);

  // 训练前基线
  const before = evaluate(encoder);
  console.log(`[训练前] 准确率: ${(before.accuracy * 100).toFixed(0)}% | Spearman: ${before.spearman.toFixed(4)} | sim+: ${before.avgSimilar.toFixed(4)} | sim-: ${before.avgDifferent.toFixed(4)}\n`);

  const epochResults: Array<{ epoch: number; loss: number; acc: number; spearman: number; simPlus: number; simMinus: number }> = [];

  for (let epoch = 0; epoch < 5; epoch++) {
    console.log(`\n--- Epoch ${epoch + 1}/5 ---`);
    const epochResult = trainer.trainEpoch(dataset, (stepResult) => {
      if (stepResult.step % 50 === 0) {
        console.log(`  [Step ${stepResult.step}] loss=${stepResult.loss.toFixed(4)} lr=${stepResult.lr.toExponential(2)}`);
      }
    });
    console.log(`  Epoch ${epoch + 1} 完成: avgLoss=${epochResult.avgLoss.toFixed(4)} (${(epochResult.duration / 1000).toFixed(1)}s)`);

    const evalResult = evaluate(encoder);
    console.log(`  [评估] 准确率: ${(evalResult.accuracy * 100).toFixed(0)}% | Spearman: ${evalResult.spearman.toFixed(4)} | sim+: ${evalResult.avgSimilar.toFixed(4)} | sim-: ${evalResult.avgDifferent.toFixed(4)}`);

    epochResults.push({
      epoch: epoch + 1,
      loss: epochResult.avgLoss,
      acc: evalResult.accuracy,
      spearman: evalResult.spearman,
      simPlus: evalResult.avgSimilar,
      simMinus: evalResult.avgDifferent,
    });
  }

  // 保存最终模型
  const serialized = encoder.serialize();
  const outPath = path.join(DATA_DIR, 'byte-encoder-v2-trained.bin');
  fs.writeFileSync(outPath, Buffer.from(serialized));
  const sizeMB = (serialized.byteLength / 1024 / 1024).toFixed(2);

  console.log('\n=== 训练总结 ===');
  console.log('Epoch | Loss    | Acc  | Spearman | sim+   | sim-');
  console.log('------|---------|------|----------|--------|-------');
  console.log(`  0   | (init)  | ${(before.accuracy * 100).toFixed(0)}%  | ${before.spearman.toFixed(4)}   | ${before.avgSimilar.toFixed(4)} | ${before.avgDifferent.toFixed(4)}`);
  for (const r of epochResults) {
    console.log(`  ${r.epoch}   | ${r.loss.toFixed(4)} | ${(r.acc * 100).toFixed(0)}%  | ${r.spearman.toFixed(4)}   | ${r.simPlus.toFixed(4)} | ${r.simMinus.toFixed(4)}`);
  }
  console.log(`\n模型已保存: ${outPath} (${sizeMB} MB)`);
  console.log('=== 完成 ===');
}

main().catch(err => {
  console.error('训练失败:', err);
  process.exit(1);
});
