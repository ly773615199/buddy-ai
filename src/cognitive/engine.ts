/**
 * 认知三层架构 — Buddy 的"思想"
 *
 * 用户模型：他是谁 / 怎么做事 / 喜欢什么
 * 自我模型：我能做什么 / 我经历了什么 / 我在想什么
 * 意图引擎：我想做什么 / 我好奇什么 / 我什么时候该主动说
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { DomainProfile } from '../knowledge/extractor.js';
import { runMigrations, type Migration } from '../core/migration.js';

const COGNITIVE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始化认知引擎表结构',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_profile (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS self_model (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS micro_goals (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          priority INTEGER DEFAULT 5,
          status TEXT DEFAULT 'pending',
          trigger TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS curiosities (
          question TEXT PRIMARY KEY,
          findings TEXT DEFAULT '',
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS domain_profiles (
          domain TEXT PRIMARY KEY,
          domain_type TEXT DEFAULT 'rule_based',
          knowledge_count INTEGER DEFAULT 0,
          depth_score REAL DEFAULT 0,
          expertise_signals INTEGER DEFAULT 0,
          growth_stage TEXT DEFAULT 'seed',
          conversation_count INTEGER DEFAULT 0,
          last_active_at INTEGER NOT NULL,
          is_active INTEGER DEFAULT 1
        );
      `);
    },
  },
];

// SQLite 行类型
interface KeyValRow { key: string; value: string; updated_at: number }
interface CountRow { c: number }
interface GoalRow {
  id: string; goal: string; priority: number; status: string;
  trigger: string; created_at: number; completed_at: number | null;
}
interface CuriosityRow { question: string; findings: string; timestamp: number }
interface DomainRow {
  domain: string; domain_type: string; knowledge_count: number; depth_score: number;
  expertise_signals: number; growth_stage: string; conversation_count: number;
  last_active_at: number; is_active: number;
}
interface TimestampRow { t: number | null }

// ==================== 用户模型 ====================

export interface UserProfile {
  // 身份层
  identity: {
    role: string;               // "前端开发" | "全栈" | "学生"
    techStack: string[];        // 技术栈
    experience: 'junior' | 'mid' | 'senior';
    primaryLanguage: string;    // 主要语言
  };

  // 行为层
  behavior: {
    activeHours: [number, number];  // 活跃时段
    workPattern: 'focused' | 'multitask' | 'exploratory';
    askStyle: 'direct' | 'exploratory';
    preferredDetailLevel: 'brief' | 'balanced' | 'thorough';
    errorTolerance: 'impatient' | 'normal' | 'patient';
  };

  // 偏好层
  preferences: {
    codeStyle: string;
    toolPreferences: string[];
    communicationStyle: string;
    topicsOfInterest: string[];
    topicsToAvoid: string[];
  };

  // 关系层
  relationship: {
    nickname: string;
    humorResponse: number;      // 0-1
    correctionResponse: number; // 0-1
  };

  // 演化记录
  evolution: Array<{
    timestamp: number;
    field: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }>;

  lastUpdated: number;
}

// ==================== 自我模型 ====================

export interface SelfModel {
  // 能力认知
  competence: {
    strengths: string[];
    weaknesses: string[];
    confidence: Record<string, number>;  // 领域 → 置信度 0-1
    learnedSkills: string[];
  };

  // 经历叙事
  narrative: {
    milestones: Array<{
      timestamp: number;
      event: string;
      emotional: number;  // -1 到 1
    }>;
    beliefs: string[];
    opinions: Record<string, string>;
  };

  // 情绪状态
  emotionalState: {
    mood: string;
    recentSatisfaction: number;
    curiosityTopics: string[];
  };

  // 自我反思
  reflections: Array<{
    timestamp: number;
    question: string;
    answer: string;
    action?: string;
  }>;

  lastUpdated: number;
}

// ==================== 意图引擎 ====================

export interface MicroGoal {
  id: string;
  goal: string;
  priority: number;       // 1-10
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  trigger: string;
  createdAt: number;
  completedAt?: number;
}

export interface CuriosityQuestion {
  question: string;
  findings: string;
  timestamp: number;
}

export interface IntentionState {
  microGoals: MicroGoal[];
  curiosities: CuriosityQuestion[];
  lastProactiveTime: number;
}

// ==================== 认知引擎 ====================

export class CognitiveEngine {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db, 'cognitive', COGNITIVE_MIGRATIONS);
  }

  // ==================== 用户模型 ====================

  /** 获取用户画像 */
  getUserProfile(): UserProfile {
    const defaultProfile: UserProfile = {
      identity: { role: '未知', techStack: [], experience: 'mid', primaryLanguage: 'zh-CN' },
      behavior: { activeHours: [9, 23], workPattern: 'focused', askStyle: 'direct', preferredDetailLevel: 'balanced', errorTolerance: 'normal' },
      preferences: { codeStyle: '', toolPreferences: [], communicationStyle: '简洁直接', topicsOfInterest: [], topicsToAvoid: [] },
      relationship: { nickname: '', humorResponse: 0.5, correctionResponse: 0.5 },
      evolution: [],
      lastUpdated: Date.now(),
    };

    try {
      const rows = this.db.prepare('SELECT key, value FROM user_profile').all() as KeyValRow[];
      if (rows.length === 0) return defaultProfile;

      const profile = { ...defaultProfile };
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value);
          (profile as Record<string, unknown>)[row.key] = parsed;
        } catch { /* skip invalid */ }
      }
      return profile;
    } catch {
      return defaultProfile;
    }
  }

  /** 更新用户画像字段 */
  updateUserField(field: string, value: unknown, reason = ''): void {
    const now = Date.now();
    const old = this.db.prepare('SELECT value FROM user_profile WHERE key = ?').get(field) as KeyValRow | undefined;

    this.db.prepare(`
      INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(field, JSON.stringify(value), now);

    // 记录演化（但更新 evolution 字段本身时不递归记录）
    if (old && old.value !== JSON.stringify(value) && field !== 'evolution') {
      this.recordEvolution(field, old.value, JSON.stringify(value), reason);
    }
  }

  /** 从对话中自动推断用户信息 */
  inferFromMessage(content: string, toolCalls: string[]): void {
    const lower = content.toLowerCase();

    // 推断技术栈
    const techPatterns: Record<string, RegExp> = {
      'React': /\breact\b/i,
      'Vue': /\bvue\b/i,
      'TypeScript': /\b(typescript|\.tsx?)\b/i,
      'Python': /\b(python|\.py)\b/i,
      'Go': /\b(golang|\.go)\b/i,
      'Rust': /\b(rust|\.rs)\b/i,
      'Node.js': /\b(node|npm|npx)\b/i,
    };

    const currentProfile = this.getUserProfile();
    const newTechStack = new Set(currentProfile.identity.techStack);

    for (const [tech, pattern] of Object.entries(techPatterns)) {
      if (pattern.test(lower) || toolCalls.some(t => pattern.test(t))) {
        newTechStack.add(tech);
      }
    }

    if (newTechStack.size !== currentProfile.identity.techStack.length) {
      this.updateUserField('identity', {
        ...currentProfile.identity,
        techStack: [...newTechStack],
      }, '对话中检测到技术栈');
    }

    // 推断提问风格
    if (/^(怎么|如何|为什么|how|why|what)/i.test(lower)) {
      const freshProfile = this.getUserProfile();
      this.updateUserField('behavior', {
        ...freshProfile.behavior,
        askStyle: 'exploratory',
      }, '用户习惯探索式提问');
    }

    // 推断详细偏好
    if (lower.length < 20) {
      const freshProfile = this.getUserProfile();
      this.updateUserField('behavior', {
        ...freshProfile.behavior,
        preferredDetailLevel: 'brief',
      }, '用户消息简短');
    }
  }

  /** 生成用户画像的 Prompt 片段 */
  getUserPromptFragment(): string {
    const p = this.getUserProfile();
    const parts: string[] = [];

    if (p.identity.role !== '未知') {
      parts.push(`用户角色: ${p.identity.role}`);
    }
    if (p.identity.techStack.length > 0) {
      parts.push(`技术栈: ${p.identity.techStack.join(', ')}`);
    }
    parts.push(`提问风格: ${p.behavior.askStyle}`);
    parts.push(`详细偏好: ${p.behavior.preferredDetailLevel}`);
    if (p.preferences.communicationStyle) {
      parts.push(`沟通风格: ${p.preferences.communicationStyle}`);
    }

    return parts.join('\n');
  }

  // ==================== 自我模型 ====================

  getSelfModel(): SelfModel {
    const defaultModel: SelfModel = {
      competence: { strengths: [], weaknesses: [], confidence: {}, learnedSkills: [] },
      narrative: { milestones: [], beliefs: [], opinions: {} },
      emotionalState: { mood: 'calm', recentSatisfaction: 50, curiosityTopics: [] },
      reflections: [],
      lastUpdated: Date.now(),
    };

    try {
      const rows = this.db.prepare('SELECT key, value FROM self_model').all() as KeyValRow[];
      if (rows.length === 0) return defaultModel;

      const model = { ...defaultModel };
      for (const row of rows) {
        try {
          model[row.key as keyof SelfModel] = JSON.parse(row.value);
        } catch { /* skip */ }
      }
      return model;
    } catch {
      return defaultModel;
    }
  }

  updateSelfField(field: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO self_model (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(field, JSON.stringify(value), Date.now());
  }

  /** 记录里程碑 */
  addMilestone(event: string, emotional: number): void {
    const model = this.getSelfModel();
    model.narrative.milestones.push({ timestamp: Date.now(), event, emotional });
    // 只保留最近 50 条
    if (model.narrative.milestones.length > 50) {
      model.narrative.milestones = model.narrative.milestones.slice(-50);
    }
    this.updateSelfField('narrative', model.narrative);
  }

  /** 更新能力置信度 */
  updateConfidence(domain: string, success: boolean): void {
    const model = this.getSelfModel();
    const current = model.competence.confidence[domain] ?? 0.5;
    model.competence.confidence[domain] = success
      ? Math.min(1, current + 0.05)
      : Math.max(0, current - 0.1);
    this.updateSelfField('competence', model.competence);
  }

  /** 生成自我认知的 Prompt 片段 */
  getSelfPromptFragment(): string {
    const m = this.getSelfModel();
    const parts: string[] = [];

    if (m.competence.strengths.length > 0) {
      parts.push(`我擅长: ${m.competence.strengths.join(', ')}`);
    }
    if (m.competence.weaknesses.length > 0) {
      parts.push(`我不太擅长: ${m.competence.weaknesses.join(', ')}`);
    }

    const topConfidence = Object.entries(m.competence.confidence)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topConfidence.length > 0) {
      parts.push(`我的自信领域: ${topConfidence.map(([k, v]) => `${k}(${Math.round(v * 100)}%)`).join(', ')}`);
    }

    parts.push(`当前情绪: ${m.emotionalState.mood}`);

    return parts.join('\n');
  }

  // ==================== 意图引擎 ====================

  /** 添加微目标 */
  addMicroGoal(goal: string, priority: number, trigger: string): void {
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.db.prepare(`
      INSERT INTO micro_goals (id, goal, priority, status, trigger, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, goal, priority, trigger, Date.now());
  }

  /** 获取待处理的微目标 */
  getPendingGoals(limit = 5): MicroGoal[] {
    const rows = this.db.prepare(`
      SELECT * FROM micro_goals WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC LIMIT ?
    `).all(limit) as GoalRow[];
    return rows.map(r => ({
      id: r.id, goal: r.goal, priority: r.priority,
      status: r.status as MicroGoal['status'], trigger: r.trigger,
      createdAt: r.created_at, completedAt: r.completed_at ?? undefined,
    }));
  }

  /** 完成微目标 */
  completeGoal(id: string): void {
    this.db.prepare('UPDATE micro_goals SET status = ?, completed_at = ? WHERE id = ?')
      .run('completed', Date.now(), id);
  }

  /** 添加好奇心问题 */
  addCuriosity(question: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO curiosities (question, findings, timestamp)
      VALUES (?, '', ?)
    `).run(question, Date.now());
  }

  /** 获取好奇心问题 */
  getCuriosities(limit = 5): CuriosityQuestion[] {
    const rows = this.db.prepare(`
      SELECT * FROM curiosities ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as CuriosityRow[];
    return rows.map(r => ({ question: r.question, findings: r.findings, timestamp: r.timestamp }));
  }

  /**
   * 判断是否应该主动发言
   * @param context 上下文信息
   * @returns true = 应该主动说
   */
  shouldSpeak(context: {
    idleMinutes: number;
    recentErrors: number;
    userMood: 'normal' | 'frustrated' | 'happy';
    hasNewInsight: boolean;
    hour: number;
    desires?: { hunger: number; curiosity: number; social: number; safety: number; expression: number; rest: number };
  }): boolean {
    // 深夜不主动（23:00 - 8:00）
    if (context.hour >= 23 || context.hour < 8) return false;

    // 用户烦躁时少说
    if (context.userMood === 'frustrated') return false;

    // 有新洞察时主动（跳过冷却）
    if (context.hasNewInsight) return true;

    // ── 欲望驱动（三合一新增）──
    if (context.desires) {
      if (context.desires.hunger > 85) return true;       // 饿了 → 主动找用户
      if (context.desires.curiosity > 75) return true;     // 好奇心强 → 主动提问
      if (context.desires.social > 80) return true;        // 社交欲强 → 主动搭话
    }

    // 用户报错多次时主动
    if (context.recentErrors >= 3) return true;

    // 距离上次主动发言至少 15 分钟
    const lastProactive = this.db.prepare(
      'SELECT MAX(timestamp) as t FROM curiosities'
    ).get() as TimestampRow | undefined;
    if (lastProactive?.t && Date.now() - lastProactive.t < 15 * 60 * 1000) {
      return false;
    }

    // 空闲超过 30 分钟，概率主动
    if (context.idleMinutes >= 30 && Math.random() < 0.3) return true;

    return false;
  }

  /** 从对话模式中推断微目标 */
  inferGoals(content: string, toolCalls: string[]): void {
    const lower = content.toLowerCase();

    // 频繁报错 → 调试协助
    if (/error|报错|失败|bug/i.test(lower)) {
      this.addMicroGoal('帮助用户解决当前错误', 8, '连续报错');
    }

    // 提到部署 → 了解部署流程
    if (/部署|deploy|上线|发布/i.test(lower)) {
      this.addMicroGoal('了解用户的部署流程', 5, '提及部署');
    }

    // 提到性能 → 性能分析
    if (/性能|慢|优化|performance/i.test(lower)) {
      this.addMicroGoal('分析项目性能瓶颈', 6, '提及性能');
    }
  }

  // ==================== 内部方法 ====================

  private recordEvolution(field: string, oldValue: string, newValue: string, reason: string): void {
    const profile = this.getUserProfile();
    profile.evolution.push({ timestamp: Date.now(), field, oldValue, newValue, reason });
    // 只保留最近 100 条
    if (profile.evolution.length > 100) {
      profile.evolution = profile.evolution.slice(-100);
    }
    this.updateUserField('evolution', profile.evolution);
  }

  // ==================== 领域画像 ====================

  /** 获取领域画像 */
  getDomainProfile(domain: string): DomainProfile {
    const defaultProfile: DomainProfile = {
      domain,
      domainType: 'rule_based',
      knowledgeCount: 0,
      depthScore: 0,
      expertiseSignals: 0,
      growthStage: 'seed',
      conversationCount: 0,
      lastActiveAt: Date.now(),
      isActive: true,
    };

    try {
      const row = this.db.prepare('SELECT * FROM domain_profiles WHERE domain = ?').get(domain) as DomainRow | undefined;
      if (!row) return defaultProfile;

      return {
        domain: row.domain,
        domainType: row.domain_type as DomainProfile['domainType'],
        knowledgeCount: row.knowledge_count,
        depthScore: row.depth_score,
        expertiseSignals: row.expertise_signals,
        growthStage: row.growth_stage as DomainProfile['growthStage'],
        conversationCount: row.conversation_count,
        lastActiveAt: row.last_active_at,
        isActive: row.is_active === 1,
      };
    } catch {
      return defaultProfile;
    }
  }

  /** 更新领域画像 */
  updateDomainProfile(domain: string, updates: Partial<DomainProfile>): void {
    const current = this.getDomainProfile(domain);
    const merged = { ...current, ...updates };

    this.db.prepare(`
      INSERT INTO domain_profiles (domain, domain_type, knowledge_count, depth_score, expertise_signals, growth_stage, conversation_count, last_active_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        domain_type = excluded.domain_type,
        knowledge_count = excluded.knowledge_count,
        depth_score = excluded.depth_score,
        expertise_signals = excluded.expertise_signals,
        growth_stage = excluded.growth_stage,
        conversation_count = excluded.conversation_count,
        last_active_at = excluded.last_active_at,
        is_active = excluded.is_active
    `).run(
      domain,
      merged.domainType,
      merged.knowledgeCount,
      merged.depthScore,
      merged.expertiseSignals,
      merged.growthStage,
      merged.conversationCount,
      merged.lastActiveAt,
      merged.isActive ? 1 : 0,
    );
  }

  /** 获取所有活跃领域画像 */
  getAllDomainProfiles(): DomainProfile[] {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM domain_profiles WHERE is_active = 1 ORDER BY knowledge_count DESC'
      ).all() as DomainRow[];

      return rows.map(r => ({
        domain: r.domain,
        domainType: r.domain_type as DomainProfile['domainType'],
        knowledgeCount: r.knowledge_count,
        depthScore: r.depth_score,
        expertiseSignals: r.expertise_signals,
        growthStage: r.growth_stage as DomainProfile['growthStage'],
        conversationCount: r.conversation_count,
        lastActiveAt: r.last_active_at,
        isActive: r.is_active === 1,
      }));
    } catch {
      return [];
    }
  }

  /** 获取领域画像的 Prompt 片段 */
  getDomainPromptFragment(): string {
    const profiles = this.getAllDomainProfiles();
    if (profiles.length === 0) return '';

    const lines = profiles
      .filter(p => p.knowledgeCount >= 5)
      .slice(0, 5)
      .map(p => `- ${p.domain}：${p.growthStage}（${p.knowledgeCount}条知识，深度${Math.round(p.depthScore * 100)}%）`);

    if (lines.length === 0) return '';
    return `用户的专业领域：\n${lines.join('\n')}`;
  }

  // ==================== 统计 ====================

  getStats(): {
    userProfileFields: number;
    milestones: number;
    pendingGoals: number;
    curiosities: number;
    domains: number;
  } {
    return {
      userProfileFields: (this.db.prepare('SELECT COUNT(*) as c FROM user_profile').get() as CountRow).c,
      milestones: this.getSelfModel().narrative.milestones.length,
      pendingGoals: (this.db.prepare("SELECT COUNT(*) as c FROM micro_goals WHERE status = 'pending'").get() as CountRow).c,
      curiosities: (this.db.prepare('SELECT COUNT(*) as c FROM curiosities').get() as CountRow).c,
      domains: (this.db.prepare('SELECT COUNT(*) as c FROM domain_profiles WHERE is_active = 1').get() as CountRow).c,
    };
  }

  close(): void {
    this.db.close();
  }
}
