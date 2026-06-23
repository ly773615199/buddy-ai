/**
 * SpringPhysics — 阻尼弹簧系统
 *
 * 用于次级运动（耳朵/尾巴/翅膀/头发等附属物的惯性跟随）
 * 物理模型：F = -k(x - target) - d(v)
 *
 * 特性：
 * - 跟随目标时有延迟（惯性）
 * - 到达目标后有回弹（overshoot + settle）
 * - 可调节刚度/阻尼控制"松软感"
 */

export interface SpringConfig {
  /** 刚度 (0-1)：越大越紧跟随。默认 0.15 */
  stiffness: number;
  /** 阻尼 (0-1)：越大振荡越快衰减。默认 0.7 */
  damping: number;
  /** 最大位移限制。默认 Infinity */
  maxDisplacement?: number;
  /** 静止阈值：速度低于此值视为停止。默认 0.0001 */
  restThreshold?: number;
}

const DEFAULT_CONFIG: SpringConfig = {
  stiffness: 0.15,
  damping: 0.7,
  maxDisplacement: Math.PI * 0.5,
  restThreshold: 0.0001,
};

export class SpringValue {
  private value: number;
  private velocity = 0;
  private config: SpringConfig;

  constructor(initial = 0, config?: Partial<SpringConfig>) {
    this.value = initial;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新弹簧状态
   * @param target 目标值
   * @param dt 帧间隔（秒）
   * @returns 当前值
   */
  update(target: number, dt: number): number {
    const { stiffness, damping, maxDisplacement, restThreshold } = this.config;

    // 弹簧力 + 阻尼力
    const displacement = target - this.value;
    const springForce = displacement * stiffness;
    const dampingForce = -this.velocity * damping;

    this.velocity += (springForce + dampingForce) * Math.min(dt, 0.05);
    this.value += this.velocity * Math.min(dt, 0.05);

    // 位移限制
    if (maxDisplacement !== undefined && maxDisplacement < Infinity) {
      const clampedTarget = target;
      const diff = this.value - clampedTarget;
      if (Math.abs(diff) > maxDisplacement) {
        this.value = clampedTarget + Math.sign(diff) * maxDisplacement;
        this.velocity *= -0.3; // 碰壁反弹
      }
    }

    // 静止检测
    if (restThreshold !== undefined) {
      if (Math.abs(this.velocity) < restThreshold && Math.abs(displacement) < restThreshold) {
        this.velocity = 0;
        this.value = target;
      }
    }

    return this.value;
  }

  /** 立即设置值（跳过弹簧） */
  set(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  /** 施加脉冲力（比如被点击时弹一下） */
  impulse(force: number): void {
    this.velocity += force;
  }

  getValue(): number {
    return this.value;
  }

  getVelocity(): number {
    return this.velocity;
  }

  /** 是否已静止 */
  isAtRest(): boolean {
    const { restThreshold = 0.0001 } = this.config;
    return Math.abs(this.velocity) < restThreshold;
  }
}

/**
 * 3D 弹簧向量（用于位置/旋转的 xyz 分量）
 */
export class SpringVec3 {
  x: SpringValue;
  y: SpringValue;
  z: SpringValue;

  constructor(
    initial: [number, number, number] = [0, 0, 0],
    config?: Partial<SpringConfig>,
  ) {
    this.x = new SpringValue(initial[0], config);
    this.y = new SpringValue(initial[1], config);
    this.z = new SpringValue(initial[2], config);
  }

  update(target: [number, number, number], dt: number): [number, number, number] {
    return [
      this.x.update(target[0], dt),
      this.y.update(target[1], dt),
      this.z.update(target[2], dt),
    ];
  }

  set(value: [number, number, number]): void {
    this.x.set(value[0]);
    this.y.set(value[1]);
    this.z.set(value[2]);
  }

  impulse(force: [number, number, number]): void {
    this.x.impulse(force[0]);
    this.y.impulse(force[1]);
    this.z.impulse(force[2]);
  }
}

/**
 * 预设弹簧参数（按身体部位）
 */
export const SPRING_PRESETS = {
  /** 耳朵：轻快，有弹性 */
  ear: { stiffness: 0.12, damping: 0.55, maxDisplacement: 0.4 },
  /** 尾巴：松软，惯性大 */
  tail: { stiffness: 0.08, damping: 0.45, maxDisplacement: 0.6 },
  /** 翅膀：中等，有扇动感 */
  wing: { stiffness: 0.10, damping: 0.50, maxDisplacement: 0.5 },
  /** 头发/刘海：最松软 */
  hair: { stiffness: 0.06, damping: 0.40, maxDisplacement: 0.3 },
  /** 肩膀/身体：紧跟随 */
  body: { stiffness: 0.20, damping: 0.80, maxDisplacement: 0.1 },
  /** 手臂：中等 */
  arm: { stiffness: 0.12, damping: 0.60, maxDisplacement: 0.3 },
} as const;
