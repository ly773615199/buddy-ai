#!/usr/bin/env ts-node
/**
 * i18n-check — 翻译质量检查脚本
 *
 * 功能：
 * - 检查翻译覆盖率（源码中文 key vs 翻译文件）
 * - 检查术语一致性（术语表 vs 翻译文件）
 * - 列出待复查条目
 * - 导出质量报告
 *
 * 用法：
 *   npx ts-node scripts/i18n-check.ts              # 完整检查
 *   npx ts-node scripts/i18n-check.ts --coverage    # 仅覆盖率
 *   npx ts-node scripts/i18n-check.ts --glossary    # 仅术语一致性
 *   npx ts-node scripts/i18n-check.ts --review      # 仅待复查条目
 *   npx ts-node scripts/i18n-check.ts --json        # JSON 输出（CI 用）
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (_traverse as any).default || _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../frontend/src');
const LOCALES_DIR = path.resolve(SRC_DIR, 'i18n/locales');
const GLOSSARY_PATH = path.resolve(SRC_DIR, 'i18n/glossary.json');
const TARGET_LANGUAGES = ['en', 'ja', 'ko', 'fr', 'de', 'es'];
const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
const COVERAGE_ONLY = args.includes('--coverage');
const GLOSSARY_ONLY = args.includes('--glossary');
const REVIEW_ONLY = args.includes('--review');
const JSON_OUTPUT = args.includes('--json');
const SHOW_ALL = args.includes('--all');

// ==================== 工具函数 ====================

function loadGlossary(): Record<string, Record<string, string>> {
  try {
    const raw = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf-8'));
    return raw.terms || raw;
  } catch {
    return {};
  }
}

function loadTranslations(lang: string): Record<string, string> {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('_') && typeof value === 'string') {
        filtered[key] = value;
      }
    }
    return filtered;
  } catch {
    return {};
  }
}

function loadReviewItems(lang: string): Record<string, { translated: string; note: string }> {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data._review || {};
  } catch {
    return {};
  }
}

// ==================== AST 中文提取 ====================

function extractChineseKeys(): Map<string, { file: string; line: number }> {
  const keys = new Map<string, { file: string; line: number }>();
  const files = scanSourceFiles(SRC_DIR);

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf-8');
    const relativePath = path.relative(SRC_DIR, file);

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
      });

      traverse(ast, {
        JSXText(path: any) {
          const value = path.node.value?.trim();
          if (value && CHINESE_RE.test(value) && !keys.has(value)) {
            keys.set(value, { file: relativePath, line: path.node.loc?.start.line || 0 });
          }
        },
        StringLiteral(path: any) {
          const value = path.node.value;
          if (!value || !CHINESE_RE.test(value) || keys.has(value)) return;
          if (t.isImportDeclaration(path.parent)) return;
          if (t.isMemberExpression(path.parent) &&
              t.isIdentifier(path.parent.object) &&
              path.parent.object.name === 'console') return;
          keys.set(value, { file: relativePath, line: path.node.loc?.start.line || 0 });
        },
        CallExpression(path: any) {
          const callee = path.node.callee;
          if (t.isIdentifier(callee) && callee.name === 't') {
            const firstArg = path.node.arguments[0];
            if (t.isStringLiteral(firstArg) && CHINESE_RE.test(firstArg.value) && !keys.has(firstArg.value)) {
              keys.set(firstArg.value, { file: relativePath, line: path.node.loc?.start.line || 0 });
            }
          }
        },
      });
    } catch {
      // skip parse errors
    }
  }

  return keys;
}

function scanSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', 'locales', 'plugins'].includes(entry.name)) continue;
      files.push(...scanSourceFiles(fullPath));
    } else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ==================== 检查逻辑 ====================

interface CheckResult {
  totalKeys: number;
  coverage: Record<string, {
    translated: number;
    missing: string[];
    coveragePercent: number;
  }>;
  glossary: {
    total: number;
    consistent: Record<string, { consistent: number; inconsistent: Array<{ key: string; expected: string; actual: string }> }>;
  };
  review: Record<string, Array<{ key: string; translated: string; note: string }>>;
}

function runCheck(): CheckResult {
  const sourceKeys = extractChineseKeys();
  const glossary = loadGlossary();
  const uniqueKeys = [...sourceKeys.keys()].sort();

  // 1. 覆盖率检查
  const coverage: CheckResult['coverage'] = {};
  for (const lang of TARGET_LANGUAGES) {
    const translations = loadTranslations(lang);
    const glossaryKeys = new Set(
      Object.keys(glossary).filter(k => glossary[k]?.[lang])
    );
    const missing = uniqueKeys.filter(k =>
      !translations[k] && !glossaryKeys.has(k)
    );
    const translated = uniqueKeys.length - missing.length;
    coverage[lang] = {
      translated,
      missing,
      coveragePercent: uniqueKeys.length > 0
        ? Math.round((translated / uniqueKeys.length) * 10000) / 100
        : 100,
    };
  }

  // 2. 术语一致性检查
  const glossaryResult: CheckResult['glossary'] = {
    total: Object.keys(glossary).length,
    consistent: {},
  };
  for (const lang of TARGET_LANGUAGES) {
    const translations = loadTranslations(lang);
    let consistent = 0;
    const inconsistent: Array<{ key: string; expected: string; actual: string }> = [];

    for (const [term, langs] of Object.entries(glossary)) {
      const expected = langs[lang];
      if (!expected) continue; // 术语表没有此语言的翻译
      const actual = translations[term];
      if (!actual) continue; // 翻译文件中没有此 key
      if (actual === expected) {
        consistent++;
      } else {
        inconsistent.push({ key: term, expected, actual });
      }
    }
    glossaryResult.consistent[lang] = { consistent, inconsistent };
  }

  // 3. 待复查条目
  const review: CheckResult['review'] = {};
  for (const lang of TARGET_LANGUAGES) {
    const items = loadReviewItems(lang);
    if (Object.keys(items).length > 0) {
      review[lang] = Object.entries(items).map(([key, val]) => ({
        key,
        translated: val.translated,
        note: val.note,
      }));
    }
  }

  return {
    totalKeys: uniqueKeys.length,
    coverage,
    glossary: glossaryResult,
    review,
  };
}

// ==================== 输出 ====================

function printReport(result: CheckResult): void {
  console.log('📊 i18n 质量报告');
  console.log('═'.repeat(50));
  console.log(`总 key 数:        ${result.totalKeys}`);
  console.log();

  // 覆盖率
  if (!GLOSSARY_ONLY && !REVIEW_ONLY) {
    console.log('📖 翻译覆盖率');
    console.log('─'.repeat(50));
    let hasError = false;
    for (const lang of TARGET_LANGUAGES) {
      const c = result.coverage[lang];
      const bar = '█'.repeat(Math.round(c.coveragePercent / 5)) +
                  '░'.repeat(20 - Math.round(c.coveragePercent / 5));
      const icon = c.coveragePercent === 100 ? '✅' : c.coveragePercent >= 80 ? '⚠️' : '❌';
      console.log(`  ${icon} ${lang}: ${bar} ${c.coveragePercent}% (${c.translated}/${result.totalKeys})`);
      if (c.missing.length > 0 && (SHOW_ALL || c.missing.length <= 20)) {
        c.missing.slice(0, 10).forEach(k => console.log(`     → "${k}"`));
        if (c.missing.length > 10) console.log(`     ... and ${c.missing.length - 10} more`);
      }
      if (c.coveragePercent < 100) hasError = true;
    }
    console.log();
  }

  // 术语一致性
  if (!COVERAGE_ONLY && !REVIEW_ONLY) {
    console.log('📖 术语一致性');
    console.log('─'.repeat(50));
    console.log(`  术语表条目: ${result.glossary.total}`);
    for (const lang of TARGET_LANGUAGES) {
      const g = result.glossary.consistent[lang];
      if (!g) continue;
      const icon = g.inconsistent.length === 0 ? '✅' : '❌';
      console.log(`  ${icon} ${lang}: ${g.consistent} consistent, ${g.inconsistent.length} inconsistent`);
      g.inconsistent.forEach(item =>
        console.log(`     → "${item.key}": expected "${item.expected}", got "${item.actual}"`)
      );
    }
    console.log();
  }

  // 待复查
  if (!COVERAGE_ONLY && !GLOSSARY_ONLY) {
    const hasReview = Object.keys(result.review).length > 0;
    console.log(`${hasReview ? '⚠️' : '✅'} 待复查条目`);
    console.log('─'.repeat(50));
    if (hasReview) {
      for (const [lang, items] of Object.entries(result.review)) {
        console.log(`  ${lang}: ${items.length} items`);
        items.forEach(item =>
          console.log(`     → "${item.key}" → "${item.translated}" (${item.note})`)
        );
      }
    } else {
      console.log('  无待复查条目');
    }
    console.log();
  }

  console.log('═'.repeat(50));
}

function printJson(result: CheckResult): void {
  const summary = {
    totalKeys: result.totalKeys,
    languages: {} as Record<string, { coverage: number; translated: number; missing: number; glossaryInconsistent: number; needsReview: number }>,
    passed: true,
  };

  for (const lang of TARGET_LANGUAGES) {
    const c = result.coverage[lang];
    const g = result.glossary.consistent[lang];
    const r = result.review[lang] || [];
    summary.languages[lang] = {
      coverage: c.coveragePercent,
      translated: c.translated,
      missing: c.missing.length,
      glossaryInconsistent: g?.inconsistent.length || 0,
      needsReview: r.length,
    };
    if (c.coveragePercent < 100 || (g?.inconsistent.length || 0) > 0 || r.length > 0) {
      summary.passed = false;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

// ==================== 主逻辑 ====================

const result = runCheck();

if (JSON_OUTPUT) {
  printJson(result);
} else {
  printReport(result);
}

// CI 退出码：有缺失翻译或术语不一致时返回 1
const hasIssues = TARGET_LANGUAGES.some(lang =>
  result.coverage[lang].coveragePercent < 100 ||
  (result.glossary.consistent[lang]?.inconsistent.length || 0) > 0 ||
  (result.review[lang]?.length || 0) > 0
);

if (hasIssues && !SHOW_ALL) {
  process.exit(1);
}
