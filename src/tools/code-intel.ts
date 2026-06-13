import { z } from 'zod';
import * as fs from 'fs/promises';
import type { ToolDef } from '../types.js';

// ==================== 代码结构分析 ====================

interface FileAnalysis {
  language: string;
  loc: number;
  exports: string[];
  imports: string[];
  functions: string[];
  classes: string[];
  interfaces: string[];
  constants: string[];
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript (React)',
    js: 'JavaScript', jsx: 'JavaScript (React)',
    py: 'Python', go: 'Go', rs: 'Rust',
    java: 'Java', kt: 'Kotlin',
    rb: 'Ruby', php: 'PHP',
    c: 'C', cpp: 'C++', h: 'C/C++ Header',
    cs: 'C#', swift: 'Swift',
    md: 'Markdown', json: 'JSON',
    yaml: 'YAML', yml: 'YAML',
    html: 'HTML', css: 'CSS',
    sh: 'Shell', bash: 'Shell',
  };
  return map[ext] ?? ext.toUpperCase();
}

function analyzeTypeScript(content: string): Partial<FileAnalysis> {
  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const interfaces: string[] = [];
  const constants: string[] = [];

  // exports
  const exportPatterns = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:default\s+)?class\s+(\w+)/g,
    /export\s+(?:default\s+)?interface\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+\{([^}]+)\}/g,
  ];
  for (const pat of exportPatterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      if (m[1].includes(',')) {
        exports.push(...m[1].split(',').map(s => s.trim()).filter(Boolean));
      } else {
        exports.push(m[1]);
      }
    }
  }

  // imports
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // functions
  const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((m = fnRegex.exec(content)) !== null) {
    functions.push(m[1]);
  }
  // arrow functions assigned to const
  const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(/g;
  while ((m = arrowRegex.exec(content)) !== null) {
    if (!functions.includes(m[1])) functions.push(m[1]);
  }

  // classes
  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  while ((m = classRegex.exec(content)) !== null) {
    classes.push(m[1]);
  }

  // interfaces
  const ifaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
  while ((m = ifaceRegex.exec(content)) !== null) {
    interfaces.push(m[1]);
  }

  // top-level const
  const constRegex = /^(?:export\s+)?const\s+(\w+)\s*[=:]/gm;
  while ((m = constRegex.exec(content)) !== null) {
    if (!constants.includes(m[1]) && !functions.includes(m[1])) {
      constants.push(m[1]);
    }
  }

  return { exports, imports, functions, classes, interfaces, constants };
}

function analyzePython(content: string): Partial<FileAnalysis> {
  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  let m;

  // imports
  const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1] ? `${m[1]}.${m[2]}` : m[2]);
  }

  // functions
  const fnRegex = /^(?:async\s+)?def\s+(\w+)/gm;
  while ((m = fnRegex.exec(content)) !== null) {
    functions.push(m[1]);
  }

  // classes
  const classRegex = /^class\s+(\w+)/gm;
  while ((m = classRegex.exec(content)) !== null) {
    classes.push(m[1]);
  }

  // Python "exports" = public functions/classes (non-underscored)
  exports.push(...functions.filter(f => !f.startsWith('_')));
  exports.push(...classes.filter(c => !c.startsWith('_')));

  return { exports, imports, functions, classes };
}

function analyzeGeneric(content: string): Partial<FileAnalysis> {
  // 对于不支持的语言，只统计行数
  return {};
}

function doAnalyze(content: string, language: string): Partial<FileAnalysis> {
  if (['TypeScript', 'TypeScript (React)', 'JavaScript', 'JavaScript (React)'].includes(language)) {
    return analyzeTypeScript(content);
  }
  if (language === 'Python') {
    return analyzePython(content);
  }
  return analyzeGeneric(content);
}

export const analyze_file: ToolDef = {
  name: 'analyze_file',
  description: '分析代码文件结构：导出、导入、函数、类、接口等。',
  parameters: z.object({
    path: z.string().describe('文件路径'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { path: filePath } = args as { path: string };
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const language = detectLanguage(filePath);
      const loc = content.split('\n').length;
      const analysis = doAnalyze(content, language);

      const parts = [`📄 ${filePath} (${language}, ${loc} 行)`];

      if (analysis.imports?.length) {
        parts.push(`\n📦 依赖 (${analysis.imports.length}):`);
        analysis.imports.slice(0, 15).forEach(i => parts.push(`  • ${i}`));
        if (analysis.imports.length > 15) parts.push(`  ... 及其他 ${analysis.imports.length - 15} 个`);
      }
      if (analysis.exports?.length) {
        parts.push(`\n📤 导出 (${analysis.exports.length}):`);
        analysis.exports.forEach(e => parts.push(`  • ${e}`));
      }
      if (analysis.functions?.length) {
        parts.push(`\n🔧 函数 (${analysis.functions.length}):`);
        analysis.functions.slice(0, 20).forEach(f => parts.push(`  • ${f}()`));
        if (analysis.functions.length > 20) parts.push(`  ... 及其他 ${analysis.functions.length - 20} 个`);
      }
      if (analysis.classes?.length) {
        parts.push(`\n🏗️ 类 (${analysis.classes.length}):`);
        analysis.classes.forEach(c => parts.push(`  • ${c}`));
      }
      if (analysis.interfaces?.length) {
        parts.push(`\n🧩 接口 (${analysis.interfaces.length}):`);
        analysis.interfaces.forEach(i => parts.push(`  • ${i}`));
      }
      if (analysis.constants?.length) {
        parts.push(`\n📌 顶层常量 (${analysis.constants.length}):`);
        analysis.constants.slice(0, 10).forEach(c => parts.push(`  • ${c}`));
      }

      return parts.join('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[分析失败: ${msg}]`;
    }
  },
};

// ==================== 查找引用 ====================

export const find_references: ToolDef = {
  name: 'find_references',
  description: '查找符号在项目中的引用位置。',
  parameters: z.object({
    symbol: z.string().describe('要查找的符号（函数名/类名/变量名）'),
    dir: z.string().describe('搜索目录'),
    file_pattern: z.string().optional().describe('文件名过滤，如 *.ts'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const { symbol, dir, file_pattern } = args as {
      symbol: string; dir: string; file_pattern?: string;
    };
    try {
      const { exec: execCb } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execCb);

      let cmd = `grep -rn --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" "${symbol}" "${dir}"`;
      if (file_pattern) {
        cmd = `grep -rn --include="${file_pattern}" "${symbol}" "${dir}"`;
      }

      const { stdout } = await exec(cmd, { timeout: 10000 });
      if (!stdout.trim()) return `[未找到 ${symbol} 的引用]`;

      const lines = stdout.trim().split('\n').slice(0, 30);
      let result = `找到 ${lines.length} 处引用 ${symbol}:\n\n`;
      result += lines.map(l => `  ${l}`).join('\n');
      if (stdout.trim().split('\n').length > 30) {
        result += `\n  ... 及其他 ${stdout.trim().split('\n').length - 30} 处`;
      }
      return result;
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 1) return `[未找到 ${symbol} 的引用]`;
      return `[搜索失败: ${e.message}]`;
    }
  },
};

// ==================== 导出 ====================

export const CODE_INTEL_TOOLS: ToolDef[] = [analyze_file, find_references];
