/**
 * EnvironmentProbe v2 — 通用环境探测器
 *
 * 四层架构：
 * Layer 1: 系统层（始终探测）— OS/硬件/网络/时间/区域
 * Layer 2: 工作环境层（始终探测）— 工作目录/沙箱/磁盘/用户目录
 * Layer 3: 领域层（按任务类型选择）— 代码/文档/数据/媒体
 * Layer 4: 能力层（始终探测）— 运行时/CLI/感知能力/限制
 *
 * 设计原则：
 * - 只探测，不修改
 * - 结果缓存（环境变化频率低）
 * - 失败静默（不影响主流程）
 * - 按任务类型动态选择探测维度，避免浪费 token
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { BuddyConfig } from '../types.js';

const execAsync = promisify(execCb);

// ==================== 类型定义 ====================

/** 完整环境快照 */
export interface EnvironmentSnapshot {
  system: SystemInfo;
  workspace: WorkspaceInfo;
  domain: DomainInfo;
  capabilities: CapabilityInfo;
  probedAt: number;
}

// ── Layer 1: 系统层 ──

export interface SystemInfo {
  os: {
    platform: string;       // 'linux' | 'darwin' | 'win32'
    arch: string;           // 'x64' | 'arm64'
    release: string;        // '6.12.21'
    hostname: string;
  };
  hardware: {
    cpuCores: number;
    totalMemoryMB: number;
    freeMemoryMB: number;
    gpuInfo: string | null;
  };
  network: {
    online: boolean;
    proxy: string | null;
  };
  time: {
    timezone: string;       // 'Asia/Shanghai'
    localTime: string;      // '2026-06-19 12:00:00'
    isWorkingHours: boolean;
    isWeekend: boolean;
    hour: number;
  };
  locale: {
    language: string;       // 'zh-CN'
    dateFormat: string;     // 'YYYY-MM-DD'
  };
}

// ── Layer 2: 工作环境层 ──

export interface WorkspaceInfo {
  cwd: string;
  sandboxWorkspace: string;
  pathResolution: {
    relativeTo: 'sandbox' | 'cwd';
    allowedRoots: string[];
  };
  homeDir: string;
  tempDir: string;
  homeDirectories: string[];
  diskSpace: {
    totalGB: number;
    freeGB: number;
    usedPercent: number;
  };
}

// ── Layer 3: 领域层 ──

export type DomainType = 'code' | 'document' | 'data' | 'media' | 'general';

export interface DomainInfo {
  detectedDomain: DomainType;
  codeProject: CodeProjectInfo | null;
  documents: DocumentInfo | null;
  dataFiles: DataFileInfo | null;
  mediaFiles: MediaFileInfo | null;
}

export interface CodeProjectInfo {
  name: string;
  version: string;
  type: 'node' | 'python' | 'go' | 'rust' | 'java' | 'mixed' | 'unknown';
  languages: string[];
  frameworks: string[];
  scripts: Record<string, string>;
  dependencies: string[];
  hasTypeScript: boolean;
  testFramework: string | null;
  hasDocker: boolean;
  hasGit: boolean;
  gitBranch: string | null;
  keyFiles: string[];
}

export interface DocumentInfo {
  recentDocuments: Array<{
    path: string;
    name: string;
    type: 'markdown' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'other';
    modifiedAt: number;
    sizeKB: number;
  }>;
  documentDirs: string[];
}

export interface DataFileInfo {
  dataFiles: Array<{
    path: string;
    name: string;
    type: 'csv' | 'json' | 'parquet' | 'sqlite' | 'excel' | 'other';
    sizeKB: number;
  }>;
  dataDirs: string[];
}

export interface MediaFileInfo {
  mediaFiles: Array<{
    path: string;
    name: string;
    type: 'image' | 'video' | 'audio';
    sizeKB: number;
  }>;
  mediaDirs: string[];
}

// ── Layer 4: 能力层 ──

export interface CapabilityInfo {
  runtimes: RuntimeInfo[];
  packageManagers: PackageManagerInfo[];
  cliTools: CLIToolInfo[];
  sensors: {
    hasCamera: boolean;
    hasMicrophone: boolean;
    hasDisplay: boolean;
    hasSpeaker: boolean;
  };
  limits: {
    maxFileSizeMB: number;
    maxExecutionTimeMs: number;
    sandboxed: boolean;
    networkAccess: boolean;
  };
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

export interface CLIToolInfo {
  name: string;
  version: string;
  available: boolean;
}

// ==================== 探测器 ====================

export class EnvironmentProbe {
  private cache: EnvironmentSnapshot | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60_000;

  /**
   * 探测完整环境（四层）
   */
  async probe(config: BuddyConfig, taskType = 'chat'): Promise<EnvironmentSnapshot> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) return this.cache;

    // 并行探测四层
    const [system, workspace, capabilities] = await Promise.all([
      this.probeSystem().catch(() => this.defaultSystemInfo()),
      this.probeWorkspace(config).catch(() => this.defaultWorkspaceInfo(config)),
      this.probeCapabilities().catch(() => this.defaultCapabilityInfo()),
    ]);

    // 领域层按任务类型选择
    const domain = await this.probeDomain(taskType, workspace.cwd).catch(() => this.defaultDomainInfo());

    const snapshot: EnvironmentSnapshot = { system, workspace, domain, capabilities, probedAt: now };
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
   * 生成 Prompt 注入文本（按任务类型精简）
   */
  toPrompt(snapshot: EnvironmentSnapshot, taskType = 'chat'): string {
    const parts: string[] = [];

    // ── 系统层（始终注入，精简版）──
    parts.push('## 环境');
    parts.push(`- 系统: ${snapshot.system.os.platform} ${snapshot.system.os.arch}`);
    parts.push(`- 时间: ${snapshot.system.time.localTime} (${snapshot.system.time.timezone})`);
    if (snapshot.system.time.isWeekend) parts.push('- 今天是周末');
    if (!snapshot.system.time.isWorkingHours) parts.push('- 当前是非工作时间');

    // ── 工作环境层（非闲聊时注入）──
    if (taskType !== 'chat') {
      parts.push(`- 工作目录: ${snapshot.workspace.cwd}`);
      parts.push(`- 沙箱目录: ${snapshot.workspace.sandboxWorkspace}`);
      parts.push(`- 磁盘: ${snapshot.workspace.diskSpace.freeGB}GB 可用 / ${snapshot.workspace.diskSpace.totalGB}GB 总计`);
      parts.push(`- 文件操作: 相对路径基于 ${snapshot.workspace.pathResolution.relativeTo} 解析`);
    }

    // ── 领域层（按任务类型注入）──
    if (snapshot.domain.detectedDomain === 'code' && snapshot.domain.codeProject) {
      const p = snapshot.domain.codeProject;
      parts.push('');
      parts.push('### 项目');
      parts.push(`- ${p.name}${p.version ? ` v${p.version}` : ''} (${p.type})`);
      if (p.frameworks.length) parts.push(`- 框架: ${p.frameworks.join(', ')}`);
      if (p.languages.length) parts.push(`- 语言: ${p.languages.join(', ')}`);
      if (p.hasGit && p.gitBranch) parts.push(`- Git: ${p.gitBranch}`);
      const scripts = Object.keys(p.scripts);
      if (scripts.length) parts.push(`- scripts: ${scripts.slice(0, 8).join(', ')}`);
      parts.push(`- 重要: 创建项目文件使用绝对路径 ${p.name}/xxx`);
    }

    if (snapshot.domain.detectedDomain === 'document' && snapshot.domain.documents) {
      const docs = snapshot.domain.documents;
      parts.push('');
      parts.push('### 文档');
      if (docs.documentDirs.length) parts.push(`- 目录: ${docs.documentDirs.join(', ')}`);
      if (docs.recentDocuments.length) {
        parts.push('- 最近:');
        for (const d of docs.recentDocuments.slice(0, 5)) {
          parts.push(`  - ${d.name} (${d.type})`);
        }
      }
    }

    if (snapshot.domain.detectedDomain === 'data' && snapshot.domain.dataFiles) {
      const data = snapshot.domain.dataFiles;
      parts.push('');
      parts.push('### 数据');
      if (data.dataDirs.length) parts.push(`- 目录: ${data.dataDirs.join(', ')}`);
      if (data.dataFiles.length) {
        parts.push('- 文件:');
        for (const f of data.dataFiles.slice(0, 5)) {
          parts.push(`  - ${f.name} (${f.type})`);
        }
      }
    }

    // ── 能力层（非闲聊时注入关键限制）──
    if (taskType !== 'chat') {
      const limits = snapshot.capabilities.limits;
      if (!limits.networkAccess) parts.push('- ⚠️ 无网络访问');
      if (limits.sandboxed) parts.push('- ⚠️ 沙箱环境');
    }

    return parts.join('\n');
  }

  // ==================== Layer 1: 系统层 ====================

  private async probeSystem(): Promise<SystemInfo> {
    const cpus = os.cpus();
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // GPU 探测
    let gpuInfo: string | null = null;
    try {
      if (process.platform === 'linux') {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo ""', { timeout: 3000 });
        gpuInfo = stdout.trim() || null;
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model" | head -1', { timeout: 3000 });
        gpuInfo = stdout.trim().replace('Chipset Model: ', '') || null;
      }
    } catch { /* 无 GPU */ }

    // 网络代理
    const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy || null;

    // 区域语言
    const lang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || 'en-US';

    return {
      os: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        hostname: os.hostname(),
      },
      hardware: {
        cpuCores: cpus.length,
        totalMemoryMB: totalMem,
        freeMemoryMB: freeMem,
        gpuInfo,
      },
      network: {
        online: true, // 简单假设，后续可加 ping 检测
        proxy,
      },
      time: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: now.toISOString().replace('T', ' ').slice(0, 19),
        isWorkingHours: day >= 1 && day <= 5 && hour >= 9 && hour <= 18,
        isWeekend: day === 0 || day === 6,
        hour,
      },
      locale: {
        language: lang.split('.')[0].replace(/_/g, '-'),
        dateFormat: 'YYYY-MM-DD',
      },
    };
  }

  // ==================== Layer 2: 工作环境层 ====================

  private async probeWorkspace(config: BuddyConfig): Promise<WorkspaceInfo> {
    const cwd = process.cwd();
    const sandboxWorkspace = config.sandbox.workspace;
    const homeDir = os.homedir();
    const tempDir = os.tmpdir();

    // 用户主目录下的顶层目录
    let homeDirectories: string[] = [];
    try {
      const entries = await fs.readdir(homeDir, { withFileTypes: true });
      homeDirectories = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name)
        .slice(0, 20);
    } catch { /* 忽略 */ }

    // 磁盘空间
    let diskSpace = { totalGB: 0, freeGB: 0, usedPercent: 0 };
    try {
      if (process.platform === 'linux' || process.platform === 'darwin') {
        const { stdout } = await execAsync(`df -BG "${cwd}" 2>/dev/null | tail -1`, { timeout: 3000 });
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 4) {
          const total = parseInt(parts[1]) || 0;
          const free = parseInt(parts[3]) || 0;
          const used = parseInt(parts[2]) || 0;
          diskSpace = {
            totalGB: total,
            freeGB: free,
            usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
          };
        }
      }
    } catch { /* 忽略 */ }

    return {
      cwd,
      sandboxWorkspace,
      pathResolution: {
        relativeTo: 'sandbox',
        allowedRoots: this.getAllowedRoots(config),
      },
      homeDir,
      tempDir,
      homeDirectories,
      diskSpace,
    };
  }

  // ==================== Layer 3: 领域层 ====================

  private async probeDomain(taskType: string, cwd: string): Promise<DomainInfo> {
    // 根据任务类型选择探测维度
    const domain = this.inferDomain(taskType);

    const [codeProject, documents, dataFiles, mediaFiles] = await Promise.all([
      domain === 'code' ? this.probeCodeProject(cwd).catch(() => null) : Promise.resolve(null),
      domain === 'document' ? this.probeDocuments(cwd).catch(() => null) : Promise.resolve(null),
      domain === 'data' ? this.probeDataFiles(cwd).catch(() => null) : Promise.resolve(null),
      domain === 'media' ? this.probeMediaFiles(cwd).catch(() => null) : Promise.resolve(null),
    ]);

    return { detectedDomain: domain, codeProject, documents, dataFiles, mediaFiles };
  }

  private inferDomain(taskType: string): DomainType {
    switch (taskType) {
      case 'tools':
      case 'code':
        return 'code';
      case 'reasoning':
      case 'writing':
      case 'planning':
        return 'document';
      case 'image-gen':
      case 'image-edit':
      case 'video-gen':
      case 'tts':
      case 'asr':
        return 'media';
      default:
        return 'general';
    }
  }

  // ── 代码项目探测 ──

  private async probeCodeProject(cwd: string): Promise<CodeProjectInfo | null> {
    const keyFiles: string[] = [];
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
    const detectedTypes: string[] = [];

    // Node.js
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
        if (allDeps.react) frameworks.push('React');
        if (allDeps.vue) frameworks.push('Vue');
        if (allDeps.next) frameworks.push('Next.js');
        if (allDeps.svelte) frameworks.push('Svelte');
        if (allDeps.express) frameworks.push('Express');
        if (allDeps.fastify) frameworks.push('Fastify');
        if (allDeps.electron) frameworks.push('Electron');
        if (allDeps.vite) frameworks.push('Vite');
        if (allDeps.typescript || fss.existsSync(path.join(cwd, 'tsconfig.json'))) {
          hasTypeScript = true;
          keyFiles.push('tsconfig.json');
        }
        if (allDeps.vitest) testFramework = 'vitest';
        else if (allDeps.jest) testFramework = 'jest';
      } catch { /* 继续 */ }
    }

    // Python
    if (fss.existsSync(path.join(cwd, 'requirements.txt')) || fss.existsSync(path.join(cwd, 'pyproject.toml'))) {
      detectedTypes.push('python');
      languages.push('Python');
      if (fss.existsSync(path.join(cwd, 'requirements.txt'))) keyFiles.push('requirements.txt');
      if (fss.existsSync(path.join(cwd, 'pyproject.toml'))) keyFiles.push('pyproject.toml');
    }

    // Go / Rust / Java
    if (fss.existsSync(path.join(cwd, 'go.mod'))) { detectedTypes.push('go'); languages.push('Go'); keyFiles.push('go.mod'); }
    if (fss.existsSync(path.join(cwd, 'Cargo.toml'))) { detectedTypes.push('rust'); languages.push('Rust'); keyFiles.push('Cargo.toml'); }
    if (fss.existsSync(path.join(cwd, 'pom.xml'))) { detectedTypes.push('java'); languages.push('Java'); keyFiles.push('pom.xml'); }

    // Docker / Git
    if (fss.existsSync(path.join(cwd, 'Dockerfile')) || fss.existsSync(path.join(cwd, 'docker-compose.yml'))) {
      hasDocker = true;
      keyFiles.push(fss.existsSync(path.join(cwd, 'Dockerfile')) ? 'Dockerfile' : 'docker-compose.yml');
    }
    if (fss.existsSync(path.join(cwd, '.git'))) {
      hasGit = true;
      try {
        const { stdout } = await execAsync('git branch --show-current', { cwd, timeout: 3000 });
        gitBranch = stdout.trim() || null;
      } catch { /* 忽略 */ }
    }

    // 其他关键文件
    for (const f of ['README.md', '.env', 'Makefile', '.eslintrc', '.prettierrc', 'biome.json']) {
      if (fss.existsSync(path.join(cwd, f))) keyFiles.push(f);
    }

    if (detectedTypes.length === 0 && keyFiles.length === 0) return null;

    return {
      name,
      version,
      type: detectedTypes.length > 1 ? 'mixed' : (detectedTypes[0] as CodeProjectInfo['type']) ?? 'unknown',
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

  // ── 文档探测 ──

  private async probeDocuments(cwd: string): Promise<DocumentInfo | null> {
    const homeDir = os.homedir();
    const docDirs = [
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'notes'),
      cwd,
    ].filter(d => fss.existsSync(d));

    const recentDocuments: DocumentInfo['recentDocuments'] = [];
    const extMap: Record<string, DocumentInfo['recentDocuments'][0]['type']> = {
      '.md': 'markdown', '.txt': 'text', '.pdf': 'pdf',
      '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx',
    };

    for (const dir of docDirs.slice(0, 3)) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const docType = extMap[ext];
          if (!docType) continue;
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            recentDocuments.push({
              path: path.join(dir, entry.name),
              name: entry.name,
              type: docType,
              modifiedAt: stat.mtimeMs,
              sizeKB: Math.round(stat.size / 1024),
            });
          } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }
    }

    // 按修改时间排序
    recentDocuments.sort((a, b) => b.modifiedAt - a.modifiedAt);

    if (recentDocuments.length === 0 && docDirs.length === 0) return null;
    return { recentDocuments: recentDocuments.slice(0, 20), documentDirs: docDirs };
  }

  // ── 数据文件探测 ──

  private async probeDataFiles(cwd: string): Promise<DataFileInfo | null> {
    const homeDir = os.homedir();
    const dataDirs = [
      path.join(homeDir, 'Data'),
      path.join(homeDir, 'datasets'),
      cwd,
    ].filter(d => fss.existsSync(d));

    const dataFiles: DataFileInfo['dataFiles'] = [];
    const extMap: Record<string, DataFileInfo['dataFiles'][0]['type']> = {
      '.csv': 'csv', '.json': 'json', '.parquet': 'parquet',
      '.db': 'sqlite', '.sqlite': 'sqlite', '.sqlite3': 'sqlite',
      '.xlsx': 'excel', '.xls': 'excel',
    };

    for (const dir of dataDirs.slice(0, 3)) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const dataType = extMap[ext];
          if (!dataType) continue;
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            dataFiles.push({
              path: path.join(dir, entry.name),
              name: entry.name,
              type: dataType,
              sizeKB: Math.round(stat.size / 1024),
            });
          } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }
    }

    dataFiles.sort((a, b) => b.sizeKB - a.sizeKB);

    if (dataFiles.length === 0 && dataDirs.length === 0) return null;
    return { dataFiles: dataFiles.slice(0, 20), dataDirs };
  }

  // ── 媒体文件探测 ──

  private async probeMediaFiles(cwd: string): Promise<MediaFileInfo | null> {
    const homeDir = os.homedir();
    const mediaDirs = [
      path.join(homeDir, 'Pictures'),
      path.join(homeDir, 'Videos'),
      path.join(homeDir, 'Music'),
      cwd,
    ].filter(d => fss.existsSync(d));

    const mediaFiles: MediaFileInfo['mediaFiles'] = [];
    const extMap: Record<string, MediaFileInfo['mediaFiles'][0]['type']> = {
      '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
      '.mp4': 'video', '.avi': 'video', '.mov': 'video', '.mkv': 'video', '.webm': 'video',
      '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.aac': 'audio',
    };

    for (const dir of mediaDirs.slice(0, 3)) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const mediaType = extMap[ext];
          if (!mediaType) continue;
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            mediaFiles.push({
              path: path.join(dir, entry.name),
              name: entry.name,
              type: mediaType,
              sizeKB: Math.round(stat.size / 1024),
            });
          } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }
    }

    mediaFiles.sort((a, b) => b.sizeKB - a.sizeKB);

    if (mediaFiles.length === 0 && mediaDirs.length === 0) return null;
    return { mediaFiles: mediaFiles.slice(0, 20), mediaDirs };
  }

  // ==================== Layer 4: 能力层 ====================

  private async probeCapabilities(): Promise<CapabilityInfo> {
    // 运行时探测
    const runtimeDefs = [
      { name: 'Node.js', cmd: 'node --version' },
      { name: 'Python', cmd: 'python3 --version || python --version' },
      { name: 'Go', cmd: 'go version' },
      { name: 'Rust', cmd: 'rustc --version' },
      { name: 'Java', cmd: 'java -version 2>&1 | head -1' },
      { name: 'Git', cmd: 'git --version' },
      { name: 'Docker', cmd: 'docker --version' },
    ];

    const runtimes: RuntimeInfo[] = await this.probeCommands(runtimeDefs);

    // 包管理器探测
    const pmDefs = [
      { name: 'npm', cmd: 'npm --version', lockFile: 'package-lock.json' },
      { name: 'pnpm', cmd: 'pnpm --version', lockFile: 'pnpm-lock.yaml' },
      { name: 'yarn', cmd: 'yarn --version', lockFile: 'yarn.lock' },
      { name: 'bun', cmd: 'bun --version', lockFile: 'bun.lockb' },
      { name: 'pip', cmd: 'pip3 --version || pip --version', lockFile: null },
    ];

    const packageManagers: PackageManagerInfo[] = [];
    const cwd = process.cwd();
    for (const pm of pmDefs) {
      const lockPath = pm.lockFile ? path.join(cwd, pm.lockFile) : null;
      const hasLock = lockPath ? fss.existsSync(lockPath) : false;
      try {
        const { stdout } = await execAsync(pm.cmd, { timeout: 3000 });
        packageManagers.push({ name: pm.name, version: stdout.trim().split('\n')[0], lockFile: hasLock ? pm.lockFile : null, available: true });
      } catch {
        packageManagers.push({ name: pm.name, version: '', lockFile: hasLock ? pm.lockFile : null, available: false });
      }
    }

    // CLI 工具探测
    const cliDefs = [
      { name: 'curl', cmd: 'curl --version 2>&1 | head -1' },
      { name: 'wget', cmd: 'wget --version 2>&1 | head -1' },
      { name: 'jq', cmd: 'jq --version' },
      { name: 'ffmpeg', cmd: 'ffmpeg -version 2>&1 | head -1' },
      { name: 'make', cmd: 'make --version 2>&1 | head -1' },
    ];

    const cliTools: CLIToolInfo[] = await this.probeCommands(cliDefs);

    // 感知能力（服务器环境通常无）
    const sensors = {
      hasCamera: false,
      hasMicrophone: false,
      hasDisplay: !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY || process.platform === 'darwin',
      hasSpeaker: false,
    };

    return {
      runtimes,
      packageManagers,
      cliTools,
      sensors,
      limits: {
        maxFileSizeMB: 100,
        maxExecutionTimeMs: 30000,
        sandboxed: true,
        networkAccess: true,
      },
    };
  }

  // ==================== 工具方法 ====================

  private async probeCommands(defs: Array<{ name: string; cmd: string }>): Promise<Array<{ name: string; version: string; available: boolean }>> {
    const results = await Promise.allSettled(
      defs.map(async (d) => {
        try {
          const { stdout } = await execAsync(d.cmd, { timeout: 3000 });
          return { name: d.name, version: stdout.trim().split('\n')[0], available: true };
        } catch {
          return { name: d.name, version: '', available: false };
        }
      }),
    );
    return results.map(r => r.status === 'fulfilled' ? r.value : { name: 'unknown', version: '', available: false });
  }

  private getAllowedRoots(config: BuddyConfig): string[] {
    const roots = [process.cwd(), config.sandbox.workspace, '/tmp', '/var/tmp'];
    const home = process.env.HOME;
    if (home) roots.push(path.join(home, '.buddy'));
    return [...new Set(roots)];
  }

  // ==================== 默认值 ====================

  private defaultSystemInfo(): SystemInfo {
    const now = new Date();
    return {
      os: { platform: process.platform, arch: process.arch, release: os.release(), hostname: os.hostname() },
      hardware: { cpuCores: os.cpus().length, totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024), freeMemoryMB: Math.round(os.freemem() / 1024 / 1024), gpuInfo: null },
      network: { online: true, proxy: null },
      time: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, localTime: now.toISOString().replace('T', ' ').slice(0, 19), isWorkingHours: false, isWeekend: false, hour: now.getHours() },
      locale: { language: 'en-US', dateFormat: 'YYYY-MM-DD' },
    };
  }

  private defaultWorkspaceInfo(config: BuddyConfig): WorkspaceInfo {
    return {
      cwd: process.cwd(),
      sandboxWorkspace: config.sandbox.workspace,
      pathResolution: { relativeTo: 'sandbox', allowedRoots: this.getAllowedRoots(config) },
      homeDir: os.homedir(),
      tempDir: os.tmpdir(),
      homeDirectories: [],
      diskSpace: { totalGB: 0, freeGB: 0, usedPercent: 0 },
    };
  }

  private defaultDomainInfo(): DomainInfo {
    return { detectedDomain: 'general', codeProject: null, documents: null, dataFiles: null, mediaFiles: null };
  }

  private defaultCapabilityInfo(): CapabilityInfo {
    return {
      runtimes: [],
      packageManagers: [],
      cliTools: [],
      sensors: { hasCamera: false, hasMicrophone: false, hasDisplay: false, hasSpeaker: false },
      limits: { maxFileSizeMB: 100, maxExecutionTimeMs: 30000, sandboxed: true, networkAccess: true },
    };
  }
}
