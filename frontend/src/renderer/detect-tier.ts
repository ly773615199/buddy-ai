/**
 * GPU 能力检测 + WebGPU 渲染器创建
 *
 * 5 档降级：
 *   webgpu  → WebGPU 渲染器 + 全部后处理
 *   high    → WebGL2 + Bloom + SSAO + 完整粒子
 *   medium  → WebGL2 + Bloom + 简化粒子
 *   low     → WebGL1 + 无后处理 + 最少粒子
 *   fallback → Canvas2D（emoji 兜底）
 */

export type RenderTier = 'webgpu' | 'high' | 'medium' | 'low' | 'fallback';

export interface TierCapabilities {
  tier: RenderTier;
  maxParticles: number;
  meshResolution: number;    // SphereGeometry 细分 (segments × rings)
  enablePostProcessing: boolean;
  enableSSAO: boolean;
  enableBloom: boolean;
  enableShadows: boolean;
  useWebGPU: boolean;
}

const TIER_PRESETS: Record<RenderTier, TierCapabilities> = {
  webgpu: {
    tier: 'webgpu',
    maxParticles: 200,
    meshResolution: 64,
    enablePostProcessing: true,
    enableSSAO: true,
    enableBloom: true,
    enableShadows: true,
    useWebGPU: true,
  },
  high: {
    tier: 'high',
    maxParticles: 150,
    meshResolution: 64,
    enablePostProcessing: true,
    enableSSAO: true,
    enableBloom: true,
    enableShadows: true,
    useWebGPU: false,
  },
  medium: {
    tier: 'medium',
    maxParticles: 80,
    meshResolution: 32,
    enablePostProcessing: true,
    enableSSAO: false,
    enableBloom: true,
    enableShadows: false,
    useWebGPU: false,
  },
  low: {
    tier: 'low',
    maxParticles: 30,
    meshResolution: 16,
    enablePostProcessing: false,
    enableSSAO: false,
    enableBloom: false,
    enableShadows: false,
    useWebGPU: false,
  },
  fallback: {
    tier: 'fallback',
    maxParticles: 0,
    meshResolution: 0,
    enablePostProcessing: false,
    enableSSAO: false,
    enableBloom: false,
    enableShadows: false,
    useWebGPU: false,
  },
};

/**
 * 检测当前设备的 GPU 能力，返回渲染档次
 */
export async function detectRenderTier(): Promise<RenderTier> {
  // 1. WebGPU 检测
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        if (device) {
          device.destroy();
          return 'webgpu';
        }
      }
    } catch {
      // WebGPU 不可用，继续 fallback
    }
  }

  // 2. WebGL 检测
  if (typeof document === 'undefined') return 'fallback';

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  // WebGL2 优先
  const gl2 = canvas.getContext('webgl2');
  if (gl2) {
    const maxTexSize = gl2.getParameter(gl2.MAX_TEXTURE_SIZE);
    const maxRenderbufferSize = gl2.getParameter(gl2.MAX_RENDERBUFFER_SIZE);
    const floatExt = gl2.getExtension('EXT_color_buffer_float');
    const maxVertUniforms = gl2.getParameter(gl2.MAX_VERTEX_UNIFORM_VECTORS);

    if (maxTexSize >= 4096 && maxRenderbufferSize >= 4096 && floatExt && maxVertUniforms >= 256) {
      cleanup(gl2, canvas);
      return 'high';
    }

    if (maxTexSize >= 2048) {
      cleanup(gl2, canvas);
      return 'medium';
    }

    cleanup(gl2, canvas);
    return 'low';
  }

  // WebGL1
  const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (gl1) {
    cleanup(gl1 as WebGLRenderingContext, canvas);
    return 'low';
  }

  return 'fallback';
}

/**
 * 获取指定档次的能力参数
 */
export function getTierCapabilities(tier: RenderTier): TierCapabilities {
  return { ...TIER_PRESETS[tier] };
}

/**
 * 获取当前设备的渲染能力（一步到位）
 */
export async function detectCapabilities(): Promise<TierCapabilities> {
  const tier = await detectRenderTier();
  return getTierCapabilities(tier);
}

/**
 * 创建渲染器 — 优先 WebGPU，fallback 到 WebGL
 * 返回 { renderer, isWebGPU }
 */
export async function createRenderer(params: {
  container: HTMLElement;
  width: number;
  height: number;
  tier: RenderTier;
  antialias: boolean;
  pixelRatio: number;
}): Promise<{ renderer: any; isWebGPU: boolean }> {
  const { width, height, tier, antialias, pixelRatio } = params;

  // WebGPU 渲染器
  if (tier === 'webgpu') {
    try {
      const { default: WebGPURenderer } = await import('three/src/renderers/webgpu/WebGPURenderer.js');
      const renderer = new WebGPURenderer({ antialias, alpha: true });
      await renderer.init();
      renderer.setSize(width, height);
      renderer.setPixelRatio(pixelRatio);
      renderer.setClearColor(0x0d1117, 0);
      renderer.outputColorSpace = (await import('three')).SRGBColorSpace;
      renderer.toneMapping = (await import('three')).ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      return { renderer, isWebGPU: true };
    } catch {
      // WebGPU 创建失败，降级到 WebGL
    }
  }

  // WebGL 渲染器
  const THREE = await import('three');
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias,
    powerPreference: tier === 'high' ? 'high-performance' : 'default',
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x0d1117, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  if (tier !== 'low') {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  return { renderer, isWebGPU: false };
}

function cleanup(gl: WebGLRenderingContext | WebGL2RenderingContext, canvas: HTMLCanvasElement): void {
  const ext = gl.getExtension('WEBGL_lose_context');
  if (ext) ext.loseContext();
  canvas.remove();
}

// ==================== Canvas2D Fallback ====================

/**
 * Canvas2D 兜底渲染器 — 当 WebGL 不可用时使用
 */
export class Canvas2DFallback {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }> = [];
  private running = false;
  private animId = 0;
  private time = 0;
  private primaryColor: string;
  private secondaryColor: string;
  private breathSpeed: number;

  constructor(
    container: HTMLElement,
    width: number,
    height: number,
    primaryColor: string,
    secondaryColor: string,
    temperament: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.primaryColor = primaryColor;
    this.secondaryColor = secondaryColor || primaryColor;
    this.breathSpeed = temperament === 'lively' ? 0.04 : temperament === 'calm' ? 0.015 : 0.025;
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

  updateProgress(_progress: number): void {}

  updateColors(primary: string, secondary?: string): void {
    this.primaryColor = primary;
    this.secondaryColor = secondary || primary;
  }

  onClick(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        life: 40 + Math.random() * 30,
        size: 2 + Math.random() * 3,
      });
    }
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  dispose(): void {
    this.stop();
    this.canvas.remove();
  }

  private loop(): void {
    if (!this.running) return;
    this.animId = requestAnimationFrame(() => this.loop());
    this.time += 0.016;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    const breathScale = 1 + Math.sin(this.time * this.breathSpeed * 60) * 0.08;
    const baseRadius = Math.min(w, h) * 0.25 * breathScale;

    const layers = [
      { radius: baseRadius * 1.8, alpha: 0.05 },
      { radius: baseRadius * 1.4, alpha: 0.1 },
      { radius: baseRadius * 1.1, alpha: 0.2 },
      { radius: baseRadius * 0.8, alpha: 0.6 },
      { radius: baseRadius * 0.5, alpha: 1.0 },
    ];

    for (const layer of layers) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, layer.radius);
      grad.addColorStop(0, this.colorWithAlpha(this.primaryColor, layer.alpha));
      grad.addColorStop(0.6, this.colorWithAlpha(this.secondaryColor, layer.alpha * 0.5));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, layer.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.02;
      p.life--;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      const alpha = p.life / 70;
      ctx.fillStyle = this.colorWithAlpha(this.primaryColor, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / 70), 0, Math.PI * 2);
      ctx.fill();
    }

    if (Math.random() < 0.3) {
      const angle = Math.random() * Math.PI * 2;
      const dist = baseRadius * (0.5 + Math.random() * 0.8);
      this.particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.5 - Math.random() * 0.5,
        life: 50 + Math.random() * 40,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  private colorWithAlpha(hex: string, alpha: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
