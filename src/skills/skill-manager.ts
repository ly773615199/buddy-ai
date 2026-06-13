/**
 * Skill Manager — 动态工具 Skill 加载系统
 *
 * 职责：扫描目录、加载 .skillmate 工具文件、注册到 ToolRegistry
 *
 * 设计原则：
 * - .skillmate 文件是自描述的，包含工具定义 + 执行逻辑
 * - 放进 ~/.buddy/skills/ 目录，重启即生效
 * - 不需要编译，不需要构建，纯 JSON 声明式
 * - 与 ExperiencePackageManager（能力包）完全独立
 *
 * 两种 .skillmate 格式：
 * 1. 声明式（简单工具）— JSON 定义参数 + shell 命令
 * 2. 脚本式（复杂工具）— 包含 JS 执行逻辑
 */

import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolDef } from '../types.js';
import { SkillGrowth } from './growth.js';

// ── 声明式 Skill 定义 ──

export interface SkillParamDef {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface SkillShellExec {
  command: string;                              // 支持 ${param} 变量替换
  timeout?: number;                             // 超时秒数，默认 30
  cwd?: string;                                 // 工作目录
}

export interface BuddySkillDef {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  permission?: string;                          // 默认 'exec_safe'
  parameters: Record<string, SkillParamDef>;
  execute: SkillShellExec | SkillShellExec[];   // 单条或链式命令
  resultParser?: 'text' | 'json' | 'lines';    // 输出解析方式，默认 'text'
  env?: Record<string, string>;                 // 环境变量
}

// ── 内部状态 ──

interface LoadedSkill {
  def: BuddySkillDef;
  filePath: string;
  toolName: string;                             // 注册到 ToolRegistry 的名称
  loadedAt: number;
}

// ── 参数名 → Zod Schema 映射 ──

function paramToZod(p: SkillParamDef): z.ZodType {
  let schema: z.ZodType;
  switch (p.type) {
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    default:
      schema = z.string();
  }
  if (p.description) schema = schema.describe(p.description);
  if (!p.required) schema = schema.optional();
  return schema;
}

function buildZodSchema(params: Record<string, SkillParamDef>): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, def] of Object.entries(params)) {
    shape[key] = paramToZod(def);
  }
  return z.object(shape);
}

// ── 变量替换（带安全转义） ──

/** 对 shell 参数进行安全转义，防止命令注入 */
function shellEscape(value: unknown): string {
  const str = String(value ?? '');
  // 用单引号包裹，内部的单引号用 '\'' 替换
  if (str === '') return "''";
  // 如果只包含安全字符，不需要转义
  if (/^[a-zA-Z0-9_./:@=,+-]+$/.test(str)) return str;
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function resolveVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    if (val === undefined || val === null) return '';
    return shellEscape(val);
  });
}

// ── 参数格式归一化 ──

/** 将数组格式的 parameters 转换为对象格式 */
function normalizeParameters(
  params: Record<string, SkillParamDef> | Array<Record<string, unknown>>,
): Record<string, SkillParamDef> {
  // 已经是对象格式，直接返回
  if (!Array.isArray(params)) return params;

  // 数组格式：每个元素有 name/type/description/required 等字段
  const result: Record<string, SkillParamDef> = {};
  for (const item of params) {
    const name = item.name as string;
    if (!name) continue;
    result[name] = {
      type: (item.type as SkillParamDef['type']) ?? 'string',
      description: (item.description as string) ?? '',
      required: item.required as boolean | undefined,
      default: item.default,
      enum: item.enum as string[] | undefined,
    };
  }
  return result;
}

// ── Skill Manager ──

export class SkillManager {
  private skills = new Map<string, LoadedSkill>();
  private scanDirs: string[];
  private verbose: boolean;
  readonly growth: SkillGrowth;

  constructor(scanDirs: string[], verbose = false) {
    this.scanDirs = scanDirs;
    this.verbose = verbose;
    this.growth = new SkillGrowth();
  }

  /** 扫描所有目录，加载 .skillmate 工具文件 */
  async scanAndLoad(): Promise<LoadedSkill[]> {
    // 加载成长数据
    await this.growth.load();

    const loaded: LoadedSkill[] = [];

    for (const dir of this.scanDirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.name.endsWith('.skillmate')) continue;
          const filePath = path.join(dir, entry.name);

          try {
            const skill = await this.loadSkillFile(filePath);
            if (skill) {
              loaded.push(skill);
              this.skills.set(skill.toolName, skill);
            }
          } catch (err) {
            if (this.verbose) {
              console.warn(`[SkillManager] 加载失败: ${filePath} — ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        if (this.verbose) {
          console.warn(`[SkillManager] 扫描目录失败: ${dir} — ${(err as Error).message}`);
        }
      }
    }

    if (this.verbose && loaded.length > 0) {
      console.log(`[SkillManager] 加载了 ${loaded.length} 个工具 Skill`);
    }

    return loaded;
  }

  /** 加载单个 .skillmate 文件 */
  private async loadSkillFile(filePath: string): Promise<LoadedSkill | null> {
    const raw = await fs.readFile(filePath, 'utf-8');

    // 跳过空文件和注释文件
    if (raw.trim().length === 0 || raw.trim().startsWith('//')) return null;

    const def = JSON.parse(raw) as BuddySkillDef;

    // 基本验证
    if (!def.name || !def.description || !def.execute) {
      throw new Error(`缺少必填字段 (name/description/execute)`);
    }

    // 归一化参数格式（兼容数组和对象两种格式）
    def.parameters = normalizeParameters(def.parameters as any);

    const toolName = `skill_${def.name}`;
    if (this.skills.has(toolName)) {
      throw new Error(`工具名冲突: ${toolName} 已存在`);
    }

    return {
      def,
      filePath,
      toolName,
      loadedAt: Date.now(),
    };
  }

  /** 将所有已加载的 Skill 注册到 ToolRegistry */
  registerAll(registry: { register: (tool: ToolDef) => void }): number {
    let count = 0;
    for (const [toolName, skill] of this.skills) {
      const toolDef = this.toToolDef(skill);
      registry.register(toolDef);
      count++;
      if (this.verbose) {
        console.log(`  [SkillManager] 注册: ${toolName} — ${skill.def.description}`);
      }
    }
    return count;
  }

  /** 将单个 Skill 转换为 ToolDef（带成长追踪） */
  private toToolDef(skill: LoadedSkill): ToolDef {
    const { def, toolName } = skill;
    const growth = this.growth;

    return {
      name: toolName,
      description: `[Skill] ${def.description}`,
      parameters: buildZodSchema(def.parameters),
      permission: def.permission ?? 'exec_safe',
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const startTime = Date.now();
        let success = false;
        let errorMsg: string | undefined;

        try {
          const commands = Array.isArray(def.execute) ? def.execute : [def.execute];
          const outputs: string[] = [];

          for (const cmd of commands) {
            const resolved = resolveVars(cmd.command, args);
            const timeout = cmd.timeout ?? 30;
            const cwd = cmd.cwd ? resolveVars(cmd.cwd, args) : undefined;

            const { exec: execCb } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(execCb);

            const execOpts: { timeout: number; cwd?: string; env?: Record<string, string> } = {
              timeout: timeout * 1000,
              ...(cwd ? { cwd } : {}),
              ...(def.env ? { env: { ...Object.fromEntries(Object.entries(process.env).filter(([_, v]) => v !== undefined) as [string, string][]), ...def.env } } : {}),
            };

            const { stdout, stderr } = await execAsync(resolved, execOpts);
            const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
            outputs.push(output);
          }

          const combined = outputs.join('\n---\n');
          success = true;

          switch (def.resultParser) {
            case 'json':
              try {
                const parsed = JSON.parse(combined);
                return JSON.stringify(parsed, null, 2);
              } catch {
                return combined;
              }
            case 'lines':
              return combined.split('\n').filter(l => l.trim()).join('\n');
            default:
              return combined;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errorMsg = msg;
          return `[Skill:${def.name}] 执行失败: ${msg}`;
        } finally {
          // 记录成长数据
          growth.record(toolName, success, Date.now() - startTime, errorMsg);
        }
      },
    };
  }

  /** 获取已加载的 Skill 列表 */
  listSkills(): Array<{ name: string; description: string; version: string; filePath: string }> {
    return [...this.skills.values()].map(s => ({
      name: s.toolName,
      description: s.def.description,
      version: s.def.version,
      filePath: s.filePath,
    }));
  }

  /** 按名称获取 Skill */
  getSkill(name: string): LoadedSkill | undefined {
    return this.skills.get(name.startsWith('skill_') ? name : `skill_${name}`);
  }

  /** 卸载并移除 Skill */
  async unloadSkill(name: string): Promise<boolean> {
    const key = name.startsWith('skill_') ? name : `skill_${name}`;
    return this.skills.delete(key);
  }

  /** 获取 Skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  /** 获取第一个扫描目录（用于写入新 .skillmate 文件） */
  getScanDir(): string | null {
    return this.scanDirs[0] ?? null;
  }
}
