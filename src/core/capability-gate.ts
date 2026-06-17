/**
 * 能力门控 — 风险确认模型（与亲密度解耦）
 *
 * 设计原则：
 * - 所有能力默认可用，不限制用户
 * - 高风险操作需要用户确认（与亲密度无关）
 * - 感知能力需要单独授权（PrivacyManager 管理）
 * - 亲密度只影响 Buddy 的语气/风格，不影响能力访问
 */

import type { TrustLevel } from '../types.js';

// ==================== 风险等级 ====================

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

// ==================== 能力定义 ====================

export interface CapabilityDef {
  id: string;
  /** 风险等级：决定是否需要确认 */
  risk: RiskLevel;
  /** 是否为感知能力（需单独授权） */
  sensory?: boolean;
  /** 能力描述（用于确认对话框） */
  description?: string;
}

// ==================== 功能开放表（全量可用，风险分级） ====================

export const CAPABILITY_GATE: Record<string, CapabilityDef> = {
  // ── 无风险：只读/查询 ──
  chat:              { id: 'chat',              risk: 'none',   description: '对话' },
  get_time:          { id: 'get_time',          risk: 'none',   description: '查询时间' },
  read_file:         { id: 'read_file',         risk: 'none',   description: '读取文件内容' },
  list_files:        { id: 'list_files',        risk: 'none',   description: '列出目录文件' },
  search_files:      { id: 'search_files',      risk: 'none',   description: '搜索文件内容' },
  git_status:        { id: 'git_status',        risk: 'none',   description: '查看 Git 状态' },
  git_diff:          { id: 'git_diff',          risk: 'none',   description: '查看 Git 变更' },
  git_log:           { id: 'git_log',           risk: 'none',   description: '查看 Git 历史' },
  search_web:        { id: 'search_web',        risk: 'none',   description: '搜索网络' },
  fetch_url:         { id: 'fetch_url',         risk: 'none',   description: '抓取网页内容' },
  analyze_file:      { id: 'analyze_file',      risk: 'none',   description: '分析代码结构' },
  find_references:   { id: 'find_references',   risk: 'none',   description: '查找代码引用' },
  scan_project:      { id: 'scan_project',      risk: 'none',   description: '扫描项目结构' },
  buddy_learn:       { id: 'buddy_learn',       risk: 'none',   description: '学习新知识' },

  // ── 低风险：可逆写操作 ──
  write_file:        { id: 'write_file',        risk: 'low',    description: '创建或修改文件' },

  // ── 中风险：命令执行 ──
  exec:              { id: 'exec',              risk: 'medium', description: '执行 Shell 命令' },

  // ── 高风险：不可逆/敏感操作 ──
  stmp_retrieve:     { id: 'stmp_retrieve',     risk: 'none',   description: '检索记忆' },
  dream_consolidate: { id: 'dream_consolidate', risk: 'none',   description: '整理记忆' },
  knowledge_extract: { id: 'knowledge_extract', risk: 'none',   description: '提取知识' },
  experience_compile:{ id: 'experience_compile',risk: 'none',   description: '编译经验' },
  package_create:    { id: 'package_create',    risk: 'low',    description: '创建能力包' },
  package_share:     { id: 'package_share',     risk: 'medium', description: '分享能力包' },

  // ── 感知能力（单独授权，不走风险确认） ──
  camera:            { id: 'camera',            risk: 'none', sensory: true, description: '摄像头' },
  microphone:        { id: 'microphone',        risk: 'none', sensory: true, description: '麦克风' },
  location:          { id: 'location',          risk: 'none', sensory: true, description: '位置' },
};

// ==================== 确认逻辑（纯风险驱动） ====================

/**
 * 检查操作是否需要用户确认
 * 基于风险等级，与亲密度/信任度无关
 */
export function needsConfirmation(toolName: string): boolean {
  const cap = CAPABILITY_GATE[toolName];
  if (!cap) return true;         // 未知工具默认需要确认
  if (cap.sensory) return false; // 感知能力走 PrivacyManager，不走这里
  return cap.risk === 'low' || cap.risk === 'medium' || cap.risk === 'high';
}

/**
 * 获取操作的风险等级
 */
export function getRiskLevel(toolName: string): RiskLevel {
  return CAPABILITY_GATE[toolName]?.risk ?? 'high';
}

/**
 * 检查是否为感知能力（需单独授权）
 */
export function isSensoryCapability(toolName: string): boolean {
  return CAPABILITY_GATE[toolName]?.sensory === true;
}

// ==================== 兼容旧接口 ====================

/**
 * 兼容旧签名：needsConfirmationCompat
 * 内部已切换到纯风险模型，忽略 trustLevel/intimacyScore
 * @deprecated 使用 needsConfirmation(toolName) 替代
 */
export function needsConfirmationCompat(toolName: string, _trustLevel?: string, _intimacyScore?: number): boolean {
  return needsConfirmation(toolName);
}

/**
 * 兼容旧签名：isCapabilityAvailable
 * 现在所有能力默认可用
 * @deprecated 不再需要检查可用性
 */
export function isCapabilityAvailable(_capabilityId: string, _intimacyScore?: number): boolean {
  return true; // 所有能力默认可用
}

/**
 * 兼容旧签名：needsCapabilityConfirmation
 * @deprecated 使用 needsConfirmation(toolName) 替代
 */
export function needsCapabilityConfirmation(capabilityId: string, _intimacyScore?: number): boolean {
  return needsConfirmation(capabilityId);
}

/**
 * 兼容旧签名：getDiscoverableCapabilities
 * 现在返回空数组（不再有阶段发现的概念）
 * @deprecated 能力引导由 UnifiedInterviewer 处理
 */
export function getDiscoverableCapabilities(_intimacyScore: number, _discoveredIds: Set<string>): CapabilityDef[] {
  return [];
}

/**
 * 兼容旧签名：getCapabilityStage
 * @deprecated 能力不再有阶段
 */
export function getCapabilityStage(_capabilityId: string): null {
  return null;
}
