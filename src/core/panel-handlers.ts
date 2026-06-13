/**
 * 面板数据请求处理 — 工具面板、记忆面板、知识图谱面板
 *
 * 从 ws-handler.ts 提取（REFACTOR_PLAN Step 4）
 */

import type { EventBus } from '../ws/server.js';
import type { Subsystems } from './subsystems.js';

export interface PanelHandlerDeps {
  sys: Subsystems;
  eventBus: EventBus;
  verbose: boolean;
}

export class PanelHandlers {
  constructor(private deps: PanelHandlerDeps) {}

  /** 处理工具面板数据请求 */
  handleToolPanelRequest(): void {
    try {
      const data = this.deps.sys.tools.getToolPanelData();
      this.deps.eventBus.emit({ type: 'tool_panel_data', data });
      if (this.deps.verbose) console.log(`  [Tools] 面板数据已发送: ${data.tools.length} 个工具, ${data.recentExecutions.length} 条记录`);
    } catch (err) {
      if (this.deps.verbose) console.warn('[Tools] 面板数据获取失败:', (err as Error).message);
    }
  }

  /** 处理记忆面板数据请求 */
  handleMemoryPanelRequest(): void {
    try {
      const domains = this.deps.sys.cognitive.getAllDomainProfiles();
      const stmpStats = this.deps.sys.stmp.getStats();
      this.deps.eventBus.emit({
        type: 'memory_panel_data',
        data: {
          domains: domains.map(d => ({
            domain: d.domain,
            domainType: d.domainType,
            knowledgeCount: d.knowledgeCount,
            depthScore: d.depthScore,
            growthStage: d.growthStage,
            confidence: 0.5,
            conversationCount: d.conversationCount,
            lastActiveAt: d.lastActiveAt,
          })),
          stats: {
            totalNodes: stmpStats.nodes || 0,
            totalDomains: domains.length,
            activeDomains: domains.filter(d => d.isActive).length,
          },
        },
      });
      if (this.deps.verbose) console.log(`  [Memory] 面板数据已发送: ${domains.length} 个领域`);
    } catch (err) {
      if (this.deps.verbose) console.warn('[Memory] 面板数据获取失败:', (err as Error).message);
    }
  }

  /** 处理知识图谱面板数据请求 */
  handleKnowledgePanelRequest(): void {
    try {
      const learnedKnowledge = this.deps.sys.learn.getLearnedKnowledge();
      const learnedFiles = this.deps.sys.learn.getLearnedFiles();
      const domains = this.deps.sys.cognitive.getAllDomainProfiles();
      const stmpStats = this.deps.sys.stmp.getStats();

      const concepts = new Map<string, { count: number; domains: Set<string>; types: Set<string> }>();
      for (const d of domains) {
        for (const kw of [d.domain]) {
          const existing = concepts.get(kw) ?? { count: 0, domains: new Set(), types: new Set() };
          existing.count += d.knowledgeCount;
          existing.domains.add(d.domain);
          existing.types.add(d.domainType);
          concepts.set(kw, existing);
        }
      }

      const nodes = Array.from(concepts.entries()).map(([name, data]) => ({
        id: name, label: name, count: data.count,
        domains: Array.from(data.domains), types: Array.from(data.types),
        size: Math.min(40, Math.max(10, data.count * 3)),
      }));

      const edges: Array<{ source: string; target: string; weight: number }> = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const sharedDomains = nodes[i].domains.filter(d => nodes[j].domains.includes(d));
          if (sharedDomains.length > 0) {
            edges.push({ source: nodes[i].id, target: nodes[j].id, weight: sharedDomains.length });
          }
        }
      }

      this.deps.eventBus.emit({
        type: 'knowledge_panel_data',
        data: {
          nodes, edges,
          knowledge: learnedKnowledge.map(k => ({ key: k.key, value: k.value, importance: k.importance })),
          files: learnedFiles,
          stats: {
            totalKnowledge: learnedKnowledge.length,
            totalFiles: learnedFiles.length,
            totalDomains: domains.length,
            totalSTMPNodes: stmpStats.nodes || 0,
          },
        },
      });
      if (this.deps.verbose) console.log(`  [Knowledge] 面板数据已发送: ${learnedKnowledge.length} 条知识, ${nodes.length} 个概念`);
    } catch (err) {
      if (this.deps.verbose) console.warn('[Knowledge] 面板数据获取失败:', (err as Error).message);
    }
  }
}
