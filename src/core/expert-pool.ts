/**
 * ExpertPool — 多专家并行调用池
 *
 * 核心能力：
 * - 多个 LLM 专家并行调用（Promise.all / Promise.any）
 * - 每个专家有独立的 systemPrompt + modelConfig + taskType
 * - 支持 Early Termination 模式（谁先完成用谁的）
 * - 每个专家独立的 eventBus 事件（带 taskId 标签）
 * - 超时 + fallback 容错
 *
 * 与 FusionBuffer 协同：
 * ExpertPool.runParallel() → 结果 → FusionBuffer.ingest() → 融合
 */

import type { EventBus } from '../ws/server.js';

// ==================== 类型 ====================

export type TaskType = 'chat' | 'code' | 'architect' | 'test' | 'review' | 'general';

export interface ModelConfig {
  id: string;
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ExpertConfig {
  /** 专家唯一 ID（如 expert-code, expert-arch） */
  id: string;
  /** 模型配置 */
  modelConfig: ModelConfig;
  /** 系统提示词 */
  systemPrompt: string;
  /** 任务类型标签 */
  taskType: TaskType;
}

export interface ExpertResult {
  expertId: string;
  text: string;
  success: boolean;
  latencyMs: number;
  modelId: string;
  error?: string;
}

export interface ExpertPoolOptions {
  /** 超时时间（ms），默认 30s */
  timeoutMs?: number;
  /** Early Termination 模式：谁先完成用谁的 */
  earlyTerminate?: boolean;
  /** 最大并发专家数（默认 3） */
  maxConcurrent?: number;
}

// ==================== LLM 接口 ====================

/** 最小化 LLM 调用接口，避免循环依赖 */
export interface LLMCaller {
  chat(messages: Array<{ role: string; content: string }>, model: string, options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string }>;
}

/** 最小化模型路由接口 */
export interface ModelRouterLike {
  select(taskType: string, context?: { content?: string }): ModelConfig | Promise<ModelConfig>;
  getFallbacks(current: { id: string }): Array<{ id: string; provider: string; model: string }>;
}

// ==================== 预设专家模板 ====================

export const EXPERT_TEMPLATES: Record<string, Omit<ExpertConfig, 'modelConfig'>> = {
  code: {
    id: 'expert-code',
    systemPrompt: '你是代码分析专家。专注于代码逻辑、实现细节、bug 检测和代码质量评估。给出具体、可操作的建议。',
    taskType: 'code',
  },
  architect: {
    id: 'expert-arch',
    systemPrompt: '你是架构设计专家。专注于系统架构、设计模式、可扩展性和技术选型。从全局视角分析问题。',
    taskType: 'architect',
  },
  test: {
    id: 'expert-test',
    systemPrompt: '你是测试设计专家。专注于测试策略、边界条件、覆盖率和质量保障。设计全面的测试方案。',
    taskType: 'test',
  },
  review: {
    id: 'expert-review',
    systemPrompt: '你是代码审查专家。专注于代码规范、安全性、性能和可维护性。提供有建设性的审查意见。',
    taskType: 'review',
  },
};

// ==================== ExpertPool ====================

export class ExpertPool {
  private activeTasks = new Map<string, AbortController>();
  private modelRouter: ModelRouterLike | null = null;

  constructor(
    private llm: LLMCaller,
    private eventBus: EventBus | null,
    modelRouter?: ModelRouterLike,
  ) {
    this.modelRouter = modelRouter ?? null;
  }

  /**
   * 设置模型路由（延迟绑定）
   */
  setModelRouter(router: ModelRouterLike): void {
    this.modelRouter = router;
  }

  /**
   * 并行调用多个专家
   */
  async runParallel(
    experts: ExpertConfig[],
    userMessage: string,
    options?: ExpertPoolOptions,
  ): Promise<ExpertResult[]> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const taskId = `pool-${Date.now()}`;

    // 限制并发数
    const maxConcurrent = options?.maxConcurrent ?? 3;
    const activeExperts = experts.slice(0, maxConcurrent);

    this.eventBus?.emit({
      type: 'expert_pool_start',
      taskId,
      experts: activeExperts.map(e => e.id),
    });

    const promises = activeExperts.map(expert =>
      this.callExpert(expert, userMessage, timeoutMs, taskId)
    );

    if (options?.earlyTerminate) {
      // Early Termination 模式：谁先完成用谁的
      try {
        const first = await Promise.any(promises);
        // 取消其他专家
        this.cancelTask(taskId);
        return [first];
      } catch {
        // 全部失败，返回所有结果
      }
    }

    const results = await Promise.allSettled(promises);
    return results.map((r, i) => ({
      expertId: activeExperts[i].id,
      text: r.status === 'fulfilled' ? r.value.text : '',
      success: r.status === 'fulfilled',
      latencyMs: r.status === 'fulfilled' ? r.value.latencyMs : 0,
      modelId: activeExperts[i].modelConfig.id,
      error: r.status === 'rejected' ? String(r.reason) : undefined,
    }));
  }

  /**
   * 调用单个专家
   */
  private async callExpert(
    expert: ExpertConfig,
    userMessage: string,
    timeoutMs: number,
    taskId: string,
  ): Promise<ExpertResult> {
    const start = Date.now();
    const abortController = new AbortController();
    const taskKey = `${taskId}-${expert.id}`;
    this.activeTasks.set(taskKey, abortController);

    this.eventBus?.emit({
      type: 'expert_start',
      taskId,
      expertId: expert.id,
      modelId: expert.modelConfig.id,
    });

    try {
      const messages = [
        { role: 'system', content: expert.systemPrompt },
        { role: 'user', content: userMessage },
      ];

      // 超时控制
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`专家 ${expert.id} 超时 (${timeoutMs}ms)`));
        }, timeoutMs);
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error(`专家 ${expert.id} 被取消`));
        });
      });

      const llmPromise = this.llm.chat(
        messages,
        expert.modelConfig.id,
        {
          maxTokens: expert.modelConfig.maxTokens,
          temperature: expert.modelConfig.temperature,
        },
      );

      const result = await Promise.race([llmPromise, timeoutPromise]);
      const latencyMs = Date.now() - start;

      this.eventBus?.emit({
        type: 'expert_done',
        taskId,
        expertId: expert.id,
        latencyMs,
        success: true,
      });

      return {
        expertId: expert.id,
        text: result.text,
        success: true,
        latencyMs,
        modelId: expert.modelConfig.id,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;

      this.eventBus?.emit({
        type: 'expert_done',
        taskId,
        expertId: expert.id,
        latencyMs,
        success: false,
        error: (err as Error).message,
      });

      return {
        expertId: expert.id,
        text: '',
        success: false,
        latencyMs,
        modelId: expert.modelConfig.id,
        error: (err as Error).message,
      };
    } finally {
      this.activeTasks.delete(taskKey);
    }
  }

  /**
   * 取消指定任务的所有专家调用
   */
  cancelTask(taskId: string): void {
    for (const [key, controller] of this.activeTasks) {
      if (key.startsWith(taskId)) {
        controller.abort();
        this.activeTasks.delete(key);
      }
    }
  }

  /**
   * 取消所有活跃任务
   */
  cancelAll(): void {
    for (const [key, controller] of this.activeTasks) {
      controller.abort();
    }
    this.activeTasks.clear();
  }

  /**
   * 获取活跃任务状态
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }

  /**
   * 根据任务类型选择专家组合，并从 ModelRouter 获取真实模型配置
   */
  static async selectExpertsForTask(
    taskDescription: string,
    availableModels: ModelConfig[],
    modelRouter?: ModelRouterLike,
  ): Promise<ExpertConfig[]> {
    const experts: ExpertConfig[] = [];
    const desc = taskDescription.toLowerCase();

    // 从 ModelRouter 获取不同 taskType 的模型
    const getModelForTask = async (taskType: string): Promise<ModelConfig> => {
      if (modelRouter) {
        try {
          const selected = await modelRouter.select(taskType, { content: taskDescription });
          return { id: selected.id, provider: selected.provider, model: selected.model };
        } catch {
          // fallback 到 availableModels
        }
      }
      return availableModels[0] ?? { id: 'default', provider: 'default', model: 'default' };
    };

    // 代码相关任务
    if (/代码|code|实现|bug|函数|类|接口/.test(desc)) {
      experts.push({
        ...EXPERT_TEMPLATES.code,
        modelConfig: await getModelForTask('code'),
      });
    }

    // 架构相关任务
    if (/架构|设计|系统|模块|组件|重构|refactor/.test(desc)) {
      experts.push({
        ...EXPERT_TEMPLATES.architect,
        modelConfig: await getModelForTask('architect'),
      });
    }

    // 测试相关任务
    if (/测试|test|覆盖率|边界|断言/.test(desc)) {
      experts.push({
        ...EXPERT_TEMPLATES.test,
        modelConfig: await getModelForTask('test'),
      });
    }

    // 审查相关任务
    if (/审查|review|规范|安全|性能/.test(desc)) {
      experts.push({
        ...EXPERT_TEMPLATES.review,
        modelConfig: await getModelForTask('review'),
      });
    }

    // 如果没有匹配到特定类型，使用通用专家
    if (experts.length === 0) {
      experts.push({
        id: 'expert-general',
        modelConfig: await getModelForTask('general'),
        systemPrompt: '你是一个通用 AI 助手，擅长分析问题并提供全面的解决方案。',
        taskType: 'general',
      });
    }

    return experts;
  }
}

// ==================== 事件类型 ====================

export interface ExpertPoolEvent {
  type: 'expert_pool_start' | 'expert_start' | 'expert_done' | 'multi_expert_complete';
  taskId: string;
  expertId?: string;
  modelId?: string;
  latencyMs?: number;
  success?: boolean;
  error?: string;
  experts?: string[];
  fusion?: {
    merged: number;
    contradictions: number;
    associations: number;
    durationMs: number;
  };
}
