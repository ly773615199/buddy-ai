# Buddy 代码审查修复计划 v2

> 基于深度全量代码审查生成
> 日期：2026-04-26
> **执行状态：已完成大部分修复**

### 执行结果汇总

| Issue | 问题 | 状态 | 改动文件 |
|-------|------|------|----------|
| #1 | 支付三渠道 Mock | ✅ Stripe 已接入真实 SDK | `billing/payment.ts` |
| #2 | 支付 Webhook 缺失 | ✅ 已注册三个路由 | `core/ws-handler.ts` |
| #3 | 经验图谱 JSON → SQLite | ✅ 已迁移 | `intelligence/experience-graph.ts` |
| #4 | LoRA 无 fallback | ✅ 已添加重试队列 | `lora/service.ts` |
| #5 | 定时器泄漏 | ✅ 已修复 | `emotion/engine.ts` `desire/engine.ts` `core/subsystems.ts` |
| #6 | 模型仓库缺失 | ✅ 已完成 | `shop/repository.ts` `shop/catalog.ts` |
| #7 | PerceptionEventBus | ✅ 已标 @deprecated | `perception/event-bus.ts` |
| #8 | PrivacyManager | ✅ 已标 @deprecated | `perception/privacy.ts` |

**测试结果**：72/73 测试文件通过，1597/1600 测试通过（3 个失败为预存在的 reminder-parser 时间解析问题）

---

## 项目架构概览

```
src/
├── core/           # 核心层：Agent、LLM 适配、消息处理、子系统容器
├── memory/         # 记忆层：MemoryStore(SQLite)、STMP(时空宫殿)、ReasoningChain、EntityStore、BeliefStore、DreamEngine
├── emotion/        # 情绪：Plutchik 8维 Buff 系统 + OCEAN 人格调制
├── desire/         # 六欲：内在驱动力 + 自然衰减
├── cognitive/      # 认知：用户模型 + 自我模型 + 微目标 + 好奇心 + 领域画像
├── intelligence/   # 自产智能：经验图谱 → 编译 → 路由 → 执行 → 进化
├── knowledge/      # 知识：提取器(6类隐性知识) + PDF解析 + 学习器
├── personality/    # 人格：OCEAN 大五 + Prompt 构建
├── pet/            # 养成：进化阶段 + 行为涌现 + 亲密度
├── social/         # 社交：CLI/Telegram/Discord/飞书/企微/钉钉/微信公众号
├── billing/        # 商业化：订阅 + 支付(Mock) + 权益检查 + LoRA接口
├── shop/           # 商城：商品目录(SQLite) + 安装器
├── skills/         # 能力包：管理 + 调度 + 评估 + 导出 + 版本 + 反馈
├── orchestrate/    # 编排：DAG 任务图 + 条件分支 + 重试 + 并行
├── ternary/        # 三进制：推理引擎 + 训练器 + 优化器 + tokenizer
├── lora/           # LoRA：云端微调对接 + 权重管理
├── tools/          # 工具：文件/命令/Git/Web/浏览器/屏幕/语音/代码智能
├── perception/     # 感知：文件监听 + 环境观察 + 事件总线(未用) + 隐私(未用)
├── behavior/       # 行为：空闲行为(OCEAN+六欲驱动)
├── voice/          # 语音：TTS(Edge) + 语音工具
├── feedback/       # 反馈：纠正检测 + 偏好学习
├── perf/           # 性能：LRU 缓存
├── launch/         # 上线：就绪检查
├── audit/          # 审计：安全日志
└── env/            # 环境检测

frontend/           # React 前端
├── src/comm/       # 通信：WebSocket Link
├── src/components/ # UI：聊天/宠物/设置/认知/记忆/工具/探索地图
├── src/audio/      # 音频引擎
├── src/voice/      # 语音(STT/麦克风/唤醒词/声音事件)
├── src/emotion/    # 前端情绪
├── src/vision/     # 视觉
└── src/sensors/    # 传感器
```

---

## 问题清单（按优先级排序）

### P0 — 业务阻塞

| # | 问题 | 文件 | 影响 | 状态 |
|---|------|------|------|------|
| 1 | 支付三渠道全是 Mock | `billing/payment.ts` | 无法收款，商业化完全不可用 | ✅ Stripe 已接入（支付宝/微信预留） |
| 2 | 支付 Webhook 端点缺失 | 无（需新建） | 付了钱系统不知道 | ✅ 已注册三个 Webhook 路由 |

### P1 — 架构一致性

| # | 问题 | 文件 | 影响 | 状态 |
|---|------|------|------|------|
| 3 | 经验图谱用 JSON 文件 | `intelligence/experience-graph.ts` | 与全项目 SQLite 不一致，无并发安全，大量节点性能差 | ✅ 已修复 |
| 4 | LoRA 云端训练无 fallback | `lora/service.ts` | API 未配置时直接抛异常，无降级方案 | ✅ 已修复 |
| 5 | 情绪/欲望引擎定时器泄漏 | `emotion/engine.ts` `desire/engine.ts` | `destroy()` 未调用则定时器泄漏 | ✅ 已修复 |

### P2 — 功能完整性

| # | 问题 | 文件 | 影响 | 状态 |
|---|------|------|------|------|
| 6 | ShopInstaller 缺模型仓库 | `shop/installer.ts` `shop/catalog.ts` | 购买→下载链路断裂 | ✅ 已完成 |
| 7 | PerceptionEventBus 未接入 | `perception/event-bus.ts` | 代码存在但无生产代码使用 | ✅ 已标废弃 |
| 8 | PrivacyManager 未接入 | `perception/privacy.ts` | 硬件权限框架无调用方 | ✅ 已标废弃 |

---

## 详细修复方案

### Issue #1：支付三渠道 Mock → 真实实现

**现状分析**：
```typescript
// payment.ts L235 — Stripe
return { success: true, orderId: order.id, clientSecret: `pi_mock_${order.id}_secret` };
// L242 — 支付宝
return { success: true, orderId: order.id, paymentUrl: `https://openapi.alipay.com/gateway.do?order=${order.id}` };
// L249 — 微信
return { success: true, orderId: order.id, qrCode: `weixin://wxpay/bizpayurl?pr=${order.id}` };
```

**已有基础**：
- ✅ `PaymentManager` 完整：SQLite 持久化、订单 CRUD、状态流转
- ✅ `SubscriptionManager` 完整：三级订阅、使用量追踪、自动过期
- ✅ `EntitlementChecker` 完整：功能门控、配额检查
- ✅ `PLAN_PRICING` 已定义：Pro ¥9/月 ¥89/年，Team ¥29/月 ¥279/年

**需要改的文件**：
- `src/billing/payment.ts` — 重写 3 个 createXxxPayment 方法
- 新建 `src/billing/webhook-handler.ts` — Webhook 处理
- `src/core/ws-handler.ts` — 注册 Webhook HTTP 路由

**Phase 1：Stripe（测试模式，验证全链路）**

```typescript
// 1. 安装依赖
// npm install stripe

// 2. PaymentConfig 扩展
interface PaymentConfig {
  provider: PaymentProvider;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;  // 新增
  sandbox?: boolean;
  currency?: string;
}

// 3. 重写 createStripePayment
private async createStripePayment(order: PaymentOrder): Promise<PaymentResult> {
  if (!this.config.apiKey) {
    return { success: false, orderId: order.id, error: 'Stripe API Key 未配置' };
  }
  const stripe = new Stripe(this.config.apiKey);
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(order.amount * 100),
    currency: order.currency.toLowerCase(),
    metadata: { orderId: order.id, userId: order.userId, plan: order.plan },
  });
  return { success: true, orderId: order.id, clientSecret: intent.client_secret };
}

// 4. 新增 Webhook 处理
async handleStripeWebhook(body: Buffer, signature: string): Promise<boolean> {
  const event = stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret);
  if (event.type === 'payment_intent.succeeded') {
    const orderId = event.data.object.metadata.orderId;
    return this.confirmPayment(orderId);
  }
  return false;
}
```

**Phase 2：支付宝**
- 安装 `alipay-sdk`
- 重写 `createAlipayPayment`：调用 `alipay.trade.page.pay`
- 新增 `handleAlipayWebhook`：RSA2 验签

**Phase 3：微信支付**
- 安装 `wechatpay-node-v3`
- 重写 `createWechatPayment`：调用 `transactions_native`
- 新增 `handleWechatWebhook`：AEAD_AES_256_GCM 解密

**Phase 4：Webhook 路由**
- 在 `ws-handler.ts` 的 `setupREST()` 中注册 `/webhook/*` 路由
- 或新建独立 HTTP server（推荐，避免与 WebSocket 端口冲突）

**预估工时**：5-7 天
**前置条件**：Stripe 账号（即时）/ 支付宝（1-3 天）/ 微信（1-2 周）

---

### Issue #2：支付 Webhook 端点缺失

**现状**：`confirmPayment()` 方法存在但无人调用

**修复**：见 Issue #1 Phase 4

---

### Issue #3：经验图谱 JSON → SQLite

**现状分析**：
```typescript
// experience-graph.ts
this.savePath = path.join(dataDir, 'experience-graph.json');
// 用 Map<string, ExperienceUnit> 存储
// save() 时 JSON.stringify 整个 Map
```

**问题**：
- 与其他所有模块（memory.db, pet.db, stmp.db, cognitive.db, billing.db, shop.db）不一致
- save() 是全量写入，O(n) 时间和空间
- 无并发安全（多进程写入会冲突）
- 倒排索引和预编译正则每次启动要重建

**修复方案**：

```typescript
// 新增迁移
const EXP_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '经验图谱从 JSON 迁移到 SQLite',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exp_nodes (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          keywords TEXT NOT NULL,
          patterns TEXT NOT NULL,
          context_tags TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exp_edges (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          to_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          data TEXT NOT NULL,
          FOREIGN KEY(from_id) REFERENCES exp_nodes(id),
          FOREIGN KEY(to_id) REFERENCES exp_nodes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_from ON exp_edges(from_id);
        CREATE INDEX IF NOT EXISTS idx_edges_to ON exp_edges(to_id);
      `);
    },
  },
];

// 重构 ExperienceGraph
export class ExperienceGraph {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'experience', EXP_MIGRATIONS);
  }

  addNode(skill: ExperienceUnit): void {
    this.db.prepare(`INSERT OR REPLACE INTO exp_nodes (...) VALUES (...)`).run(...);
    this.buildIndexForNode(skill); // 倒排索引同步更新
  }

  async load(): Promise<void> {
    const rows = this.db.prepare('SELECT * FROM exp_nodes').all();
    for (const row of rows) {
      const unit = JSON.parse(row.data);
      this.nodes.set(unit.id, unit);
      this.buildIndexForNode(unit);
    }
  }

  async save(): Promise<void> {
    // 增量保存，只写变更的节点
  }
}

// 迁移工具
async function migrateJsonToSqlite(jsonPath: string, dbPath: string): Promise<void> {
  const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  const db = new Database(dbPath);
  // ... 插入节点和边
  await fs.rename(jsonPath, jsonPath + '.bak');
}
```

**需要改的文件**：
- `src/intelligence/experience-graph.ts` — 重构存储层
- `src/intelligence/index.ts` — 更新 ExperienceEngine 构造函数
- `src/core/subsystems.ts` — 传入 dbPath

**预估工时**：2-3 天

---

### Issue #4：LoRA 云端训练无 fallback

**现状**：
```typescript
// lora/service.ts L97
if (!this.config.enabled || !this.config.apiEndpoint) {
  throw new Error('LoRA 服务未启用或未配置 API 端点');
}
```

**修复方案**：

```typescript
async submitTraining(request: LoRATrainingRequest): Promise<LoRATrainingJob> {
  if (!this.config.enabled || !this.config.apiEndpoint) {
    // 不抛异常，返回 queued 状态 + 提示
    const job: LoRATrainingJob = {
      id: `lora-${Date.now()}`,
      status: 'queued',
      domain: request.domain,
      progress: 0,
      createdAt: Date.now(),
      error: '云端服务未配置，任务已入队等待',
    };
    this.pendingJobs.set(job.id, { job, request, retryCount: 0 });
    this.jobs.set(job.id, job);
    await this.saveJobs();
    return job;
  }

  // ... 正常提交逻辑
}

// 新增：定时重试 pending 任务
private startRetryTimer(): void {
  setInterval(async () => {
    for (const [id, pending] of this.pendingJobs) {
      if (pending.retryCount >= 3) continue;
      if (!this.config.apiEndpoint) continue;
      try {
        await this.submitTraining(pending.request);
        this.pendingJobs.delete(id);
      } catch {
        pending.retryCount++;
      }
    }
  }, 60_000);
}

// 新增：手动重试
async retryJob(jobId: string): Promise<LoRATrainingJob> {
  const pending = this.pendingJobs.get(jobId);
  if (!pending) throw new Error('任务不在等待队列中');
  return this.submitTraining(pending.request);
}
```

**需要改的文件**：
- `src/lora/service.ts` — 修改 submitTraining + 新增重试逻辑

**预估工时**：1-2 天

---

### Issue #5：情绪/欲望引擎定时器泄漏

**现状**：
```typescript
// emotion/engine.ts
constructor() {
  this.tickTimer = setInterval(() => this.pool.tick(), 60_000);
}
// desire/engine.ts
constructor() {
  this.decayTimer = setInterval(() => this.tick(), 120_000);
}
```

**已有基础**：
- `closeAll()` 中已调用 `this.desire.destroy()` ✅
- 但**没有调用 `this.emotion.destroy()`** ❌

**修复**：

```typescript
// 1. EmotionEngine 添加 destroyed 检查
private destroyed = false;

destroy(): void {
  if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  this.destroyed = true;
}

// 2. Subsystems.closeAll() 补上 emotion.destroy()
async closeAll(...) {
  this.emotion.destroy();  // ← 补上
  this.desire.destroy();   // ← 已有
  this.idle.stop();        // ← 已有
  this.clock?.destroy();   // ← 已有
  // ...
}
```

**需要改的文件**：
- `src/emotion/engine.ts` — 添加 destroyed 标记
- `src/core/subsystems.ts` — closeAll 补上 emotion.destroy()

**预估工时**：0.5 天

---

### Issue #6：ShopInstaller 缺模型仓库

**现状分析**：
- `ShopCatalog`：SQLite 持久化，商品/库存/赛季/排行榜 ✅
- `ModelInstaller`：安装/卸载/更新逻辑 ✅
- 缺中间层：商品 → 下载 URL → 安装

**修复方案**：

```typescript
// 新建 src/shop/repository.ts
export class ModelRepository {
  private registryUrl: string;
  private cacheDir: string;

  constructor(config: { registryUrl: string; cacheDir: string }) {
    this.registryUrl = config.registryUrl;
    this.cacheDir = config.cacheDir;
  }

  /** 获取模型 manifest */
  async getManifest(modelId: string): Promise<ModelManifest> {
    // 本地优先
    const localPath = path.join(this.cacheDir, modelId, 'manifest.json');
    if (fs.existsSync(localPath)) {
      return JSON.parse(await fs.readFile(localPath, 'utf-8'));
    }
    // 远程
    const res = await fetch(`${this.registryUrl}/models/${modelId}/manifest.json`);
    return res.json();
  }

  /** 获取下载 URL */
  async getDownloadUrl(modelId: string, version?: string): Promise<string> {
    return `${this.registryUrl}/models/${modelId}/download${version ? `?v=${version}` : ''}`;
  }

  /** 搜索模型 */
  async search(query: string): Promise<ModelManifest[]> {
    const res = await fetch(`${this.registryUrl}/search?q=${encodeURIComponent(query)}`);
    return res.json();
  }
}

// 集成到 ShopCatalog
// purchase() → getDownloadUrl() → ModelInstaller.install()
```

**预估工时**：3-5 天

---

### Issue #7：PerceptionEventBus 未接入

**现状**：
- `src/perception/event-bus.ts` — `PerceptionEventBus` 完整实现
- 只在 `perception.test.ts` 中使用
- 生产代码中用的是 `FileWatcher` + `EnvironmentObserver` 直接处理

**分析**：当前是 CLI/Web 应用，没有硬件传感器需求。这个模块是为桌面端/移动端预留的。

**建议**：**暂不处理**。在文件头部加 `@deprecated` 标注，说明是预留模块。

```typescript
/**
 * @deprecated 当前版本未使用。为桌面端/移动端硬件感知预留。
 * 当需要接入摄像头/麦克风/位置传感器时启用。
 */
export class PerceptionEventBus extends EventEmitter {
```

---

### Issue #8：PrivacyManager 未接入

**现状**：
- `src/perception/privacy.ts` — 完整的硬件权限框架
- 管理 camera/microphone/location/motion/screen 权限
- 跟信任度系统联动
- 只在测试文件中使用

**分析**：同 Issue #7，当前无硬件感知需求。

**建议**：**暂不处理**。加 `@deprecated` 标注。

---

## 执行计划

### 第一批：核心业务（P0，1-2 周）

```
Week 1:
  Day 1-2: Stripe 测试模式实现
    - 安装 stripe SDK
    - 重写 createStripePayment()
    - 编写单元测试

  Day 3: Webhook 端点
    - 在 ws-handler.ts 的 setupREST() 中注册 /webhook/stripe
    - 实现签名验证
    - 调用 confirmPayment()

  Day 4-5: 支付宝实现
    - 安装 alipay-sdk
    - 重写 createAlipayPayment()
    - Webhook 验签

Week 2:
  Day 1-3: 微信支付实现
    - 安装 wechatpay-node-v3
    - 重写 createWechatPayment()
    - Webhook 解密

  Day 4-5: 集成测试 + 前端支付组件
```

### 第二批：架构优化（P1，1 周）

```
Week 3:
  Day 1-2: 经验图谱迁 SQLite
    - 新增 EXP_MIGRATIONS
    - 重构 ExperienceGraph 存储层
    - 编写 JSON → SQLite 迁移工具
    - 测试

  Day 3: LoRA fallback
    - 修改 submitTraining() 不抛异常
    - 新增重试队列
    - 测试

  Day 4: 定时器修复
    - EmotionEngine 添加 destroyed 检查
    - closeAll() 补上 emotion.destroy()
    - 测试

  Day 5: 模型仓库
    - 新建 ModelRepository
    - 集成到 ShopCatalog
    - 测试
```

### 第三批：低优先级（P2，按需）

```
  Issue #7: PerceptionEventBus — 加 @deprecated 注释
  Issue #8: PrivacyManager — 加 @deprecated 注释
```

---

## 依赖关系

```
Issue #2 依赖 Issue #1（先有支付实现，才有 Webhook）
Issue #6 可与 Issue #1 并行开发
其余 Issue 互相独立

前置条件：
  - Stripe：即时可用（测试模式无需审核）
  - 支付宝：需要开放平台账号（1-3 天审核）
  - 微信：需要商户号（1-2 周审核，需企业资质）
```

---

## 不改的部分（已确认完整）

| 模块 | 状态 | 说明 |
|------|------|------|
| MemoryStore | ✅ 完整 | SQLite + FTS5，持久化完善 |
| STMPStore | ✅ 完整 | 时空记忆宫殿，四步导航检索 |
| EmotionEngine | ✅ 完整 | Buff 系统 + OCEAN 调制（仅需修 destroy） |
| DesireEngine | ✅ 完整 | 六欲驱动力（仅需修 destroy） |
| CognitiveEngine | ✅ 完整 | 三层认知架构，SQLite 持久化 |
| ExperienceEngine | ✅ 完整 | 自产智能全链路（仅需迁移存储） |
| PetManager | ✅ 完整 | 养成系统 + OCEAN 涌现 |
| Orchestrate | ✅ 完整 | DAG 编排 + 条件 + 重试 + 并行 |
| Social Adapters | ✅ 完整 | 7 个平台适配器 |
| Ternary Engine | ✅ 完整 | 三进制推理 + 训练 |
| Billing/Subscription | ✅ 完整 | 订阅 + 权益（支付部分除外） |
| ShopCatalog | ✅ 完整 | 商品 + 赛季 + 库存 |
| BuddyClock | ✅ 完整 | 生物钟 + 主动行为 + 提醒 |
| LLMAdapter | ✅ 完整 | 多 Provider + Fallback + 熔断 + ModelPool |
| MessageProcessor | ✅ 完整 | 分层缓存 + 投机预取 |
| All tools | ✅ 完整 | 文件/命令/Git/Web/浏览器/代码智能 |
