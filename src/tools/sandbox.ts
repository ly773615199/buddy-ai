import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(execCb);

// ==================== 沙箱配置 ====================

export interface SandboxConfig {
  /** 允许执行的工作目录（jail） */
  workspace: string;
  /** 默认超时（秒） */
  timeout: number;
  /** 最大输出缓冲 */
  maxBuffer: number;
  /** 是否严格模式（只允许白名单命令） */
  strict: boolean;
  /** 白名单命令（strict 模式下生效） */
  allowedCommands: string[];
  /** 额外的环境变量清理 */
  stripEnvVars: string[];
}

const DEFAULT_SANDBOX: SandboxConfig = {
  workspace: '/tmp/buddy-sandbox',
  timeout: 30,
  maxBuffer: 1024 * 1024, // 1MB
  strict: false,
  allowedCommands: [
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'date',
    'pwd', 'whoami', 'tree', 'file', 'du', 'df', 'sort', 'uniq',
    'diff', 'patch', 'mkdir', 'touch',
    'git', 'node', 'npm', 'npx', 'python3', 'python',
    'tsc', 'tsx',
  ],
  stripEnvVars: [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY',
    'SILICONFLOW_API_KEY', 'MIMO_API_KEY', 'GITHUB_TOKEN',
    'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'GCP_API_KEY', 'AZURE_API_KEY',
    'STRIPE_SECRET_KEY', 'DATABASE_URL',
    'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
    'NPM_TOKEN', 'PYPI_TOKEN',
  ],
};

// ==================== 危险模式（扩展版） ====================

const BLOCKED_PATTERNS: RegExp[] = [
  // === 文件系统破坏 ===
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+[\/~]/,
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\*/,
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\./,
  /rm\s+-rf\s+[^|&;]*$/,  // rm -rf 任何路径（更激进）
  /rmdir\s+\/[^s]/,        // rmdir /xxx（非 /srv）
  /chmod\s+(-R\s+)?0?777/,
  /chown\s+-R\s+/,
  /:(){ :|:& };:/,          // fork 炸弹
  /mkfs\./,
  /wipefs/,
  /dd\s+if=.*of=\/dev\//,
  />\s*\/dev\//,
  /shred\s+/,
  />\s*\/proc\//,
  />\s*\/sys\//,

  // === 网络攻击 / 数据外泄 ===
  /wget\s+.*\|\s*(ba)?sh/,
  /curl\s+.*\|\s*(ba)?sh/,
  /curl\s+.*--data.*@/,     // curl POST 文件
  /curl\s+.*-d.*@/,         // curl -d @file
  /wget\s+.*-O\s*\/dev\//,  // 直接写设备
  /\bnc\s+-e\b/,
  /\bncat\s+.*-e\b/,
  /\bsocat\b.*EXEC/,
  /bash\s+-i\s+>&/,
  /bash\s+-c\s+.*\/dev\/tcp/,
  /\/dev\/tcp\//,
  /python.*-c.*socket/,
  /python.*-c.*subprocess\.call\(.*rm/,
  /perl\s+-e.*socket/,
  /ruby\s+-e.*socket/,

  // === 权限提升 ===
  /\bsudo\s+/,
  /\bsu\s+-/,
  /\bchmod\s+.*\+s/,
  /\bchown\s+.*root/,
  /visudo/,
  /useradd/,
  /usermod/,
  /passwd\s+/,
  /\buserdel\b/,
  /\bgroupadd\b/,
  /\bsystemctl\s+(enable|disable|start|stop)\s+/,
  /\bsystemd-run\b/,
  /\bcrontab\s+-e\b/,
  /\bat\s+.*now\b/,

  // === 系统修改 ===
  /\bapt\s+(install|remove|purge)\b/,
  /\byum\s+(install|remove)\b/,
  /\bpacman\s+(-S|-R)\b/,
  /\bdnf\s+(install|remove)\b/,
  /\bpip\s+install\b(?!.*--user)/,  // pip install 不带 --user
  /\bnpm\s+(install|add)\s+-g\b/,
  /\bmodprobe\b/,
  /\binsmod\b/,
  /\brmmod\b/,

  // === 信息收集（敏感） ===
  /\bcat\s+\/etc\/shadow\b/,
  /\bcat\s+\/etc\/passwd\b/,
  /\bcat\s+\/etc\/sudoers\b/,
  /\benv\b.*\|\s*(curl|wget|nc)\b/,  // env 输出到网络
  /\bprintenv\b.*\|\s*(curl|wget|nc)\b/,
  /\bset\b.*\|\s*(curl|wget|nc)\b/,
];

// === 网络外泄模式（宽松匹配） ===
const DATA_EXFIL_PATTERNS: RegExp[] = [
  /\|\s*(curl|wget|http|nc|ncat|socat)\s+/,  // 管道到网络工具
  /\|\s*ssh\s+/,                                // 管道到 ssh
  /curl\s+.*-X\s*POST.*\$\{?/,                 // curl POST 含变量
  /base64\s*\|.*\|\s*(curl|wget|nc)/,          // base64 编码后外发
];

// === 敏感路径操作（防止 cp/mv/cat 到可外发位置） ===
const SENSITIVE_ACCESS_PATTERNS: RegExp[] = [
  /[Cc]at\s+.*\/(etc\/shadow|etc\/passwd|etc\/sudoers)/,
  /[Cc]p\s+.*\.(ssh|gnupg|env|pem|key|aws)/,
  /[Mm]v\s+.*\.(ssh|gnupg|env|pem|key)/,
  /tar\s+.*\/(etc|root|home)/,
];

// ==================== 敏感路径 ====================

const SENSITIVE_PATHS = [
  '/etc/shadow', '/etc/passwd', '/etc/sudoers', '/etc/ssh/',
  '.ssh/', '.gnupg/', '.env', '.env.local', '.env.production',
  'id_rsa', 'id_ed25519', 'id_ecdsa',
  '.pem', '.key', 'credentials', '.netrc',
  '.aws/', '.gcp/', '.azure/',
  '/proc/self/environ',
];

// ==================== 沙箱执行器 ====================

export class SandboxExecutor {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX, ...config };
  }

  /** 更新配置 */
  configure(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 检查命令是否危险 */
  isDangerous(cmd: string): { blocked: boolean; reason?: string } {
    // 1. 正则黑名单
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(cmd)) {
        return { blocked: true, reason: `匹配危险模式: ${pattern.source.slice(0, 60)}` };
      }
    }

    // 2. 数据外泄检测
    for (const pattern of DATA_EXFIL_PATTERNS) {
      if (pattern.test(cmd)) {
        return { blocked: true, reason: `疑似数据外泄: ${pattern.source.slice(0, 60)}` };
      }
    }

    // 2.5 敏感路径操作检测
    for (const pattern of SENSITIVE_ACCESS_PATTERNS) {
      if (pattern.test(cmd)) {
        return { blocked: true, reason: `敏感路径操作被拦截: ${pattern.source.slice(0, 60)}` };
      }
    }

    // 3. 白名单模式
    if (this.config.strict) {
      const firstWord = cmd.trim().split(/\s+/)[0];
      const baseCmd = path.basename(firstWord);
      if (!this.config.allowedCommands.includes(baseCmd)) {
        return { blocked: true, reason: `严格模式：命令 "${baseCmd}" 不在白名单中` };
      }
    }

    return { blocked: false };
  }

  /** 检查路径是否敏感 */
  isSensitivePath(p: string): boolean {
    const resolved = path.resolve(p);
    return SENSITIVE_PATHS.some((sp) => resolved.includes(sp) || p.includes(sp));
  }

  /** 验证工作目录是否在沙箱内（async：真正检查符号链接） */
  private async validateCwd(cwd: string): Promise<{ valid: boolean; resolved: string; reason?: string }> {
    // 允许的工作目录根（不包含 HOME）
    const allowedRoots = [
      path.resolve(this.config.workspace),
      '/tmp',
      '/var/tmp',
      process.cwd(),
    ];

    // 1. 基础解析
    const resolved = path.resolve(cwd);

    // 2. 符号链接解析 — 获取真实路径，防止 symlink 逃逸
    let realPath: string;
    try {
      realPath = await fs.realpath(resolved);
    } catch {
      // 目录不存在时，逐级检查父目录的 symlink
      realPath = resolved;
      let check = resolved;
      while (check !== path.parse(check).root) {
        try {
          const real = await fs.realpath(check);
          if (real !== check) {
            realPath = real + resolved.slice(check.length);
            break;
          }
        } catch { /* 该级不存在，继续向上 */ }
        check = path.dirname(check);
      }
    }

    // 3. 用真实路径做白名单校验
    const isAllowed = allowedRoots.some(root =>
      realPath === root || realPath.startsWith(root + path.sep)
    );

    if (!isAllowed) {
      return { valid: false, resolved: realPath, reason: `工作目录 ${realPath} 不在允许范围内（仅限 sandbox/tmp）` };
    }

    return { valid: true, resolved: realPath };
  }

  /** 构建安全的环境变量 */
  private buildSafeEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // 清理敏感变量
    for (const key of this.config.stripEnvVars) {
      delete env[key];
    }

    // 清理所有包含 SECRET/TOKEN/KEY/PASSWORD 的变量
    for (const key of Object.keys(env)) {
      const upper = key.toUpperCase();
      if (
        (upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('PASSWORD')) &&
        !upper.startsWith('PATH') && !upper.startsWith('NODE_')
      ) {
        delete env[key];
      }
    }

    // 设置安全限制
    env.BUDDY_SANDBOX = '1';
    env.LC_ALL = 'C.UTF-8';

    return env;
  }

  /**
   * 执行命令（沙箱保护）
   */
  async exec(
    command: string,
    options?: {
      cwd?: string;
      timeout?: number;
      captureStderr?: boolean;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // 1. 危险检查
    const danger = this.isDangerous(command);
    if (danger.blocked) {
      return { stdout: '', stderr: `[拒绝: ${danger.reason}]`, exitCode: -1 };
    }

    // 2. 工作目录验证（async：检查 symlink 逃逸）
    const cwd = options?.cwd ?? this.config.workspace;
    const cwdCheck = await this.validateCwd(cwd);
    if (!cwdCheck.valid) {
      return { stdout: '', stderr: `[拒绝: ${cwdCheck.reason}]`, exitCode: -1 };
    }

    // 3. 确保沙箱目录存在
    try {
      await fs.mkdir(this.config.workspace, { recursive: true });
    } catch { /* ignore */ }

    // 4. 执行
    const timeout = (options?.timeout ?? this.config.timeout) * 1000;
    const safeEnv = this.buildSafeEnv();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwdCheck.resolved,
        timeout,
        maxBuffer: this.config.maxBuffer,
        encoding: 'utf-8',
        env: safeEnv,
      });
      return {
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: 0,
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stderr?: string; message?: string; killed?: boolean };
      if (e.killed) {
        return { stdout: '', stderr: `[命令超时被终止 (${options?.timeout ?? this.config.timeout}s)]`, exitCode: -2 };
      }
      return {
        stdout: '',
        stderr: e.stderr || e.message || String(err),
        exitCode: e.code ?? -1,
      };
    }
  }

  /**
   * 以格式化方式执行命令（供工具调用）
   */
  async execFormatted(
    command: string,
    options?: { cwd?: string; timeout?: number },
  ): Promise<string> {
    const result = await this.exec(command, options);
    if (result.exitCode === -1) {
      return result.stderr; // 拒绝消息
    }
    const output = result.stdout || result.stderr || '[命令执行完成，无输出]';
    return formatOutput(output);
  }
}

// ==================== 输出格式化 ====================

const MAX_OUTPUT_LINES = 100;
const MAX_OUTPUT_CHARS = 10000;

function formatOutput(result: string): string {
  const lines = result.split('\n');
  // 先检查行数
  if (lines.length > MAX_OUTPUT_LINES) {
    return lines.slice(0, MAX_OUTPUT_LINES).join('\n')
      + `\n... (共 ${lines.length} 行，已截断)`;
  }
  // 再检查字符数
  if (result.length <= MAX_OUTPUT_CHARS) return result;
  return result.slice(0, MAX_OUTPUT_CHARS) + `\n... (已截断，共 ${result.length} 字符)`;
}

// ==================== 单例 ====================

/** 默认沙箱执行器实例 */
export const defaultSandbox = new SandboxExecutor();
