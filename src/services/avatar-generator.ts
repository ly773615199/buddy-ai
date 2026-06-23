/**
 * AvatarGenerator — 基因参数 → AI 3D 角色生成
 *
 * 管线: 基因 → Prompt → Meshy/Tripo API → .glb → 持久化缓存
 *
 * 持久化: 相同基因参数不重复生成，hash 作为文件名
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { BuddyGenome } from '../pet/genome.js';

// ==================== 配置 ====================

interface AvatarConfig {
  provider: 'meshy' | 'tripo';
  apiKey: string;
  cacheDir: string;
  style: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

const DEFAULT_CONFIG: Partial<AvatarConfig> = {
  provider: 'meshy',
  style: 'anime chibi 3D character, cute, full body, neutral pose, T-pose, clean topology',
  pollIntervalMs: 3000,
  maxPollAttempts: 60, // 3min max
};

// ==================== 类型 ====================

export interface GenerateResult {
  status: 'cached' | 'generated' | 'failed';
  modelUrl: string | null;
  hash: string;
  error?: string;
}

interface MeshyTaskResponse {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  result?: {
    model_url?: string;
    texture_url?: string;
  };
  progress?: number;
  error?: string;
}

// ==================== 基因 → Prompt 翻译 ====================

const COLOR_NAMES: Record<string, string> = {
  '#58a6ff': 'blue', '#3fb950': 'green', '#d29922': 'gold',
  '#f85149': 'red', '#f778ba': 'pink', '#a371f7': 'purple',
  '#f0883e': 'orange', '#8b949e': 'gray',
};

function hexToColorName(hex: string): string {
  const lower = hex.toLowerCase();
  if (COLOR_NAMES[lower]) return COLOR_NAMES[lower];
  // 就近匹配
  const n = parseInt(lower.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  if (r > 200 && g < 100) return 'red';
  if (g > 200 && r < 100) return 'green';
  if (b > 200 && r < 100) return 'blue';
  if (r > 200 && g > 200) return 'yellow';
  if (r > 200 && g > 100 && b < 100) return 'orange';
  if (r > 150 && b > 150) return 'purple';
  if (r > 200 && b > 150) return 'pink';
  return 'light blue';
}

export function genomeToPrompt(genome: BuddyGenome, style?: string): string {
  const parts: string[] = [];

  // 基础风格
  parts.push(style ?? 'anime chibi 3D character');

  // 体型
  if (genome.bodyHeight > 1.15) parts.push('tall slender figure');
  else if (genome.bodyHeight < 0.85) parts.push('short compact figure');
  if (genome.bodyWidth > 1.2) parts.push('wide sturdy build');
  if (genome.bodyRoundness > 0.7) parts.push('soft rounded body');

  // 头身比
  const headRatio = genome.headSize / genome.bodyHeight;
  if (headRatio > 0.25) parts.push('very large head, chibi proportions');
  else if (headRatio > 0.2) parts.push('big head, cute proportions');

  // 耳朵
  if (genome.earSize > 0.8) {
    if (genome.earShape > 0.6) parts.push('long pointed elf ears');
    else if (genome.earShape > 0.3) parts.push('cat ears, triangular');
    else parts.push('round floppy ears');
  }

  // 尾巴
  if (genome.tailLength > 0.5) {
    if (genome.tailCurve > 0.6) parts.push('long fluffy curled tail');
    else parts.push('long straight tail');
  }

  // 翅膀
  if (genome.wingSize > 0.3) {
    parts.push('fairy wings, translucent');
  }

  // 角
  if (genome.hornSize > 0.3) {
    if (genome.hornStyle > 0.6) parts.push('glowing crystal horns');
    else parts.push('small cute horns');
  }

  // 眼睛
  if (genome.eyeSize > 1.1) parts.push('large expressive eyes');
  if (genome.eyeShape > 0.6) parts.push('almond shaped eyes');

  // 颜色
  const primaryColor = hexToColorName('#58a6ff'); // 从 visualSeed 来
  const secondaryColor = hexToColorName(genome.secondaryColor);
  parts.push(`${primaryColor} body with ${secondaryColor} accents`);

  // 质感
  const textureDesc: Record<string, string> = {
    soft: 'soft matte surface, warm feel',
    transparent: 'translucent glossy surface, crystal-like',
    sharp: 'crystalline faceted surface, geometric',
    warm: 'warm fuzzy surface, plush texture',
  };
  parts.push(textureDesc['soft'] ?? 'soft smooth surface');

  // 纹路
  if (genome.patternDensity > 0.3) {
    if (genome.patternStyle < 0.33) parts.push('small dot patterns on body');
    else if (genome.patternStyle < 0.66) parts.push('stripe patterns on body');
    else parts.push('ring patterns on body');
  }

  // 固定后缀
  parts.push('full body', 'clean background', 'high quality', 'detailed');

  return parts.join(', ');
}

// ==================== 持久化缓存 ====================

export class AvatarCache {
  private cacheDir: string;

  constructor(baseDir: string) {
    this.cacheDir = path.join(baseDir, 'avatar-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * 基因参数 → 稳定 hash
   */
  hash(genome: BuddyGenome): string {
    // 只取影响外观的字段，忽略动态参数
    const stable = {
      bodyHeight: genome.bodyHeight,
      bodyWidth: genome.bodyWidth,
      bodyDepth: genome.bodyDepth,
      bodyRoundness: genome.bodyRoundness,
      headSize: genome.headSize,
      eyeSize: genome.eyeSize,
      eyeSpacing: genome.eyeSpacing,
      eyeShape: genome.eyeShape,
      earSize: genome.earSize,
      earShape: genome.earShape,
      earAngle: genome.earAngle,
      mouthSize: genome.mouthSize,
      mouthShape: genome.mouthShape,
      tailLength: genome.tailLength,
      tailCurve: genome.tailCurve,
      wingSize: genome.wingSize,
      hornSize: genome.hornSize,
      hornStyle: genome.hornStyle,
      patternDensity: genome.patternDensity,
      patternStyle: genome.patternStyle,
      secondaryColor: genome.secondaryColor,
      colorGradient: genome.colorGradient,
    };
    const json = JSON.stringify(stable, Object.keys(stable).sort());
    return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  }

  /**
   * 检查缓存
   */
  get(genome: BuddyGenome): string | null {
    const key = this.hash(genome);
    const modelPath = path.join(this.cacheDir, `${key}.glb`);
    if (fs.existsSync(modelPath)) {
      return `/api/avatar/${key}`;
    }
    return null;
  }

  /**
   * 保存模型到缓存
   */
  set(genome: BuddyGenome, glbBuffer: Buffer): string {
    const key = this.hash(genome);
    const modelPath = path.join(this.cacheDir, `${key}.glb`);
    fs.writeFileSync(modelPath, glbBuffer);
    return `/api/avatar/${key}`;
  }

  /**
   * 获取模型文件路径
   */
  getPath(hash: string): string | null {
    const modelPath = path.join(this.cacheDir, `${hash}.glb`);
    return fs.existsSync(modelPath) ? modelPath : null;
  }

  /**
   * 缓存统计
   */
  stats(): { count: number; totalSizeMb: number } {
    const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.glb'));
    const totalSize = files.reduce((sum, f) => {
      const stat = fs.statSync(path.join(this.cacheDir, f));
      return sum + stat.size;
    }, 0);
    return { count: files.length, totalSizeMb: totalSize / 1024 / 1024 };
  }
}

// ==================== 生成服务 ====================

export class AvatarGenerator {
  private config: AvatarConfig;
  private cache: AvatarCache;
  private generating = new Set<string>(); // 防止重复生成

  constructor(config: Partial<AvatarConfig> & { apiKey: string; cacheDir: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as AvatarConfig;
    this.cache = new AvatarCache(this.config.cacheDir);
  }

  /**
   * 生成 3D 角色（带缓存）
   */
  async generate(genome: BuddyGenome): Promise<GenerateResult> {
    const hash = this.cache.hash(genome);

    // 1. 检查缓存
    const cached = this.cache.get(genome);
    if (cached) {
      return { status: 'cached', modelUrl: cached, hash };
    }

    // 2. 防止重复生成
    if (this.generating.has(hash)) {
      return { status: 'failed', modelUrl: null, hash, error: 'Already generating' };
    }
    this.generating.add(hash);

    try {
      // 3. 翻译 Prompt
      const prompt = genomeToPrompt(genome, this.config.style);

      // 4. 调用 API
      const glbBuffer = await this.callAPI(prompt);

      // 5. 持久化
      const modelUrl = this.cache.set(genome, glbBuffer);

      return { status: 'generated', modelUrl, hash };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { status: 'failed', modelUrl: null, hash, error };
    } finally {
      this.generating.delete(hash);
    }
  }

  /**
   * 获取缓存模型 URL
   */
  getCached(genome: BuddyGenome): string | null {
    return this.cache.get(genome);
  }

  /**
   * 获取模型文件路径（供 API 路由使用）
   */
  getModelPath(hash: string): string | null {
    return this.cache.getPath(hash);
  }

  /**
   * 是否正在生成
   */
  isGenerating(genome: BuddyGenome): boolean {
    return this.generating.has(this.cache.hash(genome));
  }

  // ── API 调用 ──

  private async callAPI(prompt: string): Promise<Buffer> {
    if (this.config.provider === 'meshy') {
      return this.callMeshy(prompt);
    }
    return this.callTripo(prompt);
  }

  private async callMeshy(prompt: string): Promise<Buffer> {
    const { apiKey, pollIntervalMs, maxPollAttempts } = this.config;

    // 1. 创建任务
    const createRes = await fetch('https://api.meshy.ai/v1/text-to-3d', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'preview',
        prompt,
        art_style: 'cartoon',
        topology: 'triangle',
        target_polycount: 10000,
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Meshy API error ${createRes.status}: ${body}`);
    }

    const { id: taskId } = await createRes.json() as { id: string };

    // 2. 轮询结果
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      await sleep(pollIntervalMs);

      const pollRes = await fetch(`https://api.meshy.ai/v1/text-to-3d/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) continue;

      const task = await pollRes.json() as MeshyTaskResponse;

      if (task.status === 'COMPLETED' && task.result?.model_url) {
        // 3. 下载 .glb
        const modelRes = await fetch(task.result.model_url);
        if (!modelRes.ok) throw new Error(`Failed to download model: ${modelRes.status}`);
        const arrayBuffer = await modelRes.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      if (task.status === 'FAILED') {
        throw new Error(`Meshy generation failed: ${task.error}`);
      }
    }

    throw new Error('Meshy generation timed out');
  }

  private async callTripo(prompt: string): Promise<Buffer> {
    const { apiKey, pollIntervalMs, maxPollAttempts } = this.config;

    // 1. 创建任务
    const createRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'text_to_model',
        prompt,
        model_version: 'v2.0-20240919',
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Tripo API error ${createRes.status}: ${body}`);
    }

    const { data: { task_id: taskId } } = await createRes.json() as { data: { task_id: string } };

    // 2. 轮询结果
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      await sleep(pollIntervalMs);

      const pollRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) continue;

      const { data: task } = await pollRes.json() as { data: { status: string; output?: { model?: string } } };

      if (task.status === 'success' && task.output?.model) {
        const modelRes = await fetch(task.output.model);
        if (!modelRes.ok) throw new Error(`Failed to download model: ${modelRes.status}`);
        const arrayBuffer = await modelRes.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      if (task.status === 'failed') {
        throw new Error('Tripo generation failed');
      }
    }

    throw new Error('Tripo generation timed out');
  }
}

// ==================== 工具 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
