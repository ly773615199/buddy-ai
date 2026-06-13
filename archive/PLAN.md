# AI 精灵（Buddy）— 完整开发计划

> 基于 Claude Code 泄漏源码的 Buddy 系统，独立开发为完整产品。

---

## 一、产品定位

**一句话**：一只会陪你写代码的 ASCII 宠物，有稀有度、有性格、会吐槽。

**核心价值**：
- 打破长时间编码的单调感
- 收集驱动的留存机制（稀有度 + 闪光）
- 程序员情感共鸣（5 维属性：调试/耐心/混乱/智慧/毒舌）
- 极低资源消耗（纯文本渲染）

---

## 二、产品形态规划

### Phase 1：网页版（MVP）✅ 已完成
- 单 HTML 文件，零依赖
- 完整精灵系统 + 动画 + 交互
- 本地存储（localStorage）
- **预计工期：3 天**

### Phase 1.5：智能内核 + 进化 + 记忆
- **Brain 智能内核**：感知层 + 人格层 + 输出层 + 多 LLM 后端
- **进化系统**：6 阶段进化（蛋→幼年→成长→成熟→完全→传说）+ 等级经验
- **记忆系统**：短期记忆 + 长期记忆 + 关系记忆（亲密度/羁绊）
- **成就系统**：20+ 成就（互动/时间/编程/关系/隐藏）
- **详细设计**：[BRAIN.md](./BRAIN.md) | [EVOLUTION.md](./EVOLUTION.md)

### Phase 2：CLI 终端版
- Node.js + ANSI 转义码
- 终端内嵌精灵（类似 Claude Code 效果）
- 配合真实开发流程（读取 git 状态作为对话素材）
- npm 全局安装
- **预计工期：5 天**

### Phase 3：浏览器插件
- Chrome/Edge Extension
- 挂在 GitHub/VS Code Web/任意网页上
- 可以评论 PR、代码
- **预计工期：7 天**

### Phase 4：桌面 Widget
- Tauri（Rust + Web）轻量桌面应用
- 系统托盘常驻
- 全局快捷键呼出
- **预计工期：10 天**

---

## 三、技术架构

### 3.1 核心系统

```
┌─────────────────────────────────────────┐
│              Buddy Core                  │
├─────────────┬─────────────┬─────────────┤
│  Generator  │  Renderer   │  Scheduler  │
│  (生成器)    │  (渲染器)    │  (调度器)    │
├─────────────┼─────────────┼─────────────┤
│ PRNG        │ Sprite      │ Idle Loop   │
│ Species     │ Animation   │ Speech      │
│ Rarity      │ Bubble      │ Pet         │
│ Stats       │ Hearts      │ Mood        │
│ Eyes/Hats   │ Narrow Mode │ React       │
└─────────────┴─────────────┴─────────────┘
        │              │            │
        ▼              ▼            ▼
┌─────────────────────────────────────────┐
│           Storage Layer                  │
│  localStorage / JSON / SQLite            │
└─────────────────────────────────────────┘
```

### 3.2 数据模型

```typescript
// 骨骼（确定性，从 userId 哈希生成，不存储）
interface CompanionBones {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  species: Species          // 18 种
  eye: Eye                  // 6 种
  hat: Hat                  // 8 种（含 none）
  shiny: boolean            // 1% 概率
  stats: Record<StatName, number>  // 5 维属性
}

// 灵魂（AI 生成，可存储）
interface CompanionSoul {
  name: string              // 宠物名
  personality: string       // 性格描述
  quips: string[]           // 吐槽语录库
}

// 完整精灵
interface Companion extends CompanionBones, CompanionSoul {
  hatchedAt: number         // 孵化时间戳
  interactions: number      // 互动次数
  mood: 'idle' | 'happy' | 'excited' | 'sleepy' | 'curious'
}
```

### 3.3 物种数据（18 种完整 ASCII）

| 物种 | 稀有度 | 帧数 | 特点 |
|------|--------|------|------|
| Duck | ★ | 3 | 经典，最常见 |
| Goose | ★ | 3 | 攻击性强，会"嘎" |
| Blob | ★ | 3 | 无定形，最萌 |
| Cat | ★ | 3 | /\\_/\\ 经典猫脸 |
| Dragon | ★★ | 3 | 有火焰帧 |
| Octopus | ★★ | 3 | 触手动画 |
| Owl | ★★ | 3 | 眨眼变 (-) |
| Penguin | ★★ | 3 | 摇摆走路 |
| Turtle | ★★★ | 3 | 背甲纹理 |
| Snail | ★★★ | 3 | 蜗牛壳 |
| Ghost | ★★★ | 3 | 飘浮帧 |
| Axolotl | ★★★★ | 3 | 鳃须 |
| Capybara | ★★★★★ | 3 | 水豚，最稀有 |
| Cactus | ★★★★★ | 3 | 仙人掌造型 |
| Robot | ★★★★★ | 3 | 机械脸 |
| Rabbit | ??? | 3 | 兔耳 |
| Mushroom | ??? | 3 | 蘑菇头 |
| Chonk | ??? | 3 | 胖嘟嘟 |

### 3.4 眼睛（6 种）
```
·  ✦  ×  ◉  @  °
```

### 3.5 帽子（8 种）
```
none     无帽
crown    \^^^/    皇冠
tophat   [___]    礼帽
propeller  -+-    螺旋桨帽
halo     (   )    光环
wizard    /^\     巫师帽
beanie   (___)    毛线帽
tinyduck   ,>     小鸭帽
```

### 3.6 属性系统（5 维）
```
DEBUGGING   调试能力
PATIENCE    耐心值
CHAOS       混乱指数
WISDOM      智慧值
SNARK       毒舌程度
```

每只精灵：1 个峰值（+50~80）、1 个低谷（-10~+5）、其余随机散布。稀有度提升属性下限。

---

## 四、功能清单

### 4.1 MVP 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 精灵生成 | 基于用户名哈希确定性生成 | P0 |
| ASCII 渲染 | 5×12 精灵 + 3 帧 idle 动画 | P0 |
| 稀有度系统 | 5 级稀有度 + 权重抽取 | P0 |
| 帽子系统 | 8 种帽子，Common 无帽 | P0 |
| 眼睛系统 | 6 种眼睛样式 | P0 |
| 说话气泡 | 文字气泡 + 渐隐效果 | P0 |
| 被摸交互 | 点击摸头 + 心形飘浮 | P0 |
| 属性面板 | 5 维属性可视化 | P1 |
| 闪光精灵 | 1% 概率闪光变体 | P1 |
| 窄屏适配 | <100 列折叠为一行 | P1 |
| 收藏图鉴 | 查看所有 18 种精灵 | P2 |
| 历史记录 | 互动次数、孵化时间 | P2 |
| 导出/分享 | 生成分享卡片 | P3 |

### 4.2 进阶功能（Phase 2+）

| 功能 | 说明 | 阶段 |
|------|------|------|
| AI 对话 | 精灵用 AI 生成吐槽（接入 LLM） | P2 |
| 多精灵 | 允许收集多只 | P3 |
| 进化系统 | 互动次数达标后进化 | P3 |
| 换装系统 | 自定义颜色/装饰 | P3 |
| 对战系统 | 精灵之间属性对战 | P4 |
| 社交 | 分享/赠送/交易 | P4 |

---

## 五、文件结构

```
buddy/
├── README.md                    # 项目说明
├── LICENSE                      # MIT
├── package.json                 # 依赖管理
├── index.html                   # 网页版入口（Phase 1）
├── src/
│   ├── core/
│   │   ├── generator.ts         # 生成器（PRNG + 哈希 + 属性）
│   │   ├── species.ts           # 18 物种数据
│   │   ├── types.ts             # 类型定义
│   │   └── constants.ts         # 稀有度权重/眼睛/帽子/属性
│   ├── render/
│   │   ├── sprites.ts           # ASCII 精灵渲染
│   │   ├── animation.ts         # 动画引擎（idle/pet/speak）
│   │   ├── bubble.ts            # 说话气泡
│   │   └── hearts.ts            # 心形飘浮效果
│   ├── ui/
│   │   ├── app.ts               # 主应用
│   │   ├── panel.ts             # 属性面板
│   │   ├── gallery.ts           # 收藏图鉴
│   │   └── settings.ts          # 设置页面
│   ├── storage/
│   │   └── local.ts             # localStorage 持久化
│   └── cli/
│       ├── index.ts             # CLI 入口（Phase 2）
│       ├── terminal.ts          # ANSI 终端渲染
│       └── watcher.ts           # Git 状态监听
├── styles/
│   └── main.css                 # 样式
├── assets/
│   └── screenshots/             # 截图
└── docs/
    ├── architecture.md          # 架构文档
    ├── species-guide.md         # 物种图鉴
    └── api.md                   # API 文档
```

---

## 六、生成算法（核心）

```typescript
// Mulberry32 PRNG — 4KB，足够用于宠物生成
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a 哈希
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 生成流程
function generateBuddy(username: string): CompanionBones {
  const rng = mulberry32(hashString(username + 'buddy-2026'))
  const rarity = rollRarity(rng)      // 按权重抽取
  const species = pick(rng, SPECIES)  // 随机物种
  const eye = pick(rng, EYES)         // 随机眼睛
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS)
  const shiny = rng() < 0.01          // 1% 闪光
  const stats = rollStats(rng, rarity) // 生成属性
  return { rarity, species, eye, hat, shiny, stats }
}
```

---

## 七、开发时间线

### Sprint 1（Day 1-3）：MVP 网页版 ✅ 已完成
- [x] Day 1：核心生成器 + 类型定义 + 物种数据
- [x] Day 2：渲染引擎 + 动画系统 + 气泡
- [x] Day 3：交互系统 + UI + 部署

### Sprint 1.5（Day 4-10）：智能内核 + 进化 + 记忆
- [ ] Day 4：感知层 + 人格层 + Prompt 模板
- [ ] Day 5：LLM 集成（OpenAI/Deepseek/Ollama）
- [ ] Day 6：输出控制 + 降级策略
- [ ] Day 7：记忆系统（短期 + 长期 + 关系记忆）
- [ ] Day 8：进化系统（等级 + 经验 + 阶段变化）
- [ ] Day 9：成就系统 + 日记 UI
- [ ] Day 10：集成测试 + 调优
- [ ] Day 4：Node.js CLI 框架 + ANSI 渲染
- [ ] Day 5：终端内嵌精灵 + 动画
- [ ] Day 6：Git 状态集成 + AI 吐槽
- [ ] Day 7：npm 打包 + 文档
- [ ] Day 8：测试 + 发布

### Sprint 3（Day 9-15）：浏览器插件
- [ ] Day 9-10：Chrome Extension 框架
- [ ] Day 11-12：GitHub/VS Code Web 集成
- [ ] Day 13-14：评论功能 + 分享
- [ ] Day 15：测试 + 发布

### Sprint 4（Day 16-25）：桌面 Widget
- [ ] Day 16-18：Tauri 框架 + 系统托盘
- [ ] Day 19-21：全局快捷键 + 悬浮窗口
- [ ] Day 22-24：通知系统 + 设置
- [ ] Day 25：测试 + 发布

---

## 八、技术选型

| 层 | Phase 1 (Web) | Phase 2 (CLI) | Phase 3 (Extension) | Phase 4 (Desktop) |
|---|---|---|---|---|
| 语言 | TypeScript | TypeScript | TypeScript | Rust + TS |
| 框架 | 原生 HTML/JS | Node.js | Chrome Extension API | Tauri 2.0 |
| 渲染 | DOM + CSS | ANSI 转义码 | DOM | Webview |
| 存储 | localStorage | JSON 文件 | chrome.storage | SQLite |
| 打包 | 无（单文件） | npm | web-ext | tauri build |
| AI | 无（预设语录） | OpenAI API | OpenAI API | OpenAI API |

---

## 九、商业模式（可选）

| 方式 | 说明 |
|------|------|
| 免费开源 | 核心功能免费，社区驱动 |
| Pro 版 | 解锁更多物种/帽子/闪光率提升 |
| 团队版 | 企业部署，团队精灵排行榜 |
| API | 开放精灵生成 API，第三方集成 |

---

## 十、竞品分析

| 产品 | 形态 | 差异 |
|------|------|------|
| Tamagotchi | 实体玩具 | 无 ASCII，无开发集成 |
| GitHub Pet | 浏览器插件 | 仅 GitHub，功能简单 |
| VS Code Pets | VS Code 插件 | 仅 VS Code，无稀有度 |
| **Buddy** | 全平台 | 完整游戏化 + 稀有度 + AI 对话 + 确定性生成 |

**我们的核心优势**：确定性生成（同一用户名永远得到同一精灵）+ 完整稀有度系统 + AI 对话能力。

---

*计划版本: v1.0*
*创建时间: 2026-04-07*
*基于: Claude Code Buddy 泄漏源码*
