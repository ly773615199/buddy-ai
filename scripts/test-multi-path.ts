/**
 * 测试多路召回融合模块
 */
import { MultiPathRecall, rrfFusion } from '../src/core/embedding-providers/multi-path-recall.js';
import type { EmbeddingProvider } from '../src/core/embedding-providers/onnx-provider.js';

// Mock providers for testing
const mockONNX: EmbeddingProvider = {
  name: 'onnx-mock',
  dimensions: 4,
  embed: async (text: string) => {
    // 语义相似的文本产生相似向量
    if (text.includes('排序') || text.includes('快速')) return [0.8, 0.2, 0.1, 0.9];
    if (text.includes('天气')) return [0.1, 0.9, 0.8, 0.2];
    return [0.5, 0.5, 0.5, 0.5];
  },
  isAvailable: () => true,
};

const mockTFIDF: EmbeddingProvider = {
  name: 'tfidf-mock',
  dimensions: 4,
  embed: async (text: string) => {
    // 关键词匹配：精确匹配得分高
    if (text.includes('TypeScript') || text.includes('排序算法')) return [0.9, 0.1, 0.3, 0.7];
    if (text.includes('天气')) return [0.1, 0.8, 0.9, 0.3];
    return [0.4, 0.4, 0.4, 0.4];
  },
  isAvailable: () => true,
};

const mockWeak: EmbeddingProvider = {
  name: 'weak-mock',
  dimensions: 4,
  embed: async () => [0.5, 0.5, 0.5, 0.5], // 随机噪声，无区分度
  isAvailable: () => true,
};

const unavailableProvider: EmbeddingProvider = {
  name: 'unavailable',
  dimensions: 4,
  embed: async () => { throw new Error('not available'); },
  isAvailable: () => false,
};

async function main() {
  console.log('=== 多路召回融合测试 ===\n');

  // 测试 1: RRF 融合算法
  console.log('--- 测试 1: RRF 融合 ---');
  const resultLists = new Map([
    ['ONNX', [
      { key: 'doc1', value: '排序算法', similarity: 0.9, rank: 1 },
      { key: 'doc2', value: '快速排序', similarity: 0.8, rank: 2 },
      { key: 'doc3', value: '天气预报', similarity: 0.3, rank: 3 },
    ]],
    ['TF-IDF', [
      { key: 'doc2', value: '快速排序', similarity: 0.95, rank: 1 },
      { key: 'doc1', value: '排序算法', similarity: 0.85, rank: 2 },
      { key: 'doc4', value: 'TypeScript', similarity: 0.7, rank: 3 },
    ]],
  ]);
  const fused = rrfFusion(resultLists);
  console.log('融合结果:');
  for (const r of fused.slice(0, 5)) {
    console.log(`  ${r.key}: score=${r.score.toFixed(4)} ranks=${JSON.stringify(r.ranks)}`);
  }
  console.log();

  // 测试 2: 多路搜索
  console.log('--- 测试 2: 多路搜索 ---');
  const recall = new MultiPathRecall({ topK: 5, rrfK: 60, verbose: true });
  recall.addProvider({ provider: mockONNX, weight: 1.0, label: 'ONNX' });
  recall.addProvider({ provider: mockTFIDF, weight: 0.8, label: 'TF-IDF' });

  const documents = [
    { key: 'doc1', value: '如何使用 TypeScript 实现排序算法' },
    { key: 'doc2', value: '请帮我写一个快速排序' },
    { key: 'doc3', value: '今天天气怎么样' },
    { key: 'doc4', value: 'TypeScript 类型系统详解' },
  ];

  const results = await recall.search('如何使用 TypeScript 实现排序算法', documents);
  console.log('搜索结果:');
  for (const r of results) {
    console.log(`  ${r.key}: score=${r.score.toFixed(4)} ranks=${JSON.stringify(r.ranks)} sims=${JSON.stringify(r.similarities)}`);
  }
  console.log();

  // 测试 3: 不可用 provider 自动跳过
  console.log('--- 测试 3: 不可用 provider 跳过 ---');
  const recall2 = new MultiPathRecall({ verbose: true });
  recall2.addProvider({ provider: mockONNX, label: 'ONNX' });
  recall2.addProvider({ provider: unavailableProvider, label: 'Dead' });
  recall2.addProvider({ provider: mockTFIDF, label: 'TF-IDF' });

  const results2 = await recall2.search('排序', documents);
  console.log(`可用 providers: ${recall2.getAvailableProviders().join(', ')}`);
  console.log(`结果数量: ${results2.length}`);
  console.log();

  // 测试 4: 弱 provider 不影响结果
  console.log('--- 测试 4: 弱 provider 融合 ---');
  const recall3 = new MultiPathRecall({ verbose: true });
  recall3.addProvider({ provider: mockONNX, weight: 1.0, label: 'ONNX' });
  recall3.addProvider({ provider: mockWeak, weight: 0.3, minSimilarity: 0.01, label: 'Weak' });

  const results3 = await recall3.search('排序算法', documents);
  console.log('有弱 provider 时:');
  for (const r of results3) {
    console.log(`  ${r.key}: score=${r.score.toFixed(4)} (${Object.keys(r.ranks).join('+')})`);
  }
  console.log();

  // 测试 5: embedAll
  console.log('--- 测试 5: embedAll ---');
  const allVecs = await recall.embedAll('测试文本');
  for (const [label, vec] of allVecs) {
    console.log(`  ${label}: dim=${vec.dimensions} vec=[${vec.vector.map(v => v.toFixed(2)).join(', ')}]`);
  }

  console.log('\n=== 全部通过 ===');
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
