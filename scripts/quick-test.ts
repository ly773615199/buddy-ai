import { SimCSETrainer } from '../src/brain/right/training/simcse-trainer.js';
import { InMemoryDataset } from '../src/brain/right/training/dataloader.js';

const samples = Array.from({length: 50}, (_, i) => ({
  text: `测试样本${i}: 这是一段用于验证训练管线的中文文本，包含了各种语义信息。`,
  source: 'corpus' as const
}));

const trainer = new SimCSETrainer({
  encoder: { byteEmbedDim: 64, outputDim: 384, numLayers: 4, numHeads: 6, ffnDim: 768 },
  optimizer: { learningRate: 2e-5, weightDecay: 0.01, schedule: 'cosine', scheduleParams: { warmupSteps: 5, totalSteps: 20, minLr: 2e-6 } },
  training: { batchSize: 16, epochs: 1, temperature: 0.1, dropoutRate: 0.1, logInterval: 5, saveInterval: 9999, evalInterval: 9999 },
});

const ds = new InMemoryDataset(samples);
const t0 = Date.now();
const r = trainer.trainEpoch(ds, (sr) => console.log(`  step ${sr.step}: loss=${sr.loss.toFixed(4)}`));
console.log(`OK: avgLoss=${r.avgLoss.toFixed(4)} ${((Date.now()-t0)/1000).toFixed(0)}s ${r.steps} steps`);
