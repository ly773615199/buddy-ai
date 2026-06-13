/**
 * 三脑决策与执行质量测试 v2
 * 
 * 正确处理 WS 协议：confirm_required → confirm, response_end → 完成
 */

import WebSocket from 'ws';

interface BrainTrace {
  phase: 'signal' | 'resource' | 'decision' | 'execution' | 'outcome';
  traceId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface TaskResult {
  task: string;
  difficulty: 'easy' | 'medium' | 'hard';
  response: string;
  toolCalls: number;
  traces: BrainTrace[];
  emotions: Array<{ mood: string; energy: number; satisfaction: number }>;
  startTime: number;
  endTime: number;
  latencyMs: number;
  decisionMode: string;
  decisionReason: string;
  decisionPath: string;
  nodes: string[];
  intuition: Record<string, unknown>;
  bodyState: Record<string, unknown>;
  confirmRequired: boolean;
}

const WS_URL = 'ws://localhost:8765';
const WS_TOKEN = 'dc262c2b28e10c1b9b19d1c695f3bc04ec3dbeea33bf7071';
const TIMEOUT_MS = 120_000;

const TEST_TASKS = [
  // 🟢 简单
  { difficulty: 'easy' as const, task: '你好，今天天气怎么样？' },
  { difficulty: 'easy' as const, task: '1+1等于几？' },
  { difficulty: 'easy' as const, task: '用一句话介绍你自己' },

  // 🟡 中等
  { difficulty: 'medium' as const, task: '查看当前目录有哪些文件' },
  { difficulty: 'medium' as const, task: '帮我查一下今天的日期和时间' },
  { difficulty: 'medium' as const, task: '计算 fibonacci 数列前 10 项' },

  // 🔴 困难
  { difficulty: 'hard' as const, task: '分析当前项目的 package.json，列出所有依赖并按类别分组（运行时依赖、开发依赖、AI相关依赖）' },
  { difficulty: 'hard' as const, task: '写一个 Python 脚本，实现快速排序算法，并解释时间复杂度' },
  { difficulty: 'hard' as const, task: '对比 React 和 Vue 的优缺点，用表格形式展示' },
];

async function sendTask(taskDef: typeof TEST_TASKS[0]): Promise<TaskResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?token=${WS_TOKEN}`);
    const traces: BrainTrace[] = [];
    const emotions: Array<{ mood: string; energy: number; satisfaction: number }> = [];
    const startTime = Date.now();
    let response = '';
    let toolCalls = 0;
    let resolved = false;
    let confirmRequired = false;
    let decisionMode = 'unknown';
    let decisionReason = '';
    let decisionPath = '';
    let nodes: string[] = [];
    let intuition: Record<string, unknown> = {};
    let bodyState: Record<string, unknown> = {};

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(buildResult());
      }
    }, TIMEOUT_MS);

    function buildResult(): TaskResult {
      return {
        task: taskDef.task,
        difficulty: taskDef.difficulty,
        response: response || '[TIMEOUT]',
        toolCalls,
        traces,
        emotions,
        startTime,
        endTime: Date.now(),
        latencyMs: Date.now() - startTime,
        decisionMode,
        decisionReason,
        decisionPath,
        nodes,
        intuition,
        bodyState,
        confirmRequired,
      };
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'chat',
        content: taskDef.task,
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'brain_trace':
            traces.push({
              phase: msg.phase,
              traceId: msg.traceId,
              timestamp: msg.timestamp,
              data: msg.data,
            });
            // 提取决策信息
            if (msg.phase === 'decision') {
              decisionMode = msg.data.mode || 'unknown';
              decisionReason = msg.data.reason || '';
              decisionPath = msg.data.path || '';
              nodes = msg.data.nodes || [];
              intuition = msg.data.intuition || {};
            }
            if (msg.phase === 'resource') {
              bodyState = msg.data;
            }
            break;

          case 'emotion':
            emotions.push({ mood: msg.mood, energy: msg.energy, satisfaction: msg.satisfaction });
            break;

          case 'llm_response':
            response = msg.content || '';
            break;

          case 'confirm_required':
            confirmRequired = true;
            // 自动确认
            ws.send(JSON.stringify({ type: 'tool_confirm_response', id: msg.id || `confirm-${Date.now()}`, allowed: true }));
            break;

          case 'response_end':
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              toolCalls = msg.toolCalls || 0;
              if (msg.content) response = msg.content;
              ws.close();
              resolve(buildResult());
            }
            break;
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(buildResult());
      }
    });

    ws.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(buildResult());
      }
    });
  });
}

function generateReport(results: TaskResult[]): string {
  const now = new Date();

  let report = `# 三脑决策与执行质量测试报告

> 生成时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
> 测试任务数: ${results.length}
> WebSocket: ${WS_URL}

---

## 一、总览

| 指标 | 值 |
|------|-----|
| 总任务数 | ${results.length} |
| 简单任务 | ${results.filter(r => r.difficulty === 'easy').length} |
| 中等任务 | ${results.filter(r => r.difficulty === 'medium').length} |
| 困难任务 | ${results.filter(r => r.difficulty === 'hard').length} |
| 平均延迟 | ${Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)}ms |
| 有 brain_trace | ${results.filter(r => r.traces.length > 0).length}/${results.length} |
| 需确认 | ${results.filter(r => r.confirmRequired).length} |
| 有工具调用 | ${results.filter(r => r.toolCalls > 0).length} |

---

## 二、按难度分析

`;

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    const tasks = results.filter(r => r.difficulty === diff);
    if (tasks.length === 0) continue;
    const label = diff === 'easy' ? '🟢 简单' : diff === 'medium' ? '🟡 中等' : '🔴 困难';
    const avgLatency = Math.round(tasks.reduce((s, r) => s + r.latencyMs, 0) / tasks.length);
    const avgTraces = (tasks.reduce((s, r) => s + r.traces.length, 0) / tasks.length).toFixed(1);

    report += `### ${label}任务

| 指标 | 值 |
|------|-----|
| 数量 | ${tasks.length} |
| 平均延迟 | ${avgLatency}ms |
| 平均 trace 数 | ${avgTraces} |
| 有工具调用 | ${tasks.filter(r => r.toolCalls > 0).length}/${tasks.length} |

| # | 任务 | 延迟(ms) | Traces | 决策模式 | 路径 | 工具 | 回复摘要 |
|---|------|---------|--------|---------|------|------|---------|
`;

    tasks.forEach((t, i) => {
      const summary = t.response.slice(0, 50).replace(/\n/g, ' ') + (t.response.length > 50 ? '...' : '');
      report += `| ${i + 1} | ${t.task.slice(0, 25)} | ${t.latencyMs} | ${t.traces.length} | ${t.decisionMode} | ${t.decisionPath} | ${t.toolCalls} | ${summary} |\n`;
    });
    report += '\n';
  }

  // 三脑决策详情
  report += `## 三、三脑决策详细追踪\n\n`;

  results.forEach((r, i) => {
    const signalTraces = r.traces.filter(t => t.phase === 'signal');
    const resourceTraces = r.traces.filter(t => t.phase === 'resource');
    const decisionTraces = r.traces.filter(t => t.phase === 'decision');
    const executionTraces = r.traces.filter(t => t.phase === 'execution');
    const outcomeTraces = r.traces.filter(t => t.phase === 'outcome');

    report += `### 任务 ${i + 1}: ${r.task}

| 属性 | 值 |
|------|-----|
| 难度 | ${r.difficulty} |
| 延迟 | ${r.latencyMs}ms |
| 决策模式 | ${r.decisionMode} |
| 决策路径 | ${r.decisionPath} |
| 决策原因 | ${r.decisionReason} |
| 使用节点 | ${r.nodes.join(', ') || '无'} |
| Trace数 | ${r.traces.length} (signal=${signalTraces.length} resource=${resourceTraces.length} decision=${decisionTraces.length} execution=${executionTraces.length} outcome=${outcomeTraces.length}) |
| 工具调用 | ${r.toolCalls} |
| 需确认 | ${r.confirmRequired ? '是' : '否'} |
`;

    // 直觉信号
    if (r.intuition && Object.keys(r.intuition).length > 0) {
      const intent = (r.intuition as any).intent || {};
      const proto = (r.intuition as any).protoMatch || {};
      report += `\n**右脑直觉信号:**\n`;
      report += `- 意图分类: ${intent.category || 'N/A'} (置信度: ${intent.confidence?.toFixed(3) || 'N/A'})\n`;
      if (proto.prototype) {
        report += `- 原型匹配: ${proto.prototype.label || proto.prototype.id} (距离: ${proto.distance?.toFixed(3) || 'N/A'})\n`;
      }
    }

    // 资源状态
    if (r.bodyState && Object.keys(r.bodyState).length > 0) {
      report += `\n**小脑资源状态:**\n`;
      report += `- 可用模型数: ${r.bodyState.availableNodeCount || 'N/A'}\n`;
      report += `- 本地覆盖率: ${r.bodyState.localCoverageRatio || 'N/A'}\n`;
      report += `- 本地置信度: ${r.bodyState.localConfidence || 'N/A'}\n`;
      report += `- 经验命中: ${r.bodyState.experienceHit || '无'}\n`;
    }

    // 情绪变化
    if (r.emotions.length > 0) {
      const first = r.emotions[0];
      const last = r.emotions[r.emotions.length - 1];
      report += `\n**情绪变化:** ${first.mood} (能量:${first.energy} 满意度:${first.satisfaction}) → ${last.mood} (能量:${last.energy} 满意度:${last.satisfaction})\n`;
    }

    // Trace 时间线
    if (r.traces.length > 0) {
      report += `\n<details><summary>📋 Trace 时间线</summary>\n\n\`\`\`\n`;
      r.traces.forEach(t => {
        const relTime = t.timestamp - r.startTime;
        const dataStr = JSON.stringify(t.data).slice(0, 150);
        report += `[+${relTime}ms] ${t.phase}: ${dataStr}\n`;
      });
      report += `\`\`\`\n\n</details>\n`;
    }

    report += `\n**回复:**\n\`\`\`\n${r.response.slice(0, 800)}\n\`\`\`\n\n---\n\n`;
  });

  // 质量评估
  report += `## 四、质量评估\n\n`;

  // 4.1 决策链路完整性
  const fullChain = results.filter(r => {
    const phases = new Set(r.traces.map(t => t.phase));
    return phases.has('signal') && phases.has('decision');
  });
  report += `### 4.1 决策链路完整性\n\n`;
  report += `| 类别 | 数量 | 占比 |\n|------|------|------|\n`;
  report += `| 完整链路 (signal+decision) | ${fullChain.length} | ${(fullChain.length / results.length * 100).toFixed(0)}% |\n`;
  report += `| 有决策追踪 | ${results.filter(r => r.traces.length > 0).length} | ${(results.filter(r => r.traces.length > 0).length / results.length * 100).toFixed(0)}% |\n`;
  report += `| 无追踪 | ${results.filter(r => r.traces.length === 0).length} | ${(results.filter(r => r.traces.length === 0).length / results.length * 100).toFixed(0)}% |\n\n`;

  // 4.2 决策模式分布
  const modeCount: Record<string, number> = {};
  results.forEach(r => { modeCount[r.decisionMode] = (modeCount[r.decisionMode] || 0) + 1; });
  report += `### 4.2 决策模式分布\n\n`;
  report += `| 模式 | 数量 | 占比 |\n|------|------|------|\n`;
  Object.entries(modeCount).sort((a, b) => b[1] - a[1]).forEach(([mode, count]) => {
    report += `| ${mode} | ${count} | ${(count / results.length * 100).toFixed(0)}% |\n`;
  });

  // 4.3 延迟分布
  report += `\n### 4.3 延迟分布\n\n`;
  report += `| 难度 | 平均(ms) | 最小(ms) | 最大(ms) |\n|------|---------|---------|--------|\n`;
  for (const diff of ['easy', 'medium', 'hard'] as const) {
    const tasks = results.filter(r => r.difficulty === diff);
    if (tasks.length === 0) continue;
    const latencies = tasks.map(r => r.latencyMs);
    report += `| ${diff} | ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} | ${Math.min(...latencies)} | ${Math.max(...latencies)} |\n`;
  }

  // 4.4 建议
  report += `\n### 4.4 诊断与建议\n\n`;
  if (results.filter(r => r.traces.length === 0).length > results.length * 0.3) {
    report += `- ⚠️ 部分任务无 brain_trace — 可能是简单任务跳过了三脑决策路径\n`;
  }
  if (results.every(r => r.decisionMode === 'single')) {
    report += `- ℹ️ 所有任务均使用 single 模式 — DAG 编排和多专家模式未触发\n`;
  }
  if (results.some(r => r.confirmRequired)) {
    report += `- ℹ️ 部分任务需要确认 — 符合预期的安全机制\n`;
  }
  if (fullChain.length >= results.length * 0.7) {
    report += `- ✅ 决策链路覆盖率良好\n`;
  }

  report += `\n---\n*报告由三脑测试自动生成*\n`;
  return report;
}

async function main() {
  console.log('🧪 三脑决策与执行质量测试');
  console.log(`📡 ${WS_URL}`);
  console.log(`📋 ${TEST_TASKS.length} 个任务\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < TEST_TASKS.length; i++) {
    const taskDef = TEST_TASKS[i];
    const label = taskDef.difficulty === 'easy' ? '🟢' : taskDef.difficulty === 'medium' ? '🟡' : '🔴';
    process.stdout.write(`[${i + 1}/${TEST_TASKS.length}] ${label} ${taskDef.task.slice(0, 35)}...`);

    const result = await sendTask(taskDef);
    results.push(result);

    console.log(` ✅ ${result.latencyMs}ms | ${result.traces.length}T | ${result.decisionMode} | ${result.response.length}ch`);

    if (i < TEST_TASKS.length - 1) await new Promise(r => setTimeout(r, 3000));
  }

  const report = generateReport(results);
  const reportPath = `/root/.openclaw/workspace/buddy/THREE_BRAIN_TEST_REPORT_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10)}.md`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n📄 报告: ${reportPath}`);
}

main().catch(console.error);
