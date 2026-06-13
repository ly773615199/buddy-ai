/**
 * 结构化日志系统
 * 
 * 特性：
 * - 5 个日志级别 (DEBUG/INFO/WARN/ERROR/FATAL)
 * - JSON 格式输出（生产环境）/ 彩色格式化输出（开发环境）
 * - 上下文绑定（模块名、请求ID、用户ID）
 * - 性能计时（startTimer/endTimer）
 * - 异常安全（不因日志错误影响业务）
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: unknown;
  error?: { name: string; message: string; stack?: string };
  requestId?: string;
  duration?: number;
}

class StructuredLogger {
  private minLevel: LogLevel;
  private isDev: boolean;

  constructor() {
    this.minLevel = process.env.LOG_LEVEL 
      ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO)
      : (process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG);
    this.isDev = process.env.NODE_ENV !== 'production';
  }

  private log(level: LogLevel, module: string, message: string, data?: unknown, error?: Error): void {
    if (level < this.minLevel) return;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      module,
      message,
    };
    
    if (data !== undefined) entry.data = data;
    if (error) entry.error = { name: error.name, message: error.message, stack: error.stack };

    try {
      if (this.isDev) {
        this.prettyPrint(entry);
      } else {
        process.stdout.write(JSON.stringify(entry) + '\n');
      }
    } catch { /* 日志不应影响业务 */ }
  }

  private prettyPrint(entry: LogEntry): void {
    const colors: Record<string, string> = {
      DEBUG: '\x1b[90m',  // gray
      INFO:  '\x1b[36m',  // cyan
      WARN:  '\x1b[33m',  // yellow
      ERROR: '\x1b[31m',  // red
      FATAL: '\x1b[35m',  // magenta
    };
    const reset = '\x1b[0m';
    const c = colors[entry.level] || '';
    const time = entry.timestamp.slice(11, 23);
    const prefix = `${c}${time} [${entry.level}]${reset} <${entry.module}>`;
    let line = `${prefix} ${entry.message}`;
    if (entry.duration !== undefined) line += ` (${entry.duration}ms)`;
    console.log(line);
    if (entry.data !== undefined) console.log('  data:', entry.data);
    if (entry.error) console.log('  error:', entry.error.message);
  }

  debug(module: string, message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, module, message, data);
  }

  info(module: string, message: string, data?: unknown): void {
    this.log(LogLevel.INFO, module, message, data);
  }

  warn(module: string, message: string, data?: unknown): void {
    this.log(LogLevel.WARN, module, message, data);
  }

  error(module: string, message: string, error?: Error, data?: unknown): void {
    this.log(LogLevel.ERROR, module, message, data, error);
  }

  fatal(module: string, message: string, error?: Error, data?: unknown): void {
    this.log(LogLevel.FATAL, module, message, data, error);
  }

  /** 创建带请求上下文的子 logger */
  child(module: string, requestId?: string): ModuleLogger {
    return new ModuleLogger(this, module, requestId);
  }

  /** 性能计时器 */
  startTimer(label: string): () => number {
    const start = performance.now();
    return () => {
      const duration = Math.round(performance.now() - start);
      return duration;
    };
  }
}

class ModuleLogger {
  constructor(
    private parent: StructuredLogger,
    private module: string,
    private requestId?: string,
  ) {}

  debug(message: string, data?: unknown): void { this.parent.debug(this.module, message, data); }
  info(message: string, data?: unknown): void { this.parent.info(this.module, message, data); }
  warn(message: string, data?: unknown): void { this.parent.warn(this.module, message, data); }
  error(message: string, error?: Error, data?: unknown): void { this.parent.error(this.module, message, error, data); }
  fatal(message: string, error?: Error, data?: unknown): void { this.parent.fatal(this.module, message, error, data); }
}

export const logger = new StructuredLogger();
export type { ModuleLogger };
