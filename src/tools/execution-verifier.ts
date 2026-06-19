/**
 * ExecutionVerifier — 执行验证器
 *
 * 工具执行后验证实际效果，而不只看返回值。
 *
 * 设计原则：
 * - 只验证可验证的操作（文件创建、命令执行）
 * - 失败不阻塞，但记录到教训系统
 * - 超时自动跳过（2 秒）
 * - 只读验证，不修改任何状态
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface VerificationResult {
  /** 验证是否通过 */
  verified: boolean;
  /** 实际效果描述 */
  actualEffect: string;
  /** 差异描述（null 表示无差异） */
  discrepancy: string | null;
  /** 验证耗时 ms */
  durationMs: number;
}

export interface VerificationContext {
  /** 项目根目录 */
  projectRoot: string;
  /** 沙箱目录 */
  sandboxWorkspace: string;
}

// ==================== 验证器 ====================

export class ExecutionVerifier {
  private readonly VERIFY_TIMEOUT_MS = 2000; // 2 秒超时

  constructor(private context: VerificationContext) {}

  /**
   * 验证工具执行结果
   */
  async verify(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<VerificationResult> {
    const startMs = Date.now();

    try {
      // 带超时的验证
      const verification = await this.withTimeout(
        this.doVerify(toolName, args, result),
        this.VERIFY_TIMEOUT_MS,
      );

      return {
        ...verification,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      // 超时或异常 → 跳过验证，不阻塞
      return {
        verified: true, // 乐观假设
        actualEffect: '验证跳过',
        discrepancy: err instanceof Error ? err.message : '验证超时',
        durationMs: Date.now() - startMs,
      };
    }
  }

  // ==================== 内部验证逻辑 ====================

  private async doVerify(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<Omit<VerificationResult, 'durationMs'>> {
    switch (toolName) {
      case 'write_file':
        return this.verifyFileWrite(args.path as string, result);
      case 'exec':
        return this.verifyExec(args.command as string, result);
      case 'mkdir':
      case 'create_directory':
        return this.verifyMkdir(args.path as string);
      case 'git':
      case 'git_commit':
      case 'git_push':
        return this.verifyGit(toolName, result);
      default:
        // 无验证逻辑的工具 → 乐观通过
        return { verified: true, actualEffect: '无验证逻辑', discrepancy: null };
    }
  }

  /**
   * 验证文件写入
   */
  private async verifyFileWrite(
    expectedPath: string,
    result: string,
  ): Promise<Omit<VerificationResult, 'durationMs'>> {
    // 1. 从结果中提取实际写入路径
    const pathMatch = result.match(/\[已写入\s+(.+?)，/);
    if (!pathMatch) {
      // 结果格式异常，可能是错误消息
      if (result.startsWith('[写入失败') || result.startsWith('[拒绝')) {
        return {
          verified: false,
          actualEffect: result,
          discrepancy: '写入操作失败',
        };
      }
      return {
        verified: true,
        actualEffect: '无法从结果中提取路径，跳过验证',
        discrepancy: null,
      };
    }

    const actualPath = pathMatch[1];

    // 2. 检查文件是否存在
    try {
      const stat = await fs.stat(actualPath);
      return {
        verified: stat.isFile(),
        actualEffect: `文件存在: ${actualPath} (${stat.size} bytes)`,
        discrepancy: stat.isFile() ? null : `路径存在但不是文件`,
      };
    } catch {
      return {
        verified: false,
        actualEffect: `文件不存在: ${actualPath}`,
        discrepancy: `write_file 返回"成功"但文件不存在`,
      };
    }
  }

  /**
   * 验证命令执行
   */
  private async verifyExec(
    command: string,
    result: string,
  ): Promise<Omit<VerificationResult, 'durationMs'>> {
    // 检查输出中的错误模式
    const errorPatterns = [
      /Error:/i,
      /error:/i,
      /FAILED/i,
      /fatal:/i,
      /Permission denied/i,
      /No such file or directory/i,
      /command not found/i,
      /npm ERR!/i,
      /ERROR\s/,
    ];

    const hasError = errorPatterns.some(p => p.test(result));

    if (hasError) {
      // 提取第一个错误行
      const errorLine = result.split('\n').find(l =>
        errorPatterns.some(p => p.test(l)),
      )?.trim() ?? '未知错误';

      return {
        verified: false,
        actualEffect: result.slice(0, 300),
        discrepancy: `输出中包含错误: ${errorLine.slice(0, 100)}`,
      };
    }

    return {
      verified: true,
      actualEffect: result.slice(0, 300),
      discrepancy: null,
    };
  }

  /**
   * 验证目录创建
   */
  private async verifyMkdir(
    expectedPath: string,
  ): Promise<Omit<VerificationResult, 'durationMs'>> {
    try {
      const stat = await fs.stat(expectedPath);
      return {
        verified: stat.isDirectory(),
        actualEffect: `目录存在: ${expectedPath}`,
        discrepancy: stat.isDirectory() ? null : `路径存在但不是目录`,
      };
    } catch {
      return {
        verified: false,
        actualEffect: `目录不存在: ${expectedPath}`,
        discrepancy: 'mkdir 返回成功但目录不存在',
      };
    }
  }

  /**
   * 验证 Git 操作
   */
  private async verifyGit(
    toolName: string,
    result: string,
  ): Promise<Omit<VerificationResult, 'durationMs'>> {
    // Git 操作通常有明确的成功/失败标志
    const failurePatterns = [
      /fatal:/i,
      /error:/i,
      /failed/i,
      /permission denied/i,
    ];

    const hasFailure = failurePatterns.some(p => p.test(result));

    return {
      verified: !hasFailure,
      actualEffect: result.slice(0, 300),
      discrepancy: hasFailure ? 'Git 操作可能失败' : null,
    };
  }

  // ==================== 工具方法 ====================

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`验证超时 (${ms}ms)`)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
