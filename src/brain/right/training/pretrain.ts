/**
 * SimCSE 预训脚本 — 合成数据验证训练循环
 *
 * 用合成中文数据验证整个训练管线能跑通。
 * 验证后可替换为真实语料。
 */

import { SimCSETrainer } from './simcse-trainer.js';
import { generateSyntheticData } from './dataloader.js';
import { TextEncoder } from '../features/text-encoder.js';

async function main() {
  console.log('=== SimCSE 预训开始 ===\n');

  // 1. 创建训练器
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
      epochs: 3,
      temperature: 0.05,
      dropoutRate: 0.1,
      logInterval: 5,
      saveInterval: 100,
      evalInterval: 50,
    },
  });

  const encoder = trainer.getEncoder();
  console.log(`TextEncoder V2: ${encoder.countParams()} 参数`);
  console.log(`输出维度: 384\n`);

  // 2. 生成合成数据
  const dataset = generateSyntheticData(200);
  console.log(`训练数据: ${dataset.size()} 样本\n`);

  // 3. 训练前基线
  const beforeVec1 = encoder.forwardPooled('如何使用 TypeScript 实现排序算法');
  const beforeVec2 = encoder.forwardPooled('请帮我写一个快速排序');
  const beforeVec3 = encoder.forwardPooled('今天天气怎么样');

  const sim12Before = cosineSim(new Float32Array(beforeVec1.data), new Float32Array(beforeVec2.data));
  const sim13Before = cosineSim(new Float32Array(beforeVec1.data), new Float32Array(beforeVec3.data));
  console.log(`[训练前] 排序算法 vs 快速排序: ${sim12Before.toFixed(4)}`);
  console.log(`[训练前] 排序算法 vs 天气:   ${sim13Before.toFixed(4)}`);
  console.log(`[训练前] 区分度: ${(sim12Before - sim13Before).toFixed(4)}\n`);

  // 4. 训练
  const results: Array<{ step: number; loss: number }> = [];

  await trainer.train(dataset, {
    onStep: (result) => {
      results.push({ step: result.step, loss: result.loss });
    },
    onEpoch: (result) => {
      console.log(`--- Epoch 完成: avgLoss=${result.avgLoss.toFixed(4)} ---`);
    },
    onEval: (similarity, step) => {
      console.log(`  [Eval@${step}] Spearman: ${similarity.toFixed(4)}`);
    },
  });

  // 5. 训练后验证
  const afterVec1 = encoder.forwardPooled('如何使用 TypeScript 实现排序算法');
  const afterVec2 = encoder.forwardPooled('请帮我写一个快速排序');
  const afterVec3 = encoder.forwardPooled('今天天气怎么样');

  const sim12After = cosineSim(new Float32Array(afterVec1.data), new Float32Array(afterVec2.data));
  const sim13After = cosineSim(new Float32Array(afterVec1.data), new Float32Array(afterVec3.data));

  console.log('\n=== 训练结果 ===');
  console.log(`[训练后] 排序算法 vs 快速排序: ${sim12After.toFixed(4)}`);
  console.log(`[训练后] 排序算法 vs 天气:   ${sim13After.toFixed(4)}`);
  console.log(`[训练后] 区分度: ${(sim12After - sim13After).toFixed(4)}`);

  // 6. 保存模型
  const serialized = encoder.serialize();
  const sizeMB = (serialized.byteLength / 1024 / 1024).toFixed(2);
  console.log(`\n模型大小: ${sizeMB} MB`);
  console.log(`训练步数: ${results.length}`);
  console.log(`最终 Loss: ${results[results.length - 1]?.loss.toFixed(4) ?? 'N/A'}`);

  console.log('\n=== SimCSE 预训完成 ===');
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

main().catch(err => {
  console.error('训练失败:', err);
  process.exit(1);
});
