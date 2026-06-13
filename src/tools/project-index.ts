/**
 * 项目索引引擎 — v1
 *
 * 能力：
 * 1. 递归扫描项目，提取每个文件的符号（函数/类/接口/导出）
 * 2. 构建文件→符号 / 符号→文件 的双向索引
 * 3. 构建 import 依赖图
 * 4. 基于 focus 关键词生成 LLM 友好的聚焦上下文
 * 5. 增量更新（单文件重新解析）
 *
 * 支持语言：TypeScript/JavaScript/Python/Go/Rust
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';

// ── 类型 ──

export interface FileIndex {
  path: string;                // 相对路径
  absPath: string;             // 绝对路径
  language: string;
  loc: number;                 // 行数
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: string[];
  lastModified: number;        // 文件修改时间
  contentHash: string;         // 内容 hash（用于变更检测）
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'method';
  line: number;                // 行号
  exported: boolean;
  signature?: string;          // 函数签名（参数列表）
}

export interface ImportInfo {
  source: string;              // import 路径
  specifiers: string[];        // 导入的符号
  resolvedPath?: string;       // 解析后的相对路径
}

export interface ProjectStats {
  totalFiles: number;
  totalLoc: number;
  languages: Record<string, number>;    // lang → file count
  totalSymbols: number;
  topSymbols: Array<{ name: string; kind: string; file: string }>;
  dependencyCount: number;
  indexTimeMs: number;
}

export interface ContextResult {
  context: string;             // LLM 友好的上下文文本
  files: string[];             // 包含的文件
  symbols: SymbolInfo[];       // 包含的符号
  tokenEstimate: number;       // 估算 token 数
}

export interface IndexOptions {
  rootPath: string;
  extensions?: string[];       // 监听的扩展名，默认覆盖主流语言
  maxDepth?: number;           // 最大扫描深度，默认 8
  ignorePatterns?: RegExp[];   // 额外忽略模式
  maxFiles?: number;           // 最大文件数，默认 2000
}

// ── 常量 ──

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs',
];

const DEFAULT_IGNORE = [
  /node_modules/, /\.git/, /dist/, /build/, /__pycache__/,
  /\.next/, /\.nuxt/, /\.cache/, /target\/debug/, /target\/release/,
  /venv/, /\.venv/, /vendor/, /\.DS_Store/, /\.min\./,
];

// ── 工具函数 ──

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
    '.rb': 'Ruby', '.java': 'Java', '.kt': 'Kotlin',
    '.c': 'C', '.cpp': 'C++', '.h': 'C/C++', '.hpp': 'C++', '.cs': 'C#',
  };
  return map[ext] ?? 'Unknown';
}

async function contentHash(content: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

// ── 符号提取 ──

function extractSymbolsTS(content: string): { symbols: SymbolInfo[]; imports: ImportInfo[]; exports: string[] } {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── imports ──
    const importMatch = trimmed.match(/^import\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/);
    if (importMatch) {
      const specifiers: string[] = [];
      if (importMatch[1]) {
        // 处理 import { a, b } from '...' 和 import a from '...'
        const spec = importMatch[1].replace(/[{}]/g, '').trim();
        specifiers.push(...spec.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
      }
      imports.push({ source: importMatch[2], specifiers, line: i + 1 } as any);
      continue;
    }

    // ── export function ──
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'function', line: i + 1, exported, signature: m[2]?.trim() });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export class ──
    if ((m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'class', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export interface ──
    if ((m = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'interface', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export type ──
    if ((m = trimmed.match(/^(?:export\s+)?type\s+(\w+)/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'type', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export enum ──
    if ((m = trimmed.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'enum', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export const/let/var ──
    if ((m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:{]/))) {
      const exported = trimmed.includes('export');
      symbols.push({ name: m[1], kind: 'const', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // ── export { ... } ──
    if ((m = trimmed.match(/^export\s+\{([^}]+)\}/))) {
      const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      exports.push(...names);
      continue;
    }

    // ── 箭头函数 const fn = (...) => ──
    if ((m = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(/))) {
      const exported = trimmed.includes('export');
      if (!symbols.some(s => s.name === m![1])) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, exported });
        if (exported) exports.push(m[1]);
      }
      continue;
    }

    // ── class method ──
    if ((m = trimmed.match(/^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::|{)/))) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'constructor', 'get', 'set'].includes(m[1])) {
        symbols.push({ name: m[1], kind: 'method', line: i + 1, exported: false, signature: m[2]?.trim() });
      }
    }
  }

  return { symbols, imports, exports: [...new Set(exports)] };
}

function extractSymbolsPython(content: string): { symbols: SymbolInfo[]; imports: ImportInfo[]; exports: string[] } {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m: RegExpMatchArray | null;

    // imports
    if ((m = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/))) {
      const specifiers = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
      imports.push({ source: m[1] ?? m[2], specifiers, line: i + 1 } as any);
      continue;
    }

    // def
    if ((m = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/))) {
      const exported = !m[1].startsWith('_');
      symbols.push({ name: m[1], kind: 'function', line: i + 1, exported, signature: m[2]?.trim() });
      if (exported) exports.push(m[1]);
      continue;
    }

    // class
    if ((m = trimmed.match(/^class\s+(\w+)/))) {
      const exported = !m[1].startsWith('_');
      symbols.push({ name: m[1], kind: 'class', line: i + 1, exported });
      if (exported) exports.push(m[1]);
    }
  }

  return { symbols, imports, exports: [...new Set(exports)] };
}

function extractSymbolsGo(content: string): { symbols: SymbolInfo[]; imports: ImportInfo[]; exports: string[] } {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m: RegExpMatchArray | null;

    // import
    if ((m = trimmed.match(/^import\s+"([^"]+)"/))) {
      imports.push({ source: m[1], specifiers: [], line: i + 1 } as any);
      continue;
    }

    // func
    if ((m = trimmed.match(/^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(([^)]*)\)/))) {
      const exported = m[1][0] === m[1][0].toUpperCase();
      symbols.push({ name: m[1], kind: 'function', line: i + 1, exported, signature: m[2]?.trim() });
      if (exported) exports.push(m[1]);
      continue;
    }

    // type struct/interface
    if ((m = trimmed.match(/^type\s+([A-Z]\w*)\s+(struct|interface)/))) {
      symbols.push({ name: m[1], kind: m[2] === 'interface' ? 'interface' : 'class', line: i + 1, exported: true });
      exports.push(m[1]);
    }
  }

  return { symbols, imports, exports: [...new Set(exports)] };
}

function extractSymbolsRust(content: string): { symbols: SymbolInfo[]; imports: ImportInfo[]; exports: string[] } {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m: RegExpMatchArray | null;

    // use
    if ((m = trimmed.match(/^use\s+([\w:]+)/))) {
      imports.push({ source: m[1], specifiers: [], line: i + 1 } as any);
      continue;
    }

    // pub fn
    if ((m = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/))) {
      const exported = trimmed.startsWith('pub');
      symbols.push({ name: m[1], kind: 'function', line: i + 1, exported });
      if (exported) exports.push(m[1]);
      continue;
    }

    // pub struct/enum/trait
    if ((m = trimmed.match(/^(?:pub\s+)?(struct|enum|trait)\s+(\w+)/))) {
      const exported = trimmed.startsWith('pub');
      const kind = m[1] === 'trait' ? 'interface' : m[1] === 'enum' ? 'enum' : 'class';
      symbols.push({ name: m[2], kind: kind as any, line: i + 1, exported });
      if (exported) exports.push(m[2]);
    }
  }

  return { symbols, imports, exports: [...new Set(exports)] };
}

function extractSymbols(content: string, language: string): { symbols: SymbolInfo[]; imports: ImportInfo[]; exports: string[] } {
  switch (language) {
    case 'TypeScript':
    case 'JavaScript':
      return extractSymbolsTS(content);
    case 'Python':
      return extractSymbolsPython(content);
    case 'Go':
      return extractSymbolsGo(content);
    case 'Rust':
      return extractSymbolsRust(content);
    default:
      return { symbols: [], imports: [], exports: [] };
  }
}

// ── 项目索引引擎 ──

export class ProjectIndex {
  private rootPath: string;
  private extensions: Set<string>;
  private maxDepth: number;
  private ignorePatterns: RegExp[];
  private maxFiles: number;

  // 索引数据
  private fileIndex = new Map<string, FileIndex>();  // relPath → FileIndex
  private symbolMap = new Map<string, Array<{ file: string; symbol: SymbolInfo }>>(); // symbolName → locations
  private importGraph = new Map<string, string[]>();  // file → imported files
  private initialized = false;

  constructor(options: IndexOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.extensions = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map(e => e.toLowerCase()));
    this.maxDepth = options.maxDepth ?? 8;
    this.ignorePatterns = [...DEFAULT_IGNORE, ...(options.ignorePatterns ?? [])];
    this.maxFiles = options.maxFiles ?? 2000;
  }

  /**
   * 构建完整索引
   */
  async buildIndex(): Promise<ProjectStats> {
    const startMs = Date.now();
    this.fileIndex.clear();
    this.symbolMap.clear();
    this.importGraph.clear();

    // 递归扫描
    const files = await this.scanFiles(this.rootPath, 0);

    // 并行解析（限制并发数）
    const BATCH = 20;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      await Promise.all(batch.map(f => this.indexFile(f)));
    }

    // 构建符号映射
    for (const [relPath, idx] of this.fileIndex) {
      for (const sym of idx.symbols) {
        if (!this.symbolMap.has(sym.name)) this.symbolMap.set(sym.name, []);
        this.symbolMap.get(sym.name)!.push({ file: relPath, symbol: sym });
      }
    }

    // 构建 import 图
    for (const [relPath, idx] of this.fileIndex) {
      const imported: string[] = [];
      for (const imp of idx.imports) {
        const resolved = this.resolveImport(relPath, imp.source);
        if (resolved && this.fileIndex.has(resolved)) {
          imported.push(resolved);
        }
      }
      this.importGraph.set(relPath, imported);
    }

    this.initialized = true;
    const indexTimeMs = Date.now() - startMs;

    return this.computeStats(indexTimeMs);
  }

  /**
   * 增量更新单个文件
   */
  async updateFile(relPath: string): Promise<void> {
    const absPath = path.join(this.rootPath, relPath);
    if (!fss.existsSync(absPath)) {
      // 文件删除
      this.fileIndex.delete(relPath);
      this.importGraph.delete(relPath);
      // 清理符号映射
      for (const [name, locs] of this.symbolMap) {
        this.symbolMap.set(name, locs.filter(l => l.file !== relPath));
        if (this.symbolMap.get(name)!.length === 0) this.symbolMap.delete(name);
      }
      return;
    }

    // 重新索引
    await this.indexFile(absPath);

    // 更新符号映射（先清理旧的）
    for (const [name, locs] of this.symbolMap) {
      this.symbolMap.set(name, locs.filter(l => l.file !== relPath));
      if (this.symbolMap.get(name)!.length === 0) this.symbolMap.delete(name);
    }
    const idx = this.fileIndex.get(relPath);
    if (idx) {
      for (const sym of idx.symbols) {
        if (!this.symbolMap.has(sym.name)) this.symbolMap.set(sym.name, []);
        this.symbolMap.get(sym.name)!.push({ file: relPath, symbol: sym });
      }
    }
  }

  /**
   * 符号搜索
   */
  searchSymbol(query: string, limit = 20): Array<{ file: string; symbol: SymbolInfo }> {
    const results: Array<{ file: string; symbol: SymbolInfo }> = [];
    const queryLower = query.toLowerCase();

    for (const [name, locs] of this.symbolMap) {
      if (name.toLowerCase().includes(queryLower)) {
        results.push(...locs);
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  /**
   * 查找符号的所有引用（基于 import 图）
   */
  findReferences(symbolName: string): string[] {
    const locations = this.symbolMap.get(symbolName);
    if (!locations || locations.length === 0) return [];

    const sourceFiles = locations.map(l => l.file);
    const refs: string[] = [];

    // 找所有 import 了源文件的文件
    for (const [file, imported] of this.importGraph) {
      for (const src of sourceFiles) {
        if (imported.includes(src) && !refs.includes(file)) {
          refs.push(file);
        }
      }
    }
    return refs;
  }

  /**
   * 文件摘要
   */
  getFileSummary(relPath: string): FileIndex | null {
    return this.fileIndex.get(relPath) ?? null;
  }

  /**
   * 获取文件的依赖图
   */
  getDependencyGraph(file: string): { imports: string[]; importedBy: string[] } {
    const imports = this.importGraph.get(file) ?? [];
    const importedBy: string[] = [];
    for (const [f, deps] of this.importGraph) {
      if (deps.includes(file)) importedBy.push(f);
    }
    return { imports, importedBy };
  }

  /**
   * 生成聚焦上下文 — P5 核心
   *
   * @param focus 关注点关键词（如 "视频处理"、"用户认证"）
   * @param maxTokens 最大 token 数（粗估 1 token ≈ 4 chars）
   * @returns LLM 友好的项目上下文
   */
  async generateContext(focus: string, maxTokens = 6000): Promise<ContextResult> {
    const maxChars = maxTokens * 4;
    const focusLower = focus.toLowerCase();
    const focusWords = focusLower.split(/[\s,，、]+/).filter(Boolean);

    // 1. 匹配相关文件
    const scored: Array<{ file: string; score: number; reasons: string[] }> = [];

    for (const [relPath, idx] of this.fileIndex) {
      let score = 0;
      const reasons: string[] = [];

      // 文件名匹配
      const fileName = path.basename(relPath).toLowerCase();
      for (const w of focusWords) {
        if (fileName.includes(w)) { score += 5; reasons.push('文件名'); }
      }

      // 路径匹配
      const pathLower = relPath.toLowerCase();
      for (const w of focusWords) {
        if (pathLower.includes(w)) { score += 3; reasons.push('路径'); }
      }

      // 符号名匹配
      for (const sym of idx.symbols) {
        for (const w of focusWords) {
          if (sym.name.toLowerCase().includes(w)) { score += 2; reasons.push(`符号:${sym.name}`); }
        }
      }

      // 导入路径匹配
      for (const imp of idx.imports) {
        for (const w of focusWords) {
          if (imp.source.toLowerCase().includes(w)) { score += 2; reasons.push('导入'); }
        }
      }

      if (score > 0) {
        scored.push({ file: relPath, score, reasons: [...new Set(reasons)] });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // 2. 组装上下文
    const included: string[] = [];
    const includedSymbols: SymbolInfo[] = [];
    let totalChars = 0;

    // 先加项目概览
    const overview = this.buildOverview();
    totalChars += overview.length;

    for (const { file, score } of scored.slice(0, 30)) {
      const idx = this.fileIndex.get(file);
      if (!idx) continue;

      const fileBlock = this.formatFileBlock(idx);
      if (totalChars + fileBlock.length > maxChars) break;

      included.push(file);
      includedSymbols.push(...idx.symbols.filter(s => s.exported));
      totalChars += fileBlock.length;
    }

    // 3. 组装最终上下文
    let context = `# 项目上下文 — 聚焦: ${focus}\n\n`;
    context += overview + '\n';

    for (const file of included) {
      const idx = this.fileIndex.get(file);
      if (idx) context += this.formatFileBlock(idx) + '\n';
    }

    return {
      context,
      files: included,
      symbols: includedSymbols,
      tokenEstimate: Math.ceil(totalChars / 4),
    };
  }

  /**
   * 获取完整项目摘要（不含源码）
   */
  getFullSummary(): string {
    if (!this.initialized) return '索引未构建，请先调用 buildIndex()';

    let text = `📊 项目索引摘要\n\n`;
    text += `📁 根目录: ${this.rootPath}\n`;
    text += `📄 文件数: ${this.fileIndex.size}\n`;

    const langs: Record<string, number> = {};
    let totalLoc = 0;
    let totalSymbols = 0;
    for (const idx of this.fileIndex.values()) {
      langs[idx.language] = (langs[idx.language] || 0) + 1;
      totalLoc += idx.loc;
      totalSymbols += idx.symbols.length;
    }

    text += `📝 总行数: ${totalLoc.toLocaleString()}\n`;
    text += `🔧 符号数: ${totalSymbols}\n\n`;

    text += `🔤 语言分布:\n`;
    for (const [lang, count] of Object.entries(langs).sort((a, b) => b[1] - a[1])) {
      text += `  ${lang}: ${count} 文件\n`;
    }

    text += `\n🔗 依赖图: ${this.importGraph.size} 个文件有导入关系\n`;

    // Top symbols
    const topSymbols = Array.from(this.symbolMap.entries())
      .filter(([, locs]) => locs.some(l => l.symbol.exported))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    if (topSymbols.length > 0) {
      text += `\n⭐ 高频符号:\n`;
      for (const [name, locs] of topSymbols) {
        const kinds = [...new Set(locs.map(l => l.symbol.kind))].join('/');
        text += `  ${name} (${kinds}) — ${locs.length} 处\n`;
      }
    }

    return text;
  }

  // ── 内部方法 ──

  private async scanFiles(dir: string, depth: number): Promise<string[]> {
    if (depth > this.maxDepth) return [];

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return []; }

    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(this.rootPath, fullPath);

      // 忽略检查
      if (this.ignorePatterns.some(p => p.test(relPath) || p.test(entry.name))) continue;

      if (entry.isDirectory()) {
        const subFiles = await this.scanFiles(fullPath, depth + 1);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.extensions.has(ext)) {
          files.push(fullPath);
        }
      }

      if (files.length >= this.maxFiles) break;
    }

    return files;
  }

  private async indexFile(absPath: string): Promise<void> {
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      const relPath = path.relative(this.rootPath, absPath);
      const language = detectLanguage(absPath);
      const loc = content.split('\n').length;
      const hash = await contentHash(content);

      // 检查是否需要更新
      const existing = this.fileIndex.get(relPath);
      if (existing && existing.contentHash === hash) return; // 未变更

      const { symbols, imports, exports } = extractSymbols(content, language);

      const stat = await fs.stat(absPath);

      this.fileIndex.set(relPath, {
        path: relPath,
        absPath,
        language,
        loc,
        symbols,
        imports,
        exports,
        lastModified: stat.mtimeMs,
        contentHash: hash,
      });
    } catch { /* 忽略无法读取的文件 */ }
  }

  private resolveImport(fromFile: string, importSource: string): string | null {
    if (!importSource.startsWith('.') && !importSource.startsWith('/')) return null;

    const fromDir = path.dirname(fromFile);

    // 尝试各种扩展名
    const candidates = [
      importSource,
      `${importSource}.ts`, `${importSource}.tsx`, `${importSource}.js`, `${importSource}.jsx`,
      `${importSource}/index.ts`, `${importSource}/index.tsx`, `${importSource}/index.js`,
      `${importSource}.py`, `${importSource}.go`, `${importSource}.rs`,
    ];

    for (const c of candidates) {
      const resolved = path.normalize(path.join(fromDir, c));
      if (this.fileIndex.has(resolved)) return resolved;
    }

    return null;
  }

  private buildOverview(): string {
    const langs: Record<string, number> = {};
    let totalLoc = 0;
    for (const idx of this.fileIndex.values()) {
      langs[idx.language] = (langs[idx.language] || 0) + 1;
      totalLoc += idx.loc;
    }

    let text = `## 项目概览\n`;
    text += `- 文件数: ${this.fileIndex.size}\n`;
    text += `- 总行数: ${totalLoc.toLocaleString()}\n`;
    text += `- 语言: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l}(${c})`).join(', ')}\n\n`;
    return text;
  }

  private formatFileBlock(idx: FileIndex): string {
    let text = `### ${idx.path} (${idx.language}, ${idx.loc}行)\n`;

    if (idx.imports.length > 0) {
      const importSources = idx.imports.map(i => i.source).slice(0, 8);
      text += `imports: ${importSources.join(', ')}\n`;
    }

    if (idx.exports.length > 0) {
      text += `exports: ${idx.exports.join(', ')}\n`;
    }

    const fns = idx.symbols.filter(s => s.kind === 'function').slice(0, 10);
    const cls = idx.symbols.filter(s => s.kind === 'class' || s.kind === 'interface');

    if (cls.length > 0) {
      text += `types: ${cls.map(c => `${c.kind} ${c.name}`).join(', ')}\n`;
    }
    if (fns.length > 0) {
      text += `functions: ${fns.map(f => {
        return f.signature ? `${f.name}(${f.signature})` : `${f.name}()`;
      }).join(', ')}\n`;
    }

    return text;
  }

  private computeStats(indexTimeMs: number): ProjectStats {
    const langs: Record<string, number> = {};
    let totalLoc = 0;
    let totalSymbols = 0;

    for (const idx of this.fileIndex.values()) {
      langs[idx.language] = (langs[idx.language] || 0) + 1;
      totalLoc += idx.loc;
      totalSymbols += idx.symbols.length;
    }

    const topSymbols = Array.from(this.symbolMap.entries())
      .filter(([, locs]) => locs.some(l => l.symbol.exported))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([name, locs]) => ({
        name,
        kind: locs[0].symbol.kind,
        file: locs[0].file,
      }));

    return {
      totalFiles: this.fileIndex.size,
      totalLoc,
      languages: langs,
      totalSymbols,
      topSymbols,
      dependencyCount: this.importGraph.size,
      indexTimeMs,
    };
  }
}
