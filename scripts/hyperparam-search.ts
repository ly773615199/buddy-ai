/**
 * ByteEncoder 超参搜索 — 200 样本快速对比
 */
import { SimCSETrainer } from '../src/brain/right/training/simcse-trainer.js';
import { InMemoryDataset, type TrainingSample } from '../src/brain/right/training/dataloader.js';
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

function evaluate(encoder: any) {
  const pairs = [
    { a: '如何使用 TypeScript 实现排序算法', b: '请帮我写一个快速排序', s: true },
    { a: 'Git merge 和 rebase 的区别', b: '如何回滚 Git 提交', s: true },
    { a: 'Docker 容器和虚拟机区别', b: '今天天气怎么样', s: false },
    { a: '如何优化内存使用', b: 'React 组件性能优化', s: true },
    { a: 'SQL 注入攻击防御方法', b: '今天中午吃什么', s: false },
    { a: '机器学习和深度学习的区别', b: '神经网络训练流程', s: true },
    { a: '什么是 WebSocket 协议', b: 'HTTP 长轮询的原理', s: true },
    { a: 'Node.js 事件循环机制', b: 'Python 多线程编程', s: false },
  ];

  const sims: Array<{ sim: number; similar: boolean }> = [];
  for (const p of pairs) {
    const v1 = encoder.forwardPooled(p.a);
    const v2 = encoder.forwardPooled(p.b);
    sims.push({ sim: cosineSim(new Float32Array(v1.data), new Float32Array(v2.data)), similar: p.s });
  }

  // 用 margin-based 准确率：similar 的 sim 应该 > different 的 sim
  const simS = sims.filter(s => s.similar).map(s => s.sim);
  const simD = sims.filter(s => !s.similar).map(s => s.sim);
  const avgS = simS.reduce((a, b) => a + b, 0) / simS.length;
  const avgD = simD.reduce((a, b) => a + b, 0) / simD.length;
  const margin = avgS - avgD;

  // 排序准确率：所有 similar 对的 sim 应该 > 所有 different 对的 sim
  let rankCorrect = 0, total = 0;
  for (const sp of sims.filter(s => s.similar)) {
    for (const dp of sims.filter(s => !s.similar)) {
      if (sp.sim > dp.sim) rankCorrect++;
      total++;
    }
  }

  return { margin, avgS, avgD, rankAcc: rankCorrect / total };
}

interface TrialConfig {
  name: string;
  lr: number;
  temperature: number;
  batchSize: number;
  epochs: number;
}

async function runTrial(samples: TrainingSample[], config: TrialConfig) {
  const dataset = new InMemoryDataset(samples);

  const trainer = new SimCSETrainer({
    encoder: { byteEmbedDim: 64, outputDim: 384, numLayers: 4, numHeads: 6, ffnDim: 768 },
    optimizer: {
      learningRate: config.lr, weightDecay: 0.01, schedule: 'cosine',
      scheduleParams: { warmupSteps: 5, totalSteps: 50, minLr: config.lr * 0.1 },
    },
    training: {
      batchSize: config.batchSize, epochs: config.epochs, temperature: config.temperature,
      dropoutRate: 0.1, logInterval: 999, saveInterval: 9999, evalInterval: 9999,
    },
  });

  const encoder = trainer.getEncoder();
  const before = evaluate(encoder);

  for (let ep = 0; ep < config.epochs; ep++) {
    trainer.trainEpoch(dataset);
  }

  const after = evaluate(encoder);
  return { before, after };
}

async function main() {
  console.log('=== ByteEncoder 超参搜索 ===\n');

  const corpusPath = path.join(DATA_DIR, 'chinese-corpus.txt');
  const lines = fs.readFileSync(corpusPath, 'utf-8').split('\n')
    .filter(l => l.trim().length >= 10 && l.trim().length <= 500)
    .slice(0, 200);
  const samples: TrainingSample[] = lines.map(l => ({ text: l.trim(), source: 'corpus' as const }));
  console.log(`样本: ${samples.length}\n`);

  const trials: TrialConfig[] = [
    { name: 'A: 低lr+低τ+小噪声', lr: 3e-5, temperature: 0.1, batchSize: 16, epochs: 3 },
    { name: 'B: 中lr+中τ',        lr: 5e-5, temperature: 0.15, batchSize: 16, epochs: 3 },
    { name: 'C: 低lr+大batch',     lr: 2e-5, temperature: 0.1, batchSize: 32, epochs: 3 },
    { name: 'D: 极低lr+长训练',     lr: 1e-5, temperature: 0.1, batchSize: 16, epochs: 5 },
    { name: 'E: 中lr+高τ',        lr: 5e-5, temperature: 0.2, batchSize: 16, epochs: 3 },
  ];

  const results: Array<{ config: TrialConfig; before: any; after: any }> = [];

  for (const trial of trials) {
    const t0 = Date.now();
    const r = await runTrial(samples, trial);
    const dt = ((Date.now() - t0) / 1000).toFixed(0);
    results.push({ config: trial, before: r.before, after: r.after });
    console.log(`${trial.name} (${dt}s)`);
    console.log(`  Before: margin=${r.before.margin.toFixed(4)} rankAcc=${(r.before.rankAcc * 100).toFixed(0)}% avgS=${r.before.avgS.toFixed(4)} avgD=${r.before.avgD.toFixed(4)}`);
    console.log(`  After:  margin=${r.after.margin.toFixed(4)} rankAcc=${(r.after.rankAcc * 100).toFixed(0)}% avgS=${r.after.avgS.toFixed(4)} avgD=${r.after.avgD.toFixed(4)}`);
    console.log(`  Δmargin=${(r.after.margin - r.before.margin).toFixed(4)} ΔrankAcc=${((r.after.rankAcc - r.before.rankAcc) * 100).toFixed(0)}%\n`);
  }

  // 排序
  results.sort((a, b) => b.after.margin - a.after.margin);
  console.log('=== 排名 (by margin) ===');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`#${i + 1} ${r.config.name} → margin=${r.after.margin.toFixed(4)} rankAcc=${(r.after.rankAcc * 100).toFixed(0)}%`);
  }

  const best = results[0];
  console.log(`\n最优: ${best.config.name}`);
  console.log(`  lr=${best.config.lr} τ=${best.config.temperature} batch=${best.config.batchSize} epochs=${best.config.epochs}`);
  console.log('=== 完成 ===');
}

main().catch(err => { console.error('失败:', err); process.exit(1); });
