/**
 * EnhancedTfIdf — 增强版 TF-IDF 语义检索
 *
 * 零外部依赖，纯 TypeScript 实现。目标：在无 embedding 模型时
 * 提供尽可能好的语义匹配能力。
 *
 * 核心增强：
 * 1. 嵌入式中文分词（高频词表 + 最大正向匹配）
 * 2. BM25 评分（替代 raw TF-IDF）
 * 3. 同义词图谱（中文 + 技术术语）
 * 4. 技术术语识别（文件路径、版本号、错误码）
 * 5. 停用词过滤
 * 6. 512 维向量（减少哈希碰撞）
 *
 * 设计原则：Embedding 负责语义，TF-IDF 负责精确。
 * 两路永久互补，不追求用 embedding 淘汰 TF-IDF。
 */

// ==================== 嵌入式中文高频词表 ====================
// 来源：现代汉语高频词表前 3000 词（精选与技术/日常对话相关的）
// 最大正向匹配分词用。不需要 100% 准确，够用就行。

const DICTIONARY = new Set([
  // 技术相关
  '代码', '文件', '目录', '项目', '配置', '接口', '函数', '变量', '类型', '模块',
  '组件', '服务', '数据库', '服务器', '客户端', '前端', '后端', '测试', '部署', '构建',
  '编译', '运行', '启动', '停止', '重启', '刷新', '更新', '升级', '降级', '回滚',
  '错误', '异常', '警告', '提示', '日志', '调试', '修复', '优化', '重构', '设计',
  '架构', '系统', '平台', '框架', '工具', '插件', '扩展', '功能', '特性', '版本',
  '模型', '训练', '推理', '预测', '分类', '聚类', '回归', '检测', '识别', '生成',
  '文本', '图片', '视频', '音频', '语音', '数据', '信息', '知识', '记忆', '学习',
  '网络', '连接', '请求', '响应', '缓存', '存储', '加载', '读取', '写入', '删除',
  '搜索', '查询', '过滤', '排序', '统计', '分析', '展示', '显示', '隐藏', '切换',
  // 日常对话
  '问题', '解决', '方案', '建议', '帮助', '支持', '需要', '想要', '可以', '应该',
  '已经', '正在', '即将', '完成', '开始', '结束', '继续', '暂停', '取消', '确认',
  '感谢', '抱歉', '请问', '知道', '了解', '明白', '清楚', '详细', '简单', '复杂',
  '重要', '紧急', '优先', '普通', '特殊', '一般', '正常', '异常', '成功', '失败',
  '开心', '快乐', '难过', '生气', '担心', '期待', '满意', '失望', '惊喜', '感动',
  '聪明', '笨', '快', '慢', '好', '坏', '大', '小', '多', '少',
  '今天', '明天', '昨天', '现在', '刚才', '以后', '之前', '最近', '一直', '偶尔',
  '什么', '怎么', '为什么', '哪里', '哪个', '多少', '几个', '是否', '能否', '会不会',
]);

// ==================== 同义词图谱 ====================
// key → [同义词列表]。查询时自动扩展。

const SYNONYM_MAP: Record<string, string[]> = {
  // 情感
  '开心': ['快乐', '高兴', '愉快', '欢乐', '喜悦'],
  '快乐': ['开心', '高兴', '愉快', '欢乐', '喜悦'],
  '难过': ['伤心', '悲伤', '沮丧', '失落', '郁闷'],
  '生气': ['愤怒', '恼火', '不满', '恼怒'],
  '担心': ['忧虑', '焦虑', '不安', '担忧'],
  '满意': ['满足', '满意', '欣慰', '高兴'],
  // 技术
  'bug': ['错误', '缺陷', '问题', '故障', '异常'],
  '错误': ['bug', '缺陷', '问题', '故障', '异常'],
  '修复': ['解决', '修好', '修正', '修补', 'fix'],
  '优化': ['改进', '改善', '提升', '增强'],
  '删除': ['移除', '去掉', '清除', '销毁'],
  '创建': ['新建', '建立', '生成', '添加'],
  '更新': ['升级', '刷新', '修改', '变更'],
  '配置': ['设置', '设定', '参数', '选项'],
  '运行': ['执行', '启动', '跑', '运行'],
  '测试': ['检验', '验证', '检查', 'test'],
  '代码': ['源码', '程序', '脚本', 'code'],
  '文件': ['文档', '资料', 'file', 'document'],
  '接口': ['API', '端点', 'endpoint', 'interface'],
  '模型': ['model', '网络', '算法'],
  '训练': ['train', '学习', '拟合'],
  '推理': ['inference', '预测', '推断'],
  // 常见中英对照
  '部署': ['deploy', '发布', '上线'],
  '回滚': ['rollback', '回退', '还原'],
  '缓存': ['cache', '缓冲'],
  '数据库': ['database', 'DB', '存储'],
  '服务器': ['server', '服务端'],
  '客户端': ['client', '前端'],
};

// ==================== 停用词 ====================

const STOP_WORDS = new Set([
  // 中文停用词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '里', '为', '什么', '吗', '呢', '吧',
  '啊', '哦', '嗯', '呀', '哈', '嘿', '喂', '请问', '能不能', '可以', '应该',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
  'if', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
]);

// ==================== 技术术语正则 ====================

const TECH_PATTERNS = [
  { pattern: /[\w-]+\.(?:ts|js|py|rs|go|java|cpp|c|h|vue|tsx|jsx|css|html|md|json|yaml|yml|toml)/g, weight: 3 },
  { pattern: /v?\d+\.\d+(?:\.\d+)?/g, weight: 2 },           // 版本号: v1.0, 2.5.1
  { pattern: /#\d+/g, weight: 2 },                             // issue/PR 号: #123
  { pattern: /\b(?:ERROR|WARN|INFO|DEBUG|FATAL)\b/gi, weight: 2 }, // 日志级别
  { pattern: /0x[0-9a-f]+/gi, weight: 2 },                    // 十六进制
  { pattern: /\b[A-Z_]{3,}\b/g, weight: 1.5 },                // 常量: MAX_SIZE, API_KEY
  { pattern: /[\w]+(?:Exception|Error|Fault)/g, weight: 2 },   // 异常类名
  { pattern: /(?:GET|POST|PUT|DELETE|PATCH)\s+\//g, weight: 2 }, // HTTP 方法+路径
];

// ==================== BM25 参数 ====================

const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ==================== 分词器 ====================

interface TokenInfo {
  token: string;
  isTech: boolean;
  isSynonym: boolean;
  sourceToken?: string; // 同义词来源
}

/**
 * 增强分词：中文词表分词 + 英文词提取 + 技术术语 + 同义词扩展
 */
function enhancedTokenize(text: string): TokenInfo[] {
  const result: TokenInfo[] = [];
  const added = new Set<string>();

  const addToken = (token: string, isTech: boolean, isSynonym: boolean, sourceToken?: string) => {
    const lower = token.toLowerCase();
    if (added.has(lower)) return;
    if (STOP_WORDS.has(lower)) return;
    if (lower.length < 1) return;
    added.add(lower);
    result.push({ token: lower, isTech, isSynonym, sourceToken });
  };

  // 1. 提取英文单词和标识符
  const englishWords = text.match(/[a-z][a-z0-9_-]*/gi) ?? [];
  for (const word of englishWords) {
    addToken(word, false, false);
  }

  // 2. 技术术语提取（高权重）
  for (const { pattern, weight } of TECH_PATTERNS) {
    const matches = text.match(pattern) ?? [];
    for (const m of matches) {
      addToken(m, true, false);
    }
  }

  // 3. 中文分词：最大正向匹配
  const chineseText = text.match(/[\u4e00-\u9fff]+/g)?.join('') ?? '';
  if (chineseText.length > 0) {
    let pos = 0;
    while (pos < chineseText.length) {
      let matched = false;
      // 从最长词开始匹配（最大 8 字）
      for (let len = Math.min(8, chineseText.length - pos); len >= 2; len--) {
        const word = chineseText.slice(pos, pos + len);
        if (DICTIONARY.has(word)) {
          addToken(word, false, false);
          pos += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 单字也保留
        addToken(chineseText[pos], false, false);
        pos++;
      }
    }
  }

  // 4. 同义词扩展（对所有已有 token 检查同义词）
  const snapshot = [...result];
  for (const info of snapshot) {
    const synonyms = SYNONYM_MAP[info.token];
    if (synonyms) {
      for (const syn of synonyms) {
        addToken(syn, false, true, info.token);
      }
    }
  }

  return result;
}

// ==================== BM25 评分 ====================

interface BM25Stats {
  avgDocLen: number;
  docCount: number;
  docFreq: Map<string, number>;
}

/**
 * 构建 BM25 统计信息（从语料库）
 */
function buildBM25Stats(documents: string[]): BM25Stats {
  const docFreq = new Map<string, number>();
  let totalLen = 0;

  for (const doc of documents) {
    const tokens = enhancedTokenize(doc);
    const uniqueTokens = new Set(tokens.map(t => t.token));
    totalLen += tokens.length;
    for (const t of uniqueTokens) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }

  return {
    avgDocLen: documents.length > 0 ? totalLen / documents.length : 1,
    docCount: documents.length,
    docFreq,
  };
}

/**
 * BM25 评分单个文档
 */
function bm25Score(
  queryTokens: TokenInfo[],
  docTokens: TokenInfo[],
  stats: BM25Stats,
): number {
  const docLen = docTokens.length;
  const docTokenSet = new Set(docTokens.map(t => t.token));
  let score = 0;

  for (const qToken of queryTokens) {
    const df = stats.docFreq.get(qToken.token) ?? 0;
    if (df === 0) continue;

    // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((stats.docCount - df + 0.5) / (df + 0.5) + 1);

    // TF: 该词在文档中是否出现（稀疏向量用 0/1）
    const tf = docTokenSet.has(qToken.token) ? 1 : 0;
    if (tf === 0) continue;

    // BM25 公式
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * docLen / stats.avgDocLen);
    let termScore = idf * numerator / denominator;

    // 技术术语加权
    if (qToken.isTech) termScore *= 1.5;

    score += termScore;
  }

  return score;
}

// ==================== 稀疏向量（用于余弦相似度） ====================

function buildSparseVector(tokens: TokenInfo[], stats: BM25Stats): Map<string, number> {
  const vec = new Map<string, number>();
  const tokenSet = new Set(tokens.map(t => t.token));

  for (const t of tokenSet) {
    const df = stats.docFreq.get(t) ?? 1;
    const idf = Math.log(stats.docCount / df);
    vec.set(t, idf);
  }

  return vec;
}

function cosineSimilaritySparse(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, val] of a) {
    normA += val * val;
    const bVal = b.get(term);
    if (bVal !== undefined) dot += val * bVal;
  }
  for (const val of b.values()) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ==================== 主类 ====================

export interface SearchResult {
  key: string;
  value: string;
  score: number;
  matchDetails?: {
    bm25: number;
    cosine: number;
    techBoost: number;
    synonymHits: number;
  };
}

export class EnhancedTfIdf {
  name = 'enhanced-tfidf';

  // 语料库索引
  private documents: Array<{ key: string; value: string; tokens: TokenInfo[] }> = [];
  private stats: BM25Stats = { avgDocLen: 0, docCount: 0, docFreq: new Map() };
  private dirty = true;

  /**
   * 添加或更新文档
   */
  addDocument(key: string, value: string): void {
    const existing = this.documents.findIndex(d => d.key === key);
    const tokens = enhancedTokenize(value);
    if (existing >= 0) {
      this.documents[existing] = { key, value, tokens };
    } else {
      this.documents.push({ key, value, tokens });
    }
    this.dirty = true;
  }

  /**
   * 批量设置文档（覆盖）
   */
  setDocuments(docs: Array<{ key: string; value: string }>): void {
    this.documents = docs.map(d => ({
      key: d.key,
      value: d.value,
      tokens: enhancedTokenize(d.value),
    }));
    this.dirty = true;
  }

  /**
   * 移除文档
   */
  removeDocument(key: string): void {
    this.documents = this.documents.filter(d => d.key !== key);
    this.dirty = true;
  }

  /**
   * 搜索（BM25 + 余弦相似度混合评分）
   */
  search(query: string, limit = 5): SearchResult[] {
    if (this.documents.length === 0) return [];

    // 懒更新统计
    if (this.dirty) {
      this.rebuildStats();
    }

    const queryTokens = enhancedTokenize(query);
    if (queryTokens.length === 0) return [];

    // 同义词扩展查询
    const expandedQuery = expandSynonyms(queryTokens);

    const results: SearchResult[] = [];

    for (const doc of this.documents) {
      // BM25 评分
      const bm25 = bm25Score(expandedQuery, doc.tokens, this.stats);

      // 余弦相似度
      const queryVec = buildSparseVector(expandedQuery, this.stats);
      const docVec = buildSparseVector(doc.tokens, this.stats);
      const cosine = cosineSimilaritySparse(queryVec, docVec);

      // 技术术语加成
      const techBoost = calculateTechBoost(query, doc.value);

      // 同义词命中数
      const synonymHits = countSynonymHits(queryTokens, doc.tokens);

      // 综合评分：BM25(0.5) + 余弦(0.3) + 技术加成(0.15) + 同义词(0.05)
      const score = bm25 * 0.5 + cosine * 0.3 + techBoost * 0.15 + synonymHits * 0.05;

      if (score > 0.001) {
        results.push({
          key: doc.key,
          value: doc.value,
          score,
          matchDetails: { bm25, cosine, techBoost, synonymHits },
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * 生成 embedding 向量（用于存入 memory_embeddings 表）
   * 将稀疏向量哈希到固定维度
   */
  embed(text: string, dim = 512): number[] {
    const vec = new Array<number>(dim).fill(0);
    const tokens = enhancedTokenize(text);
    if (tokens.length === 0) return vec;

    for (const t of tokens) {
      let h = 42;
      for (let i = 0; i < t.token.length; i++) {
        h = ((h << 5) - h + t.token.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(h) % dim;
      // 技术术语和同义词给更高权重
      const weight = t.isTech ? 2.0 : t.isSynonym ? 0.8 : 1.0;
      vec[idx] += weight;
    }

    // L2 归一化
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;

    return vec;
  }

  /**
   * 获取文档数量
   */
  get size(): number {
    return this.documents.length;
  }

  // ==================== 内部方法 ====================

  private rebuildStats(): void {
    const allTexts = this.documents.map(d => d.value);
    this.stats = buildBM25Stats(allTexts);
    this.dirty = false;
  }
}

// ==================== 辅助函数 ====================

function expandSynonyms(tokens: TokenInfo[]): TokenInfo[] {
  const result = [...tokens];
  for (const t of tokens) {
    const synonyms = SYNONYM_MAP[t.token];
    if (synonyms) {
      for (const syn of synonyms) {
        result.push({ token: syn, isTech: false, isSynonym: true, sourceToken: t.token });
      }
    }
  }
  return result;
}

function calculateTechBoost(query: string, doc: string): number {
  let boost = 0;
  // 查询中的技术术语在文档中出现
  for (const { pattern } of TECH_PATTERNS) {
    const queryMatches = query.match(pattern) ?? [];
    for (const m of queryMatches) {
      if (doc.includes(m)) boost += 1;
    }
  }
  return Math.min(boost, 5); // 上限
}

function countSynonymHits(queryTokens: TokenInfo[], docTokens: TokenInfo[]): number {
  const docSet = new Set(docTokens.map(t => t.token));
  let hits = 0;
  for (const q of queryTokens) {
    if (q.isSynonym && docSet.has(q.token)) hits++;
  }
  return hits;
}
