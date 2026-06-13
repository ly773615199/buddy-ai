import * as fs from 'fs';
import * as path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

/**
 * 环境自动检测 — 安装时检查运行环境
 */

export interface EnvCheck {
  name: string;
  ok: boolean;
  value: string;
  suggestion?: string;
}

export async function detectEnvironment(): Promise<EnvCheck[]> {
  const checks: EnvCheck[] = [];

  // Node.js 版本
  try {
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    checks.push({
      name: 'Node.js',
      ok: major >= 18,
      value: nodeVersion,
      suggestion: major < 18 ? '需要 Node.js >= 18，推荐 20+' : undefined,
    });
  } catch {
    checks.push({ name: 'Node.js', ok: false, value: '未检测到', suggestion: '请安装 Node.js 18+' });
  }

  // 网络连接
  try {
    await exec('curl -s --connect-timeout 5 https://api.openai.com', { timeout: 8000 });
    checks.push({ name: '网络连接', ok: true, value: '正常' });
  } catch {
    checks.push({ name: '网络连接', ok: false, value: '不可用', suggestion: '检查网络或代理设置' });
  }

  // Git
  try {
    const { stdout } = await exec('git --version', { timeout: 5000 });
    checks.push({ name: 'Git', ok: true, value: stdout.trim() });
  } catch {
    checks.push({ name: 'Git', ok: false, value: '未安装', suggestion: 'Git 工具功能不可用，核心功能不受影响' });
  }

  // Python (可选)
  try {
    const { stdout } = await exec('python3 --version || python --version', { timeout: 5000 });
    checks.push({ name: 'Python', ok: true, value: stdout.trim() });
  } catch {
    checks.push({ name: 'Python', ok: false, value: '未安装', suggestion: 'Python 代码执行不可用' });
  }

  // ~/.buddy 目录权限
  const buddyDir = path.join(process.env.HOME ?? '/tmp', '.buddy');
  try {
    if (!fs.existsSync(buddyDir)) fs.mkdirSync(buddyDir, { recursive: true });
    const testFile = path.join(buddyDir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    checks.push({ name: '数据目录', ok: true, value: buddyDir });
  } catch {
    checks.push({ name: '数据目录', ok: false, value: '不可写', suggestion: `检查 ${buddyDir} 权限` });
  }

  return checks;
}

/** 格式化检测结果 */
function formatChecks(checks: EnvCheck[]): string {
  const lines = ['\n🔍 环境检测:\n'];
  for (const c of checks) {
    const icon = c.ok ? '✅' : '❌';
    lines.push(`  ${icon} ${c.name}: ${c.value}`);
    if (c.suggestion) lines.push(`     💡 ${c.suggestion}`);
  }
  const allOk = checks.every(c => c.ok);
  lines.push(allOk ? '\n  ✅ 所有检查通过，可以开始使用！\n' : '\n  ⚠️ 部分检查未通过，核心功能仍可使用\n');
  return lines.join('\n');
}

/** 运行检测并打印 */
export async function runEnvCheck(): Promise<boolean> {
  const checks = await detectEnvironment();
  console.log(formatChecks(checks));
  return checks.filter(c => !c.ok).length === 0;
}
