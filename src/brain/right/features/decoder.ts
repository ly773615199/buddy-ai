/**
 * 输出解码器 — 将 NN 输出 logits 解码为 IntuitionDecision
 *
 * intent logits → 意图类别 + 置信度
 * tool logits → 推荐工具子集
 * quality logit → 质量预判
 */

import type { IntuitionDecision, IntuitionSignal } from '../../types.js';
import type { ModelOutput } from '../nn/model.js';
import type { PrototypeMemory, PrototypeMatch } from '../prototype-memory.js';
import { getToolIdMap } from './encoder.js';

const INTENT_LABELS = [
  'file_operations', 'code_operations', 'git_operations', 'web_operations',
  'system_operations', 'knowledge_query', 'conversation', 'complex_task',
];

const TOOL_THRESHOLD = 0.3;  // tool probability 阈值
const INTENT_THRESHOLD = 0.2;

/**
 * 解码为 IntuitionDecision
 */
export function decodeDecision(output: ModelOutput): IntuitionDecision {
  // 意图：取 argmax
  let maxIdx = 0;
  let maxVal = output.intentProbs[0];
  for (let i = 1; i < output.intentProbs.length; i++) {
    if (output.intentProbs[i] > maxVal) {
      maxVal = output.intentProbs[i];
      maxIdx = i;
    }
  }

  // 工具：所有工具概率 + 阈值过滤的子集
  const toolMap = getToolIdMap();
  const tools: Array<{ name: string; probability: number }> = [];   // 超过阈值的
  const allTools: Array<{ name: string; probability: number }> = []; // 全部
  for (let i = 0; i < output.toolProbs.length; i++) {
    const name = toolMap.get(50 + i);
    if (name) {
      allTools.push({ name, probability: output.toolProbs[i] });
      if (output.toolProbs[i] > TOOL_THRESHOLD) {
        tools.push({ name, probability: output.toolProbs[i] });
      }
    }
  }

  return {
    intent: {
      category: INTENT_LABELS[maxIdx] ?? 'conversation',
      confidence: maxVal,
    },
    intentDistribution: new Float32Array(output.intentProbs),
    tools,
    allTools,
    quality: output.qualityScore,
    confidence: maxVal,
    latencyMs: output.latencyMs,
  };
}

/**
 * 解码为 IntuitionSignal（RightBrain 对外接口）
 *
 * 双通道：intentHead + PrototypeMemory 并行运行
 * - 通道 A：intentHead → argmax → 8 类意图（快速、确定）
 * - 通道 B：原型匹配 → 最近原型 + 工具先验（动态、模糊）
 */
export function decodeSignal(output: ModelOutput, protoMem?: PrototypeMemory): IntuitionSignal {
  const decision = decodeDecision(output);

  // 通道 A：intentHead（始终运行）
  const intentResult = decision.intent;

  // 通道 B：原型匹配（始终运行，需要 hidden 向量）
  let protoMatch: IntuitionSignal['protoMatch'];
  let suggestedTools = decision.tools
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6)
    .map(t => t.name);

  if (protoMem && output._hidden) {
    const match = protoMem.findNearest(output._hidden);
    if (match) {
      protoMatch = {
        prototype: { id: match.prototype.id, label: match.prototype.label },
        distance: match.distance,
        confidence: match.confidence,
        isNovel: match.isNovel,
      };

      // 原型命中时，用原型的工具先验覆盖（数据驱动的工具选择）
      if (!match.isNovel) {
        const protoTools = match.prototype.topTools(6);
        if (protoTools.length > 0) {
          suggestedTools = protoTools;
        }
      }
    }
  }

  return {
    intent: intentResult,
    protoMatch,
    suggestedTools,
    qualityEstimate: decision.quality,
    hit: decision.confidence > INTENT_THRESHOLD,
  };
}
