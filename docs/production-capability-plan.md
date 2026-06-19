# Buddy 生产能力提升 — 执行计划

> 目标：让 Buddy 具备"接到任务先确定工作环境，再规划执行"的生产能力
> 起因：游戏立项测试暴露的三层问题 — 环境感知缺失、资源画像粗糙、执行链路无闭环
> 原则：最小侵入、复用现有机制、渐进式改造

---

## 一、问题根因回顾

### 1.1 测试中暴露的问题链

```
"我想做一款游戏"
  → LLM 不知道 cwd 是哪里 → 相对路径写到 /tmp/buddy-sandbox/
  → 工具调用返回乱码 → LLM 产出 JSON 碎片
  → 经验路由选了 OCR 模型做游戏方案 → 能力不匹配
  → 工具返回"成功"但文件不存在 → 无闭环验证
  → 任务卡在 1/3 不结束 → 并发管理缺陷
```

### 1.2 根因归类

| 类别 | 根因 | 现状 |
|------|------|------|
| 环境感知 | 系统 Prompt / buildContext 未注入 cwd、项目结构、沙箱边界 | 完全缺失 |
| 资源画像 | ResourceProfile 只有统计维度，无能力标签 | 部分缺失 |
| 模型选择 | 经验路由命中后直接执行，无能力校验 | 有盲区 |
| 执行闭环 | 工具返回"成功"但不验证实际效果 | 缺失 |
| 任务管理 | 工具被拒后任务挂起，无超时降级 | 有缺陷 |

---

## 二、执行计划总览

### 阶段划分

```
Phase 0: 环境感知注入（P0 — 解决路径错位）
Phase 1: 资源能力画像（P1 — 提升模型选择准确率）
Phase 2: 经验路由能力校验（P2 — 防止错配模型）
Phase 3: 执行闭环验证（P3 — 确保工具实际生效）
Phase 4: 任务生命周期治理（P4 — 修复卡死问题）
```

### 依赖关系

```
Phase 0（独立）→ 可立即开始
Phase 1（独立）→ 可立即开始
Phase 2（依赖 Phase 1）→ Phase 1 完成后开始
Phase 3（依赖 Phase 0）→ Phase 0 完成后开始
Phase 4（独立）→ 可立即开始
```

---

## 三、Phase 0: 环境感知注入

### 3.1 目标

让 LLM 在第一次回复前就知道：
- 当前工作目录是什么
- 项目是什么类型（Node.js/Python/Go/...）
- 有哪些依赖可用
- 文件操作的边界在哪里（沙箱 vs 项目目录）

### 3.2 新增模块

**文件**: `src/core/env-probe.ts`

```typescript
/**
 * EnvironmentProbe — 环境探测器
 *
 * 职责：在 buildContext 阶段探测当前工作环境，
 * 生成结构化的环境摘要注入 LLM Prompt。
 *
 * 设计原则：
 * - 只探测，不修改
 * - 结果缓存（环境变化频率低）
 * - 失败静默（不影响主流程）
 */

export interface EnvironmentSnapshot {
  /** 当前工作目录（process.cwd()） */
  cwd: string;
  /** 沙箱工作目录（BuddyConfig.sandbox.workspace） */
  sandboxWorkspace: string;
  /** 文件操作的路径解析规则 */
  pathResolution: {
    relativeTo: 'sandbox' | 'cwd';
    allowedRoots: string[];
  };
  /** 项目信息（如果 cwd 下有项目） */
  project: ProjectInfo | null;
  /** 可用运行时 */
  runtimes: RuntimeInfo[];
  /** 可用包管理器 */
  packageManagers: PackageManagerInfo[];
}

export interface ProjectInfo {
  /** 项目名 */
  name: string;
  /** 项目类型 */
  type: 'node' | 'python' | 'go' | 'rust' | 'java' | 'mixed' | 'unknown';
  /** 主要语言 */
  languages: string[];
  /** 框架 */
  frameworks: string[];
  /** package.json 中的 scripts（Node 项目） */
  scripts: Record<string, string>;
  /** 主要依赖（前 20 个） */
  dependencies: string[];
  /** 是否有 tsconfig.json */
  hasTypeScript: boolean;
  /** 是否有测试框架 */
  testFramework: string | null;
  /** 是否有 Docker */
  hasDocker: boolean;
  /** 是否有 Git */
  hasGit: boolean;
  /** 当前 Git 分支 */
  gitBranch: string | null;
}

export interface RuntimeInfo {
  name: string;
  version: string;
  available: boolean;
}

export interface PackageManagerInfo {
  name: string;
  lockFile: string | null;
  available: boolean;
}
```

### 3.3 实现细节

**探测逻辑**:

```typescript
export class EnvironmentProbe {
  private cache: EnvironmentSnapshot | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 分钟缓存

  async probe(config: BuddyConfig): Promise<EnvironmentSnapshot> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) return this.cache;

    const cwd = process.cwd();
    const sandboxWorkspace = config.sandbox.workspace;

    const [project, runtimes, packageManagers] = await Promise.all([
      this.probeProject(cwd),
      this.probeRuntimes(),
      this.probePackageManagers(cwd),
    ]);

    const snapshot: EnvironmentSnapshot = {
      cwd,
      sandboxWorkspace,
      pathResolution: {
        relativeTo: 'sandbox',
        allowedRoots: [cwd, sandboxWorkspace, '/tmp', '/var/tmp'],
      },
      project,
      runtimes,
      packageManagers,
    };

    this.cache = snapshot;
    this.cacheExpiry = now + this.CACHE_TTL_MS;
    return snapshot;
  }

  private async probeProject(cwd: string): Promise<ProjectInfo | null> {
    // 复用现有 scan_project 的逻辑，但提取为轻量级探测
    // 不调用工具，直接读文件
  }

  private async probeRuntimes(): Promise<RuntimeInfo[]> {
    // 探测 node, python3, go, rustc, java 是否可用及版本
  }

  private async probePackageManagers(cwd: string): Promise<PackageManagerInfo[]> {
    // 探测 npm, pnpm, yarn, bun, pip, go mod 是否可用
  }
}
```

### 3.4 注入点

**文件**: `src/core/message-processor.ts` — `buildContext()` 方法

在 Prompt 预算管理器中新增一个 segment：

```typescript
// ─── 环境感知（静态层，优先级 85 — 高于人格，低于安全指令）───
const envProbe = this.sys.envProbe;
if (envProbe) {
  const env = await envProbe.probe(this.config);
  const envPrompt = this.buildEnvironmentPrompt(env);
  budget.add({
    id: 'environment',
    source: 'env-probe',
    priority: 85,  // PRIORITY.ENVIRONMENT — 新增常量
    content: envPrompt,
    required: true,  // 环境信息必须保留
  });
}
```

**注入 Prompt 格式**:

```
## 工作环境

- 当前工作目录: /home/work/.openclaw/workspace/buddy
- 沙箱目录: /tmp/buddy-sandbox
- 文件操作规则: 相对路径基于沙箱目录解析，绝对路径直接使用
- 允许的路径范围: /home/work/.openclaw/workspace/buddy, /tmp/buddy-sandbox, /tmp

### 项目信息
- 项目名: buddy-ai v0.2.0
- 类型: Node.js (TypeScript)
- 框架: Vite (前端), Express (后端)
- 包管理: npm (有 package-lock.json)
- 测试: vitest
- Git: main 分支

### 可用运行时
- Node.js v22.22.3 ✅
- Python 3.x ✅
- Go ❌
- Rust ❌

### 重要提示
- 创建文件时，使用 write_file 工具，路径基于沙箱目录
- 如果要在项目目录下创建文件，使用绝对路径: /home/work/.openclaw/workspace/buddy/xxx
- 执行命令时，工作目录为: /home/work/.openclaw/workspace/buddy
```

### 3.5 路径解析修复

**文件**: `src/tools/builtin.ts`

修改 `resolveFilePath()` 函数，使其更智能：

```typescript
function resolveFilePath(filePath: string, context?: { cwd?: string }): string {
  if (path.isAbsolute(filePath)) return filePath;

  // 新增：如果路径以已知项目目录开头，基于项目目录解析
  const projectRoot = context?.cwd ?? process.cwd();
  const projectResolved = path.resolve(projectRoot, filePath);
  if (fss.existsSync(projectResolved)) return projectResolved;

  // 回退：基于沙箱目录解析
  return path.resolve(SANDBOX_WORKSPACE, filePath);
}
```

### 3.6 验收标准

- [ ] LLM 第一次回复中能正确引用当前工作目录
- [ ] 创建文件时使用正确的路径（项目目录而非沙箱）
- [ ] 环境探测结果在 1 分钟内缓存，不重复探测
- [ ] 环境探测失败不影响主流程

---

## 四、Phase 1: 资源能力画像

### 4.1 目标

给每个资源（模型/工具/专家）增加能力标签，让模型选择不只是"成功率高"，还要"能力匹配"。

### 4.2 扩展 ResourceProfile

**文件**: `src/brain/hub/resource-hub.ts`

```typescript
export interface ResourceProfile {
  id: string;
  type: 'model' | 'tool' | 'expert' | 'knowledge_source';
  name: string;

  // 现有：统计数据
  stats: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    totalCost: number;
    lastUsedAt: number;
  };

  // 现有：擅长任务（从 DecisionRecorder 学习）
  strengths: {
    taskTypes: Record<string, { attempts: number; successes: number }>;
    domains: Record<string, { attempts: number; successes: number }>;
  };

  // 新增：能力标签
  capabilities: ResourceCapabilities;

  // 新增：任务类型亲和度（从 recordOutcome 学习）
  affinity: Record<string, number>;  // { 'reasoning': 0.9, 'ocr': 0.3 }

  // 状态
  status: 'active' | 'degraded' | 'unavailable' | 'unknown';
  healthScore: number;
  lastHealthCheck: number;
}

export interface ResourceCapabilities {
  /** 是否支持工具调用（function calling） */
  toolCalling: boolean;
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 是否支持视觉输入 */
  vision: boolean;
  /** 最大上下文 token 数 */
  maxContextTokens: number;
  /** 最大输出 token 数 */
  maxOutputTokens: number;
  /** 擅长的任务类型（静态标签，从模型文档/探测获取） */
  strongAt: TaskType[];
  /** 不擅长的任务类型 */
  weakAt: TaskType[];
  /** 是否支持中文 */
  chineseSupport: boolean;
  /** 响应速度等级: fast | medium | slow */
  speedTier: 'fast' | 'medium' | 'slow';
}
```

### 4.3 亲和度学习

**文件**: `src/brain/hub/resource-hub.ts` — 扩展 `recordOutcome()`

```typescript
recordOutcome(id: string, outcome: ResourceOutcome): void {
  const profile = this.profiles.get(id);
  if (!profile) return;

  // 现有：更新统计数据
  // ...

  // 新增：更新亲和度
  if (outcome.taskType) {
    const current = profile.affinity[outcome.taskType] ?? 0.5;
    // 指数移动平均：新结果权重 0.3
    const newValue = outcome.success
      ? current * 0.7 + 1.0 * 0.3
      : current * 0.7 + 0.0 * 0.3;
    profile.affinity[outcome.taskType] = Math.max(0, Math.min(1, newValue));
  }
}
```

### 4.4 静态能力注入

**文件**: `src/core/model-enrichment.ts`

在模型探测阶段，从 API 响应中提取能力标签：

```typescript
// 从 SiliconFlow/OpenAI API 响应中提取
function extractCapabilities(response: ModelProbeResult): Partial<ResourceCapabilities> {
  return {
    toolCalling: response.capabilities?.toolCalling ?? false,
    streaming: response.capabilities?.streaming ?? false,
    vision: response.capabilities?.vision ?? false,
    maxContextTokens: response.contextWindow ?? 32000,
    maxOutputTokens: response.maxOutputTokens ?? 4096,
  };
}
```

### 4.5 推荐算法升级

**文件**: `src/brain/hub/resource-hub.ts` — 升级 `recommend()`

```typescript
recommend(taskType: string, domain?: string, options?: {
  requireToolCalling?: boolean;
  minAffinity?: number;
  maxLatencyMs?: number;
}): ResourceProfile[] {
  const candidates = this.getActive();

  const scored = candidates.map(p => {
    let score = 0;

    // 1. 亲和度（新增，权重 40）
    const affinity = p.affinity[taskType] ?? 0.5;
    score += affinity * 40;

    // 2. 任务类型成功率（现有，权重 30）
    const typeStats = p.strengths.taskTypes[taskType];
    if (typeStats && typeStats.attempts > 0) {
      score += (typeStats.successes / typeStats.attempts) * 30;
    }

    // 3. 领域匹配（现有，权重 20）
    if (domain) {
      const domainStats = p.strengths.domains[domain];
      if (domainStats && domainStats.attempts > 0) {
        score += (domainStats.successes / domainStats.attempts) * 20;
      }
    }

    // 4. 能力匹配（新增，权重 10）
    if (options?.requireToolCalling && !p.capabilities.toolCalling) {
      score *= 0.1; // 不支持工具调用的模型大幅降权
    }

    return { profile: p, score };
  });

  return scored
    .filter(s => s.score >= (options?.minAffinity ?? 0) * 100)
    .sort((a, b) => b.score - a.score)
    .map(s => s.profile);
}
```

### 4.6 验收标准

- [ ] ResourceProfile 包含 capabilities 字段
- [ ] 亲和度随执行结果自动学习
- [ ] recommend() 返回结果按亲和度排序
- [ ] 不支持工具调用的模型不会被选中执行工具任务

---

## 五、Phase 2: 经验路由能力校验

### 5.1 目标

经验路由命中后，不直接执行，先校验推荐模型的能力是否匹配当前任务。

### 5.2 修改点

**文件**: `src/brain/left/scheduler.ts`

在经验路由命中后增加能力校验层：

```typescript
// 现有代码（约 line 581-594）
if (resources.experienceHit) {
  const hit = resources.experienceHit;
  
  // 新增：能力校验
  const taskType = inferTaskType(signal.content);
  const recommendedModelId = hit.model; // 经验推荐的模型
  const modelProfile = resourceHub.getById(recommendedModelId);
  
  if (modelProfile) {
    const affinity = modelProfile.affinity[taskType] ?? 0.5;
    const capabilities = modelProfile.capabilities;
    
    // 校验 1: 亲和度过低
    if (affinity < 0.3) {
      return this.selectViaRouter('llm_with_hint', signal, body,
        `经验推荐 ${recommendedModelId} 但亲和度 ${affinity.toFixed(2)} 过低(${taskType}), 路由器重选`);
    }
    
    // 校验 2: 任务需要工具调用但模型不支持
    if (taskType === 'tools' && !capabilities.toolCalling) {
      return this.selectViaRouter('llm_with_hint', signal, body,
        `经验推荐 ${recommendedModelId} 但不支持工具调用, 路由器重选`);
    }
    
    // 校验 3: 任务需要推理但模型推理能力弱
    if (taskType === 'reasoning' && capabilities.weakAt?.includes('reasoning')) {
      return this.selectViaRouter('llm_with_hint', signal, body,
        `经验推荐 ${recommendedModelId} 但推理能力弱, 路由器重选`);
    }
  }
  
  // 能力校验通过，使用经验推荐
  // ... 现有逻辑
}
```

### 5.3 经验记录增强

**文件**: `src/core/experience-loop.ts`

在编译经验时，记录模型能力要求：

```typescript
interface ExperienceRecord {
  // 现有字段
  id: string;
  input: string;
  output: string;
  tools: string[];
  
  // 新增：能力要求
  requirements: {
    taskType: TaskType;
    requiresToolCalling: boolean;
    requiresVision: boolean;
    minContextTokens: number;
    preferredCapabilities: string[];  // ['reasoning', 'code-gen', 'chinese']
  };
}
```

### 5.4 验收标准

- [ ] 经验路由命中后，校验模型亲和度 ≥ 0.3
- [ ] 工具任务不选择不支持 toolCalling 的模型
- [ ] 推理任务不选择推理能力弱的模型
- [ ] 校验失败时，降级到路由器重新选择

---

## 六、Phase 3: 执行闭环验证

### 6.1 目标

工具执行后，验证实际效果，而不只看返回值。

### 6.2 新增验证器

**文件**: `src/tools/execution-verifier.ts`

```typescript
/**
 * 执行验证器 — 工具执行后验证实际效果
 *
 * 设计原则：
 * - 只验证可验证的操作（文件创建、命令执行）
 * - 失败不阻塞，但记录到教训系统
 * - 超时自动跳过
 */

export interface VerificationResult {
  verified: boolean;
  actualEffect: string;
  discrepancy: string | null;
}

export class ExecutionVerifier {
  constructor(
    private sandbox: string,
    private projectRoot: string,
  ) {}

  async verify(toolName: string, args: Record<string, unknown>, result: string): Promise<VerificationResult> {
    switch (toolName) {
      case 'write_file':
        return this.verifyFileWrite(args.path as string, result);
      case 'exec':
        return this.verifyExec(args.command as string, result);
      case 'mkdir':
        return this.verifyMkdir(args.path as string, result);
      default:
        return { verified: true, actualEffect: '无验证逻辑', discrepancy: null };
    }
  }

  private async verifyFileWrite(expectedPath: string, result: string): Promise<VerificationResult> {
    // 1. 从结果中提取实际写入路径
    const match = result.match(/\[已写入 (.+?)，/);
    if (!match) return { verified: false, actualEffect: '无法从结果中提取路径', discrepancy: '结果格式异常' };
    
    const actualPath = match[1];
    
    // 2. 检查文件是否存在
    try {
      const stat = await fs.stat(actualPath);
      return {
        verified: stat.isFile(),
        actualEffect: `文件存在: ${actualPath} (${stat.size} bytes)`,
        discrepancy: null,
      };
    } catch {
      return {
        verified: false,
        actualEffect: `文件不存在: ${actualPath}`,
        discrepancy: `write_file 返回"成功"但文件不存在`,
      };
    }
  }

  private async verifyExec(command: string, result: string): Promise<VerificationResult> {
    // 检查退出码和关键输出
    const hasError = result.includes('Error') || result.includes('error:');
    return {
      verified: !hasError,
      actualEffect: result.slice(0, 200),
      discrepancy: hasError ? '输出中包含错误信息' : null,
    };
  }

  private async verifyMkdir(expectedPath: string, result: string): Promise<VerificationResult> {
    try {
      const stat = await fs.stat(expectedPath);
      return {
        verified: stat.isDirectory(),
        actualEffect: `目录存在: ${expectedPath}`,
        discrepancy: null,
      };
    } catch {
      return {
        verified: false,
        actualEffect: `目录不存在: ${expectedPath}`,
        discrepancy: 'mkdir 返回成功但目录不存在',
      };
    }
  }
}
```

### 6.3 集成点

**文件**: `src/core/llm.ts` — 工具执行后调用验证器

```typescript
// 在 executeSingleTool 后增加验证
const result = await llmMiddleware.execute({ toolName, args, source: 'llm' });

// 新增：执行验证
if (this.executionVerifier && result.success) {
  const verification = await this.executionVerifier.verify(toolName, args, result.result);
  if (!verification.discrepancy) {
    // 验证通过，记录正反馈
    this.decisionRecorder.recordToolOutcome(toolName, true, verification.actualEffect);
  } else {
    // 验证失败，记录到教训系统
    console.warn(`[Verify] ${toolName}: ${verification.discrepancy}`);
    result.result += `\n⚠️ 验证警告: ${verification.discrepancy}`;
  }
}
```

### 6.4 验收标准

- [ ] write_file 后验证文件是否存在
- [ ] exec 后检查输出中是否有错误
- [ ] 验证失败时，结果中包含警告信息
- [ ] 验证超时（2 秒）不阻塞主流程

---

## 七、Phase 4: 任务生命周期治理

### 7.1 目标

修复工具被拒后任务卡死、并发任务管理缺陷等问题。

### 7.2 问题分析

**现有机制**:
```typescript
// agent.ts:51
private static readonly CONFIRM_TIMEOUT_MS = 30_000;

// agent.ts:332
setTimeout(() => {
  if (this.ws.getPendingConfirm(confirmId)) {
    this.ws.removePendingConfirm(confirmId);
    resolve(false);  // 超时 → 拒绝
  }
}, BuddyAgent.CONFIRM_TIMEOUT_MS);
```

**问题**:
1. 工具被拒后，LLM 收到 `[已拦截]` 但可能不理解为什么，继续重试
2. 并发任务数限制（`maxConcurrent`）在 `ConcurrencyLimiter` 中，但 `ExecutionSession` 的状态管理独立
3. 任务卡在 `1/3` 的根因：LLM 调用超时但 session 未释放

### 7.3 修复方案

**7.3.1 工具被拒后的智能降级**

**文件**: `src/core/llm.ts`

```typescript
// 在工具执行结果注入时
for (const r of results) {
  const resultStr = r.result;
  
  // 新增：工具被拒后的降级提示
  if (resultStr.startsWith('[已拦截')) {
    const rejectHint = this.buildRejectHint(r.name, resultStr);
    currentMessages.push({ role: 'user', content: `工具 ${r.name} 返回: ${resultStr}\n${rejectHint}` });
  } else {
    currentMessages.push({ role: 'user', content: `工具 ${r.name} 返回: ${resultStr}` });
  }
}

private buildRejectHint(toolName: string, reason: string): string {
  return `\n💡 提示: ${toolName} 被用户拒绝。不要重试该工具，而是：
1. 告诉用户为什么需要这个操作
2. 询问用户是否愿意手动执行
3. 尝试用其他方式完成任务（如果可能）`;
}
```

**7.3.2 ExecutionSession 超时治理**

**文件**: `src/core/execution-session.ts`

```typescript
// 新增：步骤级超时
addStep(type: string, context: Record<string, unknown>): StepHandle {
  const step = { /* ... */ };
  
  // 新增：步骤超时定时器
  step.timeoutTimer = setTimeout(() => {
    if (step.status === 'running') {
      this.failStep(step.id, '步骤超时');
      this.eventBus?.emit({
        type: 'step_timeout',
        sessionId: this.id,
        stepId: step.id,
        stepType: type,
      });
    }
  }, this.config.stepTimeoutMs ?? 60_000);
  
  return step;
}
```

**7.3.3 并发任务清理**

**文件**: `src/core/concurrency-limiter.ts`

```typescript
// 新增：强制清理僵尸任务
releaseExpired(maxAgeMs: number): number {
  const now = Date.now();
  let released = 0;
  for (const [taskId, entry] of this.active) {
    if (now - entry.startTime > maxAgeMs) {
      this.active.delete(taskId);
      this.queue = this.queue.filter(q => q.taskId !== taskId);
      released++;
      console.warn(`[Concurrency] 强制释放僵尸任务: ${taskId} (${now - entry.startTime}ms)`);
    }
  }
  if (released > 0) this.processQueue();
  return released;
}
```

### 7.4 验收标准

- [ ] 工具被拒后，LLM 不重试同一工具
- [ ] 步骤超时（60 秒）自动释放
- [ ] 僵尸任务（> 5 分钟）自动清理
- [ ] 并发任务数正确限制

---

## 八、实施顺序与时间估算

```
Week 1: Phase 0（环境感知注入）
  - Day 1-2: EnvironmentProbe 实现
  - Day 3: buildContext 集成
  - Day 4: 路径解析修复
  - Day 5: 测试验收

Week 2: Phase 1（资源能力画像）
  - Day 1-2: ResourceProfile 扩展
  - Day 3: 亲和度学习
  - Day 4: 推荐算法升级
  - Day 5: 测试验收

Week 3: Phase 2 + Phase 3（能力校验 + 执行验证）
  - Day 1-2: 经验路由能力校验
  - Day 3-4: ExecutionVerifier
  - Day 5: 集成测试

Week 4: Phase 4 + 回归测试
  - Day 1-2: 任务生命周期治理
  - Day 3-5: 全链路回归测试
```

---

## 九、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 环境探测增加延迟 | 中 | 低 | 1 分钟缓存，异步探测 |
| 能力画像数据不足 | 高 | 中 | 冷启动用静态标签，运行时学习 |
| 验证器误判 | 低 | 低 | 验证失败只警告不阻塞 |
| 改动引入回归 | 中 | 高 | 每个 Phase 独立可回滚 |

---

## 十、验收标准总览

### 10.1 功能验收

- [ ] "我想做一款游戏" → Buddy 知道 cwd，文件创建到正确位置
- [ ] 经验路由不会选 OCR 模型做游戏方案
- [ ] 工具返回"成功"后，验证文件确实存在
- [ ] 工具被拒后，Buddy 不重试，而是解释原因
- [ ] 任务不会卡在 1/3 不结束

### 10.2 性能验收

- [ ] 环境探测 < 100ms（缓存命中 < 1ms）
- [ ] 能力校验 < 10ms
- [ ] 执行验证 < 2000ms（超时跳过）
- [ ] 整体延迟增加 < 5%

### 10.3 兼容性验收

- [ ] 现有测试全部通过
- [ ] 旧配置文件兼容
- [ ] 旧经验数据可迁移
