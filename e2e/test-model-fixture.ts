/**
 * 测试模型 Fixture — 生成最小 .ta 二进制用于 E2E 测试
 *
 * 用途：
 *   - seedTestModel(): 写入临时 .ta 文件，返回路径
 *   - cleanupTestModel(): 清理临时文件
 *   - createMinimalModel(): 生成最小 TernaryModel 对象
 *
 * 生成的模型极小（~2KB），仅用于流程验证，不产生有意义的推理结果。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encode } from '../src/ternary/codec.js';
import type { TernaryModel, TernaryLayer, TernaryModelMeta } from '../src/ternary/format.js';
import { TA_FORMAT_VERSION } from '../src/ternary/format.js';

const TEST_MODEL_DIR = path.join(os.tmpdir(), 'buddy-test-models');

/** 创建最小 TernaryModel 对象（用于测试流程） */
export function createMinimalModel(overrides?: Partial<TernaryModelMeta>): TernaryModel {
  // 使用极小维度：inFeatures=64, rank=4, outFeatures=64, 2 layers
  const inFeatures = 64;
  const rank = 4;
  const outFeatures = 64;
  const numLayers = 2;

  const meta: TernaryModelMeta = {
    version: TA_FORMAT_VERSION,
    domain: 'test-domain',
    baseModel: 'test-base',
    architecture: 'ternary-transformer-test',
    inFeatures,
    outFeatures,
    rank,
    numLayers,
    quantBits: 2,
    threshold: 0.05,
    totalParams: (inFeatures * rank + rank * outFeatures) * numLayers,
    growthStage: 'seed',
    trainSteps: 0,
    lastUpdated: Date.now(),
    checksum: '',
    ...overrides,
  };

  const layers: TernaryLayer[] = [];
  for (let i = 0; i < numLayers; i++) {
    // 生成随机三进制权重 {-1, 0, 1}
    const aSize = inFeatures * rank;
    const bSize = rank * outFeatures;
    const A = new Int8Array(aSize);
    const B = new Int8Array(bSize);

    // 确定性伪随机填充（种子 = 层索引）
    let seed = i * 12345 + 67890;
    for (let j = 0; j < aSize; j++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      A[j] = (seed % 3) - 1; // {-1, 0, 1}
    }
    for (let j = 0; j < bSize; j++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      B[j] = (seed % 3) - 1;
    }

    layers.push({
      layerIndex: i,
      A,
      B,
      // 不含 scales/offsets，简化测试模型
    });
  }

  return { meta, layers };
}

/**
 * 写入测试 .ta 文件，返回文件路径
 *
 * 目录：/tmp/buddy-test-models/<domain>.ta
 * 如果已存在则跳过写入（加速重复测试）
 */
export function seedTestModel(domain = 'test-domain', overrides?: Partial<TernaryModelMeta>): string {
  fs.mkdirSync(TEST_MODEL_DIR, { recursive: true });
  const filePath = path.join(TEST_MODEL_DIR, `${domain}.ta`);

  // 缓存：已存在则跳过
  if (fs.existsSync(filePath)) {
    return filePath;
  }

  const model = createMinimalModel({ domain, ...overrides });
  const buffer = encode(model);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

/**
 * 批量写入多个测试模型（用于多专家测试）
 */
export function seedTestModels(domains: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const domain of domains) {
    result.set(domain, seedTestModel(domain));
  }
  return result;
}

/**
 * 清理测试模型文件
 */
export function cleanupTestModel(domain = 'test-domain'): void {
  const filePath = path.join(TEST_MODEL_DIR, `${domain}.ta`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch { /* 忽略清理错误 */ }
}

/**
 * 清理所有测试模型
 */
export function cleanupAllTestModels(): void {
  try {
    if (fs.existsSync(TEST_MODEL_DIR)) {
      fs.rmSync(TEST_MODEL_DIR, { recursive: true, force: true });
    }
  } catch { /* 忽略 */ }
}

/**
 * 获取测试模型路径（不创建，仅查询）
 */
export function getTestModelPath(domain = 'test-domain'): string {
  return path.join(TEST_MODEL_DIR, `${domain}.ta`);
}
