# 开发环境调试报告

**日期**: 2026-04-24  
**操作**: 克隆仓库 → 静态检查 → 修复 → 配置 LLM → 启动开发环境

---

## 1. 静态检查结果

### TypeScript 编译
- 后端: 1 error → **已修复** (message-processor.test.ts 类型 cast)
- 前端: 0 errors ✅

### ESLint
- 25 errors + 49 warnings → **0 errors** + 49 warnings
- 修复了 13 个文件，详见 commit `2231cf8`

## 2. 开发环境问题

### Bug #1: WebSocket 连接泄漏 🔴

**现象**: 前端打开后 WS 连接数从 0 飙升到 250+，导致服务不稳定  
**根因**: `App.tsx` 中 `useWebSocket` 的 `onEvent` 参数是内联箭头函数，每次渲染创建新引用 → `handleMessage` useCallback 依赖变化 → useEffect 重新执行 → 新建 WebSocket 连接  
**修复**: 将 `onEvent` 包装为 `useCallback` (handleWsEvent)，稳定引用  
**文件**: `frontend/src/App.tsx`  
**状态**: ⚠️ 已修复代码，但旧连接残留需重启清除

### Bug #2: Onboarding Provider 名称错误 🟡

**现象**: Onboarding 选择硅基流动后，config 存为 `provider: "custom"` 而非 `"siliconflow"`  
**影响**: 功能正常（custom 走 OpenAI 兼容模式），但 LLM 显示 `custom/Qwen/...` 不够清晰  
**临时修复**: 手动改 `~/.buddy/config.json` 的 provider 字段  
**根因**: 前端 onboarding 组件的 provider 映射逻辑问题  
**状态**: ✅ 已修复 — `Onboarding.tsx` 第 143、157 行，删除三元表达式，直接透传 `selectedProvider.id`

### Bug #3: 端口占用冲突 ✅

**现象**: `npm run dev:all` 报 `EADDRINUSE: address already in use :::8765`  
**根因**: 前次进程未完全退出  
**修复**: 为 `dev`、`dev:ws`、`dev:frontend`、`dev:all` 四个脚本添加 `pre` 钩子，启动前自动清理残留进程  
**状态**: ✅ 已修复 — `package.json` 新增 4 个 `pre` 脚本

## 3. LLM 配置

- **Provider**: SiliconFlow (custom 模式)
- **Model**: Qwen/Qwen2.5-7B-Instruct
- **API**: https://api.siliconflow.cn/v1
- **连接测试**: ✅ 成功
- **WS Token**: 自动从 `/api/ws-token` 获取

## 4. 文件修改清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `frontend/src/App.tsx` | onEvent → useCallback 包装 | Bug fix |
| `src/core/message-processor.test.ts` | SkillOps 类型 cast | TS fix |
| 13 个前端文件 | ESLint 错误修复 | Lint fix |

## 5. 待办

- [x] 修复 onboarding provider 映射 (custom → siliconflow) ✅
- [x] 修复端口占用冲突（添加 pre 钩子自动清理） ✅
- [ ] 彻底解决 WS 连接泄漏（ref 透传 + useSyncExternalStore 方案，详见 WEBSOCKET_ANALYSIS_AND_OPTIMIZATION.md）
- [ ] 传感器数据节流
- [ ] 消息优先级队列
- [ ] perMessageDeflate 消息压缩

## 6. WebSocket 通信层分析

已完成全面分析，详见 [WEBSOCKET_ANALYSIS_AND_OPTIMIZATION.md](./WEBSOCKET_ANALYSIS_AND_OPTIMIZATION.md)
