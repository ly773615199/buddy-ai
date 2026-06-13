# Buddy v2.0 — 开发可行性研究报告

> 基于 PLAN_V2.md 的技术选型和开发路线，调研当前（2025-2026）生态现状，给出务实建议。

---

## 一、LLM 多后端适配

### PLAN_V2 提案
自建统一接口层，适配 OpenAI / DeepSeek / Ollama / MiMo / 通义千问 / Moonshot / GLM 等。

### 调研结论：直接用 Vercel AI SDK

**推荐方案：`ai` (Vercel AI SDK)**

| 特性 | 支持 |
|------|------|
| 多 Provider | OpenAI, Anthropic, DeepSeek, Ollama, Google, Mistral, Cohere, Azure, xAI... |
| Function Calling / Tool Use | ✅ 统一格式，自动解析 |
| 流式输出 (SSE) | ✅ 内置 |
| 结构化输出 | ✅ `generateObject` / `streamObject` |
| Agent 循环 | ✅ `generateText` + `maxSteps` 自动多轮 |
| 降级策略 | 支持 fallback models |

```typescript
import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { deepseek } from '@ai-sdk/deepseek';
import { ollama } from 'ollama-ai-provider';

// 统一调用，换 provider 只改 model
const result = await generateText({
  model: openai('gpt-4o'), // 或 deepseek('deepseek-chat') 或 ollama('llama3')
  tools: {
    read_file: tool({
      description: 'Read file content',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => fs.readFileSync(path, 'utf-8'),
    }),
  },
  maxSteps: 5, // 自动多轮 tool calling
});
```

**为什么不用自建：**
- 自建适配层 = 重复造轮子 + 维护每个 provider 的 API 差异
- AI SDK 已经覆盖了 PLAN_V2 里列出的所有 provider
- 国内模型（通义千问/Moonshot/GLM）基本都兼容 OpenAI API 格式，用 `openai-compatible` provider 即可
- MiMo 有独立 provider 或走 OpenAI 兼容

**节省时间：约 2-3 周的适配层开发量**

---

## 二、桌面端框架

### PLAN_V2 提案
Electron / Tauri，未确定。

### 调研结论：Tauri，没有悬念

| 对比维度 | Electron | Tauri 2.0 |
|---------|----------|-----------|
| 安装包大小 | ~150MB+ | ~8-15MB |
| 内存占用 | ~200MB+ | ~50-80MB |
| 系统 WebView | ❌ 内置 Chromium | ✅ 系统 WebView |
| 透明窗口 | ✅ 支持 | ✅ 支持 |
| 置顶窗口 | ✅ | ✅ |
| 点击穿透 | ✅ (有限) | ✅ (原生支持) |
| 后端 | Node.js | Rust (也支持 Node sidecar) |
| 安全性 | 较弱 | 权限系统严格 |
| 学习曲线 | 低 (纯 JS) | 中 (需学 Rust 基础) |

**关键发现：WindowPet 项目**

[WindowPet](https://github.com/SeakMengs/WindowPet) 已经用 **Tauri + React** 实现了桌面宠物的核心功能：
- 透明悬浮窗口
- 点击穿透
- 多宠物管理
- 自定义精灵导入
- 开机自启
- 跨平台 (Win/Mac/Linux)

**建议：**
- 以 WindowPet 为参考/基础，改造而非从零开始
- 前端用 Vue 3 或 React (团队熟悉度决定)
- 渲染用 PixiJS (WebGL)，不用 DOM 做精灵渲染
- Rust 后端处理：文件系统访问、Git 感知、进程管理、沙箱执行

**桌面宠物核心 Tauri 配置：**
```json
// tauri.conf.json 核心配置
{
  "windows": [{
    "label": "main",
    "transparent": true,
    "decorations": false,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "resizable": false
  }]
}
```

---

## 三、精灵渲染与动画

### PLAN_V2 提案
PixiJS (WebGL) + 帧动画。

### 调研结论：可行，但要分阶段

**Week 1-4 (MVP)：静态图切换就够**
- 4 张图：idle / speaking / thinking / error
- 不需要 PixiJS，直接用 CSS/HTML img 标签切换
- 用免费像素画素材（itch.io 上大量免费商用素材）
- 零动画开发成本

**Week 5-8：引入 PixiJS**
- 帧动画：每状态 4-8 帧
- 表情系统：用 Sprite Sheet (TexturePacker 生成 JSON)
- 粒子特效：PixiJS 内置 ParticleContainer

**Week 9+：AI 生成形象**
- Stable Diffusion / DALL-E 3 生成角色
- 难点：自动生成动画帧一致性差
- 建议：先只生成静态 idle + 少量表情，高级动画后续迭代
- 备选：用 ControlNet + Reference Image 保持角色一致性

**素材来源：**
- [itch.io](https://itch.io/game-assets/free) — 大量免费像素画角色
- [OpenGameArt](https://opengameart.org/) — 开源游戏素材
- [LPC (Liberated Pixel Cup)](https://lpc.opengameart.org/) — 标准化像素画素材

---

## 四、记忆系统（本地向量检索）

### PLAN_V2 提案
SQLite + better-sqlite3 + 本地 Embedding (Xenova/transformers.js)

### 调研结论：轻量级够用，重型场景需取舍

| 方案 | 复杂度 | 性能 | 推荐场景 |
|------|--------|------|---------|
| SQLite + 关键词检索 (FTS5) | 低 | 快 | Week 1-4 MVP |
| SQLite + transformers.js embedding | 中 | 慢（首次加载模型） | Week 5+ 长期记忆 |
| 向量数据库 (Chroma/Weaviate) | 高 | 快 | 大规模场景，暂不需要 |

**建议路径：**

```
Phase A (Week 1-4):
├ SQLite + FTS5 (内置全文搜索，零额外依赖)
├ 按关键词匹配相关记忆注入上下文
├ 简单但够用
└ 开发成本：1-2 天

Phase B (Week 5+):
├ 加入 local embedding (Xenova/transformers.js)
├ 模型：Xenova/all-MiniLM-L6-v2 (~80MB 下载)
├ 向量存 SQLite (BLOB 列 + 余弦相似度计算)
├ 语义检索：用户说"上次那个 CORS 问题"→ 找到相关记忆
└ 开发成本：1 周

关键考虑：
├ transformers.js 首次加载 ~3-5s (模型初始化)
├ 推理速度：单条 ~50ms，批量更快
├ 内存占用：~200-300MB (模型加载后)
└ 是否值得：如果用户记忆 < 1000 条，FTS5 够用
```

---

## 五、代码执行沙箱

### PLAN_V2 提案
child_process + 临时目录 + 超时 + 网络隔离

### 调研结论：基础方案可行，但安全边界要明确

**MVP 方案 (Week 1-4)：**
```typescript
// 基础执行 - 够用但非完美沙箱
const { exec } = require('child_process');
const sandbox = '/tmp/buddy-sandbox/';

function safeExec(command: string, timeout = 30000) {
  // 1. 前置检查：拦截危险命令
  const blocked = ['rm -rf /', 'mkfs', 'dd if=', '> /dev/'];
  if (blocked.some(b => command.includes(b))) throw new Error('Blocked');
  
  // 2. 临时目录执行
  return exec(command, {
    cwd: sandbox,
    timeout,
    env: { ...process.env, PATH: '/usr/bin:/bin' }, // 限制 PATH
    uid: process.getuid(), // 非 root
  });
}
```

**注意事项：**
- `vm2` 已经 **被发现安全漏洞且不再维护**，不要用
- 替代方案：`isolated-vm` 或直接用 `child_process` + 进程隔离
- macOS/Linux 上可以用 `chroot` / `bubblewrap` 加固
- Windows 上沙箱能力较弱

**安全分级：**
```
Level 1 (信任 0-20)：不允许执行
Level 2 (信任 21-50)：只读命令 (ls/cat/grep/find/git status)
Level 3 (信任 51-80)：允许非破坏性命令，需要确认
Level 4 (信任 81+)：允许所有命令，事后审计
```

---

## 六、性格系统（5 维属性 → Prompt）

### PLAN_V2 提案
5 维属性数值 → 翻译成 Prompt 指令

### 调研结论：设计精巧，实现简单

这个系统本质上是 **Prompt Engineering**，不需要复杂技术。

```typescript
function buildPersonalityPrompt(attrs: Attributes): string {
  const sections = [];
  
  if (attrs.snark > 80) sections.push('你说话非常毒舌，经常吐槽用户。');
  else if (attrs.snark > 60) sections.push('你会适度吐槽，但分寸感好。');
  else if (attrs.snark > 40) sections.push('你偶尔会调侃一下。');
  else sections.push('你说话温和礼貌。');
  
  if (attrs.debugging > 80) sections.push('你一眼就能看出代码问题根因。');
  // ... 以此类推
  
  return sections.join('\n');
}
```

**关键洞察：**
- 这个系统的核心不是技术实现，是 **Prompt 素材库**
- 需要为 5 维属性的每个区间写 3-5 条风格化 Prompt
- 物种特质加成 = 覆盖/叠加某些区间的 Prompt
- 建议：初期写好 5×5=25 种组合的 Prompt 模板，后续 AI 可以自动生成

---

## 七、WebSocket 事件流

### PLAN_V2 提案
后端发状态事件 → 前端响应状态切换

### 调研结论：简单且标准

```
事件类型：
├ user_message → 精灵思考
├ thinking → 思考动画
├ tool_call:{name} → 执行状态 (每种工具不同动画)
├ tool_result:success → 保持执行
├ tool_result:error → 出错状态
├ llm_response → 说话状态
├ idle → 空闲
└ emotion:{type} → 情绪切换
```

这个设计是 **成熟模式**，不需要额外调研。前端就是状态机，后端就是事件发射器。Day 1 就能跑通。

---

## 八、开发优先级建议（务实版）

### 砍掉/推迟的功能

| 功能 | 建议 | 原因 |
|------|------|------|
| PixiJS 渲染 | 推迟到 Phase B | MVP 用 HTML img 切换就够 |
| 本地 Embedding | 推迟到 Phase B | FTS5 全文搜索够用 |
| 链上备份 | 砍掉 | 不解决真实需求，增加复杂度 |
| AI 生成形象 | 推迟到 Phase B | 先用免费素材 |
| 多精灵收集 | 推迟到 Phase B | 一只做到极致比二十只半成品强 |
| 浏览器插件 | 推迟到 Phase C | 范围膨胀 |

### Phase A 实际技术栈

```
前端：React/Vue 3 + HTML (img 标签切换状态)
后端：Node.js + Vercel AI SDK
桌面：Tauri 2.0 (参考 WindowPet)
记忆：SQLite + FTS5
执行：child_process + 超时控制
通信：WebSocket (ws 库)
安装：npm init 流程 + Tauri 打包
```

### 关键依赖

```json
{
  "dependencies": {
    "ai": "^4.x",
    "@ai-sdk/openai": "^1.x",
    "@ai-sdk/deepseek": "^1.x",
    "ollama-ai-provider": "^1.x",
    "better-sqlite3": "^11.x",
    "ws": "^8.x",
    "glob": "^10.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.x",
    "@tauri-apps/api": "^2.x",
    "typescript": "^5.x",
    "vite": "^6.x"
  }
}
```

---

## 九、最大风险点

### 1. Tauri + Rust 学习曲线
如果团队没有 Rust 经验，Tauri 后端开发会卡住。
**对策：** Tauri 的核心逻辑可以用 Node.js sidecar 跑，Rust 只做窗口管理。或者干脆 Week 1 先做 Web 版，桌面版 Week 5+ 再做。

### 2. AI 生成形象质量
Stable Diffusion 生成的角色一致性很难保证（同一个角色不同姿势差异大）。
**对策：** Phase A 用现成素材，不碰 AI 生成。Phase B 只生成静态图 + 少量表情，不追求完整动画帧。

### 3. 沙箱安全
child_process 沙箱不是真正的安全隔离。
**对策：** 明确告知用户"这是工具沙箱不是安全沙箱"，加上命令白名单/黑名单，不承诺 100% 安全。

### 4. 4 周交付压力
PLAN_V2 的 Week 1 目标（能用+有脸）包含太多东西。
**对策：** Week 1 只做 CLI 版 Agent（不要形象），Week 2 加上默认静态图 + 对话气泡。把"有脸"拆成两步。

---

## 十、总结

| 维度 | 评估 |
|------|------|
| 技术可行性 | ✅ 全部技术栈成熟可用 |
| 时间可行性 | ⚠️ 4 周 MVP 偏紧，建议 6 周 |
| 资源可行性 | ⚠️ 需要 2-3 人（前端+后端+设计） |
| 竞争可行性 | ✅ 空位明确，差异化清晰 |
| 最大亮点 | Vercel AI SDK 省 2-3 周 + WindowPet 可参考 |
| 最大风险 | 范围膨胀 + AI 形象生成质量 |

**一句话建议：先做 Agent 能力做到极致，形象用免费素材快速上线，养成和社交是后面的事。**
