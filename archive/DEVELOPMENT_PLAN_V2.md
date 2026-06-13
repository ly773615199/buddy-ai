# Buddy 开发计划 v2 — 养成即引导

> **核心转变：养成不是游戏层，是产品的引导引擎。**
> 精灵的成长 = 用户对产品的探索深度。
> 喂食 = 使用功能，玩耍 = 探索新能力，进化 = 解锁新模块，亲密度 = 使用深度。
>
> 基于 2026-04-10 全面代码审查 | 794 测试通过

---

## 一、现有设计的问题

### 当前做法：贴了个小游戏

```
用户操作 ──→ Agent 处理 ──→ 返回结果
                    │
                    └──→ PetManager.addExp(+3) ──→ 等级提升 ──→ ...然后呢？
                                                           └──→ 什么都没发生
```

**问题：** 等级提升后没有解锁任何东西。用户不知道"为什么要养它"。
XP 来源是通用计数器（对话+3，工具+10），跟用了什么功能无关。

### 应该的做法：养成 = 引导引擎

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

## 二、新架构

### 2.1 养成系统的角色重新定义

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

### 2.2 功能探索图谱（取代通用 XP 系统）

不再是"做任何事都加经验"，而是追踪**用户探索了产品的哪些能力**：

```typescript
interface FeatureMap {
  // 每个功能是一个"探索节点"
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

**功能节点清单（对应现有工具+模块）：**

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

### 2.3 能力解锁门控（取代通用等级系统）

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

### 2.4 5维属性从行为中涌现（取代手动滑动条）

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

### 2.5 引导引擎（取代通用成就系统）

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

**引导任务示例：**

```
优先级队列（根据用户当前进度动态排序）：

当前阶段：刚注册
→ "👋 你好！我是你的 Buddy。让我看看你的项目吧——说'看看当前目录有什么'"

当前阶段：用过 chat + read_file，没用过 exec
→ "🤔 你还没让我执行过命令呢。试试让我跑个 `ls` 看看？"

当前阶段：基础全满，没用过 search_web
→ "🌐 你知道吗，我可以帮你搜东西！试试问我 'xxx怎么实现'？"

当前阶段：进阶用了 5 个，没用过 buddy_learn
→ "📚 你可以教我东西哦！发个文件给我，说'记住这个'"

当前阶段：专家功能用了 3 个，没创建过能力包
→ "📦 你的领域知识已经很丰富了，要不要打包成能力包？说'创建能力包'"
```

**引导触发机制：**
- 每次对话结束 → 检查是否有可推荐的下一个功能
- 连续 3 天没用新功能 → 主动推荐
- 空闲时（IdleBehavior） → 概率性推荐
- 引导频率控制：最多每 5 条消息推荐一次，不打扰

### 2.6 亲密度 = 使用深度（统一 trust）

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

**删除 `relationship` 表的 `trust` 字段，统一由 PetManager 管理。**

---

## 三、对现有模块的影响

### 3.1 需要改造的模块

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

### 3.2 不需要改的模块

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

### 3.3 接入点清单

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

## 四、新数据模型

### 4.1 核心类型

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

### 4.2 SQLite 表结构

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

## 五、实现计划

### 阶段一：数据层重建

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 1.1 | 重写 pet/types.ts | `src/pet/types.ts` | 新数据模型（FeatureMap + BehaviorSignals + GuidanceTask） |
| 1.2 | 重写 pet/manager.ts 核心 | `src/pet/manager.ts` | trackFeature() + checkEvolution() + getGuidance() + computeBehavior() |
| 1.3 | PetManager 改用 SQLite | `src/pet/manager.ts` | 接收 dbPath，5 张表 |
| 1.4 | 删除 MemoryStore 信任/亲密字段 | `src/memory/store.ts` | relationship 表只保留其他自定义 key，trust/intimacy 移走 |
| 1.5 | 更新 pet 测试 | `src/test-pet.ts` | 测试新逻辑 |
| 1.6 | FeatureMap 初始种子数据 | `src/pet/features.ts` | 25 个功能节点定义 |

### 阶段二：Agent 集成

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 2.1 | Agent 注入 PetManager | `src/core/agent.ts` | 构造函数创建/加载 |
| 2.2 | 工具调用 → trackFeature | `src/core/agent.ts` | executeTool 回调中 |
| 2.3 | 对话 → trackFeature('chat') | `src/core/agent.ts` | handleUserMessage 中 |
| 2.4 | 梦境/知识/技能/能力包 → trackFeature | 各模块回调 | 事件驱动 |
| 2.5 | 摸头 → trackFeature('pet_headpat') | `src/core/agent.ts` | handlePet 中 |
| 2.6 | broadcastStatus() 改造 | `src/core/agent.ts` | 包含 features + evolution + guidance |
| 2.7 | 进化检查 & 事件广播 | `src/core/agent.ts` | trackFeature 后自动检查 |
| 2.8 | 引导消息 → bubble 事件 | `src/core/agent.ts` | 空闲/对话结束时检查 |
| 2.9 | 信任度统一到 PetManager | `src/core/agent.ts` | `memory.getRelation('trust')` → `pet.getIntimacy()` |
| 2.10 | 行为属性注入 Prompt | `src/personality/prompt.ts` | pet.getBehaviorSignals() → 5维 |
| 2.11 | 亲密度注入 Prompt | `src/personality/prompt.ts` | pet.getIntimacy() → 关系描述 |
| 2.12 | IdleBehavior 增加引导触发 | `src/behavior/idle.ts` | 空闲时概率性推荐 |
| 2.13 | 更新集成测试 | `src/test-integration.ts` | 覆盖新流程 |

### 阶段三：前端对齐

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 3.1 | 更新 BuddyState 类型 | `frontend/src/types/buddy.ts` | 包含 features + guidance |
| 3.2 | 修正 useWebSocket 事件解析 | `frontend/src/hooks/useWebSocket.ts` | state 事件结构对齐 |
| 3.3 | 新增 ExplorationMap 组件 | `frontend/src/components/ExplorationMap.tsx` | 替代 PetStats 中的 stat bar |
| 3.4 | 引导气泡 UI | `frontend/src/components/ChatPanel.tsx` | 特殊 role='guidance' 消息样式 |
| 3.5 | 进化动画 | `frontend/src/components/EvolutionAnimation.tsx` | 全屏揭晓 |
| 3.6 | 物种 emoji 补全 | `frontend/src/components/SpriteRenderer.tsx` | 10 物种 |

### ExplorationMap 组件设计

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

### 引导气泡样式

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

## 六、与 PLAN_V2 的映射

| PLAN_V2 描述 | 本计划实现 | 对齐度 |
|-------------|-----------|--------|
| "养成的目的是引导用户探索" | ✅ 功能探索图谱 + 引导引擎 | ✅ 完全一致 |
| "灵魂与肉身分离" | ✅ 数值走行为涌现，外观走前端渲染 | ✅ 一致 |
| "物种特质加成 → 性格" | ✅ 物种加成 + 行为信号叠加 | ✅ 更好 |
| "信任度系统" | ✅ 统一为亲密度，从使用中来 | ✅ 更好 |
| "进化系统 6 阶段" | ✅ 保留，但触发条件改为探索完成度 | ✅ 改进 |
| "成就系统" | ✅ 转化为引导任务 | ✅ 改进 |
| "等级系统" | ⚡ 不再有独立等级，进化阶段=探索深度 | ✅ 更好 |
| "多精灵收集" | 📋 阶段六 | 延后 |
| "扭蛋/孵化" | 📋 阶段六 | 延后 |
| "装扮系统" | 📋 阶段七 | 延后 |
| "精灵日记" | 📋 阶段八 | 延后 |
| "5 维属性手动调节" | ⚡ 改为自动涌现，设置面板只展示不修改 | ✅ 改进 |

---

## 七、验收标准

### 最小可体验版本（阶段一+二完成）

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

> **补充文档：** 视觉形象系统演进计划详见 [`VISUAL_IDENTITY_PLAN.md`](./VISUAL_IDENTITY_PLAN.md)
> 从 emoji 堆叠演进为"能量凝聚"视觉形象系统，包括四阶段 Canvas 渲染器、用户种子选择、行为驱动外观等完整实施方案。
