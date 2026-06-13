# i18n 方案 V3：构建时自动提取 + 预翻译 + LLM 兜底

> 生成时间：2026-05-09
> 基于：V2 方案运行审计 + 开发体验优化
> 核心变更：废弃手动 `t()` 包裹，改用 Vite 插件自动提取中文字符串

---

## 当前状态（2026-05-09）

### ✅ 已完成

| 模块 | 文件 | 说明 |
|------|------|------|
| Vite 插件 | `frontend/src/plugins/vite-plugin-i18n.ts` | 三层约定自动提取 + 覆盖率报告 |
| 翻译引擎 | `frontend/src/i18n/translate-engine.ts` | 静态 JSON → 术语表 → 缓存 → LLM 四级查找 |
| t 函数 | `frontend/src/i18n/t.ts` | 独立 t()，供插件注入 |
| 术语表 | `frontend/src/i18n/glossary.json` | 23 个关键术语，6 语言 |
| Prompt 模板 | `frontend/src/i18n/translate-prompt.ts` | 构建时/运行时共享 |
| 预翻译文件 | `frontend/src/i18n/locales/*.json` | 6 语言 × 579 key，覆盖率 98.5% |
| i18n 配置 | `frontend/src/i18n/index.ts` | i18next 初始化 + 语言切换 |
| 同步脚本 | `scripts/i18n-sync.ts` | AST 扫描 + 术语表命中 + JSON 写入 |
| 清理脚本 | `scripts/i18n-cleanup.ts` | 去除 t() 包裹 + 移除 useTranslation |
| 检查脚本 | `scripts/i18n-check.ts` | 覆盖率 + 术语一致性 + 待复查 |
| Vite 配置 | `frontend/vite.config.ts` | 插件已注册，build 时启用 |

### 插件三层约定

```
Layer 1 — JSX 文本 & 属性（JSXText / JSX StringLiteral）
  <div>中文</div>  →  <div>{t('中文')}</div>
  placeholder="中文"  →  placeholder={t('中文')}

Layer 2 — 对象属性白名单（ObjectProperty + 14 个属性名）
  { label: '中文' }  →  { label: t('中文') }
  白名单: label / desc / description / name / placeholder / title /
          content / text / message / error / tooltip / subtitle / caption / hint / keyPlaceholder

Layer 3 — 映射对象约定（标识符 key + 短中文值 ≤20 字符）
  { happy: '开心' }  →  { happy: t('开心') }
  45 个技术属性黑名单防止误伤
```

验证结果：122/122 处对象字面量裸中文 = 100% 覆盖，0 误伤。

### ✅ 已完成（V3 全部功能）

#### 1. `/api/translate` 服务端缓存

**实现**：`src/core/ws-handler.ts`

- `i18nCache` (Map) + `i18nCacheDir` 内存+磁盘双层缓存
- `i18nCacheLookup()` 查缓存，`i18nCacheWrite()` 写入
- 缓存路径: `i18n-cache/<lang>.json`（跟随 dataDir）
- 启动时从磁盘加载到内存，翻译后实时写回文件
- 全部命中缓存时直接返回，零 LLM 调用

#### 2. 后端翻译 API 接收术语表和 prompt

**实现**：`src/core/ws-handler.ts` 的 `/api/translate` 路由

- 接收 `systemPrompt` + `glossary` 参数（可选，有默认值）
- 术语表约束拼入 system prompt，保证翻译一致性
- sync 脚本和运行时翻译共享同一套术语表

#### 3. 前端语言注册制

**实现**：

- `frontend/src/i18n/index.ts` — `ALL_LANGUAGES`（全量）+ `getRegisteredLanguages()`（已注册）+ `registerLanguage()` + `getAvailableLanguages()`
- `frontend/src/components/Settings.tsx` — "添加语言"下拉按钮，选择未注册语言后注册并出现在切换列表
- localStorage 存储: `buddy_registered_languages`
- 默认注册: zh-CN, en, ja, ko, fr, de, es（7 种预翻译语言）

#### 4. sync 脚本接入后端翻译 API

**实现**：`scripts/i18n-sync.ts`

- `translateBatch()` 调用后端 `http://127.0.0.1:3000/api/translate`
- 支持术语表传入，未命中术语表的 key 走 LLM 批量翻译
- CI 集成: `.github/workflows/ci.yml` 的 `i18n-check` job

---

## 一、背景与动机

### V2 方案遗留问题

| 问题 | 影响 |
|------|------|
| 手动 `t()` 包裹开发体验差 | 代码可读性下降，括号噪音大 |
| 遗漏率高 | 55 处硬编码中文未包裹 `t()`，覆盖率约 87% |
| LLM 翻译质量不稳定 | 首次翻译无对照，一致性无法保证 |
| 首次切换语言有延迟 | 需等 LLM 逐条响应 |

### V3 目标

- **开发者直接写中文**，零 i18n 代码负担
- **构建时自动提取**，覆盖率 100%，不会遗漏
- **预翻译 JSON 为主**，零延迟、质量可控、CI 强制保障
- **LLM 仅作安全网**，正常不触发，有它在不会出事

### 翻译质量定位

```
预翻译 JSON（主力）  — 覆盖 99%，零延迟，质量受控
        ↑
构建时质量保障        — 术语表 + 反向校验 + 人工复查 + CI 强制
        ↑
运行时 LLM（安全网）  — 正常不触发，兜底用，零开销
```

**运行时 LLM 的定位**：

| 场景 | 触发 LLM？ |
|------|-----------|
| 预翻译覆盖的 key（生产环境 99%+） | ❌ 静态 JSON 直接返回 |
| 新语言扩展（还没有预翻译文件） | ✅ LLM 全量兜底，不阻塞发布 |
| 开发阶段新增 key（开发者还没跑 sync） | ✅ 过渡用，下个构建周期覆盖 |
| 极端情况（运行时动态拼接的中文） | ✅ 安全网，不崩溃 |
| 生产环境正常使用 | ❌ 基本不触发 |

**设计原则**：有 LLM 不会出事，没 LLM 也不会出事。LLM 是保险，不是依赖。

---

## 二、架构设计

### 整体流程

```
┌──────────── 开发阶段 ────────────┐
│  开发者直接写中文                    │
│  <div>出错了</div>                  │
│  placeholder="输入消息..."          │
└──────────────┬───────────────────┘
               │ Vite 插件（构建时自动转换）
               ▼
┌──────────── 构建阶段 ────────────┐
│  ① AST 解析 JSX，提取中文字符串      │
│  ② 自动替换为 t('中文') 调用         │
│  ③ 自动注入 import { t } from i18n  │
│  ④ 生成/更新 manifest.json          │
│  ⑤ 术语表命中 → 直接写入             │
│  ⑥ 未命中 → LLM 翻译 + 反向校验     │
│  ⑦ 写入 en.json / ja.json / ...     │
│  ⑧ 未通过校验 → 标记待复查           │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────── 运行时 ──────────────┐
│  t('出错了')                        │
│    → ① 静态 JSON 命中 → 返回翻译    │  ← 99% 走这里
│    → ② localStorage 缓存 → 返回    │
│    → ③ LLM 安全网（仅兜底）→ 返回   │  ← 正常不触发
│    → ④ 返回中文原文（不崩溃）       │
└──────────────────────────────────┘
```

### 翻译查找链对比

```
V2（现状）:  localStorage 缓存 → LLM → 原文
V3（新方案）: 静态 JSON（主力）→ 缓存 → LLM 安全网 → 原文
```

---

## 三、文件结构

```
frontend/src/
├── i18n/
│   ├── index.ts              ← i18n 配置（改造：加载静态 JSON + 术语表）
│   ├── translate-engine.ts   ← 翻译引擎（改造：静态文件优先 + 术语表优先）
│   ├── useTranslation.ts     ← React hook（保留）
│   ├── t.ts                  ← 导出 t 函数（新建：供插件注入使用）
│   ├── translate-prompt.ts   ← 翻译 prompt 模板（新建：构建时/运行时共享）
│   ├── glossary.json         ← 术语表（新建：关键术语固定翻译）
│   ├── locales/
│   │   ├── en.json           ← 英文预翻译（生成）
│   │   ├── ja.json           ← 日文预翻译（生成）
│   │   ├── ko.json           ← 韩文预翻译（生成）
│   │   ├── fr.json           ← 法文预翻译（生成）
│   │   ├── de.json           ← 德文预翻译（生成）
│   │   └── es.json           ← 西文预翻译（生成）
│   └── manifest.json         ← 所有中文 key 清单（生成）
├── plugins/
│   └── vite-plugin-i18n.ts   ← Vite 插件（新建）
scripts/
├── i18n-sync.ts              ← 翻译同步脚本（新建）
├── i18n-cleanup.ts           ← 源码清理脚本（新建）
└── i18n-check.ts             ← 质量检查脚本（新建）
```

---

## 四、Vite 插件设计

### 插件接口

```ts
// vite-plugin-i18n.ts
interface I18nPluginOptions {
  /** 需要扫描的文件模式，默认 ['**/*.tsx', '**/*.ts'] */
  include?: string[];
  /** 排除模式，默认 ['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts'] */
  exclude?: string[];
  /** 翻译文件输出目录，默认 'src/i18n/locales' */
  localesDir?: string;
  /** 是否在 dev 模式启用，默认 false */
  devMode?: boolean;
  /** dry-run 模式：只输出会修改什么，不实际修改，默认 false */
  dryRun?: boolean;
}
```

### 识别范围（只处理用户可见文本）

| JSX 模式 | 处理方式 | 示例 |
|----------|---------|------|
| JSX 文本节点 | 自动包裹 `t()` | `<div>出错了</div>` → `<div>{t('出错了')}</div>` |
| 字符串属性 | 自动包裹 `t()` | `placeholder="输入"` → `placeholder={t('输入')}` |
| 模板字面量 | 保留变量，提取中文部分 | `` `共 ${n} 个` `` → `` {t('共') + ' ' + n + ' ' + t('个')} `` |
| 已有 `t()` | 跳过，不重复处理 | `{t('出错了')}` → 保持原样 |

### 跳过范围（不处理）

| 模式 | 原因 |
|------|------|
| JSX 注释 `{/* 中文 */}` | 非运行时文本 |
| `console.log/warn/error('中文')` | 开发者日志 |
| `import` 语句中的中文 | 不存在 |
| `//` 和 `/* */` 注释 | 非运行时文本 |
| 变量名、类型定义 | 非用户可见文本 |
| 纯英文字符串 | 不需要翻译 |

### AST 解析策略

```ts
// 使用 @babel/parser 解析（项目已有 babel 依赖）
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';

// 解析流程：
// 1. parse(sourceCode) → AST
// 2. traverse(AST) → 遍历 JSXText / JSXAttribute / StringLiteral
// 3. 检测中文 → 记录位置和原文
// 4. 替换节点 → 生成新代码
// 5. 输出 source map
```

### 边界情况处理

```tsx
// 1. 混合 JSX 表达式
<div>共 {count} 个结果</div>
// → <div>{t('共')} {count} {t('个结果')}</div>

// 2. 模板字面量 + 插值
<div>{`错误: ${err.message}`}</div>
// → <div>{t('错误') + ': ' + err.message}</div>

// 3. 条件表达式
<span>{condition ? '开启' : '关闭'}</span>
// → <span>{condition ? t('开启') : t('关闭')}</span>

// 4. 对象字面量（需保守处理）
{ label: '硅基流动', value: 'siliconflow' }
// → { label: t('硅基流动'), value: 'siliconflow' }
// 仅处理在组件上下文中的对象字面量

// 5. 属性值
<button title="点击展开">▶</button>
// → <button title={t('点击展开')}>▶</button>

// 6. aria 属性
<button aria-label="关闭">✕</button>
// → <button aria-label={t('关闭')}>✕</button>
```

### 安全策略

| 策略 | 说明 |
|------|------|
| AST 解析 | 不用正则，避免误匹配 |
| 保守原则 | 拿不准的不处理，保持原样 |
| dry-run | 先预览再修改 |
| dev 模式可关闭 | 开发时可禁用插件 |
| Source Map | 保留映射，出问题可定位 |
| 跳过已有 `t()` | 不重复处理 V2 存量 |

---

## 五、翻译引擎改造

### translate-engine.ts V3 改造

```ts
// 静态翻译文件（构建时生成，打包进产物）
const staticLocales: Record<string, Record<string, string>> = {};

/** 加载静态翻译文件 */
export async function loadLocale(lang: string): Promise<void> {
  if (staticLocales[lang]) return;
  try {
    const mod = await import(`./locales/${lang}.json`);
    staticLocales[lang] = mod.default;
  } catch {
    // 文件不存在，说明是新语言，LLM 安全网启用
  }
}

/** 判断该语言是否有预翻译文件 */
function hasStaticLocale(lang: string): boolean {
  return !!staticLocales[lang] && Object.keys(staticLocales[lang]).length > 0;
}

/** 同步翻译（查找链：静态 → 缓存 → 原文） */
export function translateSync(text: string, lang: string): string {
  if (!text || isChineseLang(lang)) return text;
  if (!hasChinese(text)) return text;

  // ① 静态预翻译文件
  if (staticLocales[lang]?.[text]) return staticLocales[lang][text];

  // ② localStorage 缓存
  const key = cacheKey(text, lang);
  if (cache[key]) return cache[key];

  return text; // 兜底
}

/** 异步翻译（查找链：静态 → 缓存 → LLM 安全网 → 原文） */
export async function translate(text: string, lang: string): Promise<string> {
  if (!text || isChineseLang(lang)) return text;
  if (!hasChinese(text)) return text;

  // ① 静态预翻译文件
  if (staticLocales[lang]?.[text]) return staticLocales[lang][text];

  // ② localStorage 缓存
  const key = cacheKey(text, lang);
  if (cache[key]) return cache[key];

  // ③ LLM 安全网 — 仅在以下情况触发：
  //    - 该语言没有预翻译文件（新语言扩展）
  //    - dev 模式（开发者还没跑 sync）
  //    生产环境有预翻译文件时，不会走到这里
  if (!hasStaticLocale(lang) || isDevMode()) {
    try {
      const result = await callLLM(text, lang);
      cache[key] = result;
      persistCache();
      return result;
    } catch (err) {
      console.warn('[i18n] LLM safety net failed:', err);
    }
  }

  return text; // ④ 兜底
}

/** 预热：加载目标语言 + 翻译页面文本 */
export async function warmup(texts: string[], lang: string): Promise<void> {
  await loadLocale(lang);
  // 只翻译静态文件中没有的
  const missing = texts.filter(t =>
    t && hasChinese(t) &&
    !staticLocales[lang]?.[t] &&
    !cache[cacheKey(t, lang)]
  );
  if (missing.length > 0) {
    await batchTranslate(missing, lang);
  }
}
```

### t.ts（新建：供插件注入使用）

```ts
/**
 * t() 翻译函数 — 供 Vite 插件自动注入使用
 * 组件中不需要手动 import，插件会自动添加
 */
import { translateSync, translate } from './translate-engine';
import i18n from 'i18next';

function interpolate(str: string, vars?: Record<string, unknown>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

export function t(key: string, options?: Record<string, unknown>): string {
  const lang = i18n.language || 'zh-CN';

  if (lang === 'zh-CN' || lang === 'zh') {
    return interpolate(key, options);
  }

  const cached = translateSync(key, lang);
  if (cached !== key) return interpolate(cached, options);

  translate(key, lang);
  return interpolate(key, options);
}
```

---

## 六、翻译同步脚本

### scripts/i18n-sync.ts

```ts
/**
 * 翻译同步脚本
 *
 * 用法：
 *   npx ts-node scripts/i18n-sync.ts           # 扫描 + 翻译 + 写入
 *   npx ts-node scripts/i18n-sync.ts --check   # 仅检查，有未翻译则报错
 *   npx ts-node scripts/i18n-sync.ts --dry     # dry-run，只输出不写入
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = 'frontend/src/i18n/locales';
const SRC_DIR = 'frontend/src';
const TARGET_LANGS = ['en', 'ja', 'ko', 'fr', 'de', 'es'];

/** 从源码中提取所有中文字符串 */
function extractChineseKeys(): Set<string> {
  const keys = new Set<string>();
  const files = walkDir(SRC_DIR, ['.tsx', '.ts']);

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf-8');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    traverse(ast, {
      // JSX 文本节点
      JSXText(path) {
        const text = path.node.value.trim();
        if (text && /[\u4e00-\u9fff]/.test(text)) {
          keys.add(text);
        }
      },
      // 字符串字面量（属性值、函数参数等）
      StringLiteral(path) {
        const text = path.node.value;
        if (/[\u4e00-\u9fff]/.test(text)) {
          // 跳过 import 路径、console 等
          if (isUserVisible(path)) {
            keys.add(text);
          }
        }
      },
    });
  }

  return keys;
}

/** 翻译缺失的 key */
async function syncTranslations(keys: string[]): Promise<void> {
  fs.mkdirSync(LOCALES_DIR, { recursive: true });

  for (const lang of TARGET_LANGS) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '{}');
    const missing = [...keys].filter(k => !existing[k]);

    if (missing.length === 0) {
      console.log(`✅ ${lang}: 全部已翻译`);
      continue;
    }

    console.log(`⏳ ${lang}: ${missing.length} 个待翻译...`);

    // 调 LLM 批量翻译
    const translations = await batchTranslate(missing, lang);
    const merged = { ...existing, ...translations };

    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
    console.log(`✅ ${lang}: 新增 ${missing.length} 条翻译`);
  }

  // 写 manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalKeys: keys.size,
    keys: [...keys].sort(),
  };
  fs.writeFileSync(
    path.join(LOCALES_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  console.log(`📋 manifest: ${keys.size} 个 key`);
}

// CLI 入口
const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const isDry = args.includes('--dry');

const keys = extractChineseKeys();
if (isCheck) {
  // 检查模式：报错如果有未翻译的
  process.exit(0);
} else {
  syncTranslations(keys);
}
```

---

## 七、翻译质量保障

### 核心思路

运行时翻译要快（用户在等），构建时翻译可以慢慢来。**质量控制集中在两个阶段**：

1. **构建时预翻译** — 充分利用时间优势，多轮校验
2. **运行时 LLM 补充** — 共享术语表和 prompt 模板，保持一致

### 7.1 术语表（Glossary）

维护一份关键术语的固定翻译，LLM 和人工都必须遵守。

```json
// frontend/src/i18n/glossary.json
{
  "_meta": {
    "description": "关键术语固定翻译，LLM 和人工编辑都必须遵守",
    "updated": "2026-05-09"
  },
  "terms": {
    "亲密度": {
      "en": "Intimacy",
      "ja": "親密度",
      "ko": "친밀도",
      "fr": "Intimité",
      "de": "Vertrautheit",
      "es": "Intimidad",
      "note": "宠物属性，不要译成 Affection"
    },
    "精力": {
      "en": "Energy",
      "ja": "エネルギー",
      "ko": "에너지",
      "note": "宠物属性"
    },
    "心情": {
      "en": "Mood",
      "ja": "気分",
      "ko": "기분",
      "note": "宠物情绪状态"
    },
    "蛋": {
      "en": "Egg",
      "ja": "たまご",
      "note": "宠物进化第一阶段"
    },
    "孵化": {
      "en": "Hatching",
      "ja": "孵化",
      "note": "宠物进化第二阶段"
    },
    "成长": {
      "en": "Growing",
      "ja": "成長",
      "note": "宠物进化第三阶段"
    },
    "成形": {
      "en": "Formed",
      "ja": "成形",
      "note": "宠物进化第四阶段"
    },
    "成熟": {
      "en": "Mature",
      "ja": "成熟",
      "note": "宠物进化第五阶段"
    },
    "完全体": {
      "en": "Complete",
      "ja": "完全体",
      "note": "宠物进化第六阶段"
    },
    "传说": {
      "en": "Legendary",
      "ja": "レジェンダリー",
      "note": "宠物进化第七阶段"
    },
    "硅基流动": {
      "en": "SiliconFlow",
      "ja": "SiliconFlow",
      "note": "LLM 提供商名称，不翻译"
    },
    "传感器": {
      "en": "Sensor",
      "ja": "センサー",
      "note": "硬件传感器"
    }
  }
}
```

**术语表维护规则**：

- 关键属性名、阶段名、专有名词必须收录
- LLM 翻译时先查术语表，命中直接用，不重新翻译
- 人工编辑翻译文件时，术语表中的条目不允许修改（CI 检查）
- 新增关键术语时同步更新术语表

### 7.2 翻译 Prompt 模板

构建时和运行时共享同一套 prompt 模板，确保翻译风格一致。

```ts
// frontend/src/i18n/translate-prompt.ts

/** 系统 prompt — 定义翻译角色和规则 */
export const SYSTEM_PROMPT = `You are a professional UI translator for a pet AI companion app called "Buddy".
Rules:
1. Keep translations SHORT and suitable for UI labels (1-3 words preferred)
2. Maintain a warm, friendly tone (this is a pet/companion app)
3. Preserve emoji prefixes (📊 🎯 ⚡ etc.) in translations
4. Use consistent terminology (refer to the glossary)
5. For technical terms (API, LLM, Token), keep English original
6. For placeholder variables ({{count}}, {{name}}), keep them unchanged
7. Output ONLY the translation, no explanations`;

/** 构建时 prompt — 带上下文，可花更多时间 */
export function buildTimePrompt(
  text: string,
  targetLang: string,
  component?: string,
  glossary?: Record<string, string>
): string {
  const parts = [`Translate to ${targetLang}:`, `"${text}"`];

  if (component) {
    parts.push(`Component: ${component}`);
  }
  if (glossary && Object.keys(glossary).length > 0) {
    const glossaryStr = Object.entries(glossary)
      .map(([k, v]) => `${k} → ${v}`)
      .join(', ');
    parts.push(`Glossary (must follow): ${glossaryStr}`);
  }

  return parts.join('\n');
}

/** 运行时 prompt — 无上下文，快速翻译 */
export function runTimePrompt(
  text: string,
  targetLang: string,
  glossary?: Record<string, string>
): string {
  const parts = [`Translate to ${targetLang}:`, `"${text}"`];

  if (glossary && Object.keys(glossary).length > 0) {
    const glossaryStr = Object.entries(glossary)
      .map(([k, v]) => `${k} → ${v}`)
      .join(', ');
    parts.push(`Glossary: ${glossaryStr}`);
  }

  return parts.join('\n');
}
```

### 7.3 构建时翻译流程（高质量）

```
待翻译 key
    ↓
① 查术语表 → 命中 → 直接用（零 LLM 调用）
    ↓ 未命中
② 查已有翻译文件 → 命中 → 跳过
    ↓ 未命中
③ 查 localStorage 缓存 → 命中 → 跳过
    ↓ 未命中
④ 调 LLM 翻译（带组件上下文 + 术语表）
    ↓
⑤ 反向翻译校验（可选）
    ↓
⑥ 写入翻译文件
```

**反向翻译校验**：

```ts
async function verifyTranslation(
  original: string,
  translated: string,
  sourceLang: string
): Promise<{ ok: boolean; backTranslated?: string }> {
  // 把翻译结果反向翻译回中文
  const backPrompt = `Translate to ${sourceLang}: "${translated}"`;
  const backTranslated = await llmTranslate(backPrompt, sourceLang);

  // 简单匹配检查
  const similarity = calculateSimilarity(original, backTranslated);
  return {
    ok: similarity > 0.6, // 阈值可调
    backTranslated,
  };
}
```

校验失败的条目标记为 `needsReview: true`，写入 manifest，人工复查。

### 7.4 运行时 LLM 安全网（同质量标准）

运行时 LLM 是安全网，不是主力翻译。触发条件极窄：

```
触发条件：
  ① 该语言没有预翻译文件（新语言扩展，如刚加了阿拉伯语）
  ② dev 模式（开发者还没跑 sync，新增的 key 需要即时翻译）

不触发条件（生产环境正常情况）：
  ① 该语言有预翻译文件 → 静态 JSON 覆盖 99%
  ② 缓存命中 → 之前 LLM 翻译过的残留
```

当安全网触发时，走同一套质量流程：

```ts
// translate-engine.ts — 运行时 LLM 补充

async function callLLM(text: string, targetLang: string): Promise<string> {
  // ① 查术语表
  const glossaryTerm = glossary.terms[text];
  if (glossaryTerm?.[targetLang]) {
    return glossaryTerm[targetLang];
  }

  // ② 构造 prompt（带术语表）
  const relevantGlossary = extractRelevantTerms(text, glossary.terms);
  const prompt = runTimePrompt(text, targetLang, relevantGlossary);

  // ③ 调 LLM
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      targetLang,
      systemPrompt: SYSTEM_PROMPT,
      glossary: relevantGlossary,
    }),
  });

  if (!res.ok) throw new Error(`Translation API ${res.status}`);
  const data = await res.json();
  return data.translations[0] || text;
}
```

**后端 API 也需要改造**，接收 `systemPrompt` 和 `glossary` 参数：

```ts
// src/core/ws-handler.ts — /api/translate 改造
eb.addRoute('POST', '/api/translate', async (req, res) => {
  const { texts, targetLang, systemPrompt, glossary } = body;

  // 使用传入的 systemPrompt，而非硬编码
  const prompt = systemPrompt || defaultPrompt;

  // 如果有 glossary，在 prompt 中附加术语约束
  const glossaryStr = glossary
    ? `\nGlossary (must follow): ${formatGlossary(glossary)}`
    : '';

  // ... 翻译逻辑
});
```

### 7.5 翻译文件结构

每个语言的翻译文件包含元数据，方便追踪质量：

```json
// frontend/src/i18n/locales/en.json
{
  "_meta": {
    "generatedAt": "2026-05-09T10:00:00Z",
    "version": 3,
    "totalKeys": 367,
    "llmTranslated": 340,
    "humanEdited": 27,
    "needsReview": 5
  },
  "出错了": "Something went wrong",
  "🔄 刷新重试": "🔄 Retry",
  "亲密度": "Intimacy",
  "{{count}} 候选": "{{count}} candidates",
  "_review": {
    "有点累了": {
      "translated": "A bit tired",
      "note": "反向校验未通过，需人工确认"
    }
  }
}
```

### 7.6 质量检查命令

```bash
# 检查翻译覆盖率
npm run i18n:check

# 检查术语一致性
npm run i18n:glossary-check

# 查看需要人工复查的条目
npm run i18n:review

# 导出翻译报告
npm run i18n:report
```

输出示例：

```
📊 i18n 质量报告
─────────────────────────────
总 key 数:        367
已翻译:           362 (98.6%)
术语表命中:       45 (12.3%)
LLM 翻译:         317 (87.7%)
人工编辑:         27 (7.4%)
待复查:           5 (1.4%)
─────────────────────────────
待复查条目:
  ⚠️ 有点累了 → "A bit tired" (反向校验未通过)
  ⚠️ 混沌 → "Chaos" (术语冲突：应为 Chaos)
  ...
```

---

## 八、源码清理策略

### 现有 t() 处理

V2 已有 368 处 `t()` 调用，分两种处理：

| 类型 | 数量 | 处理方式 |
|------|------|---------|
| `t('纯中文')` | 368 | 脚本去掉 `t()` 包裹，恢复为中文原文 |
| `t('中文 {{var}}', { var: x })` | 24 | 转为模板字面量 `` `中文 ${x}` `` |

### 清理脚本

```ts
// scripts/i18n-cleanup.ts
// 自动把 t('中文') 替换回中文原文
// 自动把 t('中文 {{var}}', { var: expr }) 替换为 `中文 ${expr}`
// 自动移除 import { useTranslation } 和 const { t } = useTranslation()
```

### 清理后代码效果

```tsx
// Before (V2)
import { useTranslation } from '../i18n/useTranslation';
const { t } = useTranslation();
<StatCard label={t('亲密度')} value={`${intimacy}/100`} />
<StatCard label={t('对话')} value={`${count} ${t('条')}`} sub={`${t('连续')} ${days} ${t('天')}`} />

// After (V3) — 干净，零 i18n 代码
<StatCard label="亲密度" value={`${intimacy}/100`} />
<StatCard label="对话" value={`${count} 条`} sub={`连续 ${days} 天`} />
```

---

## 九、实施计划

### Phase 1：Vite 插件开发（3-4h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 创建插件骨架 | `frontend/src/plugins/vite-plugin-i18n.ts` | AST 解析 + 中文检测 |
| 实现 JSX 文本节点提取 | 同上 | `<div>中文</div>` → `<div>{t('中文')}</div>` |
| 实现属性值提取 | 同上 | `placeholder="中文"` → `placeholder={t('中文')}` |
| 实现模板字面量处理 | 同上 | `` `中文 ${n}` `` → `` {t('中文') + ' ' + n} `` |
| 实现自动 import 注入 | 同上 | 检测到中文时自动添加 `import { t } from '../i18n'` |
| dry-run 模式 | 同上 | 输出转换预览，不实际修改 |
| 集成到 vite.config.ts | `frontend/vite.config.ts` | 注册插件 |

### Phase 2：翻译引擎改造（1-2h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 新建 t.ts | `frontend/src/i18n/t.ts` | 独立 t 函数，供插件注入使用 |
| 改造 translate-engine.ts | 同上 | 加入静态文件查找层 + 术语表优先 |
| 改造 index.ts | 同上 | 启动时加载静态翻译文件 + 术语表 |
| 创建 locales 目录 | `frontend/src/i18n/locales/` | 存放预翻译 JSON |

### Phase 3：术语表 + 翻译质量基建（1-2h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 创建术语表 | `frontend/src/i18n/glossary.json` | 关键术语固定翻译 |
| 创建 prompt 模板 | `frontend/src/i18n/translate-prompt.ts` | 构建时/运行时共享 |
| 改造后端翻译 API | `src/core/ws-handler.ts` | 接收 systemPrompt + glossary 参数 |
| 创建质量检查脚本 | `scripts/i18n-check.ts` | 覆盖率 + 术语一致性 + 待复查 |

### Phase 4：翻译同步脚本（2-3h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 创建扫描脚本 | `scripts/i18n-sync.ts` | AST 扫描 + 提取中文 key |
| 实现 LLM 批量翻译 | 同上 | 带术语表 + prompt 模板 + 反向校验 |
| 实现 JSON 写入 | 同上 | 合并写入各语言翻译文件 + 元数据 |
| manifest 生成 | 同上 | 输出 key 清单、统计、待复查列表 |
| CI 集成 | `.github/workflows/i18n.yml` | --check 模式检查覆盖率 + 术语一致性 |

### Phase 5：源码清理（1-2h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 创建清理脚本 | `scripts/i18n-cleanup.ts` | 自动去除 t() 包裹 |
| 运行清理 | `frontend/src/components/*.tsx` | 368 处 t() → 中文原文 |
| 移除 useTranslation 导入 | 同上 | 不再需要手动导入 hook |
| 验证构建 | `npm run build` | 确认插件正确处理所有中文 |
| 验证运行时 | 手动测试 | 切语言确认翻译正常 |

### Phase 6：E2E 测试更新（1h）

| 任务 | 文件 | 说明 |
|------|------|------|
| 更新 i18n E2E 测试 | `e2e/i18n.spec.ts` | 适配新架构 |
| 新增构建产物测试 | 同上 | 验证翻译文件正确打包 |
| 新增降级测试 | 同上 | 验证 LLM 不可用时不崩溃 |
| 新增术语一致性测试 | 同上 | 验证关键术语翻译一致 |

### 执行顺序

```
Phase 1（插件） → Phase 2（引擎） → Phase 3（质量基建） → Phase 4（脚本） → Phase 5（清理） → Phase 6（测试）
     ↓                ↓                   ↓                   ↓                ↓                ↓
   Vite 插件       翻译引擎改造         术语表+prompt        同步脚本          源码清理          E2E 测试
   3-4h            1-2h                1-2h               2-3h             1-2h             1h
```

**总预估：9-14h**

---

## 十、验收标准

### 功能验收

- [ ] 开发者直接写中文，构建时自动转换
- [ ] `npm run build` 成功，翻译文件正确打包
- [ ] 切换语言时，全部 UI 文本自动翻译（7 种语言）
- [ ] 翻译结果来自静态 JSON，首次切换零延迟
- [ ] 新增中文 key 由构建时脚本翻译，生产环境不触发 LLM
- [ ] LLM 不可用时降级显示中文原文，不崩溃

### 代码质量验收

- [ ] 源码中无手动 `t()` 包裹（除插件生成的）
- [ ] 源码中无 `useTranslation` hook 导入（除特殊情况）
- [ ] `grep -rn "useTranslation" frontend/src/components/` 输出为空
- [ ] 所有前端测试通过
- [ ] E2E 语言切换测试通过

### 翻译质量验收

- [ ] 术语表关键术语 100% 一致
- [ ] 反向校验未通过的条目已人工复查
- [ ] 翻译文件 `_meta` 中 `needsReview` 为 0
- [ ] `npm run i18n:glossary-check` 通过
- [ ] `npm run i18n:review` 无待复查条目

### 开发体验验收

- [ ] dev 模式下可选择禁用插件（调试用）
- [ ] dry-run 模式可预览转换结果
- [ ] `npm run i18n:sync` 一键同步翻译
- [ ] CI 自动检查翻译覆盖率

---

## 十一、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 插件误转换非 UI 文本 | 中 | 代码被破坏 | AST 精确解析 + 保守策略 + dry-run |
| 模板字面量处理不正确 | 中 | 运行时错误 | 边界 case 测试 + 保持原样兜底 |
| 对象字面量中文遗漏 | 低 | 翻译不全 | 白名单机制 + 脚本补充扫描 |
| 静态翻译文件体积过大 | 低 | 包体积增长 | 按语言 code split + 动态 import |
| 构建时 LLM API 不可用 | 低 | 新 key 无翻译 | 缓存 + 术语表兜底 + CI 重试 |
| 生产环境触发 LLM 安全网 | 极低 | 额外延迟 | 有预翻译文件时不会触发 |

---

## 十二、与 V2 的对比

| 维度 | V2（现状） | V3（新方案） |
|------|-----------|-------------|
| 开发者写法 | `t('中文')` 手动包裹 | 直接写中文 |
| 遗漏风险 | 高（55 处已遗漏） | 零（自动提取） |
| 代码可读性 | 差（括号噪音） | 好（纯中文） |
| 翻译延迟 | 首次切换有延迟 | 预翻译零延迟 |
| 翻译质量 | LLM 盲翻，不稳定 | 术语表 + 上下文 prompt + 反向校验，构建时把关 |
| 术语一致性 | 无保障 | 术语表强制约束 |
| 质量追踪 | 无 | manifest 记录翻译来源 + 待复查标记 |
| 运行时 LLM | 主力翻译，每次切换触发 | 安全网，正常不触发，零开销 |
| 生产环境保障 | 依赖 LLM 可用性 | 预翻译兜底，LLM 不可用也不影响 |
| 维护成本 | 低 | 低（脚本自动） |
| 存量改造 | 368 处已完成 | 需清理 t() 包裹 |
| 扩展新语言 | 零成本 | 零成本（脚本生成） |
