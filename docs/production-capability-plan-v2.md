# Buddy 生产能力提升 — 执行计划 V2

> 目标：让 Buddy 具备"接到任务先确定工作环境，再规划执行"的生产能力
> 起因：游戏立项测试暴露的三层问题 — 环境感知缺失、资源画像粗糙、执行链路无闭环
> 原则：最小侵入、复用现有机制、渐进式改造
> V2 更新：环境感知从"纯开发"升级为"通用任务"，按任务类型动态探测

---

## 一、问题根因回顾（不变）

### 1.1 测试中暴露的问题链

```
"我想做一款游戏"
  → LLM 不知道 cwd 是哪里 → 相对路径写到 /tmp/buddy-sandbox/
  → 工具调用返回乱码 → LLM 产出 JSON 碎片
  → 经验路由选了 OCR 模型做游戏方案 → 能力不匹配
  → 工具返回"成功"但文件不存在 → 无闭环验证
  → 任务卡在 1/3 不结束 → 并发管理缺陷
```

### 1.2 根因归类（不变）

| 类别 | 根因 | 现状 |
|------|------|------|
| 环境感知 | 系统 Prompt / buildContext 未注入 cwd、项目结构、沙箱边界 | 已修复（Phase 0） |
| 资源画像 | ResourceProfile 只有统计维度，无能力标签 | 已修复（Phase 1） |
| 模型选择 | 经验路由命中后直接执行，无能力校验 | 已修复（Phase 2） |
| 执行闭环 | 工具返回"成功"但不验证实际效果 | 已修复（Phase 3） |
| 任务管理 | 工具被拒后任务挂起，无超时降级 | 已修复（Phase 4） |

---

## 二、执行计划总览（更新）

### 已完成

```
Phase 0: 环境感知注入（P0）✅ 已完成 — 但局限于开发场景
Phase 1: 资源能力画像（P1）✅ 已完成
Phase 2: 经验路由能力校验（P2）✅ 已完成
Phase 3: 执行闭环验证（P3）✅ 已完成
Phase 4: 任务生命周期治理（P4）✅ 已完成
```

### 待执行

```
Phase 5: 通用环境感知升级（P0+ — 从开发专用升级为通用）
```

---

## 三、Phase 5: 通用环境感知升级

### 5.1 问题

当前 `EnvironmentProbe` 只探测软件开发相关的信息：
- 项目类型（Node/Python/Go/Rust/Java）
- 框架（React/Vue/Express）
- 包管理器（npm/pnpm/yarn/pip）
- 运行时（node/python/go/rustc）
- 关键文件（package.json/tsconfig/Dockerfile）

这导致非开发任务（写文档、做设计、处理数据、日常对话）时，注入的环境信息无用且浪费 token。

### 5.2 设计思路

**核心原则：按任务类型动态选择探测维度**

```
                    ┌─────────────────────────────────────┐
                    │         EnvironmentProbe            │
                    │                                     │
                    │  Layer 1: 系统层（始终探测）         │
                    │    OS / 硬件 / 网络 / 时间 / 语言   │
                    │                                     │
                    │  Layer 2: 上下文层（始终探测）       │
                    │    工作目录 / 沙箱 / 能力边界        │
                    │                                     │
                    │  Layer 3: 领域层（按任务类型选择）   │
                    │    开发项目 / 文档 / 数据 / 媒体     │
                    │                                     │
                    │  Layer 4: 能力层（始终探测）         │
                    │    可用工具 / 可用运行时 / 限制      │
                    └─────────────────────────────────────┘
```

### 5.3 新接口设计

```typescript
export interface EnvironmentSnapshot {
  /** 系统信息（始终探测） */
  system: SystemInfo;
  /** 工作环境（始终探测） */
  workspace: WorkspaceInfo;
  /** 领域信息（按任务类型选择） */
  domain: DomainInfo;
  /** 能力边界（始终探测） */
  capabilities: CapabilityInfo;
  /** 探测时间戳 */
  probedAt: number;
}

// ==================== Layer 1: 系统层 ====================

export interface SystemInfo {
  /** 操作系统 */
  os: {
    platform: string;        // 'linux' | 'darwin' | 'win32'
    arch: string;            // 'x64' | 'arm64'
    release: string;         // '6.12.21'
    hostname: string;
  };
  /** 硬件 */
  hardware: {
    cpuCores: number;
    totalMemoryMB: number;
    freeMemoryMB: number;
    gpuInfo: string | null;  // 'NVIDIA RTX 4090' | null
  };
  /** 网络 */
  network: {
    online: boolean;
    proxy: string | null;    // 'http://proxy:8080' | null
    dns: string[];
  };
  /** 时间 */
  time: {
    timezone: string;        // 'Asia/Shanghai'
    localTime: string;       // '2026-06-19 12:00:00'
    isWorkingHours: boolean; // 9:00-18:00 周一到周五
    isWeekend: boolean;
  };
  /** 区域 */
  locale: {
    language: string;        // 'zh-CN'
    dateFormat: string;      // 'YYYY-MM-DD'
    currency: string;        // 'CNY'
  };
}

// ==================== Layer 2: 工作环境层 ====================

export interface WorkspaceInfo {
  /** 当前工作目录 */
  cwd: string;
  /** 沙箱目录 */
  sandboxWorkspace: string;
  /** 路径解析规则 */
  pathResolution: {
    relativeTo: 'sandbox' | 'cwd';
    allowedRoots: string[];
  };
  /** 用户主目录 */
  homeDir: string;
  /** 临时目录 */
  tempDir: string;
  /** 用户目录结构（顶层） */
  homeDirectories: string[];  // ['Documents', 'Desktop', 'Downloads', ...]
  /** 磁盘空间 */
  diskSpace: {
    totalGB: number;
    freeGB: number;
    usedPercent: number;
  };
}

// ==================== Layer 3: 领域层 ====================

/** 领域信息 — 根据任务类型动态填充 */
export interface DomainInfo {
  /** 检测到的领域 */
  detectedDomain: 'code' | 'document' | 'data' | 'media' | 'system' | 'general';
  /** 代码项目信息（仅 code 领域） */
  codeProject: CodeProjectInfo | null;
  /** 文档信息（仅 document 领域） */
  documents: DocumentInfo | null;
  /** 数据信息（仅 data 领域） */
  dataFiles: DataFileInfo | null;
  /** 媒体信息（仅 media 领域） */
  mediaFiles: MediaFileInfo | null;
}

export interface CodeProjectInfo {
  name: string;
  version: string;
  type: 'node' | 'python' | 'go' | 'rust' | 'java' | 'mixed' | 'unknown';
  languages: string[];
  frameworks: string[];
  scripts: Record<string, string>;
  dependencies: string[];
  hasTypeScript: boolean;
  testFramework: string | null;
  hasDocker: boolean;
  hasGit: boolean;
  gitBranch: string | null;
  keyFiles: string[];
}

export interface DocumentInfo {
  /** 最近修改的文档 */
  recentDocuments: Array<{
    path: string;
    name: string;
    type: 'markdown' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'other';
    modifiedAt: number;
    sizeKB: number;
  }>;
  /** 文档目录 */
  documentDirs: string[];  // ['~/Documents', '~/notes']
}

export interface DataFileInfo {
  /** 可用数据文件 */
  dataFiles: Array<{
    path: string;
    name: string;
    type: 'csv' | 'json' | 'parquet' | 'sqlite' | 'excel' | 'other';
    sizeKB: number;
  }>;
  /** 数据目录 */
  dataDirs: string[];
}

export interface MediaFileInfo {
  /** 可用媒体文件 */
  mediaFiles: Array<{
    path: string;
    name: string;
    type: 'image' | 'video' | 'audio';
    sizeKB: number;
  }>;
  /** 媒体目录 */
  mediaDirs: string[];
}

// ==================== Layer 4: 能力层 ====================

export interface CapabilityInfo {
  /** 可用运行时 */
  runtimes: RuntimeInfo[];
  /** 可用包管理器 */
  packageManagers: PackageManagerInfo[];
  /** 可用 CLI 工具 */
  cliTools: CLIToolInfo[];
  /** 感知能力 */
  sensors: {
    hasCamera: boolean;
    hasMicrophone: boolean;
    hasDisplay: boolean;
    hasSpeaker: boolean;
    hasGPS: boolean;
  };
  /** 限制 */
  limits: {
    maxFileSize: number;        // 最大文件大小 (bytes)
    maxExecutionTime: number;   // 最大执行时间 (ms)
    sandboxed: boolean;         // 是否在沙箱中
    networkAccess: boolean;     // 是否有网络访问
  };
}

export interface CLIToolInfo {
  name: string;
  version: string;
  available: boolean;
  path: string | null;
}
```

### 5.4 任务类型 → 领域探测映射

```typescript
/**
 * 根据任务类型决定探测哪些领域
 * 这是 EnvironmentProbe 的核心调度逻辑
 */
function selectDomainProbes(
  taskType: string,
  content: string,
): DomainProbeType[] {
  const probes: DomainProbeType[] = [];

  // 始终探测基础层
  probes.push('system', 'workspace', 'capabilities');

  // 按任务类型选择领域探测
  switch (taskType) {
    case 'tools':
    case 'code':
      probes.push('code');
      break;
    case 'reasoning':
    case 'writing':
    case 'planning':
      // 探测文档上下文
      probes.push('document');
      // 如果内容涉及数据，也探测数据
      if (/数据|分析|图表|统计|csv|excel/i.test(content)) {
        probes.push('data');
      }
      break;
    case 'image-gen':
    case 'image-edit':
    case 'video-gen':
      probes.push('media');
      break;
    case 'chat':
    default:
      // 闲聊只探测基础层，不探测领域
      break;
  }

  return [...new Set(probes)];
}
```

### 5.5 Prompt 注入策略

```typescript
/**
 * 根据任务类型和探测结果，生成精简的环境 Prompt
 *
 * 核心原则：
 * - 闲聊：只注入系统层（OS/时间/语言），不浪费 token
 * - 开发：注入系统层 + 工作环境层 + 代码领域层
 * - 写作：注入系统层 + 工作环境层 + 文档领域层
 * - 数据：注入系统层 + 工作环境层 + 数据领域层
 */
function buildEnvironmentPrompt(
  snapshot: EnvironmentSnapshot,
  taskType: string,
): string {
  const parts: string[] = [];

  // ── 系统层（始终注入，精简版）──
  parts.push('## 环境');
  parts.push(`- 系统: ${snapshot.system.os.platform} ${snapshot.system.os.arch}`);
  parts.push(`- 时间: ${snapshot.system.time.localTime} (${snapshot.system.time.timezone})`);
  if (snapshot.system.time.isWeekend) parts.push('- 今天是周末');
  if (!snapshot.system.time.isWorkingHours) parts.push('- 当前是非工作时间');

  // ── 工作环境层（非闲聊时注入）──
  if (taskType !== 'chat') {
    parts.push(`- 工作目录: ${snapshot.workspace.cwd}`);
    parts.push(`- 沙箱目录: ${snapshot.workspace.sandboxWorkspace}`);
    parts.push(`- 磁盘: ${snapshot.workspace.diskSpace.freeGB}GB 可用 / ${snapshot.workspace.diskSpace.totalGB}GB 总计`);

    // 路径规则
    parts.push(`- 文件操作: 相对路径基于 ${snapshot.workspace.pathResolution.relativeTo} 解析`);
  }

  // ── 领域层（按任务类型注入）──
  if (snapshot.domain.detectedDomain === 'code' && snapshot.domain.codeProject) {
    const p = snapshot.domain.codeProject;
    parts.push('');
    parts.push('### 项目');
    parts.push(`- ${p.name}${p.version ? ` v${p.version}` : ''} (${p.type})`);
    if (p.frameworks.length) parts.push(`- 框架: ${p.frameworks.join(', ')}`);
    if (p.hasGit && p.gitBranch) parts.push(`- Git: ${p.gitBranch}`);
    const scripts = Object.keys(p.scripts);
    if (scripts.length) parts.push(`- scripts: ${scripts.slice(0, 8).join(', ')}`);
  }

  if (snapshot.domain.detectedDomain === 'document' && snapshot.domain.documents) {
    const docs = snapshot.domain.documents;
    parts.push('');
    parts.push('### 文档');
    if (docs.documentDirs.length) parts.push(`- 文档目录: ${docs.documentDirs.join(', ')}`);
    if (docs.recentDocuments.length) {
      parts.push('- 最近文档:');
      for (const doc of docs.recentDocuments.slice(0, 5)) {
        parts.push(`  - ${doc.name} (${doc.type}, ${(doc.sizeKB / 1024).toFixed(1)}MB)`);
      }
    }
  }

  if (snapshot.domain.detectedDomain === 'data' && snapshot.domain.dataFiles) {
    const data = snapshot.domain.dataFiles;
    parts.push('');
    parts.push('### 数据');
    if (data.dataDirs.length) parts.push(`- 数据目录: ${data.dataDirs.join(', ')}`);
    if (data.dataFiles.length) {
      parts.push('- 数据文件:');
      for (const f of data.dataFiles.slice(0, 5)) {
        parts.push(`  - ${f.name} (${f.type}, ${(f.sizeKB / 1024).toFixed(1)}MB)`);
      }
    }
  }

  // ── 能力层（非闲聊时注入关键限制）──
  if (taskType !== 'chat') {
    const limits = snapshot.capabilities.limits;
    if (!limits.networkAccess) parts.push('- ⚠️ 无网络访问');
    if (limits.sandboxed) parts.push('- ⚠️ 沙箱环境，文件操作受限');
  }

  return parts.join('\n');
}
```

### 5.6 实现计划

```
Week 1: Phase 5.1 — 系统层探测
  - Day 1: SystemInfo 探测（OS/硬件/网络/时间/区域）
  - Day 2: WorkspaceInfo 探测（磁盘/用户目录）
  - Day 3: CapabilityInfo 探测（运行时/CLI工具/感知能力）
  - Day 4: 测试验收

Week 2: Phase 5.2 — 领域层探测
  - Day 1: 代码项目探测（复用现有 scan_project）
  - Day 2: 文档探测（扫描 Documents/桌面/下载目录）
  - Day 3: 数据文件探测（扫描 CSV/JSON/Excel/SQLite）
  - Day 4: 媒体文件探测（扫描图片/视频/音频）
  - Day 5: 测试验收

Week 3: Phase 5.3 — 动态 Prompt 注入
  - Day 1: 任务类型 → 领域探测映射
  - Day 2: 精简 Prompt 生成（闲聊 vs 开发 vs 写作 vs 数据）
  - Day 3: buildContext 集成（替换现有静态注入）
  - Day 4-5: 全链路测试验收
```

### 5.7 验收标准

- [ ] 闲聊时只注入系统层（< 200 tokens）
- [ ] 开发任务注入完整项目信息
- [ ] 写作任务注入最近文档列表
- [ ] 数据任务注入数据文件列表
- [ ] 非开发任务不注入无用的 package.json 信息
- [ ] 系统层探测 < 50ms
- [ ] 领域层探测 < 500ms（缓存命中 < 1ms）
- [ ] 所有现有测试通过

---

## 四、已完成 Phase 回顾

### Phase 0: 环境感知注入 ✅（将被 Phase 5 替换）

- `EnvironmentProbe`：探测 cwd、项目类型、依赖、运行时、Git 分支
- `buildContext` 注入环境 Prompt（优先级 85，required=true）
- 路径解析修复：相对路径优先检查项目目录

### Phase 1: 资源能力画像 ✅

- `ResourceCapabilities`：toolCalling、vision、maxContextTokens、strongAt、weakAt
- `affinity`：EMA 亲和度学习（权重 0.3）
- `recommend()`：亲和度 40 + 成功率 30 + 领域 20 + 健康度 10

### Phase 2: 经验路由能力校验 ✅

- `validateExperienceCapability()`：亲和度 ≥ 0.3、toolCalling、reasoning
- 校验失败 → `llm_with_hint` 路由器重选

### Phase 3: 执行闭环验证 ✅

- `ExecutionVerifier`：write_file 验证文件存在、exec 检查错误输出
- 2 秒超时跳过，验证失败注入警告

### Phase 4: 任务生命周期治理 ✅

- 工具被拒 → 注入降级提示（不重试）
- 步骤级 60 秒超时
- 僵尸任务自动清理

---

## 五、Phase 6: 对话状态机（讨论→确认→执行）

### 6.1 问题

当前系统只看单条消息的关键词判断任务类型，不看对话上下文。导致：
- "我想做一款游戏" → 被分类为 chat → 模型问 5 个问题 → 用户说"别问了直接做" → 仍然不执行
- 系统没有"从讨论到执行"的流程管理
- 用户的执行意图被当作闲聊处理

### 6.2 设计思路

**核心原则：对话是一个过程，不是一个点**

```
用户: "我想做一款游戏"
  → 状态: idle → discussing
  → 行为: 问 2-3 个关键问题（不是 5 个）

用户: "roguelike 卡牌，类似杀戮尖塔，用 TypeScript"
  → 状态: discussing → confirming
  → 行为: 输出方案摘要，等确认

用户: "好，开始吧"
  → 状态: confirming → executing
  → 行为: 分配资源，调用工具，创建文件
```

### 6.3 对话状态机

```typescript
type ConversationPhase = 'idle' | 'discussing' | 'confirming' | 'executing' | 'done';

interface ConversationState {
  phase: ConversationPhase;
  /** 用户的原始意图 */
  intent: string;
  /** 收集到的需求 */
  requirements: Record<string, string>;
  /** 确认的方案 */
  confirmedPlan: string | null;
  /** 本轮提问次数 */
  questionsAsked: number;
  /** 最大提问次数 */
  maxQuestions: number;
  /** 状态开始时间 */
  phaseStartedAt: number;
}
```

### 6.4 状态转换规则

```typescript
function nextState(
  current: ConversationPhase,
  userMessage: string,
  state: ConversationState,
): ConversationPhase {
  switch (current) {
    case 'idle':
      // 用户提出意图 → 进入讨论
      if (hasExecutionIntent(userMessage)) return 'discussing';
      return 'idle';

    case 'discussing':
      // 用户提供了具体信息 → 进入确认
      if (hasSpecificDetails(userMessage) || state.questionsAsked >= state.maxQuestions) {
        return 'confirming';
      }
      // 用户说"直接做" → 跳过确认
      if (isDirectExecution(userMessage)) return 'executing';
      return 'discussing';

    case 'confirming':
      // 用户确认 → 进入执行
      if (isConfirmation(userMessage)) return 'executing';
      // 用户提出修改 → 回到讨论
      if (hasModification(userMessage)) return 'discussing';
      return 'confirming';

    case 'executing':
      // 执行完成
      return 'done';

    case 'done':
      // 新意图
      return 'idle';
  }
}
```

### 6.5 意图识别

```typescript
/** 判断用户消息是否包含执行意图 */
function hasExecutionIntent(content: string): boolean {
  const intentPatterns = [
    /做.*游戏/, /开发.*应用/, /创建.*项目/, /写.*程序/,
    /build|create|develop|make|implement/i,
    /帮我.*做/, /帮我.*写/, /帮我.*创建/,
  ];
  return intentPatterns.some(p => p.test(content));
}

/** 判断用户是否要求直接执行 */
function isDirectExecution(content: string): boolean {
  const directPatterns = [
    /直接做/, /直接开始/, /别问了/, /不用问/, /现在就做/,
    /just do it|start now|go ahead|begin/i,
  ];
  return directPatterns.some(p => p.test(content));
}

/** 判断用户是否确认方案 */
function isConfirmation(content: string): boolean {
  const confirmPatterns = [
    /^好$/, /^可以$/, /^行$/, /^开始/, /^确认/, /^就这样/,
    /^ok$/i, /^yes$/i, /^go$/i, /^start$/i,
  ];
  return confirmPatterns.some(p => p.test(content.trim()));
}
```

### 6.6 注入 Prompt 策略

```typescript
function buildPhasePrompt(phase: ConversationPhase, state: ConversationState): string {
  switch (phase) {
    case 'discussing':
      return `\n## 当前阶段: 需求讨论\n- 用户意图: ${state.intent}\n- 已收集: ${JSON.stringify(state.requirements)}\n- 还可以问 ${state.maxQuestions - state.questionsAsked} 个问题\n- 问最关键的问题，不要问太多`;

    case 'confirming':
      return `\n## 当前阶段: 方案确认\n- 输出方案摘要（技术栈、模块、计划）\n- 等用户确认后开始执行\n- 不要再问问题`;

    case 'executing':
      return `\n## 当前阶段: 执行\n- 直接调用工具创建文件\n- 不要再问问题\n- 不要只给方案，要实际执行`;

    default:
      return '';
  }
}
```

### 6.7 验收标准

- [ ] "我想做一款游戏" → discussing 阶段，最多问 2 个问题
- [ ] "roguelike 卡牌，TypeScript" → confirming 阶段，输出方案
- [ ] "好，开始吧" → executing 阶段，调用工具创建文件
- [ ] "别问了直接做" → 跳过确认，直接 executing
- [ ] 状态机会话级持久化

---

## 六、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 系统探测增加延迟 | 低 | 低 | 并行探测 + 缓存 |
| 文档/数据扫描耗时 | 中 | 中 | 只扫描顶层 + 缓存 |
| Prompt token 增加 | 低 | 低 | 按任务类型精简 |
| 改动引入回归 | 中 | 高 | 每个 Phase 独立可回滚 |
