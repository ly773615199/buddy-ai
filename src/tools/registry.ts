import type { ToolDef, Attributes, TrustLevel, getPermissions, ToolExecutionRecord, ToolPanelData } from '../types.js';
import { globalToolCache, ToolCache } from './cache.js';

/**
 * 工具注册表 - 管理所有可用工具
 *
 * Task 3.2: 新增使用频率追踪，高频工具排在前面
 * Sprint 2: 新增执行日志追踪
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private usageCount = new Map<string, number>();
  private executionLog: ToolExecutionRecord[] = [];
  private readonly MAX_LOG = 50;

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
    if (!this.usageCount.has(tool.name)) {
      this.usageCount.set(tool.name, 0);
    }
  }

  registerMany(tools: ToolDef[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  /**
   * 根据信任等级过滤可用工具，按使用频率降序排列
   */
  listForPermissions(permissions: string[]): ToolDef[] {
    return this.list()
      .filter((t) => {
        if (t.permission === 'basic') return true;
        return permissions.includes(t.permission);
      })
      .sort((a, b) => {
        const countA = this.usageCount.get(a.name) ?? 0;
        const countB = this.usageCount.get(b.name) ?? 0;
        return countB - countA;
      });
  }

  /**
   * 记录工具使用（成功调用后）
   */
  recordUsage(name: string): void {
    const current = this.usageCount.get(name) ?? 0;
    this.usageCount.set(name, current + 1);
  }

  /**
   * 记录工具执行日志
   */
  recordExecution(name: string, args: Record<string, unknown>, result: string, success: boolean, durationMs: number): void {
    this.executionLog.unshift({
      tool: name,
      args,
      result: result.slice(0, 300),
      success,
      durationMs,
      timestamp: Date.now(),
    });
    if (this.executionLog.length > this.MAX_LOG) {
      this.executionLog.length = this.MAX_LOG;
    }
  }

  /**
   * 获取最近执行记录
   */
  getRecentExecutions(limit = 10): ToolExecutionRecord[] {
    return this.executionLog.slice(0, limit);
  }

  /**
   * 获取工具使用统计（含成功率）
   */
  getUsageStats(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, count] of this.usageCount) {
      if (count > 0) result[name] = count;
    }
    return result;
  }

  /**
   * 获取完整工具面板数据
   */
  getToolPanelData(): ToolPanelData {
    const tools = this.list();
    const stats = this.getUsageStats();
    const successMap = new Map<string, { success: number; total: number }>();

    for (const log of this.executionLog) {
      const entry = successMap.get(log.tool) || { success: 0, total: 0 };
      entry.total++;
      if (log.success) entry.success++;
      successMap.set(log.tool, entry);
    }

    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description || '',
        source: t.source || 'builtin',
        usageCount: stats[t.name] || 0,
        successRate: successMap.has(t.name)
          ? (successMap.get(t.name)!.success / successMap.get(t.name)!.total * 100)
          : -1,
      })),
      recentExecutions: this.getRecentExecutions(10),
    };
  }

  /**
   * 执行工具（带缓存 + 使用计数）
   */
  async executeWithCache(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.get(name);
    if (!tool) throw new Error(`工具不存在: ${name}`);

    // 如果工具配置了缓存，先查缓存
    if (tool.cacheTtlSec && tool.cacheTtlSec > 0) {
      const cacheKey = ToolCache.makeKey(name, args);
      const cached = globalToolCache.get(cacheKey);
      if (cached !== null) return cached;

      const result = await tool.execute(args);
      const output = typeof result === 'string' ? result : JSON.stringify(result);
      globalToolCache.set(cacheKey, output, tool.cacheTtlSec);
      this.recordUsage(name);
      return output;
    }

    const result = await tool.execute(args);
    this.recordUsage(name);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * 获取所有工具的 outputFormat 统计
   */
  getFormatStats(): Record<string, number> {
    const stats: Record<string, number> = { text: 0, json: 0, lines: 0, unspecified: 0 };
    for (const t of this.tools.values()) {
      if (t.outputFormat) stats[t.outputFormat]++;
      else stats.unspecified++;
    }
    return stats;
  }
}
