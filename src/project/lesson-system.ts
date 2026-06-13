/**
 * LessonSystem — 教训系统
 *
 * 职责：
 * - 从失败/成功中提取教训
 * - 手动记录教训
 * - 将教训编译为 ExperienceUnit 注入经验图谱
 * - 验证教训
 *
 * 教训 → 经验编译流程：
 * Lesson → 构造 ConversationSnapshot → ExperienceCompiler.compile() → ExperienceGraph.addNode()
 */

import { randomUUID } from 'crypto';
import type { ProjectStore } from './store.js';
import type { Lesson } from './types.js';

// ==================== 编译结果 ====================

export interface CompileResult {
  lessonId: string;
  experienceUnitId: string | null;
  success: boolean;
  reason?: string;
}

// ==================== LessonSystem ====================

export class LessonSystem {
  constructor(private store: ProjectStore) {}

  /**
   * 从失败的任务中自动提取教训
   */
  extractFromFailure(
    projectId: string,
    failedTask: {
      name: string;
      error: string;
      tool: string;
      args: Record<string, unknown>;
    },
    context: string,
  ): Lesson {
    const lesson: Lesson = {
      id: `les_${randomUUID().slice(0, 8)}`,
      projectId,
      category: 'mistake',
      title: `失败: ${failedTask.name}`,
      description: `工具 ${failedTask.tool} 执行失败: ${failedTask.error}`,
      context,
      correction: this.suggestCorrection(failedTask.tool, failedTask.error),
      impact: this.assessImpact(failedTask.error),
      applicableCategories: [],
      createdAt: Date.now(),
      verified: false,
    };

    this.store.createLesson(lesson);
    return lesson;
  }

  /**
   * 从成功的优化中提取教训
   */
  extractFromOptimization(
    projectId: string,
    description: string,
    before: string,
    after: string,
  ): Lesson {
    const lesson: Lesson = {
      id: `les_${randomUUID().slice(0, 8)}`,
      projectId,
      category: 'optimization',
      title: `优化: ${description.slice(0, 50)}`,
      description,
      context: `优化前: ${before}\n优化后: ${after}`,
      impact: 'medium',
      applicableCategories: [],
      createdAt: Date.now(),
      verified: false,
    };

    this.store.createLesson(lesson);
    return lesson;
  }

  /**
   * 手动记录教训
   */
  record(params: {
    projectId: string;
    category: Lesson['category'];
    title: string;
    description: string;
    context?: string;
    correction?: string;
    impact?: Lesson['impact'];
    applicableCategories?: string[];
  }): Lesson {
    const lesson: Lesson = {
      id: `les_${randomUUID().slice(0, 8)}`,
      projectId: params.projectId,
      category: params.category,
      title: params.title,
      description: params.description,
      context: params.context ?? '',
      correction: params.correction,
      impact: params.impact ?? 'medium',
      applicableCategories: params.applicableCategories ?? [],
      createdAt: Date.now(),
      verified: false,
    };

    this.store.createLesson(lesson);
    return lesson;
  }

  /**
   * 将教训编译为经验单元
   *
   * 这是教训进入经验图谱的入口。
   * 当前实现：标记 lesson 为已验证，返回模拟 ID。
   * 完整实现需要接入 ExperienceCompiler + ExperienceGraph。
   */
  compileToExperience(lessonId: string): CompileResult {
    const lessons = this.store.getLessons(''); // 需要按 ID 查找
    const lesson = lessons.find(l => l.id === lessonId) ?? this.store.getLessonById(lessonId);

    if (!lesson) {
      return { lessonId, experienceUnitId: null, success: false, reason: 'Lesson not found' };
    }

    if (lesson.verified) {
      return { lessonId, experienceUnitId: lesson.experienceUnitId ?? null, success: true, reason: 'Already compiled' };
    }

    // 构造经验单元 ID
    const experienceUnitId = `exp_${randomUUID().slice(0, 8)}`;

    // 链接教训到经验
    this.store.linkLessonToExperience(lessonId, experienceUnitId);

    // 标记为已验证
    this.verify(lessonId);

    return { lessonId, experienceUnitId, success: true };
  }

  /**
   * 批量编译未处理的教训
   */
  compileAllPending(): CompileResult[] {
    // 获取所有未验证且未链接经验的教训
    const allLessons = this.store.getAllLessons();
    const pending = allLessons.filter(l => !l.verified && !l.experienceUnitId);

    return pending.map(l => this.compileToExperience(l.id));
  }

  /**
   * 验证教训（标记为 verified）
   */
  verify(lessonId: string): void {
    this.store.verifyLesson(lessonId);
  }

  /**
   * 获取项目教训（带过滤）
   */
  getLessons(projectId: string, filter?: {
    category?: Lesson['category'];
    impact?: Lesson['impact'];
    verified?: boolean;
  }): Lesson[] {
    let lessons = this.store.getLessons(projectId);

    if (filter?.category) {
      lessons = lessons.filter(l => l.category === filter.category);
    }
    if (filter?.impact) {
      lessons = lessons.filter(l => l.impact === filter.impact);
    }
    if (filter?.verified !== undefined) {
      lessons = lessons.filter(l => l.verified === filter.verified);
    }

    return lessons;
  }

  /**
   * 根据工具和错误建议修正方法
   */
  private suggestCorrection(tool: string, error: string): string | undefined {
    const suggestions: Record<string, string> = {
      'git_push': '先执行 git pull --rebase 同步远程变更',
      'npm_install': '检查 package.json 依赖版本，尝试 rm -rf node_modules && npm install',
      'tsc': '修复 TypeScript 类型错误后重试',
      'eslint': '运行 eslint --fix 自动修复格式问题',
    };

    // 关键词匹配
    for (const [key, suggestion] of Object.entries(suggestions)) {
      if (tool.includes(key) || error.toLowerCase().includes(key)) {
        return suggestion;
      }
    }

    if (error.includes('EACCES')) return '检查文件权限';
    if (error.includes('ENOENT')) return '检查文件/目录是否存在';
    if (error.includes('timeout')) return '增加超时时间或检查网络连接';

    return undefined;
  }

  /**
   * 评估影响等级
   */
  private assessImpact(error: string): Lesson['impact'] {
    if (error.includes('CRITICAL') || error.includes('fatal') || error.includes('崩溃')) return 'critical';
    if (error.includes('security') || error.includes('vulnerability') || error.includes('权限')) return 'high';
    if (error.includes('timeout') || error.includes('ECONNREFUSED')) return 'medium';
    return 'low';
  }
}
