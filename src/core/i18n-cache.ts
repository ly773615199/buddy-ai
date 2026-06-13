/**
 * i18n 翻译服务端缓存
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 3）
 * 职责：翻译缓存的内存管理 + 磁盘持久化
 */

import * as fs from 'fs';
import * as path from 'path';

export class I18nServerCache {
  private cache = new Map<string, Record<string, string>>();
  private cacheDir: string | null = null;
  private verbose: boolean;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  /** 初始化缓存目录，加载已有缓存文件 */
  init(): void {
    try {
      const dataDir = process.env.BUDDY_DATA_DIR || path.join(process.env.HOME || '/tmp', '.buddy');
      this.cacheDir = path.join(dataDir, 'i18n-cache');
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const lang = file.replace('.json', '');
        const data = JSON.parse(fs.readFileSync(path.join(this.cacheDir, file), 'utf-8'));
        this.cache.set(lang, data);
      }
      if (this.verbose && files.length > 0) {
        const total = [...this.cache.values()].reduce((s, m) => s + Object.keys(m).length, 0);
        console.log(`  [i18n] Loaded ${total} cached translations from ${files.length} languages`);
      }
    } catch (err) {
      console.warn('[i18n] Failed to init translation cache:', (err as Error).message);
    }
  }

  /** 查询翻译缓存 */
  lookup(texts: string[], lang: string): { hits: Record<string, string>; misses: string[] } {
    const langCache = this.cache.get(lang) || {};
    const hits: Record<string, string> = {};
    const misses: string[] = [];
    for (const text of texts) {
      if (langCache[text]) {
        hits[text] = langCache[text];
      } else {
        misses.push(text);
      }
    }
    return { hits, misses };
  }

  /** 写入翻译缓存（内存 + 磁盘） */
  write(lang: string, translations: Record<string, string>): void {
    if (!this.cache.has(lang)) this.cache.set(lang, {});
    Object.assign(this.cache.get(lang)!, translations);
    if (this.cacheDir) {
      try {
        const filePath = path.join(this.cacheDir, `${lang}.json`);
        fs.writeFileSync(filePath, JSON.stringify(this.cache.get(lang), null, 2), 'utf-8');
      } catch (err) {
        console.warn('[i18n] Failed to write cache:', (err as Error).message);
      }
    }
  }
}
