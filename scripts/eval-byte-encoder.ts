/**
 * ByteEncoder V2 评估脚本 — 加载已有模型测试语义能力
 */
import { TextEncoder } from '../src/brain/right/features/text-encoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function spearmanCorrelation(predicted: number[], actual: number[]): number {
  const n = predicted.length;
  if (n < 2) return 0;
  const rankX = getRanks(predicted);
  const rankY = getRanks(actual);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) { const d = rankX[i] - rankY[i]; sumD2 += d * d; }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function getRanks(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let r = 0; r < indexed.length; r++) ranks[indexed[r].i] = r + 1;
  return ranks;
}

async function main() {
  console.log('=== ByteEncoder V2 评估 ===\n');

  // 1. 加载模型
  const modelPath = path.join(PROJECT_ROOT, 'training-data', 'byte-encoder-v2.bin');
  if (!fs.existsSync(modelPath)) {
    console.error('模型文件不存在:', modelPath);
    process.exit(1);
  }

  const buf = fs.readFileSync(modelPath).buffer;
  const encoder = TextEncoder.deserialize(buf);
  console.log(`模型参数量: ${encoder.countParams()}`);
  console.log(`模型大小: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB\n`);

  // 2. 基础语义区分度测试
  console.log('--- 测试 1: 语义区分度 ---');
  const testPairs: Array<{ a: string; b: string; expected: 'similar' | 'different' }> = [
    { a: '如何使用 TypeScript 实现排序算法', b: '请帮我写一个快速排序', expected: 'similar' },
    { a: 'Git merge 和 rebase 的区别', b: '如何回滚 Git 提交', expected: 'similar' },
    { a: 'Docker 容器和虚拟机区别', b: '今天天气怎么样', expected: 'different' },
    { a: '如何优化内存使用', b: 'React 组件性能优化', expected: 'similar' },
    { a: '什么是 WebSocket 协议', b: 'HTTP 长轮询的原理', expected: 'similar' },
    { a: 'SQL 注入攻击防御方法', b: '今天中午吃什么', expected: 'different' },
    { a: '机器学习和深度学习的区别', b: '神经网络训练流程', expected: 'similar' },
    { a: 'Node.js 事件循环机制', b: 'Python 多线程编程', expected: 'different' },
  ];

  let correct = 0;
  const similarities: number[] = [];
  const labels: number[] = [];

  for (const pair of testPairs) {
    const v1 = encoder.forwardPooled(pair.a);
    const v2 = encoder.forwardPooled(pair.b);
    const sim = cosineSim(new Float32Array(v1.data), new Float32Array(v2.data));
    similarities.push(sim);
    labels.push(pair.expected === 'similar' ? 0.8 : 0.2);

    const hit = (pair.expected === 'similar' && sim > 0.3) || (pair.expected === 'different' && sim < 0.3);
    if (hit) correct++;
    console.log(`  ${hit ? '✅' : '❌'} [${sim.toFixed(4)}] "${pair.a.slice(0, 25)}..." vs "${pair.b.slice(0, 25)}..." (${pair.expected})`);
  }
  console.log(`\n  准确率: ${correct}/${testPairs.length} (${(correct / testPairs.length * 100).toFixed(0)}%)`);
  console.log(`  Spearman: ${spearmanCorrelation(similarities, labels).toFixed(4)}`);

  // 3. 相似度分布测试
  console.log('\n--- 测试 2: 相似度分布 ---');
  const sentences = [
    '如何实现快速排序算法',
    '请帮我写一个排序函数',
    '今天天气真不错',
    'Docker 容器部署指南',
    'Git 分支管理最佳实践',
    '机器学习模型训练流程',
    'React 组件性能优化',
    '数据库索引优化策略',
  ];

  console.log('  相似度矩阵 (前5句):');
  const vecs = sentences.map(s => encoder.forwardPooled(s));
  for (let i = 0; i < 5; i++) {
    const row: string[] = [];
    for (let j = 0; j < 5; j++) {
      const sim = cosineSim(new Float32Array(vecs[i].data), new Float32Array(vecs[j].data));
      row.push(sim.toFixed(3));
    }
    console.log(`  [${i}] ${row.join('  ')}`);
  }

  // 4. 检查向量是否退化（全零/常量/随机）
  console.log('\n--- 测试 3: 向量健康度 ---');
  const testVec = new Float32Array(encoder.forwardPooled('测试文本').data);
  const mean = testVec.reduce((a, b) => a + b, 0) / testVec.length;
  const variance = testVec.reduce((a, b) => a + (b - mean) ** 2, 0) / testVec.length;
  const std = Math.sqrt(variance);
  const maxVal = Math.max(...testVec);
  const minVal = Math.min(...testVec);
  const zeroCount = Array.from(testVec).filter(v => Math.abs(v) < 1e-8).length;

  console.log(`  维度: ${testVec.length}`);
  console.log(`  均值: ${mean.toFixed(6)}`);
  console.log(`  标准差: ${std.toFixed(6)}`);
  console.log(`  范围: [${minVal.toFixed(6)}, ${maxVal.toFixed(6)}]`);
  console.log(`  近零元素: ${zeroCount}/${testVec.length}`);
  console.log(`  L2 范数: ${Math.sqrt(testVec.reduce((a, b) => a + b * b, 0)).toFixed(4)}`);

  // 判断是否退化
  const isDegenerate = std < 0.001 || zeroCount > testVec.length * 0.9;
  console.log(`\n  状态: ${isDegenerate ? '⚠️ 退化（接近常量/零向量）' : '✅ 正常'}`);

  // 5. 同一文本一致性测试
  console.log('\n--- 测试 4: 确定性一致性 ---');
  const v1 = new Float32Array(encoder.forwardPooled('一致性测试').data);
  const v2 = new Float32Array(encoder.forwardPooled('一致性测试').data);
  const selfSim = cosineSim(v1, v2);
  console.log(`  同文本两次编码相似度: ${selfSim.toFixed(6)} (应为 1.0)`);

  console.log('\n=== 评估完成 ===');
}

main().catch(err => {
  console.error('评估失败:', err);
  process.exit(1);
});
