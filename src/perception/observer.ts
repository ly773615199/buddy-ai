import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { MemoryStore } from '../memory/store.js';

const exec = promisify(execCb);

/**
 * 环境感知器 — 观察工作环境，自动积累记忆
 * 不阻塞对话，后台运行
 */

export class EnvironmentObserver {
  private memory: MemoryStore;
  private lastScanTime = 0;
  private lastGitStatus = '';

  constructor(memory: MemoryStore) {
    this.memory = memory;
  }

  /**
   * 扫描项目结构，提取项目画像
   */
  async scanProject(rootPath: string): Promise<ProjectProfile> {
    const profile: ProjectProfile = {
      root: rootPath,
      framework: 'unknown',
      languages: [],
      dependencies: [],
      structure: [],
    };

    try {
      // package.json → 框架 + 依赖
      const pkgPath = path.join(rootPath, 'package.json');
      if (fss.existsSync(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        profile.dependencies = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];
        profile.framework = this.detectFramework(profile.dependencies);
      }

      // requirements.txt → Python
      if (fss.existsSync(path.join(rootPath, 'requirements.txt'))) {
        if (!profile.languages.includes('Python')) profile.languages.push('Python');
      }

      // go.mod → Go
      if (fss.existsSync(path.join(rootPath, 'go.mod'))) {
        if (!profile.languages.includes('Go')) profile.languages.push('Go');
      }

      // Cargo.toml → Rust
      if (fss.existsSync(path.join(rootPath, 'Cargo.toml'))) {
        if (!profile.languages.includes('Rust')) profile.languages.push('Rust');
      }

      // 顶层目录结构
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      profile.structure = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => e.name)
        .slice(0, 15);

      // 存入记忆
      this.memory.setMemory('project', 'framework', profile.framework, 5);
      this.memory.setMemory('project', 'languages', profile.languages.join(', '), 5);
      this.memory.setMemory('project', 'structure', profile.structure.join(', '), 3);
      if (profile.dependencies.length > 0) {
        this.memory.setMemory('project', 'dependencies', profile.dependencies.slice(0, 30).join(', '), 3);
      }

      this.lastScanTime = Date.now();

    } catch {
      // 静默失败，不影响主流程
    }

    return profile;
  }

  /**
   * 感知 Git 状态变化
   */
  async checkGitChanges(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await exec('git status --short', { cwd: repoPath, timeout: 5000 });
      const currentStatus = stdout.trim();

      if (currentStatus !== this.lastGitStatus) {
        this.lastGitStatus = currentStatus;
        if (currentStatus) {
          const lines = currentStatus.split('\n');
          const summary = `Git 变更: ${lines.length} 个文件`;
          this.memory.addDiaryEntry(summary, 'neutral');
          this.memory.setMemory('git', 'last_change', summary, 2);
          return summary;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 感知时间关怀
   */
  checkTimeCare(): string | null {
    const hour = new Date().getHours();

    // 深夜关怀 (23:00 - 4:00)
    if (hour >= 23 || hour < 4) {
      const lastCare = this.memory.getMemory('time', 'last_late_care');
      const now = Date.now();
      if (!lastCare || now - parseInt(lastCare) > 3600000) {
        this.memory.setMemory('time', 'last_late_care', String(now), 1);
        return 'late_night';
      }
    }

    // 早安 (6:00 - 9:00)
    if (hour >= 6 && hour < 9) {
      const lastMorning = this.memory.getMemory('time', 'last_morning');
      const today = new Date().toISOString().split('T')[0];
      if (lastMorning !== today) {
        this.memory.setMemory('time', 'last_morning', today, 1);
        return 'morning';
      }
    }

    return null;
  }

  /**
   * 检查是否空闲
   */
  isIdle(minutesThreshold: number): boolean {
    const lastInteraction = this.memory.getMemory('session', 'last_interaction');
    if (!lastInteraction) return false;
    const elapsed = Date.now() - parseInt(lastInteraction);
    return elapsed > minutesThreshold * 60000;
  }

  /**
   * 更新最后交互时间
   */
  updateLastInteraction(): void {
    this.memory.setMemory('session', 'last_interaction', String(Date.now()), 1);
  }

  /**
   * 检测消息模式
   */
  detectPatterns(userMessage: string): string[] {
    const patterns: string[] = [];
    const lower = userMessage.toLowerCase();

    if (lower.includes('error') || lower.includes('报错') || lower.includes('失败')) {
      const errorCount = parseInt(this.memory.getMemory('session', 'recent_errors') ?? '0') + 1;
      this.memory.setMemory('session', 'recent_errors', String(errorCount), 1);
      if (errorCount >= 3) patterns.push('repeated_errors');
    } else {
      this.memory.setMemory('session', 'recent_errors', '0', 1);
    }

    if (lower.includes('怎么') || lower.includes('how') || lower.includes('什么是') || lower.includes('what is')) {
      patterns.push('learning_intent');
    }

    return patterns;
  }

  private detectFramework(deps: string[]): string {
    if (deps.includes('react')) return 'React';
    if (deps.includes('vue')) return 'Vue';
    if (deps.includes('next')) return 'Next.js';
    if (deps.includes('nuxt')) return 'Nuxt';
    if (deps.includes('svelte')) return 'Svelte';
    if (deps.includes('angular')) return 'Angular';
    if (deps.includes('express')) return 'Express';
    if (deps.includes('fastify')) return 'Fastify';
    if (deps.includes('nestjs')) return 'NestJS';
    if (deps.includes('vite')) return 'Vite';
    if (deps.includes('webpack')) return 'Webpack';
    return 'unknown';
  }
}

export interface ProjectProfile {
  root: string;
  framework: string;
  languages: string[];
  dependencies: string[];
  structure: string[];
}
