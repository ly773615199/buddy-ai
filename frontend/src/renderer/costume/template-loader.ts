/**
 * TemplateCostumeLoader — glb/fbx 服饰模板加载器
 *
 * 从远程或本地加载 3D 服饰模型，挂载到骨骼。
 * 支持 glTF/GLB（推荐）和 FBX 格式。
 */

import * as THREE from 'three';
import type { BuddyGenome } from '../../pet/genome';

/** 模板服饰配置 */
export interface TemplateCostumeConfig {
  /** 模型 URL（glb/fbx） */
  meshUrl: string;
  /** 贴图 URL（可选，glb 自带贴图时不需要） */
  textureUrl?: string;
  /** 可用的 morph targets（可选） */
  morphTargets?: string[];
  /** 缩放修正（相对于身体比例） */
  scaleCorrection?: number;
}

/** 加载状态 */
type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** 缓存条目 */
interface CacheEntry {
  scene: THREE.Group;
  state: LoadState;
  promise?: Promise<THREE.Group>;
}

// 全局模型缓存（避免重复加载）
const modelCache = new Map<string, CacheEntry>();

// 加载器单例
let gltfLoader: any = null;
let fbxLoader: any = null;

/**
 * 获取 GLTFLoader（懒加载）
 */
async function getGLTFLoader(): Promise<any> {
  if (gltfLoader) return gltfLoader;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  gltfLoader = new GLTFLoader();
  // 可选：DRACOLoader 压缩支持
  try {
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    gltfLoader.setDRACOLoader(draco);
  } catch {
    // DRACOLoader 不可用，跳过
  }
  return gltfLoader;
}

/**
 * 获取 FBXLoader（懒加载）
 */
async function getFBXLoader(): Promise<any> {
  if (fbxLoader) return fbxLoader;
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  fbxLoader = new FBXLoader();
  return fbxLoader;
}

/**
 * 加载 3D 模型（带缓存）
 */
async function loadModel(url: string): Promise<THREE.Group> {
  // 检查缓存
  const cached = modelCache.get(url);
  if (cached?.state === 'loaded') return cached.scene.clone();
  if (cached?.promise) return (await cached.promise).clone();

  // 创建缓存条目
  const entry: CacheEntry = { scene: new THREE.Group(), state: 'loading' };
  modelCache.set(url, entry);

  entry.promise = (async () => {
    try {
      const isFBX = url.toLowerCase().endsWith('.fbx');
      const loader = isFBX ? await getFBXLoader() : await getGLTFLoader();

      return new Promise<THREE.Group>((resolve, reject) => {
        const onLoad = (result: any) => {
          const scene = isFBX ? result as THREE.Group : (result as any).scene as THREE.Group;

          // 遍历所有 mesh，确保材质正确
          scene.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              // 确保材质兼容 PBR 管线
              if (child.material instanceof THREE.MeshBasicMaterial) {
                const old = child.material;
                child.material = new THREE.MeshStandardMaterial({
                  color: old.color,
                  map: old.map,
                  transparent: old.transparent,
                  opacity: old.opacity,
                  side: old.side,
                });
                old.dispose();
              }
            }
          });

          entry.scene = scene;
          entry.state = 'loaded';
          resolve(scene);
        };

        const onError = (err: any) => {
          entry.state = 'error';
          console.warn(`[TemplateCostumeLoader] Failed to load ${url}:`, err);
          reject(err);
        };

        loader.load(url, onLoad, undefined, onError);
      })();
    } catch (err) {
      entry.state = 'error';
      throw err;
    }
  })();

  return (await entry.promise).clone();
}

/**
 * 应用基因参数缩放模板
 */
function applyGeneScale(
  model: THREE.Group,
  genome: BuddyGenome,
  scaleCorrection: number,
): void {
  const baseScale = (genome.bodyHeight + genome.bodyWidth) / 2;
  const finalScale = baseScale * scaleCorrection;
  model.scale.setScalar(finalScale);
}

/**
 * TemplateCostume — 已加载的模板服饰实例
 */
export class TemplateCostume {
  private model: THREE.Group;
  private morphTargets: Map<string, number> = new Map();

  constructor(model: THREE.Group) {
    this.model = model;
  }

  /**
   * 挂载到骨骼
   */
  attachTo(bone: THREE.Bone): void {
    bone.add(this.model);
  }

  /**
   * 从骨骼卸下
   */
  detach(): void {
    this.model.parent?.remove(this.model);
  }

  /**
   * 设置 morph target 权重（如果模型有 morph targets）
   */
  setMorphTarget(name: string, weight: number): void {
    this.morphTargets.set(name, weight);
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.morphTargetInfluences) {
        const dict = child.morphTargetDictionary;
        if (dict && name in dict) {
          child.morphTargetInfluences[dict[name]] = weight;
        }
      }
    });
  }

  /**
   * 更新基因缩放
   */
  updateScale(genome: BuddyGenome, scaleCorrection: number): void {
    applyGeneScale(this.model, genome, scaleCorrection);
  }

  /**
   * 获取内部模型（调试用）
   */
  getModel(): THREE.Group {
    return this.model;
  }

  dispose(): void {
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.model.parent?.remove(this.model);
  }
}

/**
 * 加载模板服饰并创建实例
 */
export async function loadTemplateCostume(
  config: TemplateCostumeConfig,
  genome: BuddyGenome,
): Promise<TemplateCostume> {
  const model = await loadModel(config.meshUrl);

  // 加载外部贴图（如果有）
  if (config.textureUrl) {
    const texLoader = new THREE.TextureLoader();
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      texLoader.load(config.textureUrl!, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.map = texture;
          child.material.needsUpdate = true;
        }
      }
    });
  }

  // 应用基因缩放
  const scaleCorrection = config.scaleCorrection ?? 1.0;
  applyGeneScale(model, genome, scaleCorrection);

  return new TemplateCostume(model);
}

/**
 * 清除模型缓存（内存紧张时调用）
 */
export function clearModelCache(): void {
  modelCache.clear();
}

/**
 * 预加载模型（后台静默加载）
 */
export function preloadModel(url: string): void {
  if (!modelCache.has(url)) {
    loadModel(url).catch(() => {});
  }
}
