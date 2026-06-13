import { z } from 'zod';
import type { ToolDef } from '../types.js';
import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import { ProjectIndex } from './project-index.js';

// ── 全局索引缓存（按根目录）──
const indexCache = new Map<string, ProjectIndex>();

async function getOrCreateIndex(rootPath: string): Promise<ProjectIndex> {
  const resolved = path.resolve(rootPath);
  if (indexCache.has(resolved)) return indexCache.get(resolved)!;

  const index = new ProjectIndex({ rootPath: resolved });
  await index.buildIndex();
  indexCache.set(resolved, index);
  return index;
}

/**
 * 扫描项目结构工具
 */

export const scan_project: ToolDef = {
  name: 'scan_project',
  description: '扫描项目目录，识别框架、语言、依赖、目录结构等。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath } = args as { path: string };
    const resolved = path.resolve(rootPath);

    try {
      const parts: string[] = [];
      parts.push(`📁 项目扫描: ${resolved}\n`);

      // 检测语言/框架
      const indicators: string[] = [];
      const frameworks: string[] = [];
      const languages: string[] = [];

      // package.json (Node.js)
      const pkgPath = path.join(resolved, 'package.json');
      if (fss.existsSync(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        languages.push('JavaScript/TypeScript');

        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react) frameworks.push('React');
        if (deps.vue) frameworks.push('Vue');
        if (deps.next) frameworks.push('Next.js');
        if (deps.nuxt) frameworks.push('Nuxt');
        if (deps.svelte) frameworks.push('Svelte');
        if (deps.angular) frameworks.push('Angular');
        if (deps.express) frameworks.push('Express');
        if (deps.fastify) frameworks.push('Fastify');
        if (deps.nestjs) frameworks.push('NestJS');
        if (deps.vite) frameworks.push('Vite');
        if (deps.typescript) indicators.push('TypeScript');
        if (deps.tailwindcss) indicators.push('Tailwind CSS');
        if (deps.jest || deps.vitest) indicators.push('Jest/Vitest');

        parts.push(`📦 package.json: ${pkg.name ?? '(unnamed)'} v${pkg.version ?? '?'}`);
        parts.push(`   依赖: ${Object.keys(pkg.dependencies ?? {}).length} 个`);
        parts.push(`   开发依赖: ${Object.keys(pkg.devDependencies ?? {}).length} 个`);
      }

      // Python
      if (fss.existsSync(path.join(resolved, 'requirements.txt'))) languages.push('Python');
      if (fss.existsSync(path.join(resolved, 'pyproject.toml'))) languages.push('Python');

      // Go
      if (fss.existsSync(path.join(resolved, 'go.mod'))) languages.push('Go');

      // Rust
      if (fss.existsSync(path.join(resolved, 'Cargo.toml'))) languages.push('Rust');

      // Docker
      if (fss.existsSync(path.join(resolved, 'Dockerfile')) || fss.existsSync(path.join(resolved, 'docker-compose.yml'))) {
        indicators.push('Docker');
      }

      // TypeScript config
      if (fss.existsSync(path.join(resolved, 'tsconfig.json'))) indicators.push('TypeScript');

      // 目录结构
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => e.name);
      const files = entries.filter(e => e.isFile()).map(e => e.name);

      if (languages.length > 0) parts.push(`\n🔤 语言: ${languages.join(', ')}`);
      if (frameworks.length > 0) parts.push(`🏗️ 框架: ${frameworks.join(', ')}`);
      if (indicators.length > 0) parts.push(`🔧 工具链: ${indicators.join(', ')}`);

      parts.push(`\n📂 顶层目录 (${dirs.length}):`);
      dirs.slice(0, 15).forEach(d => parts.push(`  📁 ${d}`));

      parts.push(`\n📄 顶层文件 (${files.length}):`);
      files.slice(0, 15).forEach(f => parts.push(`  📄 ${f}`));

      // Git 信息
      if (fss.existsSync(path.join(resolved, '.git'))) {
        try {
          const { exec: execCb } = await import('child_process');
          const { promisify } = await import('util');
          const exec = promisify(execCb);
          const { stdout: branch } = await exec('git branch --show-current', { cwd: resolved, timeout: 5000 });
          const { stdout: log } = await exec('git log --oneline -3', { cwd: resolved, timeout: 5000 });
          parts.push(`\n🔀 Git:`);
          parts.push(`  分支: ${branch.trim()}`);
          parts.push(`  最近提交:\n${log.trim().split('\n').map(l => `    ${l}`).join('\n')}`);
        } catch { /* skip git info */ }
      }

      return parts.join('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[扫描失败: ${msg}]`;
    }
  },
};

/**
 * 项目上下文工具 — 基于 focus 关键词生成 LLM 友好的聚焦上下文
 *
 * 扫描项目全部文件，提取符号（函数/类/接口），构建依赖图，
 * 按 focus 关键词语义匹配相关文件，压缩输出。
 */
export const project_context: ToolDef = {
  name: 'project_context',
  description: '生成项目的 LLM 上下文摘要，自动选择与 focus 相关的文件和符号。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
    focus: z.string().describe('关注点关键词，如"视频处理"、"用户认证"、"工具注册"'),
    maxTokens: z.number().optional().describe('最大 token 数，默认 6000'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath, focus, maxTokens } = args as {
      path: string; focus: string; maxTokens?: number;
    };
    try {
      const index = await getOrCreateIndex(rootPath);
      const result = await index.generateContext(focus, maxTokens ?? 6000);
      return result.context;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[上下文生成失败: ${msg}]`;
    }
  },
};

/**
 * 项目符号搜索 — 查找项目中的符号定义
 */
export const project_symbols: ToolDef = {
  name: 'project_symbols',
  description: '搜索项目中的符号（函数/类/接口），支持模糊匹配。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
    query: z.string().describe('符号名或部分名称'),
    limit: z.number().optional().describe('最大返回数，默认 15'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath, query, limit } = args as {
      path: string; query: string; limit?: number;
    };
    try {
      const index = await getOrCreateIndex(rootPath);
      const results = index.searchSymbol(query, limit ?? 15);
      if (results.length === 0) return `[未找到匹配 "${query}" 的符号]`;

      let text = `找到 ${results.length} 个匹配 "${query}" 的符号:\n\n`;
      for (const r of results) {
        const exported = r.symbol.exported ? '📤' : '  ';
        const sig = r.symbol.signature ? `(${r.symbol.signature})` : '';
        text += `${exported} ${r.symbol.kind} ${r.symbol.name}${sig} — ${r.file}:${r.symbol.line}\n`;
      }
      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[符号搜索失败: ${msg}]`;
    }
  },
};

/**
 * 项目依赖图 — 查看文件的依赖关系
 */
export const project_deps: ToolDef = {
  name: 'project_deps',
  description: '查看项目文件的依赖关系图（导入/被导入）。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
    file: z.string().describe('目标文件相对路径'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath, file } = args as { path: string; file: string };
    try {
      const index = await getOrCreateIndex(rootPath);
      const { imports, importedBy } = index.getDependencyGraph(file);

      let text = `🔗 ${file} 的依赖关系:\n\n`;
      if (imports.length > 0) {
        text += `📥 导入 (${imports.length}):\n`;
        imports.forEach(i => text += `  → ${i}\n`);
      } else {
        text += `📥 导入: 无\n`;
      }
      if (importedBy.length > 0) {
        text += `\n📤 被导入 (${importedBy.length}):\n`;
        importedBy.forEach(i => text += `  ← ${i}\n`);
      } else {
        text += `\n📤 被导入: 无\n`;
      }
      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[依赖图查询失败: ${msg}]`;
    }
  },
};

/**
 * 项目索引统计 — 查看索引状态
 */
export const project_index_stats: ToolDef = {
  name: 'project_index_stats',
  description: '查看项目代码索引的统计信息（文件数/语言/符号等）。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath } = args as { path: string };
    try {
      const index = await getOrCreateIndex(rootPath);
      return index.getFullSummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[索引统计失败: ${msg}]`;
    }
  },
};

/**
 * 刷新项目索引 — 强制重建索引
 */
export const project_index_rebuild: ToolDef = {
  name: 'project_index_rebuild',
  description: '强制重建项目代码索引（文件变更后使用）。',
  parameters: z.object({
    path: z.string().describe('项目根目录路径'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: rootPath } = args as { path: string };
    try {
      const resolved = path.resolve(rootPath);
      const index = new ProjectIndex({ rootPath: resolved });
      const stats = await index.buildIndex();
      indexCache.set(resolved, index);
      return `✅ 索引重建完成 (${stats.indexTimeMs}ms)\n` +
        `  📄 ${stats.totalFiles} 文件 | 📝 ${stats.totalLoc.toLocaleString()} 行 | 🔧 ${stats.totalSymbols} 符号\n` +
        `  🔤 ${Object.entries(stats.languages).map(([l, c]) => `${l}:${c}`).join(', ')}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[索引重建失败: ${msg}]`;
    }
  },
};

/** 所有项目管理工具 — 统一导出供 subsystems.ts 注册 */
export const PROJECT_TOOLS_ALL: ToolDef[] = [
  scan_project,
  project_context,
  project_symbols,
  project_deps,
  project_index_stats,
  project_index_rebuild,
];
