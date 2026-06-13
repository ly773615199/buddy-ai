/**
 * 经验闭环 — 自动训练触发 + 意图扩展 + 工具健康注入 + 消息后处理
 *
 * 从 agent.ts 提取。
 * 职责：执行后的学习闭环（自动训练、意图扩展、工具健康反馈、结果后处理）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OrchestrationPlan, ExecutionResult } from '../types.js';
import type { TaskSignal } from './agent-types.js';
import type { Subsystems } from './subsystems.js';
import type { MessageProcessor } from './message-processor.js';
import type { BehaviorTracker } from './behavior-tracker.js';
import { toNNSample } from '../brain/right/scene/index.js';
import type { KnowledgeBridge } from '../brain/right/scene/index.js';
import type { RuntimeCollector } from '../brain/right/scene/runtime-collector.js';
import type { PendingSnapshot } from '../brain/right/scene/runtime-collector.js';
import { logger } from '../audit/structured-logger.js';

const log = logger.child('ExperienceLoop');

// ==================== 自动训练触发 ====================

/**
 * Phase 7: 自动训练触发
 * 检查所有领域画像，达到 trainable 且未触发过的领域自动提交训练
 */
export async function autoTriggerTraining(
  sys: Subsystems,
  autoTrainingTriggered: Set<string>,
  saveAutoTrainingTriggered: () => void,
  verbose: boolean,
): Promise<void> {
  try {
    const profiles = sys.cognitive.getAllDomainProfiles();
    for (const profile of profiles) {
      if (profile.growthStage !== 'trainable' && profile.growthStage !== 'mature') continue;
      if (autoTrainingTriggered.has(profile.domain)) continue;

      autoTrainingTriggered.add(profile.domain);
      saveAutoTrainingTriggered();

      if (verbose) console.log(`[AutoTrain] 领域 "${profile.domain}" 达到 ${profile.growthStage}，自动触发训练管道`);

      executeAutoTraining(sys, profile.domain, verbose).catch(err => {
        if (verbose) console.warn(`[AutoTrain] 领域 "${profile.domain}" 训练失败:`, err.message);
      });
    }
  } catch (err) {
    if (verbose) console.warn('[AutoTrain] 检查失败:', (err as Error).message);
  }
}

/** 执行自动训练流程：导出数据 → 提交训练 */
async function executeAutoTraining(sys: Subsystems, domain: string, verbose: boolean): Promise<void> {
  const { TrainingExporter } = await import('../intelligence/training-exporter.js');
  const exporter = new TrainingExporter(sys.stmp, sys.cognitive, { enableAugmentation: true }, verbose, sys.dataAugmentor);

  const result = await exporter.exportDomain(domain);
  if (result.exportedSamples < 10) {
    if (verbose) console.log(`[AutoTrain] 领域 "${domain}" 样本不足 (${result.exportedSamples} < 10)，跳过训练`);
    return;
  }

  if (verbose) console.log(`[AutoTrain] 领域 "${domain}" 导出 ${result.exportedSamples} 条训练数据，提交训练`);

  try {
    const job = await sys.loraService.startTraining(domain);
    if (verbose) console.log(`[AutoTrain] 领域 "${domain}" 训练已提交: ${job.id} (状态: ${job.status})`);
  } catch (err) {
    if (verbose) console.log(`[AutoTrain] LoRA 训练不可用，尝试三进制训练: ${(err as Error).message}`);
    try {
      await sys.feedTernaryScheduler();
      const trainResult = await sys.ternaryScheduler.forceTrain(domain);
      if (trainResult) {
        if (verbose) console.log(`[AutoTrain] 三进制训练完成: ${domain} loss ${trainResult.initialLoss.toFixed(4)}→${trainResult.finalLoss.toFixed(4)}`);
      }
    } catch (ternaryErr) {
      if (verbose) console.warn(`[AutoTrain] 三进制训练也失败: ${(ternaryErr as Error).message}`);
    }
  }
}

// ==================== 自动意图扩展 ====================

/**
 * Phase 5: 自动意图扩展 — 分类器频繁低置信度时触发 expandIntentHead
 *
 * 自适应策略（替代固定阈值）：
 * - 窗口大小：随总样本缩放，bounded [20, 100]
 * - 触发条件：z 检验 — 低置信度率是否显著高于基线 (10%)
 * - 意图上限：跟 NN 容量 (hiddenDim) 和训练数据量挂钩
 */
export function autoExpandIntents(
  sys: Subsystems,
  decisionTrace: Array<{ path: string; localConfidence: number; input: string }>,
  verbose: boolean,
): void {
  const threeBrain = sys.threeBrain;
  if (!threeBrain) return;

  try {
    const stats = threeBrain.right.getLearnStats();
    const config = threeBrain.right.getNNConfig();
    const totalSamples = stats.totalSamples ?? 0;

    const dataBound = Math.max(8, Math.floor(Math.sqrt(totalSamples / 7)));
    const capacityBound = Math.max(8, Math.floor(config.hiddenDim / 8));
    const maxIntents = Math.min(16, dataBound, capacityBound);
    if (config.numIntents >= maxIntents) return;

    const windowSize = Math.min(100, Math.max(20, Math.floor(totalSamples / 5)));
    const recent = decisionTrace.slice(-windowSize);

    const lowConfCount = recent.filter(t =>
      t.path === 'threeBrain' && t.localConfidence < 0.3,
    ).length;
    const n = recent.filter(t => t.path === 'threeBrain').length;
    if (n < 10) return;

    const pHat = lowConfCount / n;
    const p0 = 0.10;
    const z = (pHat - p0) / Math.sqrt(p0 * (1 - p0) / n);

    if (z <= 1.645) return;

    const lowConfInputs = recent
      .filter(t => t.path === 'threeBrain' && t.localConfidence < 0.3)
      .map(t => t.input);

    const patterns = new Map<string, number>();
    for (const input of lowConfInputs) {
      const words = input.match(/[\u4e00-\u9fa5]{2,}|[a-z]{3,}/gi) ?? [];
      for (const word of words) {
        patterns.set(word, (patterns.get(word) ?? 0) + 1);
      }
    }

    const frequent = [...patterns.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (frequent.length === 0) return;

    const newIntents = [{
      label: `auto_${Date.now()}`,
      description: `自动扩展: 高频未覆盖模式 ${frequent.map(([w]) => w).join(', ')}`,
      estimatedSamples: lowConfCount,
    }];

    if (verbose) {
      console.log(
        `[AutoExpand] z=${z.toFixed(2)} > 1.645, p̂=${(pHat * 100).toFixed(1)}% (${lowConfCount}/${n}), ` +
        `window=${windowSize}, intents=${config.numIntents}/${maxIntents}, ` +
        `扩展: ${newIntents[0].description}`,
      );
    }

    threeBrain.right.expandIntentHead(newIntents).catch(err => {
      if (verbose) console.warn('[AutoExpand] 意图扩展失败:', err.message);
    });
  } catch (err) {
    if (verbose) console.warn('[AutoExpand] 检查失败:', (err as Error).message);
  }
}

// ==================== 工具健康注入 ====================

/** 将工具健康数据注入三脑（影子大脑缺口检测 + 左脑调度器） */
export function feedToolHealthToBrain(sys: Subsystems, verbose: boolean): void {
  const threeBrain = sys.threeBrain;
  if (!threeBrain) return;

  try {
    const growth = sys.skillManager.growth;
    const allHealth = growth.getAllHealth();
    if (allHealth.length === 0) return;

    const metrics = allHealth.map(h => ({
      name: h.name,
      reliability: h.reliability,
      healthScore: h.healthScore,
      totalCalls: growth.getMetric(h.name)?.totalCalls ?? 0,
      failureCount: growth.getMetric(h.name)?.failureCount ?? 0,
      lastError: growth.getMetric(h.name)?.lastError,
    }));

    threeBrain.feedToolHealth(metrics);
  } catch (err) {
    if (verbose) console.warn('[ExperienceLoop] feedToolHealth 失败:', (err as Error).message);
  }
}

// ==================== 消息后处理 ====================

/**
 * 消息后处理 — 存回复 + 工具追踪 + 知识提取 + 学习
 * CLI/WS 共用
 */
export function postprocessResult(
  sys: Subsystems,
  processor: MessageProcessor,
  behavior: BehaviorTracker,
  content: string,
  result: { text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }> },
  runtimeCollector: RuntimeCollector | null,
  knowledgeBridge: KnowledgeBridge | null,
  pendingSnapshots: Map<string, PendingSnapshot>,
  verbose: boolean,
): void {
  sys.memory.addMessage('assistant', result.text);
  processor.storeToSTMP('assistant', result.text);
  recordInteraction(sys, result);
  sys.cerebellum?.onResponseComplete();
  if (result.toolCalls.length > 0) {
    sys.cerebellum?.onTaskComplete();
  }
  behavior.accumulate();

  if (result.toolCalls.length > 0) {
    const toolNames = result.toolCalls.map(tc => tc.name);
    sys.cognitive.inferFromMessage(result.text, toolNames);
    sys.cognitive.inferGoals(result.text, toolNames);
  }

  // Phase 3: 工具执行后快照捕获 → 世界模型训练样本
  if (runtimeCollector && result.toolCalls.length > 0) {
    for (const tc of result.toolCalls) {
      const pending = pendingSnapshots.get(tc.name);
      if (pending) {
        runtimeCollector.captureAfter(pending, {
          success: !tc.result.startsWith('['),
          latencyMs: 0,
          output: tc.result.slice(0, 200),
        });
        pendingSnapshots.delete(tc.name);
      }
    }
  }

  // 异步知识提取 + KnowledgeBridge 桥接
  processor.extractKnowledgeAsync().then(extracted => {
    if (knowledgeBridge && extracted && extracted.length > 0) {
      const samples = knowledgeBridge.convert(extracted);
      if (samples.length > 0) {
        for (const s of samples) {
          sys.threeBrain?.right.ingestExternalSample(toNNSample(s));
        }
        if (verbose) console.log(`[KnowledgeBridge] ${samples.length} knowledge → training samples`);
      }
    }
  }).catch(err => { if (verbose) console.warn('[ExperienceLoop] extractKnowledgeAsync 失败:', err.message); });

  processor.learnFromConversation(content, result);

  // 反馈闭环
  const recorder = sys.router.getDecisionRecorder();
  if (recorder) {
    const hasError = result.toolCalls.some(tc => tc.result?.startsWith('['));
    recorder.updateLastOutcome(content, {
      success: !hasError && result.text.length > 0,
      costEstimate: 0,
    });
  }
}

/** 记录互动 */
function recordInteraction(
  sys: Subsystems,
  result: { toolCalls: Array<{ name: string }> },
): void {
  if (result.toolCalls.length > 0) {
    sys.pet.addIntimacy(2);
  }
  for (const tc of result.toolCalls) {
    sys.memory.setMemory('tool_usage', tc.name, `最近使用于 ${new Date().toLocaleString('zh-CN')}`, 1);
  }
}

// ==================== 持久化辅助 ====================

/** 加载已触发的自动训练领域列表 */
export function loadAutoTrainingTriggered(filePath: string): Set<string> {
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(raw)) return new Set(raw);
    }
  } catch (e) { console.debug('[ExperienceLoop] load fail', e); }
  return new Set();
}

/** 持久化已触发的自动训练领域列表 */
export function saveAutoTrainingTriggered(filePath: string, triggered: Set<string>): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([...triggered]));
  } catch (e) { console.debug('[ExperienceLoop] persist fail', e); }
}
