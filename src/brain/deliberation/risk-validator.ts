/**
 * 风险校验器 — 审议结果的安全检查
 *
 * 检查项：
 * - 不可逆操作（写/删/部署）
 * - 信息缺失（missingInfo > 0 且 vote=proceed → 强制 refine）
 * - 低置信度（confidence < 0.4）
 * - 子议题未解决
 */

import type { Topic, DebateResult, RiskAssessment } from './types.js';

const WRITE_PATTERNS = /写|创建|删除|部署|新建|覆盖|write|create|delete|deploy|overwrite|remove/i;
const DESTRUCTIVE_PATTERNS = /rm\s+-rf|drop\s+table|format|mkfs|dd\s+if=/i;

export class RiskValidator {
  validate(topic: Topic, debate: DebateResult): RiskAssessment {
    const risks: RiskAssessment['risks'] = [];

    // 1. 不可逆操作检查
    if (WRITE_PATTERNS.test(topic.coreQuestion)) {
      risks.push({
        description: '涉及文件写入/删除操作',
        severity: 'medium',
        mitigation: '执行前确认目标文件和操作内容',
      });
    }
    if (DESTRUCTIVE_PATTERNS.test(topic.coreQuestion)) {
      risks.push({
        description: '检测到破坏性操作模式',
        severity: 'high',
        mitigation: '必须用户明确确认',
      });
    }

    // 2. 信息缺失检查 — 有缺失但投票 proceed → 强制 refine
    if (topic.missingInfo.length > 0 && debate.finalVote.action === 'proceed') {
      risks.push({
        description: `缺失关键信息: ${topic.missingInfo.join(', ')}`,
        severity: 'high',
        mitigation: '先向用户确认缺失信息',
      });
      debate.finalVote.action = 'refine';
    }

    // 3. 低置信度检查
    if (debate.finalVote.confidence < 0.4) {
      risks.push({
        description: '审议置信度过低',
        severity: 'medium',
        mitigation: '建议用户补充信息后重试',
      });
    }

    // 4. 必要子议题未解决检查
    const unresolved = topic.subQuestions.filter(q => q.required);
    if (unresolved.length > 0 && debate.finalVote.action === 'proceed') {
      risks.push({
        description: `有 ${unresolved.length} 个必要子议题未解决`,
        severity: 'high',
        mitigation: '先回答子议题再执行',
      });
      debate.finalVote.action = 'refine';
    }

    return {
      level: risks.some(r => r.severity === 'high') ? 'high'
        : risks.some(r => r.severity === 'medium') ? 'medium'
        : 'low',
      risks,
      canProceed: !risks.some(r => r.severity === 'high'),
      userConfirmations: risks.filter(r => r.severity === 'high').map(r => r.mitigation),
    };
  }
}
