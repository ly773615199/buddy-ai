# LLM 旧路径剥离方案

> 基于全量代码审计，梳理 `config.llm`（旧）vs `config.models`（新）的每一条引用路径，定位冲突点，制定分阶段清除方案。

---

## 一、现状总览

项目中存在 **三套 LLM 配置路径**，互相交织：

| 路径 | 状态 | 引用数 | 说明 |
|------|------|--------|------|
| `config.llm` | `@deprecated`，但**必填** | 48 处 | 旧版单模型配置，类型上不是 optional |
| `config.models` | 新版，optional | 25 处 | 统一模型池，providers 缺少 `model` 字段 |
| `config.pool` | `@deprecated`，optional | 13 处 | 旧版多模型池节点配置 |

**核心矛盾**：`config.llm` 标记了 deprecated，但类型定义为必填字段，且 DEFAULT_CONFIG 中有默认值。运行时大量代码仍在读它。

---

## 二、逐文件引用清单

### 2.1 `config.llm` 直接引用（48 处）

#### `src/config.ts`（16 处）— 配置加载/迁移/验证

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 45 | `config.llm.apiKey && config.llm.provider` | 环境变量填充主 LLM | 🔴 迁移后应删 |
| 46 | `PROVIDER_ENV_KEYS[config.llm.provider]` | 环境变量映射 | 🔴 同上 |
| 48 | `config.llm.apiKey = process.env[envKey]` | 写入 apiKey | 🔴 同上 |
| 95 | `!config.models && config.llm.provider` | 迁移触发条件 | 🟡 保留作为兼容入口 |
| 150-152 | `llm: override.llm ? {...} : base.llm` | mergeConfig 合并 | 🔴 迁移后应删 |
| 204 | `config.llm.model?.trim()` | 验证 | 🔴 应改为验证 models |
| 207-208 | `config.llm.apiKey` | apiKey 格式验证 | 🔴 同上 |
| 214-216 | `config.llm.baseUrl` | baseUrl 格式验证 | 🔴 同上 |
| 278-283 | `config.llm.provider/model/apiKey/baseUrl` | 迁移到 providers | 🟡 迁移函数本身 |
| 288-295 | `config.llm.lightweight.*` | 轻量模型迁移 | 🟡 同上 |

#### `src/core/llm.ts`（8 处）— LLM 适配层

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 32 | 注释 `优先使用 config.models，fallback 到 config.llm` | 文档 | 无 |
| 62 | 注释 | 文档 | 无 |
| 64 | `'llm' in config && config.llm` | 构造函数判断传入类型 | 🔴 应改为只接受 BuddyConfig |
| 102 | 注释 | 文档 | 无 |
| 116-117 | `return config.llm` | resolveLLMConfig fallback | 🔴 **致命：model 丢失** |
| 36 | `private config: BuddyConfig['llm']` | 内部 config 类型 | 🟡 改为独立 LLMConfig 类型 |
| 104 | `resolveLLMConfig(config): BuddyConfig['llm']` | 返回类型 | 🟡 同上 |
| 143 | `updateProvider(config: BuddyConfig['llm'])` | 参数类型 | 🟡 同上 |

#### `src/core/ws-handler.ts`（12 处）— WebSocket 处理

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 94 | `estimateMaxLimit(config.llm.provider)` | 初始化 RPM 上限 | 🔴 应从 models 读 |
| 476 | `estimateMaxLimit(this.config.llm.provider)` | 动态 RPM 调整 | 🔴 同上 |
| 1107 | 注释 `同步写入 config.llm` | 文档 | 无 |
| 1120 | `this.config.llm = {...this.config.llm, ...newLlmConfig}` | 热更新写入旧路径 | 🔴 应删 |
| 1138-1144 | 清理 lightweight/fallbacks | 旧字段清理 | 🔴 应删整个块 |
| 1431 | 注释 | 文档 | 无 |
| 1481 | `this.config.llm = {...}` | handleLLMConfig 写入 | 🔴 应删 |
| 1502-1508 | 清理 lightweight/fallbacks | 旧字段清理 | 🔴 应删整个块 |

#### `src/core/subsystems.ts`（1 处）

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 162 | `llm: {...config.llm, provider: 'mock', ...}` | MockLLM 替换 | 🔴 应改为替换 models |

#### `src/core/message-processor.ts`（1 处）

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 341 | `windows[this.config.llm.provider]` | token 窗口估算 | 🔴 应从 models 读 |

#### `src/main.ts`（2 处）

| 行 | 代码 | 用途 | 风险 |
|----|------|------|------|
| 290 | `status.config.llm.provider/model` | 状态显示 | 🔴 应从 models 读 |
| 361 | `config.llm.provider/model` | 启动日志 | 🔴 同上 |

#### `src/brain/shadow/`（3 处）— ⚠️ 不同的 `config.llm`

| 文件 | 行 | 代码 | 说明 |
|------|-----|------|------|
| `index.ts` | 72 | `config.llm` | `ShadowBrainConfig.llm`，类型为 `{call: (prompt) => Promise<string>}` |
| `phase10/prompt-evolver.ts` | 229, 247 | `this.config.llm` | `PromptEvolverConfig.llm`，同上 |
| `phase10/tool-inventor.ts` | 108 | `this.config.llm` | `ToolInventorConfig.llm`，同上 |

**注意**：这 3 处的 `config.llm` **不是** `BuddyConfig.llm`！它们是各自接口中的 `llm` 字段，类型为 `{call: (prompt: string) => Promise<string>}`（LLMCaller），已经是干净的抽象。**不需要改。**

---

### 2.2 `config.models` 引用（25 处）

| 文件 | 行 | 用途 |
|------|-----|------|
| `config.ts` | 52-53 | 环境变量填充 providers |
| `config.ts` | 95 | 迁移判断 |
| `config.ts` | 273 | 迁移跳过判断 |
| `llm.ts` | 106 | resolveLLMConfig 读 providers[0] |
| `llm.ts` | 117 | fallback 到 config.llm |
| `subsystems.ts` | 187-205 | 初始化统一模型池 |
| `agent.ts` | 1149, 1344, 1409, 1445 | executeWithConcreteNode 读 providers 凭据 |
| `ws-handler.ts` | 582-584 | 状态广播 |
| `ws-handler.ts` | 1094, 1121, 1164, 1176 | providers 热更新 |
| `ws-handler.ts` | 1458, 1460, 1482 | handleLLMConfig 双写 |
| `model-router.ts` | 263 | 错误提示 |

### 2.3 `config.pool` 引用（13 处）

| 文件 | 行 | 用途 |
|------|-----|------|
| `config.ts` | 238-242 | 验证 pool.nodes |
| `config.ts` | 266, 301-302, 330 | 迁移函数 |
| `subsystems.ts` | 177-183 | 旧版 ModelPool 初始化 |
| `main.ts` | 313, 319, 1062 | 状态显示 |

---

## 三、致命冲突点（导致 LLM 连接失败）

### 冲突 1：`resolveLLMConfig()` 丢失模型名

```
migrateToUnifiedConfig():
  providers.push({ id: 'deepseek', type: 'deepseek', apiKey, baseUrl })
  → 没有 model 字段！

resolveLLMConfig():
  model = first.id  → 'deepseek'（provider 名，不是模型名！）

ProviderFactory.create({ provider: 'deepseek', model: 'deepseek' })
  → 用 provider 名当模型名连接 → 失败或调错模型
```

### 冲突 2：热更新双写不一致

```
前端发 { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-xxx' }
  ↓
handleLLMConfig():
  config.llm = { provider: 'deepseek', model: 'deepseek-chat', ... }  ✅
  config.models.providers[] = { id: 'deepseek', type: 'deepseek', ... }  ❌ 缺 model
  ↓
reconfigureLLM(config.llm)  → 当前会话 OK
  ↓
下次启动 → loadConfig() → resolveLLMConfig() → model = providers[0].id → 失败
```

### 冲突 3：POST /api/model-pool/providers 用 type 占位

```
ws-handler.ts:1100:
  model: type,  // 'deepseek' 作为 model 名！
```

### 冲突 4：`DEFAULT_CONFIG.llm` 存在导致迁移永远触发

```
loadConfig():
  mergeConfig(DEFAULT_CONFIG, saved)
  → config.llm 永远有值（来自 DEFAULT_CONFIG）
  → !config.models && config.llm.provider → 总是 true
  → 每次启动都跑迁移
```

---

## 四、清理方案（6 阶段）

### Phase 1：类型层 — providers 加 model 字段

**文件：`src/types.ts`**

```diff
 providers: Array<{
   id: string;
   type: 'siliconflow' | 'openrouter' | 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
+  model: string;  // 默认模型名
   apiKey?: string;
   baseUrl?: string;
   costPer1kInput?: number;
   costPer1kOutput?: number;
 }>;
```

新增独立 LLMConfig 类型：

```typescript
/** 独立的 LLM 连接配置（不依赖 BuddyConfig） */
export interface LLMConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
}
```

`BuddyConfig.llm` 改为 optional：

```diff
-  llm: {
+  /** @deprecated 已迁移，运行时不应读取 */
+  llm?: {
```

---

### Phase 2：配置层 — 修复迁移 + 验证

**文件：`src/config.ts`**

#### 2.1 `migrateToUnifiedConfig()` 补 model

```diff
  providers.push({
    id: config.llm.provider,
    type: mapProviderType(config.llm.provider),
+   model: config.llm.model,
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
  });
  // lightweight 同理
  providers.push({
    id: lwId,
    type: mapProviderType(config.llm.lightweight.provider),
+   model: config.llm.lightweight.model,
    ...
  });
```

迁移后清空 llm：

```diff
  return {
    ...config,
+   llm: undefined,
    models: { providers, preferences, strategy },
  };
```

#### 2.2 `fillApiKeyFromEnv()` 只走 models

```diff
  function fillApiKeyFromEnv(config: BuddyConfig): void {
-   if (!config.llm.apiKey && config.llm.provider) { ... }
    if (config.models?.providers) { ... }
  }
```

#### 2.3 `validateConfig()` 改为验证 models

```diff
- if (!config.llm.model?.trim()) errors.push('llm.model 不能为空');
+ if (!config.models?.providers?.length) {
+   errors.push('models.providers 不能为空');
+ } else {
+   for (const p of config.models.providers) {
+     if (!p.model?.trim()) errors.push(`provider ${p.id}: model 不能为空`);
+     ...
+   }
+ }
```

#### 2.4 `mergeConfig()` 去掉 llm 合并

```diff
  return {
    ...
-   llm: override.llm ? { ...base.llm, ...override.llm } : base.llm,
    models: ...,
    ...
  };
```

#### 2.5 `loadConfig()` 迁移条件修正

```diff
- if (!config.models && config.llm.provider) {
+ if (!config.models && config.llm?.provider) {
    config = migrateToUnifiedConfig(config);
    await saveConfig(config);
  }
```

---

### Phase 3：核心层 — LLMAdapter 单一入口

**文件：`src/core/llm.ts`**

#### 3.1 `resolveLLMConfig()` 修复 + 去掉 fallback

```diff
  private static resolveLLMConfig(config: BuddyConfig): LLMConfig {
    const providers = config.models?.providers;
    if (providers && providers.length > 0) {
      const first = providers[0];
      return {
        provider: first.type,
-       model: first.id,
+       model: first.model,
        apiKey: first.apiKey,
        baseUrl: first.baseUrl,
      };
    }
-   return config.llm;
+   throw new Error('未配置任何 LLM provider，请在 config.models.providers 中添加');
  }
```

#### 3.2 构造函数简化

```diff
- constructor(config: BuddyConfig | BuddyConfig['llm'], dataDir?: string) {
-   const llmConfig = ('llm' in config && config.llm)
-     ? LLMAdapter.resolveLLMConfig(config as BuddyConfig)
-     : (config as BuddyConfig['llm']);
+ constructor(config: BuddyConfig, dataDir?: string) {
+   const llmConfig = LLMAdapter.resolveLLMConfig(config);
```

#### 3.3 内部 config 类型改为 LLMConfig

```diff
- private config: BuddyConfig['llm'];
+ private config: LLMConfig;
```

#### 3.4 `updateProvider()` 签名

```diff
- updateProvider(config: BuddyConfig['llm']): void {
+ updateProvider(config: LLMConfig): void {
```

**文件：`src/core/model-router.ts`**

#### 3.5 构造函数去掉无用参数

```diff
- constructor(_config?: BuddyConfig['llm'], dataDir?: string) {
+ constructor(dataDir?: string) {
```

---

### Phase 4：通信层 — ws-handler 单写

**文件：`src/core/ws-handler.ts`**

#### 4.1 `handleLLMConfig()` 只写 models

```diff
  async handleLLMConfig(msg): Promise<void> {
    ...
    const syncedProvider = {
      id: provider,
      type: mapProviderType(provider),
+     model,  // ← 保留模型名
      apiKey, baseUrl,
    };
    ...
    await patchConfig({
-     llm: newLlmConfig,
      models: { providers: currentProviders },
    });
-   this.config.llm = { ...this.config.llm, ...newLlmConfig };
    this.config.models = { ...this.config.models, providers: currentProviders };
    this.sys.reconfigureLLM(newLlmConfig);
    ...
-   // 删除 lightweight/fallbacks 清理块
  }
```

#### 4.2 POST /api/model-pool/providers 同理

```diff
  const newLlmConfig = {
    provider: type,
-   model: type,
+   model: body.model ?? type,
    apiKey, baseUrl,
  };
  const newProvider = { id, type, model: newLlmConfig.model, apiKey, baseUrl, ... };
  await patchConfig({
-   llm: newLlmConfig,
    models: { providers: updatedProviders },
  });
- this.config.llm = { ...this.config.llm, ...newLlmConfig };
  this.config.models = { ...this.config.models, providers: updatedProviders };
```

#### 4.3 `estimateMaxLimit` 调用改为从 models 读

```diff
- maxLimit: estimateMaxLimit(config.llm.provider),
+ const primaryType = config.models?.providers?.[0]?.type ?? 'openai';
+ maxLimit: estimateMaxLimit(primaryType),
```

#### 4.4 `handleTestLLM()` 构造 LLMAdapter 改用新格式

```diff
  const testAdapter = new LLMAdapter({
-   llm: { provider, model, apiKey, baseUrl },
- } as any);
+   models: { providers: [{ id: provider, type: provider, model, apiKey, baseUrl }] },
+ } as BuddyConfig);
```

#### 4.5 `reconfigureLLM()` 签名

```diff
- reconfigureLLM(config: BuddyConfig['llm']): void {
+ reconfigureLLM(config: LLMConfig): void {
```

---

### Phase 5：展示层 — 消费者切到新路径

**文件：`src/main.ts`**

```diff
- console.log(`  模型: ${status.config.llm.provider}/${status.config.llm.model}`);
+ const primary = status.config.models?.providers?.[0];
+ console.log(`  模型: ${primary?.type}/${primary?.model ?? '未配置'}`);
```

**文件：`src/core/message-processor.ts`**

```diff
- return windows[this.config.llm.provider] ?? 32000;
+ const primaryType = this.config.models?.providers?.[0]?.type;
+ return windows[primaryType ?? ''] ?? 32000;
```

**文件：`src/core/subsystems.ts` — MockLLM**

```diff
  if (process.env.BUDDY_MOCK_LLM === '1') {
    config = {
      ...config,
-     llm: { ...config.llm, provider: 'mock', apiKey: 'mock-key', model: 'mock-model' },
+     models: {
+       providers: [{ id: 'mock', type: 'custom', model: 'mock-model', apiKey: 'mock-key' }],
+     },
    };
  }
```

---

### Phase 6：清理层 — 删除旧路径

#### 6.1 `src/types.ts`

- 删除 `BuddyConfig.llm` 字段（或改为 `llm?: never` 强制禁止）
- 删除 `BuddyConfig.pool` 字段
- 删除 `DEFAULT_CONFIG.llm`
- 删除 `ModelPoolConfig` 接口（如不再需要）

#### 6.2 `src/config.ts`

- 删除 `migrateToUnifiedConfig()` 函数（迁移逻辑内联到 loadConfig 一次性处理）
- 删除 `PROVIDER_ENV_KEYS` 对 llm 的引用

#### 6.3 全局验证

```bash
# 期望 0 结果（shadow brain 的 config.llm 不算，那是不同接口）
grep -rn "config\.llm\b" src/ --include="*.ts" | grep -v "\.test\." | grep -v "__tests__" | grep -v "shadow/"

# 期望 0 结果
grep -rn "BuddyConfig\['llm'\]" src/ --include="*.ts" | grep -v "\.test\."

# 期望 0 结果
grep -rn "config\.pool\b" src/ --include="*.ts" | grep -v "\.test\."
```

---

## 五、前端影响

### 5.1 `Settings.tsx` — 无影响

前端通过 `sendLLMConfig({ provider, model, apiKey, baseUrl })` 发送 WS 消息，后端 `handleLLMConfig` 接收。前端不直接读写 `config.llm`。

### 5.2 `Onboarding.tsx` — 需要补 model 字段

```diff
  body: JSON.stringify({
    id: selectedProvider.id,
    type: selectedProvider.id,
+   model: model.trim(),
    apiKey: apiKey.trim() || undefined,
    baseUrl: baseUrl.trim() || undefined,
  })
```

### 5.3 `useWebSocket.ts` — 无影响

WS 消息格式不变，`llm_config` / `test_llm` 类型不变。

---

## 六、Shadow Brain 不需要改

`src/brain/shadow/` 中的 `config.llm` 是 **不同的接口**：

```typescript
// shadow/types.ts
export interface ShadowBrainConfig {
  llm: { call: (prompt: string) => Promise<string> };  // LLMCaller，不是 BuddyConfig.llm
  ...
}

// shadow/evolution-engine.ts
interface LLMCaller {
  call(prompt: string): Promise<string>;
}
```

这是通过 `LLMCallService` 注入的干净抽象，与 `BuddyConfig.llm` 无关。**不需要改。**

---

## 七、风险评估

| 风险 | 影响 | 对策 |
|------|------|------|
| 旧用户 config.json 无 model 字段 | 迁移时 providers[0].model 为空 | loadConfig 中做一次性补丁：从旧 llm.model 补入 |
| 前端发 llm_config 消息格式不变 | 无影响 | handleLLMConfig 内部转写 models.providers |
| `LLMAdapter` 构造函数签名变了 | subsystems.ts 和 main.ts 需要改 | 全局搜 `new LLMAdapter`，只有 3 处 |
| pool 字段删了 | subsystems.ts 的 pool 初始化分支要删 | 统一走 config.models |
| `tsc --noEmit` 类型错误 | 每阶段都可能引入 | 每阶段完成后验证 |

---

## 八、验证清单

- [ ] `tsc --noEmit` 零错误
- [ ] `grep -rn "config\.llm\b" src/ --include="*.ts" | grep -v shadow | grep -v test` → 0 结果
- [ ] `grep -rn "BuddyConfig\['llm'\]" src/` → 0 结果
- [ ] 删除 `~/.buddy/config.json` → 冷启动 → 自动生成新格式 → 正常
- [ ] 旧格式 config.json（只有 llm，没有 models）→ 自动迁移 → 正常
- [ ] 前端修改 LLM 配置 → 热重载 → 连接成功
- [ ] `buddy status` 显示正确模型信息
- [ ] `buddy status` 无 config.llm 报错
- [ ] Shadow brain 进化功能正常（不受影响）
