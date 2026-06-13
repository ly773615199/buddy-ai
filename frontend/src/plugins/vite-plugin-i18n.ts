/**
 * vite-plugin-i18n — 自动提取中文字符串并替换为 t() 调用
 *
 * 三层约定，零误伤：
 *
 * Layer 1 — JSX 文本 & 属性（JSXText / JSX StringLiteral）
 *   <div>中文</div>  →  <div>{t('中文')}</div>
 *   placeholder="中文"  →  placeholder={t('中文')}
 *
 * Layer 2 — 对象属性白名单（ObjectProperty + 白名单属性名）
 *   { label: '中文' }  →  { label: t('中文') }
 *   白名单: label / desc / description / name / placeholder / title /
 *           content / text / message / error / tooltip / subtitle /
 *           caption / hint / keyPlaceholder
 *
 * Layer 3 — 映射对象约定（ObjectProperty + 标识符key + 短中文值 ≤20字符）
 *   { happy: '开心' }  →  { happy: t('开心') }
 *   规则: key 匹配 ^[a-z_][a-z0-9_]*$ 且 value ≤ 20 字符含中文
 *
 * 用法：
 *   // vite.config.ts
 *   import { vitePluginI18n } from './src/plugins/vite-plugin-i18n';
 *   plugins: [react(), vitePluginI18n({ devMode: false })]
 */
import type { Plugin } from 'vite';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import path from 'path';
import * as fs from 'fs';

// ESM/CJS 兼容
const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

interface PluginOptions {
  /** dev 模式下也启用（默认 false，仅生产构建启用） */
  devMode?: boolean;
  /** dry-run 模式：只打印检测到的中文，不修改代码 */
  dryRun?: boolean;
  /** 需要处理的文件模式 */
  include?: RegExp;
  /** 需要排除的文件模式 */
  exclude?: RegExp;
  /** 严格模式：有未处理的中文字符串时构建失败 */
  strict?: boolean;
  /** 是否输出覆盖率报告（默认 true） */
  report?: boolean;
  /** 自动同步翻译文件：补充新增 key、删除废弃 key（默认 true） */
  autoSync?: boolean;
  /** 后端翻译 API 地址（默认 http://127.0.0.1:3000/api/translate） */
  translateApi?: string;
}

/** 匹配中文字符 */
const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** 判断是否是中文字符串 */
function hasChinese(str: string): boolean {
  return CHINESE_RE.test(str);
}

// ==================== Layer 2: 对象属性白名单 ====================
// 属性名本身表明值是用户可见文本，零配置即生效
const TRANSLATABLE_PROPS = new Set([
  'label', 'desc', 'description', 'name', 'placeholder', 'title',
  'content', 'text', 'message', 'error', 'tooltip', 'subtitle',
  'caption', 'hint', 'keyPlaceholder',
]);

// ==================== Layer 3: 映射对象约定 ====================
// key 是标识符格式 + value ≤ 20 字符含中文 → 判定为 UI 展示映射
const IDENTIFIER_KEY_RE = /^[a-z_][a-z0-9_]*$/;
const MAPPING_VALUE_MAX_LENGTH = 20;

// 技术属性黑名单 — 这些 key 的值即使含中文也不自动翻译
const TECHNICAL_KEYS = new Set([
  'type', 'id', 'key', 'src', 'href', 'role', 'name', 'className',
  'style', 'ref', 'target', 'rel', 'method', 'action', 'status',
  'mode', 'variant', 'size', 'color', 'theme', 'value', 'field',
  'column', 'table', 'database', 'host', 'port', 'path', 'url',
  'protocol', 'token', 'secret', 'password', 'version', 'platform',
  'engine', 'driver', 'format', 'encoding', 'locale', 'timezone',
  'console', 'window', 'document', 'navigator', 'process', 'module',
  'exports', 'require', 'global', 'globalThis',
]);

/** Layer 3 规则：判断对象属性是否属于 "标识符→中文" 映射模式 */
function isMappingPattern(key: string, value: string): boolean {
  if (TECHNICAL_KEYS.has(key)) return false;
  return IDENTIFIER_KEY_RE.test(key) &&
         value.length <= MAPPING_VALUE_MAX_LENGTH &&
         hasChinese(value);
}

// ==================== 跳过原因分类 ====================
type SkipReason =
  | 'import'           // import 路径中的中文
  | 'console'          // console 调用中的中文
  | 'existing-t'       // 已有 t() 包裹
  | 'non-translatable-attr'  // JSX 属性不在白名单
  | 'technical-key'    // 对象属性 key 在技术黑名单
  | 'long-value'       // 对象属性 value > 20 字符
  | 'identifier-miss'  // key 不匹配标识符格式
  | 'template-interpolation'; // 模板字面量含插值

interface SkipEntry {
  file: string;
  line: number;
  value: string;
  reason: SkipReason;
}

interface ExtractEntry {
  file: string;
  line: number;
  value: string;
  layer: 'L1-JSXText' | 'L1-JSXAttr' | 'L2-Whitelist' | 'L3-Mapping' | 'L1-Template';
}

// ==================== 报告统计 ====================
interface PluginStats {
  extracted: ExtractEntry[];
  skipped: SkipEntry[];
  filesProcessed: number;
  filesModified: number;
}

/**
 * 计算从源文件到 src/i18n/t.ts 的相对路径
 */
function getRelativeImportPath(sourceFile: string, srcRoot: string): string {
  const i18nTPath = path.join(srcRoot, 'i18n', 't');
  const sourceDir = path.dirname(sourceFile);
  let rel = path.relative(sourceDir, i18nTPath);
  rel = rel.split(path.sep).join('/');
  if (!rel.startsWith('.') && !rel.startsWith('/')) {
    rel = './' + rel;
  }
  return rel;
}

/**
 * 检查 AST 中是否已经导入了 t from i18n/t
 */
function hasExistingTImport(ast: t.File): boolean {
  let found = false;
  traverse(ast, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value;
      if (source.includes('i18n/t') || source.includes('i18n/index')) {
        for (const specifier of path.node.specifiers) {
          if (t.isImportSpecifier(specifier) &&
              t.isIdentifier(specifier.imported) &&
              specifier.imported.name === 't') {
            found = true;
          }
        }
      }
    },
  });
  return found;
}

// ==================== JSX 可翻译属性 ====================
const TRANSLATABLE_JSX_ATTRS = new Set([
  'placeholder', 'title', 'aria-label', 'aria-description',
  'alt', 'label', 'description', 'content',
]);

// ==================== 报告输出 ====================
function printReport(stats: PluginStats, srcRoot: string, strict: boolean): void {
  const { extracted, skipped } = stats;
  const total = extracted.length + skipped.length;

  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│           i18n 插件覆盖率报告               │');
  console.log('├─────────────────────────────────────────────┤');

  // 按 layer 统计
  const byLayer = (layer: string) => extracted.filter(e => e.layer === layer).length;
  const l1Text = byLayer('L1-JSXText');
  const l1Attr = byLayer('L1-JSXAttr');
  const l1Tpl = byLayer('L1-Template');
  const l2 = byLayer('L2-Whitelist');
  const l3 = byLayer('L3-Mapping');

  console.log(`│  自动提取:  ${String(extracted.length).padStart(4)} 处`);
  console.log(`│    Layer 1  JSXText    ${String(l1Text).padStart(4)}`);
  console.log(`│    Layer 1  JSX Attr   ${String(l1Attr).padStart(4)}`);
  console.log(`│    Layer 1  Template   ${String(l1Tpl).padStart(4)}`);
  console.log(`│    Layer 2  白名单属性  ${String(l2).padStart(4)}`);
  console.log(`│    Layer 3  映射对象    ${String(l3).padStart(4)}`);

  if (skipped.length > 0) {
    console.log(`│`);
    console.log(`│  未处理:    ${String(skipped.length).padStart(4)} 处`);

    const byReason = (reason: SkipReason) => skipped.filter(s => s.reason === reason);
    const reasons: [SkipReason, string][] = [
      ['existing-t', '已有 t() 包裹'],
      ['console', 'console 调用'],
      ['import', 'import 路径'],
      ['non-translatable-attr', '非翻译 JSX 属性'],
      ['technical-key', '技术属性 key'],
      ['long-value', '长文本 (>20字符)'],
      ['identifier-miss', '非标识符 key'],
      ['template-interpolation', '模板含插值'],
    ];

    for (const [reason, label] of reasons) {
      const items = byReason(reason);
      if (items.length > 0) {
        console.log(`│    ${label.padEnd(16)} ${String(items.length).padStart(4)}`);
      }
    }
  }

  console.log('├─────────────────────────────────────────────┤');

  const coverage = total > 0 ? Math.round(extracted.length / total * 10000) / 100 : 100;
  const bar = '█'.repeat(Math.round(coverage / 5)) + '░'.repeat(20 - Math.round(coverage / 5));
  const icon = coverage === 100 ? '✅' : coverage >= 90 ? '⚠️' : '❌';
  console.log(`│  ${icon} 覆盖率: ${bar} ${coverage}%`);
  console.log(`│     ${extracted.length}/${total} 处中文字符串已处理`);
  console.log('└─────────────────────────────────────────────┘');

  // 未处理详情（仅显示有翻译价值的）
  const actionable = skipped.filter(s =>
    s.reason === 'long-value' || s.reason === 'identifier-miss'
  );
  if (actionable.length > 0) {
    console.log('');
    console.log(`⚠️  需要关注的未处理字符串 (${actionable.length} 处):`);
    const byFile = new Map<string, SkipEntry[]>();
    for (const entry of actionable) {
      const key = entry.file.replace(srcRoot, '.');
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(entry);
    }
    for (const [file, entries] of byFile) {
      console.log(`  ${file}:`);
      for (const e of entries.slice(0, 5)) {
        console.log(`    L${e.line}  "${e.value.slice(0, 50)}${e.value.length > 50 ? '...' : ''}"  (${e.reason})`);
      }
      if (entries.length > 5) console.log(`    ... +${entries.length - 5} more`);
    }
  }

  // 严格模式：有未处理的翻译目标时失败
  if (strict && actionable.length > 0) {
    console.log('');
    console.log(`❌ strict 模式: ${actionable.length} 处中文字符串未处理，构建失败`);
    process.exit(1);
  }
}

// ==================== 自动同步翻译 ====================
const TARGET_LANGUAGES = ['en', 'ja', 'ko', 'fr', 'de', 'es'];

function loadGlossary(localesDir: string): Record<string, Record<string, string>> {
  const glossaryPath = path.join(localesDir, '..', 'glossary.json');
  try {
    return JSON.parse(fs.readFileSync(glossaryPath, 'utf-8'));
  } catch {
    return {};
  }
}

function loadExistingTranslations(localesDir: string, lang: string): Record<string, string> {
  const filePath = path.join(localesDir, `${lang}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') filtered[key] = value;
    }
    return filtered;
  } catch {
    return {};
  }
}

function writeTranslations(localesDir: string, lang: string, translations: Record<string, string>): void {
  const filePath = path.join(localesDir, `${lang}.json`);
  const data: Record<string, string> = { _comment: `中文 → ${lang} 预翻译文件` };
  for (const key of Object.keys(translations).sort()) {
    data[key] = translations[key];
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function writeManifest(localesDir: string, totalKeys: number, langStats: Record<string, number>): void {
  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    totalKeys,
    languages: Object.fromEntries(
      Object.entries(langStats).map(([lang, keys]) => [lang, { keys, file: `${lang}.json` }])
    ),
  };
  fs.writeFileSync(path.join(localesDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/** 扫描 src 目录下所有中文 key（源码真相源） */
function scanAllChineseKeys(srcRoot: string): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '__tests__', 'locales', 'plugins'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        const code = fs.readFileSync(fullPath, 'utf-8');
        if (!CHINESE_RE.test(code)) continue;
        try {
          const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
          });
          traverse(ast, {
            JSXText(p: any) {
              const v = p.node.value?.trim();
              if (v && CHINESE_RE.test(v)) keys.add(v);
            },
            StringLiteral(p: any) {
              const v = p.node.value;
              if (v && CHINESE_RE.test(v) && !t.isImportDeclaration(p.parent)) keys.add(v);
            },
          });
        } catch { /* 跳过解析失败的文件 */ }
      }
    }
  };
  walk(srcRoot);
  return keys;
}

async function callTranslateApi(
  texts: string[],
  targetLang: string,
  glossary: Record<string, string>,
  apiUrl: string,
): Promise<Record<string, string>> {
  const systemPrompt = `You are a professional UI translator for a pet AI companion app called "Buddy". Rules: 1. Keep translations SHORT for UI labels (1-3 words preferred). 2. Warm, friendly tone. 3. Preserve emoji prefixes. 4. Use glossary terms. 5. For technical terms (API, LLM, Token), keep English. 6. Output ONLY the translation.`;

  const glossaryStr = Object.entries(glossary).map(([k, v]) => `${k} → ${v}`).join('\n');
  const fullPrompt = glossaryStr
    ? `${systemPrompt}\nGlossary (must follow):\n${glossaryStr}`
    : systemPrompt;

  const result: Record<string, string> = {};

  for (const text of texts) {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [text], targetLang, systemPrompt: fullPrompt }),
      });
      if (!res.ok) continue;
      const data = await res.json() as { translations?: string[] };
      if (data.translations?.[0]) result[text] = data.translations[0];
    } catch { /* API 不可用 */ }
  }
  return result;
}

/** 直接调 LLM API（后端不可用时的 fallback，CI 环境用） */
async function callLlmDirect(
  texts: string[],
  targetLang: string,
  glossary: Record<string, string>,
): Promise<Record<string, string>> {
  const langNames: Record<string, string> = {
    en: 'English', ja: 'Japanese', ko: 'Korean',
    fr: 'French', de: 'German', es: 'Spanish',
  };
  const langName = langNames[targetLang] || targetLang;

  // 检测可用的 LLM API
  const providers = [
    { name: 'SiliconFlow', key: process.env.SILICONFLOW_API_KEY, base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    { name: 'OpenAI', key: process.env.OPENAI_API_KEY, base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: 'DeepSeek', key: process.env.DEEPSEEK_API_KEY, base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: 'Google', key: process.env.GOOGLE_API_KEY, base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  ];

  const provider = providers.find(p => p.key);
  if (!provider) return {};

  const glossaryStr = Object.entries(glossary).map(([k, v]) => `${k} → ${v}`).join('\n');
  const systemPrompt = `You are a UI translator for "Buddy" pet AI app. Translate to ${langName}. Rules: SHORT (1-3 words), warm tone, preserve emoji, use glossary. Output ONLY translation.${glossaryStr ? `\nGlossary:\n${glossaryStr}` : ''}`;

  const result: Record<string, string> = {};

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    try {
      const res = await fetch(`${provider.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `"${text}"` },
          ],
          max_tokens: 100,
          temperature: 0.1,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const translated = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
      if (translated) result[text] = translated;
    } catch { /* 跳过 */ }
    // 限流保护：每 3 个请求暂停 1 秒
    if (i > 0 && i % 3 === 0) await new Promise(r => setTimeout(r, 1000));
  }
  return result;
}

async function syncTranslations(
  srcRoot: string,
  localesDir: string,
  apiUrl: string,
): Promise<void> {
  const glossary = loadGlossary(localesDir);
  const sourceKeys = scanAllChineseKeys(srcRoot);

  console.log('');
  console.log('🔄 同步翻译文件...');
  console.log(`  📝 源码扫描: ${sourceKeys.size} 个中文 key`);

  let totalAdded = 0;
  let totalRemoved = 0;

  for (const lang of TARGET_LANGUAGES) {
    const existing = loadExistingTranslations(localesDir, lang);
    const existingKeys = new Set(Object.keys(existing));

    const added = [...sourceKeys].filter(k => !existingKeys.has(k));
    const removed = [...existingKeys].filter(k => !sourceKeys.has(k));

    if (added.length === 0 && removed.length === 0) {
      console.log(`  ✅ ${lang}: 已同步（${existingKeys.size} key）`);
      continue;
    }

    // 术语表命中
    const glossaryHits: Record<string, string> = {};
    const needApi: string[] = [];
    for (const key of added) {
      if (glossary[key]?.[lang]) {
        glossaryHits[key] = glossary[key][lang];
      } else {
        needApi.push(key);
      }
    }

    // API 翻译（后端优先，fallback 直接调 LLM）
    let apiResult: Record<string, string> = {};
    if (needApi.length > 0) {
      const langGlossary: Record<string, string> = {};
      for (const [zh, translations] of Object.entries(glossary)) {
        if (translations[lang]) langGlossary[zh] = translations[lang];
      }
      console.log(`  ⏳ ${lang}: ${needApi.length} 条待翻译...`);
      apiResult = await callTranslateApi(needApi, lang, langGlossary, apiUrl);
      // 后端不可用 → 直接调 LLM API
      if (Object.keys(apiResult).length < needApi.length) {
        const remaining = needApi.filter(k => !apiResult[k]);
        const llmResult = await callLlmDirect(remaining, lang, langGlossary);
        Object.assign(apiResult, llmResult);
      }
    }

    // 合并：保留未变的 + 新增的，仅在有新翻译时移除废弃 key
    const hasNewTranslations = Object.keys(glossaryHits).length > 0 || Object.keys(apiResult).length > 0;
    const merged: Record<string, string> = {};
    for (const key of Object.keys(existing).sort()) {
      // 没有新翻译时保留所有旧 key（防止 API 不可用时误删）
      if (hasNewTranslations ? !removed.includes(key) : true) {
        merged[key] = existing[key];
      }
    }
    Object.assign(merged, glossaryHits, apiResult);

    writeTranslations(localesDir, lang, merged);

    const apiCount = Object.keys(apiResult).length;
    const skipCount = needApi.length - apiCount;
    const parts = [];
    if (added.length > 0) parts.push(`+${added.length}（术语表${Object.keys(glossaryHits).length} + API${apiCount}${skipCount ? ` + 跳过${skipCount}` : ''}）`);
    if (removed.length > 0) parts.push(`-${removed.length}`);
    console.log(`  ✅ ${lang}: ${parts.join(', ')} → ${Object.keys(merged).length} key`);

    totalAdded += added.length;
    totalRemoved += removed.length;
  }

  // 更新 manifest
  const langStats: Record<string, number> = {};
  for (const lang of TARGET_LANGUAGES) {
    langStats[lang] = Object.keys(loadExistingTranslations(localesDir, lang)).length;
  }
  writeManifest(localesDir, sourceKeys.size, langStats);

  if (totalAdded > 0 || totalRemoved > 0) {
    console.log(`📋 同步完成: +${totalAdded} 新增, -${totalRemoved} 废弃`);
  } else {
    console.log('📋 翻译文件已是最新');
  }
}

export function vitePluginI18n(options: PluginOptions = {}): Plugin {
  const {
    devMode = false,
    dryRun = false,
    include = /\.[jt]sx?$/,
    exclude = /node_modules|\.test\.|__tests__/,
    strict = false,
    report = true,
    autoSync = true,
    translateApi = process.env.BUDDY_TRANSLATE_API || 'http://127.0.0.1:3000/api/translate',
  } = options;

  let srcRoot = '';
  const stats: PluginStats = {
    extracted: [],
    skipped: [],
    filesProcessed: 0,
    filesModified: 0,
  };

  return {
    name: 'vite-plugin-i18n',
    enforce: 'pre',

    configResolved(config) {
      srcRoot = path.join(config.root, 'src');
    },

    transform(code: string, id: string) {
      // 文件过滤
      if (!include.test(id)) return null;
      if (exclude.test(id)) return null;

      // 只处理 src 目录下的文件
      const relativeToSrc = path.relative(srcRoot, id);
      if (relativeToSrc.startsWith('..') || path.isAbsolute(relativeToSrc)) return null;

      // 快速检查是否有中文，没有就跳过
      if (!hasChinese(code)) return null;

      const shortFile = id.replace(srcRoot, '.');
      stats.filesProcessed++;

      try {
        const ast = parser.parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
        });

        let modified = false;
        const dryRunStrings: string[] = [];
        let needsTImport = false;

        // 收集当前文件的跳过项（用于 dry-run 和报告）
        const fileSkips: SkipEntry[] = [];

        function recordSkip(value: string, line: number, reason: SkipReason) {
          fileSkips.push({ file: shortFile, line, value, reason });
        }

        function recordExtract(value: string, line: number, layer: ExtractEntry['layer']) {
          if (dryRun) {
            dryRunStrings.push(value);
          }
          stats.extracted.push({ file: shortFile, line, value, layer });
        }

        traverse(ast, {
          // ── Layer 1: JSX 文本节点 ──
          JSXText(path: any) {
            const value = path.node.value;
            const trimmed = value.trim();
            if (!trimmed || !hasChinese(trimmed)) return;

            const line = path.node.loc?.start.line || 0;
            recordExtract(trimmed, line, 'L1-JSXText');

            if (dryRun) return;

            const strLit = t.stringLiteral(trimmed);
            (strLit as any)._i18nInjected = true;
            const callExpr = t.callExpression(
              t.identifier('t'),
              [strLit]
            );
            const jsxExpr = t.jSXExpressionContainer(callExpr);
            path.replaceWith(jsxExpr);
            modified = true;
            needsTImport = true;
          },

          // ── 字符串字面量（JSX 属性 + 对象属性）──
          StringLiteral(path: any) {
            const value = path.node.value;
            if (!value || !hasChinese(value)) return;
            const line = path.node.loc?.start.line || 0;

            // 跳过 import 路径
            if (t.isImportDeclaration(path.parent)) {
              recordSkip(value, line, 'import');
              return;
            }

            // 跳过已在 t() 调用中的参数（但排除 JSXText handler 刚创建的）
            if (t.isCallExpression(path.parent) &&
                t.isIdentifier(path.parent.callee) &&
                path.parent.callee.name === 't' &&
                !(path.node as any)._i18nInjected) {
              recordSkip(value, line, 'existing-t');
              return;
            }

            // 跳过 console.log / console.warn 等
            if (t.isMemberExpression(path.parent) &&
                t.isIdentifier(path.parent.object) &&
                path.parent.object.name === 'console') {
              recordSkip(value, line, 'console');
              return;
            }

            // ── JSX 属性（Layer 1）──
            if (t.isJSXAttribute(path.parent)) {
              const attrName = path.parent.name.name as string;
              if (!TRANSLATABLE_JSX_ATTRS.has(attrName)) {
                recordSkip(value, line, 'non-translatable-attr');
                return;
              }
              recordExtract(value, line, 'L1-JSXAttr');
            }
            // ── 对象属性（Layer 2 + Layer 3）──
            else if (t.isObjectProperty(path.parent)) {
              const key = path.parent.key;
              const propName = t.isIdentifier(key) ? key.name :
                               t.isStringLiteral(key) ? key.value : null;
              if (!propName) {
                recordSkip(value, line, 'identifier-miss');
                return;
              }

              const isWhitelisted = TRANSLATABLE_PROPS.has(propName);
              const isMapping = isMappingPattern(propName, value);

              if (isWhitelisted) {
                recordExtract(value, line, 'L2-Whitelist');
              } else if (isMapping) {
                recordExtract(value, line, 'L3-Mapping');
              } else {
                // 判断具体跳过原因
                if (TECHNICAL_KEYS.has(propName)) {
                  recordSkip(value, line, 'technical-key');
                } else if (value.length > MAPPING_VALUE_MAX_LENGTH) {
                  recordSkip(value, line, 'long-value');
                } else if (!IDENTIFIER_KEY_RE.test(propName)) {
                  recordSkip(value, line, 'identifier-miss');
                } else {
                  recordSkip(value, line, 'identifier-miss');
                }
                return;
              }
            }
            // ── JSX 子元素中的字符串：{"中文"} ──
            else if (t.isJSXExpressionContainer(path.parent)) {
              // {"中文"} 作为 JSX 子元素，需要提取
              recordExtract(value, line, 'L1-JSXText');
            }
            // ── 其他位置：跳过 ──
            else {
              return;
            }

            if (dryRun) return;

            const callExpr = t.callExpression(
              t.identifier('t'),
              [t.stringLiteral(value)]
            );
            // JSX 属性值必须包裹 JSXExpressionContainer，否则 Babel generate 报错
            // 例: placeholder="中文" → placeholder={t("中文")}
            if (t.isJSXAttribute(path.parent)) {
              path.replaceWith(t.jSXExpressionContainer(callExpr));
            } else {
              path.replaceWith(callExpr);
            }
            path.skip();
            modified = true;
            needsTImport = true;
          },

          // ── Layer 1: 模板字面量（纯中文自动提取，含插值跳过）──
          TemplateLiteral(path: any) {
            const quasis = path.node.quasis;
            const hasChineseInTemplate = quasis.some((q: any) =>
              q.value.raw && hasChinese(q.value.raw)
            );
            if (!hasChineseInTemplate) return;

            if (t.isCallExpression(path.parent) &&
                t.isIdentifier(path.parent.callee) &&
                path.parent.callee.name === 't') return;

            const line = path.node.loc?.start.line || 0;

            // 含插值 → 跳过
            if (path.node.expressions.length > 0) {
              const rawText = quasis.map((q: any) => q.value.raw).join('...');
              recordSkip(rawText, line, 'template-interpolation');
              return;
            }

            // 纯中文模板 → 提取
            const text = quasis[0].value.raw.trim();
            if (!text || !hasChinese(text)) return;

            recordExtract(text, line, 'L1-Template');

            if (dryRun) return;

            const callExpr = t.callExpression(
              t.identifier('t'),
              [t.stringLiteral(text)]
            );
            path.replaceWith(callExpr);
            path.skip();
            modified = true;
            needsTImport = true;
          },
        });

        // 汇总跳过项到全局统计
        stats.skipped.push(...fileSkips);

        // dry-run 模式：打印并返回
        if (dryRun) {
          if (dryRunStrings.length > 0) {
            console.log(`[i18n:dry-run] ${shortFile}:`);
            dryRunStrings.forEach(s => console.log(`  → "${s}"`));
          }
          return null;
        }

        if (!modified) return null;
        stats.filesModified++;

        // 注入 import { t } from '../i18n/t'
        if (needsTImport && !hasExistingTImport(ast)) {
          const importPath = getRelativeImportPath(id, srcRoot);
          const importDecl = t.importDeclaration(
            [t.importSpecifier(t.identifier('t'), t.identifier('t'))],
            t.stringLiteral(importPath)
          );
          ast.program.body.unshift(importDecl);
        }

        const output = generate(ast, {
          retainLines: true,
          compact: false,
          comments: true,
        });

        return {
          code: output.code,
          map: output.map,
        };
      } catch (err) {
        console.warn(`[i18n] Failed to process ${shortFile}:`, (err as Error).message);
        return null;
      }
    },

    // 构建结束时输出报告 + 自动同步翻译
    async closeBundle() {
      if (stats.filesProcessed === 0) {
        stats.extracted = [];
        stats.skipped = [];
        return;
      }

      if (report) {
        printReport(stats, srcRoot, strict);
      }

      // 自动同步翻译文件
      if (autoSync) {
        const localesDir = path.join(srcRoot, 'i18n', 'locales');
        try {
          await syncTranslations(srcRoot, localesDir, translateApi);
        } catch (err) {
          console.warn('[i18n] 翻译同步失败（不影响构建）:', (err as Error).message);
        }
      }

      // 重置（支持 watch 模式）
      stats.extracted = [];
      stats.skipped = [];
      stats.filesProcessed = 0;
      stats.filesModified = 0;
    },
  };
}
