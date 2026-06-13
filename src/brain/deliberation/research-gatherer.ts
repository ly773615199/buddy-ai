/**
 * 资料收集器 — 自动收集审议所需的上下文信息
 *
 * 数据源：
 * - 文件上下文：从输入提取路径，读取相关文件
 * - 项目结构：涉及代码操作时获取目录摘要
 * - 经验匹配：从决策记忆找相似历史
 * - 脑内上下文：小脑 BodyState + 右脑 IntuitionSignal
 */

import type { Topic, ResearchResult } from './types.js';
import type { BodyState, IntuitionSignal } from '../types.js';

export class ResearchGatherer {
  private readFile: ((path: string) => Promise<string>) | null = null;
  private listDir: ((path: string) => Promise<string[]>) | null = null;
  private getExperience: ((input: string) => string | null) | null = null;

  setFileOps(readFile: (path: string) => Promise<string>, listDir: (path: string) => Promise<string[]>): void {
    this.readFile = readFile;
    this.listDir = listDir;
  }

  setExperienceProvider(getExperience: (input: string) => string | null): void {
    this.getExperience = getExperience;
  }

  async gather(
    topic: Topic,
    input: string,
    bodyState: BodyState,
    intuition?: IntuitionSignal,
  ): Promise<ResearchResult> {
    const result: ResearchResult = {};

    // 1. 文件上下文
    const paths = input.match(/[\w/\\.-]+\.\w+/g) ?? [];
    if (paths.length > 0 && this.readFile) {
      const contents = await Promise.allSettled(
        paths.slice(0, 3).map(p => this.readFile!(p))
      );
      const successful = contents
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value.slice(0, 2000));
      if (successful.length > 0) {
        result.fileContext = successful.join('\n---\n');
      }
    }

    // 2. 项目结构
    if (/代码|code|src|模块|module|重构|refactor/i.test(input) && this.listDir) {
      try {
        const entries = await this.listDir('.');
        result.projectStructure = entries.slice(0, 30).join('\n');
      } catch { /* 静默失败 */ }
    }

    // 3. 历史经验
    if (this.getExperience) {
      const exp = this.getExperience(input);
      if (exp) {
        result.experience = exp;
      }
    }

    // 4. 脑内上下文
    result.brainContext = { bodyState, intuition };

    return result;
  }
}
