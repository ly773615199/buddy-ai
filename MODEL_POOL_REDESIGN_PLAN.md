# 模型池重构方案：全类型支持 + 激活管理

> 日期：2026-05-07
> 状态：待实施
> 优先级：P0
> 最后更新：单列表 + 高亮/灰色方案

---

## 一、问题现状

### 1.1 模型被过滤

当前 `model-classifier.ts` 的 `shouldIncludeInPool()` 硬编码只允许 chat 类型：

```typescript
// src/core/model-classifier.ts:122
export function shouldIncludeInPool(category: ModelCategory): boolean {
  return ['chat', 'vl-chat', 'omni-chat'].includes(category);
}
```

**后果**：API 返回 102 个模型，实际进入模型池仅 71 个，31 个非 chat 模型被丢弃：

| 类型 | 被丢弃数 | 代表模型 |
|------|---------|---------|
| text-to-image | 5 | Z-Image-Turbo, Qwen-Image, Kolors |
| image-to-image | 2 | Qwen-Image-Edit, Qwen-Image-Edit-2509 |
| text-to-video | 1 | Wan2.2-T2V-A14B |
| image-to-video | 1 | Wan2.2-I2V-A14B |
| text-to-speech | 3 | CosyVoice2, MOSS-TTSD, TeleSpeechASR |
| audio-to-text | 1 | SenseVoiceSmall |
| embedding | 4 | bge-m3, bce-embedding 等 |
| reranker | 5 | bge-reranker 系列 |
| translation | 1 | Hunyuan-MT-7B |
| 其他 | 8 | omni-chat, feature-extraction 等 |

### 1.2 模型重复

同名模型存在多个 provider 变体（普通版 + Pro 版 + LoRA 版），全部展示造成混乱：

| 基座名 | 变体数 | 变体 |
|--------|--------|------|
| Qwen2.5-7B-Instruct | 3 | 原版 / Pro / LoRA |
| DeepSeek-V3 | 2 | 原版 / Pro |
| DeepSeek-R1 | 2 | 原版 / Pro |
| Kimi-K2-Thinking | 2 | 原版 / Pro |
| MiniMax-M2.5 | 2 | 原版 / Pro |

共 13 组重复，去重后可减少 ~14 个条目。

### 1.3 用户无控制力

当前所有发现的模型自动进入池、自动参与调度，用户无法：
- 手动关闭不想用的模型
- 临时激活某个备用模型
- 区分"常用"和"备用"

---

## 二、设计方案

### 2.1 核心概念：激活常驻 + 待激活折叠

激活模型始终展示，待激活模型默认折叠收起，避免大量灰色模型霸占视野：

```
┌──────────────────────────────────────────────────────┐
│  🏊 模型池（88）  已激活 12                            │
│                                                       │
│  ✅ DeepSeek-V3       [标准]  ¥0.001/k    5次        │
│  ✅ Qwen3-VL-8B       [免费]  👁️ 视觉     0次        │
│  ✅ Qwen-Image        [标准]  🎨 图片生成  0次        │
│  ✅ CosyVoice2        [标准]  🔊 语音合成  0次        │
│  ...（共 12 个激活模型）                               │
│                                                       │
│  ▶ 待激活（76）──────────────────────── [全部激活]     │
│                                                       │
│  （点击展开后显示）                                     │
│  🔍 搜索模型...                                       │
│  ┌─ siliconflow ─────────────────────────────────┐   │
│  │ ⬜ Qwen2.5-72B       [高级]  ¥0.05/k   0次   │   │
│  │ ⬜ DeepSeek-R1       [高级]  推理      0次   │   │
│  │ ⬜ ...                              [批量激活] │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─ deepseek ────────────────────────────────────┐   │
│  │ ⬜ ...                                         │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**设计原则**：
- **激活区**：始终展开，高亮完整信息，按 tier 权重排序（premium → free）
- **待激活区**：默认折叠，点击 `▶ 待激活（76）` 展开，有搜索框 + 按平台分组折叠
- **视觉区分**：激活模型高亮彩色，待激活模型灰色半透明
- **操作**：点 toggle 原地变色，激活区模型变灰滑入折叠区（badge 数字 +1），反之亦然
- **批量操作**：折叠区有「全部激活」按钮 + 按平台「批量激活」

### 2.2 数据模型变更

#### ModelProfile 新增字段

```typescript
// src/core/model-pool.ts
export interface ModelProfile {
  // ... 现有字段全部保留

  /** 是否激活（参与调度）。默认 true，用户可随时 toggle */
  active: boolean;

  /** 模型分类（从可选改为必填） */
  category: ModelCategory;

  /** 同基座变体数（去重后，被折叠的变体数） */
  variantCount?: number;

  /** 被折叠的变体 ID 列表（用户可展开查看） */
  variantIds?: string[];
}
```

#### 去重规则

```typescript
interface DedupeGroup {
  baseName: string;       // 规范化后的模型名
  category: ModelCategory;
  variants: ModelProfile[];
  winner: ModelProfile;   // 择优选出的代表
}

// 去重逻辑
function dedupeModels(profiles: ModelProfile[]): ModelProfile[] {
  const groups = new Map<string, DedupeGroup>();

  for (const p of profiles) {
    const key = `${normalizeBaseName(p.displayName)}:${p.category}`;
    if (!groups.has(key)) {
      groups.set(key, { baseName: p.displayName, category: p.category, variants: [], winner: p });
    }
    const g = groups.get(key)!;
    g.variants.push(p);
    // 择优：有定价 > 无定价 → cost 低 > cost 高 → params 大 > params 小
    if (isBetter(p, g.winner)) g.winner = p;
  }

  return Array.from(groups.values()).map(g => ({
    ...g.winner,
    active: true,
    variantCount: g.variants.length,
    variantIds: g.variants.filter(v => v.id !== g.winner.id).map(v => v.id),
  }));
}
```

#### 择优排序规则

```typescript
function isBetter(a: ModelProfile, b: ModelProfile): boolean {
  // 1. 有定价 > 无定价（定价信息完整优先）
  const aHasPricing = a.costPer1kInput > 0;
  const bHasPricing = b.costPer1kInput > 0;
  if (aHasPricing !== bHasPricing) return aHasPricing;

  // 2. cost 低 > cost 高
  if (aHasPricing && bHasPricing) {
    if (a.costPer1kInput !== b.costPer1kInput) return a.costPer1kInput < b.costPer1kInput;
  }

  // 3. 参数量大 > 参数量小
  const aParams = a.parameters ?? 0;
  const bParams = b.parameters ?? 0;
  return aParams > bParams;
}
```

### 2.3 后端改动

#### 文件 1：`src/core/model-classifier.ts`

**改动**：放开 `shouldIncludeInPool`，所有已知类型都保留。

```typescript
// 改前
export function shouldIncludeInPool(category: ModelCategory): boolean {
  return ['chat', 'vl-chat', 'omni-chat'].includes(category);
}

// 改后
const EXCLUDED_CATEGORIES: ModelCategory[] = ['unknown', 'other'];

export function shouldIncludeInPool(category: ModelCategory): boolean {
  return !EXCLUDED_CATEGORIES.includes(category);
}
```

**影响范围**：`model-discovery.ts` 中 3 处调用 `shouldIncludeInPool`，无需改动，自动生效。

#### 文件 2：`src/core/model-pool.ts`

**改动 A**：`ModelProfile` 接口增加 `active`、`category`、`variantCount`、`variantIds` 字段。

**改动 B**：新增 `toggleActive(id)` 方法。

```typescript
toggleActive(id: string): boolean {
  const profile = this.profiles.get(id);
  if (!profile) return false;
  profile.active = !profile.active;
  this.saveUnifiedState();
  return profile.active;
}

setActive(id: string, active: boolean): boolean {
  const profile = this.profiles.get(id);
  if (!profile) return false;
  profile.active = active;
  this.saveUnifiedState();
  return active;
}
```

**改动 C**：`layer0StaticFilter` 增加 active 过滤。

```typescript
private layer0StaticFilter(): ModelProfile[] {
  const result: ModelProfile[] = [];
  for (const profile of this.profiles.values()) {
    if (!profile.active) continue;          // 新增
    if (this.isExcluded(profile.id)) continue;
    if (!profile.capabilities.streaming) continue;
    if (profile.costPer1kInput > this.preferences.maxCostPer1k * 2) continue;
    result.push(profile);
  }
  return result;
}
```

**改动 D**：`addProfiles` / `registerModels` 增加去重逻辑。

```typescript
// 在批量注册后执行去重
dedupeAndOptimize(): void {
  const all = Array.from(this.profiles.values());
  const groups = new Map<string, ModelProfile[]>();

  for (const p of all) {
    const key = `${normalizeBaseName(p.displayName)}:${p.category ?? 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  for (const [, variants] of groups) {
    if (variants.length <= 1) continue;

    // 择优选 winner
    variants.sort((a, b) => compareModelPriority(a, b));
    const winner = variants[0];

    // winner 激活，其余待激活
    winner.active = true;
    winner.variantCount = variants.length;
    winner.variantIds = variants.slice(1).map(v => v.id);

    for (let i = 1; i < variants.length; i++) {
      variants[i].active = false;
    }
  }
}
```

**改动 E**：`getAllProfiles()` 返回时附带 `active` 字段。

#### 文件 3：`src/core/model-discovery.ts`

**改动**：在 `discoverModels` 返回前，调用去重逻辑。

```typescript
// 在 models 数组构建完成后
const deduped = dedupeModels(models);
// deduped 中择优模型 active=true，其余变体 active=false
```

#### 文件 4：`src/core/ws-handler.ts`

**改动 A**：`GET /api/model-pool` 响应增加 `active`、`category`、`variantCount` 字段。

```typescript
json(res, 200, {
  initialized: true,
  modelCount: profiles.length,
  activeCount: profiles.filter(p => p.active).length,
  models: profiles.map(p => ({
    id: p.id,
    platform: p.platform,
    displayName: p.displayName,
    tier: p.tier,
    category: p.category ?? 'unknown',     // 新增
    active: p.active ?? true,              // 新增
    variantCount: p.variantCount ?? 1,     // 新增
    capabilities: p.capabilities,
    maxContextTokens: p.maxContextTokens,
    costPer1kInput: p.costPer1kInput,
    costPer1kOutput: p.costPer1kOutput,
    stats: p.stats,
    source: p.source,
  })),
  preferences,
  thompsonParams,
});
```

**改动 B**：新增 `PATCH /api/model-pool/toggle` 接口。

```typescript
// PATCH /api/model-pool/toggle — 激活/取消激活模型
eb.addRoute('PATCH', '/api/model-pool/toggle', async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const body = JSON.parse(await readBody(req));
    const unifiedPool = this.sys.llm.getUnifiedPool();
    if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }

    const { id, active } = body;
    if (typeof id !== 'string') { json(res, 400, { error: '缺少 id' }); return; }

    const result = unifiedPool.setActive(id, active ?? true);
    if (!result) { json(res, 404, { error: '模型不存在' }); return; }

    const profile = unifiedPool.getProfile(id);
    this.eventBus?.emit({
      type: 'bubble',
      text: active !== false ? `✅ 已激活: ${profile?.displayName}` : `⏸️ 已取消: ${profile?.displayName}`,
    });

    json(res, 200, { ok: true, active: result });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});
```

**改动 C**：新增 `POST /api/model-pool/batch-toggle` 接口（批量操作）。

```typescript
// POST /api/model-pool/batch-toggle — 批量激活/取消
eb.addRoute('POST', '/api/model-pool/batch-toggle', async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const body = JSON.parse(await readBody(req));
    const unifiedPool = this.sys.llm.getUnifiedPool();
    if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }

    const { ids, active } = body;
    if (!Array.isArray(ids)) { json(res, 400, { error: '缺少 ids 数组' }); return; }

    let changed = 0;
    for (const id of ids) {
      if (unifiedPool.setActive(id, active ?? true)) changed++;
    }

    json(res, 200, { ok: true, changed });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});
```

**改动 D**：新增 `POST /api/model-pool/batch-toggle-by-platform` 接口（按平台批量操作）。

```typescript
// POST /api/model-pool/batch-toggle-by-platform — 按平台批量激活/取消
eb.addRoute('POST', '/api/model-pool/batch-toggle-by-platform', async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const body = JSON.parse(await readBody(req));
    const unifiedPool = this.sys.llm.getUnifiedPool();
    if (!unifiedPool) { json(res, 400, { error: '统一模型池未初始化' }); return; }

    const { platform, active } = body;
    if (typeof platform !== 'string') { json(res, 400, { error: '缺少 platform' }); return; }

    let changed = 0;
    for (const profile of unifiedPool.getAllProfiles()) {
      if (profile.platform === platform && unifiedPool.setActive(profile.id, active ?? true)) {
        changed++;
      }
    }

    this.eventBus?.emit({
      type: 'bubble',
      text: active !== false ? `✅ 已激活 ${platform} 全部 ${changed} 个模型` : `⏸️ 已取消 ${platform} 全部 ${changed} 个模型`,
    });

    json(res, 200, { ok: true, changed });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});
```

### 2.4 前端改动

#### 文件：`frontend/src/components/Settings.tsx`

**改动 A**：类型定义增加新字段。

```typescript
interface ModelPoolModel {
  id: string;
  platform: string;
  displayName: string;
  tier: string;
  category?: string;        // 新增
  active?: boolean;          // 新增
  variantCount?: number;     // 新增
  capabilities: Record<string, unknown>;
  maxContextTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  stats: { totalCalls: number; successes: number; avgLatencyMs: number };
  source: string;
}
```

**改动 B**：指标概览增加激活数。

```tsx
<div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
  <div style={{ fontSize: 18, fontWeight: 600, color: '#7ee787' }}>
    {pool?.activeCount ?? pool?.models?.filter(m => m.active !== false).length ?? 0}
  </div>
  <div style={{ fontSize: 10, color: '#888' }}>已激活</div>
</div>
```

**改动 C**：模型列表改为「激活常驻 + 待激活折叠」布局。

```tsx
const [inactiveExpanded, setInactiveExpanded] = useState(false);
const [inactiveSearch, setInactiveSearch] = useState('');

// 激活区：始终展开，按 tier 排序
const activeModels = pool.models
  .filter(m => m.active !== false)
  .sort((a, b) => (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9));

// 待激活区：按平台分组
const inactiveModels = pool.models.filter(m => m.active === false);
const inactiveByPlatform = groupBy(inactiveModels, m => m.platform);
const filteredInactive = inactiveSearch
  ? inactiveModels.filter(m => m.displayName.toLowerCase().includes(inactiveSearch.toLowerCase()))
  : inactiveModels;

const activeCount = activeModels.length;
const inactiveCount = inactiveModels.length;

return (
  <div>
    {/* 指标概览 */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      <MetricCard value={pool.modelCount} label="模型总数" color="#a371f7" />
      <MetricCard value={activeCount} label="已激活" color="#7ee787" />
      <MetricCard value={strategy} label="策略" color="#7ee787" />
    </div>

    {/* 调度策略 */}
    {/* ... 保持不变 ... */}

    {/* ── 激活区（常驻展示） ── */}
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#7ee787' }}>🏊 模型池（{pool.modelCount}）  已激活 {activeCount}</span>
        <button style={btnStyle()} onClick={() => { setLoading(true); fetchPool(); }}>🔄 刷新</button>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 6, border: '1px solid #30363d' }}>
        {activeModels.map(m => (
          <ModelRow key={m.id} model={m} onToggle={() => toggleModel(m.id, false)} />
        ))}
        {activeModels.length === 0 && (
          <div style={{ padding: 12, textAlign: 'center', color: '#666', fontSize: 11 }}>暂无激活模型</div>
        )}
      </div>
    </div>

    {/* ── 待激活区（折叠） ── */}
    <div>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 8px', background: '#161b22', borderRadius: 6,
          cursor: 'pointer', marginBottom: inactiveExpanded ? 6 : 0,
        }}
        onClick={() => setInactiveExpanded(!inactiveExpanded)}
      >
        <span style={{ fontSize: 11, color: '#8b949e' }}>
          {inactiveExpanded ? '▼' : '▶'} 待激活（{inactiveCount}）
        </span>
        <button
          style={{ ...btnStyle('#238636'), fontSize: 10, padding: '2px 8px' }}
          onClick={(e) => { e.stopPropagation(); batchActivateAll(); }}
        >
          全部激活
        </button>
      </div>

      {inactiveExpanded && (
        <div style={{ borderRadius: 6, border: '1px solid #21262d', overflow: 'hidden' }}>
          {/* 搜索框 */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>
            <input
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: 11 }}
              placeholder="🔍 搜索模型..."
              value={inactiveSearch}
              onChange={e => setInactiveSearch(e.target.value)}
            />
          </div>

          {/* 按平台分组展示 */}
          {inactiveSearch ? (
            // 搜索模式：平铺结果
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filteredInactive.map(m => (
                <ModelRow key={m.id} model={m} onToggle={() => toggleModel(m.id, true)} />
              ))}
              {filteredInactive.length === 0 && (
                <div style={{ padding: 12, textAlign: 'center', color: '#666', fontSize: 11 }}>无匹配</div>
              )}
            </div>
          ) : (
            // 分组模式：按平台折叠
            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {Object.entries(inactiveByPlatform).map(([platform, models]) => (
                <PlatformGroup
                  key={platform}
                  platform={platform}
                  models={models}
                  onToggle={(id) => toggleModel(id, true)}
                  onBatchActivate={() => batchActivateByPlatform(platform)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);
```

**PlatformGroup 组件**（待激活区按平台分组折叠）：

```tsx
function PlatformGroup({ platform, models, onToggle, onBatchActivate }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 8px', background: '#0d1117', cursor: 'pointer',
          borderBottom: '1px solid #21262d', fontSize: 11, color: '#8b949e',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? '▼' : '▶'} {platform}（{models.length}）</span>
        <button
          style={{ ...btnStyle('#238636'), fontSize: 9, padding: '1px 6px' }}
          onClick={(e) => { e.stopPropagation(); onBatchActivate(); }}
        >
          批量激活
        </button>
      </div>
      {expanded && models.map(m => (
        <ModelRow key={m.id} model={m} onToggle={() => onToggle(m.id)} />
      ))}
    </div>
  );
}
```

**改动 D**：ModelRow 组件，激活高亮 / 待激活灰色，toggle 原地变色。

```tsx
function ModelRow({ model, onToggle }: { model: ModelPoolModel; onToggle: () => void }) {
  const isActive = model.active !== false;
  const successRate = model.stats.totalCalls > 0
    ? ((model.stats.successes / model.stats.totalCalls) * 100).toFixed(0)
    : '-';

  const categoryIcon: Record<string, string> = {
    'chat': '💬', 'vl-chat': '👁️', 'omni-chat': '🌐',
    'image-gen': '🎨', 'image-edit': '🖼️', 'video-gen': '🎬',
    'tts': '🔊', 'asr': '🎤', 'embedding': '📐', 'reranker': '📊',
    'translation': '🌐', 'ocr': '👁️',
  };

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 8px', borderBottom: '1px solid #21262d', fontSize: 11,
      opacity: isActive ? 1 : 0.5,                    // 灰色半透明
      background: isActive ? 'transparent' : '#0d11170a',
    }}>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
        onClick={onToggle}
        title={isActive ? '点击取消激活' : '点击激活'}
      >
        {isActive ? '✅' : '⬜'}
      </button>
      <span style={{
        color: isActive ? '#c9d1d9' : '#6e7681',      // 高亮 vs 灰色
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {model.displayName}
      </span>
      <span style={{ color: '#888', marginLeft: 4 }}>[{model.tier}]</span>
      {model.category && model.category !== 'chat' && (
        <span style={{ marginLeft: 4 }}>{categoryIcon[model.category] ?? '📦'}</span>
      )}
      {model.variantCount && model.variantCount > 1 && (
        <span style={{ color: '#8b949e', marginLeft: 4 }}>({model.variantCount}个变体)</span>
      )}
      <span style={{ color: isActive && model.stats.totalCalls > 0 ? '#7ee787' : '#555', marginLeft: 6 }}>
        {successRate}%
      </span>
      <span style={{ color: '#888', marginLeft: 6 }}>{model.stats.totalCalls}次</span>
      {model.costPer1kInput > 0 && <span style={{ color: '#d29922', marginLeft: 6 }}>¥{model.costPer1kInput}/k</span>}
    </div>
  );
}
```

**改动 E**：toggle API 调用。

```typescript
const toggleModel = async (id: string, active: boolean) => {
  await authFetch(`${apiBase}/api/model-pool/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, active }),
  });
  fetchPool();
};
```

---

## 三、API 变更汇总

### 3.1 GET /api/model-pool

**响应新增字段**：

```json
{
  "initialized": true,
  "modelCount": 88,
  "activeCount": 45,           // 新增
  "models": [
    {
      "id": "siliconflow/deepseek-ai/DeepSeek-V3",
      "displayName": "DeepSeek-V3",
      "tier": "standard",
      "category": "chat",       // 新增
      "active": true,           // 新增
      "variantCount": 2,        // 新增
      "capabilities": { ... },
      "stats": { ... }
    }
  ]
}
```

### 3.2 PATCH /api/model-pool/toggle（新增）

```
请求：
{ "id": "siliconflow/deepseek-ai/DeepSeek-V3", "active": false }

响应：
{ "ok": true, "active": false }
```

### 3.3 POST /api/model-pool/batch-toggle（新增）

```
请求：
{ "ids": ["id1", "id2", "id3"], "active": true }

响应：
{ "ok": true, "changed": 3 }
```

### 3.4 POST /api/model-pool/batch-toggle-by-platform（新增）

```
请求：
{ "platform": "siliconflow", "active": true }

响应：
{ "ok": true, "changed": 45 }
```

---

## 四、调度逻辑影响

### 4.1 不受影响的部分

- `layer1MetadataFilter`（元数据快筛）— 不变
- `layer2ThompsonSelect`（Thompson Sampling）— 不变
- `selectExcluding`（Cascade Routing）— 不变
- `recordFeedback`（反馈记录）— 不变

### 4.2 唯一改动：layer0StaticFilter

```diff
  private layer0StaticFilter(): ModelProfile[] {
    const result: ModelProfile[] = [];
    for (const profile of this.profiles.values()) {
+     if (!profile.active) continue;
      if (this.isExcluded(profile.id)) continue;
      if (!profile.capabilities.streaming) continue;
      if (profile.costPer1kInput > this.preferences.maxCostPer1k * 2) continue;
      result.push(profile);
    }
    return result;
  }
```

### 4.3 非 chat 模型的调度兼容性

当前 Thompson Sampling 依赖 `stats.byTaskType` 做学习。非 chat 模型（如 image-gen）没有这个统计，但不会出错：
- 新模型 `totalCalls=0` → Thompson Sampling 使用先验分布（均匀）
- 首次调用后自动积累统计数据
- 后续可为不同 category 配置不同的调度策略（本次不改，留扩展点）

---

## 五、迁移兼容性

### 5.1 数据兼容

- `active` 字段默认 `true`，旧数据无需迁移
- `category` 字段已有（可选），改为必填后对旧数据用 `'unknown'` 兜底
- `variantCount`/`variantIds` 为可选字段，旧数据无此字段不影响功能

### 5.2 API 兼容

- `GET /api/model-pool` 响应只增加字段，不删除/修改现有字段
- `PATCH /api/model-pool/toggle` 和 `POST /api/model-pool/batch-toggle` 为新增端点
- 前端向后兼容：`active` 字段缺失时默认 `true`

---

## 六、实施步骤

| 步骤 | 文件 | 改动 | 预估 |
|------|------|------|------|
| 1 | `model-classifier.ts` | 放开 `shouldIncludeInPool` | 5 行 |
| 2 | `model-pool.ts` | ModelProfile 加字段 + `toggleActive`/`setActive` + `dedupeAndOptimize` + layer0 过滤 | ~80 行 |
| 3 | `model-discovery.ts` | 发现后调用去重 | ~15 行 |
| 4 | `ws-handler.ts` | 响应加字段 + 新增 toggle/batch-toggle 端点 | ~50 行 |
| 5 | `Settings.tsx` | 两区展示 + toggle 按钮 + category 标签 + 指标更新 | ~120 行 |

**总改动量**：~270 行，涉及 5 个文件。

---

## 七、验证计划

### 7.1 单元测试

- `model-classifier.test.ts`：验证所有 category 都通过 `shouldIncludeInPool`
- `model-pool.test.ts`：验证 `toggleActive`、`setActive`、`dedupeAndOptimize`
- `model-discovery.test.ts`：验证去重后同名模型只保留 1 个

### 7.2 集成验证

1. 启动后端，检查日志：`发现 X 个模型, 去重后 Y 个, 激活 Z 个`
2. 调用 `GET /api/model-pool`，确认返回 `category`/`active` 字段
3. 调用 `PATCH /api/model-pool/toggle`，确认模型在两区间移动
4. 前端设置页面：确认两区展示、toggle 按钮、category 标签
5. 发送对话消息，确认只从激活区选模型
6. 激活一个 image-gen 模型，确认它出现在池中但不干扰 chat 调度

### 7.3 回归测试

- 现有对话功能不受影响（chat 模型默认全部激活）
- 现有排除列表功能不受影响
- 调度策略切换（任务匹配/成本优先/质量优先）不受影响
