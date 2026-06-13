/**
 * 后处理管线 — EffectComposer + UnrealBloomPass + SSAOPass
 *
 * v4.0 §6.6
 * 仅 high/webgpu 档启用
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { TierCapabilities } from './detect-tier';

/** 色彩校正 Shader */
const ColorCorrectionShader: THREE.ShaderMaterialParameters & { uniforms: Record<string, THREE.IUniform> } = {
  uniforms: {
    tDiffuse: { value: null },
    brightness: { value: 0.0 },
    contrast: { value: 1.0 },
    saturation: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // 亮度
      color.rgb += brightness;

      // 对比度
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;

      // 饱和度
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(gray), color.rgb, saturation);

      gl_FragColor = color;
    }
  `,
};

export interface PostProcessingConfig {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  ssaoKernelRadius: number;
  ssaoMinDistance: number;
  ssaoMaxDistance: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  bloomStrength: 0.5,
  bloomRadius: 0.4,
  bloomThreshold: 0.85,
  ssaoKernelRadius: 0.5,
  ssaoMinDistance: 0.001,
  ssaoMaxDistance: 0.1,
  brightness: 0.0,
  contrast: 1.0,
  saturation: 1.0,
};

export class PostProcessing {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private colorPass: ShaderPass | null = null;
  private enabled: boolean;
  private config: PostProcessingConfig;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    caps: TierCapabilities,
    config?: Partial<PostProcessingConfig>,
  ) {
    this.enabled = caps.enablePostProcessing;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.enabled) return;

    // 创建 EffectComposer
    this.composer = new EffectComposer(renderer);

    // RenderPass — 基础场景渲染
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // SSAOPass — 环境遮蔽（仅 high/webgpu 档）
    if (caps.enableSSAO) {
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      this.ssaoPass = new SSAOPass(scene, camera, width, height);
      this.ssaoPass.kernelRadius = this.config.ssaoKernelRadius;
      this.ssaoPass.minDistance = this.config.ssaoMinDistance;
      this.ssaoPass.maxDistance = this.config.ssaoMaxDistance;
      this.composer.addPass(this.ssaoPass);
    }

    // UnrealBloomPass — 辉光
    if (caps.enableBloom) {
      const size = new THREE.Vector2();
      renderer.getSize(size);
      this.bloomPass = new UnrealBloomPass(
        size,
        this.config.bloomStrength,
        this.config.bloomRadius,
        this.config.bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
    }

    // 色彩校正
    this.colorPass = new ShaderPass(ColorCorrectionShader);
    this.colorPass.uniforms.brightness.value = this.config.brightness;
    this.colorPass.uniforms.contrast.value = this.config.contrast;
    this.colorPass.uniforms.saturation.value = this.config.saturation;
    this.composer.addPass(this.colorPass);
  }

  /**
   * 渲染一帧
   */
  render(): void {
    if (!this.enabled || !this.composer) return;
    this.composer.render();
  }

  /**
   * 窗口大小变化
   */
  resize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.ssaoPass) {
      this.ssaoPass.setSize(width, height);
    }
  }

  /**
   * 更新 Bloom 参数
   */
  setBloom(strength: number, radius: number, threshold: number): void {
    this.config.bloomStrength = strength;
    this.config.bloomRadius = radius;
    this.config.bloomThreshold = threshold;
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
      this.bloomPass.radius = radius;
      this.bloomPass.threshold = threshold;
    }
  }

  /**
   * 更新色彩校正参数
   */
  setColorCorrection(brightness: number, contrast: number, saturation: number): void {
    this.config.brightness = brightness;
    this.config.contrast = contrast;
    this.config.saturation = saturation;
    if (this.colorPass) {
      this.colorPass.uniforms.brightness.value = brightness;
      this.colorPass.uniforms.contrast.value = contrast;
      this.colorPass.uniforms.saturation.value = saturation;
    }
  }

  /**
   * 动态调整 Bloom 强度（formProgress 驱动）
   * 早期 bloom 更强（光团感），后期减弱
   */
  updateForProgress(progress: number): void {
    const t = progress / 100;
    // 早期强 bloom → 后期弱 bloom
    const strength = 0.3 + (1 - t) * 0.5;
    const threshold = 0.6 + t * 0.25;
    this.setBloom(strength, this.config.bloomRadius, threshold);
  }

  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 销毁
   */
  dispose(): void {
    if (this.composer) {
      this.composer.passes.forEach(pass => {
        if ('dispose' in pass && typeof pass.dispose === 'function') {
          pass.dispose();
        }
      });
      this.composer = null;
    }
    this.bloomPass = null;
    this.ssaoPass = null;
    this.colorPass = null;
  }
}
