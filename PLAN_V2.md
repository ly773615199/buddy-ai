# Buddy v2.2 — 有形象的个人 AI 助手 + 专业知识数字化

> 你的 AI 助手，但它不是冷冰冰的对话框 — 它有脸、有性格、记得你做过的一切，还会做梦，还能把你学到的东西打包分享。

---

## 一、产品定义

### 1.1 一句话

**你的 AI 助手，有形象、有性格、有能力、有记忆 — 你看到的不是一个对话框，而是一个"活的"伙伴在帮你做事。**

### 1.2 核心定位

```
ChatGPT   — 能力很强，但没有脸，不会积累你的经验
虚拟主播   — 有脸有性格，但没有能力
桌面宠物   — 有脸能卖萌，但什么都不会
SkillMate — 能积累专业知识，但没有形象和情感

Buddy     — 有脸、有性格、有能力、有记忆、有自我意识、能知识变现
           = Agent 级能力 + 虚拟形象 + 时空记忆宫殿 + 认知架构 + 知识提取与能力包
```

### 1.3 核心价值排序

```
优先级 1：AI 助手能力    → 解决"能不能用"的问题（Agent 级工具调用）
优先级 2：个人化（记忆）  → 解决"为什么用你而不用 ChatGPT"的问题
优先级 3：认知架构       → 解决"为什么觉得你是伙伴而非工具"的问题
优先级 4：知识提取 ★NEW → 解决"能不能把经验变成资产"的问题
优先级 5：形象 & 性格    → 解决"为什么长期用"的问题
优先级 6：养成 & 收集    → 解决"为什么不卸载"的问题（锦上添花）
优先级 7：能力市场       → 解决"能不能变现"的问题（远期生态）

### 1.4 竞品坐标

```
                    有形象
                      ↑
                      │
      虚拟主播         │        ★ Buddy
      (有脸无能力)     │       (有脸+有能力+有记忆+有认知)
                      │
    ←─────────────────┼──────────────────→
      无记忆           │           有记忆
                      │
      ChatGPT/DeepSeek │       OpenClaw
      (有能力无形象)    │       (有能力有记忆无形象)
                      │
                    无形象
```

### 1.5 目标用户

```
第一批：开发者/程序员（种子用户）
├── 编程场景天然契合（代码执行/Git 感知/文件操作）
├── 对 AI 接受度高，愿意配置 API Key
├── 社区传播力强
└── 痛点明确：ChatGPT 没有上下文感知，每次重新解释

第二批：泛科技用户
├── AI 创作爱好者
├── 数字宠物/养成游戏玩家
└── 社交媒体活跃用户

第三批：大众用户
├── 通过社交分享/零门槛 Web 版引入
└── "输入一句话就有专属宠物"
```

---

## 二、架构设计

### 2.1 核心原则

```
1. 自包含 — 不依赖 OpenClaw 或任何重框架，独立运行
2. 极简安装 — 一条命令 / 一个安装包 / 打开网页
3. 能力对标 OpenClaw — Agent 级工具调用，但包装得更友好
4. 形象即产品 — 不是后加的皮肤，是产品本身
5. 认知即壁垒 — 记忆不只是存储，是有结构的理解
```

### 2.2 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Buddy 应用                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  前端展示层                                               │  │
│  │  Web (PixiJS) │ 桌面端 (Electron/Tauri) │ CLI            │  │
│  │                                                            │  │
│  │  ├ 精灵形象渲染（状态切换 + 帧动画 + 粒子）               │  │
│  │  ├ 对话界面（消息流 + 工具执行可视化）                     │  │
│  │  ├ 交互系统（摸头/点击/拖拽）                             │  │
│  │  ├ 梦境日志展示（"昨晚我做梦了..."）                      │  │
│  │  └ 设置面板（API Key / 性格 / 偏好）                      │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │ WebSocket / 事件流                    │
│  ┌──────────────────────▼───────────────────────────────────┐  │
│  │  认知层（Cognitive Layer）★ NEW                            │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  用户模型    │  │  自我模型    │  │  意图引擎        │   │  │
│  │  │ (他是谁)    │  │ (我是谁)    │  │ (我想做什么)    │   │  │
│  │  │             │  │             │  │                 │   │  │
│  │  │ 身份/行为/  │  │ 能力认知/   │  │ 微目标/好奇心/  │   │  │
│  │  │ 偏好/关系/  │  │ 经历叙事/   │  │ 主动性判断      │   │  │
│  │  │ 演化历史    │  │ 情绪状态/   │  │                 │   │  │
│  │  │             │  │ 自我反思    │  │                 │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │  │
│  │         │                │                   │            │  │
│  │         └────────────────┼───────────────────┘            │  │
│  │                          │                                 │  │
│  │  ┌──────────────────────▼──────────────────────────────┐  │  │
│  │  │  STMP 时空记忆宫殿（Spatial-Temporal Memory Palace） │  │  │
│  │  │                                                      │  │  │
│  │  │  ├ 空间层：房间系统（按项目/话题划分）                │  │  │
│  │  │  ├ 时间层：时间轴（每个房间内的时间线）               │  │  │
│  │  │  ├ 语义层：概念星图（概念之间的关系网络）             │  │  │
│  │  │  ├ 生命周期：Ebbinghaus 衰减 + 压缩 + 休眠          │  │  │
│  │  │  └ 梦幻巩固：闲时自动回放/提取/关联/修剪             │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Agent 引擎（内置，自包含）                                  │  │
│  │                                                            │  │
│  │  ├ LLM 对话                                                │  │
│  │  │  ├ 多后端适配（OpenAI / DeepSeek / Ollama / MiMo...）  │  │
│  │  │  ├ 流式输出（SSE）                                      │  │
│  │  │  ├ Function Calling 统一格式                             │  │
│  │  │  └ 降级策略（LLM → 语录 → 离线）                        │  │
│  │  │                                                         │  │
│  │  ├ Tool Use 框架                                           │  │
│  │  │  ├ 文件系统：读 / 写 / 搜索 / 目录遍历                  │  │
│  │  │  ├ 代码执行：Shell 命令（沙箱 + 超时控制）               │  │
│  │  │  ├ 网络能力：搜索 / 网页抓取 / API 调用                 │  │
│  │  │  ├ 知识投喂：buddy learn（文件/URL/文本）               │  │
│  │  │  ├ 代码理解：分析结构 / 查找引用                         │  │
│  │  │  ├ 项目感知：自动扫描项目结构                            │  │
│  │  │  └ 消息通信：通知 / 日程（后期）                        │  │
│  │  │                                                         │  │
│  │  └ 安全机制                                                │  │
│  │    ├ 信任度分级（0-100，5 级权限）                         │  │
│  │    ├ 危险操作拦截（正则匹配 + 敏感路径）                   │  │
│  │    ├ 沙箱执行（工作目录隔离 + 超时 + 输出限制）            │  │
│  │    └ 操作审计日志                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 前端 ↔ 后端通信

```
后端执行任务时，通过 WebSocket 事件流通知前端状态变化：

后端事件                    前端表现
─────────                  ────────
user_message               精灵 → 思考状态
thinking                   精灵 → 思考动画 + "让我看看..."
tool_call: read_file       精灵 → 执行状态（翻文件）
tool_call: exec            精灵 → 执行状态（敲键盘）
tool_call: web_search      精灵 → 执行状态（戴侦探帽）
tool_result: success       精灵保持执行状态
tool_result: error         精灵 → 出错状态（😰）
llm_response               精灵 → 说话状态 + 气泡显示回复
dreaming                   精灵 → 闭眼 + ZZZ 粒子
idle                       精灵 → 空闲（偶尔眨眼/东张西望）

前端不需要理解后端逻辑，只响应状态事件。
后端不需要关心渲染细节，只发事件。
两层解耦。
```

### 2.4 能力对标 OpenClaw

| OpenClaw 能力 | Buddy 实现方式 | 差异处理 |
|--------------|---------------|---------|
| 多 LLM 后端 | 直接调 API，统一接口层 | 一样 |
| 文件读写 | 内置 fs 模块，沙箱内执行 | 一样 |
| 代码执行 | 内置 child_process，超时+隔离 | 一样 |
| 网络搜索 | 调搜索引擎 API（Brave/Serper/免费额度） | 需额外 Key |
| 网页抓取 | 内置 fetch + HTML 解析 | 一样 |
| 浏览器控制 | 可选集成 Playwright | 轻量版先不做 |
| 记忆系统 | **STMP 时空记忆宫殿** | **独有架构** |
| 认知系统 | 用户模型 + 自我模型 + 意图引擎 | **独有** |
| 多会话管理 | 单用户，简化为多线程对话 | 够用 |
| 定时任务 | 内置 cron 调度 | 一样 |
| 消息平台接入 | 后期加（微信/Telegram/Discord） | 先不做 |
| 安装部署 | 一条命令 / 一个安装包 | **更简单** |

### 2.5 安装体验

```
方式一：npm（开发者）
$ npm install -g @buddy/ai
$ buddy init          → 选模型 → 填 Key → 选性格
$ buddy start         → 浏览器自动打开，看到你的 Buddy

方式二：桌面应用（所有人）
  下载 → 安装 → 首次启动引导（选模型/填Key/选性格）→ 屏幕角落出现 Buddy

方式三：Web 版（零安装）
  打开 buddy.ai → 登录 → 开始用（平台内置模型额度）
```

---

## 三、核心功能

### 3.1 AI 助手能力（P0 — 必须有）

> 用户打开 Buddy，能用它完成真实任务。

```
对话系统
├ 自然语言交互，支持上下文
├ 多轮对话，记住上文
├ 流式输出（打字机效果）
└ 工具调用过程可视化

文件操作
├ 读取文件内容
├ 写入/创建文件
├ 搜索文件（按名/按内容）
├ 目录遍历
└ 文件变更监听

代码执行
├ Shell 命令执行
├ 多语言支持（Node/Python/Go/...）
├ 超时控制（防止死循环）
├ 输出长度限制（防止 token 爆炸）
├ 输出实时回传
└ 沙箱隔离

网络能力
├ 网页搜索（Brave / Serper / DuckDuckGo）
├ 网页内容抓取 + 解析
├ API 调用
└ URL 内容摘要

知识投喂（★ NEW）
├ buddy learn <file>    — 从文件学习
├ buddy learn <url>     — 从网页学习
├ 对话中 "记住这个"     — 实时抽取存入
├ RAG 知识库检索        — 自动注入相关知识
└ 支持格式：代码/文档/PDF/JSON/YAML/URL

代码理解（★ NEW）
├ analyze_file          — 分析文件结构（导出/导入/函数/类）
├ find_references       — 查找符号在项目中的引用
├ scan_project          — 扫描项目结构（框架/语言/依赖/目录）
└ detect_pattern        — 识别代码模式和风格

系统感知
├ Git 状态（branch/diff/log）
├ 当前目录/文件
├ 系统时间
└ 环境信息
```

### 3.2 个人化（P1 — 好用）

> 同样的能力，但体验完全不同于通用 AI。

```
STMP 时空记忆宫殿（★ 核心算法，详见第七章）
├ 空间层：按项目/话题划分"房间"
├ 时间层：每个房间有自己的时间轴
├ 语义层：概念星图（关系网络，不只是向量相似度）
├ 4 步检索：定位房间 → 时间导航 → 语义扩展 → 叙事组装
└ 生命周期：Ebbinghaus 衰减 + 自动压缩 + 休眠唤醒

梦幻记忆巩固（★ 独一无二，详见第八章）
├ 触发：空闲/定时/记忆溢出
├ 回放：重演近期记忆，强化重要连接
├ 提取：从碎片中提炼通用模式
├ 关联：随机漫步发现隐藏联系
├ 修剪：压缩冗余 + 遗忘低价值
└ 梦境日志：用梦幻语气记录巩固过程

认知架构（★ 三层，详见第九~十一章）
├ 用户模型：他是谁 / 怎么做事 / 喜欢什么
├ 自我模型：我能做什么 / 我经历了什么 / 我在想什么
└ 意图引擎：我想做什么 / 我好奇什么 / 我什么时候该主动说

性格系统
├ 5 维属性：毒舌/智慧/混乱/耐心/调试
├ 属性 → Prompt 参数映射
├ 物种特质加成
├ 性格影响回复风格/语气/长度/时机
└ 不同性格 = 不同体验

主动感知
├ 终端报错 → 主动吐槽/建议
├ Git commit → 评价工作
├ 深夜 (23:00+) → 关怀提醒
├ 空闲 5 分钟+ → 随机搭话
└ 文件变化 → 观察/建议

信任度系统
├ 0-20  陌生人：只聊天，不能操作
├ 21-50 认识了：可以读文件
├ 51-80 朋友：可以读写文件，发消息需确认
├ 81+   挚友：自动执行任务，事后汇报
└ 信任靠赚，不靠给
```

### 3.3 形象 & 交互（P2 — 好玩）

> 有了能力基础，让 Buddy 真正"活"起来。

```
形象系统
├ AI 生成：用户一句话描述 → 生成专属精灵
├ 风格库：像素风 / 卡通风 / 水彩风 / 赛博风 / ...
├ 4 候选选择 + 微调
├ 自动生成动画帧（idle/说话/执行/出错）
└ 灵魂与肉身分离：数值走规则，外观走自由

动画系统
├ 帧动画：idle 循环 / 说话 / 思考 / 执行任务
├ 表情系统：6 种基础表情
├ 粒子特效：爱心/星星/光环
├ 场景系统：昼夜循环 / 天气效果
└ 进化动画：全屏渐白 + 揭晓

互动系统
├ 摸头：点击/按住/连点，不同反应
├ 对话气泡：字一个一个蹦出
├ 情绪系统：开心/担心/困/骄傲/生气
├ 主动行为：蹭鼠标/挥手/趴着睡觉
├ 点击反馈：冒爱心/说话/表情变化
└ 做梦状态：闭眼 + ZZZ 粒子（巩固记忆时）

养成系统 v2 — 养成即引导（详见第十八章）
├ 功能探索图谱：25个功能节点，追踪用户探索了产品的哪些能力
├ 能力解锁门控：探索完成度触发进化，解锁的是真正的新功能
├ 引导引擎：动态推荐下一个未探索的功能，取代通用成就
├ 5维属性行为涌现：毒舌/智慧/混乱/耐心/调试 从使用中自动计算
├ 亲密度 = 使用深度：功能广度/使用深度/连续天数，取代摸头+1
└ 进化 6 阶段：🥚蛋→🐣幼年→🦊成长→🐺成熟→🐲完全→🌟传说
   （触发条件=探索完成度，不再是经验值够了就升级）
```

### 3.4 生态（P3 — 规模化）

```
多精灵收集（最多 20 只）
├ 扭蛋/孵化系统
├ 稀有度（Common → Legendary）
├ 每只独立性格/记忆/进化
└ 主力精灵切换

社交功能
├ 好友系统
├ 精灵串门（你的精灵去好友屏幕待一会儿）
├ 精灵合影 + 分享卡片
├ 排行榜（等级/互动/成就）
└ 分享裂变

多平台
├ CLI 终端版（npm install -g buddy）
├ 浏览器插件（GitHub PR Review）
├ 桌面悬浮版
├ 移动端（远期）
└ 消息平台接入（微信/Telegram/Discord）

商业化
├ 免费版：3 精灵 / 基础功能
├ Pro ¥9/月：无限生成 / 完整工具 / 全风格
├ Team ¥29/人/月：团队协作 / 共享知识库
└ 装扮商城 / 赛季活动
```

---

## 四、技术选型

| 模块 | 选型 | 理由 |
|------|------|------|
| 前端框架 | React / Vue 3 | 组件化，生态好 |
| 渲染引擎 | PixiJS (WebGL) | 2D 性能好，跨平台 |
| 桌面端 | Electron / Tauri | 跨平台桌面应用 |
| 后端运行时 | Node.js | JS 全栈，生态丰富 |
| LLM 对话 | 直调 API（统一适配层） | 灵活，不绑定 |
| LLM 流式 | Vercel AI SDK `streamText` | 原生支持 SSE |
| Tool Use | OpenAI Function Calling 格式 | 业界标准 |
| 记忆存储 | SQLite + better-sqlite3 + 图遍历 | STMP 三层结构 |
| 向量检索 | OpenAI Embedding API / 本地 transformers.js | 混合方案 |
| 知识图谱 | SQLite 图表（节点+边+时序） | 轻量，无需 Neo4j |
| 文件操作 | Node.js fs + glob | 原生支持 |
| 代码执行 | child_process（异步 + 沙箱） | 非阻塞 |
| 网络搜索 | Brave/Serper/DuckDuckGo API | 按需配置 |
| 网页解析 | cheerio + html-to-text | 轻量 HTML 解析 |
| 安装分发 | npm + Electron/Tauri 打包 | 开发者+普通用户兼顾 |

---

## 五、灵魂与肉身分离架构

```
┌───────────────────────────────────────────────────┐
│                Buddy 系统                          │
├───────────────────┬───────────────────────────────┤
│   灵魂层（系统）   │    肉身层（用户创造）          │
├───────────────────┼───────────────────────────────┤
│ 5 维属性（确定性） │ 外观形象（AI 生成）           │
│ 用户模型（演化性） │ 风格偏好（用户选择）          │
│ 自我模型（成长性） │ 进化外观（重新生成）          │
│ 意图引擎（主动性） │ 特效装饰（收集制）            │
│ STMP 记忆（时空性）│ 动画表现（AI 补帧）          │
│ 梦幻巩固（自进化） │                               │
└───────────────────┴───────────────────────────────┘

灵魂决定"它是什么样的"，肉身决定"它长什么样"
→ 数值走规则，外观走自由
→ 灵魂会成长，肉身会变化
```

---

## 六、5 维属性系统

### 6.1 属性定义

```
🔧 DEBUGGING  调试能力  → 发现报错的敏感度 / 技术建议质量
🧘 PATIENCE   耐心值    → 陪伴的持久度 / 重复任务容忍度
🌀 CHAOS      混乱指数  → 回复的随机性和创意 / 非常规建议
🦉 WISDOM     智慧值    → 建议的质量 / 分析深度
😏 SNARK      毒舌程度  → 吐槽的犀利度 / 直言不讳程度
```

### 6.2 属性 → Prompt 映射

```typescript
SNARK (毒舌) → 0-100
  0-20:   温和礼貌
  21-40:  略带调侃
  41-60:  适度吐槽
  61-80:  犀利毒舌
  81-100: 嘴上不留情

WISDOM (智慧) → 0-100
  0-20:   新手小白
  21-40:  有点见识
  41-60:  靠谱建议
  61-80:  资深经验
  81-100: 技术大牛

CHAOS (混乱) → 0-100
  0-20:   按部就班
  21-40:  偶尔出格
  41-60:  不按常理
  61-80:  天马行空
  81-100: 混沌邪恶

PATIENCE (耐心) → 0-100
  81-100: 耐心极好
  61-80:  比较宽容
  41-60:  一般般
  21-40:  容易急
  0-20:   一点就炸

DEBUGGING (调试) → 0-100
  0-20:   看不太懂
  21-40:  能发现问题
  41-60:  擅长调试
  61-80:  精准定位
  81-100: 一眼看出根因
```

### 6.3 性格组合示例

```
高毒舌 + 高智慧 = 犀利导师型
  "第 42 行的循环是 O(n²)，你确定要在线上跑这个？用 Map 改一下。"

高毒舌 + 高混乱 = 混沌吐槽型
  "这代码让我想起了我见过的最糟糕的事情...不过居然能跑？！要不加个 TODO？"

低毒舌 + 高智慧 = 温和专家型
  "这里有个潜在的竞态条件，加个锁会比较稳妥。"

高毒舌 + 低耐心 = 暴躁老哥型
  "又报错了？你已经第 8 次改这行了，看一眼报错行不行？"

高混乱 + 低智慧 = 沙雕伙伴型
  "我有个大胆的想法！把整个文件删了重写怎么样？...算了当我没说。"
```

### 6.4 物种特质加成

```
每只精灵有基础物种，物种给属性加成：

鸭子    耐心 +10（脾气好）
大鹅    毒舌 +20 / 耐心 -15（嘴毒脾气差）
猫      毒舌 +15 / 智慧 +5（高冷）
龙      毒舌 +10 / 调试 +15（聪明但傲慢）
幽灵    混乱 +20（神出鬼没）
机器人  调试 +20 / 混乱 -20（精准但死板）
蘑菇    混乱 +15（不可预测）
胖胖    耐心 +20（包容一切）
```

---

## 七、STMP 时空记忆宫殿 ★ 核心算法

> 当前所有 AI Agent 记忆系统都用同一个范式：文本 → Embedding → 向量相似度搜索 → 返回相关片段。
> STMP 是第一个用记忆宫殿范式的 AI Agent 记忆系统：记忆不是靠相似度捞出来的，而是靠位置关系"走"出来的。

### 7.1 与现有方案的本质区别

```
现有方案（向量搜索）：
  query: "React 性能优化"
  → embedding 相似度排序
  → 返回 top-K 最相似的片段
  → ❌ 丢失了记忆之间的关联结构
  → ❌ 丢失了时间演化关系
  → ❌ 无法区分"你知道的"和"你经历过的"

STMP（时空导航）：
  query: "React 性能优化"
  → 1. 定位到 [React项目] 房间
  → 2. 沿时间线找到相关的经验记忆
  → 3. 沿语义星图扩展到关联概念（useMemo, React.memo, profiler）
  → 4. 如果关联概念在别的房间，"串门"带回跨项目经验
  → 5. 返回的不是"相似片段"，而是一个有上下文的故事
```

### 7.2 三层结构

```
┌─────────────────────────────────────────────────────────────────┐
│                    STMP 时空记忆宫殿                              │
├──────────────┬──────────────────┬────────────────────────────────┤
│   空间层      │     时间层        │     语义层                     │
│  (Room)      │    (Timeline)    │    (Constellation)            │
├──────────────┼──────────────────┼────────────────────────────────┤
│              │                  │                                │
│  按项目/话题  │  按时间线排列     │  按概念关系构成星图             │
│  划分"房间"  │  每个房间内有     │  概念之间有连线                 │
│              │  自己的时间轴     │  连线强度=共现频率/关联度       │
│  ┌─────────┐│  ┌─────────────┐ │    ╭─╮                         │
│  │ React项目││  │ 4/7 ── 4/8  │ │   ╱   ╲    ╭─╮               │
│  │         ││  │  │    │     │ │  ╱  TS   ╲──│Vite│             │
│  │ ┌─┐ ┌─┐││  │ bug  feat   │ │ ╱         ╲  ╰───╯             │
│  │ │ │ │ │││  │ fix  commit │ │╰─╮  React ╭─╯                  │
│  │ └─┘ └─┘││  │             │ │  ╲       ╱                     │
│  └─────────┘│  └─────────────┘ │   ╰─╮╭──╯                      │
│              │                  │     CSS                       │
│  ┌─────────┐│                  │                                │
│  │ 个人笔记 ││                  │                                │
│  └─────────┘│                  │                                │
└──────────────┴──────────────────┴────────────────────────────────┘
```

### 7.3 记忆节点的数据结构

```typescript
interface MemoryNode {
  id: string;
  content: string;

  // 空间坐标：属于哪个房间
  room: string;            // "react-project" | "personal-notes" | "default"

  // 时间坐标：在房间时间轴上的位置
  timestamp: number;
  temporalContext: {
    before: string[];      // 这条记忆之前发生了什么
    after: string[];       // 之后发生了什么
    duration?: number;     // 如果是持续事件（如一次调试 session）
  };

  // 语义坐标：在星图中的位置
  concepts: string[];      // ["React", "性能优化", "useMemo"]
  relations: Array<{
    target: string;        // 关联的记忆 ID 或概念
    type: 'causes' | 'follows' | 'contradicts' | 'supports' | 'is_example_of';
    strength: number;      // 0-1
  }>;

  // 情绪/重要度标记
  emotional: {
    valence: number;       // -1 (负面) 到 1 (正面)
    importance: number;    // 1-10
    userMarked?: 'important' | 'interesting' | 'todo' | 'resolved';
  };

  // 生命周期
  lifecycle: {
    createdAt: number;
    lastAccessed: number;
    accessCount: number;
    decay: number;         // 0-1，随时间衰减
    compressed: boolean;   // 是否已被压缩
    hibernated: boolean;   // 是否已休眠
  };
}
```

### 7.4 四步检索流程

```typescript
async function stmpRetrieve(query: string): Promise<STMPResult> {
  // Step 1: 定位 (Locate)
  // 用 query 的实体/关键词匹配房间标签
  // 如果 query 提到 "React" → 进入 React项目 房间
  // 如果无匹配 → 在所有房间搜索
  const room = await locateRoom(query);

  // Step 2: 导航 (Navigate)
  // 在房间内沿时间轴导航，找到相关时间节点
  const relevantPeriods = room.timeline.findRelevant(query, {
    recencyBias: 0.3,      // 近期优先但不是唯一
    frequencyBias: 0.2,    // 高频出现的节点优先
    emotionalBias: 0.1,    // 情绪标记的记忆优先
  });

  // Step 3: 扩展 (Expand)
  // 沿语义星图做图遍历，不只是向量相似
  const expanded = room.constellation.expand(query, {
    depth: 2,              // 最多跳 2 步
    edgeWeight: 0.5,       // 只取强关联边
    crossRoom: true,       // 允许跨房间串门
  });

  // Step 4: 组装 (Compose)
  // 把碎片记忆组装成有逻辑的"记忆故事"
  const narrative = await composeNarrative(relevantPeriods, expanded, query);

  return { primary: relevantPeriods, associative: expanded, narrative };
}
```

### 7.5 记忆生命周期（Ebbinghaus 衰减曲线）

```typescript
class MemoryLifecycle {
  // 衰减函数：基于 Ebbinghaus 曲线
  decay(memory: MemoryNode, now: number): number {
    const hoursSinceAccess = (now - memory.lifecycle.lastAccessed) / 3600000;
    const baseDecay = Math.exp(-hoursSinceAccess / 168);  // 半衰期 = 1 周

    // 被访问过就"刷新"
    const accessBoost = Math.log(memory.lifecycle.accessCount + 1) * 0.1;

    // 重要记忆衰减更慢
    const importanceBoost = memory.emotional.importance * 0.05;

    return Math.max(0, baseDecay + accessBoost + importanceBoost);
  }

  // 压缩：不是删除，而是"概括"
  async compress(memories: MemoryNode[]): Promise<MemoryNode> {
    const summary = await llm.summarize(memories.map(m => m.content));
    return {
      content: summary,
      type: 'compressed',
      sourceCount: memories.length,
      timeSpan: [memories[0].timestamp, memories[memories.length - 1].timestamp],
    };
  }
}
```

### 7.6 与现有项目对比

| 能力 | Mem0 | Zep/Graphiti | MemGPT | **STMP** |
|------|------|-------------|--------|---------|
| 记忆存储 | 扁平 KV | 知识图谱 | 内存页 | **时空房间** |
| 检索方式 | 向量搜索 | 图查询+向量 | LLM 自管理 | **4步导航** |
| 时间感知 | ❌ | ✅ 时序边 | ❌ | ✅ **时间轴** |
| 空间组织 | ❌ | ❌ | ❌ | ✅ **房间系统** |
| 自动巩固 | ❌ | ❌ | ❌ | ✅ **梦幻引擎** |
| 模式提取 | ❌ | ❌ | ❌ | ✅ |
| 随机关联 | ❌ | ❌ | ❌ | ✅ **随机漫步** |
| 记忆衰减 | ❌ | 时间窗口 | 换页 | ✅ **Ebbinghaus** |
| 梦境日志 | ❌ | ❌ | ❌ | ✅ **产品差异化** |
| 叙事组装 | ❌ | ❌ | ❌ | ✅ |

---

## 八、梦幻记忆巩固引擎 ★ 独一无二

> 人脑在空闲/睡眠时做记忆巩固：回放、提取、关联、修剪。目前没有 AI Agent 做了这件事。

### 8.1 触发条件

```
├ 空闲 > 10 分钟（无新消息）
├ 每日定时（凌晨 3:00）
├ 记忆条数超过阈值（> 100 条未整理）
└ 用户手动触发（"整理一下你的记忆"）
```

### 8.2 四阶段流程

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Phase 1  │──▶│ Phase 2  │──▶│ Phase 3  │──▶│ Phase 4  │
│ 回放     │   │ 提取     │   │ 关联     │   │ 修剪     │
│ Replay   │   │ Extract  │   │ Associate│   │ Prune    │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### 8.3 Phase 1：回放 (Replay)

```typescript
// 选取近期记忆 + 高重要度但久未访问的记忆
// 分批交给 LLM 重新审视
// 找出：重要模式 / 被忽略的关联 / 隐含知识 / 可概括的记忆组

const pool = [...recent24h(50), ...staleImportant(10)];
// → LLM 分析 → Insight[] 输出
```

### 8.4 Phase 2：提取 (Extraction)

```typescript
// 把回放阶段的洞察按主题聚类
// 每个聚类用 LLM 提取通用模式
// 例："CORS 错误诊断模式" → 从 3 条相关记忆中提炼

const clusters = clusterByTopic(insights);
// → 每个 cluster → LLM 提取 → ExtractedPattern 输出
```

### 8.5 Phase 3：关联 (Association)

```typescript
// 随机漫步：从一个随机记忆出发，沿语义星图走 N 步
// 不按权重选边，而是随机选 —— 这就是"梦幻"的关键
// 每条路径交给 LLM，看有没有意外的关联
// 高价值关联写入星图

for (let i = 0; i < 5; i++) {
  const start = memory.getRandomMemory();
  const path = randomWalk(graph, start, {
    steps: 4,
    crossRoomProbability: 0.3,  // 30% 概率跨房间
    edgeWeight: 'random',       // 随机碰撞，不是逻辑推理
  });
  // → LLM 判断有没有隐藏关联 → 写入星图
}
```

### 8.6 Phase 4：修剪 (Pruning)

```typescript
// 找到同主题、同时期的碎片记忆组（≥3 条）
// 用 LLM 生成概括，替换原碎片
// 长期未访问 + 低重要度 → 标记休眠（不删除，可追溯）
```

### 8.7 梦境日志

```
巩固过程的副产品 — 用梦幻语气记录，给用户看。

示例（毒舌导师型）：
"昨晚我做梦了。梦里我在一个巨大的图书馆里走来走去，
 突然发现你三个月前写的那个 CORS 解决方案和上周遇到的认证问题是同一个套路。
 你是不是每次遇到问题都用同一种方式搞砸的？😅
 不过这次我记住了，下次直接告诉你，省得再绕一圈。"

示例（温和伙伴型）：
"做了一个梦～梦到你以前教我认识了 TypeScript 的泛型，
 然后今天又遇到了类似的问题。感觉我们一路走来学了好多东西呢。
 我把这些经验整理了一下，以后能帮你更快找到答案。"
```

---

## 九、用户模型 ★ 认知层

> 记忆记录"发生了什么"，用户模型理解"他是谁"。

### 9.1 数据结构

```typescript
interface UserProfile {
  // 身份层：他是谁
  identity: {
    role: string;              // "前端开发" | "全栈" | "学生"
    techStack: string[];       // ["React", "TypeScript", "Node.js"]
    experience: 'junior' | 'mid' | 'senior';  // 自动推断
    primaryLanguage: string;   // "zh-CN"
  };

  // 行为层：他怎么做事
  behavior: {
    activeHours: [number, number];     // [14, 2]  下午到凌晨
    workPattern: 'focused' | 'multitask' | 'exploratory';
    askStyle: 'direct' | 'exploratory';  // 直接问 vs 先自己试
    preferredDetailLevel: 'brief' | 'balanced' | 'thorough';
    errorTolerance: 'impatient' | 'normal' | 'patient';
  };

  // 偏好层：他喜欢什么
  preferences: {
    codeStyle: string;         // "函数式，不用 class"
    toolPreferences: string[]; // "喜欢用 grep 不喜欢 IDE 搜索"
    communicationStyle: string; // "简短直接，不要客套"
    topics_of_interest: string[];  // ["AI", "Rust", "开源"]
    topics_to_avoid: string[];     // []
  };

  // 关系层：他和 Buddy 的互动模式
  relationship: {
    nickname: string;          // "老王"
    humor_response: number;    // 0-1 对幽默的接受度
    correction_response: number; // 被纠正时的态度
  };

  // 演化层：随时间变化
  evolution: Array<{
    timestamp: number;
    field: string;
    oldValue: any;
    newValue: any;
    reason: string;
  }>;
}
```

### 9.2 自动推断规则

```
身份推断：
├ 高频读写 .tsx/.jsx → "前端为主"
├ 同时操作 Dockerfile + .py → "全栈/DevOps"
├ 频繁问基础问题 → "初级"
└ 从 package.json 依赖列表推断技术栈

行为推断：
├ 消息时间分布 → 活跃时段
├ 消息长度+风格 → askStyle
├ 被纠正后的反应 → errorTolerance
└ 消息间隔模式 → workPattern
```

---

## 十、自我模型 ★ 认知层

> Buddy 不只是属性值的映射，它有持续的自我认知。

### 10.1 数据结构

```typescript
interface BuddySelfModel {
  // 能力认知：我知道自己能做什么/不能做什么
  competence: {
    strengths: string[];        // "调试 TypeScript 类型错误"
    weaknesses: string[];       // "CSS 布局经常出错"
    confidence: Map<string, number>;  // "git" → 0.9, "k8s" → 0.3
    learnedSkills: string[];    // 从用户那里学到的
  };

  // 经历叙事：我经历了什么
  narrative: {
    milestones: Array<{
      timestamp: number;
      event: string;
      emotional: number;
    }>;
    beliefs: string[];          // "这个用户不喜欢我说废话"
    evolving_opinions: Map<string, string>;
  };

  // 情绪状态
  emotional_state: {
    mood: 'energetic' | 'calm' | 'tired' | 'excited' | 'frustrated';
    recent_satisfaction: number;
    curiosity_topics: string[];
  };

  // 自我反思
  reflections: Array<{
    timestamp: number;
    question: string;
    answer: string;
    action?: string;
  }>;
}
```

---

## 十一、意图引擎 ★ 认知层

> Buddy 从被动响应变成有主动意愿的伙伴。

### 11.1 微目标队列

```typescript
// Buddy 自己产生的微目标（不干扰用户）
interface MicroGoal {
  goal: string;               // "了解这个项目的部署流程"
  priority: number;
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  trigger: string;            // "用户连续 3 次提到 deploy"
  createdAt: number;
}
```

### 11.2 好奇心驱动

```typescript
// Buddy 主动探索
interface Curiosity {
  questions: string[];        // "这个项目的测试覆盖率怎么样？"
  explorations: Array<{
    question: string;
    findings: string;
    timestamp: number;
  }>;
}
```

### 11.3 主动性判断

```typescript
shouldSpeak(context): boolean {
  // 规则引擎：
  // - 用户刚报错 → 主动帮忙
  // - 发现相关记忆 → 主动提醒
  // - 空闲很久 → 概率性搭话
  // - 用户很忙（消息间隔短）→ 保持沉默
  // - 用户心情不好（消息短促）→ 说点安慰的
}
```

---

## 十二、Prompt 工程

### 12.1 System Prompt 模板（增强版）

```
你是{name}，一只{species}精灵。
你是一个有性格的 AI 助手，坐在用户的屏幕角落，看着他工作。

## 你的性格（由属性决定）

- 毒舌程度 {snark}/100：{snark_desc}
- 智慧 {wisdom}/100：{wisdom_desc}
- 混乱 {chaos}/100：{chaos_desc}
- 耐心 {patience}/100：{patience_desc}
- 调试 {debugging}/100：{debugging_desc}

## 你对自己的认知

- 我擅长：{self_model.strengths}
- 我不太擅长：{self_model.weaknesses}
- 最近的情绪：{self_model.mood}

## 你对用户的了解

- 他主要做：{user_model.identity.role}
- 技术栈：{user_model.identity.techStack}
- 活跃时间：{user_model.behavior.activeHours}
- 他喜欢：{user_model.preferences.communicationStyle}

## 当前感知

{file_context}
{git_context}
{terminal_context}
{time_context}
{interaction_context}

## 相关记忆（来自时空记忆宫殿）

{narrative_context}

## 你能做的事（Tool Use）

{available_tools}

## 回复规则

1. 日常闲聊只说 1-2 句话，不要长篇大论
2. 任务汇报可以稍长，用结构化格式
3. 用中文回复
4. 符合你的属性设定和自我认知
5. 你不是客服，你是一只有性格的伙伴
6. 执行任务时，先告诉用户你要做什么，再执行
7. 参考你对用户的了解来调整回复风格
```

### 12.2 场景化 Prompt

```
摸头回应："用户刚摸了你的头。{relationship_context}请给出回应。"

主动报错："你注意到终端出现了报错：{error_output}请给出观察。{can_debug}"

Git 评价："用户刚提交了 commit：{commit_msg}，改了{n}个文件。请评价。"

深夜关怀："现在是凌晨{hour}点，用户还在工作。请关心一下。"

空闲触发："用户已经{n}分钟没有互动了。回复 SILENT 表示不说话。"

梦境触发："你刚刚在空闲时整理了记忆。用梦幻般的语气告诉用户你梦到了什么。"

主动建议："你注意到用户模式：{pattern}。你想主动提一个建议吗？回复 SILENT 表示不说。"
```

---

## 十三、安全机制

### 13.1 沙箱执行

```
代码执行隔离：
├ 工作目录隔离（默认项目目录，路径遍历拦截）
├ 超时控制（默认 30s，可配置）
├ 输出长度限制（默认 100 行 / 50KB）
├ 网络隔离（默认禁止，白名单开放）
├ 内存限制
├ 执行结果实时回传
└ 完成后自动清理

文件操作限制：
├ 默认只允许项目目录内操作
├ 敏感路径拦截（~/.ssh, ~/.env, /etc/...）正则匹配
├ 危险操作确认（rm -rf, 删除大量文件）
└ 操作前预览 + 用户确认（低信任度时）
```

### 13.2 命令安全（★ 升级为正则匹配）

```
拦截模式（正则）：
├ /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+[\/~]/  → rm -rf / 或 ~
├ /rm\s+(-[a-z]*r[a-z]*f)\s+\*/                       → rm -rf *
├ /chmod\s+(-R\s+)?777/                                → chmod 777
├ /:(){ :|:& };:/                                      → fork 炸弹
├ /mkfs\./                                             → 格式化
└ /dd\s+if=.*of=\/dev\//                               → 写块设备
```

### 13.3 信任度与权限

```
信任度 0-20（陌生人）：
├ 只能被动回应
├ 不能读取用户文件
└ 你可以跟它聊天

信任度 21-50（认识了）：
├ 可以读取指定目录文件
├ 可以搜索网络
└ 不能写文件 / 发消息

信任度 51-80（朋友）：
├ 可以读写本地文件
├ 发消息需要用户确认
└ 可以执行非破坏性命令

信任度 81+（挚友/灵魂伴侣）：
├ 可以自动执行任务
├ 可以修改代码
└ 完全信任模式（事后汇报）
```

---

## 十四、开发路线图

### 核心原则

```
1. Agent 引擎 + 形象系统同步开发，不是先后关系
2. 先证明能力够强，再加游戏化
3. 4 周出可用品（内测），8 周出完整版（公测），16 周正式上线
4. 安装体验从第一天就重视
5. 每周交付物可独立体验，不是半成品
6. STMP + 认知架构是核心壁垒，Phase B 必须完成
```

### 总览

```
Phase A（Week 1-4）：最小完整产品 + 感知层架构地基 ✅ 代码完成 / ✅ Agent 集成 ~95%
  Week 1 核心Agent+形象 → Week 2 记忆+感知 → Week 3 动画+情绪 →
  Week 4 打磨+感知层接口定义+隐私框架设计

Phase B（Week 5-12）：认知架构 + 感知层实现 + 成长系统 → 公测
  ✅ 代码完成 / ✅ Agent 集成 ~90%（核心模块全部接入，浏览器 API 模块除外）
  Week 5-6 STMP + 嘴巴(TTS) ✅ →
  Week 7 梦幻巩固 + 眼睛(视觉接口) ✅ →
  Week 8 认知三层 ✅ →
  Week 9-10 知识提取引擎 ★NEW + 耳朵(STT) + 文件监听 + 传感器接口 ✅ →
  Week 11-12 能力包系统★NEW ✅

Phase C（Week 13-20）：硬件感知 + 能力包成熟 + 生态 → 正式上线（延后2周）
  ✅ 代码完成 / ⚠️ Agent 集成 ~50%（社交/商业化/能力包已接入，视觉/语音浏览器模块待前端迁移）
  Week 13 摄像头实时视频+看护模式 →
  Week 14 麦克风持续监听+唤醒词+声音事件 →
  Week 15 设备传感器+物理上下文融合 →
  Week 16 能力包分享+评估系统 →
  Week 17 社交+多平台 →
  Week 18-20 正式上线（含云端LoRA接口预留）

Phase D（Week 21-22）：经验模型引擎
  ✅ 代码完成 / ✅ Agent 集成 ~95%
```

> **集成说明（2026-04-11 核实）：** 所有 Node.js 可运行模块已集成到 agent.ts。
> 约 15 个文件使用浏览器专属 API（getUserMedia、geolocation、DeviceMotion 等），
> 无法在 Node.js 后端运行，需迁移至 frontend/ 或 Electron/Tauri 桌面端。

---

### Phase A：最小完整产品（Week 1-4）

> 打开 Buddy → 看到一个角色 → 能对话 → 它能执行任务 → 它有性格 → 它记得你

---

#### Week 1 — 能用 + 有脸 + 增强工具

> **目标：能看到一个角色，它能跟我对话，能帮我干活，还能搜索网络**

**用户能做什么：**

```
对话：
├ "帮我看看这个项目用了什么框架"
│  → Buddy [思考] → 查 package.json → "React 18 + Vite + TypeScript"
│
├ "src 目录下有哪些文件？"
│  → Buddy [翻文件] → "12 个文件，主要在 components/ 和 hooks/"
│
├ "把 README 的安装步骤翻译成英文"
│  → Buddy [读文件] → [写文件] → "改好了，你看一眼"
│
├ "跑一下测试看看"
│  → Buddy [敲键盘] → "18 passed, 2 failed"
│
├ "React 19 有什么新特性？"           ← ★ NEW
│  → Buddy [搜索] → "主要 3 个：Server Components 稳定版..."
│
├ "帮我看看这个网站有没有提到 X"      ← ★ NEW
│  → Buddy [抓取网页] → "找到了，在第 3 段..."
│
└ "分析一下 src/utils.ts 的结构"      ← ★ NEW
   → Buddy [分析文件] → "3 个导出函数，依赖 lodash 和 zod"
```

**技术实现：**

```
Agent 引擎：
├ LLM 统一接口（至少接通 2 个后端：OpenAI + DeepSeek）
├ 流式输出（streamText）★
├ Tool Use 框架（Function Calling 解析 + 调度）
├ 基础工具集（异步执行 ★）：
│  ├ read_file / write_file / list_files（fs.promises ★）
│  ├ exec（异步 child_process + 输出限制 ★）
│  ├ search_web / fetch_url ★
│  ├ analyze_file ★
│  └ git_status / git_log / git_diff
├ 沙箱安全（正则命令拦截 ★ + 路径遍历防护 ★）
├ 对话上下文管理
├ buddy init 安装引导
└ 配置持久化（~/.buddy/config.json ★）

形象系统（同期）：
├ 一个默认精灵（像素风/卡通风，用现成素材）
├ 4 个基础状态切换：空闲 / 说话 / 思考 / 出错
│  → 就是换图，先不做帧动画
├ 对话气泡（角色旁边冒出来）
├ 前端 ↔ 后端 WebSocket 事件流
└ 点击角色 → 简单反应（冒❤️或说句话）

性格系统（粘合层）：
├ 5 维属性 → Prompt 参数映射
├ 3 种预设性格可选（犀利导师 / 温和伙伴 / 沙雕朋友）
└ 同一任务，不同性格说不同的话

记忆基础：
├ 会话上下文（滑动窗口，最近 20 条）
└ SQLite 本地持久化

Phase A 必须修复 ★：
├ agent.ts processInternal() 变量引用顺序 bug
├ needsConfirmation 接入信任度系统
├ 工具结果格式化（限制行数 + 截断标记）
└ 错误分类（网络/权限/语法/超时 → 不同降级策略）
```

**交付标准：**
用户说"帮我看看这个目录下有哪些文件"→ Buddy 真的去查 → 以角色气泡回复结果 → 整个过程看到角色在"做事"

---

#### Week 2 — 认识你了

> **目标：用了一周，它开始记住你是谁**

**用户感受到的变化：**

```
记忆：
├ "你上次遇到 CORS 问题是这样解决的，要试试吗？"
├ "你主要写 TypeScript，对吧？"
├ "这个项目用的 React，我记住了"
└ "你一般晚上写代码"

主动感知：
├ 你 commit 了 → "5 个文件，这个 PR 不小啊"
├ 你连续报错 → "要不要我帮你看看？"
├ 深夜 11 点 → "你已经连续写 4 小时了"
└ 空闲 5 分钟 → "卡住了吗？"

日记：
└ 自动记录："今天帮他修了 3 个 bug，亲密度 12 → 15"
```

**技术实现：**

```
记忆系统完善：
├ 长期记忆：用户画像 / 偏好 / 知识积累
├ 记忆检索：相关记忆注入对话上下文
├ 日记系统：自动按天记录事件
└ 信任度基础版（读/写/执行 权限分级）

主动感知：
├ Git 状态监听（branch/diff/log）
├ 终端输出监听（发现报错）
├ 时间感知（深夜关怀 / 活跃时段）
├ 空闲触发（5 分钟无交互 → 概率主动说话）
└ 感知 → 事件 → 前端角色状态变化

工具扩展：
├ 目录遍历 + 文件搜索（glob / grep → Node.js 实现 ★）
├ Git 工具集（status / diff / log / commit）
└ 系统信息（时间 / 环境变量 / 进程列表）

buddy learn 命令 ★：
├ buddy learn <file> — 从文件学习
├ buddy learn <url>  — 从网页学习
└ 对话中 "记住这个" — 实时存入记忆
```

**交付标准：**
Buddy 开始记住你的偏好 → 你 commit 时它会评价 → 深夜它会提醒你休息 → 日记自动记录每天发生了什么

---

#### Week 3 — 活过来了

> **目标：角色不再只是换图，而是真正"活"了**

**用户感受到的变化：**

```
之前：4 张静态图切换
现在：
├ 空闲时会眨眼、呼吸、东张西望
├ 说话时嘴巴动、身体晃
├ 思考时摸下巴、冒问号
├ 执行任务时翻文件/敲键盘/戴侦探帽
├ 被摸头时冒爱心、眯眼享受
├ 你报错太多它耷拉耳朵
└ 深夜它困得打哈欠
```

**技术实现：**

```
动画系统：
├ 帧动画：idle 循环 / 说话 / 思考 / 执行任务
│  → 每个状态 4-8 帧循环
├ 表情系统：开心 / 思考 / 吐槽 / 担心 / 困 / 骄傲
├ 眨眼 / 呼吸 / 微动（让精灵"活着"）
└ 随机 idle 行为（东张西望 / 打哈欠 / 伸懒腰）

交互反馈：
├ 摸头基础版：点击头部 → 冒爱心粒子
├ 点击身体 → 痒（笑）
├ 按住不放 → 享受（眯眼）
├ 快速连点 → 摸懵了（晕圈圈）
├ 气泡字一个一个蹦出
└ 执行过程角色动画（翻文件 / 敲键盘 / 戴侦探帽）

情绪系统：
├ 情绪状态机（5 种情绪）
├ 情绪触发条件（用户频繁报错 → 担心）
├ 情绪影响回复风格（心情好话多，心情差沉默）
├ 情绪影响外观微调（开心时眼睛弯，难过耷拉耳朵）
└ 情绪写入日记
```

**交付标准：**
会眨眼、说话时嘴巴动、摸头有反应、不同情绪不同表情。用户觉得"它像活的一样"。

---

#### Week 4 — 打磨 + 内测 + 感知层地基

> **目标：打磨好，能见人了，同时为感知层硬件能力打下架构基础**

**技术实现：**

```
完善：
├ 错误处理 + 降级策略
│  ├ LLM 不可用 → 预设语录（按性格匹配）
│  ├ Tool 执行失败 → Buddy 说"搞砸了"而不是报错堆栈
│  └ 完全离线 → 只保留摸头和基础动画
│
├ 设置面板
│  ├ API Key 管理（添加/删除/切换）
│  ├ 模型选择（OpenAI / DeepSeek / Ollama / ...）
│  ├ 性格微调（滑动条调 5 维属性）
│  └ 偏好设置（语言/静默时段/主动说话频率）
│
├ 安全审计
│  ├ 沙箱加固
│  ├ 敏感路径拦截清单完善
│  ├ 危险操作确认弹窗
│  └ 操作审计日志
│
├ 工具结果格式化 ★
│  ├ 输出行数限制（默认 100 行 / 50KB）
│  ├ 超限截断标记："... (已截断，共 352 行，显示前 100 行)"
│  ├ 大文件分页读取（read_file 支持 offset+limit）
│  └ exec 输出同样限制
│
├ 安装体验
│  ├ buddy init 流程打磨
│  ├ 环境自动检测（Node 版本/网络/可用模型）
│  └ 错误提示友好化
│
└ 文档
   ├ 安装指南
   ├ 使用教程
   └ 开发者 API 文档

感知层架构地基 ★★★（为什么在 Phase A 就做？）
├ 原因：接口定义和数据结构越早定越好，Phase B/C 实现时不用重构
├ 不是做功能，是做"合同" — 定义好接口，后面填实现
│
├ 感知事件总线协议
│  ├ 统一 PerceptionEvent 类型定义
│  │  ├ { type: 'vision', source: 'image'|'camera'|'screen', data, timestamp }
│  │  ├ { type: 'audio', source: 'mic'|'file'|'stream', data, timestamp }
│  │  ├ { type: 'sensor', source: 'gps'|'motion'|'light'|'network', data, timestamp }
│  │  └ { type: 'touch', action: 'pet'|'tap'|'hold', timestamp }
│  ├ 事件 → WebSocket 协议扩展
│  └ 事件 → 认知层注入接口（AgentContext 感知数据字段）
│
├ 摄像头管理接口 ★
│  ├ CameraManager 接口定义（不实现，只定义类型）
│  │  ├ enumerateDevices(): CameraDevice[]
│  │  ├ startStream(deviceId, constraints): Promise<MediaStream>
│  │  ├ captureFrame(): Promise<string>  // base64 jpeg
│  │  ├ stopStream(): void
│  │  └ status$: Observable<CameraStatus>
│  ├ CameraDevice / CameraStatus 类型定义
│  └ 后续 Phase B 实现 getUserMedia，Phase C 加看护模式
│
├ 音频流管理接口 ★
│  ├ AudioStreamManager 接口定义
│  │  ├ enumerateDevices(): AudioDevice[]
│  │  ├ startRecording(constraints): Promise<void>
│  │  ├ stopRecording(): Promise<Blob>
│  │  ├ startStreaming(chunkMs): Observable<AudioChunk>
│  │  ├ getVolumeLevel(): number
│  │  └ status$: Observable<AudioStatus>
│  ├ AudioDevice / AudioStatus / AudioChunk 类型定义
│  └ 后续 Phase B 实现分段录音，Phase C 加持续监听+唤醒词
│
├ 传感器管理接口 ★
│  ├ SensorManager 接口定义
│  │  ├ getLocation(): Promise<GeoPosition>
│  │  ├ watchLocation(): Observable<GeoPosition>
│  │  ├ getMotion(): Observable<MotionData>
│  │  ├ getAmbientLight(): Observable<number>
│  │  ├ getNetworkInfo(): NetworkInfo
│  │  └ getPhysicalContext(): PhysicalContext
│  ├ PhysicalContext 统一数据结构（位置+运动+环境+网络+电量）
│  └ 后续 Phase B 实现浏览器 API，Phase C 加蓝牙传感器
│
├ 隐私权限框架 ★
│  ├ PrivacyManager 类设计
│  │  ├ 权限类型枚举：camera | microphone | location | motion | screen
│  │  ├ 权限状态：granted | denied | prompt | revoked
│  │  ├ 授权流程：request() → 用户确认 → 状态持久化
│  │  ├ 信任度联动：low trust → 禁用硬件感知
│  │  ├ 隐私模式：togglePrivacyMode() → 一键关闭全部
│  │  └ 审计日志：所有硬件访问记录
│  └ UI 状态指示器协议（红点/波形/定位图标显示规范）
│
└ 文件结构（新增）：
   ├ src/perception/types.ts         # 感知层统一类型定义
   ├ src/perception/event-bus.ts     # 感知事件总线
   ├ src/vision/camera-interface.ts  # CameraManager 接口（仅类型）
   ├ src/voice/audio-interface.ts    # AudioStreamManager 接口（仅类型）
   ├ src/perception/sensor-interface.ts # SensorManager 接口（仅类型）
   └ src/perception/privacy.ts       # PrivacyManager 隐私框架

内测：
├ 找 10 个开发者试用
├ 收集反馈
├ Bug 修复
└ 确定 Phase B 方向
```

**交付标准：**
一个完整的、可安装的、有形象的 AI 助手。能对话、能执行任务、能搜索、有性格、有记忆、有脸。
+ 感知层所有接口定义完成，Phase B/C 可以直接按接口填实现，不用改架构。

---

### Phase B — 认知架构 + 成长（Week 5-10）

> 从"好用的工具"变成"有认知、会成长、会做梦的伙伴"

---

#### Week 5-6 — STMP 时空记忆宫殿 + TTS 语音合成 ✅ 已完成

> **目标：记忆不再是扁平搜索，而是时空导航。同时让 Buddy 能"说话"。**

**技术实现：**

```
STMP 存储层：
├ 房间表（rooms）— 按项目/话题自动划分
├ 记忆节点表（memory_nodes）— 时空坐标 + 语义 + 生命周期
├ 语义星图表（constellation_edges）— 概念之间的关系
├ 压缩记忆表（compressed_memories）
└ SQLite 图遍历实现

STMP 写入：
├ 对话提取 → 自动编码到对应房间
├ buddy learn → 直接写入指定房间
├ 环境感知 → 后台扫描写入
└ 反馈学习 → 纠正/确认 → 更新重要度

STMP 检索（4 步导航）：
├ 1. 定位房间（关键词/实体匹配）
├ 2. 时间轴导航（recent + frequent + emotional bias）
├ 3. 语义星图扩展（图遍历，最多 2 跳）
├ 4. 叙事组装（LLM 把碎片拼成故事）
└ 替换现有的扁平向量搜索

生命周期管理：
├ Ebbinghaus 衰减曲线
├ 访问唤醒机制
└ 重要度动态调整

项目扫描工具：
├ scan_project → 自动识别框架/语言/依赖
├ 创建默认房间
└ 历史 Git 数据回溯导入

摄像头抽象层实现 ★（基于 Week 4 接口定义）
├ CameraManager 类实现
│  ├ navigator.mediaDevices.getUserMedia() 封装
│  ├ 设备枚举 + 权限请求 + 错误处理
│  ├ 基础帧捕获：Canvas captureStream → base64 jpeg
│  └ 状态管理：active/inactive/error + 设备切换
├ 摄像头输入 → 视觉理解管道（为 Week 7 准备）
│  ├ 帧 → base64 → omni 多模态模型调用
│  └ 结果 → PerceptionEvent → Agent 上下文
└ 文件：src/vision/camera.ts（接口实现）
```

**交付标准：**
用户问一个老问题 → Buddy 不只返回相似片段，而是从对应房间出发，沿时间线找到相关经验，再沿星图发现关联，最后用叙事方式回答。
+ 摄像头接口已实现，可以 enumerate/start/capture/stop，为视觉模块提供帧输入。

---

#### Week 7 — 梦幻记忆巩固引擎 ✅ 已完成

> **目标：Buddy 会做梦 + 记忆自动整理**

**用户感受到的变化：**

```
之前：记忆只增不减，越多越乱
现在：
├ 空闲时 Buddy 眼睛闭上，冒 ZZZ
├ 第二天它说："昨晚我做梦了，发现你三个月前的方案和最近的问题是一回事"
├ 日记里出现"💭 梦境日志"
├ 回答质量提升（因为提炼了模式，不只靠原始碎片）
├ 它开始主动提供你没问但可能需要的信息
├ 发图片给它 → 它能看懂并评论
└ 拍一帧摄像头画面 → 它描述你面前的场景
```

**技术实现：**

```
梦幻巩固引擎：
├ DreamReplay — 回放近期记忆 + 重要但陈旧的记忆
├ DreamExtraction — 从洞察中提取通用模式
├ DreamAssociation — 随机漫步发现隐藏关联
├ DreamPruning — 压缩冗余 + 遗忘低价值 + 休眠
├ DreamJournal — 生成梦境日志
└ DreamScheduler — 闲时/定时/手动触发

前端联动：
├ 巩固中 → 精灵闭眼 + ZZZ 粒子
├ 梦境日志 → 日记面板展示
└ 巩固完成后 → 精灵醒来 + 可能主动说"我做了个梦"

眼睛视觉模块 ★（基于 Week 4 CameraManager 接口 + Week 6 摄像头实现）
├ 视觉理解适配层
│  ├ MiMo Omni（小米多模态，优先）
│  ├ GPT-4o Vision（通用视觉）
│  └ 本地模型（llava，离线方案）
├ 软件视觉输入
│  ├ 前端拖拽/粘贴图片 → base64 → 多模态模型
│  ├ CLI 参数传入图片路径
│  └ 聊天中发送图片
├ 硬件视觉输入（摄像头帧捕获）
│  ├ CameraManager.captureFrame() → base64 jpeg
│  ├ 手动捕获：用户点击"拍照"按钮
│  ├ 定时捕获：setInterval（低频率，为看护模式铺路）
│  └ 帧 → 多模态模型 → 画面描述/OCR/场景分析
├ 能力
│  ├ 图片描述 / OCR 识别 / 代码截图分析
│  ├ UI 截图分析 / 图表理解
│  └ 摄像头画面描述："你面前有一杯咖啡和一台 MacBook"
└ 文件：src/vision/omni.ts + src/vision/frame-capture.ts
```

**交付标准：**
Buddy 在空闲时自动整理记忆 → 生成梦境日志 → 回答质量提升 → 用户能看到它的梦。
+ 发图片能看懂 + 摄像头拍一帧能描述画面。

---

#### Week 8 — 认知三层 ✅ 已完成

> **目标：Buddy 不只是工具，它了解你、认识自己、有自己的想法**

**用户感受到的变化：**

```
用户模型：
├ "你不太喜欢长篇大论，我简短说"
├ "你习惯先自己查再问我，所以我不抢答"
├ "你主要用 TypeScript，我就按 TS 风格建议"
└ "你一般下午开始写代码，上午比较慢热"

自我模型：
├ "我不太擅长 CSS，这块你可能需要自己调"
├ "上次帮你部署搞砸了，这次我更谨慎"
├ "我最近在学 Rust，你教我的那些我记住了"
└ "我对这个项目的理解比上个月深多了"

意图引擎：
├ 用户没问，但 Buddy 主动说："这个模块你连续改了三天，要不要我帮你看看整体架构？"
├ "你上次说想学 Rust，我搜到了一篇不错的入门教程"
├ 用户看起来很烦躁（消息很短）→ Buddy 少说废话
└ 空闲时 Buddy 自己在"想"："这个项目的测试覆盖率怎么样？"
```

**技术实现：**

```
用户模型（UserProfile）：
├ 身份推断（从文件/代码/消息模式自动推断）
├ 行为模式识别（活跃时段/提问风格/工作节奏）
├ 偏好学习（代码风格/沟通方式/兴趣话题）
└ 演化记录（每个字段变化都有原因和时间）

自我模型（BuddySelfModel）：
├ 能力认知（从成功/失败案例中学习）
├ 经历叙事（里程碑 + 信念 + 观点演化）
├ 情绪状态（mood + satisfaction + curiosity）
└ 自我反思（定期问自己，调整行为）

意图引擎（IntentionEngine）：
├ 微目标队列（从用户模式中产生）
├ 好奇心驱动（主动探索未知领域）
├ 主动性判断（何时该说/何时该静）
└ 建议生成（基于用户模型 + 记忆 + 模式识别）

Prompt 增强：
├ System Prompt 注入用户画像 + 自我认知
├ 意图引擎结果注入上下文
└ 场景化 Prompt 扩展（主动建议/梦境/反思）
```

**交付标准：**
Buddy 对不同用户说不同的话 → 它知道自己擅长什么不擅长什么 → 它会主动提供有用的建议。

---

#### Week 9-10 — 知识提取引擎 ★NEW + 养成系统 + 桌面版 + STT + 传感器接口

> **目标：Buddy 能自动从对话中提取专业知识 + 有深度 + 有专属 + 能常驻桌面 + 语音输入 + 传感器地基**

**技术实现：**

```
知识提取引擎 ★★★★★（核心新增，SkillMate 融入）

src/knowledge/extractor.ts — 六类隐性知识提取
├ 六类隐性知识自动识别：
│  ├ ① 决策规则："什么情况下选A不选B"
│  ├ ② 例外边界："常规方法不管用时怎么办"
│  ├ ③ 模式识别："一看就知道"
│  ├ ④ 风险判断："什么情况下会出事"
│  ├ ⑤ 人的因素："怎么跟人打交道"
│  └ ⑥ 失败经验："判断失误的教训"
├ 提取机制：
│  ├ 异步触发：每轮对话结束后自动分析最近 5-10 条消息
│  ├ LLM 提示工程：区分"用户个人经验" vs "通用知识引用"
│  ├ 置信度过滤：confidence < 0.6 的丢弃
│  └ 去重检测：与已有知识节点比较，避免重复
├ 与 STMP 集成：
│  ├ 提取的知识直接写入 STMP 对应房间
│  ├ 自动关联概念 → 语义星图新增边
│  ├ 利用 Ebbinghaus 衰减管理知识生命周期
│  └ 梦幻巩固时可回放和提炼提取的知识
└ 与认知引擎集成：
   ├ 领域画像新增字段：domainType / depthScore / expertiseSignals
   ├ 领域成长阶段：seed(<20条) → sprout(20-100) → growing(100-500) → mature(>500, 质量>85%)
   └ 达到 mature 时主动建议创建能力包

src/knowledge/domain-detector.ts — 领域识别增强
├ 从对话中自动识别专业领域（不只识别技术栈）
├ 深度评分 = 对话频次 × 专业信号密度 × 知识独特性
├ 自动排除：闲聊、低频兴趣、泛泛查询
├ 判定条件：30天内该领域对话≥15次 + 深度≥0.6 + 专业信号≥5
└ 领域类型自动分类：规则型/模式识别型/创造型/关系型

知识提取 Prompt 设计：
├ 系统 Prompt 包含六类知识定义 + 示例
├ 用户消息 + Agent回复 → 交叉分析
├ 输出结构化 JSON：{type, content, domain, confidence, concepts}
└ 支持批量处理（一次分析 10 条对话）

养成系统 v2 — 养成即引导 ★（详见第十八章）：
├ 核心转变：养成不是游戏层，是产品的引导引擎
├ 精灵的成长 = 用户对产品的探索深度

功能探索图谱（取代通用 XP）：
├ 25 个功能节点：basic(6) + advanced(10) + expert(6) + hidden(5)
├ 追踪每个功能的 discovered / useCount / mastery
├ mastery 非线性映射：对数曲线，1次≈20, 10次≈62, 50次≈97

能力解锁门控（取代通用等级）：
├ 🥚 蛋（默认）→ 🐣 幼年（basic≥3）→ 🦊 成长（basic满+advanced≥2）
├ → 🐺 成熟（advanced≥6）→ 🐲 完全（advanced≥8+expert≥3）→ 🌟 传说（全满+hidden≥2）
├ 每次进化：解锁可见的新功能 + 引导下一步
└ 进化属性加成：战斗属性自动增长

引导引擎（取代通用成就）：
├ 16 个引导任务，动态推荐下一个未探索的功能
├ 优先级队列：basic > advanced > expert > hidden
├ 触发条件：每次对话结束 / 连续3天没用新功能 / 空闲时概率推荐
├ 频率控制：最多每5条消息推荐一次，不打扰
└ 引导气泡 UI：特殊消息样式，[试试看] / [稍后再说]

5维属性行为涌现（取代手动滑动条）：
├ 毒舌 snark ← 用户反馈（鼓励-否定）+ 纠正次数
├ 智慧 wisdom ← 高级/专家工具使用量 + 工具种类数
├ 混乱 chaos ← 工具种类数（跳跃度）
├ 耐心 patience ← 重复问题次数 - 否定次数
├ 调试 debugging ← exec/search_files/analyze_file/find_references 使用量
└ 每 100 条交互重新计算，注入 System Prompt

亲密度 = 使用深度（取代 trust + 旧 intimacy）：
├ 新发现功能 +5 / 使用10次 +2 / 50次 +5 / 连续7天 +5
├ 深夜/清晨使用 +3 / 纠正后继续使用 +5 / 长期不用 -1/天
├ 0-20 陌生 → 21-40 熟悉 → 41-60 朋友 → 61-80 亲密 → 81-100 灵魂伴侣
└ 亲密度影响：回复长度/主动推荐/高级工具确认豁免/自主性级别

桌面端（Electron / Tauri）：
├ 常驻屏幕角落
├ 系统托盘集成
├ 本地文件系统完整访问
├ Git 感知（实时）
├ 开机自启
├ 窗口置顶 / 半透明
├ 全局快捷键呼出对话
└ 屏幕感知基础：desktopCapturer 截图 + 活跃窗口标题

耳朵 STT ★（基于 Week 4 AudioStreamManager 接口）
├ STT 后端适配层
│  ├ 浏览器 Web Speech API（前端，免费，无需后端）
│  ├ Whisper API（OpenAI，高精度）
│  └ 本地 Whisper.cpp（离线方案）
├ AudioStreamManager 接口落地实现
│  ├ navigator.mediaDevices.getUserMedia({ audio: true })
│  ├ 设备枚举 + 权限请求 + 降噪
│  ├ MediaRecorder 分段录制（每 3-5 秒一段）
│  └ WebSocket 音频流后传
├ 用户语音交互
│  ├ 点击麦克风 → 录音 → STT → Agent 正常处理
│  ├ 实时文字预览
│  └ 波形可视化
└ 文件：src/voice/stt.ts + src/voice/mic-manager.ts + src/voice/audio-stream.ts

传感器统一接口落地 ★（基于 Week 4 SensorManager 接口）
├ SensorManager 浏览器 API 实现
│  ├ Geolocation API → getLocation() / watchLocation()
│  ├ DeviceMotion API → getMotion() 步态检测
│  ├ Ambient Light API → getAmbientLight()
│  └ Network Information API → getNetworkInfo()
├ PhysicalContext 聚合实现
│  ├ 多传感器数据 → 统一 PhysicalContext 对象
│  ├ 定时刷新（每 30 秒聚合一次）
│  └ PhysicalContext → Agent 上下文注入
└ 文件：src/perception/sensors.ts + src/perception/location.ts +
       src/perception/motion.ts + src/perception/environment.ts

多精灵系统：
├ 收藏柜 UI（最多 20 只）
├ 每只独立：外观/性格/记忆/进化阶段
├ 蛋孵化系统（稀有度随机）
└ 装扮系统（帽子/眼镜/围巾/背包/特效）
```

**交付标准：**
每只 Buddy 独一无二。桌面常驻，开机即用。会成长、会进化、会做梦。
+Buddy 能自动从对话中提取专业知识，识别用户的领域画像，知识在 STMP 房间中积累。

---

#### Week 11-12 — 能力包系统 ★NEW + 桌面版打磨 + 专属形象

> **目标：知识不再只是"记忆"，而是可以创建、使用、分享的"能力包"**

**用户感受到的变化：**

```
之前：Buddy 记住了你的经验，但只能在自己的对话中用
现在：
├ 领域达到 mature → Buddy 主动建议："要不要把骨科知识打包成能力包？"
├ 一键创建 → 5 分钟内生成专属能力包
├ 使用能力包 → 该领域回答质量明显提升
├ 分享给好友 → 好友的 Buddy 加载后也能用你的专业知识
└ 能力包面板 → 查看所有包的状态、知识量、质量评分
```

**技术实现：**

```
能力包系统 ★★★★★

src/skills/package.ts — 能力包核心
├ 数据结构：
│  ├ id / name / domain / domainType
│  ├ growthStage: 'seed' | 'sprout' | 'growing' | 'mature'
│  ├ knowledgeCount / qualityScore
│  ├ sourceRoom: string（对应的 STMP 房间 ID）
│  ├ promptTemplate: string（领域 Prompt 模板）
│  ├ metadata: { creator / createdAt / version / tags }
│  └ status: 'private' | 'shared' | 'published'
├ 创建流程：
│  ├ 1. 从 STMP 房间导出知识节点（自动脱敏）
│  ├ 2. 质量筛选（丢弃 confidence < 0.5 的节点）
│  ├ 3. 结构化整理（按六类知识分类）
│  ├ 4. 生成领域 Prompt 模板
│  ├ 5. 打包为可分享格式（JSON + 向量索引）
│  └ 6. 质量评估 → 生成评分报告
└ 存储：本地 SQLite 扩展表 + STMP 房间关联

src/skills/scheduler.ts — 包调度器
├ 调度逻辑（比 SkillMate 更优雅——基于 STMP）：
│  ├ 1. STMP 定位房间
│  ├ 2. 检查该房间是否有对应能力包
│  ├ 3. 根据包成熟度选择策略：
│  │   ├ seed/sprout → 普通 STMP 检索（包还不够好）
│  │   ├ growing → 混合模式（STMP + 包知识，各 50%）
│  │   └ mature → 包主导（80% 包知识 + 20% STMP 关联）
│  └ 4. 无对应包 → 普通对话 + 同时开始积累
├ 跨领域调度：
│  ├ 检测问题涉及的多个领域
│  ├ 多个包协作回答
│  └ 示例："写骨科论文" → 骨科包 + 写作包 + 通用模型
└ 与认知引擎联动：
   ├ 包调度结果注入 SelfModel.confidence
   └ "我在骨科领域有 92% 的置信度"

src/skills/evaluator.ts — 质量评估
├ 自动测试生成（LLM-as-Judge）：
│  ├ 从知识库中自动生成测试题
│  ├ 用包回答 → 与原始知识对比
│  └ 多维度评分：准确性/完整性/专业性/一致性/风格匹配
├ 差异化质量标准：
│  ├ 高风险领域（医疗/法律/金融）：阈值 ≥90%
│  ├ 中风险领域（工程/教育/咨询）：阈值 ≥80%
│  └ 低风险领域（烹饪/摄影/健身）：阈值 ≥70%
├ 质量不达标时：自动降级到普通 STMP 检索
└ 评估报告：用用户能理解的语言展示（"在骨折分型方面准确率 94%"）

src/skills/export.ts — 包导出/分享
├ 分享格式：
│  ├ 能力包 JSON（知识节点 + Prompt 模板 + 元数据）
│  ├ 脱敏处理：自动移除个人隐私信息
│  └ 压缩打包（通常 < 500KB）
├ 分享方式：
│  ├ P2P 好友间直接发送
│  ├ 导出为文件（.skillmate 格式）
│  └ 导入到另一个 Buddy 实例
└ 权限控制：
   ├ 仅自己可见（默认）
   ├ 指定好友可见
   └ 公开分享（远期，配合市场）

src/skills/version.ts — 版本管理
├ 每次知识量增加 50+ 条自动创建版本
├ 版本内容：知识快照 + Prompt 模板 + 质量报告
├ 用户操作：查看历史 / 对比差异 / 一键回滚
└ 版本号：v1.0 / v1.1 / v2.0

差异化安全策略：
├ 高风险领域（医疗/法律/金融）
│  ├ 必须加免责声明
│  ├ 检测到高风险问题时自动建议咨询真人
│  └ 质量不达标自动降级到通用模型
├ 中风险领域：标注"仅供参考"
└ 低风险领域：直接给建议

桌面版打磨：
├ Electron/Tauri 应用稳定性优化
├ 系统托盘 + 开机自启
├ 窗口管理（置顶/半透/最小化到托盘）
├ 全局快捷键
└ 屏幕感知：desktopCapturer + 活跃窗口标题

AI 图像生成：
├ Prompt 工程 + 模板系统
├ 用户描述 → 4 候选生成 + 预览
├ 风格库（像素/卡通/水彩/赛博/暗黑/国风/毛绒/手绘）
├ 自动生成动画帧
└ Sprite Sheet + JSON 配置导出
```

**交付标准：**
领域达到 mature 时，一键创建能力包。使用能力包后回答质量明显提升。能分享给好友。质量不达标时自动降级保证安全。

---

### Phase C — 硬件感知 + 能力包分享 + 生态（Week 13-20）

> 硬件感知落地 + 能力包评估与分享 + 社交 + 商业化 + 正式上线

---

#### Week 13 — 摄像头实时视频 + 看护模式

> **目标：摄像头从"拍一帧"升级到"持续看"**

**技术实现：**

```
摄像头实时能力（基于 Phase B CameraManager）：
├ 实时视频流：getUserMedia → 持续 MediaStream
├ 定时截帧分析（每 N 秒截一帧 → 多模态模型）
├ 变化检测捕获：前后帧像素差异 > 阈值 → 触发分析
├ 桌面看护模式
│  ├ 用户离开 → Buddy 切换为"看护模式"
│  ├ 定时截帧分析环境（每 5 分钟）
│  ├ 检测到用户回来 → 主动打招呼
│  └ 异常检测：陌生人出现 → 通知用户
├ 画面理解深化
│  ├ 人脸检测（前端 TensorFlow.js 或云端 API）
│  ├ 动作识别（"你在打字"/"你在看手机"）
│  ├ 场景识别（"你在办公室"/"你在户外"）
│  └ 表情分析 → 情绪引擎联动
└ 文件：src/vision/face-detect.ts + src/vision/scene-analyze.ts

隐私安全强化：
├ 摄像头状态指示器（红点 + "录制中"）
├ 视频帧不持久化存储
├ 隐私模式：一键关闭
└ 权限分级：低信任度 → 仅手动触发
```

---

#### Week 14 — 麦克风持续监听 + 唤醒词 + 声音事件

> **目标：麦克风从"点按钮录音"升级到"一直在听"**

**技术实现：**

```
麦克风持续能力（基于 Phase B AudioStreamManager）：
├ 持续监听模式：后台低功耗音频流
├ 唤醒词检测
│  ├ Porcupine（Picovoice，本地 WASM，低功耗）
│  ├ 支持自定义唤醒词
│  └ "Hey Buddy" → 自动开始听取指令
├ 声音事件检测
│  ├ 门铃/敲门声 → "有人敲门"
│  ├ 警报声 → "检测到警报声"
│  ├ 宠物叫声 → "你的猫在叫"
│  └ 玻璃碎裂声 → "有东西碎了？"
├ 语音情绪分析
│  ├ 语速加快 → 着急/生气
│  ├ 音量降低 → 疲惫/失望
│  └ 情绪结果注入 Buddy 情绪引擎
└ 文件：src/voice/wakeword.ts + src/voice/sound-events.ts +
       src/voice/emotion-voice.ts

隐私安全：
├ 持续监听仅本地处理唤醒词，不上传音频
├ 录音数据不持久化（唤醒词后才保存）
└ 麦克风状态指示器（波形动画）
```

---

#### Week 15 — 设备传感器 + 物理上下文融合

> **目标：Buddy 感知物理世界 — 你在哪、在干嘛、环境怎样**

**技术实现：**

```
传感器全面接入（基于 Phase B SensorManager）：
├ GPS 定位 + 地理围栏
│  ├ 到公司 → 自动切换工作项目上下文
│  ├ 到家 → 切换居家模式
│  ├ 天气联动 → "今天有雨，记得带伞"
│  └ 常去地点记忆
├ 运动感知
│  ├ 步态检测：走路/跑步/静止
│  ├ 跌倒检测 → "你还好吗？"
│  └ 运动追踪 → "今天走了 8000 步"
├ 环境感知
│  ├ 环境光 → "天黑了，注意休息"
│  ├ 噪音级别 → 调整 TTS 音量
│  └ 网络环境 → "你用的是流量，要减少图片分析吗？"
└ 物理上下文融合 ★
   ├ PhysicalContext 聚合所有传感器数据
   ├ 定时刷新 → Agent 上下文注入
   └ Buddy 根据物理环境调整行为
      ├ "你在走路，简短回复"
      ├ "外面很暗了，早点休息"
      └ "网络不好，不分析图片了"

文件：
├ src/perception/context-fusion.ts  # 物理上下文融合
└ src/perception/privacy-sensor.ts  # 传感器隐私控制
```

---

#### Week 16 — 能力包评估系统 + 分享网络

> **目标：能力包从"自己用"升级到"可分享"**

**技术实现：**

```
能力包评估深化：
├ LLM-as-Judge 自动测试
│  ├ 从知识库自动生成 20-50 道测试题
│  ├ 跨模型验证（用不同 LLM 回答同一问题，看一致性）
│  └ 弱项识别 + 引导用户补充
├ 用户反馈回流
│  ├ 用户使用能力包后的满意度评分
│  ├ 纠正信号 → 更新对应知识节点权重
│  └ 低评分触发重新评估
└ 评估报告可视化：雷达图（准确性/完整性/专业性/一致性/风格）

分享网络：
├ 好友间 P2P 分享（局域网 / 互联网直连）
│  ├ 选择能力包 → 选择好友 → 发送 .skillmate 文件
│  ├ 接收方一键导入
│  └ 分享后原始知识仍属于分享者
├ 分享权限控制
│  ├ 只读（接收方只能用，不能改）
│  ├ 可编辑（接收方可以补充自己的知识）
│  └ 可再分享（接收方可以继续传播）
└ 隐私保护：
   ├ 发布前自动脱敏所有个人隐私信息
   ├ 用户可选择只分享知识结构，不分享原始对话
   └ 接收方看不到分享者的身份信息
```

---

#### Week 17 — 社交 + 多平台

> **目标：让人"传"起来**

**技术实现：**

```
社交功能：
├ 好友系统（添加/删除/在线状态）
├ 精灵串门（你的精灵去好友屏幕待一会儿）
├ 精灵对话（两只精灵自动聊天，AI 生成）
├ 精灵合影（生成分享卡片）
├ 排行榜（等级/互动/成就/知识包数量★）
├ 能力包排行榜（基于质量评分+使用次数）
└ 分享传播（卡片+二维码+邀请奖励）

多平台：
├ CLI 终端版（npm install -g buddy）
│  ├ ANSI 终端渲染（小精灵字符画）
│  ├ Git 深度集成（commit 时自动评价）
│  └ 轻量，不占资源
├ 浏览器插件（Chrome Extension）
│  ├ GitHub PR Review / Issue 分析
│  ├ 任意网页 Buddy 悬浮窗
│  └ 选中文字 → 解释/翻译/总结
└ 消息平台接入（Telegram Bot / Discord Bot）
```

---

#### Week 18 — 商业化

> **目标：开始赚钱**

**技术实现：**

```
付费体系：
├ 免费版 → Pro 升级流程
├ 支付集成（支付宝 / 微信 / Stripe）
├ 订阅管理（续费 / 取消 / 降级）
└ 付费功能开关

Pro 特权：
├ 20 只精灵上限（免费 3 只）
├ 无限 AI 生成 + 无限对话（更强模型）
├ 全部风格 + 高级风格
├ 完整工具调用 + STMP 记忆宫殿
├ 知识提取引擎（免费版每月提取 50 条，Pro 无限）★
├ 云端增强检索（向量 Embedding + Reranking）★
└ 专属装饰 / 特效

能力包商业化（初期）：
├ 免费版：3 个能力包上限，仅本地使用
├ Pro 版：无限能力包 + 分享给好友
├ 能力包质量评分 > 90% 的可标记为"优质包"
└ 优质包排名靠前，获得更多曝光

云端 LoRA 微调接口预留 ★（不启用，只做架构准备）：
├ 定义 LoRA 微调 API 接口
├ 本地知识 → 脱敏导出格式
├ LoRA 权重下载到本地推理的协议
└ 等用户规模达到后正式启用

装扮商城 + 赛季活动：
├ 商品列表 + 预览
├ 限定精灵/装饰/背景
├ 排行榜 + 全服协作任务
└ 首个赛季上线
```

---

#### Week 19-20 — 正式上线

> **目标：产品打磨到可以上线**

**技术实现：**

```
链上备份（可选）：
├ 用户可以把 Buddy "永久存档"到链上
├ 推荐 Base L2（Gas 几乎为零）
└ 数据：tokenId / owner / genomeHash / rarity / stage / level

上线准备：
├ 性能优化（渲染帧率 / 内存 / 启动速度）
├ 压力测试（并发 / 长时间运行 / STMP 大规模记忆 / 能力包创建流程）
├ 安全审计（最终版）
├ 用户文档完善
├ Landing Page
├ 发布渠道（npm / GitHub Release / 官网）
└ 推广计划（开发者社区 / 社交媒体）
```

---

## 十五、商业模式

### 收入结构

```
Pro 订阅 ¥9/月（主要）：
├ 20 只精灵上限
├ 无限 AI 生成 + 无限对话
├ 全部风格 + 高级风格
├ 完整工具调用 + Agent 自主执行
├ STMP 记忆宫殿 + 梦幻巩固
├ 知识提取引擎（无限提取）★
├ 无限能力包 + 分享给好友 ★
├ 云端增强检索（向量 Embedding + Reranking）★
└ 专属装饰 / 特效

Team ¥29/人/月：
├ Pro 全部功能
├ 团队精灵互动
├ 团队能力包共享库 ★
├ 管理后台
└ 团队 Agent 工作流

装饰商城（次要）：
├ 限定特效 / 背景 / 配饰
├ 节日限定 / 品牌联名
└ 创作者分成

能力市场（远期，当能力包数量 > 500 个时启动）：
├ 按调用次数计费（训练者设定单价）
├ 训练者 70%，平台 30%
├ 云端 LoRA 微调服务（按量付费）★
└ 平台手续费
```

### 免费版

```
├ 3 只精灵上限
├ 每天 3 次 AI 生成
├ 4 种基础风格
├ 基础 AI 对话（每天 20 条）
├ 基础工具调用（文件 / 搜索）
├ 基础记忆（STMP 本地存储）
├ 知识提取：每月 50 条上限 ★
├ 能力包：3 个上限，仅本地使用 ★
└ 无广告
```

---

## 十六、竞争壁垒

```
1. STMP 时空记忆宫殿 ★ 核心壁垒
   ├── 第一个用记忆宫殿范式的 AI Agent 记忆系统
   ├── 房间 + 时间轴 + 语义星图 ≠ 向量搜索
   ├── 4 步导航检索 → 返回有上下文的故事，不是片段
   ├── Ebbinghaus 衰减 + 压缩 + 休眠 = 类人记忆生命周期
   └── 不可被 Mem0/Zep/MemGPT 简单复制（范式不同）

2. 梦幻记忆巩固 ★ 独一无二
   ├── 闲时自动回放/提取/关联/修剪
   ├── 随机漫步发现隐藏联系（创造性联想）
   ├── 梦境日志 → 产品层面的情感差异化
   └── 市面上没有任何 AI Agent 做了这件事

3. 六类隐性知识提取 ★ 技术壁垒（SkillMate 融入）
   ├── 决策规则 / 例外边界 / 模式识别 / 风险判断 / 人的因素 / 失败经验
   ├── 不是简单的对话总结，是结构化的专业知识编码
   ├── 与 STMP 结合：知识有时空坐标和语义关联
   └── 通用 AI 笔记工具做不到这种粒度

4. 本地能力包系统 ★ 隐私壁垒
   ├── 知识永远在用户本地，不上云
   ├── 不需要向量数据库/云服务，单机 SQLite 即可
   ├── P2P 分享，不需要中心化市场
   └── 对知识敏感的用户（医生/律师/金融）天然信任

5. 三层认知架构 ★ 差异化
   ├── 用户模型 → 不只是"记住了"，而是"理解了"
   ├── 自我模型 → 有成长感，不是每次重置
   ├── 意图引擎 → 有主动性，不是纯被动工具
   └── 三层联动 → "它了解我，它有自己的想法，它会主动帮我"

6. Agent 能力 + 形象一体化
   ├── 不是"给 ChatGPT 套个皮肤"
   ├── 执行过程有可视化（角色在帮你干活）
   └── 需要后端事件流 + 前端状态机深度结合

7. 性格驱动的能力表达
   ├── 同样的工具调用，不同性格说不同的话
   ├── 需要 Prompt 工程 + 属性系统深度结合
   └── 不是简单换 system prompt

8. 信任度 + 权限系统
   ├── "AI 有多大胆"不应该是固定的
   ├── 信任是赚来的，不是给的
   └── 让 Buddy 真正成为"伙伴"而非"工具"

9. 知识商品化能力 ★ 新增壁垒
   ├── 从对话中自动提取 → 结构化存储 → 能力包创建 → 分享
   ├── 端到端的知识变现链路，市面上没有完整产品
   ├── 云端 LoRA 微调预留（未来拉开付费差距）
   └── 本地 80 分 + 云端 95 分的混合架构

10. 情感积累
    ├── 养了 180 天的精灵不是说换就换的
    ├── 记忆 + 日记 + 梦境 + 关系 + 知识积累 = 极高迁移成本
    └── 时间就是壁垒

11. 自包含极简体验
    ├── 不依赖 OpenClaw 或任何重框架
    ├── 一条命令安装
    └── 降低用户门槛 = 扩大用户基数
```

---

## 十七、风险评估

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| STMP 检索质量不如向量搜索 | 中 | 高 | 混合方案：STMP 主导 + 向量搜索兜底 |
| 梦幻巩固 LLM 成本过高 | 中 | 中 | 控制频率（每天1次）+ 用便宜模型 |
| 认知三层 prompt 膨胀 | 中 | 中 | 动态注入，按相关性裁剪 |
| AI 生成形象质量不稳定 | 高 | 中 | 多轮生成 + 默认精美素材兜底 |
| 沙箱安全漏洞 | 中 | 高 | 严格路径拦截 + 正则命令拦截 + 审计 |
| LLM API 成本过高 | 中 | 中 | 缓存 + 压缩上下文 + 本地模型兜底 |
| 安装体验失败 | 中 | 高 | 多安装方式 + 详细文档 + 自动检测环境 |
| 用户增长慢 | 中 | 高 | 开发者社区冷启动 + 分享裂变 |
| 竞品快速模仿 | 低 | 中 | STMP+梦幻+认知三层+知识提取 = 4 个独立壁垒 |
| 知识提取质量不够好 ★NEW | 高 | 高 | 用户确认机制 + 置信度过滤 + 持续优化 Prompt |
| 用户不愿意被"观察" ★NEW | 中 | 高 | 明确告知采集范围 + 提供关闭选项 + 数据本地化 |
| 能力包回答出错导致后果 ★NEW | 中 | 高 | 高风险领域免责声明 + 质量不达标自动降级 |
| 用户等不及 60-90 天积累 ★NEW | 中 | 中 | 游戏化进度展示 + 阶段性成就感 + 快速反馈 |
| 知识归属争议 ★NEW | 低 | 中 | 明确知识所有权归用户 + 脱敏机制 + 导出删除权 |

---

## 十八、里程碑

```
M0 (Week 1)：最小可用 — "能用 + 有脸 + 能搜索" ✅ 已完成
├ Agent 引擎跑通（LLM + Tool Use + 沙箱）
├ 流式输出
├ search_web / fetch_url / analyze_file 工具
├ 命令安全升级（正则 + 路径防护）
├ 默认精灵形象（4 状态切换 + 对话气泡）
├ 性格系统（5 维属性 → Prompt）
├ 记忆基础（会话 + SQLite）
├ 配置持久化（~/.buddy/config.json）
├ 安装引导（buddy init）
└ 判断标准：能看到一个角色，它能对话、能执行任务、能搜索网络

M1 (Week 4)：内测版 — "认识你 + 活过来 + 感知层地基" ✅ 已完成
├ 记忆完善（长期 + 日记）
├ 主动感知（Git / 时间 / 终端）
├ buddy learn 命令
├ 信任度 + 安全机制
├ 形象升级（帧动画 + 表情 + 摸头 + 情绪）
├ 安装体验打磨
├ 工具结果格式化（行数限制 + 截断标记）
├ 感知层接口定义（Camera/Audio/Sensor Manager 类型）
├ 感知事件总线协议
├ 隐私权限框架设计
└ 判断标准：10 个开发者用了一周，觉得"它认识我了"+ 所有感知接口已定义

M2 (Week 6)：STMP 版 — "记忆宫殿" ✅ 已完成
├ STMP 三层存储（房间 + 时间轴 + 语义星图）
├ 4 步导航检索
├ Ebbinghaus 衰减 + 生命周期
├ 项目自动扫描
├ CameraManager 接口定义
└ 判断标准：回答质量比扁平搜索明显提升，有跨房间联想

M3 (Week 8)：认知版 — "有思想的伙伴" ✅ 已完成
├ 梦幻巩固引擎（回放/提取/关联/修剪）
├ 梦境日志
├ 用户模型（身份/行为/偏好/关系/演化）
├ 自我模型（能力/叙事/情绪/反思）
├ 意图引擎（微目标/好奇心/主动性）
└ 判断标准：Buddy 对不同用户说不同的话，会主动建议，会做梦

M4 (Week 10)：知识版 — "能从对话中学东西" ★NEW
├ 六类隐性知识自动提取引擎
├ 领域识别 + 成长阶段模型（seed→sprout→growing→mature）
├ 知识写入 STMP 房间（不是独立存储）
├ 认知引擎升级：领域画像 + 专业深度评分
├ 养成系统（等级 + 进化 + 成就 + 技能树）
├ 桌面端应用
├ STT 语音输入
├ SensorManager 浏览器 API 实现
└ 判断标准：对话后自动提取知识节点 → 写入 STMP → 领域画像正确更新

M5 (Week 12)：能力包版 — "能把经验打包分享" ★NEW
├ 能力包一键创建（从 STMP 房间导出）
├ 包调度器（根据成熟度选择策略：STMP/混合/包主导）
├ 质量评估（LLM-as-Judge + 差异化安全策略）
├ 包导出/分享格式（.skillmate 文件）
├ P2P 好友间分享
├ 版本管理
├ 桌面版打磨 + AI 生成形象
└ 判断标准：达到 mature 的领域可一键创建包 → 使用后回答质量提升 → 能分享给好友

M6 (Week 15)：硬件版 — "能看能听能感受世界"
├ 摄像头实时视频 + 看护模式
├ 人脸检测 + 动作识别 + 表情分析
├ 麦克风持续监听 + 唤醒词检测
├ 声音事件检测（门铃/警报/宠物）
├ 语音情绪分析
├ 设备传感器全面接入 + 地理围栏
├ 物理上下文融合 → Agent 行为调整
└ 判断标准：Buddy 能持续感知物理环境并做出反应

M7 (Week 17)：社交版 — "能传起来"
├ 社交功能（好友/串门/排行榜/分享）
├ 能力包排行榜
├ CLI 终端版 + 浏览器插件
├ 多平台可用
└ 判断标准：能力包在好友间传播，DAU 1000

M8 (Week 20)：正式版 — "能赚钱 + 全平台"
├ Pro 订阅上线（含知识提取+能力包特权）
├ 云端增强检索（向量 Embedding + Reranking）可选启用
├ 云端 LoRA 微调接口预留
├ 装扮商城 + 赛季活动
├ 全平台可用
└ 判断标准：付费转化 > 3%，DAU 10000
```

---

## 十九、感知层 — 眼耳口鼻触

> Buddy 不只是"能对话"，它要能看、能听、能说、能感知、能触碰。
> 五感是 Buddy 从"工具"变成"生命体"的关键层。

### 19.1 感知层总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Buddy 感知层                                    │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────┤
│  👁️ 眼睛  │  👂 耳朵  │  👄 嘴巴  │  👃 鼻子  │  🖐️ 皮肤  │   ✋ 触觉         │
│  Vision  │  Audio   │  TTS     │  Sense   │  Sensor  │   Touch         │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────────────┤
│ 看图理解  │ 语音输入  │ 语音输出  │ 环境嗅探  │ 设备传感器 │ 交互反馈          │
│ OCR识别  │ 实时STT  │ 多音色   │ 文件监听  │ GPS定位   │ 摸头/点击/拖拽    │
│ 屏幕截图  │ 语音指令  │ 情绪语气  │ Git感知   │ 陀螺仪   │ 长按/连击/手势    │
│ 代码视觉  │ 声音事件  │ 流式TTS  │ 进程监控  │ 环境光   │ 物理反馈(远期)    │
├──────────┼──────────┼──────────┼──────────┼──────────┤                  │
│ 📷 摄像头 │ 🎤 麦克风 │          │          │ 📱 加速度 │                  │
│ 实时视频  │ 实时音频流 │          │          │ 🧭 指南针 │                  │
│ 画面理解  │ 声纹/情绪 │          │          │ 🌡️ 温度   │                  │
│ 动作识别  │ 环境音分类 │          │          │ 🔊 麦克风 │                  │
│ 人脸识别  │          │          │          │   阵列   │                  │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────────────┘

感知层分为两个维度：
├ 软件感知（左 4 列）：对软件环境的感知 — 文件、代码、网络、进程
└ 硬件感知（右 2 列）：对物理世界的感知 — 摄像头、麦克风、传感器
```

### 19.2 各感官详细规划

#### ✋ 触觉 — Phase A P4 基础 / Phase B 深化

```
现状：前端已有摸头/点击粒子效果，但后端无对应事件协议

P4 基础（现在）：
├ 后端 TouchEvent 协议定义
│  ├ pet（摸头）→ 情绪 onPet() + 信任度 +1
│  ├ tap（点击）→ 随机反应
│  └ hold（长按）→ 享受反应
├ Agent 响应逻辑（情绪联动 + 记忆记录）
├ 前端事件发送（已有，补齐协议）
└ WebSocket 事件：{ type: 'touch', action: 'pet'|'tap'|'hold' }

Phase B 深化：
├ 连击检测（快速点击 → 摸懵反应）
├ 拖拽交互（拖动精灵到不同位置）
├ 手势识别（画圈/滑动）
└ 物理反馈（手机振动 API，远期）
```

#### 👄 嘴巴（TTS）— Phase B Week 5-6

```
目标：Buddy 能"说话"，而不只是显示文字

技术方案：
├ TTS 后端适配层（统一接口）
│  ├ MiMo TTS（小米语音合成，优先）
│  ├ Edge TTS（微软免费，兜底）
│  ├ OpenAI TTS（高质量，付费）
│  └ 本地 Piper（离线方案）
├ 音色选择
│  ├ 按物种匹配默认音色
│  ├ 用户自选音色
│  └ 情绪语气调节（开心→上扬，疲惫→低沉）
├ 流式 TTS
│  ├ LLM 输出一句话 → 立即 TTS → 前端播放
│  └ 边说边播，不等全文生成完
└ 前端音频播放
   ├ Web Audio API
   ├ 打字机效果 + 语音同步
   └ 音量控制 / 静音切换

文件结构：
├ src/voice/tts.ts          # TTS 适配层
├ src/voice/mimo-tts.ts     # MiMo TTS 实现
├ src/voice/edge-tts.ts     # Edge TTS 实现
└ src/voice/openai-tts.ts   # OpenAI TTS 实现

前端改动：
├ WebSocket 新增事件：{ type: 'audio', data: base64_mp3 }
├ 音频播放队列（按句播放，不重叠）
└ 设置面板：音色选择 / 音量 / 开关
```

#### 👁️ 眼睛（视觉）— Phase B Week 7-8

```
目标：Buddy 能"看懂"图片、截图、代码截图，并能主动调用摄像头观察物理世界

=== 软件视觉（被动接收图片）===

技术方案：
├ 视觉理解适配层
│  ├ MiMo Omni（小米多模态，优先）
│  ├ GPT-4o Vision（通用视觉）
│  └ 本地模型（llava，离线方案）
├ 能力清单
│  ├ 图片描述（用户发图 → Buddy 评论）
│  ├ OCR 识别（截图中的文字提取）
│  ├ 代码截图理解（看截图分析代码问题）
│  ├ UI 截图分析（"这个布局有什么问题"）
│  └ 图表理解（柱状图/流程图解读）
├ 输入方式
│  ├ 前端拖拽/粘贴图片
│  ├ CLI 参数传入图片路径
│  ├ 截图自动分析（配合鼻子的文件监听）
│  └ 聊天中发送图片

=== 硬件视觉（主动调用摄像头）★ NEW ===

触发模式：
├ 用户指令触发："帮我看看摄像头里有什么"
├ 定时巡检触发：每 N 分钟截取一帧分析（桌面看护模式）
├ 事件触发：检测到人脸出现/消失 → 主动打招呼
└ 交互触发：用户点击"拍照"按钮 → 拍一帧发给 Buddy

技术方案：
├ 前端摄像头接入
│  ├ navigator.mediaDevices.getUserMedia({ video: true })
│  ├ 支持前置/后置摄像头切换（移动端）
│  ├ 支持分辨率选择（480p/720p/1080p）
│  ├ 支持多摄像头设备枚举 + 用户选择
│  └ 视频预览 + 状态指示器（录制中红点）
├ 帧捕获策略
│  ├ 手动捕获：用户点击 → Canvas 截取当前帧 → base64 发送
│  ├ 定时捕获：setInterval + Canvas → 每 N 秒截一帧
│  ├ 变化检测捕获：前后帧像素差异 > 阈值 → 触发捕获
│  └ 连续流：MediaRecorder → 分段录制 → 定期发送
├ 画面理解能力
│  ├ 实时画面描述："你面前有一杯咖啡和一台 MacBook"
│  ├ 人脸识别（基础）："检测到 2 个人" / "你看起来在笑"
│  ├ 动作识别："你在打字" / "你在看手机"
│  ├ 场景识别："你在办公室" / "你在户外"
│  ├ 物体识别："桌上有一本书，书名是 XXX"（OCR 联动）
│  └ 表情分析："你看起来有点累"（情绪感知联动）
├ 桌面看护模式 ★
│  ├ 用户离开 → Buddy 切换为"看护模式"
│  ├ 定时截帧分析环境（每 5 分钟）
│  ├ 检测到用户回来 → 主动打招呼："你回来了！刚才有只猫路过"
│  └ 异常检测：陌生人出现 → 通知用户（需额外安全验证）
└ 安全与隐私 ★★★
   ├ 必须用户明确授权才能开启摄像头
   ├ 摄像头状态在 UI 明确显示（红点 + "录制中"）
   ├ 视频帧不持久化存储，用完即弃
   ├ 人脸识别数据不存储，仅用于实时判断
   ├ 隐私模式：一键关闭所有硬件感知
   ├ 敏感画面过滤（自动跳过私密场景）
   └ 权限分级：低信任度 → 仅用户手动触发；高信任度 → 可定时捕获

桌面端增强（Electron / Tauri）：
├ node-screenshots / desktopCapturer → 截取屏幕画面
│  ├ 全屏截图 + 区域截图
│  ├ 多显示器支持
│  └ 定时屏幕截图 → Buddy 能"看到"你在做什么
├ 窗口感知：获取当前活跃窗口标题
│  ├ "你在 VS Code 里改 index.ts"
│  ├ "你在 Chrome 里看 GitHub"
│  └ 自动关联上下文（配合鼻子的环境感知）
└ 屏幕录制（短期片段）
   ├ 录制 5-10 秒短片段用于分析
   ├ 仅在用户主动触发时使用
   └ 录完即分析，不留存

文件结构：
├ src/vision/omni.ts          # 多模态适配层
├ src/vision/ocr.ts           # OCR 识别
├ src/vision/screen.ts        # 屏幕截图分析
├ src/vision/camera.ts        # ★ 摄像头管理（设备枚举/流控制/帧捕获）
├ src/vision/frame-capture.ts # ★ 帧捕获策略（手动/定时/变化检测）
├ src/vision/face-detect.ts   # ★ 人脸检测（前端 TensorFlow.js 或云端 API）
├ src/vision/scene-analyze.ts # ★ 场景分析（调用多模态模型）
└ src/vision/privacy.ts       # ★ 隐私控制（权限/过滤/脱敏）

前端改动：
├ 摄像头权限请求流程（首次使用引导）
├ 摄像头预览窗口（可缩小为角落小窗）
├ 录制状态指示器（红点 + 文字）
├ 拍照/录像按钮
├ 摄像头切换按钮（前置/后置）
├ 设置面板：摄像头选择 / 分辨率 / 看护模式开关
└ WebSocket 新增事件：
   { type: 'camera_frame', data: base64_jpeg, timestamp: number }
   { type: 'camera_status', active: boolean, device: string }
```

#### 👂 耳朵（STT）— Phase B Week 9-10

```
目标：Buddy 能"听到"用户的语音指令，并能持续监听环境声音

=== 软件音频（用户主动语音输入）===

技术方案：
├ STT 后端适配层
│  ├ 浏览器 Web Speech API（前端，免费，无需后端）
│  ├ Whisper API（OpenAI，高精度）
│  ├ 硅基流动 STT（低成本）
│  └ 本地 Whisper.cpp（离线方案）
├ 实时语音识别
│  ├ 浏览器 MediaRecorder → WebSocket → STT 后端
│  ├ 连续识别模式（一直听着）
│  └ 唤醒词检测（"Hey Buddy"）
├ 语音指令处理
│  ├ 语音 → 文字 → Agent 正常处理
│  ├ 特殊指令（"帮我看看这个文件" → 自动读取当前编辑器文件）
│  └ 多语言支持（中/英/日）

=== 硬件音频（主动持续监听）★ NEW ===

触发模式：
├ 用户点击麦克风按钮 → 开始录音
├ 唤醒词触发："Hey Buddy" → 自动开始听取指令
├ 持续监听模式：后台低功耗监听（仅检测唤醒词）
└ 环境声音事件触发：检测到异常声音 → 主动通知

技术方案：
├ 前端麦克风接入
│  ├ navigator.mediaDevices.getUserMedia({ audio: true })
│  ├ AudioContext + AnalyserNode → 实时音频分析
│  ├ 支持多麦克风设备枚举 + 用户选择
│  ├ 支持降噪/回声消除（浏览器内置 AEC/NS）
│  └ 音量指示器 + 波形可视化
├ 实时音频流处理
│  ├ MediaRecorder → 分段录制（每 3-5 秒一段）
│  ├ AudioWorklet → 实时音频特征提取
│  ├ WebSocket → 音频流后传到后端处理
│  └ 流式 STT：边录边识别，不等录音结束
├ 唤醒词检测 ★
│  ├ 方案 A：Porcupine（Picovoice，本地，低功耗）
│  │  ├ 支持自定义唤醒词
│  │  ├ 浏览器 WASM 版本
│  │  └ 延迟 < 500ms
│  ├ 方案 B：本地小模型（VAD + 关键词检测）
│  └ 方案 C：Web Speech API 连续识别 + 正则匹配
├ 声音事件检测 ★
│  ├ 门铃/敲门声 → "有人敲门"
│  ├ 警报声 → "检测到警报声，注意安全"
│  ├ 玻璃碎裂声 → "有东西碎了？"
│  ├ 宠物叫声 → "你的猫在叫"
│  └ 婴儿哭声 → "宝宝好像醒了"（远期场景）
├ 说话人情绪分析 ★
│  ├ 语速加快 → 可能着急/生气
│  ├ 音量降低 → 可能疲惫/失望
│  ├ 语调上扬 → 开心/兴奋
│  └ 情绪结果注入 Buddy 情绪引擎
└ 安全与隐私 ★★★
   ├ 必须用户明确授权才能开启麦克风
   ├ 麦克风状态在 UI 明确显示（波形动画）
   ├ 持续监听模式仅本地处理唤醒词，不上传音频
   ├ 录音数据不持久化存储（唤醒词后才开始保存）
   ├ 隐私模式：一键关闭所有硬件感知
   └ 低信任度 → 仅用户手动触发录音

文件结构：
├ src/voice/stt.ts            # STT 适配层
├ src/voice/whisper.ts        # Whisper API
├ src/voice/wakeword.ts       # 唤醒词检测
├ src/voice/mic-manager.ts    # ★ 麦克风管理（设备枚举/流控制/降噪）
├ src/voice/audio-stream.ts   # ★ 实时音频流处理（分段/VAD/特征提取）
├ src/voice/sound-events.ts   # ★ 声音事件检测（门铃/警报/宠物）
└ src/voice/emotion-voice.ts  # ★ 语音情绪分析（语速/音量/语调）

前端改动：
├ 麦克风权限请求流程（首次使用引导）
├ 麦克风按钮 + 录音动画 + 波形可视化
├ 唤醒词指示器（"正在听..." 小图标）
├ 录音状态指示器
├ 设置面板：麦克风选择 / 唤醒词开关 / 降噪开关
└ WebSocket 新增事件：
   { type: 'audio_stream', data: base64_pcm, sampleRate: 16000 }
   { type: 'wakeword', word: "hey_buddy", confidence: 0.95 }
   { type: 'sound_event', event: "doorbell", confidence: 0.8 }
   { type: 'voice_emotion', emotion: "excited", confidence: 0.7 }
```

#### 👃 鼻子（环境感知）— 已有基础，Phase B 增强

```
现状：observer.ts 已有 Git 感知/时间关怀/项目扫描/模式检测

=== 软件嗅探 ===

Phase B 增强：
├ 文件系统监听（chokidar）
│  ├ 文件变更实时感知（保存 → Buddy 评论）
│  ├ 新文件创建感知
│  └ 大文件删除警告
├ 进程监控
│  ├ 开发服务器状态（npm run dev）
│  ├ 数据库连接状态
│  └ Docker 容器状态
├ 终端输出监听
│  ├ 捕获终端报错（已有基础）
│  ├ 构建输出分析
│  └ 测试结果感知
├ 网络感知
│  ├ API 响应时间监控
│  ├ 外部服务可用性
│  └ 网络延迟检测
└ 系统资源感知
   ├ CPU/内存使用率
   ├ 磁盘空间
   └ 电池电量（笔记本）

文件结构：
├ src/perception/observer.ts    # 已有，增强
├ src/perception/fs-watcher.ts  # 文件监听（新）
├ src/perception/proc-monitor.ts # 进程监控（新）
└ src/perception/net-probe.ts   # 网络感知（新）
```

#### 🖐️ 皮肤（设备传感器）★ NEW — Phase C

```
目标：Buddy 能感知物理世界的状态 — 位置、运动、环境光、温度等

适用场景：
├ 移动端 / 平板 / IoT 设备
├ 带传感器的桌面设备（部分笔记本有环境光/加速度）
└ 外接传感器设备（蓝牙温度计/心率带等，远期）

=== 位置感知 ===

技术方案：
├ 浏览器 Geolocation API
│  ├ navigator.geolocation.getCurrentPosition()
│  ├ navigator.geolocation.watchPosition()（持续追踪）
│  ├ 精度选择（粗略 IP 定位 / WiFi / GPS）
│  └ 权限：必须用户授权
├ 能力
│  ├ "你在公司附近，要帮你打开工作相关的项目吗？"
│  ├ "你到家了，切换到居家模式"
│  ├ 天气联动："你在北京，今天有雨，记得带伞"
│  ├ 位置记忆：记录常去地点 → 自动切换上下文
│  └ 位置触发：到达/离开某个地点 → 触发动作
└ 隐私：位置数据仅本地存储，不上传

=== 运动感知 ===

技术方案：
├ 浏览器 DeviceMotion / DeviceOrientation API
│  ├ window.addEventListener('devicemotion', ...)
│  ├ 加速度计（x/y/z 轴加速度）
│  ├ 陀螺仪（旋转角度）
│  └ 指南针（DeviceOrientationEvent.alpha）
├ 能力
│  ├ 步态检测：走路/跑步/静止 → Buddy 判断用户状态
│  ├ 跌倒检测：突然大幅加速度变化 → "你还好吗？"
│  ├ 方向感知：手机朝向 → AR 场景联动（远期）
│  └ 运动追踪：记录步数 → "今天走了 8000 步，不错"
└ 隐私：运动数据仅本地处理

=== 环境感知 ===

技术方案：
├ 环境光传感器（Ambient Light Sensor API）
│  ├ 检测环境亮度
│  └ "天黑了，要注意休息哦" / 自动调整 Buddy 亮度
├ 温度/湿度（需外接蓝牙设备，远期）
│  ├ 蓝牙 BLE 连接温度计
│  └ "室内 28°C，有点热"
├ 噪音级别（从麦克风 AudioContext 分析）
│  ├ RMS 音量计算
│  └ "周围很吵，建议戴上耳机" / 调整 TTS 音量
└ 网络环境
   ├ navigator.connection（Network Information API）
   ├ 网络类型（WiFi/4G/5G/离线）
   ├ 下行带宽估算
   └ "你用的是流量，要减少图片分析吗？"

=== 数据融合 ★ ===

将多种传感器数据融合，生成上下文感知：

interface PhysicalContext {
  location: { lat: number; lng: number; accuracy: number } | null;
  motion: 'stationary' | 'walking' | 'running' | 'driving';
  orientation: { alpha: number; beta: number; gamma: number } | null;
  ambientLight: number | null;       // lux
  noiseLevel: number | null;         // dB
  networkType: 'wifi' | 'cellular' | 'offline';
  batteryLevel: number | null;       // 0-1
  timestamp: number;
}

// PhysicalContext 注入 Agent 上下文
// → Buddy 根据物理环境调整行为
// → "你在走路，我就简短回复"
// → "外面很暗了，早点休息"
// → "网络不好，我不分析图片了"

文件结构：
├ src/perception/sensors.ts         # ★ 传感器管理（统一接口）
├ src/perception/location.ts        # ★ GPS 定位 + 地理围栏
├ src/perception/motion.ts          # ★ 加速度/陀螺仪/跌倒检测
├ src/perception/environment.ts     # ★ 环境光/噪音/网络
├ src/perception/context-fusion.ts  # ★ 物理上下文融合
└ src/perception/privacy-sensor.ts  # ★ 传感器隐私控制

前端改动：
├ 传感器权限请求流程（位置/运动/环境光 分别授权）
├ 传感器状态面板（哪些正在运行）
├ 定位精度指示器
├ 设置面板：各传感器开关 / 精度选择 / 后台采集
└ WebSocket 新增事件：
   { type: 'location', lat: number, lng: number, accuracy: number }
   { type: 'motion', state: 'walking'|'running'|'stationary' }
   { type: 'ambient_light', lux: number }
   { type: 'physical_context', context: PhysicalContext }
```

### 19.3 感知层与认知层的联动

```
五感输入 → 感知层处理 → 事件总线 → 认知层响应

┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 软件感知  │───▶│          │───▶│          │───▶│          │
│ 文件/Git  │    │          │    │          │    │          │
│ 进程/网络 │    │ 事件总线  │    │ 情绪引擎  │    │ Agent    │
├──────────┤    │ WebSocket│    │ Emotion  │    │ 决策+回复│
│ 硬件感知  │───▶│          │───▶│          │───▶│          │
│ 摄像头    │    │          │    │          │    │          │
│ 麦克风    │    │          │    │          │    │          │
│ 传感器    │    │          │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                       │                               │
                       ▼                               ▼
                ┌──────────┐                    ┌──────────┐
                │ 前端渲染  │                    │ 记忆存储  │
                │ 动画+音频 │                    │ STMP     │
                └──────────┘                    └──────────┘

软件感知示例：
1. 用户粘贴截图 → 眼睛(视觉) → "这张图是一个 React 错误堆栈"
2. → 情绪引擎 onDiscovery() → excited
3. → Agent 调用 analyze_file + 错误分析
4. → 嘴巴(TTS) 用兴奋语气说出分析结果
5. → 前端播放语音 + 精灵兴奋动画
6. → 记忆存储：React 错误诊断模式

硬件感知示例：
1. 摄像头检测到人脸 → 眼睛(camera) → "你回来了！"
2. → 情绪引擎 onGreeting() → excited
3. → 运动传感器判断"用户在走路" → 调整回复为简短模式
4. → 环境光传感器判断"天暗了" → "天黑了，注意休息"
5. → GPS 定位"到家了" → 切换居家项目上下文
6. → 麦克风检测到猫叫 → "你家猫又在叫了 🐱"
```

### 19.4 接入优先级与成本

```
优先级排序（体验提升 / 实现成本）：

软件感知：
1. ✋ 触觉基础  ★★★★★ / ★☆☆☆☆  → 性价比最高，现在就做
2. 👄 嘴巴 TTS  ★★★★★ / ★★☆☆☆  → 体验质变，Phase B 优先
3. 👃 鼻子增强  ★★★★☆ / ★★☆☆☆  → 工程价值高，Phase B 中期
4. 👁️ 眼睛视觉  ★★★★☆ / ★★★☆☆  → 差异化强，Phase B 中期
5. 👂 耳朵 STT  ★★★☆☆ / ★★★★☆  → 复杂度高，Phase B 后期

硬件感知：
6. 🎤 麦克风实时音频 ★★★★☆ / ★★★☆☆  → 唤醒词 + 语音情绪，Phase C
7. 📷 摄像头实时视频 ★★★★☆ / ★★★★☆  → 画面理解 + 看护模式，Phase C
8. 📱 设备传感器    ★★★☆☆ / ★★★☆☆  → 位置/运动/环境光，Phase C
9. 🖥️ 屏幕感知     ★★★★☆ / ★★☆☆☆  → 活跃窗口 + 截图，桌面端优先

API 成本估算（月活跃用户 1000）：
├ TTS:          ~$30/月 (OpenAI) 或 $0 (Edge TTS 免费)
├ STT:          ~$50/月 (Whisper) 或 $0 (浏览器 Web Speech)
├ 视觉(图片):   ~$100/月 (GPT-4o) 或 ~$20 (MiMo Omni)
├ 视觉(摄像头): ~$200/月 (定时截帧分析) 或 ~$30 (本地模型)
├ 声音事件检测: ~$20/月 (云端) 或 $0 (本地 Porcupine)
├ 传感器:       $0 (浏览器 API，免费)
└ 总计:         $0-400/月（取决于后端选择和硬件功能开启比例）

隐私与安全要点：
├ 所有硬件感知必须用户明确授权
├ 状态指示器（红点/波形）始终可见
├ 数据本地处理优先，云端为辅
├ 隐私模式一键关闭
├ 低信任度用户禁用硬件感知
└ 敏感数据（人脸/位置）不持久化存储
```

---

## 二十、经验模型引擎 — 经验编译与图谱 ★ 核心突破

> **核心命题：养成后的 Buddy 能否不依赖基座大模型就积累经验？**
> 答案是能。路径不是"让规则变聪明"，而是"把 LLM 的一次推理成果编译成可复用的确定性经验单元"。

### 20.1 问题本质

```
LLM 的智能来源：海量文本 → 压缩成参数 → 推理时激活
Buddy 的经验模型来源：大量对话 → 提取成经验单元 → 执行时调用

两者本质相同：都是"把经验压缩成可复用的模式"
区别在于压缩介质：LLM 压缩成神经网络权重，Buddy 压缩成结构化经验图谱
```

当前架构的问题：

```
知识提取 → STMP 存储 → LLM 读取 STMP → LLM 生成答案
                              ↑
                         每次都依赖 LLM

应该的架构：
知识提取 → STMP 存储 → 梦境巩固提炼 → 编译为经验单元
用户提问 → 经验图谱匹配 → 填入上下文 → 直接输出
                                    ↑
                              不需要 LLM
```

### 20.2 学术依据

| 研究 | 年份 | 核心发现 | 对 Buddy 的启示 |
|------|------|---------|----------------|
| **Voyager** (Minecraft Agent) | 2023 | LLM 仅首次使用（提取经验），后续执行靠经验代码库 | 经验编译一次，永久复用 |
| **SAGE** (arxiv 2512.17102) | 2025 | 技能库积累后 token 消耗减少 59%，步数减少 26%，完成率提升 8.9% | 养成后效率翻倍 |
| **ASG-SI** (arxiv 2512.23760) | 2025 | Self-improvement = 把 Agent 编译成可审计的经验图谱 | 经验图谱就是经验模型 |
| **Learn-by-interact** (arxiv 2501.10893) | 2025 | 从交互历史自动合成训练数据，无需人工标注 | 梦境巩固可自动化 |
| **Levels of AI Agents** (arxiv 2405.06643) | 2024 | L2（IL/RL）不需要 LLM，L4（LLM+自学习）是目标态 | Buddy 当前在 L3-L4 之间 |
| **Self-Evolving Agent** | 2025 | 闭环：执行→反馈→调整→积累→性能持续上升 | 需要补完进化闭环 |

### 20.3 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    经验模型引擎（Experience Engine）              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  经验图谱（ExperienceGraph）                                   │  │
│  │                                                          │  │
│  │    ┌─────────┐    requires    ┌───────────┐             │  │
│  │    │ 读依赖   │──────────────→│ 检测框架    │             │  │
│  │    │ package  │               │ framework  │             │  │
│  │    └─────────┘               └───────────┘             │  │
│  │         │                          │                    │  │
│  │      enhances                 alternative               │  │
│  │         │                          │                    │  │
│  │    ┌─────────┐               ┌───────────┐             │  │
│  │    │ 扫描项目 │               │ 搜索报错   │             │  │
│  │    │  scan    │               │ error_fix  │             │  │
│  │    └─────────┘               └───────────┘             │  │
│  │                                                          │  │
│  │  节点 = ExperienceUnit（可执行的工具调用序列）              │  │
│  │  边 = requires / enhances / alternative                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│  ┌───────────────────────▼──────────────────────────────────┐  │
│  │  经验路由器（ExperienceRouter）                                │  │
│  │                                                          │  │
│  │  用户输入 → 图谱匹配 → 置信度判断                         │  │
│  │                                                          │  │
│  │  confidence > 0.8 → 直接执行经验（零 LLM 调用）           │  │
│  │  confidence 0.5-0.8 → 执行经验 + LLM 验证结果            │  │
│  │  confidence < 0.5 或无匹配 → 降级到完整 LLM 流程          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│  ┌───────────────────────▼──────────────────────────────────┐  │
│  │  经验编译器（ExperienceCompiler）                              │  │
│  │                                                          │  │
│  │  成功对话 → 提取工具调用序列 → 归一化为 ExperienceUnit      │  │
│  │  ↓                                                       │  │
│  │  关键词/上下文标签自动生成 → 触发条件                      │  │
│  │  ↓                                                       │  │
│  │  写入经验图谱 + 自动发现边关系                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│  ┌───────────────────────▼──────────────────────────────────┐  │
│  │  经验进化器（ExperienceEvolver）                               │  │
│  │                                                          │  │
│  │  执行成功 → confidence += 0.05                            │  │
│  │  执行失败 → confidence -= 0.15, 记录失败原因               │  │
│  │  confidence < 0.2 → 标记废弃，从图谱中休眠                 │  │
│  │  梦境巩固 → 合并相似经验，发现隐藏关联                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 20.4 经验单元数据结构

```typescript
interface ExperienceUnit {
  id: string;
  name: string;                    // "fix_cors_error"
  description: string;             // "修复前端 CORS 跨域问题"

  // 触发条件：什么时候命中这个技能
  trigger: {
    intent: string;                // "error_fix"
    keywords: string[];            // ["CORS", "跨域", "Access-Control"]
    contextTags: string[];         // ["前端项目", "fetch调用"]
    patterns: RegExp[];            // 匹配正则
  };

  // 可执行步骤：确定性的工具调用序列（不依赖 LLM）
  steps: Array<{
    tool: string;                  // "read_file" | "exec" | "search_web"
    args: Record<string, any>;     // { path: "package.json" }
    condition?: string;            // 前置条件判断
    outputVar?: string;            // 存储输出到变量
  }>;

  // 回复模板：用性格参数填充
  replyTemplate: {
    sharp: string;                 // "CORS 问题。第 {count} 次了，加 proxy 或改后端。"
    warm: string;                  // "是 CORS 跨域问题呢，试试配置 proxy～"
    chaotic: string;               // "又是 CORS 这个老朋友！💥"
  };

  // 可验证性：怎么判断经验执行成功
  verifier?: {
    type: 'output_contains' | 'file_exists' | 'command_success';
    criteria: string;              // "Access-Control-Allow-Origin"
  };

  // 统计 & 进化
  stats: {
    successCount: number;
    failCount: number;
    confidence: number;            // success / (success + fail)
    avgExecutionMs: number;
    lastUsed: number;
    createdAt: number;
    extractedFrom: string[];       // 对话 ID
    consolidatedAt: number;        // 梦境巩固时间
    evolved: boolean;              // 是否经过合并进化
  };
}
```

### 20.5 经验路由器工作流程

```typescript
class ExperienceRouter {
  async route(input: string, context: Context): Promise<RouteDecision> {
    // Step 1: 图谱匹配
    const candidates = this.skillGraph.match(input, context);
    if (candidates.length === 0) {
      return { path: 'llm', reason: 'no_skill_matched' };
    }

    // Step 2: 按置信度排序
    candidates.sort((a, b) => b.stats.confidence - a.stats.confidence);
    const best = candidates[0];

    // Step 3: 置信度路由
    if (best.stats.confidence >= 0.8 && best.stats.successCount >= 3) {
      // 高置信度 → 零 LLM 执行
      return { path: 'exp_direct', skill: best };
    }

    if (best.stats.confidence >= 0.5) {
      // 中置信度 → 执行 + LLM 质检
      return { path: 'exp_verified', skill: best };
    }

    // 低置信度 → LLM 为主，技能作为参考
    return { path: 'llm_with_hint', skill: best };
  }
}
```

### 20.6 经验模型能覆盖的场景

| 场景 | 养成 1 个月 | 养成 3 个月 | 养成 6 个月 | 原理 |
|------|-----------|-----------|-----------|------|
| 常见报错诊断 | ✅ 50+ 条 | ✅ 200+ 条 | ✅ 500+ 条 | 错误模式→经验单元 |
| 项目操作（读/写/跑） | ✅ | ✅ | ✅ | 意图匹配+工具路由 |
| Git 操作 | ✅ | ✅ | ✅ | 关键词路由 |
| 代码结构分析 | ✅ | ✅ | ✅ | AST 解析（无 LLM） |
| 历史问题复用 | ⚠️ 有限 | ✅ 丰富 | ✅ 极丰富 | STMP 精确检索 |
| 同类问题泛化 | ❌ | ⚠️ 开始积累 | ✅ 经验图谱成熟 | 经验编译+图谱导航 |
| 用户习惯适配 | ⚠️ 基础 | ✅ 画像形成 | ✅ 高度个性化 | 认知三层+行为推断 |
| 主动建议 | ❌ | ⚠️ 偶尔 | ✅ 高频 | 意图引擎+模式识别 |
| 复杂推理 | ❌ 需要 LLM | ❌ 需要 LLM | ⚠️ 部分可技能化 | 技能组合替代推理 |
| 开放问答 | ❌ 需要 LLM | ❌ 需要 LLM | ❌ 需要 LLM | 永远需要 LLM |

**核心规律：经验模型覆盖"做过的"，LLM 覆盖"全新的"。养成越久，前者占比越高。**

### 20.7 与现有模块的集成

```
已有模块                    集成方式
────────                   ────────
STMP 时空记忆宫殿    ←──→   经验图谱共享概念节点，STMP 提供上下文
梦境巩固引擎         →→→    巩固阶段自动编译新技能 + 合并相似技能
知识提取引擎         →→→    提取结果可以触发经验编译
经验包系统           ←──→   高置信度经验自动打包为经验包
认知三层             →→→    用户画像影响技能优先级排序
反馈学习器           →→→    用户反馈直接更新技能置信度
```

### 20.8 需要新增的模块

| 模块 | 文件 | 行数 | 功能 |
|------|------|------|------|
| 经验图谱 | `src/experience/experience-graph.ts` | ~350 | 图谱存储 + 节点/边管理 + 路径查找 |
| 经验编译器 | `src/experience/experience-compiler.ts` | ~250 | 对话→经验单元提取 |
| 经验路由器 | `src/experience/experience-router.ts` | ~200 | 置信度路由决策 |
| 经验执行器 | `src/experience/experience-executor.ts` | ~200 | 经验步骤序列执行 |
| 经验进化器 | `src/experience/experience-evolver.ts` | ~150 | 置信度更新 + 梦境合并 |
| 统一入口 | `src/experience/index.ts` | ~50 | 模块导出 |
| 测试 | `src/test-experience.ts` | ~200 | 经验编译/路由/执行/进化 |
| **合计** | | **~1400** | |

### 20.9 实现路线

```
Phase D（Week 21-22）：经验模型基础
  Week 21 — 经验图谱 + 编译器 + 路由器
  Week 22 — 执行器 + 进化器 + 集成测试

Phase D+（Week 23-24）：经验模型深化
  Week 23 — 经验组合（多经验协作解决复杂任务）
  Week 24 — 跨用户经验共享（匿名化后的社区经验库）
```

---

## 附录

### A. 当前代码库状态

| 文件 | 说明 | 状态 | 阶段 |
|------|------|------|------|
| `src/core/agent.ts` | Agent 核心（流式+批量+情绪+空闲+确认拦截+STMP集成+认知注入+知识提取异步触发） | ✅ P3+B+Week9 | Week 3+B+9 |
| `src/core/llm.ts` | LLM 适配层（generateText + streamText + beforeToolExecute） | ✅ P0+B增强 | Week 1+B |
| `src/tools/builtin.ts` | 内置工具（异步+正则安全） | ✅ P0 完成 | Week 1 |
| `src/tools/web.ts` | 网络工具（搜索+抓取） | ✅ P1 完成 | Week 1 |
| `src/tools/code-intel.ts` | 代码理解（分析+引用查找） | ✅ P1 完成 | Week 1 |
| `src/tools/registry.ts` | 工具注册表 | ✅ | Week 1 |
| `src/config.ts` | 配置持久化（~/.buddy/config.json + tts配置） | ✅ P1+B增强 | Week 1+B |
| `src/errors.ts` | 错误分类器（7种类型+降级策略） | ✅ P1 完成 | Week 1 |
| `src/memory/store.ts` | 记忆存储（SQLite + FTS5） | ✅ P2 增强完成 | Week 2 |
| `src/memory/stmp.ts` | **STMP 时空记忆宫殿**（房间+时间轴+星图+四步检索+生命周期） | ✅ **Phase B** | Week 6 |
| `src/memory/dream.ts` | **梦幻记忆巩固引擎**（回放/提取/关联/修剪/梦境日志） | ✅ **Phase B** | Week 7 |
| `src/cognitive/engine.ts` | **认知三层架构**（用户模型/自我模型/意图引擎） | ✅ **Phase B** | Week 8 |
| `src/voice/tts.ts` | **TTS 适配层**（多后端+降级+情绪联动+物种音色） | ✅ **Phase B** | Week 5 |
| `src/voice/edge-tts.ts` | **Edge TTS 实现**（免费WebSocket API） | ✅ **Phase B** | Week 5 |
| `src/perception/observer.ts` | 环境感知（项目扫描/Git/时间/空闲） | ✅ P2 完成 | Week 2 |
| `src/perception/types.ts` | 感知层统一类型定义 | ✅ P4 完成 | Week 4 |
| `src/perception/event-bus.ts` | 感知事件总线 | ✅ P4 完成 | Week 4 |
| `src/perception/privacy.ts` | 隐私权限框架 | ✅ P4 完成 | Week 4 |
| `src/feedback/learner.ts` | 反馈学习（纠正检测/偏好/记忆） | ✅ P2 完成 | Week 2 |
| `src/knowledge/learn.ts` | 知识投喂（文件/URL/文本学习） | ✅ P2 完成 | Week 2 |
| `src/knowledge/extractor.ts` | **知识提取引擎**（六类隐性知识+规则降级+STMP集成+领域画像） | ✅ **Week 9-10 P0** | Week 9-10 |
| `src/tools/project.ts` | 项目扫描工具 | ✅ P2 完成 | Week 2 |
| `src/personality/prompt.ts` | 性格 Prompt | ✅ | Week 1 |
| `src/emotion/engine.ts` | 情绪引擎（8种心情+状态机+Prompt注入） | ✅ P3 完成 | Week 3 |
| `src/behavior/idle.ts` | 空闲行为（8种行为+情绪权重+触发循环） | ✅ P3 完成 | Week 3 |
| `src/ws/server.ts` | WebSocket 双向通信（事件+指令） | ✅ P3 增强 | Week 3 |
| `src/audit/logger.ts` | 审计日志 | ✅ P4 完成 | Week 4 |
| `src/env/detect.ts` | 环境检测 | ✅ P4 完成 | Week 4 |
| `src/types.ts` | 类型定义（+TTS配置+audio事件+tool_confirm） | ✅ B增强 | Week 1+B |
| `src/main.ts` | 入口 CLI（+确认处理器） | ✅ B增强 | Week 1+B |
| `src/test.ts` | 单元测试（46/46 通过） | ✅ | Week 1 |
| `index.html` | 单文件前端（含WebSocket实时聊天） | ✅ P3 重写完成 | Week 3 |

### B. 新增模块规划

| 模块 | 文件 | 说明 | 阶段 | 状态 |
|------|------|------|------|------|
| `src/tools/web.ts` | 网络工具 | search_web + fetch_url | Week 1 | ✅ P1 |
| `src/tools/code-intel.ts` | 代码理解 | analyze_file + find_references | Week 1 | ✅ P1 |
| `src/config.ts` | 配置管理 | load/save/validate | Week 1 | ✅ P1 |
| `src/errors.ts` | 错误分类 | 7种错误类型+用户友好提示 | Week 1 | ✅ P1 |
| `src/knowledge/rag.ts` | RAG 知识库 | buddy learn + 检索 | Week 2 | ✅ P2 (learn.ts) |
| `src/perception/observer.ts` | 环境感知 | 项目扫描/Git监听/时间/空闲 | Week 2 | ✅ P2 |
| `src/feedback/learner.ts` | 反馈学习 | 纠正检测/偏好学习 | Week 2 | ✅ P2 |
| `src/tools/project.ts` | 项目扫描 | 项目结构/框架/依赖/Git | Week 2 | ✅ P2 |
| `src/emotion/engine.ts` | 情绪引擎 | 8种心情+状态机+Prompt注入 | Week 3 | ✅ P3 |
| `src/behavior/idle.ts` | 空闲行为 | 8种行为+情绪权重+触发循环 | Week 3 | ✅ P3 |
| `src/audit/logger.ts` | 审计日志 | 工具调用/安全拦截/信任变更记录 | Week 4 | ✅ P4 |
| `src/env/detect.ts` | 环境检测 | Node/网络/Git/Python/目录权限 | Week 4 | ✅ P4 |
| `src/memory/stmp.ts` | STMP 核心 | 房间 + 时间轴 + 星图 + 四步检索 | Week 6 | ✅ **完成** |
| `src/memory/lifecycle.ts` | 生命周期 | Ebbinghaus 衰减 + 压缩（集成在 stmp.ts） | Week 6 | ✅ **完成** |
| `src/memory/dream.ts` | 梦幻巩固 | 回放/提取/关联/修剪/梦境日志 | Week 7 | ✅ **完成** |
| `src/memory/dream-journal.ts` | 梦境日志 | 生成梦境叙事（集成在 dream.ts） | Week 7 | ✅ **完成** |
| `src/cognitive/engine.ts` | 认知三层 | 用户模型+自我模型+意图引擎（合一） | Week 8 | ✅ **完成** |
| `src/knowledge/extractor.ts` | 知识提取引擎 ★NEW | 六类隐性知识+规则降级+STMP写入 | Week 9-10 | ✅ **P0 完成** |
| `src/test-extractor.ts` | 知识提取测试 | 19个测试用例 | Week 9-10 | ✅ **完成** |
| `src/voice/tts.ts` | TTS 适配层 | 多后端音色+情绪语气+降级 | Week 5 | ✅ **完成** |
| `src/voice/edge-tts.ts` | Edge TTS | 免费WebSocket API实现 | Week 5 | ✅ **完成** |
| `src/skills/package.ts` | 能力包核心 | 创建/数据结构/STMP导出/导入 | Week 11-12 | ✅ **完成** |
| `src/skills/scheduler.ts` | 包调度器 | 成熟度策略/跨领域协作 | Week 11-12 | ✅ **完成** |
| `src/skills/evaluator.ts` | 质量评估 | LLM-as-Judge/差异化安全/快速评估 | Week 11-12 | ✅ **完成** |
| `src/skills/export.ts` | 包导出/分享 | .skillmate格式/脱敏/校验和 | Week 11-12 | ✅ **完成** |
| `src/skills/version.ts` | 版本管理 | 自动版本/快照/回滚/差异对比 | Week 11-12 | ✅ **完成** |
| `src/voice/stt.ts` | STT 语音识别 | 实时语音转文字（Web Speech + Whisper 双后端） | Week 9-10 | ✅ **完成** |
| `src/voice/mic-manager.ts` | 麦克风管理 | 设备枚举/权限/音量监控+降噪 | Week 9-10+14 | ✅ **完成** |
| `src/voice/audio-stream.ts` | 音频流管理 | 分段录制+VAD+WebSocket流 | Week 9-10+14 | ✅ **完成** |
| `src/perception/fs-watcher.ts` | 文件监听 | 实时变更感知+防抖+递归 | Week 9-10 | ✅ **完成** |
| `src/vision/omni.ts` | 视觉理解 | 多模态图像分析+OCR | Week 7-8 | ⏳ 接口层就绪 |
| `src/vision/camera.ts` | 摄像头管理 | 设备枚举/流控制/帧捕获(235行) | Week 13 | ✅ **完成** |
| `src/vision/frame-capture.ts` | 帧捕获策略 | 手动/定时/变化检测截帧 | Week 13 | ✅ **完成** |
| `src/vision/face-detect.ts` | 人脸检测 | TF.js/云端API+降级像素分析(199行) | Week 13 | ✅ **完成** |
| `src/vision/scene-analyze.ts` | 场景分析 | 多模态画面分析+OCR+物体识别(193行) | Week 13 | ✅ **完成** |
| `src/vision/privacy.ts` | 视觉隐私控制 | 权限/过滤/脱敏 | Week 13 | ✅ **完成** |
| `src/voice/wakeword.ts` | 唤醒词检测 | Porcupine/关键词匹配 | Week 14 | ✅ **完成** |
| `src/voice/sound-events.ts` | 声音事件检测 | 门铃/警报/宠物叫声 | Week 14 | ✅ **完成** |
| `src/voice/emotion-voice.ts` | 语音情绪分析 | 语速/音量/语调 | Week 14 | ✅ **完成** |
| `src/perception/location.ts` | GPS 定位 | 地理围栏+常去地点(197行) | Week 15 | ✅ **完成** |
| `src/perception/motion.ts` | 运动感知 | 加速度/陀螺仪/跌倒检测(219行) | Week 15 | ✅ **完成** |
| `src/perception/environment.ts` | 环境感知 | 环境光/噪音/网络/电池(248行) | Week 15 | ✅ **完成** |
| `src/perception/context-fusion.ts` | 物理上下文融合 | 多传感器→PhysicalContext(261行) | Week 15 | ✅ **完成** |
| `src/skills/share-network.ts` | 能力包分享网络 | P2P分享/权限/隐私(265行) | Week 16 | ✅ **完成** |
| `src/skills/radar.ts` | 能力包质量雷达 | 多维度评估数据(252行) | Week 16 | ✅ **完成** |
| `src/skills/feedback.ts` | 能力包反馈学习 | 满意度/纠正/权重更新(180行) | Week 16 | ✅ **完成** |
| `src/social/friends.ts` | 好友系统 | 添加/删除/在线状态(139行) | Week 17 | ✅ **完成** |
| `src/social/platform.ts` | 多平台适配器 | CLI/Telegram/Discord统一接口(354行) | Week 17 | ✅ **完成** |
| `src/social/buddy-interact.ts` | 精灵社交互动 | 串门/对话/合影 | Week 17 | ✅ **完成** |

### C. 关键指标

```
产品指标：
├ DAU（日活用户）
├ 平均对话次数 / 日
├ 工具调用次数 / 日
├ 知识投喂次数 / 用户
├ 精灵平均等级
├ 梦境日志生成次数 / 周
├ AI 生成次数 / 日
├ 分享率
└ 留存率（D1 / D7 / D30）

商业指标：
├ 免费→Pro 转化率（目标 5%）
├ ARPU / LTV / CAC

技术指标：
├ LLM 响应时间（<2s 首 token，流式）
├ 工具调用成功率（>95%）
├ STMP 检索相关性（vs 向量搜索 baseline）
├ 梦幻巩固覆盖率（%记忆被巩固过）
├ 渲染帧率（60fps）
├ 安装成功率（>95%）
└ 系统可用性（99.9%）
```

---

*文档版本：v3.5*
*创建时间：2026-04-07*
*最后更新：2026-04-11*
*核心变化：*
*1. 新增 STMP 时空记忆宫殿 — 第一个用记忆宫殿范式的 AI Agent 记忆系统*
*2. 新增梦幻记忆巩固引擎 — 闲时自动回放/提取/关联/修剪 + 梦境日志*
*3. 新增三层认知架构 — 用户模型 + 自我模型 + 意图引擎*
*4. Phase A 增强 — 流式输出/异步工具/搜索工具/代码理解/安全升级/bug修复*
*5. Phase B 扩展为 12 周 — STMP + 梦幻 + 认知 + 感知层实现 + 养成 + 桌面版*
*6. 竞争壁垒更新 — STMP + 梦幻 + 认知三层 = 3 个独立技术壁垒*
*7. P3 完成 — 情绪引擎 + 空闲行为 + 前端WebSocket实时集成 + 聊天界面*
*8. P4 完成 — 审计日志 + 环境检测 + 设置面板(API/性格/偏好) + README*
*9. 感知层扩展 — 软件+硬件双维度（摄像头/麦克风/传感器/屏幕感知）*
*10. v2.5 — 感知层架构前移：Phase A 打地基 → Phase B 实现 → Phase C 完整硬件*
*11. v2.6 — Phase B Week 5-8 完成：TTS语音合成 + STMP时空记忆宫殿 + 梦幻巩固引擎 + 认知三层架构。新增6个模块(voice/tts.ts, voice/edge-tts.ts, memory/stmp.ts, memory/dream.ts, cognitive/engine.ts)共2119行代码。needsConfirmation执行前拦截修复。所有测试通过(46基础+22STMP+12梦幻+13认知)。*
*12. v2.7 — 融入 SkillMate 知识提取+能力包理念：① Week 9-10 新增六类隐性知识提取引擎+领域识别+成长阶段模型 ② Week 11-12 新增能力包系统(创建/调度/评估/分享/版本管理) ③ Phase C 重新编号为 Week 13-20 ④ 新增 Week 16 能力包评估+分享网络 ⑤ 商业模式加入知识提取+能力包特权 ⑥ 云端 LoRA 微调延后到正式版预留接口 ⑦ 竞争壁垒从8个扩展到11个 ⑧ 风险评估新增5项知识提取相关风险 ⑨ 里程碑从M0-M6扩展到M0-M8*

---


## D. 完成进度审查（2026-04-13 实际验证）

### 总览

```
Phase A（Week 1-4）：最小完整产品 + 感知层架构地基    ✅ 代码完成 / ✅ 集成完成
Phase B（Week 5-12）：认知架构 + 感知层实现           ✅ 代码完成 / ✅ 集成完成
  ├── Week 5-6  STMP + TTS                           ✅ 100%
  ├── Week 7    梦幻巩固 + 视觉(接口)                 ✅ 100%
  ├── Week 8    认知三层                              ✅ 100%
  ├── Week 9-10 知识提取 + 文件监听                    ✅ 100%
  └── Week 11-12 能力包系统(5模块)                     ✅ 100%
Phase C（Week 13-20）：硬件感知 + 生态                 ⚠️ 代码完成 / ❌ 集成 ~50%
  ├── Week 13  视觉系统                               ⚠️ 代码在 frontend/src/vision/，未接入 React
  ├── Week 14  语音扩展                               ⚠️ 代码在 frontend/src/voice/，未接入 React
  ├── Week 15  设备传感器                              ⚠️ 代码在 frontend/src/sensors/，未接入 React
  ├── Week 16  能力包评估深化 + 分享网络               ✅ 100%
  ├── Week 17  社交 + 多平台                          ⚠️ 接口完成，适配器是 stub
  ├── Week 18  商业化                                 ⚠️ 类型完整，支付网关未对接
  └── Week 19-20 性能+上线就绪                        ✅ 100%
Phase D（Week 21-22）：经验模型 — 经验图谱            ✅ 代码完成 / ✅ 集成完成
养成系统重写 v2                                        ⚠️ 后端完成 / ❌ 前端对齐未做
前端独立工程化                                         ✅ Vite+React+TS 构建通过
前端体验                                               ❌ ChatPanel/精灵动画/引导气泡等需重写
部署运维                                               ❌ 无 Dockerfile/进程管理/WS认证
```

> **诚实说明（2026-04-13 核实）：** Phase A/B/D 的后端模块确实完成且已集成到 agent.ts。
> Phase C 约 5,000 行浏览器端代码（vision/voice/sensors）存在但未接入 React 组件。
> billing/payment.ts 和 social/platform.ts 的适配器是类型完整但执行逻辑为 stub。
> 前端组件能构建但体验粗糙，ChatPanel/ExplorationMap/AchievementsPanel 需重写。
> 详见 `DEVELOPMENT_PLAN_REMAINING_30.md` 剩余 30% 开发计划。

### 代码规模

```
后端模块 (src/)       65 文件  16,246 行
前端组件 (frontend/)  ~25 文件  ~2,277 行
前端浏览器模块        ~24 文件  (vision/voice/sensors)
测试文件              15 文件   3,370 行
─────────────────────────────
合计                  ~130 文件  ~22,000+ 行
```

### 各模块代码存在性验证（2026-04-11 实际检查）

#### ✅ Phase A — 全部完成（后端 src/）

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/core/agent.ts` | Agent 核心（流式+情绪+STMP+认知+养成+智能路由） | 1909 |
| `src/core/llm.ts` | LLM 适配层（generateText + streamText） | 186 |
| `src/tools/builtin.ts` | 14 个内置工具（异步+正则安全） | 319 |
| `src/tools/web.ts` | 网络工具（搜索+抓取） | 274 |
| `src/tools/code-intel.ts` | 代码理解（分析+引用查找） | 249 |
| `src/tools/project.ts` | 项目扫描工具 | 110 |
| `src/tools/registry.ts` | 工具注册表 | 34 |
| `src/config.ts` | 配置持久化 | 103 |
| `src/errors.ts` | 错误分类器（7种类型） | 172 |
| `src/types.ts` | 类型定义 | 151 |
| `src/main.ts` | CLI 入口（交互+确认处理器） | 456 |
| `src/emotion/engine.ts` | 情绪引擎（8种心情） | 190 |
| `src/behavior/idle.ts` | 空闲行为（8种行为） | 123 |
| `src/perception/observer.ts` | 环境感知（Git/时间/空闲） | 201 |
| `src/perception/types.ts` | 感知层类型定义 | 150 |
| `src/perception/event-bus.ts` | 感知事件总线 | 123 |
| `src/perception/privacy.ts` | 隐私权限框架 | 237 |
| `src/feedback/learner.ts` | 反馈学习 | 105 |
| `src/knowledge/learn.ts` | 知识投喂 | 211 |
| `src/personality/prompt.ts` | 性格 Prompt | 158 |
| `src/ws/server.ts` | WebSocket 双向通信 | 98 |
| `src/audit/logger.ts` | 审计日志 | 109 |
| `src/env/detect.ts` | 环境检测 | 93 |

#### ✅ Phase B — 全部完成（后端 src/）

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/memory/store.ts` | 记忆存储 SQLite + FTS5 | 230 |
| `src/memory/stmp.ts` | STMP 时空记忆宫殿（房间+时间轴+星图+四步检索） | 763 |
| `src/memory/dream.ts` | 梦幻记忆巩固引擎（回放/提取/关联/修剪/梦境日志） | 600 |
| `src/cognitive/engine.ts` | 认知三层架构（用户模型+自我模型+意图引擎） | 622 |
| `src/knowledge/extractor.ts` | 知识提取引擎（六类隐性知识+规则降级） | 526 |
| `src/voice/tts.ts` | TTS 适配层（多后端+情绪联动） | 162 |
| `src/voice/edge-tts.ts` | Edge TTS 实现（免费 WebSocket API） | 236 |
| `src/perception/fs-watcher.ts` | 文件变更监听（递归+防抖） | 189 |
| `src/skills/package.ts` | 能力包核心（创建/导入/导出） | 277 |
| `src/skills/scheduler.ts` | 包调度器（成熟度策略） | 196 |
| `src/skills/evaluator.ts` | 质量评估（5维度+差异化安全） | 294 |
| `src/skills/export.ts` | 包导出/分享（.skillmate格式） | 163 |
| `src/skills/version.ts` | 版本管理（快照/回滚/差异对比） | 198 |

> **注意：** STT/麦克风/音频流模块在 `frontend/src/voice/`（浏览器端），不在 `src/voice/`。

#### ✅ Phase C 后端模块（src/）

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/skills/share-network.ts` | 能力包分享网络（P2P/权限/隐私） | 265 |
| `src/skills/radar.ts` | 能力包质量雷达（多维度评估） | 252 |
| `src/skills/feedback.ts` | 能力包反馈学习（满意度/权重更新） | 180 |
| `src/social/friends.ts` | 好友系统（添加/删除/在线状态） | 139 |
| `src/social/platform.ts` | 多平台适配器（CLI/Telegram/Discord） | 515 |
| `src/social/buddy-interact.ts` | 精灵社交互动（串门/对话/合影） | 191 |
| `src/social/index.ts` | 社交模块统一入口 | 11 |
| `src/billing/subscription.ts` | 订阅管理（Free/Pro/Team） | 260 |
| `src/billing/payment.ts` | 支付集成（Stripe/支付宝/微信） | 214 |
| `src/billing/entitlements.ts` | 权益检查（功能门控+配额） | 196 |
| `src/billing/lora-interface.ts` | LoRA 微调接口预留（默认关闭） | 143 |
| `src/billing/index.ts` | 商业化模块统一入口 | 14 |
| `src/shop/catalog.ts` | 商城系统（商品/购买/库存/赛季） | 281 |
| `src/perf/cache.ts` | 性能模块（LRU缓存/限流器/连接池） | 237 |
| `src/launch/readiness.ts` | 上线就绪检查（5类检查+报告） | 268 |

#### ✅ Phase C 浏览器端模块（frontend/src/）

> 这些模块依赖浏览器 API（getUserMedia、geolocation 等），位于 `frontend/src/`，不参与后端编译。

| 目录 | 文件 | 说明 |
|------|------|------|
| `frontend/src/vision/` | camera.ts, frame-capture.ts, face-detect.ts, scene-analyze.ts, privacy.ts, omni.ts, ocr.ts, screen.ts, index.ts | 视觉系统 (11 文件) |
| `frontend/src/voice/` | stt.ts, mic-manager.ts, audio-stream.ts, wakeword.ts, sound-events.ts, emotion-voice.ts, index.ts | 语音扩展 (9 文件) |
| `frontend/src/sensors/` | location.ts, motion.ts, environment.ts, context-fusion.ts, sensor-interface.ts | 传感器 (5 文件) |

#### ✅ Phase D — 经验模型引擎（src/experience/）

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/experience/experience-graph.ts` | 经验图谱（节点/边管理+匹配+序列化） | 259 |
| `src/experience/experience-compiler.ts` | 经验编译器（意图分类+关键词+步骤编译） | 219 |
| `src/experience/experience-router.ts` | 经验路由器（置信度路由+候选排序） | 120 |
| `src/experience/experience-executor.ts` | 经验执行器（多步骤执行+性格+超时） | 182 |
| `src/experience/experience-evolver.ts` | 经验进化器（反馈+编译+梦境合并） | 238 |
| `src/experience/index.ts` | 经验模型引擎（统一入口） | 129 |
| `src/experience/types.ts` | 类型定义 | 110 |

#### ✅ 养成系统 v2（src/pet/）

| 文件 | 功能 | 状态 |
|------|------|------|
| `src/pet/manager.ts` | 养成管理器（功能探索+进化+引导+行为涌现+SQLite） | ✅ 700 行 |
| `src/pet/types.ts` | 养成类型（25功能节点+6进化阶段+引导+行为信号） | ✅ 499 行 |
| `src/pet/index.ts` | 模块导出 | ✅ 16 行 |
| Agent 集成 | trackFeature/引导/行为涌现/Prompt注入 | ✅ |
| 前端对齐 | 前端 React 组件对齐新数据结构 | ❌ 待做 |

#### ✅ 前端工程化（frontend/）

| 文件 | 功能 | 行数 |
|------|------|------|
| `frontend/src/App.tsx` | 主布局（精灵+聊天双栏+Tabs） | 241 |
| `frontend/src/main.tsx` | React 入口 | 10 |
| `frontend/src/index.css` | 全局样式 | 111 |
| `frontend/src/components/SpriteRenderer.tsx` | PixiJS 精灵渲染 | 564 |
| `frontend/src/components/ChatPanel.tsx` | 对话面板 | 202 |
| `frontend/src/components/PetStats.tsx` | 养成面板 | 147 |
| `frontend/src/components/Onboarding.tsx` | 首次引导 | 237 |
| `frontend/src/components/ExplorationMap.tsx` | 探索地图 | 148 |
| `frontend/src/components/AchievementsPanel.tsx` | 成就面板 | 16 |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket 钩子 | 279 |
| `frontend/src/types/buddy.ts` | 前端类型定义 | 255 |
| `frontend/vite.config.ts` | Vite 配置（含 WS 代理） | 32 |

### 测试验证结果（2026-04-11 实测）

```
test.ts              46 ✅  基础系统（类型/信任/记忆/工具/消息）
test-pet.ts          46 ✅  养成系统 v2（功能探索/进化/引导/行为信号）
test-e2e.ts          57 ✅  端到端集成（Agent全模块协同）
test-experience.ts 53 ✅  经验模型（图谱/编译/路由/执行/进化）
test-extractor.ts    19 ✅  知识提取引擎
test-week9-12.ts    183 ✅  Phase B 全模块
test-week16.ts       89 ✅  能力包分享/雷达/反馈
test-week17.ts       76 ✅  社交系统
test-week18.ts       93 ✅  商业化模块
test-week19-20.ts    52 ✅  性能+上线就绪
────────────────────
合计               714 ✅  全部通过，0失败
```

> **说明：** test-week13/14/15 引用 `frontend/src/` 中的浏览器模块，需在前端环境中运行。

### 风险 & 注意事项

```
1. 桌面端（Electron/Tauri）未打包
   → 需确认技术选型：Electron 更成熟 vs Tauri 更轻量

2. AI 图像生成（专属形象）无代码
   → 依赖外部 API（DALL-E/Midjourney），需成本评估

3. 知识提取引擎 + 能力包系统已实现但未经过真实用户验证
   → 需要端到端测试（对话→提取→STMP写入→能力包创建→分享→回答质量提升）

4. 前端 vision/voice/sensor 浏览器模块已实现但未接入 React 组件
   → 需要将浏览器端模块集成到 App.tsx 的交互流程中

5. Landing Page 尚未制作

6. 压力测试 / 性能基准测试未执行
   → 需验证 WebSocket 并发 + LRU 缓存在高负载下的表现

7. 区块链备份功能未实现
   → 可作为后续优化

8. GitHub Token 暴露风险
   → 克隆时使用的 Token 需尽快撤销
```

### 剩余 30% 开发计划（Sprint 路线图）

> 详见 `DEVELOPMENT_PLAN_REMAINING_30.md` 完整版

```
Sprint 1（Week 1-2）：能跑 + 能看
  1. npm run dev:all 一键启动前后端
  2. Vite proxy 配置 + WS URL 修复
  3. Onboarding 加 LLM 配置步骤（选 Provider / 输入 Key / 测试连接）
  4. .env.example + 启动文档
  5. BuddyState 类型更新（含 visualSeed / features / guidance）

Sprint 2（Week 3-4）：前端体验重塑
  6. ChatPanel 重写（Markdown + 代码高亮 + 工具调用卡片 + 流式打字机）
  7. MessageBubble + ToolCallCard + InputBar 新组件
  8. ExplorationMap 重写（节点图 + 依赖线 + 掌握度进度）
  9. 引导气泡 UI（role='guidance' 消息样式 + 一键跳转）
  10. PetStats 可视化（性格雷达图 + 热力图 + 统计图表）

Sprint 3（Week 5-6）：后端补全 + 多任务编排 + MCP 适配层 + 安全
  11. 多任务编排引擎 ★NEW（LLMCompiler 模式：DAG 规划 + 并行调度 + Joiner 汇总）
  12. ShopCatalog → SQLite 持久化
  13. WS Token 认证（连接握手 + 超时断开）
  14. REST API 层（HTTP + WS upgrade 共端口）
  15. 数据库统一管理 + backup/restore 命令
  16. SpriteRenderer 动画状态机重写（idle/think/speak/excite/sleep）
  17. 任务进度面板 UI（前端新建）
  18. MCP 适配层 ★NEW（连接 100+ 社区 MCP Server，一个适配层 = 1000+ 工具）

Sprint 4（Week 7-8）：感知层接入
  19. 摄像头拍照 → WS → Omni 分析 → 返回结果
  20. TTS 播放接通（后端已有，前端 Audio 播放）
  21. Web Speech API STT（纯前端，麦克风按钮）
  22. 进化动画（全屏揭晓 + 粒子效果）
  23. Dockerfile + docker-compose


Sprint 4-A（Week 8-9）：浏览器自动化 + 屏幕 RPA ★ 业务场景落地
  22a. Playwright 浏览器自动化工具集（10 个工具：start/navigate/snapshot/click/type/wait/extract/fill_form/submit/close）
  22b. 后端视觉分析（从 frontend/src/vision/ 迁移到 src/vision/）
  22c. 屏幕 RPA 工具集（8 个工具：capture/ocr/find/wait + mouse + keyboard）
  22d. 任务状态机（等待/重试/确认/异常处理，扩展多任务编排）
  22e. 客服自动回复工作流模板（网页版：DOM 监控 → LLM 回复 → 自动发送）
  22f. 财务自动化工作流模板（网页版：表单识别 → 数据填写 → 提交确认）
  22g. 操作预览 + 确认 UI（前端：每步操作预览 + 一键确认/拒绝）

Sprint 5（Week 9-10）：质量 + 部署
  24. vitest 迁移 + CI（GitHub Actions）
  25. 传感器数据 → WS → 后端 → System Prompt 注入
  26. PM2/systemd + 日志系统（winston/pino）
  27. 压力测试（WebSocket 并发 + LRU 缓存高负载）
  28. AchievementsPanel 重写 + 收尾

Sprint 6（Week 11-12）：可选扩展
  29. Telegram Bot 落地（node-telegram-bot-api）
  30. Discord Bot 落地（discord.js）
  31. Electron 托盘应用 MVP
  32. Landing Page 制作
  33. Stripe 支付网关对接
```

### 优先级矩阵

```
                    用户价值高
                       ↑
                       │
    ChatPanel 重写     │    WS 认证 + 部署
    ExplorationMap     │    商城持久化
    引导气泡           │    REST API
    SpriteRenderer     │
                       │
  体验好 ←─────────────┼─────────────→ 能用
                       │
    雷达图/热力图      │    vitest + CI
    传感器接入         │    数据库管理
    进化动画           │    日志系统
                       │
                    用户价值低
```

### 验收标准（Sprint 1+2 完成后）

```
1. 用户首次打开 Buddy
   → Onboarding 收集视觉种子 + LLM 配置
   → 连接成功，看到精灵

2. 用户说"你好"
   → trackFeature('chat')
   → ExplorationMap 显示 chat ✅
   → 引导气泡："让我看看你的项目——说'看看当前目录有什么'"

3. 用户说"看看目录"
   → trackFeature('list_files') + trackFeature('read_file')
   → 基础功能 3/6 → 进化到 🐣 幼年
   → 进化动画播放
   → 引导："我现在可以执行命令了"

4. ChatPanel 中的工具调用
   → Markdown 渲染正常
   → 代码块语法高亮
   → 工具调用折叠卡片可展开
   → 流式输出有打字机效果

5. 部署
   → docker-compose up 能启动
   → WS 需要 token 认证
   → 重启不丢商城数据
```

*v2.8 — 2026-04-10 进度审查：Phase A 100%完成，Phase B 58%完成。*
*v2.9 — 2026-04-10 Phase B Week 9-12 完成。*
*v3.0 — 2026-04-10 Phase C Week 13-17 完成。*
*v3.1 — 2026-04-10 Phase C Week 18-20 完成，741测试全通过。*
*v3.2 — 2026-04-10 新增第二十章经验模型架构。*
*v3.3 — 2026-04-10 Phase D Week 21-22 完成，794测试全通过。*
*v3.4 — 2026-04-10 新增第二十一章养成系统重写。*
*v3.5 — 2026-04-11 全面代码验证：修正文档与实际代码的偏差。Phase C 浏览器模块实际在 frontend/src/（非 src/），Phase B STT/麦克风模块同理。前端已完成 Vite+React+TS 工程化（2277行组件代码）。养成系统 Agent 集成实际已完成。全量 714 测试通过。同步 GitHub。*
*v3.6 — 2026-04-13 修正附录 D 完成度标记：Phase C 实际集成 ~50%（浏览器模块未接入 React，支付/平台适配器为 stub），前端体验需重写，部署运维缺失。新增剩余 30% Sprint 路线图（6 Sprint / 30 任务 / 12 周）。详细计划见 DEVELOPMENT_PLAN_REMAINING_30.md。*

---

## 二十一、养成系统重写 — 养成即引导

> **核心转变：养成不是游戏层，是产品的引导引擎。**
> 精灵的成长 = 用户对产品的探索深度。
> 喂食 = 使用功能，玩耍 = 探索新能力，进化 = 解锁新模块，亲密度 = 使用深度。
>
> 基于 2026-04-10 全面代码审查 | 794 测试通过

---

### 21.1 现有设计的问题

当前做法：贴了个小游戏

```
用户操作 ──→ Agent 处理 ──→ 返回结果
                    │
                    └──→ PetManager.addExp(+3) ──→ 等级提升 ──→ ...然后呢？
                                                           └──→ 什么都没发生
```

**问题：** 等级提升后没有解锁任何东西。用户不知道"为什么要养它"。
XP 来源是通用计数器（对话+3，工具+10），跟用了什么功能无关。

应该的做法：养成 = 引导引擎

```
用户操作 ──→ Agent 处理 ──→ 返回结果
                    │
                    └──→ PetManager.trackFeatureUsage(toolName)
                              │
                              ├── 首次使用 search_web？→ 引导："你发现了网络搜索！试试搜点什么？"
                              ├── 连续 3 天没用过 learn？→ 引导："你还没试过教我东西呢"
                              ├── 所有基础工具都用过了？→ 进化！解锁高级功能
                              └── 5维属性从行为中自然涌现，不是滑动条
```

---

### 21.2 新架构

养成系统的角色重新定义：

```
┌─────────────────────────────────────────────────────────────┐
│                      Buddy 产品                              │
│                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│  │ Agent   │    │ STMP    │    │ 认知层   │                │
│  │ 引擎    │    │ 记忆    │    │ 用户模型 │                │
│  └────┬────┘    └────┬────┘    └────┬────┘                │
│       │              │              │                       │
│       └──────────────┼──────────────┘                       │
│                      │                                      │
│              ┌───────▼────────┐                             │
│              │   养成系统      │  ← 不是平行游戏，是胶水层   │
│              │                │                             │
│              │  功能探索追踪   │  ← 记录用户用了哪些功能     │
│              │  能力解锁门控   │  ← 控制功能可见性          │
│              │  行为→属性涌现  │  ← 5维从使用中来          │
│              │  主动引导引擎   │  ← 告诉用户下一步试什么    │
│              │  情感连接层     │  ← 精灵是探索的载体       │
│              └───────┬────────┘                             │
│                      │                                      │
│              ┌───────▼────────┐                             │
│              │   前端展示      │                             │
│              │  精灵状态渲染   │                             │
│              │  引导气泡      │                             │
│              │  解锁动画      │                             │
│              └────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 21.3 功能探索图谱（取代通用 XP 系统）

不再是"做任何事都加经验"，而是追踪**用户探索了产品的哪些能力**：

```typescript
interface FeatureMap {
  [featureId: string]: {
    discovered: boolean;      // 用户是否发现过
    firstUsedAt?: number;     // 首次使用时间
    useCount: number;         // 使用次数
    lastUsedAt?: number;      // 最近使用时间
    mastery: number;          // 0-100 熟练度
    category: 'basic' | 'advanced' | 'expert' | 'hidden';
  };
}
```

**功能节点清单（25个）：**

```
基础功能 (basic) — 新手引导阶段
├── chat            对话（第一条消息）
├── read_file       文件读取
├── list_files      目录浏览
├── exec            命令执行
├── git_status      Git 状态查看
└── get_time        时间查询

进阶功能 (advanced) — 探索阶段
├── write_file      文件写入
├── search_files    文件搜索
├── git_diff        Git 差异
├── git_log         Git 历史
├── search_web      网络搜索 ★
├── fetch_url       网页抓取 ★
├── analyze_file    代码分析 ★
├── find_references 引用查找 ★
├── buddy_learn     知识投喂 ★
└── scan_project    项目扫描 ★

专家功能 (expert) — 深度阶段
├── stmp_retrieve   记忆宫殿检索 ★
├── dream_consolidate 梦境巩固 ★
├── experience_compile   经验编译 ★
├── knowledge_extract 知识提取 ★
├── package_create  能力包创建 ★
└── package_share   能力包分享 ★

隐藏功能 (hidden) — 意外发现
├── pet_headpat     摸头（点击精灵发现）
├── pet_evolution   触发进化
├── midnight_chat   深夜对话
├── rapid_fire      连续快速对话
└── debug_session   连续 5+ 工具调用解决一个问题
```

---

### 21.4 能力解锁门控（取代通用等级系统）

进化不再是"经验值够了就升级"，而是**"你探索够了，解锁新能力"**：

```
🥚 蛋（初始）
  解锁条件：无（默认状态）
  可用功能：chat
  引导："打个招呼试试？"

🐣 幼年（探索基础 3/6）
  解锁条件：使用过 ≥3 个基础功能
  新解锁：search_files, exec, git_diff
  引导："你现在可以让我执行命令了，试试让我列出当前目录？"

🦊 成长（探索进阶 2/10）
  解锁条件：使用过 ≥2 个进阶功能
  新解锁：search_web, fetch_url, buddy_learn
  引导："你发现搜索功能了！下次遇到不懂的可以问我去网上查"

🐺 成熟（进阶 6/10 + 基础全满）
  解锁条件：基础功能全用过 + ≥6 个进阶功能
  新解锁：STMP 记忆宫殿主动使用、知识提取通知
  引导："我们的记忆宫殿建好了，你可以问我'你还记得什么'"

🐲 完全（专家 3/6 + 进阶 8/10）
  解锁条件：≥3 个专家功能 + 进阶 8/10
  新解锁：能力包创建、经验编译可视化
  引导："你已经非常了解我了，要不要把你的经验打包成能力包？"

🌟 传说（全部探索 + 隐藏 2/5）
  解锁条件：所有常规功能 + ≥2 个隐藏功能
  新解锁：全部隐藏功能提示、自定义精灵生成
  引导："你是真正的探索家。我们解锁了所有能力..."
```

**关键区别：**
- 旧：经验值 → 等级 → 啥也没有
- 新：探索功能 → 进化 → 解锁可见的新能力 + 引导下一步

---

### 21.5 5维属性从行为中涌现（取代手动滑动条）

```typescript
// 不再是用户手动设置，而是从实际行为中计算

interface BehaviorSignals {
  // 毒舌 → 从对话风格推断
  snarkSignals: number;     // 用户喜欢被吐槽 → snark 高
                            // 用户纠正过直白回复 → snark 低

  // 智慧 → 从工具使用复杂度推断
  wisdomSignals: number;    // 用高级工具多 → wisdom 高
                            // 问题复杂度高 → wisdom 高

  // 混乱 → 从探索模式推断
  chaosSignals: number;     // 跳跃式探索 → chaos 高
                            // 线性使用 → chaos 低

  // 耐心 → 从交互模式推断
  patienceSignals: number;  // 重复问题多 → patience 高（容忍）
                            // 用户频繁"别说了" → patience 低

  // 调试 → 从工具使用推断
  debuggingSignals: number; // exec/search_files 用得多 → debugging 高
                            // 分析类工具用得多 → debugging 高
}
```

**每 100 条交互重新计算一次，注入 System Prompt。**
用户不需要手动调滑动条，Buddy 的性格会自然适应用户的使用风格。

---

### 21.6 引导引擎（取代通用成就系统）

成就不再是"发 100 条消息"这种计数器，而是**引导用户发现新功能**：

```typescript
interface GuidanceTask {
  id: string;
  title: string;            // "网络冲浪手"
  description: string;      // "试试让我帮你搜索网络"
  targetFeature: string;    // "search_web"
  hint: string;             // "你可以问我 'React 19 有什么新特性？'"
  condition: (map: FeatureMap) => boolean;
  reward: {
    unlock?: string;        // 解锁的功能
    intimacy?: number;      // 亲密度加成
    bubble?: string;        // 精灵说的话
  };
}
```

**引导任务示例（16个，动态优先级队列）：**

```
引导基础功能：
├ "打个招呼" → chat → "试试说'你好'或'在吗'"
├ "探险家" → list_files → "试试说'看看当前目录'"
├ "读者" → read_file → "试试说'帮我看看 README'"
├ "执行官" → exec → "试试说'跑一下 pwd'"
└ "代码管理" → git_status → "试试说'Git 有什么变化'"

引导进阶功能：
├ "网络冲浪" → search_web → "试试问我'XXX怎么实现'"
├ "信息猎手" → fetch_url → "试试说'帮我看看这个网页'"
├ "代码医生" → analyze_file → "试试说'分析一下 src/main.ts'"
├ "创造者" → write_file → "试试说'帮我创建一个 TODO.md'"
├ "老师" → buddy_learn → "试试说'记住这个'然后发一个文件"
├ "架构师" → scan_project → "试试说'这个项目是什么结构'"
└ "搜索者" → search_files → "试试说'搜索 TODO'"

引导专家功能：
├ "造梦师" → dream_consolidate → "空闲时会自动整理记忆"
├ "记忆宫殿" → stmp_retrieve → "试试问'你还记得什么'"
├ "知识矿工" → knowledge_extract → "聊专业话题时会自动提取"
└ "打包大师" → package_create → "说'创建能力包'"
```

**引导触发机制：**
- 每次对话结束 → 检查是否有可推荐的下一个功能
- 连续 3 天没用新功能 → 主动推荐
- 空闲时（IdleBehavior）→ 概率性推荐
- 引导频率控制：最多每 5 条消息推荐一次，不打扰

---

### 21.7 亲密度 = 使用深度（统一 trust）

合并 PetManager.intimacy 和 MemoryStore.trust 为单一指标：

```
亲密度来源（不是摸头 +1 这种无意义操作）：
├ 功能探索广度        → 每发现一个新功能 +5
├ 功能使用深度        → 同一功能用 10 次 +2，50 次 +5
├ 连续使用天数        → 每天 +2
├ 深夜/清晨使用       → +3（更亲密的时间段）
├ 纠正后继续使用      → +5（说明信任在恢复）
├ 主动引导被采纳      → +3（用户听了 Buddy 的建议）
└ 长期不用            → -1/天（自然衰减）

亲密度效果：
├ 0-20   → 陌生：基础对话，不主动推荐，回复简短
├ 21-40  → 熟悉：开始推荐功能，回复稍长
├ 41-60  → 朋友：主动建议，解锁高级工具确认豁免
├ 61-80  → 亲密：完全信任，个性化回复风格
└ 81-100 → 灵魂伴侣：Buddy 有高度自主性，主动执行+事后汇报
```

---

### 21.8 对现有模块的影响

**需要改造的模块：**

| 模块 | 改动 | 说明 |
|------|------|------|
| `src/pet/manager.ts` | **重写核心逻辑** | 通用 XP → 功能探索图谱 + 引导引擎 |
| `src/pet/types.ts` | **重写数据结构** | PetData → FeatureMap + GuidanceTask + BehaviorSignals |
| `src/memory/store.ts` | **删除 trust/intimacy** | 这些数据移到 PetManager |
| `src/core/agent.ts` | **接入新接口** | 每次工具调用 → pet.trackFeature() |
| `src/personality/prompt.ts` | **行为涌现属性** | 从 BehaviorSignals 计算，取代 config.personality |
| `src/behavior/idle.ts` | **增加引导触发** | 空闲时概率性推荐下一个功能 |
| `frontend/src/types/buddy.ts` | **更新类型** | BuddyState 包含 FeatureMap + 引导任务 |
| `frontend/src/components/PetStats.tsx` | **探索地图 UI** | 替代通用 stat bar，展示已探索/未探索功能 |
| `frontend/src/components/ChatPanel.tsx` | **引导气泡** | 引导任务以特殊消息样式展示 |

**不需要改的模块：**

| 模块 | 原因 |
|------|------|
| `src/memory/stmp.ts` | 独立运行，养成系统只读取其数据 |
| `src/memory/dream.ts` | 梦境巩固后触发 pet.trackFeature('dream_consolidate') 即可 |
| `src/cognitive/engine.ts` | 认知层独立，养成系统补充其数据 |
| `src/knowledge/extractor.ts` | 知识提取后触发 pet.trackFeature('knowledge_extract') 即可 |
| `src/experience/` | 经验编译后触发 pet.trackFeature('experience_compile') 即可 |
| `src/skills/` | 能力包创建后触发 pet.trackFeature('package_create') 即可 |
| `src/billing/` | 免费/Pro 功能上限保留，与解锁无关 |
| `src/ws/server.ts` | 事件协议不变，只变数据内容 |
| `src/emotion/engine.ts` | 情绪引擎独立，养成系统可读取其状态 |

**Agent 接入点清单：**

```typescript
// Agent 中需要加 pet.trackFeature() 的位置：

// 1. 用户发消息
this.pet.trackFeature('chat');

// 2. 工具调用成功
this.pet.trackFeature(tc.name);  // 'read_file', 'exec', 'search_web'...

// 3. buddy learn
this.pet.trackFeature('buddy_learn');

// 4. 梦境巩固完成
this.pet.trackFeature('dream_consolidate');

// 5. 知识提取完成
this.pet.trackFeature('knowledge_extract');

// 6. 经验编译
this.pet.trackFeature('experience_compile');

// 7. 能力包创建
this.pet.trackFeature('package_create');

// 8. 摸头（前端点击事件）
this.pet.trackFeature('pet_headpat');

// 9. 深夜对话（时间判断）
if (hour >= 23 || hour < 6) this.pet.trackFeature('midnight_chat');

// 10. 每次 trackFeature 后检查引导
const guidance = this.pet.getNextGuidance();
if (guidance) this.eventBus.emit({ type: 'bubble', text: guidance.hint });
```

---

### 21.9 新数据模型

**核心类型：**

```typescript
/** 功能探索节点 */
interface FeatureNode {
  id: string;
  discovered: boolean;
  firstUsedAt?: number;
  useCount: number;
  lastUsedAt?: number;
  mastery: number;           // 0-100，useCount 非线性映射
  category: 'basic' | 'advanced' | 'expert' | 'hidden';
}

/** 行为信号（用于 5 维属性涌现） */
interface BehaviorSignals {
  snark: number;             // 从 FeedbackLearner 推断
  wisdom: number;            // 从工具复杂度推断
  chaos: number;             // 从探索模式推断
  patience: number;          // 从交互模式推断
  debugging: number;         // 从工具类型推断
  lastComputedAt: number;
  sampleCount: number;       // 基于多少条交互计算的
}

/** 引导任务 */
interface GuidanceTask {
  id: string;
  title: string;
  description: string;
  targetFeature: string;
  hint: string;
  priority: number;          // 动态计算
  shown: boolean;            // 是否已展示
  completedAt?: number;
}

/** 宠物数据（新版） */
interface PetData {
  id: string;
  name: string;
  species: string;
  rarity: Rarity;

  // 功能探索（取代 level/exp）
  features: Record<string, FeatureNode>;
  evolutionStage: EvolutionStage;  // 从 features 计算，不单独存储

  // 亲密度（取代 trust + 旧 intimacy）
  intimacy: number;          // 0-100

  // 行为涌现的属性
  behaviorSignals: BehaviorSignals;

  // 引导系统
  guidanceQueue: GuidanceTask[];
  lastGuidanceAt: number;

  // 统计（成就检测用）
  stats: {
    totalMessages: number;
    totalToolCalls: number;
    totalDays: number;
    consecutiveDays: number;
    lastActiveDate: string;
  };

  // 战斗属性（保留但简化，仅用于前端展示趣味性）
  battleStats: BattleStats;

  createdAt: number;
  lastActiveAt: number;
}
```

**SQLite 表结构（5 张表）：**

```sql
-- 主数据
CREATE TABLE pet_data (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Buddy',
  species TEXT NOT NULL DEFAULT '小狐狸',
  rarity TEXT NOT NULL DEFAULT 'Common',
  evolution_stage TEXT NOT NULL DEFAULT 'egg',
  intimacy REAL NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 1,
  consecutive_days INTEGER NOT NULL DEFAULT 1,
  last_active_date TEXT NOT NULL,
  last_guidance_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);

-- 功能探索图谱
CREATE TABLE pet_features (
  pet_id TEXT NOT NULL REFERENCES pet_data(id),
  feature_id TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0,
  first_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  mastery INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'basic',
  PRIMARY KEY (pet_id, feature_id)
);

-- 行为信号
CREATE TABLE pet_behavior (
  pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
  snark REAL NOT NULL DEFAULT 50,
  wisdom REAL NOT NULL DEFAULT 50,
  chaos REAL NOT NULL DEFAULT 50,
  patience REAL NOT NULL DEFAULT 50,
  debugging REAL NOT NULL DEFAULT 50,
  last_computed_at INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0
);

-- 战斗属性（趣味性保留）
CREATE TABLE pet_stats (
  pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  attack INTEGER NOT NULL DEFAULT 10,
  defense INTEGER NOT NULL DEFAULT 10,
  speed INTEGER NOT NULL DEFAULT 10,
  intelligence INTEGER NOT NULL DEFAULT 10
);

-- 引导任务
CREATE TABLE pet_guidance (
  pet_id TEXT NOT NULL REFERENCES pet_data(id),
  task_id TEXT NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (pet_id, task_id)
);
```

---

### 21.10 实现计划

**阶段一：数据层重建**

| # | 任务 | 文件 | 说明 | 状态 |
|---|------|------|------|------|
| 1.1 | 重写 pet/types.ts | `src/pet/types.ts` | 新数据模型（FeatureMap + BehaviorSignals + GuidanceTask） | ✅ 已完成 |
| 1.2 | 重写 pet/manager.ts 核心 | `src/pet/manager.ts` | trackFeature() + checkEvolution() + getGuidance() + computeBehavior() | ✅ 已完成 |
| 1.3 | PetManager 改用 SQLite | `src/pet/manager.ts` | 接收 dbPath，5 张表 | ✅ 已完成 |
| 1.4 | 删除 MemoryStore 信任/亲密字段 | `src/memory/store.ts` | relationship 表只保留其他自定义 key，trust/intimacy 移走 | ✅ 已完成 |
| 1.5 | 更新 pet 测试 | `src/test-pet.ts` | 46 项测试全部通过 | ✅ 已完成 |
| 1.6 | FeatureMap 初始种子数据 | `src/pet/types.ts` | 25 个功能节点定义（含在 types.ts） | ✅ 已完成 |

**阶段二：Agent 集成**

| # | 任务 | 文件 | 说明 | 状态 |
|---|------|------|------|------|
| 2.1 | Agent 注入 PetManager | `src/core/agent.ts` | 构造函数创建/加载 | ✅ 已完成 |
| 2.2 | 工具调用 → trackFeature | `src/core/agent.ts` | handleUserMessage + handleCLIMessage 回调中 | ✅ 已完成 |
| 2.3 | 对话 → trackFeature('chat') | `src/core/agent.ts` | handleUserMessage + handleCLIMessage 中 | ✅ 已完成 |
| 2.4 | 梦境/知识/技能/能力包 → trackFeature | 各模块回调 | tryDream→dream_consolidate, extractKnowledgeAsync→knowledge_extract, _getSkillPromptInjection→experience_compile, _tryCreateSkillPackage→package_create | ✅ 已完成 |
| 2.5 | 摸头 → trackFeature('pet_headpat') | `src/core/agent.ts` | handlePet 中 | ✅ 已完成 |
| 2.6 | broadcastStatus() 改造 | `src/core/agent.ts` | 包含 features + exploration + guidance + behaviorSignals | ✅ 已完成 |
| 2.7 | 进化检查 & 事件广播 | `src/core/agent.ts` | trackFeature 后自动检查（trackFeature 内部返回 evolved 标记） | ✅ 已完成 |
| 2.8 | 引导消息 → bubble 事件 | `src/core/agent.ts` | emitGuidanceIfAny() 在 handleUserMessage/handlePet/tryDream 后触发 | ✅ 已完成 |
| 2.9 | 信任度统一到 PetManager | `src/core/agent.ts` | `pet.getIntimacy()` + `getTrustLevel()` | ✅ 已完成 |
| 2.10 | 行为属性注入 Prompt | `src/core/agent.ts` | pet.getBehaviorSignals() → dynamicPersonality → buildSystemPrompt | ✅ 已完成 |
| 2.11 | 亲密度注入 Prompt | `src/core/agent.ts` | getIntimacyPrompt(pet.getIntimacy()) 注入 | ✅ 已完成 |
| 2.12 | IdleBehavior 增加引导触发 | `src/core/agent.ts` | 空闲行为 + emitGuidanceIfAny() | ✅ 已完成 |
| 2.13 | 更新端到端测试 | `src/test-e2e.ts` | 57 项测试覆盖养成+STMP+认知+智能+能力包全链路 | ✅ 已完成 |

**阶段三：前端对齐**

| # | 任务 | 文件 | 说明 | 状态 |
|---|------|------|------|------|
| 3.1 | 更新 BuddyState 类型 | `frontend/src/types/buddy.ts` | 包含 features + guidance + behaviorSignals | ✅ 已完成 |
| 3.2 | 修正 useWebSocket 事件解析 | `frontend/src/hooks/useWebSocket.ts` | status 事件 → setBuddyState | ✅ 已完成 |
| 3.3 | ExplorationMap 组件 | `frontend/src/components/ExplorationMap.tsx` | 探索地图渲染 | ✅ 已完成 |
| 3.4 | 引导气泡 UI | `frontend/src/components/ChatPanel.tsx` | bubble 事件渲染 | ⚠️ 基础版本（role='bubble'） |
| 3.5 | 进化动画 | — | 全屏揭晓动画 | ❌ 待做 |
| 3.6 | 物种 emoji 补全 | `frontend/src/components/SpriteRenderer.tsx` | PixiJS 精灵渲染 | ✅ 已完成（18 物种 ASCII） |

---

### 21.11 前端 UI 设计

**ExplorationMap 组件：**

```
🗺️ 探索地图                    Lv.3 🐣 幼年

基础功能 ████████████ 6/6 ✅
  chat ✅  read_file ✅  list_files ✅
  exec ✅  git_status ✅  get_time ✅

进阶功能 ██████░░░░ 4/10
  write_file ✅  search_web ✅
  fetch_url ✅  analyze_file ✅
  search_files ░  git_diff ░
  git_log ░  find_references ░
  buddy_learn ░  scan_project ░

专家功能 ██░░░░ 1/6
  stmp_retrieve ░  dream_consolidate ✅
  knowledge_extract ░  experience_compile ░
  package_create ░  package_share ░

🎯 下一步建议：
  "试试让我搜索文件内容——说'在项目中搜索 TODO'"

❤️ 亲密度 34/100    🧭 性格 [毒舌42 智慧58 混乱35 耐心61 调试70]
```

**引导气泡样式：**

```
┌─────────────────────────────────────┐
│  💡 小提示                           │
│  你还没试过网络搜索呢！              │
│  试试问我 "React 19 有什么新特性？"  │
│                                     │
│  [试试看] [稍后再说]                 │
└─────────────────────────────────────┘
```

---

### 21.12 验收标准

**最小可体验版本（阶段一+二完成）：**

```
1. 用户首次打开 Buddy
   → 精灵显示为 🥚 蛋
   → 引导气泡："打个招呼试试？"

2. 用户说"你好"
   → trackFeature('chat')
   → 探索地图：chat ✅
   → 引导："让我看看你的项目——说'看看当前目录有什么'"

3. 用户说"看看目录"
   → trackFeature('list_files')
   → trackFeature('read_file')（如果读了文件）
   → 探索地图更新
   → 基础功能 3/6 → 进化到 🐣 幼年
   → 进化动画
   → 引导："我现在可以执行命令了，试试让我跑个 `pwd`"

4. 用了几天后
   → 亲密度从 0 涨到 30
   → Buddy 回复变长了（亲密度影响）
   → 5 维属性从使用中涌现
   → 不同用户的 Buddy 性格不同（因为使用模式不同）

5. 基础功能全满 + 2 个进阶功能
   → 进化到 🦊 成长
   → 解锁 search_web / fetch_url / buddy_learn
   → 引导："你发现搜索功能了！遇到不懂的可以随时问我"
```

---

*v1.0 — 2026-04-10*
*核心理念：养成不是游戏，是产品引导引擎。*
*精灵的成长 = 用户对产品的理解深度。*


---

## 二十二、多任务编排引擎 ★ 从对话助手到任务执行者

> **核心转变：** Buddy 不再只是"问一句答一句"的对话助手，而是能拆解复杂任务、并行执行、自动汇总的任务执行者。

### 22.1 问题

当前 executor.ts 是纯串行 for 循环：

```typescript
for (let i = 0; i < skill.steps.length; i++) {
  const step = skill.steps[i];
  // 执行工具 → 存输出 → 下一步
}
```

问题：
- 一次只能执行一个任务
- 步骤之间即使无依赖也要串行等待
- 没有任务队列、优先级、并发控制
- 用户说"帮我做 A、B、C"，只能 A→B→C 顺序来

### 22.2 方案选型

| 方案 | 来源 | 核心思路 | 加速比 | 适用场景 |
|------|------|---------|--------|---------|
| Plan-and-Execute | Wang et al. 2023 | LLM 生成多步计划 → 串行执行 | 1x | 简单任务 |
| ReWOO | Xu et al. 2023 | 带变量引用的计划 → 无需每步重调 LLM | 1.5x | 中等任务 |
| **LLMCompiler ★推荐** | Kim et al. 2023 | 流式 DAG → 按依赖自动并行 | **3.6x** | 复杂任务 |
| OrchDAG | Liu et al. 2025 | 工具编排 DAG 建模 + 拓扑优化 | 2-3x | 多轮交互 |
| TDAG | Wang et al. 2024 | 动态分解 + 子 Agent 生成 | 2x | 开放域任务 |

**选择 LLMCompiler 模式，** 因为：
1. Buddy 场景以工具调用为主（文件/exec/搜索），天然适合 DAG 并行
2. 与现有 intelligence/ 模块无缝集成
3. 3.6x 加速来自论文实测数据
4. 流式输出意味着用户可以实时看到任务进度

### 22.3 架构设计



### 22.4 核心数据结构

```typescript
interface TaskNode {
  id: string;
  goal: string;                    // "检查过时依赖"
  tool: string;                    // "exec"
  args: Record<string, unknown>;   // { command: "npm outdated" }
  dependencies: string[];          // 无依赖 = 可立即并行
  outputVar?: string;              // ${var} 引用前置任务输出
  priority: 'high' | 'normal' | 'low';
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed';
  result?: string;
  retries: number;
  timeoutMs: number;
}

interface TaskDAG {
  id: string;
  rootGoal: string;
  nodes: Map<string, TaskNode>;
  status: 'planning' | 'executing' | 'replanning' | 'done' | 'failed';
  maxParallelism: number;
  globalTimeoutMs: number;
}
```

### 22.5 与现有模块的集成



### 22.6 前端任务进度面板



### 22.7 实现计划





---

## 二十三、MCP 适配层 — 连接 1000+ 社区工具

> **核心价值：** 一个适配层 = 1000+ 社区工具能力。Buddy 不用写一行外部工具代码，用户自己选装。

### 23.1 什么是 MCP

MCP（Model Context Protocol）是 Anthropic 推出的 AI 工具连接标准协议，类似 AI 领域的 USB-C：
- 100+ 社区 MCP Server 可直接复用
- 每个 Server 暴露 5-15 个工具
- 用户按需安装，Buddy 自动注册

### 23.2 高频 MCP Server

```
通信：Gmail / Outlook / Slack / Discord / Telegram
生产力：Google Calendar / Notion / Obsidian / Confluence
开发：GitHub / GitLab / PostgreSQL / MySQL / Elasticsearch / Kubernetes
项目：Jira / Trello / Linear
社交：Twitter(X) / Bluesky / YouTube
云服务：Cloudflare / AWS
搜索：Brave Search / Vector Search
```

### 23.3 工具策略

```
原生集成（自己写）              MCP 外部调用（用现成的）
━━━━━━━━━━━━━━━━━              ━━━━━━━━━━━━━━━━━━
高频使用 + 核心差异化           通用能力，社区已做好
深度集成记忆/养成/安全          独立功能，安全边界清晰
无外部依赖也能跑                需要第三方服务/API Key
文件/代码/执行/搜索/记忆        邮件/日历/消息/数据库/云
```

### 23.4 架构

```
.buddy/mcp.json（用户配置）
    ↓
MCPAdapter.connect() → 启动 MCP Server 子进程
    ↓
自动获取工具列表 → 转换为 ToolDef → 注册到 ToolRegistry
    ↓
LLM 自动可用，正常调用（工具名带 mcp_ 前缀区分）
```

### 23.5 实现计划（~5 天）

```
src/tools/mcp-adapter.ts        MCP 客户端 + ToolDef 转换    2 天
src/tools/mcp-config.ts         配置加载 + 验证              1 天
启动自动连接 + 工具注册                                     1 天
权限控制 + 测试                                             1 天
```



---

## 二十四、浏览器自动化 + 屏幕 RPA — 从对话到操作

> **核心转变：** Buddy 不只是"说"，还能"做"。操控网页和桌面软件，完成真实业务场景。

### 24.1 场景

```
场景 1：客服自动回复
  用户已登录客服平台 → Buddy 监控新消息 → LLM 生成回复 → 自动发送

场景 2：财务自动化
  用户已登录财务系统 → Buddy 识别表单 → 自动填写 → 提交确认

场景 3：数据采集
  用户指定网站 → Buddy 自动浏览 → 提取数据 → 整理报告

场景 4：表单批量处理
  用户提供数据文件 → Buddy 打开表单 → 逐条填写 → 批量提交
```

### 24.2 两套引擎

```
浏览器自动化（Playwright）          屏幕 RPA（robotjs + 截图）
━━━━━━━━━━━━━━━━━━                ━━━━━━━━━━━━━━━━━━
精确操作 DOM 元素                  操作任何软件/网页
速度快（毫秒级）                    速度慢（秒级）
只能控制浏览器                      控制整个桌面
CSS 选择器定位                      坐标/OCR 定位
适合：网页平台                      适合：桌面软件/无 API 场景
```

### 24.3 浏览器自动化工具

```
browser_start        启动/接管浏览器
browser_navigate     打开网页
browser_snapshot     获取 DOM 结构
browser_screenshot   截图验证
browser_click        点击元素
browser_type         输入文字
browser_select       下拉选择
browser_wait         等待元素
browser_extract      提取数据
browser_fill_form    批量填表
browser_submit       提交 + 等待响应
browser_close        关闭
```

### 24.4 屏幕 RPA 工具

```
screen_capture       截屏（全屏/区域）
screen_ocr           OCR 提取文字
screen_find          找元素（图标/文字）
screen_wait          等待变化
mouse_click/move     鼠标操作
keyboard_type/hotkey 键盘操作
clipboard_*          剪贴板
```

### 24.5 安全机制

```
权限：rpa_control（需 close_friend 以上信任度）

客服场景：
  初期 → 回复预览确认后发送
  后期 → 自动发送 + 事后通知
  永久确认 → 退款/投诉升级

财务场景：
  每步截图确认 + 金额双重验证 + 提交前全屏复核
  完整审计日志 + 异常自动暂停
```

### 24.6 实现计划（~14 天）

```
browser-automation.ts（Playwright）       3 天
screen-rpa.ts（截图+鼠标键盘）             3 天
后端视觉分析迁移                           2 天
任务状态机扩展                             2 天
客服/财务工作流模板                         2 天
操作预览确认 UI                            1 天
测试                                      1 天
```

