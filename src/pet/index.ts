export { PetManager } from './manager.js';
export type { TrackResult } from './manager.js';
export type {
  PetData, FeatureNode, FeatureCategory, BehaviorSignals, GuidanceTask, GuidanceDef,
  BattleStats, EvolutionStage, Rarity, EvolutionInfo, SpeciesInfo, FeatureDef,
  VisualSeed, VisualIdentity, VisualStage, TextureType, TemperamentType,
  BehaviorVisualEffect, VisualStageInfo,
} from './types.js';
export {
  FEATURE_DEFS, GUIDANCE_DEFS, EVOLUTION_TABLE, SPECIES_TABLE, RARITY_WEIGHTS, RARITY_COLORS,
  INTIMACY_EVOLUTION_MAP,
  calcMastery, getEvolutionStage, countByCategory, getSpeciesInfo,
  getIntimacyDescription, getIntimacyPrompt, getBehaviorPrompt,
  defaultBehaviorSignals, defaultBattleStats, defaultVisualSeed,
  getVisualStage, calcBehaviorVisualEffect,
  TEXTURE_OPTIONS, TEMPERAMENT_OPTIONS, COLOR_PRESETS, VISUAL_STAGE_TABLE,
} from './types.js';
