# E2E 测试覆盖补全计划

> 基于 2026-05-08 前端组件 vs E2E 测试覆盖分析生成
> 目标：将组件级 E2E 覆盖率从 78% 提升至 100%，深度覆盖率从 52% 提升至 80%+

---

## 📊 当前状态

| 指标 | 当前值 | 目标值 |
|---|---|---|
| 组件级 E2E 覆盖 | 18/23 (78%) | 23/23 (100%) |
| 深度场景覆盖 | 12/23 (52%) | 19/23 (83%) |
| E2E spec 文件数 | 27 | 32+ |
| 视觉回归基线 | 20+ 截图 | 30+ 截图 |

---

## 🎯 Phase 1: 缺口组件专项 (P0)

### 1.1 AgentTrace — 决策追踪面板
**文件**: `e2e/agent-trace.spec.ts`
**优先级**: 🔴 高 — 完全无覆盖

**测试用例**:
- [ ] 决策追踪面板结构完整（traceId、timestamp、mode 字段）
- [ ] 发送消息后产生追踪记录（与 `brain-decision.spec.ts` 联动）
- [ ] 追踪记录包含三脑决策详情（左脑/右脑/小脑）
- [ ] 追踪时间线渲染正确（时间倒序）
- [ ] 空状态 — 无追踪记录时显示引导文案
- [ ] Visual regression — 追踪面板截图基线

**Mock 策略**: 注入 mock trace 数据（复用 `brain-decision.spec.ts` 的 fixture）

---

### 1.2 BuddyCanvas — 精灵画布
**文件**: `e2e/buddy-canvas.spec.ts`
**优先级**: 🔴 高 — 完全无覆盖

**测试用例**:
- [ ] Canvas 元素存在且尺寸正确
- [ ] 精灵渲染 — 注入 visual_seed 后画布有内容
- [ ] 精灵动画 — 情绪切换后画布更新（happy→frustrated）
- [ ] 精灵互动 — 点击画布触发 pet 事件
- [ ] Canvas resize — 窗口大小变化后画布自适应
- [ ] 性能 — 连续渲染 100 帧无报错
- [ ] Visual regression — 精灵各阶段截图基线

**Mock 策略**: 注入 visual_seed + emotion 状态

---

### 1.3 SensorPanel — 传感器面板
**文件**: `e2e/sensor-panel.spec.ts`
**优先级**: 🟡 中 — 有 unit test 但无 E2E

**测试用例**:
- [ ] 传感器面板结构完整（位置/运动/环境三个子区）
- [ ] 位置信息渲染（经纬度/城市名）
- [ ] 运动状态渲染（静止/步行/跑步）
- [ ] 环境信息渲染（温度/湿度/光照）
- [ ] 传感器数据更新 — WS 推送 sensor_update 后面板刷新
- [ ] 空状态 — 无传感器数据时显示降级提示
- [ ] Visual regression — 传感器面板截图

**Mock 策略**: WS 注入 sensor_update 事件

---

### 1.4 svgComponents — SVG 工具函数
**文件**: `frontend/src/__tests__/svgComponents.test.ts`
**优先级**: 🟡 中 — 工具函数，补充 unit test 即可

**测试用例**:
- [ ] 各 SVG 生成函数返回合法 SVG 字符串
- [ ] 参数边界 — 空值/极端值不崩溃
- [ ] 输出一致性 — 相同输入产生相同输出

**说明**: 纯函数，unit test 足够，不需要 E2E

---

## 🎯 Phase 2: 深度覆盖增强 (P1)

### 2.1 CognitiveDashboard — 认知仪表盘深度测试
**文件**: `e2e/cognitive-dashboard.spec.ts`
**优先级**: 🟡 中 — 当前仅有基础渲染验证

**测试用例**:
- [ ] 认知状态卡片 — 各指标数值正确渲染
- [ ] 认知状态更新 — WS 推送 status 事件后仪表盘刷新
- [ ] 子面板切换（如果有多 tab）
- [ ] 数据为空时的降级展示
- [ ] Visual regression — 认知仪表盘截图

---

### 2.2 VisionPanel — 视觉面板深度测试
**文件**: `e2e/vision-panel.spec.ts`
**优先级**: 🟡 中 — 当前仅有基础覆盖

**测试用例**:
- [ ] 摄像头画面渲染（mock MediaStream）
- [ ] OCR 结果展示 — 注入 ocr 事件后显示文字
- [ ] 场景分析结果 — 注入 scene_analyze 事件
- [ ] 隐私模式切换 — 开启/关闭摄像头权限
- [ ] 隐私模式下敏感数据脱敏展示
- [ ] Visual regression — 视觉面板截图

---

### 2.3 PetStats — 宠物状态深度测试
**文件**: 增强 `e2e/pet-interaction.spec.ts`
**优先级**: 🟡 中

**新增用例**:
- [ ] 进化阶段切换 — 不同阶段 emoji/描述变化
- [ ] 基因组展示 — 稀有度标签颜色
- [ ] 亲密度等级变化 — 数值增长后等级提升
- [ ] 探索图谱节点展开/收起

---

### 2.4 Settings — 设置面板深度测试
**文件**: 增强 `e2e/app.spec.ts` 或新建 `e2e/settings-panel.spec.ts`
**优先级**: 🟢 低 — 已有较好覆盖

**新增用例**:
- [ ] LLM 配置 — 添加/删除 provider 端点
- [ ] 模型池状态展示 — 已加载模型数量
- [ ] 订阅信息 — 剩余消息数/升级入口
- [ ] 主题切换 — 亮色/暗色模式

---

## 🎯 Phase 3: 视觉回归基线扩展 (P1)

### 3.1 新增截图基线

| 场景 | 文件名 | 说明 |
|---|---|---|
| AgentTrace 面板 | `agent-trace-panel.png` | 追踪记录列表 |
| BuddyCanvas 各阶段 | `canvas-hatchling.png` | 孵化期精灵 |
| | `canvas-juvenile.png` | 幼年期精灵 |
| | `canvas-mature.png` | 成熟期精灵 |
| SensorPanel | `sensor-panel.png` | 传感器数据 |
| CognitiveDashboard | `cognitive-dashboard.png` | 认知仪表盘 |
| VisionPanel | `vision-panel.png` | 视觉面板 |
| Settings 主题 | `settings-theme-dark.png` | 暗色主题 |
| 响应式 4K | `responsive-4k-2560.png` | 4K 分辨率 |

### 3.2 截图稳定性优化
- [ ] 确保所有新增截图前调用 `stabilizeForScreenshot()`
- [ ] Canvas/WebGL 截图需额外等待渲染完成
- [ ] 动态数据统一 mock 固定值

---

## 🎯 Phase 4: CI/CD 集成 (P2)

### 4.1 GitHub Actions 增强
- [ ] E2E 测试拆分：mock 测试 vs real-llm 测试分 job 运行
- [ ] 截图 artifact 上传（失败时自动保存）
- [ ] 覆盖率报告生成 + PR comment
- [ ] 视觉回归 diff 报告自动生成

### 4.2 测试数据管理
- [ ] 统一 mock fixture 管理（`e2e/fixtures/` 目录）
- [ ] 共享 mock WS server 工具函数
- [ ] 测试环境变量文档化

---

## 📅 执行排期

| Phase | 工作量 | 预计完成 |
|---|---|---|
| Phase 1: 缺口组件 | ~4 个 spec 文件 + 1 个 unit test | 2-3 天 |
| Phase 2: 深度增强 | ~4 个 spec 文件增强 | 2 天 |
| Phase 3: 视觉回归 | ~10 个新截图基线 | 1 天 |
| Phase 4: CI/CD | GitHub Actions 配置 | 1 天 |
| **总计** | | **6-7 天** |

---

## 🔧 实施原则

1. **Mock 优先**: 所有 E2E 测试默认使用 mock LLM (`BUDDY_MOCK_LLM=1`)
2. **WS 注入**: 通过 mock WS server 注入测试数据，不依赖真实后端
3. **截图稳定**: 统一使用 `stabilizeForScreenshot()` 消除动态干扰
4. **复用 fixture**: 提取公共 mock 数据到 `e2e/fixtures/`
5. **独立可运行**: 每个 spec 文件独立，不依赖其他 spec 的执行顺序
