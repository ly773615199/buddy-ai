/**
 * 原型记忆层 — 在 hidden[128] 空间做最近邻匹配
 *
 * 双通道架构：与 intentHead 并行运行，不替代 argmax
 * - intentHead → 意图分类（训练监督信号）
 * - 原型层 → 工具先验 + 新意图发现（推理增强）
 *
 * 核心能力：
 * 1. findNearest() — 余弦距离匹配已知原型
 * 2. observeNovel() — 新颖样本存入暂存区
 * 3. createPrototype() — 暂存区满时自动创建新原型
 * 4. updateCentroid() — EMA 在线更新原型中心
 * 5. merge/decay — 合并重叠原型、衰减不活跃原型
 */

// ==================== 数据结构 ====================

export interface Prototype {
  /** 唯一标识 */
  id: string;
  /** 人类可读标签（初始 8 个预设，后续由 LLM 或规则生成） */
  label: string;
  /** 类中心向量 [128]，已 L2 归一化 */
  centroid: Float32Array;
  /** 归入此类的累计样本数 */
  count: number;
  /** 工具使用分布：toolName → 使用次数 */
  toolDist: Map<string, number>;
  /** 工具成功率：toolName → { attempts, successes } */
  toolSuccess: Map<string, { attempts: number; successes: number }>;
  /** 创建时间 */
  firstSeen: number;
  /** 最近命中时间 */
  lastSeen: number;
  /** 是否为种子原型（不可消化） */
  isSeed: boolean;
  /** 调试标签 */
  tags: string[];
  /** 质量分 0-1（工具推荐成功率的滑动平均） */
  qualityScore: number;
  /** 连续工具失败次数（成功时重置为 0） */
  failureStreak: number;
}

export interface NoveltyCandidate {
  /** 该簇的样本 embedding 列表（环形缓冲） */
  samples: Float32Array[];
  /** 环形缓冲写指针 */
  writeIdx: number;
  /** 累计观察次数 */
  observeCount: number;
  /** 首次观察时间 */
  firstSeen: number;
  /** 最近观察时间 */
  lastSeen: number;
  /** 该簇常用的工具 */
  toolHints: Map<string, number>;
}

/** 工具推荐：从原型的 toolDist 中取 top K */
function topTools(proto: Prototype, k = 5): string[] {
  if (proto.toolDist.size === 0) return [];
  return [...proto.toolDist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name]) => name);
}

export interface PrototypeMatch {
  prototype: Prototype & { topTools(k?: number): string[] };
  distance: number;
  confidence: number;
  isNovel: boolean;
}

export interface PrototypeMemoryConfig {
  /** 新颖度阈值：到最近原型的余弦距离超过此值视为新意图（默认 0.6） */
  noveltyThreshold: number;
  /** 合并阈值：两个原型距离小于此值时合并（默认 0.3） */
  mergeThreshold: number;
  /** 新类确认所需的最少样本数（默认 5） */
  minNovelSamples: number;
  /** 原型最大数量（默认 32） */
  maxPrototypes: number;
  /** EMA 学习率（默认 0.1） */
  emaLR: number;
  /** 种子原型不可消化 */
  protectSeeds: boolean;
  /** 暂存区每个桶的最大样本数（默认 20） */
  maxNovelSamples: number;
  /** hidden 维度（默认 128） */
  hiddenDim: number;
  /** 质量分低于此值视为低质量原型，可被消化（默认 0.3） */
  qualityDigestThreshold: number;
  /** 连续失败次数超过此值视为低质量（默认 5） */
  failureStreakThreshold: number;
  /** 质量分滑动平均的衰减系数（默认 0.95） */
  qualityDecay: number;
}

const DEFAULT_CONFIG: PrototypeMemoryConfig = {
  noveltyThreshold: 0.6,
  mergeThreshold: 0.3,
  minNovelSamples: 5,
  maxPrototypes: 32,
  emaLR: 0.1,
  protectSeeds: true,
  maxNovelSamples: 20,
  hiddenDim: 128,
  qualityDigestThreshold: 0.3,
  failureStreakThreshold: 5,
  qualityDecay: 0.95,
};

// ==================== 核心类 ====================

export class PrototypeMemory {
  readonly config: PrototypeMemoryConfig;

  /** 已知原型列表 */
  private prototypes: Prototype[] = [];
  /** 新颖样本暂存区：桶 ID → 候选 */
  private noveltyBuffer: Map<string, NoveltyCandidate> = new Map();

  constructor(config?: Partial<PrototypeMemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 查询 ──

  /**
   * 在 hidden 空间找最近原型
   * @param hidden NN 输出的 embedding [hiddenDim]，未归一化
   * @returns 最近原型的距离、置信度、是否新颖
   */
  findNearest(hidden: Float32Array): PrototypeMatch | null {
    if (this.prototypes.length === 0) return null;

    const normed = l2Normalize(hidden);
    let bestProto: Prototype | null = null;
    let bestDist = Infinity;

    for (const p of this.prototypes) {
      const dist = cosineDistance(normed, p.centroid);
      if (dist < bestDist) {
        bestDist = dist;
        bestProto = p;
      }
    }

    if (!bestProto) return null;

    const isNovel = bestDist >= this.config.noveltyThreshold;
    const confidence = isNovel
      ? bestDist  // 越远越不确定
      : 1 - bestDist / this.config.noveltyThreshold;  // 归一化到 0-1

    return {
      prototype: Object.assign(bestProto, { topTools: (k = 5) => topTools(bestProto, k) }),
      distance: bestDist,
      confidence,
      isNovel,
    };
  }

  /**
   * 获取所有原型（用于调试和序列化）
   */
  getPrototypes(): readonly Prototype[] {
    return this.prototypes;
  }

  /**
   * 按 ID 查找原型
   */
  getPrototype(id: string): Prototype | undefined {
    return this.prototypes.find(p => p.id === id);
  }

  /**
   * 添加原型（种子初始化或外部注入）
   */
  addPrototype(proto: Prototype): void {
    // 去重：同 ID 不重复添加
    if (this.prototypes.some(p => p.id === proto.id)) return;
    this.prototypes.push(proto);
  }

  // ── 更新 ──

  /**
   * 命中已知原型时：EMA 更新 centroid + 更新 lastSeen
   */
  hitPrototype(proto: Prototype, hidden: Float32Array): void {
    const normed = l2Normalize(hidden);
    const lr = this.config.emaLR / Math.sqrt(proto.count + 1);

    for (let i = 0; i < this.config.hiddenDim; i++) {
      proto.centroid[i] = (1 - lr) * proto.centroid[i] + lr * normed[i];
    }

    // 重新归一化，保持单位向量
    l2NormalizeInPlace(proto.centroid);

    proto.count++;
    proto.lastSeen = Date.now();
  }

  /**
   * 更新原型的工具分布（工具执行后调用）
   *
   * 同时更新质量分：
   * - 成功 → qualityScore 上升，failureStreak 归零
   * - 失败 → qualityScore 下降，failureStreak 累加
   * - 连续失败超阈值 → 标记为可消化
   */
  updateTool(protoId: string, toolName: string, success: boolean): void {
    const proto = this.getPrototype(protoId);
    if (!proto) return;

    // 更新 toolDist
    proto.toolDist.set(toolName, (proto.toolDist.get(toolName) ?? 0) + 1);

    // 更新 toolSuccess
    const ts = proto.toolSuccess.get(toolName) ?? { attempts: 0, successes: 0 };
    ts.attempts++;
    if (success) ts.successes++;
    proto.toolSuccess.set(toolName, ts);

    // 更新质量分（滑动平均）
    const alpha = 0.1; // 单次反馈的权重
    proto.qualityScore = proto.qualityScore * (1 - alpha) + (success ? 1 : 0) * alpha;

    // 更新连续失败计数
    if (success) {
      proto.failureStreak = 0;
    } else {
      proto.failureStreak++;
    }

    // 质量过低 → 标记（不立即消化，等 createPrototype 时统一处理）
    if (this.isLowQuality(proto)) {
      if (!proto.tags.includes('low_quality')) {
        proto.tags.push('low_quality');
      }
    }
  }

  /**
   * 判断原型是否低质量（可被消化）
   */
  private isLowQuality(proto: Prototype): boolean {
    if (proto.isSeed) return false;
    // 连续失败超阈值
    if (proto.failureStreak >= this.config.failureStreakThreshold) return true;
    // 质量分低于阈值（且有足够的工具尝试数据）
    const totalAttempts = [...proto.toolSuccess.values()].reduce((a, s) => a + s.attempts, 0);
    if (totalAttempts >= 5 && proto.qualityScore < this.config.qualityDigestThreshold) return true;
    return false;
  }

  // ── 新颖性暂存 ──

  /**
   * 新颖样本存入暂存区
   * @param hidden NN 输出的 embedding
   * @returns 如果暂存区满并创建了新原型，返回新原型；否则 null
   */
  observeNovel(hidden: Float32Array): Prototype | null {
    // 找最近的暂存桶
    const normed = l2Normalize(hidden);
    const bucketId = this.findNovelBucket(normed);

    // 获取或创建桶
    let bucket = this.noveltyBuffer.get(bucketId);
    if (!bucket) {
      bucket = {
        samples: [],
        writeIdx: 0,
        observeCount: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        toolHints: new Map(),
      };
      this.noveltyBuffer.set(bucketId, bucket);
    }

    // 环形缓冲写入
    if (bucket.samples.length < this.config.maxNovelSamples) {
      bucket.samples.push(new Float32Array(normed));
    } else {
      bucket.samples[bucket.writeIdx] = new Float32Array(normed);
      bucket.writeIdx = (bucket.writeIdx + 1) % this.config.maxNovelSamples;
    }
    bucket.observeCount++;
    bucket.lastSeen = Date.now();

    // 检查是否满足创建条件
    if (bucket.samples.length >= this.config.minNovelSamples) {
      return this.createPrototypeFromBucket(bucketId, bucket);
    }

    return null;
  }

  // ── 原型生命周期 ──

  /**
   * 消化低质量非种子原型
   *
   * 触发条件（由 isLowQuality 判断）：
   * - 连续工具失败 >= failureStreakThreshold
   * - 质量分 < qualityDigestThreshold（且有足够数据）
   *
   * 消化 = 合并到最近的种子原型（工具知识保留）
   *
   * @returns 被消化的原型列表
   */
  digest(): Prototype[] {
    const seeds = this.prototypes.filter(p => p.isSeed);
    if (seeds.length === 0) return [];

    const digested: Prototype[] = [];
    const remaining: Prototype[] = [];

    for (const p of this.prototypes) {
      if (p.isSeed || !this.isLowQuality(p)) {
        remaining.push(p);
        continue;
      }

      // 找最近的种子原型
      let nearestSeed = seeds[0];
      let nearestDist = Infinity;
      for (const s of seeds) {
        const dist = cosineDistance(p.centroid, s.centroid);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSeed = s;
        }
      }

      // 消化：工具知识 + centroid 合并到种子
      this.digestInto(nearestSeed, p);
      digested.push(p);
    }

    this.prototypes = remaining;
    return digested;
  }

  /**
   * 容量管理：接近上限时消化最差原型，腾出空间
   *
   * 在 createPrototypeFromBucket 中调用
   */
  private digestForCapacity(): void {
    const headroom = this.config.maxPrototypes - this.prototypes.length;
    if (headroom > 2) return; // 还有空间，不消化

    // 按质量分排序，消化最差的非种子原型
    const candidates = this.prototypes
      .filter(p => !p.isSeed)
      .sort((a, b) => a.qualityScore - b.qualityScore);

    const seeds = this.prototypes.filter(p => p.isSeed);
    if (seeds.length === 0) return;

    // 消化直到腾出 3 个位置
    let digested = 0;
    for (const p of candidates) {
      if (digested >= 3) break;

      let nearestSeed = seeds[0];
      let nearestDist = Infinity;
      for (const s of seeds) {
        const dist = cosineDistance(p.centroid, s.centroid);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSeed = s;
        }
      }

      this.digestInto(nearestSeed, p);
      this.prototypes = this.prototypes.filter(x => x !== p);
      digested++;
    }
  }

  /**
   * 将源原型的知识消化到目标种子原型
   */
  private digestInto(target: Prototype, source: Prototype): void {
    // 1. 合并 toolDist
    for (const [tool, count] of source.toolDist) {
      target.toolDist.set(tool, (target.toolDist.get(tool) ?? 0) + count);
    }

    // 2. 合并 toolSuccess
    for (const [tool, stats] of source.toolSuccess) {
      const existing = target.toolSuccess.get(tool) ?? { attempts: 0, successes: 0 };
      existing.attempts += stats.attempts;
      existing.successes += stats.successes;
      target.toolSuccess.set(tool, existing);
    }

    // 3. 加权融合 centroid（保留种子的主体方向，吸收源的微弱信号）
    const totalWeight = target.count + source.count;
    if (totalWeight > 0) {
      const tWeight = target.count / totalWeight;
      const sWeight = source.count / totalWeight;
      for (let i = 0; i < this.config.hiddenDim; i++) {
        target.centroid[i] = target.centroid[i] * tWeight + source.centroid[i] * sWeight;
      }
      l2NormalizeInPlace(target.centroid);
    }

    // 4. 累加计数
    target.count += source.count;

    // 5. 标记消化来源（调试用）
    target.tags.push(`digested:${source.id}`);
  }

  /** @deprecated 使用 digest() 代替 */
  decay(): Prototype[] {
    return this.digest();
  }

  /**
   * 合并最相似的原型对
   * @returns 是否执行了合并
   */
  merge(): boolean {
    if (this.prototypes.length < this.config.maxPrototypes) return false;

    // 找距离最小的一对
    let minDist = Infinity;
    let minI = -1;
    let minJ = -1;

    for (let i = 0; i < this.prototypes.length; i++) {
      for (let j = i + 1; j < this.prototypes.length; j++) {
        const dist = cosineDistance(this.prototypes[i].centroid, this.prototypes[j].centroid);
        if (dist < minDist) {
          minDist = dist;
          minI = i;
          minJ = j;
        }
      }
    }

    if (minI < 0 || minDist > this.config.mergeThreshold) return false;

    const a = this.prototypes[minI];
    const b = this.prototypes[minJ];

    // 合并为新原型
    const merged = mergePrototypes(a, b, this.config.hiddenDim);

    // 删除旧的，插入新的
    this.prototypes.splice(minJ, 1);  // 先删大的索引
    this.prototypes.splice(minI, 1);
    this.prototypes.push(merged);

    return true;
  }

  // ── 序列化 ──

  /**
   * 序列化为 JSON（用于持久化）
   */
  toJSON(): object {
    return {
      config: this.config,
      prototypes: this.prototypes.map(p => ({
        ...p,
        centroid: Array.from(p.centroid),
        toolDist: Object.fromEntries(p.toolDist),
        toolSuccess: Object.fromEntries(p.toolSuccess),
      })),
      noveltyBuffer: Array.from(this.noveltyBuffer.entries()).map(([k, v]) => ({
        bucketId: k,
        observeCount: v.observeCount,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        sampleCount: v.samples.length,
        // 不序列化原始向量，太占空间
      })),
    };
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON(data: any): PrototypeMemory {
    const mem = new PrototypeMemory(data.config);
    mem.prototypes = data.prototypes.map((p: any) => ({
      ...p,
      centroid: new Float32Array(p.centroid),
      toolDist: new Map(Object.entries(p.toolDist)),
      toolSuccess: new Map(Object.entries(p.toolSuccess)),
    }));
    return mem;
  }

  // ── 内部方法 ──

  /**
   * 找新颖样本应该归入哪个桶
   * 用最近原型的距离分桶：同一原型附近的新样本归入同一桶
   */
  private findNovelBucket(normed: Float32Array): string {
    if (this.prototypes.length === 0) return 'bucket_0';

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.prototypes.length; i++) {
      const dist = cosineDistance(normed, this.prototypes[i].centroid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    // 用最近原型的索引 + 距离区间分桶
    const distBucket = Math.floor(bestDist * 10);  // 0.1 为一个桶
    return `bucket_${bestIdx}_${distBucket}`;
  }

  /**
   * 从暂存桶创建新原型
   */
  private createPrototypeFromBucket(bucketId: string, bucket: NoveltyCandidate): Prototype | null {
    // 容量管理：消化低质量原型腾空间
    this.digestForCapacity();

    // 计算样本均值作为 centroid
    const dim = this.config.hiddenDim;
    const centroid = new Float32Array(dim);
    for (const sample of bucket.samples) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += sample[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= bucket.samples.length;
    }
    l2NormalizeInPlace(centroid);

    // 合并工具提示
    const toolDist = new Map<string, number>();
    for (const [tool, count] of bucket.toolHints) {
      toolDist.set(tool, count);
    }

    const now = Date.now();
    const proto: Prototype = {
      id: `auto_${now}_${Math.random().toString(36).slice(2, 6)}`,
      label: `auto_${now}`,
      centroid,
      count: bucket.samples.length,
      toolDist,
      toolSuccess: new Map(),
      firstSeen: bucket.firstSeen,
      lastSeen: now,
      isSeed: false,
      tags: ['auto', `source:${bucketId}`],
      qualityScore: 0.5,   // 新原型默认中等质量
      failureStreak: 0,
    };

    this.prototypes.push(proto);

    // 清空桶
    this.noveltyBuffer.delete(bucketId);

    // 检查是否需要合并
    this.merge();

    return proto;
  }
}

// ==================== 工具函数 ====================

/** L2 归一化（返回新数组） */
function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-10) return new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** L2 归一化（原地修改） */
function l2NormalizeInPlace(v: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-10) return;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
}

/** 余弦距离（输入必须已归一化） */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

/** 合并两个原型 */
function mergePrototypes(a: Prototype, b: Prototype, dim: number): Prototype {
  const totalCount = a.count + b.count;
  const wa = a.count / totalCount;
  const wb = b.count / totalCount;

  // 加权平均 centroid
  const centroid = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    centroid[i] = wa * a.centroid[i] + wb * b.centroid[i];
  }
  l2NormalizeInPlace(centroid);

  // 合并 toolDist
  const toolDist = new Map(a.toolDist);
  for (const [tool, count] of b.toolDist) {
    toolDist.set(tool, (toolDist.get(tool) ?? 0) + count);
  }

  // 合并 toolSuccess
  const toolSuccess = new Map(a.toolSuccess);
  for (const [tool, stats] of b.toolSuccess) {
    const existing = toolSuccess.get(tool) ?? { attempts: 0, successes: 0 };
    toolSuccess.set(tool, {
      attempts: existing.attempts + stats.attempts,
      successes: existing.successes + stats.successes,
    });
  }

  return {
    id: `merged_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: a.count >= b.count ? a.label : b.label,
    centroid,
    count: totalCount,
    toolDist,
    toolSuccess,
    firstSeen: Math.min(a.firstSeen, b.firstSeen),
    lastSeen: Math.max(a.lastSeen, b.lastSeen),
    isSeed: a.isSeed || b.isSeed,
    qualityScore: Math.max(a.qualityScore, b.qualityScore),
    failureStreak: 0,
    tags: ['merged', `from:${a.id}`, `from:${b.id}`],
  };
}
