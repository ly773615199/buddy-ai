# Buddy 前端依赖问题清理

> 两个问题，一个配置修复，一个代码修复。

---

## 问题 1：`sharp` 不应在 frontend dependencies 中

### 现状

```json
// frontend/package.json
"dependencies": {
  "sharp": "^0.34.5",  // ❌ Node.js C++ native addon
}
```

- `sharp` 是 Node.js 原生模块（C++ binding），**在浏览器中完全无法运行**
- 前端代码中唯一引用：`frontend/src/vision/privacy.ts` 第 166 行，动态导入
- vite.config.ts 已标记为 `external`，浏览器构建时不打包
- 运行时 `import('sharp')` 会失败（代码中已处理失败情况，返回原图）
- 根 `package.json`（后端）中**没有** sharp

### 修复

**文件 1**：`frontend/package.json`

```diff
  "dependencies": {
    "@rolldown/binding-linux-x64-gnu": "^1.0.0-rc.18",
    "@tanstack/react-virtual": "^3.13.24",
    "highlight.js": "^11.11.1",
    "i18next": "^26.0.6",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-i18next": "^17.0.4",
    "seedrandom": "^3.0.5",
-   "sharp": "^0.34.5",
    "tesseract.js": "^7.0.0",
    "three": "^0.170.0"
  },
```

**文件 2**：`frontend/src/vision/privacy.ts`（可选，代码已处理失败）

现状已安全，动态导入有 try-catch 降级：

```typescript
// 第 166 行（现状，不需改动）
try {
  const sharp = (await import('sharp' as string)) as any;
  // ... 像素化处理 ...
} catch {
  // sharp 未安装或操作失败，返回原图
  return input;
}
```

可选优化：用 Canvas API 替代 sharp，实现前端原生像素化：

```typescript
// 替代方案：纯 Canvas 像素化（浏览器原生，无依赖）
private async pixelateWithCanvas(input: Buffer, region: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const img = await createImageFromBuffer(input);

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  // 像素化：缩小再放大
  const pixelSize = 10;
  const { x, y, w, h } = region;
  const sw = Math.max(1, Math.ceil(w / pixelSize));
  const sh = Math.max(1, Math.ceil(h / pixelSize));

  // 从原图取区域 → 缩小
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);

  // 放回原位（放大 → 像素化效果）
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, sw, sh, x, y, w, h);

  return canvasToBuffer(canvas);
}
```

---

## 问题 2：`tesseract.js` 在 external 中但仍在 dependencies 中

### 现状

```json
// frontend/package.json
"dependencies": {
  "tesseract.js": "^7.0.0",  // ✅ 浏览器兼容库
}

// frontend/vite.config.ts
build: {
  rollupOptions: {
    external: ['sharp', 'tesseract.js'],  // ❌ 被排除，不会打包
  },
},
ssr: {
  external: ['sharp', 'tesseract.js'],
},
```

**矛盾**：
- `dependencies` 声明了 → 说明想用
- `external` 排除了 → 构建时不会打包进产物
- 浏览器运行时 `import('tesseract.js')` 找不到模块（没有通过 CDN 加载）

### tesseract.js 的浏览器兼容性

`tesseract.js` 是**纯浏览器库**（WASM + Web Worker），完全可以在浏览器中运行。它被标记为 `external` 是错误的。

### 修复

**文件**：`frontend/vite.config.ts`

```diff
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
-     external: ['sharp', 'tesseract.js'],
+     external: ['sharp'],
    },
  },
  ssr: {
-   external: ['sharp', 'tesseract.js'],
+   external: ['sharp'],
  },
```

修改后：
- `sharp`：保持 external（Node.js native，浏览器不可用）
- `tesseract.js`：从 external 移除，vite 会把它打包进产物
- SSR 场景下 `sharp` 仍然从 node_modules 外部加载

### 验证

```bash
cd frontend
npm run build
# 检查 dist/assets/ 中是否包含 tesseract 相关 chunk
ls -la dist/assets/ | grep -i tesseract
```

---

## 总结

| 问题 | 文件 | 改动 | 风险 |
|---|---|---|---|
| sharp 误入 frontend deps | `frontend/package.json` | 删除一行 | 无（代码已有降级） |
| tesseract.js 被 external | `frontend/vite.config.ts` | 移除一个词 | 低（浏览器库，本应打包） |

---

## 问题 3：`@rolldown/binding-linux-x64-gnu` 误入 frontend dependencies

### 现状

```json
// frontend/package.json
"dependencies": {
  "@rolldown/binding-linux-x64-gnu": "^1.0.0-rc.18",  // ❌ 平台特定 native binding
}
```

- Vite 8 使用 Rolldown（Rust bundler），此包是其 Linux x64 平台的原生绑定
- 前端源码中零引用
- 平台特定：仅 Linux x64，在 macOS/Windows 上会安装失败
- 应由 vite 自动管理为 optional dependency，不应手动声明

### 修复

从 `frontend/package.json` 删除。

---

## 问题 4：`seedrandom` 误入 frontend dependencies

### 现状

```json
// frontend/package.json
"dependencies": {
  "seedrandom": "^3.0.5",  // ❌ 前端未使用
}
```

- 前端源码中零引用
- 仅在后端 `src/pet/genome.ts` 中使用
- 根 `package.json`（后端）中已有 `seedrandom`

### 修复

从 `frontend/package.json` 删除（后端已有）。

---

## 问题 5：`@esbuild/linux-x64` 误入根 devDependencies

### 现状

```json
// 根 package.json
"devDependencies": {
  "@esbuild/linux-x64": "^0.27.7",  // ❌ 平台特定 native binding
}
```

- esbuild 的 Linux x64 平台原生绑定
- 后端源码中零引用
- 平台特定：仅 Linux x64
- 应由 esbuild 自动管理为 optional dependency

### 修复

从根 `package.json` 删除。

---

## 总结

| 问题 | 文件 | 改动 | 风险 |
|---|---|---|---|
| sharp 误入 frontend deps | `frontend/package.json` | 删除一行 | 无（代码已有降级） |
| tesseract.js 被 external | `frontend/vite.config.ts` | 移除一个词 | 低（浏览器库，本应打包） |
| @rolldown/binding 误入 | `frontend/package.json` | 删除一行 | 无（vite 自动管理） |
| seedrandom 误入 | `frontend/package.json` | 删除一行 | 无（后端已有） |
| @esbuild/linux-x64 误入 | `package.json` | 删除一行 | 无（esbuild 自动管理） |

**总改动量**：3 个文件，共删除 5 行。
