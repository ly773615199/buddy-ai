/**
 * Probers — 统一资源探测器注册表
 *
 * 每种资源类型对应一个探测器实现。
 * BatchProbeScheduler 根据资源类型选择对应的探测器。
 */

import type { ResourceType, ResourceProber } from '../types.js';
import { ModelProber } from './model-prober.js';
import { MCPToolProber } from './mcp-tool-prober.js';
import { HTTPToolProber } from './http-tool-prober.js';
import { KnowledgeSourceProber } from './knowledge-prober.js';
import { PlatformProber } from './platform-prober.js';
import { TTSProber } from './tts-prober.js';
import { LocalExpertProber } from './local-expert-prober.js';
import { SkillProber } from './skill-prober.js';

export { ModelProber } from './model-prober.js';
export { MCPToolProber } from './mcp-tool-prober.js';
export { HTTPToolProber } from './http-tool-prober.js';
export { KnowledgeSourceProber } from './knowledge-prober.js';
export { PlatformProber } from './platform-prober.js';
export { TTSProber } from './tts-prober.js';
export { LocalExpertProber } from './local-expert-prober.js';
export { SkillProber } from './skill-prober.js';

/** 创建默认探测器注册表 */
export function createDefaultProbers(): Map<ResourceType, ResourceProber> {
  const probers = new Map<ResourceType, ResourceProber>();

  probers.set('model', new ModelProber());
  probers.set('tool', new HTTPToolProber()); // HTTP 工具作为默认，MCP 在注册时覆盖
  probers.set('knowledge_source', new KnowledgeSourceProber());
  probers.set('platform', new PlatformProber());
  probers.set('tts', new TTSProber());
  probers.set('local_expert', new LocalExpertProber());
  probers.set('skill', new SkillProber());

  return probers;
}
