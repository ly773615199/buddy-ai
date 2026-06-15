# 资源画像全类型桥接修复计划

## 问题

`UnifiedResourceHub` 定义了 7 种资源类型，但只有 `model` 被注册接入。
其他 6 种资源各自为政，三脑决策的 `ResourceState` 看不到它们的真实状态。

## 修复方案

### Step 1: 创建统一资源桥接器 `UnifiedResourceBridge`

文件: `src/brain/hub/unified-resource-bridge.ts`

职责：将所有资源管理器的数据同步到 `UnifiedResourceHub`，让三脑决策能看到完整资源画像。

桥接目标：
- `ToolRegistry` + `SkillGrowth` → tool 资源
- `KnowledgeSourceManager` → knowledge_source 资源
- `PlatformManager` → platform 资源
- `TTSManager` → tts 资源
- `TernaryExpertRouter` → local_expert 资源
- `SkillManager` → skill 资源

### Step 2: 在 Subsystems 初始化时注册桥接器

修改 `src/core/subsystems.ts`，在各管理器就绪后调用 `UnifiedResourceBridge.fullSync()`。

### Step 3: 执行反馈回流

工具/专家执行后，通过桥接器同步 `recordOutcome` 到 `UnifiedResourceHub`，
使健康度、漂移检测、边际价值审计覆盖所有资源类型。

### Step 4: 补全 `collectResourceState`

修改 `src/core/signal-collector.ts`，让 `ResourceState` 包含非模型资源的状态。

## 验证

- 重启服务后 `/api/status` 应显示非零资源数
- 工具执行后资源画像自动更新
- 三脑决策能感知工具/知识源/平台的可用性
