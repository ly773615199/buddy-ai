// ==================== 养成系统管理器 v2 ====================
// 核心：功能探索图谱 + 能力解锁门控 + 引导引擎 + 行为涌现

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type {
  PetData, FeatureNode, FeatureCategory, BehaviorSignals, GuidanceTask,
  BattleStats, EvolutionStage, Rarity, EvolutionInfo, SpeciesInfo,
  VisualSeed, VisualIdentity, VisualStage,
} from './types.js';
import { computeGenome, type BuddyGenome, type GenomeContext } from './genome.js';
import {
  FEATURE_DEFS, GUIDANCE_DEFS, EVOLUTION_TABLE, SPECIES_TABLE, RARITY_WEIGHTS,
  calcMastery, countByCategory,
  getSpeciesInfo, defaultBehaviorSignals, defaultBattleStats,
  defaultVisualSeed, getVisualStage, getIntimacyDescription,
  getEvolutionStageByIntimacy,
} from './types.js';
import { runMigrations, type Migration } from '../core/migration.js';
import { SPECIES_GROWTH_BIAS } from '../types.js';
import type { OceanPersonality } from '../personality/ocean.js';
import { speciesInitialOcean, computeOcean, SPECIES_OCEAN_BIAS, getPersonalityStrength } from '../personality/ocean.js';

// SQLite 行类型
interface PetDataRow {
  id: string; name: string; species: string; rarity: string; evolution_stage: string;
  intimacy: number; total_messages: number; total_tool_calls: number; total_days: number;
  consecutive_days: number; last_active_date: string; last_guidance_at: number;
  created_at: number; last_active_at: number;
}
interface FeatureRow {
  pet_id: string; feature_id: string; name: string; description: string;
  category: string; emoji: string; discovered: number; first_used_at: number | null;
  use_count: number; last_used_at: number | null; mastery: number;
}
interface BehaviorRow {
  pet_id: string; snark: number; wisdom: number; chaos: number;
  patience: number; debugging: number; last_computed_at: number; sample_count: number;
}
interface StatsRow {
  pet_id: string; hp: number; max_hp: number; attack: number;
  defense: number; speed: number; intelligence: number;
}
interface GuidanceRow {
  task_id: string; title: string; description: string; target_feature: string;
  hint: string; priority: number; shown: number; completed_at: number | null;
}
interface VisualRow {
  pet_id: string; primary_color: string; secondary_color: string | null;
  texture: string; temperament: string; seed: number; form_progress: number;
  stage: string; svg_cache: string | null; svg_generated_at: number | null; created_at: number;
}
interface LastDateRow { last_active_date: string; consecutive_days: number }
interface IntimacyRow { intimacy: number }
interface OceanRow { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number; last_computed_at: number; sample_count: number }

// ==================== 事件类型 ====================

export interface TrackResult {
  featureId: string;
  isNewDiscovery: boolean;
  evolved: boolean;
  previousStage?: string;
  newStage?: string;
  newGuidance?: GuidanceTask;
  intimacyChange: number;
  masteryIncrease: number;
  // 视觉形象
  formProgress: number;
  visualStageChanged: boolean;
  newVisualStage?: VisualStage;
}

// ==================== 宠物管理器 ====================

export class PetManager {
  private db: Database.Database;
  private petId: string;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
    runMigrations(this.db, 'pet', PET_MIGRATIONS);

    // 加载或创建宠物
    const existing = this.db.prepare('SELECT id FROM pet_data LIMIT 1').get() as { id: string } | undefined;
    if (existing) {
      this.petId = existing.id;
    } else {
      this.petId = this.createNew();
    }
  }

  // ==================== 数据库初始化 ====================

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pet_data (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Buddy',
        species TEXT NOT NULL DEFAULT '光灵',
        rarity TEXT NOT NULL DEFAULT 'Common',
        evolution_stage TEXT NOT NULL DEFAULT 'egg',
        intimacy REAL NOT NULL DEFAULT 0,
        total_messages INTEGER NOT NULL DEFAULT 0,
        total_tool_calls INTEGER NOT NULL DEFAULT 0,
        total_days INTEGER NOT NULL DEFAULT 1,
        consecutive_days INTEGER NOT NULL DEFAULT 1,
        last_active_date TEXT NOT NULL,
        last_guidance_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pet_features (
        pet_id TEXT NOT NULL REFERENCES pet_data(id),
        feature_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'basic',
        emoji TEXT NOT NULL DEFAULT '',
        discovered INTEGER NOT NULL DEFAULT 0,
        first_used_at INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        mastery INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pet_id, feature_id)
      );

      CREATE TABLE IF NOT EXISTS pet_behavior (
        pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
        snark REAL NOT NULL DEFAULT 50,
        wisdom REAL NOT NULL DEFAULT 50,
        chaos REAL NOT NULL DEFAULT 50,
        patience REAL NOT NULL DEFAULT 50,
        debugging REAL NOT NULL DEFAULT 50,
        last_computed_at INTEGER NOT NULL DEFAULT 0,
        sample_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS pet_stats (
        pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
        hp INTEGER NOT NULL DEFAULT 100,
        max_hp INTEGER NOT NULL DEFAULT 100,
        attack INTEGER NOT NULL DEFAULT 10,
        defense INTEGER NOT NULL DEFAULT 10,
        speed INTEGER NOT NULL DEFAULT 10,
        intelligence INTEGER NOT NULL DEFAULT 10
      );

      CREATE TABLE IF NOT EXISTS pet_guidance (
        pet_id TEXT NOT NULL REFERENCES pet_data(id),
        task_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        target_feature TEXT NOT NULL DEFAULT '',
        hint TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        shown INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        PRIMARY KEY (pet_id, task_id)
      );

      CREATE TABLE IF NOT EXISTS pet_visual (
        pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
        primary_color TEXT NOT NULL DEFAULT '#58a6ff',
        secondary_color TEXT,
        texture TEXT NOT NULL DEFAULT 'soft',
        temperament TEXT NOT NULL DEFAULT 'warm',
        seed INTEGER NOT NULL DEFAULT 0,
        form_progress REAL NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT 'egg',
        svg_cache TEXT,
        svg_generated_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pet_daily_activity (
        pet_id TEXT NOT NULL REFERENCES pet_data(id),
        date TEXT NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pet_id, date)
      );

      CREATE TABLE IF NOT EXISTS pet_ocean (
        pet_id TEXT PRIMARY KEY REFERENCES pet_data(id),
        openness REAL NOT NULL DEFAULT 50,
        conscientiousness REAL NOT NULL DEFAULT 50,
        extraversion REAL NOT NULL DEFAULT 50,
        agreeableness REAL NOT NULL DEFAULT 50,
        neuroticism REAL NOT NULL DEFAULT 50,
        last_computed_at INTEGER NOT NULL DEFAULT 0,
        sample_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // ==================== 创建新宠物 ====================

  private createNew(opts?: { name?: string; species?: string; rarity?: Rarity }): string {
    const id = randomUUID();
    const species = opts?.species || '光灵';
    const rarity = opts?.rarity || this.rollRarity();
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    // 插入主数据
    this.db.prepare(`
      INSERT INTO pet_data (id, name, species, rarity, evolution_stage, intimacy, last_active_date, created_at, last_active_at)
      VALUES (?, ?, ?, ?, 'egg', 10, ?, ?, ?)
    `).run(id, opts?.name || 'Buddy', species, rarity, today, now, now);

    // 初始化功能节点
    const featureStmt = this.db.prepare(`
      INSERT OR IGNORE INTO pet_features (pet_id, feature_id, name, description, category, emoji, discovered, use_count, mastery)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
    `);
    for (const def of FEATURE_DEFS) {
      featureStmt.run(id, def.id, def.name, def.description, def.category, def.emoji);
    }

    // 初始化行为信号
    const signals = defaultBehaviorSignals();
    this.db.prepare(`
      INSERT INTO pet_behavior (pet_id, snark, wisdom, chaos, patience, debugging, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(id, signals.snark, signals.wisdom, signals.chaos, signals.patience, signals.debugging);

    // 初始化战斗属性（含物种加成）
    const stats = { ...defaultBattleStats() };
    const speciesInfo = getSpeciesInfo(species);
    if (speciesInfo.statBonus.maxHp) { stats.maxHp += speciesInfo.statBonus.maxHp; stats.hp = stats.maxHp; }
    if (speciesInfo.statBonus.attack) stats.attack += speciesInfo.statBonus.attack;
    if (speciesInfo.statBonus.defense) stats.defense += speciesInfo.statBonus.defense;
    if (speciesInfo.statBonus.speed) stats.speed += speciesInfo.statBonus.speed;
    if (speciesInfo.statBonus.intelligence) stats.intelligence += speciesInfo.statBonus.intelligence;

    this.db.prepare(`
      INSERT INTO pet_stats (pet_id, hp, max_hp, attack, defense, speed, intelligence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, stats.hp, stats.maxHp, stats.attack, stats.defense, stats.speed, stats.intelligence);

    // 初始化引导任务
    const guidanceStmt = this.db.prepare(`
      INSERT OR IGNORE INTO pet_guidance (pet_id, task_id, title, description, target_feature, hint, priority, shown)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    for (const def of GUIDANCE_DEFS) {
      guidanceStmt.run(id, def.id, def.title, def.description, def.targetFeature, def.hint, 0);
    }

    // 初始化视觉形象（默认种子，注册时由用户选择覆盖）
    const vSeed = defaultVisualSeed();
    this.db.prepare(`
      INSERT INTO pet_visual (pet_id, primary_color, texture, temperament, seed, stage, created_at)
      VALUES (?, ?, ?, ?, ?, 'egg', ?)
    `).run(id, vSeed.primaryColor, vSeed.texture, vSeed.temperament, vSeed.seed, now);

    return id;
  }

  // ==================== 核心方法：追踪功能使用 ====================

  trackFeature(featureId: string): TrackResult {
    const now = Date.now();
    const row = this.db.prepare(
      'SELECT discovered, use_count FROM pet_features WHERE pet_id = ? AND feature_id = ?'
    ).get(this.petId, featureId) as { discovered: number; use_count: number } | undefined;

    if (!row) {
      // 未知功能，忽略
      return { featureId, isNewDiscovery: false, evolved: false, intimacyChange: 0, masteryIncrease: 0, formProgress: this.getVisualIdentity().formProgress, visualStageChanged: false };
    }

    const wasDiscovered = row.discovered === 1;
    const oldUseCount = row.use_count;
    const newUseCount = oldUseCount + 1;
    const newMastery = calcMastery(newUseCount);
    const isNewDiscovery = !wasDiscovered;

    // 更新功能节点
    this.db.prepare(`
      UPDATE pet_features SET
        discovered = 1,
        first_used_at = COALESCE(first_used_at, ?),
        use_count = ?,
        last_used_at = ?,
        mastery = ?
      WHERE pet_id = ? AND feature_id = ?
    `).run(now, newUseCount, now, newMastery, this.petId, featureId);

    // 更新统计
    if (FEATURE_DEFS.find(f => f.id === featureId)?.category === 'basic' || 
        FEATURE_DEFS.find(f => f.id === featureId)?.category === 'advanced' ||
        FEATURE_DEFS.find(f => f.id === featureId)?.category === 'expert') {
      this.db.prepare('UPDATE pet_data SET total_tool_calls = total_tool_calls + 1 WHERE id = ?').run(this.petId);
    }

    // 计算亲密度变化
    let intimacyChange = 0;
    if (isNewDiscovery) {
      intimacyChange = 6; // 发现新功能 +6
    } else if (newUseCount === 10 || newUseCount === 50) {
      intimacyChange = 2; // 使用深度里程碑
    } else if (newUseCount === 100) {
      intimacyChange = 5;
    }
    if (intimacyChange > 0) {
      this.db.prepare('UPDATE pet_data SET intimacy = MIN(100, intimacy + ?) WHERE id = ?')
        .run(intimacyChange, this.petId);
    }

    // 检查进化（亲密度驱动：进化靠旅程不靠数功能）
    const currentIntimacy = this.getIntimacy();
    const newStageInfo = getEvolutionStageByIntimacy(currentIntimacy);
    const currentStage = (this.db.prepare('SELECT evolution_stage FROM pet_data WHERE id = ?')
      .get(this.petId) as { evolution_stage: string } | undefined)?.evolution_stage;
    const evolved = newStageInfo.stage !== currentStage;

    let previousStage: string | undefined;
    let newStageName: string | undefined;
    if (evolved) {
      previousStage = currentStage;
      newStageName = newStageInfo.name;
      this.db.prepare('UPDATE pet_data SET evolution_stage = ? WHERE id = ?')
        .run(newStageInfo.stage, this.petId);

      // 应用进化属性加成
      if (newStageInfo.statBonus.maxHp) {
        this.db.prepare('UPDATE pet_stats SET max_hp = max_hp + ?, hp = max_hp + ? WHERE pet_id = ?')
          .run(newStageInfo.statBonus.maxHp, newStageInfo.statBonus.maxHp, this.petId);
      }
      if (newStageInfo.statBonus.attack) {
        this.db.prepare('UPDATE pet_stats SET attack = attack + ? WHERE pet_id = ?')
          .run(newStageInfo.statBonus.attack, this.petId);
      }
      if (newStageInfo.statBonus.defense) {
        this.db.prepare('UPDATE pet_stats SET defense = defense + ? WHERE pet_id = ?')
          .run(newStageInfo.statBonus.defense, this.petId);
      }
      if (newStageInfo.statBonus.speed) {
        this.db.prepare('UPDATE pet_stats SET speed = speed + ? WHERE pet_id = ?')
          .run(newStageInfo.statBonus.speed, this.petId);
      }
      if (newStageInfo.statBonus.intelligence) {
        this.db.prepare('UPDATE pet_stats SET intelligence = intelligence + ? WHERE pet_id = ?')
          .run(newStageInfo.statBonus.intelligence, this.petId);
      }
    }

    // 标记完成的引导任务
    this.db.prepare('UPDATE pet_guidance SET shown = 1, completed_at = ? WHERE pet_id = ? AND target_feature = ? AND completed_at IS NULL')
      .run(now, this.petId, featureId);

    // 更新最后活跃时间
    this.db.prepare('UPDATE pet_data SET last_active_at = ? WHERE id = ?').run(now, this.petId);

    // 形象进度增长
    let formDelta = 0;
    if (isNewDiscovery) formDelta += 3;          // 发现新功能 +3
    if (newUseCount % 10 === 0) formDelta += 1;  // 每 10 次使用 +1
    const visualResult = formDelta > 0 ? this.updateFormProgress(formDelta) : { newProgress: this.getVisualIdentity().formProgress, stageChanged: false };

    // 获取下一个引导
    const newGuidance = this.getNextGuidance();

    return {
      featureId,
      isNewDiscovery,
      evolved,
      previousStage,
      newStage: newStageName,
      newGuidance: newGuidance || undefined,
      intimacyChange,
      masteryIncrease: newMastery - calcMastery(oldUseCount),
      formProgress: visualResult.newProgress,
      visualStageChanged: visualResult.stageChanged,
      newVisualStage: visualResult.newStage,
    };
  }

  // ==================== 引导引擎 ====================

  getNextGuidance(): GuidanceTask | null {
    const now = Date.now();
    const data = this.getData();

    // 距离上次推荐至少 5 分钟
    if (now - data.lastGuidanceAt < 5 * 60 * 1000) return null;

    // 获取已完成的功能
    const features = this.getFeaturesMap();
    const discoveredIds = new Set(Object.entries(features).filter(([, f]) => f.discovered).map(([id]) => id));

    // 获取所有引导任务
    const tasks = this.db.prepare(`
      SELECT task_id, title, description, target_feature, hint, priority, shown, completed_at
      FROM pet_guidance WHERE pet_id = ?
    `).all(this.petId) as GuidanceRow[];

    // 过滤：未完成 + 前置条件满足 + 目标功能未发现
    const candidates = tasks.filter(t => {
      if (t.completed_at) return false;                      // 已完成
      if (discoveredIds.has(t.target_feature)) return false; // 目标功能已发现
      return true;
    });

    if (candidates.length === 0) return null;

    // 优先推荐目标功能未发现的
    // 按 category 排序：basic > advanced > expert > hidden
    const catOrder: Record<string, number> = { basic: 0, advanced: 1, expert: 2, hidden: 3 };
    candidates.sort((a, b) => {
      const aCat = features[a.target_feature]?.category || 'hidden';
      const bCat = features[b.target_feature]?.category || 'hidden';
      return (catOrder[aCat] || 99) - (catOrder[bCat] || 99);
    });

    const best = candidates[0];
    return {
      id: best.task_id,
      title: best.title,
      description: best.description,
      targetFeature: best.target_feature,
      hint: best.hint,
      priority: best.priority,
      shown: best.shown === 1,
      completedAt: best.completed_at || undefined,
    };
  }

  markGuidanceShown(taskId: string): void {
    this.db.prepare('UPDATE pet_guidance SET shown = 1 WHERE pet_id = ? AND task_id = ?')
      .run(this.petId, taskId);
    this.db.prepare('UPDATE pet_data SET last_guidance_at = ? WHERE id = ?')
      .run(Date.now(), this.petId);
  }

  // ==================== 行为信号计算 ====================

  /** 从使用模式计算5维属性（每100条交互重新计算） */
  /** 从使用上下文计算人格变化（涌现式，增量更新 + 物种倾向 + 随机性） */
  computeBehaviorSignals(context: {
    toolCategories: Record<string, number>;
    correctionCount: number;
    encourageCount: number;
    negationCount: number;
    repeatQuestionCount: number;
    uniqueToolsUsed: number;
    totalInteractions: number;
  }): BehaviorSignals {
    const { toolCategories, correctionCount, encourageCount, negationCount, repeatQuestionCount, uniqueToolsUsed, totalInteractions } = context;

    // 获取当前值（增量更新，不是替换）
    const current = this.getBehaviorSignals();

    // 物种成长倾向
    const petData = this.getData();
    const bias = SPECIES_GROWTH_BIAS[petData.species] ?? SPECIES_GROWTH_BIAS['光灵'];

    // 随机噪声（±10%，每只 Buddy 独特）
    const noise = () => 0.9 + Math.random() * 0.2;

    // 计算各维度的目标方向
    const advancedTools = (toolCategories['advanced'] || 0) + (toolCategories['expert'] || 0);
    const debugTools = (toolCategories['exec'] || 0) + (toolCategories['search_files'] || 0)
      + (toolCategories['analyze_file'] || 0) + (toolCategories['find_references'] || 0);

    const target = {
      snark:     clamp(50 + (encourageCount - negationCount) * 3 - correctionCount * 2, 0, 100),
      wisdom:    clamp(30 + advancedTools * 2 + uniqueToolsUsed * 1.5, 0, 100),
      chaos:     clamp(20 + uniqueToolsUsed * 4, 0, 100),
      patience:  clamp(50 + repeatQuestionCount * 2 - negationCount * 5, 0, 100),
      debugging: clamp(20 + debugTools * 3, 0, 100),
    };

    // 增量更新：90% 惯性 + 10% 新方向（× 物种倾向 × 随机噪声）
    const INERTIA = 0.9;
    const signals: BehaviorSignals = {
      snark:     clamp(current.snark     * INERTIA + target.snark     * (1 - INERTIA) * bias.snark     * noise(), 0, 100),
      wisdom:    clamp(current.wisdom    * INERTIA + target.wisdom    * (1 - INERTIA) * bias.wisdom    * noise(), 0, 100),
      chaos:     clamp(current.chaos     * INERTIA + target.chaos     * (1 - INERTIA) * bias.chaos     * noise(), 0, 100),
      patience:  clamp(current.patience  * INERTIA + target.patience  * (1 - INERTIA) * bias.patience  * noise(), 0, 100),
      debugging: clamp(current.debugging * INERTIA + target.debugging * (1 - INERTIA) * bias.debugging * noise(), 0, 100),
      lastComputedAt: Date.now(),
      sampleCount: totalInteractions,
    };

    // 持久化
    this.db.prepare(`
      UPDATE pet_behavior SET snark=?, wisdom=?, chaos=?, patience=?, debugging=?, last_computed_at=?, sample_count=?
      WHERE pet_id=?
    `).run(signals.snark, signals.wisdom, signals.chaos, signals.patience, signals.debugging,
      signals.lastComputedAt, signals.sampleCount, this.petId);

    // ── 同步更新 OCEAN 大五人格 ──
    // 从行为信号构建 PersonalityContext，驱动 OCEAN 值随交互演化
    try {
      const oceanCtx: import('../personality/ocean.js').PersonalityContext = {
        totalInteractions,
        uniqueToolsUsed,
        uniqueDomains: Object.keys(toolCategories).length,
        newFeatureDiscoveries: uniqueToolsUsed,
        taskCompleteRate: Math.max(0, 1 - correctionCount / Math.max(1, totalInteractions)),
        abandonedTasks: correctionCount,
        errorRetryWithoutFix: repeatQuestionCount,
        avgMessageLength: 0, // 由上层补充
        proactiveSpeakCount: 0,
        feedbackInteractions: encourageCount + correctionCount,
        gratitudeCount: encourageCount,
        harshNegation: negationCount,
        softCorrection: correctionCount,
        consecutiveErrors: 0,
        successfulRecovery: encourageCount,
        longStablePeriod: totalInteractions > 50 && correctionCount < 3,
        recentEmotionVariance: negationCount / Math.max(1, totalInteractions),
      };
      this.computeAndUpdateOcean(oceanCtx);
    } catch {
      // OCEAN 更新失败不影响行为信号
    }

    return signals;
  }

  getBehaviorSignals(): BehaviorSignals {
    const row = this.db.prepare('SELECT * FROM pet_behavior WHERE pet_id = ?').get(this.petId) as BehaviorRow | undefined;
    if (!row) return defaultBehaviorSignals();
    return {
      snark: row.snark, wisdom: row.wisdom, chaos: row.chaos,
      patience: row.patience, debugging: row.debugging,
      lastComputedAt: row.last_computed_at, sampleCount: row.sample_count,
    };
  }

  // ==================== OCEAN 大五人格（三合一改造） ====================

  /** 获取当前 OCEAN 人格（无则从旧 5 维迁移或使用物种基线+随机抖动） */
  getOcean(): OceanPersonality {
    const row = this.db.prepare('SELECT * FROM pet_ocean WHERE pet_id = ?').get(this.petId) as OceanRow | undefined;
    if (row) {
      return {
        openness: row.openness, conscientiousness: row.conscientiousness,
        extraversion: row.extraversion, agreeableness: row.agreeableness, neuroticism: row.neuroticism,
      };
    }
    // 首次：使用物种基线 + 随机抖动生成初始值（成长系统核心）
    const species = this.getSpecies();
    const ocean = speciesInitialOcean(species);
    // 持久化
    this.db.prepare(`INSERT OR REPLACE INTO pet_ocean (pet_id, openness, conscientiousness, extraversion, agreeableness, neuroticism, last_computed_at, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      this.petId, ocean.openness, ocean.conscientiousness, ocean.extraversion, ocean.agreeableness, ocean.neuroticism, Date.now(), 0,
    );
    return ocean;
  }

  /** 从行为上下文计算并更新 OCEAN（每 100 条交互调用） */
  computeAndUpdateOcean(ctx: import('../personality/ocean.js').PersonalityContext): OceanPersonality {
    const current = this.getOcean();
    const species = this.getSpecies();
    const bias = SPECIES_OCEAN_BIAS[species] ?? {};
    const ps = this.getPersonalityStrength();
    const updated = computeOcean(ctx, current, bias, ps);
    this.db.prepare(`INSERT OR REPLACE INTO pet_ocean (pet_id, openness, conscientiousness, extraversion, agreeableness, neuroticism, last_computed_at, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      this.petId, updated.openness, updated.conscientiousness, updated.extraversion, updated.agreeableness, updated.neuroticism,
      Date.now(), (this.db.prepare('SELECT sample_count FROM pet_ocean WHERE pet_id = ?').get(this.petId) as { sample_count: number } | undefined)?.sample_count ?? 0 + 1,
    );
    return updated;
  }

  /** 获取当前 personalityStrength (PS: 0→1) */
  getPersonalityStrength(): number {
    const data = this.getData();
    return getPersonalityStrength(data.evolutionStage, data.formProgress);
  }

  /** 获取物种名 */
  getSpecies(): string {
    return (this.db.prepare('SELECT species FROM pet_data WHERE id = ?').get(this.petId) as { species: string } | undefined)?.species ?? '光灵';
  }

  // ==================== 亲密度管理 ====================

  getIntimacy(): number {
    return (this.db.prepare('SELECT intimacy FROM pet_data WHERE id = ?').get(this.petId) as IntimacyRow | undefined)?.intimacy || 0;
  }

  addIntimacy(delta: number): number {
    this.db.prepare('UPDATE pet_data SET intimacy = MIN(100, MAX(0, intimacy + ?)) WHERE id = ?')
      .run(delta, this.petId);
    return this.getIntimacy();
  }

  // ==================== 消息/天数追踪 ====================

  trackMessage(): void {
    this.db.prepare('UPDATE pet_data SET total_messages = total_messages + 1 WHERE id = ?').run(this.petId);
    this.recordDailyActivity('messages');
  }

  /** 记录工具调用 */
  trackToolCall(): void {
    this.db.prepare('UPDATE pet_data SET total_tool_calls = total_tool_calls + 1 WHERE id = ?').run(this.petId);
    this.recordDailyActivity('tool_calls');
  }

  /** 记录每日活动量 */
  private recordDailyActivity(field: 'messages' | 'tool_calls'): void {
    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare(`
      INSERT INTO pet_daily_activity (pet_id, date, ${field}) VALUES (?, ?, 1)
      ON CONFLICT(pet_id, date) DO UPDATE SET ${field} = ${field} + 1
    `).run(this.petId, today);
  }

  /** 获取每日活动数据（最近 N 天） */
  getDailyActivity(days = 28): { date: string; messages: number; toolCalls: number }[] {
    const rows = this.db.prepare(`
      SELECT date, messages, tool_calls FROM pet_daily_activity
      WHERE pet_id = ? ORDER BY date DESC LIMIT ?
    `).all(this.petId, days) as { date: string; messages: number; tool_calls: number }[];
    return rows.map(r => ({ date: r.date, messages: r.messages, toolCalls: r.tool_calls })).reverse();
  }

  updateConsecutiveDays(): void {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare('SELECT last_active_date, consecutive_days FROM pet_data WHERE id = ?')
      .get(this.petId) as LastDateRow | undefined;
    if (!row || row.last_active_date === today) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newDays = row.last_active_date === yesterday ? row.consecutive_days + 1 : 1;

    this.db.prepare('UPDATE pet_data SET last_active_date = ?, consecutive_days = ?, total_days = total_days + 1 WHERE id = ?')
      .run(today, newDays, this.petId);

    // 连续天数加亲密度
    if (newDays > 1 && newDays % 7 === 0) {
      this.addIntimacy(5);
    }
  }

  // ==================== 深夜/清晨检测 ====================

  isSpecialTime(): 'midnight' | 'morning' | null {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 4) return 'midnight';
    if (hour >= 4 && hour < 6) return 'morning';
    return null;
  }

  trackSpecialTimeFeature(): void {
    const special = this.isSpecialTime();
    if (special === 'midnight') this.trackFeature('midnight_chat');
    else if (special === 'morning') this.trackFeature('morning_bird');
  }

  // ==================== 数据查询 ====================

  getData(): PetData {
    const row = this.db.prepare('SELECT * FROM pet_data WHERE id = ?').get(this.petId) as PetDataRow | undefined;
    if (!row) throw new Error('Pet not found');
    const visual = this.getVisualIdentity();
    return {
      id: row.id,
      name: row.name,
      species: row.species,
      rarity: row.rarity as Rarity,
      evolutionStage: row.evolution_stage as EvolutionStage,
      intimacy: row.intimacy,
      behaviorSignals: this.getBehaviorSignals(),
      battleStats: this.getBattleStats(),
      totalMessages: row.total_messages,
      totalToolCalls: row.total_tool_calls,
      totalDays: row.total_days,
      consecutiveDays: row.consecutive_days,
      lastActiveDate: row.last_active_date,
      lastGuidanceAt: row.last_guidance_at,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      visualSeed: visual.seed,
      formProgress: visual.formProgress,
    };
  }

  getFeatures(): FeatureNode[] {
    const rows = this.db.prepare('SELECT * FROM pet_features WHERE pet_id = ? ORDER BY category, feature_id')
      .all(this.petId) as FeatureRow[];
    return rows.map(r => ({
      id: r.feature_id, name: r.name, description: r.description,
      category: r.category as FeatureCategory, emoji: r.emoji,
      discovered: r.discovered === 1, firstUsedAt: r.first_used_at ?? undefined,
      useCount: r.use_count, lastUsedAt: r.last_used_at ?? undefined, mastery: r.mastery,
    }));
  }

  private getFeaturesMap(): Record<string, FeatureNode> {
    const features = this.getFeatures();
    const map: Record<string, FeatureNode> = {};
    for (const f of features) map[f.id] = f;
    return map;
  }

  getBattleStats(): BattleStats {
    const row = this.db.prepare('SELECT * FROM pet_stats WHERE pet_id = ?').get(this.petId) as StatsRow | undefined;
    if (!row) return defaultBattleStats();
    return {
      hp: row.hp, maxHp: row.max_hp, attack: row.attack,
      defense: row.defense, speed: row.speed, intelligence: row.intelligence,
    };
  }

  /** 获取完整摘要（给前端） */
  getSummary() {
    const data = this.getData();
    const features = this.getFeatures();
    const counts = countByCategory(this.getFeaturesMap());
    const stageInfo = getEvolutionStageByIntimacy(data.intimacy);
    const speciesInfo = getSpeciesInfo(data.species);
    const guidance = this.getNextGuidance();
    const discoveredCount = features.filter(f => f.discovered).length;
    const totalCount = features.length;

    return {
      id: data.id,
      name: data.name,
      species: data.species,
      emoji: speciesInfo.emoji,
      rarity: data.rarity,
      rarityColor: {
        Common: '#8b949e', Uncommon: '#3fb950', Rare: '#d29922',
        Epic: '#f778ba', Legendary: '#f0883e',
      }[data.rarity],
      evolutionStage: stageInfo.stage,
      stageName: stageInfo.name,
      stageEmoji: stageInfo.emoji,
      stageDescription: stageInfo.description,
      intimacy: Math.round(data.intimacy),
      intimacyDescription: getIntimacyDescription(data.intimacy),
      behaviorSignals: data.behaviorSignals,
      battleStats: data.battleStats,
      features: features,
      exploration: {
        discovered: discoveredCount,
        total: totalCount,
        basic: counts.basic,
        advanced: counts.advanced,
        expert: counts.expert,
        hidden: counts.hidden,
        basicTotal: features.filter(f => f.category === 'basic').length,
        advancedTotal: features.filter(f => f.category === 'advanced').length,
        expertTotal: features.filter(f => f.category === 'expert').length,
        hiddenTotal: features.filter(f => f.category === 'hidden').length,
      },
      guidance: guidance ? {
        id: guidance.id,
        title: guidance.title,
        description: guidance.description,
        hint: guidance.hint,
        targetFeature: guidance.targetFeature,
      } : null,
      stats: {
        totalMessages: data.totalMessages,
        totalToolCalls: data.totalToolCalls,
        totalDays: data.totalDays,
        consecutiveDays: data.consecutiveDays,
        dailyActivity: this.getDailyActivity(28),
      },
      // 视觉形象
      visualSeed: data.visualSeed,
      formProgress: Math.round(data.formProgress),
      visualStage: getVisualStage(data.formProgress),
    };
  }

  // ==================== 基因系统 ====================

  /** 计算并返回 BuddyGenome（30 参数涌现） */
  getGenome(cognitive?: {
    getUserProfile: () => { identity: { techStack: string[] }; behavior: { preferredDetailLevel: string } };
    getAllDomainProfiles: () => Array<{ growthStage: string; knowledgeCount: number }>;
  }): BuddyGenome {
    const data = this.getData();
    const ocean = this.getOcean();
    const ps = this.getPersonalityStrength();
    const visual = this.getVisualIdentity();

    // 默认 profile（cognitive 未接入时）
    const userProfile = cognitive?.getUserProfile() ?? {
      identity: { techStack: [] },
      behavior: { preferredDetailLevel: 'balanced' as const },
    };
    const domainProfiles = cognitive?.getAllDomainProfiles() ?? [];

    const ctx: GenomeContext = {
      visualSeed: visual.seed,
      behaviorSignals: data.behaviorSignals,
      ocean,
      userProfile: {
        identity: { techStack: userProfile.identity.techStack },
        behavior: { preferredDetailLevel: userProfile.behavior.preferredDetailLevel as 'thorough' | 'brief' | 'balanced' },
      },
      domainProfiles,
      emotionEnergy: 0.5, // 由调用方补充
      evolutionStage: data.evolutionStage,
      formProgress: data.formProgress,
      personalityStrength: ps,
    };

    return computeGenome(ctx);
  }

  // ==================== 重命名 ====================

  rename(newName: string): void {
    this.db.prepare('UPDATE pet_data SET name = ? WHERE id = ?').run(newName, this.petId);
  }

  // ==================== 视觉形象系统 ====================

  /** 注册用户视觉种子（Onboarding 时调用） */
  registerVisualSeed(seed: VisualSeed): void {
    this.db.prepare(`
      UPDATE pet_visual SET primary_color = ?, secondary_color = ?, texture = ?, temperament = ?, seed = ?
      WHERE pet_id = ?
    `).run(seed.primaryColor, seed.secondaryColor || null, seed.texture, seed.temperament, seed.seed, this.petId);
  }

  /** 获取完整视觉形象数据 */
  getVisualIdentity(): VisualIdentity {
    const row = this.db.prepare('SELECT * FROM pet_visual WHERE pet_id = ?').get(this.petId) as VisualRow | undefined;
    if (!row) {
      const d = defaultVisualSeed();
      return { seed: d, stage: 'egg', formProgress: 0 };
    }
    return {
      seed: {
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color || undefined,
        texture: row.texture as VisualSeed['texture'],
        temperament: row.temperament as VisualSeed['temperament'],
        seed: row.seed,
      },
      stage: row.stage as VisualStage,
      formProgress: row.form_progress,
      svgCache: row.svg_cache || undefined,
      svgGeneratedAt: row.svg_generated_at || undefined,
    };
  }

  /** 增加 formProgress 并自动推进阶段 */
  updateFormProgress(delta: number): { newProgress: number; stageChanged: boolean; newStage?: VisualStage } {
    const current = this.getVisualIdentity();
    const newProgress = Math.min(100, current.formProgress + delta);
    const oldStage = current.stage;
    const stageInfo = getVisualStage(newProgress);
    const stageChanged = stageInfo.stage !== oldStage;

    this.db.prepare('UPDATE pet_visual SET form_progress = ?, stage = ? WHERE pet_id = ?')
      .run(newProgress, stageInfo.stage, this.petId);

    return {
      newProgress,
      stageChanged,
      newStage: stageChanged ? stageInfo.stage : undefined,
    };
  }

  /** 缓存生成的 SVG（成形阶段调用） */
  cacheSvg(svg: string): void {
    this.db.prepare('UPDATE pet_visual SET svg_cache = ?, svg_generated_at = ? WHERE pet_id = ?')
      .run(svg, Date.now(), this.petId);
  }

  // ==================== 关闭 ====================

  close(): void {
    this.db.close();
  }

  // ==================== 工具方法 ====================

  private rollRarity(): Rarity {
    const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
      roll -= weight;
      if (roll <= 0) return rarity as Rarity;
    }
    return 'Common';
  }
}

// ==================== 辅助 ====================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ==================== Schema Migrations ====================

const PET_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '添加 nickname 字段到 pet_data',
    up(db) {
      // 如果 nickname 列不存在则添加
      const cols = db.prepare("PRAGMA table_info(pet_data)").all() as { name: string }[];
      if (!cols.some(c => c.name === 'nickname')) {
        db.exec("ALTER TABLE pet_data ADD COLUMN nickname TEXT DEFAULT ''");
      }
    },
  },
  {
    version: 2,
    description: '为 pet_features 添加 feature_index 加速查询',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_pet_features_pet ON pet_features(pet_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_pet_features_discovered ON pet_features(pet_id, discovered)');
    },
  },
];
