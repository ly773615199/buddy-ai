/**
 * 飞书知识源 — 飞书 Wiki v2 API 知识空间接入
 *
 * 功能：
 * - 用飞书 Wiki v2 API 拉取知识空间节点
 * - 支持增量同步（对比 obj_edit_time）
 * - 拉取文档内容（通过 obj_token 调 docx API）
 * - 缓存到本地 STMP，避免重复拉取
 */

import type {
  KnowledgeSource, KnowledgeNode, KnowledgeContent,
  SearchOptions, SyncResult,
} from './source-manager.js';
import type { MemoryStore } from '../memory/store.js';

// ==================== 类型 ====================

interface FeishuSourceConfig {
  id?: string;
  appId: string;
  appSecret: string;
  spaces: Array<{ spaceId: string; name: string }>;
  syncIntervalMs?: number;
}

interface FeishuToken {
  tenantAccessToken: string;
  expiresAt: number;
}

interface WikiNode {
  nodeToken: string;
  objToken: string;
  objType: string;
  title: string;
  hasChild: boolean;
  parentToken: string;
  objCreateTime: string;
  objEditTime: string;
  creator: string;
}

// ==================== FeishuSource ====================

export class FeishuSource implements KnowledgeSource {
  readonly id: string;
  readonly type = 'feishu' as const;
  readonly name = '飞书知识源';

  private appId: string;
  private appSecret: string;
  private spaces: Array<{ spaceId: string; name: string }>;
  private memory: MemoryStore;
  private token: FeishuToken | null = null;

  // 节点缓存（nodeToken → 文档内容）
  private nodeCache: Map<string, { content: string; editTime: string }> = new Map();

  constructor(memory: MemoryStore, config: FeishuSourceConfig) {
    this.id = config.id ?? 'feishu';
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.spaces = config.spaces;
    this.memory = memory;
  }

  // ==================== KnowledgeSource 接口 ====================

  /**
   * 搜索飞书知识
   *
   * 从本地缓存中搜索（同步后的数据）
   */
  async search(query: string, options?: SearchOptions): Promise<KnowledgeNode[]> {
    const limit = options?.limit ?? 10;
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    const memories = this.memory.getMemoriesByCategory('feishu_knowledge');
    const scored = memories.map(m => {
      const text = (m.key + ' ' + m.value).toLowerCase();
      const matchCount = queryWords.filter(w => text.includes(w)).length;
      return { memory: m, score: matchCount / Math.max(1, queryWords.length) };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s, i) => {
      const parts = s.memory.key.split('|');
      return {
        id: `feishu-${parts[0] ?? i}`,
        sourceId: this.id,
        sourceType: 'feishu' as const,
        title: parts[1] ?? s.memory.key,
        content: s.memory.value,
        summary: s.memory.value.slice(0, 200),
        domain: parts[2] ?? '飞书',
        concepts: [],
        score: 0.5 + s.score * 0.3,
        createdAt: 0,
        updatedAt: 0,
      };
    });
  }

  /**
   * 读取完整文档内容
   */
  async read(nodeId: string): Promise<KnowledgeContent | null> {
    // 从缓存中查找
    const cached = this.nodeCache.get(nodeId);
    if (cached) {
      return { id: nodeId, content: cached.content, metadata: { source: 'feishu' } };
    }

    // 从记忆中查找
    const memories = this.memory.getMemoriesByCategory('feishu_knowledge');
    const match = memories.find(m => m.key.startsWith(nodeId));
    if (!match) return null;

    return {
      id: nodeId,
      content: match.value,
      metadata: { source: 'feishu' },
    };
  }

  /**
   * 列出所有飞书文档
   */
  async list(): Promise<KnowledgeNode[]> {
    const memories = this.memory.getMemoriesByCategory('feishu_knowledge');
    return memories.map((m, i) => {
      const parts = m.key.split('|');
      return {
        id: `feishu-${parts[0] ?? i}`,
        sourceId: this.id,
        sourceType: 'feishu' as const,
        title: parts[1] ?? m.key,
        content: m.value,
        summary: m.value.slice(0, 200),
        domain: parts[2] ?? '飞书',
        concepts: [],
        score: 0.5,
        createdAt: 0,
        updatedAt: 0,
      };
    });
  }

  /**
   * 同步：拉取所有知识空间的文档
   *
   * 增量同步：对比 obj_edit_time
   */
  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    let added = 0;
    let updated = 0;
    let deleted = 0;

    // 获取 token
    const token = await this.getToken();
    if (!token) {
      return {
        sourceId: this.id,
        synced: 0, added: 0, updated: 0, deleted: 0,
        durationMs: Date.now() - startTime,
        error: '无法获取飞书 tenant_access_token',
      };
    }

    // 遍历所有知识空间
    for (const space of this.spaces) {
      try {
        const nodes = await this.listSpaceNodes(space.spaceId, token);
        for (const node of nodes) {
          // 检查是否已缓存且未更新
          const cached = this.nodeCache.get(node.nodeToken);
          if (cached && cached.editTime === node.objEditTime) continue;

          // 拉取文档内容
          if (node.objType === 'doc' || node.objType === 'docx') {
            const content = await this.fetchDocContent(node.objToken, token);
            if (content) {
              this.nodeCache.set(node.nodeToken, { content, editTime: node.objEditTime });

              // 写入本地记忆
              this.memory.setMemory(
                'feishu_knowledge',
                `${node.nodeToken}|${node.title}|${space.name}`,
                content.slice(0, 5000),
                7,
              );

              if (cached) updated++;
              else added++;
            }
          }
        }
      } catch {
        // 单个空间同步失败，继续
      }
    }

    return {
      sourceId: this.id,
      synced: added + updated + deleted,
      added,
      updated,
      deleted,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 是否可用
   */
  isAvailable(): boolean {
    return !!(this.appId && this.appSecret && this.spaces.length > 0);
  }

  /**
   * 获取统计
   */
  getStats(): { spaces: number; cachedNodes: number } {
    return {
      spaces: this.spaces.length,
      cachedNodes: this.nodeCache.size,
    };
  }

  // ==================== 内部方法 ====================

  /**
   * 获取 tenant_access_token
   */
  private async getToken(): Promise<string | null> {
    // 检查缓存
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.tenantAccessToken;
    }

    try {
      const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return null;
      const data = await res.json() as any;

      if (data.code !== 0) return null;

      this.token = {
        tenantAccessToken: data.tenant_access_token,
        expiresAt: Date.now() + (data.expire - 300) * 1000, // 提前 5 分钟刷新
      };

      return this.token.tenantAccessToken;
    } catch {
      return null;
    }
  }

  /**
   * 列出知识空间下的所有节点
   */
  private async listSpaceNodes(spaceId: string, token: string): Promise<WikiNode[]> {
    const nodes: WikiNode[] = [];
    let pageToken = '';

    do {
      const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes?page_size=50${pageToken ? `&page_token=${pageToken}` : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) break;
      const data = await res.json() as any;

      if (data.code !== 0) break;

      const items = data.data?.items ?? [];
      for (const item of items) {
        nodes.push({
          nodeToken: item.node_token ?? '',
          objToken: item.obj_token ?? '',
          objType: item.obj_type ?? '',
          title: item.title ?? '',
          hasChild: item.has_child ?? false,
          parentToken: item.parent_node_token ?? '',
          objCreateTime: item.obj_create_time ?? '',
          objEditTime: item.obj_edit_time ?? '',
          creator: item.creator?.id ?? '',
        });
      }

      pageToken = data.data?.page_token ?? '';
    } while (pageToken);

    return nodes;
  }

  /**
   * 获取文档内容
   */
  private async fetchDocContent(documentId: string, token: string): Promise<string | null> {
    try {
      const res = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return null;
      const data = await res.json() as any;

      if (data.code !== 0) return null;

      // 提取文本内容
      const blocks = data.data?.items ?? [];
      const texts: string[] = [];

      for (const block of blocks) {
        // 文本块
        if (block.block_type === 2 && block.text?.elements) {
          const text = block.text.elements
            .map((el: any) => el.text_run?.content ?? '')
            .join('');
          if (text.trim()) texts.push(text.trim());
        }
        // 标题块
        if ((block.block_type === 3 || block.block_type === 4 || block.block_type === 5) && block.heading?.elements) {
          const level = block.block_type - 2;
          const text = block.heading.elements
            .map((el: any) => el.text_run?.content ?? '')
            .join('');
          if (text.trim()) texts.push('#'.repeat(level) + ' ' + text.trim());
        }
      }

      return texts.join('\n') || null;
    } catch {
      return null;
    }
  }
}
