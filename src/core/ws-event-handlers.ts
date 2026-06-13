/**
 * WS 事件处理器 — 传感器、情绪源、命令、宠物交互等
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 4）
 */

import type { WSEvent } from '../types.js';
import type { EventBus } from '../ws/server.js';
import type { Subsystems } from './subsystems.js';
import type { TextureType, TemperamentType } from '../pet/types.js';
import type { FileChangeEvent } from '../perception/fs-watcher.js';

export interface WSEventHandlerDeps {
  sys: Subsystems;
  eventBus: EventBus | null;
  verbose: boolean;
  broadcastEmotion: () => void;
  broadcastStatus: () => void;
  checkAndEmitEvolution: (result: { evolved?: boolean; previousStage?: string; newStage?: string }) => void;
  emitGuidanceIfAny: () => void;
  handleOrchestrate: (content: string) => Promise<void>;
  syncPersonalityToEmotion: () => void;
  recordUserCorrection: () => void;
}

export class WSEventHandlers {
  constructor(private deps: WSEventHandlerDeps) {}

  /** 处理视觉种子 */
  handleVisualSeed(msg: Record<string, unknown>): void {
    try {
      const seed = {
        primaryColor: String(msg.primaryColor ?? '#58a6ff'),
        secondaryColor: msg.secondaryColor ? String(msg.secondaryColor) : undefined,
        texture: String(msg.texture ?? 'soft') as TextureType,
        temperament: String(msg.temperament ?? 'warm') as TemperamentType,
        seed: Number(msg.seed ?? Date.now()),
      };
      this.deps.sys.pet.registerVisualSeed(seed);
      if (this.deps.verbose) console.log(`  [Visual] 视觉种子已注册: ${seed.primaryColor} / ${seed.texture} / ${seed.temperament}`);
      this.deps.broadcastStatus();
    } catch (err) {
      if (this.deps.verbose) console.warn('[Visual] 注册视觉种子失败:', (err as Error).message);
    }
  }

  /** 处理前端命令 */
  async handleCommand(command: string, args?: string): Promise<void> {
    switch (command) {
      case 'status':
        this.deps.broadcastStatus();
        break;
      case 'emotion_reset':
        this.deps.sys.cerebellum?.reset();
        this.deps.broadcastEmotion();
        break;
      case 'model':
        this.handleModelCommand(args);
        break;
      case 'orch':
        if (args) {
          await this.deps.handleOrchestrate(args);
        } else {
          this.deps.eventBus?.emit({ type: 'bubble', text: '用法: /orch <多步骤任务描述>' });
        }
        break;
      case 'evolution_log':
        await this.handleEvolutionLog({});
        break;
      default:
        this.deps.eventBus?.emit({ type: 'error', message: `未知命令: ${command}` });
    }
  }

  /** 处理 /model 命令 — 查看/切换模型 */
  private handleModelCommand(args?: string): void {
    const router = this.deps.sys.llm.getRouter();
    const arg = args?.trim();

    if (!arg || arg === 'status') {
      const summary = router.getSummary();
      const lines = [
        `🧠 模型路由状态:`,
        `  统一池: ${summary.hasUnifiedPool ? '✅ 已初始化' : '❌ 未初始化'}`,
        `  Pool调度器: ${summary.hasPoolScheduler ? '✅' : '❌'}`,
      ];
      if (summary.localExperts.length > 0) lines.push(`  本地专家: ${summary.localExperts.join(', ')}`);
      if (summary.userOverride) lines.push(`  ⚡ 用户覆盖: ${summary.userOverride}`);
      if (Object.keys(summary.learnedPrefs).length > 0) lines.push(`  📚 已学习: ${JSON.stringify(summary.learnedPrefs)}`);
      this.deps.eventBus?.emit({ type: 'bubble', text: lines.join('\n') });
      return;
    }

    if (arg === 'auto') {
      router.clearUserOverride();
      this.deps.eventBus?.emit({ type: 'bubble', text: '🔄 已恢复自动路由' });
      return;
    }

    if (arg.startsWith('local/')) {
      router.setUserOverride(arg);
      this.deps.eventBus?.emit({ type: 'bubble', text: `⚡ 模型已切换到: ${arg}（本次会话有效）` });
      return;
    }

    this.deps.eventBus?.emit({ type: 'bubble', text: `用法: /model [local/<domain>|auto|status]` });
  }

  /** 处理摸头事件 */
  handlePet(): void {
    this.deps.sys.cerebellum?.onPet();
    this.deps.sys.memory.incrementInteraction();

    const result = this.deps.sys.pet.trackFeature('pet_headpat');
    this.deps.checkAndEmitEvolution(result);
    this.deps.sys.pet.addIntimacy(1);
    this.deps.sys.pet.trackSpecialTimeFeature();

    this.deps.broadcastEmotion();
    this.deps.broadcastStatus();

    const moodEmoji = this.deps.sys.cerebellum?.getMoodEmoji();
    let bubble = `${moodEmoji} 嗯～`;
    if (result.isNewDiscovery) bubble = `${moodEmoji} 哦？你发现了一个秘密！🤗`;

    this.deps.eventBus?.emit({ type: 'bubble', text: bubble });
    this.deps.emitGuidanceIfAny();
  }

  /** 查询进化事件日志 */
  async handleEvolutionLog(msg: Record<string, unknown>): Promise<void> {
    try {
      const limit = Number(msg.limit) || 50;
      const events = await this.deps.sys.intelligence.evolver.getEvents(limit);
      const stagnation = this.deps.sys.intelligence.evolver.getStagnation();
      this.deps.eventBus?.emit({ type: 'evolution_log', events, stagnation, count: events.length });
      if (this.deps.verbose) console.log(`  [Evolver] 发送 ${events.length} 条进化事件`);
    } catch (err) {
      this.deps.eventBus?.emit({ type: 'error', message: `获取进化日志失败: ${(err as Error).message}` });
    }
  }

  /** 处理传感器数据回传 */
  handleSensorUpdate(msg: Record<string, unknown>): void {
    try {
      const data = msg.data as Record<string, unknown> | undefined;
      if (!data) return;

      const sensorData = data as {
        location?: { lat: number; lng: number; accuracy: number } | null;
        motion?: { x: number; y: number; z: number; state: string } | null;
        environment?: { light: number; battery: number; online: boolean } | null;
      };

      const concepts: string[] = ['sensor'];
      let content = '传感器数据更新';

      if (sensorData.location) {
        concepts.push('location');
        content += ` 位置:(${sensorData.location.lat.toFixed(4)}, ${sensorData.location.lng.toFixed(4)})`;
      }
      if (sensorData.motion) {
        concepts.push('motion', sensorData.motion.state);
        content += ` 运动:${sensorData.motion.state}`;
      }
      if (sensorData.environment) {
        concepts.push('environment');
        content += ` 网络:${sensorData.environment.online ? '在线' : '离线'}`;
        if (sensorData.environment.battery >= 0) content += ` 电量:${sensorData.environment.battery}%`;
        if (sensorData.environment.light >= 0) content += ` 光照:${sensorData.environment.light}lux`;
      }

      this.deps.sys.stmp.insertNode({
        id: `sensor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content, room: 'perception', timestamp: Date.now(),
        temporalContext: { before: [], after: [] }, concepts, relations: [],
        emotional: { valence: 0, importance: 1 },
        lifecycle: { createdAt: Date.now(), lastAccessed: Date.now(), accessCount: 1, decay: 1.0, compressed: false, hibernated: false },
        source: 'observed',
      });

      if (this.deps.verbose) console.log(`  [Sensor] 数据已记录: ${content}`);
    } catch (err) {
      if (this.deps.verbose) console.warn('[Sensor] 数据处理失败:', (err as Error).message);
    }
  }

  /** 处理前端语音情绪检测结果 → 注入 EmotionEngine */
  handleEmotionSource(msg: Record<string, unknown>): void {
    try {
      const mood = msg.mood as string | undefined;
      const confidence = msg.confidence as number | undefined;
      if (!mood || (confidence ?? 0) < 0.3) return;

      const buffMap: Record<string, string> = {
        happy: 'user_voice_happy', excited: 'user_voice_excited', sad: 'user_voice_sad',
        angry: 'user_voice_angry', anxious: 'user_voice_anxious', tired: 'user_voice_tired',
        calm: 'user_voice_neutral', neutral: 'user_voice_neutral',
      };

      const buffKey = buffMap[mood] ?? 'user_voice_neutral';
      this.deps.sys.cerebellum?.applyBuff(buffKey);
      if (this.deps.verbose) console.log(`  [Emotion] 语音情绪注入: ${mood} (${((confidence ?? 0) * 100).toFixed(0)}%) → ${buffKey}`);
    } catch (err) {
      if (this.deps.verbose) console.warn('[Emotion] 语音情绪处理失败:', (err as Error).message);
    }
  }

  /** 处理文件变更事件 */
  handleFileChange(event: FileChangeEvent): void {
    const typeEmoji: Record<string, string> = { add: '📄', change: '✏️', unlink: '🗑️' };
    const emoji = typeEmoji[event.type] ?? '📝';

    this.deps.sys.perceptionBus.publish('environment', 'fs', {
      subtype: 'file_change', type: event.type, path: event.relativePath, extension: event.extension,
    });

    this.deps.eventBus?.emit({
      type: 'bubble',
      text: `${emoji} ${event.relativePath} ${event.type === 'add' ? '新增' : event.type === 'change' ? '变更' : '删除'}`,
    });

    try {
      this.deps.sys.stmp.insertNode({
        id: `fs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: `文件${event.type === 'add' ? '新增' : event.type === 'change' ? '变更' : '删除'}: ${event.relativePath}`,
        room: 'perception', timestamp: event.timestamp,
        temporalContext: { before: [], after: [] },
        concepts: [event.relativePath, event.extension, 'file_change'], relations: [],
        emotional: { valence: 0, importance: 2 },
        lifecycle: { createdAt: event.timestamp, lastAccessed: event.timestamp, accessCount: 1, decay: 1.0, compressed: false, hibernated: false },
        source: 'observed',
      });
    } catch (err) {
      if (this.deps.verbose) console.warn('[STMP] 文件变更写入失败:', (err as Error).message);
    }

    if (this.deps.verbose) console.log(`  [FS] ${emoji} ${event.type}: ${event.relativePath}`);
  }
}
