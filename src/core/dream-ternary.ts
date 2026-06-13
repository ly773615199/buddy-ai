/**
 * 梦境巩固 + 三进制训练触发器
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 4）
 */

import type { DreamSession } from '../memory/dream.js';
import type { EventBus } from '../ws/server.js';
import type { Subsystems } from './subsystems.js';
import type { BehaviorTracker } from './behavior-tracker.js';
import type { BuddyConfig } from '../types.js';

export interface DreamTernaryDeps {
  sys: Subsystems;
  eventBus: EventBus | null;
  behavior: BehaviorTracker;
  config: BuddyConfig;
  verbose: boolean;
  broadcastEmotion: () => void;
  broadcastStatus: () => void;
  checkAndEmitEvolution: (result: { evolved?: boolean; previousStage?: string; newStage?: string }) => void;
  emitGuidanceIfAny: () => void;
}

export class DreamTernaryHandler {
  constructor(private deps: DreamTernaryDeps) {}

  /** 尝试触发梦幻巩固（三合一改造：引入 rest 欲望） */
  async tryDream(trigger: DreamSession['trigger']): Promise<void> {
    const restDesire = this.deps.sys.cerebellum?.getDesires().rest;
    if (!this.deps.sys.dream.shouldDream(trigger, 0, restDesire)) return;

    this.deps.eventBus?.emit({ type: 'idle_action', action: 'sleep' });
    this.deps.sys.cerebellum?.onIdle(30);

    try {
      const session = await this.deps.sys.dream.dream(trigger);
      const dreamTrack = this.deps.sys.pet.trackFeature('dream_consolidate');
      this.deps.checkAndEmitEvolution(dreamTrack);
      this.deps.sys.cerebellum?.onDreamComplete();

      if (this.deps.eventBus) {
        this.deps.eventBus.emit({ type: 'bubble', text: session.journal });
        this.deps.eventBus.emit({ type: 'dream_complete', journal: session.journal, timestamp: Date.now() });
        this.deps.sys.memory.addMessage('assistant', session.journal);
        this.deps.sys.memory.addDiaryEntry(`💭 梦境日志:\n${session.journal}`, 'dreaming');
        this.deps.emitGuidanceIfAny();
      }

      try {
        this.deps.sys.intelligence.dream();
        await this.deps.sys.intelligence.save();
        try {
          const packs = this.deps.sys.knowledgeExporter.exportAllMature();
          if (packs.length > 0 && this.deps.verbose) {
            console.log(`  [KnowledgeExporter] 梦境导出 ${packs.length} 个成熟领域知识包`);
          }
        } catch (err) {
          if (this.deps.verbose) console.warn('[KnowledgeExporter] 导出失败:', (err as Error).message);
        }
      } catch (err) {
        if (this.deps.verbose) console.warn('[Dream] 技能巩固失败:', (err as Error).message);
      }
    } catch (err) {
      if (this.deps.verbose) console.warn('[Dream] 梦境失败:', (err as Error).message);
    }

    this.deps.broadcastEmotion();
  }

  /** 三进制训练心跳 — 注入知识并检查是否触发训练 */
  async tryTernaryTrain(): Promise<void> {
    try {
      const fed = await this.deps.sys.feedTernaryScheduler();
      if (fed === 0) return;

      const pending = this.deps.sys.ternaryScheduler.getPendingSummary();
      const topDomain = pending.length > 0 ? pending[0].domain : 'unknown';

      const result = await this.deps.sys.ternaryScheduler.checkAndTrain();
      if (!result) return;

      if (this.deps.verbose) {
        console.log(`[Ternary] ${topDomain} 训练完成: loss ${result.initialLoss.toFixed(4)} → ${result.finalLoss.toFixed(4)} | 步数: ${result.steps}`);
      }

      this.deps.eventBus?.emit({
        type: 'ternary_train_complete',
        domain: topDomain,
        success: result.success,
        initialLoss: result.initialLoss,
        finalLoss: result.finalLoss,
        steps: result.steps,
        timestamp: Date.now(),
      });

      if (result.success) {
        await this.deps.sys.ternaryRouter.init().catch(err => { if (this.deps.verbose) console.warn('[Ternary] 训练后 router.init 失败:', err.message); });

        const experts = this.deps.sys.ternaryRouter.listExperts();
        const llmRouter = this.deps.sys.llm.getRouter();
        for (const expert of experts) {
          const routerRef = this.deps.sys.ternaryRouter;
          llmRouter.registerLocalExpert({
            domain: expert.domain,
            confidence: 0.75,
            capabilities: {
              toolCalling: false, streaming: false, structuredOutput: false, vision: false,
              maxContextTokens: 512, maxOutputTokens: 256, toolChoice: false,
              parallelToolCalls: false, needsPromptToolCalling: true, preferredToolFormat: 'natural',
              supportsDeveloperRole: false,
            },
            query: async (prompt: string) => {
              const r = await routerRef.query(expert.domain, prompt);
              return r.answer;
            },
          });
        }
      }
    } catch (err) {
      if (this.deps.verbose) console.warn('[Ternary] 调度训练失败:', (err as Error).message);
    }
  }
}
