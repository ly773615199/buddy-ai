/**
 * Integration — 系统集成桥接
 *
 * 将 ProjectModel 与已有基础设施连接：
 * - STMP: 每个项目 = 一个 STMP 房间
 * - DreamEngine: 项目完成时触发巩固
 * - ExperienceCompiler: 项目经验编译
 * - CognitiveEngine: 用户画像 / 领域画像更新
 */

import type { ProjectStore } from './store.js';
import type { Project, Plan } from './types.js';
import type { STMPStore, MemoryNode } from '../memory/stmp.js';
import type { DreamEngine } from '../memory/dream.js';
import type { CognitiveEngine } from '../cognitive/engine.js';
import type { ExperienceCompiler } from '../intelligence/experience-compiler.js';

// ==================== 外部依赖 ====================

export interface IntegrationDeps {
  stmp: STMPStore;
  dream: DreamEngine;
  cognitive: CognitiveEngine;
  experienceCompiler: ExperienceCompiler;
}

// ==================== 集成配置 ====================

export interface IntegrationConfig {
  /** 是否自动创建 STMP 房间 */
  autoCreateSTMPRoom?: boolean;
  /** 是否在项目完成时触发 Dream 巩固 */
  triggerDreamOnComplete?: boolean;
  /** 是否自动更新用户画像 */
  updateCognitiveProfile?: boolean;
}

const DEFAULT_CONFIG: IntegrationConfig = {
  autoCreateSTMPRoom: true,
  triggerDreamOnComplete: true,
  updateCognitiveProfile: true,
};

// ==================== IntegrationManager ====================

export class IntegrationManager {
  private config: IntegrationConfig;
  private deps: IntegrationDeps | null = null;

  constructor(
    private store: ProjectStore,
    config?: Partial<IntegrationConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 注入外部依赖（由 Subsystems 初始化时调用） */
  setDeps(deps: IntegrationDeps): void {
    this.deps = deps;
  }

  /** 是否已注入依赖 */
  hasDeps(): boolean {
    return this.deps !== null;
  }

  // ==================== 生命周期钩子 ====================

  /**
   * 项目创建时的集成钩子
   */
  onProjectCreated(project: Project): void {
    if (this.config.autoCreateSTMPRoom) {
      this.createSTMPRoom(project);
    }
  }

  /**
   * 项目完成时的集成钩子
   */
  onProjectCompleted(project: Project, plan: Plan): void {
    if (this.config.triggerDreamOnComplete) {
      this.triggerProjectDream(project);
    }

    if (this.config.updateCognitiveProfile) {
      this.updateCognitiveFromProject(project);
    }

    this.compileProjectExperience(project, plan);
  }

  // ==================== 1. STMP 房间 ====================

  /**
   * 创建 STMP 房间（项目记忆容器）
   *
   * 每个项目自动创建一个 STMP 房间，
   * 项目下的所有记忆、对话、决策都存入该房间。
   */
  private createSTMPRoom(project: Project): string {
    const roomId = `project-${project.id}`;

    if (this.deps) {
      const existing = this.deps.stmp.getRoom(roomId);
      if (!existing) {
        this.deps.stmp.createRoom(roomId, project.name, [project.category, ...project.tags]);
      }
    }

    return roomId;
  }

  // ==================== 2. Dream 巩固 ====================

  /**
   * 触发项目 Dream 巩固
   *
   * 项目完成后触发 DreamEngine 将项目记忆从短期转为长期。
   * 注：DreamEngine 当前为全局巩固（非按房间），触发一次即可。
   */
  private triggerProjectDream(project: Project): void {
    if (!this.deps) return;

    const roomId = `project-${project.id}`;

    // 先把项目完成事件写入 STMP，让 Dream 巩固时能捞到
    this.deps.stmp.insertNode({
      id: `proj-done-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: `项目「${project.name}」已完成。类别: ${project.category}, 标签: ${project.tags.join(', ')}`,
      room: roomId,
      timestamp: Date.now(),
      temporalContext: { before: [], after: [] },
      concepts: [project.category, '项目完成', ...project.tags],
      relations: [],
      emotional: { valence: 0.5, importance: 7 },
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      source: 'observed',
    });

    // 触发 Dream 巩固（异步，不阻塞）
    this.deps.dream.dream('manual').catch(() => { /* 静默 */ });
  }

  // ==================== 3. 用户画像 / 领域画像 ====================

  /**
   * 从项目更新用户画像
   *
   * 从项目中推断用户的技术栈、领域专长等。
   */
  private updateCognitiveFromProject(project: Project): void {
    if (!this.deps) return;

    // 更新领域画像：项目类别 → 领域
    const domain = project.category;
    const existing = this.deps.cognitive.getDomainProfile(domain);
    this.deps.cognitive.updateDomainProfile(domain, {
      conversationCount: existing.conversationCount + 1,
      lastActiveAt: Date.now(),
    });

    // 更新用户技术栈
    const techs = (project.metadata.technologies as string[]) ?? [];
    if (techs.length > 0) {
      const profile = this.deps.cognitive.getUserProfile();
      const merged = [...new Set([...profile.identity.techStack, ...techs])];
      this.deps.cognitive.updateUserField('identity', {
        ...profile.identity,
        techStack: merged,
      }, `项目「${project.name}」使用了 ${techs.join(', ')}`);
    }
  }

  // ==================== 4. 经验编译 ====================

  /**
   * 编译项目经验
   *
   * 项目成功完成后，将项目的"需求→方案→执行→结果"编译为可复用经验，
   * 存入 STMP 项目房间。
   */
  private compileProjectExperience(project: Project, plan: Plan): void {
    if (!this.deps) return;

    const completedSteps = plan.steps.filter(s => s.status === 'done' || s.status === 'skipped');
    const lessons = this.store.getLessons(project.id);

    // 构造经验摘要
    const summary = [
      `项目「${project.name}」经验总结:`,
      `类别: ${project.category}`,
      `方案: ${plan.title} (v${plan.version})`,
      `步骤: ${completedSteps.length}/${plan.steps.length} 完成`,
      `决策: ${plan.decisions.length} 条`,
      `教训: ${lessons.length} 条`,
    ];

    if (plan.decisions.length > 0) {
      summary.push('关键决策:');
      for (const d of plan.decisions) {
        summary.push(`  - ${d.question} → ${d.chosen} (${d.reasoning})`);
      }
    }

    if (lessons.length > 0) {
      summary.push('教训:');
      for (const l of lessons) {
        summary.push(`  - [${l.category}] ${l.title}: ${l.description}`);
      }
    }

    // 存入 STMP 项目房间
    const roomId = `project-${project.id}`;
    this.deps.stmp.insertNode({
      id: `proj-exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: summary.join('\n'),
      room: roomId,
      timestamp: Date.now(),
      temporalContext: { before: [], after: [] },
      concepts: [project.category, '项目经验', project.name, ...project.tags],
      relations: [],
      emotional: { valence: 0.3, importance: 8 },
      lifecycle: {
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
        decay: 1.0,
        compressed: false,
        hibernated: false,
      },
      source: 'extracted',
    });
  }

  // ==================== 5. 项目记忆记录 ====================

  /**
   * 记录项目记忆到 STMP
   */
  recordProjectMemory(
    projectId: string,
    content: string,
    concepts: string[],
    importance: number,
  ): void {
    const roomId = `project-${projectId}`;

    if (this.deps) {
      const node: MemoryNode = {
        id: `proj-mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content,
        room: roomId,
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
        source: 'conversation',
      };
      this.deps.stmp.insertNode(node);
    }
  }

  // ==================== 状态查询 ====================

  /**
   * 获取集成状态
   */
  getIntegrationStatus(projectId: string): {
    stmpRoomId: string | null;
    hasDreamTriggered: boolean;
    hasCognitiveUpdate: boolean;
    lessonCount: number;
  } {
    const project = this.store.getProject(projectId);
    return {
      stmpRoomId: project?.stmpRoomId ?? null,
      hasDreamTriggered: project?.status === 'completed',
      hasCognitiveUpdate: project?.status === 'completed',
      lessonCount: this.store.getLessons(projectId).length,
    };
  }
}
