/**
 * ProjectModel — Agent 工具定义
 *
 * 暴露给 Agent 的项目管理工具。
 * Sprint 1: 项目 CRUD
 * Sprint 2+: 方案、执行、产出物、教训、跨项目、搜索
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ToolDef } from '../types.js';
import { ProjectStore } from './store.js';
import type { Project, PlanStep } from './types.js';
import { PlanManager } from './plan-manager.js';
import { ProjectProgressTracker } from './progress-tracker.js';
import { ExecutionManager } from './execution-manager.js';
import { ArtifactManager } from './artifact-manager.js';
import { LessonSystem } from './lesson-system.js';
import { CrossProjectManager } from './cross-project.js';
import { ProjectSearch } from './search.js';
import { IntegrationManager, type IntegrationDeps } from './integration.js';

// ==================== 全局 Store 实例 ====================

let _store: ProjectStore | null = null;

export function getProjectStore(dataDir?: string): ProjectStore {
  if (!_store) {
    const dir = dataDir ?? `${process.env.HOME ?? '/tmp'}/.buddy`;
    _store = new ProjectStore(`${dir}/project.db`);
  }
  return _store;
}

// ==================== 全局 PlanManager 实例 ====================

let _planManager: PlanManager | null = null;

export function getPlanManager(): PlanManager {
  if (!_planManager) {
    _planManager = new PlanManager(getProjectStore());
  }
  return _planManager;
}

// ==================== 全局 ProgressTracker / ExecutionManager 实例 ====================

let _progressTracker: ProjectProgressTracker | null = null;
let _executionManager: ExecutionManager | null = null;

export function getProgressTracker(): ProjectProgressTracker {
  if (!_progressTracker) {
    _progressTracker = new ProjectProgressTracker(getProjectStore());
  }
  return _progressTracker;
}

export function getExecutionManager(): ExecutionManager {
  if (!_executionManager) {
    _executionManager = new ExecutionManager(getProjectStore(), getProgressTracker());
  }
  return _executionManager;
}

// ==================== 全局 ArtifactManager / LessonSystem 实例 ====================

let _artifactManager: ArtifactManager | null = null;
let _lessonSystem: LessonSystem | null = null;

export function getArtifactManager(): ArtifactManager {
  if (!_artifactManager) {
    _artifactManager = new ArtifactManager(getProjectStore());
  }
  return _artifactManager;
}

export function getLessonSystem(): LessonSystem {
  if (!_lessonSystem) {
    _lessonSystem = new LessonSystem(getProjectStore());
  }
  return _lessonSystem;
}

// ==================== 全局 CrossProject / Search / Integration 实例 ====================

let _crossProject: CrossProjectManager | null = null;
let _projectSearch: ProjectSearch | null = null;
let _integrationManager: IntegrationManager | null = null;

export function getCrossProjectManager(): CrossProjectManager {
  if (!_crossProject) {
    _crossProject = new CrossProjectManager(getProjectStore());
  }
  return _crossProject;
}

export function getProjectSearch(): ProjectSearch {
  if (!_projectSearch) {
    _projectSearch = new ProjectSearch(getProjectStore());
  }
  return _projectSearch;
}

export function getIntegrationManager(): IntegrationManager {
  if (!_integrationManager) {
    _integrationManager = new IntegrationManager(getProjectStore());
  }
  return _integrationManager;
}

/**
 * 注入集成依赖 — 由 Subsystems 初始化时调用
 *
 * 接通 STMPStore / DreamEngine / CognitiveEngine / ExperienceCompiler
 */
export function setIntegrationDeps(deps: IntegrationDeps): void {
  getIntegrationManager().setDeps(deps);
}

// ==================== 工具：创建项目 ====================

export const project_create: ToolDef = {
  name: 'project_create',
  description: '创建新项目。可指定名称、描述、行业类别、标签。隐式项目由 Agent 自动创建，显式项目由用户创建。',
  parameters: z.object({
    name: z.string().describe('项目名称'),
    description: z.string().optional().describe('项目描述'),
    category: z.enum(['web', 'mobile', 'data', 'devops', 'research', 'design', 'other'])
      .optional().describe('行业类别'),
    tags: z.array(z.string()).optional().describe('标签列表'),
    origin: z.enum(['implicit', 'explicit']).optional().describe('来源：implicit=Agent自动, explicit=用户创建'),
    requirements: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    })).optional().describe('初始需求列表'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const now = Date.now();
    const id = `proj_${randomUUID().slice(0, 8)}`;

    const requirements = (args.requirements as Array<{ title: string; description?: string; priority?: string }>)?.map(r => ({
      id: `req_${randomUUID().slice(0, 8)}`,
      title: r.title,
      description: r.description ?? '',
      priority: (r.priority ?? 'medium') as 'critical' | 'high' | 'medium' | 'low',
      status: 'proposed' as const,
      acceptanceCriteria: [],
      createdAt: now,
    })) ?? [];

    const project: Project = {
      id,
      name: args.name as string,
      description: (args.description as string) ?? '',
      category: (args.category as string) ?? 'other',
      tags: (args.tags as string[]) ?? [],
      status: 'planning',
      origin: (args.origin as 'implicit' | 'explicit') ?? 'explicit',
      requirements,
      stmpRoomId: `project-${id}`,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    store.createProject(project);

    const lines = [
      `✅ 项目已创建`,
      `  ID: ${project.id}`,
      `  名称: ${project.name}`,
      `  类别: ${project.category}`,
      `  来源: ${project.origin === 'implicit' ? '隐式（自动）' : '显式（用户）'}`,
    ];
    if (project.tags.length > 0) lines.push(`  标签: ${project.tags.join(', ')}`);
    if (requirements.length > 0) lines.push(`  需求: ${requirements.length} 条`);
    return lines.join('\n');
  },
};

// ==================== 工具：列出项目 ====================

export const project_list: ToolDef = {
  name: 'project_list',
  description: '列出所有项目，可按状态、类别、来源过滤。',
  parameters: z.object({
    status: z.enum(['planning', 'active', 'paused', 'completed', 'archived']).optional().describe('按状态过滤'),
    category: z.string().optional().describe('按类别过滤'),
    origin: z.enum(['implicit', 'explicit']).optional().describe('按来源过滤'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const projects = store.listProjects({
      status: args.status as string | undefined,
      category: args.category as string | undefined,
      origin: args.origin as string | undefined,
    });

    if (projects.length === 0) return '📋 暂无项目';

    const lines = [`📋 项目列表 (${projects.length} 个):\n`];
    for (const p of projects) {
      const statusIcon = { planning: '📝', active: '🚀', paused: '⏸️', completed: '✅', archived: '📦' }[p.status] ?? '❓';
      const originIcon = p.origin === 'implicit' ? '🤖' : '👤';
      lines.push(`${statusIcon}${originIcon} ${p.id} | ${p.name} | ${p.category} | ${p.status}`);
      if (p.requirements.length > 0) {
        lines.push(`   需求: ${p.requirements.length} 条`);
      }
    }
    return lines.join('\n');
  },
};

// ==================== 工具：获取项目详情 ====================

export const project_get: ToolDef = {
  name: 'project_get',
  description: '获取项目的详细信息，包括需求列表、当前方案、进度、统计。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const project = store.getProject(args.projectId as string);
    if (!project) return `[项目不存在: ${args.projectId}]`;

    const stats = store.getProjectStats(project.id);
    const progress = stats.currentProgress;

    const lines = [
      `📁 项目详情: ${project.name}`,
      `  ID: ${project.id}`,
      `  描述: ${project.description || '(无)'}`,
      `  类别: ${project.category}`,
      `  状态: ${project.status}`,
      `  来源: ${project.origin === 'implicit' ? '隐式' : '显式'}`,
      `  标签: ${project.tags.length > 0 ? project.tags.join(', ') : '(无)'}`,
      `  创建: ${new Date(project.createdAt).toLocaleString('zh-CN')}`,
      `  更新: ${new Date(project.updatedAt).toLocaleString('zh-CN')}`,
    ];

    if (project.requirements.length > 0) {
      lines.push(`\n📋 需求 (${project.requirements.length}):`);
      for (const r of project.requirements) {
        const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[r.priority] ?? '⚪';
        lines.push(`  ${icon} ${r.title} [${r.status}]`);
      }
    }

    if (progress) {
      lines.push(`\n📊 进度: ${progress.percentComplete.toFixed(1)}% (${progress.completedSteps}/${progress.totalSteps})`);
    }

    lines.push(`\n📈 统计: ${stats.totalPlans} 方案 | ${stats.totalDecisions} 决策 | ${stats.totalArtifacts} 产出物 | ${stats.totalLessons} 教训`);

    return lines.join('\n');
  },
};

// ==================== 工具：更新项目 ====================

export const project_update: ToolDef = {
  name: 'project_update',
  description: '更新项目信息（名称、描述、状态、标签等）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    name: z.string().optional().describe('新名称'),
    description: z.string().optional().describe('新描述'),
    status: z.enum(['planning', 'active', 'paused', 'completed', 'archived']).optional().describe('新状态'),
    category: z.string().optional().describe('新类别'),
    tags: z.array(z.string()).optional().describe('新标签'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const project = store.getProject(args.projectId as string);
    if (!project) return `[项目不存在: ${args.projectId}]`;

    const updates: Partial<Project> = {};
    if (args.name) updates.name = args.name as string;
    if (args.description) updates.description = args.description as string;
    if (args.status) {
      updates.status = args.status as Project['status'];
      if (updates.status === 'completed') updates.completedAt = Date.now();
    }
    if (args.category) updates.category = args.category as string;
    if (args.tags) updates.tags = args.tags as string[];

    store.updateProject(project.id, updates);

    return `✅ 项目 ${project.id} 已更新: ${Object.keys(updates).join(', ')}`;
  },
};

// ==================== 工具：删除项目 ====================

export const project_delete: ToolDef = {
  name: 'project_delete',
  description: '删除项目及其所有关联数据（方案、检查点、产出物、教训）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    confirm: z.boolean().optional().describe('确认删除'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    if (!args.confirm) return '⚠️ 请设置 confirm=true 确认删除此项目及其所有数据。';

    const store = getProjectStore();
    const project = store.getProject(args.projectId as string);
    if (!project) return `[项目不存在: ${args.projectId}]`;

    store.deleteProject(project.id);
    return `🗑️ 项目 "${project.name}" (${project.id}) 及其所有关联数据已删除。`;
  },
};

// ==================== 工具：创建方案 ====================

export const plan_create: ToolDef = {
  name: 'plan_create',
  description: '为项目创建方案（初版）。可从需求自动生成步骤，也可手动指定步骤。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    title: z.string().describe('方案标题'),
    description: z.string().optional().describe('方案描述'),
    steps: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      tool: z.string().optional(),
      deps: z.array(z.string()).optional(),
    })).optional().describe('手动指定步骤（不填则从需求自动生成）'),
    estimatedDurationMs: z.number().optional().describe('预估耗时（毫秒）'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const pm = getPlanManager();

    const project = store.getProject(args.projectId as string);
    if (!project) return `[项目不存在: ${args.projectId}]`;

    const steps = (args.steps as Array<{ title: string; description?: string; tool?: string; deps?: string[] }>)?.map(s => ({
      id: `step_${randomUUID().slice(0, 8)}`,
      title: s.title,
      description: s.description ?? '',
      tool: s.tool,
      deps: s.deps ?? [],
      status: 'pending' as const,
    }));

    const plan = pm.createPlan(project.id, args.title as string, {
      description: args.description as string,
      requirements: project.requirements,
      steps,
      estimatedDurationMs: args.estimatedDurationMs as number,
    });

    return [
      `✅ 方案已创建`,
      `  ID: ${plan.id}`,
      `  标题: ${plan.title}`,
      `  版本: v${plan.version}`,
      `  步骤: ${plan.steps.length} 个`,
      `  决策: ${plan.decisions.length} 条`,
    ].join('\n');
  },
};

// ==================== 工具：创建方案新版本 ====================

export const plan_new_version: ToolDef = {
  name: 'plan_new_version',
  description: '基于当前方案创建新版本。旧版本自动标记为 superseded。',
  parameters: z.object({
    planId: z.string().describe('当前方案 ID'),
    title: z.string().optional().describe('新标题'),
    description: z.string().optional().describe('新描述'),
    steps: z.array(z.object({
      id: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      tool: z.string().optional(),
      deps: z.array(z.string()).optional(),
    })).optional().describe('新步骤列表（不填则沿用）'),
    reason: z.string().describe('变更原因（必填）'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const pm = getPlanManager();

    let steps: PlanStep[] | undefined;
    if (args.steps) {
      steps = (args.steps as Array<{ id?: string; title: string; description?: string; tool?: string; deps?: string[] }>).map(s => ({
        id: s.id ?? `step_${randomUUID().slice(0, 8)}`,
        title: s.title,
        description: s.description ?? '',
        tool: s.tool,
        deps: s.deps ?? [],
        status: 'pending' as const,
      }));
    }

    try {
      const plan = pm.createNewVersion(args.planId as string, {
        title: args.title as string,
        description: args.description as string,
        steps,
        reason: args.reason as string,
      });

      return [
        `✅ 方案新版本已创建`,
        `  ID: ${plan.id}`,
        `  标题: ${plan.title}`,
        `  版本: v${plan.version}`,
        `  步骤: ${plan.steps.length} 个`,
        `  基于: ${plan.parentVersionId}`,
      ].join('\n');
    } catch (e: unknown) {
      return `[创建失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：获取方案版本链 ====================

export const plan_get_versions: ToolDef = {
  name: 'plan_get_versions',
  description: '获取项目的所有方案版本（从最早到最新）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const pm = getPlanManager();
    const versions = pm.getVersionChain(args.projectId as string);

    if (versions.length === 0) return '📋 该项目暂无方案';

    const lines = [`📋 方案版本链 (${versions.length} 个):\n`];
    for (const p of versions) {
      const statusIcon = { draft: '📝', approved: '✅', executing: '🚀', completed: '✅', superseded: '⏭️' }[p.status] ?? '❓';
      const current = p.status !== 'superseded' ? ' ← 当前' : '';
      lines.push(`${statusIcon} v${p.version} | ${p.id} | ${p.title} [${p.status}]${current}`);
      lines.push(`   步骤: ${p.steps.length} | 决策: ${p.decisions.length} | 创建: ${new Date(p.createdAt).toLocaleString('zh-CN')}`);
    }
    return lines.join('\n');
  },
};

// ==================== 工具：方案版本对比 ====================

export const plan_diff: ToolDef = {
  name: 'plan_diff',
  description: '对比两个方案版本的差异。',
  parameters: z.object({
    planIdA: z.string().describe('方案 A ID（旧版本）'),
    planIdB: z.string().describe('方案 B ID（新版本）'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const pm = getPlanManager();
    try {
      const diff = pm.diffVersions(args.planIdA as string, args.planIdB as string);

      const lines = [
        `📊 方案对比: v${diff.planA.version} → v${diff.planB.version}`,
        `  摘要: ${diff.summary}\n`,
      ];

      if (diff.titleChanged) lines.push(`  标题: "${diff.planA.title}" → "${diff.planB.title}"`);
      if (diff.descriptionChanged) lines.push('  描述已变更');

      if (diff.addedSteps.length > 0) {
        lines.push(`\n  ➕ 新增步骤 (${diff.addedSteps.length}):`);
        diff.addedSteps.forEach(s => lines.push(`    + ${s.title}`));
      }
      if (diff.removedSteps.length > 0) {
        lines.push(`\n  ➖ 移除步骤 (${diff.removedSteps.length}):`);
        diff.removedSteps.forEach(s => lines.push(`    - ${s.title}`));
      }
      if (diff.modifiedSteps.length > 0) {
        lines.push(`\n  🔄 修改步骤 (${diff.modifiedSteps.length}):`);
        diff.modifiedSteps.forEach(m => lines.push(`    ~ ${m.stepId}.${m.field}: ${JSON.stringify(m.before)} → ${JSON.stringify(m.after)}`));
      }
      if (diff.addedDecisions.length > 0) {
        lines.push(`\n  💡 新增决策 (${diff.addedDecisions.length}):`);
        diff.addedDecisions.forEach(d => lines.push(`    + ${d.question} → ${d.chosen}`));
      }

      return lines.join('\n');
    } catch (e: unknown) {
      return `[对比失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：记录决策 ====================

export const decision_record: ToolDef = {
  name: 'decision_record',
  description: '在方案中记录一个关键决策。',
  parameters: z.object({
    planId: z.string().describe('方案 ID'),
    question: z.string().describe('决策问题'),
    options: z.array(z.string()).describe('候选方案列表'),
    chosen: z.string().describe('选择的方案'),
    reasoning: z.string().describe('选择理由'),
    consequences: z.array(z.string()).optional().describe('预期后果'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const pm = getPlanManager();
    try {
      const decision = pm.recordDecision(args.planId as string, {
        question: args.question as string,
        options: args.options as string[],
        chosen: args.chosen as string,
        reasoning: args.reasoning as string,
        consequences: args.consequences as string[],
      });

      return [
        `✅ 决策已记录`,
        `  ID: ${decision.id}`,
        `  问题: ${decision.question}`,
        `  选择: ${decision.chosen}`,
        `  理由: ${decision.reasoning}`,
      ].join('\n');
    } catch (e: unknown) {
      return `[记录失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：开始执行 ====================

export const execution_start: ToolDef = {
  name: 'execution_start',
  description: '从方案创建执行并开始运行。方案步骤将按顺序执行。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    planId: z.string().describe('方案 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    try {
      const binding = em.startExecution(
        args.projectId as string,
        args.planId as string,
      );
      const status = em.getExecutionStatus(args.projectId as string);

      return [
        `🚀 执行已开始`,
        `  绑定 ID: ${binding.id}`,
        `  DAG ID: ${binding.dagId}`,
        `  步骤: ${status.progress?.totalSteps ?? 0} 个`,
      ].join('\n');
    } catch (e: unknown) {
      return `[启动失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：暂停执行 ====================

export const execution_pause: ToolDef = {
  name: 'execution_pause',
  description: '暂停当前执行，自动创建检查点保存进度。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    reason: z.string().optional().describe('暂停原因'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    try {
      const cp = em.pauseExecution(
        args.projectId as string,
        args.reason as string,
      );
      return [
        `⏸️ 执行已暂停`,
        `  检查点: ${cp.id}`,
        `  进度: ${cp.progressPercent.toFixed(1)}%`,
        `  原因: ${cp.note ?? '(无)'}`,
      ].join('\n');
    } catch (e: unknown) {
      return `[暂停失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：恢复执行 ====================

export const execution_resume: ToolDef = {
  name: 'execution_resume',
  description: '从上次检查点恢复执行。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    try {
      const binding = em.resumeExecution(args.projectId as string);
      return [
        `▶️ 执行已恢复`,
        `  绑定 ID: ${binding.id}`,
        `  恢复时间: ${new Date(binding.resumedAt!).toLocaleString('zh-CN')}`,
      ].join('\n');
    } catch (e: unknown) {
      return `[恢复失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：完成执行 ====================

export const execution_complete: ToolDef = {
  name: 'execution_complete',
  description: '标记执行完成。项目状态变为 completed。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    try {
      em.completeExecution(args.projectId as string);
      return `✅ 执行已完成，项目状态已更新为 completed`;
    } catch (e: unknown) {
      return `[完成失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：标记步骤完成 ====================

export const step_done: ToolDef = {
  name: 'step_done',
  description: '标记某个步骤完成并输出结果。每 3 步自动创建检查点。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    stepId: z.string().describe('步骤 ID'),
    output: z.string().optional().describe('步骤输出'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    em.markStepDone(
      args.projectId as string,
      args.stepId as string,
      args.output as string,
    );
    const status = em.getExecutionStatus(args.projectId as string);
    return `✅ 步骤 ${args.stepId} 已完成 | 进度: ${status.progress?.percentComplete.toFixed(1) ?? 0}%`;
  },
};

// ==================== 工具：标记步骤失败 ====================

export const step_fail: ToolDef = {
  name: 'step_fail',
  description: '标记某个步骤失败。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    stepId: z.string().describe('步骤 ID'),
    error: z.string().optional().describe('错误信息'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    em.markStepFailed(
      args.projectId as string,
      args.stepId as string,
      args.error as string,
    );
    return `❌ 步骤 ${args.stepId} 已失败`;
  },
};

// ==================== 工具：标记步骤跳过 ====================

export const step_skip: ToolDef = {
  name: 'step_skip',
  description: '标记某个步骤跳过。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    stepId: z.string().describe('步骤 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    em.markStepSkipped(
      args.projectId as string,
      args.stepId as string,
    );
    return `⏭️ 步骤 ${args.stepId} 已跳过`;
  },
};

// ==================== 工具：查看执行状态 ====================

export const execution_status: ToolDef = {
  name: 'execution_status',
  description: '查看项目的当前执行状态、进度和检查点。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    const status = em.getExecutionStatus(args.projectId as string);

    if (!status.binding) return '📋 该项目暂无执行记录';

    const lines = [
      `📊 执行状态`,
      `  绑定 ID: ${status.binding.id}`,
      `  状态: ${status.binding.status}`,
      `  开始: ${new Date(status.binding.startedAt).toLocaleString('zh-CN')}`,
    ];

    if (status.binding.pauseReason) {
      lines.push(`  暂停原因: ${status.binding.pauseReason}`);
    }

    if (status.progress) {
      const p = status.progress;
      lines.push(`\n📈 进度: ${p.percentComplete.toFixed(1)}%`);
      lines.push(`  完成: ${p.completedSteps}/${p.totalSteps}`);
      if (p.failedSteps > 0) lines.push(`  失败: ${p.failedSteps}`);
      if (p.skippedSteps > 0) lines.push(`  跳过: ${p.skippedSteps}`);
    }

    if (status.currentStep) {
      lines.push(`\n▶️ 当前步骤: ${status.currentStep.title} [${status.currentStep.status}]`);
    }

    if (status.latestCheckpoint) {
      lines.push(`\n💾 最新检查点: ${status.latestCheckpoint.id}`);
      lines.push(`  阶段: ${status.latestCheckpoint.phase}`);
      lines.push(`  时间: ${new Date(status.latestCheckpoint.timestamp).toLocaleString('zh-CN')}`);
      if (status.latestCheckpoint.note) lines.push(`  备注: ${status.latestCheckpoint.note}`);
    }

    return lines.join('\n');
  },
};

// ==================== 工具：创建检查点 ====================

export const checkpoint_create: ToolDef = {
  name: 'checkpoint_create',
  description: '手动创建检查点（保存当前执行状态快照）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    note: z.string().optional().describe('检查点备注'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const em = getExecutionManager();
    const store = getProjectStore();
    const pt = getProgressTracker();

    const binding = store.getActiveDAGBinding(args.projectId as string);
    if (!binding) return '[没有活跃的执行]';

    const plan = store.getPlan(binding.planId);
    if (!plan) return '[方案不存在]';

    const snapshot = {
      completedSteps: plan.steps.filter(s => s.status === 'done').map(s => s.id),
      pendingSteps: plan.steps.filter(s => s.status === 'pending').map(s => s.id),
      runningSteps: plan.steps.filter(s => s.status === 'running').map(s => s.id),
      outputs: Object.fromEntries(plan.steps.filter(s => s.output).map(s => [s.id, s.output!])),
      decisions: plan.decisions,
    };

    const cp = pt.createCheckpoint(args.projectId as string, binding.planId, snapshot, {
      dagBindingId: binding.id,
      phase: 'manual',
      note: args.note as string,
    });

    return `💾 检查点已创建: ${cp.id} | 进度: ${cp.progressPercent.toFixed(1)}%`;
  },
};

// ==================== 工具：列出检查点 ====================

export const checkpoint_list: ToolDef = {
  name: 'checkpoint_list',
  description: '列出项目的检查点历史。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    limit: z.number().optional().describe('最大返回数，默认 10'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();
    const checkpoints = store.getCheckpoints(
      args.projectId as string,
      (args.limit as number) ?? 10,
    );

    if (checkpoints.length === 0) return '📋 暂无检查点';

    const lines = [`💾 检查点列表 (${checkpoints.length}):\n`];
    for (const cp of checkpoints) {
      lines.push(`  ${cp.id} | ${cp.phase} | ${cp.progressPercent.toFixed(1)}% | ${new Date(cp.timestamp).toLocaleString('zh-CN')}`);
      if (cp.note) lines.push(`    备注: ${cp.note}`);
      lines.push(`    完成: ${cp.snapshot.completedSteps.length} | 待办: ${cp.snapshot.pendingSteps.length}`);
    }
    return lines.join('\n');
  },
};

// ==================== 工具：创建产出物 ====================

export const artifact_create: ToolDef = {
  name: 'artifact_create',
  description: '创建项目产出物（代码、文档、配置、测试等）。如果提供 path 和 content，会实际写入磁盘。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    name: z.string().describe('产出物名称'),
    type: z.enum(['code', 'document', 'config', 'data', 'design', 'test', 'other']).describe('类型'),
    path: z.string().optional().describe('文件路径（提供后会实际创建文件）'),
    content: z.string().optional().describe('内容（与 path 配合写入磁盘）'),
    planId: z.string().optional().describe('关联方案 ID'),
    metadata: z.record(z.unknown()).optional().describe('自定义元数据'),
  }),
  permission: 'write_files',
  execute: async (args) => {
    const am = getArtifactManager();
    try {
      const art = await am.create({
        projectId: args.projectId as string,
        planId: args.planId as string,
        name: args.name as string,
        type: args.type as string as import('./types.js').Artifact['type'],
        path: args.path as string,
        content: args.content as string,
        metadata: args.metadata as Record<string, unknown>,
      });
      return `✅ 产出物已创建: ${art.name} (${art.id}) v${art.version}`;
    } catch (e: unknown) {
      return `[创建失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：更新产出物 ====================

export const artifact_update: ToolDef = {
  name: 'artifact_update',
  description: '更新产出物（自动创建新版本）。如果提供 path 或 content，会实际写入磁盘。',
  parameters: z.object({
    artifactId: z.string().describe('产出物 ID'),
    content: z.string().optional().describe('新内容'),
    path: z.string().optional().describe('新路径'),
    metadata: z.record(z.unknown()).optional().describe('新元数据'),
  }),
  permission: 'write_files',
  execute: async (args) => {
    const am = getArtifactManager();
    try {
      const art = await am.update(args.artifactId as string, {
        content: args.content as string,
        path: args.path as string,
        metadata: args.metadata as Record<string, unknown>,
      });
      return `✅ 产出物已更新: ${art.name} → v${art.version}`;
    } catch (e: unknown) {
      return `[更新失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：列出产出物 ====================

export const artifact_list: ToolDef = {
  name: 'artifact_list',
  description: '列出项目产出物（每个名称只返回最新版本）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    type: z.string().optional().describe('按类型过滤'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const am = getArtifactManager();
    const arts = am.listLatest(args.projectId as string, args.type as string);

    if (arts.length === 0) return '📋 暂无产出物';

    const lines = [`📋 产出物列表 (${arts.length}):\n`];
    for (const a of arts) {
      const pathInfo = a.path ? ` → ${a.path}` : '';
      lines.push(`  ${a.id} | ${a.name} v${a.version} [${a.type}]${pathInfo}`);
    }
    return lines.join('\n');
  },
};

// ==================== 工具：产出物版本对比 ====================

export const artifact_diff: ToolDef = {
  name: 'artifact_diff',
  description: '对比两个产出物版本的差异。',
  parameters: z.object({
    artifactIdA: z.string().describe('产出物 A ID（旧版本）'),
    artifactIdB: z.string().describe('产出物 B ID（新版本）'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const am = getArtifactManager();
    try {
      const d = am.diff(args.artifactIdA as string, args.artifactIdB as string);
      return [
        `📊 产出物对比: ${d.nameA} v${d.versionA} → v${d.versionB}`,
        `  ${d.summary}`,
      ].join('\n');
    } catch (e: unknown) {
      return `[对比失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：记录教训 ====================

export const lesson_record: ToolDef = {
  name: 'lesson_record',
  description: '记录一个项目教训（经验、错误、优化、模式、警告）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    category: z.enum(['mistake', 'insight', 'optimization', 'pattern', 'warning']).describe('类别'),
    title: z.string().describe('教训标题'),
    description: z.string().describe('详细描述'),
    context: z.string().optional().describe('产生背景'),
    correction: z.string().optional().describe('正确做法'),
    impact: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('影响等级'),
    applicableCategories: z.array(z.string()).optional().describe('适用项目类别'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const ls = getLessonSystem();
    try {
      const lesson = ls.record({
        projectId: args.projectId as string,
        category: args.category as import('./types.js').Lesson['category'],
        title: args.title as string,
        description: args.description as string,
        context: args.context as string,
        correction: args.correction as string,
        impact: args.impact as import('./types.js').Lesson['impact'],
        applicableCategories: args.applicableCategories as string[],
      });
      return `✅ 教训已记录: ${lesson.title} (${lesson.id}) [${lesson.category}]`;
    } catch (e: unknown) {
      return `[记录失败: ${(e as Error).message}]`;
    }
  },
};

// ==================== 工具：列出教训 ====================

export const lesson_list: ToolDef = {
  name: 'lesson_list',
  description: '列出项目教训，可按类别、影响、验证状态过滤。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    category: z.enum(['mistake', 'insight', 'optimization', 'pattern', 'warning']).optional().describe('按类别过滤'),
    impact: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('按影响过滤'),
    verified: z.boolean().optional().describe('按验证状态过滤'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const ls = getLessonSystem();
    const lessons = ls.getLessons(args.projectId as string, {
      category: args.category as import('./types.js').Lesson['category'],
      impact: args.impact as import('./types.js').Lesson['impact'],
      verified: args.verified as boolean,
    });

    if (lessons.length === 0) return '📋 暂无教训';

    const lines = [`📋 教训列表 (${lessons.length}):\n`];
    for (const l of lessons) {
      const icon = { mistake: '❌', insight: '💡', optimization: '⚡', pattern: '🔄', warning: '⚠️' }[l.category] ?? '📝';
      const verified = l.verified ? ' ✅' : '';
      lines.push(`${icon} ${l.id} | ${l.title} [${l.impact}]${verified}`);
      if (l.correction) lines.push(`   修正: ${l.correction}`);
    }
    return lines.join('\n');
  },
};

// ==================== 工具：编译教训到经验 ====================

export const lesson_compile: ToolDef = {
  name: 'lesson_compile',
  description: '将教训编译为经验单元，注入经验图谱。',
  parameters: z.object({
    lessonId: z.string().describe('教训 ID'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const ls = getLessonSystem();
    const result = ls.compileToExperience(args.lessonId as string);

    if (result.success) {
      return `✅ 教训已编译: ${result.lessonId} → ${result.experienceUnitId}`;
    }
    return `[编译失败: ${result.reason}]`;
  },
};

// ==================== 工具：批量编译教训 ====================

export const lesson_compile_all: ToolDef = {
  name: 'lesson_compile_all',
  description: '批量编译所有未处理的教训。',
  parameters: z.object({}),
  permission: 'read_files',
  execute: async () => {
    const ls = getLessonSystem();
    const results = ls.compileAllPending();

    if (results.length === 0) return '📋 没有待编译的教训';

    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    return `📊 编译完成: ${success} 成功, ${failed} 失败 (共 ${results.length})`;
  },
};

// ==================== 工具：查找相似项目 ====================

export const cross_project_find: ToolDef = {
  name: 'cross_project_find',
  description: '查找与当前项目相似的其他项目（基于类别、标签、需求）。',
  parameters: z.object({
    projectId: z.string().describe('项目 ID'),
    limit: z.number().optional().describe('最大返回数，默认 5'),
    minSimilarity: z.number().optional().describe('最低相似度 0-1，默认 0.1'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const cpm = getCrossProjectManager();
    const results = cpm.findSimilarProjects(
      args.projectId as string,
      { limit: args.limit as number, minSimilarity: args.minSimilarity as number },
    );

    if (results.length === 0) return '📋 未找到相似项目';

    const lines = [`📋 相似项目 (${results.length}):\n`];
    for (const r of results) {
      lines.push(`  ${r.project.id} | ${r.project.name} [${r.project.category}]`);
      lines.push(`    相似度: ${(r.similarity * 100).toFixed(0)}% (${r.matchedBy})`);
      if (r.relevantLessons.length > 0) {
        lines.push(`    教训: ${r.relevantLessons.length} 条`);
      }
    }
    return lines.join('\n');
  },
};

// ==================== 工具：注入历史教训 ====================

export const cross_project_inject: ToolDef = {
  name: 'cross_project_inject',
  description: '从相似项目注入历史教训到当前项目。',
  parameters: z.object({
    projectId: z.string().describe('目标项目 ID'),
    categories: z.array(z.string()).optional().describe('过滤教训类别'),
    minImpact: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('最低影响等级'),
    limit: z.number().optional().describe('最大注入数，默认 10'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const cpm = getCrossProjectManager();
    const result = cpm.injectLessons(args.projectId as string, {
      categories: args.categories as string[],
      minImpact: args.minImpact as import('./types.js').Lesson['impact'],
      limit: args.limit as number,
    });

    if (result.injected.length === 0) return '📋 无可注入的教训';

    return [
      `✅ 已注入 ${result.injected.length} 条教训`,
      `  来源项目: ${result.sourceProjects.join(', ')}`,
      ...result.injected.map(l => `  - [${l.category}/${l.impact}] ${l.title}`),
    ].join('\n');
  },
};

// ==================== 工具：全文搜索 ====================

export const project_search: ToolDef = {
  name: 'project_search',
  description: '全文搜索项目、方案、决策、教训、产出物。',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    entityTypes: z.array(z.string()).optional().describe('过滤实体类型: project/plan/decision/lesson/artifact'),
    projectId: z.string().optional().describe('限定在某个项目内'),
    limit: z.number().optional().describe('最大返回数，默认 20'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const ps = getProjectSearch();
    return ps.searchFormatted(args.query as string, {
      entityTypes: args.entityTypes as string[],
      projectId: args.projectId as string,
      limit: args.limit as number,
    });
  },
};

// ==================== 工具：重建搜索索引 ====================

export const project_search_rebuild: ToolDef = {
  name: 'project_search_rebuild',
  description: '重建全文搜索索引。',
  parameters: z.object({}),
  permission: 'read_files',
  execute: async () => {
    const ps = getProjectSearch();
    ps.rebuildIndex();
    return '✅ 搜索索引已重建';
  },
};

// ==================== 工具：项目统计 ====================

export const project_stats: ToolDef = {
  name: 'project_stats',
  description: '查看项目统计信息或全局统计。',
  parameters: z.object({
    projectId: z.string().optional().describe('项目 ID（不填则返回全局统计）'),
  }),
  permission: 'read_files',
  execute: async (args) => {
    const store = getProjectStore();

    if (args.projectId) {
      const stats = store.getProjectStats(args.projectId as string);
      return [
        `📊 项目统计: ${args.projectId}`,
        `  方案: ${stats.totalPlans}`,
        `  决策: ${stats.totalDecisions}`,
        `  检查点: ${stats.totalCheckpoints}`,
        `  产出物: ${stats.totalArtifacts}`,
        `  教训: ${stats.totalLessons} (已验证: ${stats.verifiedLessons})`,
        stats.currentProgress ? `  进度: ${stats.currentProgress.percentComplete.toFixed(1)}%` : '',
      ].filter(Boolean).join('\n');
    }

    const global = store.getGlobalStats();
    const lines = [
      '📊 全局统计',
      `  项目: ${global.totalProjects} (活跃: ${global.activeProjects}, 完成: ${global.completedProjects})`,
      `  方案: ${global.totalPlans}`,
      `  教训: ${global.totalLessons}`,
    ];
    if (Object.keys(global.categories).length > 0) {
      lines.push('  分类:');
      for (const [cat, count] of Object.entries(global.categories)) {
        lines.push(`    ${cat}: ${count}`);
      }
    }
    return lines.join('\n');
  },
};

// ==================== 导出所有工具 ====================

export const PROJECT_TOOLS_SPRINT1: ToolDef[] = [
  project_create,
  project_list,
  project_get,
  project_update,
  project_delete,
];

export const PROJECT_TOOLS_SPRINT2: ToolDef[] = [
  plan_create,
  plan_new_version,
  plan_get_versions,
  plan_diff,
  decision_record,
];

export const PROJECT_TOOLS_SPRINT3: ToolDef[] = [
  execution_start,
  execution_pause,
  execution_resume,
  execution_complete,
  step_done,
  step_fail,
  step_skip,
  execution_status,
  checkpoint_create,
  checkpoint_list,
];

export const PROJECT_TOOLS_SPRINT4: ToolDef[] = [
  artifact_create,
  artifact_update,
  artifact_list,
  artifact_diff,
  lesson_record,
  lesson_list,
  lesson_compile,
  lesson_compile_all,
];

export const PROJECT_TOOLS_SPRINT5: ToolDef[] = [
  cross_project_find,
  cross_project_inject,
  project_search,
  project_search_rebuild,
  project_stats,
];

export const PROJECT_TOOLS_ALL: ToolDef[] = [
  ...PROJECT_TOOLS_SPRINT1,
  ...PROJECT_TOOLS_SPRINT2,
  ...PROJECT_TOOLS_SPRINT3,
  ...PROJECT_TOOLS_SPRINT4,
  ...PROJECT_TOOLS_SPRINT5,
];
