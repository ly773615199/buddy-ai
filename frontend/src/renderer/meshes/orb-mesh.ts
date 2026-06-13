/**
 * 光团 mesh — 蛋/孵化阶段的视觉核心
 *
 * Three.js 3D 光团 mesh：
 * - 多层径向渐变模拟发光
 * - Fresnel 边缘发光
 * - 呼吸动画
 * - 副色微光
 */

import * as THREE from 'three';

/** 光团着色器 — 顶点 */
const ORB_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** 光团着色器 — 片段 */
const ORB_FRAGMENT = /* glsl */ `
uniform vec3 u_primaryColor;
uniform vec3 u_secondaryColor;
uniform float u_time;
uniform float u_breathScale;
uniform float u_glowIntensity;
uniform float u_edgeHardness;
uniform float u_secondaryMix;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Fresnel 边缘发光
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // 径向渐变（中心亮，边缘暗）
  float centerGlow = 1.0 - length(vUv - 0.5) * 1.4;
  centerGlow = clamp(centerGlow, 0.0, 1.0);

  // 呼吸脉动
  float pulse = 0.7 + sin(u_time * u_breathScale) * 0.3;

  // 基础颜色
  vec3 baseColor = u_primaryColor;

  // 副色微光（偏移位置）
  float secondaryGlow = smoothstep(0.3, 0.7, length(vUv - vec2(0.55, 0.4)));
  baseColor = mix(baseColor, u_secondaryColor, secondaryGlow * u_secondaryMix * 0.3);

  // 合成
  vec3 center = baseColor * centerGlow * pulse * u_glowIntensity;
  vec3 edge = u_primaryColor * fresnel * u_edgeHardness * pulse * 0.5;
  vec3 ambient = u_primaryColor * 0.08;

  // 中心高光
  float highlight = smoothstep(0.25, 0.0, length(vUv - vec2(0.4, 0.35)));
  vec3 highlightColor = vec3(1.0) * highlight * 0.15 * pulse;

  vec3 finalColor = ambient + center + edge + highlightColor;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export interface OrbParams {
  primaryColor: string;
  secondaryColor?: string;
  breathSpeed: number;    // 来自 temperament
  glowIntensity: number;  // 0-1，早期阶段更强
  edgeHardness: number;   // 来自 texture
  secondaryMix: number;   // 0-1，副色混合度
}

export class OrbMesh {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private time = 0;

  constructor(params: OrbParams) {
    const geometry = new THREE.SphereGeometry(1, 64, 32);

    this.material = new THREE.ShaderMaterial({
      vertexShader: ORB_VERTEX,
      fragmentShader: ORB_FRAGMENT,
      uniforms: {
        u_primaryColor:   { value: new THREE.Color(params.primaryColor) },
        u_secondaryColor: { value: new THREE.Color(params.secondaryColor || params.primaryColor) },
        u_time:           { value: 0 },
        u_breathScale:    { value: params.breathSpeed },
        u_glowIntensity:  { value: params.glowIntensity },
        u_edgeHardness:   { value: params.edgeHardness },
        u_secondaryMix:   { value: params.secondaryMix },
      },
      transparent: false,
      depthWrite: true,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
  }

  /**
   * 每帧更新
   */
  update(deltaTime: number): void {
    this.time += deltaTime;
    this.material.uniforms.u_time.value = this.time;
  }

  /**
   * 更新参数（颜色/阶段变化时）
   */
  updateParams(params: Partial<OrbParams>): void {
    if (params.primaryColor) {
      this.material.uniforms.u_primaryColor.value.set(params.primaryColor);
    }
    if (params.secondaryColor) {
      this.material.uniforms.u_secondaryColor.value.set(params.secondaryColor);
    }
    if (params.breathSpeed !== undefined) {
      this.material.uniforms.u_breathScale.value = params.breathSpeed;
    }
    if (params.glowIntensity !== undefined) {
      this.material.uniforms.u_glowIntensity.value = params.glowIntensity;
    }
    if (params.edgeHardness !== undefined) {
      this.material.uniforms.u_edgeHardness.value = params.edgeHardness;
    }
    if (params.secondaryMix !== undefined) {
      this.material.uniforms.u_secondaryMix.value = params.secondaryMix;
    }
  }

  /**
   * 缩放（呼吸动画由 shader 处理，这里用于拖拽/弹跳等外部缩放）
   */
  setScale(s: number): void {
    this.mesh.scale.setScalar(s);
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
