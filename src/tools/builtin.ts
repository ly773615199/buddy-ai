import { z } from 'zod';
import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import type { ToolDef } from '../types.js';
import { WEB_TOOLS } from './web.js';
import { globalToolCache } from './cache.js';
import { CODE_INTEL_TOOLS } from './code-intel.js';
import { BROWSER_TOOLS } from './browser.js';
import { SCREEN_TOOLS } from './screen.js';
import { scan_project, project_context, project_symbols, project_deps, project_index_stats, project_index_rebuild } from './project.js';
import { GIT_OPS_TOOLS } from './git-ops.js';
import { SandboxExecutor, defaultSandbox } from './sandbox.js';

// 向后兼容：保留旧的 execAsync（仅 git 等只读操作需要 shell 时使用）
import { exec as execCb, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

// ==================== 安全检查 ====================
// exec 安全检查已迁移到 sandbox.ts
// 这里保留文件操作的路径保护

const SENSITIVE_PATHS = [
  '/etc/shadow', '/etc/passwd', '/etc/sudoers',
  '.ssh/', '.gnupg/', '.env', '.env.local',
  'id_rsa', 'id_ed25519', 'id_ecdsa',
  '.pem', '.key', 'credentials',
  // ISSUE-020: 补充缺失的敏感路径
  '.aws/', '.kube/config', '.docker/config.json', '.npmrc',
  '.gcp/', '.azure/', 'credentials.json',
];

function isSensitivePath(p: string): boolean {
  const resolved = path.resolve(p);
  return SENSITIVE_PATHS.some((sp) => resolved.includes(sp) || p.includes(sp));
}

// ==================== 路径范围限制（MAJ-04/05 修复） ====================

/** 允许文件操作的根目录列表 */
const SANDBOX_WORKSPACE = process.env.BUDDY_SANDBOX_WORKSPACE || '/tmp/buddy-sandbox';

const ALLOWED_FILE_ROOTS: string[] = (() => {
  const roots = [
    process.cwd(),
    SANDBOX_WORKSPACE,
    '/tmp',
    '/var/tmp',
  ];
  const home = process.env.HOME;
  if (home) roots.push(path.join(home, '.buddy'));
  return roots;
})();

/**
 * 解析文件路径：智能路径解析
 *
 * 解析优先级：
 * 1. 绝对路径直接使用
 * 2. 项目目录（process.cwd()）下存在 → 使用项目路径
 * 3. 沙箱目录下存在 → 使用沙箱路径
 * 4. 默认基于项目目录解析（write_file 场景）
 */
function resolveFilePath(filePath: string, preferSandbox = false): string {
  if (path.isAbsolute(filePath)) return filePath;

  const projectResolved = path.resolve(process.cwd(), filePath);
  const sandboxResolved = path.resolve(SANDBOX_WORKSPACE, filePath);

  // write_file 场景：优先沙箱（保持向后兼容）
  if (preferSandbox) {
    return sandboxResolved;
  }

  // read_file / list_files 场景：优先项目目录
  try {
    if (fss.existsSync(projectResolved)) return projectResolved;
  } catch { /* 继续 */ }

  // 沙箱目录下存在
  try {
    if (fss.existsSync(sandboxResolved)) return sandboxResolved;
  } catch { /* 继续 */ }

  // 默认：基于项目目录解析
  return projectResolved;
}

/**
 * 检查文件路径是否在允许范围内
 * 防止路径遍历读写 /etc/hostname 等系统文件
 */
function isPathAllowed(filePath: string): { allowed: boolean; reason?: string } {
  if (isSensitivePath(filePath)) {
    return { allowed: false, reason: `路径 ${filePath} 被保护` };
  }
  const resolved = resolveFilePath(filePath);
  const allowed = ALLOWED_FILE_ROOTS.some(root =>
    resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!allowed) {
    return { allowed: false, reason: `路径 ${resolved} 不在允许范围内（仅限 workspace/tmp）` };
  }
  return { allowed: true, reason: resolved };
}

// ==================== 工具结果格式化 ====================

const MAX_OUTPUT_LINES = 100;
const MAX_OUTPUT_CHARS = 10000;

function formatOutput(result: string): string {
  if (result.length <= MAX_OUTPUT_CHARS) return result;
  const lines = result.split('\n');
  if (lines.length > MAX_OUTPUT_LINES) {
    return lines.slice(0, MAX_OUTPUT_LINES).join('\n')
      + `\n... (共 ${lines.length} 行，已截断)`;
  }
  return result.slice(0, MAX_OUTPUT_CHARS) + `\n... (已截断，共 ${result.length} 字符)`;
}

// ==================== 文件操作 ====================

export const read_file: ToolDef = {
  name: 'read_file',
  description: '读取文件内容。支持指定起始行和行数来截取。',
  parameters: z.object({
    path: z.string().describe('文件路径'),
    start_line: z.number().optional().describe('起始行号（从1开始）'),
    max_lines: z.number().optional().describe('最大读取行数'),
  }),
  permission: 'read_files',
  outputFormat: 'text',
  outputSchema: z.string(),
  cacheTtlSec: 30,
  execute: async (args) => {
    const { path: filePath, start_line, max_lines } = args as {
      path: string; start_line?: number; max_lines?: number;
    };
    const resolved = resolveFilePath(filePath);
    const pathCheck = isPathAllowed(filePath);
    if (!pathCheck.allowed) {
      return `[拒绝: ${pathCheck.reason}]`;
    }
    try {
      const content = await fs.readFile(resolved, 'utf-8');
      const lines = content.split('\n');
      const start = (start_line ?? 1) - 1;
      const end = max_lines ? start + max_lines : lines.length;
      const selected = lines.slice(start, end);
      return formatOutput(selected.map((l, i) => `${start + i + 1}| ${l}`).join('\n'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[读取失败: ${msg}]`;
    }
  },
};

export const write_file: ToolDef = {
  name: 'write_file',
  description: '写入/创建文件。指定路径和内容。',
  parameters: z.object({
    path: z.string().describe('文件路径'),
    content: z.string().describe('文件内容'),
  }),
  permission: 'write_files',
  execute: async (args) => {
    const { path: filePath, content } = args as { path: string; content: string };
    // write_file: 智能路径解析 — 项目目录下已存在的路径优先项目目录
    const resolved = resolveFilePath(filePath, false);
    const pathCheck = isPathAllowed(filePath);
    if (!pathCheck.allowed) {
      return `[拒绝: ${pathCheck.reason}]`;
    }
    try {
      const dir = path.dirname(resolved);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
      // Task 7.1: 写入后清除该文件的 read_file 缓存
      globalToolCache.invalidate('read_file', { path: filePath });
      globalToolCache.invalidate('read_file', { path: resolved });
      return `[已写入 ${resolved}，${content.length} 字节]`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[写入失败: ${msg}]`;
    }
  },
};

export const list_files: ToolDef = {
  name: 'list_files',
  description: '列出目录下的文件和子目录。',
  parameters: z.object({
    path: z.string().describe('目录路径'),
    recursive: z.boolean().optional().describe('是否递归'),
  }),
  permission: 'read_files',
  outputFormat: 'lines',
  outputSchema: z.string(),
  cacheTtlSec: 30,
  execute: async (args) => {
    const { path: dirPath, recursive } = args as { path: string; recursive?: boolean };
    const resolvedDir = resolveFilePath(dirPath);
    // MAJ-04 修复: 列目录也需要路径限制
    const pathCheck = isPathAllowed(dirPath);
    if (!pathCheck.allowed) {
      return `[拒绝: ${pathCheck.reason}]`;
    }
    try {
      if (recursive) {
        const results: string[] = [];
        async function walk(dir: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            results.push(full);
            if (e.isDirectory()) await walk(full);
          }
        }
        await walk(resolvedDir);
        return formatOutput(results.join('\n'));
      } else {
        const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
        return entries
          .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[列出失败: ${msg}]`;
    }
  },
};

export const search_files: ToolDef = {
  name: 'search_files',
  description: '在文件中搜索内容。',
  parameters: z.object({
    pattern: z.string().describe('搜索关键词或正则'),
    path: z.string().describe('搜索目录'),
    file_pattern: z.string().optional().describe('文件名过滤，如 *.ts'),
  }),
  permission: 'read_files',
  outputFormat: 'lines',
  outputSchema: z.string(),
  execute: async (args) => {
    const { pattern, path: dirPath, file_pattern } = args as {
      pattern: string; path: string; file_pattern?: string;
    };
    const resolvedDir = resolveFilePath(dirPath);
    // 路径范围检查
    const pathCheck = isPathAllowed(dirPath);
    if (!pathCheck.allowed) {
      return `[拒绝: ${pathCheck.reason}]`;
    }
    // MAJ-04 修复: 使用 execFile 替代 shell 拼接，杜绝命令注入
    const grepArgs = ['-rn'];
    if (file_pattern) {
      grepArgs.push(`--include=${file_pattern}`);
    }
    grepArgs.push(pattern, resolvedDir);
    try {
      const { stdout, stderr } = await execFileAsync('grep', grepArgs, { timeout: 10_000 });
      return formatOutput(stdout || stderr || '[无匹配结果]');
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 1) return '[无匹配结果]';
      return `[搜索失败: ${e.message ?? '未知错误'}]`;
    }
  },
};

// ==================== Shell 执行（沙箱保护） ====================

export const exec: ToolDef = {
  name: 'exec',
  description: '执行 Shell 命令。有超时限制（30秒），输出有长度限制。沙箱保护：环境变量隔离、工作目录限制、危险命令拦截。',
  parameters: z.object({
    command: z.string().describe('要执行的命令'),
    cwd: z.string().optional().describe('工作目录'),
    timeout: z.number().optional().describe('超时秒数'),
  }),
  permission: 'exec_safe',
  outputFormat: 'text',
  execute: async (args) => {
    const { command, cwd, timeout } = args as {
      command: string; cwd?: string; timeout?: number;
    };
    return defaultSandbox.execFormatted(command, { cwd, timeout });
  },
};

// ==================== Git 操作 ====================

export const git_status: ToolDef = {
  name: 'git_status',
  description: '查看 Git 仓库状态。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
  }),
  permission: 'read_files',
  outputFormat: 'text',
  execute: async (args) => {
    const { repo_path } = args as { repo_path: string };
    try {
      const [statusRes, branchRes] = await Promise.all([
        execFileAsync('git', ['status', '--short'], { cwd: repo_path, timeout: 5000 }),
        execFileAsync('git', ['branch', '--show-current'], { cwd: repo_path, timeout: 5000 }),
      ]);
      return `分支: ${branchRes.stdout.trim()}\n${statusRes.stdout || '[干净的工作区]'}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Git 状态获取失败: ${msg}]`;
    }
  },
};

export const git_log: ToolDef = {
  name: 'git_log',
  description: '查看 Git 提交历史。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    count: z.number().optional().describe('显示条数'),
  }),
  permission: 'read_files',
  outputFormat: 'lines',
  execute: async (args) => {
    const { repo_path, count } = args as { repo_path: string; count?: number };
    try {
      const { stdout } = await execFileAsync(
        'git', ['log', `--oneline`, `-${count ?? 10}`],
        { cwd: repo_path, timeout: 5000 },
      );
      return stdout;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Git 日志获取失败: ${msg}]`;
    }
  },
};

export const git_diff: ToolDef = {
  name: 'git_diff',
  description: '查看 Git diff。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    file: z.string().optional().describe('指定文件'),
  }),
  permission: 'read_files',
  outputFormat: 'text',
  execute: async (args) => {
    const { repo_path, file } = args as { repo_path: string; file?: string };
    try {
      const gitArgs = ['diff'];
      if (file) gitArgs.push(file);
      const { stdout } = await execFileAsync('git', gitArgs, { cwd: repo_path, timeout: 10000 });
      return formatOutput(stdout) || '[无变更]';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Git diff 失败: ${msg}]`;
    }
  },
};

// ==================== 系统信息 ====================

export const get_time: ToolDef = {
  name: 'get_time',
  description: '获取当前时间和日期。',
  parameters: z.object({}),
  permission: 'basic',
  outputFormat: 'text',
  cacheTtlSec: 1,
  execute: async () => {
    const now = new Date();
    const hour = now.getHours();
    let timeOfDay = '凌晨';
    if (hour >= 6 && hour < 12) timeOfDay = '上午';
    else if (hour >= 12 && hour < 14) timeOfDay = '中午';
    else if (hour >= 14 && hour < 18) timeOfDay = '下午';
    else if (hour >= 18 && hour < 23) timeOfDay = '晚上';

    return `当前时间: ${now.toLocaleString('zh-CN')}\n时段: ${timeOfDay} ${hour}点`;
  },
};

// ==================== 导出所有工具 ====================

export const ALL_TOOLS: ToolDef[] = [
  read_file, write_file, list_files, search_files,
  exec,
  git_status, git_log, git_diff,
  ...GIT_OPS_TOOLS,
  get_time,
  ...WEB_TOOLS,
  ...CODE_INTEL_TOOLS,
  ...BROWSER_TOOLS,
  ...SCREEN_TOOLS,
  scan_project,
  project_context,
  project_symbols,
  project_deps,
  project_index_stats,
  project_index_rebuild,
];
