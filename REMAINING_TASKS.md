# 剩余任务计划

> 生成时间：2026-04-27
> 基于：孤立模块审计 + 开发记录清理
> 状态：P0/P1/P2 已全部完成，仅剩 P3

---

## 已完成总览

| 提交 | 内容 | 改动 |
|------|------|------|
| `fca2192` | CognitiveDashboard 补 Tab / assessComplexity 修复 / preprocessMessage 去重 / 删除 workflow-dag-adapter | +20/-98 |
| `ea9a21f` | DAG 三代整合（删除 workflows.ts + dag-compiler.ts，合入 experience-compiler） | +147/-495 |
| `1f2c070` | intent-classifier 集成（两层工具过滤） | +19/-5 |

**清理成果**：12 个孤立模块中 10 个已处理（83%）

---

## 剩余任务

### P3-01: shared-connection.ts — 多标签页 WS 共享

**文件**: `frontend/src/comm/shared-connection.ts`
**状态**: 代码完整，仅测试引用，未集成到 useWebSocket
**工作量**: 1 天

#### 目标

多个浏览器标签页共享一个 WS 连接，减少后端压力。

#### 集成方案

```
useWebSocket.ts 改造：
  1. 创建 SharedConnection 实例
  2. 如果当前标签页是主节点 → 建立 WS 连接
  3. 如果是从节点 → 通过 BroadcastChannel 收发
  4. 主节点关闭时自动竞选新主节点
```

#### 阻塞因素

- 需要验证 BuddyLink + SharedConnection 的兼容性
- 需要处理 BuddyLink 状态机与 SharedConnection 角色的映射

#### 验收标准

- [ ] 打开 3 个标签页，只有 1 个 WS 连接
- [ ] 关闭主标签页，从标签页自动接管
- [ ] BuddyLink 状态机不受影响

---

### P3-02: sensors/ + SensorPanel — 设备感知系统

**文件**: `frontend/src/sensors/`（6 文件）+ `frontend/src/components/SensorPanel.tsx`
**状态**: 代码完整，无消费者
**工作量**: 2 天

#### 目标

让 Buddy 感知用户设备环境（位置、运动、光线、电池、网络），根据环境调整行为。

#### 集成方案

```
Phase 1: App.tsx 集成 SensorPanel（补 Tab）
  - 在 tabs 数组中添加 sensors Tab
  - 渲染 SensorPanel 组件

Phase 2: 后端感知融合
  - sensorData 通过 WS 传到后端
  - 后端 context-fusion.ts 综合判断场景
  - Buddy 根据场景调整回复风格

Phase 3: 主动行为
  - 低电量 → 主动建议保存工作
  - 晚上 + 静止 → 切换安静模式
  - 移动中 → 回复变简短
```

#### 阻塞因素

- 浏览器传感器 API 需要用户授权
- Desktop/Electron 环境下传感器能力有限
- 建议等移动端或 Electron 增强计划明确后再做

#### 验收标准

- [ ] SensorPanel 正确显示位置/运动/环境数据
- [ ] 权限管理正常工作
- [ ] 后端能接收并处理传感器数据

---

### P3-03: 多专家并行前端入口

**文件**: 后端 `ws-handler.ts:138`（已实现）+ 前端无入口
**状态**: 后端完整，前端缺失
**工作量**: 1 天

#### 目标

让用户可以同时调用多个 LLM 回答同一问题，融合结果。

#### 集成方案

```
前端：
  - ChatPanel 或 InputBar 添加"多专家"按钮
  - 点击后发送 { type: 'multi_expert', content: '...' }
  - 展示多个专家的回答 + 融合结果

后端：
  - handleMultiExpertParallel 已实现
  - 需要确认 FusionBuffer 融合逻辑正常
```

#### 阻塞因素

- 需要产品定义：什么场景触发多专家？用户如何选择？
- 需要用户配置多个 LLM Provider

#### 验收标准

- [ ] 前端有明确的触发入口
- [ ] 多专家结果正确展示
- [ ] 融合结果优于单个 LLM

---

### P3-04: emotion-voice / sound-events — 情绪语音

**文件**: 后端 `voice/emotion-voice.ts` + `voice/sound-events.ts`
**状态**: 存在但未集成
**工作量**: 2 天

#### 目标

让 Buddy 的情绪通过声音表达（开心→语速快，疲惫→语速慢）。

#### 集成方案

```
后端：
  - EmotionEngine 状态变化时触发语音参数调整
  - TTS 调用时附带情绪参数（语速、音调、音量）

前端：
  - audio/sfx-player.ts 已有 SFX 系统
  - 新增情绪过渡音效（已有 getEmotionTransitionSFX）
  - 完善音效触发逻辑
```

#### 阻塞因素

- 依赖 SOUND_SYSTEM_PLAN 排期
- Edge TTS 对情绪参数的支持有限

#### 验收标准

- [ ] 情绪变化时语音风格有感知差异
- [ ] 不干扰正常对话流程

---

### P3-05: dag-compiler LLM 深度分析

**文件**: `src/intelligence/experience-compiler.ts`（已合入静态分析）
**状态**: 静态分析已集成，LLM 深度分析未做
**工作量**: 1 天

#### 目标

用 LLM 分析对话中的 DAG 模式（条件分支、复杂并行），超越静态分析。

#### 集成方案

```
experience-compiler.ts 增强：
  - extractDAGPattern() 中检测到并行/重试候选时
  - 调用 LLM 做深度分析（复用 dag-compiler.ts 的 llmExtractDAG 逻辑）
  - LLM 判断是否可以转为 DAG + 输出结构化 DAG 定义
```

#### 验收标准

- [ ] 静态分析检测到候选时，LLM 分析能给出更优的 DAG 结构
- [ ] LLM 失败时降级到静态分析结果

---

## 时间线

| 周 | 任务 | 工时 |
|----|------|------|
| Week 1 | P3-01 shared-connection + P3-03 多专家入口 | 2 天 |
| Week 2 | P3-02 sensors/ + SensorPanel | 2 天 |
| Week 3 | P3-04 emotion-voice + P3-05 dag-compiler LLM | 3 天 |

**总计**: 7 天（1.5 周）

---

## 依赖关系

```
P3-01 shared-connection ← 无依赖，可随时做
P3-02 sensors/          ← 等移动端/Electron 计划
P3-03 多专家并行        ← 等产品定义
P3-04 emotion-voice     ← 等 SOUND_SYSTEM_PLAN
P3-05 dag-compiler LLM  ← 无依赖，可随时做
```

## 备注

- 所有 P3 任务都是**锦上添花**，不影响核心功能
- 建议根据用户反馈和产品方向调整优先级
- 如果移动端计划启动，P3-02 应提升到 P2
