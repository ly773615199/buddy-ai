/**
 * Git 操作工具测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { git_commit, git_branch, git_merge, git_push } from './git-ops.js';

const execAsync = promisify(execCb);

const TEST_REPO = path.join(os.tmpdir(), `buddy-git-test-${Date.now()}`);

beforeAll(async () => {
  // 创建测试仓库
  await fs.mkdir(TEST_REPO, { recursive: true });
  await execAsync('git init', { cwd: TEST_REPO });
  await execAsync('git config user.email "test@test.com"', { cwd: TEST_REPO });
  await execAsync('git config user.name "Test"', { cwd: TEST_REPO });
  // 创建初始提交
  await fs.writeFile(path.join(TEST_REPO, 'README.md'), '# Test');
  await execAsync('git add -A && git commit -m "init"', { cwd: TEST_REPO });
});

afterAll(async () => {
  await fs.rm(TEST_REPO, { recursive: true, force: true }).catch(() => {});
});

describe('git_commit', () => {
  it('应能提交新文件', async () => {
    await fs.writeFile(path.join(TEST_REPO, 'new-file.txt'), 'hello');
    const result = await git_commit.execute({
      repo_path: TEST_REPO,
      message: 'add new file',
    });
    expect(result).toContain('1 file changed');
    expect(result).toContain('new-file.txt');
  });

  it('无变更时应提示干净', async () => {
    const result = await git_commit.execute({
      repo_path: TEST_REPO,
      message: 'empty commit',
    });
    expect(result).toContain('干净');
  });

  it('应能处理含引号的提交信息', async () => {
    await fs.writeFile(path.join(TEST_REPO, 'quote.txt'), 'test');
    const result = await git_commit.execute({
      repo_path: TEST_REPO,
      message: "fix: user's bug",
    });
    expect(result).toContain('quote.txt');
  });
});

describe('git_branch', () => {
  it('应能列出分支', async () => {
    const result = await git_branch.execute({
      repo_path: TEST_REPO,
      action: 'list',
    });
    expect(result).toContain('master');
  });

  it('应能创建新分支', async () => {
    const result = await git_branch.execute({
      repo_path: TEST_REPO,
      action: 'create',
      branch_name: 'test-feature',
    });
    expect(result).toContain('test-feature');
    // 切回 master
    await execAsync('git switch master', { cwd: TEST_REPO });
  });

  it('应能切换分支', async () => {
    // 先确认在 master
    await execAsync('git switch master', { cwd: TEST_REPO });
    const result = await git_branch.execute({
      repo_path: TEST_REPO,
      action: 'switch',
      branch_name: 'test-feature',
    });
    expect(result).toContain('test-feature');
    // 切回 master
    await execAsync('git switch master', { cwd: TEST_REPO });
  });

  it('缺少 branch_name 应返回错误', async () => {
    const result = await git_branch.execute({
      repo_path: TEST_REPO,
      action: 'create',
    });
    expect(result).toContain('需要指定');
  });
});

describe('git_merge', () => {
  it('应能合并分支', async () => {
    // 在 test-feature 上创建一个新提交
    await execAsync('git switch test-feature', { cwd: TEST_REPO });
    await fs.writeFile(path.join(TEST_REPO, 'feature.txt'), 'feature code');
    await execAsync('git add -A && git commit -m "add feature"', { cwd: TEST_REPO });
    await execAsync('git switch master', { cwd: TEST_REPO });

    const result = await git_merge.execute({
      repo_path: TEST_REPO,
      branch: 'test-feature',
    });
    expect(result).toContain('feature.txt');
  });
});

describe('git_push', () => {
  it('无远程应返回失败信息', async () => {
    const result = await git_push.execute({
      repo_path: TEST_REPO,
    });
    // 没有配置远程，push 会失败
    expect(result).toContain('失败');
  });
});

describe('工具元数据', () => {
  it('每个工具应有正确的 name 和 description', () => {
    for (const tool of [git_commit, git_branch, git_merge, git_push]) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.permission).toBe('exec_safe');
      expect(tool.execute).toBeTypeOf('function');
    }
  });
});
