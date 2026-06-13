# Buddy 隐私合规 & 训练数据管线 详细计划

> 生成日期：2026-05-10
> 状态：待执行

---

## 一、现状分析

### 1.1 当前代码问题

| 问题 | 位置 | 严重度 |
|------|------|--------|
| sharp 作为脱敏手段，但环境装不上 | `frontend/src/vision/privacy.ts:166` | 高 |
| 训练管线脱敏位置错误（应在发布时，不在训练时） | `training-exporter.ts` | 高 |
| 人脸检测全链路可选依赖，无 guaranteed 实现 | `face-detect.ts` | 中 |
| 无隐私政策文档 | 项目根目录 | 高 |
| 无数据处理记录文档 | 项目根目录 | 高 |
| 无 DPIA 文档 | 项目根目录 | 中 |
| 亲密度系统与合规系统未打通 | `src/perception/privacy.ts` (deprecated) | 中 |

### 1.2 现有可用基础设施

| 组件 | 状态 | 可用 |
|------|------|------|
| 亲密度/信任度体系 | 已实现 | ✅ |
| 审计日志 (`audit`) | 已实现 | ✅ |
| 帧数据自动过期 (5min) | 已实现 | ✅ |
| 隐私模式 toggle | 已实现 | ✅ |
| REST API `/api/privacy` | 已实现 | ✅ |
| 状态指示器框架 | 已实现 | ✅ |
| 文本脱敏 (path/IP/email/token) | 已实现 | ✅ |

---

## 二、合规框架（对外法律合规）

### 2.1 适用法规清单

| 法规 | 地域 | 对 Buddy 的要求 |
|------|------|----------------|
| 《个人信息保护法》(PIPL) | 中国 | 人脸=敏感信息，需单独同意、最小范围、最短留存 |
| 最高法人脸识别司法解释(2021) | 中国 | 不能捆绑授权，需替代方案 |
| 《数据安全法》 | 中国 | 数据分类分级，重要数据评估 |
| GDPR | 欧盟 | 生物识别=特殊类别，DPIA，删除权，Privacy by Design |
| EU AI Act (2024) | 欧盟 | 情绪识别=高风险AI，需透明度+人类监督 |
| Apple App Store 隐私标签 | 全球 | 必须声明摄像头、麦克风、生物识别数据采集 |
| Google Play 数据安全声明 | 全球 | 必须声明数据类型、用途、是否共享 |

### 2.2 合规交付物清单

#### 文档层（对外必备）

| # | 文档 | 内容 | 优先级 |
|---|------|------|--------|
| C1 | 隐私政策 (Privacy Policy) | 数据类型、用途、留存、权利、联系方式 | P0 |
| C2 | 数据处理记录 (ROPA) | 处理活动清单、法律依据、跨境传输 | P0 |
| C3 | DPIA 报告 | 风险评估、缓解措施（EU AI Act 要求） | P1 |
| C4 | Cookie/传感器声明 | 摄像头、麦克风、位置传感器使用说明 | P1 |
| C5 | 第三方处理者清单 | 用了哪些云API、数据传给谁 | P0 |
| C6 | 数据主体权利行使指南 | 用户如何查询、导出、删除数据 | P1 |

#### 产品层（用户可感知）

| # | 功能 | 说明 | 优先级 |
|---|------|------|--------|
| P1 | 隐私设置面板 | 查看/管理所有隐私相关设置 | P0 |
| P2 | 数据导出 | 用户可导出自己的所有数据 | P1 |
| P3 | 数据删除 | 一键删除所有个人数据 | P0 |
| P4 | 传感器状态指示 | 摄像头/麦克风开启时可见指示 | P0 |
| P5 | 处理透明度 | 显示"正在分析"等状态 | P1 |
| P6 | 第三方传输提示 | 数据发送到云端时告知 | P1 |

#### 技术层（后台实现）

| # | 技术点 | 说明 | 优先级 |
|---|--------|------|--------|
| T1 | 帧数据不落盘 | 分析完即丢，不写磁盘 | P0 |
| T2 | 自动过期机制 | 已有 5min，需确保所有路径覆盖 | P0 |
| T3 | 删除接口 | `DELETE /api/privacy/data` 删除所有用户数据 | P0 |
| T4 | 审计日志完善 | 记录所有数据采集/传输/处理事件 | P1 |
| T5 | 第三方 API 调用脱敏 | 发送到云端前剥离可识别信息 | P1 |
| T6 | App Store 隐私标签配置 | Info.plist / manifest 声明 | P1 |

---

## 三、技术改造方案

### 3.1 删除 sharp 依赖

**范围：**
- `frontend/src/vision/privacy.ts` — `anonymizeFrameAsync` 方法
- `frontend/vite.config.ts` — `rollupOptions.external` 和 `ssr.external`

**操作：**
1. 删除 `anonymizeFrameAsync` 中的 sharp 调用
2. 删除 vite.config.ts 中的 sharp external 配置
3. `anonymizeFrame` 同步方法保留，改为纯 Canvas 实现（见 3.2）

### 3.2 纯 Canvas 人脸区域处理（用于本地预览）

**场景：** VisionPanel 中用户预览摄像头画面时的隐私显示

**方案：** Canvas 2D `drawImage` 缩放像素化
```ts
// 纯 Canvas 像素化 — 无任何外部依赖
function pixelateRegion(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; width: number; height: number },
  blockSize: number = 8
): void {
  const { x, y, width, height } = region;
  const imageData = ctx.getImageData(x, y, width, height);
  const data = imageData.data;

  for (let py = 0; py < height; py += blockSize) {
    for (let px = 0; px < width; px += blockSize) {
      // 采样块内平均色
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = 0; dy < blockSize && py + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && px + dx < width; dx++) {
          const i = ((py + dy) * width + (px + dx)) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      // 填充块
      for (let dy = 0; dy < blockSize && py + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && px + dx < width; dx++) {
          const i = ((py + dy) * width + (px + dx)) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, x, y);
}
```

**特点：** 零依赖、纯 JS、可测试、浏览器/Node Canvas 通用

### 3.3 浏览器原生 FaceDetector（替换 TF.js）

**方案：** 使用 Shape Detection API 的 `FaceDetector`

```ts
// 浏览器原生，零依赖
if ('FaceDetector' in window) {
  const detector = new FaceDetector({ maxDetectedFaces: 5 });
  const faces = await detector.detect(imageElement);
  // faces[i].boundingBox → { x, y, width, height }
}
```

**降级链：**
1. Shape Detection API（Chrome/Edge 原生）→ 零依赖
2. 简单肤色检测 heuristic → 纯 Canvas
3. 无检测 → 返回空（不阻塞功能）

### 3.4 训练管线调整

**原则：** 训练不脱敏，发布时脱敏

```
当前（错误）：
  经验数据 → anonymizeContent → 训练 → 模型
  （训练时脱敏，降低质量）

调整后（正确）：
  经验数据 → 直接训练 → 模型（本地，不脱敏）
  模型 → 发布前审查 → 脱敏处理 → 商城上架
```

**具体改动：**
1. `training-exporter.ts` — 保留文本脱敏（path/IP/email/token），这是基本安全卫生
2. `lora/service.ts` — 保留文本脱敏，同上
3. **新增**：商城发布管线的图像/经验脱敏（见 3.5）

### 3.5 商城发布脱敏管线

**新增模块：** `src/shop/publish-sanitizer.ts`

```
发布流程：
  1. 模型/技能打包
  2. 扫描嵌入数据：
     - 文本中的 PII（路径/IP/邮箱/token/用户名） → 已有 anonymizeContent
     - 经验数据中的图像帧 → 像素化或丢弃
     - 对话记录中的个人信息 → 脱敏
  3. 生成脱敏报告
  4. 上架
```

**数据分类：**

| 数据类型 | 本地训练 | 商城发布 |
|---------|---------|---------|
| 对话文本 | 保留 | 脱敏 PII |
| 经验知识 | 保留 | 脱敏 PII |
| 图像帧 | 保留 | 丢弃或像素化 |
| 用户名/ID | 保留 | 替换为匿名 ID |
| 人格配置 | 保留 | 保留（非 PII） |
| 技能代码 | 保留 | 保留（非 PII） |

---

## 四、隐私政策框架（草案）

### 4.1 数据采集声明

```
Buddy 采集以下类型的数据：

┌─────────────┬──────────────┬────────────┬──────────────┐
│ 数据类型     │ 用途          │ 存储位置    │ 保留期限      │
├─────────────┼──────────────┼────────────┼──────────────┤
│ 对话内容     │ AI 对话       │ 本地设备    │ 用户控制     │
│ 摄像头画面   │ 场景理解      │ 不存储*     │ 分析后即丢   │
│ 麦克风音频   │ 语音交互      │ 不存储*     │ 识别后即丢   │
│ 位置信息     │ 环境感知      │ 本地设备    │ 用户控制     │
│ 人脸信息     │ 表情感知      │ 不存储      │ 分析后即丢   │
│ 情绪数据     │ 个性化交互    │ 本地设备    │ 用户控制     │
│ 使用统计     │ 产品改进      │ 匿名聚合    │ 90 天        │
└─────────────┴──────────────┴────────────┴──────────────┘

* 仅在用户明确启用"训练数据贡献"时，经脱敏处理后存储
```

### 4.2 用户权利

```
您有权：
✅ 知道 Buddy 采集了什么数据（隐私面板查看）
✅ 随时关闭任何传感器（摄像头/麦克风/位置）
✅ 导出您的所有数据（JSON 格式）
✅ 删除您的所有数据（一键清除）
✅ 撤回任何授权（即时生效）
✅ 获得数据处理的透明报告
```

### 4.3 第三方披露

```
Buddy 可能与以下第三方服务交互：

┌──────────────┬──────────────┬──────────────┐
│ 服务          │ 传输数据      │ 用途          │
├──────────────┼──────────────┼──────────────┤
│ LLM API      │ 对话文本      │ AI 推理       │
│ (用户配置)    │ (不含图像)    │              │
├──────────────┼──────────────┼──────────────┤
│ 语音识别 API  │ 音频片段      │ STT          │
│ (用户配置)    │              │              │
├──────────────┼──────────────┼──────────────┤
│ 商城服务      │ 脱敏后的模型  │ 技能分享      │
│              │ 和技能数据    │              │
└──────────────┴──────────────┴──────────────┘

所有第三方传输均需用户明确启用，可随时关闭。
```

---

## 五、App Store 合规配置

### 5.1 Apple App Store 隐私标签

```xml
<!-- Info.plist -->
<key>NSCameraUsageDescription</key>
<string>Buddy 使用摄像头来理解你周围的环境，提供更智能的陪伴</string>
<key>NSMicrophoneUsageDescription</key>
<string>Buddy 使用麦克风来听取你的语音指令和对话</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Buddy 使用位置信息来感知你的环境上下文</string>
```

**隐私标签声明：**
- Data Used to Track You: None
- Data Linked to You: None
- Data Not Linked to You: Usage Data (匿名)

### 5.2 Google Play 数据安全声明

```
数据类型：          摄像头画面、麦克风音频、位置
数据用途：          AI 功能（本地处理）
是否共享：          否（除非用户启用云服务）
是否加密：          是
数据可删除：        是
```

---

## 六、实施计划

### Phase 1: 基础合规（P0，1-2 周）

| 任务 | 文件 | 说明 |
|------|------|------|
| 删除 sharp 依赖 | `privacy.ts`, `vite.config.ts` | 清理不可用依赖 |
| 实现纯 Canvas 像素化 | `privacy.ts` | 替换 sharp 的本地预览脱敏 |
| 实现原生 FaceDetector | `face-detect.ts` | 替换 TF.js 依赖 |
| 数据删除接口 | `ws-handler.ts` | `DELETE /api/privacy/data` |
| 帧数据不落盘确认 | `privacy.ts` | 确保内存处理、不写磁盘 |
| 隐私政策文档 | `PRIVACY_POLICY.md` | 对外必备 |
| 隐私设置面板 | `Settings.tsx` | 用户可管理隐私 |

### Phase 2: 商城合规（P1，2-3 周）

| 任务 | 文件 | 说明 |
|------|------|------|
| 商城发布脱敏管线 | `src/shop/publish-sanitizer.ts` | PII 扫描+脱敏+报告 |
| 图像帧处理策略 | `publish-sanitizer.ts` | 发布时丢弃或像素化 |
| DPIA 文档 | `DPIA.md` | EU AI Act 要求 |
| 第三方处理者清单 | `DATA_PROCESSORS.md` | 对外披露 |
| 审计日志完善 | `audit/` | 记录所有数据操作 |
| App Store 隐私标签 | 配置文件 | 上架必备 |

### Phase 3: 增强透明度（P2，持续）

| 任务 | 文件 | 说明 |
|------|------|------|
| 数据导出功能 | `ws-handler.ts` | 用户可导出所有数据 |
| 处理透明度面板 | `VisionPanel.tsx` | 实时显示数据处理状态 |
| 传感器使用统计 | 新模块 | 记录采集了多少帧/音频 |
| 年度合规审查机制 | 流程文档 | 定期审查更新 |

---

## 七、验收标准

### 合规验收

- [ ] 隐私政策文档存在且内容完整
- [ ] 用户可查看、导出、删除所有个人数据
- [ ] 帧数据不持久化存储（除非用户明确启用训练贡献）
- [ ] 所有第三方传输有用户开关
- [ ] 摄像头/麦克风开启时有可见指示
- [ ] 商城发布前 PII 已脱敏
- [ ] App Store 隐私标签已配置

### 技术验收

- [ ] 无 sharp 依赖
- [ ] 无 TF.js 依赖（使用原生 FaceDetector + 降级）
- [ ] 所有新增功能有对应测试
- [ ] 训练管线质量不受影响（本地训练不脱敏）
- [ ] 商城发布管线有脱敏测试覆盖

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Shape Detection API 兼容性 | 部分浏览器不支持 | 三级降级链 |
| 商城脱敏遗漏 PII | 法律风险 | 自动扫描 + 人工审查 |
| 用户不理解隐私设置 | 合规风险 | 默认安全 + 渐进引导 |
| EU AI Act 高风险分类 | 需额外合规 | 透明文档 + 人类监督机制 |
| 训练数据含敏感图像 | 发布泄露 | 发布管线强制扫描 |

---

## 附录：法规速查

- 《个人信息保护法》: https://www.gov.cn/xinwen/2021-08/20/content_5632486.htm
- 最高法人脸识别司法解释: https://www.court.gov.cn/fabu/xiangqing/314981.html
- GDPR: https://gdpr-info.eu/
- EU AI Act: https://artificialintelligenceact.eu/
- Apple 隐私标签: https://developer.apple.com/app-store/app-privacy-details/
- Google Play 数据安全: https://support.google.com/googleplay/answer/10787469
