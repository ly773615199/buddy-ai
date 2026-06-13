/**
 * MCP 适配层 — 连接社区 MCP Server 作为工具提供者
 *
 * MCP (Model Context Protocol) 是 Anthropic 定义的开放协议，
 * 允许 AI Agent 连接外部工具/数据源。
 * 社区已有 100+ MCP Server (GitHub/Slack/DB/文件系统等)。
 *
 * 架构：
 * Buddy ToolRegistry ← MCPAdapter ← MCP Server (stdio/SSE)
 *
 * 本模块负责：
 * 1. 管理 MCP Server 连接生命周期
 * 2. 将 MCP tools 注册为 Buddy ToolDef
 * 3. 将 Buddy 工具调用转发到 MCP Server
 * 4. 处理 MCP 的 JSON-RPC 通信
 */

import { ChildProcess, spawn } from 'child_process';
import { z } from 'zod';
import type { ToolDef } from '../types.js';

export interface MCPServerConfig {
  name: string;
  command: string;           // 启动命令，如 "npx" 
  args: string[];            // 参数，如 ["-y", "@modelcontextprotocol/server-filesystem"]
  env?: Record<string, string>;
  description?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class MCPAdapter {
  private servers = new Map<string, MCPServerState>();
  private messageId = 0;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /** 连接一个 MCP Server */
  async connect(config: MCPServerConfig): Promise<MCPTool[]> {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP Server "${config.name}" 已连接`);
    }

    const proc = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const state: MCPServerState = {
      config,
      proc,
      pending: new Map(),
      buffer: '',
      tools: [],
    };

    // 处理 stdout（JSON-RPC 响应）
    proc.stdout?.on('data', (data: Buffer) => {
      state.buffer += data.toString();
      this.processBuffer(state);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (this.verbose) console.warn(`[MCP:${config.name}] stderr: ${data.toString().trim()}`);
    });

    proc.on('close', (code) => {
      if (this.verbose) console.log(`[MCP:${config.name}] 进程退出 (code: ${code})`);
      this.servers.delete(config.name);
    });

    proc.on('error', (err) => {
      if (this.verbose) console.error(`[MCP:${config.name}] 错误: ${err.message}`);
      this.servers.delete(config.name);
    });

    this.servers.set(config.name, state);

    // 初始化握手
    await this.sendRequest(state, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'buddy', version: '0.2.0' },
    });

    // 发送 initialized 通知
    await this.sendNotification(state, 'notifications/initialized', {});

    // 获取工具列表
    const toolsResult = await this.sendRequest(state, 'tools/list', {});
    state.tools = (toolsResult.tools ?? []) as MCPTool[];

    if (this.verbose) console.log(`[MCP:${config.name}] 已连接，${state.tools.length} 个工具`);

    return state.tools;
  }

  /** 断开 MCP Server */
  async disconnect(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;

    try {
      await this.sendRequest(state, 'shutdown', {});
    } catch { /* ignore */ }

    state.proc.kill('SIGTERM');
    this.servers.delete(name);
  }

  /** 断开所有 */
  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map(n => this.disconnect(n)));
  }

  /** 调用 MCP 工具 */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const state = this.servers.get(serverName);
    if (!state) throw new Error(`MCP Server "${serverName}" 未连接`);

    const result = await this.sendRequest(state, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    return result as MCPToolResult;
  }

  /** 将 MCP Server 的工具注册到 Buddy ToolRegistry */
  registerAsToolDefs(serverName: string): ToolDef[] {
    const state = this.servers.get(serverName);
    if (!state) return [];

    return state.tools.map(tool => {
      // 将 MCP 的 JSON Schema 转换为 Zod schema
      let parameters: z.ZodObject<Record<string, z.ZodType>>;
      try {
        parameters = tool.inputSchema
          ? jsonSchemaToZod(tool.inputSchema as Record<string, unknown>)
          : z.object({}).passthrough() as unknown as z.ZodObject<Record<string, z.ZodType>>;
      } catch {
        // schema 解析失败，降级为接受任意参数
        parameters = z.object({}).passthrough() as unknown as z.ZodObject<Record<string, z.ZodType>>;
      }

      return {
        name: `mcp_${serverName}_${tool.name}`,
        description: `[MCP:${serverName}] ${tool.description}`,
        parameters,
        permission: 'exec_safe',
        execute: async (args: Record<string, unknown>): Promise<string> => {
          try {
            const result = await this.callTool(serverName, tool.name, args);
            if (result.isError) {
              const errorMsg = result.content.find(c => c.type === 'text')?.text ?? '未知错误';
              return `[MCP:${serverName}] 错误: ${errorMsg}`;
            }
            return result.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n')
              || JSON.stringify(result.content);
          } catch (err) {
            return `[MCP:${serverName}] 调用失败: ${(err as Error).message}`;
          }
        },
      };
    });
  }

  /** 获取已连接的服务器列表 */
  listServers(): Array<{ name: string; toolCount: number; connected: boolean }> {
    return [...this.servers.entries()].map(([name, state]) => ({
      name,
      toolCount: state.tools.length,
      connected: state.proc.exitCode === null,
    }));
  }

  /** 获取所有可用的 MCP 工具 */
  listAllTools(): Array<{ server: string; tool: string; description: string }> {
    const result: Array<{ server: string; tool: string; description: string }> = [];
    for (const [serverName, state] of this.servers) {
      for (const tool of state.tools) {
        result.push({ server: serverName, tool: tool.name, description: tool.description });
      }
    }
    return result;
  }

  // ── JSON-RPC 通信 ──

  private async sendRequest(state: MCPServerState, method: string, params: unknown): Promise<any> {
    const id = ++this.messageId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, 30_000);

      state.pending.set(id, { resolve, reject, timeout });
      state.proc.stdin?.write(msg);
    });
  }

  private async sendNotification(state: MCPServerState, method: string, params: unknown): Promise<void> {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    state.proc.stdin?.write(msg);
  }

  private processBuffer(state: MCPServerState): void {
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);

        if (msg.id !== undefined && state.pending.has(msg.id)) {
          const pending = state.pending.get(msg.id)!;
          clearTimeout(pending.timeout);
          state.pending.delete(msg.id);

          if (msg.error) {
            pending.reject(new Error(msg.error.message ?? 'MCP 错误'));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // 非 JSON 行，忽略
      }
    }
  }
}

// ── JSON Schema → Zod 转换 ──

/** 将 MCP 工具的 JSON Schema 转换为 Zod schema */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodObject<Record<string, z.ZodType>> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType;

    switch (prop.type) {
      case 'number':
      case 'integer':
        field = z.number();
        if (prop.minimum !== undefined) field = (field as z.ZodNumber).min(prop.minimum as number);
        if (prop.maximum !== undefined) field = (field as z.ZodNumber).max(prop.maximum as number);
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        if (prop.items && typeof prop.items === 'object' && (prop.items as any).type) {
          const itemType = (prop.items as any).type === 'number' ? z.number()
            : (prop.items as any).type === 'boolean' ? z.boolean()
            : z.string();
          field = z.array(itemType);
        } else {
          field = z.array(z.string());
        }
        break;
      case 'object':
        // 嵌套对象：递归转换或降级为 record
        if (prop.properties) {
          field = jsonSchemaToZod(prop as Record<string, unknown>);
        } else {
          field = z.record(z.string(), z.unknown());
        }
        break;
      default:
        // string / enum / unknown
        if (prop.enum && Array.isArray(prop.enum)) {
          field = z.enum(prop.enum as [string, ...string[]]);
        } else {
          field = z.string();
        }
    }

    if (prop.description) field = field.describe(prop.description as string);
    if (!required.has(key)) field = field.optional();

    shape[key] = field;
  }

  // 如果没有属性定义，返回接受任意参数的 schema
  if (Object.keys(shape).length === 0) {
    return z.object({}).passthrough() as unknown as z.ZodObject<Record<string, z.ZodType>>;
  }

  return z.object(shape);
}

// ── 内部类型 ──

interface MCPServerState {
  config: MCPServerConfig;
  proc: ChildProcess;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>;
  buffer: string;
  tools: MCPTool[];
}

// ── 预置 MCP Server 配置 ──

export const PRESET_MCP_SERVERS: Record<string, MCPServerConfig> = {
  filesystem: {
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    description: '文件系统访问',
  },
  github: {
    name: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? '' },
    description: 'GitHub 操作 (Issues/PRs/Code)',
  },
  memory: {
    name: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    description: '知识图谱记忆',
  },
  puppeteer: {
    name: 'puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    description: '浏览器自动化 (Puppeteer)',
  },
  slack: {
    name: 'slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? '' },
    description: 'Slack 消息/频道操作',
  },
  postgres: {
    name: 'postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRES_URL: process.env.POSTGRES_URL ?? '' },
    description: 'PostgreSQL 数据库查询',
  },
};
