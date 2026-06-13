# i18n V2 落地补齐计划

> 生成时间：2026-05-08
> 基于：I18N_PLAN_V2.md 实现审计结果
> 目标：消除全部验收阻断项，达到方案 100% 对齐

---

## 当前状态

- ✅ 翻译引擎 `translate-engine.ts` — 完成
- ✅ i18next 集成 `index.ts` + `useTranslation.ts` — 完成
- ✅ 后端翻译 API `/api/translate` — 完成
- ⚠️ 组件迁移 — **79 处 UI 文本未包裹 t()**
- ⚠️ 语言切换 UI — **只有 zh-CN/en，缺少 ja/ko/fr/de/es**
- ❌ 翻译 JSON 文件未删除
- ❌ translate-engine 无单元测试

---

## Phase A：组件 t() 补全（79 处，约 2h）

按文件优先级排序，每文件列出具体行号和修复方式。

### A1. ActivityPanel.tsx（14 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L115 | `label: '感知'` | `label: t('感知')` |
| L193 | `title={... \`${day.messages} 消息, ${day.toolCalls} 工具\`}` | `title={t('{n} 消息, {m} 工具', { n: day.messages, m: day.toolCalls })}` |
| L257 | `label: '总消息'` | `label: t('总消息')` |
| L258 | `label: '工具调用'` | `label: t('工具调用')` |
| L259 | `label: '活跃天数'` | `label: t('活跃天数')` |
| L260 | `label: '连续天数'` | `label: t('连续天数')` |
| L261 | `label: '预估 Tokens'` | `label: t('预估 Tokens')` |
| L607 | `label: '网络'` + `'在线'`/`'离线'` | `label: t('网络')` + `t('在线')`/`t('离线')` |
| L608 | `label: '语言'` | `label: t('语言')` |
| L609 | `label: '平台'` | `label: t('平台')` |
| L610 | `label: 'CPU 核心'` + `'未知'` | `label: t('CPU 核心')` + `t('未知')` |
| L611 | `label: '内存'` + `'未知'` | `label: t('内存')` + `t('未知')` |
| L612 | `label: '屏幕'` | `label: t('屏幕')` |
| L613 | `label: '时区'` | `label: t('时区')` |

### A2. PetStats.tsx（12 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L161 | `label="亲密度"` | `label={t('亲密度')}` |
| L164 | `label="心情"` | `label={t('心情')}` |
| L166 | `精力 ${...}` | `t('精力 {n}', { n: ... })` |
| L169 | `label="对话"` + `条` / `连续...天` | 全部包裹 t() |
| L441 | `({cell.activity} 次活动)` / `(无活动)` | `t('{n} 次活动', { n: ... })` / `t('无活动')` |
| L485-491 | `'混沌'`~`'传说'` 7 级标签 + desc | 每个 label/desc 包裹 t() |

### A3. Settings.tsx（12 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L137 | `label: '硅基流动'` | `label: t('硅基流动')` |
| L140 | `label: 'Ollama (本地)'` | `label: t('Ollama (本地)')` |
| L141 | `label: '自定义'` | `label: t('自定义')` |
| L604 | `label: '任务匹配'` | `label: t('任务匹配')` |
| L605 | `label: '成本优先'` | `label: t('成本优先')` |
| L606 | `label: '质量优先'` | `label: t('质量优先')` |
| L656 | `title={... '点击取消激活' : '点击激活'}` | `title={... t('点击取消激活') : t('点击激活')}` |
| L928-929 | 语言选项只渲染 zh-CN/en | **见 Phase B** |
| L959 | `label: '监听频道 ID...'` | `label: t('监听频道 ID...')` |
| L967 | `label: 'Webhook 端口'` | `label: t('Webhook 端口')` |
| L977 | `label: 'EncodingAESKey'` | 保留（专有名词） |
| L986 | `label: 'EncodingAESKey'` | 保留（专有名词） |

### A4. CognitiveDashboard.tsx（11 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L185-189 | 5 个 tab label `'📚 领域知识'` 等 | 每个包裹 t() |
| L286 | `label="当前车道"` | `label={t('当前车道')}` |
| L291 | `label="排队等待"` | `label={t('排队等待')}` |
| L296 | `label="模式"` | `label={t('模式')}` |
| L353-355 | `label="模型总数"` 等 3 个 | 包裹 t() |

### A5. VisionPanel.tsx（7 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L77 | `setError(\`摄像头启动失败: ...\`)` | `setError(t('摄像头启动失败') + ': ' + ...)` |
| L121 | `setError(\`OCR 失败: ...\`)` | `setError(t('OCR 失败') + ': ' + ...)` |
| L136 | `场景: ${...}` | `t('场景') + ': ' + ...` |
| L138 | `物体: ${...}` | `t('物体') + ': ' + ...` |
| L140 | `物体数: ${...}` | `t('物体数') + ': ' + ...` |
| L141 | `文字: ${...}` | `t('文字') + ': ' + ...` |
| L146 | `setError(\`场景分析失败: ...\`)` | `setError(t('场景分析失败') + ': ' + ...)` |

### A6. Experts.tsx（6 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L79 | `setError('无法加载专家列表...')` | `setError(t('无法加载专家列表，请确认后端已启动'))` |
| L119 | `message: \`安装失败: ${err.message}\`` | `message: t('安装失败') + ': ' + err.message` |
| L217-220 | `'全部'`/`'已安装'`/`'可安装'`/`'已启用'` | 每个包裹 t() |

### A7. SpriteRenderer.tsx（5 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L1414 | `desc: \`进化进度 ${progress}%\`` | `desc: t('进化进度') + ' ' + progress + '%'` |
| L1415 | `desc: '当前情绪'` | `desc: t('当前情绪')` |
| L1416 | `desc: '亲密度'` | `desc: t('亲密度')` |
| L1417 | `desc: '稀有度'` | `desc: t('稀有度')` |
| L1418 | `desc: '最近行为'` | `desc: t('最近行为')` |

### A8. KnowledgePanel.tsx（4 处）

L172-175：`'知识条目'`/`'学习文件'`/`'领域'`/`'STMP 节点'` → 包裹 t()

### A9. ChatPanel.tsx（3 处）

| 行号 | 原文 | 修复 |
|------|------|------|
| L148 | `'▲ 收起详情'` / `▼ 展开 ${n} 条中间事件` | t() 包裹 |
| L312 | `desc="试试：帮我列一下当前目录的文件"` | `desc={t('试试：帮我列一下当前目录的文件')}` |
| L319 | `desc={\`搜索 "${searchQuery}" 无结果\`}` | `desc={t('搜索无结果')}` |

### A10. Onboarding.tsx（3 处）

L53/63/73：`'硅基流动'`/`'Ollama (本地)'`/`'自定义'` → 与 Settings 共用翻译 key

### A11. InputBar.tsx（2 处）

L303/331：`'停止录音'`/`'语音输入'` → 包裹 t()

---

## Phase B：语言切换 UI 扩展（30min）

**文件：** `frontend/src/components/Settings.tsx`

**现状：** L928-929 硬编码 `[zh-CN, en]` 两个按钮
**目标：** 从 `SUPPORTED_LANGUAGES` 动态渲染

```tsx
// 替换 L925-936
import { SUPPORTED_LANGUAGES } from '../i18n/index';

// ...
<div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
  {t('语言')}
</div>
<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
  {SUPPORTED_LANGUAGES.map(lang => (
    <button
      key={lang.code}
      style={optionBtnStyle(language === lang.code)}
      onClick={() => onLanguageChange?.(lang.code)}
    >
      {lang.flag} {lang.label}
    </button>
  ))}
</div>
```

---

## Phase C：清理遗留翻译文件（10min）

**删除：**
- `frontend/src/i18n/zh-CN.json`
- `frontend/src/i18n/en.json`

**前置检查：**
```bash
grep -r "zh-CN.json\|en.json\|from.*i18n/zh\|from.*i18n/en" frontend/src/ --include="*.ts" --include="*.tsx"
```
确认无引用后删除。

---

## Phase D：translate-engine 单元测试（1h）

**新建文件：** `frontend/src/__tests__/translate-engine.test.ts`

| 测试用例 | 覆盖点 |
|---------|--------|
| 中文目标直接返回原文 | `isChineseLang` 分支 |
| 非中文 + 缓存命中 → 同步返回 | `translateSync` 路径 |
| 非中文 + 缓存未命中 → 异步翻译 | `translate` + fetch 调用 |
| 翻译失败 → 降级返回原文 | try/catch 降级 |
| 50ms 内多个请求合并为一次 API 调用 | batch debounce |
| localStorage 缓存持久化 | `persistCache` / 加载 |
| `clearTranslationCache()` 清空缓存 | 缓存清除 |
| `warmup()` 批量预热 | 批量翻译 + 缓存写入 |
| 非中文文本（无汉字）直接返回 | `hasChinese` 过滤 |

---

## Phase E：E2E 测试补全（1.5h）

### E1. 英文 UI 完整验证（扩展 app.spec.ts）

```ts
test('语言切换 → 英文 UI 全面验证', async ({ page }) => {
  await skipOnboarding(page);
  await page.locator('button', { hasText: '⚙️' }).first().click();
  await page.locator('button', { hasText: '🎨' }).first().click();
  await page.locator('button', { hasText: 'English' }).click();

  // 验证各 Tab 英文渲染
  await expect(page.getByRole('button', { name: /Chat/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Activity/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Settings/ })).toBeVisible();

  // 验证设置面板英文
  await expect(page.getByText('Appearance')).toBeVisible();
});
```

### E2. 多语言切换 E2E（新文件 `e2e/i18n.spec.ts`）

| 测试 | 说明 |
|------|------|
| 日语切换 + 假名渲染验证 | 切 ja → 验证 tab 文本变化 |
| 语言偏好持久化 | 切 en → 刷新 → 仍为 en |
| 翻译缓存生效 | 切 en → 刷新 → 无额外 API 调用 |
| 降级：翻译 API 不可用 | mock 404 → 显示中文原文不崩溃 |

### E3. 英文视觉回归基线（扩展 visual-regression.spec.ts）

```ts
test('主界面 — 英文基线', async ({ page }) => {
  await setupMockWS(page);
  await skipOnboarding(page);
  // 切英文
  await page.locator('button', { hasText: '⚙️' }).first().click();
  await page.locator('button', { hasText: '🎨' }).first().click();
  await page.locator('button', { hasText: 'English' }).click();
  await page.waitForTimeout(500);
  await stableScreenshot(page, 'main-connected-en.png');
});
```

---

## 执行顺序 & 预估

| 阶段 | 任务 | 预估时间 | 依赖 |
|------|------|---------|------|
| A | 组件 t() 补全（79 处） | 2h | 无 |
| B | 语言切换 UI 扩展 | 30min | 无 |
| C | 删除遗留翻译文件 | 10min | A 完成后 |
| D | translate-engine 单测 | 1h | 无 |
| E | E2E 测试补全 | 1.5h | A+B 完成后 |
| **合计** | | **~5h** | |

---

## 验收标准（完成后自查）

- [ ] `grep -rn '[\u4e00-\u9fff]' frontend/src/components/ --include="*.tsx" | grep -v t( | grep -v '//' | grep -v 'import'` 输出为空（除注释和专有名词）
- [ ] Settings 语言选择器显示 7 种语言
- [ ] `zh-CN.json` / `en.json` 已删除
- [ ] `npm run test:frontend` 通过（含 translate-engine 测试）
- [ ] E2E 语言切换测试通过（至少 en/zh 双向）
- [ ] 英文视觉回归截图基线已生成
