# Buddy 开发总纲 — 三层能力架构补强计划

> 生成时间：2026-04-20
> 更新时间：2026-04-23
> 基于：全量代码审计 + Hermes Agent 对标 + 架构深度讨论 + LoRA 积累效率分析 + 多渠道方案调研 + 通信层审计
> 当前版本：ad7bfb6 (命名重构 Skill→Experience 完成)

---

## 一、核心架构：三层能力模型

Buddy 的能力由三层构成，每层有独立的增长逻辑和价值定位：

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Layer 1: 经验包 (Experience Pack) — 行业专业 AI 能力        │
│  ═══════════════════════════════════════════════════         │
│  本质：从专业对话蒸馏而来的领域知识，三级形态                  │
│  三级形态：                                                    │
│    ① Prompt 注入（即时可用，零成本）← 先做这个                   │
│    ② 训练数据管道（本地积累，为微调准备）                        │
│    ③ LoRA 权重（微调产物，可交易）← 最终目标                    │
│  价值：让没有大模型的人也能获得大模型的行业专业判断力           │
│  增长：对话 → 知识积累 → Prompt 注入 → 数据导出 → 微调 → LoRA  │
│  市场：经验包是 Buddy 市场核心交易品（Prompt 模板到 LoRA 都可） │
│  状态：接口已定义 (billing/lora-interface.ts)                 │
│        Prompt 注入未实现                                       │
│        LoRA 管道未实现                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 2: 经验模型 (Experience Engine) — 使用模式学习         │
│  ═══════════════════════════════════════════════════         │
│  本质：从对话中学习"怎么用工具完成任务"                        │
│  价值：每个 Buddy 独有的自进化能力，越用越聪明                 │
│  形式：ExperienceUnit（触发条件 + 工具步骤序列 + 回复模板）    │
│  增长：对话 → 编译 → 图谱 → 路由 → 执行 → 反馈进化           │
│  市场：不交易，是每个实例的私有资产                            │
│  状态：已实现 (intelligence/)                                │
│        当前是"工具调用模式的录制回放"，缺少 LLM 参与的深度编译  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 3: Skill — 可执行的操作工具                           │
│  ═══════════════════════════════════════════════════         │
│  本质：Agent 的"手脚"，具体的可执行操作                       │
│  价值：决定 Agent 能做什么、不能做什么                        │
│  形式：ToolDef（工具名 + 参数定义 + 执行逻辑）                │
│  增长：内置 / 本地文件 / MCP Server / 市场安装                │
│  市场：Skill 本身不是市场商品，是基础设施                      │
│        但 Skill 可以从任何市场来源安装（ClawHub/Hermes/本地）  │
│  状态：20 个硬编码工具，无安装机制                             │
│        MCP 适配器写了但没连任何 Server                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 三层关系

```
经验包 (三级形态)            经验模型 (使用模式)         Skill (工具)
    "我会什么"                  "我怎么用"              "我用什么"
 Prompt注入→数据→LoRA权     工具组合学习              具体可执行操作
    ↓ 加载后                    ↓ 调用时                 ↓ 注册后
 LLM获得专业领域判断力    ExperienceRouter 匹配执行    ToolRegistry 统一管理
    ↓ 需要调用                  ↓ 需要调用               ↓ 被调用
    └──────────────────────────→ Skill ←────────────────┘

经验包的大脑需要 Skill 的手脚来施展能力
经验模型的肌肉记忆需要 Skill 的工具来训练
```

### 类比

```
经验包 = 20 年经验的专科医生的大脑（专业判断力）
Skill  = 手术刀、听诊器、CT 机（具体工具）
经验模型 = 医生不断积累的临床经验（使用模式）

市场卖的是"大脑"，不是"手术刀"
但"大脑"没有"手术刀"就做不了手术
```

---

## 二、现状审计

### 2.1 经验包 (Layer 1) — 接口已定义，实现为空

| 环节 | 接口 | 实现 | 状态 |
|------|------|------|------|
| 知识收集 | STMP 时空记忆宫殿 | ✅ 664 行，完整实现 | 已有 |
| 隐性知识提取 | KnowledgeExtractor (6 类) | ✅ 740 行，完整实现 | 已有 |
| 领域画像 | CognitiveEngine.updateDomainProfile | ✅ 完整 | 已有 |
| 达到 mature | `growthStage === 'mature'` | ✅ 有判断 | 已有 |
| 训练数据导出 | `exportKnowledgeForTraining(domain)` | ❌ 仅接口 | 缺 |
| 提交训练 | `submitTraining(request)` | ❌ 仅接口 | 缺 |
| 查询进度 | `getJobStatus(jobId)` | ❌ 仅接口 | 缺 |
| 下载权重 | `downloadWeights(jobId)` | ❌ 仅接口 | 缺 |
| 本地权重加载 | — | ❌ 无接口定义 | 缺 |
| 市场交易 | billing 框架 | ⚠️ 订单管理有，LoRA 无 | 半成品 |

**知识收集管道是通的**，从对话 → STMP → KnowledgeExtractor → 领域画像，全链路完整。
断在"成熟后怎么变成 LoRA 权重"这一步。

### 2.2 经验模型 (Layer 2) — 已实现，能力有限

| 模块 | 文件 | 行数 | 状态 |
|------|------|------|------|
| 经验图谱 | intelligence/experience-graph.ts | ~260 | ✅ |
| 经验编译器 | intelligence/experience-compiler.ts | ~190 | ✅ |
| 经验路由器 | intelligence/experience-router.ts | ~120 | ✅ |
| 经验执行器 | intelligence/experience-executor.ts | ~160 | ✅ |
| 经验进化器 | intelligence/experience-evolver.ts | ~260 | ✅ |

**能做的**：
- 从成功对话中提取工具调用序列
- 关键词匹配 + 置信度路由
- 自动执行已学过的工具序列
- 成功/失败反馈更新置信度
- 梦境巩固（合并相似经验、淘汰低质量）
- 停滞检测

**做不到的**：
- 理解"为什么这么做"（只有工具序列，没有推理）
- 泛化到新场景（只能匹配关键词，不能举一反三）
- 提取专业判断逻辑（没有 LLM 参与编译过程）

### 2.3 Skill (Layer 3) — 20 个硬编码工具，无扩展机制

**已注册工具（20 个）**：

| 工具 | 类型 | 可执行性 | 问题 |
|------|------|:------:|------|
| read_file | 文件 | ✅ | 完好 |
| write_file | 文件 | ✅ | 完好 |
| list_files | 文件 | ✅ | 完好 |
| search_files | 文件 | ✅ | 完好 |
| exec | 系统 | ✅ | 完好（有沙箱） |
| git_status | Git | ✅ | 完好 |
| git_log | Git | ✅ | 完好 |
| git_diff | Git | ✅ | 完好 |
| get_time | 工具 | ✅ | 完好 |
| search_web | 网络 | ⚠️ | DDG 免费搜索，质量差 |
| fetch_url | 网络 | ⚠️ | shell curl，SPA 不可用 |
| analyze_file | 代码 | ✅ | 正则分析，完好 |
| find_references | 代码 | ✅ | grep 级搜索，完好 |
| scan_project | 项目 | ✅ | 完好 |
| browser_screenshot | 浏览器 | ⚠️ | 需 Playwright |
| browser_extract | 浏览器 | ⚠️ | curl\|sed，SPA 废 |
| browser_pdf | 浏览器 | ⚠️ | 需 Playwright |
| screen_capture | 屏幕 | ⚠️ | 需 scrot/screencapture |
| screen_ocr | 屏幕 | ⚠️ | 需 tesseract |
| screen_describe | 屏幕 | ⚠️ | 需 scrot + tesseract |

**缺失的工具类别**：

| 类别 | 具体缺失 | 影响行业 |
|------|---------|---------|
| 外部服务集成 | GitHub/Slack/邮件/云服务 API 调用 | 全部 |
| 数据处理 | Excel/CSV/JSON 结构化编辑 | 金融/运营/教育 |
| 数据库操作 | SQLite/Postgres 查询 | 开发/数据 |
| 图片处理 | resize/convert/compress | 设计/运营 |
| 容器管理 | Docker/K8s 操作 | DevOps |
| 远程操作 | SSH 连接 | 运维 |
| 代码质量 | format/lint/test 封装 | 开发 |
| 通信 | HTTP 请求（带 headers/auth） | 全部 |

**MCP 适配器**：`MCPAdapter` 类完整实现了 JSON-RPC 协议（connect/discover/call/disconnect），
但 Subsystems 只 `new MCPAdapter(verbose)`，没有 connect 任何 Server。

---

## 三、与竞品对比

| 维度 | Buddy 现状 | Hermes Agent | OpenClaw | Buddy 目标 |
|------|:---------:|:----------:|:--------:|:---------:|
| 工具数量 | 20（硬编码） | ~30 | ~40 | 20+N（动态） |
| 工具增长 | ❌ | ✅ Agent 自写 Skill | ✅ clawhub 安装 | ✅ 多来源安装 |
| 专业能力 | ❌ | ❌ | ❌ | ✅ LoRA 经验包 |
| 使用学习 | ✅ | ✅ | ❌ | ✅（升级） |
| 记忆系统 | ✅ STMP | ✅ 3层 | ✅ | ✅ STMP |
| 形象系统 | ✅ | ❌ | ❌ | ✅ |
| 认知架构 | ✅ | ❌ | ❌ | ✅ |
| 多平台 | ⚠️ 适配器写了 | ✅ 7+ 平台 | ✅ | ✅ |

**Buddy 的独特价值**：三层能力架构（经验包 + 经验模型 + Skill）是其他项目都没有的完整体系。

---

## 四、开发计划

> **2026-04-23 核实更新**：Phase 1-6 功能开发已基本完成（代码先于计划文档），当前真正需要推进的是 Phase 0 基础设施和 Phase 7 通信层强化。

### 完成度总览

| Phase | 内容 | 状态 | 说明 |
|-------|------|:----:|------|
| Phase 0 | 基础设施 | 🔴 缺失 | CI/CD 不完整、无结构化日志、无健康检查、无安全审计 |
| Phase 1 | Skill + MCP | ✅ 完成 | SkillManager(274行) + 27个.skillmate + MCPAdapter(293行) + MCPRegistry |
| Phase 2 | 链路修复 | ✅ 完成 | Onboarding测试连接、TTS音频播放、编排前端、WS Token认证 |
| Phase 3 | Prompt Injection | ✅ 完成 | PromptInjector(369行) + TrainingExporter(490行) + KnowledgeInterviewer(517行) + DataAugmentor(267行) |
| Phase 4 | LoRA 管道 | ✅ 完成 | LoRAService(469行) 含 submitTraining/getJobStatus/downloadWeights/exportKnowledge |
| Phase 5 | 前端可视化 | ✅ 完成 | CognitiveDashboard(207行) + Experts(447行) + ExplorationMap(277行) + AchievementsPanel |
| Phase 6 | 多平台 | ✅ 完成 | TelegramAdapter + DiscordAdapter + FriendsSystem + BuddyInteract(515行) |
| Phase 7 | 通信层强化 | 🟡 进行中 | BUG-002/003/005 已修，自诊断/自修复/自进化待做 |

---

### Phase 1-6：功能开发（已完成）

以下模块已全部实现，仅列出关键文件和行数作为记录：

#### Phase 1：Skill 骨架 + MCP 接通 ✅

```
src/skills/skill-manager.ts    — 274 行，动态 Skill 加载（.skillmate 声明式工具）
skills/                        — 27 个 .skillmate 文件（weather/github/docker/video/pdf 等）
src/tools/mcp-adapter.ts       — 293 行，MCP JSON-RPC 协议适配器
src/tools/mcp-registry.ts      — Smithery MCP 市场搜索
src/tools/tool-retriever.ts    — 语义检索工具子集
src/tools/cache.ts             — LRU + TTL 工具结果缓存
```

#### Phase 2：链路修复 ✅

```
Onboarding LLM 测试连接    — 前端 sendTestLLM → 后端 handleTestLLM → test_llm_result 事件
TTS 音频前端播放           — useWebSocket case 'audio': base64 → Blob → Audio.play()
编排引擎前端接通           — orch_start/task_start/task_done/task_fail/progress/done 全部处理
WS Token 认证              — EventBus 连接时校验 token + isLocal 免认证
REST API 共端口            — HTTP + WS 同端口，upgrade 时验证
```

#### Phase 3：经验包 Prompt Injection ✅

```
src/intelligence/prompt-injector.ts      — 369 行，STMP 知识 → 领域 Prompt 注入
src/intelligence/training-exporter.ts    — 490 行，训练数据导出（JSONL）
src/intelligence/knowledge-interviewer.ts — 517 行，主动提问引擎
src/intelligence/data-augmentor.ts       — 267 行，Self-Instruct 数据扩增
src/core/message-processor.ts            — buildContext 中集成 PromptInjector
```

#### Phase 4：LoRA 积累效率优化 + 微调管道 ✅

```
src/lora/service.ts            — 469 行，LoRA 全流程服务
  ├─ submitTraining()          — 云端训练提交
  ├─ getJobStatus()            — 训练进度查询
  ├─ downloadWeights()         — 权重下载
  ├─ exportKnowledgeForTraining() — 知识导出
  └─ startTraining()           — 一键训练（含质量检查）
src/billing/lora-interface.ts  — LoRA 接口定义
src/intelligence/data-augmentor.ts — Self-Instruct + 质量评估
```

#### Phase 5：前端认知可视化 ✅

```
frontend/src/components/CognitiveDashboard.tsx — 207 行，领域知识/Skill/梦境日志
frontend/src/components/Experts.tsx            — 447 行，三进制专家商城
frontend/src/components/ExplorationMap.tsx     — 277 行，探索地图
frontend/src/components/AchievementsPanel.tsx  — 成就面板
useWebSocket 事件处理                          — cognitive_update/experience_matched/dream_complete/skill_registered
```

#### Phase 6：经验模型升级 + 多平台 ✅

```
src/intelligence/experience-compiler.ts — 经验编译器
src/intelligence/experience-router.ts   — 置信度路由
src/intelligence/experience-executor.ts — 确定性执行
src/intelligence/experience-evolver.ts  — 积累/合并/淘汰
src/social/platform.ts                  — 515 行，CLI/Telegram/Discord 适配器
src/social/friends.ts                   — 好友系统
src/social/buddy-interact.ts            — Buddy 互访/互动
```

---

### Phase 0：基础设施（🔴 重点推进）

> 功能开发已完成，基础设施是当前最大短板。

#### 已有

| 项目 | 状态 | 说明 |
|------|:----:|------|
| CI 基础 | ✅ | `.github/workflows/ci.yml` — lint + test + build，Node 20/22 矩阵 |
| 测试框架 | ✅ | vitest 配置 + `test:coverage` 脚本 + 43 个测试文件 |
| Docker | ✅ | Dockerfile + docker-compose.yml + .dockerignore |
| 构建脚本 | ✅ | `build:all` / `dev:all` / `test:all` |

#### 缺失（按优先级）

**P0 — 必须补上：**

| 项目 | 文件 | 说明 |
|------|------|------|
| 开发环境镜像 | `.npmrc` | `registry=https://registry.npmmirror.com` + ELECTRON_MIRROR |
| Release CI | `.github/workflows/release.yml` | tag 触发 → Docker build → push to registry |
| 安全审计 CI | `.github/workflows/security.yml` | 每周 `npm audit` + 依赖漏洞扫描 |
| 结构化日志 | 替换 console.* 为统一 logger | JSON 格式 + 级别控制 + 文件轮转 |
| 健康检查端点 | `GET /api/health` | 返回 LLM/WS/Memory/Config 各子系统状态 |

**P1 — 强烈推荐：**

| 项目 | 文件 | 说明 |
|------|------|------|
| 测试覆盖率提升 | 核心模块 | llm.ts / ws-handler.ts / message-processor.ts 覆盖率 > 60% |
| 集成测试 | `tests/integration/` | WS 端到端 + LLM mock + 配置 round-trip |
| CHANGELOG | `CHANGELOG.md` | conventional-commits 自动生成 |
| .editorconfig | `.editorconfig` | 统一缩进/换行/编码 |

**P2 — 有则更好：**

| 项目 | 文件 | 说明 |
|------|------|------|
| .prettierrc | `.prettierrc` | 代码格式化（团队协作用） |
| Dependabot | `.github/dependabot.yml` | 自动依赖更新 PR |
| Prometheus 指标 | `GET /api/metrics` | 可选，用于 Grafana 监控 |

---

### Phase 7：通信层强化（🟡 进行中）

> 详见 `COMMUNICATION_UPGRADE_PLAN.md`（v3 — 事件驱动管道架构）

**架构**：单文件 BuddyLink 类，4 层管道（State → Reliability → Transport → Observe），12 项能力全保留，管道扩展机制支持未来新增能力。

#### 已完成

| 项目 | 文件 | 状态 |
|------|------|:----:|
| BUG-001: WS Token 认证修复 | `src/ws/server.ts` | ✅ |
| BUG-002: LLM 配置消息队列 | `useWebSocket.ts` + `App.tsx` | ✅ |
| BUG-003: LLM 空 URL（根因 BUG-002） | — | ✅ |
| BUG-005: WS 重连风暴防护 | `useWebSocket.ts` | ✅ |
| 后端内存配置同步 | `ws-handler.ts` | ✅ |

#### 待做（3 周）

| Week | 内容 | 产出 |
|------|------|------|
| Week 1 | BuddyLink 骨架（状态机+心跳+重连）+ 消息可靠性（ACK+重试+降级+离线队列）+ 后端 LinkHandler | `comm/link.ts` + `core/link-handler.ts` |
| Week 2 | Observe 层（诊断+故障模式+策略自适应）+ 配置同步 + useWebSocket 集成 | 诊断融入流程，对外接口不变 |
| Week 3 | 管道扩展机制 + 边界情况 + 性能优化 + UI 状态展示 | 扩展层 API，端到端测试 |

---

---

## 五、总工时

| 阶段 | 内容 | 工时 | 状态 |
|------|------|------|:----:|
| Phase 0 | 基础设施（环境/CI/日志/安全） | 12 天 | 🔴 待做 |
| Phase 1 | Skill 骨架 + MCP + 补工具 | 5 天 | ✅ 已完成 |
| Phase 2 | 链路修复（6 处断裂） | 5 天 | ✅ 已完成 |
| Phase 3 | Prompt Injection + 训练数据管道 | 5 天 | ✅ 已完成 |
| Phase 4a | 主动知识采集 + 训练数据质量提升 | 5 天 | ✅ 已完成 |
| Phase 4b | 基座模型全链路赋能 | 2.5 天 | ✅ 已完成 |
| Phase 4c | 云端微调对接 + 本地权重加载 | 7.5 天 | ✅ 已完成 |
| Phase 5 | 前端认知可视化 | 5 天 | ✅ 已完成 |
| Phase 6 | 经验模型升级 + 多平台 | 5 天 | ✅ 已完成 |
| Phase 7 | 通信层强化（管道架构，3 周） | 15 天 | 🟡 进行中 |

**剩余工作**：
- Phase 0 基础设施：12 天
- Phase 7 通信层强化：10 天（5 天已完成，改为管道架构后总量 15 天）
- **实际还需投入：约 22 天（4-5 周）**

---

## 六、核心原则

1. **不动已有代码**：经验模型、STMP、认知引擎、前端组件 — 全部不动，只加层
2. **Skill 是独立层**：和经验模型没有从属关系，但经验模型学习使用所有 Skill
3. **经验包的三级形态**：
   - Prompt Injection（即时可用，零额外成本）
   - 训练数据管道（本地积累，为微调做准备）
   - LoRA 权重（微调产物，可交易商品）
   - 三者是递进关系，Prompt Injection 先跑起来，LoRA 是最终目标
4. **LoRA 微调路径多元化**：
   - 有 GPU → 本地微调
   - 有云端服务 → API 微调
   - 普通用户 → 商城代微调（付费）
   - 无条件 → 先用 Prompt Injection 攒数据
5. **LoRA 优先、Prompt 兜底**：有 LoRA 权重就用 LoRA，没有就回退到 Prompt Injection，用户无感切换
6. **市场卖经验包**：Skill 是基础设施不是商品，市场交易的是行业专业 AI 能力（从 Prompt 注入到 LoRA 权重都可以交易）
7. **兼容所有市场**：Skill 格式兼容 ClawHub / Hermes / 本地文件，不绑定单一来源
8. **数据质量 > 数据数量**：100 条高质量问答对（含推理链） > 500 条碎片知识句。训练数据格式必须是 instruction/input/output 三元组，output 包含推理链
9. **主动采集 > 被动等待**：Buddy 主动提问引导用户输出专业知识，比被动等待对话效率高 3-5 倍。把知识提取从"数据挖掘"变成"知识采访"
10. **基座模型是全链路工具**：LLM 不只是微调目标，它在整条 LoRA 产线中扮演 6 个角色 — 采访官（知道问什么）、蒸馏器（提炼洞察）、扩增器（Self-Instruct 变多）、质检员（评估就绪度）、仿真器（LoRA 之前的平替）、推理链生成器（让训练数据从背诵变思考）
11. **RAG 先行，LoRA 后补**：Prompt Injection（本质是 RAG）和 LoRA 是阶梯关系，不是二选一。trainable 阶段 Prompt Injection 已能提供 70-80 分体验，LoRA 提升到 85-95 分

---

## 附录 A：LoRA 积累管线效率审计（2026-04-21）

基于全量代码审计，对 LoRA 积累管线 6 个环节逐一分析：

| 环节 | 输入 → 输出 | 当前效率 | 瓶颈原因 | 改进方案 |
|------|------------|:---:|---------|---------|
| 1. 知识提取 | 对话 → 知识节点 | ★★☆☆☆ | 每次对话都调 LLM（75% 空提取）；只取最近 10 条；领域推断用硬编码字典 | 预检机制 + 批量提取 + LLM 驱动领域推断 |
| 2. STMP 存储 | 知识节点 → SQLite | ★★★★☆ | 写入/读取快，衰减合理 | 无大问题 |
| 3. 领域成长判定 | 知识量 → 阶段 | ★☆☆☆☆ | mature 需 500 条 + depthScore 0.85（线性 +0.01/次），等 100+ 天 | 新增 trainable 阶段（100 条即可训练） |
| 4. 训练数据导出 | 知识节点 → JSONL | ★★☆☆☆ | output 是一句话（无推理链），input 永远为空，instruction 用通用模板 | 改为问答对 + Self-Instruct 扩增 + 推理链 |
| 5. 云端训练 | JSONL → 权重 | ☆☆☆☆☆ | 代码写好了但没对接具体云服务 | 选定硅基流动/AutoDL 对接 |
| 6. 本地权重 | safetensors → 推理 | ☆☆☆☆☆ | 只有下载管理，无加载逻辑 | Ollama/llama.cpp LoRA 加载 |

**效率改进预期**：

| 指标 | 改进前 | 改进后 | 提升 |
|------|--------|--------|:---:|
| trainable 门槛 | 500 条 / 100+ 天 | 100 条 / 10-20 天 | **5x** |
| 有效提取率 | 25%（75% 空提取浪费） | ~80%（预检过滤） | **3x** |
| 1 条知识 → 训练样本 | 1 → 1 | 1 → 5-10（Self-Instruct） | **5-10x** |
| 训练数据质量 | 格式正确但无推理 | 问答对 + 推理链 + 质量评估 | **2-3x** |
| 等待期用户体验 | 无 LoRA = 无感 | Prompt Injection 70-80 分 | **0→70** |

## 附录 B：基座模型在 LoRA 产线中的 6 个角色

基座模型不只是 LoRA 的最终目标，它是整条产线的核心工具：

```
┌──────────────────────────────────────────────────────────────────┐
│                      基座模型 (LLM)                              │
│                                                                  │
│  既是发动机，也是工程师，也是质检员                                │
└────────────┬──────────┬──────────┬──────────┬──────────┬─────────┘
             │          │          │          │          │
          采访官      蒸馏器      扩增器     质检员    推理链生成器
```

| 角色 | 职责 | 当前状态 | Phase 4 改进 |
|------|------|:---:|:---:|
| **采访官** | 识别知识缺口，生成针对性追问问题 | ❌ 无 | 4a |
| **蒸馏器** | 从对话提炼洞察（本质 > 原文） | ⚠️ 抄写模式 | 4b |
| **扩增器** | Self-Instruct：1 条知识 → 5+ 训练样本 | ❌ 无 | 4a |
| **质检员** | 评估训练数据就绪度，给出改进建议 | ⚠️ 纯格式评分 | 4b |
| **仿真器** | LoRA 之前用 Prompt Injection 模拟专家 | ✅ 已有 | — |
| **推理链生成器** | 为训练数据补充 CoT，提升泛化能力 | ❌ 无 | 4b |

**核心洞察**：把 LLM 当"工人"用，而不是只当"产品"卖。基座模型见过海量知识，天然知道一个领域的知识结构应该长什么样——这个能力应该被用来加速知识采集，而不是等知识攒够了才用。

---

*v1.6 — 2026-04-23 | Phase 7 通信层强化从"5 模块拆分"重构为"事件驱动管道"架构：单文件 BuddyLink，4 层管道，12 项能力全保留，管道扩展机制。工作量从 25 天降至 15 天。详见 COMMUNICATION_UPGRADE_PLAN.md v3。*
