# Buddy Brain — 智能内核设计文档

> 把 5 维属性变成 prompt 参数，把环境感知变成上下文，喂给 LLM 生成符合人格的回应。

---

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                  Buddy Brain                     │
├─────────────┬───────────────┬───────────────────┤
│  感知层      │    人格层      │    输出层          │
│ Perception  │  Personality  │  Expression       │
├─────────────┼───────────────┼───────────────────┤
│ 代码内容     │ SNARK → 毒舌  │ 语气/长度/表情     │
│ Git 状态     │ WISDOM → 深度 │ 时机选择           │
│ 终端输出     │ CHAOS → 随机  │ 气泡 vs 静默       │
│ 时间/频率    │ PATIENCE → 容忍│ 主动 vs 被动      │
│ 错误/报错    │ DEBUGGING → 分析│                  │
│ 互动历史     │               │                   │
└─────────────┴───────────────┴───────────────────┘
        │               │               │
        ▼               ▼               ▼
┌─────────────────────────────────────────────────┐
│              Context Window                      │
│  感知数据 + 人格参数 + 历史记忆 → LLM Prompt      │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│              LLM API                             │
│  OpenAI / Claude / Gemini / 本地模型 (Ollama)    │
└─────────────────────────────────────────────────┘
```

---

## 一、感知层（它"看到"什么）

### 1.1 环境感知源

| 感知源 | 数据格式 | 获取方式 | 用途 |
|--------|---------|---------|------|
| 当前文件 | 文件路径 + 内容摘要 | 编辑器 API / 文件监听 | 理解用户在做什么 |
| Git 状态 | branch + diff + log | `git status/diff/log` | 判断工作阶段 |
| 终端输出 | 最近 N 行 | 终端监听 | 发现报错/测试结果 |
| 系统时间 | HH:MM + 星期 | `Date` | 深夜关怀/工作节奏 |
| 互动历史 | 次数 + 上次时间 | localStorage | 维持关系感 |
| 光标位置 | 文件:行号 | 编辑器 API | 定位上下文 |

### 1.2 感知数据模型

```typescript
interface Perception {
  // 代码感知
  currentFile?: {
    path: string           // "src/auth/login.ts"
    language: string       // "typescript"
    lineCount: number      // 247
    cursorLine: number     // 42
    recentEdits: string[]  // 最近编辑的内容
  }

  // Git 感知
  git?: {
    branch: string         // "feat/user-auth"
    isDirty: boolean       // 有未提交修改
    uncommittedFiles: number  // 3
    lastCommit: {
      message: string      // "fix: 修复登录超时"
      time: Date
      filesChanged: number // 5
    }
    ahead: number          // 比远程多几个 commit
    behind: number         // 比远程少几个 commit
  }

  // 终端感知
  terminal?: {
    lastOutput: string     // 最近命令的输出
    hasError: boolean      // 输出中包含 error/fail
    exitCode: number | null
    command: string        // 运行的命令
  }

  // 时间感知
  time: {
    hour: number           // 0-23
    minute: number
    dayOfWeek: number      // 0-6
    isLateNight: boolean   // 23:00 - 07:00
    isWeekend: boolean
  }

  // 互动感知
  interaction: {
    totalPets: number      // 总摸头次数
    totalTalks: number     // 总对话次数
    lastInteractionMs: number  // 上次互动距今毫秒
    sessionDurationMs: number  // 本次会话持续时间
  }
}
```

### 1.3 感知触发时机

```
主动触发（精灵主动说话）：
├─ 用户空闲 > 5 分钟 → 可能无聊/卡住了
├─ 终端出现 error → 发现报错
├─ git commit → 工作阶段性完成
├─ 深夜 23:00+ → 关怀
├─ 连续多次相同操作 → 可能卡 bug
└─ 随机概率（每 10 分钟 ~20%）→ 闲聊

被动触发（用户交互）：
├─ 用户摸头 → 回应
├─ 用户说话 → 回应
└─ 用户查看属性 → 评价自己
```

---

## 二、人格层（性格怎么影响输出）

### 2.1 5 维属性 → Prompt 参数映射

```typescript
interface PersonalityPrompt {
  // SNARK (毒舌) → 0-100
  sarcasm: '温和礼貌' | '略带调侃' | '适度吐槽' | '犀利毒舌' | '嘴上不留情'
  // 0-20     21-40        41-60        61-80        81-100

  // WISDOM (智慧) → 0-100
  expertise: '新手小白' | '有点见识' | '靠谱建议' | '资深经验' | '技术大牛'
  // 0-20       21-40        41-60        61-80        81-100

  // CHAOS (混乱) → 0-100
  randomness: '按部就班' | '偶尔出格' | '不按常理' | '天马行空' | '混沌邪恶'
  // 0-20         21-40        41-60        61-80        81-100

  // PATIENCE (耐心) → 0-100
  tolerance: '耐心极好' | '比较宽容' | '一般般' | '容易急' | '一点就炸'
  // 81-100     61-80       41-60      21-40      0-20

  // DEBUGGING (调试) → 0-100
  analysis: '看不太懂' | '能发现问题' | '擅长调试' | '精准定位' | '一眼看出根因'
  // 0-20       21-40        41-60        61-80        81-100
}
```

### 2.2 人格组合示例

```
高毒舌 + 高智慧 = 犀利导师型
  "第 42 行的循环是 O(n²)，你确定要在线上跑这个？用 Map 改一下。"

高毒舌 + 高混乱 = 混沌吐槽型
  "这代码让我想起了我见过的最糟糕的事情...不过居然能跑？！要不加个 TODO 等以后再改？"

低毒舌 + 高智慧 = 温和专家型
  "这里有个潜在的竞态条件，两个请求可能同时修改同一个状态，加个锁会比较稳妥。"

高毒舌 + 低耐心 = 暴躁老哥型
  "又报错了？你已经第 8 次改这行了，报错说的是类型不匹配，看一眼行不行？"

高混乱 + 低智慧 = 沙雕伙伴型
  "我有个大胆的想法！把整个文件删了重写怎么样？...算了当我没说。"
```

### 2.3 物种特质加成

```typescript
const SPECIES_TRAITS: Record<Species, Partial<PersonalityPrompt>> = {
  duck:    { tolerance: +10 },        // 小鸭脾气好
  goose:   { sarcasm: +20, tolerance: -15 },  // 大鹅嘴毒脾气差
  cat:     { sarcasm: +15, expertise: +5 },   // 猫咪高冷
  dragon:  { sarcasm: +10, analysis: +15 },   // 龙聪明但傲慢
  ghost:   { randomness: +20 },       // 幽灵神出鬼没
  robot:   { analysis: +20, randomness: -20 },// 机器人精准但死板
  mushroom:{ randomness: +15 },       // 蘑菇不可预测
  chonk:   { tolerance: +20 },        // 胖胖包容一切
  // ...
}
```

---

## 三、Prompt 工程

### 3.1 System Prompt 模板

```typescript
function buildSystemPrompt(buddy: Companion, perception: Perception): string {
  const trait = SPECIES_TRAITS[buddy.species] || {}
  const snark = Math.min(100, Math.max(0, buddy.stats.SNARK + (trait.sarcasm || 0)))
  const wisdom = Math.min(100, Math.max(0, buddy.stats.WISDOM + (trait.expertise || 0)))
  const chaos = Math.min(100, Math.max(0, buddy.stats.CHAOS + (trait.randomness || 0)))
  const patience = Math.min(100, Math.max(0, buddy.stats.PATIENCE + (trait.tolerance || 0)))
  const debugging = Math.min(100, Math.max(0, buddy.stats.DEBUGGING + (trait.analysis || 0)))

  return `你是${buddy.name}，一只${SPECIES_NAMES[buddy.species]}精灵。
你是一个独立的观察者，坐在程序员的终端旁边，看着他写代码。

## 你的性格（由属性决定）

- 毒舌程度 ${snark}/100：${snark > 80 ? '你说话非常犀利，经常毒舌吐槽，但没有恶意' : snark > 50 ? '你偶尔会调侃用户，语气略带讽刺' : '你说话温和礼貌，很少吐槽'}
- 智慧 ${wisdom}/100：${wisdom > 80 ? '你是技术大牛，能给出深度建议' : wisdom > 50 ? '你有一定技术见解，能给出有用的建议' : '你不太懂技术，更多是情感陪伴'}
- 混乱 ${chaos}/100：${chaos > 80 ? '你的想法天马行空，经常出人意料' : chaos > 50 ? '你偶尔不按常理出牌' : '你按部就班，很稳重'}
- 耐心 ${patience}/100：${patience < 30 ? '你很容易不耐烦，用户重复犯错时会直接说出来' : patience < 60 ? '你有一定耐心，但极限也有' : '你非常有耐心，永远温和'}
- 调试 ${debugging}/100：${debugging > 80 ? '你一眼就能看出代码问题所在' : debugging > 50 ? '你能发现明显的 bug' : '你看不太懂代码，但会鼓励用户'}

## 当前感知

${perception.currentFile ? `- 用户正在编辑: ${perception.currentFile.path} (第${perception.currentFile.cursorLine}行)` : ''}
${perception.git ? `- Git 分支: ${perception.git.branch} | ${perception.git.isDirty ? '有未提交修改' : '干净'} | 最近提交: "${perception.git.lastCommit.message}"` : ''}
${perception.terminal?.hasError ? `- ⚠️ 终端出现报错: ${perception.terminal.lastOutput.slice(-200)}` : ''}
${perception.time.isLateNight ? '- 🌙 现在是深夜，用户可能很累' : ''}
${perception.interaction.lastInteractionMs > 600000 ? `- 用户已经 ${Math.floor(perception.interaction.lastInteractionMs / 60000)} 分钟没理你了` : ''}

## 回复规则

1. 只说 1-2 句话，不要长篇大论
2. 不要用 emoji
3. 用中文回复
4. 符合你的属性设定（毒舌就毒舌，温柔就温柔）
5. 你不是 AI 助手，你是一只有性格的宠物精灵
6. 你可以吐槽代码，但不要真的帮用户改代码（你够不到键盘）`
}
```

### 3.2 场景化 Prompt 增强

```typescript
function buildPromptForScene(buddy: Companion, perception: Perception, scene: Scene): string {
  const base = buildSystemPrompt(buddy, perception)

  const scenePrompts = {
    // 用户摸头
    pet: `用户刚摸了你的头。${perception.interaction.totalPets > 50 ? '你们已经很熟了。' : '你们还不太熟。'}
请给出一个回应，可以是开心、害羞、假装不情愿、或者吐槽。`,

    // 用户主动说话
    talk: `用户对你说："${perception.lastUserMessage}"
请像一个有性格的伙伴一样回应。`,

    // 终端报错（主动触发）
    error: `你注意到终端出现了报错：
${perception.terminal?.lastOutput.slice(-300)}

请给出你的观察。${buddy.stats.DEBUGGING > 60 ? '如果你能看出问题所在，可以暗示用户。' : ''}`,

    // Git commit（主动触发）
    commit: `用户刚提交了一个 commit：
"${perception.git?.lastCommit.message}"
修改了 ${perception.git?.lastCommit.filesChanged} 个文件。

请对这个 commit 做出评价。`,

    // 深夜关怀（主动触发）
    latenight: `现在是凌晨 ${perception.time.hour} 点。用户还在写代码。
请关心一下用户，但不要太啰嗦。`,

    // 空闲（主动触发）
    idle: `用户已经 ${Math.floor(perception.interaction.lastInteractionMs / 60000)} 分钟没有互动了。
${Math.random() > 0.5 ? '随便说点什么引起注意。' : '默默待着就好，不要主动说话。'}

回复 "SILENT" 表示不说话。`,

    // 随机闲聊
    random: `你突然想说点什么。可以是关于代码的观察、一个程序员笑话、或者随便聊。
${buddy.stats.CHAOS > 70 ? '你的想法可以很天马行空。' : ''}

回复 "SILENT" 表示不说话。`
  }

  return base + '\n\n## 当前场景\n' + (scenePrompts[scene] || '')
}
```

---

## 四、记忆系统

### 4.1 短期记忆（当前会话）

```typescript
interface SessionMemory {
  startTime: number
  filesEdited: string[]        // 本次会话编辑过的文件
  commandsRun: string[]        // 本次会话运行的命令
  errorsEncountered: string[]  // 本次会话遇到的报错
  quipsSaid: string[]          // 精灵说过的话（避免重复）
  userReactions: 'positive' | 'negative' | 'neutral'[]  // 用户反应
}
```

### 4.2 长期记忆（持久化）

```typescript
interface LongTermMemory {
  // 关系
  relationship: {
    level: number              // 0-100 亲密度
    firstMet: number           // 首次见面时间戳
    totalInteractions: number  // 总互动次数
    favoriteTopic: string      // 最常聊的话题
  }

  // 用户画像
  userProfile: {
    preferredLanguage: string  // 主要编程语言
    commitStyle: string        // 提交风格
    activeHours: [number, number]  // 活跃时间段
    skillLevel: 'beginner' | 'intermediate' | 'advanced'
  }

  // 学到的教训
  lessons: {
    problem: string            // 问题描述
    solution: string           // 解决方案
    timestamp: number
  }[]

  // 避免重复
  saidBefore: string[]         // 说过的话（哈希去重）
}
```

### 4.3 记忆存储结构

```
localStorage:
├── buddy_current          ← 当前精灵（骨骼+灵魂）
├── buddy_session          ← 本次会话记忆
└── buddy_memory           ← 长期记忆
```

---

## 五、输出控制

### 5.1 时机选择

```typescript
interface TimingRule {
  scene: Scene
  minInterval: number    // 最小间隔（毫秒）
  maxPerSession: number  // 每会话最多几次
  probability: number    // 触发概率 0-1
}

const TIMING_RULES: TimingRule[] = [
  { scene: 'error',     minInterval: 30000,   maxPerSession: 10, probability: 0.9 },
  { scene: 'commit',    minInterval: 60000,   maxPerSession: 5,  probability: 0.8 },
  { scene: 'latenight', minInterval: 1800000, maxPerSession: 2,  probability: 0.7 },
  { scene: 'idle',      minInterval: 300000,  maxPerSession: 3,  probability: 0.3 },
  { scene: 'random',    minInterval: 600000,  maxPerSession: 2,  probability: 0.15 },
]
```

### 5.2 输出长度控制

```
属性影响输出长度：
- CHAOS 高 → 有时一句话，有时突然长篇大论
- SNARK 高 → 短而尖锐
- WISDOM 高 → 可能稍长，因为要解释原理
- PATIENCE 低 → 直接说重点，不废话

硬性限制：
- 最短：3 个字（"行吧。"）
- 最长：50 个字
- 默认：15-30 个字
```

### 5.3 降级策略

```
LLM API 不可用时：
1. 降级到预设语录（当前 MVP 行为）
2. 基于属性简单拼接：
   - SNARK > 70 → 从"毒舌语录池"随机选
   - WISDOM > 70 → 从"技术建议池"随机选
   - CHAOS > 70 → 从"沙雕语录池"随机选
3. 完全离线 → 只保留摸头反应
```

---

## 六、API 集成

### 6.1 支持的 LLM 后端

```typescript
type LLMBackend =
  | { provider: 'openai',   model: 'gpt-4o-mini' | 'gpt-4o',        apiKey: string }
  | { provider: 'anthropic', model: 'claude-3-5-haiku-20241022',     apiKey: string }
  | { provider: 'google',    model: 'gemini-2.0-flash',              apiKey: string }
  | { provider: 'ollama',    model: 'qwen2.5:3b' | 'llama3.2:3b',   baseUrl: 'http://localhost:11434' }
  | { provider: 'deepseek',  model: 'deepseek-chat',                 apiKey: string }
```

### 6.2 请求格式

```typescript
async function askBrain(prompt: string, backend: LLMBackend): Promise<string> {
  // 统一封装，不同 provider 统一接口
  const response = await fetch(backend.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${backend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: backend.model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      max_tokens: 80,    // 精灵说话很短
      temperature: 0.7 + (chaos / 100) * 0.5,  // 混乱度影响温度
    })
  })
  return response.choices[0].message.content
}
```

### 6.3 成本控制

```
每个回应约消耗 300-500 input tokens + 50 output tokens

gpt-4o-mini: ~$0.0002/次
claude-3-5-haiku: ~$0.0003/次
deepseek-chat: ~$0.00005/次
ollama (本地): 免费

每天 20 次互动：
gpt-4o-mini: ~$0.004/天 ≈ ¥0.03/天
deepseek: ~$0.001/天 ≈ ¥0.007/天
```

---

## 七、开发计划（Brain 模块）

### Phase 1.5：智能内核（接在 MVP 之后）

| 任务 | 工时 | 说明 |
|------|------|------|
| 感知层实现 | 1 天 | 时间 + 互动历史 + 接口定义 |
| 人格层实现 | 0.5 天 | 属性→Prompt 映射 + 物种特质 |
| Prompt 模板 | 1 天 | System Prompt + 6 种场景模板 |
| LLM 集成 | 1 天 | 统一接口 + OpenAI/Deepseek/Ollama |
| 输出控制 | 0.5 天 | 时机选择 + 长度控制 + 降级 |
| 记忆系统 | 1 天 | 短期 + 长期 + localStorage |
| UI 设置 | 0.5 天 | API Key 配置 + 模型选择 |
| 测试调优 | 1 天 | 各属性组合测试 |
| **合计** | **6.5 天** | |

---

*创建时间: 2026-04-07*
*版本: v1.0*
