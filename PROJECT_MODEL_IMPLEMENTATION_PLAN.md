# ProjectModel 详细实现计划

> 基于 Buddy 现有架构，在已有 STMP / DreamEngine / ExperienceCompiler / CognitiveEngine / DAG 编排之上，加一层"项目语义"——给 Buddy 加一个"项目大脑"。

---

## 〇、核心理念：隐性项目意识

ProjectModel 不是每次都要"创建项目→定方案→走流程"。它是**三层激活**的：

### 第一层：无感（大部分情况）

用户说"帮我看看这个文件"、"这段代码什么意思"——就是一个任务，走正常 DAG 编排或直接工具调用，ProjectModel 完全不介入。底层 DecisionMemory、ExperienceCompiler 该记录还是记录，但不挂项目标签。

### 第二层：半显性（多步工作）

用户说"帮我重构这个模块"、"给这个项目加单元测试"——Agent 自动判断这是多步工作，后台创建轻量项目上下文：

- 自动归组记忆（STMP 房间自动创建）
- 自动追踪进度（走到哪了）
- 自动记录决策（为什么这样重构）
- 但不强制用户走"需求→方案→审批"流程
- 用户完全无感，但事后能查"上次重构做了什么"

### 第三层：显性（正式项目）

用户说"我要做一个新功能"、"帮我规划这个版本"——走完整流程：

- 创建项目 → 列需求 → 定方案（可能多版本）→ 执行（可能暂停恢复）→ 产出物管理 → 教训提取

### 激活判断逻辑

```
单步任务（1个工具调用）     → 第一层，无感
多步但目标明确（2-5步）     → 第二层，后台自动追踪
多阶段、有决策点、需要规划   → 第三层，显性项目
```

### 向上兼容，向下不耦合

- 第一层产生的决策/经验，不挂项目标签，但能被第三层的跨项目系统检索到
- 第二层自动创建的项目上下文，用户随时可以"升级"为正式项目
- 第三层的项目完成后，教训自动沉淀，下次第二层的工作也能受益

### 项目类型标记

`Project` 增加 `origin` 字段：

```typescript
origin: 'implicit' | 'explicit';
// implicit = Agent 后台自动创建（第二层）
// explicit = 用户显式创建（第三层）
```

隐式项目可以随时升级为显式（用户说"把这个标记为正式项目"）。

**ProjectModel 是"心里有数"的能力，不是那套流程。流程只是这个能力在最高级场景下的外化。**

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        ProjectModel 层                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ 方案管理  │ │ 执行管理  │ │ 进度追踪  │ │ 产出物    │           │
│  │(Plan)    │ │(Execute) │ │(Progress)│ │(Artifact)│           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │            │            │            │                  │
│  ┌────┴────────────┴────────────┴────────────┴─────┐            │
│  │              ProjectStore (SQLite)               │            │
│  │  projects / plans / decisions / checkpoints /    │            │
│  │  artifacts / lessons / progress / dag_bindings   │            │
│  └──────────────────┬──────────────────────────────┘            │
│                     │                                           │
├─────────────────────┼───────────────────────────────────────────┤
│                     │        已有基础设施（不改动）                │
│  ┌──────────┐  ┌────┴─────┐  ┌───────────┐  ┌──────────┐      │
│  │  STMP    │  │DAG 编排  │  │ Experience│  │Cognitive │      │
│  │ 记忆宫殿 │  │Workflow  │  │ Compiler  │  │ Engine   │      │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘      │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                     │
│  │  Dream   │  │ Decision │  │ Experience│                     │
│  │  Engine  │  │ Memory   │  │ Graph     │                     │
│  └──────────┘  └──────────┘  └───────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

**设计原则**：ProjectModel 不替代任何已有模块，而是在它们之上提供项目级语义。每个项目是 STMP 的一个"房间"，每个项目的决策写入 DecisionMemory，每个项目的经验通过 ExperienceCompiler 编译进 ExperienceGraph。

---

## 二、模块拆分与文件清单

### 新增文件（8 个核心 + 3 个工具 + 1 个集成 + 测试）

| # | 文件路径 | 职责 | 行数估算 |
|---|---------|------|---------|
| 1 | `src/project/types.ts` | 全部类型定义 | ~200 |
| 2 | `src/project/store.ts` | SQLite 存储引擎 + Migration | ~500 |
| 3 | `src/project/plan-manager.ts` | 方案 CRUD + 版本管理 | ~250 |
| 4 | `src/project/execution-manager.ts` | DAG 绑定 + 暂停/恢复 | ~300 |
| 5 | `src/project/progress-tracker.ts` | checkpoints + progress 计数 | ~200 |
| 6 | `src/project/artifact-manager.ts` | 产出物版本管理 | ~200 |
| 7 | `src/project/lesson-system.ts` | 教训提取 + 经验注入 | ~250 |
| 8 | `src/project/cross-project.ts` | 跨项目查找 + 历史注入 | ~200 |
| 9 | `src/project/tools.ts` | 暴露给 Agent 的工具定义 | ~300 |
| 10 | `src/project/search.ts` | FTS5 全文搜索封装 | ~150 |
| 11 | `src/project/integration.ts` | 与 STMP/Dream/Experience/Cognitive 的桥接 | ~200 |
| 12 | `src/project/store.test.ts` | 存储引擎测试 | ~300 |
| 13 | `src/project/plan-manager.test.ts` | 方案管理测试 | ~200 |
| 14 | `src/project/execution-manager.test.ts` | 执行管理测试 | ~200 |
| 15 | `src/project/cross-project.test.ts` | 跨项目测试 | ~150 |

**总计约 3400 行代码。**

---

## 三、类型定义（`src/project/types.ts`）

```typescript
// ==================== 项目 ====================

export interface Project {
  id: string;                    // proj_<uuid>
  name: string;
  description: string;
  category: string;              // 行业分类：'web' | 'mobile' | 'data' | 'devops' | 'research' | 'design' | 'other'
  tags: string[];                // 自定义标签
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  origin: 'implicit' | 'explicit';  // 隐式（Agent自动创建）| 显式（用户创建）
  requirements: Requirement[];   // 需求列表
  currentPlanId?: string;        // 当前活跃方案
  stmpRoomId: string;            // 关联的 STMP 房间 ID
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;  // 自定义元数据
}

export interface Requirement {
  id: string;                    // req_<uuid>
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'proposed' | 'approved' | 'implementing' | 'verified' | 'done';
  acceptanceCriteria: string[];
  createdAt: number;
}

// ==================== 方案 ====================

export interface Plan {
  id: string;                    // plan_<uuid>
  projectId: string;
  title: string;
  description: string;
  version: number;               // 版本号，从 1 开始
  parentVersionId?: string;      // 基于哪个版本创建
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'superseded';
  steps: PlanStep[];
  decisions: Decision[];         // 关键决策记录
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStep {
  id: string;                    // step_<uuid>
  title: string;
  description: string;
  tool?: string;                 // 关联工具
  args?: Record<string, unknown>;
  deps: string[];                // 依赖的 step ID
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped';
  output?: string;
  estimatedMs?: number;
  actualMs?: number;
}

export interface Decision {
  id: string;                    // dec_<uuid>
  question: string;              // 决策问题
  options: string[];             // 候选方案
  chosen: string;                // 选择的方案
  reasoning: string;             // 选择理由
  consequences?: string[];       // 预期后果
  timestamp: number;
}

// ==================== 执行管理 ====================

export interface DAGBinding {
  id: string;                    // bind_<uuid>
  projectId: string;
  planId: string;
  dagId: string;                 // 关联的 WorkflowManager DAG ID
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  pauseReason?: string;
  resumedAt?: number;
  startedAt: number;
  finishedAt?: number;
}

// ==================== 检查点与进度 ====================

export interface Checkpoint {
  id: string;                    // cp_<uuid>
  projectId: string;
  planId: string;
  dagBindingId?: string;
  phase: string;                 // 当前阶段名
  snapshot: {
    completedSteps: string[];
    pendingSteps: string[];
    runningSteps: string[];
    outputs: Record<string, string>;  // stepId → output
    decisions: Decision[];
  };
  progressPercent: number;       // 0-100
  timestamp: number;
  note?: string;
}

export interface ProgressCounter {
  projectId: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  percentComplete: number;       // 0-100
  estimatedRemainingMs: number;
  lastUpdated: number;
}

// ==================== 产出物 ====================

export interface Artifact {
  id: string;                    // art_<uuid>
  projectId: string;
  planId?: string;
  name: string;
  type: 'code' | 'document' | 'config' | 'data' | 'design' | 'test' | 'other';
  path?: string;                 // 文件路径（如有）
  content?: string;              // 内容（小型产出物直接存）
  version: number;               // 版本号
  parentVersionId?: string;      // 前一版本
  createdBy: string;             // 创建者（tool name / 'user' / 'agent'）
  createdAt: number;
  metadata: Record<string, unknown>;
}

// ==================== 教训 ====================

export interface Lesson {
  id: string;                    // les_<uuid>
  projectId: string;
  category: 'mistake' | 'insight' | 'optimization' | 'pattern' | 'warning';
  title: string;
  description: string;
  context: string;               // 什么情况下产生的
  correction?: string;           // 正确做法
  impact: 'low' | 'medium' | 'high' | 'critical';
  applicableCategories: string[];  // 适用于哪些项目类别
  experienceUnitId?: string;     // 编译后的 ExperienceUnit ID（链接到经验图谱）
  createdAt: number;
  verified: boolean;             // 是否经过验证
}

// ==================== 跨项目 ====================

export interface SimilarProject {
  project: Project;
  similarity: number;            // 0-1
  matchedBy: 'category' | 'tags' | 'requirements' | 'technology';
  relevantLessons: Lesson[];
}
```

---

## 四、存储引擎（`src/project/store.ts`）

### 4.1 SQLite Schema

```sql
-- 项目表
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  tags TEXT DEFAULT '[]',
  status TEXT DEFAULT 'planning',
  requirements TEXT DEFAULT '[]',
  current_plan_id TEXT,
  stmp_room_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);

-- 方案表（含版本链）
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  parent_version_id TEXT,
  status TEXT DEFAULT 'draft',
  steps TEXT DEFAULT '[]',
  decisions TEXT DEFAULT '[]',
  estimated_duration_ms INTEGER,
  actual_duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_plans_version ON plans(project_id, version);

-- DAG 绑定表
CREATE TABLE IF NOT EXISTS dag_bindings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  dag_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  pause_reason TEXT,
  resumed_at INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dag_bindings_project ON dag_bindings(project_id);

-- 检查点表
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  dag_binding_id TEXT,
  phase TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  progress_percent REAL DEFAULT 0,
  timestamp INTEGER NOT NULL,
  note TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, timestamp);

-- 进度计数器表
CREATE TABLE IF NOT EXISTS progress_counters (
  project_id TEXT PRIMARY KEY,
  total_steps INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  failed_steps INTEGER DEFAULT 0,
  skipped_steps INTEGER DEFAULT 0,
  percent_complete REAL DEFAULT 0,
  estimated_remaining_ms INTEGER DEFAULT 0,
  last_updated INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 产出物表
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'other',
  path TEXT,
  content TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  parent_version_id TEXT,
  created_by TEXT DEFAULT 'agent',
  created_at INTEGER NOT NULL,
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_name ON artifacts(project_id, name);

-- 教训表
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT DEFAULT '',
  correction TEXT,
  impact TEXT DEFAULT 'medium',
  applicable_categories TEXT DEFAULT '[]',
  experience_unit_id TEXT,
  created_at INTEGER NOT NULL,
  verified INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lessons_project ON lessons(project_id);
CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);
CREATE INDEX IF NOT EXISTS idx_lessons_impact ON lessons(impact);

-- FTS5 全文搜索索引（跨项目/决策/教训）
CREATE VIRTUAL TABLE IF NOT EXISTS project_search_fts USING fts5(
  entity_type,    -- 'project' | 'plan' | 'decision' | 'lesson' | 'artifact'
  entity_id,
  title,
  content,
  tags,
  project_id
);
```

### 4.2 Migration 策略

使用 `runMigrations(this.db, 'project', PROJECT_MIGRATIONS)` — 与 STMP、ExperienceGraph、CognitiveEngine 完全一致的模式。

```typescript
const PROJECT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化 ProjectModel 全部表结构',
    up(db) {
      // 上面所有 CREATE TABLE / INDEX / VIRTUAL TABLE
    },
  },
  // 后续版本在此追加
];
```

### 4.3 Store 类核心方法

```typescript
export class ProjectStore {
  private db: Database.Database;

  constructor(dbPath: string) { /* 同 STMPStore 模式 */ }

  // ── 项目 CRUD ──
  createProject(project: Project): void;
  getProject(id: string): Project | null;
  updateProject(id: string, updates: Partial<Project>): void;
  deleteProject(id: string): void;
  listProjects(filter?: { status?: string; category?: string }): Project[];

  // ── 方案 ──
  createPlan(plan: Plan): void;
  getPlan(id: string): Plan | null;
  getPlanVersions(projectId: string): Plan[];
  getLatestPlanVersion(projectId: string): Plan | null;
  updatePlan(id: string, updates: Partial<Plan>): void;
  supersedePlan(id: string): void;  // 标记为 superseded

  // ── DAG 绑定 ──
  createDAGBinding(binding: DAGBinding): void;
  getDAGBinding(id: string): DAGBinding | null;
  getActiveDAGBinding(projectId: string): DAGBinding | null;
  updateDAGBinding(id: string, updates: Partial<DAGBinding>): void;

  // ── 检查点 ──
  createCheckpoint(cp: Checkpoint): void;
  getCheckpoints(projectId: string, limit?: number): Checkpoint[];
  getLatestCheckpoint(projectId: string): Checkpoint | null;

  // ── 进度 ──
  upsertProgress(counter: ProgressCounter): void;
  getProgress(projectId: string): ProgressCounter | null;

  // ── 产出物 ──
  createArtifact(artifact: Artifact): void;
  getArtifact(id: string): Artifact | null;
  getArtifactVersions(projectId: string, name: string): Artifact[];
  listArtifacts(projectId: string, type?: string): Artifact[];

  // ── 教训 ──
  createLesson(lesson: Lesson): void;
  getLessons(projectId: string): Lesson[];
  getLessonsByCategory(category: string, limit?: number): Lesson[];
  getVerifiedLessons(): Lesson[];
  linkLessonToExperience(lessonId: string, experienceUnitId: string): void;

  // ── FTS5 搜索 ──
  search(query: string, options?: {
    entityTypes?: string[];  // 过滤实体类型
    projectId?: string;      // 限定项目
    limit?: number;
  }): SearchResult[];

  indexForSearch(entityType: string, entityId: string, title: string, content: string, tags: string, projectId: string): void;

  // ── 统计 ──
  getProjectStats(projectId: string): ProjectStats;
  getGlobalStats(): GlobalProjectStats;

  close(): void;
}
```

---

## 五、方案管理（`src/project/plan-manager.ts`）

### 5.1 核心职责

- **创建方案**：从需求生成方案（可 LLM 辅助）
- **版本管理**：方案修改时自动创建新版本，保留历史链
- **决策记录**：每个关键决策点自动记录
- **方案比对**：支持版本间 diff

### 5.2 关键实现

```typescript
export class PlanManager {
  constructor(
    private store: ProjectStore,
    private llmCaller?: LLMCaller,
  ) {}

  /**
   * 从需求列表创建初版方案
   */
  async createPlan(
    projectId: string,
    title: string,
    requirements: Requirement[],
    options?: { llmAssist?: boolean },
  ): Promise<Plan>;

  /**
   * 创建方案的新版本（基于当前版本）
   */
  async createNewVersion(
    planId: string,
    changes: {
      title?: string;
      description?: string;
      steps?: PlanStep[];
      decisions?: Decision[];
      reason: string;  // 变更原因
    },
  ): Promise<Plan>;

  /**
   * 记录一个决策
   */
  recordDecision(
    planId: string,
    decision: Omit<Decision, 'id' | 'timestamp'>,
  ): Decision;

  /**
   * 获取方案版本链
   */
  getVersionChain(projectId: string): Plan[];

  /**
   * 版本间 diff
   */
  diffVersions(planIdA: string, planIdB: string): PlanDiff;

  /**
   * 用 LLM 辅助将需求分解为步骤
   */
  async decomposeRequirements(
    requirements: Requirement[],
    context?: string,
  ): Promise<PlanStep[]>;
}
```

### 5.3 方案版本链数据结构

```
Plan v1 (initial) → Plan v2 (add step) → Plan v3 (change decision)
                                              ↑
                                          currentPlanId
```

每个 Plan 的 `parentVersionId` 指向前一版本，`version` 是递增整数。

---

## 六、执行管理（`src/project/execution-manager.ts`）

### 6.1 核心职责

- 将 Plan 的步骤绑定到 DAG
- 支持暂停/恢复（写检查点 + DAG 状态）
- 与 WorkflowManager 交互执行

### 6.2 关键实现

```typescript
export class ExecutionManager {
  constructor(
    private store: ProjectStore,
    private workflowManager: WorkflowManager,
    private progressTracker: ProjectProgressTracker,
  ) {}

  /**
   * 从 Plan 创建 DAG 并绑定
   * Plan.steps → DAG tasks，保持 deps 关系
   */
  async startExecution(
    projectId: string,
    planId: string,
    options?: {
      parallelGroups?: string[][];  // 可选并行组
      defaultTimeoutMs?: number;
    },
  ): Promise<DAGBinding>;

  /**
   * 暂停执行
   * 1. 创建检查点（保存当前所有状态）
   * 2. 暂停 DAG（通过 WorkflowManager）
   * 3. 更新 binding 状态
   */
  async pauseExecution(
    projectId: string,
    reason?: string,
  ): Promise<Checkpoint>;

  /**
   * 恢复执行
   * 1. 读取最新检查点
   * 2. 恢复 DAG 状态
   * 3. 从断点继续
   */
  async resumeExecution(
    projectId: string,
  ): Promise<DAGBinding>;

  /**
   * 获取当前执行状态
   */
  getExecutionStatus(projectId: string): {
    binding: DAGBinding | null;
    progress: ProgressCounter | null;
    latestCheckpoint: Checkpoint | null;
  };

  /**
   * 监听 DAG 事件 → 自动更新检查点和进度
   */
  private onDAGEvent(event: OrchestrateEvent): void;
}
```

### 6.3 暂停/恢复流程

```
暂停流程:
  onDAGEvent(orch_task_done)
    → progressTracker.updateStep()
    → store.upsertProgress()
    → store.createCheckpoint()  [每 N 步或暂停时]

恢复流程:
  resumeExecution()
    → store.getLatestCheckpoint()
    → checkpoint.snapshot.completedSteps → 标记 DAG tasks 为 done
    → checkpoint.snapshot.pendingSteps → 保持 pending
    → workflowManager.run(dagId)  [从断点继续]
```

---

## 七、进度追踪（`src/project/progress-tracker.ts`）

### 7.1 设计

```typescript
export class ProjectProgressTracker {
  constructor(private store: ProjectStore) {}

  /**
   * 初始化项目进度
   */
  initProgress(projectId: string, totalSteps: number): void;

  /**
   * 步骤完成时更新
   */
  stepCompleted(projectId: string, stepId: string): void;
  stepFailed(projectId: string, stepId: string): void;
  stepSkipped(projectId: string, stepId: string): void;

  /**
   * 创建检查点（快照当前完整状态）
   */
  createCheckpoint(
    projectId: string,
    planId: string,
    snapshot: Checkpoint['snapshot'],
    note?: string,
  ): Checkpoint;

  /**
   * 获取当前进度
   */
  getProgress(projectId: string): ProgressCounter;

  /**
   * 估算剩余时间（EWMA，复用 TaskProgressTracker 的算法）
   */
  private estimateRemaining(projectId: string): number;
}
```

### 7.2 检查点策略

- **自动创建**：每完成 3 步自动创建
- **手动创建**：暂停/恢复时创建
- **里程碑**：关键步骤完成后创建
- **快照内容**：completedSteps + pendingSteps + runningSteps + outputs + decisions

---

## 八、产出物管理（`src/project/artifact-manager.ts`）

### 8.1 设计

```typescript
export class ArtifactManager {
  constructor(private store: ProjectStore) {}

  /**
   * 创建产出物
   */
  create(params: {
    projectId: string;
    planId?: string;
    name: string;
    type: Artifact['type'];
    path?: string;
    content?: string;
    createdBy?: string;
    metadata?: Record<string, unknown>;
  }): Artifact;

  /**
   * 更新产出物（自动创建新版本）
   */
  update(
    artifactId: string,
    changes: { content?: string; path?: string; metadata?: Record<string, unknown> },
  ): Artifact;

  /**
   * 获取产出物的所有版本
   */
  getVersions(projectId: string, name: string): Artifact[];

  /**
   * 获取最新版本
   */
  getLatest(projectId: string, name: string): Artifact | null;

  /**
   * 按项目列出所有产出物（每个 name 只返回最新版本）
   */
  listLatest(projectId: string, type?: string): Artifact[];

  /**
   * 版本间 diff（文本类产出物）
   */
  diff(artifactIdA: string, artifactIdB: string): string;
}
```

### 8.2 版本链

```
Artifact "api-design" v1 → v2 → v3 (latest)
                                ↑
                           parentVersionId = v2.id
```

---

## 九、教训系统（`src/project/lesson-system.ts`）

### 9.1 核心设计

教训系统是 ProjectModel 学习能力的核心。它从项目执行中自动提取教训，并可编译为 ExperienceUnit 进入经验图谱。

```typescript
export class LessonSystem {
  constructor(
    private store: ProjectStore,
    private experienceCompiler: ExperienceCompiler,
    private experienceGraph: ExperienceGraph,
  ) {}

  /**
   * 从失败的任务中自动提取教训
   */
  async extractFromFailure(
    projectId: string,
    failedTask: { name: string; error: string; tool: string; args: Record<string, unknown> },
    context: string,
  ): Promise<Lesson>;

  /**
   * 从成功的优化中提取教训
   */
  extractFromOptimization(
    projectId: string,
    description: string,
    before: string,
    after: string,
  ): Promise<Lesson>;

  /**
   * 手动记录教训
   */
  record(params: Omit<Lesson, 'id' | 'createdAt' | 'verified' | 'experienceUnitId'>): Lesson;

  /**
   * 将教训编译为 ExperienceUnit 并注入经验图谱
   *
   * 流程：
   * 1. 从 Lesson 构造 ConversationSnapshot
   * 2. 调用 ExperienceCompiler.compile()
   * 3. 将编译结果加入 ExperienceGraph
   * 4. 更新 Lesson.experienceUnitId 链接
   */
  async compileToExperience(lessonId: string): Promise<string | null>;

  /**
   * 批量编译未处理的教训
   */
  async compileAllPending(): Promise<number>;

  /**
   * 验证教训（标记为 verified）
   */
  verify(lessonId: string): void;

  /**
   * 获取项目教训
   */
  getLessons(projectId: string, filter?: {
    category?: Lesson['category'];
    impact?: Lesson['impact'];
    verified?: boolean;
  }): Lesson[];
}
```

### 9.2 教训 → 经验编译流程

```
Lesson (失败: "git push 被拒绝，因为本地落后")
  ↓
构造 ConversationSnapshot:
  - userMessage: "推送代码到远程"
  - toolCalls: [{ name: "git_push", args: {...}, result: "rejected" }]
  - wasSuccessful: false
  ↓
ExperienceCompiler.compile() → null (因为 wasSuccessful=false)
  ↓
手动构造 ExperienceUnit:
  - trigger: { intent: "git_push", keywords: ["push", "git"], ... }
  - steps: [
      { tool: "git_pull", args: { rebase: true }, description: "先拉取远程" },
      { tool: "git_push", args: {}, description: "再推送" },
    ]
  - reasoning: "当 push 被拒时，先 pull --rebase 再 push"
  ↓
ExperienceGraph.addNode()
  ↓
Lesson.experienceUnitId = unit.id
```

---

## 十、跨项目系统（`src/project/cross-project.ts`）

### 10.1 核心设计

```typescript
export class CrossProjectManager {
  constructor(
    private store: ProjectStore,
    private lessonSystem: LessonSystem,
  ) {}

  /**
   * 查找相似项目
   * 匹配维度：category + tags + requirements关键词 + technology
   */
  findSimilarProjects(
    projectId: string,
    options?: { limit?: number; minSimilarity?: number },
  ): SimilarProject[];

  /**
   * 注入历史教训到新项目
   * 在项目创建或规划阶段调用，自动注入相关教训
   */
  async injectLessons(
    projectId: string,
    options?: {
      categories?: string[];  // 过滤教训类别
      minImpact?: Lesson['impact'];
      limit?: number;
    },
  ): Promise<{
    injected: Lesson[];
    sourceProjects: string[];
  }>;

  /**
   * 获取跨项目经验摘要
   * 用于 LLM prompt 注入
   */
  getCrossProjectContext(
    projectId: string,
    focus?: string,
  ): string;

  /**
   * 按行业分类统计教训
   */
  getLessonsByCategory(): Record<string, Lesson[]>;
}
```

### 10.2 相似度算法

```typescript
function calcProjectSimilarity(a: Project, b: Project): number {
  let score = 0;

  // 1. category 匹配 (权重 0.3)
  if (a.category === b.category) score += 0.3;

  // 2. tags 重叠 (权重 0.3)
  const tagsA = new Set(a.tags);
  const tagsB = new Set(b.tags);
  const tagOverlap = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...tagsA, ...tagsB]).size;
  score += tagUnion > 0 ? (tagOverlap / tagUnion) * 0.3 : 0;

  // 3. requirements 关键词重叠 (权重 0.3)
  const kwA = extractRequirementKeywords(a.requirements);
  const kwB = extractRequirementKeywords(b.requirements);
  const kwOverlap = kwA.filter(k => kwB.has(k)).length;
  const kwUnion = new Set([...kwA, ...kwB]).size;
  score += kwUnion > 0 ? (kwOverlap / kwUnion) * 0.3 : 0;

  // 4. metadata 中的 technology 匹配 (权重 0.1)
  const techA = (a.metadata.technologies as string[]) ?? [];
  const techB = (b.metadata.technologies as string[]) ?? [];
  const techOverlap = techA.filter(t => techB.includes(t)).length;
  score += techA.length > 0 ? (techOverlap / Math.max(techA.length, techB.length)) * 0.1 : 0;

  return Math.min(1, score);
}
```

---

## 十一、FTS5 全文搜索（`src/project/search.ts`）

### 11.1 设计

```typescript
export interface SearchResult {
  entityType: 'project' | 'plan' | 'decision' | 'lesson' | 'artifact';
  entityId: string;
  projectId: string;
  title: string;
  snippet: string;      // 匹配片段（高亮）
  rank: number;         // FTS5 排序分
}

export class ProjectSearch {
  constructor(private store: ProjectStore) {}

  /**
   * 全文搜索（跨项目/决策/教训/产出物）
   */
  search(query: string, options?: {
    entityTypes?: string[];
    projectId?: string;
    limit?: number;
  }): SearchResult[];

  /**
   * 索引一条记录
   */
  index(entityType: string, entityId: string, title: string, content: string, tags: string[], projectId: string): void;

  /**
   * 重建索引
   */
  rebuildIndex(): void;
}
```

### 11.2 FTS5 查询示例

```sql
-- 搜索所有包含"性能优化"的项目/决策/教训
SELECT entity_type, entity_id, title, snippet(project_search_fts, 4, '<b>', '</b>', '...', 32) as snippet, rank
FROM project_search_fts
WHERE project_search_fts MATCH '性能优化'
ORDER BY rank
LIMIT 20;

-- 限定在某个项目内搜索
SELECT ... FROM project_search_fts
WHERE project_search_fts MATCH '性能优化' AND project_id = 'proj_xxx';
```

---

## 十二、系统集成（`src/project/integration.ts`）

### 12.1 与 STMP 集成

```typescript
/**
 * 每个项目自动创建一个 STMP 房间
 * 项目下的所有记忆、对话、决策都存入该房间
 */
export function integrateWithSTMP(project: Project, stmp: STMPStore): string {
  const roomId = `project-${project.id}`;
  stmp.createRoom(roomId, project.name, [project.category, ...project.tags]);
  return roomId;
}

/**
 * 项目相关记忆自动写入 STMP
 */
export function recordProjectMemory(
  stmp: STMPStore,
  projectId: string,
  content: string,
  concepts: string[],
  importance: number,
): void {
  const node: MemoryNode = {
    id: `proj-mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content,
    room: `project-${projectId}`,
    timestamp: Date.now(),
    temporalContext: { before: [], after: [] },
    concepts,
    relations: [],
    emotional: { valence: 0, importance },
    lifecycle: {
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
      decay: 1.0,
      compressed: false,
      hibernated: false,
    },
    source: 'extracted',
  };
  stmp.insertNode(node);
}
```

### 12.2 与 DreamEngine 集成

```typescript
/**
 * 项目完成后触发 Dream 巩固
 * 将项目记忆从短期转为长期
 */
export function triggerProjectDream(
  dream: DreamEngine,
  stmp: STMPStore,
  projectId: string,
): void {
  const roomId = `project-${projectId}`;
  // 触发该项目房间的记忆巩固
  dream.consolidateRoom(roomId);
}
```

### 12.3 与 ExperienceCompiler 集成

```typescript
/**
 * 项目成功完成后，编译项目经验
 * 将项目的"需求→方案→执行→结果"编译为可复用经验
 */
export async function compileProjectExperience(
  project: Project,
  plan: Plan,
  compiler: ExperienceCompiler,
  graph: ExperienceGraph,
): Promise<void> {
  // 构造 ConversationSnapshot
  const snapshot: ConversationSnapshot = {
    id: `proj-conv-${project.id}`,
    userMessage: `完成项目: ${project.name} - ${project.description}`,
    assistantReply: `已完成 ${plan.steps.length} 个步骤`,
    toolCalls: plan.steps
      .filter(s => s.tool && s.status === 'done')
      .map(s => ({
        name: s.tool!,
        args: s.args ?? {},
        result: s.output ?? 'done',
      })),
    timestamp: Date.now(),
    wasSuccessful: plan.steps.every(s => s.status === 'done' || s.status === 'skipped'),
  };

  if (compiler.canCompile(snapshot)) {
    const unit = compiler.compile(snapshot);
    if (unit) {
      graph.addNode(unit);
    }
  }
}
```

### 12.4 与 CognitiveEngine 集成

```typescript
/**
 * 项目完成后更新用户画像
 * 从项目中推断用户的技术栈、工作模式等
 */
export function updateCognitiveFromProject(
  cognitive: CognitiveEngine,
  project: Project,
): void {
  // 从项目 category 推断领域
  cognitive.updateDomainProfile(project.category, {
    conversationCount: cognitive.getDomainProfile(project.category).conversationCount + 1,
    lastActiveAt: Date.now(),
  });

  // 从 metadata.technologies 推断技术栈
  const techs = (project.metadata.technologies as string[]) ?? [];
  if (techs.length > 0) {
    const profile = cognitive.getUserProfile();
    const merged = new Set([...profile.identity.techStack, ...techs]);
    cognitive.updateUserField('identity', {
      ...profile.identity,
      techStack: [...merged],
    }, `项目 ${project.name} 中使用`);
  }
}
```

---

## 十三、工具暴露（`src/project/tools.ts`）

### 13.1 Agent 可调用的工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `project_create` | 创建新项目 | name, description, category, tags |
| `project_list` | 列出项目 | status?, category? |
| `project_get` | 获取项目详情 | projectId |
| `project_update` | 更新项目 | projectId, updates |
| `plan_create` | 创建方案 | projectId, title, requirements |
| `plan_new_version` | 创建方案新版本 | planId, changes, reason |
| `plan_get_versions` | 获取方案版本链 | projectId |
| `plan_diff` | 方案版本对比 | planIdA, planIdB |
| `decision_record` | 记录决策 | planId, question, options, chosen, reasoning |
| `execution_start` | 开始执行 | projectId, planId |
| `execution_pause` | 暂停执行 | projectId, reason? |
| `execution_resume` | 恢复执行 | projectId |
| `execution_status` | 查看执行状态 | projectId |
| `checkpoint_create` | 创建检查点 | projectId, note? |
| `checkpoint_list` | 列出检查点 | projectId, limit? |
| `artifact_create` | 创建产出物 | projectId, name, type, content? |
| `artifact_update` | 更新产出物 | artifactId, changes |
| `artifact_list` | 列出产出物 | projectId, type? |
| `lesson_record` | 记录教训 | projectId, category, title, description |
| `lesson_compile` | 编译教训到经验图谱 | lessonId |
| `cross_project_find` | 查找相似项目 | projectId |
| `cross_project_inject` | 注入历史教训 | projectId |
| `project_search` | 全文搜索 | query, entityTypes?, projectId? |
| `project_stats` | 项目统计 | projectId |

### 13.2 工具注册

```typescript
export const PROJECT_TOOLS: ToolDef[] = [
  project_create,
  project_list,
  project_get,
  project_update,
  plan_create,
  plan_new_version,
  plan_get_versions,
  plan_diff,
  decision_record,
  execution_start,
  execution_pause,
  execution_resume,
  execution_status,
  checkpoint_create,
  checkpoint_list,
  artifact_create,
  artifact_update,
  artifact_list,
  lesson_record,
  lesson_compile,
  cross_project_find,
  cross_project_inject,
  project_search,
  project_stats,
];
```

---

## 十四、实现顺序（Sprint 计划）

### Sprint 1：基础存储 + 项目 CRUD（3 天）

**目标**：能创建、查询、更新项目

1. `src/project/types.ts` — 类型定义
2. `src/project/store.ts` — SQLite 存储引擎 + Migration
3. `src/project/tools.ts` — project_create / project_list / project_get / project_update
4. `src/project/store.test.ts` — 存储引擎测试

**验收**：`project_create` 创建项目后，能在数据库中查到，STMP 房间自动创建。

### Sprint 2：方案管理 + 决策（2 天）

**目标**：能创建方案、版本管理、记录决策

1. `src/project/plan-manager.ts`
2. 工具：plan_create / plan_new_version / plan_get_versions / plan_diff / decision_record
3. `src/project/plan-manager.test.ts`

**验收**：创建方案 → 修改 → 新版本，能 diff 两个版本，决策记录可查。

### Sprint 3：执行管理 + 进度（3 天）

**目标**：能启动/暂停/恢复执行，有进度追踪

1. `src/project/progress-tracker.ts`
2. `src/project/execution-manager.ts`
3. 工具：execution_start / execution_pause / execution_resume / execution_status / checkpoint_create / checkpoint_list
4. `src/project/execution-manager.test.ts`

**验收**：启动执行 → 暂停 → 查看检查点 → 恢复，进度实时更新。

### Sprint 4：产出物 + 教训（2 天）

**目标**：产出物版本管理，教训提取与编译

1. `src/project/artifact-manager.ts`
2. `src/project/lesson-system.ts`
3. 工具：artifact_* / lesson_*
4. 工具：lesson_compile（教训→经验图谱）

**验收**：产出物可迭代版本，教训可编译为经验进入图谱。

### Sprint 5：跨项目 + 搜索 + 集成（2 天）

**目标**：跨项目查找、FTS5 搜索、与 STMP/Dream/Cognitive 集成

1. `src/project/cross-project.ts`
2. `src/project/search.ts`
3. `src/project/integration.ts`
4. 工具：cross_project_* / project_search / project_stats
5. `src/project/cross-project.test.ts`

**验收**：创建两个相似项目 → 跨项目查找 → 注入教训，FTS5 搜索可用。

### Sprint 6：E2E 测试 + 文档（1 天）

1. 完整生命周期 E2E 测试
2. 更新 `ARCHITECTURE.md`
3. 更新 `README.md`

**总计：约 13 天**

---

## 十五、与已有模块的接口对接点

| ProjectModel 功能 | 对接的已有模块 | 对接方式 |
|-------------------|---------------|---------|
| 项目记忆 | STMPStore | 每个项目 = 一个 STMP Room |
| 项目执行 | WorkflowManager | Plan.steps → DAG tasks |
| 决策记录 | DecisionMemory | Decision → DecisionRecord |
| 教训→经验 | ExperienceCompiler + ExperienceGraph | Lesson → ConversationSnapshot → ExperienceUnit |
| 项目梦 | DreamEngine | 项目完成时触发 consolidateRoom |
| 用户画像 | CognitiveEngine | 项目完成后推断 techStack / domain |
| 领域画像 | CognitiveEngine.updateDomainProfile | 项目 category → domain |
| FTS5 搜索 | 独立 project_search_fts 表 | 与 STMP 的 stmp_nodes_fts 并行 |

---

## 十六、风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| STMP 房间过多导致检索变慢 | 中 | 中 | 项目完成后压缩/归档房间 |
| 教训→经验编译质量不稳定 | 高 | 中 | 增加人工验证步骤 + 置信度阈值 |
| DAG 暂停/恢复丢失中间状态 | 低 | 高 | 每步完成都写检查点，恢复时校验 |
| FTS5 索引膨胀 | 低 | 低 | 定期 rebuild + 限制 content 长度 |
| 跨项目相似度算法不准 | 中 | 中 | 初期用简单算法，后续可用 LLM 增强 |

---

## 十七、关键设计决策

### Q1: 为什么不直接扩展现有模块？

**答**：ProjectModel 是一个**语义层**，不是存储层。STMP 存记忆，DAG 存执行，ExperienceGraph 存经验 —— 它们各自做好自己的事。ProjectModel 在它们之上提供"项目"这个语义概念，让 Agent 能理解"我正在做哪个项目，做到哪了，之前踩过什么坑"。

### Q2: 为什么每个项目一个 STMP 房间？

**答**：STMP 的房间机制天然适合项目隔离。每个项目有自己的房间，记忆自动按项目分组，检索时先定位房间再搜索，效率高且不混淆。同时跨房间的语义星图边支持跨项目关联。

### Q3: 教训为什么要编译为 ExperienceUnit？

**答**：教训如果不进入经验图谱，就只是数据库里的一行文字。编译为 ExperienceUnit 后：
1. 能被 ExperienceGraph.match() 匹配到
2. 能被 ExperienceRouter 路由执行
3. 能在 DAG 中自动应用（如"先 pull 再 push"模式）
4. 能跨项目复用

### Q4: 版本管理的粒度？

**答**：
- **方案**：每次有意义的修改创建新版本（类似 git commit）
- **产出物**：每次更新创建新版本（类似 git 文件版本）
- **不做的事**：不做全量快照（太浪费），只做增量链
