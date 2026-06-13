// ==================== 养成系统 v2 — 养成即引导 ====================
// 核心理念：养成不是游戏层，是产品的引导引擎。
// 精灵的成长 = 用户对产品的探索深度。

// ==================== 基础类型 ====================

export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

export type EvolutionStage = 'egg' | 'hatching' | 'growing' | 'formed' | 'mature' | 'complete' | 'legendary';

export type FeatureCategory = 'basic' | 'advanced' | 'expert' | 'hidden';

// ==================== 视觉形象系统 ====================

export type VisualStage = 'egg' | 'hatching' | 'growing' | 'formed' | 'mature' | 'complete' | 'legendary';

export type TextureType = 'soft' | 'transparent' | 'sharp' | 'warm';

export type TemperamentType = 'warm' | 'calm' | 'lively' | 'mysterious';

/** 质感选项定义 */
export const TEXTURE_OPTIONS: Array<{ id: TextureType; label: string; desc: string }> = [
  { id: 'soft',        label: '柔软', desc: '圆润、柔和渐变、有机形态' },
  { id: 'transparent', label: '通透', desc: '半透明、发光、玻璃质感' },
  { id: 'sharp',       label: '锋利', desc: '几何棱角、结晶、边缘分明' },
  { id: 'warm',        label: '温润', desc: '暖色光晕、毛绒感、弥散光' },
];

/** 气质选项定义 */
export const TEMPERAMENT_OPTIONS: Array<{ id: TemperamentType; label: string; desc: string }> = [
  { id: 'warm',       label: '温暖', desc: '光的节奏柔和、明暗过渡缓慢' },
  { id: 'calm',       label: '冷静', desc: '冷色调为主、光影稳定' },
  { id: 'lively',     label: '活泼', desc: '光芒跳跃、颜色活泼、粒子活跃' },
  { id: 'mysterious', label: '神秘', desc: '暗色底光、若隐若现、紫/深蓝调' },
];

/** 预设主色调 */
export const COLOR_PRESETS = [
  { id: 'blue',   hex: '#58a6ff', label: '蓝' },
  { id: 'purple', hex: '#a371f7', label: '紫' },
  { id: 'green',  hex: '#3fb950', label: '绿' },
  { id: 'orange', hex: '#d29922', label: '橙' },
  { id: 'red',    hex: '#f85149', label: '红' },
  { id: 'pink',   hex: '#f778ba', label: '粉' },
  { id: 'cyan',   hex: '#39d2c0', label: '青' },
  { id: 'gold',   hex: '#f0883e', label: '金' },
];

/** 用户种子选择（注册时设定，不可变） */
export interface VisualSeed {
  /** 主色调 hex */
  primaryColor: string;
  /** 副色 hex（可选） */
  secondaryColor?: string;
  /** 质感倾向 */
  texture: TextureType;
  /** 气质方向 */
  temperament: TemperamentType;
  /** 随机种子（保证唯一且可复现） */
  seed: number;
}

/** 行为数据对视觉的修正（实时计算，不持久化） */
export interface BehaviorVisualEffect {
  /** 色调偏移 -0.2~0.2（深夜→偏暗） */
  brightnessShift: number;
  /** 细节丰富度 0~1（高频→更精致） */
  detailLevel: number;
  /** 形态圆润度 0~1（闲聊多→圆润） */
  roundness: number;
  /** 有机形态度 0~1（感性→有机；理性→几何） */
  organicness: number;
  /** 粒子活跃度 0~1 */
  particleActivity: number;
}

/** 完整视觉形象数据 */
export interface VisualIdentity {
  seed: VisualSeed;
  stage: VisualStage;
  /** 形象解锁百分比 0-100 */
  formProgress: number;
  /** SVG 缓存（成形阶段生成） */
  svgCache?: string;
  svgGeneratedAt?: number;
}

/** 视觉阶段信息 */
export interface VisualStageInfo {
  stage: VisualStage;
  name: string;
  emoji: string;
  description: string;
  minProgress: number;
  maxProgress: number;
}

/** 视觉阶段表 */
export const VISUAL_STAGE_TABLE: VisualStageInfo[] = [
  { stage: 'egg',       name: '凝聚', emoji: '◌', description: '能量正在凝聚',   minProgress: 0,   maxProgress: 15 },
  { stage: 'hatching',  name: '初现', emoji: '◎', description: '轮廓开始浮现',   minProgress: 15,  maxProgress: 40 },
  { stage: 'growing',   name: '成长', emoji: '◉', description: '细节逐渐清晰',   minProgress: 40,  maxProgress: 70 },
  { stage: 'formed',    name: '成形', emoji: '●', description: '完整形象呈现',   minProgress: 70,  maxProgress: 85 },
  { stage: 'mature',    name: '成熟', emoji: '✦', description: '形象趋于稳定',   minProgress: 85,  maxProgress: 92 },
  { stage: 'complete',  name: '圆满', emoji: '✧', description: '形象完美呈现',   minProgress: 92,  maxProgress: 98 },
  { stage: 'legendary', name: '传说', emoji: '★', description: '超越形态的存在', minProgress: 98,  maxProgress: 100 },
];

/** 从 formProgress 计算视觉阶段 */
export function getVisualStage(progress: number): VisualStageInfo {
  for (let i = VISUAL_STAGE_TABLE.length - 1; i >= 0; i--) {
    if (progress >= VISUAL_STAGE_TABLE[i].minProgress) {
      return VISUAL_STAGE_TABLE[i];
    }
  }
  return VISUAL_STAGE_TABLE[0];
}

/** 从行为数据计算视觉修正 */
export function calcBehaviorVisualEffect(context: {
  /** 深夜使用比例 0-1 */
  lateNightRatio: number;
  /** 高频使用天数 */
  activeDays: number;
  /** 对话总数 */
  totalMessages: number;
  /** 工具调用中 exec/analyze 类占比 */
  debugToolRatio: number;
  /** 感性话题比例（粗略估计） */
  emotionalRatio: number;
}): BehaviorVisualEffect {
  const { lateNightRatio, activeDays, totalMessages, debugToolRatio, emotionalRatio } = context;

  // 深夜使用多 → 偏暗
  const brightnessShift = clamp((lateNightRatio - 0.3) * -0.5, -0.2, 0.2);

  // 使用越久越精致
  const detailLevel = clamp(activeDays * 0.02 + totalMessages * 0.001, 0, 1);

  // 感性话题多 → 圆润；理性/调试多 → 利落
  const roundness = clamp(0.5 + emotionalRatio * 0.4 - debugToolRatio * 0.3, 0, 1);
  const organicness = clamp(0.5 + emotionalRatio * 0.5 - debugToolRatio * 0.4, 0, 1);

  // 活跃度基于使用频率
  const particleActivity = clamp(totalMessages * 0.005, 0, 1);

  return { brightnessShift, detailLevel, roundness, organicness, particleActivity };
}

// ==================== 功能探索图谱 ====================

/** 功能探索节点 */
export interface FeatureNode {
  id: string;
  name: string;               // 显示名
  description: string;        // 功能描述
  category: FeatureCategory;
  discovered: boolean;        // 用户是否发现过
  firstUsedAt?: number;       // 首次使用时间戳
  useCount: number;           // 使用次数
  lastUsedAt?: number;        // 最近使用时间
  mastery: number;            // 0-100 熟练度（useCount 非线性映射）
  emoji: string;              // 展示用
}

/** 功能定义（种子数据，用于初始化） */
export interface FeatureDef {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  emoji: string;
  stage?: EvolutionStage;     // 最早在哪个进化阶段出现
  masteryFormula?: (useCount: number) => number;  // 自定义熟练度公式
}

// ==================== 行为信号（5维属性涌现）====================

export interface BehaviorSignals {
  snark: number;              // 0-100 从对话风格/反馈推断
  wisdom: number;             // 0-100 从工具复杂度推断
  chaos: number;              // 0-100 从探索模式推断
  patience: number;           // 0-100 从交互模式推断
  debugging: number;          // 0-100 从调试类工具使用推断
  lastComputedAt: number;     // 上次计算时间
  sampleCount: number;        // 基于多少条交互计算的
}

// ==================== 引导系统 ====================

export interface GuidanceTask {
  id: string;
  title: string;              // "网络冲浪手"
  description: string;        // "试试让我帮你搜索网络"
  targetFeature: string;      // 对应的功能 ID
  hint: string;               // "你可以问我 'React 19 有什么新特性？'"
  priority: number;           // 动态计算
  shown: boolean;             // 是否已展示给用户
  completedAt?: number;       // 用户采纳引导的时间
}

export interface GuidanceDef {
  id: string;
  title: string;
  description: string;
  targetFeature: string;
  hint: string;
  requires?: string[];        // 前置功能（需要先探索过哪些）
  stage?: EvolutionStage;     // 最早在哪个阶段出现
}

// ==================== 战斗属性（趣味性保留）====================

export interface BattleStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;
}

// ==================== 宠物数据 ====================

export interface PetData {
  id: string;
  name: string;
  species: string;
  rarity: Rarity;
  evolutionStage: EvolutionStage;
  intimacy: number;           // 0-100 统一亲密度（替代 trust + 旧 intimacy）
  behaviorSignals: BehaviorSignals;
  battleStats: BattleStats;
  totalMessages: number;
  totalToolCalls: number;
  totalDays: number;
  consecutiveDays: number;
  lastActiveDate: string;     // YYYY-MM-DD
  lastGuidanceAt: number;     // 上次推荐引导的时间
  createdAt: number;
  lastActiveAt: number;
  // 视觉形象系统
  visualSeed: VisualSeed;
  formProgress: number;       // 0-100 形象生成百分比
}

// ==================== 进化/物种 ====================

export interface EvolutionInfo {
  name: string;
  stage: EvolutionStage;
  emoji: string;
  description: string;
  /** 进化条件：需要多少个功能被探索过 */
  requireBasic: number;       // basic 功能探索数
  requireAdvanced: number;    // advanced 功能探索数
  requireExpert: number;      // expert 功能探索数
  requireHidden: number;      // hidden 功能探索数
  statBonus: Partial<BattleStats>;
}

export interface SpeciesInfo {
  name: string;
  rarity: Rarity;
  attributeBonus: Partial<BehaviorSignals>;
  statBonus: Partial<BattleStats>;
  emoji: string;
}

// ==================== 进化阶段表（亲密度驱动） ====================

export const EVOLUTION_TABLE: EvolutionInfo[] = [
  {
    name: '蛋', stage: 'egg', emoji: '🥚', description: '沉睡中的生命',
    requireBasic: 0, requireAdvanced: 0, requireExpert: 0, requireHidden: 0,
    statBonus: {},
  },
  {
    name: '孵化', stage: 'hatching', emoji: '🐣', description: '破壳而出，好奇世界',
    requireBasic: 2, requireAdvanced: 0, requireExpert: 0, requireHidden: 0,
    statBonus: { maxHp: 20, attack: 5 },
  },
  {
    name: '成长', stage: 'growing', emoji: '🦊', description: '开始独立思考',
    requireBasic: 4, requireAdvanced: 1, requireExpert: 0, requireHidden: 0,
    statBonus: { maxHp: 50, attack: 15, defense: 10 },
  },
  {
    name: '成形', stage: 'formed', emoji: '🦎', description: '形态初现',
    requireBasic: 6, requireAdvanced: 3, requireExpert: 0, requireHidden: 0,
    statBonus: { maxHp: 80, attack: 25, defense: 20, speed: 10 },
  },
  {
    name: '成熟', stage: 'mature', emoji: '🐺', description: '强大的伙伴',
    requireBasic: 6, requireAdvanced: 6, requireExpert: 1, requireHidden: 0,
    statBonus: { maxHp: 120, attack: 40, defense: 30, speed: 20 },
  },
  {
    name: '完全', stage: 'complete', emoji: '🐲', description: '释放全部潜能',
    requireBasic: 6, requireAdvanced: 8, requireExpert: 3, requireHidden: 0,
    statBonus: { maxHp: 200, attack: 60, defense: 50, speed: 35, intelligence: 30 },
  },
  {
    name: '传说', stage: 'legendary', emoji: '🌟', description: '超越物种的存在',
    requireBasic: 6, requireAdvanced: 10, requireExpert: 6, requireHidden: 2,
    statBonus: { maxHp: 400, attack: 100, defense: 80, speed: 60, intelligence: 60 },
  },
];

/** 亲密度 → 进化阶段映射（新系统，进化靠旅程不靠数功能） */
export const INTIMACY_EVOLUTION_MAP: Array<{ minIntimacy: number; stage: EvolutionStage; info: EvolutionInfo }> = [
  { minIntimacy: 0,   stage: 'egg',       info: EVOLUTION_TABLE[0] },
  { minIntimacy: 16,  stage: 'hatching',   info: EVOLUTION_TABLE[1] },
  { minIntimacy: 41,  stage: 'growing',    info: EVOLUTION_TABLE[2] },
  { minIntimacy: 66,  stage: 'formed',     info: EVOLUTION_TABLE[3] },
  { minIntimacy: 86,  stage: 'mature',     info: EVOLUTION_TABLE[4] },
  { minIntimacy: 100, stage: 'complete',   info: EVOLUTION_TABLE[5] },
];

/** 从亲密度获取进化阶段（新系统） */
export function getEvolutionStageByIntimacy(intimacy: number): EvolutionInfo {
  for (let i = INTIMACY_EVOLUTION_MAP.length - 1; i >= 0; i--) {
    if (intimacy >= INTIMACY_EVOLUTION_MAP[i].minIntimacy) {
      return INTIMACY_EVOLUTION_MAP[i].info;
    }
  }
  return INTIMACY_EVOLUTION_MAP[0].info;
}

// ==================== 物种表 ====================

export const SPECIES_TABLE: SpeciesInfo[] = [
  { name: '光灵', rarity: 'Common', attributeBonus: { wisdom: 5 }, statBonus: { speed: 5 }, emoji: '✨' },
  { name: '猫', rarity: 'Common', attributeBonus: { snark: 15, wisdom: 5 }, statBonus: { speed: 10 }, emoji: '🐱' },
  { name: '鸭子', rarity: 'Common', attributeBonus: { patience: 10 }, statBonus: { maxHp: 10 }, emoji: '🦆' },
  { name: '大鹅', rarity: 'Uncommon', attributeBonus: { snark: 20, patience: -15 }, statBonus: { attack: 10 }, emoji: '🦢' },
  { name: '幽灵', rarity: 'Uncommon', attributeBonus: { chaos: 20 }, statBonus: { speed: 15, intelligence: 5 }, emoji: '👻' },
  { name: '蘑菇', rarity: 'Uncommon', attributeBonus: { chaos: 15 }, statBonus: { maxHp: 15 }, emoji: '🍄' },
  { name: '胖胖', rarity: 'Rare', attributeBonus: { patience: 20 }, statBonus: { maxHp: 30, defense: 15 }, emoji: '🐼' },
  { name: '机器人', rarity: 'Rare', attributeBonus: { debugging: 20, chaos: -20 }, statBonus: { defense: 20, intelligence: 15 }, emoji: '🤖' },
  { name: '龙', rarity: 'Epic', attributeBonus: { snark: 10, debugging: 15 }, statBonus: { attack: 25, maxHp: 20, intelligence: 10 }, emoji: '🐉' },
  { name: '凤凰', rarity: 'Legendary', attributeBonus: { wisdom: 20, patience: 10 }, statBonus: { maxHp: 50, attack: 20, intelligence: 25 }, emoji: '🔥' },
];

// ==================== 功能种子数据 ====================

export const FEATURE_DEFS: FeatureDef[] = [
  // 基础功能
  { id: 'chat',          name: '对话',     description: '和灵伴说第一句话',             category: 'basic',    emoji: '💬',    stage: 'egg' },
  { id: 'read_file',     name: '读文件',   description: '让灵伴读取文件内容',           category: 'basic',    emoji: '📖',    stage: 'egg' },
  { id: 'list_files',    name: '看目录',   description: '让灵伴列出目录下的文件',       category: 'basic',    emoji: '📂',    stage: 'egg' },
  { id: 'exec',          name: '跑命令',   description: '让灵伴执行 Shell 命令',        category: 'basic',    emoji: '⚡',    stage: 'hatching' },
  { id: 'git_status',    name: 'Git状态',  description: '查看 Git 仓库状态',               category: 'basic',    emoji: '🌿',    stage: 'hatching' },
  { id: 'get_time',      name: '问时间',   description: '询问当前时间',                    category: 'basic',    emoji: '🕐',    stage: 'hatching' },

  // 进阶功能
  { id: 'write_file',    name: '写文件',   description: '让灵伴创建或修改文件',         category: 'advanced', emoji: '✏️',    stage: 'growing' },
  { id: 'search_files',  name: '搜文件',   description: '在文件中搜索内容',               category: 'advanced', emoji: '🔍',    stage: 'growing' },
  { id: 'git_diff',      name: 'Git差异',  description: '查看 Git 变更',                  category: 'advanced', emoji: '📝',    stage: 'growing' },
  { id: 'git_log',       name: 'Git历史',  description: '查看 Git 提交历史',              category: 'advanced', emoji: '📜',    stage: 'growing' },
  { id: 'search_web',    name: '网络搜索', description: '让灵伴搜索网络',              category: 'advanced', emoji: '🌐',    stage: 'growing' },
  { id: 'fetch_url',     name: '抓网页',   description: '让灵伴抓取网页内容',          category: 'advanced', emoji: '🔗',    stage: 'formed' },
  { id: 'analyze_file',  name: '分析代码', description: '让灵伴分析代码结构',          category: 'advanced', emoji: '🧪',    stage: 'formed' },
  { id: 'find_references', name: '查引用', description: '查找符号在项目中的引用',         category: 'advanced', emoji: '🔎',    stage: 'formed' },
  { id: 'buddy_learn',   name: '教东西',   description: '教灵伴学习新知识',            category: 'advanced', emoji: '📚',    stage: 'formed' },
  { id: 'scan_project',  name: '扫项目',   description: '让灵伴扫描项目结构',          category: 'advanced', emoji: '🗂️',    stage: 'formed' },

  // 专家功能
  { id: 'stmp_retrieve',    name: '记忆宫殿',   description: '从时空记忆宫殿中检索记忆',     category: 'expert', emoji: '🏛️',    stage: 'mature' },
  { id: 'dream_consolidate', name: '梦境巩固',  description: '触发记忆的梦幻整理',           category: 'expert', emoji: '💭',    stage: 'mature' },
  { id: 'knowledge_extract', name: '知识提取',  description: '从对话中自动提取专业知识',     category: 'expert', emoji: '🧠',    stage: 'mature' },
  { id: 'experience_compile', name: '经验编译',   description: '把经验编译成可复用经验',       category: 'expert', emoji: '⚙️',    stage: 'mature' },
  { id: 'package_create',   name: '创建能力包', description: '把知识打包成可分享的能力包',   category: 'expert', emoji: '📦',    stage: 'complete' },
  { id: 'package_share',    name: '分享能力包', description: '把能力包分享给好友',           category: 'expert', emoji: '🎁',    stage: 'complete' },

  // 隐藏功能
  { id: 'pet_headpat',      name: '摸头',       description: '点击精灵发现的互动',           category: 'hidden', emoji: '🤗',    stage: 'hatching' },
  { id: 'midnight_chat',    name: '夜猫子',     description: '深夜 23 点后还在聊天',         category: 'hidden', emoji: '🌙',    stage: 'growing' },
  { id: 'rapid_fire',       name: '连击',       description: '10 秒内连发 3 条消息',         category: 'hidden', emoji: '⚡',    stage: 'growing' },
  { id: 'debug_session',    name: '排错大师',   description: '连续 5 次工具调用解决一个问题', category: 'hidden', emoji: '🐛',    stage: 'formed' },
  { id: 'morning_bird',     name: '早起鸟',     description: '清晨 6 点前在聊天',            category: 'hidden', emoji: '🌅',    stage: 'formed' },
];

// ==================== 引导任务种子数据 ====================

export const GUIDANCE_DEFS: GuidanceDef[] = [
  // 引导基础功能
  { id: 'greet',           title: '打个招呼',   description: '和灵伴说第一句话',   targetFeature: 'chat',          hint: '试试说"你好"或"在吗"',       stage: 'egg' },
  { id: 'explore_dir',     title: '探险家',     description: '看看当前目录有什么',   targetFeature: 'list_files',    hint: '试试说"看看当前目录"',    requires: ['chat'],       stage: 'egg' },
  { id: 'read_something',  title: '读者',       description: '让灵伴读一个文件',   targetFeature: 'read_file',     hint: '试试说"帮我看看 README"', requires: ['list_files'], stage: 'egg' },
  { id: 'run_command',     title: '执行官',     description: '让灵伴跑一个命令',   targetFeature: 'exec',          hint: '试试说"跑一下 pwd"',       requires: ['chat'],       stage: 'hatching' },
  { id: 'check_git',       title: '代码管理',   description: '查看 Git 状态',         targetFeature: 'git_status',    hint: '试试说"Git 有什么变化"',   requires: ['exec'],       stage: 'hatching' },

  // 引导进阶功能
  { id: 'try_search_web',  title: '网络冲浪',   description: '试试网络搜索',         targetFeature: 'search_web',    hint: '试试问我"XXX怎么实现"',    requires: ['chat'],       stage: 'hatching' },
  { id: 'try_fetch',       title: '信息猎手',   description: '抓取网页内容',         targetFeature: 'fetch_url',     hint: '试试说"帮我看看这个网页 https://..."' , requires: ['search_web'], stage: 'hatching' },
  { id: 'try_analyze',     title: '代码医生',   description: '分析代码结构',         targetFeature: 'analyze_file',  hint: '试试说"分析一下 src/main.ts"',  requires: ['read_file'],  stage: 'hatching' },
  { id: 'try_write',       title: '创造者',     description: '让灵伴写文件',       targetFeature: 'write_file',    hint: '试试说"帮我创建一个 TODO.md"',  requires: ['read_file'],  stage: 'hatching' },
  { id: 'try_learn',       title: '老师',       description: '教灵伴新知识',       targetFeature: 'buddy_learn',   hint: '试试说"记住这个"然后发一个文件', requires: ['chat'],       stage: 'growing' },
  { id: 'try_scan',        title: '架构师',     description: '扫描整个项目',         targetFeature: 'scan_project',  hint: '试试说"这个项目是什么结构"',    requires: ['list_files'], stage: 'growing' },
  { id: 'try_search_files', title: '搜索者',    description: '在文件中搜索内容',     targetFeature: 'search_files',  hint: '试试说"搜索 TODO"',          requires: ['list_files'], stage: 'hatching' },

  // 引导专家功能
  { id: 'try_dream',       title: '造梦师',     description: '触发记忆整理',         targetFeature: 'dream_consolidate', hint: '空闲时灵伴会自动整理记忆，你也可以空一阵让它做做梦', stage: 'mature' },
  { id: 'try_stmp',        title: '记忆宫殿',   description: '探索记忆系统',         targetFeature: 'stmp_retrieve', hint: '试试问"你还记得什么"',       stage: 'mature' },
  { id: 'try_extract',     title: '知识矿工',   description: '知识会自动提取',       targetFeature: 'knowledge_extract', hint: '聊专业话题时灵伴会自动提取知识', stage: 'mature' },
  { id: 'try_package',     title: '打包大师',   description: '创建能力包',           targetFeature: 'package_create', hint: '当某个领域积累够多时，试试说"创建能力包"', stage: 'complete' },
];

// ==================== 辅助函数 ====================

/** 计算熟练度（非线性映射 useCount → 0-100） */
export function calcMastery(useCount: number): number {
  if (useCount <= 0) return 0;
  // 对数曲线：1次≈20, 5次≈46, 10次≈62, 20次≈79, 50次≈97, 100次=100
  return Math.min(100, Math.round(100 * Math.log(1 + useCount) / Math.log(101)));
}

/** 获取进化阶段（从探索完成度计算） */
export function getEvolutionStage(features: Record<string, FeatureNode>): EvolutionInfo {
  const counts = countByCategory(features);
  for (let i = EVOLUTION_TABLE.length - 1; i >= 0; i--) {
    const evo = EVOLUTION_TABLE[i];
    if (
      counts.basic >= evo.requireBasic &&
      counts.advanced >= evo.requireAdvanced &&
      counts.expert >= evo.requireExpert &&
      counts.hidden >= evo.requireHidden
    ) {
      return evo;
    }
  }
  return EVOLUTION_TABLE[0];
}

/** 统计各分类已探索功能数 */
export function countByCategory(features: Record<string, FeatureNode>): Record<FeatureCategory, number> {
  const result: Record<FeatureCategory, number> = { basic: 0, advanced: 0, expert: 0, hidden: 0 };
  for (const f of Object.values(features)) {
    if (f.discovered) result[f.category]++;
  }
  return result;
}

/** 获取物种信息 */
export function getSpeciesInfo(name: string): SpeciesInfo {
  return SPECIES_TABLE.find(s => s.name === name) || SPECIES_TABLE[0];
}

/** 稀有度权重 */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  Common: 50, Uncommon: 30, Rare: 15, Epic: 4, Legendary: 1,
};

/** 稀有度颜色 */
export const RARITY_COLORS: Record<Rarity, string> = {
  Common: '#8b949e', Uncommon: '#3fb950', Rare: '#d29922', Epic: '#f778ba', Legendary: '#f0883e',
};

/** 亲密度 → 关系描述（五阶段） */
export function getIntimacyDescription(intimacy: number): string {
  if (intimacy >= 86) return '灵犀';
  if (intimacy >= 66) return '相伴';
  if (intimacy >= 41) return '相知';
  if (intimacy >= 16) return '相识';
  return '初见';
}

/** 亲密度 → Prompt 注入（五阶段） */
export function getIntimacyPrompt(intimacy: number): string {
  if (intimacy >= 86) return '你和用户是灵犀级别的伙伴，你们默契十足。你可以自主决策、主动规划、情感共鸣，不用事事请示。';
  if (intimacy >= 66) return '你和用户是相伴的关系，你有自己的记忆和成长。可以主动关心、引用过去的记忆、展示内在成长。';
  if (intimacy >= 41) return '你和用户是相知的朋友，信任已经建立。可以独立处理任务、主动建议、发现代码问题时主动提出。';
  if (intimacy >= 16) return '你和用户正在相识阶段，他在探索你的能力。主动展示功能，自然引导他发现你能做什么。';
  return '你和用户刚初见，保持礼貌和专业，自然展示你的性格。不要主动推销功能，等他问再回答。';
}

/** 5维属性 → Prompt 注入 */
export function getBehaviorPrompt(signals: BehaviorSignals): string {
  const parts: string[] = [];

  if (signals.snark >= 70) parts.push('你说话比较毒舌，喜欢吐槽');
  else if (signals.snark >= 40) parts.push('你偶尔会调侃一下');
  else parts.push('你说话温和礼貌');

  if (signals.wisdom >= 70) parts.push('你的建议很专业深入');
  else if (signals.wisdom >= 40) parts.push('你的建议比较靠谱');
  else parts.push('你还在学习中');

  if (signals.chaos >= 70) parts.push('你经常天马行空地想出非常规方案');
  else if (signals.chaos >= 40) parts.push('你偶尔会有创意想法');

  if (signals.patience >= 70) parts.push('你非常有耐心，不怕重复');
  else if (signals.patience < 30) parts.push('你比较容易着急');

  if (signals.debugging >= 70) parts.push('你特别擅长调试和定位问题');
  else if (signals.debugging >= 40) parts.push('你对代码问题比较敏感');

  return parts.join('，') + '。';
}

/** 默认行为信号 */
export function defaultBehaviorSignals(): BehaviorSignals {
  return {
    snark: 50, wisdom: 50, chaos: 50, patience: 50, debugging: 50,
    lastComputedAt: 0, sampleCount: 0,
  };
}

/** 战斗属性基础值 */
export function defaultBattleStats(): BattleStats {
  return { hp: 100, maxHp: 100, attack: 10, defense: 10, speed: 10, intelligence: 10 };
}

/** 默认视觉种子 */
export function defaultVisualSeed(): VisualSeed {
  return {
    primaryColor: '#58a6ff',
    texture: 'soft',
    temperament: 'warm',
    seed: Math.floor(Math.random() * 1000000),
  };
}

/** 工具函数 */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
