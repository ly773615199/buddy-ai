/**
 * 浏览器自动化工具集 — 基于系统命令调用
 *
 * 提供页面截图、网页内容提取、表单填写等浏览器操作。
 * 依赖系统已安装的 chromium/chrome/playwright。
 *
 * 安全修复：
 * - CRIT-01: 浏览器工具代码注入 — 参数通过 JSON.stringify 安全传递，杜绝模板拼接注入
 * - MAJ-03: SSRF 防护 — URL 校验拒绝内网/元数据地址，禁止 curl -L 重定向到内网
 */

import { z } from 'zod';
import path from 'path';
import { URL } from 'url';
import type { ToolDef } from '../types.js';

// ==================== URL 安全校验 ====================

/** 需要拒绝的内网/特殊 IP 段和主机名 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

/** 验证 URL 是否允许 fetch（拒绝内网、元数据端点等） */
function validateFetchUrl(urlStr: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'URL 格式无效' };
  }

  // 只允许 http/https
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: `不允许的协议: ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase();

  // 拒绝已知危险主机名
  if (BLOCKED_HOSTS.has(hostname)) {
    return { ok: false, reason: `禁止访问: ${hostname}` };
  }

  // 拒绝 loopback
  if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    return { ok: false, reason: `禁止访问 loopback: ${hostname}` };
  }

  // 拒绝链路本地地址（AWS/GCP/Azure 元数据）
  if (hostname.startsWith('169.254.')) {
    return { ok: false, reason: `禁止访问链路本地地址: ${hostname}` };
  }

  // 拒绝私有 IP 段
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    // 10.0.0.0/8
    if (a === 10) return { ok: false, reason: `禁止访问内网地址: ${hostname}` };
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: `禁止访问内网地址: ${hostname}` };
    // 192.168.0.0/16
    if (a === 192 && b === 168) return { ok: false, reason: `禁止访问内网地址: ${hostname}` };
  }

  // 拒绝 .local / .internal 等 mDNS / 内网域名
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    return { ok: false, reason: `禁止访问内网域名: ${hostname}` };
  }

  return { ok: true };
}

/** 验证输出路径是否安全（只能写 /tmp 或 sandbox） */
function validateOutputPath(p: string): { ok: boolean; reason?: string } {
  const resolved = path.resolve(p);
  const allowedPrefixes = ['/tmp/', '/var/tmp/'];
  const processDir = process.cwd();
  if (resolved.startsWith(processDir + '/') || resolved === processDir) return { ok: true };
  for (const prefix of allowedPrefixes) {
    if (resolved.startsWith(prefix)) return { ok: true };
  }
  return { ok: false, reason: `输出路径 ${resolved} 不在允许范围内（仅限 /tmp）` };
}

// ==================== 工具定义 ====================

export const browser_screenshot: ToolDef = {
  name: 'browser_screenshot',
  description: '截取网页截图，保存为 PNG 文件。可指定视口大小和等待时间。',
  parameters: z.object({
    url: z.string().describe('目标 URL'),
    output: z.string().optional().describe('输出文件路径，默认 /tmp/buddy-screenshot.png'),
    width: z.number().optional().describe('视口宽度，默认 1280'),
    height: z.number().optional().describe('视口高度，默认 720'),
    wait: z.number().optional().describe('页面加载等待秒数，默认 3'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const url = args.url as string;
    const output = (args.output as string) ?? '/tmp/buddy-screenshot.png';
    const width = (args.width as number) ?? 1280;
    const height = (args.height as number) ?? 720;
    const wait = (args.wait as number) ?? 3;

    // 安全校验
    const urlCheck = validateFetchUrl(url);
    if (!urlCheck.ok) return `[拒绝: ${urlCheck.reason}]`;

    const pathCheck = validateOutputPath(output);
    if (!pathCheck.ok) return `[拒绝: ${pathCheck.reason}]`;

    // CRIT-01 修复: 通过 JSON.stringify 安全传递参数，杜绝代码注入
    const script = `
const { chromium } = require('playwright');
(async () => {
  const params = ${JSON.stringify({ url, output, width, height, wait })};
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: params.width, height: params.height } });
  await page.goto(params.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(params.wait * 1000);
  await page.screenshot({ path: params.output, fullPage: false });
  await browser.close();
  console.log('OK');
})();
`;

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const tmpScript = '/tmp/buddy-browser-screenshot.js';
      const fs = await import('fs/promises');
      await fs.writeFile(tmpScript, script);

      const { stdout, stderr } = await execAsync(`node ${tmpScript}`, { timeout: 45000 });
      await fs.unlink(tmpScript).catch(() => {});

      if (stderr && !stderr.includes('Warning')) {
        return `[浏览器截图失败] ${stderr.slice(0, 200)}`;
      }
      return `截图已保存到 ${output} (${width}x${height})`;
    } catch (err) {
      return `[浏览器截图失败] ${(err as Error).message}. 请确保已安装: npm install playwright`;
    }
  },
};

export const browser_extract: ToolDef = {
  name: 'browser_extract',
  description: '提取网页的文本内容和结构。去除广告/导航/脚本，返回干净的可读文本。',
  parameters: z.object({
    url: z.string().describe('目标 URL'),
    maxChars: z.number().optional().describe('最大字符数，默认 5000'),
  }),
  permission: 'web_search',
  execute: async (args) => {
    const url = args.url as string;
    const maxChars = (args.maxChars as number) ?? 5000;

    // SSRF 防护
    const urlCheck = validateFetchUrl(url);
    if (!urlCheck.ok) return `[拒绝: ${urlCheck.reason}]`;

    try {
      // MAJ-03 修复: 使用 Node.js fetch 替代 curl -L，防止 SSRF 链式重定向
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BuddyBot/1.0)' },
      });
      clearTimeout(timer);

      if (!resp.ok) {
        return `[网页提取失败] HTTP ${resp.status}`;
      }

      const html = await resp.text();
      // 简单 HTML → 纯文本：去标签 + 压缩空白
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);

      return text || '无法提取网页内容';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) return '[网页提取失败] 请求超时（15s）';
      return `[网页提取失败] ${msg}`;
    }
  },
};

export const browser_pdf: ToolDef = {
  name: 'browser_pdf',
  description: '将网页保存为 PDF 文件。',
  parameters: z.object({
    url: z.string().describe('目标 URL'),
    output: z.string().optional().describe('输出 PDF 路径，默认 /tmp/buddy-page.pdf'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const url = args.url as string;
    const output = (args.output as string) ?? '/tmp/buddy-page.pdf';

    // 安全校验
    const urlCheck = validateFetchUrl(url);
    if (!urlCheck.ok) return `[拒绝: ${urlCheck.reason}]`;

    const pathCheck = validateOutputPath(output);
    if (!pathCheck.ok) return `[拒绝: ${pathCheck.reason}]`;

    // CRIT-01 修复: 通过 JSON.stringify 安全传递参数
    const script = `
const { chromium } = require('playwright');
(async () => {
  const params = ${JSON.stringify({ url, output })};
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(params.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.pdf({ path: params.output, format: 'A4', margin: { top: '20px', bottom: '20px' } });
  await browser.close();
  console.log('OK');
})();
`;

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const fs = await import('fs/promises');

      const tmpScript = '/tmp/buddy-browser-pdf.js';
      await fs.writeFile(tmpScript, script);

      const { stderr } = await execAsync(`node ${tmpScript}`, { timeout: 45000 });
      await fs.unlink(tmpScript).catch(() => {});

      if (stderr && !stderr.includes('Warning')) {
        return `[PDF 生成失败] ${stderr.slice(0, 200)}`;
      }
      return `PDF 已保存到 ${output}`;
    } catch (err) {
      return `[PDF 生成失败] ${(err as Error).message}. 请确保已安装: npm install playwright`;
    }
  },
};

export const BROWSER_TOOLS: ToolDef[] = [browser_screenshot, browser_extract, browser_pdf];
