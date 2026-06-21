/**
 * 监督对比学习训练脚本
 *
 * 使用 code-text-pairs.jsonl 的标注数据训练 TextEncoder
 * 正样本对 = (代码片段, 自然语言描述)
 * 负样本 = batch 内其他样本（in-batch negatives）
 */

import { SupervisedContrastiveTrainer } from '../src/brain/right/training/supervised-contrastive.js';
import { loadPairedDataset, PairedDataset } from '../src/brain/right/training/paired-dataset.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'training-data');
const OUTPUT_DIR = path.join(DATA_DIR, 'supcon-output');

async function main() {
  console.log('=== 监督对比学习训练 ===\n');

  // 1. 加载数据
  const pairsPath = path.join(DATA_DIR, 'code-text-pairs.jsonl');
  if (!fs.existsSync(pairsPath)) {
    console.error(`数据文件不存在: ${pairsPath}`);
    process.exit(1);
  }

  const pairs = await loadPairedDataset(pairsPath);
  console.log(`加载配对数据: ${pairs.length} 对`);

  // 统计
  const typeCounts = new Map<string, number>();
  for (const p of pairs) {
    typeCounts.set(p.type, (typeCounts.get(p.type) || 0) + 1);
  }
  console.log('类型分布:');
  for (const [type, count] of typeCounts) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();

  // 2. 划分训练/验证集（验证集限制到 50 条，加速评估）
  const dataset = new PairedDataset(pairs);
  const [trainSet, valSetFull] = dataset.split(0.9);
  const valSet = new PairedDataset(valSetFull.getPairs().slice(0, 50));
  console.log(`训练集: ${trainSet.size()} 对`);
  console.log(`验证集: ${valSet.size()} 对\n`);

  // 3. 创建训练器（使用较小的模型加速训练）
  const trainer = new SupervisedContrastiveTrainer({
    encoder: {
      byteEmbedDim: 32,
      outputDim: 128,
      numLayers: 2,
      numHeads: 4,
      ffnDim: 256,
    },
    optimizer: {
      learningRate: 2e-4,
      weightDecay: 0.01,
      schedule: 'cosine',
      scheduleParams: {
        warmupSteps: 100,
        totalSteps: 2000,
        minLr: 1e-5,
      },
    },
    training: {
      batchSize: 16,
      epochs: 15,
      temperature: 0.07,
      logInterval: 10,
      saveInterval: 500,
      evalInterval: 50,
      gradClip: 1.0,
      maxInputLen: 128,
    },
  });

  const encoder = trainer.getEncoder();
  console.log(`TextEncoder 参数量: ${encoder.countParams()}\n`);

  // 4. 训练前基线评估
  const beforeMetrics = trainer.evaluate(valSet);
  console.log('[训练前基线]');
  console.log(`  Code→Text R@1: ${(beforeMetrics.codeToTextR1 * 100).toFixed(1)}%`);
  console.log(`  Text→Code R@1: ${(beforeMetrics.textToCodeR1 * 100).toFixed(1)}%`);
  console.log(`  正样本相似度: ${beforeMetrics.avgPosSim.toFixed(4)}`);
  console.log(`  负样本相似度: ${beforeMetrics.avgNegSim.toFixed(4)}`);
  console.log();

  // 5. 训练
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const history: Array<{
    epoch: number;
    loss: number;
    posSim: number;
    negSim: number;
    ctR1: number;
    tcR1: number;
  }> = [];

  await trainer.train(trainSet, valSet, {
    onStep: (result) => {
      // 已在 train() 内部打印
    },
    onEpoch: (result) => {
      const metrics = trainer.evaluate(valSet);
      console.log(`  [验证] CT-R@1: ${(metrics.codeToTextR1 * 100).toFixed(1)}% | TC-R@1: ${(metrics.textToCodeR1 * 100).toFixed(1)}% | PosSim: ${metrics.avgPosSim.toFixed(4)} | NegSim: ${metrics.avgNegSim.toFixed(4)}`);

      history.push({
        epoch: result.epoch,
        loss: result.avgLoss,
        posSim: result.avgPosSim,
        negSim: result.avgNegSim,
        ctR1: metrics.codeToTextR1,
        tcR1: metrics.textToCodeR1,
      });
    },
    onSave: (enc, step) => {
      const outPath = path.join(OUTPUT_DIR, `step-${step}`);
      trainer.saveModel(outPath, fs, path);
    },
  });

  // 6. 保存最终模型
  const finalDir = path.join(OUTPUT_DIR, 'final');
  trainer.saveModel(finalDir, fs, path);

  // 保存序列化模型（兼容现有格式）
  const serialized = encoder.serialize();
  const binPath = path.join(DATA_DIR, 'byte-encoder-v2-supcon.bin');
  fs.writeFileSync(binPath, Buffer.from(serialized));
  const sizeMB = (serialized.byteLength / 1024 / 1024).toFixed(2);

  // 7. 训练总结
  console.log('\n=== 训练总结 ===');
  console.log('Epoch | Loss    | PosSim | NegSim | CT-R@1 | TC-R@1');
  console.log('------|---------|--------|--------|--------|-------');
  console.log(`  0   | (init)  | -      | -      | ${(beforeMetrics.codeToTextR1 * 100).toFixed(1)}%   | ${(beforeMetrics.textToCodeR1 * 100).toFixed(1)}%`);
  for (const r of history) {
    console.log(
      `  ${String(r.epoch).padStart(2)}   | ${r.loss.toFixed(4)} | ${r.posSim.toFixed(4)} | ${r.negSim.toFixed(4)} | ${(r.ctR1 * 100).toFixed(1)}%   | ${(r.tcR1 * 100).toFixed(1)}%`
    );
  }

  // 保存训练历史
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'history.json'),
    JSON.stringify({ before: beforeMetrics, history }, null, 2),
  );

  console.log(`\n模型已保存: ${binPath} (${sizeMB} MB)`);
  console.log(`训练历史: ${path.join(OUTPUT_DIR, 'history.json')}`);
  console.log('=== 完成 ===');
}

main().catch(err => {
  console.error('训练失败:', err);
  process.exit(1);
});
