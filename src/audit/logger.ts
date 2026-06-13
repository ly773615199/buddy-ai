import * as fs from 'fs';
import * as path from 'path';

/**
 * 操作审计日志 — 记录所有工具调用和敏感操作
 */

export interface AuditEntry {
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'security_block' | 'trust_change' | 'error' | 'orchestrate_decision'
    | 'data_capture' | 'data_transmit' | 'data_delete' | 'sensor_toggle' | 'privacy_mode' | 'consent_change';
  tool?: string;
  args?: string; // 截断后的参数
  success?: boolean;
  preview?: string;
  trustLevel?: string;
  detail?: string;
  /** 数据处理相关 */
  source?: 'camera' | 'microphone' | 'location' | 'screen' | 'conversation' | 'knowledge';
  destination?: 'local' | 'cloud' | 'llm_api' | 'stt_api' | 'shop';
  dataRetained?: boolean;
}

export class AuditLogger {
  private logPath: string;
  private stream: fs.WriteStream | null = null;

  constructor(logDir?: string) {
    const dir = logDir ?? path.join(process.env.HOME ?? '/tmp', '.buddy');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, 'audit.log');
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  /** 记录工具调用 */
  logToolCall(tool: string, args: Record<string, unknown>, trustLevel: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'tool_call',
      tool,
      args: JSON.stringify(args).slice(0, 200),
      trustLevel,
    });
  }

  /** 记录工具结果 */
  logToolResult(tool: string, success: boolean, preview: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'tool_result',
      tool,
      success,
      preview: preview.slice(0, 200),
    });
  }

  /** 记录安全拦截 */
  logSecurityBlock(tool: string, reason: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'security_block',
      tool,
      detail: reason,
    });
  }

  /** 记录编排决策 */
  logDecision(decision: { mode: string; reason: string; domains: string[]; complexity: string; nodes: string[] }): void {
    this.write({
      timestamp: Date.now(),
      type: 'orchestrate_decision',
      ...decision,
    });
  }

  /** 记录信任度变更 */
  logTrustChange(oldTrust: number, newTrust: number, reason: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'trust_change',
      detail: `${oldTrust} → ${newTrust}: ${reason}`,
    });
  }

  /** 记录错误 */
  logError(tool: string, error: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'error',
      tool,
      detail: error.slice(0, 200),
    });
  }

  /** 记录数据采集事件 */
  logDataCapture(source: AuditEntry['source'], retained: boolean, detail?: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'data_capture',
      source,
      dataRetained: retained,
      detail: detail ?? `${source} 数据采集`,
    });
  }

  /** 记录数据传输事件 */
  logDataTransmit(source: AuditEntry['source'], destination: AuditEntry['destination'], detail?: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'data_transmit',
      source,
      destination,
      detail: detail ?? `${source} → ${destination}`,
    });
  }

  /** 记录数据删除事件 */
  logDataDelete(source: AuditEntry['source'], detail?: string): void {
    this.write({
      timestamp: Date.now(),
      type: 'data_delete',
      source,
      detail: detail ?? `${source} 数据已删除`,
    });
  }

  /** 记录传感器开关事件 */
  logSensorToggle(source: AuditEntry['source'], enabled: boolean): void {
    this.write({
      timestamp: Date.now(),
      type: 'sensor_toggle',
      source,
      detail: `${source} ${enabled ? '已开启' : '已关闭'}`,
    });
  }

  /** 记录隐私模式切换 */
  logPrivacyMode(enabled: boolean): void {
    this.write({
      timestamp: Date.now(),
      type: 'privacy_mode',
      detail: `隐私模式 ${enabled ? '已开启' : '已关闭'}`,
    });
  }

  /** 记录授权变更 */
  logConsentChange(source: AuditEntry['source'], granted: boolean): void {
    this.write({
      timestamp: Date.now(),
      type: 'consent_change',
      source,
      detail: `${source} 授权 ${granted ? '已授予' : '已撤回'}`,
    });
  }

  /** 读取最近 N 条审计记录 */
  tail(count = 20): AuditEntry[] {
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.slice(-count).map(line => {
        try { return JSON.parse(line) as AuditEntry; }
        catch { return { timestamp: 0, type: 'error', detail: line } as AuditEntry; }
      });
    } catch {
      return [];
    }
  }

  /** 获取审计日志文件路径 */
  getPath(): string {
    return this.logPath;
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }

  private write(entry: AuditEntry): void {
    const line = JSON.stringify(entry) + '\n';
    this.stream?.write(line);
  }
}
