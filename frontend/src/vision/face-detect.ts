/**
 * 人脸检测模块
 * 降级链：Shape Detection API → 肤色检测 heuristic → 空
 * 零强制依赖，所有浏览器 guaranteed 可用
 */

export interface FaceDetectionResult {
  faces: DetectedFace[];
  timestamp: number;
  processingMs: number;
}

export interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
  expression?: 'happy' | 'sad' | 'neutral' | 'surprised' | 'angry';
  landmarks?: { x: number; y: number }[];
}

export interface FaceDetectorOptions {
  minConfidence?: number;       // 最低置信度，默认 0.5
  maxFaces?: number;            // 最大检测数，默认 5
  detectExpressions?: boolean;  // 是否检测表情
}

export type FaceDetectionBackend = 'shape_detection' | 'skin_color' | 'cloud' | 'fallback';

export class FaceDetector {
  private backend: FaceDetectionBackend = 'fallback';
  private options: Required<FaceDetectorOptions>;
  private apiKey: string | null = null;

  constructor(options: FaceDetectorOptions = {}) {
    this.options = {
      minConfidence: options.minConfidence ?? 0.5,
      maxFaces: options.maxFaces ?? 5,
      detectExpressions: options.detectExpressions ?? false,
    };
  }

  /** 初始化检测器 — 自动探测最佳后端 */
  async init(backend?: FaceDetectionBackend, apiKey?: string): Promise<void> {
    if (apiKey) this.apiKey = apiKey;

    if (backend) {
      this.backend = backend;
      return;
    }

    // 自动探测：Shape Detection API → 肤色 → fallback
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      this.backend = 'shape_detection';
    } else if (typeof document !== 'undefined') {
      this.backend = 'skin_color';
    } else {
      this.backend = 'fallback';
    }
  }

  /** 从 base64 图片检测人脸 */
  async detect(base64Image: string): Promise<FaceDetectionResult> {
    const startMs = Date.now();

    let faces: DetectedFace[];

    switch (this.backend) {
      case 'shape_detection':
        faces = await this._detectWithShapeAPI(base64Image);
        break;
      case 'skin_color':
        faces = await this._detectWithSkinColor(base64Image);
        break;
      case 'cloud':
        faces = await this._detectWithCloud(base64Image);
        break;
      default:
        faces = [];
    }

    // 过滤低置信度
    faces = faces.filter(f => f.confidence >= this.options.minConfidence);
    faces = faces.slice(0, this.options.maxFaces);

    return {
      faces,
      timestamp: Date.now(),
      processingMs: Date.now() - startMs,
    };
  }

  /** 从视频元素检测 */
  async detectFromVideo(video: HTMLVideoElement): Promise<FaceDetectionResult> {
    if (video.readyState < 2) {
      return { faces: [], timestamp: Date.now(), processingMs: 0 };
    }

    // Shape Detection API 可以直接接受 video 元素
    if (this.backend === 'shape_detection' && typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        const detector = new (window as any).FaceDetector({ maxDetectedFaces: this.options.maxFaces });
        const results = await detector.detect(video);
        const faces: DetectedFace[] = results.map((r: any) => ({
          boundingBox: {
            x: r.boundingBox.x,
            y: r.boundingBox.y,
            width: r.boundingBox.width,
            height: r.boundingBox.height,
          },
          confidence: 0.9,
        }));
        return {
          faces: faces.filter(f => f.confidence >= this.options.minConfidence),
          timestamp: Date.now(),
          processingMs: 0,
        };
      } catch {
        // Shape Detection 对 video 失败，降级到 canvas 截图
      }
    }

    // 降级：截取 canvas 再检测
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { faces: [], timestamp: Date.now(), processingMs: 0 };

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    return this.detect(base64);
  }

  /** 检查是否可用 */
  isAvailable(): boolean {
    return true; // fallback 总是可用（最差返回空数组）
  }

  /** 获取当前后端 */
  getBackend(): FaceDetectionBackend {
    return this.backend;
  }

  /** 清理 */
  destroy(): void {
    // 无需清理，Shape Detection API 无状态
  }

  // ==================== 后端实现 ====================

  /**
   * Shape Detection API — 浏览器原生，Chrome/Edge 支持
   * https://wicg.github.io/shape-detection-api/
   */
  private async _detectWithShapeAPI(base64: string): Promise<DetectedFace[]> {
    try {
      const img = await this._base64ToImage(base64);
      const detector = new (window as any).FaceDetector({
        maxDetectedFaces: this.options.maxFaces,
      });
      const results = await detector.detect(img);

      return results.map((r: any) => ({
        boundingBox: {
          x: r.boundingBox.x,
          y: r.boundingBox.y,
          width: r.boundingBox.width,
          height: r.boundingBox.height,
        },
        confidence: 0.9,
        landmarks: r.landmarks?.map((l: any) => ({ x: l.locations[0].x, y: l.locations[0].y })),
      }));
    } catch {
      // Shape Detection API 调用失败，降级到肤色检测
      return this._detectWithSkinColor(base64);
    }
  }

  /**
   * 肤色检测 heuristic — 纯 Canvas 像素分析，零依赖
   * 基于 YCbCr 色彩空间的肤色聚类，简单但 guaranteed 可用
   */
  private async _detectWithSkinColor(base64: string): Promise<DetectedFace[]> {
    try {
      const img = await this._base64ToImage(base64);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 降采样加速（每 4 像素采样一次）
      const step = 4;
      const skinPixels: Array<{ x: number; y: number }> = [];

      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          const i = (y * canvas.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];

          // YCbCr 肤色检测
          if (this._isSkinColor(r, g, b)) {
            skinPixels.push({ x, y });
          }
        }
      }

      if (skinPixels.length < 20) return [];

      // 简单聚类：找连通区域作为人脸候选
      return this._clusterSkinRegions(skinPixels, canvas.width, canvas.height, step);
    } catch {
      return [];
    }
  }

  /**
   * YCbCr 色彩空间肤色判定
   * 基于经典肤色模型，适合多种肤色
   */
  private _isSkinColor(r: number, g: number, b: number): boolean {
    // RGB → YCbCr
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.169 * r - 0.331 * g + 0.500 * b;
    const cr = 128 + 0.500 * r - 0.419 * g - 0.081 * b;

    // 肤色范围（宽松阈值，覆盖多种肤色）
    return cr > 133 && cr < 173 && cb > 77 && cb < 127 && y > 80;
  }

  /**
   * 简单连通区域聚类 — 将肤色像素聚类为矩形区域
   * 使用网格化 + flood fill，性能优于逐像素聚类
   */
  private _clusterSkinRegions(
    pixels: Array<{ x: number; y: number }>,
    imgWidth: number,
    imgHeight: number,
    step: number,
  ): DetectedFace[] {
    // 创建网格标记
    const gridW = Math.ceil(imgWidth / step);
    const gridH = Math.ceil(imgHeight / step);
    const grid = new Uint8Array(gridW * gridH);

    for (const p of pixels) {
      const gx = Math.floor(p.x / step);
      const gy = Math.floor(p.y / step);
      grid[gy * gridW + gx] = 1;
    }

    // 找连通区域
    const visited = new Uint8Array(gridW * gridH);
    const regions: Array<{ minX: number; minY: number; maxX: number; maxY: number; count: number }> = [];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (grid[idx] === 0 || visited[idx]) continue;

        // BFS flood fill
        const queue = [idx];
        visited[idx] = 1;
        let minX = gx, maxX = gx, minY = gy, maxY = gy, count = 0;

        while (queue.length > 0) {
          const ci = queue.pop()!;
          const cx = ci % gridW;
          const cy = Math.floor(ci / gridW);
          count++;
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);

          // 4-连通邻居
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const ni = ny * gridW + nx;
            if (grid[ni] === 0 || visited[ni]) continue;
            visited[ni] = 1;
            queue.push(ni);
          }
        }

        // 过滤太小的区域（噪声）
        if (count >= 10) {
          regions.push({ minX, minY, maxX, maxY, count });
        }
      }
    }

    // 按面积排序，取最大的几个
    regions.sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));

    return regions.slice(0, this.options.maxFaces).map(r => ({
      boundingBox: {
        x: r.minX * step,
        y: r.minY * step,
        width: (r.maxX - r.minX + 1) * step,
        height: (r.maxY - r.minY + 1) * step,
      },
      confidence: Math.min(0.8, 0.4 + r.count * 0.01), // 基于像素数量的置信度
    }));
  }

  /** 云端检测（可选，需 API Key） */
  private async _detectWithCloud(base64: string): Promise<DetectedFace[]> {
    if (!this.apiKey) return [];

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Detect all faces in this image. Return JSON array with: {x, y, width, height, confidence, expression}. Only return valid JSON, no markdown.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          }],
          max_tokens: 500,
        }),
      });

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '[]';
      const parsed = JSON.parse(content.replace(/```json\n?|```/g, ''));

      return Array.isArray(parsed) ? parsed.map((f: any) => ({
        boundingBox: { x: f.x ?? 0, y: f.y ?? 0, width: f.width ?? 0, height: f.height ?? 0 },
        confidence: f.confidence ?? 0.7,
        expression: f.expression,
      })) : [];
    } catch {
      return [];
    }
  }

  private _base64ToImage(base64: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  }
}
