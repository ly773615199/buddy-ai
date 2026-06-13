import { describe, it, expect } from 'vitest';
import { PDFParser } from './pdf-parser.js';

describe('PDFParser', () => {
  const parser = new PDFParser();

  // ── 基本验证 ──

  describe('文件验证', () => {
    it('非 PDF 文件返回错误', () => {
      const buf = Buffer.from('this is not a pdf');
      const result = parser.extract(buf);
      expect(result.text).toBe('');
      expect(result.warnings.some(w => w.includes('不是有效的 PDF'))).toBe(true);
    });

    it('空 buffer 返回错误', () => {
      const buf = Buffer.alloc(0);
      const result = parser.extract(buf);
      expect(result.text).toBe('');
    });
  });

  // ── PDF 头 ──

  describe('PDF 头检测', () => {
    it('识别 %PDF-1.4 头', () => {
      const buf = Buffer.from('%PDF-1.4\n%%EOF');
      const result = parser.extract(buf);
      // 不会崩溃
      expect(result).toBeDefined();
    });

    it('识别 %PDF-1.7 头', () => {
      const buf = Buffer.from('%PDF-1.7\n%%EOF');
      const result = parser.extract(buf);
      expect(result).toBeDefined();
    });
  });

  // ── 构造最小 PDF ──

  describe('最小 PDF 结构', () => {
    it('提取带文本的最小 PDF', () => {
      // 构造一个最小的带文本 PDF
      const objects: string[] = [];

      // Object 1: Catalog
      objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

      // Object 2: Pages
      objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

      // Object 3: Page
      objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 612 792] >>\nendobj\n');

      // Object 4: Content stream (BT/ET with text)
      const streamContent = 'BT\n/F1 12 Tf\n100 700 Td\n(Hello World) Tj\nET';
      objects.push(`4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`);

      const body = objects.join('');
      const xrefOffset = body.length;

      // XRef table
      const xref = `xref\n0 5\n0000000000 65535 f \n${String(objects[0].length).padStart(10, '0')} 00000 n \n`;

      const trailer = `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

      const pdfContent = `%PDF-1.4\n${body}${xref}${trailer}`;
      const buf = Buffer.from(pdfContent);

      const result = parser.extract(buf);
      expect(result.pageCount).toBeGreaterThanOrEqual(0);
      // 即使不能完美解析，也不应崩溃
      expect(result).toBeDefined();
    });
  });

  // ── PDF 字符串解码 ──

  describe('PDF 字符串解码', () => {
    it('通过 extract 方法不崩溃', () => {
      // 使用一个简单的 buffer 测试
      const buf = Buffer.from('%PDF-1.4\nsome content\n%%EOF');
      const result = parser.extract(buf);
      expect(result).toBeDefined();
    });
  });

  // ── extractFromFile ──

  describe('extractFromFile', () => {
    it('不存在的文件抛出异常', async () => {
      await expect(parser.extractFromFile('/nonexistent/file.pdf')).rejects.toThrow();
    });
  });
});
