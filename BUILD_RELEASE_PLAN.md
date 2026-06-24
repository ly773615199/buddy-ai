# Buddy 全平台构建 & 发布 — GitHub Actions 规划

> 目标：推送 tag（如 `v0.2.0`）后自动构建 Windows / macOS / Linux 安装包并发布到 GitHub Release。

---

## 架构总览

```
tag push (v*)
  ├─ build-win      (windows-latest)  → .exe (nsis + portable)
  ├─ build-mac      (macos-latest)    → .dmg
  ├─ build-linux    (ubuntu-latest)   → .AppImage + .deb
  ├─ build-android  (ubuntu-latest)   → .apk + .aab
  ├─ build-ios      (macos-latest)    → .ipa (暂禁用，需 Apple 证书)
  └─ release        (全部完成后)      → 创建 GitHub Release，上传产物
```

## 涉及文件

| 文件 | 用途 |
|------|------|
| `.github/workflows/release.yml` | 主 workflow（7 job） |
| `electron/icon.icns` | macOS 图标（已生成） |
| `electron/entitlements.mac.plist` | macOS 权限声明 |
| `frontend/android/app/build.gradle` | Android 构建配置（动态版本+签名） |
| `frontend/android/app/proguard-rules.pro` | Android 混淆规则 |

---

## 分步计划

### Step 1：基础 release workflow
- 新建 `.github/workflows/release.yml`
- 触发条件：`push tags: v*`
- 3 个平台并行构建（win / mac / linux）
- 不签名、不公证（先跑通）
- 产物上传到 GitHub Release（draft）

### Step 2：修复 electron-builder 配置兼容性
- 当前 `package.json` 的 `build.win` 已修（sign 相关）
- 确认 `build.nsis`、`build.publish` 配置无报错
- 补齐缺失的 `author` 字段

### Step 3：macOS 图标 & 签名准备
- 从 `electron/icon.png` 生成 `icon.icns`
- 添加 `entitlements.mac.plist`
- （签名/公证需要 Apple Developer 证书，暂跳过）

### Step 4：Release 产物整理
- 统一 artifact 命名规则：`Buddy-{version}-{platform}-{arch}.{ext}`
- 生成 SHA256 校验文件
- Release notes 模板

### Step 5：优化
- ✅ Electron 二进制缓存
- ✅ Gradle 缓存
- ✅ 并行构建（5 平台同时跑）
- ✅ Android 版本号自动同步（从 package.json 读取）
- ✅ Android 签名配置（keystore 环境变量）
- ✅ ProGuard 混淆优化
- 失败通知（可选：钉钉/飞书 webhook）

---

## 当前状态

- [x] Step 0：分析项目结构
- [x] **Step 1：基础 release workflow** ✅
- [x] **Step 2：配置兼容性** ✅
- [x] **Step 3：macOS 图标 & 签名准备** ✅
- [x] **Step 4：Release 产物整理** ✅
- [x] **Step 5：优化** ✅
