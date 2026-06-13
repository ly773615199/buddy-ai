/**
 * Scene World Model 模块入口
 *
 * 导出所有组件，供 RightBrain 集成使用
 */

export { EntityRegistry } from './entity-registry.js';
export type {
  Entity, Edge, EntitySnapshot, SceneDiff,
  EntityType, EdgeRelation, EntityRegistryConfig,
} from './entity-registry.js';
export {
  createFileEntity, createFunctionEntity, createClassEntity,
  createToolEntity, createMemoryEntity,
  createDependencyEdge, createCallEdge, createContainsEdge,
} from './entity-registry.js';

export { GNNLayer, MessageFunction, UpdateFunction } from './gnn-layer.js';
export type { GNNLayerConfig } from './gnn-layer.js';
export { aggregateMessages, aggregateMax } from './gnn-layer.js';

export { SceneWorldModel } from './scene-world-model.js';
export type {
  SceneAction, ScenePredictionResult,
  EntityChange, EdgeChange, SceneWorldModelConfig,
} from './scene-world-model.js';

export {
  generateSyntheticSamples,
  buildRuntimeSample,
  knowledgeToTrainingSample,
  toNNSample,
} from './scene-training.js';
export type { WorldModelTrainingSample } from './scene-training.js';

export {
  extractFromProject,
  extractFromSTMP,
  extractFromExperience,
  extractFromKnowledge,
  syncAllSources,
} from './entity-adapters.js';
export type {
  ProjectIndexSource,
  STMPSource,
  ExperienceSource,
  KnowledgeItem,
  MemoryNodeLite,
  RoomLite,
  ExperienceNodeLite,
  ExperienceEdgeLite,
} from './entity-adapters.js';

export { RuntimeCollector } from './runtime-collector.js';
export type {
  RuntimeCollectorConfig,
  PendingSnapshot,
  ToolExecutionResult,
  CollectedSample,
} from './runtime-collector.js';

export { KnowledgeBridge } from './knowledge-bridge.js';
export type {
  ExtractedKnowledgeLite,
  KnowledgeBridgeConfig,
  KnowledgeBridgeStats,
} from './knowledge-bridge.js';
