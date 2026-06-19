# Buddy 模块架构

> 后端 125 个源文件，~33,900 行代码 | 前端 42 个模块，~10,400 行代码 | 测试 42 个文件，~11,000 行

## 核心入口

```
src/main.ts          — CLI 入口（init / status / 交互模式）
src/start-ws.ts      — WebSocket 服务入口
src/core/agent.ts    — BuddyAgent 主类（串联所有子系统）
src/config.ts        — 配置管理（~/.buddy/config.json）
```

## 模块地图

```
src/
├── core/                — 核心引擎（15 文件）
│   ├── agent.ts         — 主类：消息处理、工具拦截、事件分发
│   ├── llm.ts           — LLM 适配器：多 Provider + 流式 + Function Calling
│   ├── subsystems.ts    — 子系统容器：统一初始化 30+ 模块
│   ├── provider-registry.ts — Provider 注册表（OpenAI/DeepSeek/Anthropic/Google/Ollama/Custom）
│   ├── message-processor.ts — 消息处理管线：Prompt 预算管理 + 上下文组装
│   ├── prompt-budget.ts — Token 预算分配器（优先级驱动）
│   ├── universal-tool-caller — 通用工具调用（不支持 Function Calling 的模型降级路径）
│   ├── response-normalizer.ts — 响应格式统一
│   ├── intent-classifier.ts — 意图分类
│   ├── behavior-tracker.ts — 行为追踪
│   ├── skill-ops.ts     — 能力包操作（STMP→包重建）
│   ├── ws-handler.ts    — WebSocket 消息处理
│   ├── db-manager.ts    — 数据库统一管理（备份/恢复/状态）
│   ├── constants.ts     — 安全规则 + 工具确认逻辑
│   ├── conversation-state-machine.ts — 对话状态机（idle→discussing→confirming→executing→done）
│   └── capability-scheduler.ts — 能力协同调度器（五维能力动态组合）
│
├── memory/              — 记忆系统（3 文件）
│   ├── store.ts         — SQLite + FTS5 全文搜索（对话/记忆/日记/关系）
│   ├── stmp.ts          — STMP 时空记忆宫殿（房间+概念星图+时间轴导航）
│   └── dream.ts         — 梦境巩固引擎（回放/提取/关联/修剪）
│
├── cognitive/           — 认知架构（1 文件）
│   └── engine.ts        — 用户模型 + 自我模型 + 意图引擎（SQLite 持久化）
│
├── knowledge/           — 知识系统（2 文件）
│   ├── extractor.ts     — 六类隐性知识提取 + 领域画像
│   └── learn.ts         — 文件/URL/文本学习
│
├── intelligence/        — 自产智能引擎 ★（15 文件）
│   ├── index.ts         — ExperienceEngine 统一入口
│   ├── experience-graph.ts    — 经验图谱（节点=经验单元，边=关联）
│   ├── experience-compiler.ts — 经验编译器（对话→经验单元）
│   ├── experience-router.ts   — 经验路由器（置信度分级决策）
│   ├── experience-executor.ts — 经验执行器（确定性工具执行）
│   ├── experience-evolver.ts  — 经验进化器（积累/合并/淘汰）
│   ├── check-function.ts      — 验证函数
│   ├── metrics.ts             — 量化指标采集
│   ├── prompt-injector.ts     — Prompt 知识注入
│   ├── training-exporter.ts   — 训练数据导出（JSONL）
│   ├── knowledge-interviewer.ts — 主动提问引擎
│   └── types.ts               — 类型定义
│
├── skills/              — 能力包系统（10 文件）
│   ├── skill-manager.ts     — 动态 Skill 加载（.skillmate 声明式工具）
│   ├── index.ts             — ExperiencePackageManager
│   ├── scheduler.ts         — 调度器
│   ├── evaluator.ts         — 评估器
│   ├── export.ts            — 导出器
│   ├── version.ts           — 版本管理
│   ├── radar.ts             — 质量雷达
│   ├── feedback.ts          — 反馈学习
│   └── share-network.ts     — 分享网络
│
├── orchestrate/         — DAG 工作流编排（8 文件）
│   ├── dag.ts               — DAG 数据结构 + 拓扑排序
│   ├── planner.ts           — LLM 驱动的任务规划器
│   ├── executor.ts          — 任务执行器（条件分支/重试/超时/并行）
│   ├── workflow-manager.ts  — 工作流 CRUD + 执行历史
│   ├── dag-compiler.ts      — 经验→DAG 编译
│   ├── workflow-dag-adapter.ts — 工作流适配器
│   └── types.ts             — Task/TaskDAG/ConditionEdge 等类型
│
├── project/             — 项目大脑（8 源文件 + 6 测试）
│   ├── types.ts             — Project/Plan/Decision/Artifact/Lesson 等类型
│   ├── store.ts             — SQLite 存储引擎（8 表 + FTS5 + Migration）
│   ├── plan-manager.ts      — 方案管理（CRUD + 版本链 + 决策记录 + Diff）
│   ├── progress-tracker.ts  — 进度追踪（检查点 + EWMA 估算）
│   ├── execution-manager.ts — 执行管理（DAG 绑定 + 暂停/恢复 + 自动检查点）
│   ├── artifact-manager.ts  — 产出物管理（版本链 + Diff）
│   ├── lesson-system.ts     — 教训系统（提取 + 编译→经验图谱）
│   ├── cross-project.ts     — 跨项目（相似度查找 + 教训注入 + 经验摘要）
│   ├── search.ts            — FTS5 全文搜索封装
│   └── integration.ts       — STMP/Dream/Cognitive 集成桥接
│
├── tools/               — 工具系统（19 源文件 + 3 测试）
│   ├── registry.ts          — 工具注册表（权限过滤+缓存）
│   ├── builtin.ts           — 内置工具汇总入口（聚合所有工具集，导出 ALL_TOOLS 数组）
│   ├── sandbox.ts           — 命令执行沙箱（白名单+超时+资源限制）
│   ├── web.ts               — 网络工具（search_web / fetch_url）
│   ├── code-intel.ts        — 代码智能（analyze_file / find_references）
│   ├── browser.ts           — 浏览器自动化（screenshot / extract / pdf）
│   ├── screen.ts            — 屏幕 RPA（capture / ocr / describe）
│   ├── project.ts           — 项目扫描 + 索引（6 个工具）
│   ├── project-index.ts     — 项目代码索引引擎（符号/依赖/上下文生成）
│   ├── git-ops.ts           — Git 高级操作（commit / branch / merge / push）
│   ├── mcp-adapter.ts       — MCP 协议适配器（JSON-RPC stdio，6 个预置 Server）
│   ├── mcp-registry.ts      — MCP 服务器发现（Smithery 市场搜索）
│   ├── voice.ts             — 语音工具（tts_speak / tts_voices / tts_status，工厂函数）
│   ├── ternary-expert.ts    — 三进制专家路由（类，非 ToolDef）
│   ├── tool-chain.ts        — 工具链组合执行（类，非 ToolDef）
│   ├── tool-retriever.ts    — 工具智能检索（按查询推荐工具子集）
│   ├── cache.ts             — 工具结果缓存（LRU + TTL）
│   └── workflows.ts         — 工作流模板数据（9 个预定义模板，非 ToolDef）
│
├── pet/                 — 养成系统（2+ 文件）
│   ├── manager.ts           — 功能探索图谱 + 引导引擎 + 行为涌现
│   └── types.ts             — 27 个功能节点 + 进化表 + 物种表 + 视觉种子
│
├── emotion/             — 情绪系统（1 文件）
│   └── engine.ts            — mood/energy/satisfaction 状态机（8 种情绪）
│
├── personality/         — 人格系统（1 文件）
│   └── prompt.ts            — 5 维属性→自然语言 Prompt 注入
│
├── behavior/            — 行为系统（1 文件）
│   └── idle.ts              — 空闲行为（blink/think/yawn 等）
│
├── brain/               — 三脑架构 + 影子大脑（30+ 文件）★
│   ├── brain.ts           — ThreeBrain 编排器：decide/feedback/heartbeat 三脑协作
│   ├── types.ts           — 共享类型（TaskSignal/BodyState/Rule/TrainingSample 等）
│   ├── left/              — 左脑：理性决策脑
│   │   ├── rule-engine.ts     — 规则引擎（8 条内置 + 学习 + 否定 + 淘汰）
│   │   ├── scheduler.ts       — 统一调度器（四层新颖度路由 + Thompson Sampling + 元认知）
│   │   ├── policy-distiller.ts— 策略蒸馏器（聚类 → 正/否定规则）
│   │   └── decision-memory.ts — 决策记忆（JSONL + kNN + 聚类 + 反事实）
│   ├── right/             — 右脑：直觉学习脑
│   │   ├── nn/              — 手写 NN 内核（Tensor + Attention + FFN + Encoder + 5 输出头）
│   │   ├── training/        — 在线学习（ReplayBuffer + SGD + LPR 防遗忘 + 课程学习）
│   │   └── features/        — 特征编码（结构化/空间/图像/场景多模态编码器）
│   ├── cerebellum/        — 小脑：本体感知 + 稳态调节
│   │   ├── body-state.ts    — 本体状态机（情绪 Buff + OCEAN 人格 + 欲望计算）
│   │   ├── homeostasis.ts   — 稳态调节器（4 条 PID 回路）
│   │   ├── sensor-fusion.ts — 感知融合（多源 → BodyEvent）
│   │   ├── motor-control.ts — 运动控制（空闲 + 主动行为）
│   │   └── adaptive/        — 自适应层（节律/习惯/误差调谐）
│   ├── convergence/       — 信号汇聚层（4 Sink + 优先级排序）
│   └── shadow/            — 影子大脑：自我迭代基础设施 ★ Phase 9
│       ├── index.ts           — ShadowBrainOrchestrator 编排器
│       ├── gap-detector.ts    — 能力缺口检测（连续失败 + 低置信度）
│       ├── evolution-engine.ts— 进化引擎（L1 规则/L2 参数/L3 结构）
│       ├── timing-controller.ts— 时机控制器（负载/样本/稳定性/间隔/窗口）
│       ├── evolution-lock.ts  — 进化锁（GDI + CPS + 回归 + 人工审批）
│       ├── state-manager.ts   — 状态管理（版本存档/日志/能力图谱）
│       └── ab-recorder.ts     — A/B 对比记录器
│
├── perception/          — 感知层（5 文件）
│   ├── observer.ts          — 环境观察器（模式检测/时间关怀）
│   ├── fs-watcher.ts        — 文件变更监听
│   ├── event-bus.ts         — 事件总线
│   └── privacy.ts           — 隐私保护
│
├── ws/                  — WebSocket 服务（1 文件）
│   └── server.ts            — EventBus：WS 服务器 + HTTP REST + Token 认证 + Rate Limiting
│
├── social/              — 社交系统（4 文件）
│   ├── friends.ts           — 好友系统
│   ├── buddy-interact.ts    — Buddy 互访/互动
│   └── platform.ts          — 多平台适配（CLI/Telegram/Discord）
│
├── billing/             — 商业化（5 文件）
│   ├── subscription.ts      — 订阅管理
│   ├── entitlements.ts      — 权益检查
│   ├── payment.ts           — 支付
│   └── lora-interface.ts    — LoRA 接口定义
│
├── shop/                — 商城（1 文件）
│   └── catalog.ts           — 商品目录 + 购买 + 库存
│
├── lora/                — LoRA 微调服务（2 文件）
│   ├── index.ts             — 入口
│   └── service.ts           — 云端训练对接 + 本地权重管理
│
├── ternary/             — 三进制微模型（20 文件）
│   ├── format.ts            — .ta 格式定义
│   ├── tokenizer.ts         — 分词器
│   ├── engine.ts            — 推理引擎
│   ├── trainer.ts           — 增量训练
│   ├── distill.ts           — 蒸馏管线
│   ├── optimizer.ts         — 优化器
│   ├── compute.ts           — 三进制计算
│   ├── codec.ts             — 编解码
│   ├── architecture.ts      — 架构定义
│   ├── cloud-trainer.ts     — 云端训练
│   ├── eval.ts              — 评估
│   ├── growth.ts            — 增长
│   ├── manager.ts           — 管理器
│   ├── scheduler.ts         — 调度器
│   └── distill-prep.ts      — 蒸馏准备
│
├── voice/               — 语音后端（3 文件）
│   ├── tts.ts               — TTS 管理器
│   └── edge-tts.ts          — Edge TTS 后端
│
├── audit/               — 审计日志（1 文件）
├── perf/                — 性能（LRUCache）
├── launch/              — 上线就绪检查
├── feedback/            — 反馈学习
├── env/                 — 环境检测
└── errors.ts            — 错误分类
```

## 前端结构

```
frontend/src/
├── App.tsx              — 主应用（Tab 导航：chat/stats/vision/sensors/cognitive）
├── main.tsx             — 入口
├── components/
│   ├── ChatPanel.tsx        — 聊天面板
│   ├── MessageBubble.tsx    — 消息气泡
│   ├── InputBar.tsx         — 输入栏
│   ├── PetStats.tsx         — 养成状态
│   ├── SpriteRenderer.tsx   — 精灵渲染（PIXI.js）
│   ├── VisionPanel.tsx      — 视觉面板
│   ├── SensorPanel.tsx      — 传感器面板
│   ├── CognitiveDashboard.tsx — 认知仪表盘
│   ├── Onboarding.tsx       — 引导流程
│   ├── AchievementsPanel.tsx — 成就面板
│   ├── ExplorationMap.tsx   — 探索地图
│   └── Experts.tsx          — 专家面板
├── hooks/
│   └── useWebSocket.ts      — WebSocket 连接管理
├── sensors/             — 设备传感器（5 模块）
├── vision/              — 视觉系统（8 模块）
├── voice/               — 语音前端（7 模块）
├── types/
└── utils/
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端运行时 | Node.js 22+ / ESM / TypeScript |
| LLM SDK | Vercel AI SDK（@ai-sdk/openai, deepseek, anthropic, google） |
| 数据库 | better-sqlite3（WAL 模式，5 个独立 DB） |
| 通信 | WebSocket (ws) + HTTP REST |
| 前端 | React 19 + Vite + TypeScript |
| 渲染 | PIXI.js（精灵动画） |
| 测试 | Vitest |
| 构建 | TypeScript compiler + Vite |
| 容器化 | Docker + Docker Compose |
| 桌面 | Electron |

## 数据存储

| 数据库 | 路径 | 用途 |
|--------|------|------|
| memory.db | ~/.buddy/ | 对话历史 + 长期记忆 + 日记 + FTS5 索引 |
| stmp.db | ~/.buddy/ | STMP 时空记忆宫殿（房间+节点+星图） |
| cognitive.db | ~/.buddy/ | 用户模型 + 自我模型 + 领域画像 |
| pet.db | ~/.buddy/ | 养成数据（进化/功能/行为/属性） |
| billing.db | ~/.buddy/ | 订阅 + 权益 + 交易 |

## 安全架构

- **工具权限系统**：5 级信任度（stranger → soulmate），按亲密度动态解锁
- **工具执行拦截**：高危操作需用户确认（WS 推送确认请求 / CLI 交互确认）
- **沙箱执行**：Shell 命令白名单 + 超时 + 资源限制
- **路径保护**：敏感路径（.ssh, .env, 私钥等）拒绝访问
- **WS 认证**：Token 认证 + Rate Limiting（10s/30 条）
- **Prompt 注入防御**：外部内容标记，系统指令不可被覆盖

## 内置工具列表

| 工具 | 功能 | 权限 |
|------|------|------|
| read_file | 读取文件 | read_files |
| write_file | 写入/创建文件 | write_files |
| list_files | 列出目录 | read_files |
| search_files | 文件内容搜索 | read_files |
| exec | 执行 Shell 命令（沙箱） | exec_safe |
| git_status | Git 状态 | read_files |
| git_log | Git 提交历史 | read_files |
| git_diff | Git 差异 | read_files |
| git_commit | Git 提交 | write_files |
| git_branch | Git 分支管理 | write_files |
| git_merge | Git 合并 | write_files |
| git_push | Git 推送 | exec_safe |
| get_time | 获取当前时间 | basic |
| search_web | 网络搜索 | web_search |
| fetch_url | 抓取网页内容 | web_search |
| analyze_file | 代码分析 | read_files |
| find_references | 查找引用 | read_files |
| browser_screenshot | 浏览器截图 | exec_safe |
| browser_extract | 浏览器内容提取 | exec_safe |
| browser_pdf | 浏览器导出 PDF | exec_safe |
| screen_capture | 屏幕捕获 | exec_safe |
| screen_ocr | 屏幕 OCR | exec_safe |
| screen_describe | 屏幕描述 | exec_safe |
| tts_speak | 文字转语音 | exec_safe |
| tts_voices | 列出可用音色 | basic |
| tts_status | TTS 系统状态 | basic |
| scan_project | 项目扫描 | read_files |
| project_context | 生成项目上下文 | read_files |
| project_symbols | 搜索项目符号 | read_files |
| project_deps | 项目依赖分析 | read_files |
| project_index_stats | 索引统计 | read_files |
| project_index_rebuild | 重建索引 | read_files |

**ProjectModel 工具（28 个）**：

| 工具 | 描述 | Sprint |
|------|------|--------|
| project_create | 创建项目 | 1 |
| project_list | 列出项目 | 1 |
| project_get | 项目详情 | 1 |
| project_update | 更新项目 | 1 |
| project_delete | 删除项目 | 1 |
| plan_create | 创建方案 | 2 |
| plan_new_version | 方案新版本 | 2 |
| plan_get_versions | 方案版本链 | 2 |
| plan_diff | 方案版本对比 | 2 |
| decision_record | 记录决策 | 2 |
| execution_start | 开始执行 | 3 |
| execution_pause | 暂停执行 | 3 |
| execution_resume | 恢复执行 | 3 |
| execution_complete | 完成执行 | 3 |
| step_done | 步骤完成 | 3 |
| step_fail | 步骤失败 | 3 |
| step_skip | 步骤跳过 | 3 |
| execution_status | 执行状态 | 3 |
| checkpoint_create | 创建检查点 | 3 |
| checkpoint_list | 列出检查点 | 3 |
| artifact_create | 创建产出物 | 4 |
| artifact_update | 更新产出物 | 4 |
| artifact_list | 列出产出物 | 4 |
| artifact_diff | 产出物对比 | 4 |
| lesson_record | 记录教训 | 4 |
| lesson_list | 列出教训 | 4 |
| lesson_compile | 编译教训 | 4 |
| lesson_compile_all | 批量编译 | 4 |
| cross_project_find | 查找相似项目 | 5 |
| cross_project_inject | 注入历史教训 | 5 |
| project_search | 全文搜索 | 5 |
| project_search_rebuild | 重建搜索索引 | 5 |
| project_stats | 项目统计 | 5 |

> 注：实际工具总数还包括动态加载的 .skillmate 工具（27 个）和 MCP Server 工具（6 个预置 Server，每个提供若干工具）。

## .skillmate 动态工具

位于 `skills/` 目录，声明式 JSON 工具定义，启动时自动扫描加载：

`process_list`, `hash_compute`, `dependency_audit`, `image_resize`, `video_cut`, `pdf_extract`, `system_info`, `docker_ps`, `subtitle_extract`, `github_info`, `base64_tool`, `run_tests`, `video_concat`, `audio_info`, `video_info`, `disk_usage`, `json_query`, `weather`, `video_extract_audio`, `image_convert`, `log_tail`, `port_check`, `lint_check`, `video_speed`, `npm_run`, `format_code`, `video_to_gif`

## 对话状态机

**文件**: `src/core/conversation-state-machine.ts`

管理对话生命周期：`idle → discussing → confirming → executing → done`

```
用户: "我想做一款游戏"
  → idle → discussing（最多问 2 个问题）

用户: "roguelike 卡牌，TypeScript"
  → discussing → confirming（输出方案摘要）

用户: "好，开始吧"
  → confirming → executing（三脑分配资源，调用工具）

执行成功 → executing → done
执行失败 → executing → discussing（重试）
```

**集成点**:
- `MessageProcessor.buildContext()` — 注入阶段 Prompt（priority=82）
- `SignalCollector.collectPerceptionState()` — taskType 提升
- `ThreeBrain.decide()` — 对话阶段影响审议/法则决策
- `PlanExecutor.executeByPlan()` — 执行结果回调状态转换

**详细分析**: [docs/conversation-state-machine-analysis.md](docs/conversation-state-machine-analysis.md)
