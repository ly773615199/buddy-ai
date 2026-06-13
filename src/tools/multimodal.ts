/**
 * 多模态工具集 — 图片生成、语音识别、文本向量化、OCR
 *
 * 注册为 ToolDef，供 Agent / DAG 编排调用。
 * 内部委托给 LLMAdapter.executeMultimodal()。
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolDef } from '../types.js';
import type { LLMAdapter } from '../core/llm.js';
import type { TaskType } from '../core/model-router.js';

/** 创建多模态工具集（工厂函数，需要注入 LLMAdapter 实例） */
export function createMultimodalTools(llm: LLMAdapter): ToolDef[] {

  const image_generate: ToolDef = {
    name: 'image_generate',
    description: '根据文字描述生成图片。返回图片 URL 或本地保存路径。',
    parameters: z.object({
      prompt: z.string().describe('图片描述，越详细效果越好'),
      size: z.string().optional().describe('图片尺寸，如 "1024x1024"、"512x512"，默认 1024x1024'),
      output: z.string().optional().describe('保存图片的本地路径，不填则只返回 URL'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const prompt = args.prompt as string;
      const size = args.size as string | undefined;
      const output = args.output as string | undefined;

      if (!prompt.trim()) return '[ImageGen] prompt 不能为空';

      try {
        const result = await llm.executeMultimodal('image-gen', prompt, {
          imageSize: size ?? '1024x1024',
        });

        if (result.type !== 'image') return '[ImageGen] 意外的返回类型';

        const response: Record<string, unknown> = {
          success: true,
          type: 'image',
          urlCount: result.urls.length,
          urls: result.urls,
        };

        // 如果指定了输出路径，下载第一张图片
        if (output && result.urls.length > 0) {
          try {
            const resp = await fetch(result.urls[0]);
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              const dir = path.dirname(output);
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(output, buffer);
              response.savedTo = output;
              response.sizeKB = Math.round(buffer.length / 1024);
            }
          } catch (dlErr) {
            response.downloadError = `下载失败: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`;
          }
        }

        // 如果有 base64 图片且指定了输出路径
        if (output && result.b64Images?.length && !response.savedTo) {
          try {
            const buffer = Buffer.from(result.b64Images[0], 'base64');
            const dir = path.dirname(output);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(output, buffer);
            response.savedTo = output;
            response.sizeKB = Math.round(buffer.length / 1024);
          } catch (writeErr) {
            response.saveError = `保存失败: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`;
          }
        }

        if (result.revisedPrompt) response.revisedPrompt = result.revisedPrompt;

        return JSON.stringify(response, null, 2);
      } catch (err) {
        return `[ImageGen 失败] ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const speech_recognize: ToolDef = {
    name: 'speech_recognize',
    description: '识别音频文件中的语音内容（ASR/STT）。支持 wav、mp3、m4a 等格式。',
    parameters: z.object({
      audio_path: z.string().describe('音频文件路径'),
      language: z.string().optional().describe('音频语言代码，如 "zh"、"en"，不填自动检测'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const audioPath = args.audio_path as string;
      const language = args.language as string | undefined;

      try {
        const audioBuffer = await fs.readFile(audioPath);
        const result = await llm.executeMultimodal('asr', audioBuffer, {
          language,
        });

        if (result.type !== 'asr') return '[ASR] 意外的返回类型';

        const response: Record<string, unknown> = {
          success: true,
          text: result.text,
          textLength: result.text.length,
        };
        if (result.language) response.language = result.language;
        if (result.duration) response.durationSec = result.duration;
        if (result.segments?.length) response.segmentCount = result.segments.length;

        return JSON.stringify(response, null, 2);
      } catch (err) {
        return `[ASR 失败] ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const text_embed: ToolDef = {
    name: 'text_embed',
    description: '将文本转换为向量嵌入（Embedding）。用于语义搜索、相似度计算等场景。',
    parameters: z.object({
      text: z.string().describe('要向量化的文本'),
      output: z.string().optional().describe('保存向量的文件路径（JSON 格式），不填则只返回摘要'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const text = args.text as string;
      const output = args.output as string | undefined;

      if (!text.trim()) return '[Embedding] 文本不能为空';

      try {
        const result = await llm.executeMultimodal('embedding', text);

        if (result.type !== 'embedding') return '[Embedding] 意外的返回类型';

        const response: Record<string, unknown> = {
          success: true,
          dimensions: result.dimensions,
          vectorCount: result.embeddings.length,
          model: result.model,
        };
        if (result.usage) response.usage = result.usage;

        // 保存完整向量到文件
        if (output && result.embeddings.length > 0) {
          const dir = path.dirname(output);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(output, JSON.stringify({
            model: result.model,
            dimensions: result.dimensions,
            embeddings: result.embeddings,
          }, null, 2));
          response.savedTo = output;
        }

        // 返回向量摘要（前 8 维 + 总维度）
        if (result.embeddings[0]) {
          response.preview = `[${result.embeddings[0].slice(0, 8).map((v: number) => v.toFixed(4)).join(', ')}...] (${result.dimensions}d)`;
        }

        return JSON.stringify(response, null, 2);
      } catch (err) {
        return `[Embedding 失败] ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const image_ocr: ToolDef = {
    name: 'image_ocr',
    description: '识别图片中的文字内容（OCR）。支持截图、照片、扫描件等。',
    parameters: z.object({
      image_path: z.string().describe('图片文件路径'),
      prompt: z.string().optional().describe('自定义识别指令，默认提取所有文字'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const imagePath = args.image_path as string;
      const prompt = args.prompt as string | undefined;

      try {
        const imageBuffer = await fs.readFile(imagePath);
        const result = await llm.executeMultimodal('ocr', imageBuffer, {
          ocrPrompt: prompt,
        });

        if (result.type !== 'ocr') return '[OCR] 意外的返回类型';

        const response: Record<string, unknown> = {
          success: true,
          text: result.text,
          textLength: result.text.length,
        };
        if (result.blocks?.length) response.blockCount = result.blocks.length;

        return JSON.stringify(response, null, 2);
      } catch (err) {
        return `[OCR 失败] ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const video_generate: ToolDef = {
    name: 'video_generate',
    description: '根据文字描述生成视频。返回视频 URL 或本地保存路径。',
    parameters: z.object({
      prompt: z.string().describe('视频描述，越详细效果越好'),
      output: z.string().optional().describe('保存视频的本地路径，不填则只返回 URL'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const prompt = args.prompt as string;
      const output = args.output as string | undefined;

      if (!prompt.trim()) return '[VideoGen] prompt 不能为空';

      try {
        const result = await llm.executeMultimodal('video-gen', prompt);

        if (result.type !== 'video') return '[VideoGen] 意外的返回类型';

        const response: Record<string, unknown> = {
          success: true,
          type: 'video',
          urlCount: result.urls.length,
          urls: result.urls,
        };

        // 如果指定了输出路径，下载第一个视频
        if (output && result.urls.length > 0) {
          try {
            const resp = await fetch(result.urls[0]);
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              const dir = path.dirname(output);
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(output, buffer);
              response.savedTo = output;
              response.sizeKB = Math.round(buffer.length / 1024);
            }
          } catch (dlErr) {
            response.downloadError = `下载失败: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`;
          }
        }

        return JSON.stringify(response, null, 2);
      } catch (err) {
        return `[VideoGen 失败] ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  return [image_generate, video_generate, speech_recognize, text_embed, image_ocr];
}
