/**
 * ConversationStateMachine — 对话状态机
 *
 * 管理从讨论到执行的对话生命周期：
 * idle → discussing → confirming → executing → done
 *
 * 核心原则：对话是一个过程，不是一个点。
 * 用户说"我想做一款游戏"不是闲聊，是执行意图的起点。
 */

// ==================== 类型定义 ====================

export type ConversationPhase = 'idle' | 'discussing' | 'confirming' | 'executing' | 'done';

export interface ConversationState {
  phase: ConversationPhase;
  /** 用户的原始意图 */
  intent: string;
  /** 收集到的需求 */
  requirements: Record<string, string>;
  /** 确认的方案摘要 */
  confirmedPlan: string | null;
  /** 本轮提问次数 */
  questionsAsked: number;
  /** 最大提问次数（默认 2） */
  maxQuestions: number;
  /** 状态开始时间 */
  phaseStartedAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
}

export interface PhaseTransition {
  from: ConversationPhase;
  to: ConversationPhase;
  reason: string;
  timestamp: number;
}

// ==================== 状态机 ====================

export class ConversationStateMachine {
  private state: ConversationState;
  private transitions: PhaseTransition[] = [];
  private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无活动回到 idle

  constructor() {
    this.state = this.createInitialState();
  }

  /**
   * 处理用户消息，返回当前状态和应该注入的 Prompt
   */
  processMessage(userMessage: string): {
    state: ConversationState;
    phasePrompt: string;
    transition: PhaseTransition | null;
  } {
    const now = Date.now();

    // 超时回到 idle
    if (now - this.state.lastActiveAt > this.IDLE_TIMEOUT_MS && this.state.phase !== 'idle') {
      this.transitionTo('idle', '超时回到空闲');
    }

    this.state.lastActiveAt = now;

    const previousPhase = this.state.phase;
    const newPhase = this.computeNextPhase(userMessage);
    let transition: PhaseTransition | null = null;

    if (newPhase !== previousPhase) {
      transition = this.transitionTo(newPhase, this.getTransitionReason(previousPhase, newPhase, userMessage));
    }

    // 更新状态
    this.updateState(userMessage, newPhase);

    // 生成阶段 Prompt
    const phasePrompt = this.buildPhasePrompt();

    return { state: { ...this.state }, phasePrompt, transition };
  }

  /**
   * 获取当前状态（只读）
   */
  getState(): Readonly<ConversationState> {
    return { ...this.state };
  }

  /**
   * 获取当前阶段
   */
  getPhase(): ConversationPhase {
    return this.state.phase;
  }

  /**
   * 强制设置阶段（用于外部干预）
   */
  setPhase(phase: ConversationPhase, reason: string): void {
    this.transitionTo(phase, reason);
  }

  /**
   * 重置状态机
   */
  reset(): void {
    this.state = this.createInitialState();
    this.transitions = [];
  }

  /**
   * 获取转换历史（调试用）
   */
  getTransitions(): PhaseTransition[] {
    return [...this.transitions];
  }

  // ==================== 核心逻辑 ====================

  private computeNextPhase(userMessage: string): ConversationPhase {
    const current = this.state.phase;
    const trimmed = userMessage.trim();

    switch (current) {
      case 'idle':
        // 用户提出执行意图 → 进入讨论
        if (this.hasExecutionIntent(trimmed)) return 'discussing';
        return 'idle';

      case 'discussing': {
        // 用户说"直接做" → 跳过确认，直接执行
        if (this.isDirectExecution(trimmed)) return 'executing';

        // 用户提供了具体细节 → 进入确认
        if (this.hasSpecificDetails(trimmed)) return 'confirming';

        // 已经问了足够多的问题 → 进入确认
        if (this.state.questionsAsked >= this.state.maxQuestions) return 'confirming';

        return 'discussing';
      }

      case 'confirming': {
        // 用户确认 → 进入执行
        if (this.isConfirmation(trimmed)) return 'executing';

        // 用户提出修改 → 回到讨论
        if (this.hasModification(trimmed)) return 'discussing';

        // 用户提供了更多细节 → 仍在确认
        return 'confirming';
      }

      case 'executing':
        // 执行中 → 保持（等待工具执行完成）
        return 'executing';

      case 'done':
        // 新意图 → 回到 idle
        if (this.hasExecutionIntent(trimmed)) return 'discussing';
        return 'idle';

      default:
        return current;
    }
  }

  private updateState(message: string, newPhase: ConversationPhase): void {
    // 记录意图
    if (newPhase === 'discussing' && !this.state.intent) {
      this.state.intent = message;
    }

    // 提取需求信息
    if (newPhase === 'discussing' || newPhase === 'confirming') {
      this.extractRequirements(message);
    }

    // 记录提问次数（助手提问后）
    if (newPhase === 'discussing') {
      this.state.questionsAsked++;
    }
  }

  /**
   * 从用户消息中提取需求信息
   */
  private extractRequirements(message: string): void {
    const lower = message.toLowerCase();

    // 游戏类型
    const gameTypes = ['roguelike', 'rpg', 'fps', 'moba', '卡牌', '策略', '动作', '冒险', '解谜', '平台跳跃'];
    for (const t of gameTypes) {
      if (lower.includes(t)) {
        this.state.requirements.gameType = t;
        break;
      }
    }

    // 技术栈
    const techStacks = ['typescript', 'javascript', 'python', 'unity', 'unreal', 'godot', 'phaser', 'react', 'vue'];
    for (const t of techStacks) {
      if (lower.includes(t)) {
        this.state.requirements.techStack = t;
        break;
      }
    }

    // 平台
    const platforms = ['pc', 'mobile', 'web', '网页', '手机', '主机', '桌面'];
    for (const p of platforms) {
      if (lower.includes(p)) {
        this.state.requirements.platform = p;
        break;
      }
    }

    // 参考游戏
    const refs = ['杀戮尖塔', '哈迪斯', '以撒的结合', '空洞骑士', '蔚蓝', '死亡细胞'];
    for (const r of refs) {
      if (lower.includes(r)) {
        this.state.requirements.reference = r;
        break;
      }
    }
  }

  // ==================== 意图识别 ====================

  private hasExecutionIntent(content: string): boolean {
    const patterns = [
      /做.*游戏/,
      /开发.*应用/,
      /创建.*项目/,
      /写.*程序/,
      /帮我.*做/,
      /帮我.*写/,
      /帮我.*创建/,
      /帮我.*开发/,
      /我想.*做/,
      /我想.*开发/,
      /我想.*创建/,
      /build|create|develop|make|implement/i,
      /做一个/,
      /写一个/,
      /搞一个/,
    ];
    return patterns.some(p => p.test(content));
  }

  private isDirectExecution(content: string): boolean {
    const patterns = [
      /直接做/,
      /直接开始/,
      /别问了/,
      /不用问/,
      /现在就做/,
      /开始做/,
      /赶紧做/,
      /快做/,
      /just do it/i,
      /start now/i,
      /go ahead/i,
      /begin/i,
      /直接执行/,
      /不要问/,
      /别废话/,
    ];
    return patterns.some(p => p.test(content));
  }

  private isConfirmation(content: string): boolean {
    const trimmed = content.trim();
    const patterns = [
      /^好$/,
      /^可以$/,
      /^行$/,
      /^好的$/,
      /^可以的$/,
      /^没问题$/,
      /^确认$/,
      /^就这样$/,
      /^开始$/,
      /^开始吧$/,
      /^做吧$/,
      /^开搞$/,
      /^ok$/i,
      /^yes$/i,
      /^go$/i,
      /^start$/i,
      /^sure$/i,
      /^yep$/i,
      /^yeah$/i,
      /^好的开始$/,
      /^确认开始$/,
    ];
    return patterns.some(p => p.test(trimmed));
  }

  private hasSpecificDetails(content: string): boolean {
    // 包含技术栈、游戏类型、参考游戏等具体信息
    const detailPatterns = [
      /roguelike/i,
      /rpg/i,
      /fps/i,
      /卡牌/,
      /策略/,
      /typescript/i,
      /javascript/i,
      /python/i,
      /unity/i,
      /unreal/i,
      /godot/i,
      /phaser/i,
      /类似.*杀戮尖塔/,
      /类似.*哈迪斯/,
      /pc|手机|web|网页/i,
    ];
    const matchCount = detailPatterns.filter(p => p.test(content)).length;
    return matchCount >= 2; // 至少匹配 2 个细节
  }

  private hasModification(content: string): boolean {
    const patterns = [
      /改.*用/,
      /换成/,
      /不要/,
      /换一个/,
      /改一下/,
      /修改/,
      /调整/,
    ];
    return patterns.some(p => p.test(content));
  }

  // ==================== Prompt 生成 ====================

  private buildPhasePrompt(): string {
    const { phase, intent, requirements, questionsAsked, maxQuestions } = this.state;

    switch (phase) {
      case 'discussing': {
        const remaining = maxQuestions - questionsAsked;
        const reqStr = Object.entries(requirements)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return [
          '',
          '## 当前阶段: 需求讨论',
          `- 用户意图: ${intent}`,
          reqStr ? `- 已收集需求: ${reqStr}` : '- 尚未收集到具体需求',
          `- 还可以问 ${remaining} 个关键问题`,
          '- 只问最关键的问题，不要问太多',
          '- 如果用户说\"直接做\"或\"别问了\"，立即进入执行',
        ].join('\n');
      }

      case 'confirming': {
        const reqStr = Object.entries(requirements)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return [
          '',
          '## 当前阶段: 方案确认',
          `- 用户意图: ${intent}`,
          reqStr ? `- 需求: ${reqStr}` : '',
          '- 输出方案摘要（技术栈、模块划分、开发计划）',
          '- 等用户确认后开始执行',
          '- 不要再问问题',
          '- 回复结尾加上: \"确认后我开始执行\" 或类似提示',
        ].filter(Boolean).join('\n');
      }

      case 'executing':
        return [
          '',
          '## 当前阶段: 执行',
          `- 用户意图: ${intent}`,
          '- 直接调用工具（write_file/exec）创建项目文件',
          '- 不要再问问题',
          '- 不要只给方案，要实际执行工具调用',
          '- 先创建项目结构，再创建核心文件',
        ].join('\n');

      case 'done':
        return '';

      case 'idle':
      default:
        return '';
    }
  }

  // ==================== 工具方法 ====================

  private transitionTo(phase: ConversationPhase, reason: string): PhaseTransition {
    const transition: PhaseTransition = {
      from: this.state.phase,
      to: phase,
      reason,
      timestamp: Date.now(),
    };
    this.transitions.push(transition);
    this.state.phase = phase;
    this.state.phaseStartedAt = Date.now();

    // 进入新阶段时重置计数器
    if (phase === 'discussing') {
      this.state.questionsAsked = 0;
    }
    if (phase === 'idle') {
      this.state = this.createInitialState();
    }

    return transition;
  }

  private getTransitionReason(from: ConversationPhase, to: ConversationPhase, message: string): string {
    if (from === 'idle' && to === 'discussing') return `用户提出执行意图: ${message.slice(0, 50)}`;
    if (from === 'discussing' && to === 'confirming') return '需求已收集足够，进入确认';
    if (from === 'discussing' && to === 'executing') return '用户要求直接执行';
    if (from === 'confirming' && to === 'executing') return '用户确认方案';
    if (from === 'confirming' && to === 'discussing') return '用户提出修改';
    if (to === 'idle') return '回到空闲';
    return `${from} → ${to}`;
  }

  private createInitialState(): ConversationState {
    return {
      phase: 'idle',
      intent: '',
      requirements: {},
      confirmedPlan: null,
      questionsAsked: 0,
      maxQuestions: 2, // 最多问 2 个问题
      phaseStartedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
  }
}
