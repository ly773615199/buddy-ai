# 🐾 灵伴 — 有形象的个人 AI 助手

你的 AI 助手，但它不是冷冰冰的对话框 — 它有脸、有性格、记得你做过的一切。

```
ChatGPT   — 能力很强，但没有脸
桌面宠物   — 有脸能卖萌，但什么都不会
灵伴      — 有脸、有性格、有能力、有记忆
```

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/ly773615199/buddy.git
cd buddy

# 一键安装前后端依赖
npm run install:all

# (可选) 初始化配置
npx tsx src/main.ts init
```

### 一键启动

```bash
# 同时启动后端 WS (8765) + 前端 Vite (5173)
npm run dev:all

# 浏览器自动打开 http://localhost:5173
```

### 单独启动

```bash
# CLI 交互模式（纯终端）
npm run dev

# 仅后端 WS 服务器
npm run dev:ws

# 仅前端
npm run dev:frontend
```

### 首次使用

1. 打开 `http://localhost:5173`
2. 进入 Onboarding 引导：选择主色调 → 质感 → 气质 → API Key 配置
3. 输入任意一个 Provider 的 API Key（DeepSeek / OpenAI / 硅基流动等）
4. 系统自动发现可用模型，开始对话！

## 功能概览

### 🧠 AI 对话
- 统一模型池：只需填 API Key，自动发现 100+ 可用模型
- 多 Provider 并行：OpenAI / DeepSeek / Anthropic / Google / Ollama / 硅基流动 / 自定义
- Thompson Sampling 智能选择：根据任务类型自动选最优模型，越用越准
- 流式输出（打字机效果）
- Function Calling + 降级 Prompt 模拟双路径
- 熔断器 + 自动重试

### 🔧 工具系统
**32 个内置工具** + **27 个 .skillmate 动态工具** + **MCP 外部工具**：

- **文件操作** (4)：read_file / write_file / list_files / search_files
- **Shell 执行** (1)：exec（沙箱隔离，白名单+超时）
- **Git 基础** (3)：git_status / git_log / git_diff
- **Git 高级** (4)：git_commit / git_branch / git_merge / git_push
- **网络** (2)：search_web / fetch_url
- **代码智能** (2)：analyze_file / find_references
- **浏览器** (3)：browser_screenshot / browser_extract / browser_pdf
- **屏幕 RPA** (3)：screen_capture / screen_ocr / screen_describe
- **语音 TTS** (3)：tts_speak / tts_voices / tts_status
- **项目索引** (6)：scan_project / project_context / project_symbols / project_deps / project_index_stats / project_index_rebuild
- **系统** (1)：get_time
- **.skillmate 扩展** (27)：视频/音频/图片处理、hash、base64、json_query、weather 等声明式工具
- **MCP 协议**：6 个预置 Server（filesystem/github/memory/puppeteer/slack/postgres），支持 Smithery 市场搜索安装

### 🎭 情绪系统
8 种心情状态（energetic / calm / tired / excited / frustrated / happy / thinking / confused），影响回复风格和前端动画。

### 🛡️ 安全机制
- 信任度分级权限（stranger → soulmate，5 级）
- 高危操作需用户确认（WS/CLI 双模式）
- 沙箱执行（白名单+超时+资源限制）
- 敏感路径保护（.ssh, .env, 私钥等）
- WS Token 认证 + Rate Limiting

### 💾 STMP 时空记忆宫殿
三层结构：空间层（房间）+ 时间层（时间轴）+ 语义层（概念星图）。四步检索：定位房间 → 时间导航 → 语义扩展 → 叙事组装。支持 Ebbinghaus 衰减 + 自动压缩。

### 🌙 梦境巩固引擎
空闲时自动触发记忆回放/提取/关联/修剪，生成梦境日志。

### 🧩 认知三层架构
- **用户模型**：身份/行为/偏好/关系，带演化历史
- **自我模型**：能力认知/经历叙事/情绪状态/自我反思
- **意图引擎**：驱动主动行为

### 📚 知识提取 + 经验模型
- 六类隐性知识自动提取
- 经验图谱（编译→路由→执行→进化）
- 置信度路由：高→直接执行，中→LLM 质检，低→LLM 主导
- 训练数据导出（JSONL）+ LoRA 微调管道

### 📦 能力包系统
创建/评估/版本管理/导出(.skillmate)/反馈学习

### ⚡ DAG 工作流编排
LLM 驱动的任务规划，支持条件分支/重试/超时/并行执行

### 🤝 社交系统
好友管理 + Buddy 互访 + 多平台适配（CLI / Telegram / Discord）

### 💰 商业化
订阅管理（Free/Pro/Team）+ 权益检查 + 商城系统

### 🐣 养成系统
6 阶段进化（蛋→幼年→成长→成熟→完全→传说）+ 27 个功能节点探索 + 5 维行为涌现 + 亲密度系统

## CLI 命令

```
/status        查看状态
/learn <file|url>  学习
/learned       已学知识
/watch <path>  监听文件变更
/shop          商城
/buy <id>      购买
/friends       好友列表
/mcp           MCP 服务器状态
/workflow      工作流管理
/project       项目索引
/orch <task>   DAG 编排预览
/export <domain>   导出能力包
/export-training   导出训练数据
/train <domain>    LoRA 微调
/backup        备份数据库
/help          帮助
/quit          退出
```

## 配置

配置文件 `~/.buddy/config.json`，可通过 `buddy init` 向导生成：

```json
{
  "name": "Buddy",
  "species": "光灵",
  "personality": { "snark": 15, "wisdom": 70, "chaos": 25, "patience": 85, "debugging": 60 },
  "llm": { "provider": "openai", "model": "gpt-4o-mini", "apiKey": "sk-..." },
  "ws": { "port": 8765 },
  "sandbox": { "timeout": 30000, "workspace": "/tmp/buddy-sandbox" },
  "idle": { "enabled": true, "blinkMs": 3000, "actionMs": 15000 },
  "tts": { "enabled": true, "backend": "edge" },
  "mcp": { "servers": [] },
  "platforms": {}
}
```

支持的 LLM Provider：`openai` / `deepseek` / `anthropic` / `google` / `ollama` / `custom`（OpenAI 兼容）

## 数据存储

所有数据在 `~/.buddy/`：

```
~/.buddy/
├── config.json      — 配置
├── memory.db        — 对话 + 记忆 + 日记（FTS5）
├── stmp.db          — STMP 时空记忆宫殿
├── pet.db           — 养成数据
├── cognitive.db     — 认知模型
├── billing.db       — 订阅 + 商城
├── social.db        — 社交数据
└── backups/         — 备份
```

## 项目结构

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 22+ / TypeScript / ESM |
| LLM | Vercel AI SDK |
| 数据库 | better-sqlite3 (WAL) |
| 通信 | WebSocket + HTTP REST |
| 前端 | React 19 + Vite |
| 渲染 | PIXI.js |
| 测试 | Vitest |
| 桌面 | Electron |
| 部署 | Docker + Docker Compose |

## 文档

- [架构说明](./ARCHITECTURE.md) — 模块结构 + 技术细节
- [部署指南](./DEPLOY.md) — Docker / npm 部署
- [文档索引](./DOCUMENT_INDEX.md) — 全部文档导航

## License

MIT
