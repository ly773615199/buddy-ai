/**
 * HumanoidSkeleton — 完整人形骨架
 *
 * v4.0 §6.4 定义：
 * - 脊柱 (root → spine → chest → neck → head)
 * - 面部 (jaw, brow, eyelid, lip, ear)
 * - 上肢 (shoulder → elbow → hand)
 * - 下肢 (hip → knee → foot)
 * - 附属物 (tail, wing_l, wing_r)
 *
 * 骨骼位置由基因参数决定。
 */

import * as THREE from 'three';
import type { BuddyGenome } from '../../pet/genome';
import { SpringValue, SpringVec3, SPRING_PRESETS } from '../physics/spring-physics';

export interface BoneDefinition {
  name: string;
  position: [number, number, number];
  parent: string | null;
  /** 是否受基因参数影响 */
  geneDriven?: boolean;
}

/** 标准人形骨架定义 */
const SKELETON_DEF: BoneDefinition[] = [
  // 脊柱链
  { name: 'root',   position: [0, 0, 0],       parent: null },
  { name: 'spine',  position: [0, 0, 0],       parent: 'root' },
  { name: 'chest',  position: [0, 0.3, 0],     parent: 'spine',  geneDriven: true },
  { name: 'neck',   position: [0, 0.25, 0],    parent: 'chest' },
  { name: 'head',   position: [0, 0.2, 0],     parent: 'neck',   geneDriven: true },

  // 面部
  { name: 'jaw',      position: [0, -0.08, 0.05],   parent: 'head' },
  { name: 'brow_l',   position: [-0.04, 0.06, 0.08], parent: 'head', geneDriven: true },
  { name: 'brow_r',   position: [0.04, 0.06, 0.08],  parent: 'head', geneDriven: true },
  { name: 'eyelid_l', position: [-0.04, 0.02, 0.08], parent: 'head' },
  { name: 'eyelid_r', position: [0.04, 0.02, 0.08],  parent: 'head' },
  { name: 'lip_l',    position: [-0.02, -0.04, 0.08], parent: 'head' },
  { name: 'lip_r',    position: [0.02, -0.04, 0.08],  parent: 'head' },
  { name: 'ear_l',    position: [-0.08, 0.05, 0],     parent: 'head', geneDriven: true },
  { name: 'ear_r',    position: [0.08, 0.05, 0],      parent: 'head', geneDriven: true },

  // 上肢
  { name: 'shoulder_l', position: [-0.15, 0.2, 0],  parent: 'chest', geneDriven: true },
  { name: 'elbow_l',    position: [-0.12, -0.12, 0], parent: 'shoulder_l' },
  { name: 'hand_l',     position: [0, -0.12, 0],     parent: 'elbow_l' },
  { name: 'shoulder_r', position: [0.15, 0.2, 0],    parent: 'chest', geneDriven: true },
  { name: 'elbow_r',    position: [0.12, -0.12, 0],  parent: 'shoulder_r' },
  { name: 'hand_r',     position: [0, -0.12, 0],     parent: 'elbow_r' },

  // 下肢
  { name: 'hip_l',   position: [-0.06, -0.15, 0], parent: 'spine', geneDriven: true },
  { name: 'knee_l',  position: [0, -0.15, 0],     parent: 'hip_l' },
  { name: 'foot_l',  position: [0, -0.15, 0.03],  parent: 'knee_l' },
  { name: 'hip_r',   position: [0.06, -0.15, 0],  parent: 'spine', geneDriven: true },
  { name: 'knee_r',  position: [0, -0.15, 0],     parent: 'hip_r' },
  { name: 'foot_r',  position: [0, -0.15, 0.03],  parent: 'hip_r' },

  // 附属物
  { name: 'tail',   position: [0, -0.05, -0.15], parent: 'spine', geneDriven: true },
  { name: 'wing_l', position: [-0.12, 0.15, -0.05], parent: 'chest', geneDriven: true },
  { name: 'wing_r', position: [0.12, 0.15, -0.05],  parent: 'chest', geneDriven: true },
];

export class HumanoidSkeleton {
  bones: Map<string, THREE.Bone> = new Map();
  skeleton: THREE.Skeleton | null = null;

  // ── 注意力跟随状态（眼球→头→肩，延迟跟随） ──
  private attentionTarget = { x: 0, y: 0 };     // 目标位置（归一化 -1~1）
  private headAttention = { x: 0, y: 0 };        // 头部当前跟随位置
  private shoulderAttention = { x: 0, y: 0 };    // 肩膀当前跟随位置
  private lastUpdateTime = 0;                     // 上次 update 时间戳（用于计算 delta）

  // ── 弹簧驱动的次级运动 ──
  private earSpringL = new SpringVec3([0, 0, 0], SPRING_PRESETS.ear);
  private earSpringR = new SpringVec3([0, 0, 0], SPRING_PRESETS.ear);
  private tailSpring  = new SpringVec3([0, 0, 0], SPRING_PRESETS.tail);
  private wingSpringL = new SpringVec3([0, 0, 0], SPRING_PRESETS.wing);
  private wingSpringR = new SpringVec3([0, 0, 0], SPRING_PRESETS.wing);

  // ── 自然眨眼状态 ──
  private blinkTimer = 0;
  private nextBlinkAt = 2 + Math.random() * 4;  // 2-6秒眨一次
  private isBlinking = false;
  private blinkPhase = 0;  // 0=闭眼中, 1=睁眼中
  /** 正在眨眼时为 true，通知 FacialExpressionSystem 暂停覆盖眼皮 */
  isBlinkActive = false;

  constructor(genome: BuddyGenome) {
    this.buildSkeleton(genome);
  }

  /**
   * 设置注意力目标（来自鼠标/眼球追踪，归一化坐标 -1~1）
   */
  setAttentionTarget(x: number, y: number): void {
    this.attentionTarget.x = Math.max(-1, Math.min(1, x));
    this.attentionTarget.y = Math.max(-1, Math.min(1, y));
  }

  private buildSkeleton(genome: BuddyGenome): void {
    // 创建所有骨骼
    for (const def of SKELETON_DEF) {
      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.position.set(...def.position);
      this.bones.set(def.name, bone);
    }

    // 建立层级关系
    for (const def of SKELETON_DEF) {
      if (def.parent) {
        const parent = this.bones.get(def.parent);
        const child = this.bones.get(def.name);
        if (parent && child) {
          parent.add(child);
        }
      }
    }

    // 应用基因参数调整骨骼位置
    this.applyGenome(genome);

    // 创建 Skeleton
    const boneArray = Array.from(this.bones.values());
    this.skeleton = new THREE.Skeleton(boneArray);
  }

  /**
   * 应用基因参数调整骨骼位置
   */
  applyGenome(genome: BuddyGenome): void {
    const h = genome.bodyHeight;
    const w = genome.bodyWidth;

    // 躯干
    const chest = this.bones.get('chest');
    if (chest) chest.position.set(0, 0.3 * h, 0);

    const neck = this.bones.get('neck');
    if (neck) neck.position.set(0, 0.25 * h, 0);

    const head = this.bones.get('head');
    if (head) head.position.set(0, 0.2 * h, 0);

    // 面部
    const browL = this.bones.get('brow_l');
    if (browL) browL.position.set(-0.04 * genome.eyeSpacing, 0.06, 0.08);

    const browR = this.bones.get('brow_r');
    if (browR) browR.position.set(0.04 * genome.eyeSpacing, 0.06, 0.08);

    const earL = this.bones.get('ear_l');
    if (earL) {
      earL.position.set(-0.08 * genome.earSize, 0.05, 0);
      earL.rotation.z = -genome.earAngle * Math.PI / 180;
    }

    const earR = this.bones.get('ear_r');
    if (earR) {
      earR.position.set(0.08 * genome.earSize, 0.05, 0);
      earR.rotation.z = genome.earAngle * Math.PI / 180;
    }

    // 上肢
    const shoulderL = this.bones.get('shoulder_l');
    if (shoulderL) shoulderL.position.set(-0.15 * w, 0.2 * h, 0);

    const elbowL = this.bones.get('elbow_l');
    if (elbowL) elbowL.position.set(-0.12 * w, -0.12 * h, 0);

    const shoulderR = this.bones.get('shoulder_r');
    if (shoulderR) shoulderR.position.set(0.15 * w, 0.2 * h, 0);

    const elbowR = this.bones.get('elbow_r');
    if (elbowR) elbowR.position.set(0.12 * w, -0.12 * h, 0);

    // 下肢
    const hipL = this.bones.get('hip_l');
    if (hipL) hipL.position.set(-0.06 * w, -0.15 * h, 0);

    const hipR = this.bones.get('hip_r');
    if (hipR) hipR.position.set(0.06 * w, -0.15 * h, 0);

    // 附属物
    const tail = this.bones.get('tail');
    if (tail) tail.position.set(0, -0.05 * h, -0.15 * genome.bodyDepth);

    const wingL = this.bones.get('wing_l');
    if (wingL) wingL.position.set(-0.12 * w, 0.15 * h, -0.05);

    const wingR = this.bones.get('wing_r');
    if (wingR) wingR.position.set(0.12 * w, 0.15 * h, -0.05);

    // 不存在的附属物隐藏
    if (genome.tailLength <= 0) {
      const t = this.bones.get('tail');
      if (t) t.scale.setScalar(0);
    }
    if (genome.wingSize <= 0) {
      const wl = this.bones.get('wing_l');
      const wr = this.bones.get('wing_r');
      if (wl) wl.scale.setScalar(0);
      if (wr) wr.scale.setScalar(0);
    }
  }

  /**
   * 按名字获取骨骼
   */
  getBone(name: string): THREE.Bone | undefined {
    return this.bones.get(name);
  }

  /**
   * 获取根骨骼
   */
  getRoot(): THREE.Bone | undefined {
    return this.bones.get('root');
  }

  /**
   * 持续动画更新（每帧调用）
   */
  update(time: number, genome: BuddyGenome, mood: string): void {
    // 计算帧间隔（用于 lerp 跟随）
    const delta = this.lastUpdateTime > 0 ? Math.min(time - this.lastUpdateTime, 0.1) : 0.016;
    this.lastUpdateTime = time;

    // ── 呼吸参数 ──
    const breathCycle = Math.sin(time * genome.breatheSpeed);
    const breathCycleSlow = Math.sin(time * genome.breatheSpeed * 0.5);

    // ── 尾巴摇摆（弹簧驱动，sin 作为目标 + 情绪调制） ──
    const tail = this.bones.get('tail');
    if (tail && genome.tailLength > 0) {
      const tailSpeed = mood === 'excited' ? 0.15 : mood === 'sleeping' ? 0.02 : 0.06;
      // 弹簧目标：基础摆动 + 情绪加成
      const targetY = Math.sin(time * tailSpeed) * (0.08 + genome.tailLength * 0.04);
      const targetX = Math.sin(time * tailSpeed * 0.7) * 0.02;
      // 情绪脉冲：开心时给尾巴一个额外的摇摆力
      if (mood === 'happy' || mood === 'excited') {
        this.tailSpring.y.impulse(Math.sin(time * 0.3) * 0.001);
      }
      const tailRot = this.tailSpring.update([targetX, targetY, 0], delta);
      tail.rotation.x = tailRot[0];
      tail.rotation.y = tailRot[1];
    }

    // ── 翅膀扇动（弹簧驱动） ──
    const wingL = this.bones.get('wing_l');
    const wingR = this.bones.get('wing_r');
    if (wingL && wingR && genome.wingSize > 0) {
      const flapTarget = Math.sin(time * 0.04) * 0.05 * genome.wingSize;
      const wingRotL = this.wingSpringL.update([0, 0, -flapTarget], delta);
      const wingRotR = this.wingSpringR.update([0, 0, flapTarget], delta);
      wingL.rotation.z = wingRotL[2];
      wingR.rotation.z = wingRotR[2];
      // 翅膀微前后摆动
      wingL.rotation.x = wingRotL[0];
      wingR.rotation.x = wingRotR[0];
    }

    // ── 耳朵（弹簧驱动：情绪目标 + 跟随头部微动） ──
    const earL = this.bones.get('ear_l');
    const earR = this.bones.get('ear_r');
    if (earL && earR) {
      const earMoodX = mood === 'excited' ? 0.06 : mood === 'sleeping' ? -0.04 : 0;
      const earMoodZ = mood === 'happy' ? 0.03 : mood === 'confused' ? -0.02 : 0;
      // 跟随头部转动产生微偏移
      const headInfluence = this.headAttention.x * 0.02;
      const earTargetL: [number, number, number] = [earMoodX, 0, earMoodZ - headInfluence];
      const earTargetR: [number, number, number] = [earMoodX, 0, -earMoodZ - headInfluence];
      // 开心时耳朵给一个弹跳力
      if (mood === 'happy') {
        this.earSpringL.impulse([0.01, 0, 0]);
        this.earSpringR.impulse([0.01, 0, 0]);
      }
      const earRotL = this.earSpringL.update(earTargetL, delta);
      const earRotR = this.earSpringR.update(earTargetR, delta);
      earL.rotation.x = earRotL[0];
      earL.rotation.z = earRotL[2];
      earR.rotation.x = earRotR[0];
      earR.rotation.z = earRotR[2];
    }

    // ── 根骨骼：呼吸 + 摇摆 ──
    const root = this.bones.get('root');
    if (root) {
      root.scale.y = 1 + breathCycle * 0.02;
      root.rotation.z = Math.sin(time * 0.5) * genome.swayAmount * 0.05;
    }

    // ══════════════════════════════════════════
    // Phase 3: 微动作 — 所有骨骼呼吸联动
    // ══════════════════════════════════════════

    // ── 脊柱：呼吸前后倾 ──
    const spine = this.bones.get('spine');
    if (spine) {
      spine.rotation.x = breathCycle * 0.008;
    }

    // ── 胸腔：呼吸扩张感 ──
    const chest = this.bones.get('chest');
    if (chest) {
      const chestBreath = Math.sin(time * genome.breatheSpeed + 0.2);
      chest.scale.x = 1 + chestBreath * 0.008;
      chest.scale.z = 1 + chestBreath * 0.006;
    }

    // ── 头部：呼吸微动 + 注意力方向 ──
    const head = this.bones.get('head');
    if (head) {
      const headBreath = Math.sin(time * genome.breatheSpeed + 0.5);
      head.position.y = head.position.y + headBreath * 0.002;
      // 微微左右转动（像在观察环境）
      head.rotation.y = Math.sin(time * 0.08) * 0.02;
    }

    // ── 颈部：跟随头部微动 ──
    const neck = this.bones.get('neck');
    if (neck) {
      neck.rotation.x = breathCycle * 0.003;
    }

    // ── 肩膀：呼吸起伏 ──
    const shoulderL = this.bones.get('shoulder_l');
    const shoulderR = this.bones.get('shoulder_r');
    if (shoulderL) {
      const shBreath = Math.sin(time * genome.breatheSpeed + 0.3);
      shoulderL.position.y = shoulderL.position.y + shBreath * 0.003;
    }
    if (shoulderR) {
      const shBreath = Math.sin(time * genome.breatheSpeed + 0.3);
      shoulderR.position.y = shoulderR.position.y + shBreath * 0.003;
    }

    // ── 手臂：微微摆动 ──
    const elbowL = this.bones.get('elbow_l');
    const elbowR = this.bones.get('elbow_r');
    if (elbowL) {
      elbowL.rotation.z = Math.sin(time * 0.3) * 0.005;
    }
    if (elbowR) {
      elbowR.rotation.z = Math.sin(time * 0.3 + 1) * 0.005;
    }

    // ── 手：微微摆动（呼吸相位偏移） ──
    const handL = this.bones.get('hand_l');
    const handR = this.bones.get('hand_r');
    if (handL) {
      const handBreath = Math.sin(time * genome.breatheSpeed + 0.8);
      handL.rotation.z = handBreath * 0.003;
    }
    if (handR) {
      const handBreath = Math.sin(time * genome.breatheSpeed + 0.8);
      handR.rotation.z = handBreath * 0.003;
    }

    // ── 膝盖：微微屈伸（呼吸节奏） ──
    const kneeL = this.bones.get('knee_l');
    const kneeR = this.bones.get('knee_r');
    if (kneeL) {
      kneeL.rotation.x = breathCycle * 0.002;
    }
    if (kneeR) {
      kneeR.rotation.x = breathCycle * 0.002;
    }

    // ══════════════════════════════════════════
    // Phase 3: 情绪联动微动作（完整版）
    // ══════════════════════════════════════════

    // ── 开心/兴奋：脚尖微踮 + 尾巴加速（已在上面处理） ──
    if (mood === 'happy' || mood === 'excited') {
      const footL = this.bones.get('foot_l');
      const footR = this.bones.get('foot_r');
      const joyBounce = Math.sin(time * 2) * 0.01;
      if (footL) footL.rotation.x = joyBounce;
      if (footR) footR.rotation.x = joyBounce;
    }

    // ── 悲伤/疲惫：肩膀下沉 ──
    if (mood === 'tired' || mood === 'sleeping') {
      if (shoulderL) shoulderL.position.y -= 0.005;
      if (shoulderR) shoulderR.position.y -= 0.005;
    }

    // ── 思考：身体前倾 ──
    if (mood === 'thinking') {
      if (spine) spine.rotation.x += 0.01;
    }

    // ── 愤怒：握拳 + 肩膀收紧 ──
    if (mood === 'frustrated' || mood === 'angry') {
      if (handL) handL.rotation.x = Math.sin(time * 3) * 0.05 + 0.08;
      if (handR) handR.rotation.x = Math.sin(time * 3 + 0.5) * 0.05 + 0.08;
      if (shoulderL) shoulderL.position.z += 0.003;
      if (shoulderR) shoulderR.position.z += 0.003;
    }

    // ── 恐惧/困惑：身体微缩 + 肩膀耸起 ──
    if (mood === 'confused') {
      if (chest) chest.scale.y = 1 - 0.005;
      if (shoulderL) shoulderL.position.y += 0.004;
      if (shoulderR) shoulderR.position.y += 0.004;
      // 头微歪
      if (head) head.rotation.z = Math.sin(time * 0.3) * 0.015;
    }

    // ── 平静：轻柔摇摆（已由 root sway 处理，此处加一点胸腔呼吸） ──
    if (mood === 'calm') {
      if (chest) {
        chest.scale.x = 1 + Math.sin(time * genome.breatheSpeed * 0.8) * 0.004;
      }
    }

    // ══════════════════════════════════════════
    // Phase 3: 注意力跟随（眼球→头→肩，延迟跟随）
    // ══════════════════════════════════════════

    // 头部跟随目标，延迟 200ms（用 lerp 模拟）
    const headLerp = 1 - Math.exp(-delta * 5);   // ~200ms 达到目标
    this.headAttention.x += (this.attentionTarget.x - this.headAttention.x) * headLerp;
    this.headAttention.y += (this.attentionTarget.y - this.headAttention.y) * headLerp;

    if (head) {
      // 叠加到已有的呼吸微动上
      head.rotation.y += this.headAttention.x * 0.15;  // 左右转动 ±0.15 rad
      head.rotation.x += this.headAttention.y * -0.08;  // 上下点头
    }

    // 颈部跟随头部，延迟 300ms
    const neckLerp = 1 - Math.exp(-delta * 3);
    if (neck) {
      neck.rotation.y += this.headAttention.x * 0.05 * neckLerp;
    }

    // 肩膀跟随头部，延迟 500ms（用更慢的 lerp）
    const shoulderLerp = 1 - Math.exp(-delta * 2);
    this.shoulderAttention.x += (this.headAttention.x - this.shoulderAttention.x) * shoulderLerp;
    this.shoulderAttention.y += (this.headAttention.y - this.shoulderAttention.y) * shoulderLerp;

    if (shoulderL) {
      shoulderL.position.x += this.shoulderAttention.x * -0.005;
      shoulderL.position.y += this.shoulderAttention.y * 0.003;
    }
    if (shoulderR) {
      shoulderR.position.x += this.shoulderAttention.x * -0.005;
      shoulderR.position.y += this.shoulderAttention.y * 0.003;
    }

    // ══════════════════════════════════════════
    // 自然眨眼系统（泊松分布间隔）
    // ══════════════════════════════════════════
    this.blinkTimer += delta;

    if (!this.isBlinking && this.blinkTimer >= this.nextBlinkAt) {
      this.isBlinking = true;
      this.blinkPhase = 0;
      this.blinkTimer = 0;
      this.isBlinkActive = true;
    }

    if (this.isBlinking) {
      const eyeLidL = this.bones.get('eyelid_l');
      const eyeLidR = this.bones.get('eyelid_r');
      if (this.blinkPhase === 0 && this.blinkTimer > 0.06) {
        this.blinkPhase = 1;
        this.blinkTimer = 0;
      }
      if (this.blinkPhase === 0) {
        if (eyeLidL) eyeLidL.rotation.x = Math.min(eyeLidL.rotation.x + delta * 8, 0.3);
        if (eyeLidR) eyeLidR.rotation.x = Math.min(eyeLidR.rotation.x + delta * 8, 0.3);
      } else {
        if (eyeLidL) eyeLidL.rotation.x = Math.max(eyeLidL.rotation.x - delta * 4, 0);
        if (eyeLidR) eyeLidR.rotation.x = Math.max(eyeLidR.rotation.x - delta * 4, 0);
        if (this.blinkTimer > 0.1) {
          this.isBlinking = false;
          this.isBlinkActive = false;
          this.blinkTimer = 0;
          this.nextBlinkAt = 2 + Math.random() * 4;
          if (Math.random() < 0.1) this.nextBlinkAt = 0.3;
        }
      }
    }
  }
}
