/**
 * EnvironmentProbe — 环境探测器
 *
 * 职责：在 buildContext 阶段探测当前工作环境，
 * 生成结构化的环境摘要注入 LLM Prompt。
 *
 * 设计原则：
 * - 只探测，不修改
 * - 结果缓存（环境变化频率低）
 * - 失败静默（不影响主流程）
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { BuddyConfig } from '../types.js';

const execAsync = promisify(execCb);

// ==================== 类型定义 ====================

export interface EnvironmentSnapshot {
  /** 当前工作目录（process.cwd()） */
  cwd: string;
  /** 沙箱工作目录（BuddyConfig.sandbox.workspace） */
  sandboxWorkspace: string;
  /** 文件操作的路径解析规则 */
  pathResolution: {
    relativeTo: 'sandbox' | 'cwd';
    allowedRoots: string[];
  };
  /** 项目信息（如果 cwd 下有项目） */
  project: ProjectInfo | null;
  /** 可用运行时 */
  runtimes: RuntimeInfo[];
  /** 可用包管理器 */
  packageManagers: PackageManagerInfo[];
  /** 探测时间戳 */
  probedAt: number;
}

export interface ProjectInfo {
  /** 项目名 */
  name: string;
  /** 项目版本 */
  version: string;
  /** 项目类型 */
  type: 'node' | 'python' | 'go' | 'rust' | 'java' | 'mixed' | 'unknown';
  /** 主要语言 */
  languages: string[];
  /** 框架 */
  frameworks: string[];
  /** package.json 中的 scripts（Node 项目） */
  scripts: Record<string, string>;
  /** 主要依赖（前 30 个） */
  dependencies: string[];
  /** 是否有 tsconfig.json */
  hasTypeScript: boolean;
  /** 是否有测试框架 */
  testFramework: string | null;
  /** 是否有 Docker */
  hasDocker: boolean;
  /** 是否有 Git */
  hasGit: boolean;
  /** 当前 Git 分支 */
  gitBranch: string | null;
  /** 项目根目录下的关键文件 */
  keyFiles: string[];
}

export interface RuntimeInfo {
  name: string;
  version: string;
  available: boolean;
}

export interface PackageManagerInfo {
  name: string;
  version: string;
  lockFile: string | null;
  available: boolean;
}

// ==================== 探测器 ====================

export class EnvironmentProbe {
  private cache: EnvironmentSnapshot | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 分钟缓存

  /**
   * 探测当前环境
   */
  async probe(config: BuddyConfig): Promise<EnvironmentSnapshot> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) return this.cache;

    const cwd = process.cwd();
    const sandboxWorkspace = config.sandbox.workspace;

    // 并行探测：项目信息、运行时、包管理器
    const [project, runtimes, packageManagers] = await Promise.all([
      this.probeProject(cwd).catch(() => null),
      this.probeRuntimes().catch(() => []),
      this.probePackageManagers(cwd).catch(() => []),
    ]);

    const snapshot: EnvironmentSnapshot = {
      cwd,
      sandboxWorkspace,
      pathResolution: {
        relativeTo: 'sandbox',
        allowedRoots: this.getAllowedRoots(config),
      },
      project,
      runtimes,
      packageManagers,
      probedAt: now,
    };

    this.cache = snapshot;
    this.cacheExpiry = now + this.CACHE_TTL_MS;
    return snapshot;
  }

  /**
   * 强制刷新缓存
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  /**
   * 生成环境 Prompt 注入文本
   */
  toPrompt(snapshot: EnvironmentSnapshot): string {
    const parts: string[] = [];

    // ── 工作环境 ──
    parts.push('## 工作环境');
    parts.push(`- 当前工作目录: ${snapshot.cwd}`);
    parts.push(`- 沙箱目录: ${snapshot.sandboxWorkspace}`);
    parts.push('- 文件操作规则: 相对路径基于沙箱目录解析，绝对路径直接使用');
    parts.push(`- 允许的路径范围: ${snapshot.pathResolution.allowedRoots.join(', ')}`);

    // ── 项目信息 ──
    if (snapshot.project) {
      const p = snapshot.project;
      parts.push('');
      parts.push('### 项目信息');
      parts.push(`- 项目名: ${p.name}${p.version ? ` v${p.version}` : ''}`);
      parts.push(`- 类型: ${this.formatProjectType(p)}`);
      if (p.frameworks.length > 0) parts.push(`- 框架: ${p.frameworks.join(', ')}`);
      if (p.languages.length > 0) parts.push(`- 语言: ${p.languages.join(', ')}`);

      // 包管理器
      const pm = snapshot.packageManagers.filter(pm => pm.available);
      if (pm.length > 0) {
        const lockInfo = pm.map(m => m.lockFile ? `${m.name}(${m.lockFile})` : m.name).join(', ');
        parts.push(`- 包管理: ${lockInfo}`);
      }

      if (p.testFramework) parts.push(`- 测试框架: ${p.testFramework}`);
      if (p.hasGit && p.gitBranch) parts.push(`- Git 分支: ${p.gitBranch}`);

      // scripts
      const scriptKeys = Object.keys(p.scripts);
      if (scriptKeys.length > 0) {
        parts.push(`- 可用 scripts: ${scriptKeys.slice(0, 10).join(', ')}${scriptKeys.length > 10 ? ` (${scriptKeys.length}个)` : ''}`);
      }

      // 关键文件
      if (p.keyFiles.length > 0) {
        parts.push(`- 关键文件: ${p.keyFiles.slice(0, 15).join(', ')}`);
      }
    }

    // ── 可用运行时 ──
    const availableRuntimes = snapshot.runtimes.filter(r => r.available);
    if (availableRuntimes.length > 0) {
      parts.push('');
      parts.push('### 可用运行时');
      for (const r of availableRuntimes) {
        parts.push(`- ${r.name} ${r.version} ✅`);
      }
    }

    // ── 重要提示 ──
    parts.push('');
    parts.push('### 重要提示');
    parts.push(`- 创建文件时，使用 write_file 工具，路径基于沙箱目录: ${snapshot.sandboxWorkspace}`);
    parts.push(`- 如果要在项目目录下创建文件，使用绝对路径: ${snapshot.cwd}/xxx`);
    parts.push(`- 执行命令时，工作目录为: ${snapshot.cwd}`);

    return parts.join('\n');
  }

  // ==================== 私有方法 ====================

  private getAllowedRoots(config: BuddyConfig): string[] {
    const roots = [
      process.cwd(),
      config.sandbox.workspace,
      '/tmp',
      '/var/tmp',
    ];
    const home = process.env.HOME;
    if (home) roots.push(path.join(home, '.buddy'));
    return [...new Set(roots)];
  }

  private async probeProject(cwd: string): Promise<ProjectInfo | null> {
    const keyFiles: string[] = [];

    // 检测项目类型
    const indicators = {
      node: ['package.json', 'tsconfig.json', 'jsconfig.json', '.nvmrc', 'bun.lockb'],
      python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'poetry.lock'],
      go: ['go.mod', 'go.sum'],
      rust: ['Cargo.toml', 'Cargo.lock'],
      java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    };

    const detectedTypes: string[] = [];
    const languages: string[] = [];
    const frameworks: string[] = [];
    let name = '';
    let version = '';
    let scripts: Record<string, string> = {};
    let dependencies: string[] = [];
    let hasTypeScript = false;
    let testFramework: string | null = null;
    let hasDocker = false;
    let hasGit = false;
    let gitBranch: string | null = null;

    // Node.js 项目
    const pkgPath = path.join(cwd, 'package.json');
    if (fss.existsSync(pkgPath)) {
      detectedTypes.push('node');
      languages.push('JavaScript/TypeScript');
      keyFiles.push('package.json');

      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        name = pkg.name ?? '';
        version = pkg.version ?? '';
        scripts = pkg.scripts ?? {};
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        dependencies = Object.keys(allDeps).slice(0, 30);

        // 框架检测
        if (allDeps.react) frameworks.push('React');
        if (allDeps.vue) frameworks.push('Vue');
        if (allDeps.next) frameworks.push('Next.js');
        if (allDeps.nuxt) frameworks.push('Nuxt');
        if (allDeps.svelte) frameworks.push('Svelte');
        if (allDeps.express) frameworks.push('Express');
        if (allDeps.fastify) frameworks.push('Fastify');
        if (allDeps.nestjs || allDeps['@nestjs/core']) frameworks.push('NestJS');
        if (allDeps.vite) frameworks.push('Vite');
        if (allDeps.electron) frameworks.push('Electron');

        // TypeScript 检测
        if (allDeps.typescript || fss.existsSync(path.join(cwd, 'tsconfig.json'))) {
          hasTypeScript = true;
          keyFiles.push('tsconfig.json');
        }

        // 测试框架检测
        if (allDeps.vitest) testFramework = 'vitest';
        else if (allDeps.jest) testFramework = 'jest';
        else if (allDeps.mocha) testFramework = 'mocha';
        else if (allDeps.pytest) testFramework = 'pytest';
      } catch {
        // package.json 解析失败，继续
      }
    }

    // Python 项目
    if (fss.existsSync(path.join(cwd, 'requirements.txt'))) {
      detectedTypes.push('python');
      languages.push('Python');
      keyFiles.push('requirements.txt');
    }
    if (fss.existsSync(path.join(cwd, 'pyproject.toml'))) {
      detectedTypes.push('python');
      if (!languages.includes('Python')) languages.push('Python');
      keyFiles.push('pyproject.toml');
    }

    // Go 项目
    if (fss.existsSync(path.join(cwd, 'go.mod'))) {
      detectedTypes.push('go');
      languages.push('Go');
      keyFiles.push('go.mod');
    }

    // Rust 项目
    if (fss.existsSync(path.join(cwd, 'Cargo.toml'))) {
      detectedTypes.push('rust');
      languages.push('Rust');
      keyFiles.push('Cargo.toml');
    }

    // Java 项目
    if (fss.existsSync(path.join(cwd, 'pom.xml'))) {
      detectedTypes.push('java');
      languages.push('Java');
      keyFiles.push('pom.xml');
    }

    // Docker
    if (fss.existsSync(path.join(cwd, 'Dockerfile')) || fss.existsSync(path.join(cwd, 'docker-compose.yml'))) {
      hasDocker = true;
      keyFiles.push(fss.existsSync(path.join(cwd, 'Dockerfile')) ? 'Dockerfile' : 'docker-compose.yml');
    }

    // Git
    if (fss.existsSync(path.join(cwd, '.git'))) {
      hasGit = true;
      try {
        const { stdout } = await execAsync('git branch --show-current', { cwd, timeout: 3000 });
        gitBranch = stdout.trim() || null;
      } catch {
        // git 不可用
      }
    }

    // 其他关键文件
    const otherFiles = ['README.md', '.env', '.env.example', 'Makefile', '.eslintrc', '.prettierrc', 'biome.json'];
    for (const f of otherFiles) {
      if (fss.existsSync(path.join(cwd, f))) keyFiles.push(f);
    }

    // 没有检测到任何项目文件
    if (detectedTypes.length === 0 && keyFiles.length === 0) return null;

    const projectType = detectedTypes.length > 1 ? 'mixed' : (detectedTypes[0] as ProjectInfo['type']) ?? 'unknown';

    return {
      name,
      version,
      type: projectType,
      languages: [...new Set(languages)],
      frameworks: [...new Set(frameworks)],
      scripts,
      dependencies,
      hasTypeScript,
      testFramework,
      hasDocker,
      hasGit,
      gitBranch,
      keyFiles: [...new Set(keyFiles)],
    };
  }

  private async probeRuntimes(): Promise<RuntimeInfo[]> {
    const runtimes = [
      { name: 'Node.js', cmd: 'node --version' },
      { name: 'Python', cmd: 'python3 --version || python --version' },
      { name: 'Go', cmd: 'go version' },
      { name: 'Rust', cmd: 'rustc --version' },
      { name: 'Java', cmd: 'java -version 2>&1 | head -1' },
      { name: 'Git', cmd: 'git --version' },
      { name: 'Docker', cmd: 'docker --version' },
    ];

    const results: RuntimeInfo[] = [];

    for (const r of runtimes) {
      try {
        const { stdout } = await execAsync(r.cmd, { timeout: 3000 });
        const version = stdout.trim().split('\n')[0];
        results.push({ name: r.name, version, available: true });
      } catch {
        results.push({ name: r.name, version: '', available: false });
      }
    }

    return results;
  }

  private async probePackageManagers(cwd: string): Promise<PackageManagerInfo[]> {
    const managers = [
      { name: 'npm', cmd: 'npm --version', lockFile: 'package-lock.json' },
      { name: 'pnpm', cmd: 'pnpm --version', lockFile: 'pnpm-lock.yaml' },
      { name: 'yarn', cmd: 'yarn --version', lockFile: 'yarn.lock' },
      { name: 'bun', cmd: 'bun --version', lockFile: 'bun.lockb' },
      { name: 'pip', cmd: 'pip3 --version || pip --version', lockFile: null },
      { name: 'poetry', cmd: 'poetry --version', lockFile: 'poetry.lock' },
    ];

    const results: PackageManagerInfo[] = [];

    for (const m of managers) {
      const lockPath = m.lockFile ? path.join(cwd, m.lockFile) : null;
      const hasLock = lockPath ? fss.existsSync(lockPath) : false;

      try {
        const { stdout } = await execAsync(m.cmd, { timeout: 3000 });
        const version = stdout.trim().split('\n')[0];
        results.push({
          name: m.name,
          version,
          available: true,
          lockFile: hasLock ? m.lockFile : null,
        });
      } catch {
        results.push({
          name: m.name,
          version: '',
          available: false,
          lockFile: hasLock ? m.lockFile : null,
        });
      }
    }

    return results;
  }

  private formatProjectType(p: ProjectInfo): string {
    const typeMap: Record<string, string> = {
      node: 'Node.js',
      python: 'Python',
      go: 'Go',
      rust: 'Rust',
      java: 'Java',
      mixed: '多语言',
      unknown: '未知',
    };
    let result = typeMap[p.type] ?? p.type;
    if (p.hasTypeScript) result += ' (TypeScript)';
    return result;
  }
}
