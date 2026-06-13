# Buddy 项目改造总计划

> 生成日期：2026-05-10
> 状态：待执行
> 关联文档：PRIVACY_COMPLIANCE_PLAN.md, INTIMACY_SYSTEM_DESIGN.md

---

## 目录

1. [改造目标](#一改造目标)
2. [现状总结](#二现状总结)
3. [三线并行计划](#三三线并行计划)
4. [详细任务清单](#四详细任务清单)
5. [代码改动清单](#五代码改动清单)
6. [测试计划](#六测试计划)
7. [验收标准](#七验收标准)
8. [风险与缓解](#八风险与缓解)
9. [附录：关联文档索引](#附录关联文档索引)

---

## 一、改造目标

### 1.1 为什么改

| 问题 | 根因 |
|------|------|
| sharp 装不上，脱敏功能断了 | 用了 native 依赖，环境不兼容 |
| 训练管线脱敏位置错误 | 训练时脱敏降低质量，应该发布时脱敏 |
| 亲密度系统散沙 | 功能开放、引导、进化各自独立，没有统一逻辑 |
| 对外合规缺失 | 无隐私政策、无 DPIA、无数据处理记录 |
| 提问引擎只做知识采集 | 框架可复用，但没扩展到能力引导和情感关怀 |

### 1.2 改成什么样

```
改完后的 Buddy：

  用户视角：灵伴之旅 — 从陌生到灵魂伙伴，每一步都有 Buddy 引导发现
  技术视角：纯 JS 实现，无 native 依赖，所有功能 guaranteed 可用
  合规视角：隐私政策完整，数据处理可审计，App Store 可上架
  商业视角：能力包可发布商城，发布时脱敏，训练时不脱敏
```

---

## 二、现状总结

### 2.1 技术债务

| 债务 | 位置 | 影响 |
|------|------|------|
| sharp 依赖 | `frontend/src/vision/privacy.ts:166` | 脱敏功能不可用 |
| TF.js 可选依赖 | `frontend/src/vision/face-detect.ts:50` | 人脸检测不可靠 |
| 旧 PrivacyManager | `src/perception/privacy.ts` (deprecated) | 代码冗余 |
| CONFIRMATION_MAP | `src/core/constants.ts` | 跟亲密度系统脱节 |

### 2.2 可用资产

| 资产 | 位置 | 复用方式 |
|------|------|---------|
| 亲密度系统 | `src/pet/manager.ts` | 重新语义化五阶段 |
| 信任等级 | `src/types.ts:58` | 保留映射，改阶段定义 |
| KnowledgeInterviewer | `src/intelligence/knowledge-interviewer.ts` | 扩展为三合一提问 |
| FEATURE_DEFS | `src/pet/types.ts` | 对齐亲密度阶段 |
| EVOLUTION_TABLE | `src/pet/types.ts` | 对齐亲密度阶段 |
| 审计日志 | `src/audit/` | 扩展数据处理记录 |
| 帧数据过期 | `frontend/src/vision/privacy.ts` | 保留机制 |
| REST API | `src/core/ws-handler.ts` | 扩展隐私 API |
| GUIDANCE_TASKS | `src/pet/types.ts` | 替换为提问引擎驱动 |

---

## 三、三线并行计划

```
线 1: 技术改造（清理依赖 + 重写实现）
线 2: 亲密度系统（统一阶段 + 提问引擎 + 引导话术）
线 3: 对外合规（隐私政策 + 商城发布 + App Store）

三线可并行，最终在线 2 汇合。
```

### 时间线

```
Week 1:  线 1（技术清理） + 线 3（隐私政策文档）
Week 2:  线 2（亲密度阶段定义 + 功能开放表）
Week 3:  线 2（提问引擎扩展 + 引导话术库）
Week 4:  线 3（商城发布脱敏 + App Store 配置） + 线 1（测试）
Week 5:  联调 + 验收
```

---

## 四、详细任务清单

### Phase 1: 技术清理（Week 1）

#### 1.1 删除 sharp 依赖

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T01 | 删除 `anonymizeFrameAsync` 中的 sharp 调用 | `frontend/src/vision/privacy.ts` | 删除 L166-197 的 sharp import 和像素化逻辑 |
| T02 | 删除 vite.config.ts 的 sharp external | `frontend/vite.config.ts` | 删除 `rollupOptions.external` 和 `ssr.external` 中的 `['sharp']` |
| T03 | 实现纯 Canvas 像素化替代 | `frontend/src/vision/privacy.ts` | 用 `getImageData` + 块平均色填充替代 sharp |

#### 1.2 替换人脸检测依赖

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T04 | 实现 Shape Detection API 检测器 | `frontend/src/vision/face-detect.ts` | 使用浏览器原生 `FaceDetector`，零依赖 |
| T05 | 实现肤色检测 heuristic 降级 | `frontend/src/vision/face-detect.ts` | Canvas 像素分析，简单肤色聚类 |
| T06 | 保留 TF.js 作为可选增强 | `frontend/src/vision/face-detect.ts` | 动态 import，不强制 |
| T07 | 降级链整合 | `frontend/src/vision/face-detect.ts` | Shape Detection → 肤色 → 空 |

#### 1.3 清理 deprecated 代码

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T08 | 评估旧 PrivacyManager | `src/perception/privacy.ts` | 确认无调用后标记删除或合并 |
| T09 | 清理 CONFIRMATION_MAP | `src/core/constants.ts` | 替换为 CAPABILITY_GATE 驱动 |

---

### Phase 2: 亲密度系统（Week 2-3）

#### 2.1 统一阶段定义

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T10 | 定义五阶段常量 | `src/types.ts` | 初见/相识/相知/相伴/灵犀 + 范围 + 描述 |
| T11 | 重写 `getTrustLevel` | `src/types.ts` | 映射到新五阶段 |
| T12 | 重写 `getPermissions` | `src/types.ts` | 按阶段定义工具权限 |
| T13 | 更新 `getIntimacyDescription` | `src/pet/types.ts` | 五阶段描述 |
| T14 | 更新 `getIntimacyPrompt` | `src/pet/types.ts` | 五阶段 Prompt 注入 |

#### 2.2 功能开放表

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T15 | 实现 CAPABILITY_GATE | 新文件 `src/core/capability-gate.ts` | 功能开放表，替代 CONFIRMATION_MAP |
| T16 | 实现能力发现状态追踪 | `src/pet/manager.ts` | 记录每个能力是否已发现、发现时间 |
| T17 | 对齐 FEATURE_DEFS 阶段 | `src/pet/types.ts` | 每个功能绑定到亲密度阶段 |
| T18 | 对齐 EVOLUTION_TABLE | `src/pet/types.ts` | 进化阶段 = 亲密度阶段 |
| T19 | 对齐 GUIDANCE_TASKS | `src/pet/types.ts` | 引导任务由提问引擎驱动 |

#### 2.3 提问引擎扩展

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T20 | 创建 UnifiedInterviewer | `src/intelligence/unified-interviewer.ts` | 继承 KnowledgeInterviewer |
| T21 | 实现能力引导提问 | `unified-interviewer.ts` | 关键词匹配 + 阶段触发 + 话术 |
| T22 | 实现情感关怀提问 | `unified-interviewer.ts` | 情绪检测 + 活跃度 + 关心话术 |
| T23 | 实现统一决策入口 | `unified-interviewer.ts` | 优先级：情感 > 能力 > 知识 |
| T24 | 编写引导话术库 | `src/intelligence/discovery-scripts.ts` | 每个功能的引导话术 + 触发条件 |

#### 2.4 感知能力告知

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T25 | 摄像头首次使用告知 | `frontend/src/components/VisionPanel.tsx` | Buddy 引导式告知，非弹窗 |
| T26 | 麦克风首次使用告知 | 相关组件 | 同上 |
| T27 | 感知能力撤回机制 | `frontend/src/vision/privacy.ts` | 设置中可随时关闭 |

---

### Phase 3: 对外合规（Week 1, 4）

#### 3.1 文档

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T28 | 编写隐私政策 | `PRIVACY_POLICY.md` | 数据类型、用途、留存、权利 |
| T29 | 编写数据处理记录 | `DATA_PROCESSING_RECORD.md` | ROPA |
| T30 | 编写第三方处理者清单 | `DATA_PROCESSORS.md` | 云 API、商城服务 |
| T31 | 编写 DPIA | `DPIA.md` | 风险评估、缓解措施 |
| T32 | 编写用户权利指南 | `USER_RIGHTS.md` | 查询、导出、删除流程 |

#### 3.2 技术

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T33 | 数据删除接口 | `src/core/ws-handler.ts` | `DELETE /api/privacy/data` |
| T34 | 数据导出接口 | `src/core/ws-handler.ts` | `GET /api/privacy/export` |
| T35 | 审计日志扩展 | `src/audit/` | 记录所有数据采集/传输事件 |
| T36 | 帧数据不落盘确认 | `frontend/src/vision/privacy.ts` | 确保所有路径内存处理 |
| T37 | 第三方 API 调用脱敏 | 相关调用点 | 发送前剥离可识别信息 |

#### 3.3 商城发布

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T38 | 实现发布脱敏管线 | 新文件 `src/shop/publish-sanitizer.ts` | PII 扫描 + 脱敏 + 报告 |
| T39 | 文本 PII 扫描 | `publish-sanitizer.ts` | 路径/IP/邮箱/token/用户名 |
| T40 | 图像帧处理 | `publish-sanitizer.ts` | 发布时丢弃含人脸帧 |
| T41 | 脱敏报告生成 | `publish-sanitizer.ts` | 记录脱敏了什么、为什么 |

#### 3.4 App Store

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| T42 | Apple 隐私标签配置 | `Info.plist` / manifest | 摄像头、麦克风、生物识别声明 |
| T43 | Google Play 数据安全声明 | 配置文件 | 数据类型、用途、是否共享 |
| T44 | landing 页面隐私政策链接 | `landing/index.html` | 底部链接 |

---

## 五、代码改动清单

### 新增文件

```
src/core/capability-gate.ts              # 功能开放表
src/intelligence/unified-interviewer.ts  # 三合一提问引擎
src/intelligence/discovery-scripts.ts    # 引导话术库
src/shop/publish-sanitizer.ts            # 商城发布脱敏
PRIVACY_POLICY.md                        # 隐私政策
DATA_PROCESSING_RECORD.md                # 数据处理记录
DATA_PROCESSORS.md                       # 第三方处理者清单
DPIA.md                                  # 数据保护影响评估
USER_RIGHTS.md                           # 用户权利指南
```

### 修改文件

```
frontend/src/vision/privacy.ts           # 删 sharp，纯 Canvas 像素化
frontend/src/vision/face-detect.ts       # Shape Detection API + 降级链
frontend/vite.config.ts                  # 删 sharp external
src/types.ts                             # 五阶段定义 + getTrustLevel
src/pet/types.ts                         # FEATURE_DEFS/EVOLUTION/GUIDANCE 对齐
src/pet/manager.ts                       # 能力发现状态追踪
src/core/constants.ts                    # 删 CONFIRMATION_MAP
src/core/ws-handler.ts                   # 隐私 API 扩展
src/core/agent.ts                        # 集成 CAPABILITY_GATE
src/perception/privacy.ts                # 删除或合并
frontend/src/components/VisionPanel.tsx   # 感知能力告知
frontend/src/components/Settings.tsx      # 隐私设置面板
landing/index.html                       # 隐私政策链接
```

### 删除文件

```
无文件删除，但以下代码段删除：
- privacy.ts 中的 sharp import 和 anonymizeFrameAsync
- vite.config.ts 中的 sharp external
- constants.ts 中的 CONFIRMATION_MAP
- perception/privacy.ts 整个文件（确认无调用后）
```

---

## 六、测试计划

### 6.1 单元测试

| 测试目标 | 测试内容 | 文件 |
|---------|---------|------|
| Canvas 像素化 | 输入区域 → 输出像素化结果 | `privacy.test.ts` |
| Shape Detection 降级 | 各后端切换 + 降级逻辑 | `face-detect.test.ts` |
| CAPABILITY_GATE | 各阶段权限正确性 | `capability-gate.test.ts` |
| 提问引擎 | 三种模式决策逻辑 | `unified-interviewer.test.ts` |
| 发布脱敏 | PII 扫描 + 脱敏正确性 | `publish-sanitizer.test.ts` |

### 6.2 E2E 测试

| 测试场景 | 说明 |
|---------|------|
| 新用户首次对话 | 验证 Phase 1 体验完整 |
| 功能发现流程 | Buddy 引导 → 用户同意 → 功能解锁 |
| 隐私设置面板 | 查看/管理/删除数据 |
| 感知能力告知 | 首次使用摄像头的引导流程 |
| 数据删除 | 删除后确认数据清除 |

### 6.3 合规测试

| 测试项 | 说明 |
|--------|------|
| 隐私政策完整性 | 覆盖所有数据类型 |
| 数据删除有效性 | 删除后不可恢复 |
| 帧数据过期 | 5 分钟后自动清除 |
| 第三方传输可控 | 用户关闭后不传输 |

---

## 七、验收标准

### 功能验收

- [ ] 无 sharp 依赖，所有功能正常
- [ ] 无 TF.js 强制依赖，人脸检测有 guaranteed 降级
- [ ] 五阶段亲密度系统运行正常
- [ ] 提问引擎三种模式工作正常
- [ ] 功能发现由 Buddy 引导驱动
- [ ] 进化阶段与亲密度阶段对齐

### 合规验收

- [ ] 隐私政策文档存在且完整
- [ ] 用户可查看、导出、删除所有个人数据
- [ ] 帧数据不持久化存储
- [ ] 所有第三方传输有用户开关
- [ ] 摄像头/麦克风开启时有可见指示
- [ ] 商城发布前 PII 已脱敏
- [ ] App Store 隐私标签已配置

### 测试验收

- [ ] 新增功能有对应单元测试
- [ ] E2E 测试覆盖核心流程
- [ ] CI 通过

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Shape Detection API 浏览器兼容性 | 中 | 部分浏览器不可用 | 三级降级链，最低级保证可用 |
| Canvas 像素化性能 | 低 | 大图处理慢 | 限制处理区域大小，异步处理 |
| 提问引擎过于频繁 | 中 | 用户被打扰 | 冷却机制 + 用户可关闭 |
| 商城脱敏遗漏 | 低 | 法律风险 | 自动扫描 + 人工审查双保险 |
| 五阶段迁移兼容 | 中 | 旧用户数据不匹配 | 渐进迁移，保留旧值映射 |

---

## 附录：关联文档索引

| 文档 | 内容 |
|------|------|
| `PRIVACY_COMPLIANCE_PLAN.md` | 隐私合规详细框架 |
| `INTIMACY_SYSTEM_DESIGN.md` | 亲密度系统五阶段设计 + 提问引擎整合 |
| `PRIVACY_POLICY.md` | 隐私政策（待编写） |
| `DPIA.md` | 数据保护影响评估（待编写） |
| `DATA_PROCESSING_RECORD.md` | 数据处理记录（待编写） |
