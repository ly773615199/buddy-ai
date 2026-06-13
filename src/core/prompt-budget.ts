/**
 * Prompt 预算管理器
 *
 * 核心思想：System Prompt 不是越大越好。
 * 学生向老师提问时，要精炼、有重点，把有限的"自我介绍"空间用在刀刃上。
 *
 * 工作方式：
 * 1. 各模块往 manager 里塞 Prompt 段（segment）
 * 2. 每个段有优先级和 required 标记
 * 3. assemble() 时按优先级填充，超预算截断低优先级段
 * 4. required 段不可丢弃，宁可截断其他段也要保留
 */

// ==================== 类型定义 ====================

export interface PromptSegment {
  /** 唯一标识，用于去重和替换 */
  id: string;
  /** 来源模块 */
  source: string;
  /** 优先级 0-100，越高越重要 */
  priority: number;
  /** 内容 */
  content: string;
  /** 是否必须保留（安全相关等） */
  required: boolean;
  /** 最大允许长度（字符数），超长自动截断 */
  maxLength?: number;
}

export interface BudgetReport {
  totalSegments: number;
  includedSegments: string[];
  droppedSegments: string[];
  truncatedSegments: string[];
  estimatedTokens: number;
  budgetTokens: number;
  utilization: number;  // 0-1
}

// ==================== 优先级常量 ====================

export const PRIORITY = {
  /** 安全指令、权限边界 — 绝不可丢 */
  SECURITY: 100,
  /** 核心行为指令 */
  CORE_INSTRUCTION: 95,
  /** 信任度/工具权限 */
  TRUST_PERMISSIONS: 90,
  /** 工具列表 */
  TOOLS: 80,
  /** 经验提示（来自经验模型） */
  EXPERIENCE_HINT: 75,
  /** 人格属性 */
  PERSONALITY: 70,
  /** 情绪状态 */
  EMOTION: 60,
  /** 用户认知画像 */
  COGNITIVE: 50,
  /** 记忆检索 */
  MEMORY: 40,
  /** 领域知识 */
  DOMAIN_KNOWLEDGE: 30,
  /** 动态技能列表 */
  SKILLS: 20,
  /** 补充信息（可随时丢弃） */
  SUPPLEMENTARY: 10,
} as const;

// ==================== 主类 ====================

export class PromptBudgetManager {
  private segments: Map<string, PromptSegment> = new Map();
  private maxTokens: number;

  constructor(maxTokens = 4096) {
    this.maxTokens = maxTokens;
  }

  /**
   * 添加或替换 Prompt 段（同 id 替换）
   */
  add(segment: PromptSegment): void {
    this.segments.set(segment.id, segment);
  }

  /**
   * 批量添加
   */
  addMany(segments: PromptSegment[]): void {
    for (const seg of segments) this.add(seg);
  }

  /**
   * 移除指定段
   */
  remove(id: string): void {
    this.segments.delete(id);
  }

  /**
   * 清空所有段
   */
  clear(): void {
    this.segments.clear();
  }

  /**
   * 设置预算上限
   */
  setBudget(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  /**
   * 组装最终 Prompt
   *
   * 算法（借鉴 AIOS 动态上下文管理）：
   * 1. 根据 taskType 动态调整优先级权重
   * 2. required 段优先，按 priority 排序
   * 3. 非 required 段按 priority 排序
   * 4. 依次填充，直到预算用尽
   * 5. 超预算的 required 段强制截断保留
   * 6. 超预算的非 required 段直接丢弃
   */
  assemble(taskType?: string): string {
    // 根据任务类型动态调整优先级（借鉴 AIOS Kernel 上下文管理）
    const priorityBoost = this.getTaskTypeBoost(taskType);

    const all = Array.from(this.segments.values());

    // 排序：required 优先，同级别按调整后 priority 降序
    all.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      const pa = (a.priority + (priorityBoost.get(a.source) ?? 0));
      const pb = (b.priority + (priorityBoost.get(b.source) ?? 0));
      return pb - pa;
    });

    let budget = this.maxTokens;
    const result: string[] = [];

    for (const seg of all) {
      let content = seg.content;

      // maxLength 限制
      if (seg.maxLength && content.length > seg.maxLength) {
        content = content.slice(0, seg.maxLength) + '\n...[auto-truncated]';
      }

      const tokens = this.estimateTokens(content);

      if (tokens <= budget) {
        result.push(this.wrapSegment(seg, content));
        budget -= tokens;
      } else if (seg.required && budget > 30) {
        // required 段：截断到剩余预算
        const truncated = this.truncateToTokens(content, budget);
        result.push(this.wrapSegment(seg, truncated));
        budget = 0;
      }
      // 非 required 段超预算 → 丢弃
    }

    return result.join('\n\n');
  }

  /**
   * 生成预算报告
   */
  getReport(): BudgetReport {
    const all = Array.from(this.segments.values());
    const assembled = this.assemble();

    // 反向检测哪些段被包含了
    const included: string[] = [];
    const dropped: string[] = [];
    const truncated: string[] = [];

    for (const seg of all) {
      if (assembled.includes(seg.id)) {
        included.push(seg.id);
      } else {
        dropped.push(seg.id);
      }
    }

    return {
      totalSegments: all.length,
      includedSegments: included,
      droppedSegments: dropped,
      truncatedSegments: truncated,
      estimatedTokens: this.estimateTokens(assembled),
      budgetTokens: this.maxTokens,
      utilization: this.estimateTokens(assembled) / this.maxTokens,
    };
  }

  /**
   * 获取当前总 token 估算
   */
  getTotalEstimatedTokens(): number {
    let total = 0;
    for (const seg of this.segments.values()) {
      total += this.estimateTokens(seg.content);
    }
    return total;
  }

  /**
   * 检查是否超预算
   */
  isOverBudget(): boolean {
    return this.getTotalEstimatedTokens() > this.maxTokens;
  }

  // ==================== 内部工具 ====================

  /**
   * 粗略 token 估算
   * 英文约 4 字符/token，中文约 1.5 字符/token
   * 取保守值 2 字符/token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 2);
  }

  /**
   * 截断到指定 token 数
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 2;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n...[budget truncated]';
  }

  /**
   * 包装段内容（加来源标记，便于调试）
   */
  private wrapSegment(seg: PromptSegment, content: string): string {
    return `<!-- ${seg.id} [${seg.source} p${seg.priority}] -->\n${content}`;
  }

  /**
   * 根据任务类型返回各来源的优先级加成（借鉴 AIOS 动态上下文管理）
   *
   * reasoning: 记忆 + 领域知识优先级提升
   * tools: 工具列表优先级提升
   * chat: 人格 + 情绪优先级提升
   * background: 最小化 prompt
   */
  private getTaskTypeBoost(taskType?: string): Map<string, number> {
    const boost = new Map<string, number>();
    switch (taskType) {
      case 'reasoning':
        boost.set('memory', 20);      // MEMORY 40→60
        boost.set('knowledge', 20);   // DOMAIN_KNOWLEDGE 30→50
        boost.set('experience', 10);  // EXPERIENCE_HINT 75→85
        break;
      case 'tools':
        boost.set('tools', 15);       // TOOLS 80→95
        boost.set('skills', 10);      // SKILLS 20→30
        break;
      case 'chat':
        boost.set('personality', 15); // PERSONALITY 70→85
        boost.set('emotion', 15);     // EMOTION 60→75
        boost.set('cognitive', 10);   // COGNITIVE 50→60
        break;
      case 'background':
        boost.set('supplementary', -5); // 降低补充信息优先级
        break;
    }
    return boost;
  }
}
