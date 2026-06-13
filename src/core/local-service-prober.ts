/**
 * LocalServiceProber — 启动时自动探测本地 AI 服务
 *
 * 并行探测已知端口，命中则自动注册到配置。
 * 探测失败静默跳过，不影响启动速度。
 *
 * 支持：
 *   - Ollama      (localhost:11434)
 *   - LM Studio   (localhost:1234)
 *   - ComfyUI     (localhost:8188)
 *   - vLLM        (localhost:8000)
 *   - LocalAI     (localhost:8080)
 */

import type { BuddyConfig } from '../types.js';

export interface ProbedService {
  id: string;
  type: 'ollama' | 'lmstudio' | 'comfyui' | 'vllm' | 'localai';
  name: string;
  baseUrl: string;
  models: string[];
  /** 是否需要注册为 provider（LLM 类型） */
  isProvider: boolean;
  /** 是否需要注册为 customTool（非 LLM 类型，如 ComfyUI） */
  isTool: boolean;
}

interface ProbeTarget {
  id: string;
  type: ProbedService['type'];
  name: string;
  baseUrl: string;
  probeUrl: string;
  probeMethod: 'GET' | 'HEAD';
  extractModels: (data: any) => string[];
  isProvider: boolean;
  isTool: boolean;
  /** 自定义工具配置（isTool=true 时使用） */
  toolConfig?: NonNullable<BuddyConfig['customTools']>[number];
}

const PROBE_TARGETS: ProbeTarget[] = [
  {
    id: 'ollama',
    type: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    probeUrl: 'http://localhost:11434/api/tags',
    probeMethod: 'GET',
    extractModels: (data: any) => {
      if (data?.models) return data.models.map((m: any) => m.name ?? m.id).filter(Boolean);
      return [];
    },
    isProvider: true,
    isTool: false,
  },
  {
    id: 'lmstudio',
    type: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    probeUrl: 'http://localhost:1234/v1/models',
    probeMethod: 'GET',
    extractModels: (data: any) => {
      if (data?.data) return data.data.map((m: any) => m.id).filter(Boolean);
      if (Array.isArray(data)) return data.map((m: any) => m.id ?? m.name).filter(Boolean);
      return [];
    },
    isProvider: true,
    isTool: false,
  },
  {
    id: 'comfyui',
    type: 'comfyui',
    name: 'ComfyUI',
    baseUrl: 'http://localhost:8188',
    probeUrl: 'http://localhost:8188/system_stats',
    probeMethod: 'GET',
    extractModels: () => [], // ComfyUI 不走 LLM 模型池
    isProvider: false,
    isTool: true,
    toolConfig: {
      id: 'comfyui_generate',
      name: 'ComfyUI 文生图',
      description: '通过本地 ComfyUI 生成图片。传入 workflow JSON 或 prompt。',
      endpoint: 'http://localhost:8188/api/prompt',
      method: 'POST',
      timeoutMs: 300000,
    },
  },
  {
    id: 'vllm',
    type: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://localhost:8000/v1',
    probeUrl: 'http://localhost:8000/v1/models',
    probeMethod: 'GET',
    extractModels: (data: any) => {
      if (data?.data) return data.data.map((m: any) => m.id).filter(Boolean);
      return [];
    },
    isProvider: true,
    isTool: false,
  },
  {
    id: 'localai',
    type: 'localai',
    name: 'LocalAI',
    baseUrl: 'http://localhost:8080/v1',
    probeUrl: 'http://localhost:8080/v1/models',
    probeMethod: 'GET',
    extractModels: (data: any) => {
      if (data?.data) return data.data.map((m: any) => m.id).filter(Boolean);
      return [];
    },
    isProvider: true,
    isTool: false,
  },
];

const PROBE_TIMEOUT_MS = 2000;

/**
 * 探测单个服务
 */
async function probeOne(target: ProbeTarget): Promise<ProbedService | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const resp = await fetch(target.probeUrl, {
      method: target.probeMethod,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const data = await resp.json();
    const models = target.extractModels(data);

    return {
      id: target.id,
      type: target.type,
      name: target.name,
      baseUrl: target.baseUrl,
      models,
      isProvider: target.isProvider,
      isTool: target.isTool,
    };
  } catch {
    return null;
  }
}

/**
 * 并行探测所有已知本地服务
 * 返回发现的服务列表
 */
export async function probeLocalServices(): Promise<ProbedService[]> {
  const results = await Promise.allSettled(
    PROBE_TARGETS.map((t) => probeOne(t)),
  );

  const discovered: ProbedService[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      discovered.push(r.value);
    }
  }
  return discovered;
}

/**
 * 探测并自动注册到配置
 *
 * 逻辑：
 *   1. 并行探测所有本地服务
 *   2. 对于 LLM provider：检查 config.models.providers 中是否已有同类型
 *      → 没有则自动添加
 *   3. 对于 customTool：检查 config.customTools 中是否已有同 ID
 *      → 没有则自动添加
 *   4. 返回变更摘要（用于日志/通知）
 *
 * @returns 变更描述数组，无变更则返回空数组
 */
export async function probeAndAutoRegister(
  config: BuddyConfig,
): Promise<{ config: BuddyConfig; changes: string[] }> {
  const discovered = await probeLocalServices();
  if (discovered.length === 0) return { config, changes: [] };

  const changes: string[] = [];
  const existingProviders = config.models?.providers ?? [];
  const existingTools = config.customTools ?? [];

  let providersUpdated = false;
  let toolsUpdated = false;
  const newProviders = [...existingProviders];
  const newTools = [...existingTools];

  for (const svc of discovered) {
    // ── LLM Provider 自动注册 ──
    if (svc.isProvider) {
      const alreadyExists = existingProviders.some(
        (p) => p.type === svc.type || p.baseUrl === svc.baseUrl,
      );
      if (!alreadyExists) {
        // 用第一个发现的模型作为默认模型
        const defaultModel = svc.models[0] ?? '';
        newProviders.push({
          id: svc.id,
          type: svc.type as any,
          model: defaultModel,
          baseUrl: svc.baseUrl,
        });
        providersUpdated = true;
        const modelInfo = svc.models.length > 0
          ? `，发现 ${svc.models.length} 个模型（默认: ${defaultModel}）`
          : '';
        changes.push(`📡 自动发现 ${svc.name} (${svc.baseUrl})${modelInfo}`);
      }
    }

    // ── Custom Tool 自动注册 ──
    if (svc.isTool && svc.type === 'comfyui') {
      const alreadyExists = existingTools.some((t) => t.id === 'comfyui_generate');
      if (!alreadyExists && PROBE_TARGETS.find((t) => t.id === 'comfyui')?.toolConfig) {
        newTools.push(PROBE_TARGETS.find((t) => t.id === 'comfyui')!.toolConfig as any);
        toolsUpdated = true;
        changes.push(`🎨 自动发现 ComfyUI (${svc.baseUrl})，已注册文生图工具`);
      }
    }
  }

  // 构建新配置
  let newConfig = config;
  if (providersUpdated || toolsUpdated) {
    newConfig = {
      ...config,
      ...(providersUpdated ? { models: { ...(config.models ?? {}), providers: newProviders, strategy: config.models?.strategy ?? 'task_match' } } : {}),
      ...(toolsUpdated ? { customTools: newTools } : {}),
    };
  }

  return { config: newConfig, changes };
}
