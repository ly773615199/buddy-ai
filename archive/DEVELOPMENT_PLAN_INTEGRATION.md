# Buddy 开发计划 — Evolver 整合 + 缺口修复 + 代码审查更新

> 基于 2026-04-19 全量代码核实 | 不依赖旧文档，以实际代码为准

---

## 一、代码核实结果（2026-04-19）

### 已修复的"旧缺口"（文档声称未完成，代码实际已完成）

| # | 旧缺口 | 实际代码状态 | 证明 |
|---|--------|------------|------|
| 1 | LLM 测试连接是假的 | ✅ 已修复 | `useWebSocket.sendTestLLM()` → `ws-handler.ts handleTestLLM()` → `LLMAdapter.testConnection()` |
| 2 | TTS 音频前端没播放 | ✅ 已修复 | `useWebSocket` case 'audio': base64→Blob→Audio.play() |
| 3 | 编排引擎前端零接入 | ✅ 已修复 | 7 个 `orch_*` 事件处理 + `sendOrchestrate()` + `/orch` 前缀路由 |
| 4 | LLM 配置不热重载 | ✅ 已修复 | `handleLLMConfig()` → `sys.reconfigureLLM()` |
| 5 | useWebSocket 缺 sendOrchestrate | ✅ 已修复 | 方法已存在 |
| 6 | WS Token 认证 | ✅ 已实现 | `ws/server.ts` 构造函数校验 token |
| 7 | REST API 层 | ✅ 已实现 | `/api/status` `/api/chat` `/api/config` `/api/llm/test` |

### 已修复的缺口（2026-04-19 新增修复）

| # | 缺口 | Commit | 说明 |
|---|------|--------|------|
| 1 | **进化阶段类型不一致** | `390e225` | 后端对齐前端 7 阶段 `egg|hatching|growing|formed|mature|complete|legendary` |
| 2 | **后端不发送 evolve 事件** | `a4ca86d` | 新增 `checkAndEmitEvolution()`，所有 trackFeature 调用点已接入 |
| 3 | **SpriteRenderer 未覆盖所有 VisualStage** | `31f9616` | formed/mature/complete/legendary 独立渲染，含尺寸/光晕/粒子/光环差异 |

---

## 二、Evolver 整合计划

Evolver (https://github.com/EvoMap/evolver) 是 GEP 驱动的 AI Agent 自进化引擎。
Buddy 的经验模型 (`intelligence/`) 是 Agent 内置的"肌肉记忆"，
Evolver 是外部的"进化顾问"。两者互补。

### 可借鉴并落地的能力

| # | 能力 | Buddy 现状 | 改造方案 | 工作量 |
|---|------|-----------|---------|--------|
| 1 | **进化事件持久化** | `ExperienceEvolver.events` 只存内存 | 写入 `~/.buddy/experience-events.jsonl`，前端可查看 | 2 天 |
| 2 | **停滞检测** | 无 | 检测连续编译失败率，超阈值暂停自动编译 | 1 天 |
| 3 | **GEP 兼容导出** | `.skillmate` 格式 | 增加 GEP 格式导出（genes.json + capsules.json） | 3 天 |
| 4 | **受保护源边界** | 无 | 标记不可被技能修改的文件/配置 | 1 天 |

### 长期整合方向（不在本次执行）

- 对接 EvoMap Skill Store（需要 evomap.ai 账号 + A2A 协议）
- Worker Pool 参与（需要稳定公网服务）

---

## 三、执行计划

### Sprint 1：缺口修复 ✅ 已完成

```
Task 1: 统一进化阶段类型         ✅ 390e225
Task 2: 后端发送 evolve 事件     ✅ a4ca86d
Task 3: SpriteRenderer 7 阶段覆盖 ✅ 31f9616
```

### Sprint 2：Evolver 能力整合 ✅ 已完成

```
Task 4: 进化事件持久化           ✅ JSONL 写入 + getEvents() 读取 API + evolution_log 事件推送 (2026-04-19)
Task 5: 停滞检测                ✅ StagnationState + canCompile() 检查 + 24h 暂停机制 (2026-04-19)
Task 6: GEP 兼容导出            ✅ exportAsGEP() + GEP 类型定义 + 批量导出 (2026-04-19)
```

#### Task 4 详情：进化事件持久化

**涉及文件**：
- `src/experience/experience-evolver.ts` — 加 JSONL 写入（每次 onSuccess/onFailure/compile/consolidate/retire）
- `src/experience/index.ts` — 暴露 getEvents() 读取 API
- `src/core/ws-handler.ts` — 新增 evolution_log 命令处理

#### Task 5 详情：停滞检测

**涉及文件**：
- `src/experience/experience-evolver.ts` — 新增 StagnationState + 检测逻辑
- `src/core/message-processor.ts` — 编译前检查停滞状态

**检测规则**：最近 20 次事件中淘汰占比 > 60% → 停滞
**行为**：暂停自动编译 24h，写入 stagnation_detected 事件

#### Task 6 详情：GEP 兼容导出

**涉及文件**：
- `src/skills/export.ts` — 新增 exportAsGEP() 方法
- `src/experience/types.ts` — 新增 GEP 类型定义

**导出格式**：genes (经验单元) + capsules (技能组合) + events (审计事件)

### Sprint 3：代码清理 + 同步 📋 待执行

```
Task 7: 类型一致性清理           — 前后端共享类型
Task 8: 文档更新                — 更新 README/ANALYSIS 反映真实状态
```

---

*最后更新：2026-04-19 21:55 GMT+8*
*基于逐文件代码核实，不依赖旧文档*
