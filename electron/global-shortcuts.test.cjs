/**
 * global-shortcuts.cjs — Smoke Tests
 *
 * 不需要真实 Electron 环境，mock globalShortcut 后测试基本行为。
 */

// ==================== Mock Electron ====================
const mockRegistered = new Set();

const mockGlobalShortcut = {
  register: function (accelerator, callback) {
    mockRegistered.add(accelerator);
    return true;
  },
  unregisterAll: function () {
    mockRegistered.clear();
  },
  isRegistered: function (accelerator) {
    return mockRegistered.has(accelerator);
  },
};

// 拦截 require 以返回 mock 的 electron 模块
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { globalShortcut: mockGlobalShortcut };
  }
  return origLoad.apply(this, arguments);
};

// ==================== Tests ====================
const { GlobalShortcuts } = require('./global-shortcuts.cjs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n[GlobalShortcuts Tests]\n');

// Test 1: Class can be required
assert(typeof GlobalShortcuts === 'function', 'GlobalShortcuts 是一个构造函数');

// Test 2: Constructor accepts options
const actions = [];
const gs = new GlobalShortcuts({
  onAction: (action) => actions.push(action),
  mainWindow: null,
});
assert(gs instanceof GlobalShortcuts, '实例化成功');

// Test 3: getStatus returns correct structure before registration
const status0 = gs.getStatus();
assert(typeof status0 === 'object', 'getStatus() 返回对象');
assert(status0.platform === process.platform, 'platform 正确');
assert(typeof status0.modifier === 'string', 'modifier 是字符串');
assert(Array.isArray(status0.registered), 'registered 是数组');
assert(typeof status0.total === 'number', 'total 是数字');
assert(status0.total === 5, 'total 为 5（五个快捷键）');
assert(status0.registered.length === 0, '注册前 registered 为空');
assert(status0.pushToTalkActive === false, 'pushToTalkActive 初始为 false');

// Test 4: registerAll registers shortcuts
gs.registerAll();
const status1 = gs.getStatus();
assert(status1.registered.length === 5, 'registerAll 后 registered 长度为 5');

// Test 5: unregisterAll clears all
gs.unregisterAll();
const status2 = gs.getStatus();
assert(status2.registered.length === 0, 'unregisterAll 后 registered 为空');

// Test 6: onAction callback works
gs.registerAll();
gs.onAction('test_action');
assert(actions.includes('test_action'), 'onAction 回调被调用');

// Cleanup
gs.unregisterAll();

// 恢复原始 Module._load
Module._load = origLoad;

console.log(`\n结果: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
