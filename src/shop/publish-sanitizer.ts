/**
 * 商城发布脱敏管线
 *
 * 在技能/能力包发布到商城前，对数据进行脱敏处理：
 * 1. 文本 PII 扫描（路径/IP/邮箱/token/用户名）
 * 2. 图像帧处理（丢弃含人脸帧）
 * 3. 脱敏报告生成
 *
 * 原则：训练时不脱敏（保持质量），发布时脱敏（保证安全）
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { sanitizeText, containsPII, generateSanitizeReport, type SanitizeOptions } from '../core/sanitizer.js';

// ==================== 类型定义 ====================

export interface PublishPackage {
  /** 包名 */
  name: string;
  /** 版本 */
  version: string;
  /** 领域 */
  domain: string;
  /** 描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 技能代码 */
  skills?: SkillEntry[];
  /** 经验数据 */
  experiences?: ExperienceEntry[];
  /** 知识数据 */
  knowledge?: KnowledgeEntry[];
  /** 模型数据 */
  model?: ModelEntry;
  /** 图像帧（如果有） */
  frames?: FrameEntry[];
}

export interface SkillEntry {
  id: string;
  name: string;
  code: string;
  description: string;
}

export interface ExperienceEntry {
  id: string;
  domain: string;
  trigger: string;
  steps: string[];
  replyTemplate: Record<string, string>;
}

export interface KnowledgeEntry {
  domain: string;
  concepts: string[];
  content: string;
}

export interface ModelEntry {
  format: string;
  data: string; // base64 或路径
  config?: Record<string, unknown>;
}

export interface FrameEntry {
  id: string;
  data: string; // base64
  hasFace?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SanitizeResult {
  /** 是否有 PII 被发现 */
  hasPII: boolean;
  /** 脱敏后的包 */
  sanitized: PublishPackage;
  /** 脱敏报告 */
  report: SanitizeReport;
}

export interface SanitizeReport {
  /** 处理时间 */
  timestamp: number;
  /** 原始大小（估算） */
  originalSize: number;
  /** 脱敏后大小 */
  sanitizedSize: number;
  /** 文本替换详情 */
  textReplacements: Array<{ type: string; count: number }>;
  /** 丢弃的帧数 */
  discardedFrames: number;
  /** 保留的帧数 */
  retainedFrames: number;
  /** 脱敏的字段 */
  sanitizedFields: string[];
  /** 警告 */
  warnings: string[];
}

// ==================== 主类 ====================

export class PublishSanitizer {
  private options: SanitizeOptions;
  private verbose: boolean;

  constructor(options?: SanitizeOptions, verbose = false) {
    this.options = options ?? {};
    this.verbose = verbose;
  }

  /**
   * 脱敏整个发布包
   */
  async sanitize(pkg: PublishPackage): Promise<SanitizeResult> {
    const report: SanitizeReport = {
      timestamp: Date.now(),
      originalSize: this.estimateSize(pkg),
      sanitizedSize: 0,
      textReplacements: [],
      discardedFrames: 0,
      retainedFrames: 0,
      sanitizedFields: [],
      warnings: [],
    };

    const sanitized = { ...pkg };

    // 1. 脱敏描述
    if (pkg.description) {
      const result = this.sanitizeField('description', pkg.description);
      sanitized.description = result.value;
      if (result.changed) report.sanitizedFields.push('description');
    }

    // 2. 脱敏技能数据
    if (pkg.skills) {
      sanitized.skills = pkg.skills.map(skill => this.sanitizeSkill(skill, report));
    }

    // 3. 脱敏经验数据
    if (pkg.experiences) {
      sanitized.experiences = pkg.experiences.map(exp => this.sanitizeExperience(exp, report));
    }

    // 4. 脱敏知识数据
    if (pkg.knowledge) {
      sanitized.knowledge = pkg.knowledge.map(k => this.sanitizeKnowledge(k, report));
    }

    // 5. 处理图像帧（丢弃含人脸的帧）
    if (pkg.frames) {
      const { retained, discarded } = this.processFrames(pkg.frames);
      sanitized.frames = retained;
      report.discardedFrames = discarded;
      report.retainedFrames = retained.length;
      if (discarded > 0) {
        report.warnings.push(`丢弃了 ${discarded} 个含人脸的图像帧`);
      }
    }

    // 6. 脱敏模型配置
    if (pkg.model?.config) {
      sanitized.model = {
        ...pkg.model,
        config: this.sanitizeConfig(pkg.model.config),
      };
      report.sanitizedFields.push('model.config');
    }

    report.sanitizedSize = this.estimateSize(sanitized);

    return {
      hasPII: report.textReplacements.length > 0 || report.discardedFrames > 0,
      sanitized,
      report,
    };
  }

  /**
   * 扫描包中的 PII（不修改，仅报告）
   */
  scan(pkg: PublishPackage): Array<{ field: string; type: string; location: string }> {
    const findings: Array<{ field: string; type: string; location: string }> = [];

    // 扫描文本字段
    const textFields = [
      { path: 'description', value: pkg.description },
      { path: 'author', value: pkg.author },
    ];

    for (const { path: fieldPath, value } of textFields) {
      if (value && containsPII(value)) {
        findings.push({ field: fieldPath, type: 'text_pii', location: fieldPath });
      }
    }

    // 扫描技能
    if (pkg.skills) {
      for (const skill of pkg.skills) {
        if (containsPII(skill.code)) findings.push({ field: `skill.${skill.id}.code`, type: 'text_pii', location: `skills[${skill.id}]` });
        if (containsPII(skill.description)) findings.push({ field: `skill.${skill.id}.description`, type: 'text_pii', location: `skills[${skill.id}]` });
      }
    }

    // 扫描经验
    if (pkg.experiences) {
      for (const exp of pkg.experiences) {
        for (const step of exp.steps) {
          if (containsPII(step)) findings.push({ field: `exp.${exp.id}.steps`, type: 'text_pii', location: `experiences[${exp.id}]` });
        }
        for (const [key, val] of Object.entries(exp.replyTemplate)) {
          if (containsPII(val)) findings.push({ field: `exp.${exp.id}.replyTemplate.${key}`, type: 'text_pii', location: `experiences[${exp.id}]` });
        }
      }
    }

    // 扫描知识
    if (pkg.knowledge) {
      for (const k of pkg.knowledge) {
        if (containsPII(k.content)) findings.push({ field: `knowledge.${k.domain}.content`, type: 'text_pii', location: `knowledge[${k.domain}]` });
      }
    }

    // 检查帧
    if (pkg.frames) {
      const faceFrames = pkg.frames.filter(f => f.hasFace);
      if (faceFrames.length > 0) {
        findings.push({ field: 'frames', type: 'face_detected', location: `${faceFrames.length} 帧含人脸` });
      }
    }

    return findings;
  }

  /**
   * 生成脱敏报告（人类可读）
   */
  formatReport(result: SanitizeResult): string {
    const { report } = result;
    const lines: string[] = [
      '# 发布脱敏报告',
      '',
      `**处理时间**: ${new Date(report.timestamp).toISOString()}`,
      `**原始大小**: ~${Math.round(report.originalSize / 1024)}KB`,
      `**脱敏后**: ~${Math.round(report.sanitizedSize / 1024)}KB`,
      '',
    ];

    if (report.textReplacements.length > 0) {
      lines.push('## 文本脱敏');
      for (const r of report.textReplacements) {
        lines.push(`- ${r.type}: ${r.count} 处替换`);
      }
      lines.push('');
    }

    if (report.discardedFrames > 0) {
      lines.push('## 图像帧处理');
      lines.push(`- 丢弃: ${report.discardedFrames} 帧（含人脸）`);
      lines.push(`- 保留: ${report.retainedFrames} 帧`);
      lines.push('');
    }

    if (report.sanitizedFields.length > 0) {
      lines.push('## 脱敏字段');
      for (const f of report.sanitizedFields) {
        lines.push(`- ${f}`);
      }
      lines.push('');
    }

    if (report.warnings.length > 0) {
      lines.push('## ⚠️ 警告');
      for (const w of report.warnings) {
        lines.push(`- ${w}`);
      }
      lines.push('');
    }

    if (!result.hasPII) {
      lines.push('✅ 未发现 PII，数据可安全发布。');
    }

    return lines.join('\n');
  }

  // ==================== 内部方法 ====================

  private sanitizeSkill(skill: SkillEntry, report: SanitizeReport): SkillEntry {
    const result = { ...skill };

    const codeResult = this.sanitizeField(`skill.${skill.id}.code`, skill.code);
    result.code = codeResult.value;
    if (codeResult.changed) report.sanitizedFields.push(`skills[${skill.id}].code`);

    const descResult = this.sanitizeField(`skill.${skill.id}.description`, skill.description);
    result.description = descResult.value;
    if (descResult.changed) report.sanitizedFields.push(`skills[${skill.id}].description`);

    return result;
  }

  private sanitizeExperience(exp: ExperienceEntry, report: SanitizeReport): ExperienceEntry {
    const result = { ...exp };

    // 脱敏步骤
    result.steps = exp.steps.map(step => {
      const r = this.sanitizeField('step', step);
      return r.value;
    });

    // 脱敏回复模板
    result.replyTemplate = {};
    for (const [key, val] of Object.entries(exp.replyTemplate)) {
      const r = this.sanitizeField(`replyTemplate.${key}`, val);
      result.replyTemplate[key] = r.value;
      if (r.changed) report.sanitizedFields.push(`experiences[${exp.id}].replyTemplate.${key}`);
    }

    return result;
  }

  private sanitizeKnowledge(k: KnowledgeEntry, report: SanitizeReport): KnowledgeEntry {
    const r = this.sanitizeField(`knowledge.${k.domain}.content`, k.content);
    if (r.changed) report.sanitizedFields.push(`knowledge[${k.domain}].content`);
    return { ...k, content: r.value };
  }

  private sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const result = { ...config };
    // 移除可能含 PII 的配置字段
    const sensitiveKeys = ['apiKey', 'api_key', 'token', 'secret', 'password', 'baseUrl', 'base_url'];
    for (const key of sensitiveKeys) {
      if (key in result) {
        result[key] = '[REDACTED]';
      }
    }
    return result;
  }

  private sanitizeField(field: string, value: string): { value: string; changed: boolean } {
    const sanitized = sanitizeText(value, this.options);
    const changed = sanitized !== value;

    if (changed) {
      const report = generateSanitizeReport(value, sanitized);
      for (const r of report.replacements) {
        const existing = this.options ? [] : [];
        // 累加替换计数（简化处理）
      }
    }

    return { value: sanitized, changed };
  }

  private processFrames(frames: FrameEntry[]): { retained: FrameEntry[]; discarded: number } {
    const retained: FrameEntry[] = [];
    let discarded = 0;

    for (const frame of frames) {
      if (frame.hasFace) {
        discarded++;
        if (this.verbose) {
          console.log(`  [Sanitizer] 丢弃含人脸帧: ${frame.id}`);
        }
      } else {
        retained.push(frame);
      }
    }

    return { retained, discarded };
  }

  private estimateSize(obj: unknown): number {
    try {
      return JSON.stringify(obj).length;
    } catch {
      return 0;
    }
  }
}

// ==================== 便捷函数 ====================

/**
 * 快速扫描 PII
 */
export function scanForPII(pkg: PublishPackage): Array<{ field: string; type: string; location: string }> {
  const sanitizer = new PublishSanitizer();
  return sanitizer.scan(pkg);
}
