/**
 * DAG 工作流管理器 — 持久化 / 列表 / 执行 / 历史
 */

import type { DAGWorkflowDef, TaskDAG, OrchestrateResult, OrchestrateEvent, ConditionEdge, RetryConfig } from './types.js';
import { createDAG, createTask, addTask, addEdge } from './dag.js';
import { TaskExecutor } from './executor.js';
import type { ToolRegistry } from '../tools/registry.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkflowRunRecord {
  workflowId: string;
  dagId: string;
  startedAt: number;
  finishedAt: number;
  success: boolean;
  summary: string;
  totalMs: number;
}

export class WorkflowManager {
  private workflows = new Map<string, DAGWorkflowDef>();
  private history: WorkflowRunRecord[] = [];
  private savePath: string;
  private historyPath: string;
  private executor: TaskExecutor;

  constructor(registry: ToolRegistry, dataDir?: string, verbose = false) {
    const dir = dataDir ?? path.join(process.env.HOME ?? '/tmp', '.buddy');
    this.savePath = path.join(dir, 'dag-workflows.json');
    this.historyPath = path.join(dir, 'dag-workflow-history.jsonl');
    this.executor = new TaskExecutor(registry, undefined, verbose);
  }

  async init(): Promise<void> {
    await this.load();
  }

  // ── CRUD ──

  list(category?: string): DAGWorkflowDef[] {
    const all = Array.from(this.workflows.values());
    if (category) return all.filter(w => w.category === category);
    return all;
  }

  get(id: string): DAGWorkflowDef | undefined {
    return this.workflows.get(id);
  }

  async save(def: DAGWorkflowDef): Promise<void> {
    def.updatedAt = Date.now();
    this.workflows.set(def.id, def);
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const result = this.workflows.delete(id);
    if (result) await this.persist();
    return result;
  }

  // ── 执行 ──

  async run(
    workflowId: string,
    onEvent?: (event: OrchestrateEvent) => void,
  ): Promise<OrchestrateResult> {
    const def = this.workflows.get(workflowId);
    if (!def) throw new Error(`工作流不存在: ${workflowId}`);

    const dag = this.defToDAG(def);
    const noop = () => {};

    const result = await this.executor.execute(dag, onEvent ?? noop, 4);

    // 记录历史
    def.runCount++;
    def.lastRunAt = Date.now();

    const record: WorkflowRunRecord = {
      workflowId: def.id,
      dagId: dag.id,
      startedAt: dag.createdAt,
      finishedAt: Date.now(),
      success: result.success,
      summary: result.summary,
      totalMs: result.totalMs,
    };
    this.history.push(record);

    // 持久化
    await this.persist();
    await this.persistHistory(record);

    return result;
  }

  // ── 从 DAG 执行结果创建 workflow ──

  async createFromDAG(
    dag: TaskDAG,
    name: string,
    description?: string,
    category: DAGWorkflowDef['category'] = 'custom',
  ): Promise<DAGWorkflowDef> {
    const def: DAGWorkflowDef = {
      id: `wf_${Date.now().toString(36)}`,
      name,
      description: description ?? dag.description,
      category,
      dag: {
        tasks: Array.from(dag.tasks.values()).map(t => ({
          id: t.id,
          name: t.name,
          tool: t.tool,
          args: t.args,
          deps: t.deps,
          retry: t.retry,
          timeoutMs: t.timeoutMs,
        })),
        edges: dag.edges,
        parallelGroups: dag.parallelGroups,
        defaultTimeoutMs: dag.defaultTimeoutMs,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    await this.save(def);
    return def;
  }

  // ── 历史 ──

  getHistory(workflowId?: string, limit = 20): WorkflowRunRecord[] {
    let records = this.history;
    if (workflowId) records = records.filter(r => r.workflowId === workflowId);
    return records.slice(-limit);
  }

  // ── 内部 ──

  private defToDAG(def: DAGWorkflowDef): TaskDAG {
    const dag = createDAG(def.description, {
      defaultTimeoutMs: def.dag.defaultTimeoutMs ?? 30000,
    });

    const taskIdMap = new Map<string, string>();

    for (const t of def.dag.tasks) {
      const task = createTask(t.name, t.tool, t.args, [], {
        retry: t.retry,
        timeoutMs: t.timeoutMs,
      });
      // 保留原始 ID 映射
      taskIdMap.set(t.id, task.id);
      addTask(dag, task);
    }

    // 重写依赖
    for (const t of def.dag.tasks) {
      const dagId = taskIdMap.get(t.id)!;
      const task = dag.tasks.get(dagId)!;
      task.deps = t.deps
        .map(dep => taskIdMap.get(dep) ?? dep)
        .filter(dep => dag.tasks.has(dep));
    }

    // 边
    for (const edge of (def.dag.edges ?? [])) {
      const from = taskIdMap.get(edge.from);
      const to = taskIdMap.get(edge.to);
      if (from && to) {
        addEdge(dag, { from, to, condition: edge.condition });
      }
    }

    // 并行组
    for (const group of (def.dag.parallelGroups ?? [])) {
      dag.parallelGroups.push(
        group.map(id => taskIdMap.get(id) ?? id).filter(id => dag.tasks.has(id)),
      );
    }

    return dag;
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.savePath);
    await fs.mkdir(dir, { recursive: true });
    const data = Array.from(this.workflows.values());
    await fs.writeFile(this.savePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.savePath, 'utf-8');
      const data: DAGWorkflowDef[] = JSON.parse(raw);
      for (const def of data) {
        this.workflows.set(def.id, def);
      }
    } catch { /* 空 */ }
  }

  private async persistHistory(record: WorkflowRunRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.historyPath, line, 'utf-8').catch(err => console.warn('[Workflow] 历史记录持久化失败:', err.message));
  }
}
