/**
 * 种子知识注入器 — 从工具定义 + 种子经验生成合成训练数据
 *
 * 三种数据源：
 * 1. 种子经验 → 直接转换（高质量，来自真实场景）
 * 2. 工具定义 → 变体生成（中质量，基于工具描述）
 * 3. 内置规则 → 规则转换（高质量，人工编写）
 *
 * 参考论文：
 * - TinyAgent (EMNLP 2024): 工具定义→合成训练数据→SFT
 * - Quality Matters (2024): 高质量少量数据 > 低质量大量数据
 */

import type { TrainingSample } from '../../types.js';
import type { ExperienceUnit } from '../../../intelligence/types.js';
import { encodeFeatures, type EncodeInput } from '../features/encoder.js';

// ==================== 映射表 ====================

/** 种子经验 intent → NN 意图类别索引 */
const INTENT_LABELS = [
  'file_operations', 'code_operations', 'git_operations', 'web_operations',
  'system_operations', 'knowledge_query', 'conversation', 'complex_task',
];

const INTENT_MAP: Record<string, number> = {
  'git_status': 2, 'git_diff': 2, 'git_log': 2,
  'file_read': 0, 'file_write': 0, 'list_files': 0, 'file_search': 0,
  'exec': 4, 'get_time': 4,
  'search_web': 3, 'fetch_url': 3,
  'code_analyze': 1, 'error_fix': 1,
  'knowledge_qa': 5, 'error_debug': 5, 'code_example': 1, 'doc_lookup': 5,
  'conversation': 6,
};

/** 工具名 → NN 工具索引（与 online-learner.ts 一致） */
const TOOL_IDS: Record<string, number> = {
  'read_file': 0, 'write_file': 1, 'list_files': 2, 'search_files': 3,
  'exec': 4, 'git_status': 5, 'git_log': 6, 'git_diff': 7,
  'git_commit': 8, 'git_branch': 9, 'git_merge': 10, 'git_push': 11,
  'search_web': 12, 'fetch_url': 13, 'analyze_file': 14, 'find_references': 15,
  'browser_screenshot': 16, 'browser_extract': 17, 'browser_pdf': 18,
  'screen_capture': 19, 'screen_ocr': 20, 'screen_describe': 21,
  'tts_speak': 22, 'tts_voices': 23, 'tts_status': 24,
  'scan_project': 25, 'project_context': 26, 'get_time': 27,
};

/** 意图 → 典型工具组合 */
const DOMAIN_TOOLS: Record<string, string[]> = {
  'file_operations': ['read_file', 'write_file', 'list_files', 'search_files'],
  'code_operations': ['read_file', 'write_file', 'exec', 'search_files', 'analyze_file'],
  'git_operations': ['exec', 'git_status', 'git_log', 'git_diff', 'git_commit'],
  'web_operations': ['search_web', 'fetch_url'],
  'system_operations': ['exec'],
  'knowledge_query': ['fetch_url', 'search_web'],
  'conversation': [],
  'complex_task': ['exec'],
};

// ==================== 合成样本接口 ====================

interface SynthesizedSample {
  features: Float32Array;
  labelIntent: number;
  labelTools: number[];
  labelQuality: number;
  outcome: boolean;
  source: 'seed_experience' | 'tool_variant' | 'builtin_rule';
}

// ==================== 特征编码辅助 ====================

/** 构造 EncodeInput 并编码为 Float32Array */
function encodeAsFeatures(
  domains: string[],
  complexity: 'simple' | 'medium' | 'complex',
  taskType: 'chat' | 'tools' | 'reasoning' | 'background' | 'domain',
  confidence: number,
  suggestedTools: string[] = [],
): Float32Array {
  const signal = {
    domains,
    complexity,
    taskType,
    shouldUseDAG: false,
    dagReason: '',
    intentConfidence: confidence,
  };
  const resources = {
    budgetRemaining: 100,
    availableNodeCount: 1,
    localCoverageRatio: 1,
    localConfidence: confidence,
    userCorrectionCount: 0,
    experienceHit: null,
  };
  const input: EncodeInput = { signal, resources, suggestedTools };
  const tokenIds = encodeFeatures(input);
  const features = new Float32Array(tokenIds.length);
  for (let i = 0; i < tokenIds.length; i++) features[i] = tokenIds[i];
  return features;
}

/** 工具名列表 → 32 维多标签向量 */
function toolsToLabels(tools: string[]): number[] {
  const labels = new Array(32).fill(0);
  for (const tool of tools) {
    const idx = TOOL_IDS[tool];
    if (idx !== undefined) labels[idx] = 1;
  }
  return labels;
}

/** 工具标签是否有效（至少有一个工具被标记） */
function hasValidTools(labels: number[]): boolean {
  return labels.some(t => t > 0);
}

// ==================== 数据源 1: 种子经验转换 ====================

function experienceToSample(seed: ExperienceUnit): SynthesizedSample | null {
  const intentIdx = INTENT_MAP[seed.trigger.intent] ?? -1;
  if (intentIdx < 0) return null;

  const toolNames = seed.steps.map(s => s.tool);
  const toolLabels = toolsToLabels(toolNames);
  if (!hasValidTools(toolLabels)) return null;

  const domains = seed.trigger.contextTags.length > 0
    ? [seed.trigger.contextTags[0].toLowerCase()]
    : [INTENT_LABELS[intentIdx]];

  const features = encodeAsFeatures(
    domains,
    'simple',
    'tools',
    seed.stats.confidence,
    toolNames,
  );

  return {
    features,
    labelIntent: intentIdx,
    labelTools: toolLabels,
    labelQuality: seed.stats.confidence,
    outcome: seed.stats.successCount > 0,
    source: 'seed_experience',
  };
}

// ==================== 数据源 2: 工具定义变体 ====================

/** 工具描述关键词 → 可能的用户说法 */
const TOOL_VARIANTS: Record<string, string[]> = {
  'read_file': ['读文件', '查看文件', '打开文件', 'read file', 'show file'],
  'write_file': ['写文件', '创建文件', '保存文件', 'write file', 'create file'],
  'list_files': ['列出文件', '查看目录', '文件列表', 'list files', 'show directory'],
  'search_files': ['搜索文件', '查找文件', '找文件', 'search files', 'find files'],
  'exec': ['执行命令', '运行', '跑一下', 'execute', 'run command'],
  'git_status': ['查看状态', 'git状态', 'git status', '仓库状态'],
  'git_diff': ['查看改动', '变更', 'diff', 'git diff', '改了什么'],
  'git_log': ['提交历史', '提交记录', 'git log', 'commit history'],
  'search_web': ['搜索', '搜一下', '网上查', 'search', 'google'],
  'fetch_url': ['获取网页', '打开链接', 'fetch url', '抓取页面'],
  'analyze_file': ['分析文件', '代码分析', 'analyze', '代码审查'],
  'get_time': ['几点了', '时间', 'what time', 'get time'],
};

function generateToolVariants(toolName: string): SynthesizedSample[] {
  const variants = TOOL_VARIANTS[toolName];
  if (!variants) return [];

  const intentIdx = guessIntentFromTool(toolName);
  const toolLabels = toolsToLabels([toolName]);

  return variants.map(variant => ({
    features: encodeAsFeatures(
      [INTENT_LABELS[intentIdx]],
      'simple' as const,
      'tools' as const,
      0.5,
      [toolName],
    ),
    labelIntent: intentIdx,
    labelTools: toolLabels,
    labelQuality: 0.5,
    outcome: true,
    source: 'tool_variant' as const,
  }));
}

function guessIntentFromTool(tool: string): number {
  if (['read_file', 'write_file', 'list_files', 'search_files'].includes(tool)) return 0;
  if (['analyze_file', 'find_references'].includes(tool)) return 1;
  if (tool.startsWith('git_')) return 2;
  if (['search_web', 'fetch_url'].includes(tool)) return 3;
  if (['exec', 'get_time'].includes(tool)) return 4;
  return 7; // complex_task
}

// ==================== 数据源 3: 内置规则 ====================

function builtinRulesToSamples(): SynthesizedSample[] {
  const rules = [
    {
      name: 'git_status',
      domains: ['git'],
      intent: 2,
      tools: ['exec'],
      complexity: 'simple' as const,
      confidence: 0.8,
    },
    {
      name: 'file_read',
      domains: ['file'],
      intent: 0,
      tools: ['read_file'],
      complexity: 'simple' as const,
      confidence: 0.8,
    },
    {
      name: 'search_and_fetch',
      domains: ['web'],
      intent: 3,
      tools: ['search_web', 'fetch_url'],
      complexity: 'medium' as const,
      confidence: 0.7,
    },
    {
      name: 'code_analysis',
      domains: ['code'],
      intent: 1,
      tools: ['analyze_file', 'find_references'],
      complexity: 'medium' as const,
      confidence: 0.7,
    },
    {
      name: 'knowledge_rag',
      domains: ['knowledge'],
      intent: 5,
      tools: ['search_web', 'fetch_url'],
      complexity: 'medium' as const,
      confidence: 0.6,
    },
    {
      name: 'exec_command',
      domains: ['system'],
      intent: 4,
      tools: ['exec'],
      complexity: 'simple' as const,
      confidence: 0.8,
    },
    {
      name: 'file_write',
      domains: ['file'],
      intent: 0,
      tools: ['write_file'],
      complexity: 'simple' as const,
      confidence: 0.8,
    },
    {
      name: 'git_diff',
      domains: ['git'],
      intent: 2,
      tools: ['exec'],
      complexity: 'simple' as const,
      confidence: 0.7,
    },
  ];

  return rules.map(rule => ({
    features: encodeAsFeatures(
      rule.domains,
      rule.complexity,
      'tools',
      rule.confidence,
      rule.tools,
    ),
    labelIntent: rule.intent,
    labelTools: toolsToLabels(rule.tools),
    labelQuality: rule.confidence,
    outcome: true,
    source: 'builtin_rule' as const,
  }));
}

// ==================== 主函数 ====================

/**
 * 从工具定义 + 种子经验 + 内置规则生成合成训练数据
 *
 * @param seedExperiences 种子经验列表
 * @returns 合成训练样本列表（已过滤无效样本）
 */
export function synthesizeTrainingData(
  seedExperiences: ExperienceUnit[],
): TrainingSample[] {
  const raw: SynthesizedSample[] = [];

  // 方法 1：种子经验直接转换
  for (const seed of seedExperiences) {
    const sample = experienceToSample(seed);
    if (sample) raw.push(sample);
  }

  // 方法 2：工具定义变体生成
  for (const toolName of Object.keys(TOOL_VARIANTS)) {
    raw.push(...generateToolVariants(toolName));
  }

  // 方法 3：内置规则转换
  raw.push(...builtinRulesToSamples());

  // 质量过滤
  const valid = raw.filter(s =>
    hasValidTools(s.labelTools) &&
    s.labelIntent >= 0 &&
    s.features.length > 0,
  );

  // 转换为 TrainingSample
  return valid.map(s => ({
    features: s.features,
    labelIntent: s.labelIntent,
    labelTools: s.labelTools,
    labelQuality: s.labelQuality,
    outcome: s.outcome,
    timestamp: Date.now(),
    weight: s.source === 'seed_experience' ? 1.0 : s.source === 'builtin_rule' ? 0.8 : 0.5,
  }));
}
