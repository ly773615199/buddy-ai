/**
 * 经验模型引擎 — 统一入口
 *
 * 将经验图谱 + 编译器 + 路由器 + 执行器 + 进化器 + 检查函数 + 量化指标
 * 组合为一个完整引擎。
 */

export { ExperienceGraph } from './experience-graph.js';
export { ExperienceCompiler } from './experience-compiler.js';
export { ExperienceRouter, type RouterConfig } from './experience-router.js';
export { ExperienceExecutor, type ToolExecutor, type PersonalityKey } from './experience-executor.js';
export { ExperienceEvolver, type EvolutionEvent, type StagnationState } from './experience-evolver.js';
export { CheckFunction, type CheckResult, type CheckContext } from './check-function.js';
export { MetricsCollector, type MetricSnapshot, type ExperienceMetrics } from './metrics.js';
export { PromptInjector, type InjectorConfig, type KnowledgeNode, type DomainKnowledgePack, type InjectionResult } from './prompt-injector.js';
export { TrainingExporter, type ExportConfig, type TrainingSample, type ExportResult, type DomainStats } from './training-exporter.js';
export type {
  ExperienceUnit,
  ExperienceStep,
  ExperienceEdge,
  EdgeType,
  ReplyTemplate,
  ExperienceVerifier,
  RouteDecision,
  RoutePath,
  ExperienceExecutionResult,
  ConversationSnapshot,
} from './types.js';

import { ExperienceGraph } from './experience-graph.js';
import { ExperienceCompiler, type LLMCaller } from './experience-compiler.js';
import { ExperienceRouter, type RouterConfig } from './experience-router.js';
import { ExperienceExecutor, type ToolExecutor, type PersonalityKey } from './experience-executor.js';
import { ExperienceEvolver } from './experience-evolver.js';
import { CheckFunction, type CheckContext } from './check-function.js';
import { MetricsCollector } from './metrics.js';
import { createSeedExperiences, shouldImportSeeds } from './seed-experiences.js';
import type { ConversationSnapshot, ExperienceExecutionResult, RouteDecision, ExperienceUnit } from './types.js';
import type { ToolSynthesizer } from '../core/tool-synthesizer.js';
import type { SkillManager } from '../skills/skill-manager.js';

export interface ExperienceConfig {
  dataDir?: string;
  router?: Partial<RouterConfig>;
  defaultPersonality?: PersonalityKey;
  /** 快速学习模式：前 N 次对话强制编译（跳过 canCompile 检查），默认 50 */
  fastLearnThreshold?: number;
  /** 调试模式 */
  verbose?: boolean;
}

export class ExperienceEngine {
  readonly graph: ExperienceGraph;
  readonly compiler: ExperienceCompiler;
  readonly router: ExperienceRouter;
  readonly executor: ExperienceExecutor;
  readonly evolver: ExperienceEvolver;
  readonly checkFn: CheckFunction;
  readonly metrics: MetricsCollector;

  private toolSynthesizer: ToolSynthesizer | null = null;
  private skillManager: SkillManager | null = null;
  private initialized = false;
  private fastLearnThreshold: number;
  private fastLearnCount = 0;
  private verbose: boolean;

  constructor(toolExecutor: ToolExecutor, config?: ExperienceConfig) {
    this.graph = new ExperienceGraph(config?.dataDir);
    this.compiler = new ExperienceCompiler();
    this.router = new ExperienceRouter(this.graph, config?.router);
    this.executor = new ExperienceExecutor(toolExecutor, {
      defaultPersonality: config?.defaultPersonality,
    });
    this.evolver = new ExperienceEvolver(this.graph, config?.dataDir);
    this.checkFn = new CheckFunction();
    this.metrics = new MetricsCollector();
    this.fastLearnThreshold = config?.fastLearnThreshold ?? 50;
    this.verbose = config?.verbose ?? false;
  }

  /**
   * Phase 6: 注入 LLM 调用器，启用推理增强编译
   */
  setLLMCaller(caller: LLMCaller): void {
    this.compiler.setLLMCaller(caller);
    this.evolver.setLLMCaller(caller);
  }

  /** 获取所有已编译的经验单元（供 KnowledgeExporter 使用） */
  getExperiences(): ExperienceUnit[] {
    return this.graph.getAllNodes();
  }

  /**
   * Sprint 3: 注入工具合成器和技能管理器
   */
  setToolSynthesizer(synthesizer: ToolSynthesizer, skillManager: SkillManager): void {
    this.toolSynthesizer = synthesizer;
    this.skillManager = skillManager;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.graph.load();

    // 冷启动引导：图谱为空时导入种子经验
    if (shouldImportSeeds(this.graph.size)) {
      const seeds = createSeedExperiences();
      for (const seed of seeds) {
        this.graph.addNode(seed);
      }
      this.graph.discoverEdges();
      console.log(`[ExperienceEngine] 冷启动：导入 ${seeds.length} 个种子经验`);
    }

    this.initialized = true;
  }

  /**
   * 完整处理流程：路由 → Check → 执行 → 反馈 → 量化
   */
  async process(
    input: string,
    contextTags: string[] = [],
    personality?: PersonalityKey,
    toolNames?: Set<string>,
  ): Promise<{ decision: RouteDecision; result?: ExperienceExecutionResult }> {
    const decision = this.router.route(input, contextTags);

    // 记录路由决策到 metrics
    this.metrics.recordInteraction(decision.path);

    // exp_direct 和 exp_verified 执行逻辑相同
    if ((decision.path === 'exp_direct' || decision.path === 'exp_verified') && decision.skill) {
      // Pre-check：执行前验证
      if (toolNames) {
        const checkCtx: CheckContext = {
          inputArgs: {},
          stepResults: [],
          toolNames,
        };
        const preResult = this.checkFn.preCheck(decision.skill, checkCtx);
        if (!preResult.passed) {
          // Pre-check 失败，降级到 LLM
          decision.path = 'llm_with_hint';
          decision.reason = `check_failed: ${preResult.message}`;
          return { decision };
        }
      }

      const startTime = Date.now();
      const result = await this.executor.execute(decision.skill, personality);
      const durationMs = Date.now() - startTime;

      // P6: 反思门不通过 → 降级到 LLM（不算技能失败）
      if (!result.success && (result as any).needsLLMFallback) {
        decision.path = 'llm_with_hint';
        decision.reason = `reflection_failed: ${result.error}`;
        return { decision };
      }

      // 记录执行结果
      this.metrics.recordExpExecution(result.success, durationMs);

      if (result.success) {
        this.evolver.onSuccess(decision.skill.id, result.executionMs);
      } else {
        this.evolver.onFailure(decision.skill.id, result.error ?? 'unknown');
      }
      return { decision, result };
    }

    // llm_with_hint / llm / llm_only → 不执行，返回路由决策
    return { decision };
  }

  /**
   * 从成功对话学习
   *
   * 快速学习模式：前 N 次对话强制编译，快速积累经验图谱
   */
  async learn(conv: ConversationSnapshot): Promise<boolean> {
    // 快速学习模式：跳过 canCompile 检查，强制编译
    const isFastMode = this.fastLearnCount < this.fastLearnThreshold;
    if (isFastMode) {
      this.fastLearnCount++;
    }

    // 快速学习模式下，即使工具调用失败也尝试编译（只记录成功的步骤）
    const skill = isFastMode
      ? await this.evolver.compileFromConversation({ ...conv, wasSuccessful: true })
      : await this.evolver.compileFromConversation(conv);

    if (skill) {
      // 根据步骤数量自动设置抽象层级
      if (skill.abstractionLevel === undefined) {
        (skill as any).abstractionLevel = skill.steps.length >= 3 ? 'workflow' : 'concrete';
      }

      // Sprint 3: 经验编译后自动检查是否触发工具合成
      this.trySynthesizeTool(skill);

      return true;
    }
    return false;
  }

  /**
   * Sprint 3: 尝试从经验单元合成工具
   */
  private trySynthesizeTool(unit: ExperienceUnit): void {
    if (!this.toolSynthesizer || !this.skillManager) return;

    try {
      const result = this.toolSynthesizer.trySynthesize(unit);
      if (!result) return;

      // 保存 .skillmate 文件到 skills 目录
      const skillDir = this.skillManager.getScanDir();
      if (!skillDir) return;

      const fileName = `${result.synthesized.definition.name}.skillmate`;
      const filePath = `${skillDir}/${fileName}`;
      const content = JSON.stringify(result.synthesized.definition, null, 2);

      // 使用 fs 写入（异步，不阻塞）
      import('fs/promises').then(fs =>
        fs.writeFile(filePath, content, 'utf-8').then(() => {
          // 重新扫描加载
          this.skillManager!.scanAndLoad().catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });
        })
      ).catch((err) => { if (this.verbose) console.debug('[DEBUG] 静默错误:', err?.message ?? err); });
    } catch {
      // 静默失败
    }
  }

  /**
   * 梦境巩固
   */
  dream(): void {
    this.evolver.dreamConsolidate();
  }

  /**
   * 保存状态
   */
  async save(): Promise<void> {
    await this.graph.save();
  }

  /**
   * 获取效果报告
   */
  getReport(): string {
    return this.metrics.generateReport();
  }

  /**
   * 统计信息
   */
  stats() {
    return {
      graph: this.graph.stats(),
      recentEvents: this.evolver.getRecentEvents(10),
      metrics: this.metrics.takeSnapshot(),
      fastLearn: {
        count: this.fastLearnCount,
        threshold: this.fastLearnThreshold,
        remaining: Math.max(0, this.fastLearnThreshold - this.fastLearnCount),
        active: this.fastLearnCount < this.fastLearnThreshold,
      },
    };
  }
}
