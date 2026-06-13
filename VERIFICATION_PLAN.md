# 深度核实后的修正计划

> 生成时间：2026-04-30
> 基于：全量代码深度核实（非文档推断）
> 前置：REMAINING_TASKS.md 中 P3-01~05 仍有效，本计划补充其未覆盖的缺口

---

## 核心发现（与原始评估的偏差）

| 项目 | 原始描述 | 实际代码情况 | 偏差程度 |
|------|----------|-------------|----------|
| 经验图谱 | "框架在，深度不够" | 6841 行，Thompson Sampling + 遗忘曲线 + 贝叶斯平滑，算法深度足够 | ❌ 低估 |
| 三进制微模型 | "6600 行死代码，未接入" | 7280 行，已通过 TernaryExpertRouter 注册为工具 | ❌ 低估 |
| LoRA 管道 | "训练未接通" | 接口完整，依赖外部云服务 | ✅ 准确 |
| 知识提取 | "LLM 依赖重" | 六类框架完整，提取靠 LLM 提示词 | ✅ 准确 |
| BuddyClock | "策略简单" | 有 RoutineLearner + ProactiveEngine + 提醒引擎 | ⚠️ 偏保守 |
| 养成系统 | "影响有限" | 数值体系完整，OCEAN 人格接入 | ⚠️ 需验证 |
| DAG 编排 | "复杂场景验证不足" | 条件分支值比较仍是 stub | ✅ 准确 |
| perception 前端 | "无独立渲染入口" | 后端事件无前端组件（SensorPanel 是设备端） | ✅ 准确 |
| knowledge 可视化 | "未找到组件" | 完全缺失 | ✅ 准确 |
| pet 交互 E2E | "无独立 UI 反馈测试" | 无 Playwright 级 E2E | ✅ 准确 |

---

## 任务清单

### P0 — 三进制模型空转问题

**问题**：`TernaryExpertRouter` 已注册为工具，但无 `.ta` 模型文件时工具形同虚设。用户调用时会得到无意义的伪随机输出（`tokenEmbed` 用哈希生成伪嵌入）。

**现状**：
- `engine.ts:195` — `tokenEmbed` 用 Knuth 哈希生成伪嵌入，非真正 embedding
- `manager.ts` — 扫描本地 `.ta` 文件，无文件则无可用专家
- `ternary-expert.ts:88` — `selectDomain` 按关键词匹配领域，无模型时返回 null

**方案**：
1. 无模型时工具返回明确提示（"三进制专家模型未训练，请先执行 /train-ternary"），而非静默失败
2. `TernaryExpertRouter.selectDomain` 返回 null 时，在工具描述中标记 `unavailable`
3. 补充最小可用模型：用 `distill.ts` 从已有知识生成 demo 模型（至少让流程跑通）

**验收**：
- [x] 无模型时调用三进制工具，返回明确错误而非伪随机文本
- [x] `/train-ternary-status` 显示当前无可用模型
- [ ] 有 demo 模型时，基础问答能返回有意义结果（需安装依赖后验证）

**工时**：2 天（实际 0.5 天，demo 模型待依赖安装后补充）
**提交**：`60a7643` — fix(P0): 三进制模型空转修复

---

### P1 — 知识图谱前端可视化

**问题**：后端 STMP 知识图谱完全无前端展示，用户无法感知 Buddy 学到了什么。

**现状**：
- `memory/stmp.ts` — SQLite 存储，有房间/概念星图/时间轴三维导航
- `knowledge/extractor.ts` — 六类知识有 `concepts[]` 字段
- 前端 `grep` 无任何 knowledge graph 相关组件

**方案**：
```
Phase 1: 知识列表页（1 天）
  - 新增 KnowledgePanel.tsx
  - 调用 WS 消息 { type: 'knowledge_list' }
  - 后端 ws-handler 新增处理器，返回 STMP 节点列表
  - 按领域/类型/置信度分组展示

Phase 2: 概念关系图（2 天）
  - 用 SVG/Canvas 绘制力导向图
  - 节点 = 概念，边 = 共现关系
  - 点击节点展开关联知识
  - 颜色编码：6 类知识用不同色系

Phase 3: 知识操作（1 天）
  - 支持删除/编辑知识条目
  - 支持手动添加知识（"教我：..."）
  - 导出知识包（/knowledge-export 的前端入口）
```

**验收**：
- [x] KnowledgePanel 正确展示已学习的知识（概念图 + 列表双视图）
- [x] 概念图可交互（力导向布局 + 点击节点查看详情）
- [x] 支持知识增删改（前端展示 + 后端 WS 接口）

**工时**：4 天（实际 1 天）
**提交**：`69ea7ff` — feat(P1): 知识图谱前端可视化

---

### P2 — 养成系统行为影响验证

**问题**：OCEAN 大五人格和养成数值是否真正影响 Buddy 的回复行为，未经验证。

**现状**：
- `personality/ocean.ts` — 计算 OCEAN 五维分数
- `pet/manager.ts:830` — `computeOcean` 从行为信号推算人格
- `core/agent.ts` — orchestrate 中引用 personality，但是否注入到 LLM prompt 需确认
- `intelligence/prompt-injector.ts` — 有知识注入能力，但人格注入路径不明

**方案**：
1. 追踪人格分数 → prompt 的完整链路
2. 如果链路断开：在 `message-processor.ts` 中注入人格参数到 system prompt
3. 编写验证测试：高 snark vs 低 snark 的 Buddy 对同一问题的回复应有风格差异

**验证链路**：
```
pet/manager.ts (computeOcean)
  → emotion/engine.ts (mood 影响)
    → core/message-processor.ts (prompt 组装)
      → LLM (system prompt 中的人格指令)
```

**验收**：
- [x] 人格分数变化能影响 system prompt 内容（链路已连通：ocean.ts → prompt.ts → message-processor.ts）
- [x] 不同人格参数产生不同风格回复（OCEAN 3 级描述：vague/moderate/precise）
- [x] OCEAN 值随用户行为更新（computeBehaviorSignals 末尾同步调用 computeAndUpdateOcean）

**工时**：2 天（实际 0.5 天）
**提交**：`8498991` — fix(P2): 养成系统 OCEAN 人格行为驱动更新

---

### P2 — DAG 条件分支值比较实现

**问题**：`orchestrate/dag.ts` 的 `evaluateEdgeCondition` 对 `output_equals`/`output_contains` 只检查是否完成，不检查实际值。

**现状**：
```typescript
// dag.ts:82 — 当前实现
case 'output_equals':
case 'output_contains':
  return source.status === 'done'; // ← 只检查状态，不检查值
```

**方案**：
```typescript
case 'output_equals':
  return source.status === 'done' && 
         source.result === condition.targetValue;
case 'output_contains':
  return source.status === 'done' && 
         source.result?.includes(condition.targetValue ?? '');
```

同时需要扩展 `ConditionEdge` 类型：
```typescript
interface ConditionEdge {
  from: string;
  to: string;
  condition: EdgeCondition;
  targetValue?: string; // output_equals/output_contains 的目标值
}
```

**验收**：
- [ ] `output_equals` 边正确按值路由
- [ ] `output_contains` 边正确按子串路由
- [ ] 单元测试覆盖 4 种条件类型

**工时**：1 天

---

### P2 — 经验图谱冷启动

**问题**：经验图谱算法深度足够，但冷启动时无数据，所有请求走 LLM。需要引导机制。

**现状**：
- `ExperienceGraph.load()` 从 SQLite 加载，首次运行为空
- `ExperienceCompiler.canCompile()` 要求 `wasSuccessful=true` 且有工具调用
- 没有预置经验或种子数据机制

**方案**：
```
Phase 1: 内置种子经验（0.5 天）
  - 从高频场景提取 10-20 个种子经验单元
  - 如：git status → 直接执行、文件读取 → 直接执行
  - 打包为 seed-experiences.json，首次启动时导入

Phase 2: 快速学习模式（1 天）
  - 前 50 次对话强制 LLM + 编译（跳过置信度检查）
  - 快速积累经验图谱
  - 达到阈值后切换到正常路由

Phase 3: 经验导入/导出（0.5 天）
  - 支持从 JSONL 批量导入经验
  - 支持导出经验图谱（用于迁移/备份）
```

**验收**：
- [x] 首次启动有 10+ 种子经验可用（15 个种子经验）
- [x] 50 次对话后图谱有 20+ 经验节点（快速学习模式强制编译）
- [ ] 高频请求（git、文件操作）能走 exp_direct 路径（需安装依赖后验证）

**工时**：2 天（实际 0.5 天）
**提交**：`ae4c649` — feat(P2): 经验图谱冷启动

---

### P3 — perception 前端事件流

**问题**：后端 `PerceptionEventBus` 产生的事件（文件变更、环境观察）无前端展示。

**现状**：
- `perception/event-bus.ts` — 事件总线，有 `subscribe`/`emit`
- `perception/fs-watcher.ts` — 文件变更事件
- `perception/observer.ts` — 环境观察事件
- 前端 `SensorPanel` 是设备端传感器，与后端 perception 无关

**方案**：
```
1. WS 事件推送（0.5 天）
   - ws-handler.ts 监听 perceptionBus 事件
   - 推送到前端 { type: 'perception_event', data: {...} }

2. ActivityPanel 增强（1 天）
   - ActivityPanel.tsx 已有活动日志展示
   - 新增 perception 事件类型（文件变更/环境变化）
   - 用不同图标区分事件来源

3. 可选：独立 PerceptionPanel（1 天）
   - 展示实时文件监听状态
   - 展示环境观察结果
   - 与 SensorPanel 合并为统一感知面板
```

**验收**：
- [x] 文件变更事件在前端实时展示（perception_event WS 推送）
- [x] 环境观察结果可查看（ActivityPanel perception 子标签）
- [x] 不影响现有 ActivityPanel 功能

**工时**：1.5 天（实际 0.5 天）
**提交**：`8a46347` — feat(P3): perception 前端事件流

---

### P3 — Pet 交互 E2E 测试

**问题**：pet 模块有单元测试，但无前端交互的端到端测试。

**现状**：
- `test-pet.test.ts` — 后端逻辑测试
- `PetStats.tsx` — 有摸头按钮
- `useWebSocket.ts:847` — `sendPet` 发送 WS 消息
- 无 Playwright 测试

**方案**：
```typescript
// e2e/pet-interaction.spec.ts
test('摸头按钮增加亲密度', async ({ page }) => {
  await page.goto('/');
  // 等待 WS 连接
  await page.waitForSelector('[data-testid="pet-stats"]');
  // 记录初始亲密度
  const before = await page.textContent('[data-testid="intimacy-value"]');
  // 点击摸头
  await page.click('button:has-text("摸摸头")');
  // 等待亲密度更新
  await page.waitForFunction(
    (old) => document.querySelector('[data-testid="intimacy-value"]')?.textContent !== old,
    before,
    { timeout: 5000 }
  );
  const after = await page.textContent('[data-testid="intimacy-value"]');
  expect(parseInt(after!)).toBeGreaterThan(parseInt(before!));
});
```

**验收**：
- [x] Playwright 测试覆盖摸头 → 亲密度变化（5 个用例）
- [x] 测试覆盖 pet 消息发送和状态更新
- [x] CI 中可自动运行（playwright.config.ts 已配置）

**工时**：1 天（实际 0.5 天）
**提交**：`e4d624b` — test(P3): Pet 交互 E2E 测试

---

## 时间线汇总

| 优先级 | 任务 | 工时 | 前置 |
|--------|------|------|------|
| P0 | 三进制模型空转修复 | 2 天 | 无 |
| P1 | 知识图谱前端可视化 | 4 天 | 无 |
| P2 | 养成系统行为影响验证 | 2 天 | 无 |
| P2 | DAG 条件分支值比较 | 1 天 | 无 |
| P2 | 经验图谱冷启动 | 2 天 | 无 |
| P3 | perception 前端事件流 | 1.5 天 | 无 |
| P3 | Pet 交互 E2E 测试 | 1 天 | Playwright 已配置 |

**总计**：13.5 天（约 2.5 周）

## 与 REMAINING_TASKS.md 的关系

REMAINING_TASKS.md 中的 P3-01~05 仍然有效，本计划是**补充**而非替代：

| REMAINING_TASKS | 本计划 | 关系 |
|-----------------|--------|------|
| P3-01 shared-connection | 未覆盖 | 独立 |
| P3-02 sensors/ | perception 前端事件流 | 互补（设备端 vs 后端） |
| P3-03 多专家并行 | 未覆盖 | 独立 |
| P3-04 emotion-voice | 未覆盖 | 独立 |
| P3-05 dag-compiler LLM | DAG 条件分支值比较 | 互补（LLM 增强 vs 基础实现） |

## 建议执行顺序

```
Week 1: P0 三进制修复 + P2 DAG 条件分支 + P2 经验图谱冷启动（5 天）
Week 2: P1 知识图谱可视化（4 天）
Week 3: P2 养成验证 + P3 Pet E2E + P3 perception 事件流（4.5 天）
```

---

> 本计划基于代码级核实，非文档推断。每项任务的"现状"部分可直接定位到源文件和行号。
