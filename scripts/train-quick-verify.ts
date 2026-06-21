/**
 * ByteEncoder V2 快速训练验证 — 小数据集确认管线能跑通
 * 200 样本 × 2 epoch，预计 ~5 分钟
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
  ];
  let correct = 0, sumS = 0, sumD = 0, cS = 0, cD = 0;
  for (const p of pairs) {
    const v1 = encoder.forwardPooled(p.a);
    const v2 = encoder.forwardPooled(p.b);
    const sim = cosineSim(new Float32Array(v1.data), new Float32Array(v2.data));
    if (p.s) { sumS += sim; cS++; } else { sumD += sim; cD++; }
    if ((p.s && sim > 0.3) || (!p.s && sim < 0.3)) correct++;
  }
  return { acc: correct / pairs.length, simP: sumS / cS, simN: sumD / cD, margin: sumS / cS - sumD / cD };
}

async function main() {
  console.log('=== ByteEncoder V2 快速验证 ===\n');

  // 加载数据，只取 200 条
  const corpusPath = path.join(DATA_DIR, 'chinese-corpus.txt');
  const lines = fs.readFileSync(corpusPath, 'utf-8').split('\n')
    .filter(l => l.trim().length >= 10 && l.trim().length <= 500)
    .slice(0, 200);
  const samples: TrainingSample[] = lines.map(l => ({ text: l.trim(), source: 'corpus' as const }));
  console.log(`训练样本: ${samples.length}\n`);

  const dataset = new InMemoryDataset(samples);

  const trainer = new SimCSETrainer({
    encoder: { byteEmbedDim: 64, outputDim: 384, numLayers: 4, numHeads: 6, ffnDim: 768 },
    optimizer: {
      learningRate: 5e-5, weightDecay: 0.01, schedule: 'cosine',
      scheduleParams: { warmupSteps: 10, totalSteps: 100, minLr: 1e-6 },
    },
    training: { batchSize: 16, epochs: 3, temperature: 0.15, dropoutRate: 0.1, logInterval: 5, saveInterval: 9999, evalInterval: 9999 },
  });

  const encoder = trainer.getEncoder();
  console.log(`参数量: ${encoder.countParams()}\n`);

  const before = evaluate(encoder);
  console.log(`[训练前] acc=${(before.acc * 100).toFixed(0)}% | sim+=${before.simP.toFixed(4)} | sim-=${before.simN.toFixed(4)} | margin=${before.margin.toFixed(4)}\n`);

  const history: Array<{ epoch: number; loss: number; acc: number; margin: number }> = [];

  for (let ep = 0; ep < 3; ep++) {
    const t0 = Date.now();
    const result = trainer.trainEpoch(dataset, (sr) => {
      if (sr.step % 5 === 0) {
        console.log(`  [Step ${sr.step}] loss=${sr.loss.toFixed(4)} lr=${sr.lr.toExponential(2)}`);
      }
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Epoch ${ep + 1} 完成: avgLoss=${result.avgLoss.toFixed(4)} (${dt}s, ${result.steps} steps)`);

    const ev = evaluate(encoder);
    console.log(`  [评估] acc=${(ev.acc * 100).toFixed(0)}% | sim+=${ev.simP.toFixed(4)} | sim-=${ev.simN.toFixed(4)} | margin=${ev.margin.toFixed(4)}\n`);
    history.push({ epoch: ep + 1, loss: result.avgLoss, acc: ev.acc, margin: ev.margin });
  }

  // 保存
  const serialized = encoder.serialize();
  fs.writeFileSync(path.join(DATA_DIR, 'byte-encoder-v2-trained.bin'), Buffer.from(serialized));

  console.log('=== 总结 ===');
  console.log(`训练前: acc=${(before.acc * 100).toFixed(0)}% margin=${before.margin.toFixed(4)}`);
  for (const h of history) {
    console.log(`Epoch ${h.epoch}: loss=${h.loss.toFixed(4)} acc=${(h.acc * 100).toFixed(0)}% margin=${h.margin.toFixed(4)}`);
  }

  // 全量训练时间估算
  const fullSamples = 13655;
  const stepsPerEpoch = Math.ceil(fullSamples / 8);
  const stepsTotal = stepsPerEpoch * 5;
  const timePerStep = 2.5; // 估算
  const hours = (stepsTotal * timePerStep / 3600).toFixed(1);
  console.log(`\n全量训练估算: ${stepsTotal} steps × ${timePerStep}s = ~${hours}h (batch=8)`);
  console.log('=== 完成 ===');
}

main().catch(err => { console.error('失败:', err); process.exit(1); });
