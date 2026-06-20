/**
 * 代码-文本对构造脚本
 *
 * 从项目源码中提取代码片段和对应的自然语言描述，
 * 构造训练对用于 ByteEncoder 的代码-文本对齐预训。
 *
 * 数据来源：
 * 1. 函数/方法 + JSDoc 注释 → (代码, 自然语言描述)
 * 2. 类定义 + 类注释 → (类结构, 类描述)
 * 3. 接口定义 + 注释 → (接口结构, 接口描述)
 * 4. 错误消息 + 上下文 → (错误场景, 错误描述)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'training-data');

interface CodeTextPair {
  code: string;
  text: string;
  type: 'function' | 'class' | 'interface' | 'error' | 'config';
  source: string;
}

// ==================== 提取器 ====================

/**
 * 从 TypeScript 文件提取函数+注释对
 */
function extractFunctionPairs(filePath: string): CodeTextPair[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const pairs: CodeTextPair[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // 查找 JSDoc 注释块
    if (lines[i].trim().startsWith('/**')) {
      const commentLines: string[] = [];
      let j = i;
      while (j < lines.length && !lines[j].trim().endsWith('*/')) {
        commentLines.push(lines[j]);
        j++;
      }
      if (j < lines.length) commentLines.push(lines[j]);

      // 提取注释文本
      const commentText = commentLines
        .map(l => l.replace(/^\s*\*\s?/, '').replace(/\/\*\*|\*\//g, '').trim())
        .filter(l => l.length > 0 && !l.startsWith('@'))
        .join(' ');

      // 查找紧随其后的函数/方法定义
      let k = j + 1;
      while (k < lines.length && lines[k].trim() === '') k++;

      if (k < lines.length) {
        const defLine = lines[k].trim();
        const funcMatch = defLine.match(
          /(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)|(?:async\s+)?(\w+)\s*\(/
        );

        if (funcMatch && commentText.length >= 10 && /[\u4e00-\u9fff]/.test(commentText)) {
          // 提取函数签名（最多 10 行）
          const codeLines = lines.slice(k, Math.min(k + 10, lines.length));
          const code = codeLines.join('\n').trim();

          if (code.length >= 20) {
            pairs.push({
              code: code.slice(0, 500),
              text: commentText.slice(0, 300),
              type: 'function',
              source: filePath,
            });
          }
        }
      }
    }
  }

  return pairs;
}

/**
 * 提取类定义+注释对
 */
function extractClassPairs(filePath: string): CodeTextPair[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const pairs: CodeTextPair[] = [];

  // 匹配类定义前的注释
  const classPattern = /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+)?class\s+(\w+)/g;
  let match;

  while ((match = classPattern.exec(content)) !== null) {
    const comment = match[1]
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('@'))
      .join(' ');

    const className = match[2];

    if (comment.length >= 10 && /[\u4e00-\u9fff]/.test(comment)) {
      // 提取类的前几行（字段定义）
      const classStart = content.indexOf('{', match.index);
      if (classStart >= 0) {
        const classBody = content.slice(classStart, classStart + 500);
        const fields = classBody
          .split('\n')
          .slice(0, 10)
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('//') && l !== '{' && l !== '}')
          .join('\n');

        pairs.push({
          code: `class ${className} {\n${fields}\n}`,
          text: comment.slice(0, 300),
          type: 'class',
          source: filePath,
        });
      }
    }
  }

  return pairs;
}

/**
 * 提取接口定义+注释对
 */
function extractInterfacePairs(filePath: string): CodeTextPair[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const pairs: CodeTextPair[] = [];

  const ifacePattern = /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+)?interface\s+(\w+)/g;
  let match;

  while ((match = ifacePattern.exec(content)) !== null) {
    const comment = match[1]
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('@'))
      .join(' ');

    const ifaceName = match[2];

    if (comment.length >= 10 && /[\u4e00-\u9fff]/.test(comment)) {
      const ifaceStart = content.indexOf('{', match.index);
      if (ifaceStart >= 0) {
        const ifaceBody = content.slice(ifaceStart, ifaceStart + 300);
        const fields = ifaceBody
          .split('\n')
          .slice(0, 8)
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('//') && l !== '{' && l !== '}')
          .join('\n');

        pairs.push({
          code: `interface ${ifaceName} {\n${fields}\n}`,
          text: comment.slice(0, 300),
          type: 'interface',
          source: filePath,
        });
      }
    }
  }

  return pairs;
}

/**
 * 提取错误消息+上下文对
 */
function extractErrorPairs(filePath: string): CodeTextPair[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const pairs: CodeTextPair[] = [];

  // 匹配 throw new Error('...')
  const errorPattern = /throw\s+new\s+Error\(['"`]([^'"`]+)['"`]\)/g;
  let match;

  while ((match = errorPattern.exec(content)) !== null) {
    const errorMsg = match[1];
    if (errorMsg.length >= 5 && /[\u4e00-\u9fff]/.test(errorMsg)) {
      // 获取上下文（前后 3 行）
      const lines = content.slice(0, match.index).split('\n');
      const startLine = Math.max(0, lines.length - 3);
      const context = lines.slice(startLine).join('\n').trim();

      pairs.push({
        code: context.slice(0, 200),
        text: `错误: ${errorMsg}`,
        type: 'error',
        source: filePath,
      });
    }
  }

  return pairs;
}

// ==================== 主流程 ====================

function main() {
  console.log('=== 代码-文本对构造 ===\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allPairs: CodeTextPair[] = [];

  // 遍历 src 目录
  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        allPairs.push(
          ...extractFunctionPairs(fullPath),
          ...extractClassPairs(fullPath),
          ...extractInterfacePairs(fullPath),
          ...extractErrorPairs(fullPath),
        );
      }
    }
  }

  walkDir(path.join(PROJECT_ROOT, 'src'));

  // 去重
  const seen = new Set<string>();
  const uniquePairs = allPairs.filter(p => {
    const key = `${p.code.slice(0, 50)}|${p.text.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 打乱
  for (let i = uniquePairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniquePairs[i], uniquePairs[j]] = [uniquePairs[j], uniquePairs[i]];
  }

  // 写入 JSONL
  const outputPath = path.join(OUTPUT_DIR, 'code-text-pairs.jsonl');
  const lines = uniquePairs.map(p => JSON.stringify(p));
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');

  // 统计
  const byType = new Map<string, number>();
  for (const p of uniquePairs) {
    byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
  }

  console.log('=== 结果 ===');
  console.log(`总对数: ${uniquePairs.length}`);
  for (const [type, count] of byType) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`输出文件: ${outputPath}`);
  console.log('\n=== 完成 ===');
}

main();
