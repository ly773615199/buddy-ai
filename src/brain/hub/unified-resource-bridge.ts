/**
 * UnifiedResourceBridge — 全资源类型桥接器
 *
 * 将所有资源管理器的数据同步到 UnifiedResourceHub，
 * 让三脑决策能看到完整资源画像（不仅限于 model）。
 *
 * 桥接目标：
 *   ToolRegistry + SkillGrowth → tool
 *   KnowledgeSourceManager     → knowledge_source
 *   PlatformManager            → platform
 *   TTSManager                 → tts
 *   TernaryExpertRouter        → local_expert
 *   SkillManager               → skill
 */

import type { UnifiedResourceHub, ResourceOutcome } from './unified-resource-hub.js';
import type { ResourceType, ResourceDefinition } from './types.js';

// ==================== 外部接口（避免循环依赖） ====================

/** ToolRegistry 最小接口 */
interface ToolRegistryLike {
  list(): Array<{ name: string; description?: string }>;
}

/** SkillGrowth 最小接口 */
interface SkillGrowthLike {
  getAllHealth(): Array<{
    name: string;
    healthScore: number;
    reliability: number;
    efficiency: number;
  }>;
  getMetric(name: string): {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
    lastUsed: number;
  } | undefined;
}

/** KnowledgeSourceManager 最小接口 */
interface KnowledgeSourceManagerLike {
  getAllSources(): Array<{
    id: string;
    name: string;
    type: string;
    isAvailable(): boolean;
  }>;
}

/** PlatformManager 最小接口 */
interface PlatformManagerLike {
  list(): string[];
  getActive(): { platform: string } | null;
}

/** TTSManager 最小接口 */
interface TTSManagerLike {
  listBackends(): string[];
  getActiveBackend(): { name: string } | null;
}

/** TernaryExpertRouter 最小接口 */
interface TernaryExpertRouterLike {
  listExperts(): Array<{
    domain: string;
    growthStage: string;
    totalParams: number;
    trainSteps: number;
    lastUpdated: number;
  }>;
}

/** SkillManager 最小接口 */
interface SkillManagerLike {
  listSkills(): Array<{
    name: string;
    description: string;
    version: string;
  }>;
  growth: SkillGrowthLike;
}

// ==================== 桥接器 ====================

export class UnifiedResourceBridge {
  private hub: UnifiedResourceHub;

  private toolRegistry: ToolRegistryLike | null = null;
  private skillGrowth: SkillGrowthLike | null = null;
  private knowledgeSourceManager: KnowledgeSourceManagerLike | null = null;
  private platformManager: PlatformManagerLike | null = null;
  private ttsManager: TTSManagerLike | null = null;
  private ternaryRouter: TernaryExpertRouterLike | null = null;
  private skillManager: SkillManagerLike | null = null;

  constructor(hub: UnifiedResourceHub) {
    this.hub = hub;
  }

  // ==================== 注册管理器 ====================

  setToolRegistry(registry: ToolRegistryLike, growth: SkillGrowthLike): this {
    this.toolRegistry = registry;
    this.skillGrowth = growth;
    return this;
  }

  setKnowledgeSourceManager(manager: KnowledgeSourceManagerLike): this {
    this.knowledgeSourceManager = manager;
    return this;
  }

  setPlatformManager(manager: PlatformManagerLike): this {
    this.platformManager = manager;
    return this;
  }

  setTTSManager(manager: TTSManagerLike): this {
    this.ttsManager = manager;
    return this;
  }

  setTernaryExpertRouter(router: TernaryExpertRouterLike): this {
    this.ternaryRouter = router;
    return this;
  }

  setSkillManager(manager: SkillManagerLike): this {
    this.skillManager = manager;
    return this;
  }

  // ==================== 全量同步 ====================

  /**
   * 全量同步所有资源管理器到 UnifiedResourceHub
   * 返回同步的资源总数
   */
  fullSync(): number {
    let count = 0;
    count += this.syncTools();
    count += this.syncKnowledgeSources();
    count += this.syncPlatforms();
    count += this.syncTTS();
    count += this.syncLocalExperts();
    count += this.syncSkills();
    return count;
  }

  // ==================== 各类型同步 ====================

  /**
   * ToolRegistry + SkillGrowth → tool 资源
   */
  syncTools(): number {
    if (!this.toolRegistry) return 0;

    const tools = this.toolRegistry.list();
    let synced = 0;

    for (const tool of tools) {
      const id = `tool/${tool.name}`;
      const def: ResourceDefinition = {
        id,
        type: 'tool',
        name: tool.name,
        metadata: { description: tool.description },
      };

      this.hub.register(def);

      // 从 SkillGrowth 读取健康数据
      if (this.skillGrowth) {
        const health = this.skillGrowth.getAllHealth().find(h =>
          h.name === tool.name || h.name === `skill_${tool.name}`
        );
        const metric = this.skillGrowth.getMetric(tool.name)
          ?? this.skillGrowth.getMetric(`skill_${tool.name}`);

        const resource = this.hub.get(id);
        if (resource) {
          if (health) {
            resource.healthScore = health.healthScore;
          }
          if (metric) {
            resource.stats.totalCalls = metric.totalCalls;
            resource.stats.successes = metric.successCount;
            resource.stats.failures = metric.failureCount;
            resource.stats.avgLatencyMs = metric.totalCalls > 0
              ? metric.totalDurationMs / metric.totalCalls
              : 0;
            resource.stats.lastUsedAt = metric.lastUsed;
          }
          // 根据健康度设置状态（通过状态机）
          if (resource.state === 'discovered') {
            if (resource.healthScore >= 50) {
              this.hub.markState(resource.id, 'active', '工具同步');
            } else if (resource.healthScore >= 20) {
              this.hub.markState(resource.id, 'degraded', '工具同步');
            }
          }
        }
      }

      synced++;
    }

    return synced;
  }

  /**
   * KnowledgeSourceManager → knowledge_source 资源
   */
  syncKnowledgeSources(): number {
    if (!this.knowledgeSourceManager) return 0;

    const sources = this.knowledgeSourceManager.getAllSources();
    let synced = 0;

    for (const source of sources) {
      const id = `knowledge/${source.id}`;
      const def: ResourceDefinition = {
        id,
        type: 'knowledge_source',
        name: source.name,
        metadata: {
          sourceType: source.type,
          available: source.isAvailable(),
        },
      };

      this.hub.register(def);

      const resource = this.hub.get(id);
      if (resource && resource.state === 'discovered') {
        this.hub.markState(resource.id, source.isAvailable() ? 'active' : 'degraded', '知识源同步');
        resource.healthScore = source.isAvailable() ? 80 : 30;
      }

      synced++;
    }

    return synced;
  }

  /**
   * PlatformManager → platform 资源
   */
  syncPlatforms(): number {
    if (!this.platformManager) return 0;

    const platforms = this.platformManager.list();
    const activePlatform = this.platformManager.getActive();
    let synced = 0;

    for (const platform of platforms) {
      const id = `platform/${platform}`;
      const def: ResourceDefinition = {
        id,
        type: 'platform',
        name: platform,
        metadata: {
          isActive: activePlatform?.platform === platform,
        },
      };

      this.hub.register(def);

      const resource = this.hub.get(id);
      if (resource && resource.state === 'discovered') {
        this.hub.markState(resource.id, activePlatform?.platform === platform ? 'active' : 'discovered', '平台同步');
        resource.healthScore = activePlatform?.platform === platform ? 90 : 50;
      }

      synced++;
    }

    return synced;
  }

  /**
   * TTSManager → tts 资源
   */
  syncTTS(): number {
    if (!this.ttsManager) return 0;

    const backends = this.ttsManager.listBackends();
    const activeBackend = this.ttsManager.getActiveBackend();
    let synced = 0;

    for (const backend of backends) {
      const id = `tts/${backend}`;
      const def: ResourceDefinition = {
        id,
        type: 'tts',
        name: backend,
        metadata: {
          isActive: activeBackend?.name === backend,
        },
      };

      this.hub.register(def);

      const resource = this.hub.get(id);
      if (resource && resource.state === 'discovered') {
        this.hub.markState(resource.id, activeBackend?.name === backend ? 'active' : 'discovered', 'TTS同步');
        resource.healthScore = activeBackend?.name === backend ? 90 : 50;
      }

      synced++;
    }

    return synced;
  }

  /**
   * TernaryExpertRouter → local_expert 资源
   */
  syncLocalExperts(): number {
    if (!this.ternaryRouter) return 0;

    const experts = this.ternaryRouter.listExperts();
    let synced = 0;

    for (const expert of experts) {
      const id = `expert/${expert.domain}`;
      const def: ResourceDefinition = {
        id,
        type: 'local_expert',
        name: expert.domain,
        metadata: {
          growthStage: expert.growthStage,
          totalParams: expert.totalParams,
          trainSteps: expert.trainSteps,
          lastUpdated: expert.lastUpdated,
        },
      };

      this.hub.register(def);

      const resource = this.hub.get(id);
      if (resource && resource.state === 'discovered') {
        // 根据成长阶段设置状态
        switch (expert.growthStage) {
          case 'mature':
            this.hub.markState(resource.id, 'active', '专家同步: mature');
            resource.healthScore = 85;
            break;
          case 'trainable':
            this.hub.markState(resource.id, 'active', '专家同步: trainable');
            resource.healthScore = 65;
            break;
          case 'seed':
            // 保持 discovered
            resource.healthScore = 40;
            break;
          default:
            resource.healthScore = 50;
        }
      }

      synced++;
    }

    return synced;
  }

  /**
   * SkillManager → skill 资源
   */
  syncSkills(): number {
    if (!this.skillManager) return 0;

    const skills = this.skillManager.listSkills();
    let synced = 0;

    for (const skill of skills) {
      const id = `skill/${skill.name}`;
      const def: ResourceDefinition = {
        id,
        type: 'skill',
        name: skill.name,
        metadata: {
          description: skill.description,
          version: skill.version,
        },
      };

      this.hub.register(def);

      // 从 SkillGrowth 读取健康数据
      const growth = this.skillManager.growth;
      if (growth) {
        const health = growth.getAllHealth().find(h =>
          h.name === skill.name || h.name === `skill_${skill.name}`
        );
        const metric = growth.getMetric(skill.name)
          ?? growth.getMetric(`skill_${skill.name}`);

        const resource = this.hub.get(id);
        if (resource) {
          if (health) {
            resource.healthScore = health.healthScore;
          }
          if (metric) {
            resource.stats.totalCalls = metric.totalCalls;
            resource.stats.successes = metric.successCount;
            resource.stats.failures = metric.failureCount;
            resource.stats.avgLatencyMs = metric.totalCalls > 0
              ? metric.totalDurationMs / metric.totalCalls
              : 0;
            resource.stats.lastUsedAt = metric.lastUsed;
          }
          if (resource.state === 'discovered') {
            this.hub.markState(resource.id, resource.healthScore >= 50 ? 'active' : 'degraded', '技能同步');
          }
        }
      }

      synced++;
    }

    return synced;
  }

  // ==================== 反馈回流 ====================

  /**
   * 工具执行后记录结果到 UnifiedResourceHub
   * 供外部调用（如 message-processor / tool-synthesizer）
   */
  recordToolOutcome(toolName: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`tool/${toolName}`, outcome);
  }

  /**
   * 知识源查询后记录结果
   */
  recordKnowledgeOutcome(sourceId: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`knowledge/${sourceId}`, outcome);
  }

  /**
   * 平台操作后记录结果
   */
  recordPlatformOutcome(platform: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`platform/${platform}`, outcome);
  }

  /**
   * TTS 调用后记录结果
   */
  recordTTSOutcome(backend: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`tts/${backend}`, outcome);
  }

  /**
   * 本地专家执行后记录结果
   */
  recordExpertOutcome(domain: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`expert/${domain}`, outcome);
  }

  /**
   * 技能执行后记录结果
   */
  recordSkillOutcome(skillName: string, outcome: ResourceOutcome): void {
    this.hub.recordOutcome(`skill/${skillName}`, outcome);
  }

  // ==================== 增量同步 ====================

  /**
   * 新工具注册时同步
   */
  onToolRegistered(name: string, description?: string): void {
    const id = `tool/${name}`;
    if (!this.hub.get(id)) {
      this.hub.register({ id, type: 'tool', name, metadata: { description } });
      this.hub.markState(id, 'active', '新工具注册');
      const r = this.hub.get(id);
      if (r) {
        r.healthScore = 70;
      }
    }
  }

  /**
   * 新知识源注册时同步
   */
  onKnowledgeSourceRegistered(source: { id: string; name: string; type: string; available: boolean }): void {
    const id = `knowledge/${source.id}`;
    if (!this.hub.get(id)) {
      this.hub.register({ id, type: 'knowledge_source', name: source.name, metadata: { sourceType: source.type } });
      this.hub.markState(id, source.available ? 'active' : 'degraded', '新知识源注册');
      const r = this.hub.get(id);
      if (r) {
        r.healthScore = source.available ? 80 : 30;
      }
    }
  }

  /**
   * 平台注册时同步
   */
  onPlatformRegistered(platform: string, isActive: boolean): void {
    const id = `platform/${platform}`;
    if (!this.hub.get(id)) {
      this.hub.register({ id, type: 'platform', name: platform });
      this.hub.markState(id, isActive ? 'active' : 'discovered', '新平台注册');
      const r = this.hub.get(id);
      if (r) {
        r.healthScore = isActive ? 90 : 50;
      }
    }
  }

  /**
   * TTS 后端注册时同步
   */
  onTTSBackendRegistered(backend: string, isActive: boolean): void {
    const id = `tts/${backend}`;
    if (!this.hub.get(id)) {
      this.hub.register({ id, type: 'tts', name: backend });
      this.hub.markState(id, isActive ? 'active' : 'discovered', '新TTS注册');
      const r = this.hub.get(id);
      if (r) {
        r.healthScore = isActive ? 90 : 50;
      }
    }
  }

  /**
   * 专家模型变化时同步
   */
  onExpertChanged(domain: string, growthStage: string): void {
    const id = `expert/${domain}`;
    const existing = this.hub.get(id);
    if (existing) {
      // 更新成长阶段元数据
      existing.metadata.growthStage = growthStage;
      // 根据成长阶段调整状态
      if (growthStage === 'mature' && existing.state === 'discovered') {
        this.hub.markState(existing.id, 'active', '专家成熟');
        existing.healthScore = 85;
      }
    } else {
      this.syncLocalExperts();
    }
  }

  /**
   * 技能安装/卸载时同步
   */
  onSkillChanged(): void {
    this.syncSkills();
  }
}
