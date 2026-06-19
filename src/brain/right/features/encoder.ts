/**
 * 特征编码器 — 将结构化输入编码为 token ID 序列
 *
 * 输入：TaskSignal + BodyState + ResourceState + 历史 + 多模态数据
 * 输出：number[] (token IDs，送入 NN)
 *
 * Token ID 分配：
 *   0       = PAD
 *   1       = UNK
 *   2       = CLS (决策标记)
 *   3       = SEP
 *   10-29   = domain 类别
 *   30-39   = complexity
 *   40-49   = taskType
 *   50-81   = tool IDs（32 个）
 *   100-199 = 数值 bin（置信度/质量/情绪等）
 *   200-299 = 情绪 bin
 *   300-399 = 欲望 bin
 *   400-449 = 空间坐标 bins（SpatialEncoder）
 *   450-549 = 图像 patch IDs（ImageEncoder）
 *   550-699 = 场景节点/边/slot（SceneEncoder）
 */

import type { TaskSignal, ResourceState, BodyState, IntuitionSignal } from '../../types.js';
import { encodeSpatial, type SpatialEncodeInput } from './spatial-encoder.js';
import { encodeImage, type RawImage } from './image-encoder.js';
import { encodeSceneGraph, slotAttention, encodeSlots, type SceneGraph } from './scene-encoder.js';
import { TextEncoder } from './text-encoder.js';
import { Tensor } from '../nn/tensor.js';

// ==================== Token ID 映射 ====================

const DOMAIN_MAP: Record<string, number> = {
  'file': 10, 'code': 11, 'git': 12, 'web': 13, 'system': 14,
  'knowledge': 15, 'conversation': 16, 'complex': 17,
  'database': 18, 'network': 19, 'security': 20, 'devops': 21,
};

const COMPLEXITY_MAP: Record<string, number> = {
  'simple': 30, 'medium': 33, 'complex': 36,
};

const TASK_TYPE_MAP: Record<string, number> = {
  'chat': 40, 'tools': 41, 'reasoning': 42, 'background': 43, 'domain': 44,
};

const TOOL_IDS: Record<string, number> = {
  'read_file': 50, 'write_file': 51, 'list_files': 52, 'search_files': 53,
  'exec': 54, 'git_status': 55, 'git_log': 56, 'git_diff': 57,
  'git_commit': 58, 'git_branch': 59, 'git_merge': 60, 'git_push': 61,
  'search_web': 62, 'fetch_url': 63, 'analyze_file': 64, 'find_references': 65,
  'browser_screenshot': 66, 'browser_extract': 67, 'browser_pdf': 68,
  'screen_capture': 69, 'screen_ocr': 70, 'screen_describe': 71,
  'tts_speak': 72, 'tts_voices': 73, 'tts_status': 74,
  'scan_project': 75, 'project_context': 76, 'get_time': 77,
};

const TOOL_ID_LIST = Object.values(TOOL_IDS);

// ==================== 数值离散化 ====================

/** 将 0-100 的值离散化为 10 个 bin */
function discretize100(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(100, value)) / 10);
  return 100 + bin;
}

/** 将 0-1 的值离散化为 10 个 bin */
function discretize01(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(1, value)) * 10);
  return 110 + Math.min(bin, 9);
}

/** 将情绪值离散化为 5 个 bin */
function discretizeEmotion(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(100, value)) / 20);
  return 200 + Math.min(bin, 4);
}

/** 将欲望值离散化为 5 个 bin */
function discretizeDesire(value: number): number {
  const bin = Math.floor(Math.max(0, Math.min(100, value)) / 20);
  return 300 + Math.min(bin, 4);
}

// ==================== 编码函数 ====================

export interface EncodeInput {
  signal: TaskSignal;
  resources: ResourceState;
  body?: BodyState;
  recentTools?: string[];   // 最近使用的工具
  suggestedTools?: string[]; // 经验系统推荐的工具
  /** 空间数据（可选） */
  spatial?: SpatialEncodeInput;
  /** 图像数据（可选） */
  image?: RawImage;
  /** 场景图数据（可选） */
  sceneGraph?: SceneGraph;
}

/**
 * 编码为 token ID 序列
 *
 * 序列结构：[CLS] [domains...] [SEP] [complexity] [taskType] [confidence] [SEP]
 *           [tools...] [SEP] [suggested...] [SEP] [body_state...] [SEP]
 *           [spatial...] [SEP] [image...] [SEP] [scene...] [SEP]
 */
export function encodeFeatures(input: EncodeInput): number[] {
  const tokens: number[] = [2]; // CLS

  // Domains（最多 4 个）
  for (const domain of input.signal.domains.slice(0, 4)) {
    tokens.push(DOMAIN_MAP[domain] ?? 1);
  }
  tokens.push(3); // SEP

  // Complexity + TaskType + Confidence
  tokens.push(COMPLEXITY_MAP[input.signal.complexity] ?? 1);
  tokens.push(TASK_TYPE_MAP[input.signal.taskType] ?? 1);
  tokens.push(discretize01(input.signal.intentConfidence));
  tokens.push(3);

  // Available tools from resources（前 10 个）
  if (input.resources.experienceHit) {
    tokens.push(discretize01(input.resources.localConfidence));
  }
  tokens.push(discretize100(input.resources.localCoverageRatio * 100));
  tokens.push(3);

  // ── 资源画像（700-719）──
  // 预算剩余：归一化到 0-1（hourlyBudget 通常 1.0）
  const budgetNorm = Math.max(0, Math.min(1, input.resources.budgetRemaining));
  tokens.push(700 + Math.floor(budgetNorm * 10));
  // 可用模型数：归一化到 0-1（假设最多 50 个模型）
  const modelCountNorm = Math.min(1, input.resources.availableNodeCount / 50);
  tokens.push(710 + Math.floor(modelCountNorm * 10));
  // 工具健康度：不可靠工具数（0=健康，越多越差）
  const toolUnreliable = input.resources.toolHealth?.unreliableTools?.length ?? 0;
  tokens.push(720 + Math.min(toolUnreliable, 9));
  // 用户纠正次数：高纠正 = 需要更强模型
  const correctionNorm = Math.min(1, input.resources.userCorrectionCount / 10);
  tokens.push(730 + Math.floor(correctionNorm * 10));
  tokens.push(3);

  // Suggested tools（经验系统推荐）
  if (input.suggestedTools) {
    for (const tool of input.suggestedTools.slice(0, 8)) {
      tokens.push(TOOL_IDS[tool] ?? 1);
    }
  }
  tokens.push(3);

  // Recent tools
  if (input.recentTools) {
    for (const tool of input.recentTools.slice(0, 5)) {
      tokens.push(TOOL_IDS[tool] ?? 1);
    }
  }
  tokens.push(3);

  // Body state
  if (input.body) {
    tokens.push(discretize100(input.body.energy));
    tokens.push(discretize100(input.body.temperature));
    tokens.push(discretize100(input.body.load));
    // 情绪：取主要维度
    tokens.push(discretizeEmotion(input.body.emotion.joy));
    tokens.push(discretizeEmotion(input.body.emotion.trust));
    tokens.push(discretizeEmotion(input.body.emotion.anticipation));
    // 认知
    tokens.push(discretize100(input.body.confidenceLevel));
    tokens.push(discretize100(input.body.confusionLevel));
    // 社交
    tokens.push(discretize100(input.body.intimacyLevel));
  }
  tokens.push(3); // SEP

  // ── 多模态编码（可选）──

  // 空间编码（400-449）
  if (input.spatial) {
    const spatialTokens = encodeSpatial(input.spatial);
    tokens.push(...spatialTokens);
    tokens.push(3); // SEP
  }

  // 图像编码（450-549）
  if (input.image) {
    const imageTokens = encodeImage(input.image);
    tokens.push(...imageTokens);
    tokens.push(3); // SEP
  }

  // 场景编码（550-699）
  if (input.sceneGraph) {
    const sceneTokens = encodeSceneGraph(input.sceneGraph);
    tokens.push(...sceneTokens);
    // Slot Attention → slot tokens
    const slots = slotAttention(sceneTokens);
    const slotTokens = encodeSlots(slots);
    tokens.push(...slotTokens);
    tokens.push(3); // SEP
  }

  return tokens;
}

/**
 * 快速特征编码 — 简单任务专用（Phase 4 优化）
 *
 * 只编码核心信号，跳过：body state / spatial / image / scene / suggested tools
 * 目标：token 数 ≤ 12（vs 完整编码 20-60+），缩短序列 → 减少注意力计算量
 *
 * 适用条件：signal.complexity === 'simple' || input.length < 30
 */
export function encodeFeaturesFast(input: EncodeInput): number[] {
  const tokens: number[] = [2]; // CLS

  // Domains（最多 2 个，简单任务通常 0-1 个）
  for (const domain of input.signal.domains.slice(0, 2)) {
    tokens.push(DOMAIN_MAP[domain] ?? 1);
  }
  tokens.push(3); // SEP

  // Complexity + TaskType + Confidence（核心三件套）
  tokens.push(COMPLEXITY_MAP[input.signal.complexity] ?? 1);
  tokens.push(TASK_TYPE_MAP[input.signal.taskType] ?? 1);
  tokens.push(discretize01(input.signal.intentConfidence));
  tokens.push(3); // SEP

  // 资源覆盖率（单 token，经验直连判断用）
  tokens.push(discretize100(input.resources.localCoverageRatio * 100));
  tokens.push(3); // SEP

  // 预算剩余（快速路径也需要，影响模型选择）
  const budgetNorm = Math.max(0, Math.min(1, input.resources.budgetRemaining));
  tokens.push(700 + Math.floor(budgetNorm * 10));
  tokens.push(3); // SEP

  return tokens; // 通常 10-12 个 token
}

/**
 * 获取所有已知工具名列表
 */
export function getToolNames(): string[] {
  return Object.keys(TOOL_IDS);
}

/**
 * 获取工具 ID → 名称映射
 */
export function getToolIdMap(): Map<number, string> {
  const map = new Map<number, string>();
  for (const [name, id] of Object.entries(TOOL_IDS)) {
    map.set(id, name);
  }
  return map;
}

/**
 * V2 特征编码 — 拼接 TextEncoder 的语义向量
 *
 * 有 TextEncoder + rawText → 文本走 TextEncoder 输出的 token 拼接到序列前部
 * 否则 → fallback 到原 encodeFeatures()
 */
export function encodeFeaturesV2(
  input: EncodeInput,
  textEncoder?: TextEncoder,
  rawText?: string,
): { tokenIds: number[]; textEmbedding?: Tensor } {
  const baseTokens = encodeFeatures(input);

  if (textEncoder && rawText) {
    const textEmb = textEncoder.forward(rawText); // [S', outputDim]
    return { tokenIds: baseTokens, textEmbedding: textEmb };
  }

  return { tokenIds: baseTokens };
}
