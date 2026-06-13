import {
  type BehaviorAccumulator, createAccumulator,
  TOOL_CATEGORIES, NEGATION_PATTERNS, BEHAVIOR_COMPUTE_INTERVAL,
} from './constants.js';
import type { PetManager } from '../pet/index.js';

/**
 * 行为追踪器 — 累积交互信号，定期计算5维行为属性
 */
export class BehaviorTracker {
  private accumulator: BehaviorAccumulator = createAccumulator();
  private lastUserMessage: string = '';

  constructor(private pet: PetManager, private verbose: boolean) {}

  /** 追踪一次工具使用 */
  trackTool(toolName: string): void {
    const cat = TOOL_CATEGORIES[toolName];
    if (cat) {
      this.accumulator.toolCategories[cat] = (this.accumulator.toolCategories[cat] || 0) + 1;
    }
    this.accumulator.uniqueTools.add(toolName);
  }

  /** 追踪反馈信号 */
  trackFeedback(correction: { type: string; negative?: boolean }): void {
    if (correction.type === 'correction') {
      this.accumulator.correctionCount++;
    } else if (correction.type === 'encouragement') {
      this.accumulator.encourageCount++;
    } else if (correction.negative) {
      this.accumulator.negationCount++;
    }
  }

  /** 检测否定/打断信号 */
  detectNegation(content: string): boolean {
    return NEGATION_PATTERNS.test(content.trim());
  }

  /** 检测重复问题 */
  detectRepeat(content: string): boolean {
    if (!this.lastUserMessage) return false;
    const a = content.replace(/\s/g, '').slice(0, 10);
    const b = this.lastUserMessage.replace(/\s/g, '').slice(0, 10);
    return a.length > 3 && a === b;
  }

  /** 设置最后一条用户消息 */
  setLastMessage(content: string): void {
    this.lastUserMessage = content;
  }

  /** 累积一次交互并检查是否触发行为计算 */
  accumulate(): void {
    this.accumulator.totalInteractions++;
    if (this.accumulator.totalInteractions % BEHAVIOR_COMPUTE_INTERVAL !== 0) return;

    this.pet.computeBehaviorSignals({
      toolCategories: { ...this.accumulator.toolCategories },
      correctionCount: this.accumulator.correctionCount,
      encourageCount: this.accumulator.encourageCount,
      negationCount: this.accumulator.negationCount,
      repeatQuestionCount: this.accumulator.repeatQuestionCount,
      uniqueToolsUsed: this.accumulator.uniqueTools.size,
      totalInteractions: this.accumulator.totalInteractions,
    });

    if (this.verbose) {
      console.log(`  [行为] 5维属性已重新计算 (${this.accumulator.totalInteractions} 次交互)`);
    }
  }
}
