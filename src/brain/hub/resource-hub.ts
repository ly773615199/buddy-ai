/**
 * ResourceHub — 统一资源画像系统
 *
 * 职责:
 * 1. 注册所有可用资源（模型/工具/本地专家/知识源）
 * 2. 维护资源画像（成功率/延迟/成本/擅长任务）
 * 3. 提供查询接口（getActive/recommend/getHealth）
 * 4. 接收执行反馈（recordOutcome → 更新画像）
 *
 * 不做的事:
 * - 不管理资源生命周期（那是 ModelPool/SkillManager 的事）
 * - 不做调度决策（那是 Scheduler 的事）
 * - 不做执行（那是 PlanExecutor 的事）
 */

export interface ResourceProfile {
  id: string;
  type: 'model' | 'tool' | 'expert' | 'knowledge_source';
  name: string;

  // 画像数据
  stats: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    totalCost: number;
    lastUsedAt: number;
  };

  // 擅长任务（从 DecisionRecorder 学习）
  strengths: {
    taskTypes: Record<string, { attempts: number; successes: number }>;
    domains: Record<string, { attempts: number; successes: number }>;
  };

  // 状态
  status: 'active' | 'degraded' | 'unavailable' | 'unknown';
  healthScore: number;  // 0-100
  lastHealthCheck: number;
}

export interface ResourceOutcome {
  success: boolean;
  latencyMs: number;
  cost?: number;
  taskType?: string;
  domain?: string;
}

export class ResourceHub {
  private profiles: Map<string, ResourceProfile> = new Map();

  // ==================== 注册 ====================

  register(resource: Omit<ResourceProfile, 'stats' | 'strengths'>): void {
    const existing = this.profiles.get(resource.id);
    if (existing) {
      // 更新状态字段
      existing.status = resource.status;
      existing.healthScore = resource.healthScore;
      existing.lastHealthCheck = resource.lastHealthCheck;
      existing.name = resource.name;
      return;
    }

    this.profiles.set(resource.id, {
      ...resource,
      stats: {
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        totalCost: 0,
        lastUsedAt: 0,
      },
      strengths: {
        taskTypes: {},
        domains: {},
      },
    });
  }

  unregister(id: string): void {
    this.profiles.delete(id);
  }

  // ==================== 查询 ====================

  getActive(type?: ResourceProfile['type']): ResourceProfile[] {
    const results: ResourceProfile[] = [];
    for (const p of this.profiles.values()) {
      if (p.status === 'active' || p.status === 'degraded') {
        if (!type || p.type === type) {
          results.push(p);
        }
      }
    }
    return results;
  }

  getById(id: string): ResourceProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * 推荐资源 — 按任务类型和领域匹配，按成功率排序
   */
  recommend(taskType: string, domain?: string): ResourceProfile[] {
    const candidates = this.getActive();

    const scored = candidates.map(p => {
      let score = 0;

      // 任务类型匹配
      const typeStats = p.strengths.taskTypes[taskType];
      if (typeStats && typeStats.attempts > 0) {
        score += (typeStats.successes / typeStats.attempts) * 50;
      }

      // 领域匹配
      if (domain) {
        const domainStats = p.strengths.domains[domain];
        if (domainStats && domainStats.attempts > 0) {
          score += (domainStats.successes / domainStats.attempts) * 30;
        }
      }

      // 健康度
      score += p.healthScore * 0.2;

      return { profile: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.profile);
  }

  // ==================== 反馈 ====================

  recordOutcome(id: string, outcome: ResourceOutcome): void {
    const p = this.profiles.get(id);
    if (!p) return;

    const s = p.stats;
    s.totalCalls++;
    if (outcome.success) s.successCount++;
    else s.failureCount++;

    // 增量平均延迟
    s.avgLatencyMs = (s.avgLatencyMs * (s.totalCalls - 1) + outcome.latencyMs) / s.totalCalls;
    s.totalCost += outcome.cost ?? 0;
    s.lastUsedAt = Date.now();

    // 更新擅长任务
    if (outcome.taskType) {
      const tt = p.strengths.taskTypes[outcome.taskType] ?? { attempts: 0, successes: 0 };
      tt.attempts++;
      if (outcome.success) tt.successes++;
      p.strengths.taskTypes[outcome.taskType] = tt;
    }
    if (outcome.domain) {
      const dd = p.strengths.domains[outcome.domain] ?? { attempts: 0, successes: 0 };
      dd.attempts++;
      if (outcome.success) dd.successes++;
      p.strengths.domains[outcome.domain] = dd;
    }

    // 自动更新健康度
    this.updateHealthScore(p);
  }

  /**
   * 批量更新资源状态（从 ModelPool 同步）
   */
  updateStatus(id: string, status: ResourceProfile['status']): void {
    const p = this.profiles.get(id);
    if (p) {
      p.status = status;
      p.lastHealthCheck = Date.now();
    }
  }

  // ==================== 健康度 ====================

  private updateHealthScore(p: ResourceProfile): void {
    const s = p.stats;
    if (s.totalCalls === 0) {
      p.healthScore = 100; // 新资源默认健康
      return;
    }

    const successRate = s.successCount / s.totalCalls;
    const recency = Math.min(1, (Date.now() - s.lastUsedAt) / (24 * 60 * 60 * 1000)); // 0-1 (1天内)

    // 健康度 = 成功率 * 70% + 近期使用 * 20% + 基线 10%
    p.healthScore = Math.round(
      successRate * 70 +
      (1 - recency) * 20 +
      10
    );

    // 自动降级
    if (p.healthScore < 30) p.status = 'degraded';
    if (p.healthScore < 10) p.status = 'unavailable';
  }

  getHealthSummary(): {
    total: number;
    active: number;
    degraded: number;
    unavailable: number;
  } {
    let active = 0, degraded = 0, unavailable = 0;
    for (const p of this.profiles.values()) {
      if (p.status === 'active') active++;
      else if (p.status === 'degraded') degraded++;
      else if (p.status === 'unavailable') unavailable++;
    }
    return { total: this.profiles.size, active, degraded, unavailable };
  }

  /** 获取所有注册资源（调试用） */
  getAll(): ResourceProfile[] {
    return [...this.profiles.values()];
  }
}
