/**
 * CapabilityCoverageChecker — 能力覆盖度检查器
 *
 * 在消息处理入口处检查：当前模型池能否处理用户的请求
 * coverage < 0.5 → reject，0.5-0.8 → degrade，> 0.8 → proceed
 *
 * 纯规则检查，无 LLM 调用
 */

import type { ModelPool, ModelProfile } from './model-pool.js';

// ==================== 类型定义 ====================

export interface CapabilityRequirement {
  needsVision: boolean;
  needsToolCalling: boolean;
  needsNativeToolCalling: boolean;
  minContextTokens: number;
  languagePreference: 'chinese' | 'english' | 'any';
  /** 需要的特殊能力 */
  requiredCapabilities: string[];
}

export interface CoverageReport {
  requirement: CapabilityRequirement;
  coverage: {
    vision: { available: boolean; models: string[] };
    toolCalling: { available: boolean; models: string[] };
    nativeToolCalling: { available: boolean; models: string[] };
    contextLength: { available: boolean; models: string[] };
    language: { available: boolean; models: string[] };
  };
  overallCoverage: number;      // 0-1
  gaps: string[];               // 缺失的能力列表
  recommendation: 'proceed'     // 能力足够
                 | 'degrade'    // 可以降级处理
                 | 'reject';    // 应该拒绝并告知用户
  /** reject 时的友好提示 */
  message?: string;
}

// ==================== 关键词检测 ====================

const VISION_KEYWORDS = [
  '图片', '图像', '照片', '截图', '看图', '识别图', '分析图',
  'image', 'photo', 'picture', 'screenshot', 'vision', 'visual',
  'ocr', '看这个', '这是什么图',
];

const TOOL_KEYWORDS = [
  '执行', '运行', 'run', 'exec', '读取', 'read', '写入', 'write',
  '搜索', 'search', 'git', '文件', 'file', '部署', 'deploy',
  '安装', 'install', '命令', 'command', 'shell', 'bash',
];

const HIGH_CONTEXT_KEYWORDS = [
  '分析整个', '全文', '所有文件', '整个项目', '批量',
  'all files', 'entire', 'full text', 'batch',
];

// ==================== 检查器 ====================

export class CapabilityCoverageChecker {
  private pool: ModelPool;

  constructor(pool: ModelPool) {
    this.pool = pool;
  }

  /**
   * 检查用户请求的能力覆盖度
   */
  check(content: string, taskType?: string): CoverageReport {
    const requirement = this.extractRequirement(content, taskType);
    const profiles = this.pool.getAllProfiles();

    // 检查各维度覆盖
    const visionModels = profiles.filter(p => p.capabilities.vision).map(p => p.id);
    const toolCallingModels = profiles.filter(p => p.capabilities.toolCallingMode !== 'none').map(p => p.id);
    const nativeToolModels = profiles.filter(p => p.capabilities.toolCallingMode === 'native').map(p => p.id);
    const contextModels = profiles.filter(p => p.maxContextTokens >= requirement.minContextTokens).map(p => p.id);
    const langModels = this.filterByLanguage(profiles, requirement.languagePreference);

    const coverage = {
      vision: { available: visionModels.length > 0, models: visionModels.slice(0, 5) },
      toolCalling: { available: toolCallingModels.length > 0, models: toolCallingModels.slice(0, 5) },
      nativeToolCalling: { available: nativeToolModels.length > 0, models: nativeToolModels.slice(0, 5) },
      contextLength: { available: contextModels.length > 0, models: contextModels.slice(0, 5) },
      language: { available: langModels.length > 0, models: langModels.slice(0, 5) },
    };

    // 计算覆盖率
    const gaps: string[] = [];
    let coveredDimensions = 0;
    let totalDimensions = 0;

    if (requirement.needsVision) {
      totalDimensions++;
      if (coverage.vision.available) coveredDimensions++;
      else gaps.push('视觉理解 (Vision)');
    }

    if (requirement.needsToolCalling) {
      totalDimensions++;
      if (coverage.toolCalling.available) coveredDimensions++;
      else gaps.push('工具调用 (Tool Calling)');
    }

    if (requirement.needsNativeToolCalling) {
      totalDimensions++;
      if (coverage.nativeToolCalling.available) coveredDimensions++;
      else gaps.push('原生工具调用 (Native Tool Calling)');
    }

    if (requirement.minContextTokens > 4096) {
      totalDimensions++;
      if (coverage.contextLength.available) coveredDimensions++;
      else gaps.push(`长上下文 (${requirement.minContextTokens} tokens)`);
    }

    if (requirement.languagePreference !== 'any') {
      totalDimensions++;
      if (coverage.language.available) coveredDimensions++;
      else gaps.push(`${requirement.languagePreference === 'chinese' ? '中文' : '英文'}能力`);
    }

    // 无特殊需求时默认满分
    if (totalDimensions === 0) {
      return {
        requirement,
        coverage,
        overallCoverage: 1,
        gaps: [],
        recommendation: 'proceed',
      };
    }

    const overallCoverage = coveredDimensions / totalDimensions;

    // 决策
    let recommendation: CoverageReport['recommendation'];
    let message: string | undefined;

    if (overallCoverage >= 0.8) {
      recommendation = 'proceed';
    } else if (overallCoverage >= 0.5) {
      recommendation = 'degrade';
      message = `部分能力缺失，将使用降级模式：${gaps.join('、')}`;
    } else {
      recommendation = 'reject';
      message = this.buildRejectionMessage(gaps);
    }

    return {
      requirement,
      coverage,
      overallCoverage,
      gaps,
      recommendation,
      message,
    };
  }

  // ==================== 需求提取 ====================

  /** 从用户消息中提取能力需求 */
  private extractRequirement(content: string, taskType?: string): CapabilityRequirement {
    const lower = content.toLowerCase();

    const needsVision = VISION_KEYWORDS.some(k => lower.includes(k));
    const needsToolCalling = TOOL_KEYWORDS.some(k => lower.includes(k)) || taskType === 'tools';
    const needsNativeToolCalling = needsToolCalling && taskType === 'tools';
    const minContextTokens = HIGH_CONTEXT_KEYWORDS.some(k => lower.includes(k)) ? 32000 : 4096;

    // 语言偏好
    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const totalChars = content.length;
    const languagePreference: CapabilityRequirement['languagePreference'] =
      totalChars > 0 && chineseChars / totalChars > 0.3 ? 'chinese'
      : totalChars > 0 && chineseChars / totalChars < 0.05 ? 'english'
      : 'any';

    return {
      needsVision,
      needsToolCalling,
      needsNativeToolCalling,
      minContextTokens,
      languagePreference,
      requiredCapabilities: [],
    };
  }

  // ==================== 辅助 ====================

  /** 按语言过滤模型 */
  private filterByLanguage(profiles: ModelProfile[], preference: CapabilityRequirement['languagePreference']): string[] {
    if (preference === 'any') return profiles.map(p => p.id);
    const threshold = 0.6;
    return profiles
      .filter(p => {
        if (preference === 'chinese') return p.capabilities.chinese >= threshold;
        if (preference === 'english') return p.capabilities.english >= threshold;
        return true;
      })
      .map(p => p.id);
  }

  /** 构建拒绝消息 */
  private buildRejectionMessage(gaps: string[]): string {
    const suggestions: string[] = [];

    if (gaps.some(g => g.includes('视觉'))) {
      suggestions.push('添加支持 Vision 的 Provider（如 OpenAI GPT-4o、Google Gemini）');
    }
    if (gaps.some(g => g.includes('工具调用'))) {
      suggestions.push('添加支持 Tool Calling 的模型（如 DeepSeek、GPT-4o）');
    }
    if (gaps.some(g => g.includes('长上下文'))) {
      suggestions.push('添加支持长上下文的模型（如 Gemini 1.5、Claude）');
    }

    return [
      `⚠️ 当前模型池缺少以下能力: ${gaps.join('、')}`,
      '',
      '建议：',
      ...suggestions.map(s => `• ${s}`),
    ].join('\n');
  }
}
