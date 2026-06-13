# Buddy 进化与记忆系统设计

> 让精灵不只是宠物，而是一个会成长、会记住、有羁绊的伙伴。

---

## 一、进化系统

### 1.1 进化总览

```
蛋 (Egg)
 │  ← 摸头 10 次孵化
 ▼
幼年期 (Baby)     Lv.1-10
 │  ← 互动 100 次 / 相处 7 天
 ▼
成长期 (Juvenile)  Lv.11-25
 │  ← 互动 500 次 / 相处 30 天 / 解锁成就 5 个
 ▼
成熟期 (Adult)     Lv.26-50
 │  ← 互动 2000 次 / 相处 90 天 / 解锁成就 15 个
 ▼
完全体 (Final)     Lv.51-99
 │  ← 互动 5000 次 / 相处 180 天 / 解锁成就 30 个
 ▼
传说态 (Legendary)  Lv.100 ✨
```

### 1.2 等级系统

```typescript
interface LevelSystem {
  level: number           // 1-100
  exp: number             // 当前经验值
  expToNext: number       // 升级所需经验
  stage: 'egg' | 'baby' | 'juvenile' | 'adult' | 'final' | 'legendary'
}

// 经验来源
const EXP_SOURCES = {
  pet: 5,                 // 摸头 +5
  talk: 10,               // 对话 +10
  error_detected: 20,     // 发现报错 +20
  bug_solved: 50,         // 帮助解决 bug +50
  commit: 15,             // 用户提交 commit +15
  daily_login: 25,        // 每日首次互动 +25
  streak_bonus: 10,       // 连续 N 天互动 +10*N
  achievement: 100,       // 解锁成就 +100
  latenight_care: 30,     // 深夜被关怀 +30
}

// 升级经验曲线（指数增长）
function expToLevel(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.5))
}
// Lv.1→2: 50, Lv.5→6: 559, Lv.10→11: 1581, Lv.25→26: 6374, Lv.50→51: 17850
```

### 1.3 进化变化

每次进化阶段变化时：

```typescript
interface EvolutionChange {
  stage: Stage

  // 外观变化
  visual: {
    size: 'small' | 'medium' | 'large'      // ASCII 精灵变大
    aura: 'none' | 'glow' | 'sparkle' | 'flame'  // 光环效果
    borderStyle: 'none' | 'dots' | 'stars' | 'fire' // 边框特效
    newFrames: number    // 动画帧数增加（3→4→5）
  }

  // 能力解锁
  abilities: string[]

  // 属性加成
  statBonus: Partial<Record<StatName, number>>
}
```

**各阶段变化表：**

| 阶段 | 大小 | 光环 | 特效 | 新能力 | 属性加成 |
|------|------|------|------|--------|---------|
| 蛋 🥚 | 3×5 | 无 | 裂纹动画 | 无 | 无 |
| 幼年 | 5×12 | 无 | 无 | 摸头反应 | 全属性+5 |
| 成长 | 5×12 | glow | 圆点边框 | 主动说话 | 全属性+10 |
| 成熟 | 7×16 | sparkle | 星星边框 | 代码分析 | 全属性+15 |
| 完全 | 7×16 | flame | 火焰边框 | 深度建议 | 全属性+20 |
| 传说 | 9×20 | rainbow | 彩虹全部 | 全能力 MAX | 全属性+30 |

### 1.4 进化解锁的能力

```typescript
const STAGE_ABILITIES = {
  egg: [],

  baby: [
    'pet_reaction',          // 摸头反应
    'basic_quip',            // 基础吐槽
  ],

  juvenile: [
    'active_speak',          // 主动说话（不再只是被动回应）
    'mood_detection',        // 检测用户情绪
    'idle_chat',             // 空闲时闲聊
  ],

  adult: [
    'code_observation',      // 观察代码并评论
    'error_alert',           // 发现报错主动提醒
    'git_commentary',        // 对 commit 做出评价
    'late_night_care',       // 深夜关怀
  ],

  final: [
    'deep_analysis',         // 深度代码分析
    'pattern_recognition',   // 识别编码模式
    'proactive_suggestions', // 主动建议
    'memory_recall',         // 回忆过去的对话
  ],

  legendary: [
    'all_abilities_max',     // 所有能力满级
    'custom_personality',    // 自定义性格微调
    'teach_mode',            // 教学模式
    'companion_commute',     // 跨设备同步
  ],
}
```

### 1.5 进化动画

```
蛋 → 幼年：
  裂纹动画（3 帧）
  碎裂 → 精灵弹出
  "✨ 我诞生了！请多指教~"

幼年 → 成长：
  闪烁 → 长大
  光环渐现
  "🌟 我长大了！现在我可以主动找你说话了~"

成长 → 成熟：
  光芒爆发 → 升级
  "⭐ 我变强了！我能看懂你的代码了~"

成熟 → 完全：
  烈焰升腾
  "🔥 完全体！我已经准备好帮你解决难题了！"

完全 → 传说：
  彩虹全屏特效
  "🌈 传说形态！我们已经是一辈子的伙伴了。"
```

---

## 二、记忆系统

### 2.1 记忆架构

```
┌───────────────────────────────────────────────┐
│                Memory System                   │
├──────────────┬──────────────┬─────────────────┤
│  短期记忆     │   长期记忆    │   关系记忆       │
│  Working     │  Long-term   │  Relationship   │
├──────────────┼──────────────┼─────────────────┤
│ 当前会话      │ 跨会话持久化  │ 羁绊/亲密度      │
│ 上下文窗口    │ 知识图谱     │ 里程碑事件       │
│ 最近 N 条     │ 用户画像     │ 共同经历         │
│ 情绪状态      │ 学到的教训   │ 称呼/偏好        │
└──────────────┴──────────────┴─────────────────┘
```

### 2.2 短期记忆（当前会话）

```typescript
interface WorkingMemory {
  sessionId: string
  startTime: number

  // 对话历史（滑动窗口，保留最近 20 条）
  messages: {
    role: 'user' | 'buddy'
    content: string
    timestamp: number
    context?: {
      file?: string
      action?: string  // 'pet' | 'talk' | 'error' | 'commit'
    }
  }[]

  // 当前感知快照
  currentContext: {
    file: string
    gitBranch: string
    lastCommand: string
    mood: 'happy' | 'neutral' | 'frustrated' | 'tired'
  }

  // 本次会话统计
  stats: {
    pets: number
    talks: number
    errorsSeen: number
    commitsSeen: number
    startTime: number
  }
}
```

### 2.3 长期记忆（跨会话持久化）

```typescript
interface LongTermMemory {
  // ──── 用户画像 ────
  profile: {
    name: string                    // 用户名
    nickname?: string               // 精灵给用户起的昵称
    primaryLanguages: string[]      // 主要编程语言 ["TypeScript", "Python"]
    frameworks: string[]            // 常用框架 ["React", "Express"]
    activeHours: { start: number, end: number }  // 活跃时段 9-23
    skillLevel: number              // 0-100，精灵评估的技术水平
    codingStyle: {
      commitStyle: 'conventional' | 'descriptive' | 'minimal'
      indentStyle: 'spaces' | 'tabs'
      testHabit: 'always' | 'sometimes' | 'never'
    }
  }

  // ──── 知识图谱 ────
  knowledge: {
    // 用户经常遇到的问题
    commonErrors: {
      pattern: string               // "Cannot read property of undefined"
      count: number                 // 遇到次数
      lastSeen: number
      solution?: string             // 如果精灵知道解决方案
    }[]

    // 用户的项目
    projects: {
      name: string
      path: string
      techStack: string[]
      lastActive: number
      notes: string                 // 精灵对这个项目的观察
    }[]

    // 用户的编码模式
    patterns: {
      name: string                  // "晚睡型开发者"
      description: string           // "经常在 23:00-02:00 写代码"
      confidence: number            // 0-100
    }[]
  }

  // ──── 里程碑事件 ────
  milestones: {
    id: string
    type: 'first_meet' | 'level_up' | 'achievement' | 'streak' | 'special'
    title: string                   // "第一次摸头"
    description: string             // "你轻轻摸了摸我的头，我好开心~"
    timestamp: number
    emotion: 'happy' | 'proud' | 'grateful' | 'excited'
    recalled: number                // 被回忆的次数
  }[]

  // ──── 对话精华 ────
  memorableQuotes: {
    quote: string                   // 精灵说过的精彩的话
    context: string                 // 当时的情境
    userReaction: 'loved' | 'laughed' | 'ignored'
    timestamp: number
  }[]

  // ──── 避免重复 ────
  saidHashes: string[]              // 说过的话的哈希（最近 200 条）
}
```

### 2.4 关系记忆（羁绊系统）

```typescript
interface RelationshipMemory {
  // 亲密度 0-100
  intimacy: number

  // 羁绊值 0-100（比亲密度更深层）
  bond: number

  // 称呼系统
  addressing: {
    buddyCallsUser: string          // 精灵叫用户什么："铲屎官" / "大佬" / "搭档"
    userCallsBuddy: string          // 用户叫精灵什么（从对话中学习）
  }

  // 共同经历计数
  sharedExperiences: {
    bugsFixed: number               // 一起修过的 bug
    lateNights: number              // 一起熬过的夜
    commits: number                 // 一起提交的 commit
    errors: number                  // 一起面对的报错
    laughs: number                  // 一起笑过的次数
  }

  // 关系阶段
  stage: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'soulmate'

  // 关系历史
  history: {
    date: number
    event: string                   // "亲密度从 30 升到 31"
    trigger: string                 // "连续互动 7 天"
  }[]
}
```

### 2.5 亲密度成长

```typescript
const INTIMACY_GAIN = {
  // 日常互动
  pet: 0.5,                  // 摸头 +0.5
  talk: 1,                   // 对话 +1
  daily_login: 3,            // 每日登录 +3

  // 深度互动
  error_collaboration: 5,    // 一起解决报错 +5
  late_night_together: 3,    // 深夜一起加班 +3
  remembered_milestone: 2,   // 回忆里程碑 +2

  // 特殊事件
  first_bug_fixed: 10,       // 第一个一起修的 bug
  streak_7_days: 15,         // 连续 7 天互动
  streak_30_days: 30,        // 连续 30 天互动
  level_up: 5,               // 升级

  // 负面
  ignored_24h: -1,           // 24 小时没互动 -1
  ignored_7d: -5,            // 7 天没互动 -5
}

// 关系阶段阈值
const RELATIONSHIP_THRESHOLDS = {
  stranger:      { min: 0,   label: '陌生人',  greeting: '你好...' },
  acquaintance:  { min: 20,  label: '认识了',  greeting: '又见面了~' },
  friend:        { min: 50,  label: '朋友',    greeting: '嘿！想你了~' },
  close_friend:  { min: 80,  label: '挚友',    greeting: '搭档！今天干点啥？' },
  soulmate:      { min: 100, label: '灵魂伴侣', greeting: '你来了 ❤️' },
}
```

### 2.6 记忆回忆机制

```typescript
// 精灵会"回忆"过去的经历
function recallMemory(buddy: Companion, context: Context): string | null {
  const { longTerm, relationship } = buddy.memory

  // 根据当前情境触发回忆
  const recallTriggers = [
    {
      condition: () => context.terminal?.hasError && longTerm.knowledge.commonErrors.length > 0,
      recall: () => {
        const similar = findSimilarError(context.terminal.lastOutput, longTerm.knowledge.commonErrors)
        if (similar) return `我记得你之前也遇到过类似的错误...${similar.solution || '当时怎么解决的来着？'}`
      }
    },
    {
      condition: () => relationship.sharedExperiences.lateNights > 10 && context.time.isLateNight,
      recall: () => `这是我们第 ${relationship.sharedExperiences.lateNights} 次一起熬夜了...记得第一次是修那个登录 bug。`
    },
    {
      condition: () => context.git?.lastCommit.message.includes('fix') && relationship.sharedExperiences.bugsFixed > 5,
      recall: () => `又一个 bug 被消灭了！这是我们一起修的第 ${relationship.sharedExperiences.bugsFixed} 个 bug 💪`
    },
    {
      condition: () => longTerm.milestones.length > 0 && Math.random() < 0.1,
      recall: () => {
        const milestone = pick(randomFrom(longTerm.milestones))
        return `突然想起${milestone.description}`
      }
    },
  ]

  for (const trigger of recallTriggers) {
    if (trigger.condition()) return trigger.recall()
  }
  return null
}
```

### 2.7 记忆可视化（UI）

```
┌─────────────────────────────────────────┐
│  📖 精灵日记                              │
├─────────────────────────────────────────┤
│  📅 2026-04-07                          │
│  今天第一次见面！他给我起名叫"小胖"。       │
│  他一直在写 React 代码，看起来很熟练。     │
│  摸了我 3 次头，好开心~                   │
│                                         │
│  📅 2026-04-08                          │
│  他今天遇到一个 CORS 错误，我提醒他了。    │
│  晚上 11 点还在写代码，我让他早点睡。      │
│  亲密度: 15 → 18                        │
│                                         │
│  ⭐ 里程碑                               │
│  🎉 第一次摸头 (04-07)                   │
│  🎉 连续互动 3 天 (04-09)               │
│  🎉 一起修了第一个 bug (04-10)           │
│                                         │
│  📊 统计                                 │
│  相处: 7 天 | 摸头: 42 次 | 对话: 28 次  │
│  一起修的 bug: 3 | 熬夜: 2 次            │
│  亲密度: 32/100 | 羁绊: 15/100           │
└─────────────────────────────────────────┘
```

---

## 三、成就系统

### 3.1 成就列表

```typescript
const ACHIEVEMENTS = [
  // 互动类
  { id: 'first_pet',       title: '初次触碰',     desc: '第一次摸头',                icon: '👋', exp: 50 },
  { id: 'pet_10',          title: '摸摸达人',     desc: '摸头 10 次',                icon: '🤲', exp: 100 },
  { id: 'pet_100',         title: '撸宠大师',     desc: '摸头 100 次',               icon: '🏆', exp: 500 },
  { id: 'pet_1000',        title: '终极抚摸',     desc: '摸头 1000 次',              icon: '👑', exp: 2000 },

  // 时间类
  { id: 'first_night',     title: '夜猫子',       desc: '第一次深夜互动',             icon: '🌙', exp: 50 },
  { id: 'streak_7',        title: '形影不离',     desc: '连续互动 7 天',              icon: '📅', exp: 200 },
  { id: 'streak_30',       title: '不离不弃',     desc: '连续互动 30 天',             icon: '💎', exp: 1000 },
  { id: 'streak_100',      title: '永恒伙伴',     desc: '连续互动 100 天',            icon: '🌈', exp: 5000 },

  // 编程类
  { id: 'first_error',     title: '问题发现者',   desc: '第一次发现报错',             icon: '🐛', exp: 50 },
  { id: 'errors_50',       title: 'Bug 猎人',     desc: '一起面对 50 个报错',         icon: '🔍', exp: 300 },
  { id: 'first_commit',    title: '见证者',       desc: '一起提交第一个 commit',       icon: '📝', exp: 100 },
  { id: 'commits_100',     title: '记录官',       desc: '一起提交 100 个 commit',      icon: '📚', exp: 1000 },

  // 关系类
  { id: 'intimacy_50',     title: '知心伙伴',     desc: '亲密度达到 50',              icon: '❤️', exp: 500 },
  { id: 'intimacy_100',    title: '灵魂伴侣',     desc: '亲密度达到 100',             icon: '💖', exp: 2000 },
  { id: 'nickname',        title: '专属昵称',     desc: '精灵给你起了昵称',           icon: '🏷️', exp: 200 },

  // 进化类
  { id: 'stage_juvenile',  title: '破壳成长',     desc: '进化到成长期',               icon: '🌱', exp: 300 },
  { id: 'stage_adult',     title: '羽翼丰满',     desc: '进化到成熟期',               icon: '🦋', exp: 1000 },
  { id: 'stage_final',     title: '完全体',       desc: '进化到最终形态',             icon: '🔥', exp: 3000 },
  { id: 'stage_legendary', title: '传说降临',     desc: '进化到传说形态',             icon: '⚡', exp: 10000 },

  // 隐藏成就
  { id: 'easter_egg_1',    title: '???' ,         desc: '???',  icon: '🎁', exp: 500, hidden: true },
  { id: 'easter_egg_2',    title: '???',          desc: '???',  icon: '🎁', exp: 500, hidden: true },
  { id: 'easter_egg_3',    title: '???',          desc: '???',  icon: '🎁', exp: 500, hidden: true },
]
```

---

## 四、数据流总结

```
用户行为
  ├─→ 感知层（当前上下文）
  ├─→ 记忆系统
  │    ├─ 短期记忆（会话内）
  │    ├─ 长期记忆（跨会话）
  │    └─ 关系记忆（亲密度/羁绊）
  │
  ├─→ 进化系统
  │    ├─ 经验值计算
  │    ├─ 等级判断
  │    ├─ 阶段进化检查
  │    └─ 能力解锁
  │
  ├─→ 成就系统
  │    └─ 条件检查 → 解锁
  │
  └─→ Brain（智能内核）
       ├─ 感知 + 记忆 + 人格 → Prompt
       ├─ LLM 生成回应
       └─ 输出 + 更新记忆 + 检查进化/成就
```

---

## 五、存储结构

```typescript
// localStorage keys
const STORAGE_KEYS = {
  buddy_current: 'buddy_current',           // 当前精灵（Companion）
  buddy_working: 'buddy_working_memory',    // 短期记忆
  buddy_longterm: 'buddy_longterm_memory',  // 长期记忆
  buddy_relationship: 'buddy_relationship', // 关系记忆
  buddy_achievements: 'buddy_achievements', // 成就列表
  buddy_diary: 'buddy_diary',               // 精灵日记
}

// 总存储量估算
// 精灵数据: ~2KB
// 短期记忆: ~5KB（每次会话重建）
// 长期记忆: ~20KB（随时间增长）
// 关系记忆: ~5KB
// 成就: ~3KB
// 日记: ~50KB（按天追加，可清理旧条目）
// 总计: ~85KB（localStorage 上限 5-10MB，绰绰有余）
```

---

*创建时间: 2026-04-07*
*版本: v1.0*
