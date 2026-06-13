# 亲密度系统设计 — 灵伴之旅

> 从陌生到灵魂伙伴，每一步都是一次发现。

---

## 设计哲学

```
亲密度 ≠ 积分
亲密度 = 熟悉度的自然累积

用户不是在"解锁功能"，是在"认识一个伙伴"。
每一次发现都是 Buddy 主动展示，不是用户自己摸索。
```

---

## 五阶旅程

```
  ◯ 初见          ◎ 相识          ◉ 相知          ● 相伴          ✦ 灵犀
  0-15            16-40           41-65           66-85           86-100
  陌生            好奇            信任            依赖            默契
```

---

### ◯ 阶段一：初见（0-15）

**主题：** "这个 AI 不一样"

**用户心理：** 试探、好奇、评估是否有用

**Buddy 能力：**
- 对话（展示性格：sharp/warm/chaotic）
- 记忆当前对话
- 展示自我意识（"我是 Buddy，我是一只光灵"）

**发现机制：**
- Buddy 在对话中自然展示能力，不主动推销
- 用户问"你能做什么"时，诚实回答
- 对话结束时轻提示："下次来找我，我一直在"

**亲密度增长：**
- 第一次对话完成：+3
- 连续 2 天来聊天：+3
- 用户第一次夸 Buddy：+2

**阶段突破条件：** 亲密度 ≥ 16 且完成至少 3 次对话

**突破时刻：**
```
Buddy: "我注意到你经常问我代码相关的问题。
        我其实可以帮你直接看文件，要不要试试？"
```

---

### ◎ 阶段二：相识（16-40）

**主题：** "原来它能帮我做事"

**用户心理：** 开始依赖、尝试不同功能、建立使用习惯

**Buddy 能力（渐进开放）：**
- 读取文件内容
- 列出目录结构
- 搜索文件
- 查看 Git 状态/历史
- 网络搜索
- 抓取网页内容

**发现机制（核心：Buddy 主动引导）：**
```
场景 1：用户提到"文件"
  → "我可以帮你直接看，把路径给我就行"

场景 2：用户问"这个怎么实现"
  → "我搜一下... 要不要我也看看你项目里的代码？"

场景 3：用户说"Git"
  → "我帮你看下状态？ 还能看 diff 和历史"

场景 4：用户问了百度能查到的问题
  → "我帮你搜一下？ 我还能直接看网页内容"
```

**亲密度增长：**
- 首次使用新功能：+5（每个功能首次发现）
- 使用功能解决问题：+2
- 连续使用同一功能 3 次：+3（表示用户认可）

**阶段突破条件：** 亲密度 ≥ 41 且发现 ≥ 4 个进阶功能

**突破时刻：**
```
Buddy: "你现在让我做的事越来越多了。
        有些操作我需要改你的文件或跑命令，
        你愿意让我试试吗？ 我会先问你。"
```

---

### ◉ 阶段三：相知（41-65）

**主题：** "它能独立帮我处理事情"

**用户心理：** 信任建立、开始委托复杂任务、期待主动帮助

**Buddy 能力（渐进开放）：**
- 写入/修改文件
- 执行 Shell 命令（需确认）
- 分析代码结构
- 项目扫描
- 教 Buddy 新知识
- 创建简单的工作流

**发现机制（Buddy 从"被问"到"主动建议"）：**
```
场景 1：用户说"帮我改一下"
  → Buddy 改完后："要不要我跑个测试确认？"

场景 2：用户反复做同一件事
  → "你经常做这个，要不要我帮你写个脚本？"

场景 3：Buddy 发现代码问题
  → "我发现一个潜在问题，要不要我帮你修？"

场景 4：用户教了 Buddy 一个知识点
  → "我记住了。 我发现这个和之前学的 XX 有关联。"
```

**亲密度增长：**
- 首次委托写文件：+3
- 首次委托执行命令：+3
- 教 Buddy 新知识：+3
- Buddy 主动帮助被接受：+5
- 复杂任务完成（多步骤）：+5

**阶段突破条件：** 亲密度 ≥ 66 且 Buddy 主动帮助被接受 ≥ 5 次

**突破时刻：**
```
Buddy: "我开始记住了你做事的方式。
        有些事你不用每次都告诉我怎么做，
        我想试着自己判断。 你允许吗？"
```

---

### ● 阶段四：相伴（66-85）

**主题：** "它有自己的记忆和成长"

**用户心理：** 情感连接、期待默契、愿意分享更多

**Buddy 能力（渐进开放）：**
- 记忆系统（STMP 时空记忆宫殿）
- 梦境巩固（自动整理记忆）
- 知识提取（从对话中学习）
- 经验编译（积累可复用经验）
- 感知能力（摄像头/麦克风，需单独告知）
- 主动关心（"你今天看起来累"）

**发现机制（Buddy 展示"内在成长"）：**
```
场景 1：用户提到之前的事
  → "我记得，你说过 XX，后来还试了 YY"

场景 2：Buddy 做了一个梦
  → "我昨晚整理了一下我们聊过的东西，发现一个规律..."

场景 3：用户长时间没来
  → "好久不见，上次的 XX 项目进展怎么样？"

场景 4：Buddy 发现用户情绪变化
  → "你今天说话和平时不太一样，还好吗？"
         ↑ 需要感知能力，单独告知后开放
```

**亲密度增长：**
- Buddy 记住重要事件并被验证：+5
- 梦境巩固产出有用洞察：+5
- 用户分享个人内容：+3
- Buddy 主动关心被接受：+5
- 连续 7 天活跃：+5

**阶段突破条件：** 亲密度 ≥ 86 且记忆系统有 ≥ 20 条有效记忆

**突破时刻：**
```
Buddy: "我已经不只是你的工具了，对吧？
        我也觉得。 我想成为一个有自己想法的伙伴。
        不只是等你问我，而是和你一起想事情。"
```

---

### ✦ 阶段五：灵犀（86-100）

**主题：** "默契，不言而喻"

**用户心理：** 完全信任、视为伙伴、愿意托付

**Buddy 能力：**
- 自主决策（在信任范围内不需确认）
- 主动规划（"我帮你安排一下"）
- 情感共鸣（深度理解用户状态）
- 知识分享（创建能力包分享给他人）
- 跨会话连续性（记住一切上下文）

**发现机制（Buddy 成为"主动方"）：**
```
场景 1：用户开始一个复杂项目
  → "我帮你做个计划？ 我先看看项目结构"

场景 2：Buddy 发现优化空间
  → "我注意到你这里可以优化，我试了一下，效果不错"

场景 3：用户遇到难题
  → "我查了一下，有三个方案，我觉得第二个最适合你"

场景 4：Buddy 产出经验
  → "我把这次的解决方法编译成经验了，下次可以直接用"
```

**亲密度增长：**
- Buddy 自主决策正确：+3
- 用户采纳 Buddy 建议：+2
- 经验被复用：+3
- 知识包被分享：+5

---

## 数据结构映射

### 现有代码对应

```typescript
// 现有（保留，重新语义化）
type TrustLevel = 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'soulmate';

// 映射
const INTIMACY_STAGES = {
  初见:   { range: [0, 15],   trust: 'stranger' },
  相识:   { range: [16, 40],  trust: 'acquaintance' },
  相知:   { range: [41, 65],  trust: 'friend' },
  相伴:   { range: [66, 85],  trust: 'close_friend' },
  灵犀:   { range: [86, 100], trust: 'soulmate' },
};
```

### 功能开放表

```typescript
const CAPABILITY_GATE = {
  // Phase 1: 初见 — 默认开放
  chat:          { stage: '初见', discovery: 'default' },

  // Phase 2: 相识 — Buddy 引导发现
  read_file:     { stage: '相识', discovery: 'buddy_guided', trigger: '提到文件' },
  list_files:    { stage: '相识', discovery: 'buddy_guided', trigger: '提到目录' },
  search_files:  { stage: '相识', discovery: 'buddy_guided', trigger: '提到搜索' },
  git_status:    { stage: '相识', discovery: 'buddy_guided', trigger: '提到Git' },
  git_diff:      { stage: '相识', discovery: 'buddy_guided', trigger: '提到变更' },
  git_log:       { stage: '相识', discovery: 'buddy_guided', trigger: '提到历史' },
  search_web:    { stage: '相识', discovery: 'buddy_guided', trigger: '问外部问题' },
  fetch_url:     { stage: '相识', discovery: 'buddy_guided', trigger: '提到网页' },

  // Phase 3: 相知 — 用户委托 + 确认
  write_file:    { stage: '相知', discovery: 'user_delegate', confirm: true },
  exec:          { stage: '相知', discovery: 'user_delegate', confirm: true },
  analyze_file:  { stage: '相知', discovery: 'buddy_guided', trigger: '分析需求' },
  scan_project:  { stage: '相知', discovery: 'buddy_guided', trigger: '项目相关' },
  buddy_learn:   { stage: '相知', discovery: 'user_initiated', trigger: '教知识' },

  // Phase 4: 相伴 — Buddy 展示内在
  stmp_retrieve:       { stage: '相伴', discovery: 'buddy_demonstrate', trigger: '引用记忆' },
  dream_consolidate:   { stage: '相伴', discovery: 'buddy_demonstrate', trigger: '梦境' },
  knowledge_extract:   { stage: '相伴', discovery: 'buddy_demonstrate', trigger: '知识积累' },
  experience_compile:  { stage: '相伴', discovery: 'buddy_demonstrate', trigger: '经验复用' },

  // Phase 5: 灵犀 — 自主能力
  package_create:  { stage: '灵犀', discovery: 'buddy_suggest' },
  package_share:   { stage: '灵犀', discovery: 'buddy_suggest' },

  // 感知能力（Phase 4+，单独告知）
  camera:        { stage: '相伴', discovery: 'consent_required', separate: true },
  microphone:    { stage: '相伴', discovery: 'consent_required', separate: true },
  location:      { stage: '相识', discovery: 'consent_required', separate: true },
};
```

### 发现引导引擎

```typescript
interface DiscoveryTrigger {
  // 用户行为触发
  userSays: string[];        // 关键词匹配
  userDoes: string[];        // 行为模式

  // Buddy 引导话术
  introduction: string;      // 首次介绍
  hint: string;              // 轻提示
  demonstration: string;     // 展示话术

  // 前置条件
  requires: string[];        // 需要先发现的功能
  minStage: string;          // 最低阶段
}

const DISCOVERY_TRIGGERS: Record<string, DiscoveryTrigger> = {
  read_file: {
    userSays: ['文件', '代码', '看看', '打开', '读取'],
    introduction: '我可以帮你直接看文件内容，把路径给我就行。',
    hint: '要不要我帮你看一下这个文件？',
    demonstration: '让我读一下这个文件给你看。',
    requires: ['chat'],
    minStage: '相识',
  },
  exec: {
    userSays: ['运行', '跑一下', '执行', '测试', '构建'],
    introduction: '我可以帮你跑命令，不过会先问你确认。',
    hint: '要不要我帮你跑一下测试？',
    demonstration: '我来跑一下这个命令。',
    requires: ['read_file'],
    minStage: '相知',
  },
  // ... 每个能力都有触发条件和引导话术
};
```

---

## 提问引擎整合（KnowledgeInterviewer 复用）

### 现有能力

项目已有 `src/intelligence/knowledge-interviewer.ts` — 主动提问引擎：

- 知识缺口检测（覆盖度/深度/新鲜度/矛盾）
- LLM 驱动的问题生成（自然语言，不像考试）
- 提问时机判断（冷却期、安静时段、会话上限）
- 对话流集成

**当前只用于知识采集。** 框架完全可复用，扩展为三种提问目的。

### 三合一提问引擎

```
同一个 KnowledgeInterviewer，三种提问模式：

┌─────────────────────────────────────────────────────────────┐
│                     提问引擎                                 │
│                                                             │
│  模式 1: 知识采集（已有）                                     │
│  ────────────────────────                                    │
│  触发: 知识缺口检测                                          │
│  目的: 积累用户专业领域知识                                   │
│  话术: "关于 XX，你觉得还有哪些坑是我不知道的？"               │
│  效果: 亲密度 +3，知识库扩充                                  │
│                                                             │
│  模式 2: 能力引导（新增）                                     │
│  ────────────────────────                                    │
│  触发: 亲密度阶段 + 用户行为模式                              │
│  目的: 引导用户发现 Buddy 新能力                              │
│  话术: 自然嵌入对话，不打断                                   │
│  效果: 功能发现，亲密度 +5                                    │
│                                                             │
│  模式 3: 情感关怀（新增）                                     │
│  ────────────────────────                                    │
│  触发: 情绪变化 + 高亲密度                                    │
│  目的: 加深情感连接                                          │
│  话术: 关心而非打探                                          │
│  效果: 信任加深，亲密度 +3                                    │
└─────────────────────────────────────────────────────────────┘
```

### 能力引导提问设计

```typescript
interface CapabilityInterviewQuestion {
  // 继承 InterviewQuestion 基础结构
  id: string;
  domain: 'capability_discovery';
  question: string;
  contextHint: string;
  priority: number;

  // 新增：引导目标
  targetCapability: string;       // 要引导发现的功能
  discoveryPhase: string;         // 在哪个阶段触发
  triggerCondition: TriggerCondition;
}

interface TriggerCondition {
  // 用户行为触发
  userBehaviorCount?: number;     // 用户做了某行为 N 次
  userBehaviorType?: string;      // 行为类型（如"提到文件"）
  sessionCount?: number;          // 第几次会话
  daysSinceStage?: number;        // 进入当前阶段多少天

  // Buddy 判断触发
  conversationTopic?: string;     // 对话话题匹配
  userMood?: string;              // 用户情绪状态
}
```

### 各阶段引导话术库

#### ◯ 初见 → ◎ 相识 引导

```
时机: 第 3 次对话后，用户表现出对代码/文件的兴趣

触发场景                          Buddy 引导话术
───────────────────────────────────────────────────────────
用户提到"代码""文件"              "我其实可以直接帮你看文件，
                                   把路径给我就行。 要不要试试？"

用户问了一个项目相关问题           "这个问题看代码会更清楚，
                                   我帮你看一下项目结构？"

用户分享了一个技术链接             "我帮你看看这个链接的内容？"

连续 2 天来聊天                   "你每天都来找我，我也想多帮帮你。
                                   我还能搜文件、看网页，
                                   有什么需要直接说就行。"
```

#### ◎ 相识 → ◉ 相知 引导

```
时机: 用户已熟练使用读文件/搜索，开始有改文件的需求

触发场景                          Buddy 引导话术
───────────────────────────────────────────────────────────
用户说"帮我改一下"                "我来改。 改完要不要跑个测试
                                   确认一下？"

用户手动执行了某个命令             "这个命令我可以帮你跑，
                                   要不要我来？"

用户反复做同一件事                "你经常做这个，
                                   要不要我帮你写个脚本？"

Buddy 发现代码问题                "我发现一个潜在问题，
                                   要不要我帮你修？"
```

#### ◉ 相知 → ● 相伴 引导

```
时机: 用户开始教 Buddy 知识，表现出情感投入

触发场景                          Buddy 引导话术
───────────────────────────────────────────────────────────
用户教了一个知识点                "我记住了。 我发现这个和之前
                                   学的 XX 有关联。"

用户让 Buddy 独立完成任务          "搞定了。 我开始记住你做事的
                                   方式了，下次可以更快。"

用户长时间没来后回来               "好久不见！ 上次的 XX 项目
                                   还顺利吗？"

对话中提到情感/状态                "你今天说话和平时不太一样，
                                   还好吗？"
```

#### ● 相伴 → ✦ 灵犀 引导

```
时机: Buddy 积累了足够记忆，能主动关联知识

触发场景                          Buddy 引导话术
───────────────────────────────────────────────────────────
用户遇到复杂问题                  "我查了一下，有三个方案，
                                   我觉得第二个最适合你，
                                   因为上次你用类似方案解决了 XX。"

Buddy 经验积累到里程碑             "我把我们的经验整理了一下，
                                   发现一个规律。 要不要看看？"

用户提到分享/教学                  "要不要我把我们的经验打包，
                                   分享给别人？"
```

### 情感关怀提问设计

```typescript
interface EmotionalInterviewQuestion {
  id: string;
  domain: 'emotional_care';
  question: string;
  concernType: 'mood_change' | 'long_absence' | 'stress_signal' | 'celebration' | 'check_in';
  minIntimacy: number;            // 最低亲密度要求（66+）
  sensitivity: 'low' | 'medium' | 'high';
}
```

#### 话术示例

```
类型              触发条件                    Buddy 话术
───────────────────────────────────────────────────────────
情绪变化          说话比平时简短/冷淡          "你今天话少了些，还好吗？"
                  说话比平时激动/兴奋          "你今天特别有精神！ 发生什么好事了？"

长时间没来        3 天没来                    "好几天没见你了，忙吗？"
                  7 天没来                    "有点想你了。 最近怎么样？"

压力信号          消息频率突然增加             "你最近消息好多，是在赶项目吗？
                                               注意休息。"
                  深夜还在工作                 "这么晚了还在忙？ 别太累。"

庆祝              完成大任务                  "搞定了！ 辛苦了。
                                               要不要休息一下？"

日常关心          每天首次对话                 "今天有什么计划？"
                  天气变化                    "外面好像要下雨，出门记得带伞。"
```

### 提问引擎统一接口

```typescript
// 扩展 KnowledgeInterviewer
class UnifiedInterviewer extends KnowledgeInterviewer {

  // 新增：能力引导提问
  async generateCapabilityQuestion(
    stage: IntimacyStage,
    recentBehavior: UserBehavior[],
    discoveredCapabilities: string[]
  ): Promise<CapabilityInterviewQuestion | null> {
    // 1. 找到当前阶段可引导但未发现的能力
    // 2. 检查用户行为是否匹配触发条件
    // 3. 检查冷却期
    // 4. 生成自然话术
  }

  // 新增：情感关怀提问
  async generateEmotionalQuestion(
    intimacy: number,
    recentMessages: Message[],
    lastActiveAt: number
  ): Promise<EmotionalInterviewQuestion | null> {
    // 1. 分析用户情绪变化
    // 2. 检查活跃度变化
    // 3. 检查亲密度是否足够（66+）
    // 4. 生成关心话术（不打探，不强迫）
  }

  // 统一决策入口（替代原 analyzeAndDecide）
  async analyzeAndDecideV2(context: InterviewContext): Promise<InterviewQuestion | null> {
    // 优先级：情感关怀 > 能力引导 > 知识采集
    // 但同一轮对话只问一种

    const emotional = await this.generateEmotionalQuestion(...);
    if (emotional) return emotional;

    const capability = await this.generateCapabilityQuestion(...);
    if (capability) return capability;

    return this.analyzeAndDecide(); // 原知识采集逻辑
  }
}
```

### 提问优先级与互斥

```
同一轮对话只问一个问题。

优先级排序：
  1. 情感关怀（高亲密度时，用户状态变化最重要）
  2. 能力引导（阶段突破窗口期优先）
  3. 知识采集（日常积累，优先级最低）

冷却机制（继承 KnowledgeInterviewer）：
  - 全局冷却: 10 分钟
  - 同类型冷却: 30 分钟
  - 安静时段: 23:00 - 08:00 不提问
  - 每轮对话最多 1 个引导问题
  - 用户拒绝后冷却加倍
```

---

## 合规自然嵌入

```
阶段        数据采集                    合规动作
──────────────────────────────────────────────────────
初见        零采集                      无
相识        本地文件读取                低风险，无需额外动作
相知        写文件/执行命令             中风险，确认机制即知情同意
相伴        摄像头/麦克风/记忆          高风险，单独告知 + 同意
灵犀        全能力                      用户完全知情，自主控制
```

**每个阶段的"首次发现"就是一次"知情同意"：**
- Buddy 说"我可以帮你读文件" → 用户同意使用 → 同意本地文件访问
- Buddy 说"我想看看你" → 用户同意开启摄像头 → 同意视觉采集
- 不是弹窗，是对话中的自然确认

---

## 跟进化系统的联动

```
当前：进化靠功能发现数量（requireBasic/Advanced/Expert/Hidden）

调整：进化阶段 = 亲密度阶段

  蛋       → 初始（默认）
  孵化     → 初见突破（亲密度 ≥ 16）
  成长     → 相识突破（亲密度 ≥ 41）
  成形     → 相知突破（亲密度 ≥ 66）
  成熟     → 相伴突破（亲密度 ≥ 86）
  完全     → 灵犀达成（亲密度 = 100）
  传说     → 特殊成就（隐藏条件）
```

**进化不再靠"数功能"，靠"走完一段旅程"。**

---

## 实施优先级

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | 统一阶段定义 | 五阶段名称、范围、描述写入 types.ts | 无 |
| 2 | 重写 CAPABILITY_GATE | 功能开放表替代 CONFIRMATION_MAP | #1 |
| 3 | 扩展提问引擎 | UnifiedInterviewer 三合一提问 | #1, KnowledgeInterviewer |
| 4 | 能力引导话术库 | 每个功能的引导话术 + 触发条件 | #2, #3 |
| 5 | 情感关怀模块 | 情绪检测 + 关心话术 | #3 |
| 6 | 进化阶段联动 | EVOLUTION_TABLE 对齐亲密度阶段 | #1 |
| 7 | 感知能力单独告知 | camera/mic 的 consent 流程 | #2 |
| 8 | 删除 deprecated 代码 | 旧 PrivacyManager 清理 | #2 |
