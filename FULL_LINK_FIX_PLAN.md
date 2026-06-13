# 全链路修复计划：三脑多模型协作数据流

> 修复三脑决策到 LLM 执行的 5 个数据断裂点，打通多模型协作闭环

## 问题总结

| # | 断裂点 | 影响 | 文件 |
|---|--------|------|------|
| 1 | TaskSignal 不携带 content | 模型选择基于空内容，质量降级 | types.ts, agent.ts |
| 2 | OrchestrationNode 不携带凭据 | 并行/辩论路径无法调用指定模型 | types.ts, scheduler.ts |
| 3 | userOverride 不解析 provider/model | 多模型并行形同虚设 | model-router.ts |
| 4 | Router 异步注入 | 启动前几条消息走本地模型 | subsystems.ts |
| 5 | Cascade/Sequential 无凭据 | 级联/接力路径 LLM 调用 401 | model-pool.ts, model-router.ts, llm.ts |

## 修复顺序

1. **TaskSignal 加 content** — 最小改动，解锁后续
2. **OrchestrationNode 加凭据字段** — 类型扩展
3. **ModelPool 存凭据** — 方案 C 核心
4. **ModelRouter 注入凭据** — 方案 C 核心
5. **resolveModel 解析 provider/model** — 并行路径修复
6. **LLMAdapter fallback** — 双保险
7. **Subsystems 同步注入** — 消除竞态

## 验证方案

每个修复后运行验证脚本，确保：
- 单模型调用成功
- 并行多模型调用各用不同模型
- 级联路径不 401
- 启动后立即可用（无竞态）
