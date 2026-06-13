/**
 * 3D 粒子系统 — THREE.Points + AdditiveBlending
 *
 * 对接现有 EmotionParticleParams（emotion-particles.ts）
 * 情绪驱动颜色/速度/密度/光晕
 */

import * as THREE from 'three';
import type { EmotionParticleParams } from '../emotion/emotion-particles';
import type { TierCapabilities } from './detect-tier';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  wobblePhase: number;
  wobbleSpeed: number;
}

export class ParticleSystem {
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private particles: Particle[] = [];
  private maxParticles: number;
  private primaryColor: THREE.Color;
  private secondaryColor: THREE.Color;
  private emotionParams: EmotionParticleParams;

  // Buffer arrays
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor(
    scene: THREE.Scene,
    primaryColor: string,
    secondaryColor: string,
    tier: TierCapabilities,
  ) {
    this.maxParticles = tier.maxParticles;
    this.primaryColor = new THREE.Color(primaryColor);
    this.secondaryColor = new THREE.Color(secondaryColor || primaryColor);

    // 默认情绪参数
    this.emotionParams = {
      hueShift: 0,
      saturationMul: 1,
      brightnessMul: 1,
      velocityMul: 1,
      spreadMul: 1,
      spawnRateMul: 1,
      lifetimeMul: 1,
      glowIntensityMul: 1,
      glowPulseSpeed: 0.02,
      trailEnabled: false,
      wobbleAmount: 0.5,
      clusterTendency: 0.3,
    };

    // Buffer
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.PointsMaterial({
      size: 0.03,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  /**
   * 更新情绪参数（来自 emotion-particles.ts 的 computeEmotionParams 输出）
   */
  updateEmotion(params: EmotionParticleParams): void {
    this.emotionParams = params;
  }

  /**
   * 更新主色调（Onboarding 选择变化时）
   */
  updateColors(primary: string, secondary?: string): void {
    this.primaryColor.set(primary);
    this.secondaryColor.set(secondary || primary);
  }

  /**
   * 主循环调用 — 更新粒子位置/生命周期/生成新粒子
   * @param time 当前时间（秒）
   * @param spawnCount 本帧生成数量（0 = 按情绪自动计算）
   */
  update(time: number, spawnCount = 0): void {
    const ep = this.emotionParams;

    // 生成新粒子
    const count = spawnCount > 0
      ? spawnCount
      : Math.max(1, Math.round(2 * ep.spawnRateMul));

    for (let i = 0; i < count; i++) {
      this.spawnParticle(time);
    }

    // 更新现有粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // 运动
      const wobbleX = ep.wobbleAmount > 0.1
        ? Math.sin(p.life * p.wobbleSpeed + p.wobblePhase) * ep.wobbleAmount * 0.3
        : 0;
      const wobbleY = ep.wobbleAmount > 0.1
        ? Math.cos(p.life * p.wobbleSpeed * 0.7 + p.wobblePhase) * ep.wobbleAmount * 0.15
        : 0;

      p.position.x += p.velocity.x + wobbleX;
      p.position.y += p.velocity.y + wobbleY;
      p.position.z += p.velocity.z;

      // 聚集倾向
      if (ep.clusterTendency > 0.1) {
        p.position.x -= p.position.x * ep.clusterTendency * 0.003;
        p.position.y -= p.position.y * ep.clusterTendency * 0.003;
      }
    }

    // 同步到 buffer
    this.syncBuffers();
  }

  /**
   * 点击爆发 — 在指定位置生成一批粒子
   */
  burst(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnParticle(0, x, y, z, true);
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    if (this.points.parent) {
      this.points.parent.remove(this.points);
    }
  }

  // ── 内部方法 ──

  private spawnParticle(time: number, px = 0, py = 0, pz = 0, burst = false): void {
    if (this.particles.length >= this.maxParticles) return;

    const ep = this.emotionParams;
    const spread = burst ? 1.5 : 0.3 * ep.spreadMul;
    const speedMul = burst ? 1.5 : 0.3 * ep.velocityMul;

    const p: Particle = {
      position: new THREE.Vector3(
        px + (Math.random() - 0.5) * spread,
        py + (Math.random() - 0.5) * spread,
        pz + (Math.random() - 0.5) * spread * 0.5,
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * speedMul * 0.3,
        (0.3 + Math.random() * speedMul) * 0.8,
        (Math.random() - 0.5) * speedMul * 0.15,
      ),
      life: Math.round((burst ? 40 : 80 + Math.random() * 60) * ep.lifetimeMul),
      maxLife: 0, // computed below
      size: (1.5 + Math.random() * 2.5) * (0.8 + ep.brightnessMul * 0.4),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.05 + Math.random() * 0.1,
    };
    p.maxLife = p.life;
    this.particles.push(p);
  }

  private syncBuffers(): void {
    const count = this.particles.length;

    for (let i = 0; i < this.maxParticles; i++) {
      if (i < count) {
        const p = this.particles[i];
        const lifeRatio = p.life / p.maxLife;

        this.positions[i * 3] = p.position.x;
        this.positions[i * 3 + 1] = p.position.y;
        this.positions[i * 3 + 2] = p.position.z;

        // 颜色：主色和副色之间插值，受情绪色相偏移影响
        const color = new THREE.Color().lerpColors(
          this.primaryColor,
          this.secondaryColor,
          0.3 + Math.sin(p.wobblePhase) * 0.2,
        );
        this.colors[i * 3] = color.r;
        this.colors[i * 3 + 1] = color.g;
        this.colors[i * 3 + 2] = color.b;

        this.sizes[i] = p.size * lifeRatio * this.emotionParams.glowIntensityMul;
      } else {
        // 空粒子：放到视野外
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = -100;
        this.positions[i * 3 + 2] = 0;
        this.sizes[i] = 0;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }
}
