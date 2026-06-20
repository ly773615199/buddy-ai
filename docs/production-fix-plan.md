# Buddy 生产环境修复与优化计划

> 日期: 2026-06-20
> 状态: 执行中
> 基于: 实际代码审查 + 端到端测试 + 市场竞品分析

---

## 一、现状分析

### 1.1 代码规模

| 指标 | 数值 |
|------|------|
| 源文件 | 345 个 .ts |
| 测试文件 | 224 个 .test.ts |
| WebSocket 相关 | 后端 27 文件 / 前端 9 文件 |
| 记忆系统 | ~4,008 行 |
| 模型池+路由+发现 | ~3,705 行 |

### 1.2 当前配置

- **LLM**: MiMo v2 (小米), 单 provider, 无 embedding 模型
- **前端**: React 19 + Vite + PIXI.js, WebSocket 通信
- **后端**: Node.js 22 + tsx watch + better-sqlite3
- **沙箱**: 限定 `/tmp/buddy-sandbox` + `process.cwd()` + `/tmp`

### 1.3 测试发现的问题

| # | 问题 | 严重度 | 影响范围 | 当前状态 |
|---|------|--------|----------|----------|
| 1 | WebSocket 消息重放重复 | P0 | 全部用户 | ✅ 已修复 |
| 2 | Embedding 模型缺失 | P0 | 记忆系统 | ✅ 已降级 |
| 3 | 订阅制限制核心能力 | P1 | 商业化 | ✅ 已移除 |
| 4 | 文件写入 LLM 误判 | P2 | 工具调用 | ⚠️ 待优化 |
| 5 | 消息重放风暴 | P2 | 服务端性能 | 📋 待修复 |
| 6 | 前端重连无退避 | P2 | 用户体验 | 📋 待修复 |
| 7 | Embedding 质量差 | P1 | 记忆检索 | 📋 待升级 |

---

## 二、已修复项（详细）

### 2.1 WebSocket 消息重放重复

**提交**: `1b80684`

**根因分析**:
```
重连 → 发送 resume(lastSeq) → 服务端重放消息 → 前端去重集合残留旧指纹
→ 部分消息被误判"已存在"而跳过 → 部分消息因截断不同而重复追加
```

前端 `recentContentRef` 使用 `type:content.slice(0,100)` 作为去重 key，但：
- 流式片段内容不同，去重失效
- 重连时集合未清空，旧指纹干扰新消息

**修复方案**:

```typescript
// 1. 重连时清空去重集合
if (isConnected && !wasConnected) {
  recentContentRef.current.clear();   // 新增
  recentMsgIdsRef.current.clear();    // 新增
  // ...发送 resume
}

// 2. 新增 seq 级去重（最可靠）
const seenSeqsRef = useRef<Set<number>>(new Set());
if (typeof eventSeq === 'number') {
  if (seenSeqsRef.current.has(eventSeq)) return; // 已处理，跳过
  seenSeqsRef.current.add(eventSeq);
}
```

**验证**: 同 seq 消息只处理一次，重连后历史消息不重复

### 2.2 Embedding 模型缺失降级

**提交**: `1b80684`

**根因分析**:
```
模型池 10 个模型 → 全部是 chat 类型 → embedCapable=false
→ embedding 任务无可用模型 → 向量检索完全失效 → 只能用 FTS5 全文搜索
```

MiMo API 不支持 `/v1/embeddings` 端点，`model-pool.ts` 的 Layer 0 过滤器将所有非 embedding 模型排除。

**修复方案**:

```typescript
// 无 embedding 模型时降级到 TF-IDF 向量
catch (err) {
  if (msg.includes('无可用模型')) {
    const vector = simpleTfIdfEmbed(text, 128); // 字符级 TF-IDF
    return { vector, dimensions: 128, model: 'tfidf-fallback' };
  }
  throw err;
}
```

**局限**: TF-IDF 是词频统计，无语义理解能力。"开心"和"快乐"不会匹配。

### 2.3 订阅制核心能力限制移除

**提交**: `e36fed8`

**改动**:
- `PLAN_LIMITS` 三个 tier 全部设为无限 (`-1`)
- `EntitlementChecker.check()` 直接返回 `{ allowed: true, remaining: -1 }`
- 移除 `ws-handler.ts` 消息配额拦截
- 移除 `skill-ops.ts` 能力包数量限制
- 保留商城/支付/赛季等体验层变现代码

---

## 三、待优化项（详细方案）

### 3.1 文件写入 LLM 误判 [P2]

**现象**: 后端 `write_file` 工具调用成功（日志 `✅write_file(undefined)▶`），但 MiMo 模型回复"文件操作被拒绝了"。

**根因**: 工具返回格式为 `[已写入 /path，123 字节]`，方括号格式可能被 LLM 解读为错误信息。

**方案**:

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1 | 修改 `write_file` 返回格式，去掉方括号 | `src/tools/builtin.ts` |
| 2 | 成功时返回 `✅ 已写入 {path}（{size} 字节）` | 同上 |
| 3 | 失败时返回 `❌ 写入失败: {reason}` | 同上 |

```typescript
// 当前
return `[已写入 ${resolved}，${content.length} 字节]`;
// 改为
return `✅ 已写入 ${resolved}（${content.length} 字节）`;
```

**工作量**: 0.5h | **风险**: 低

### 3.2 消息重放风暴 [P2]

**现象**: 后端日志频繁出现 `重放 50 条消息 (from seq 145)`，同一 seq 反复重放。

**根因**: 
1. 前端频繁断连重连（每 10-15 秒一次）
2. 每次重连都发送 `resume(lastSeq)`
3. 服务端 `REPLAY_BUFFER_SIZE=50`，每次都重放全部

**方案**:

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1 | 前端添加指数退避重连（1s→2s→4s→8s→30s max） | `frontend/src/comm/shared-connection.ts` |
| 2 | 后端 resume 响应后更新客户端 lastSeq 确认 | `src/core/ws-protocol.ts` |
| 3 | 单次 resume 重放上限改为 20 条（从 50 降低） | `src/core/link-handler.ts` |

```typescript
// link-handler.ts
const REPLAY_BUFFER_SIZE = 20; // 从 50 降到 20

// ws-protocol.ts — resume 响应后发送确认
ws.send(JSON.stringify({ type: 'resume_ack', lastSeq: replayMessages.at(-1)?.seq }));
```

**工作量**: 2h | **风险**: 中（需要前后端联调）

### 3.3 前端重连无退避 [P2]

**现象**: 前端 WebSocket 断开后立即重连，无退避策略。

**根因**: `SharedConnection` 的 heartbeat 超时只有 15s，主节点失效后立即竞选新主节点，触发重连。

**方案**:

```typescript
// shared-connection.ts — 添加退避
private reconnectAttempts = 0;
private readonly MAX_RECONNECT_DELAY = 30_000;
private readonly BASE_RECONNECT_DELAY = 1_000;

private scheduleReconnect(): void {
  const delay = Math.min(
    this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
    this.MAX_RECONNECT_DELAY
  );
  this.reconnectAttempts++;
  setTimeout(() => this.tryBecomeMaster(), delay);
}
```

**工作量**: 1h | **风险**: 低

### 3.4 Embedding 质量升级 [P1]

**当前状态**: TF-IDF 降级方案，无语义理解能力。

**方案对比**:

| 方案 | 成本 | 质量 | 延迟 | 依赖 |
|------|------|------|------|------|
| SiliconFlow BAAI/bge-small-zh-v1.5 | 免费 | ★★★★ | ~100ms | 外部 API |
| 本地 ONNX bge-small-zh | 免费 | ★★★★ | ~50ms | onnxruntime |
| OpenAI text-embedding-3-small | $0.02/1M tokens | ★★★★★ | ~200ms | 外部 API |
| 当前 TF-IDF 降级 | 免费 | ★★ | ~1ms | 无 |

**推荐方案**: SiliconFlow BAAI/bge-small-zh-v1.5

理由：
- 免费（SiliconFlow 免费额度足够）
- 中文效果好（BAAI 发布，中文 benchmark 领先）
- 无需本地依赖（纯 API 调用）
- 与现有 SiliconFlow 集成路径一致

**实施步骤**:

| 步骤 | 改动 | 文件 |
|------|------|------|
| 1 | 在模型发现中注册 SiliconFlow embedding 模型 | `src/core/model-discovery.ts` |
| 2 | 在模型知识中标记 bge-small-zh 为 embedding 模型 | `src/core/model-knowledge.ts` |
| 3 | 确保 model-pool 的 Layer 0 不过滤该模型 | `src/core/model-pool.ts` |
| 4 | 用户在设置中添加 SiliconFlow API Key（或复用已有） | 前端设置页 |

```typescript
// model-knowledge.ts — 添加 embedding 模型知识
{
  id: 'siliconflow/BAAI/bge-small-zh-v1.5',
  displayName: 'BGE Small ZH (SF)',
  tier: 'free',
  capabilities: { embedding: true, chinese: 0.95, dimensions: 512 },
}
```

**工作量**: 3h | **风险**: 低

---

## 四、执行时间线

```
Week 1 (6/20 - 6/27)
├── [已完成] WebSocket 消息重放重复修复
├── [已完成] Embedding TF-IDF 降级
├── [已完成] 订阅制限制移除
├── [Day 1-2] 文件写入 LLM 误判优化 (0.5h)
├── [Day 2-3] 消息重放风暴修复 (2h)
└── [Day 3-4] 前端重连退避 (1h)

Week 2 (6/27 - 7/4)
├── [Day 1-3] Embedding 质量升级 (3h)
├── [Day 3-5] 端到端回归测试
└── [Day 5] 生产环境验证
```

---

## 五、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| SiliconFlow 免费额度耗尽 | 低 | Embedding 失效 | 自动降级到 TF-IDF |
| 重连退避导致消息延迟 | 中 | 用户感知卡顿 | max 30s 退避 + 首次立即重连 |
| 工具返回格式变更影响其他 LLM | 低 | 误判 | 统一格式，兼容所有 provider |
| TF-IDF 降级导致记忆检索不准 | 高 | 体验下降 | 尽快升级到真正的 embedding 模型 |

---

## 六、验收标准

| 项目 | 验收条件 |
|------|----------|
| WebSocket 去重 | 重连后无重复消息，同一 seq 只处理一次 |
| Embedding 降级 | 无 embedding 模型时记忆系统不报错，FTS5 正常工作 |
| 文件写入 | write_file 成功后 LLM 不再误判为"被拒绝" |
| 重放风暴 | 单次 resume 重放 ≤20 条，无循环重放 |
| 重连退避 | 断连后重连间隔 1s→2s→4s→8s→16s→30s |
| Embedding 升级 | 添加 SiliconFlow embedding 模型后语义检索可用 |
