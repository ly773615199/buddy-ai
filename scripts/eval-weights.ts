/**
 * 逐个评估 ByteEncoder 权重文件的语义质量
 */
import { TextEncoder } from '../src/brain/right/features/text-encoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'training-data');

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const evalPairs = [
  { a: '如何使用 TypeScript 实现排序算法', b: '请帮我写一个快速排序', similar: true },
  { a: 'Git merge 和 rebase 的区别', b: '如何回滚 Git 提交', similar: true },
  { a: 'Docker 容器和虚拟机区别', b: '今天天气怎么样', similar: false },
  { a: '如何优化内存使用', b: 'React 组件性能优化', similar: true },
  { a: 'SQL 注入攻击防御方法', b: '今天中午吃什么', similar: false },
  { a: '机器学习和深度学习的区别', b: '神经网络训练流程', similar: true },
  { a: '什么是 WebSocket 协议', b: 'HTTP 长轮询的原理', similar: true },
  { a: 'Node.js 事件循环机制', b: 'Python 多线程编程', similar: false },
  { a: '请解释 OAuth 2.0 授权流程', b: 'JWT token 验证机制', similar: true },
  { a: 'CSS Flexbox 布局教程', b: '量子计算基本原理', similar: false },
  { a: '帮我写一个 Hello World', b: '打印输出示例代码', similar: true },
  { a: '今天晚饭吃什么', b: 'Python 装饰器用法', similar: false },
];

function evaluate(encoder: TextEncoder) {
  let correct = 0;
  let sumSim = 0, sumDiff = 0, cntSim = 0, cntDiff = 0;
  const sims: number[] = [];
  const labels: number[] = [];

  for (const p of evalPairs) {
    const v1 = encoder.forwardPooled(p.a);
    const v2 = encoder.forwardPooled(p.b);
    const sim = cosineSim(new Float32Array(v1.data), new Float32Array(v2.data));
    sims.push(sim);
    labels.push(p.similar ? 1 : 0);

    if (p.similar) { sumSim += sim; cntSim++; } else { sumDiff += sim; cntDiff++; }
    const hit = (p.similar && sim > 0.3) || (!p.similar && sim < 0.3);
    if (hit) correct++;
  }

  // Spearman
  const n = sims.length;
  const getRanks = (arr: number[]) => {
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let r = 0; r < n; r++) ranks[indexed[r].i] = r + 1;
    return ranks;
  };
  const rx = getRanks(sims), ry = getRanks(labels);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) { const d = rx[i] - ry[i]; sumD2 += d * d; }
  const spearman = 1 - (6 * sumD2) / (n * (n * n - 1));

  const avgSim = cntSim > 0 ? sumSim / cntSim : 0;
  const avgDiff = cntDiff > 0 ? sumDiff / cntDiff : 0;

  return {
    accuracy: correct / evalPairs.length,
    spearman,
    avgSimilar: avgSim,
    avgDifferent: avgDiff,
    margin: avgSim - avgDiff,
  };
}

function main() {
  const files = [
    'byte-encoder-v2.bin',
    'byte-encoder-v2-trained.bin',
    'byte-encoder-v2-trained-1782017747133.bin',
  ];

  console.log('=== ByteEncoder 权重评估对比 ===\n');

  const results: Record<string, ReturnType<typeof evaluate>> = {};

  for (const file of files) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`[SKIP] ${file} — 文件不存在`);
      continue;
    }

    const buf = fs.readFileSync(fp).buffer;
    const encoder = TextEncoder.deserialize(buf);
    const result = evaluate(encoder);
    results[file] = result;

    console.log(`📁 ${file}`);
    console.log(`   参数量: ${encoder.countParams()}`);
    console.log(`   准确率: ${(result.accuracy * 100).toFixed(0)}%`);
    console.log(`   Spearman: ${result.spearman.toFixed(4)}`);
    console.log(`   sim+(相似对): ${result.avgSimilar.toFixed(4)}`);
    console.log(`   sim-(不相似): ${result.avgDifferent.toFixed(4)}`);
    console.log(`   区分度(margin): ${result.margin.toFixed(4)}`);
    console.log();
  }

  // 对比摘要
  console.log('=== 对比摘要 ===');
  console.log(`${'文件'.padEnd(45)} | Acc  | Spear | sim+   | sim-   | margin`);
  console.log(`${'─'.repeat(45)}-|------|-------|--------|--------|-------`);
  for (const [file, r] of Object.entries(results)) {
    console.log(`${file.padEnd(45)} | ${(r.accuracy*100).toFixed(0)}%  | ${r.spearman.toFixed(3)} | ${r.avgSimilar.toFixed(4)} | ${r.avgDifferent.toFixed(4)} | ${r.margin.toFixed(4)}`);
  }

  // 额外：看随机初始化的向量是否退化
  console.log('\n=== 向量范数检查（是否退化/坍塌）===');
  for (const file of files) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) continue;
    const buf = fs.readFileSync(fp).buffer;
    const encoder = TextEncoder.deserialize(buf);

    const texts = ['你好世界', '机器学习', 'Docker容器', '今天天气好'];
    const norms: number[] = [];
    const sims: number[] = [];
    const vecs: Float32Array[] = [];

    for (const t of texts) {
      const v = encoder.forwardPooled(t);
      const arr = new Float32Array(v.data);
      vecs.push(arr);
      let norm = 0;
      for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
      norms.push(Math.sqrt(norm));
    }
    // 所有向量两两相似度
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        sims.push(cosineSim(vecs[i], vecs[j]));
      }
    }
    const avgNorm = norms.reduce((a, b) => a + b, 0) / norms.length;
    const avgSim = sims.reduce((a, b) => a + b, 0) / sims.length;
    const normStd = Math.sqrt(norms.reduce((s, n) => s + (n - avgNorm) ** 2, 0) / norms.length);

    console.log(`\n📁 ${file}`);
    console.log(`   向量范数: ${norms.map(n => n.toFixed(4)).join(', ')} (avg=${avgNorm.toFixed(4)}, std=${normStd.toFixed(4)})`);
    console.log(`   两两相似度: ${sims.map(s => s.toFixed(4)).join(', ')} (avg=${avgSim.toFixed(4)})`);
    console.log(`   范数坍塌: ${normStd < 0.001 ? '⚠️ 是' : '✅ 否'} | 语义坍塌: ${avgSim > 0.95 ? '⚠️ 是' : '✅ 否'}`);
  }
}

main();
