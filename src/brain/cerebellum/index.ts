/**
 * 小脑：本体感知 + 稳态调节脑
 *
 * MAPE-K + PID 负反馈
 * 实时、低延迟、自主、不需要 LLM
 *
 * 子模块：
 * - BodyStateManager：本体状态管理 + 事件驱动更新 + prompt 注入
 * - HomeostasisRegulator：PID 稳态调节
 * - SensorFusion：感知融合
 * - MotorControl：运动控制
 */

import type {
  BodyState, BodyEvent, HomeostasisAction, TaskSignal, ExecutionPlan,
} from '../types.js';
import { BodyStateManager, type Mood } from './body-state.js';
import { HomeostasisRegulator, type HomeostasisConfig, DEFAULT_HOMEOSTASIS_CONFIG } from './homeostasis.js';
import { SensorFusion, type SensorFusionConfig } from './sensor-fusion.js';
import { MotorControl, type MotorControlConfig, type IdleAction, type ProactiveAction, type ActionParams } from './motor-control.js';
import { RhythmAdaptor, type RhythmConfig, type RhythmAdjustment } from './adaptive/rhythm.js';
import { HabitMemory, type HabitConfig } from './adaptive/habit.js';
import { ErrorTuner, type ErrorTunerConfig } from './adaptive/error-tuner.js';

export interface CerebellumConfig extends HomeostasisConfig {
  sensorFusion?: Partial<SensorFusionConfig>;
  motorControl?: Partial<MotorControlConfig>;
  rhythm?: Partial<RhythmConfig>;
  habits?: Partial<HabitConfig>;
  errorTuner?: Partial<ErrorTunerConfig>;
}

const DEFAULT_CONFIG: CerebellumConfig = {
  ...DEFAULT_HOMEOSTASIS_CONFIG,
};

export class Cerebellum {
  private verbose: boolean;

  /** 本体状态管理 */
  readonly bodyState: BodyStateManager;
  /** 稳态调节器 */
  readonly homeostasis: HomeostasisRegulator;
  /** 感知融合：多源数据 → BodyEvent */
  readonly sensorFusion: SensorFusion;
  /** 运动控制：空闲行为 + 主动行为 */
  readonly motorControl: MotorControl;
  /** 自适应：节律自适配（心跳/梦境/后台频率） */
  readonly rhythm: RhythmAdaptor;
  /** 自适应：肌肉记忆（高频 pattern 缓存） */
  readonly habits: HabitMemory;
  /** 自适应：错误阈值自适应（弱化/强化告警） */
  readonly errorTuner: ErrorTuner;

  constructor(config?: Partial<CerebellumConfig>, verbose = false) {
    this.verbose = verbose;

    // 初始化子模块
    this.bodyState = new BodyStateManager();
    this.homeostasis = new HomeostasisRegulator(config);
    this.sensorFusion = new SensorFusion(config?.sensorFusion, verbose);
    this.motorControl = new MotorControl(config?.motorControl, verbose);

    // 自适应层
    this.rhythm = new RhythmAdaptor(config?.rhythm, verbose);
    this.habits = new HabitMemory(config?.habits, verbose);
    this.errorTuner = new ErrorTuner(config?.errorTuner, verbose);

    // 传感器融合事件 → 自动 regulate
    this.sensorFusion.onFused((event) => {
      this.regulate(event);
    });
  }

  /**
   * MAPE-K 循环：Monitor → Analyze → Plan → Execute
   *
   * 输入 BodyEvent，输出调节动作列表
   * 目标 < 1ms
   */
  regulate(event: BodyEvent): HomeostasisAction[] {
    const t0 = performance.now();

    // Monitor: 更新状态
    this.bodyState.updateFromEvent(event);

    // 自适应：节律采样
    this.rhythm.sampleFromBody(this.bodyState.getState());

    // 自适应：错误事件 → ErrorTuner
    if (event.type === 'tool_result' && !event.data?.success) {
      this.errorTuner.observe(String(event.data?.errorType ?? 'unknown'), 'medium');
    }

    // 同步情绪状态给 MotorControl
    this.motorControl.updateMood(this.bodyState.inferMood());

    // Analyze + Plan + Execute: PID 调节
    const filtered = this.homeostasis.regulate(this.bodyState.getState());

    // 自适应：节律调节（每 10 次 regulate 计算一次）
    const rhythmAdj = this.rhythm.regulate();
    if (rhythmAdj && this.verbose) {
      console.log(`[Cerebellum] 节律调节: heartbeat=${rhythmAdj.heartbeatIntervalMs}ms, dream=${rhythmAdj.dreamDensity.toFixed(2)}`);
    }

    if (this.verbose && filtered.length > 0) {
      console.log(`[Cerebellum] regulate: ${(performance.now() - t0).toFixed(2)}ms, ${filtered.length} 动作`);
    }

    return filtered;
  }

  /** 获取当前本体状态 */
  getBodyState(): BodyState {
    return this.bodyState.getState();
  }

  /** 获取调节历史 */
  getActionHistory(limit = 10) {
    return this.homeostasis.getActionHistory(limit);
  }

  /** 获取情绪 prompt 注入 */
  getPromptInjection(): string {
    return this.bodyState.getPromptInjection();
  }

  /** 获取欲望 prompt 注入 */
  getDesirePrompt(): string | null {
    return this.bodyState.getDesirePrompt();
  }

  /** 推断情绪标签 */
  inferMood(): Mood {
    return this.bodyState.inferMood();
  }

  destroy(): void {
    this.homeostasis.clearHistory();
    this.sensorFusion.destroy();
    this.motorControl.destroy();
  }

  /** 启动自动行为（空闲行为 + 主动行为） */
  startMotor(): void {
    this.motorControl.start();
  }

  /** 停止自动行为 */
  stopMotor(): void {
    this.motorControl.stop();
  }

  /** 注入感知数据（快捷方法） */
  ingestPerception(source: string, content: string, concepts: string[] = [], confidence = 1): void {
    this.sensorFusion.ingest({ source, content, concepts, confidence });
  }

  /** 手动触发空闲行为 */
  triggerIdle(): IdleAction | null {
    return this.motorControl.triggerIdle(this.bodyState.getState());
  }

  /** 手动触发主动行为 */
  triggerProactive(): ProactiveAction | null {
    return this.motorControl.triggerProactive(this.bodyState.getState());
  }

  // ── 兼容旧 EmotionEngine/DesireEngine 接口 ──
  setPersonality(traits: unknown) { this.bodyState.setPersonality(traits); }
  setPersonalityStrength(ps: number) { this.bodyState.setPersonalityStrength(ps); }
  setIntimacy(value: number) { this.bodyState.setIntimacy(value); }
  getMood() { return this.bodyState.inferMood(); }
  getMoodEmoji() { return this.bodyState.getMoodEmoji(); }
  getVector() { return this.bodyState.getEmotion(); }
  getDesireVector() { return this.bodyState.getDesires(); }
  /** 兼容旧 EmotionEngine.getState() 返回格式 */
  getLegacyState() { return this.bodyState.getLegacyState(); }
  /** 获取欲望向量（兼容 DesireEngine.getVector） */
  getDesires() { return this.bodyState.getDesires(); }
  reset() { /* BodyStateManager 无需 reset，Buff 自然过期 */ }

  /** 事件快捷方法（供 agent.ts 直接调用） */
  onUserMessage() { this.bodyState.onUserMessage(); }
  onThinking() { this.bodyState.onThinking(); }
  onResponseComplete() { this.bodyState.onResponseComplete(); }
  onToolSuccess() { this.bodyState.onToolSuccess(); }
  onToolError() { this.bodyState.onToolError(); }
  onLLMError() { this.bodyState.onLLMError(); }
  onTaskComplete() { this.bodyState.onTaskComplete(); }
  onDiscovery() { this.bodyState.onDiscovery(); }
  onLateNight() { this.bodyState.onLateNight(); }
  onMorning() { this.bodyState.onMorning(); }
  onDreamComplete() { this.bodyState.onDreamComplete(); }
  onPet() { this.bodyState.onPet(); }
  onIdle(minutes: number) { this.bodyState.onIdle(minutes); }
  onUserVoice(mood: 'happy' | 'sad' | 'angry' | 'anxious' | 'excited' | 'tired' | 'neutral') { this.bodyState.onUserVoice(mood); }
  /** 情绪 Buff 应用 */
  applyBuff(templateKey: string) { this.bodyState.applyBuff(templateKey); }
  /** 欲望上下文重算 */
  recomputeDesires(ctx: Parameters<typeof this.bodyState.recomputeDesires>[0]) { this.bodyState.recomputeDesires(ctx); }
  /** 表达选择 */
  getExpression() { return this.bodyState.getExpression(); }
  /** 欲望冲动 */
  getDesireImpulses() { return this.bodyState.getDesireImpulses(); }

  // ── 自适应层接口 ──

  /** 查询习惯缓存（高频 pattern 命中时可跳过完整链路） */
  lookupHabit(signal: TaskSignal): ExecutionPlan | null {
    return this.habits.lookup(signal);
  }

  /** 记录决策到习惯缓存 */
  recordHabit(signal: TaskSignal, plan: ExecutionPlan, success: boolean, latencyMs = 0): void {
    this.habits.record(signal, plan, success, latencyMs);
  }

  /** 记录交互（节律感知） */
  recordInteraction(): void {
    this.rhythm.recordInteraction();
  }

  /** 获取节律调整建议 */
  getRhythmAdjustment(): RhythmAdjustment {
    return this.rhythm.regulate();
  }

  /** 获取错误告警权重（< 1 弱化，> 1 强化） */
  getErrorAlertWeight(errorType: string): number {
    return this.errorTuner.getAlertWeight(errorType);
  }

  /** 获取所有错误 profile */
  getErrorProfiles() {
    return this.errorTuner.getAllProfiles();
  }
}
