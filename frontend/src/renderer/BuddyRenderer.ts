/**
 * BuddyRenderer — Three.js 渲染器核心
 *
 * 职责：
 * - 场景/相机/灯光管理
 * - GPU 降级检测 + WebGPU 尝试
 * - 光团/人形/粒子/后处理协调
 * - SkinnedMesh 骨架绑定
 * - Tab 可见性暂停
 *
 * Phase 1：光团（蛋/孵化阶段）
 * Phase 3+：人形 mesh + 骨骼
 */

import * as THREE from 'three';
import { detectCapabilities, createRenderer, type TierCapabilities, type RenderTier } from './detect-tier';
import { OrbMesh, type OrbParams } from './meshes/orb-mesh';
import { HumanoidMesh } from './meshes/humanoid-mesh';
import { ParticleSystem } from './particle-system';
import { HumanoidSkeleton } from './skeleton/humanoid-skeleton';
import { FacialExpressionSystem } from './skeleton/facial-expression';
import { PostProcessing } from './post-processing';
import { ChibiRenderer } from './chibi-renderer';
import { CostumeRenderer } from './costume/CostumeRenderer';
import type { EmotionParticleParams } from '../emotion/emotion-particles';
import type { BuddyGenome } from '../../pet/genome';

/** 质感 → 光晕边缘硬度 */
const GLOW_EDGE: Record<string, number> = {
  soft: 0.6,
  transparent: 0.85,
  sharp: 0.95,
  warm: 0.5,
};

/** 质感 → 光晕半径倍数 */
const GLOW_SCALE: Record<string, number> = {
  soft: 1.3,
  transparent: 1.5,
  sharp: 1.1,
  warm: 1.4,
};

/** 质感 → 粗糙度/金属度 */
const MATERIAL_PROPS: Record<string, { roughness: number; metalness: number }> = {
  soft:        { roughness: 0.6,  metalness: 0.0 },
  transparent: { roughness: 0.15, metalness: 0.2 },
  sharp:       { roughness: 0.3,  metalness: 0.3 },
  warm:        { roughness: 0.75, metalness: 0.0 },
};

/** 气质 → 呼吸速度 */
const BREATH_MAP: Record<string, number> = {
  warm: 0.02,
  calm: 0.015,
  lively: 0.04,
  mysterious: 0.025,
};

export interface BuddyRendererConfig {
  container: HTMLElement;
  width: number;
  height: number;
  primaryColor: string;
  secondaryColor?: string;
  texture: string;      // soft | transparent | sharp | warm
  temperament: string;   // warm | calm | lively | mysterious
}

export class BuddyRenderer {
  // Core
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Objects
  private orb: OrbMesh;
  private humanoid: HumanoidMesh | null = null;
  private skeleton: HumanoidSkeleton | null = null;
  private facial: FacialExpressionSystem | null = null;
  private particles: ParticleSystem;
  private postProcessing: PostProcessing | null = null;
  private costumeRenderer: CostumeRenderer | null = null;
  private activeMesh: 'orb' | 'humanoid' = 'orb';
  private currentMood = 'neutral';
  private currentGenome: BuddyGenome | null = null;
  private isWebGPU = false;

  // State
  private tier: RenderTier = 'fallback';
  private caps: TierCapabilities;
  private running = false;
  private lastTime = 0;
  private animationId = 0;
  private chibi: ChibiRenderer | null = null;
  private useChibi = false;
  private currentFormProgress = 0;

  // Config
  private width: number;
  private height: number;
  private container: HTMLElement;
  private texture: string;
  private temperament: string;

  // Interaction
  private mouseX = 0;
  private mouseY = 0;
  private mouseInside = false;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  // Callbacks
  private onTierDetected?: (tier: RenderTier) => void;

  constructor(config: BuddyRendererConfig) {
    this.container = config.container;
    this.width = config.width;
    this.height = config.height;
    this.texture = config.texture;
    this.temperament = config.temperament;
    this.caps = {
      tier: 'fallback',
      maxParticles: 0,
      meshResolution: 0,
      enablePostProcessing: false,
      enableSSAO: false,
      enableBloom: false,
      enableShadows: false,
      useWebGPU: false,
    };

    // 场景
    this.scene = new THREE.Scene();

    // 相机
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0, 3);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0x404040, 0.6));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(2, 3, 4);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(mainLight);

    // 补光
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-2, 1, -3);
    this.scene.add(fillLight);

    // 光团
    const edgeHardness = GLOW_EDGE[config.texture] || 0.6;
    const breathSpeed = BREATH_MAP[config.temperament] || 0.025;
    this.orb = new OrbMesh({
      primaryColor: config.primaryColor,
      secondaryColor: config.secondaryColor,
      breathSpeed,
      glowIntensity: 1.0,
      edgeHardness,
      secondaryMix: 0.5,
    });
    this.scene.add(this.orb.getMesh());

    // 粒子（先用默认 cap，init 后更新）
    this.particles = new ParticleSystem(
      this.scene,
      config.primaryColor,
      config.secondaryColor || config.primaryColor,
      { ...this.caps, maxParticles: 50 },
    );

    // ChibiRenderer — 立即可用，不等 GPU 检测
    this.chibi = new ChibiRenderer(config.container, config.width, config.height);
    this.useChibi = true;
    this.chibi.start();
  }

  /**
   * 异步初始化 — 检测 GPU，创建渲染器
   */
  async init(): Promise<RenderTier> {
    this.tier = await detectCapabilities();
    this.caps = (await import('./detect-tier')).getTierCapabilities(this.tier);
    this.onTierDetected?.(this.tier);

    if (this.tier === 'fallback') {
      return this.tier;
    }

    // 创建渲染器（优先 WebGPU，fallback 到 WebGL）
    const pixelRatio = Math.min(window.devicePixelRatio, this.tier === 'low' ? 1 : 2);
    const { renderer, isWebGPU } = await createRenderer({
      container: this.container,
      width: this.width,
      height: this.height,
      tier: this.tier,
      antialias: this.tier !== 'low',
      pixelRatio,
    });

    this.renderer = renderer;
    this.isWebGPU = isWebGPU;

    // 挂载到 DOM
    this.container.appendChild(this.renderer.domElement);

    // 后处理管线
    if (this.caps.enablePostProcessing) {
      this.postProcessing = new PostProcessing(
        this.renderer,
        this.scene,
        this.camera,
        this.caps,
      );
    }

    // 重建粒子系统（用正确的 cap）
    this.particles.dispose();
    this.particles = new ParticleSystem(
      this.scene,
      this.orb.getMesh().material instanceof THREE.ShaderMaterial
        ? '#' + (this.orb.getMesh().material as THREE.ShaderMaterial).uniforms.u_primaryColor.value.getHexString()
        : '#58a6ff',
      '#a371f7',
      this.caps,
    );

    // 3D 就绪，但不立即切换——等 genome 到达后由 triggerSwitchTo3D() 触发
    return this.tier;
  }

  /**
   * 外部触发切换：2D Q版 → 3D（genome 就绪后调用）
   */
  triggerSwitchTo3D(): void {
    if (!this.useChibi || !this.renderer) return;
    this.useChibi = false;
    // 3D 渲染器开始工作
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now() / 1000;
      this.loop();
    }
  }

  /**
   * 是否在用 2D 模式
   */
  isChibiMode(): boolean {
    return this.useChibi;
  }

  /**
   * 开始渲染循环
   */
  start(): void {
    if (this.running || !this.renderer) return;
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.loop();
  }

  /**
   * 停止渲染循环
   */
  stop(): void {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  /**
   * 更新情绪参数
   */
  updateEmotion(params: EmotionParticleParams): void {
    this.particles.updateEmotion(params);
  }

  /**
   * 更新情绪状态（mood 变化时调用）
   */
  updateMood(mood: string): void {
    this.currentMood = mood;
    this.facial?.setEmotion(mood);
    this.postProcessing?.updateMood(mood);
  }

  /**
   * 更新颜色
   */
  updateColors(primary: string, secondary?: string): void {
    this.orb.updateParams({ primaryColor: primary, secondaryColor: secondary });
    this.particles.updateColors(primary, secondary);
    this.humanoid?.updateColors(primary, secondary);
  }

  /**
   * 更新质感
   */
  updateTexture(texture: string): void {
    this.texture = texture;
    const edgeHardness = GLOW_EDGE[texture] || 0.6;
    this.orb.updateParams({ edgeHardness });
    const props = MATERIAL_PROPS[texture] || MATERIAL_PROPS.soft;
    this.humanoid?.updateMaterialProps(props.roughness, props.metalness);
  }

  /**
   * 更新 formProgress — 控制光团发光强度 + 人形变形 + 后处理
   * 早期更强（光团感），后期减弱（形态清晰）
   */
  updateProgress(progress: number): void {
    this.currentFormProgress = progress;
    const t = progress / 100;
    const glowIntensity = Math.max(0, 1 - t);
    this.orb.updateParams({ glowIntensity });
    this.humanoid?.updateFormProgress(progress);

    // 后处理 Bloom 跟随 formProgress
    this.postProcessing?.updateForProgress(progress);

    // formProgress > 15% 时从光团过渡到人形
    if (progress > 15 && this.humanoid && this.activeMesh === 'orb') {
      this.scene.remove(this.orb.getMesh());
      this.scene.add(this.humanoid.getMesh());
      this.activeMesh = 'humanoid';
    } else if (progress <= 15 && this.activeMesh === 'humanoid') {
      this.scene.remove(this.humanoid.getMesh());
      this.scene.add(this.orb.getMesh());
      this.activeMesh = 'orb';
    }

    // formProgress >= 70% 时自动装备默认服饰
    if (progress >= 70 && this.costumeRenderer && this.skeleton) {
      const primaryColor = this.getPrimaryColor();
      this.costumeRenderer.autoEquipDefaults(this.skeleton.bones, this.currentGenome!, primaryColor);
    } else if (progress < 70 && this.costumeRenderer) {
      this.costumeRenderer.unequipDefaults();
    }
  }

  /**
   * 更新基因参数（接收 genome 后调用）
   */
  updateGenome(genome: BuddyGenome): void {
    this.currentGenome = genome;
    const primaryColor = this.getPrimaryColor();

    if (!this.humanoid) {
      // 创建人形 mesh
      this.humanoid = new HumanoidMesh(genome, primaryColor);

      // 应用质感
      const props = MATERIAL_PROPS[this.texture] || MATERIAL_PROPS.soft;
      this.humanoid.updateMaterialProps(props.roughness, props.metalness);
    } else {
      this.humanoid.updateGenome(genome);
    }

    // 创建/更新骨架
    if (!this.skeleton) {
      this.skeleton = new HumanoidSkeleton(genome);
      this.facial = new FacialExpressionSystem();

      // 绑定骨架到 mesh
      if (this.skeleton.skeleton) {
        this.humanoid.bindSkeleton(this.skeleton.skeleton);
      }
    } else {
      this.skeleton.applyGenome(genome);
    }

    // 初始化服饰渲染器
    if (!this.costumeRenderer) {
      this.costumeRenderer = new CostumeRenderer();
    }
  }

  /**
   * 窗口大小变化
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(width, height);
    this.postProcessing?.resize(width, height);
  }

  /**
   * 鼠标移动（眼球追踪 + 接近反应）
   */
  onMouseMove(x: number, y: number, inside: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseInside = inside;
  }

  /**
   * 点击（粒子爆发）
   */
  onClick(x: number, y: number): void {
    const worldX = (x / this.width - 0.5) * 2;
    const worldY = -(y / this.height - 0.5) * 2;
    this.particles.burst(worldX, worldY, 0, 8);
  }

  /**
   * 设置 GPU 检测回调
   */
  setOnTierDetected(cb: (tier: RenderTier) => void): void {
    this.onTierDetected = cb;
  }

  /**
   * 获取渲染档次
   */
  getTier(): RenderTier {
    return this.tier;
  }

  /**
   * 是否使用 WebGPU
   */
  isWebGPURenderer(): boolean {
    return this.isWebGPU;
  }

  /**
   * 获取服饰渲染器
   */
  getCostumeRenderer(): CostumeRenderer | null {
    return this.costumeRenderer;
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.stop();
    this.chibi?.dispose();
    this.chibi = null;
    this.postProcessing?.dispose();
    this.costumeRenderer?.dispose();
    this.particles.dispose();
    this.orb.dispose();
    this.humanoid?.dispose();
    this.skeleton = null;
    this.facial = null;
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  // ── 内部方法 ──

  private getPrimaryColor(): string {
    if (this.orb.getMesh().material instanceof THREE.ShaderMaterial) {
      return '#' + (this.orb.getMesh().material as THREE.ShaderMaterial).uniforms.u_primaryColor.value.getHexString();
    }
    return '#58a6ff';
  }

  private loop(): void {
    if (!this.running) return;

    this.animationId = requestAnimationFrame(() => this.loop());

    const now = performance.now() / 1000;
    const delta = now - this.lastTime;
    this.lastTime = now;

    // ── Chibi 模式：只更新骨骼 + 渲染 2D ──
    if (this.useChibi && this.chibi) {
      // 更新骨骼动画
      if (this.skeleton && this.currentGenome) {
        if (this.mouseInside) {
          const normX = (this.mouseX / this.width) * 2 - 1;
          const normY = -((this.mouseY / this.height) * 2 - 1);
          this.skeleton.setAttentionTarget(normX, normY);
        }
        this.skeleton.update(now, this.currentGenome, this.currentMood);
      }
      if (this.facial && this.skeleton) {
        this.facial.update(this.skeleton);
      }
      this.chibi.render(this.skeleton, this.facial, this.currentGenome, this.currentFormProgress);
      return;
    }

    // ── 3D 模式 ──
    // 更新光团
    this.orb.update(delta);

    // 更新人形 mesh + 骨骼动画 + 面部表情
    if (this.activeMesh === 'humanoid' && this.humanoid) {
      this.humanoid.update(delta);

      // 骨骼动画（尾巴/翅膀/耳朵/呼吸/摇摆）
      if (this.skeleton && this.currentGenome) {
        // 更新注意力目标（鼠标位置 → 归一化坐标 -1~1）
        if (this.mouseInside) {
          const normX = (this.mouseX / this.width) * 2 - 1;
          const normY = -((this.mouseY / this.height) * 2 - 1);
          this.skeleton.setAttentionTarget(normX, normY);
        }
        this.skeleton.update(now, this.currentGenome, this.currentMood);
      }

      // 面部表情（眨眼已由 skeleton.update() 内置泊松系统处理）
      if (this.facial && this.skeleton) {
        this.facial.update(this.skeleton);
      }
    }

    // 更新粒子
    this.particles.update(now);

    // 渲染（后处理 or 直接渲染）
    if (this.postProcessing?.isEnabled()) {
      this.postProcessing.render();
    } else {
      this.renderer?.render(this.scene, this.camera);
    }
  }
}
