/**
 * FacialExpression — 面部表情系统
 *
 * v4.0 §6.5：情绪→表情映射
 * 骨骼驱动：眉/眼皮/嘴角/下巴
 *
 * 7 种情绪：happy/sad/angry/surprised/thinking/tired/calm
 */

import * as THREE from 'three';
import type { HumanoidSkeleton } from './humanoid-skeleton';

export interface FacialExpression {
  browL: number;      // -1 皱眉 ~ +1 挑眉
  browR: number;
  eyeLidL: number;    // 0 睁眼 ~ 1 闭眼
  eyeLidR: number;
  jaw: number;        // 0 闭嘴 ~ 1 张嘴
  lipL: number;       // -1 下拉 ~ +1 上扬
  lipR: number;
}

/** 情绪→表情预设 */
const EMOTION_PRESETS: Record<string, FacialExpression> = {
  happy: {
    browL: 0.3, browR: 0.3,
    eyeLidL: 0.1, eyeLidR: 0.1,
    jaw: 0.2,
    lipL: 0.8, lipR: 0.8,
  },
  sad: {
    browL: -0.5, browR: -0.5,
    eyeLidL: 0.3, eyeLidR: 0.3,
    jaw: 0,
    lipL: -0.5, lipR: -0.5,
  },
  angry: {
    browL: -0.8, browR: -0.8,
    eyeLidL: 0.2, eyeLidR: 0.2,
    jaw: 0.1,
    lipL: -0.3, lipR: -0.3,
  },
  surprised: {
    browL: 0.8, browR: 0.8,
    eyeLidL: 0, eyeLidR: 0,
    jaw: 0.6,
    lipL: 0, lipR: 0,
  },
  thinking: {
    browL: 0.2, browR: -0.3,
    eyeLidL: 0.2, eyeLidR: 0.1,
    jaw: 0,
    lipL: 0, lipR: 0.1,
  },
  tired: {
    browL: -0.2, browR: -0.2,
    eyeLidL: 0.5, eyeLidR: 0.5,
    jaw: 0.1,
    lipL: -0.2, lipR: -0.2,
  },
  calm: {
    browL: 0, browR: 0,
    eyeLidL: 0, eyeLidR: 0,
    jaw: 0,
    lipL: 0.1, lipR: 0.1,
  },
  excited: {
    browL: 0.5, browR: 0.5,
    eyeLidL: 0, eyeLidR: 0,
    jaw: 0.3,
    lipL: 0.6, lipR: 0.6,
  },
  confused: {
    browL: 0.3, browR: -0.4,
    eyeLidL: 0.15, eyeLidR: 0.05,
    jaw: 0.05,
    lipL: -0.1, lipR: 0,
  },
  energetic: {
    browL: 0.4, browR: 0.4,
    eyeLidL: 0, eyeLidR: 0,
    jaw: 0.15,
    lipL: 0.5, lipR: 0.5,
  },
  neutral: {
    browL: 0, browR: 0,
    eyeLidL: 0, eyeLidR: 0,
    jaw: 0,
    lipL: 0, lipR: 0,
  },
};

/** 骨骼名称→旋转轴映射 */
const BONE_TRANSFORMS: Record<string, {
  boneName: string;
  apply: (bone: THREE.Bone, value: number) => void;
}> = {
  browL:    { boneName: 'brow_l',   apply: (b, v) => { b.rotation.z = v * 0.15; } },
  browR:    { boneName: 'brow_r',   apply: (b, v) => { b.rotation.z = v * 0.15; } },
  eyeLidL:  { boneName: 'eyelid_l', apply: (b, v) => { b.rotation.x = v * 0.3; } },
  eyeLidR:  { boneName: 'eyelid_r', apply: (b, v) => { b.rotation.x = v * 0.3; } },
  jaw:      { boneName: 'jaw',      apply: (b, v) => { b.rotation.x = v * 0.2; } },
  lipL:     { boneName: 'lip_l',    apply: (b, v) => { b.rotation.z = v * 0.1; } },
  lipR:     { boneName: 'lip_r',    apply: (b, v) => { b.rotation.z = v * 0.1; } },
};

export class FacialExpressionSystem {
  private current: FacialExpression = { ...EMOTION_PRESETS.neutral };
  private target: FacialExpression = { ...EMOTION_PRESETS.neutral };
  private transitionSpeed = 0.05; // 每帧过渡速度

  /**
   * 设置目标情绪表情
   */
  setEmotion(mood: string): void {
    const preset = EMOTION_PRESETS[mood] ?? EMOTION_PRESETS.neutral;
    this.target = { ...preset };
  }

  /**
   * 每帧更新 — 平滑过渡 + 应用到骨骼
   */
  update(skeleton: HumanoidSkeleton): void {
    // 平滑过渡
    const t = this.transitionSpeed;
    this.current.browL    += (this.target.browL    - this.current.browL)    * t;
    this.current.browR    += (this.target.browR    - this.current.browR)    * t;
    this.current.eyeLidL  += (this.target.eyeLidL  - this.current.eyeLidL)  * t;
    this.current.eyeLidR  += (this.target.eyeLidR  - this.current.eyeLidR)  * t;
    this.current.jaw      += (this.target.jaw      - this.current.jaw)      * t;
    this.current.lipL     += (this.target.lipL     - this.current.lipL)     * t;
    this.current.lipR     += (this.target.lipR     - this.current.lipR)     * t;

    // 应用到骨骼
    for (const [key, transform] of Object.entries(BONE_TRANSFORMS)) {
      const bone = skeleton.getBone(transform.boneName);
      if (bone) {
        const value = this.current[key as keyof FacialExpression];
        transform.apply(bone, value);
      }
    }
  }

  /**
   * 眨眼动作（定时触发）
   */
  blink(skeleton: HumanoidSkeleton): void {
    const eyeLidL = skeleton.getBone('eyelid_l');
    const eyeLidR = skeleton.getBone('eyelid_r');
    if (eyeLidL) eyeLidL.rotation.x = 0.3; // 快速闭眼
    if (eyeLidR) eyeLidR.rotation.x = 0.3;
    // 下一帧恢复由 update() 的平滑过渡自动处理
  }

  /**
   * 获取当前表情状态（调试用）
   */
  getCurrent(): FacialExpression {
    return { ...this.current };
  }
}
