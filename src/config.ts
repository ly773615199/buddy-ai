import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BuddyConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * 配置管理 — 读写 ~/.buddy/config.json
 */

// 加载 .env 文件到 process.env（启动时执行一次）
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), '.env');
  try {
    const content = fss.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch { /* .env 不存在，忽略 */ }
}
loadEnvFile();

/** 环境变量名映射（provider → env key） */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  mimo: 'MIMO_API_KEY',
  // 本地 provider 不需要 API Key（留空即可）
  // ollama, lmstudio, vllm 等
};

/** 从环境变量补充缺失的 API Key（config 优先，env 兜底） */
function fillApiKeyFromEnv(config: BuddyConfig): void {
  // 统一模型池 providers（唯一路径）
  if (config.models?.providers) {
    for (const p of config.models.providers) {
      if (!p.apiKey) {
        const envKey = PROVIDER_ENV_KEYS[p.type] ?? PROVIDER_ENV_KEYS[p.id];
        if (envKey && process.env[envKey]) {
          p.apiKey = process.env[envKey];
        }
      }
    }
  }
}

const CONFIG_DIR = path.join(process.env.HOME ?? '/tmp', '.buddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * 加载配置（如果不存在则返回默认值）
 */
export async function loadConfig(): Promise<BuddyConfig> {
  let config: BuddyConfig;
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw) as Partial<BuddyConfig>;
    // 合并默认值（缺失字段用默认值填充）
    config = mergeConfig(DEFAULT_CONFIG, saved);
  } catch {
    config = { ...DEFAULT_CONFIG };
  }

  // 自动生成 WS Token（如果不存在）
  if (!config.ws.token) {
    config.ws.token = crypto.randomBytes(24).toString('hex');
    await saveConfig(config);
  }

  // 自动迁移旧 llm/pool 配置到统一模型池
  if (!config.models && (config.llm?.provider || config.pool?.nodes)) {
    config = migrateToUnifiedConfig(config);
    await saveConfig(config);
  }

  // 从环境变量补充缺失的 API Key
  fillApiKeyFromEnv(config);

  return config;
}

/**
 * 保存配置
 */
export async function saveConfig(config: BuddyConfig): Promise<void> {
  await ensureConfigDir();
  const serialized = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, serialized, 'utf-8');
}

/**
 * 更新配置的部分字段
 */
export async function patchConfig(patch: Partial<BuddyConfig>): Promise<BuddyConfig> {
  const current = await loadConfig();
  const merged = mergeConfig(current, patch);
  await saveConfig(merged);
  return merged;
}

/**
 * 检查配置是否存在
 */
export function configExists(): boolean {
  return fss.existsSync(CONFIG_FILE);
}

/**
 * 获取配置目录路径
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * 深合并配置对象 — 只覆盖 override 中显式存在的字段
 * 防止 patchConfig({ ws: { port: 8080 } }) 丢失 token
 */
function mergeConfig(base: BuddyConfig, override: Partial<BuddyConfig>): BuddyConfig {
  return {
    ...base,
    ...override,
    personality: override.personality
      ? { ...base.personality, ...override.personality }
      : base.personality,
    // llm 字段已废弃，不再合并（迁移后由 migrateToUnifiedConfig 清空）
    // llm 不再参与合并
    models: override.models
      ? {
          ...override.models,
          providers: override.models.providers ?? base.models?.providers ?? [],
          preferences: { ...base.models?.preferences, ...override.models.preferences },
        }
      : base.models,
    ws: override.ws
      ? { ...base.ws, ...override.ws }
      : base.ws,
    sandbox: override.sandbox
      ? { ...base.sandbox, ...override.sandbox }
      : base.sandbox,
    idle: override.idle
      ? { ...base.idle, ...override.idle }
      : base.idle,
    tts: override.tts
      ? { ...base.tts, ...override.tts }
      : base.tts,
    mcp: override.mcp ?? base.mcp,
    platforms: override.platforms
      ? { ...base.platforms, ...override.platforms }
      : base.platforms,
    knowledge: override.knowledge
      ? {
          local: override.knowledge.local ?? base.knowledge?.local,
          web: override.knowledge.web
            ? { ...base.knowledge?.web, ...override.knowledge.web }
            : base.knowledge?.web,
          feishu: override.knowledge.feishu
            ? { ...base.knowledge?.feishu, ...override.knowledge.feishu }
            : base.knowledge?.feishu,
        }
      : base.knowledge,
    pool: override.pool
      ? {
          ...override.pool,
          nodes: override.pool.nodes ?? base.pool?.nodes ?? [],
        }
      : base.pool,
    customTools: override.customTools ?? base.customTools,
  };
}

/**
 * 验证配置完整性
 */
export function validateConfig(config: BuddyConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 基本字段
  if (!config.name?.trim()) errors.push('name 不能为空');
  if (!config.species?.trim()) errors.push('species 不能为空');

  // 性格属性范围
  const p = config.personality;
  if (p.snark < 0 || p.snark > 100) errors.push('snark 必须在 0-100');
  if (p.wisdom < 0 || p.wisdom > 100) errors.push('wisdom 必须在 0-100');
  if (p.chaos < 0 || p.chaos > 100) errors.push('chaos 必须在 0-100');
  if (p.patience < 0 || p.patience > 100) errors.push('patience 必须在 0-100');
  if (p.debugging < 0 || p.debugging > 100) errors.push('debugging 必须在 0-100');

  // 统一模型池配置
  if (config.models?.providers?.length) {
    for (const p of config.models.providers) {
      if (!p.model?.trim()) errors.push(`provider ${p.id}: model 不能为空`);
      if (p.apiKey && p.apiKey.length < 10) errors.push(`provider ${p.id}: apiKey 长度不足`);
      if (p.baseUrl) {
        try {
          const url = new URL(p.baseUrl);
          if (!['http:', 'https:'].includes(url.protocol)) {
            errors.push(`provider ${p.id}: baseUrl 必须使用 http:// 或 https:// 协议`);
          }
        } catch {
          errors.push(`provider ${p.id}: baseUrl 不是有效的 URL 格式`);
        }
      }
    }
  }

  // ws.port 端口范围校验
  if (config.ws.port < 1 || config.ws.port > 65535) {
    errors.push('ws.port 必须在 1-65535 范围内');
  }

  // sandbox.workspace 路径校验
  if (config.sandbox.workspace) {
    if (!path.isAbsolute(config.sandbox.workspace)) {
      errors.push('sandbox.workspace 必须是绝对路径');
    }
  }

  // pool 配置校验
  if (config.pool) {
    if (!config.pool.nodes?.length) {
      errors.push('pool.nodes 不能为空');
    }
    for (const node of config.pool.nodes ?? []) {
      if (!node.id?.trim()) errors.push('pool node id 不能为空');
      if (!['cloud', 'local_expert', 'lora'].includes(node.type)) {
        errors.push(`pool node ${node.id}: type 必须是 cloud/local_expert/lora`);
      }
      if (node.type === 'cloud' && !node.model?.trim()) {
        errors.push(`pool node ${node.id}: cloud 类型必须指定 model`);
      }
      if (node.type === 'local_expert' && !node.domain?.trim()) {
        errors.push(`pool node ${node.id}: local_expert 类型必须指定 domain`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ==================== 配置迁移 ====================

/**
 * 将旧 llm 配置迁移到新的统一模型池配置
 *
 * 旧格式（已废弃）：
 *   config.llm = { provider, model, apiKey, baseUrl, lightweight: {...} }
 *   config.pool = { strategy, nodes: [...] }
 *
 * 新格式：
 *   config.models = { providers: [...], preferences: {...}, strategy: 'task_match' }
 */
export function migrateToUnifiedConfig(config: BuddyConfig): BuddyConfig {
  // 如果已经有 models 配置，不需要迁移
  if (config.models) return config;

  const providers: NonNullable<BuddyConfig['models']>['providers'] = [];
  const llm = config.llm; // 可能是 undefined

  // 主模型 → providers 列表
  if (llm?.provider && llm.model) {
    providers.push({
      id: llm.provider,
      type: mapProviderType(llm.provider),
      model: llm.model,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
    });
  }

  // 轻量模型 → providers 列表
  if (llm?.lightweight?.provider && llm.lightweight.model) {
    const lwId = `${llm.lightweight.provider}-light`;
    if (!providers.some(p => p.id === lwId)) {
      providers.push({
        id: lwId,
        type: mapProviderType(llm.lightweight.provider),
        model: llm.lightweight.model,
        apiKey: llm.lightweight.apiKey ?? llm.apiKey,
        baseUrl: llm.lightweight.baseUrl ?? llm.baseUrl,
      });
    }
  }

  // pool.nodes → providers 列表（去重）
  if (config.pool?.nodes) {
    for (const node of config.pool.nodes) {
      if (node.type === 'cloud' && node.provider) {
        const exists = providers.some(p =>
          p.type === node.provider && p.apiKey === node.apiKey
        );
        if (!exists) {
          providers.push({
            id: node.id,
            type: mapProviderType(node.provider),
            model: node.model ?? node.id,
            apiKey: node.apiKey,
            baseUrl: node.baseUrl,
          });
        }
      }
    }
  }

  return {
    ...config,
    llm: undefined, // 迁移后清空旧路径
    pool: undefined, // pool 也一并清空
    models: {
      providers,
      preferences: {
        excluded: [],
        preferFree: false,
        preferLocal: false,
        maxCostPer1k: 1.0,
        maxCostPerHour: 5.0,
      },
      strategy: config.pool?.strategy ?? 'task_match',
    },
  };
}

export function mapProviderType(provider: string): 'siliconflow' | 'openrouter' | 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio' | 'mimo' | 'nvidia' | 'custom' {
  const lower = provider.toLowerCase();
  if (lower === 'siliconflow' || lower === 'sf') return 'siliconflow';
  if (lower === 'openrouter') return 'openrouter';
  if (lower === 'deepseek') return 'deepseek';
  if (lower === 'openai') return 'openai';
  if (lower === 'anthropic') return 'anthropic';
  if (lower === 'google' || lower === 'gemini') return 'google';
  if (lower === 'ollama') return 'ollama';
  if (lower === 'lmstudio' || lower === 'lm-studio' || lower === 'lm_studio') return 'lmstudio';
  if (lower === 'mimo' || lower === 'xiaomi' || lower === 'xiaomimimo') return 'mimo';
  if (lower === 'nvidia' || lower === 'nvidia-nim' || lower === 'nim') return 'nvidia';
  return 'custom';
}
