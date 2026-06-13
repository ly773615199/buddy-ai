/**
 * Integration — 系统集成桥接
 *
 * 将 ProjectModel 与已有基础设施连接：
 * - STMP: 每个项目 = 一个 STMP 房间
 * - DecisionMemory: 决策记录桥接
 * - ExperienceCompiler: 教训→经验编译
 * - CognitiveEngine: 用户画像更新
 *
 * 注意：这些是集成接口定义。
 * 完整实现需要注入实际的 STMP/Dream/Cognitive 实例。
 */

import type { ProjectStore } from './store.js';
import type { Project, Plan, Lesson } from './types.js';

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

  constructor(
    private store: ProjectStore,
    config?: Partial<IntegrationConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

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

    // 编译项目经验
    this.compileProjectExperience(project, plan);
  }

  /**
   * 创建 STMP 房间（项目记忆容器）
   *
   * 每个项目自动创建一个 STMP 房间，
   * 项目下的所有记忆、对话、决策都存入该房间。
   */
  private createSTMPRoom(project: Project): string {
    const roomId = `project-${project.id}`;

    // 实际实现需要调用 STMPStore.createRoom()
    // stmp.createRoom(roomId, project.name, [project.category, ...project.tags]);

    return roomId;
  }

  /**
   * 触发项目 Dream 巩固
   *
   * 项目完成后触发 DreamEngine 将项目记忆从短期转为长期。
   */
  private triggerProjectDream(project: Project): void {
    const roomId = `project-${project.id}`;
    // 实际实现需要调用 DreamEngine.consolidateRoom(roomId)
    void roomId;
  }

  /**
   * 从项目更新用户画像
   *
   * 从项目中推断用户的技术栈、工作模式等。
   */
  private updateCognitiveFromProject(project: Project): void {
    // 从项目 category 推断领域
    // cognitive.updateDomainProfile(project.category, ...)

    // 从 metadata.technologies 推断技术栈
    const techs = (project.metadata.technologies as string[]) ?? [];
    if (techs.length > 0) {
      // cognitive.updateUserField('identity', { techStack: [...merged] })
      void techs;
    }
  }

  /**
   * 编译项目经验
   *
   * 项目成功完成后，将项目的"需求→方案→执行→结果"编译为可复用经验。
   */
  private compileProjectExperience(project: Project, plan: Plan): void {
    const completedSteps = plan.steps.filter(s => s.status === 'done' || s.status === 'skipped');

    // 构造经验摘要
    const summary = {
      project: project.name,
      category: project.category,
      totalSteps: plan.steps.length,
      completedSteps: completedSteps.length,
      decisions: plan.decisions.length,
      lessons: this.store.getLessons(project.id).length,
    };

    // 实际实现需要调用 ExperienceCompiler.compile()
    void summary;
  }

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

    // 实际实现：
    // const node: MemoryNode = {
    //   id: `proj-mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    //   content,
    //   room: roomId,
    //   timestamp: Date.now(),
    //   concepts,
    //   relations: [],
    //   emotional: { valence: 0, importance },
    //   ...
    // };
    // stmp.insertNode(node);

    void roomId;
    void content;
    void concepts;
    void importance;
  }

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
