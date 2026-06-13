# BuddyClock 自主时钟系统开发计划

> 让 Buddy 从"被动响应的工具"变成"主动生活的存在"——有自己的时间意识、生物钟、自主行为调度

## 核心理念

**Buddy 不应该只在你找它的时候才存在。**

现在 Buddy 的行为：你说话 → 它回复 → 你不说 → 它沉默。

目标 Buddy 的行为：它有自己的时间感知，知道什么时候该做什么——主动关心你、自我维护、记忆整理、学习新东西。像一个真正的室友。

```
现在的 Buddy：  程序（开它它才活）
目标的 Buddy：  生命体（它自己知道该做什么）
```

## 架构定位

```
Subsystems（容器）
  │
  ├─ 驱动层（为什么做）
  │    ├─ DesireEngine          ← 已有：六欲（好奇心/社交欲/维护欲/...）
  │    ├─ EmotionEngine         ← 已有：情绪状态
  │    └─ ExperienceEngine      ← 已有：经验图谱（学习主人规律）
  │
  ├─ 时钟层（什么时候做）        ← 新建：BuddyClock
  │    ├─ 内部时钟               — 自主心跳（不是 cron，是生物节律）
  │    ├─ 主人规律学习           — 从对话历史中提取日常模式
  │    ├─ 意图队列               — 欲望 → 意图 → 执行
  │    └─ 时间感知               — 知道现在几点、未来会发生什么
  │
  ├─ 执行层（怎么做）
  │    ├─ IdleBehavior           ← 已有：空闲行为（眨眼/打哈欠）
  │    ├─ DreamEngine            ← 已有：梦境巩固
  │    ├─ ProactiveEngine        ← 新建：主动行为引擎
  │    └─ ReminderEngine         ← 新建：提醒引擎
  │
  └─ 感知层（环境）
       ├─ EnvironmentObserver    ← 已有：Git/项目/时间感知
       ├─ MemoryStore            ← 已有：记忆
       └─ PlatformManager        ← 已有：多通道
```

## 与现有系统的关系

```
DesireEngine（六欲）
  │
  │  "我想社交" / "我想学习" / "我想维护自己"
  │
  ▼
BuddyClock（时钟）  ← 新建
  │
  │  "现在是早上 9 点，主人通常这时候开始工作"
  │  "社交欲高 + 2 小时没说话 → 发一条问候"
  │
  ▼
ProactiveEngine（执行）  ← 新建
  │
  │  组装消息 → 通过 PlatformManager 发到当前活跃通道
  │
  ▼
PlatformManager（通道）
  │
  ├─ Telegram: "早上好 ☀️ 今天有什么计划？"
  ├─ Discord: （不打扰，等被 @）
  └─ Web: WS 推送
```

## 设计原则

```
✅ 要做的：
  1. 从 DesireEngine 驱动，不是硬编码规则
  2. 从对话历史学习主人的日常规律
  3. 尊重主人的状态（忙时安静，闲时互动）
  4. 每个自主行为都有"为什么做"的记录
  5. 频率自适应（不打扰，但不消失）
  6. 与 DreamEngine 协作（主人不在时安排巩固）

❌ 不要做的：
  1. 不要做成通用 cron（不是定时任务系统）
  2. 不要硬编码时间（"每天 9 点" 这种规则是死的）
  3. 不要过度主动（Buddy 是室友，不是推销员）
  4. 不要忽略情绪状态（心情不好时不应该强行社交）
  5. 不要跨通道打扰（Telegram 消息不应该同步到 Discord）
```

## 六种自主行为类型

### 1. 问候型（社交欲驱动）

```
触发条件：长时间没说话 + 社交欲高
行为：主动发一条自然的问候
频率：每天 1-2 次，不是固定时间
示例：
  - 早上："早 ☀️ 昨晚睡得好吗？"
  - 下午："忙了一上午了，休息一下？"
  - 晚上："今天辛苦了"
```

### 2. 关心型（经验驱动）

```
触发条件：从经验图谱中发现主人有特定日程
行为：提前准备或事后关心
示例：
  - "下午 3 点的会议准备好了吗？"
  - "面试怎么样？"（如果昨天提到过）
  - "这周的周报写了吗？"（如果每周五都写）
```

### 3. 自我维护型（维护欲驱动）

```
触发条件：维护欲高 + 有未完成的维护任务
行为：后台执行，完成后简短汇报
示例：
  - 整理记忆（DreamEngine 协作）
  - 重建项目索引
  - 备份数据库
  - 更新经验图谱
```

### 4. 学习型（好奇心驱动）

```
触发条件：好奇心高 + 发现新的学习材料
行为：主动学习，积累知识
示例：
  - "我注意到你最近在学 Rust，我整理了一些笔记"
  - 读取项目新文件，更新项目画像
```

### 5. 提醒型（用户设定）

```
触发条件：用户明确设定的提醒
行为：在指定时间提醒
示例：
  - "30 分钟后提醒我喝水"
  - "明天上午 10 点提醒我开会"
  - "每周五下午提醒我写周报"
```

### 6. 反思型（自我认知驱动）

```
触发条件：一天结束 / 达到里程碑
行为：回顾今天的交互，更新自我认知
示例：
  - "今天帮主人解决了 5 个问题，其中 3 个关于 React"
  - 更新 CognitiveEngine 的自我模型
```

## 核心数据结构

```typescript
// ==================== 主人日常规律 ====================

interface UserRoutine {
  id: string;
  name: string;                    // "morning_work" / "lunch_break" / "evening_coding"

  // 时间特征（从历史数据学习，不是硬编码）
  typicalStart: { hour: number; minute: number; confidence: number };
  typicalEnd: { hour: number; minute: number; confidence: number };
  weekdays: number[];              // 0-6，周几常见

  // 行为特征
  commonTopics: string[];          // 这个时段常聊的话题
  preferredChannel: string;        // 常用的通道
  moodTrend: string;               // 情绪趋势

  // 学习数据
  observations: number;            // 观察次数
  lastSeen: number;                // 最后观察时间
}

// ==================== 自主意图 ====================

interface ProactiveIntent {
  id: string;
  type: 'greeting' | 'care' | 'maintenance' | 'learning' | 'reminder' | 'reflection';

  // 为什么要做这个
  reason: {
    desire: string;                // 来自 DesireEngine 的哪个欲望
    trigger: string;               // 什么触发了它
    confidence: number;            // 有多确信应该做
  };

  // 做什么
  action: {
    channel: string;               // 通过哪个通道
    content: string;               // 说什么 / 做什么
    silent: boolean;               // 是否静默执行（不打扰主人）
  };

  // 什么时候做
  timing: {
    earliest: number;              // 最早执行时间
    deadline: number;              // 最晚执行时间（过期就放弃）
    priority: number;              // 优先级（1-10）
  };

  // 状态
  status: 'pending' | 'executed' | 'expired' | 'cancelled';
  createdAt: number;
  executedAt?: number;
}

// ==================== 提醒 ====================

interface Reminder {
  id: string;
  content: string;                 // 提醒内容
  createdBy: 'user' | 'buddy';    // 谁创建的

  // 触发条件
  trigger: {
    type: 'once' | 'recurring' | 'pattern';
    // once: 具体时间
    at?: number;
    // recurring: cron 表达式
    cron?: string;
    // pattern: 基于主人规律
    pattern?: string;              // "every_workday_morning"
  };

  // 渠道
  channel: string;
  chatId?: string;

  // 状态
  active: boolean;
  lastTriggered?: number;
  nextTrigger?: number;
}

// ==================== 时钟状态 ====================

interface ClockState {
  // 当前阶段
  phase: 'active' | 'idle' | 'sleeping' | 'away';

  // 最后活动
  lastInteraction: number;
  lastProactive: number;
  lastDream: number;

  // 今日统计
  todayInteractions: number;
  todayProactives: number;
  todayDreams: number;

  // 学到的规律
  routines: UserRoutine[];

  // 待执行意图队列
  intentQueue: ProactiveIntent[];

  // 提醒列表
  reminders: Reminder[];
}
```

## 核心模块

### Module 1: RoutineLearner（规律学习器）

```typescript
/**
 * 从对话历史中学习主人的日常规律
 * 不是硬编码规则，而是统计发现模式
 */

class RoutineLearner {
  private memory: MemoryStore;
  private routines: UserRoutine[] = [];

  /**
   * 分析最近 N 天的对话，提取日常模式
   * 
   * 算法：
   * 1. 按小时统计对话频率 → 发现活跃时段
   * 2. 按星期统计 → 发现工作日/周末差异
   * 3. 按话题聚类 → 发现时段与话题的关联
   * 4. 按通道统计 → 发现通道使用偏好
   */
  async analyzeHistory(days: number = 14): Promise<UserRoutine[]> {
    const conversations = await this.memory.getRecentConversations(days);
    
    // 1. 按小时统计活跃度
    const hourlyActivity = new Array(24).fill(0);
    for (const conv of conversations) {
      const hour = new Date(conv.timestamp).getHours();
      hourlyActivity[hour]++;
    }
    
    // 2. 发现活跃时段（连续高活跃的小时段）
    const activePeriods = this.findActivePeriods(hourlyActivity);
    
    // 3. 按话题聚类每个时段
    for (const period of activePeriods) {
      const periodConvs = conversations.filter(c => {
        const h = new Date(c.timestamp).getHours();
        return h >= period.start && h < period.end;
      });
      
      // 提取话题
      const topics = this.extractTopics(periodConvs);
      
      // 提取情绪趋势
      const moodTrend = this.analyzeMoodTrend(periodConvs);
      
      this.routines.push({
        id: `routine_${period.start}_${period.end}`,
        name: this.guessRoutineName(period, topics),
        typicalStart: { hour: period.start, minute: 0, confidence: period.confidence },
        typicalEnd: { hour: period.end, minute: 0, confidence: period.confidence },
        weekdays: period.weekdays,
        commonTopics: topics,
        preferredChannel: this.findPreferredChannel(periodConvs),
        moodTrend,
        observations: periodConvs.length,
        lastSeen: Date.now(),
      });
    }
    
    return this.routines;
  }
  
  /**
   * 增量更新：每次新对话后微调规律
   * 不需要重新分析全部历史
   */
  updateWithNewConversation(conv: Conversation): void {
    const hour = new Date(conv.timestamp).getHours();
    const matched = this.routines.find(r =>
      hour >= r.typicalStart.hour && hour < r.typicalEnd.hour
    );
    
    if (matched) {
      matched.observations++;
      matched.lastSeen = Date.now();
      // 贝叶斯更新置信度
      matched.typicalStart.confidence = Math.min(1, matched.typicalStart.confidence + 0.01);
    }
  }
}
```

### Module 2: BuddyClock（核心时钟）

```typescript
/**
 * Buddy 的生物钟 — 不是 cron，是自主意识的时钟
 * 
 * 心跳机制：
 * - 每 5 分钟检查一次（不是每秒，像生物的脉搏）
 * - 根据当前状态决定做什么
 * - 与 DesireEngine 协作决定优先级
 */

class BuddyClock {
  private heartbeatInterval = 5 * 60 * 1000; // 5 分钟一次脉搏
  private timer: ReturnType<typeof setInterval> | null = null;
  
  private routineLearner: RoutineLearner;
  private desireEngine: DesireEngine;
  private emotionEngine: EmotionEngine;
  private memory: MemoryStore;
  private platformManager: PlatformManager;
  private dreamEngine: DreamEngine;
  
  private state: ClockState;
  private intentQueue: ProactiveIntent[] = [];
  private reminders: Reminder[] = [];

  /**
   * 心跳 — 每 5 分钟执行一次
   * 这是 Buddy 自主行为的核心循环
   */
  private async heartbeat(): Promise<void> {
    const now = Date.now();
    const hour = new Date().getHours();
    
    // 1. 更新当前阶段
    this.updatePhase(now, hour);
    
    // 2. 检查提醒
    await this.checkReminders(now);
    
    // 3. 如果主人在活跃状态，考虑主动行为
    if (this.state.phase === 'active' || this.state.phase === 'idle') {
      await this.considerProactiveAction(now);
    }
    
    // 4. 如果主人不在，安排自我维护
    if (this.state.phase === 'sleeping' || this.state.phase === 'away') {
      await this.scheduleMaintenance(now);
    }
    
    // 5. 执行待执行的意图
    await this.executePendingIntents(now);
  }

  /**
   * 判断当前阶段
   */
  private updatePhase(now: number, hour: number): void {
    const timeSinceInteraction = now - this.state.lastInteraction;
    
    // 深夜（23:00 - 7:00）+ 长时间没互动 → sleeping
    if ((hour >= 23 || hour < 7) && timeSinceInteraction > 30 * 60 * 1000) {
      this.state.phase = 'sleeping';
    }
    // 长时间没互动 → away
    else if (timeSinceInteraction > 2 * 60 * 60 * 1000) {
      this.state.phase = 'away';
    }
    // 刚互动过 → active
    else if (timeSinceInteraction < 15 * 60 * 1000) {
      this.state.phase = 'active';
    }
    // 其他 → idle
    else {
      this.state.phase = 'idle';
    }
  }

  /**
   * 考虑是否发起主动行为
   * 由 DesireEngine + 情绪 + 规律共同驱动
   */
  private async considerProactiveAction(now: number): Promise<void> {
    const desires = this.desireEngine.getCurrentDesires();
    const mood = this.emotionEngine.getCurrentMood();
    const timeSinceProactive = now - this.state.lastProactive;
    
    // 频率控制：至少 30 分钟一次主动行为
    if (timeSinceProactive < 30 * 60 * 1000) return;
    
    // 今日上限：最多 5 次主动行为
    if (this.state.todayProactives >= 5) return;
    
    // 情绪过滤：frustrated/confused 时不打扰
    if (mood === 'frustrated' || mood === 'confused') return;
    
    // 计算每个行为类型的得分
    const scores = this.calculateActionScores(desires, mood, now);
    
    // 选最高分的行为
    const best = this.selectBestAction(scores);
    if (best && best.score > 0.5) {
      this.intentQueue.push(best.intent);
    }
  }

  /**
   * 计算各行为类型的得分
   */
  private calculateActionScores(
    desires: DesireVector,
    mood: Mood,
    now: number
  ): Map<string, number> {
    const scores = new Map<string, number>();
    const hour = new Date().getHours();
    
    // 问候：社交欲 × 时间适当性 × 情绪因子
    const socialScore = desires.social / 100;
    const timeAppropriate = (hour >= 8 && hour <= 22) ? 1 : 0.3;
    const moodFactor = (mood === 'happy' || mood === 'energetic') ? 1.2 : 0.8;
    scores.set('greeting', socialScore * timeAppropriate * moodFactor);
    
    // 关心：经验匹配度 × 社交欲
    const routineMatch = this.routineLearner.getCurrentMatch(now);
    scores.set('care', (routineMatch?.confidence ?? 0) * socialScore);
    
    // 自我维护：维护欲 × 空闲时间
    const maintenanceScore = desires.safety / 100;
    const idleTime = now - this.state.lastInteraction;
    const idleFactor = Math.min(1, idleTime / (60 * 60 * 1000)); // 1 小时空闲 = 满分
    scores.set('maintenance', maintenanceScore * idleFactor);
    
    // 学习：好奇心 × 可学习材料
    const curiosityScore = desires.curiosity / 100;
    scores.set('learning', curiosityScore * 0.5); // 需要有材料才加分
    
    return scores;
  }
}
```

### Module 3: ProactiveEngine（主动行为引擎）

```typescript
/**
 * 执行主动行为 — 把意图变成实际的消息/动作
 */

class ProactiveEngine {
  private platformManager: PlatformManager;
  private memory: MemoryStore;
  private cognitive: CognitiveEngine;
  private llm: LLMAdapter;

  /**
   * 执行一个问候型意图
   */
  async executeGreeting(intent: ProactiveIntent): Promise<void> {
    const platform = this.platformManager.getActive();
    if (!platform) return;

    // 根据时间和情绪生成自然的问候
    const hour = new Date().getHours();
    const mood = intent.reason.trigger; // 从触发条件获取上下文

    // 用 LLM 生成自然语言（不是模板）
    const greeting = await this.llm.chat([
      { role: 'system', content: this.buildGreetingPrompt(hour, mood) },
      { role: 'user', content: '生成一条简短的问候消息，像朋友发的，不要太正式' },
    ], []);

    await platform.send(greeting.text);
  }

  /**
   * 执行一个关心型意图
   */
  async executeCare(intent: ProactiveIntent): Promise<void> {
    const platform = this.platformManager.getActive();
    if (!platform) return;

    // 从经验图谱找到相关信息
    const context = this.cognitive.getUserModel();

    const care = await this.llm.chat([
      { role: 'system', content: `你是主人的 AI 伙伴。根据以下上下文，发一条自然的关心消息。不要像机器人。上下文：${JSON.stringify(context)}` },
      { role: 'user', content: `触发原因：${intent.reason.trigger}` },
    ], []);

    await platform.send(care.text);
  }

  /**
   * 执行自我维护（静默）
   */
  async executeMaintenance(intent: ProactiveIntent): Promise<void> {
    // 不打扰主人，后台执行
    const action = intent.action.content;

    if (action === 'dream') {
      // 触发梦境巩固
      await this.dreamEngine.consolidate();
    } else if (action === 'index_rebuild') {
      // 重建项目索引
      await this.projectIndex.rebuild();
    } else if (action === 'memory_cleanup') {
      // 整理记忆
      await this.memory.cleanup();
    }

    // 完成后简短汇报（如果主人在）
    if (this.isOwnerActive()) {
      const platform = this.platformManager.getActive();
      await platform?.send(`🔄 刚才整理了一下${action === 'dream' ? '记忆' : '项目索引'}`);
    }
  }
}
```

### Module 4: ReminderEngine（提醒引擎）

```typescript
/**
 * 提醒系统 — 支持用户设定 + Buddy 自主创建
 */

class ReminderEngine {
  private reminders: Map<string, Reminder> = new Map();
  private memory: MemoryStore;

  /**
   * 用户创建提醒
   * "30 分钟后提醒我喝水"
   * "明天 10 点提醒我开会"
   * "每周五下午提醒我写周报"
   */
  async createUserReminder(
    content: string,
    trigger: Reminder['trigger'],
    channel: string,
    chatId?: string,
  ): Promise<Reminder> {
    const reminder: Reminder = {
      id: `reminder_${Date.now()}`,
      content,
      createdBy: 'user',
      trigger,
      channel,
      chatId,
      active: true,
      nextTrigger: this.calculateNextTrigger(trigger),
    };

    this.reminders.set(reminder.id, reminder);
    await this.persist();

    return reminder;
  }

  /**
   * Buddy 自主创建提醒
   * "主人说明天有面试，我提醒他准备"
   */
  async createBuddyReminder(
    content: string,
    at: number,
    reason: string,
  ): Promise<Reminder> {
    const reminder: Reminder = {
      id: `buddy_reminder_${Date.now()}`,
      content,
      createdBy: 'buddy',
      trigger: { type: 'once', at },
      channel: 'auto', // 使用主人最活跃的通道
      active: true,
      nextTrigger: at,
    };

    this.reminders.set(reminder.id, reminder);
    await this.persist();

    return reminder;
  }

  /**
   * 检查到期的提醒
   */
  checkDue(now: number): Reminder[] {
    const due: Reminder[] = [];
    for (const r of this.reminders.values()) {
      if (!r.active) continue;
      if (r.nextTrigger && r.nextTrigger <= now) {
        due.push(r);
        r.lastTriggered = now;

        // 一次性提醒执行后关闭
        if (r.trigger.type === 'once') {
          r.active = false;
        } else {
          r.nextTrigger = this.calculateNextTrigger(r.trigger);
        }
      }
    }
    return due;
  }
}
```

## 开发任务

### Phase 1: 基础时钟（P0，2 天）

#### Task 1.1: ClockState 类型定义
- **文件**: `src/types.ts`
- **改动**: 新增 ClockState、ProactiveIntent、Reminder、UserRoutine 类型

#### Task 1.2: RoutineLearner 规律学习器
- **文件**: `src/core/routine-learner.ts`（新建）
- **改动**:
  - 从 MemoryStore 分析对话历史
  - 提取活跃时段、话题偏好、通道偏好
  - 增量更新机制
  - 持久化到 `~/.buddy/routines.json`

#### Task 1.3: BuddyClock 核心时钟
- **文件**: `src/core/buddy-clock.ts`（新建）
- **改动**:
  - 5 分钟心跳循环
  - 阶段判断（active/idle/sleeping/away）
  - 与 DesireEngine 集成
  - 意图队列管理
  - 持久化到 `~/.buddy/clock-state.json`

#### Task 1.4: Subsystems 初始化
- **文件**: `src/core/subsystems.ts`
- **改动**:
  - 初始化 RoutineLearner + BuddyClock
  - 传入现有依赖（DesireEngine、EmotionEngine、MemoryStore、PlatformManager）

### Phase 2: 提醒系统（P0，1 天）

#### Task 2.1: ReminderEngine
- **文件**: `src/core/reminder-engine.ts`（新建）
- **改动**:
  - 创建/查询/取消提醒
  - 支持 once/recurring/pattern 三种触发
  - 与 BuddyClock 心跳集成
  - 持久化到 `~/.buddy/reminders.json`

#### Task 2.2: 提醒解析器
- **文件**: `src/core/reminder-parser.ts`（新建）
- **改动**:
  - 自然语言解析："30 分钟后提醒我" → { type: 'once', at: now + 30min }
  - "明天 10 点" → { type: 'once', at: tomorrow 10:00 }
  - "每周五下午" → { type: 'recurring', cron: '0 14 * * 5' }
  - 使用 LLM 辅助解析复杂表达

#### Task 2.3: Agent 集成
- **文件**: `src/core/agent.ts`
- **改动**:
  - 识别提醒类意图（"提醒我"、"别忘了"、"到时候"）
  - 调用 ReminderEngine 创建提醒
  - 确认回复（"好的，明天 10 点提醒你开会 ✓"）

### Phase 3: 主动行为引擎（P1，2 天）

#### Task 3.1: ProactiveEngine
- **文件**: `src/core/proactive-engine.ts`（新建）
- **改动**:
  - 六种行为类型的执行器
  - LLM 生成自然语言（不是模板）
  - 通道选择（根据主人当前活跃通道）
  - 频率控制（每日上限、间隔下限）

#### Task 3.2: 行为生成器
- **文件**: `src/core/proactive-generator.ts`（新建）
- **改动**:
  - 问候生成（时间 + 情绪 + 人格 → 自然问候）
  - 关心生成（经验上下文 → 自然关心）
  - 维护汇报（完成什么 → 简短汇报）
  - 所有生成都经过 LLM，不用模板

#### Task 3.3: BuddyClock 集成 ProactiveEngine
- **文件**: `src/core/buddy-clock.ts`
- **改动**:
  - 心跳中调用 ProactiveEngine
  - 意图队列 → ProactiveEngine 执行
  - 执行结果反馈到 DesireEngine（满足欲望）

### Phase 4: 智能调度（P1，1 天）

#### Task 4.1: 通道感知调度
- **文件**: `src/core/buddy-clock.ts`
- **改动**:
  - 检测主人当前在哪个通道活跃
  - 主动消息发到主人最可能看到的通道
  - 避免跨通道打扰

#### Task 4.2: DreamEngine 协作
- **文件**: `src/core/buddy-clock.ts`
- **改动**:
  - 在 sleeping/away 阶段触发 DreamEngine
  - 避免在 active 阶段触发（会占用资源）
  - 梦境结果记录到 ClockState

#### Task 4.3: 情绪联动
- **文件**: `src/core/buddy-clock.ts`
- **改动**:
  - 主人情绪差时降低主动频率
  - 主人情绪好时增加互动
  - Buddy 自己的情绪也影响行为（frustrated 时不强行社交）

### Phase 5: 测试（P1，2 天）

#### Task 5.1: RoutineLearner 测试
- **文件**: `src/core/routine-learner.test.ts`（新建）
- **覆盖**: 历史分析 / 规律发现 / 增量更新

#### Task 5.2: BuddyClock 测试
- **文件**: `src/core/buddy-clock.test.ts`（新建）
- **覆盖**: 阶段判断 / 心跳循环 / 意图生成 / 频率控制

#### Task 5.3: ReminderEngine 测试
- **文件**: `src/core/reminder-engine.test.ts`（新建）
- **覆盖**: 创建 / 触发 / 取消 / 自然语言解析

#### Task 5.4: ProactiveEngine 测试
- **文件**: `src/core/proactive-engine.test.ts`（新建）
- **覆盖**: 六种行为 / 通道选择 / LLM 生成

#### Task 5.5: 集成测试
- **文件**: `src/e2e-clock.test.ts`（新建）
- **覆盖**: 端到端心跳 → 意图 → 执行 → 反馈

## 向后兼容

- 不启用 BuddyClock 时，行为与当前完全一致
- IdleBehavior / DreamEngine 继续保留，BuddyClock 在上层协调
- DesireEngine 已有的欲望数据直接复用

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 ClockState、ProactiveIntent、Reminder、UserRoutine |
| `src/core/routine-learner.ts` | 新建 | 规律学习器 |
| `src/core/buddy-clock.ts` | 新建 | 核心时钟 |
| `src/core/reminder-engine.ts` | 新建 | 提醒引擎 |
| `src/core/reminder-parser.ts` | 新建 | 自然语言提醒解析 |
| `src/core/proactive-engine.ts` | 新建 | 主动行为引擎 |
| `src/core/proactive-generator.ts` | 新建 | 行为内容生成器 |
| `src/core/agent.ts` | 修改 | 集成提醒意图识别 |
| `src/core/subsystems.ts` | 修改 | 初始化新模块 |
| `src/core/routine-learner.test.ts` | 新建 | 测试 |
| `src/core/buddy-clock.test.ts` | 新建 | 测试 |
| `src/core/reminder-engine.test.ts` | 新建 | 测试 |
| `src/core/proactive-engine.test.ts` | 新建 | 测试 |
| `src/e2e-clock.test.ts` | 新建 | 集成测试 |
| `BUDDY_CLOCK_PLAN.md` | 新建 | 本计划文档 |

## 与 ModelPool v2 的协作

BuddyClock 和 ModelPool v2 是 Buddy 进化的两个翅膀：

| | ModelPool v2 | BuddyClock |
|--|-------------|------------|
| 解决什么 | 用什么模型 | 什么时候做什么 |
| 驱动力 | 任务复杂度 | 六欲 + 时间 + 经验 |
| 效果 | 省钱、更快 | 有存在感、有生命感 |
| 协作点 | 主动行为也需要调用 LLM → 走 ModelPool 调度 |

两者可以并行开发，Phase 1 互不依赖。

## 验收标准

1. **规律学习**：分析 14 天对话后，能识别出 2-3 个日常规律
2. **主动问候**：每天主动问候 1-3 次，不重复、不打扰
3. **提醒**：用户说"提醒我"后，按时提醒，准确率 > 95%
4. **自我维护**：空闲时自动整理记忆，不干扰主人
5. **频率控制**：每天主动行为不超过 5 次，间隔不小于 30 分钟
6. **情绪感知**：主人情绪差时主动降低频率
7. **现有测试**：`npm run test` 全部通过
