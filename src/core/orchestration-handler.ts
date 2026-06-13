/**
 * 编排处理器 — 多任务编排 + 多专家并行
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 4）
 */

import type { WSEvent } from '../types.js';
import type { EventBus } from '../ws/server.js';
import type { Subsystems } from './subsystems.js';
import type { BehaviorTracker } from './behavior-tracker.js';
import { ExecutionSession } from './execution-session.js';
import { ExpertPool } from './expert-pool.js';
import type { AdaptiveTaskQueue } from './task-queue.js';
import type { TaskExecutor } from '../orchestrate/index.js';
import type { LinkDiagnostics } from './link-diagnostics.js';

export interface OrchestrationDeps {
  sys: Subsystems;
  eventBus: EventBus | null;
  verbose: boolean;
  taskExecutor: TaskExecutor;
  taskQueue: AdaptiveTaskQueue;
  expertPool: ExpertPool;
  linkDiag: LinkDiagnostics;
  broadcastEmotion: () => void;
  broadcastStatus: () => void;
  checkAndEmitEvolution: (result: { evolved?: boolean; previousStage?: string; newStage?: string }) => void;
  emitGuidanceIfAny: () => void;
}

export class OrchestrationHandler {
  private sessionCounter = 0;
  private currentSession: ExecutionSession | null = null;

  constructor(private deps: OrchestrationDeps) {}

  /** 获取当前 ExecutionSession（供状态查询使用） */
  getCurrentSession(): ExecutionSession | null { return this.currentSession; }

  /** 记录会话计数器偏移（与主 handler 同步） */
  setSessionCounter(counter: number): void { this.sessionCounter = counter; }
  getSessionCounter(): number { return this.sessionCounter; }

  /**
   * 多专家并行处理入口
   */
  async handleMultiExpertParallel(
    content: string,
    handleMultiExpert: (results: Array<{ expertId: string; text: string; success: boolean; concepts?: string[]; confidence?: number }>, userMessage: string) => Promise<void>,
    TIMEOUT_EXPERT_MS: number,
  ): Promise<void> {
    const taskId = `mep-${Date.now()}`;
    const taskStartTime = Date.now();
    let taskSuccess = true;

    try {
      await this.deps.taskQueue.acquire(taskId);
    } catch (err) {
      this.deps.eventBus?.emit({ type: 'error', message: '系统繁忙，请稍后重试' });
      return;
    }

    this.deps.taskQueue.releaseExpired(TIMEOUT_EXPERT_MS);

    const session = new ExecutionSession({
      id: `mep-${++this.sessionCounter}-${Date.now()}`,
      goal: content.slice(0, 200), autonomyLevel: 2, maxRetries: 1, maxSteps: 10, checkpointInterval: 5,
    });
    session.start();
    this.currentSession = session;

    this.deps.eventBus?.emit({ type: 'thinking' });

    try {
      const selectStep = session.addStep('select_experts', { content });
      const modelRouter = this.deps.sys.llm.getRouter();
      const experts = await ExpertPool.selectExpertsForTask(
        content, [{ id: 'default', provider: 'default', model: 'default' }], modelRouter,
      );
      session.completeStep(selectStep.id, `选择了 ${experts.length} 个专家`, true);

      if (this.deps.verbose) console.log(`  [MultiExpert] 选择了 ${experts.length} 个专家: ${experts.map(e => e.id).join(', ')}`);

      const callStep = session.addStep('expert_call', { expertCount: experts.length });
      const results = await this.deps.expertPool.runParallel(experts, content, { timeoutMs: 30_000, earlyTerminate: false });
      const successCount = results.filter(r => r.success).length;
      session.completeStep(callStep.id, `${successCount}/${results.length} 专家成功`, successCount > 0);

      const fusionStep = session.addStep('fusion', { resultCount: results.length });
      await handleMultiExpert(results, content);
      session.completeStep(fusionStep.id, '融合完成', true);

      this.deps.eventBus?.emit({
        type: 'multi_expert_result', taskId,
        experts: results.map(r => ({ id: r.expertId, success: r.success, latencyMs: r.latencyMs })),
      } as WSEvent);

      session.complete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('多专家并行处理错误:', msg);
      this.deps.linkDiag.recordError(msg);
      session.fail(msg);
      taskSuccess = false;
      this.deps.eventBus?.emit({ type: 'error', message: `多专家处理失败: ${msg}` });
    } finally {
      const stats = session.getStats();
      if (this.deps.verbose) console.log(`  [MultiExpert] ${session.id} 结束: ${stats.completedSteps}/${stats.totalSteps} 步完成`);
      this.currentSession = null;
      this.deps.taskQueue.release(taskId, {
        id: taskId, latencyMs: Date.now() - taskStartTime, success: taskSuccess, timestamp: Date.now(),
      });
      this.deps.eventBus?.emit({ type: 'idle' });
    }
  }

  /** 多任务编排执行 */
  async handleOrchestrate(content: string): Promise<void> {
    const taskId = `orch-${Date.now()}`;
    const taskStartTime = Date.now();
    let taskSuccess = true;

    try {
      await this.deps.taskQueue.acquire(taskId);
    } catch (err) {
      this.deps.eventBus?.emit({ type: 'error', message: '系统繁忙，请稍后重试' });
      return;
    }

    this.deps.taskQueue.releaseExpired(120_000);

    const session = new ExecutionSession({
      id: `orch-${++this.sessionCounter}-${Date.now()}`,
      goal: content.slice(0, 200), autonomyLevel: 2, maxRetries: 2, maxSteps: 50, checkpointInterval: 10,
    });
    session.start();
    this.currentSession = session;

    this.deps.eventBus?.emit({ type: 'thinking' });
    this.deps.sys.cerebellum?.onThinking();
    this.deps.broadcastEmotion();

    try {
      const planStep = session.addStep('dag_planner', { content });
      const dag = await this.deps.sys.dagPlanner.plan(content);
      session.completeStep(planStep.id, `规划了 ${dag.tasks.size} 个任务`, true);
      if (this.deps.verbose) console.log(`  [Orch] 规划了 ${dag.tasks.size} 个任务`);

      const execStep = session.addStep('dag_execute', { taskCount: dag.tasks.size });
      const result = await this.deps.taskExecutor.execute(dag, (event) => {
        this.deps.eventBus?.emit(event as WSEvent);
      });
      session.completeStep(execStep.id, result.summary.slice(0, 500), true);

      try {
        if (this.deps.sys.workflowManager) {
          const workflow = await this.deps.sys.workflowManager.createFromDAG(dag, `auto-${Date.now()}`, content.slice(0, 100), 'dev');
          if (this.deps.verbose) console.log(`  [Workflow] 已保存: ${workflow.id}`);
        }
      } catch (err) {
        if (this.deps.verbose) console.warn('[Workflow] 保存失败:', (err as Error).message);
      }

      this.deps.sys.memory.addMessage('assistant', result.summary);
      this.deps.eventBus?.emit({ type: 'llm_response', content: result.summary });
      const orchTrack = this.deps.sys.pet.trackFeature('orchestrate');
      this.deps.checkAndEmitEvolution(orchTrack);
      this.deps.sys.cerebellum?.onTaskComplete();
      this.deps.broadcastStatus();
      this.deps.broadcastEmotion();

      session.complete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('编排执行错误:', msg);
      this.deps.linkDiag.recordError(msg);
      session.fail(msg);
      taskSuccess = false;
      this.deps.eventBus?.emit({ type: 'error', message: `编排失败: ${msg}` });
    } finally {
      const stats = session.getStats();
      if (this.deps.verbose) console.log(`  [Session] ${session.id} 编排结束: ${stats.completedSteps}/${stats.totalSteps} 步完成`);
      this.currentSession = null;
      this.deps.taskQueue.release(taskId, {
        id: taskId, latencyMs: Date.now() - taskStartTime, success: taskSuccess, timestamp: Date.now(),
      });
      this.deps.eventBus?.emit({ type: 'idle' });
    }
  }

  /**
   * 多专家结果融合写入
   */
  async handleMultiExpert(
    results: Array<{ expertId: string; text: string; success: boolean; concepts?: string[]; confidence?: number }>,
    userMessage: string,
  ): Promise<void> {
    const sensorFusion = this.deps.sys.cerebellum?.sensorFusion;
    if (!sensorFusion) {
      if (this.deps.verbose) console.warn('[MultiExpert] SensorFusion 未初始化');
      return;
    }

    for (const result of results) {
      if (result.success && result.text) {
        sensorFusion.ingest({
          source: result.expertId, content: result.text,
          concepts: result.concepts ?? this.extractConcepts(result.text),
          confidence: result.confidence ?? 0.8,
        });
      }
    }

    const fusionResult = sensorFusion.flush();

    this.deps.eventBus?.emit({
      type: 'multi_expert_complete',
      experts: results.filter(r => r.success).length,
      fusion: fusionResult,
    } as WSEvent);

    if (this.deps.verbose) {
      console.log(`  [MultiExpert] ${results.length} 专家结果 → 融合: ${fusionResult.merged} 条, 矛盾: ${fusionResult.contradictions}, 关联: ${fusionResult.associations} (${fusionResult.durationMs}ms)`);
    }
  }

  private extractConcepts(text: string): string[] {
    const chineseWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];
    const englishWords = text.match(/\b[A-Za-z]{3,}\b/g) ?? [];
    const all = [...chineseWords, ...englishWords.map(w => w.toLowerCase())];
    return [...new Set(all)].slice(0, 20);
  }
}
