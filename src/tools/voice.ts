/**
 * 语音工具集 — TTS 语音合成
 *
 * 将 TTSManager 包装为 ToolDef，供 Agent 调用。
 * 注意：STT 在浏览器端，Node.js 后端不支持。
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolDef } from '../types.js';
import type { TTSManager, TTSOptions } from '../voice/tts.js';

/** 创建语音工具集（工厂函数，需要注入 TTSManager 实例） */
export function createVoiceTools(tts: TTSManager): ToolDef[] {

  const tts_speak: ToolDef = {
    name: 'tts_speak',
    description: '将文本转为语音并保存为音频文件。支持中英文，可指定音色、语速、音调。',
    parameters: z.object({
      text: z.string().describe('要合成的文本内容'),
      voice: z.string().optional().describe('音色 ID，如 zh-CN-XiaoxiaoNeural，不填用默认'),
      output: z.string().optional().describe('输出文件路径，默认 /tmp/buddy-tts-output.mp3'),
      rate: z.string().optional().describe('语速，如 "+20%"、"-10%"'),
      pitch: z.string().optional().describe('音调，如 "+5Hz"、"-3Hz"'),
    }),
    permission: 'exec_safe',
    execute: async (args) => {
      const text = args.text as string;
      const voice = args.voice as string | undefined;
      const output = (args.output as string) ?? '/tmp/buddy-tts-output.mp3';
      const rate = args.rate as string | undefined;
      const pitch = args.pitch as string | undefined;

      if (!text.trim()) {
        return '[TTS] 文本为空，无法合成';
      }

      const options: TTSOptions = {};
      if (voice) options.voice = voice;
      if (rate) options.rate = rate;
      if (pitch) options.pitch = pitch;

      const result = await tts.synthesize(text, options);

      if (!result.success) {
        return `[TTS 合成失败] ${result.error}`;
      }

      if (!result.audioBuffer) {
        return '[TTS] 未获取到音频数据';
      }

      // 确保输出目录存在
      const dir = path.dirname(output);
      await fs.mkdir(dir, { recursive: true });

      // 保存音频文件
      await fs.writeFile(output, result.audioBuffer);

      const sizeKB = Math.round(result.audioBuffer.length / 1024);
      const durationSec = result.duration ? (result.duration / 1000).toFixed(1) : '未知';

      return JSON.stringify({
        success: true,
        file: output,
        format: result.format,
        sizeKB,
        estimatedDuration: `${durationSec}秒`,
        textLength: text.length,
      });
    },
  };

  const tts_voices: ToolDef = {
    name: 'tts_voices',
    description: '列出所有可用的 TTS 音色，包括音色 ID、语言、性别、风格。',
    parameters: z.object({}),
    permission: 'basic',
    execute: async () => {
      const backend = tts.getActiveBackend();
      if (!backend) {
        return '[TTS] 没有可用的 TTS 后端';
      }

      const voices = backend.listVoices();
      const lines = voices.map(v => {
        const style = v.style ? ` (${v.style})` : '';
        return `${v.id} | ${v.name}${style} | ${v.language} | ${v.gender}`;
      });

      return `后端: ${backend.name}\n共 ${voices.length} 个音色:\n${lines.join('\n')}`;
    },
  };

  const tts_status: ToolDef = {
    name: 'tts_status',
    description: '查看 TTS 系统状态：启用状态、活跃后端、可用后端列表。',
    parameters: z.object({}),
    permission: 'basic',
    execute: async () => {
      const enabled = tts.isEnabled();
      const backends = tts.listBackends();
      const active = tts.getActiveBackend();

      const status = [
        `启用: ${enabled ? '是' : '否'}`,
        `活跃后端: ${active?.name ?? '无'}`,
        `已注册后端: ${backends.join(', ') || '无'}`,
      ];

      if (active) {
        const available = await active.isAvailable();
        status.push(`活跃后端可用: ${available ? '是' : '否'}`);
      }

      return status.join('\n');
    },
  };

  return [tts_speak, tts_voices, tts_status];
}
