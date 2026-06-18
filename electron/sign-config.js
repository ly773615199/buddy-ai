/**
 * Windows 代码签名配置
 *
 * 使用方法：
 * 1. 设置环境变量：
 *    - CSC_LINK: 证书文件路径 (.pfx/.p12)
 *    - CSC_KEY_PASSWORD: 证书密码
 *    - 或使用 EV 证书（硬件令牌）：
 *    - WIN_CSC_LINK: EV 证书路径
 *    - WIN_CSC_KEY_PASSWORD: EV 证书密码
 *
 * 2. 构建时自动签名：
 *    npm run electron:build:win
 */

const path = require('path');

/**
 * 签名函数（electron-builder 回调）
 */
async function sign(configuration) {
  const { path: filePath, hash, isNest } = configuration;

  // 从环境变量获取证书信息
  const certLink = process.env.CSC_LINK || process.env.WIN_CSC_LINK;
  const certPassword = process.env.CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD;

  if (!certLink) {
    console.warn('[Sign] 未配置证书，跳过代码签名');
    console.warn('[Sign] 请设置 CSC_LINK 和 CSC_KEY_PASSWORD 环境变量');
    return;
  }

  console.log(`[Sign] 签名文件: ${path.basename(filePath)}`);
  console.log(`[Sign] 哈希算法: ${hash}`);

  // 使用 signtool.exe 签名
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // 查找 signtool（Windows SDK）
  const signtoolPaths = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe',
    'signtool.exe', // PATH 中
  ];

  let signtool = 'signtool.exe';
  for (const p of signtoolPaths) {
    try {
      require('fs').accessSync(p);
      signtool = p;
      break;
    } catch {}
  }

  // 时间戳服务器（免费）
  const timestampServers = [
    'http://timestamp.digicert.com',
    'http://timestamp.sectigo.com',
    'http://timestamp.comodoca.com',
  ];

  const args = [
    'sign',
    '/f', certLink,
    '/p', certPassword,
    '/fd', hash || 'SHA256',
    '/tr', timestampServers[0],
    '/td', 'SHA256',
  ];

  // 如果是嵌套签名（如安装包内嵌的 exe）
  if (isNest) {
    args.push('/as');
  }

  args.push(filePath);

  try {
    await execFileAsync(signtool, args, { timeout: 60000 });
    console.log(`[Sign] ✅ 签名成功: ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[Sign] ❌ 签名失败: ${err.message}`);
    // 签名失败不阻断构建（开发阶段）
    if (process.env.CI) {
      throw err;
    }
  }
}

module.exports = { sign };
