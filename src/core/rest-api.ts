/**
 * REST API 路由 — 从 ws-handler.ts 提取
 *
 * 职责：30+ 个 HTTP 端点（状态查询、配置管理、模型池、三进制、隐私、知识等）
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Subsystems } from './subsystems.js';
import type { EventBus } from '../ws/server.js';
import type { LinkHandler } from './link-handler.js';
import type { LinkDiagnostics } from './link-diagnostics.js';
import type { AdaptiveTaskQueue } from './task-queue.js';
import type { BuddyConfig } from '../types.js';

/** REST API 上下文 — 从 WSHandler 解耦出来的依赖 */
export interface RESTContext {
  sys: Subsystems;
  config: BuddyConfig;
  eventBus: EventBus;
  verbose: boolean;
  agentRef: {
    getDecisionTrace(): Array<Record<string, unknown>>;
    getABStats(): Record<string, unknown>;
  } | null;
  linkHandler: LinkHandler;
  linkDiag: LinkDiagnostics;
  taskQueue: AdaptiveTaskQueue;
  getAudio(id: string): { data: string; format: string } | null;
  i18nCacheLookup(texts: string[], lang: string): { hits: Record<string, string>; misses: string[] };
  i18nCacheWrite(lang: string, translations: Record<string, string>): void;
  handleUserMessage(content: string, msgId?: string): Promise<void>;
}

// ── HTTP 辅助函数 ──

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

// ── 路由注册 ──

/**
 * 注册所有 REST API 路由
 */
export function setupRESTAPI(ctx: RESTContext): void {
  const { eventBus: eb, sys, config, verbose, agentRef, linkHandler, linkDiag, taskQueue } = ctx;

  // GET /api/status — 服务器状态
  eb.addRoute('GET', '/api/status', (_req: IncomingMessage, res: ServerResponse) => {
    const emotionState = sys.cerebellum?.getLegacyState();
    const petSummary = sys.pet.getSummary();
    const stats = sys.memory.getStats();
    json(res, 200, {
      name: petSummary.name,
      species: petSummary.species,
      emoji: petSummary.emoji,
      evolutionStage: petSummary.evolutionStage,
      stageName: petSummary.stageName,
      intimacy: petSummary.intimacy,
      emotion: emotionState,
      stats,
      clients: eb.clientCount,
    });
  });

  // GET /api/concurrency — 自适应并发控制状态
  eb.addRoute('GET', '/api/concurrency', (_req: IncomingMessage, res: ServerResponse) => {
    json(res, 200, taskQueue.getStatus());
  });

  // GET /api/decision-trace — 三脑决策追踪记录
  eb.addRoute('GET', '/api/decision-trace', (_req: IncomingMessage, res: ServerResponse) => {
    const trace = agentRef?.getDecisionTrace() ?? [];
    json(res, 200, { total: trace.length, traces: trace.slice(-50) });
  });

  // GET /api/brain-status — 三脑状态 + A/B 对比统计
  eb.addRoute('GET', '/api/brain-status', (_req: IncomingMessage, res: ServerResponse) => {
    const abStats = agentRef?.getABStats() ?? null;
    const emotionState = sys.cerebellum?.getLegacyState();
    const bodyState = sys.cerebellum?.getBodyState();
    json(res, 200, {
      emotion: emotionState,
      body: bodyState ? {
        energy: bodyState.energy,
        temperature: bodyState.temperature,
        load: bodyState.load,
        focusLevel: bodyState.focusLevel,
        confidenceLevel: bodyState.confidenceLevel,
        confusionLevel: bodyState.confusionLevel,
      } : null,
      abStats,
    });
  });

  // POST /api/chat — 发送消息并获取回复
  eb.addRoute('POST', '/api/chat', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.content || typeof body.content !== 'string') {
        json(res, 400, { error: 'content 字段必须为字符串' });
        return;
      }
      await ctx.handleUserMessage(body.content);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  // GET /api/config — 非敏感配置
  eb.addRoute('GET', '/api/config', (_req: IncomingMessage, res: ServerResponse) => {
    const models = config.models ? {
      ...config.models,
      providers: (config.models.providers ?? []).map(p => ({
        ...p,
        apiKey: p.apiKey ? `${p.apiKey.slice(0, 6)}***` : undefined,
      })),
    } : null;

    const platforms = config.platforms
      ? Object.fromEntries(
          Object.entries(config.platforms).map(([id, cfg]) => {
            if (!cfg) return [id, cfg];
            const sanitized: Record<string, unknown> = { enabled: (cfg as any).enabled };
            for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
              if (k === 'enabled') continue;
              if (typeof v === 'string' && (k === 'token' || k.includes('Secret') || k.includes('Key') || k === 'encodingAESKey' || k === 'secret')) {
                sanitized[k] = v.length > 6 ? `${v.slice(0, 6)}***` : '***';
              } else {
                sanitized[k] = v;
              }
            }
            return [id, sanitized];
          }),
        )
      : {};

    json(res, 200, {
      name: config.name,
      species: config.species,
      personality: config.personality,
      ws: { port: config.ws.port },
      models,
      platforms,
      customTools: config.customTools ?? [],
    });
  });

  // PATCH /api/config/platforms — 保存单个通道配置
  eb.addRoute('PATCH', '/api/config/platforms', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const { channelId, ...fields } = body;

      if (!channelId) { json(res, 400, { error: '缺少 channelId' }); return; }

      const validChannels = ['telegram', 'discord', 'feishu', 'wecom', 'wechat_mp', 'dingtalk'];
      if (!validChannels.includes(channelId)) {
        json(res, 400, { error: `不支持的通道: ${channelId}` });
        return;
      }

      if (!config.platforms) (config as unknown as Record<string, unknown>).platforms = {};

      const configPath = process.env.BUDDY_CONFIG_PATH || 'config.json';
      const { readFile, writeFile } = await import('fs/promises');
      let fileConfig: Record<string, any> = {};
      try {
        const raw = await readFile(configPath, 'utf-8');
        fileConfig = JSON.parse(raw);
      } catch { /* 文件不存在或解析失败 */ }

      const existing = (fileConfig.platforms?.[channelId] ?? config.platforms?.[channelId as keyof typeof config.platforms] ?? {}) as Record<string, unknown>;
      const merged = { ...existing, ...fields };

      if (!fileConfig.platforms) fileConfig.platforms = {};
      fileConfig.platforms[channelId] = merged;
      await writeFile(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');

      (config.platforms as Record<string, unknown>)[channelId] = merged;

      json(res, 200, { ok: true, channelId });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  // ── 三进制模型 API ──

  // GET /api/ternary/models
  eb.addRoute('GET', '/api/ternary/models', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      await sys.ternaryRouter.init().catch(err => { if (verbose) console.warn('[Ternary] router.init 失败:', err.message); });
      const experts = sys.ternaryRouter.listExperts();
      const installed = experts.map(e => ({
        domain: e.domain,
        name: e.domain,
        description: `${e.architecture} · ${e.growthStage}`,
        architecture: e.architecture || '100m',
        version: e.version || '1.0.0',
        author: 'buddy',
        tags: [],
        installed: true,
        enabled: true,
        growthStage: e.growthStage || 'seed',
        trainSteps: e.trainSteps || 0,
        fileSize: sys.ternaryManager.getModelSizeEstimate(e.domain),
      }));
      const shopExperts = sys.shopCatalog.getAvailableItems({ type: 'expert_model' });
      const installedDomains = new Set(experts.map(e => e.domain));
      const available = shopExperts
        .filter(s => !installedDomains.has(s.id))
        .map(s => ({
          domain: s.id,
          name: s.name,
          description: s.description,
          architecture: '100m',
          version: '0.1.0',
          author: 'community',
          tags: s.tags,
          installed: false,
          enabled: false,
          growthStage: 'seed',
          trainSteps: 0,
          fileSize: '?',
        }));
      json(res, 200, { models: [...installed, ...available] });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  // POST /api/ternary/install/:domain
  eb.addRoute('POST', '/api/ternary/install/:domain', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const domain = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      if (!domain) { json(res, 400, { error: '缺少 domain 参数' }); return; }
      await sys.ternaryManager.create(domain);
      eb.emit({ type: 'model_installed', domain, success: true });
      json(res, 200, { ok: true, domain });
    } catch (err) {
      const domain = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      eb.emit({ type: 'model_installed', domain, success: false });
      json(res, 500, { error: (err as Error).message });
    }
  });

  // POST /api/ternary/uninstall/:domain
  eb.addRoute('POST', '/api/ternary/uninstall/:domain', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const domain = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      if (!domain) { json(res, 400, { error: '缺少 domain 参数' }); return; }
      await sys.ternaryManager.delete(domain);
      json(res, 200, { ok: true, domain });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  // GET /api/audio/:id
  eb.addRoute('GET', '/api/audio/:id', (_req: IncomingMessage, res: ServerResponse) => {
    const id = decodeURIComponent((_req.url ?? '').split('/').pop() ?? '');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 audio id' }));
      return;
    }
    const audio = ctx.getAudio(id);
    if (!audio) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '音频不存在或已过期' }));
      return;
    }
    const audioBuffer = Buffer.from(audio.data, 'base64');
    res.writeHead(200, {
      'Content-Type': `audio/${audio.format}`,
      'Content-Length': audioBuffer.length.toString(),
      'Cache-Control': 'no-cache',
    });
    res.end(audioBuffer);
  });

  // GET /api/health — 健康检查
  eb.addRoute('GET', '/api/health', async (_req: IncomingMessage, res: ServerResponse) => {
    const start = performance.now();
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    checks.memory = { status: heapUsedMB < 512 ? 'healthy' : heapUsedMB < 1024 ? 'degraded' : 'unhealthy', latencyMs: 0 };

    try {
      const dbStart = performance.now();
      sys.memory.getStats();
      checks.database = { status: 'healthy', latencyMs: Math.round(performance.now() - dbStart) };
    } catch (e: any) { checks.database = { status: 'unhealthy', error: e.message }; }

    try { sys.cerebellum?.getLegacyState(); checks.emotion = { status: 'healthy' }; }
    catch (e: any) { checks.emotion = { status: 'unhealthy', error: e.message }; }

    try {
      const pool = sys.llm.getPool?.();
      if (pool && pool.isInitialized) {
        checks.modelPool = { status: pool.profileCount > 0 ? 'healthy' : 'degraded', latencyMs: 0 };
      } else { checks.modelPool = { status: 'healthy', latencyMs: 0 }; }
    } catch (e: any) { checks.modelPool = { status: 'unhealthy', error: e.message }; }

    checks.websocket = { status: eb.clientCount > 0 ? 'healthy' : 'idle' };

    const statuses = Object.values(checks).map(c => c.status);
    const overall = statuses.includes('unhealthy') ? 'unhealthy' : statuses.includes('degraded') ? 'degraded' : 'healthy';

    json(res, overall === 'unhealthy' ? 503 : 200, {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      version: process.env.npm_package_version || '0.0.0',
      latencyMs: Math.round(performance.now() - start),
      checks,
    });
  });

  // GET /api/diagnostics
  eb.addRoute('GET', '/api/diagnostics', (_req: IncomingMessage, res: ServerResponse) => {
    json(res, 200, { metrics: linkDiag.getMetrics(), diagnosis: linkDiag.diagnose() });
  });

  // ── Webhook 路由 ──

  eb.addRoute('POST', '/webhook/stripe', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 stripe-signature 头' })); return; }
      const body = await readRawBody(req);
      const handled = await sys.paymentManager.handleStripeWebhook(body, signature);
      res.writeHead(handled ? 200 : 400);
      res.end(JSON.stringify({ received: handled }));
    } catch (err) {
      if (verbose) console.error('[Webhook] Stripe 处理失败:', (err as Error).message);
      res.writeHead(500); res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  eb.addRoute('POST', '/webhook/alipay', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const bodyStr = await readBody(req);
      const params = Object.fromEntries(new URLSearchParams(bodyStr));
      const handled = await sys.paymentManager.handleAlipayWebhook(params);
      res.writeHead(handled ? 200 : 400); res.end('success');
    } catch (err) {
      if (verbose) console.error('[Webhook] 支付宝处理失败:', (err as Error).message);
      res.writeHead(500); res.end('fail');
    }
  });

  eb.addRoute('POST', '/webhook/wechat', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRawBody(req);
      const signature = (req.headers['wechatpay-signature'] as string) ?? '';
      const handled = await sys.paymentManager.handleWechatWebhook(body, signature);
      res.writeHead(handled ? 200 : 400);
      res.end(JSON.stringify({ code: handled ? 'SUCCESS' : 'FAIL', message: 'OK' }));
    } catch (err) {
      if (verbose) console.error('[Webhook] 微信处理失败:', (err as Error).message);
      res.writeHead(500); res.end(JSON.stringify({ code: 'FAIL', message: (err as Error).message }));
    }
  });

  // POST /api/upload/pdf
  eb.addRoute('POST', '/api/upload/pdf', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          if (buffer.length === 0) { json(res, 400, { error: '空文件' }); return; }

          const { PDFParser } = await import('../knowledge/pdf-parser.js');
          const parser = new PDFParser(verbose);
          const result = parser.extract(buffer);

          if (!result.text) { json(res, 400, { error: '无法提取 PDF 文本', warnings: result.warnings }); return; }

          sys.stmp.insertNode({
            id: `pdf-${Date.now()}`,
            content: result.text.slice(0, 5000),
            room: 'perception',
            timestamp: Date.now(),
            temporalContext: { before: [], after: [] },
            concepts: ['pdf-import'],
            relations: [],
            emotional: { valence: 0, importance: 5 },
            lifecycle: { createdAt: Date.now(), lastAccessed: Date.now(), accessCount: 1, decay: 1.0, compressed: false, hibernated: false },
            source: 'observed',
          });

          json(res, 200, { success: true, pageCount: result.pageCount, extractedFrom: result.extractedFrom, textLength: result.text.length, preview: result.text.slice(0, 500), warnings: result.warnings });
        } catch (err) { json(res, 500, { error: (err as Error).message }); }
      });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  // ── 接入模块 REST 路由 ──

  eb.addRoute('GET', '/api/beliefs', (_req: IncomingMessage, res: ServerResponse) => {
    const query = new URL(`http://localhost${_req.url}`).searchParams.get('q');
    const beliefs = query ? sys.beliefStore.retrieve(query) : sys.beliefStore.getAll(20);
    json(res, 200, { beliefs, total: sys.beliefStore.size });
  });

  eb.addRoute('GET', '/api/entities', (_req: IncomingMessage, res: ServerResponse) => {
    const query = new URL(`http://localhost${_req.url}`).searchParams.get('q');
    const entities = query ? sys.entityStore.search(query) : sys.entityStore.getAll(50);
    json(res, 200, { entities, total: sys.entityStore.size });
  });

  eb.addRoute('GET', '/api/privacy', (_req: IncomingMessage, res: ServerResponse) => {
    const pm = sys.privacyManager;
    json(res, 200, { privacyMode: pm.isPrivacyMode(), indicators: pm.getActiveIndicators(), auditLog: pm.getAuditLog(20) });
  });

  eb.addRoute('POST', '/api/privacy/toggle', (_req: IncomingMessage, res: ServerResponse) => {
    json(res, 200, { privacyMode: sys.privacyManager.togglePrivacyMode() });
  });

  eb.addRoute('DELETE', '/api/privacy/data', (_req: IncomingMessage, res: ServerResponse) => {
    const deleted: Record<string, boolean> = {};
    try { sys.privacyManager.clearAuditLog(); deleted.audit = true; } catch { deleted.audit = false; }
    try { if (sys.privacyManager.isPrivacyMode()) sys.privacyManager.togglePrivacyMode(); deleted.privacyReset = true; } catch { deleted.privacyReset = false; }
    try { for (const t of ['camera', 'microphone', 'location', 'motion', 'ambient_light', 'screen'] as const) sys.privacyManager.revokePermission(t); deleted.permissionsRevoked = true; } catch { deleted.permissionsRevoked = false; }
    eb.emit({ type: 'status', data: { event: 'data_deleted', deleted } });
    json(res, 200, { success: true, deleted, timestamp: Date.now() });
  });

  eb.addRoute('GET', '/api/privacy/export', (_req: IncomingMessage, res: ServerResponse) => {
    const exportData: Record<string, unknown> = { exportedAt: Date.now(), version: '1.0' };
    try { exportData.privacy = { state: sys.privacyManager.exportState(), status: sys.privacyManager.getStatus(), auditLog: sys.privacyManager.getAuditLog(1000) }; } catch { exportData.privacy = null; }
    try { exportData.perception = { events: sys.perceptionBus.getRecent(100), stats: sys.perceptionBus.getStats() }; } catch { exportData.perception = null; }
    try { const packs = sys.knowledgeExporter?.exportAllMature?.(); exportData.knowledge = packs ?? null; } catch { exportData.knowledge = null; }
    json(res, 200, exportData);
  });

  eb.addRoute('GET', '/api/perception', (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(`http://localhost${_req.url}`);
    const count = parseInt(url.searchParams.get('count') ?? '20');
    const category = url.searchParams.get('category') as any;
    json(res, 200, { events: sys.perceptionBus.getRecent(count, category), stats: sys.perceptionBus.getStats() });
  });

  eb.addRoute('GET', '/api/knowledge/export', (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(`http://localhost${_req.url}`);
    const domain = url.searchParams.get('domain');
    if (domain) { json(res, 200, { pack: sys.knowledgeExporter.exportDomainPack(domain) }); }
    else { const packs = sys.knowledgeExporter.exportAllMature(); json(res, 200, { packs, count: packs.length }); }
  });

  eb.addRoute('GET', '/api/env', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const { detectEnvironment } = await import('../env/detect.js');
      const checks = await detectEnvironment();
      json(res, 200, { checks, allPassed: checks.every(c => c.ok) });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('GET', '/api/ternary/growth', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const experts = sys.ternaryRouter.listExperts();
      const reports = experts.map(e => {
        const model = { meta: { ...e, growthStage: e.growthStage as any, trainSteps: e.trainSteps, lastUpdated: Date.now(), totalParams: 0 } } as any;
        return sys.ternaryGrowth.getReport(model, 0, 0);
      });
      json(res, 200, { reports });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('POST', '/api/mcp/search', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, { results: await sys.mcpRegistry.search(body.query ?? '') });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('GET', '/api/skills/health', (_req: IncomingMessage, res: ServerResponse) => {
    const health = sys.skillManager.growth.getAllHealth();
    const top = sys.skillManager.growth.getTopActive(10);
    json(res, 200, { health, topActive: top, totalSkills: sys.skillManager.size });
  });

  // ── 统一模型池管理 API ──

  eb.addRoute('GET', '/api/model-pool', (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool || !unifiedPool.isInitialized) {
        json(res, 200, { initialized: false, modelCount: 0, activeCount: 0, models: [], preferences: null, thompsonParams: {} });
        return;
      }
      const profiles = unifiedPool.getAllProfiles();
      json(res, 200, {
        initialized: true,
        modelCount: profiles.length,
        activeCount: profiles.filter(p => p.active !== false).length,
        models: profiles.map(p => ({
          id: p.id, platform: p.platform, displayName: p.displayName, tier: p.tier,
          category: p.category ?? 'unknown', active: p.active !== false,
          variantCount: p.variantCount ?? 1, capabilities: p.capabilities,
          maxContextTokens: p.maxContextTokens, costPer1kInput: p.costPer1kInput,
          costPer1kOutput: p.costPer1kOutput, stats: p.stats, source: p.source,
          accessStatus: p.accessStatus ?? 'unknown', failureStreak: p.failureStreak ?? 0,
          failureType: p.failureType ?? null,
        })),
        preferences: unifiedPool.getPreferences(),
        thompsonParams: unifiedPool.getThompsonParams(),
      });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('POST', '/api/model-pool/exclude', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      unifiedPool.addExclusion(body.pattern);
      eb.emit({ type: 'bubble', text: `🚫 已排除模型: ${body.pattern}` });
      json(res, 200, { ok: true, preferences: unifiedPool.getPreferences() });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('DELETE', '/api/model-pool/exclude', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      unifiedPool.removeExclusion(body.pattern);
      json(res, 200, { ok: true, preferences: unifiedPool.getPreferences() });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('PATCH', '/api/model-pool/preferences', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      unifiedPool.updatePreferences(body);
      json(res, 200, { ok: true, preferences: unifiedPool.getPreferences() });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('PATCH', '/api/model-pool/toggle', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      const { id, active } = body as { id?: string; active?: boolean };
      if (typeof id !== 'string') { json(res, 400, { error: '缺少 id' }); return; }
      const result = unifiedPool.setActive(id, active ?? true);
      if (!result && active !== false) { json(res, 404, { error: '模型不存在' }); return; }
      const profile = unifiedPool.getProfile(id);
      eb.emit({ type: 'bubble', text: active !== false ? `✅ 已激活: ${profile?.displayName ?? id}` : `⏸️ 已取消: ${profile?.displayName ?? id}` });
      json(res, 200, { ok: true, active: result });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('POST', '/api/model-pool/batch-toggle', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      const { ids, active } = body as { ids?: string[]; active?: boolean };
      if (!Array.isArray(ids)) { json(res, 400, { error: '缺少 ids 数组' }); return; }
      let changed = 0;
      for (const id of ids) { if (unifiedPool.setActive(id, active ?? true)) changed++; }
      json(res, 200, { ok: true, changed });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('POST', '/api/model-pool/batch-toggle-by-platform', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      const { platform, active } = body as { platform?: string; active?: boolean };
      if (typeof platform !== 'string') { json(res, 400, { error: '缺少 platform' }); return; }
      const changed = unifiedPool.setActiveByPlatform(platform, active ?? true);
      eb.emit({ type: 'bubble', text: active !== false ? `✅ 已激活 ${platform} 全部 ${changed} 个模型` : `⏸️ 已取消 ${platform} 全部 ${changed} 个模型` });
      json(res, 200, { ok: true, changed });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('POST', '/api/model-pool/refresh', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }
      const cfg = body.platform;
      if (!cfg?.id || !cfg?.type) { json(res, 400, { error: '缺少 platform.id 或 platform.type' }); return; }
      const result = await unifiedPool.refreshPlatform(cfg);
      json(res, 200, { ok: true, modelCount: result.models.length, error: result.error });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  // ── API 端点管理 ──

  eb.addRoute('POST', '/api/model-pool/providers', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { id, type, model, apiKey, baseUrl, costPer1kInput, costPer1kOutput } = body as { id?: string; type?: string; model?: string; apiKey?: string; baseUrl?: string; costPer1kInput?: number; costPer1kOutput?: number };
      if (!id || !type) { json(res, 400, { error: '缺少 id 或 type 字段' }); return; }

      const { patchConfig, mapProviderType } = await import('../config.js');
      const { verifyEndpoint } = await import('./model-access-verifier.js');
      const endpointResult = await verifyEndpoint({ type, apiKey, baseUrl });
      if (!endpointResult.ok) {
        json(res, 400, { ok: false, error: endpointResult.message, errorType: endpointResult.error, latencyMs: endpointResult.latencyMs });
        return;
      }

      const currentProviders = config.models?.providers ?? [];
      const existingIdx = currentProviders.findIndex(p => p.id === id);
      const newProvider = { id, type: mapProviderType(type), model: model ?? type, apiKey, baseUrl, costPer1kInput, costPer1kOutput };
      let updatedProviders: typeof currentProviders;
      let isUpdate = false;

      if (existingIdx >= 0) {
        const existing = currentProviders[existingIdx];
        const unchanged = existing.type === newProvider.type && existing.model === newProvider.model && existing.apiKey === newProvider.apiKey && existing.baseUrl === newProvider.baseUrl && existing.costPer1kInput === newProvider.costPer1kInput && existing.costPer1kOutput === newProvider.costPer1kOutput;
        if (unchanged) {
          if (verbose) console.log(`[ModelPool] 端点 ${id} 配置未变化，跳过`);
          const unifiedPoolSkip = sys.llm.getUnifiedPool();
          json(res, 200, { ok: true, provider: newProvider, modelCount: unifiedPoolSkip ? unifiedPoolSkip.getProfilesByPlatform(id).length : 0, unchanged: true });
          return;
        }
        updatedProviders = [...currentProviders]; updatedProviders[existingIdx] = newProvider; isUpdate = true;
      } else {
        updatedProviders = [...currentProviders, newProvider];
      }

      await patchConfig({ models: { ...config.models, providers: updatedProviders } });
      config.models = { ...config.models, providers: updatedProviders };
      sys.reconfigureLLM({ provider: type, model: newProvider.model, apiKey, baseUrl } as any);

      const unifiedPool = sys.llm.getUnifiedPool();
      let modelCount = 0;
      let discoveryError: string | undefined;
      if (unifiedPool) {
        unifiedPool.updateProviderCredentials(id, { apiKey, baseUrl });
        try { const result = await unifiedPool.refreshPlatform(newProvider as any); modelCount = result.models.length; }
        catch (err) { discoveryError = (err as Error).message; if (verbose) console.warn(`[ModelPool] 刷新新端点 ${id} 失败:`, discoveryError); }
      }

      linkHandler.updateConfigHash(config);
      eb.emit({ type: 'bubble', text: `📡 已${isUpdate ? '更新' : '添加'} API 端点: ${id} (${type}), 发现 ${modelCount} 个模型` });
      json(res, 200, { ok: true, provider: newProvider, modelCount, ...(discoveryError ? { discoveryError } : {}), ...(endpointResult.balanceWarning ? { balanceWarning: endpointResult.balanceWarning, balanceMessage: endpointResult.message } : {}), endpointLatencyMs: endpointResult.latencyMs });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('DELETE', '/api/model-pool/providers', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { id } = body as { id?: string };
      if (!id) { json(res, 400, { error: '缺少 id 字段' }); return; }
      const { patchConfig } = await import('../config.js');
      const currentProviders = config.models?.providers ?? [];
      const idx = currentProviders.findIndex(p => p.id === id);
      if (idx === -1) { json(res, 404, { error: `端点 ${id} 不存在` }); return; }
      const updatedProviders = currentProviders.filter(p => p.id !== id);
      await patchConfig({ models: { providers: updatedProviders } as any });
      config.models = { ...config.models, providers: updatedProviders } as any;
      const unifiedPool = sys.llm.getUnifiedPool();
      if (unifiedPool) { for (const p of unifiedPool.getProfilesByPlatform(id)) unifiedPool.removeProfile(p.id); }
      // 清理模型知识缓存中该平台的数据
      try {
        const { ModelKnowledgeUpdater } = await import('./model-knowledge-updater.js');
        const dataDir = (await import('path')).join(process.env.HOME ?? '/tmp', '.buddy');
        const cacheFile = (await import('path')).join(dataDir, 'model-knowledge-cache.json');
        const fs = await import('fs/promises');
        const raw = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
        let cleaned = 0;
        if (raw.profiles) {
          for (const [pid, prof] of Object.entries(raw.profiles as Record<string, { platform?: string }>)) {
            if (prof.platform === id) { delete raw.profiles[pid]; cleaned++; }
          }
        }
        if (raw.lastRefresh) delete raw.lastRefresh[id];
        if (raw.lastErrors) delete raw.lastErrors[id];
        await fs.writeFile(cacheFile, JSON.stringify(raw, null, 2));
        if (cleaned > 0) console.log(`[ModelPool] 清理 ${id} 的知识缓存: ${cleaned} 个模型`);
      } catch (e) { console.warn('[ModelPool] 清理知识缓存失败:', e); }
      linkHandler.updateConfigHash(config);
      eb.emit({ type: 'bubble', text: `🗑️ 已删除 API 端点: ${id}` });
      json(res, 200, { ok: true, removedId: id });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  // ── 模型可用性管理 ──

  eb.addRoute('GET', '/api/model-pool/access-status', (_req: IncomingMessage, res: ServerResponse) => {
    const unifiedPool = sys.llm.getUnifiedPool();
    if (!unifiedPool) { json(res, 200, { models: [] }); return; }
    json(res, 200, {
      models: unifiedPool.getAllProfiles().map(p => ({
        id: p.id, platform: p.platform, displayName: p.displayName,
        accessStatus: p.accessStatus ?? 'unknown', failureStreak: p.failureStreak ?? 0,
        failureType: p.failureType ?? null, lastSuccessAt: p.lastSuccessAt ?? null, lastFailureAt: p.lastFailureAt ?? null,
      })),
    });
  });

  eb.addRoute('POST', '/api/model-pool/retry-denied', (_req: IncomingMessage, res: ServerResponse) => {
    const unifiedPool = sys.llm.getUnifiedPool();
    if (!unifiedPool) { json(res, 200, { retried: 0 }); return; }
    const retryModels = unifiedPool.getModelsForRetry();
    json(res, 200, { retried: retryModels.length, models: retryModels.map(m => m.id) });
  });

  eb.addRoute('POST', '/api/model-pool/verify-model', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { modelId } = body as { modelId?: string };
      if (!modelId) { json(res, 400, { error: '缺少 modelId 字段' }); return; }
      const unifiedPool = sys.llm.getUnifiedPool();
      if (!unifiedPool) { json(res, 400, { error: '模型池未初始化' }); return; }
      const profile = unifiedPool.getProfile(modelId);
      if (!profile) { json(res, 404, { error: `模型 ${modelId} 不存在` }); return; }

      const { verifyModelAccess } = await import('./model-access-verifier.js');
      const result = await verifyModelAccess(profile, async (model, timeoutMs) => {
        const creds = unifiedPool.getProviderCredentials(model.platform);
        const { ProviderFactory } = await import('./provider-registry.js');
        const { model: llmModel } = await ProviderFactory.create({
          provider: model.platform, model: model.id.split('/').slice(1).join('/'),
          apiKey: creds?.apiKey, baseUrl: creds?.baseUrl,
        });
        const { generateText } = await import('ai');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try { await generateText({ model: llmModel, messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 1 }); }
        finally { clearTimeout(timeout); }
      });

      if (result.ok) unifiedPool.setModelAccessStatus(modelId, 'available');
      else unifiedPool.setModelAccessStatus(modelId, result.error === 'auth' ? 'denied' : 'broken');

      json(res, 200, { ...result, verified: result.ok });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  // ── 自定义工具端点管理 ──

  eb.addRoute('GET', '/api/config/custom-tools', (_req: IncomingMessage, res: ServerResponse) => {
    json(res, 200, { tools: config.customTools ?? [] });
  });

  eb.addRoute('POST', '/api/config/custom-tools', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { id, name, description, endpoint, method, headers, parameters, timeoutMs } = body as { id?: string; name?: string; description?: string; endpoint?: string; method?: string; headers?: Record<string, string>; parameters?: Record<string, unknown>; timeoutMs?: number };
      if (!id || !endpoint) { json(res, 400, { error: '缺少 id 或 endpoint 字段' }); return; }

      const { patchConfig } = await import('../config.js');
      const currentTools = config.customTools ?? [];
      const existingIdx = currentTools.findIndex(t => t.id === id);
      const newTool = { id, name: name ?? id, description: description ?? `自定义工具: ${id}`, endpoint, method: (method as 'GET' | 'POST' | 'PUT') ?? 'POST', headers, parameters, timeoutMs: timeoutMs ?? 30000 };
      let updatedTools: typeof currentTools;
      if (existingIdx >= 0) { updatedTools = [...currentTools]; updatedTools[existingIdx] = newTool; }
      else { updatedTools = [...currentTools, newTool]; }

      await patchConfig({ customTools: updatedTools });
      config.customTools = updatedTools;

      const { createHttpApiTools } = await import('../tools/http-api.js');
      for (const t of currentTools.filter(t => t.id === id)) {
        sys.tools.register({ name: t.id, description: '', parameters: undefined as any, permission: 'exec_safe', execute: async () => '' } as any);
      }
      sys.tools.registerMany(createHttpApiTools([newTool]));

      linkHandler.updateConfigHash(config);
      eb.emit({ type: 'bubble', text: `🔧 已${existingIdx >= 0 ? '更新' : '添加'}自定义工具: ${id}` });
      json(res, 200, { ok: true, tool: newTool });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  eb.addRoute('DELETE', '/api/config/custom-tools', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { id } = body as { id?: string };
      if (!id) { json(res, 400, { error: '缺少 id 字段' }); return; }
      const { patchConfig } = await import('../config.js');
      const currentTools = config.customTools ?? [];
      const idx = currentTools.findIndex(t => t.id === id);
      if (idx === -1) { json(res, 404, { error: `工具 ${id} 不存在` }); return; }
      const updatedTools = currentTools.filter(t => t.id !== id);
      await patchConfig({ customTools: updatedTools });
      config.customTools = updatedTools;
      linkHandler.updateConfigHash(config);
      eb.emit({ type: 'bubble', text: `🗑️ 已删除自定义工具: ${id}` });
      json(res, 200, { ok: true, removedId: id });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  // POST /api/translate — i18n 翻译
  eb.addRoute('POST', '/api/translate', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readBody(req));
      const { text, texts, targetLang, systemPrompt, glossary: requestGlossary } = body as { text?: string; texts?: string[]; targetLang?: string; systemPrompt?: string; glossary?: Record<string, string> };
      if (!targetLang) { json(res, 400, { error: '缺少 targetLang 字段' }); return; }
      const inputTexts = texts ?? (text ? [text] : []);
      if (inputTexts.length === 0) { json(res, 400, { error: '缺少 text 或 texts 字段' }); return; }

      const { hits, misses } = ctx.i18nCacheLookup(inputTexts, targetLang);
      if (misses.length === 0) {
        json(res, 200, { translations: inputTexts.map(t => hits[t]), source: 'cache' });
        return;
      }

      const langNames: Record<string, string> = { en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
      const langName = langNames[targetLang] || targetLang;
      const glossaryStr = requestGlossary && Object.keys(requestGlossary).length > 0
        ? `\nGlossary (must follow these translations exactly):\n${Object.entries(requestGlossary).map(([k, v]) => `${k} → ${v}`).join('\n')}`
        : '';

      if (misses.length === 1) {
        const sysPrompt = systemPrompt || `Translate the following UI text to ${langName}. Output ONLY the translation, no explanation. Keep it short and suitable for UI.${glossaryStr}`;
        const result = await sys.llm.chat(
          [{ role: 'system', content: sysPrompt, timestamp: Date.now() } as any, { role: 'user', content: `"${misses[0]}"`, timestamp: Date.now() } as any],
          [], 1, { taskType: 'background' },
        );
        const translated = result.text.trim().replace(/^["']|["']$/g, '');
        ctx.i18nCacheWrite(targetLang, { [misses[0]]: translated });
        json(res, 200, { translations: inputTexts.map(t => hits[t] || translated), source: 'llm' });
        return;
      }

      const list = misses.map((t, i) => `${i + 1}. "${t}"`).join('\n');
      const sysPrompt = systemPrompt || `Translate each of the following UI texts to ${langName}. Output ONLY a JSON array of translated strings, in the same order. Keep translations short and suitable for UI. No explanations.${glossaryStr}`;
      const result = await sys.llm.chat(
        [{ role: 'system', content: sysPrompt, timestamp: Date.now() } as any, { role: 'user', content: list, timestamp: Date.now() } as any],
        [], 1, { taskType: 'background' },
      );
      let newTranslations: string[];
      try { const jsonMatch = result.text.match(/\[[\s\S]*\]/); newTranslations = jsonMatch ? JSON.parse(jsonMatch[0]) : misses; }
      catch { newTranslations = misses; }

      const cacheEntries: Record<string, string> = {};
      misses.forEach((t, i) => { cacheEntries[t] = newTranslations[i] || t; });
      ctx.i18nCacheWrite(targetLang, cacheEntries);

      const missMap = new Map(misses.map((t, i) => [t, newTranslations[i] || t]));
      json(res, 200, { translations: inputTexts.map(t => hits[t] || missMap.get(t) || t), source: 'llm' });
    } catch (err) { json(res, 500, { error: (err as Error).message }); }
  });

  if (verbose) console.log('  [REST] API 路由已注册');
}
