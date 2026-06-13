# 知识源接入 + 影子脑内部集成 计划

## 总览

两个独立模块，互不依赖，可并行开发：

1. **影子脑内部集成修复** — 把已写好的组件接上（小改动）
2. **知识源统一接入** — 新增 adapter 层 + 三脑管控（中等改动）

---

## 模块一：影子脑内部集成修复

### 1.1 MetaLearner → EvolutionEngine 策略闭环

**现状**：`recommendSwitch()` 的结果存到了 `currentStrategyId`，但 `runEvolution()` 生成方案时没用它。

**改动**：
- `ShadowBrainOrchestrator.runEvolution()` 里，调 `evolutionEngine.generateProposals()` 前，把 `currentStrategyId` 对应的策略参数传进去
- `EvolutionEngine.generateProposals()` 新增可选参数 `strategy?: LearningStrategy`
- EvolutionEngine 根据策略的 `samplingMethod` 和 `lrSchedule` 调整方案生成方式

**涉及文件**：
- `src/brain/shadow/index.ts` — 传策略参数
- `src/brain/shadow/evolution-engine.ts` — 接收并使用策略参数

**工作量**：小（~50 行代码）

### 1.2 ToolInventor 接入编排器

**现状**：`ToolInventor` 写好了但 `ShadowBrainOrchestrator` 没有引用它。

**改动**：
- `ShadowBrainOrchestrator` 构造函数新增 `toolInventor?: ToolInventor` 参数
- `runEvolution()` 里，当 `EvolutionEngine` 生成不出方案时（proposals 为空），fallback 到 `ToolInventor.invent(gap, existingToolNames)`
- ToolInventor 的 approved 工具通过 `BrainProvider.addLearnedRule()` 或新的 `addInventedTool()` 合入

**涉及文件**：
- `src/brain/shadow/index.ts` — 新增属性 + fallback 逻辑
- `src/brain/shadow/types.ts` — BrainProvider 可选扩展 `addInventedTool()`

**工作量**：小（~80 行代码）

### 1.3 SelfModifier 修改写回

**现状**：`evaluateComponents()` 返回修改建议，`apply()` 标记 status='applied'，但没有实际修改目标组件的参数。

**改动**：
- SelfModifier 新增 `componentRef` 注册机制：每个 target 组件注册自己的参数 setter
- `apply()` 时调用对应的 setter 写入新值
- `revert()` 时调用 setter 写回旧值

```typescript
// 注册示例
selfModifier.register('evolution_lock', 'gdiThreshold', 
  (val) => evolutionLock.setGDIThreshold(val as number)
);
```

**涉及文件**：
- `src/brain/shadow/phase10/self-modifier.ts` — 新增注册 + 写回机制
- `src/brain/shadow/evolution-lock.ts` — 新增 setGDIThreshold() 等 setter
- `src/brain/shadow/timing-controller.ts` — 新增 setMaxLoad() 等 setter
- `src/brain/shadow/gap-detector.ts` — 新增 setMinFailures() 等 setter
- `src/brain/shadow/index.ts` — 初始化时注册组件

**工作量**：中（~150 行代码，跨 5 个文件）

### 模块一总结

| 子任务 | 改动类型 | 工作量 |
|--------|---------|--------|
| MetaLearner 闭环 | 接线 | 小 |
| ToolInventor 接入 | 接线 + fallback | 小 |
| SelfModifier 写回 | 新增机制 + setter | 中 |

**总工作量**：~280 行代码，不涉及架构变更。

---

## 模块二：知识源统一接入

### 四层知识源

| 层级 | 来源 | 状态 |
|------|------|------|
| **本地** | STMP、MemoryStore、本地文件夹 | ✅ 已有 |
| **对话** | KnowledgeExtractor 从对话中提取 | ✅ 已有 |
| **网络搜索** | 搜索引擎 → 抓取 → 学习 → 记忆 | ❌ 未接入（learnFromUrl 已有基础） |
| **SaaS 知识库** | 飞书 Wiki、Notion、Confluence | ❌ 未接入 |
| **云存储** | 阿里云 OSS、S3、NAS、WebDAV | 后续按需 |

### 2.1 KnowledgeSource 统一接口

**新增文件**：`src/knowledge/source-manager.ts`

```typescript
interface KnowledgeSource {
  id: string;
  type: 'local' | 'web' | 'feishu' | 'cloud';
  
  // 三脑调这些方法
  search(query: string, options?: SearchOptions): Promise<KnowledgeNode[]>;
  read(nodeId: string): Promise<KnowledgeContent>;
  list(parentId?: string): Promise<KnowledgeNode[]>;
  
  // 生命周期
  sync(): Promise<SyncResult>;
  isAvailable(): boolean;
}

class KnowledgeSourceManager {
  private sources: Map<string, KnowledgeSource>;
  
  // 三脑调这个方法：自动选源 + 检索 + 去重 + 排序
  async query(query: string, domain?: string, options?: QueryOptions): Promise<KnowledgeNode[]>;
  
  // 注册/注销源
  register(source: KnowledgeSource): void;
  unregister(id: string): void;
  
  // 全量同步
  async syncAll(): Promise<SyncResult[]>;
}
```

**工作量**：中（~200 行）

### 2.2 LocalSource — 本地文件夹索引

**新增文件**：`src/knowledge/local-source.ts`

**功能**：
- 指定 watchFolders，首次启动扫描建 FTS5 索引
- 支持增量更新（文件 mtime 对比）
- 支持 md / txt / pdf / ts / js 文件类型
- PDF 用已有的 `PDFParser` 提取文本
- 代码文件按函数/类分块

**复用已有模块**：
- `PDFParser`（`src/knowledge/pdf-parser.ts`）
- `MemoryStore` 的 FTS5（`src/memory/store.ts`）
- `BuddyLearn` 的分块逻辑（`src/knowledge/learn.ts`）

**工作量**：中（~250 行）

### 2.3 WebSource — 网络搜索学习

**新增文件**：`src/knowledge/web-source.ts`

**功能**：
- 三脑判定"本地知识没命中，需要外部知识"时触发
- 调搜索 API（DuckDuckGo / Bing / Google）获取结果 URL
- 用已有的 `BuddyLearn.learnFromUrl()` 逐条抓取学习
- 学习结果存入 STMP（来源标记为 'web'）
- 后续相同问题直接查本地命中，不再重复搜索

**搜索 API 选择**：
- DuckDuckGo — 免费、无需 API key，适合起步
- Bing Search API — 需要 key，结果质量更好
- Google Custom Search — 需要 key，最精准

**复用已有模块**：
- `BuddyLearn.learnFromUrl()`（`src/knowledge/learn.ts`）— 抓取 + 分块 + 存储
- STMP 的 MemoryNode 结构

**三脑管控**：
- 右脑判断：是否需要搜索（knowledge_query 类意图 + 本地未命中）
- 左脑规则：搜索频率限制（避免重复搜同一个问题）、结果数量上限
- 小脑：系统负载高时延迟搜索、超时控制

**工作量**：中（~200 行）

### 2.4 FeishuSource — 飞书 Wiki 接入

**新增文件**：`src/knowledge/feishu-source.ts`

**功能**：
- 用飞书 Wiki v2 API 拉取知识空间节点
- 支持增量同步（对比 obj_edit_time）
- 拉取文档内容（通过 obj_token 调 docx API）
- 缓存到本地 STMP，避免重复拉取

**依赖飞书 API**：
- `GET /wiki/v2/spaces` — 列出知识空间
- `GET /wiki/v2/spaces/:space_id/nodes` — 列出子节点
- `GET /wiki/v2/spaces/get_node` — 获取节点信息
- `GET /docx/v1/documents/:document_id/blocks` — 读文档内容

**复用已有模块**：
- `FeishuAdapter` 的 token 管理（`src/social/feishu-adapter.ts`）
- STMP 的 MemoryNode 结构

**前端配置**：飞书应用凭证（appId / appSecret）通过前端设置页面配置，不需要改代码。

**工作量**：中（~300 行）

### 2.5 三脑决策流接入

**改动文件**：
- `src/brain/left/rule-engine.ts` — 新增知识检索规则
- `src/brain/right/features/encoder.ts` — 新增知识查询意图编码
- `src/core/message-processor.ts` — 在处理流程中调 KnowledgeSourceManager.query()

**接入点**：
```
用户消息 → message-processor.ts
  → 右脑 classifyFromText() 判断是否需要查知识
  → 左脑规则匹配决定查哪个源（本地优先 → 飞书 → 网络搜索）
  → KnowledgeSourceManager.query()
  → 结果注入 prompt → 交给 LLM 生成
```

**工作量**：中（~200 行）

### 2.6 配置接入

**改动文件**：`src/config.ts` + `src/types.ts`

新增配置项：
```typescript
knowledge: {
  local: {
    watchFolders: string[];
    fileTypes: string[];
    syncIntervalMs: number;
  };
  web: {
    searchEngine: 'duckduckgo' | 'bing' | 'google';
    apiKey?: string;       // bing/google 需要
    maxResults: number;    // 每次搜索最多几条，默认 5
    cooldownMs: number;    // 同问题搜索冷却，默认 1h
  };
  feishu: {
    appId: string;
    appSecret: string;
    spaces: Array<{ spaceId: string; name: string }>;
    syncIntervalMs: number;
  };
}
```

飞书凭证通过前端设置页面配置，其他项配置文件即可。

**工作量**：小（~50 行）

### 模块二总结

| 子任务 | 类型 | 工作量 |
|--------|------|--------|
| KnowledgeSourceManager | 新增 | 中 |
| LocalSource | 新增 | 中 |
| WebSource | 新增 | 中 |
| FeishuSource | 新增 | 中 |
| 三脑决策流接入 | 改动 | 中 |
| 配置接入 | 改动 | 小 |

**总工作量**：~1200 行代码，新增 4 个文件，改动 3-4 个文件。

---

## 模块三：前端多通道 + 知识源配置

### 3.1 现状

前端 `Settings.tsx` 的 Platform tab 只有 2 个占位卡片：
- 📱 Telegram — "配置中..."
- 🎮 Discord — "配置中..."

但后端已有 **7 个通道适配器**：

| 通道 | 后端适配器 | 前端展示 | 状态 |
|------|-----------|---------|------|
| CLI | CLIAdapter | — | 无需配置 |
| Telegram | TelegramAdapter | ✅ 占位卡片 | 需要补配置表单 |
| Discord | DiscordAdapter | ✅ 占位卡片 | 需要补配置表单 |
| 飞书 | FeishuAdapter | ❌ 没有 | 需要新增 |
| 企业微信 | WeComAdapter | ❌ 没有 | 需要新增 |
| 微信公众号 | WeChatMPAdapter | ❌ 没有 | 需要新增 |
| 钉钉 | DingTalkAdapter | ❌ 没有 | 需要新增 |

### 3.2 前端改动

**改动文件**：`frontend/src/components/Settings.tsx`

Platform section 改为动态渲染，数据驱动：

```typescript
const CHANNELS = [
  { id: 'telegram',   icon: '📱', name: 'Telegram',    fields: ['botToken'] },
  { id: 'discord',    icon: '🎮', name: 'Discord',     fields: ['botToken'] },
  { id: 'feishu',     icon: '📘', name: '飞书',        fields: ['appId', 'appSecret'] },
  { id: 'wecom',      icon: '🏢', name: '企业微信',    fields: ['corpId', 'agentId', 'token', 'encodingAESKey'] },
  { id: 'wechat_mp',  icon: '💚', name: '微信公众号',  fields: ['appId', 'appSecret', 'token'] },
  { id: 'dingtalk',   icon: '📌', name: '钉钉',        fields: ['appKey', 'appSecret'] },
];
```

每个通道一个卡片，点开后显示配置表单，保存后调后端 API 写入配置。

### 3.3 知识源配置

飞书知识源配置复用飞书通道的凭证，额外只需要勾选要同步哪些知识空间：

```
飞书通道配置（已有）
  ├── appId: xxx
  ├── appSecret: xxx
  └── 知识源（新增）
      ├── ☑ 空间A: 前端知识库
      ├── ☑ 空间B: 产品文档
      └── ☐ 空间C: 测试空间
```

本地知识源配置更简单，只需指定文件夹路径：

```
本地知识源
  ├── watchFolders: [/home/user/docs, /project/wiki]
  └── fileTypes: [md, txt, pdf]
```

### 模块三总结

| 子任务 | 类型 | 工作量 |
|--------|------|--------|
| Platform section 重构为数据驱动 | 改动 | 中 |
| 6 个通道配置表单 | 新增 | 中 |
| 飞书知识空间选择器 | 新增 | 小 |
| 本地知识源文件夹配置 | 新增 | 小 |
| 后端配置 API（读写通道配置） | 新增 | 中 |

**总工作量**：~600 行前端代码 + ~200 行后端 API。

---

## 总结

| 模块 | 总工作量 | 架构变更 | 风险 |
|------|---------|---------|------|
| 影子脑集成修复 | ~280 行 | 无 | 低（都是接线） |
| 知识源统一接入 | ~1200 行 | 无（扩展层） | 中（飞书 API 对接） |
| 前端多通道 + 知识源配置 | ~800 行 | 无 | 低 |

**三个模块都不涉及架构变更**，都是在现有架构上做扩展和接线。可以并行开发，互不依赖。

### 建议开发顺序

1. **影子脑集成修复**（小改动，快速验证）
2. **KnowledgeSourceManager + LocalSource**（核心能力，不依赖外部）
3. **WebSource**（网络搜索学习，用 DuckDuckGo 起步无需 key）
4. **前端多通道配置**（补齐所有通道的配置表单）
5. **FeishuSource**（需要飞书应用凭证，前端配置后即可使用）
6. **三脑决策流接入**（把前面的组件串起来）
