#!/usr/bin/env ts-node
/**
 * i18n-sync — 翻译同步脚本
 *
 * 功能：
 * - AST 扫描 frontend/src/ 提取所有中文 key
 * - 对比已有翻译文件，只翻译缺失的
 * - 调 LLM 批量翻译（带术语表 + prompt）
 * - 写入各语言翻译 JSON + manifest.json
 *
 * 用法：
 *   npx ts-node scripts/i18n-sync.ts          # 同步翻译
 *   npx ts-node scripts/i18n-sync.ts --check   # 仅检查缺失翻译
 *   npx ts-node scripts/i18n-sync.ts --dry     # dry-run 模式
 */
import * as fs from 'fs';
import * as nodePath from 'path';
import { fileURLToPath } from 'url';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (_traverse as any).default || _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);
const SRC_DIR = nodePath.resolve(__dirname, '../frontend/src');
const LOCALES_DIR = nodePath.resolve(SRC_DIR, 'i18n/locales');
const GLOSSARY_PATH = nodePath.resolve(SRC_DIR, 'i18n/glossary.json');
const TARGET_LANGUAGES = ['en', 'ja', 'ko', 'fr', 'de', 'es'];
const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const DRY_RUN = args.includes('--dry');

// ==================== AST 中文提取 ====================

interface ExtractedKey {
  text: string;
  file: string;
  line: number;
}

/**
 * 从单个文件中提取所有中文字符串
 */
function extractChineseFromFile(filePath: string): ExtractedKey[] {
  const code = fs.readFileSync(filePath, 'utf-8');
  const results: ExtractedKey[] = [];
  const seen = new Set<string>();

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
    });

    traverse(ast, {
      JSXText(path: any) {
        const value = path.node.value?.trim();
        if (value && CHINESE_RE.test(value) && !seen.has(value)) {
          seen.add(value);
          results.push({
            text: value,
            file: nodePath.relative(SRC_DIR, filePath),
            line: path.node.loc?.start.line || 0,
          });
        }
      },
      StringLiteral(path: any) {
        const value = path.node.value;
        if (!value || !CHINESE_RE.test(value) || seen.has(value)) return;
        // 跳过 import 路径
        if (t.isImportDeclaration(path.parent)) return;
        // 跳过 console
        if (t.isMemberExpression(path.parent) &&
            t.isIdentifier(path.parent.object) &&
            path.parent.object.name === 'console') return;
        seen.add(value);
        results.push({
          text: value,
          file: nodePath.relative(SRC_DIR, filePath),
          line: path.node.loc?.start.line || 0,
        });
      },
      // 也提取 t('中文') 中的参数（向后兼容）
      CallExpression(path: any) {
        const callee = path.node.callee;
        if (t.isIdentifier(callee) && callee.name === 't') {
          const firstArg = path.node.arguments[0];
          if (t.isStringLiteral(firstArg) && CHINESE_RE.test(firstArg.value) && !seen.has(firstArg.value)) {
            seen.add(firstArg.value);
            results.push({
              text: firstArg.value,
              file: nodePath.relative(SRC_DIR, filePath),
              line: path.node.loc?.start.line || 0,
            });
          }
        }
      },
    });
  } catch (err) {
    console.warn(`[i18n-sync] Failed to parse ${filePath}:`, (err as Error).message);
  }

  return results;
}

/**
 * 递归扫描目录中所有 TS/TSX 文件
 */
function scanSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过 node_modules、__tests__、locales
      if (['node_modules', '__tests__', 'locales', 'plugins'].includes(entry.name)) continue;
      files.push(...scanSourceFiles(fullPath));
    } else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

// ==================== 术语表加载 ====================

function loadGlossary(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// ==================== 已有翻译加载 ====================

function loadExistingTranslations(lang: string): Record<string, string> {
  const filePath = nodePath.join(LOCALES_DIR, `${lang}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== '_comment' && typeof value === 'string') {
        filtered[key] = value;
      }
    }
    return filtered;
  } catch {
    return {};
  }
}

// ==================== LLM 翻译（接入后端 API） ====================

/** 后端翻译 API 地址 */
const TRANSLATE_API = process.env.BUDDY_TRANSLATE_API || 'http://127.0.0.1:3000/api/translate';

/**
 * 调用后端 /api/translate 批量翻译
 * 带术语表 + systemPrompt，与运行时共享质量标准
 */
async function translateBatch(
  texts: string[],
  targetLang: string,
  glossary: Record<string, Record<string, string>>
): Promise<Record<string, string>> {
  // 构建术语表映射
  const langGlossary: Record<string, string> = {};
  for (const [zh, translations] of Object.entries(glossary)) {
    if (translations[targetLang]) {
      langGlossary[zh] = translations[targetLang];
    }
  }

  // 术语表直接命中
  const result: Record<string, string> = {};
  const needTranslation: string[] = [];

  for (const text of texts) {
    if (langGlossary[text]) {
      result[text] = langGlossary[text];
    } else {
      needTranslation.push(text);
    }
  }

  if (needTranslation.length === 0) return result;

  // 调后端 API
  try {
    const langNames: Record<string, string> = {
      en: 'English', ja: 'Japanese', ko: 'Korean',
      fr: 'French', de: 'German', es: 'Spanish',
    };
    const langName = langNames[targetLang] || targetLang;

    const systemPrompt = `You are a professional UI translator for a pet AI companion app called "Buddy".
Rules:
1. Keep translations SHORT and suitable for UI labels (1-3 words preferred)
2. Maintain a warm, friendly tone (this is a pet/companion app)
3. Preserve emoji prefixes in translations
4. Use consistent terminology (refer to the glossary)
5. For technical terms (API, LLM, Token), keep English original
6. For placeholder variables ({{count}}, {{name}}), keep them unchanged
7. Output ONLY the translations, no explanations`;

    const res = await fetch(TRANSLATE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts: needTranslation,
        targetLang,
        systemPrompt,
        glossary: langGlossary,
      }),
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { translations: string[]; source?: string };
    const translations = data.translations || [];

    for (let i = 0; i < needTranslation.length; i++) {
      result[needTranslation[i]] = translations[i] || `[${targetLang}]${needTranslation[i]}`;
    }

    const source = data.source === 'cache' ? 'cache' : 'LLM';
    console.log(`[i18n-sync] ✅ ${source} translated ${needTranslation.length} texts for ${targetLang}`);
  } catch (err) {
    console.warn(`[i18n-sync] ⚠️  API call failed: ${(err as Error).message}`);
    console.warn(`[i18n-sync] Falling back to source text as placeholder.`);
    for (const text of needTranslation) {
      result[text] = `[${targetLang}]${text}`;
    }
  }

  return result;
}

// ==================== 写入翻译文件 ====================

function writeTranslations(lang: string, translations: Record<string, string>): void {
  const filePath = nodePath.join(LOCALES_DIR, `${lang}.json`);
  const data: Record<string, string> = { _comment: `中文 → ${lang} 预翻译文件` };
  // 按 key 排序
  const sortedKeys = Object.keys(translations).sort();
  for (const key of sortedKeys) {
    data[key] = translations[key];
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function writeManifest(stats: Record<string, { keys: number; file: string }>): void {
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalKeys: Object.values(stats).reduce((sum, s) => Math.max(sum, s.keys), 0),
    languages: stats,
  };
  const filePath = nodePath.join(LOCALES_DIR, 'manifest.json');
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// ==================== 主逻辑 ====================

async function main(): Promise<void> {
  console.log('🔍 Scanning source files for Chinese text...\n');

  // 1. 扫描所有中文 key
  const sourceFiles = scanSourceFiles(SRC_DIR);
  const allKeys = new Map<string, ExtractedKey>();

  for (const file of sourceFiles) {
    const keys = extractChineseFromFile(file);
    for (const key of keys) {
      if (!allKeys.has(key.text)) {
        allKeys.set(key.text, key);
      }
    }
  }

  const uniqueKeys = [...allKeys.keys()].sort();
  console.log(`Found ${uniqueKeys.length} unique Chinese keys across ${sourceFiles.length} files.\n`);

  if (CHECK_ONLY) {
    // 检查模式：只报告缺失翻译，有缺失则 exit 1（CI 用）
    const glossary = loadGlossary();
    let totalMissing = 0;
    for (const lang of TARGET_LANGUAGES) {
      const existing = loadExistingTranslations(lang);
      const missing = uniqueKeys.filter(k => !existing[k] && !(glossary[k] && glossary[k][lang]));
      console.log(`${lang}: ${existing.length} existing, ${missing.length} missing`);
      if (missing.length > 0) {
        totalMissing += missing.length;
        missing.slice(0, 10).forEach(k => console.log(`  → "${k}"`));
        if (missing.length > 10) console.log(`  ... and ${missing.length - 10} more`);
      }
    }
    if (totalMissing > 0) {
      console.log(`\n❌ ${totalMissing} missing translations. Run 'npm run i18n:sync' to fix.`);
      process.exit(1);
    } else {
      console.log(`\n✅ All translations up to date.`);
    }
    return;
  }

  // 2. 加载术语表和已有翻译
  const glossary = loadGlossary();

  // 3. 对每个语言同步翻译
  const stats: Record<string, { keys: number; file: string }> = {};

  for (const lang of TARGET_LANGUAGES) {
    const existing = loadExistingTranslations(lang);
    const missing = uniqueKeys.filter(k => !existing[k]);

    if (missing.length === 0) {
      console.log(`✅ ${lang}: all ${uniqueKeys.length} keys translated`);
      stats[lang] = { keys: Object.keys(existing).length, file: `${lang}.json` };
      continue;
    }

    console.log(`🔄 ${lang}: ${missing.length} missing translations...`);

    if (DRY_RUN) {
      console.log(`  [dry-run] Would translate ${missing.length} keys`);
      missing.forEach(k => console.log(`  → "${k}"`));
      stats[lang] = { keys: Object.keys(existing).length, file: `${lang}.json` };
      continue;
    }

    // 翻译缺失的 key
    const newTranslations = await translateBatch(missing, lang, glossary);

    // 合并已有翻译 + 新翻译
    const merged = { ...existing, ...newTranslations };

    // 写入文件
    writeTranslations(lang, merged);
    stats[lang] = { keys: Object.keys(merged).length, file: `${lang}.json` };
    console.log(`  ✅ Written ${Object.keys(merged).length} keys to ${lang}.json`);
  }

  // 4. 写入 manifest
  if (!DRY_RUN) {
    writeManifest(stats);
    console.log('\n📋 Updated manifest.json');
  }

  // 5. 输出缺失 key 列表（供参考）
  const glossaryLangs = TARGET_LANGUAGES.filter(lang =>
    uniqueKeys.some(k => glossary[k] && glossary[k][lang])
  );
  if (glossaryLangs.length > 0) {
    console.log(`\n📖 Glossary covers ${Object.keys(glossary).length} terms`);
  }

  console.log('\n✨ i18n sync complete!');
}

main().catch(err => {
  console.error('❌ i18n sync failed:', err);
  process.exit(1);
});
