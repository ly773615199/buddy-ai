#!/usr/bin/env ts-node
/**
 * i18n-cleanup — 源码清理脚本
 *
 * 功能：
 * - 自动把 t('中文') 替换回中文原文（移除 t() 包裹）
 * - 自动移除 useTranslation 导入和 const { t } = useTranslation()
 * - 处理各种边界情况
 *
 * 用法：
 *   npx ts-node scripts/i18n-cleanup.ts            # 执行清理
 *   npx ts-node scripts/i18n-cleanup.ts --dry       # dry-run 模式
 *   npx ts-node scripts/i18n-cleanup.ts --file path # 只处理指定文件
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../frontend/src');
const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const FILE_INDEX = args.indexOf('--file');
const TARGET_FILE = FILE_INDEX >= 0 ? args[FILE_INDEX + 1] : null;

// ==================== 文件扫描 ====================

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

// ==================== 清理逻辑 ====================

interface CleanupResult {
  file: string;
  changes: string[];
  newCode: string | null;
}

function cleanupFile(filePath: string): CleanupResult {
  const code = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(SRC_DIR, filePath);
  const changes: string[] = [];

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
    });

    let modified = false;

    traverse(ast, {
      // 1. 把 t('中文') 替换回 '中文'
      CallExpression(path: any) {
        const callee = path.node.callee;
        if (!t.isIdentifier(callee) || callee.name !== 't') return;

        const firstArg = path.node.arguments[0];
        if (!t.isStringLiteral(firstArg)) return;

        // 保留模板字符串中的 t() 调用，只处理简单情况
        const text = firstArg.value;

        // 替换为字符串字面量
        path.replaceWith(t.stringLiteral(text));
        modified = true;
        changes.push(`t('${text}') → '${text}'`);
      },

      // 2. 移除 useTranslation 导入
      ImportDeclaration(path: any) {
        const source = path.node.source.value;
        if (!source.includes('useTranslation')) return;

        // 移除整个 import 语句
        path.remove();
        modified = true;
        changes.push(`Removed import from '${source}'`);
      },

      // 3. 移除 const { t } = useTranslation()
      VariableDeclaration(path: any) {
        for (const declarator of path.node.declarations) {
          if (!t.isObjectPattern(declarator.id)) continue;
          if (!t.isCallExpression(declarator.init)) continue;
          if (!t.isIdentifier(declarator.init.callee)) continue;
          if (declarator.init.callee.name !== 'useTranslation') continue;

          // 检查是否只解构了 t
          const properties = declarator.id.properties;
          const hasOnlyT = properties.length === 1 &&
            t.isObjectProperty(properties[0]) &&
            t.isIdentifier(properties[0].key) &&
            properties[0].key.name === 't';

          if (hasOnlyT) {
            path.remove();
            modified = true;
            changes.push('Removed const { t } = useTranslation()');
          }
          // 如果还解构了其他变量（如 i18n, lang），保留但移除 t
          // 这种情况比较复杂，暂时跳过
        }
      },
    });

    if (!modified) {
      return { file: relativePath, changes: [], newCode: null };
    }

    const output = generate(ast, {
      retainLines: true,
      compact: false,
      comments: true,
    });

    return { file: relativePath, changes, newCode: output.code };
  } catch (err) {
    console.warn(`[cleanup] Failed to process ${relativePath}:`, (err as Error).message);
    return { file: relativePath, changes: [`ERROR: ${(err as Error).message}`], newCode: null };
  }
}

// ==================== 主逻辑 ====================

async function main(): Promise<void> {
  console.log('🧹 i18n cleanup — removing t() wrappers and useTranslation imports\n');

  let files: string[];
  if (TARGET_FILE) {
    const absPath = path.resolve(TARGET_FILE);
    if (!fs.existsSync(absPath)) {
      console.error(`❌ File not found: ${absPath}`);
      process.exit(1);
    }
    files = [absPath];
  } else {
    files = scanSourceFiles(SRC_DIR);
  }

  let totalChanges = 0;
  let modifiedFiles = 0;

  for (const file of files) {
    const result = cleanupFile(file);

    if (result.changes.length === 0) continue;

    modifiedFiles++;
    totalChanges += result.changes.length;

    console.log(`📄 ${result.file}:`);
    result.changes.forEach(c => console.log(`  • ${c}`));

    if (!DRY_RUN && result.newCode) {
      fs.writeFileSync(file, result.newCode, 'utf-8');
      console.log(`  ✅ Written`);
    } else if (DRY_RUN) {
      console.log(`  [dry-run] Would write changes`);
    }
    console.log();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Modified ${modifiedFiles} files with ${totalChanges} changes.`);
  if (DRY_RUN) console.log('(dry-run mode, no files were actually modified)');
}

main().catch(err => {
  console.error('❌ Cleanup failed:', err);
  process.exit(1);
});
