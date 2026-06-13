/**
 * 屏幕 RPA 工具集 — 截图 + OCR 文字识别
 *
 * 依赖系统命令：
 * - 截图: scrot (Linux) / screencapture (macOS) / nircmd (Windows)
 * - OCR: tesseract
 */

import { z } from 'zod';
import type { ToolDef } from '../types.js';

export const screen_capture: ToolDef = {
  name: 'screen_capture',
  description: '截取当前屏幕截图。可指定区域或全屏。',
  parameters: z.object({
    output: z.string().optional().describe('输出路径，默认 /tmp/buddy-screen.png'),
    region: z.string().optional().describe('截图区域 "x,y,w,h"，不填为全屏'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const output = (args.output as string) ?? '/tmp/buddy-screen.png';
    const region = args.region as string | undefined;

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const os = await import('os');

      const platform = os.platform();
      let cmd: string;

      if (platform === 'darwin') {
        cmd = region
          ? `screencapture -R ${region.replace(/,/g, ' ')} "${output}"`
          : `screencapture "${output}"`;
      } else if (platform === 'linux') {
        cmd = region
          ? `scrot "${output}" -a ${region}`
          : `scrot "${output}"`;
      } else {
        return '[屏幕截图] 不支持的操作系统，仅支持 Linux/macOS';
      }

      await execAsync(cmd, { timeout: 10000 });
      return `屏幕截图已保存到 ${output}`;
    } catch (err) {
      return `[屏幕截图失败] ${(err as Error).message}. Linux 需安装: apt install scrot`;
    }
  },
};

export const screen_ocr: ToolDef = {
  name: 'screen_ocr',
  description: '对截图或图片进行 OCR 文字识别，提取图中文字。',
  parameters: z.object({
    image: z.string().describe('图片文件路径'),
    lang: z.string().optional().describe('语言 (chi_sim/eng)，默认自动'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const image = args.image as string;
    const lang = (args.lang as string) ?? 'chi_sim+eng';

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // 检查 tesseract 是否安装
      try {
        await execAsync('which tesseract');
      } catch {
        return '[OCR] 需要安装 tesseract: apt install tesseract-ocr tesseract-ocr-chi-sim';
      }

      const outputBase = '/tmp/buddy-ocr-output';
      await execAsync(`tesseract "${image}" ${outputBase} -l ${lang}`, { timeout: 30000 });

      const fs = await import('fs/promises');
      const text = await fs.readFile(`${outputBase}.txt`, 'utf-8');
      await fs.unlink(`${outputBase}.txt`).catch(() => {});

      return text.trim() || '未识别到文字';
    } catch (err) {
      return `[OCR 失败] ${(err as Error).message}`;
    }
  },
};

export const screen_describe: ToolDef = {
  name: 'screen_describe',
  description: '截取屏幕并识别图中内容，返回文字描述。',
  parameters: z.object({
    region: z.string().optional().describe('截图区域 "x,y,w,h"，不填为全屏'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const output = '/tmp/buddy-screen-describe.png';
    const region = args.region as string | undefined;

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const os = await import('os');

      // 截图
      const platform = os.platform();
      if (platform === 'darwin') {
        await execAsync(`screencapture "${output}"`, { timeout: 10000 });
      } else if (platform === 'linux') {
        await execAsync(`scrot "${output}"`, { timeout: 10000 });
      } else {
        return '[屏幕描述] 不支持的操作系统';
      }

      // OCR 提取文字
      try {
        await execAsync('which tesseract');
        const ocrBase = '/tmp/buddy-screen-ocr';
        await execAsync(`tesseract "${output}" ${ocrBase} -l chi_sim+eng`, { timeout: 30000 });
        const fs = await import('fs/promises');
        const text = (await fs.readFile(`${ocrBase}.txt`, 'utf-8')).trim();
        await fs.unlink(`${ocrBase}.txt`).catch(() => {});

        if (text) {
          return `屏幕内容（OCR 识别）:\n${text.slice(0, 2000)}`;
        }
        return '屏幕截图已完成，但 OCR 未识别到文字。图片已保存到 ' + output;
      } catch {
        return `屏幕截图已保存到 ${output}，但 tesseract 未安装，无法 OCR。安装命令: apt install tesseract-ocr`;
      }
    } catch (err) {
      return `[屏幕描述失败] ${(err as Error).message}`;
    }
  },
};

export const SCREEN_TOOLS: ToolDef[] = [screen_capture, screen_ocr, screen_describe];
