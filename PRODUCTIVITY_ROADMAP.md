# Buddy 生产力工具化改造开发计划

> 基于代码分析 + 网络方案调研，2026-04-21 生成

---

## 背景

Buddy 当前定位是"有形象的个人 AI 助手"，具备完整的 Agent 框架（LLM 对话 + 工具调用 + 记忆系统 + 安全沙箱）。核心问题是：**框架已有，工具不足，编排太弱。**

经分析：
- 实际注册工具 **23 个**（README 写的 14 个过时）
- 3 个模块（TTS/STT/Edge-TTS）功能完整但未注册为工具
- `.skillmate` 声明式扩展机制存在但示例仅 3 个
- MCP 适配器完整但写死了 6 个 Server，无动态发现
- 工作流是线性步骤，无条件分支/并行/重试
- 无项目级上下文索引

**目标：将 Buddy 从"有脸的聊天机器人"升级为"可扩展的工具编排平台"。**

---

## 阶段一：工具补全（1-2 周）

> 核心原则：低投入高产出，优先补"已有代码只需包装"和"一行命令能实现"的工具。

### 1.1 激活已有模块（0.5 天）

将已开发但未注册的功能包装为 ToolDef：

| 工具名 | 包装内容 | 文件 |
|--------|----------|------|
| `tts_speak` | 包装 `src/voice/tts.ts` 的 TTS 功能 | `src/tools/voice.ts`（新建） |
| `stt_listen` | 包装 STT 识别功能 | `src/tools/voice.ts` |
| `edge_tts_list` | 列出可用音色 | `src/tools/voice.ts` |

### 1.2 Git 操作补全（1 天）

补 4 个工具，对标基础编程助手能力：

| 工具名 | 功能 | 实现 |
|--------|------|------|
| `git_commit` | 暂存并提交 | `git add -A && git commit -m "${message}"` |
| `git_branch` | 分支操作 | `git branch` / `git switch` / `git checkout` |
| `git_merge` | 合并分支 | `git merge ${branch}` |
| `git_push` | 推送到远程 | `git push origin ${branch}` |

### 1.3 媒体处理工具（1-2 天）

全部基于 ffmpeg CLI，用 `.skillmate` 声明式写，不改 TypeScript：

```json
// skills/video_info.skillmate 示例
{
  "name": "video_info",
  "description": "获取视频文件元数据（时长/分辨率/编码等）",
  "version": "1.0.0",
  "tags": ["视频", "媒体"],
  "parameters": {
    "file": { "type": "string", "description": "视频文件路径", "required": true }
  },
  "execute": { "command": "ffprobe -v quiet -print_format json -show_format -show_streams '${file}'", "timeout": 10 },
  "resultParser": "json"
}
```

完整清单（10 个 .skillmate 文件）：

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `video_info.skillmate` | `skill_video_info` | 视频元数据 |
| `video_extract_audio.skillmate` | `skill_video_extract_audio` | 提取音频轨 |
| `video_cut.skillmate` | `skill_video_cut` | 裁剪片段 |
| `video_concat.skillmate` | `skill_video_concat` | 拼接多个视频 |
| `video_to_gif.skillmate` | `skill_video_to_gif` | 视频转 GIF |
| `video_speed.skillmate` | `skill_video_speed` | 变速播放 |
| `image_resize.skillmate` | `skill_image_resize` | 图片缩放 |
| `image_convert.skillmate` | `skill_image_convert` | 图片格式转换 |
| `subtitle_extract.skillmate` | `skill_subtitle_extract` | 提取内嵌字幕 |
| `audio_info.skillmate` | `skill_audio_info` | 音频元数据 |

**前提**：系统需安装 ffmpeg。在工具描述中注明依赖。

### 1.4 编程辅助工具（1 天）

用 `.skillmate` 声明式：

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `npm_run.skillmate` | `skill_npm_run` | 运行 npm scripts |
| `run_tests.skillmate` | `skill_run_tests` | 自动检测并运行测试 |
| `lint_check.skillmate` | `skill_lint_check` | ESLint 检查 |
| `format_code.skillmate` | `skill_format_code` | Prettier 格式化 |
| `json_query.skillmate` | `skill_json_query` | jq 查询 JSON |
| `dependency_audit.skillmate` | `skill_dependency_audit` | npm audit |

### 1.5 系统运维工具（0.5 天）

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `process_list.skillmate` | `skill_process_list` | 进程列表 |
| `port_check.skillmate` | `skill_port_check` | 端口占用检查 |
| `disk_usage.skillmate` | `skill_disk_usage` | 磁盘空间分析 |
| `log_tail.skillmate` | `skill_log_tail` | 日志尾部查看 |
| `system_info.skillmate` | `skill_system_info` | 系统综合信息 |

### 1.6 文档工具（0.5 天）

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `pdf_extract.skillmate` | `skill_pdf_extract` | PDF 文本提取 |
| `hash_compute.skillmate` | `skill_hash_compute` | 文件哈希计算 |
| `base64_tool.skillmate` | `skill_base64` | Base64 编解码 |

### 阶段一验收标准

- [ ] 工具总数从 23 个增加到 **50+ 个**
- [ ] 新增工具全部通过 `skill_*` 前缀注册
- [ ] 更新 README 中的工具数量
- [ ] 媒体工具链可跑通：`视频信息 → 裁剪 → 提取音频 → 转 GIF` 完整流水线

---

## 阶段二：MCP 动态发现（1-2 周）

> 让工具扩展从"改代码"变成"装插件"。

### 2.1 MCP 配置文件化（2 天）

将 MCP Server 配置从硬编码改为配置文件驱动：

**新增配置项** `config.json`：
```json
{
  "mcp": {
    "servers": [
      {
        "name": "github",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" },
        "autoConnect": true
      }
    ]
  }
}
```

**改动文件**：
- `src/types.ts` — 新增 MCP 配置类型
- `src/core/subsystems.ts` — 从 config 读取 MCP server 列表
- `src/main.ts` — 新增 `/mcp` CLI 命令（list/add/remove）

### 2.2 Smithery 集成（3 天）

接入 Smithery.ai MCP 服务市场，实现自动发现和安装：

```
新增文件：src/tools/mcp-registry.ts

class MCPRegistry {
  search(query: string): Promise<MCPServerEntry[]>  // 搜索 Smithery API
  install(entry: MCPServerEntry): Promise<void>      // 自动下载配置
  uninstall(name: string): Promise<void>             // 移除
  update(name: string): Promise<void>                // 更新
}
```

**CLI 命令**：
```
/mcp search "视频处理"     → 搜索相关 MCP Server
/mcp install ffmpeg-mcp    → 自动安装并注册
/mcp list                   → 已安装列表
/mcp remove ffmpeg-mcp      → 卸载
```

### 2.3 MCP 工具语义检索（2 天）

参考 ScaleMCP/MCP-Zero 论文思路：

当工具总数超过一定数量（如 50+），不再全部塞入 prompt，而是：
1. Agent 判断需要什么能力 → 生成工具需求描述
2. 从已安装 MCP 工具中语义检索 → 找到匹配工具
3. 只将匹配的工具 schema 注入 prompt

**实现**：
- 为每个工具生成嵌入向量（工具名 + 描述 + 参数）
- 用 SQLite + cosine similarity 做轻量级检索
- 集成到 `LLMAdapter` 的工具注入逻辑

### 阶段二验收标准

- [ ] MCP Server 可通过配置文件增删，无需改代码
- [ ] `/mcp search` 可搜索 Smithery 并安装
- [ ] 工具超过 50 个时自动启用语义检索模式
- [ ] 新安装的 MCP Server 工具立即可用

---

## 阶段三：结构化工具 I/O（1 周）

> 让工具能组合、能链式调用。

### 3.1 ToolDef 输出 Schema（2 天）

```typescript
// 扩展 ToolDef 接口
export interface ToolDef {
  // ...现有字段
  outputSchema?: z.ZodType;   // 输出结构校验
  outputFormat?: 'text' | 'json' | 'lines';  // 输出格式提示
}
```

**改动文件**：
- `src/types.ts` — 扩展 ToolDef
- `src/tools/builtin.ts` — 给现有工具加 outputSchema
- `src/core/message-processor.ts` — 执行后校验输出

### 3.2 工具链组合（2 天）

支持将工具输出作为下一个工具的输入：

```typescript
// 工具链定义
interface ToolChain {
  id: string;
  steps: Array<{
    tool: string;
    args: Record<string, unknown>;
    // 支持引用前一步的输出
    // ${prev}  → 上一步的完整输出
    // ${prev.field} → 上一步 JSON 输出的某个字段
  }>;
}
```

**示例**：
```json
{
  "id": "video-to-audio-gif",
  "steps": [
    { "tool": "skill_video_info", "args": { "file": "${input}" } },
    { "tool": "skill_video_extract_audio", "args": { "file": "${input}", "output": "/tmp/audio.mp3" } },
    { "tool": "skill_video_to_gif", "args": { "file": "${input}", "output": "/tmp/preview.gif", "fps": 10 } }
  ]
}
```

### 3.3 结构化结果缓存（1 天）

对相同输入+相同工具的结果做缓存，避免重复执行：

```typescript
// LRU 缓存已有，只需接入工具执行层
const cacheKey = `${toolName}:${JSON.stringify(args)}`;
```

### 阶段三验收标准

- [ ] 所有工具都有 outputSchema 定义
- [ ] 工具链可运行，前一步输出自动传递给后一步
- [ ] 相同调用命中缓存时直接返回

---

## 阶段四：DAG 编排引擎（2 周）

> 从线性工作流升级为图结构编排。

### 4.1 DAG 工作流定义（3 天）

将现有的 `WorkflowTemplate` 从线性步骤升级为有向图：

```typescript
interface WorkflowNode {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  // 可选：超时、重试
  timeout?: number;
  retry?: { max: number; delayMs: number };
}

interface WorkflowEdge {
  from: string;
  to: string;
  condition?: 'success' | 'failure' | 'always';
  // 或自定义条件函数
  conditionFn?: (result: unknown) => boolean;
}

interface DAGWorkflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  parallel?: string[][];  // 可并行的节点组
}
```

### 4.2 DAG 执行器（3 天）

```typescript
class DAGExecutor {
  async execute(workflow: DAGWorkflow, input: Record<string, unknown>): Promise<DAGResult> {
    // 1. 拓扑排序
    // 2. 并行组识别
    // 3. 逐层执行，检查条件边
    // 4. 失败节点走 failure 边或 retry
    // 5. 收集所有节点输出
  }
}
```

核心能力：
- **条件分支**：if success → next, if fail → fallback
- **并行执行**：同层节点 Promise.all
- **重试机制**：可配置 maxRetries + backoff
- **中间结果传递**：节点间通过 context 共享

### 4.3 工作流编辑器（2 天）

CLI 命令：
```
/workflow list                    → 列出可用工作流
/workflow run video-pipeline      → 执行工作流
/workflow create                  → 交互式创建工作流
/workflow edit video-pipeline     → 编辑工作流
/workflow history                 → 执行历史
```

### 4.4 经验编译器升级（2 天）

改造 `ExperienceCompiler`，使其从成功的多步骤对话中提取 DAG 工作流（而非线性序列）：

- 识别条件分支（LLM 在不同情况下做了不同操作）
- 识别并行机会（多次工具调用互不依赖）
- 自动提取重试模式（某步骤失败后重试成功）

### 阶段四验收标准

- [ ] DAG 工作流可定义、可执行
- [ ] 支持条件分支、并行、重试
- [ ] 经验编译器可自动生成 DAG 工作流
- [ ] CLI 可交互式创建和管理工作流

---

## 阶段五：项目级上下文索引（1-2 周）

> 让 Buddy 理解大型项目，而非只能处理单个文件。

### 5.1 Tree-sitter 集成（3 天）

替换现有的正则 AST 解析为 Tree-sitter：

```bash
npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go
```

```typescript
// src/tools/code-index.ts（新建）
class CodeIndex {
  buildIndex(projectRoot: string): Promise<ProjectIndex>  // 构建项目索引
  symbolSearch(name: string): SymbolResult[]               // 符号搜索
  references(name: string): ReferenceResult[]              // 引用查找
  fileSummary(filePath: string): FileSummary               // 文件摘要
  dependencyGraph(): DependencyGraph                       // 依赖图
}
```

### 5.2 项目上下文生成器（2 天）

集成 Repomix 思路，生成 LLM 友好的项目上下文：

```typescript
// 工具：project_context
{
  name: 'project_context',
  description: '生成项目的 LLM 上下文摘要，自动选择相关文件',
  parameters: {
    path: string,          // 项目根目录
    focus: string,         // 关注点（如"视频处理"、"用户认证"）
    maxTokens: number,     // 最大 token 数
  }
}
```

实现逻辑：
1. 扫描项目结构
2. 根据 `focus` 关键词语义匹配相关文件
3. 用 Tree-sitter 提取关键符号（函数签名、类定义、接口）
4. 压缩输出，只保留结构信息和关键代码

### 5.3 增量索引（2 天）

文件变更时自动更新索引，而非每次全量重建：

- 使用已有的 `FileWatcher` 模块监听变更
- 只重新解析变更文件
- 索引持久化到 SQLite

### 阶段五验收标准

- [ ] 支持 TS/JS/Python/Go/Rust 的 Tree-sitter 解析
- [ ] `project_context` 工具可生成聚焦的项目摘要
- [ ] 1000+ 文件项目可在 5 秒内完成索引
- [ ] 文件变更后索引自动更新

---

## 整体时间线

```
第 1 周    阶段一：工具补全（激活模块 + git + 媒体 + 编程 + 系统 + 文档）
第 2 周    阶段二：MCP 动态发现（配置文件 + Smithery + 语义检索）
第 3 周    阶段三：结构化 I/O（输出 schema + 工具链 + 缓存）
第 4-5 周  阶段四：DAG 编排引擎（定义 + 执行 + 编辑器 + 经验升级）
第 6-7 周  阶段五：项目级上下文（Tree-sitter + 上下文生成 + 增量索引）
```

总计 **7 周**，1 个全职开发者。

---

## 优先级矩阵

按"投入产出比"排序：

| 优先级 | 改造 | 投入 | 效果 | 阶段 |
|--------|------|------|------|------|
| **P0** | 激活已有模块 + 补 Git 工具 | 1.5 天 | 工具覆盖基础编程 | 阶段一 |
| **P0** | 媒体处理 .skillmate | 2 天 | 视频流水线能力 | 阶段一 |
| **P1** | MCP 配置文件化 | 2 天 | 工具不再硬编码 | 阶段二 |
| **P1** | 结构化输出 Schema | 2 天 | 工具可组合 | 阶段三 |
| **P2** | Smithery 集成 | 3 天 | 无限工具扩展 | 阶段二 |
| **P2** | DAG 编排引擎 | 8 天 | 条件/并行/重试 | 阶段四 |
| **P3** | Tree-sitter 项目索引 | 5 天 | 大项目理解能力 | 阶段五 |
| **P3** | MCP 语义检索 | 2 天 | 大规模工具管理 | 阶段二 |

---

## 技术风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| ffmpeg 未安装导致媒体工具不可用 | 工具执行失败 | 工具描述注明依赖，exec 前检查 `which ffmpeg` |
| MCP Server 启动失败 | 工具不可用 | 连接失败降级处理，不影响其他工具 |
| Tree-sitter native binding 编译问题 | 部分平台不可用 | 提供 fallback 为正则解析 |
| DAG 执行器复杂度 | 开发周期延长 | 先做最小版本（条件+并行），后续迭代加重试/超时 |
| 工具太多导致 prompt 超长 | LLM 选择困难 | 阶段二的语义检索解决此问题 |

---

## 成功指标

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 内置工具数 | 23 | 50+ |
| MCP 动态工具 | 0 | 可扩展到无限 |
| 工作流类型 | 线性 | DAG（条件+并行+重试） |
| 代码索引深度 | 正则 AST | Tree-sitter 多语言 |
| 最大可处理项目规模 | 单文件级别 | 1000+ 文件 |
| 视频处理能力 | 无 | 裁剪/拼接/转码/GIF/字幕 |
