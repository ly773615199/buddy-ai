/**
 * 功能开放表 — 替代 CONFIRMATION_MAP，与亲密度五阶段联动
 *
 * 设计原则：
 * - 功能不是"解锁"，是"Buddy 主动引导发现"
 * - 每个功能有发现方式：default / buddy_guided / user_delegate / buddy_demonstrate / consent_required
 * - 高风险操作在低阶段需要确认，高阶段自动放行
 */

import type { IntimacyStageName, TrustLevel } from '../types.js';
import { getIntimacyStage } from '../types.js';

// ==================== 发现方式 ====================

export type DiscoveryMode =
  | 'default'            // 默认开放，无需发现
  | 'buddy_guided'       // Buddy 主动引导用户发现
  | 'user_delegate'      // 用户主动委托（需确认）
  | 'buddy_demonstrate'  // Buddy 展示内在能力
  | 'consent_required'   // 需要单独知情同意（感知能力）
  | 'user_initiated';    // 用户主动发起（如教知识）

// ==================== 能力定义 ====================

export interface CapabilityDef {
  id: string;
  stage: IntimacyStageName;
  discovery: DiscoveryMode;
  /** 需要确认的操作（低阶段时） */
  confirm?: boolean;
  /** 触发引导的关键词/场景 */
  trigger?: string;
  /** 是否为感知能力（需单独告知） */
  separate?: boolean;
  /** 前置能力（需先发现） */
  requires?: string[];
}

// ==================== 功能开放表 ====================

export const CAPABILITY_GATE: Record<string, CapabilityDef> = {
  // ── Phase 1: 初见 — 默认开放 ──
  chat:          { id: 'chat',          stage: '初见', discovery: 'default' },
  get_time:      { id: 'get_time',      stage: '初见', discovery: 'default' },

  // ── Phase 2: 相识 — Buddy 引导发现 ──
  read_file:     { id: 'read_file',     stage: '相识', discovery: 'buddy_guided', trigger: '提到文件',    requires: ['chat'] },
  list_files:    { id: 'list_files',    stage: '相识', discovery: 'buddy_guided', trigger: '提到目录',    requires: ['chat'] },
  search_files:  { id: 'search_files',  stage: '相识', discovery: 'buddy_guided', trigger: '提到搜索',    requires: ['list_files'] },
  git_status:    { id: 'git_status',    stage: '相识', discovery: 'buddy_guided', trigger: '提到Git',     requires: ['chat'] },
  git_diff:      { id: 'git_diff',      stage: '相识', discovery: 'buddy_guided', trigger: '提到变更',    requires: ['git_status'] },
  git_log:       { id: 'git_log',       stage: '相识', discovery: 'buddy_guided', trigger: '提到历史',    requires: ['git_status'] },
  search_web:    { id: 'search_web',    stage: '相识', discovery: 'buddy_guided', trigger: '问外部问题',  requires: ['chat'] },
  fetch_url:     { id: 'fetch_url',     stage: '相识', discovery: 'buddy_guided', trigger: '提到网页',    requires: ['search_web'] },

  // ── Phase 3: 相知 — 用户委托 + 确认 ──
  write_file:    { id: 'write_file',    stage: '相知', discovery: 'user_delegate', confirm: true, requires: ['read_file'] },
  exec:          { id: 'exec',          stage: '相知', discovery: 'user_delegate', confirm: true, requires: ['chat'] },
  analyze_file:  { id: 'analyze_file',  stage: '相知', discovery: 'buddy_guided',  trigger: '分析需求',  requires: ['read_file'] },
  scan_project:  { id: 'scan_project',  stage: '相知', discovery: 'buddy_guided',  trigger: '项目相关',  requires: ['list_files'] },
  buddy_learn:   { id: 'buddy_learn',   stage: '相知', discovery: 'user_initiated', trigger: '教知识' },

  // ── Phase 4: 相伴 — Buddy 展示内在 ──
  stmp_retrieve:       { id: 'stmp_retrieve',       stage: '相伴', discovery: 'buddy_demonstrate', trigger: '引用记忆' },
  dream_consolidate:   { id: 'dream_consolidate',   stage: '相伴', discovery: 'buddy_demonstrate', trigger: '梦境' },
  knowledge_extract:   { id: 'knowledge_extract',   stage: '相伴', discovery: 'buddy_demonstrate', trigger: '知识积累' },
  experience_compile:  { id: 'experience_compile',  stage: '相伴', discovery: 'buddy_demonstrate', trigger: '经验复用' },

  // ── Phase 5: 灵犀 — 自主能力 ──
  package_create:  { id: 'package_create',  stage: '灵犀', discovery: 'buddy_demonstrate' },
  package_share:   { id: 'package_share',   stage: '灵犀', discovery: 'buddy_demonstrate' },

  // ── 感知能力（相伴+，单独告知） ──
  camera:        { id: 'camera',        stage: '相伴', discovery: 'consent_required', separate: true },
  microphone:    { id: 'microphone',    stage: '相伴', discovery: 'consent_required', separate: true },
  location:      { id: 'location',      stage: '相识', discovery: 'consent_required', separate: true },
};

// ==================== 能力检查 ====================

/** 检查功能是否在当前阶段可用 */
export function isCapabilityAvailable(capabilityId: string, intimacyScore: number): boolean {
  const cap = CAPABILITY_GATE[capabilityId];
  if (!cap) return false; // 未知能力默认不可用

  const currentStage = getIntimacyStage(intimacyScore);
  const stageOrder: IntimacyStageName[] = ['初见', '相识', '相知', '相伴', '灵犀'];
  const currentIdx = stageOrder.indexOf(currentStage.name);
  const requiredIdx = stageOrder.indexOf(cap.stage);

  return currentIdx >= requiredIdx;
}

/** 检查功能是否需要用户确认 */
export function needsCapabilityConfirmation(capabilityId: string, intimacyScore: number): boolean {
  const cap = CAPABILITY_GATE[capabilityId];
  if (!cap) return false;

  // 高阶段（相伴+）自动放行写操作
  const stage = getIntimacyStage(intimacyScore);
  if (stage.name === '相伴' || stage.name === '灵犀') {
    // 相伴及以上对 write_file/exec 不再需要确认
    if (capabilityId === 'write_file' || capabilityId === 'exec') return false;
  }

  return cap.confirm === true;
}

/** 获取当前阶段可发现但尚未发现的能力列表 */
export function getDiscoverableCapabilities(
  intimacyScore: number,
  discoveredIds: Set<string>,
): CapabilityDef[] {
  const stage = getIntimacyStage(intimacyScore);
  const stageOrder: IntimacyStageName[] = ['初见', '相识', '相知', '相伴', '灵犀'];
  const currentIdx = stageOrder.indexOf(stage.name);

  return Object.values(CAPABILITY_GATE).filter(cap => {
    if (discoveredIds.has(cap.id)) return false; // 已发现
    const capIdx = stageOrder.indexOf(cap.stage);
    return capIdx <= currentIdx; // 当前阶段或更低阶段的能力
  });
}

/** 获取能力的阶段信息 */
export function getCapabilityStage(capabilityId: string): IntimacyStageName | null {
  return CAPABILITY_GATE[capabilityId]?.stage ?? null;
}

// ==================== 兼容：替代旧 CONFIRMATION_MAP ====================

/**
 * 兼容旧接口：检查工具是否需要确认
 * 内部已切换到 CAPABILITY_GATE，但保留旧签名供 agent.ts 使用
 */
export function needsConfirmationCompat(toolName: string, trustLevel: string, intimacyScore?: number): boolean {
  // 如果有亲密度分数，使用新系统
  if (intimacyScore !== undefined) {
    return needsCapabilityConfirmation(toolName, intimacyScore);
  }

  // 降级：基于信任等级的简单映射
  const cap = CAPABILITY_GATE[toolName];
  if (!cap || !cap.confirm) return false;

  const levelOrder: TrustLevel[] = ['stranger', 'acquaintance', 'friend', 'close_friend', 'soulmate'];
  const currentIdx = levelOrder.indexOf(trustLevel as TrustLevel);

  // stranger/acquaintance 对 write_file 需要确认
  // stranger/acquaintance/friend 对 exec 需要确认
  if (toolName === 'write_file') return currentIdx <= 1; // stranger, acquaintance
  if (toolName === 'exec') return currentIdx <= 2;       // stranger, acquaintance, friend

  return false;
}
