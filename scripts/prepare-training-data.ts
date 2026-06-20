/**
 * 训练数据准备脚本 — 从项目自身提取中文语料
 *
 * 数据来源：
 * 1. docs 下的 md 文件 — 项目文档（高质量中文）
 * 2. src 下的 ts 文件 — 代码注释 + 字符串常量
 * 3. 源码中的中文字符串（日志、提示词、描述）
 *
 * 输出：每行一个训练样本的文本文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'training-data');

// ==================== 提取器 ====================

/**
 * 从 Markdown 文档提取中文段落
 */
function extractFromDocs(): string[] {
  const docsDir = path.join(PROJECT_ROOT, 'docs');
  const samples: string[] = [];

  if (!fs.existsSync(docsDir)) return samples;

  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
    const lines = content.split('\n');

    let currentParagraph = '';
    for (const line of lines) {
      const trimmed = line.trim();

      // 跳过代码块、表格分隔符、空行
      if (trimmed.startsWith('```')) continue;
      if (trimmed.startsWith('|---')) continue;
      if (trimmed === '') {
        if (currentParagraph.length >= 15) {
          samples.push(currentParagraph.trim());
        }
        currentParagraph = '';
        continue;
      }

      // 跳过纯英文行
      if (!/[\u4e00-\u9fff]/.test(trimmed)) continue;

      // 累积段落
      currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
    }

    if (currentParagraph.length >= 15) {
      samples.push(currentParagraph.trim());
    }
  }

  return samples;
}

/**
 * 从 TypeScript 源码提取中文注释和字符串
 */
function extractFromSource(): string[] {
  const srcDir = path.join(PROJECT_ROOT, 'src');
  const samples: string[] = [];

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        extractFromFile(fullPath, samples);
      }
    }
  }

  walkDir(srcDir);
  return samples;
}

function extractFromFile(filePath: string, samples: string[]): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 提取中文注释
    const commentMatch = trimmed.match(/\/\/\s*(.+)/);
    if (commentMatch && /[\u4e00-\u9fff]/.test(commentMatch[1])) {
      const text = commentMatch[1].trim();
      if (text.length >= 10 && text.length <= 500) {
        // 清理注释标记
        samples.push(text.replace(/^[-*]\s*/, ''));
      }
    }

    // 提取 JSDoc 注释
    const jsdocMatch = trimmed.match(/\*\s*(.+)/);
    if (jsdocMatch && /[\u4e00-\u9fff]/.test(jsdocMatch[1])) {
      const text = jsdocMatch[1].trim();
      if (text.length >= 10 && text.length <= 500 && !text.startsWith('TODO')) {
        samples.push(text);
      }
    }

    // 提取中文字符串常量
    const stringMatches = trimmed.match(/['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*?)['"`]/g);
    if (stringMatches) {
      for (const match of stringMatches) {
        const text = match.slice(1, -1).trim();
        if (text.length >= 10 && text.length <= 300) {
          samples.push(text);
        }
      }
    }
  }
}

/**
 * 从 README 和 SOUL/USER/AGENTS 等文件提取
 */
function extractFromWorkspace(): string[] {
  const workspaceDir = path.join(PROJECT_ROOT);
  const samples: string[] = [];

  const files = ['README.md', 'AGENTS.md', 'SOUL.md', 'TOOLS.md'];
  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentParagraph = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) continue;
      if (trimmed === '') {
        if (currentParagraph.length >= 15) {
          samples.push(currentParagraph.trim());
        }
        currentParagraph = '';
        continue;
      }
      if (!/[\u4e00-\u9fff]/.test(trimmed)) continue;
      currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
    }
    if (currentParagraph.length >= 15) {
      samples.push(currentParagraph.trim());
    }
  }

  return samples;
}

/**
 * 从类型定义提取描述性文本
 */
function extractFromTypes(): string[] {
  const typesFile = path.join(PROJECT_ROOT, 'src/types.ts');
  const samples: string[] = [];

  if (!fs.existsSync(typesFile)) return samples;

  const content = fs.readFileSync(typesFile, 'utf-8');
  const commentBlocks = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];

  for (const block of commentBlocks) {
    const text = block
      .replace(/\/\*\*|\*\/|\*\s?/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && /[\u4e00-\u9fff]/.test(l))
      .join(' ');

    if (text.length >= 10) {
      samples.push(text);
    }
  }

  return samples;
}

// ==================== 数据清洗 ====================

function cleanSample(text: string): string | null {
  // 去除多余空白
  let cleaned = text.replace(/\s+/g, ' ').trim();

  // 去除 markdown 标记
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/#{1,6}\s*/g, '');
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 去除代码片段
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // 长度检查
  if (cleaned.length < 10 || cleaned.length > 1000) return null;

  // 中文比例检查（至少 20% 中文字符）
  const chineseRatio = (cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length / cleaned.length;
  if (chineseRatio < 0.15) return null;

  return cleaned;
}

// ==================== 主流程 ====================

function main() {
  console.log('=== 训练数据准备 ===\n');

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. 提取文档语料
  console.log('📄 提取文档语料...');
  const docSamples = extractFromDocs();
  console.log(`  文档: ${docSamples.length} 段`);

  // 2. 提取源码语料
  console.log('💻 提取源码语料...');
  const srcSamples = extractFromSource();
  console.log(`  源码: ${srcSamples.length} 条`);

  // 3. 提取工作区文件
  console.log('📝 提取工作区文件...');
  const wsSamples = extractFromWorkspace();
  console.log(`  工作区: ${wsSamples.length} 段`);

  // 4. 提取类型定义
  console.log('📋 提取类型定义...');
  const typeSamples = extractFromTypes();
  console.log(`  类型: ${typeSamples.length} 条`);

  // 5. 合并 + 清洗
  const allRaw = [...docSamples, ...srcSamples, ...wsSamples, ...typeSamples];
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const raw of allRaw) {
    const clean = cleanSample(raw);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      cleaned.push(clean);
    }
  }

  // 6. 打乱顺序
  for (let i = cleaned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cleaned[i], cleaned[j]] = [cleaned[j], cleaned[i]];
  }

  // 7. 写入文件
  const corpusPath = path.join(OUTPUT_DIR, 'chinese-corpus.txt');
  fs.writeFileSync(corpusPath, cleaned.join('\n'), 'utf-8');

  // 8. 统计
  const totalChars = cleaned.reduce((sum, s) => sum + s.length, 0);
  const avgLen = cleaned.length > 0 ? totalChars / cleaned.length : 0;

  console.log('\n=== 结果 ===');
  console.log(`总样本数: ${cleaned.length}`);
  console.log(`总字符数: ${totalChars}`);
  console.log(`平均长度: ${avgLen.toFixed(0)} 字符`);
  console.log(`输出文件: ${corpusPath}`);

  // 9. 按来源分类输出
  const docSet = new Set(docSamples.map(s => cleanSample(s)).filter(Boolean));
  const srcSet = new Set(srcSamples.map(s => cleanSample(s)).filter(Boolean));

  const codeRelated = cleaned.filter(s =>
    /代码|函数|模块|接口|API|TypeScript|JavaScript|实现|编译|测试|部署|Git|Docker/.test(s)
  );
  const convRelated = cleaned.filter(s =>
    /对话|用户|问题|回答|帮助|建议|请|谢谢|你好/.test(s)
  );

  const codePath = path.join(OUTPUT_DIR, 'code-related.txt');
  const convPath = path.join(OUTPUT_DIR, 'conversation-related.txt');
  fs.writeFileSync(codePath, codeRelated.join('\n'), 'utf-8');
  fs.writeFileSync(convPath, convRelated.join('\n'), 'utf-8');

  console.log(`\n代码相关: ${codeRelated.length} → ${codePath}`);
  console.log(`对话相关: ${convRelated.length} → ${convPath}`);
  console.log('\n=== 完成 ===');
}

main();
