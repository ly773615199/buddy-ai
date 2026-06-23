/**
 * ChibiRenderer — Canvas2D Q 版角色渲染器
 *
 * 所有设备通用基线体验，不依赖 GPU / WebGL / 外部 API
 * 基因参数驱动外观，骨骼动画 + 情绪表情
 *
 * 绘制层级:
 *   1. 阴影 → 2. 尾巴 → 3. 身体 → 4. 腿 → 5. 手臂
 *   6. 翅膀 → 7. 头 → 8. 耳朵 → 9. 角 → 10. 五官 → 11. 粒子
 */

import type { BuddyGenome } from '../../pet/genome';
import type { HumanoidSkeleton } from './skeleton/humanoid-skeleton';
import type { FacialExpressionSystem } from './skeleton/facial-expression';

// ==================== 颜色工具 ====================

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.min(255, r + amount);
  const lg = Math.min(255, g + amount);
  const lb = Math.min(255, b + amount);
  return `rgb(${lr},${lg},${lb})`;
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0,r-amount)},${Math.max(0,g-amount)},${Math.max(0,b-amount)})`;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ==================== 默认基因 ====================

const DEFAULT_GENOME: Partial<BuddyGenome> = {
  bodyHeight: 1.0, bodyWidth: 1.0, bodyDepth: 1.0, bodyRoundness: 0.5,
  headSize: 1.0, eyeSize: 1.0, eyeSpacing: 1.0, eyeShape: 0.5,
  earSize: 0.8, earShape: 0.5, earAngle: 30,
  mouthSize: 0.5, mouthShape: 0.5,
  tailLength: 1.0, tailCurve: 0.5,
  wingSize: 0, hornSize: 0,
  primaryColor: '#58a6ff', secondaryColor: '#a371f7',
  patternDensity: 0.3, patternStyle: 0, colorGradient: 0.5,
  breatheSpeed: 1.0, swayAmount: 0.5,
};

// ==================== ChibiRenderer ====================

export class ChibiRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private time = 0;
  private running = false;
  private animId = 0;

  // 粒子
  private particles: Array<{
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; size: number; color: string;
  }> = [];

  // 点击闪光
  private flashAlpha = 0;
  private flashX = 0;
  private flashY = 0;

  constructor(container: HTMLElement, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * (window.devicePixelRatio || 1);
    this.canvas.height = height * (window.devicePixelRatio || 1);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animId);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  onClick(x: number, y: number): void {
    this.flashX = x;
    this.flashY = y;
    this.flashAlpha = 1;
    // 点击爆发粒子
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        size: 2 + Math.random() * 3,
        color: '#58a6ff',
      });
    }
  }

  updateProgress(_progress: number): void { /* 2D 不需要 */ }
  updateColors(_primary: string, _secondary?: string): void { /* 颜色来自 genome */ }

  dispose(): void {
    this.stop();
    this.canvas.remove();
  }

  // ── 主循环 ──

  private loop(): void {
    if (!this.running) return;
    this.animId = requestAnimationFrame(() => this.loop());
    this.time += 0.016;
  }

  /**
   * 外部调用：每帧渲染（由 BuddyCanvas 驱动）
   * 跟随 formProgress 渐进绘制：混沌光团 → Q版角色
   */
  render(
    skeleton: HumanoidSkeleton | null,
    facial: FacialExpressionSystem | null,
    genome: BuddyGenome | null,
    formProgress: number = 100,
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const g = { ...DEFAULT_GENOME, ...genome } as BuddyGenome;
    const t = this.time;
    const fp = Math.max(0, Math.min(100, formProgress)) / 100; // 0~1

    // 清除
    ctx.clearRect(0, 0, w, h);

    // 中心点 + 缩放
    const cx = w / 2;
    const cy = h / 2 + 10;
    const scale = Math.min(w, h) / 200;

    // 呼吸 + 摇摆
    const breathe = Math.sin(t * g.breatheSpeed * 2) * 0.02;
    const sway = Math.sin(t * 0.5) * g.swayAmount * 2;

    ctx.save();
    ctx.translate(cx + sway, cy);
    ctx.scale(scale, scale * (1 + breathe));

    // ═══ 渐进绘制 ═══

    // 阶段 1: 混沌光团 (fp 0~0.15)
    if (fp < 0.15) {
      this.drawChaosOrb(ctx, g, t, fp);
      ctx.restore();
      this.drawParticles(ctx, g);
      if (this.flashAlpha > 0) this.drawFlash(ctx);
      return;
    }

    // 阶段 2: 光团开始有轮廓 (fp 0.15~0.3)
    if (fp < 0.3) {
      const morphT = (fp - 0.15) / 0.15; // 0~1
      this.drawChaosOrb(ctx, g, t, fp);
      this.drawEmergingOutline(ctx, g, t, morphT);
      ctx.restore();
      this.drawParticles(ctx, g);
      if (this.flashAlpha > 0) this.drawFlash(ctx);
      return;
    }

    // 阶段 3+: 渐进显现 Q 版角色
    const bodyT = smoothstep(0.3, 0.7, fp);
    const detailT = smoothstep(0.5, 0.9, fp);
    const accessoryT = smoothstep(0.6, 1.0, fp);

    // 获取骨骼旋转
    const headRot = skeleton?.getBone('head')?.rotation.z ?? 0;
    const tailRot = skeleton?.getBone('tail')?.rotation.y ?? Math.sin(t * 0.06) * 0.3;
    const earLRot = skeleton?.getBone('ear_l')?.rotation.z ?? 0;
    const earRRot = skeleton?.getBone('ear_r')?.rotation.z ?? 0;
    const face = facial?.getCurrent() ?? { browL: 0, browR: 0, eyeLidL: 0, eyeLidR: 0, jaw: 0, lipL: 0, lipR: 0 };

    // 1. 阴影（淡入）
    if (bodyT > 0.1) {
      ctx.globalAlpha = bodyT;
      this.drawShadow(ctx, g);
      ctx.globalAlpha = 1;
    }

    // 2. 尾巴（后期出现）
    if (accessoryT > 0.1 && g.tailLength > 0.1) {
      ctx.globalAlpha = accessoryT;
      this.drawTail(ctx, g, tailRot);
      ctx.globalAlpha = 1;
    }

    // 3. 身体（从光团渐变为 Q 版身体）
    if (bodyT > 0) {
      this.drawBodyMorph(ctx, g, bodyT, t);
    }

    // 4. 腿
    if (bodyT > 0.3) {
      ctx.globalAlpha = smoothstep(0.3, 0.6, fp);
      this.drawLegs(ctx, g, t);
      ctx.globalAlpha = 1;
    }

    // 5. 手臂
    if (bodyT > 0.2) {
      ctx.globalAlpha = smoothstep(0.2, 0.5, fp);
      this.drawArms(ctx, g, t);
      ctx.globalAlpha = 1;
    }

    // 6. 翅膀
    if (accessoryT > 0.2 && g.wingSize > 0.1) {
      ctx.globalAlpha = accessoryT;
      this.drawWings(ctx, g, t);
      ctx.globalAlpha = 1;
    }

    // 7. 头部
    ctx.save();
    ctx.rotate(headRot * 0.3 * detailT);
    this.drawHeadMorph(ctx, g, bodyT, detailT);

    // 8. 耳朵
    if (accessoryT > 0.1) {
      ctx.globalAlpha = accessoryT;
      this.drawEars(ctx, g, earLRot, earRRot);
      ctx.globalAlpha = 1;
    }

    // 9. 角
    if (accessoryT > 0.2 && g.hornSize > 0.1) {
      ctx.globalAlpha = accessoryT;
      this.drawHorns(ctx, g);
      ctx.globalAlpha = 1;
    }

    // 10. 五官
    if (detailT > 0.1) {
      ctx.globalAlpha = detailT;
      this.drawFace(ctx, g, face, t);
      ctx.globalAlpha = 1;
    }

    ctx.restore(); // head rotation
    ctx.restore(); // main transform

    // 11. 粒子
    this.drawParticles(ctx, g);

    // 12. 点击闪光
    if (this.flashAlpha > 0) this.drawFlash(ctx);
  }

  // ==================== 绘制方法 ====================

  // ==================== 渐进阶段绘制 ====================

  /**
   * 混沌光团 (formProgress 0~15%)
   * 一团发光的粒子云，呼吸脉动
   */
  private drawChaosOrb(ctx: CanvasRenderingContext2D, g: BuddyGenome, t: number, fp: number): void {
    const baseR = 30 + fp * 40; // 随进度微微膨胀
    const pulse = 1 + Math.sin(t * g.breatheSpeed * 2) * 0.08;
    const r = baseR * pulse;

    // 多层光晕
    const layers = [
      { radius: r * 1.8, alpha: 0.04 },
      { radius: r * 1.4, alpha: 0.08 },
      { radius: r * 1.1, alpha: 0.15 },
      { radius: r * 0.8, alpha: 0.35 },
      { radius: r * 0.5, alpha: 0.6 },
    ];

    for (const layer of layers) {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, layer.radius);
      grad.addColorStop(0, rgba(g.primaryColor, layer.alpha));
      grad.addColorStop(0.6, rgba(g.secondaryColor, layer.alpha * 0.5));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, layer.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 核心亮点
    ctx.fillStyle = rgba('#ffffff', 0.4 + Math.sin(t * 3) * 0.2);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // 旋涡粒子（暗示内部结构）
    for (let i = 0; i < 8; i++) {
      const angle = t * 0.5 + i * Math.PI * 2 / 8;
      const dist = r * 0.6 + Math.sin(t * 2 + i) * 10;
      const px = Math.cos(angle) * dist;
      const py = Math.sin(angle) * dist;
      const alpha = 0.2 + Math.sin(t + i) * 0.1;
      ctx.fillStyle = rgba(g.primaryColor, alpha);
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 涌现轮廓 (formProgress 15~30%)
   * 光团开始有形状暗示
   */
  private drawEmergingOutline(ctx: CanvasRenderingContext2D, g: BuddyGenome, t: number, morphT: number): void {
    // 在光团基础上叠加模糊轮廓
    ctx.save();
    ctx.globalAlpha = morphT * 0.3;
    ctx.strokeStyle = g.primaryColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    // 头部轮廓（大圆）
    const headR = 24 + g.headSize * 12;
    ctx.beginPath();
    ctx.arc(0, -headR - 10, headR * (0.5 + morphT * 0.5), 0, Math.PI * 2);
    ctx.stroke();

    // 身体轮廓（椭圆）
    const bw = 28 * g.bodyWidth * morphT;
    const bh = 35 * g.bodyHeight * morphT;
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.3, bw, bh * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 身体渐变绘制 (formProgress 30~70%)
   * 从模糊轮廓渐变为清晰 Q 版身体
   */
  private drawBodyMorph(ctx: CanvasRenderingContext2D, g: BuddyGenome, bodyT: number, t: number): void {
    const bw = 28 * g.bodyWidth;
    const bh = 35 * g.bodyHeight;

    // 模糊度随 bodyT 降低
    ctx.save();
    ctx.globalAlpha = 0.3 + bodyT * 0.7;

    // 主体
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.roundRect(-bw, -5, bw * 2, bh, [12 * g.bodyRoundness]);
    ctx.fill();

    // 肚子高光
    if (bodyT > 0.3) {
      const grad = ctx.createRadialGradient(0, bh * 0.3, 0, 0, bh * 0.3, bw);
      grad.addColorStop(0, rgba(lighten(g.primaryColor, 40), 0.4 * bodyT));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.3, bw * 0.6, bh * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 纹路（后期出现）
    if (g.patternDensity > 0.2 && bodyT > 0.5) {
      ctx.globalAlpha = (bodyT - 0.5) * 2 * g.patternDensity * 0.3;
      this.drawPattern(ctx, g, -bw, -5, bw * 2, bh);
    }

    ctx.restore();
  }

  /**
   * 头部渐变绘制 (formProgress 30~90%)
   * 从模糊圆形渐变为清晰 Q 版头
   */
  private drawHeadMorph(ctx: CanvasRenderingContext2D, g: BuddyGenome, bodyT: number, detailT: number): void {
    const hr = 24 + g.headSize * 12;

    ctx.save();
    ctx.globalAlpha = 0.3 + bodyT * 0.7;

    // 头部主体
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.arc(0, -hr - 10, hr, 0, Math.PI * 2);
    ctx.fill();

    // 脸部高光（后期出现）
    if (detailT > 0.2) {
      const grad = ctx.createRadialGradient(-hr * 0.3, -hr - 20, 0, 0, -hr - 10, hr);
      grad.addColorStop(0, rgba(lighten(g.primaryColor, 50), 0.5 * detailT));
      grad.addColorStop(0.5, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, -hr - 10, hr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 腮红（后期出现）
    if (detailT > 0.5) {
      ctx.fillStyle = rgba(g.secondaryColor, 0.15 * detailT);
      ctx.beginPath();
      ctx.ellipse(-hr * 0.5, -hr, hr * 0.25, hr * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hr * 0.5, -hr, hr * 0.25, hr * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ==================== 基础绘制方法 ====================

  private drawShadow(ctx: CanvasRenderingContext2D, g: BuddyGenome): void {
    const shadowW = 40 * g.bodyWidth;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(0, 70, shadowW, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawTail(ctx: CanvasRenderingContext2D, g: BuddyGenome, tailRot: number): void {
    if (g.tailLength < 0.1) return;
    const len = 20 + g.tailLength * 20;
    const curve = g.tailCurve * 30;

    ctx.save();
    ctx.translate(0, 20);
    ctx.rotate(tailRot);

    ctx.strokeStyle = g.primaryColor;
    ctx.lineWidth = 4 + g.tailLength;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-curve, -len * 0.5, -curve * 0.5, -len);
    ctx.stroke();

    // 尾巴尖端光点
    ctx.fillStyle = lighten(g.primaryColor, 60);
    ctx.beginPath();
    ctx.arc(-curve * 0.5, -len, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, g: BuddyGenome): void {
    const bw = 28 * g.bodyWidth;
    const bh = 35 * g.bodyHeight;

    // 主体
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.roundRect(-bw, -5, bw * 2, bh, [12 * g.bodyRoundness]);
    ctx.fill();

    // 肚子高光
    const grad = ctx.createRadialGradient(0, bh * 0.3, 0, 0, bh * 0.3, bw);
    grad.addColorStop(0, rgba(lighten(g.primaryColor, 40), 0.4));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.3, bw * 0.6, bh * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 纹路
    if (g.patternDensity > 0.2) {
      this.drawPattern(ctx, g, -bw, -5, bw * 2, bh);
    }
  }

  private drawPattern(ctx: CanvasRenderingContext2D, g: BuddyGenome, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.globalAlpha = g.patternDensity * 0.3;
    ctx.fillStyle = g.secondaryColor;

    if (g.patternStyle < 0.33) {
      // 点
      for (let i = 0; i < 5; i++) {
        const px = x + w * 0.2 + Math.sin(i * 1.3) * w * 0.3;
        const py = y + h * 0.2 + (i / 5) * h * 0.6;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (g.patternStyle < 0.66) {
      // 条纹
      for (let i = 0; i < 3; i++) {
        const sy = y + h * 0.25 + i * h * 0.2;
        ctx.fillRect(x + w * 0.2, sy, w * 0.6, 2);
      }
    } else {
      // 环
      ctx.strokeStyle = g.secondaryColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.4, w * 0.3, h * 0.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLegs(ctx: CanvasRenderingContext2D, g: BuddyGenome, t: number): void {
    const legW = 8 * g.bodyWidth;
    const legH = 18 * g.bodyHeight;
    const bodyH = 35 * g.bodyHeight;
    const bounce = Math.sin(t * 2) * 1.5;

    ctx.fillStyle = darken(g.primaryColor, 20);

    // 左腿
    ctx.save();
    ctx.translate(-12 * g.bodyWidth, bodyH - 5);
    ctx.rotate(Math.sin(t * 0.8) * 0.05);
    ctx.beginPath();
    ctx.roundRect(-legW / 2, 0, legW, legH + bounce, [4]);
    ctx.fill();
    // 脚
    ctx.fillStyle = darken(g.primaryColor, 30);
    ctx.beginPath();
    ctx.ellipse(0, legH + bounce, legW * 0.7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 右腿
    ctx.fillStyle = darken(g.primaryColor, 20);
    ctx.save();
    ctx.translate(12 * g.bodyWidth, bodyH - 5);
    ctx.rotate(Math.sin(t * 0.8 + 1) * 0.05);
    ctx.beginPath();
    ctx.roundRect(-legW / 2, 0, legW, legH - bounce, [4]);
    ctx.fill();
    ctx.fillStyle = darken(g.primaryColor, 30);
    ctx.beginPath();
    ctx.ellipse(0, legH - bounce, legW * 0.7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawArms(ctx: CanvasRenderingContext2D, g: BuddyGenome, t: number): void {
    const armW = 6 * g.bodyWidth;
    const armH = 22 * g.bodyHeight;
    const bodyH = 35 * g.bodyHeight;

    ctx.fillStyle = darken(g.primaryColor, 10);

    // 左臂
    ctx.save();
    ctx.translate(-28 * g.bodyWidth, 8);
    ctx.rotate(Math.sin(t * 0.3) * 0.15 - 0.2);
    ctx.beginPath();
    ctx.roundRect(-armW / 2, 0, armW, armH, [3]);
    ctx.fill();
    ctx.restore();

    // 右臂
    ctx.save();
    ctx.translate(28 * g.bodyWidth, 8);
    ctx.rotate(Math.sin(t * 0.3 + 1) * 0.15 + 0.2);
    ctx.beginPath();
    ctx.roundRect(-armW / 2, 0, armW, armH, [3]);
    ctx.fill();
    ctx.restore();
  }

  private drawWings(ctx: CanvasRenderingContext2D, g: BuddyGenome, t: number): void {
    const size = 20 + g.wingSize * 20;
    const flap = Math.sin(t * 0.04) * 0.2;

    ctx.save();
    ctx.globalAlpha = 0.6;

    // 左翼
    ctx.save();
    ctx.translate(-20, 0);
    ctx.rotate(-0.3 + flap);
    ctx.fillStyle = rgba(g.secondaryColor, 0.4);
    ctx.strokeStyle = g.secondaryColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-size * 0.8, -size * 0.3, -size, -size * 0.6);
    ctx.quadraticCurveTo(-size * 0.4, -size * 0.2, 0, -size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 右翼
    ctx.save();
    ctx.translate(20, 0);
    ctx.rotate(0.3 - flap);
    ctx.fillStyle = rgba(g.secondaryColor, 0.4);
    ctx.strokeStyle = g.secondaryColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.8, -size * 0.3, size, -size * 0.6);
    ctx.quadraticCurveTo(size * 0.4, -size * 0.2, 0, -size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  private drawHead(ctx: CanvasRenderingContext2D, g: BuddyGenome): void {
    const hr = 24 + g.headSize * 12;

    // 头部主体
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.arc(0, -hr - 10, hr, 0, Math.PI * 2);
    ctx.fill();

    // 脸部高光
    const grad = ctx.createRadialGradient(-hr * 0.3, -hr - 20, 0, 0, -hr - 10, hr);
    grad.addColorStop(0, rgba(lighten(g.primaryColor, 50), 0.5));
    grad.addColorStop(0.5, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, -hr - 10, hr, 0, Math.PI * 2);
    ctx.fill();

    // 腮红
    ctx.fillStyle = rgba(g.secondaryColor, 0.15);
    ctx.beginPath();
    ctx.ellipse(-hr * 0.5, -hr, hr * 0.25, hr * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hr * 0.5, -hr, hr * 0.25, hr * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEars(ctx: CanvasRenderingContext2D, g: BuddyGenome, leftRot: number, rightRot: number): void {
    const hr = 24 + g.headSize * 12;
    const earLen = 10 + g.earSize * 15;
    const earW = 6 + g.earSize * 6;
    const sharp = g.earShape; // 0=圆, 1=尖

    // 左耳
    ctx.save();
    ctx.translate(-hr * 0.6, -hr * 1.8 - 10);
    ctx.rotate(leftRot - 0.3);
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.moveTo(-earW, 0);
    if (sharp > 0.5) {
      // 尖耳
      ctx.lineTo(0, -earLen);
      ctx.lineTo(earW, 0);
    } else {
      // 圆耳
      ctx.quadraticCurveTo(-earW, -earLen, 0, -earLen);
      ctx.quadraticCurveTo(earW, -earLen, earW, 0);
    }
    ctx.closePath();
    ctx.fill();
    // 内耳
    ctx.fillStyle = rgba(g.secondaryColor, 0.4);
    ctx.beginPath();
    ctx.moveTo(-earW * 0.5, -2);
    ctx.quadraticCurveTo(0, -earLen * 0.7, earW * 0.5, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 右耳
    ctx.save();
    ctx.translate(hr * 0.6, -hr * 1.8 - 10);
    ctx.rotate(rightRot + 0.3);
    ctx.fillStyle = g.primaryColor;
    ctx.beginPath();
    ctx.moveTo(-earW, 0);
    if (sharp > 0.5) {
      ctx.lineTo(0, -earLen);
      ctx.lineTo(earW, 0);
    } else {
      ctx.quadraticCurveTo(-earW, -earLen, 0, -earLen);
      ctx.quadraticCurveTo(earW, -earLen, earW, 0);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(g.secondaryColor, 0.4);
    ctx.beginPath();
    ctx.moveTo(-earW * 0.5, -2);
    ctx.quadraticCurveTo(0, -earLen * 0.7, earW * 0.5, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawHorns(ctx: CanvasRenderingContext2D, g: BuddyGenome): void {
    const hr = 24 + g.headSize * 12;
    const hornLen = 8 + g.hornSize * 15;

    ctx.fillStyle = darken(g.secondaryColor, 20);
    ctx.strokeStyle = g.secondaryColor;
    ctx.lineWidth = 1.5;

    // 左角
    ctx.save();
    ctx.translate(-hr * 0.3, -hr * 2 - 10);
    ctx.rotate(-0.2);
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(0, -hornLen);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 右角
    ctx.save();
    ctx.translate(hr * 0.3, -hr * 2 - 10);
    ctx.rotate(0.2);
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(0, -hornLen);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    g: BuddyGenome,
    face: { browL: number; browR: number; eyeLidL: number; eyeLidR: number; jaw: number; lipL: number; lipR: number },
    t: number,
  ): void {
    const hr = 24 + g.headSize * 12;
    const eyeY = -hr - 12;
    const eyeSpacing = 14 * g.eyeSpacing;
    const eyeR = 4 + g.eyeSize * 3;

    // ── 眼睛 ──
    // 左眼
    this.drawEye(ctx, -eyeSpacing, eyeY, eyeR, face.eyeLidL, g, t);
    // 右眼
    this.drawEye(ctx, eyeSpacing, eyeY, eyeR, face.eyeLidR, g, t);

    // ── 眉毛 ──
    ctx.strokeStyle = darken(g.primaryColor, 60);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // 左眉
    ctx.save();
    ctx.translate(-eyeSpacing, eyeY - eyeR - 4);
    ctx.rotate(face.browL * 0.3);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(6, face.browL * -3);
    ctx.stroke();
    ctx.restore();

    // 右眉
    ctx.save();
    ctx.translate(eyeSpacing, eyeY - eyeR - 4);
    ctx.rotate(face.browR * -0.3);
    ctx.beginPath();
    ctx.moveTo(-6, face.browR * -3);
    ctx.lineTo(6, 0);
    ctx.stroke();
    ctx.restore();

    // ── 嘴巴 ──
    const mouthY = -hr + 4;
    const mouthW = 4 + g.mouthSize * 6;

    ctx.strokeStyle = darken(g.primaryColor, 50);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (face.jaw > 0.3) {
      // 张嘴
      ctx.fillStyle = darken(g.primaryColor, 80);
      ctx.beginPath();
      ctx.ellipse(0, mouthY, mouthW * face.jaw, 3 + face.jaw * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 闭嘴 — 根据 lipL/lipR 决定弧度
      const curve = (face.lipL + face.lipR) * 0.5 * 4;
      ctx.beginPath();
      ctx.moveTo(-mouthW, mouthY);
      ctx.quadraticCurveTo(0, mouthY + curve, mouthW, mouthY);
      ctx.stroke();
    }
  }

  private drawEye(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number,
    eyeLid: number,
    g: BuddyGenome,
    t: number,
  ): void {
    // 眼白
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (1 - eyeLid * 0.8), 0, 0, Math.PI * 2);
    ctx.fill();

    if (eyeLid > 0.9) return; // 闭眼

    // 瞳孔
    const pupilR = r * 0.5 * (0.5 + g.pupilSize * 0.5);
    const lookX = Math.sin(t * 0.08) * 1.5; // 微微左右看
    ctx.fillStyle = darken(g.primaryColor, 80);
    ctx.beginPath();
    ctx.arc(x + lookX, y, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // 高光
    if (g.eyeHighlight > 0.3) {
      ctx.fillStyle = `rgba(255,255,255,${g.eyeHighlight * 0.8})`;
      ctx.beginPath();
      ctx.arc(x + lookX - pupilR * 0.3, y - pupilR * 0.3, pupilR * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // 眨眼（每 3-5 秒）
    const blinkCycle = t % (3 + Math.sin(t * 0.1) * 2);
    if (blinkCycle < 0.1) {
      ctx.fillStyle = g.primaryColor;
      ctx.beginPath();
      ctx.ellipse(x, y, r + 1, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 粒子 ──

  private drawParticles(ctx: CanvasRenderingContext2D, g: BuddyGenome): void {
    // 自动产生粒子
    if (Math.random() < 0.15) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 40;
      this.particles.push({
        x: this.width / 2 + Math.cos(angle) * dist,
        y: this.height / 2 + Math.sin(angle) * dist * 0.5 - 20,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.5,
        life: 40 + Math.random() * 30,
        maxLife: 70,
        size: 1.5 + Math.random() * 2,
        color: Math.random() > 0.5 ? g.primaryColor : g.secondaryColor,
      });
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life--;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = rgba(p.color, alpha * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 点击闪光 ──

  private drawFlash(ctx: CanvasRenderingContext2D): void {
    this.flashAlpha *= 0.9;
    if (this.flashAlpha < 0.01) { this.flashAlpha = 0; return; }

    const grad = ctx.createRadialGradient(this.flashX, this.flashY, 0, this.flashX, this.flashY, 30);
    grad.addColorStop(0, rgba('#ffffff', this.flashAlpha * 0.6));
    grad.addColorStop(0.5, rgba('#58a6ff', this.flashAlpha * 0.3));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.flashX, this.flashY, 30, 0, Math.PI * 2);
    ctx.fill();
  }
}
