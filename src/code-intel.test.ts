/**
 * Code Intelligence 工具测试
 * 覆盖: analyze_file, find_references, detectLanguage, analyzeTypeScript, analyzePython
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/buddy-code-intel-test';

describe('Code Intelligence', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  // ==================== analyze_file ====================

  describe('analyze_file', () => {
    it('分析 TypeScript 文件结构', async () => {
      const tsContent = `
import { z } from 'zod';
import * as fs from 'fs';

export interface Config {
  name: string;
  debug: boolean;
}

export class Manager {
  run() {}
}

export function process(data: string): string {
  return data;
}

export const DEFAULT_TIMEOUT = 5000;

function helper() {
  return 42;
}
`;
      fs.writeFileSync(path.join(TEST_DIR, 'test.ts'), tsContent);

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.ts') });

      expect(result).toContain('TypeScript');
      expect(result).toContain('Config');
      expect(result).toContain('Manager');
      expect(result).toContain('process()');
      expect(result).toContain('helper()');
    });

    it('分析 Python 文件结构', async () => {
      const pyContent = `
import os
from pathlib import Path

class DataProcessor:
    def process(self, data):
        return data

def main():
    pass

def _private():
    pass
`;
      fs.writeFileSync(path.join(TEST_DIR, 'test.py'), pyContent);

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.py') });

      expect(result).toContain('Python');
      expect(result).toContain('DataProcessor');
      expect(result).toContain('main()');
    });

    it('分析 Markdown 文件只显示行数', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'test.md'), '# Hello\n\nWorld');

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.md') });

      expect(result).toContain('Markdown');
      expect(result).toContain('行');
    });

    it('不存在的文件返回错误信息', async () => {
      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: '/nonexistent/file.ts' });

      expect(result).toContain('[分析失败');
    });

    it('空文件可分析', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'empty.ts'), '');

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'empty.ts') });

      expect(result).toContain('TypeScript');
    });

    it('识别未知扩展名', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'test.xyz'), 'content');

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.xyz') });

      expect(result).toContain('XYZ');
    });

    it('分析带 React 的 TSX', async () => {
      const tsxContent = `
import React from 'react';

export function App() {
  return <div>Hello</div>;
}

export interface Props {
  name: string;
}
`;
      fs.writeFileSync(path.join(TEST_DIR, 'test.tsx'), tsxContent);

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.tsx') });

      expect(result).toContain('React');
      expect(result).toContain('App()');
      expect(result).toContain('Props');
    });

    it('分析 JavaScript 文件', async () => {
      const jsContent = `
const express = require('express');

function handler(req, res) {
  res.send('ok');
}

class Server {
  start() {}
}

module.exports = { Server, handler };
`;
      fs.writeFileSync(path.join(TEST_DIR, 'test.js'), jsContent);

      const { analyze_file } = await import('./tools/code-intel.js');
      const result = await analyze_file.execute({ path: path.join(TEST_DIR, 'test.js') });

      expect(result).toContain('JavaScript');
      expect(result).toContain('handler()');
      expect(result).toContain('Server');
    });
  });

  // ==================== find_references ====================

  describe('find_references', () => {
    beforeAll(() => {
      // 创建多个测试文件用于引用搜索
      fs.writeFileSync(path.join(TEST_DIR, 'a.ts'), `import { helper } from './b';\nconsole.log(helper());`);
      fs.writeFileSync(path.join(TEST_DIR, 'b.ts'), `export function helper() { return 42; }`);
      fs.writeFileSync(path.join(TEST_DIR, 'c.ts'), `// helper is not used here`);
    });

    it('找到符号引用', async () => {
      const { find_references } = await import('./tools/code-intel.js');
      const result = await find_references.execute({ symbol: 'helper', dir: TEST_DIR });

      expect(result).toContain('helper');
      expect(result).toContain('a.ts');
    });

    it('未找到返回提示', async () => {
      const { find_references } = await import('./tools/code-intel.js');
      const result = await find_references.execute({ symbol: 'nonExistentSymbol12345', dir: TEST_DIR });

      // grep 无结果时返回 [未找到...] 或 [搜索失败:...]
      expect(result).toMatch(/\[未找到|\[搜索失败/);
    });

    it('支持文件过滤', async () => {
      const { find_references } = await import('./tools/code-intel.js');
      const result = await find_references.execute({
        symbol: 'helper', dir: TEST_DIR, file_pattern: '*.ts',
      });

      expect(result).toContain('helper');
    });
  });

  // ==================== CODE_INTEL_TOOLS 导出 ====================

  describe('工具注册', () => {
    it('导出 2 个工具', async () => {
      const { CODE_INTEL_TOOLS } = await import('./tools/code-intel.js');
      expect(CODE_INTEL_TOOLS).toHaveLength(2);
      expect(CODE_INTEL_TOOLS.map(t => t.name)).toEqual(['analyze_file', 'find_references']);
    });

    it('工具都有正确的权限定义', async () => {
      const { CODE_INTEL_TOOLS } = await import('./tools/code-intel.js');
      for (const tool of CODE_INTEL_TOOLS) {
        expect(tool.permission).toBe('read_files');
        expect(tool.execute).toBeInstanceOf(Function);
        expect(tool.parameters).toBeDefined();
      }
    });
  });
});
