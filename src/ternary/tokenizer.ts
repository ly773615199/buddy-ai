/**
 * 三进制模型 Tokenizer
 *
 * 简化实现：基于 UTF-8 字节的 BPE-like 分词。
 * 生产环境可替换为 sentencepiece WASM。
 *
 * 词表大小默认 32000，与训练数据匹配。
 */

// ── 基本分词器 ──

export interface TokenizerConfig {
  vocabSize: number;
  bosTokenId: number;  // <s>
  eosTokenId: number;  // </s>
  padTokenId: number;  // <pad>
  unkTokenId: number;  // <unk>
}

const DEFAULT_CONFIG: TokenizerConfig = {
  vocabSize: 32000,
  bosTokenId: 1,
  eosTokenId: 2,
  padTokenId: 0,
  unkTokenId: 3,
};

/**
 * 简易 Tokenizer
 *
 * 实际项目中应加载训练好的 sentencepiece 模型。
 * 这里提供一个可工作的 fallback，用于开发和测试。
 */
export class TernaryTokenizer {
  private config: TokenizerConfig;
  private vocab: Map<string, number> = new Map();
  private id2token: Map<number, string> = new Map();
  private loaded = false;

  constructor(config?: Partial<TokenizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 从文件加载 tokenizer (JSON 格式)
   */
  async load(tokenizerPath: string): Promise<void> {
    const fs = await import('fs/promises');
    const data = await fs.readFile(tokenizerPath, 'utf-8');
    const json = JSON.parse(data);

    this.vocab = new Map(Object.entries(json.vocab));
    this.id2token = new Map();
    for (const [token, id] of this.vocab) {
      this.id2token.set(id as number, token);
    }

    this.loaded = true;
  }

  /**
   * 使用内置词表初始化 (用于测试/开发)
   */
  initBuiltin(): void {
    // 基础 token
    this.addToken('<pad>', this.config.padTokenId);
    this.addToken('<s>', this.config.bosTokenId);
    this.addToken('</s>', this.config.eosTokenId);
    this.addToken('<unk>', this.config.unkTokenId);

    // ASCII 可打印字符 (32-126)
    let id = 10;
    for (let i = 32; i <= 126; i++) {
      this.addToken(String.fromCharCode(i), id++);
    }

    // 常用中文字符 (简化：取 Unicode 前 30000 个汉字)
    const cjkStart = 0x4E00;
    const cjkEnd = Math.min(cjkStart + this.config.vocabSize - id, 0x9FFF);
    for (let cp = cjkStart; cp <= cjkEnd && id < this.config.vocabSize; cp++) {
      this.addToken(String.fromCodePoint(cp), id++);
    }

    // 常用标点
    const punct = '，。！？、；：""\'\'（）【】《》—…·～';
    for (const ch of punct) {
      if (!this.vocab.has(ch) && id < this.config.vocabSize) {
        this.addToken(ch, id++);
      }
    }

    this.loaded = true;
  }

  /**
   * 编码: 文本 → token ID 数组
   */
  encode(text: string): number[] {
    this.ensureLoaded();

    const ids: number[] = [this.config.bosTokenId];

    for (const ch of text) {
      const id = this.vocab.get(ch);
      if (id !== undefined) {
        ids.push(id);
      } else {
        // 按 UTF-8 字节拆分
        const bytes = new TextEncoder().encode(ch);
        for (const b of bytes) {
          ids.push(this.vocab.get(`\\x${b.toString(16).padStart(2, '0')}`) ?? this.config.unkTokenId);
        }
      }
    }

    ids.push(this.config.eosTokenId);
    return ids;
  }

  /**
   * 解码: token ID 数组 → 文本
   */
  decode(ids: number[]): string {
    this.ensureLoaded();

    const tokens: string[] = [];
    for (const id of ids) {
      if (id === this.config.bosTokenId || id === this.config.eosTokenId || id === this.config.padTokenId) {
        continue;
      }
      const token = this.id2token.get(id);
      if (token !== undefined && !token.startsWith('\\x')) {
        tokens.push(token);
      }
    }

    return tokens.join('');
  }

  /**
   * 词表大小
   */
  get vocabSize(): number {
    return this.config.vocabSize;
  }

  /**
   * 是否已加载
   */
  get isLoaded(): boolean {
    return this.loaded;
  }

  private addToken(token: string, id: number): void {
    this.vocab.set(token, id);
    this.id2token.set(id, token);
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.initBuiltin();
    }
  }
}
