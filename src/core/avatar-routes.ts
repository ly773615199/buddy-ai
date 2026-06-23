/**
 * Avatar API 路由
 *
 * GET  /api/avatar/:hash      — 获取已缓存的 .glb 模型
 * POST /api/avatar/generate   — 触发生成
 * GET  /api/avatar/status/:hash — 查询生成状态
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { AvatarGenerator, AvatarCache } from '../services/avatar-generator.js';
import type { BuddyGenome } from '../pet/genome.js';

// 全局实例（由 start-ws.ts 初始化）
let generator: AvatarGenerator | null = null;

export function initAvatarRoutes(apiKey: string, cacheDir: string): Router {
  generator = new AvatarGenerator({
    apiKey,
    cacheDir,
    provider: 'meshy',
  });

  const router = Router();

  // GET /api/avatar/:hash — 返回 .glb 文件
  router.get('/avatar/:hash', (req, res) => {
    const { hash } = req.params;
    if (!generator) return res.status(503).json({ error: 'Avatar service not initialized' });

    const modelPath = generator.getModelPath(hash);
    if (!modelPath) return res.status(404).json({ error: 'Model not found' });

    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(modelPath);
  });

  // POST /api/avatar/generate — 触发生成
  router.post('/avatar/generate', async (req, res) => {
    if (!generator) return res.status(503).json({ error: 'Avatar service not initialized' });

    const genome = req.body as BuddyGenome;
    if (!genome || typeof genome.bodyHeight !== 'number') {
      return res.status(400).json({ error: 'Invalid genome data' });
    }

    // 检查缓存
    const cached = generator.getCached(genome);
    if (cached) {
      return res.json({ status: 'cached', modelUrl: cached });
    }

    // 异步生成（不阻塞响应）
    const hash = new AvatarCache(process.env.AVATAR_CACHE_DIR || './data').hash(genome);
    res.json({ status: 'generating', hash });

    // 后台生成
    try {
      const result = await generator.generate(genome);
      console.log(`[Avatar] Generated: ${result.hash} → ${result.status}`);
    } catch (err) {
      console.error(`[Avatar] Generation failed:`, err);
    }
  });

  // GET /api/avatar/status/:hash — 查询状态
  router.get('/avatar/status/:hash', (req, res) => {
    if (!generator) return res.status(503).json({ error: 'Avatar service not initialized' });

    const { hash } = req.params;
    const modelPath = generator.getModelPath(hash);

    if (modelPath) {
      res.json({ status: 'ready', modelUrl: `/api/avatar/${hash}` });
    } else if (generator.isGenerating({} as BuddyGenome)) {
      res.json({ status: 'generating' });
    } else {
      res.json({ status: 'not_found' });
    }
  });

  return router;
}
