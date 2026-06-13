/**
 * HTTP API 工具 — 调用本地/远程 HTTP 服务
 *
 * 用途：接入 ComfyUI、Whisper、Stable Diffusion WebUI 等本地服务。
 * 用户在 config.customTools 中声明端点，Buddy 自动注册为工具。
 *
 * 设计原则：
 *   1. 通用 HTTP 客户端，不绑定特定服务
 *   2. 参数透传，由 LLM 决定发什么
 *   3. 超时/错误处理完善
 *   4. 结果自动截断（避免大文件内容灌入上下文）
 */

import { z } from 'zod';
import type { ToolDef, BuddyConfig } from '../types.js';

/** 自定义工具元素类型 */
type CustomToolItem = NonNullable<BuddyConfig['customTools']>[number];
/** 模板用，endpoint 可选 */
type CustomToolTemplate = Omit<CustomToolItem, 'endpoint'> & { endpoint?: string };

/** 从 config.customTools 生成 ToolDef 列表 */
export function createHttpApiTools(customTools: BuddyConfig['customTools']): ToolDef[] {
  if (!customTools?.length) return [];

  return customTools.map((ct) => {
    const tool: ToolDef = {
      name: ct.id,
      description: ct.description,
      parameters: buildZodSchema(ct.parameters),
      permission: 'exec_safe',
      source: 'plugin',
      execute: async (args: Record<string, unknown>) => {
        const method = ct.method ?? 'POST';
        const timeoutMs = ct.timeoutMs ?? 30_000;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...ct.headers,
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const fetchOptions: RequestInit = {
            method,
            headers,
            signal: controller.signal,
          };

          if (method === 'POST' || method === 'PUT') {
            fetchOptions.body = JSON.stringify(args);
          } else {
            // GET: 参数拼到 URL query
            const url = new URL(ct.endpoint);
            for (const [k, v] of Object.entries(args)) {
              url.searchParams.set(k, String(v));
            }
            ct.endpoint = url.toString();
          }

          const resp = await fetch(ct.endpoint, fetchOptions);

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return `[${ct.name}] HTTP ${resp.status}: ${errText.slice(0, 500)}`;
          }

          // 尝试 JSON 解析
          const contentType = resp.headers.get('content-type') ?? '';
          if (contentType.includes('json')) {
            const data = await resp.json();
            const output = JSON.stringify(data, null, 2);
            return truncate(output, 5000);
          }

          // 纯文本
          const text = await resp.text();
          return truncate(text, 5000);
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            return `[${ct.name}] 请求超时 (${timeoutMs}ms)`;
          }
          return `[${ct.name}] 请求失败: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          clearTimeout(timer);
        }
      },
    };
    return tool;
  });
}

/**
 * 预置的常用本地服务工具模板
 * 用户只需在 config 中填 endpoint，不需要手写 description/schema
 */
export const PRESET_TOOL_TEMPLATES: Record<string, CustomToolTemplate> = {
  comfyui_generate: {
    id: 'comfyui_generate',
    name: 'ComfyUI 文生图',
    description: '通过 ComfyUI 本地部署生成图片。传入 prompt（描述）和可选的 width/height/steps 等参数。返回生成结果。',
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述' },
        negative_prompt: { type: 'string', description: '负面提示词（不想要的内容）' },
        width: { type: 'number', description: '宽度，默认 1024' },
        height: { type: 'number', description: '高度，默认 1024' },
        steps: { type: 'number', description: '采样步数，默认 20' },
        seed: { type: 'number', description: '随机种子，-1 为随机' },
      },
      required: ['prompt'],
    },
    timeoutMs: 300_000,
  },
  comfyui_video: {
    id: 'comfyui_video',
    name: 'ComfyUI 文生视频',
    description: '通过 ComfyUI 本地部署生成视频。传入 prompt 描述，返回视频文件。',
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频描述' },
        width: { type: 'number', description: '宽度，默认 832' },
        height: { type: 'number', description: '高度，默认 480' },
        frames: { type: 'number', description: '帧数，默认 81' },
        fps: { type: 'number', description: '帧率，默认 16' },
        seed: { type: 'number', description: '随机种子，-1 为随机' },
      },
      required: ['prompt'],
    },
    timeoutMs: 600_000,
  },
  whisper_transcribe: {
    id: 'whisper_transcribe',
    name: 'Whisper 语音转文字',
    description: '通过本地 Whisper 服务转录音频。传入音频文件路径。',
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        audio_path: { type: 'string', description: '音频文件路径' },
        language: { type: 'string', description: '语言代码，如 zh、en' },
      },
      required: ['audio_path'],
    },
  },
  ollama_generate: {
    id: 'ollama_generate',
    name: 'Ollama 文本生成',
    description: '通过本地 Ollama 生成文本。适合独立于主 LLM 的辅助生成任务。',
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '输入文本' },
        model: { type: 'string', description: '模型名，如 qwen3:8b' },
        system: { type: 'string', description: '系统提示词' },
      },
      required: ['prompt'],
    },
  },
};

/**
 * 根据模板 ID 生成完整 ToolDef（用户只需填 endpoint）
 */
export function createFromPreset(
  presetId: string,
  endpoint: string,
  overrides?: Partial<CustomToolItem>,
): CustomToolItem {
  const template = PRESET_TOOL_TEMPLATES[presetId];
  if (!template) throw new Error(`未知的预设工具模板: ${presetId}`);

  return {
    ...template,
    ...overrides,
    endpoint,
  } as CustomToolItem;
}

// ==================== 内部工具函数 ====================

function buildZodSchema(schema?: Record<string, unknown>): z.ZodType {
  if (!schema?.properties) {
    // 无 schema → 接受任意 JSON 对象
    return z.record(z.unknown());
  }

  const props = schema.properties as Record<string, any>;
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(props)) {
    switch (def.type) {
      case 'string':
        shape[key] = z.string().describe(def.description ?? '');
        break;
      case 'number':
        shape[key] = z.number().describe(def.description ?? '');
        break;
      case 'boolean':
        shape[key] = z.boolean().describe(def.description ?? '');
        break;
      default:
        shape[key] = z.unknown().describe(def.description ?? '');
    }

    // 可选字段
    const required = (schema.required as string[]) ?? [];
    if (!required.includes(key)) {
      shape[key] = shape[key].optional();
    }
  }

  return z.object(shape);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n... (已截断，共 ${text.length} 字符)`;
}
