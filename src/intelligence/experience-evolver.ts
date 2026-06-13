/**
 * 经验进化器 — 置信度更新 + 梦境合并 + 经验淘汰
 *
 * 每次经验执行后更新置信度。
 * 梦境巩固阶段合并相似经验、淘汰低置信度经验。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExperienceUnit, ConversationSnapshot } from './types.js';
import type { EvolutionSignal } from '../brain/convergence/evolution-sink.js';
import { ExperienceGraph } from './experience-graph.js';
import { ExperienceCompiler, type LLMCaller } from './experience-compiler.js';

export interface EvolutionEvent {
  type: 'confidence_up' | 'confidence_down' | 'merged' | 'retired' | 'compiled' | 'stagnation_detected' | 'compile_blocked';
  skillId: string;
  detail: string;
  timestamp?: number;
}

export interface StagnationState {
  detected: boolean;
  detectedAt: number;
  resumeAt: number;           // 何时恢复自动编译
  reason: string;
}

export class ExperienceEvolver {
  private graph: ExperienceGraph;
  private compiler: ExperienceCompiler;
  private events: EvolutionEvent[] = [];
  private eventsPath: string;
  private stagnation: StagnationState = {
    detected: false,
    detectedAt: 0,
    resumeAt: 0,
    reason: '',
  };
  /** 信号汇聚层回调（v3.1） */
  private onConverge: ((signal: EvolutionSignal) => void) | null = null;

  constructor(graph: ExperienceGraph, dataDir?: string) {
    this.graph = graph;
    this.compiler = new ExperienceCompiler();
    const baseDir = dataDir ?? path.join(process.env.HOME ?? '/tmp', '.buddy');
    this.eventsPath = path.join(baseDir, 'experience-events.jsonl');
  }

  /**
   * Phase 6: 注入 LLM 调用器到编译器
   */
  setLLMCaller(caller: LLMCaller): void {
    this.compiler.setLLMCaller(caller);
  }

  /** 注入信号汇聚层回调（v3.1） */
  setConvergenceCallback(callback: (signal: EvolutionSignal) => void): void {
    this.onConverge = callback;
  }

  // ── 执行反馈 ──

  /**
   * 技能执行成功
   */
  onSuccess(skillId: string, executionMs: number): void {
    const skill = this.graph.getNode(skillId);
    if (!skill) return;

    skill.stats.successCount++;
    skill.stats.confidence = this.recalcConfidence(skill);
    skill.stats.lastUsed = Date.now();

    // 滑动平均执行时间
    const n = skill.stats.successCount;
    skill.stats.avgExecutionMs =
      skill.stats.avgExecutionMs * (n - 1) / n + executionMs / n;

    this.events.push({
      type: 'confidence_up',
      skillId,
      detail: `success=${skill.stats.successCount}, confidence=${skill.stats.confidence.toFixed(2)}`,
    });
    this.persistEvent(this.events[this.events.length - 1]);

    // v3.1: 接入信号汇聚层
    this.onConverge?.({
      eventType: 'success',
      skillId,
      detail: `success, confidence=${skill.stats.confidence.toFixed(2)}`,
      intent: undefined,
      tools: undefined,
    });
  }

  /**
   * 技能执行失败
   */
  onFailure(skillId: string, error: string): void {
    const skill = this.graph.getNode(skillId);
    if (!skill) return;

    skill.stats.failCount++;
    skill.stats.confidence = this.recalcConfidence(skill);
    skill.stats.lastUsed = Date.now();

    this.events.push({
      type: 'confidence_down',
      skillId,
      detail: `fail=${skill.stats.failCount}, confidence=${skill.stats.confidence.toFixed(2)}, error=${error}`,
    });
    this.persistEvent(this.events[this.events.length - 1]);

    // v3.1: 接入信号汇聚层
    this.onConverge?.({
      eventType: 'failure',
      skillId,
      detail: `fail, confidence=${skill.stats.confidence.toFixed(2)}, error=${error}`,
    });

    // 置信度太低 → 标记休眠
    if (skill.stats.confidence < 0.1 && skill.stats.failCount >= 5) {
      this.retire(skillId);
    }
  }

  /**
   * 从成功对话编译新技能
   */
  async compileFromConversation(conv: ConversationSnapshot): Promise<ExperienceUnit | null> {
    let skill = this.compiler.compile(conv);
    if (!skill) return null;

    // Phase 6: LLM 深度 DAG 分析（增强静态分析结果）
    if (skill.dagPattern) {
      const enhanced = await this.compiler.enhanceDAGWithLLM(conv, skill.dagPattern);
      skill = { ...skill, dagPattern: enhanced };
    }

    // Phase 6: 用 LLM 增强推理逻辑
    skill = await this.compiler.enhanceWithReasoning(skill, conv);

    // 检查是否已有非常相似的技能
    const similar = this.graph.match(
      conv.userMessage,
      skill.trigger.contextTags,
    );

    if (similar.length > 0) {
      const best = similar[0];
      const similarity = this.calcOverlap(best, skill);
      if (similarity > 0.7) {
        // 太相似，合并到已有经验
        this.mergeInto(best, skill);
        return best;
      }
    }

    // 新经验，加入图谱
    this.graph.addNode(skill);
    this.graph.discoverEdges();

    this.events.push({
      type: 'compiled',
      skillId: skill.id,
      detail: `from conversation: "${conv.userMessage.slice(0, 40)}"`,
    });
    this.persistEvent(this.events[this.events.length - 1]);

    return skill;
  }

  // ── 梦境巩固 ──

  /**
   * 梦境巩固：合并相似技能 + 发现隐藏关联
   */
  dreamConsolidate(): EvolutionEvent[] {
    const beforeEvents = this.events.length;

    // 1. 找到相似技能组
    const groups = this.graph.findSimilar(0.6);

    for (const group of groups) {
      // 按置信度排序，保留最强的
      group.sort((a, b) => b.stats.confidence - a.stats.confidence);
      const keeper = group[0];

      for (let i = 1; i < group.length; i++) {
        this.mergeInto(keeper, group[i]);
        this.graph.removeNode(group[i].id);
      }

      keeper.stats.evolved = true;
      keeper.stats.consolidatedAt = Date.now();

      this.events.push({
        type: 'merged',
        skillId: keeper.id,
        detail: `merged ${group.length} skills, confidence=${keeper.stats.confidence.toFixed(2)}`,
      });
      this.persistEvent(this.events[this.events.length - 1]);
    }

    // 2. 淘汰低质量技能
    for (const skill of this.graph.getAllNodes()) {
      if (
        skill.stats.confidence < 0.15 &&
        skill.stats.failCount > skill.stats.successCount * 2 &&
        skill.stats.failCount >= 3
      ) {
        this.retire(skill.id);
      }
    }

    // 3. 重新发现边关系
    this.graph.discoverEdges();

    return this.events.slice(beforeEvents);
  }

  // ── 统计 ──

  getRecentEvents(count = 20): EvolutionEvent[] {
    return this.events.slice(-count);
  }

  clearEvents(): void {
    this.events = [];
  }

  // ── 私有方法 ──

  private recalcConfidence(skill: ExperienceUnit): number {
    const total = skill.stats.successCount + skill.stats.failCount;
    if (total === 0) return 0.5;

    // 遗忘曲线衰减（借鉴 Self-Evolving Agents / Ebbinghaus）
    // 距离上次使用越久，有效成功次数越少
    const daysSinceLastUse = (Date.now() - skill.stats.lastUsed) / 86400000;
    const forgettingFactor = Math.exp(-daysSinceLastUse / 30); // 30 天半衰期

    // 基础成功率（衰减后）
    const effectiveSuccess = skill.stats.successCount * forgettingFactor;
    const effectiveTotal = total * forgettingFactor;

    // 贝叶斯平滑：加权 5 次"中性"试验，避免早期波动太大
    const smoothed = (effectiveSuccess + 2.5) / (effectiveTotal + 5);

    // 最近使用加成（衰减后的额外小激励）
    const recencyBoost = Math.exp(-daysSinceLastUse / 720) * 0.05; // 30 天半衰期

    return Math.min(0.99, Math.max(0.01, smoothed + recencyBoost));
  }

  private mergeInto(keeper: ExperienceUnit, donor: ExperienceUnit): void {
    // 合并统计
    keeper.stats.successCount += donor.stats.successCount;
    keeper.stats.failCount += donor.stats.failCount;
    keeper.stats.confidence = this.recalcConfidence(keeper);
    keeper.stats.extractedFrom.push(...donor.stats.extractedFrom);

    // 合并关键词（去重）
    const allKw = new Set([
      ...keeper.trigger.keywords,
      ...donor.trigger.keywords,
    ]);
    keeper.trigger.keywords = Array.from(allKw).slice(0, 15);

    // 合并正则（去重）
    const allPatterns = new Set([
      ...keeper.trigger.patterns,
      ...donor.trigger.patterns,
    ]);
    keeper.trigger.patterns = Array.from(allPatterns).slice(0, 8);

    // 合并上下文标签
    const allTags = new Set([
      ...keeper.trigger.contextTags,
      ...donor.trigger.contextTags,
    ]);
    keeper.trigger.contextTags = Array.from(allTags);
  }

  private retire(skillId: string): void {
    this.graph.removeNode(skillId);
    this.events.push({
      type: 'retired',
      skillId,
      detail: 'confidence too low, retired from graph',
    });
    this.persistEvent(this.events[this.events.length - 1]);
  }

  private calcOverlap(a: ExperienceUnit, b: ExperienceUnit): number {
    const kwA = new Set(a.trigger.keywords.map(k => k.toLowerCase()));
    const kwB = new Set(b.trigger.keywords.map(k => k.toLowerCase()));
    const intersection = [...kwA].filter(k => kwB.has(k)).length;
    const union = new Set([...kwA, ...kwB]).size;
    if (union === 0) return 0;

    let score = intersection / union;
    if (a.trigger.intent === b.trigger.intent) score += 0.2;
    return Math.min(1, score);
  }

  // ── 持久化 ──

  /** 追加事件到 JSONL 文件 */
  private persistEvent(event: EvolutionEvent): void {
    const record = { ...event, timestamp: event.timestamp ?? Date.now() };
    const line = JSON.stringify(record) + '\n';
    fs.appendFile(this.eventsPath, line, 'utf-8').catch(err => console.warn('[Evolver] 事件持久化失败:', err.message));
  }

  /** 从 JSONL 文件读取事件历史 */
  async getEvents(limit = 100): Promise<EvolutionEvent[]> {
    try {
      const content = await fs.readFile(this.eventsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      const recent = lines.slice(-limit);
      return recent.map(l => {
        try { return JSON.parse(l) as EvolutionEvent; }
        catch { return null; }
      }).filter((e): e is EvolutionEvent => e !== null);
    } catch {
      return this.events.slice(-limit);
    }
  }

  // ── 停滞检测 ──

  /** 检查是否处于停滞状态 */
  isStagnant(): boolean {
    if (!this.stagnation.detected) return false;
    // 检查是否已过暂停期
    if (Date.now() >= this.stagnation.resumeAt) {
      this.stagnation.detected = false;
      return false;
    }
    return true;
  }

  /** 获取停滞状态 */
  getStagnation(): StagnationState {
    return { ...this.stagnation };
  }

  /**
   * 运行停滞检测
   * 规则：最近 20 次事件中淘汰(retired)占比 > 60% → 停滞
   */
  private checkStagnation(): void {
    const recent = this.events.slice(-20);
    if (recent.length < 10) return;

    const retiredCount = recent.filter(e => e.type === 'retired').length;
    const ratio = retiredCount / recent.length;

    if (ratio > 0.6) {
      this.stagnation = {
        detected: true,
        detectedAt: Date.now(),
        resumeAt: Date.now() + 24 * 60 * 60 * 1000, // 暂停 24h
        reason: `最近 ${recent.length} 次事件中淘汰率 ${(ratio * 100).toFixed(0)}%，暂停自动编译 24h`,
      };

      const event: EvolutionEvent = {
        type: 'stagnation_detected',
        skillId: '*',
        detail: this.stagnation.reason,
      };
      this.events.push(event);
      this.persistEvent(event);
    }
  }

  /**
   * 编译前检查（供外部调用）
   * @returns true = 可以编译, false = 被停滞检测阻止
   */
  canCompile(): boolean {
    this.checkStagnation();
    if (this.isStagnant()) {
      const event: EvolutionEvent = {
        type: 'compile_blocked',
        skillId: '*',
        detail: `停滞检测阻止编译: ${this.stagnation.reason}`,
      };
      this.events.push(event);
      this.persistEvent(event);
      return false;
    }
    return true;
  }

  // ── I8: 经验图谱自动进化 ──

  /**
   * 自动进化：拆分高失败率多步经验 + 合并频繁连续使用的经验
   */
  async autoEvolve(): Promise<EvolutionEvent[]> {
    const beforeEvents = this.events.length;
    const allExp = this.graph.getAllNodes();

    // 1. 拆分：高失败率的多步骤经验
    const failing = allExp.filter(e =>
      e.stats.failCount > 3 &&
      e.stats.failCount / (e.stats.successCount + e.stats.failCount) > 0.4 &&
      e.steps.length > 1
    );

    for (const exp of failing) {
      const split = this.splitExperience(exp);
      if (split.length > 1) {
        this.graph.removeNode(exp.id);
        for (const s of split) {
          this.graph.addNode(s);
        }
        const event: EvolutionEvent = {
          type: 'merged',
          skillId: exp.id,
          detail: `拆分高失败率经验 "${exp.trigger.intent}" → ${split.length} 个子经验`,
        };
        this.events.push(event);
        this.persistEvent(event);
      }
    }

    // 2. 合并：频繁连续使用的两个经验
    const pairs = this.findFrequentPairs();
    for (const [a, b] of pairs) {
      const merged = this.mergeExperiences(a, b);
      if (merged) {
        this.graph.addNode(merged);
        const event: EvolutionEvent = {
          type: 'merged',
          skillId: merged.id,
          detail: `合并频繁配对经验 "${a.trigger.intent}" + "${b.trigger.intent}"`,
        };
        this.events.push(event);
        this.persistEvent(event);
      }
    }

    // 3. 重新发现边关系
    this.graph.discoverEdges();

    return this.events.slice(beforeEvents);
  }

  /**
   * 拆分多步经验为单步经验
   */
  private splitExperience(exp: ExperienceUnit): ExperienceUnit[] {
    if (exp.steps.length <= 1) return [exp];

    return exp.steps.map((step, i) => ({
      ...exp,
      id: `${exp.id}_step${i}`,
      trigger: {
        ...exp.trigger,
        keywords: [step.tool, ...exp.trigger.keywords.slice(0, 3)],
      },
      steps: [step],
      replyTemplate: {
        default: `{_step_0}`,
        sharp: `{_step_0}`,
        warm: `{_step_0}`,
        chaotic: `{_step_0}`,
      },
      stats: {
        ...exp.stats,
        successCount: 0,
        failCount: 0,
        confidence: 0.3,
      },
    }));
  }

  /**
   * 查找频繁连续使用的经验对
   */
  private findFrequentPairs(): Array<[ExperienceUnit, ExperienceUnit]> {
    const allExp = this.graph.getAllNodes();
    const pairs: Array<[ExperienceUnit, ExperienceUnit]> = [];

    // 简单策略：找到共享关键词且都高置信度的经验对
    for (let i = 0; i < allExp.length; i++) {
      for (let j = i + 1; j < allExp.length; j++) {
        const a = allExp[i];
        const b = allExp[j];

        // 共享关键词
        const sharedKw = a.trigger.keywords.filter(k =>
          b.trigger.keywords.some(bk => bk.toLowerCase() === k.toLowerCase())
        );

        if (sharedKw.length >= 2 &&
            a.stats.confidence > 0.5 &&
            b.stats.confidence > 0.5 &&
            a.steps.length + b.steps.length <= 6) {
          pairs.push([a, b]);
        }
      }
    }

    return pairs.slice(0, 3); // 每次最多合并 3 对
  }

  /**
   * 合并两个经验为一个
   */
  private mergeExperiences(a: ExperienceUnit, b: ExperienceUnit): ExperienceUnit | null {
    if (a.steps.length + b.steps.length > 6) return null;

    return {
      ...a,
      id: `merged_${a.id}_${b.id}`,
      trigger: {
        intent: `${a.trigger.intent} + ${b.trigger.intent}`,
        keywords: [...new Set([...a.trigger.keywords, ...b.trigger.keywords])].slice(0, 15),
        patterns: [...new Set([...a.trigger.patterns, ...b.trigger.patterns])].slice(0, 8),
        contextTags: [...new Set([...a.trigger.contextTags, ...b.trigger.contextTags])],
      },
      steps: [...a.steps, ...b.steps],
      replyTemplate: a.replyTemplate, // 保留 a 的模板
      stats: {
        successCount: 0,
        failCount: 0,
        confidence: Math.min(a.stats.confidence, b.stats.confidence) * 0.8,
        avgExecutionMs: a.stats.avgExecutionMs + b.stats.avgExecutionMs,
        lastUsed: 0,
        createdAt: Date.now(),
        extractedFrom: [...a.stats.extractedFrom, ...b.stats.extractedFrom],
        evolved: true,
        consolidatedAt: Date.now(),
      },
    };
  }

  // ── P2-2: 假设生成 + 自动测试（借鉴 Self-Optimizing Multi-Agent） ──

  /**
   * 从失败经验中提取模式，生成改进假设
   *
   * 借鉴 Self-Optimizing Multi-Agent 的 5 角色循环：
   * Refinement → Execution → Evaluation → Modification → Documentation
   */
  async hypothesize(): Promise<EvolutionEvent[]> {
    const beforeEvents = this.events.length;
    const allExp = this.graph.getAllNodes();

    // 找到失败率高的经验
    const failing = allExp.filter(e => {
      const total = e.stats.successCount + e.stats.failCount;
      return total >= 3 && e.stats.failCount / total > 0.3;
    });

    for (const exp of failing) {
      // 分析失败模式
      const failEvents = this.events.filter(
        e => e.skillId === exp.id && e.type === 'confidence_down'
      );

      // 提取失败原因
      const errorPatterns = this.extractErrorPatterns(failEvents);

      // 生成改进假设
      const hypotheses = this.generateHypotheses(exp, errorPatterns);

      for (const hypothesis of hypotheses) {
        // 应用假设（修改经验配置）
        const applied = this.applyHypothesis(exp, hypothesis);
        if (applied) {
          const event: EvolutionEvent = {
            type: 'compiled',
            skillId: exp.id,
            detail: `假设测试: ${hypothesis.description} (原置信度=${exp.stats.confidence.toFixed(2)})`,
          };
          this.events.push(event);
          this.persistEvent(event);

          // v3.1: 接入信号汇聚层
          this.onConverge?.({
            eventType: 'hypothesis',
            skillId: exp.id,
            detail: hypothesis.description,
          });
        }
      }
    }

    return this.events.slice(beforeEvents);
  }

  /**
   * 从失败事件中提取错误模式
   */
  private extractErrorPatterns(failEvents: EvolutionEvent[]): string[] {
    const patterns: string[] = [];
    for (const event of failEvents) {
      const detail = event.detail;
      if (detail.includes('timeout')) patterns.push('timeout');
      if (detail.includes('error') || detail.includes('错误')) patterns.push('error');
      if (detail.includes('confidence') && detail.includes('0.')) patterns.push('low_confidence');
      if (detail.includes('sanity_check')) patterns.push('quality_issue');
    }
    return [...new Set(patterns)];
  }

  /**
   * 根据错误模式生成改进假设
   */
  private generateHypotheses(
    exp: ExperienceUnit,
    errorPatterns: string[]
  ): Array<{ type: string; description: string; action: () => void }> {
    const hypotheses: Array<{ type: string; description: string; action: () => void }> = [];

    if (errorPatterns.includes('timeout')) {
      hypotheses.push({
        type: 'reduce_complexity',
        description: '超时 → 减少步骤数或简化触发条件',
        action: () => {
          if (exp.steps.length > 2) {
            exp.steps = exp.steps.slice(0, Math.ceil(exp.steps.length / 2));
          }
        },
      });
    }

    if (errorPatterns.includes('low_confidence')) {
      hypotheses.push({
        type: 'refine_keywords',
        description: '低置信度 → 精简关键词（去除泛化词）',
        action: () => {
          exp.trigger.keywords = exp.trigger.keywords.slice(0, 5);
        },
      });
    }

    if (errorPatterns.includes('quality_issue')) {
      hypotheses.push({
        type: 'add_verification',
        description: '质量问题 → 添加上下文标签以提高匹配精度',
        action: () => {
          if (exp.trigger.contextTags.length < 3) {
            exp.trigger.contextTags.push('verified');
          }
        },
      });
    }

    // 通用假设：失败多但关键词太宽
    if (exp.stats.failCount > 5 && exp.trigger.keywords.length > 10) {
      hypotheses.push({
        type: 'narrow_trigger',
        description: '触发太宽 → 减少关键词数量',
        action: () => {
          exp.trigger.keywords = exp.trigger.keywords.slice(0, 8);
        },
      });
    }

    return hypotheses;
  }

  /**
   * 应用假设到经验（带回滚保护）
   */
  private applyHypothesis(
    exp: ExperienceUnit,
    hypothesis: { type: string; description: string; action: () => void }
  ): boolean {
    try {
      const originalKeywords = [...exp.trigger.keywords];
      const originalSteps = exp.steps.length;
      const originalTags = [...exp.trigger.contextTags];

      hypothesis.action();

      // 验证修改有效
      if (exp.trigger.keywords.length === 0 || exp.steps.length === 0) {
        exp.trigger.keywords = originalKeywords;
        exp.steps = exp.steps.slice(0, originalSteps);
        exp.trigger.contextTags = originalTags;
        return false;
      }

      // 重置统计（新假设需要重新验证）
      exp.stats.successCount = 0;
      exp.stats.failCount = 0;
      exp.stats.confidence = 0.3;

      return true;
    } catch {
      return false;
    }
  }
}
