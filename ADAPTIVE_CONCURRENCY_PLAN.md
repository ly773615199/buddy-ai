# 自适应并发控制开发方案 v2

> 代号：AdaptiveTaskQueue
> 目标：将固定并发数（maxConcurrent=3）升级为根据实时信号自动调整的智能并发控制

---

## 核心变更（v2）

1. **maxLimit 自动计算** — 根据 API provider 的 RPM 自动算出，不拍脑袋
2. **前端起步值可调** — CognitiveDashboard 可编辑 initialLimit
3. **`/api/concurrency/config` 热更新** — 无需重启

---

## maxLimit 自动计算

```
maxLimit = min(RPM × avgLatency / 60, 硬上限10)
```

| Provider | RPM | 默认 maxLimit |
|----------|-----|---------------|
| openai | 500 | 10 |
| deepseek | 60 | 3 |
| anthropic | 50 | 3 |
| google | 15 | 2 |
| ollama | ∞ | 5 |
| mimo | 100 | 5 |
| custom | 60 | 3 |

---

## 文件变更

| 文件 | 改动 |
|------|------|
| `src/core/concurrency-limiter.ts` | 已完成 |
| `src/core/concurrency-limiter.test.ts` | 已完成 |
| `src/core/adaptive-stress.test.ts` | 已完成 |
| `src/core/task-queue.ts` | 已完成 |
| `src/core/ws-handler.ts` | 新增 maxLimit 自动算 + `/api/concurrency/config` |
| `src/types.ts` | 新增 ProviderRateLimit 表 |
| `frontend/.../CognitiveDashboard.tsx` | 新增起步值编辑器 |

---

## API

```
GET  /api/concurrency        — 查询并发状态
POST /api/concurrency/config — 更新起步值 { initialLimit: 5 }
```

---

## 验收

1. maxLimit 根据 provider 自动计算
2. 前端可编辑起步值
3. 39 个测试全通过
4. TypeScript 无错
