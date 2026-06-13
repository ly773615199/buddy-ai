/**
 * HumanoidMesh — 程序化人形网格
 *
 * 从球体到人形的连续变形：
 * - 基础：SphereGeometry(1, 64, 32)
 * - 基因参数驱动顶点位移（Vertex Shader via onBeforeCompile）
 * - formProgress 驱动形态调制
 * - SkinnedMesh 绑定骨架
 *
 * 不存储模型文件，运行时从参数生成。
 */

import * as THREE from 'three';
import type { BuddyGenome } from '../../pet/genome';
import type { HumanoidSkeleton } from '../skeleton/humanoid-skeleton';

// ==================== 注入的 Vertex Shader 片段 ====================

const VERTEX_DEFORM = /* glsl */ `
// 基因参数 uniforms
uniform float u_bodyHeight;
uniform float u_bodyWidth;
uniform float u_bodyDepth;
uniform float u_bodyRoundness;
uniform float u_headSize;
uniform float u_earSize;
uniform float u_earAngle;
uniform float u_tailLength;
uniform float u_wingSize;
uniform float u_hornSize;

// 动画 uniforms
uniform float u_time;
uniform float u_breatheSpeed;
uniform float u_swayAmount;

// formProgress 调制
uniform float u_formT;  // 0=球体, 1=完全人形

vec3 deformBuddy(vec3 pos, vec3 norm) {
  float t = u_formT;

  // 1. 身材比例缩放（从 formProgress 20% 开始）
  float bodyT = smoothstep(0.2, 0.8, t);
  pos.y *= mix(1.0, u_bodyHeight, bodyT);
  pos.x *= mix(1.0, u_bodyWidth, bodyT);
  pos.z *= mix(1.0, mix(u_bodyWidth, u_bodyDepth, 0.5), bodyT);

  // 2. 圆润度（从 formProgress 30% 开始）
  float roundT = smoothstep(0.3, 0.9, t);
  float roundFactor = u_bodyRoundness * 0.15 * roundT;
  pos += norm * roundFactor * (1.0 - abs(norm.y) * 0.5);

  // 3. 头身比：头部区域独立缩放（从 formProgress 40% 开始）
  float headT = smoothstep(0.4, 0.9, t);
  float headZone = smoothstep(0.3, 0.8, pos.y);
  pos.y += headZone * (u_headSize - 1.0) * 0.5 * headT;
  pos.xz *= 1.0 + headZone * (u_headSize - 1.0) * 0.3 * headT;

  // 4. 耳朵区域拉伸（从 formProgress 30% 开始）
  float earT = smoothstep(0.3, 0.8, t);
  float earZone = smoothstep(0.5, 1.0, pos.y) * (1.0 - smoothstep(0.0, 0.5, abs(pos.x)));
  vec3 earDir = normalize(vec3(pos.x, 0.8, 0.0));
  pos += earDir * u_earSize * 0.2 * earZone * earT;

  // 5. 尾巴区域拉伸（从 formProgress 35% 开始）
  float tailT = smoothstep(0.35, 0.85, t);
  float tailZone = smoothstep(0.2, -0.8, pos.z) * smoothstep(-0.3, 0.3, pos.y);
  pos.z -= u_tailLength * 0.5 * tailZone * tailT;

  // 6. 翅膀区域扩展（从 formProgress 70% 开始）
  float wingT = smoothstep(0.7, 0.95, t);
  float wingZone = smoothstep(0.2, 0.8, abs(pos.x)) * smoothstep(0.0, 0.5, pos.y);
  pos.x += sign(pos.x) * u_wingSize * 0.3 * wingZone * wingT;

  // 7. 角区域拉伸（从 formProgress 60% 开始）
  float hornT = smoothstep(0.6, 0.9, t);
  float hornZone = smoothstep(0.7, 1.0, pos.y) * (1.0 - smoothstep(0.0, 0.3, abs(pos.x)));
  pos.y += u_hornSize * 0.3 * hornZone * hornT;

  // 8. 呼吸动画
  float breath = sin(u_time * u_breatheSpeed) * 0.02;
  pos.y *= 1.0 + breath;

  // 9. 摇摆动画
  pos.x += sin(u_time * 0.5) * u_swayAmount * 0.02;

  return pos;
}
`;

// ==================== 注入的 Fragment Shader 片段 ====================

const FRAGMENT_DEFORM = /* glsl */ `
uniform vec3 u_primaryColor;
uniform vec3 u_secondaryColor;
uniform float u_patternDensity;
uniform float u_patternStyle;
uniform float u_colorGradient;
uniform float u_glowIntensity;
uniform float u_formT;
uniform float u_time;

// 简单 3D 噪声
float hash3D(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3D(i), hash3D(i + vec3(1,0,0)), f.x),
        mix(hash3D(i + vec3(0,1,0)), hash3D(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3D(i + vec3(0,0,1)), hash3D(i + vec3(1,0,1)), f.x),
        mix(hash3D(i + vec3(0,1,1)), hash3D(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

vec3 buddyColor(vec3 baseColor, vec3 normal, vec3 worldPos, vec2 uv) {
  // 主副色渐变
  float gradient = mix(uv.y, uv.x, u_colorGradient);
  vec3 col = mix(u_primaryColor, u_secondaryColor, gradient * 0.6);

  // 程序化纹路
  float texNoise = noise3D(worldPos * (5.0 + u_patternDensity * 15.0));

  if (u_patternStyle < 0.25) {
    vec2 dotUV = fract(uv * (5.0 + u_patternDensity * 10.0));
    float dot = smoothstep(0.3, 0.35, length(dotUV - 0.5));
    col = mix(u_secondaryColor, col, dot);
  } else if (u_patternStyle < 0.5) {
    float stripe = smoothstep(0.4, 0.5, fract(uv.y * (8.0 + u_patternDensity * 15.0)));
    col = mix(u_secondaryColor, col, stripe);
  } else if (u_patternStyle < 0.75) {
    float ring = smoothstep(0.45, 0.5, fract(length(uv - 0.5) * (6.0 + u_patternDensity * 10.0)));
    col = mix(u_secondaryColor, col, ring);
  } else {
    col = mix(col, u_secondaryColor, texNoise * u_patternDensity * 0.3);
  }

  // Fresnel 边缘发光（早期更强）
  vec3 V = normalize(cameraPosition - worldPos);
  float fresnel = pow(1.0 - max(dot(normalize(normal), V), 0.0), 3.0);
  vec3 fresnelGlow = u_primaryColor * fresnel * u_glowIntensity * 0.3;

  // 情绪发光
  vec3 emission = u_primaryColor * 0.05;

  return col + fresnelGlow + emission;
}
`;

// ==================== 网格类 ====================

export class HumanoidMesh {
  private mesh: THREE.SkinnedMesh;
  private material: THREE.MeshStandardMaterial;
  private time = 0;
  private currentFormT = 0;
  private skeletonBound = false;
  private shaderRef: THREE.WebGLProgram | null = null;

  // 存储 uniform 引用（onBeforeCompile 后设置）
  private uniforms: Record<string, THREE.IUniform> = {};

  constructor(genome: BuddyGenome, primaryColor: string) {
    const geometry = new THREE.SphereGeometry(1, 64, 32);

    // PBR 基础材质 + onBeforeCompile 注入自定义逻辑
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryColor),
      roughness: 0.4,
      metalness: 0.0,
    });

    // 初始 uniforms
    const initUniforms = {
      u_bodyHeight:     { value: genome.bodyHeight },
      u_bodyWidth:      { value: genome.bodyWidth },
      u_bodyDepth:      { value: genome.bodyDepth },
      u_bodyRoundness:  { value: genome.bodyRoundness },
      u_headSize:       { value: genome.headSize },
      u_earSize:        { value: genome.earSize },
      u_earAngle:       { value: genome.earAngle },
      u_tailLength:     { value: genome.tailLength },
      u_wingSize:       { value: genome.wingSize },
      u_hornSize:       { value: genome.hornSize },
      u_time:           { value: 0 },
      u_breatheSpeed:   { value: genome.breatheSpeed },
      u_swayAmount:     { value: genome.swayAmount },
      u_formT:          { value: 0 },
      u_primaryColor:   { value: new THREE.Color(primaryColor) },
      u_secondaryColor: { value: new THREE.Color(genome.secondaryColor) },
      u_patternDensity: { value: genome.patternDensity },
      u_patternStyle:   { value: genome.patternStyle },
      u_colorGradient:  { value: genome.colorGradient },
      u_glowIntensity:  { value: 1.0 },
    };

    this.material.onBeforeCompile = (shader) => {
      // 注入 uniforms
      Object.assign(shader.uniforms, initUniforms);
      this.uniforms = shader.uniforms;
      this.shaderRef = shader.program;

      // 注入 vertex shader：程序化身材变形
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n${VERTEX_DEFORM}`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = deformBuddy(transformed, objectNormal);`,
      );

      // 注入 fragment shader：程序化纹路 + 发光
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n${FRAGMENT_DEFORM}`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = buddyColor(diffuseColor.rgb, vNormal, vWorldPos, vUv);`,
      );
    };

    // SkinnedMesh（骨架后续绑定）
    this.mesh = new THREE.SkinnedMesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /**
   * 绑定骨架到 mesh
   */
  bindSkeleton(skeleton: THREE.Skeleton): void {
    if (this.skeletonBound) return;
    this.mesh.add(skeleton.bones[0]);
    this.mesh.bind(skeleton);
    this.skeletonBound = true;
  }

  /**
   * 每帧更新
   */
  update(deltaTime: number): void {
    this.time += deltaTime;
    if (this.uniforms.u_time) {
      this.uniforms.u_time.value = this.time;
    }
  }

  /**
   * 更新 formProgress（0-100）→ 驱动形态变形
   */
  updateFormProgress(progress: number): void {
    const t = progress / 100;
    this.currentFormT = t;
    if (this.uniforms.u_formT) {
      this.uniforms.u_formT.value = t;
    }
    // 早期发光更强
    if (this.uniforms.u_glowIntensity) {
      this.uniforms.u_glowIntensity.value = Math.max(0, 1 - t);
    }
  }

  /**
   * 更新基因参数（基因变化时调用）
   */
  updateGenome(genome: BuddyGenome): void {
    const u = this.uniforms;
    if (!u.u_bodyHeight) return; // 尚未编译

    u.u_bodyHeight.value = genome.bodyHeight;
    u.u_bodyWidth.value = genome.bodyWidth;
    u.u_bodyDepth.value = genome.bodyDepth;
    u.u_bodyRoundness.value = genome.bodyRoundness;
    u.u_headSize.value = genome.headSize;
    u.u_earSize.value = genome.earSize;
    u.u_earAngle.value = genome.earAngle;
    u.u_tailLength.value = genome.tailLength;
    u.u_wingSize.value = genome.wingSize;
    u.u_hornSize.value = genome.hornSize;
    u.u_breatheSpeed.value = genome.breatheSpeed;
    u.u_swayAmount.value = genome.swayAmount;
    u.u_secondaryColor.value.set(genome.secondaryColor);
    u.u_patternDensity.value = genome.patternDensity;
    u.u_patternStyle.value = genome.patternStyle;
    u.u_colorGradient.value = genome.colorGradient;
  }

  /**
   * 更新颜色
   */
  updateColors(primary: string, secondary?: string): void {
    this.material.color.set(primary);
    if (this.uniforms.u_primaryColor) {
      this.uniforms.u_primaryColor.value.set(primary);
    }
    if (secondary && this.uniforms.u_secondaryColor) {
      this.uniforms.u_secondaryColor.value.set(secondary);
    }
  }

  /**
   * 更新粗糙度/金属度（质感变化时）
   */
  updateMaterialProps(roughness: number, metalness: number): void {
    this.material.roughness = roughness;
    this.material.metalness = metalness;
  }

  getMesh(): THREE.SkinnedMesh {
    return this.mesh;
  }

  getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
