/**
 * 规则引擎 — 左脑的核心决策组件
 *
 * 从 agent.ts 的 8 条 if-else 迁移为 Rule 对象
 * 支持内置规则 + 学习规则 + 否定规则
 * 按优先级匹配，可解释、可审计
 */

import type {
  TaskSignal, ResourceState, ExecutionPlan, IntuitionSignal,
  BodyState, Rule,
} from '../types.js';
import type {
  DAGSkeleton, SkeletonStep, GateResult, GateViolation, TaskDAG,
} from '../../orchestrate/types.js';
import type { ToolRegistry } from '../../tools/registry.js';

export class RuleEngine {
  private rules: Rule[] = [];
  private negations: Map<string, number> = new Map();

  constructor() {
    this.loadBuiltinRules();
  }

  /** 加载内置规则（从 agent.ts 迁移的 8 条 if-else） */
  private loadBuiltinRules(): void {
    const now = Date.now();
    this.rules = [
      {
        id: 'builtin-git-heavy',
        name: 'Git 重度操作 → DAG 编排',
        priority: 90,
        condition: (signal) => signal.shouldUseDAG && signal.domains.includes('git'),
        action: (signal) => ({
          mode: 'sequential', reason: 'DAG 编排: git 重度操作',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.8, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      {
        id: 'builtin-code-complex',
        name: '复杂代码任务 → 主模型',
        priority: 70,
        condition: (signal) => signal.complexity === 'complex' && signal.domains.includes('code'),
        action: (signal, resources) => ({
          mode: 'single', reason: '复杂代码任务，使用主模型',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.7, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-web-search',
        name: 'Web 搜索任务 → 轻量模型 + 工具',
        priority: 65,
        condition: (signal) => signal.domains.includes('web'),
        action: (signal) => ({
          mode: 'single', reason: 'Web 搜索，轻量模型 + 工具',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.8, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-low-confidence',
        name: '低置信度 → 经验辅助',
        priority: 50,
        condition: (signal, resources) => resources.experienceHit !== null && resources.localConfidence < 0.5,
        action: (signal, resources) => ({
          mode: 'single', reason: '低置信度，经验辅助',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }, { id: 'exp', type: 'experience' }],
          confidence: 0.6, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-high-load',
        name: '高负载 → 降级模型',
        priority: 85,
        condition: (signal, resources, _intuition, body) => body !== undefined && body.load > 80,
        action: (signal) => ({
          mode: 'single', reason: '系统高负载，降级到轻量模型',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.7, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-low-energy',
        name: '低精力 → 简化回复',
        priority: 60,
        condition: (signal, resources, _intuition, body) => body !== undefined && body.energy < 30,
        action: (signal) => ({
          mode: 'local_only', reason: '精力低，使用本地模型简化回复',
          selectedNodes: [{ id: 'local', type: 'local_expert' }],
          confidence: 0.7, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-confused',
        name: '高困惑度 → 澄清',
        priority: 75,
        condition: (signal, resources, _intuition, body) => body !== undefined && body.confusionLevel > 70,
        action: (signal) => ({
          mode: 'single', reason: '用户困惑，使用主模型详细解释',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.8, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-knowledge-query',
        name: '知识查询意图 → 优先本地知识源',
        priority: 55,
        condition: (signal) => signal.domains.includes('knowledge'),
        action: (signal) => ({
          mode: 'single', reason: '知识查询，优先检索本地/飞书/网络知识源',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.7, source: 'rule',
          // 附加提示：让 message-processor 优先走知识源检索
          _knowledgeHint: 'prefer_knowledge_sources',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 文件操作规则 ──
      {
        id: 'builtin-file-write',
        name: '文件写入操作 → 直接执行',
        priority: 88,
        condition: (signal) => {
          const content = (signal.content ?? "")?.toLowerCase() ?? "";
          return /^(写入|保存|创建|编辑|修改|write|save|create|edit)\s*\S+/.test(content)
            || /^打开(文件|目录)/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '文件写入操作，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-file-read',
        name: '文件读取操作 → 直接执行',
        priority: 87,
        condition: (signal) => {
          const content = (signal.content ?? "")?.toLowerCase() ?? "";
          return /^(读取|查看|打开|cat|read|head|tail|less|more)\s+\S+/.test(content)
            || /^(ls|dir|find|tree)\s/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '文件读取操作，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── Git 操作规则 ──
      {
        id: 'builtin-git-status',
        name: 'git status/diff/log → 直接执行',
        priority: 92,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^git\s+(status|diff|log|show|branch|remote|stash)\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: 'Git 查询命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.95, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-git-commit',
        name: 'git commit/push/merge → 直接执行',
        priority: 91,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^git\s+(commit|push|merge|pull|rebase|checkout|switch)\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: 'Git 写操作，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 包管理规则 ──
      {
        id: 'builtin-npm-install',
        name: 'npm install/run/test/build → 直接执行',
        priority: 86,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(npm|yarn|pnpm)\s+(install|run|test|build|start|dev|ci|update|uninstall)\b/.test(content)
            || /^pip\s+(install|uninstall|freeze|list)\b/.test(content)
            || /^pip3?\s+install\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '包管理命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 构建编译规则 ──
      {
        id: 'builtin-build',
        name: 'tsc/make/cargo build → 直接执行',
        priority: 84,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(tsc|npx\s+tsc|make|cargo\s+(build|test|run|check)|cmake|gradle|mvn)\b/.test(content)
            || /^(npm\s+run\s+(build|compile|tsc))\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '构建编译命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.85, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── Docker 规则 ──
      {
        id: 'builtin-docker',
        name: 'docker 命令 → 直接执行',
        priority: 83,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^docker\s+(ps|logs|build|run|stop|rm|exec|images|compose|pull|push|inspect|stats|top)\b/.test(content)
            || /^docker-compose\s/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: 'Docker 命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 网络调试规则 ──
      {
        id: 'builtin-network',
        name: 'curl/ping/wget → 直接执行',
        priority: 82,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(curl|wget|ping|traceroute|nslookup|dig|netstat|ss|lsof)\b/.test(content)
            || /^(ifconfig|ip\s+addr)\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '网络调试命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 代码分析规则 ──
      {
        id: 'builtin-code-lint',
        name: 'eslint/tsc --noEmit/prettier → 直接执行',
        priority: 81,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(npx\s+)?(eslint|prettier|tsc\s+--noEmit|biome|deno\s+lint)\b/.test(content)
            || /^(npm\s+run\s+(lint|format|check|typecheck))\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '代码分析命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.85, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
      {
        id: 'builtin-code-search',
        name: 'grep/find/ripgrep 搜索 → 直接执行',
        priority: 80,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(grep|rg|find|ag|ack|wc\s+-l)\b/.test(content)
            || /^(cat|head|tail)\s+.*\|/.test(content); // 管道命令
        },
        action: (signal) => ({
          mode: 'single', reason: '代码搜索命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.85, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 系统运维规则 ──
      {
        id: 'builtin-sysadmin',
        name: '系统运维命令 → 直接执行',
        priority: 79,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(ps|top|htop|kill|killall|nohup|systemctl|journalctl|df|du|free|uname|whoami|which|whereis|env|export|chmod|chown|ln)\b/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '系统运维命令，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.85, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 时间/计算规则 ──
      {
        id: 'builtin-time-calc',
        name: '时间/日期/计算查询 → 直接执行',
        priority: 78,
        condition: (signal) => {
          const content = (signal.content ?? "");
          return /^(现在几点|今天(日期|几号)|当前时间|what\s+time|current\s+time|date\s+today)/i.test(content)
            || /^(\d+[\+\-\*\/\%]\d+|计算\s+\d)/.test(content)
            || /^(convert|换算|转换)\s/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '时间/计算查询，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.9, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 进程管理规则 ──
      {
        id: 'builtin-process',
        name: '进程/端口查看 → 直接执行',
        priority: 77,
        condition: (signal) => {
          const content = (signal.content ?? "")?.trim() ?? "";
          return /^(lsof\s+-i|ss\s+-tlnp|netstat\s+-tlnp|fuser)\b/.test(content)
            || /^查看.*(端口|进程|服务)/.test(content)
            || /^哪个(进程|服务)/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '进程/端口查询，直接执行',
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }],
          confidence: 0.85, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 工具推荐规则（经验系统） ──
      {
        id: 'builtin-experience-route',
        name: '经验路由命中 → 优先使用经验',
        priority: 74,
        condition: (signal, resources) => resources.experienceHit !== null,
        action: (signal, resources) => ({
          mode: 'single', reason: `经验路由命中: ${resources.experienceHit!.id}`,
          selectedNodes: [{ id: 'auto', type: 'cloud_node' }, { id: 'exp', type: 'experience' }],
          confidence: 0.8, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },

      // ── 问候/闲聊规则 ──
      {
        id: 'builtin-greeting',
        name: '问候/闲聊 → 简单回复',
        priority: 40,
        condition: (signal) => {
          const content = (signal.content ?? "").toLowerCase().trim();
          return /^(你好|hello|hi|hey|嗨|在吗|早上好|good\s*morning|good\s*evening|晚安|good\s*night|谢谢|thanks|thank\s*you|再见|bye|拜拜)$/.test(content);
        },
        action: (signal) => ({
          mode: 'single', reason: '问候/闲聊，简单回复',
          selectedNodes: [{ id: 'local', type: 'local_expert' }],
          confidence: 0.95, source: 'rule',
        }),
        source: 'builtin',
        stats: { hits: 0, successes: 0, lastUsed: 0 },
        createdAt: now,
      },
    ];
  }

  /** 评估规则（按优先级匹配第一个） */
  evaluate(
    signal: TaskSignal,
    resources: ResourceState,
    intuition?: IntuitionSignal,
    body?: BodyState,
  ): ExecutionPlan | null {
    const sorted = [...this.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sorted) {
      const fingerprint = this.fingerprint(signal);
      if (this.negations.has(fingerprint)) continue;

      if (rule.condition(signal, resources, intuition, body)) {
        rule.stats.hits++;
        rule.stats.lastUsed = Date.now();
        return rule.action(signal, resources);
      }
    }
    return null;
  }

  /** 添加学习到的规则 */
  addLearnedRule(rule: Rule): void {
    const maxLearned = 50;
    if (this.rules.filter(r => r.source === 'learned').length >= maxLearned) {
      const learned = this.rules.filter(r => r.source === 'learned');
      const oldest = learned.reduce((a, b) => a.stats.lastUsed < b.stats.lastUsed ? a : b);
      this.rules = this.rules.filter(r => r.id !== oldest.id);
    }
    this.rules.push(rule);
  }

  /** 添加否定规则 */
  addNegation(signal: TaskSignal): void {
    const fp = this.fingerprint(signal);
    this.negations.set(fp, (this.negations.get(fp) || 0) + 1);
  }

  /** 规则反馈 */
  feedback(ruleId: string, success: boolean): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.stats.successes += success ? 1 : 0;
    }
  }

  /** 淘汰低效规则 */
  prune(maxAge: number, minSuccessRate: number): number {
    const now = Date.now();
    const before = this.rules.length;
    this.rules = this.rules.filter(r => {
      if (r.source === 'builtin') return true;
      const age = now - r.stats.lastUsed;
      const successRate = r.stats.hits > 0 ? r.stats.successes / r.stats.hits : 0;
      return age < maxAge && (r.stats.hits === 0 || successRate >= minSuccessRate);
    });
    return before - this.rules.length;
  }

  /** 获取所有规则 */
  getRules(): Rule[] {
    return [...this.rules];
  }

  getStats() {
    return {
      totalRules: this.rules.length,
      builtinRules: this.rules.filter(r => r.source === 'builtin').length,
      learnedRules: this.rules.filter(r => r.source === 'learned').length,
      negations: this.negations.size,
    };
  }

  private fingerprint(signal: TaskSignal): string {
    return `${signal.domains.sort().join(',')}|${signal.complexity}|${signal.taskType}`;
  }

  // ==================== Gate-1: 左脑规划门控 ====================

  /**
   * 验证 DAG 骨架的合理性
   * 在 planner 生成骨架后、Skill 绑定前调用
   */
  validateDAGSkeleton(
    skeleton: DAGSkeleton,
    signal: TaskSignal,
    resources: ResourceState,
  ): GateResult {
    const violations: GateViolation[] = [];

    // ── 规则 1: 简单任务不应拆分 ──
    if (signal.complexity === 'simple' && skeleton.steps.length > 1) {
      violations.push({
        rule: 'over-split-simple',
        severity: 'block',
        description: `简单任务被拆分为 ${skeleton.steps.length} 步`,
        action: 'downgrade_to_single',
      });
    }

    // ── 规则 2: 步骤数上限 ──
    const maxSteps: Record<string, number> = { simple: 1, medium: 3, complex: 5 };
    const limit = maxSteps[signal.complexity] ?? 5;
    if (skeleton.steps.length > limit) {
      violations.push({
        rule: 'too-many-steps',
        severity: 'warn',
        description: `${signal.complexity} 任务最多 ${limit} 步，实际 ${skeleton.steps.length} 步`,
        action: 'replan',
      });
    }

    // ── 规则 3: 领域一致性 ──
    const allowedCategories = this.getAllowedCategories(signal.domains);
    for (const step of skeleton.steps) {
      if (step.suggestedCategory && !allowedCategories.has(step.suggestedCategory)) {
        violations.push({
          rule: 'domain-mismatch',
          severity: 'block',
          description: `步骤 "${step.name}" 的类别 "${step.suggestedCategory}" 与任务领域 [${signal.domains.join(',')}] 不匹配`,
          action: 'remove_step',
          taskId: step.id,
        });
      }
    }

    // ── 规则 4: 依赖环检测 ──
    if (this.hasCycle(skeleton.steps)) {
      violations.push({
        rule: 'dependency-cycle',
        severity: 'block',
        description: '步骤依赖存在循环',
        action: 'replan',
      });
    }

    // ── 规则 5: 资源充足性 ──
    if (resources.budgetRemaining < skeleton.steps.length * 0.01) {
      violations.push({
        rule: 'budget-insufficient',
        severity: 'warn',
        description: '预算可能不足',
        action: 'reduce_steps',
      });
    }

    const blocks = violations.filter(v => v.severity === 'block');
    if (blocks.length > 0) {
      return { passed: false, violations, action: blocks[0].action as GateResult['action'] };
    }
    return { passed: true, violations: [], action: 'proceed' };
  }

  // ==================== Gate-2: 工具-意图验证 ====================

  /**
   * 验证解析后的 DAG 中工具选择的合理性
   * 在 SkillResolver 完成后、执行前调用
   */
  validateResolvedDAG(
    dag: TaskDAG,
    signal: TaskSignal,
    registry: ToolRegistry,
    toolHealth?: import('../types.js').ToolHealthSummary,
  ): GateResult {
    const violations: GateViolation[] = [];
    const allowedCategories = this.getAllowedCategories(signal.domains);
    const removedIds = new Set<string>();

    for (const [taskId, task] of dag.tasks) {
      // ── 规则 1: 工具存在性 ──
      const tool = registry.get(task.tool);
      if (!tool) {
        violations.push({
          rule: 'tool-not-found',
          severity: 'block',
          description: `任务 "${task.name}" 引用不存在的工具 "${task.tool}"`,
          action: 'remove_task',
          taskId,
        });
        removedIds.add(taskId);
        continue;
      }

      // ── 规则 2: 工具-意图一致性（类别围栏）──
      const toolCat = this.getToolCategory(task.tool);
      if (toolCat && !allowedCategories.has(toolCat)) {
        violations.push({
          rule: 'tool-intent-mismatch',
          severity: 'block',
          description: `任务 "${task.name}" 使用工具 "${task.tool}" (${toolCat})，但任务领域 [${signal.domains.join(',')}] 不需要此工具类别`,
          action: 'remove_task',
          taskId,
        });
        removedIds.add(taskId);
      }

      // ── 规则 3: 工具健康度 ──
      if (toolHealth) {
        const health = toolHealth.scores[task.tool];
        if (health !== undefined && health < 30) {
          violations.push({
            rule: 'tool-unreliable',
            severity: 'warn',
            description: `工具 "${task.tool}" 可靠度过低 (${health}%)`,
            action: 'warn',
            taskId,
          });
        }
      }
    }

    // ── 规则 4: 移除任务后的依赖完整性 ──
    if (removedIds.size > 0) {
      for (const [taskId, task] of dag.tasks) {
        if (removedIds.has(taskId)) continue;
        const hasOrphanedDep = task.deps.some(depId => removedIds.has(depId));
        if (hasOrphanedDep) {
          violations.push({
            rule: 'orphaned-task',
            severity: 'warn',
            description: `任务 "${task.name}" 的依赖被移除，将被跳过`,
            action: 'skip_task',
            taskId,
          });
        }
      }
    }

    const blocks = violations.filter(v => v.severity === 'block');
    return {
      passed: blocks.length === 0,
      violations,
      action: blocks.length > 0 ? 'remove_violations' : 'proceed',
    };
  }

  // ==================== 辅助方法 ====================

  /** 领域 → 允许的工具类别映射 */
  private getAllowedCategories(domains: string[]): Set<string> {
    const map: Record<string, string[]> = {
      code: ['code_analysis', 'file_ops', 'system'],
      web: ['web_search', 'file_ops'],
      git: ['git', 'file_ops', 'system'],
      voice: ['voice'],
      chat: ['chat'],
      data: ['web_search', 'file_ops'],
      architect: ['code_analysis', 'file_ops'],
      test: ['code_analysis', 'system'],
      review: ['code_analysis'],
      knowledge: ['web_search', 'file_ops'],
      writing: ['file_ops'],
    };
    const result = new Set<string>();
    for (const d of domains) {
      for (const c of (map[d] ?? [])) result.add(c);
    }
    // file_ops 和 system 总是允许
    result.add('file_ops');
    result.add('system');
    return result;
  }

  /** 工具名 → 类别 */
  private getToolCategory(toolName: string): string | null {
    const categoryMap: Record<string, string> = {
      analyze_file: 'code_analysis', find_references: 'code_analysis',
      project_symbols: 'code_analysis', project_context: 'code_analysis',
      project_deps: 'code_analysis',
      exec: 'system', read_file: 'file_ops', write_file: 'file_ops',
      list_files: 'file_ops', search_files: 'file_ops',
      scan_project: 'file_ops', project_index_rebuild: 'file_ops',
      project_index_stats: 'system',
      search_web: 'web_search', fetch_url: 'web_search', browser: 'web_search',
      git_status: 'git', git_log: 'git', git_diff: 'git',
      tts_speak: 'voice',
    };
    return categoryMap[toolName] ?? null;
  }

  /** 检测依赖环（DFS） */
  private hasCycle(steps: SkeletonStep[]): boolean {
    const adj = new Map<string, string[]>();
    for (const s of steps) adj.set(s.id, s.deps);

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      for (const dep of (adj.get(id) ?? [])) {
        if (dfs(dep)) return true;
      }
      inStack.delete(id);
      return false;
    };

    for (const s of steps) {
      if (dfs(s.id)) return true;
    }
    return false;
  }
}
