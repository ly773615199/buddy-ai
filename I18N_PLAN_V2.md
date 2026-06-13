# i18n 方案 v2：LLM 运行时自动翻译

> 修订时间：2026-05-08
> 核心变更：废弃手动维护翻译 JSON，改用 LLM 按需翻译 + 缓存

---

## 一、背景与动机

### 旧方案问题
- 维护 zh-CN.json / en.json 两份翻译文件，开发负担重
- 151 个硬编码中文字符串，仅 21% 在翻译文件中有对应
- 每次新增功能都要同步维护翻译 key，容易遗漏
- 支持新语言 = 维护新文件，扩展成本线性增长

### 新方案优势
- 开发者直接写中文，零额外负担
- LLM 按需翻译，支持任意语言
- 翻译缓存后零开销
- 利用项目已有的 LLM 能力，无需额外基建

---

## 二、架构设计

### 翻译流程

```
组件调用 t('中文原文')
    ↓
i18next 查询
    ↓
[当前语言 = zh-CN] → 直接返回原文
    ↓
[当前语言 ≠ zh-CN] → 查 localStorage 缓存
    ↓
[缓存命中] → 返回缓存翻译
    ↓
[缓存未命中] → 调 LLM 翻译 → 存缓存 → 返回翻译
```

### 技术栈

| 组件 | 保留/变更 |
|------|-----------|
| i18next | ✅ 保留（框架层） |
| react-i18next | ✅ 保留（React 绑定） |
| zh-CN.json | ❌ 删除 |
| en.json | ❌ 删除 |
| 自定义 backend | ✅ 新增（LLM + 缓存） |

---

## 三、实施计划

### Phase 1：翻译引擎（1-2h）

**新建 `frontend/src/i18n/translate-engine.ts`**

```ts
// 核心能力：调 LLM 翻译 + localStorage 缓存

interface TranslateOptions {
  text: string;        // 中文原文
  targetLang: string;  // 目标语言代码
  context?: string;    // 可选：UI 上下文（帮助 LLM 理解语境）
}

// 缓存层
const CACHE_KEY = 'buddy_i18n_cache';
const cache: Record<string, string> = JSON.parse(
  localStorage.getItem(CACHE_KEY) || '{}'
);

function getCacheKey(text: string, lang: string): string {
  return `${lang}::${text}`;
}

function saveCache(): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// LLM 翻译（调后端 API）
async function callLLM(text: string, targetLang: string): Promise<string> {
  const langNames: Record<string, string> = {
    en: 'English', ja: '日本語', ko: '한국어',
    fr: 'Français', de: 'Deutsch', es: 'Español',
  };
  const langName = langNames[targetLang] || targetLang;

  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      targetLang: langName,
      // 规则：保持简短，适合UI，不要意译
    }),
  });

  if (!res.ok) throw new Error(`Translation failed: ${res.status}`);
  const data = await res.json();
  return data.translated;
}

// 主函数
export async function translate(text: string, targetLang: string): Promise<string> {
  // 中文目标 → 直接返回
  if (targetLang === 'zh-CN' || targetLang === 'zh') return text;

  // 查缓存
  const key = getCacheKey(text, targetLang);
  if (cache[key]) return cache[key];

  // 调 LLM
  try {
    const translated = await callLLM(text, targetLang);
    cache[key] = translated;
    saveCache();
    return translated;
  } catch (err) {
    console.warn('[i18n] Translation failed, falling back to original:', err);
    return text; // 降级：返回原文
  }
}

// 批量翻译（初始化时用）
export async function translateBatch(
  texts: string[], targetLang: string
): Promise<void> {
  const uncached = texts.filter(t => !cache[getCacheKey(t, targetLang)]);
  if (uncached.length === 0) return;

  // 一次性翻译所有未缓存的文本
  try {
    const res = await fetch('/api/translate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: uncached, targetLang }),
    });
    if (!res.ok) return;
    const data = await res.json();
    for (let i = 0; i < uncached.length; i++) {
      const key = getCacheKey(uncached[i], targetLang);
      cache[key] = data.translations[i] || uncached[i];
    }
    saveCache();
  } catch (err) {
    console.warn('[i18n] Batch translation failed:', err);
  }
}

// 清除缓存（调试用）
export function clearTranslationCache(): void {
  localStorage.removeItem(CACHE_KEY);
}
```

### Phase 2：i18next 集成（30min）

**改写 `frontend/src/i18n/index.ts`**

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translate } from './translate-engine';

// 自定义 backend：用 LLM 翻译替代读 JSON
const LLMBackend = {
  type: 'backend' as const,
  read(language: string, namespace: string, callback: Function) {
    // 不从文件读取，翻译在 interpolate 阶段处理
    callback(null, {});
  },
  save() {},
  create() {},
};

i18n
  .use(LLMBackend)
  .use(initReactI18next)
  .init({
    resources: {},
    lng: localStorage.getItem('buddy_lang') || 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
      // 核心：在插值阶段拦截，调 LLM 翻译
      defaultSeparator: '',
    },
  });

// 重写翻译函数：中文原文作为 key，翻译在运行时完成
const originalT = i18n.t.bind(i18n);
i18n.t = function(key: string, opts?: any): string {
  const result = originalT(key, opts);
  // 如果 key 就是中文原文且当前语言不是中文，异步翻译
  if (i18n.language !== 'zh-CN' && /[\u4e00-\u9fff]/.test(key)) {
    // 同步返回原文，异步更新翻译（下次渲染生效）
    translate(key, i18n.language).then(translated => {
      if (translated !== result) {
        // 触发重渲染
        i18n.emit('languageChanged', i18n.language);
      }
    });
    // 从缓存取翻译（如果有）
    const cached = getCachedTranslation(key, i18n.language);
    return cached || result;
  }
  return result;
} as typeof i18n.t;

export function changeLanguage(lang: string): void {
  i18n.changeLanguage(lang);
  localStorage.setItem('buddy_lang', lang);
}

export default i18n;
```

### Phase 3：后端翻译 API（1h）

**新建 `src/api/translate.ts`（或在现有路由中添加）**

```ts
// POST /api/translate
// { text: string, targetLang: string }
// → { translated: string }

// POST /api/translate/batch
// { texts: string[], targetLang: string }
// → { translations: string[] }

// 使用已配置的 LLM provider（轻量模型即可）
// 翻译是简单任务，用最便宜的模型
```

### Phase 4：组件完整迁移（2-3h，一次性）

**所有组件的硬编码中文必须用 `t()` 包裹，不做渐进式。**

不包 `t()` 的文本切语言时不会被翻译，等于没做。必须一次改完。

#### 迁移步骤（16 个文件，151 个字符串）

1. 组件顶部加 `import { useTranslation } from 'react-i18next'`
2. 函数体内加 `const { t } = useTranslation()`
3. 所有中文字符串用 `t()` 包裹

```tsx
// Before
<div>⚔️ 攻击</div>
<input placeholder="输入消息..." />
<span>有点累了</span>

// After
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
<div>{t('⚔️ 攻击')}</div>
<input placeholder={t('输入消息...')} />
<span>{t('有点累了')}</span>
```

#### 待迁移文件清单

| 文件 | 中文字符串数 | 优先级 |
|------|------------|--------|
| SpriteRenderer.tsx | 12 | P0 |
| PetStats.tsx | 29 | P0 |
| CognitiveDashboard.tsx | 26 | P0 |
| Experts.tsx | 19 | P1 |
| Onboarding.tsx | 20 | P1 |
| InputBar.tsx | 13 | P1 |
| VisionPanel.tsx | 10 | P1 |
| ChatPanel.tsx | 6 | P2 |
| KnowledgePanel.tsx | 4 | P2 |
| DiagnosticCard.tsx | 7 | P2 |
| SensorPanel.tsx | 2 | P2 |
| MessageBubble.tsx | 2 | P2 |
| ExplorationMap.tsx | - | P2 |
| BuddyCanvas.tsx | - | P2 |
| ErrorBoundary.tsx | 1 | P3 |
| ToolCallCard.tsx | - | P3 |

### Phase 5：语言切换 UI

在 Settings 的外观 tab 保留语言选择器，选项扩展为：
- 🇨🇳 中文（默认）
- 🇺🇸 English
- 🇯🇵 日本語
- 🇰🇷 한국어
- ...（按需添加）

切换时触发 `changeLanguage()`，自动翻译所有可见文本。

---

## 四、关键设计决策

### 1. 翻译粒度：短文本 vs 长文本

| 类型 | 策略 |
|------|------|
| 短文本（<50字） | 逐条翻译，缓存 |
| 长文本（>50字） | 批量翻译，避免多次 API 调用 |

### 2. 翻译时机

| 时机 | 说明 |
|------|------|
| 首次切换语言 | 批量翻译当前页面所有可见文本 |
| 组件挂载时 | 逐条翻译（命中缓存则零开销） |
| 新文本出现时 | 逐条翻译（如新消息、新通知） |

### 3. 降级策略

```
LLM 翻译失败 → 返回中文原文（可读，不崩溃）
网络断开 → 读缓存（已翻译的可用，未翻译的显示中文）
```

### 4. 缓存失效

- 手动清除：设置页面加"清除翻译缓存"按钮
- 自动过期：不设过期（UI 文本变化慢，手动清除够用）
- 版本号：代码版本变更时可选择性清除

---

## 五、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `frontend/src/i18n/translate-engine.ts` | 翻译引擎（LLM + 缓存） |
| 改写 | `frontend/src/i18n/index.ts` | 接入翻译引擎 |
| 新建 | `src/api/translate.ts` | 后端翻译 API |
| 删除 | `frontend/src/i18n/zh-CN.json` | 不再需要 |
| 删除 | `frontend/src/i18n/en.json` | 不再需要 |
| 改写 | `I18N_PLAN.md` | 更新为新方案 |
| 完整改 | `frontend/src/components/*.tsx` (16个) | 硬编码中文 → t() 包裹 |
| 完整改 | `frontend/src/App.tsx` | 清理残留硬编码中文 |

---

## 六、验收标准

- [ ] 所有组件硬编码中文已用 `t()` 包裹（grep 无遗漏）
- [ ] 切换语言时，全部 UI 文本自动翻译
- [ ] 翻译结果缓存到 localStorage，刷新后无需重新翻译
- [ ] LLM 不可用时降级显示中文原文，不崩溃
- [ ] 新增组件直接写中文 + `t()` 包裹，无需维护翻译文件
- [ ] 支持扩展到任意语言，无需新增文件
