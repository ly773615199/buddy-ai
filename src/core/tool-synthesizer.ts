/**
 * ToolSynthesizer — 经验 → 工具桥接
 *
 * 从 ExperienceCompiler 的高频经验单元自动生成 .skillmate 工具：
 * 1. 触发判断：置信度 > 0.8 且成功次数 > 5
 * 2. 参数泛化：从具体值提取参数模板
 * 3. 命令合成：拼装 .skillmate 定义
 * 4. 质量门：验证生成的工具可执行
 */

import type { ExperienceUnit, ExperienceStep } from '../intelligence/types.js';
import type { BuddySkillDef, SkillParamDef } from '../skills/skill-manager.js';

// ==================== 类型 ====================

export interface SynthesisDecision {
  shouldSynthesize: boolean;
  reason: string;
}

export interface ParamTemplate {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  inferredFrom: string;          // 推断来源的原始值
}

export interface SynthesizedTool {
  definition: BuddySkillDef;
  sourceExperienceId: string;
  sourceExperienceName: string;
  generalizedParams: ParamTemplate[];
  qualityScore: number;          // 0-1 质量评分
}

export interface QualityGateResult {
  passed: boolean;
  score: number;
  issues: string[];
}

// ==================== 配置 ====================

const SYNTHESIS_CONFIG = {
  minConfidence: 0.8,
  minSuccessCount: 5,
  maxSteps: 5,                  // 经验步骤过多不合成（太复杂）
  minQualityScore: 0.6,         // 质量门最低分
  maxParams: 6,                 // 最大参数数量
};

// ==================== 常量值模式 ====================

/** 可泛化的路径模式 */
const PATH_PATTERNS = [
  { pattern: /^\/[\w/.-]+\.\w+$/, paramType: 'path', desc: '文件路径' },
  { pattern: /^[\w/.-]+\.\w+$/, paramType: 'path', desc: '相对路径' },
];

/** 可泛化的值模式 */
const VALUE_PATTERNS: Array<{ test: (v: string) => boolean; type: ParamTemplate['type']; desc: string }> = [
  { test: v => /^\d+$/.test(v), type: 'number', desc: '数字' },
  { test: v => /^(true|false)$/i.test(v), type: 'boolean', desc: '布尔值' },
  { test: v => /^https?:\/\//.test(v), type: 'string', desc: 'URL' },
  { test: v => v.length > 20, type: 'string', desc: '长文本' },
];

// ==================== ToolSynthesizer ====================

export class ToolSynthesizer {
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  // ── 1. 触发判断 ──

  /**
   * 判断经验单元是否应该被合成为工具
   */
  shouldSynthesize(unit: ExperienceUnit): SynthesisDecision {
    // 置信度检查
    if (unit.stats.confidence < SYNTHESIS_CONFIG.minConfidence) {
      return { shouldSynthesize: false, reason: `置信度 ${unit.stats.confidence.toFixed(2)} < ${SYNTHESIS_CONFIG.minConfidence}` };
    }

    // 成功次数检查
    if (unit.stats.successCount < SYNTHESIS_CONFIG.minSuccessCount) {
      return { shouldSynthesize: false, reason: `成功次数 ${unit.stats.successCount} < ${SYNTHESIS_CONFIG.minSuccessCount}` };
    }

    // 步骤数检查（太复杂的经验不适合合成简单工具）
    if (unit.steps.length > SYNTHESIS_CONFIG.maxSteps) {
      return { shouldSynthesize: false, reason: `步骤数 ${unit.steps.length} > ${SYNTHESIS_CONFIG.maxSteps}，过于复杂` };
    }

    // 已经是 strategy 级别的经验不适合降级为工具
    if (unit.abstractionLevel === 'strategy') {
      return { shouldSynthesize: false, reason: 'strategy 级别经验不适合合成工具' };
    }

    // 步骤必须都是已知工具
    const unknownTools = unit.steps.filter(s => !this.isKnownTool(s.tool));
    if (unknownTools.length > 0) {
      return { shouldSynthesize: false, reason: `包含未知工具: ${unknownTools.map(s => s.tool).join(', ')}` };
    }

    return { shouldSynthesize: true, reason: '满足所有条件' };
  }

  // ── 2. 参数泛化 ──

  /**
   * 从经验步骤的具体值中提取参数模板
   */
  generalizeParams(unit: ExperienceUnit): ParamTemplate[] {
    const params: ParamTemplate[] = [];
    const seen = new Set<string>();

    for (const step of unit.steps) {
      for (const [key, value] of Object.entries(step.args)) {
        const paramKey = `${step.tool}.${key}`;
        if (seen.has(paramKey)) continue;
        seen.add(paramKey);

        const strValue = String(value);
        const param = this.inferParam(key, strValue, step.tool);
        if (param) {
          params.push(param);
        }
      }

      if (params.length >= SYNTHESIS_CONFIG.maxParams) break;
    }

    return params;
  }

  // ── 3. 命令合成 ──

  /**
   * 将经验单元合成为 .skillmate 工具定义
   */
  composeSkillmate(unit: ExperienceUnit, params: ParamTemplate[]): SynthesizedTool {
    const toolName = `synth_${unit.id.replace(/^exp_/, '')}`;
    const parameters = this.buildParamSchema(params);

    // 生成执行命令（链式多步骤）
    const commands = this.buildCommands(unit.steps, params);

    const definition: BuddySkillDef = {
      name: toolName,
      description: `[自动生成] ${unit.description}`,
      version: '1.0.0',
      author: 'ToolSynthesizer',
      tags: ['synthesized', unit.trigger.intent, ...unit.trigger.contextTags],
      permission: 'exec_safe',
      parameters,
      execute: commands.length === 1 ? commands[0] : commands,
      resultParser: 'text',
    };

    const qualityScore = this.assessQuality(unit, params);

    return {
      definition,
      sourceExperienceId: unit.id,
      sourceExperienceName: unit.name,
      generalizedParams: params,
      qualityScore,
    };
  }

  // ── 4. 质量门 ──

  /**
   * 验证生成的工具质量
   */
  validate(synthesized: SynthesizedTool): QualityGateResult {
    const issues: string[] = [];
    let score = synthesized.qualityScore;

    // 检查名称合法性
    if (!/^[a-z][a-z0-9_]*$/.test(synthesized.definition.name)) {
      issues.push('工具名不合法（应为小写字母开头的 snake_case）');
      score -= 0.2;
    }

    // 检查描述
    if (synthesized.definition.description.length < 10) {
      issues.push('描述过短');
      score -= 0.1;
    }

    // 检查参数数量
    const paramCount = Object.keys(synthesized.definition.parameters).length;
    if (paramCount === 0 && synthesized.sourceExperienceName.length > 0) {
      // 无参数的工具可能过于具体
      issues.push('无参数定义，可能过于具体');
      score -= 0.1;
    }

    // 检查命令合法性
    const commands = Array.isArray(synthesized.definition.execute)
      ? synthesized.definition.execute
      : [synthesized.definition.execute];
    for (const cmd of commands) {
      if (!cmd.command || cmd.command.trim().length === 0) {
        issues.push('存在空命令');
        score -= 0.3;
      }
      // 安全检查：不允许危险命令
      if (/[;&|`$()]/.test(cmd.command) && !cmd.command.includes('${')) {
        issues.push(`命令包含潜在危险字符: ${cmd.command.slice(0, 50)}`);
        score -= 0.3;
      }
    }

    // 检查参数引用完整性
    for (const param of synthesized.generalizedParams) {
      const refPattern = `{{${param.name}}}`;
      const allCmds = commands.map(c => c.command).join(' ');
      if (!allCmds.includes(refPattern) && !allCmds.includes(param.name)) {
        issues.push(`参数 ${param.name} 未在命令中引用`);
        score -= 0.05;
      }
    }

    score = Math.max(0, Math.min(1, score));

    return {
      passed: score >= SYNTHESIS_CONFIG.minQualityScore && issues.length < 3,
      score: Math.round(score * 100) / 100,
      issues,
    };
  }

  // ── 完整流程 ──

  /**
   * 尝试从经验单元合成工具（完整流程）
   */
  trySynthesize(unit: ExperienceUnit): { synthesized: SynthesizedTool; gate: QualityGateResult } | null {
    const decision = this.shouldSynthesize(unit);
    if (!decision.shouldSynthesize) {
      if (this.verbose) console.log(`  [Synthesizer] 跳过 ${unit.name}: ${decision.reason}`);
      return null;
    }

    const params = this.generalizeParams(unit);
    const synthesized = this.composeSkillmate(unit, params);
    const gate = this.validate(synthesized);

    if (!gate.passed) {
      if (this.verbose) console.log(`  [Synthesizer] 质量门拦截 ${unit.name}: ${gate.issues.join(', ')} (score: ${gate.score})`);
      return null;
    }

    if (this.verbose) console.log(`  [Synthesizer] 合成成功: ${synthesized.definition.name} (score: ${gate.score})`);
    return { synthesized, gate };
  }

  // ── 私有方法 ──

  /** 判断是否为已知工具 */
  private isKnownTool(toolName: string): boolean {
    // 内置工具 + 常见工具名
    const knownTools = new Set([
      'read_file', 'write_file', 'exec', 'search_files', 'list_files',
      'git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch',
      'search_web', 'fetch_url', 'get_time', 'system_info',
      'json_query', 'pdf_extract', 'npm_run', 'lint_check',
      'docker_ps', 'video_info', 'video_cut', 'tts_speak',
    ]);
    return knownTools.has(toolName) || toolName.startsWith('skill_') || toolName.startsWith('synth_');
  }

  /** 从值推断参数类型 */
  private inferParam(key: string, value: string, toolName: string): ParamTemplate | null {
    // 跳过常量/标志性的短值
    if (value.length <= 1) return null;
    // 跳过看起来像固定枚举的值
    if (/^(GET|POST|PUT|DELETE|HEAD)$/i.test(value)) return null;

    // 路径参数
    for (const { pattern, desc } of PATH_PATTERNS) {
      if (pattern.test(value)) {
        return { name: key, type: 'string', description: desc, required: true, inferredFrom: value };
      }
    }

    // 其他值模式
    for (const { test, type, desc } of VALUE_PATTERNS) {
      if (test(value)) {
        return { name: key, type, description: desc, required: true, inferredFrom: value };
      }
    }

    // 默认：短字符串参数
    if (value.length < 100) {
      return { name: key, type: 'string', description: `${key} 参数`, required: true, inferredFrom: value };
    }

    return null;
  }

  /** 构建参数 schema */
  private buildParamSchema(params: ParamTemplate[]): Record<string, SkillParamDef> {
    const schema: Record<string, SkillParamDef> = {};
    for (const p of params) {
      schema[p.name] = {
        type: p.type,
        description: p.description,
        required: p.required,
      };
    }
    return schema;
  }

  /** 构建执行命令 */
  private buildCommands(steps: ExperienceStep[], params: ParamTemplate[]): Array<{ command: string; timeout?: number }> {
    const paramNames = new Set(params.map(p => p.name));

    return steps.map(step => {
      let command = this.stepToCommand(step, paramNames);
      return { command, timeout: 30 };
    });
  }

  /** 将单个步骤转为 shell 命令 */
  private stepToCommand(step: ExperienceStep, paramNames: Set<string>): string {
    // 对于 exec 工具，直接提取 command 参数
    if (step.tool === 'exec' && typeof step.args.command === 'string') {
      return this.generalizeCommand(step.args.command, paramNames);
    }

    // 对于文件读取
    if (step.tool === 'read_file') {
      const path = step.args.path || step.args.filePath;
      return `cat ${this.generalizeValue(String(path), paramNames)}`;
    }

    // 对于文件写入
    if (step.tool === 'write_file') {
      const path = step.args.path || step.args.filePath;
      const content = step.args.content;
      if (typeof content === 'string' && content.length < 200) {
        return `echo ${JSON.stringify(this.generalizeValue(content, paramNames))} > ${this.generalizeValue(String(path), paramNames)}`;
      }
      return `# write to ${this.generalizeValue(String(path), paramNames)}`;
    }

    // 对于搜索
    if (step.tool === 'search_files') {
      const pattern = step.args.pattern || step.args.query;
      return `grep -r ${this.generalizeValue(String(pattern), paramNames)} .`;
    }

    // 对于 git 操作
    if (step.tool.startsWith('git_')) {
      const gitCmd = step.tool.replace('git_', 'git ');
      return gitCmd;
    }

    // 对于 web 搜索
    if (step.tool === 'search_web') {
      const query = step.args.query || step.args.q;
      return `# web search: ${this.generalizeValue(String(query), paramNames)}`;
    }

    // 默认：注释占位
    return `# ${step.tool}: ${JSON.stringify(step.args).slice(0, 100)}`;
  }

  /** 泛化命令中的具体值 */
  private generalizeCommand(command: string, paramNames: Set<string>): string {
    let result = command;
    for (const name of paramNames) {
      // 如果命令中包含了参数名的引用，保持不变
      if (result.includes(`{{${name}}}`)) continue;
    }
    return result;
  }

  /** 泛化单个值 */
  private generalizeValue(value: string, paramNames: Set<string>): string {
    // 如果值很短且看起来是参数名，直接引用
    if (paramNames.has(value)) return `{{${value}}}`;
    return value;
  }

  /** 评估合成质量 */
  private assessQuality(unit: ExperienceUnit, params: ParamTemplate[]): number {
    let score = 0.5; // 基础分

    // 置信度加权
    score += unit.stats.confidence * 0.2;

    // 成功次数加权（对数衰减）
    score += Math.min(0.2, Math.log2(unit.stats.successCount + 1) * 0.05);

    // 参数泛化程度（有参数比没参数好）
    if (params.length > 0) score += 0.1;

    // 步骤简洁性（步骤越少越好）
    if (unit.steps.length <= 2) score += 0.1;

    return Math.min(1, score);
  }
}
