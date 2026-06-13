/**
 * Git 操作工具集 — 补充 git_commit / git_branch / git_merge / git_push
 *
 * CRIT-03 修复: 所有 git 命令使用 execFile（数组参数）替代 exec（shell 拼接），
 * 杜绝通过 commit message / branch name 的命令注入。
 */

import { z } from 'zod';
import type { ToolDef } from '../types.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

function formatOutput(stdout: string, stderr: string): string {
  const out = stdout.trim();
  const err = stderr.trim();
  if (out && err) return `${out}\n[stderr] ${err}`;
  return out || err || '[完成]';
}

/** 校验分支名：只允许字母数字、连字符、下划线、斜杠、点 */
function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._\-\/]+$/.test(name) && !name.startsWith('-') && !name.includes('..');
}

export const git_commit: ToolDef = {
  name: 'git_commit',
  description: '暂存所有变更并提交。需要提供提交信息。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    message: z.string().describe('提交信息'),
    add_all: z.boolean().optional().describe('是否暂存所有变更，默认 true'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const { repo_path, message, add_all } = args as {
      repo_path: string; message: string; add_all?: boolean;
    };
    try {
      // 先暂存
      if (add_all !== false) {
        await execFileAsync('git', ['add', '-A'], { cwd: repo_path, timeout: 10_000 });
      }

      // 检查是否有变更
      const { stdout: status } = await execFileAsync('git', ['status', '--short'], { cwd: repo_path, timeout: 5_000 });
      if (!status.trim()) {
        return '工作区干净，没有需要提交的变更';
      }

      // CRIT-03 修复: 使用 execFile 数组参数，commit message 作为独立参数，不经过 shell 解析
      const { stdout, stderr } = await execFileAsync(
        'git', ['commit', '-m', message],
        { cwd: repo_path, timeout: 10_000 },
      );
      return formatOutput(stdout, stderr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[git commit 失败] ${msg}`;
    }
  },
};

export const git_branch: ToolDef = {
  name: 'git_branch',
  description: 'Git 分支操作：列出分支、创建分支、切换分支。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    action: z.enum(['list', 'create', 'switch', 'delete']).describe('操作类型'),
    branch_name: z.string().optional().describe('分支名（create/switch/delete 时必填）'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const { repo_path, action, branch_name } = args as {
      repo_path: string; action: string; branch_name?: string;
    };
    try {
      // 分支名校验
      if (branch_name && !isValidBranchName(branch_name)) {
        return `[拒绝: 分支名 "${branch_name}" 包含非法字符]`;
      }

      let gitArgs: string[];
      switch (action) {
        case 'list':
          gitArgs = ['branch', '-a'];
          break;
        case 'create':
          if (!branch_name) return '创建分支需要指定 branch_name';
          gitArgs = ['checkout', '-b', branch_name];
          break;
        case 'switch':
          if (!branch_name) return '切换分支需要指定 branch_name';
          // CRIT-03 修复: 使用 execFile 数组参数，不再拼接 "git switch || git checkout"
          // 先尝试 switch，失败则 fallback 到 checkout
          try {
            const { stdout, stderr } = await execFileAsync('git', ['switch', branch_name], { cwd: repo_path, timeout: 10_000 });
            return formatOutput(stdout, stderr);
          } catch {
            gitArgs = ['checkout', branch_name];
          }
          break;
        case 'delete':
          if (!branch_name) return '删除分支需要指定 branch_name';
          gitArgs = ['branch', '-d', branch_name];
          break;
        default:
          return `未知操作: ${action}`;
      }
      const { stdout, stderr } = await execFileAsync('git', gitArgs, { cwd: repo_path, timeout: 10_000 });
      return formatOutput(stdout, stderr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[git branch 失败] ${msg}`;
    }
  },
};

export const git_merge: ToolDef = {
  name: 'git_merge',
  description: '合并指定分支到当前分支。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    branch: z.string().describe('要合并的分支名'),
    no_ff: z.boolean().optional().describe('是否使用 --no-ff（强制创建合并提交）'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const { repo_path, branch, no_ff } = args as {
      repo_path: string; branch: string; no_ff?: boolean;
    };
    // 分支名校验
    if (!isValidBranchName(branch)) {
      return `[拒绝: 分支名 "${branch}" 包含非法字符]`;
    }
    try {
      const gitArgs = ['merge'];
      if (no_ff) gitArgs.push('--no-ff');
      gitArgs.push(branch);

      const { stdout, stderr } = await execFileAsync('git', gitArgs, { cwd: repo_path, timeout: 30_000 });
      return formatOutput(stdout, stderr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('CONFLICT')) {
        return `[git merge 冲突] 合并 ${branch} 时发生冲突。请手动解决后执行 git add + git commit`;
      }
      return `[git merge 失败] ${msg}`;
    }
  },
};

export const git_push: ToolDef = {
  name: 'git_push',
  description: '推送到远程仓库。可指定分支。',
  parameters: z.object({
    repo_path: z.string().describe('仓库路径'),
    remote: z.string().optional().describe('远程名，默认 origin'),
    branch: z.string().optional().describe('分支名，不填推当前分支'),
    force: z.boolean().optional().describe('是否强制推送（--force-with-lease）'),
  }),
  permission: 'exec_safe',
  execute: async (args) => {
    const { repo_path, remote, branch, force } = args as {
      repo_path: string; remote?: string; branch?: string; force?: boolean;
    };
    try {
      const r = remote ?? 'origin';
      let currentBranch = branch;
      if (!currentBranch) {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: repo_path, timeout: 5_000 });
        currentBranch = stdout.trim();
      }
      if (!currentBranch) return '无法确定当前分支';

      // 远程名校验
      if (!/^[a-zA-Z0-9._\-]+$/.test(r)) {
        return `[拒绝: 远程名 "${r}" 包含非法字符]`;
      }
      if (!isValidBranchName(currentBranch)) {
        return `[拒绝: 分支名 "${currentBranch}" 包含非法字符]`;
      }

      const gitArgs = ['push'];
      if (force) gitArgs.push('--force-with-lease');
      gitArgs.push(r, currentBranch);

      const { stdout, stderr } = await execFileAsync('git', gitArgs, { cwd: repo_path, timeout: 30_000 });
      return formatOutput(stdout, stderr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[git push 失败] ${msg}`;
    }
  },
};

export const GIT_OPS_TOOLS: ToolDef[] = [git_commit, git_branch, git_merge, git_push];
