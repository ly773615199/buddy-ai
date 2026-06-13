/**
 * LawClassifier — 法则系统（规则→法则进化）
 *
 * 6 条互斥法则，替代复杂条件嵌套：
 * 1. 确定性执行 — 输入可直接映射到工具（规则命中）
 * 2. 信息检索 — 需要外部信息（搜索/知识库）
 * 3. 生成创造 — 需要 LLM（复杂推理/创作）
 * 4. 交互澄清 — 信息不足，需追问用户
 * 5. 组合编排 — 可分解为子任务（DAG）
 * 6. 降级兜底 — 以上都不匹配时的默认路径
 *
 * 法则决定路径，调度器选具体模型。
 */

import type { TaskSignal, ResourceState, ExecutionPlan } from '../types.js';
import type { RuleEngine } from './rule-engine.js';

export type LawId = 1 | 2 | 3 | 4 | 5 | 6;

export interface LawResult {
  law: LawId;
  confidence: number;
  reason: string;
  /** 法则命中后的执行建议（可选，法则 1 直接给 plan） */
  plan?: ExecutionPlan;
}

export class LawClassifier {
  constructor(private verbose = false) {}

  /**
   * 分类法则 — 输入只会命中一条（互斥）
   * 优先级: 1 > 5 > 4 > 2 > 3 > 6
   */
  classify(
    signal: TaskSignal,
    resources: ResourceState,
    ruleEngine: RuleEngine,
  ): LawResult {
    // 法则 1: 确定性执行 — 规则引擎命中
    const rulePlan = ruleEngine.evaluate(signal, resources);
    if (rulePlan) {
      return {
        law: 1,
        confidence: rulePlan.confidence,
        reason: `规则命中: ${rulePlan.reason}`,
        plan: rulePlan,
      };
    }

    // 法则 5: 组合编排 — DAG
    if (signal.shouldUseDAG) {
      return {
        law: 5,
        confidence: 0.7,
        reason: `多步任务: ${signal.dagReason}`,
      };
    }

    // 法则 4: 交互澄清 — 低置信度 + 非闲聊
    if (signal.intentConfidence < 0.3 && signal.taskType !== 'chat') {
      return {
        law: 4,
        confidence: 0.6,
        reason: '意图不明确，需要澄清',
      };
    }

    // 法则 2: 信息检索 — 知识/搜索领域
    if (signal.domains.includes('knowledge') || signal.domains.includes('web')) {
      return {
        law: 2,
        confidence: 0.7,
        reason: `需要外部信息: ${signal.domains.join(', ')}`,
      };
    }

    // 法则 3: 生成创造 — 复杂任务 + LLM
    if (signal.complexity === 'complex' || signal.taskType === 'reasoning') {
      return {
        law: 3,
        confidence: 0.65,
        reason: `复杂任务，需要 LLM: ${signal.complexity}`,
      };
    }

    // 法则 6: 降级兜底
    return {
      law: 6,
      confidence: 0.5,
      reason: '无匹配法则，走默认路径',
    };
  }

  /** 法则编号 → 名称 */
  static lawName(law: LawId): string {
    const names: Record<LawId, string> = {
      1: '确定性执行',
      2: '信息检索',
      3: '生成创造',
      4: '交互澄清',
      5: '组合编排',
      6: '降级兜底',
    };
    return names[law];
  }
}
