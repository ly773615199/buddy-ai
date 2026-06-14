/**
 * 六欲引擎 — 类型定义
 *
 * 运行时逻辑已迁移至小脑 BodyStateManager（src/brain/cerebellum/body-state.ts）。
 * 此文件仅保留类型定义，供其他模块使用。
 */

// ==================== 类型定义 ====================

/** 六欲维度 */
export interface DesireVector {
  hunger: number;        // 能量需求 0-100
  curiosity: number;     // 求知欲 0-100
  social: number;        // 社交欲 0-100
  safety: number;        // 安全欲 0-100
  expression: number;    // 表达欲 0-100
  rest: number;          // 休息欲 0-100
}
