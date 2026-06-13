# 灵伴 3D 精灵系统 — 执行计划

> 基于 `SPRITE_3D_DESIGN.md` v4.0 方案
> 日期：2026-05-01
> 状态：进行中

---

## 进度总览

| Phase | 内容 | 工期 | 状态 |
|-------|------|------|------|
| 1 | Three.js 基础渲染器（光团+粒子） | 5 天 | ✅ 完成 |
| 2 | BuddyGenome 基因系统（30参数+涌现计算） | 3 天 | ✅ 完成 |
| 3 | 程序化形态变形（球体→人形连续变形） | 5 天 | ✅ 完成 |
| 4 | 骨骼+面部表情+情绪驱动 | 5 天 | ✅ 完成 |
| 5 | PBR 材质+Bloom/SSAO 后处理 | 3 天 | 🔲 待执行 |
| 6 | 服饰系统+商城集成 | 4 天 | 🔲 待执行 |

**已完成：4/6 Phase | 剩余：7 天**

---

## Phase 1：Three.js 基础渲染器 ✅

| 文件 | 说明 |
|------|------|
| `frontend/src/renderer/detect-tier.ts` | GPU 5 档检测 |
| `frontend/src/renderer/BuddyRenderer.ts` | Three.js 核心渲染器 |
| `frontend/src/renderer/meshes/orb-mesh.ts` | 光团 mesh (Fresnel/呼吸) |
| `frontend/src/renderer/particle-system.ts` | 3D 粒子系统 |
| `frontend/src/components/BuddyCanvas.tsx` | React 包装组件 |

## Phase 2：基因系统 ✅

| 文件 | 说明 |
|------|------|
| `src/pet/genome.ts` | 30 参数 + computeGenome() + aestheticRefinement() |
| `src/pet/manager.ts` | 新增 getGenome() |
| `src/core/ws-handler.ts` | broadcastStatus 增加 genome |
| `frontend/src/types/buddy.ts` | BuddyGenome 类型 |

## Phase 3：程序化形态变形 ✅

| 文件 | 说明 |
|------|------|
| `frontend/src/renderer/meshes/humanoid-mesh.ts` | 人形 mesh + Vertex Shader 变形 |

- 9 步身材变形（比例/圆润度/头身比/耳朵/尾巴/翅膀/角/呼吸/摇摆）
- formProgress → 形态调制（各部位独立时间线）
- 程序化纹路（点/条纹/环/噪声）
- BuddyRenderer: 光团→人形自动切换

## Phase 4：骨骼与表情 ✅

| 文件 | 说明 |
|------|------|
| `frontend/src/renderer/skeleton/humanoid-skeleton.ts` | 完整人形骨架 |
| `frontend/src/renderer/skeleton/facial-expression.ts` | 面部表情系统 |

- 30 根骨骼（脊柱/四肢/面部/附属物）
- 10 种情绪预设（happy/sad/angry/surprised/thinking/tired/calm/excited/confused/energetic）
- 骨骼动画（尾巴摇摆/翅膀扇动/耳朵竖立/呼吸/摇摆）
- 平滑表情过渡 + 定时眨眼

## Phase 5：材质与后处理 🔲

- [ ] PBR 材质完善（onBeforeCompile 纹路注入）
- [ ] 后处理管线（Bloom + SSAO）
- [ ] 进化阶段附加效果（光环/粒子环）
- [ ] GPU 降级适配

## Phase 6：服饰与商城集成 🔲

| 文件 | 说明 |
|------|------|
| `frontend/src/renderer/costume/attach-points.ts` | 挂载点系统（已创建） |
| `frontend/src/renderer/costume/CostumeRenderer.ts` | 服饰渲染器（已创建） |

- [ ] 商城数据对接（broadcastStatus 增加 equippedItems）
- [ ] 默认服装自动装备
- [ ] 槽位冲突处理

---

## 文件清单

### 已创建

```
frontend/src/renderer/
  ├── BuddyRenderer.ts          ✅
  ├── detect-tier.ts            ✅
  ├── post-processing.ts        ✅ (骨架)
  ├── particle-system.ts        ✅
  ├── meshes/
  │   ├── orb-mesh.ts           ✅
  │   └── humanoid-mesh.ts      ✅
  ├── skeleton/
  │   ├── humanoid-skeleton.ts  ✅
  │   └── facial-expression.ts  ✅
  └── costume/
      ├── attach-points.ts      ✅
      └── CostumeRenderer.ts    ✅

frontend/src/components/
  └── BuddyCanvas.tsx           ✅

src/pet/
  └── genome.ts                 ✅
```

### 待修改

```
frontend/src/App.tsx              # SpriteRenderer → BuddyCanvas
src/core/ws-handler.ts           # broadcastStatus 增加 equippedItems
```
