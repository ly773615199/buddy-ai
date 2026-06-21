/**
 * ByteEncoder V2 全量预训 — 优化参数版
 *
 * 超参（从快速验证推算）：
 * - lr=2e-5, τ=0.1, batch=32, noise=0.05
 * - 5 epoch, cosine schedule with warmup
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
    { a: '请解释 OAuth 2.0 授权流程', b: 'JWT token 验证机制', s: true },
    { a: 'CSS Flexbox 布局教程', b: '量子计算基本原理', s: false },
  ];

  const sims: Array<{ sim: number; similar: boolean }> = [];
  for (const p of pairs) {
    const v1 = encoder.forwardPooled(p.a);
    const v2 = encoder.forwardPooled(p.b);
    sims.push({ sim: cosineSim(new Float32Array(v1.data), new Float32Array(v2.data)), similar: p.s });
  }

  const simS = sims.filter(s => s.similar).map(s => s.sim);
  const simD = sims.filter(s => !s.similar).map(s => s.sim);
  const avgS = simS.reduce((a, b) => a + b, 0) / simS.length;
  const avgD = simD.reduce((a, b) => a + b, 0) / simD.length;

  let rankCorrect = 0, total = 0;
  for (const sp of sims.filter(s => s.similar)) {
    for (const dp of sims.filter(s => !s.similar)) {
      if (sp.sim > dp.sim) rankCorrect++;
      total++;
    }
  }

  return { margin: avgS - avgD, avgS, avgD, rankAcc: rankCorrect / total };
}

async function main() {
  console.log('=== ByteEncoder V2 全量预训 ===\n');

  // 加载数据，限制 2000 样本
  const allSamples: TrainingSample[] = [];
  for (const [file, source] of [
    ['chinese-corpus.txt', 'corpus'],
    ['code-related.txt', 'code'],
    ['conversation-related.txt', 'conversation'],
  ] as const) {
    const fp = path.join(DATA_DIR, file);
    if (fs.existsSync(fp)) {
      const lines = fs.readFileSync(fp, 'utf-8').split('\n');
      for (const l of lines) {
        const t = l.trim();
        if (t.length >= 10 && t.length <= 2000) allSamples.push({ text: t, source });
      }
    }
  }

  // 限制 2000 样本
  const maxSamples = 2000;
  const shuffled = allSamples.sort(() => Math.random() - 0.5).slice(0, maxSamples);

  console.log(`总样本: ${shuffled.length}`);
  console.log(`  corpus: ${shuffled.filter(s => s.source === 'corpus').length}`);
  console.log(`  code: ${shuffled.filter(s => s.source === 'code').length}`);
  console.log(`  conversation: ${shuffled.filter(s => s.source === 'conversation').length}\n`);

  const dataset = new InMemoryDataset(shuffled);
  const stepsPerEpoch = Math.ceil(shuffled.length / 32);
  const totalSteps = stepsPerEpoch * 2;

  const trainer = new SimCSETrainer({
    encoder: { byteEmbedDim: 64, outputDim: 384, numLayers: 4, numHeads: 6, ffnDim: 768 },
    optimizer: {
      learningRate: 2e-5, weightDecay: 0.01, schedule: 'cosine',
      scheduleParams: { warmupSteps: Math.ceil(totalSteps * 0.1), totalSteps, minLr: 2e-6 },
    },
    training: {
      batchSize: 32, epochs: 5, temperature: 0.1,
      dropoutRate: 0.1, logInterval: 20, saveInterval: 9999, evalInterval: 9999,
    },
  });

  const encoder = trainer.getEncoder();
  console.log(`参数量: ${encoder.countParams()}`);
  console.log(`steps/epoch: ${stepsPerEpoch}, total steps: ${totalSteps}\n`);

  const before = evaluate(encoder);
  console.log(`[训练前] margin=${before.margin.toFixed(4)} rankAcc=${(before.rankAcc * 100).toFixed(0)}% sim+=${before.avgS.toFixed(4)} sim-=${before.avgD.toFixed(4)}\n`);

  const history: Array<{ epoch: number; loss: number; time: number; margin: number; rankAcc: number }> = [];

  for (let ep = 0; ep < 2; ep++) {
    const t0 = Date.now();
    const result = trainer.trainEpoch(dataset, (sr) => {
      if (sr.step % 50 === 0) {
        console.log(`  [Step ${sr.step}] loss=${sr.loss.toFixed(4)} lr=${sr.lr.toExponential(2)}`);
      }
    });
    const dt = (Date.now() - t0) / 1000;
    console.log(`  Epoch ${ep + 1}: avgLoss=${result.avgLoss.toFixed(4)} (${dt.toFixed(0)}s, ${result.steps} steps)`);

    const ev = evaluate(encoder);
    console.log(`  [评估] margin=${ev.margin.toFixed(4)} rankAcc=${(ev.rankAcc * 100).toFixed(0)}% sim+=${ev.avgS.toFixed(4)} sim-=${ev.avgD.toFixed(4)}\n`);
    history.push({ epoch: ep + 1, loss: result.avgLoss, time: dt, margin: ev.margin, rankAcc: ev.rankAcc });
  }

  // 保存模型（覆盖旧的）
  const serialized = encoder.serialize();
  const outPath = path.join(DATA_DIR, 'byte-encoder-v2.bin');
  fs.writeFileSync(outPath, Buffer.from(serialized));
  const sizeMB = (serialized.byteLength / 1024 / 1024).toFixed(2);

  // 也保存一份带时间戳的备份
  const backupPath = path.join(DATA_DIR, `byte-encoder-v2-trained-${Date.now()}.bin`);
  fs.writeFileSync(backupPath, Buffer.from(serialized));

  const totalTime = history.reduce((s, h) => s + h.time, 0);

  console.log('=== 训练总结 ===');
  console.log(`Epoch | Loss    | Margin | RankAcc | Time`);
  console.log(`------|---------|--------|---------|------`);
  console.log(`  0   | (init)  | ${before.margin.toFixed(4)} | ${(before.rankAcc * 100).toFixed(0)}%     | -`);
  for (const h of history) {
    console.log(`  ${h.epoch}   | ${h.loss.toFixed(4)} | ${h.margin.toFixed(4)} | ${(h.rankAcc * 100).toFixed(0)}%     | ${h.time.toFixed(0)}s`);
  }
  console.log(`\n总耗时: ${(totalTime / 60).toFixed(1)} min`);
  console.log(`模型已保存: ${outPath} (${sizeMB} MB)`);
  console.log(`备份: ${backupPath}`);
  console.log('=== 完成 ===');
}

main().catch(err => { console.error('训练失败:', err); process.exit(1); });
