# 灵伴（Buddy）源代码深度审查报告

**审查日期**: 2026-05-12
**审查范围**: 全项目 ~490 个 TS 文件，约 95K 行代码
**审查人**: AI Code Reviewer

---

## 1. 总览

### 优点
- **架构设计有深度**：三脑架构（左脑/右脑/小脑/影子脑）+ STMP 时空记忆宫殿 + 情绪系统，概念完整且有理论支撑
- **类型系统较好**：`tsconfig.json` 开启 `strict: true`，核心类型定义清晰（`types.ts` 使用 Zod schema）
- **数据库迁移机制规范**：`core/migration.ts` 实现了版本化迁移，所有模块统一使用
- **沙箱安全意识强**：`tools/sandbox.ts` 有完整的危险命令黑名单、数据外泄检测、符号链接逃逸防护、环境变量清理
- **PII 脱敏模块完备**：`core/sanitizer.ts` 覆盖手机号、身份证、邮箱、API Key、JWT、文件路径、IP
- **WS 通信设计合理**：Token 认证、频率限制、心跳检测、僵尸连接清理、消息序列号 + 重放缓冲区
- **测试覆盖可观**：208 个后端测试文件 + 24 个前端测试文件

### 缺点
- **`any` 滥用严重**：405 处 `as any`、180 处 `: any`（已修复核心模块约 35 处）
- **安全漏洞存在**：浏览器工具代码注入、影子大脑 `new Function()`、Shell 注入（已修复）
- **空 catch 块泛滥**：250+ 处 `catch {}` 静默吞掉错误
- **文档 Plan 文件过多**：60+ 个 `*_PLAN.md`，实际文档偏薄
- **前端 XSS 风险**：`dangerouslySetInnerHTML` 直接渲染高亮代码

---

## 2. 严重问题（Critical）

### CRIT-01: 浏览器工具代码注入 ✅ 已修复
**文件**: `src/tools/browser.ts`

用户提供的 `url` 和 `output` 参数直接拼接进 JavaScript 源码字符串，写入临时文件后用 `node` 执行。

**攻击向量**: LLM 可被 prompt 注入诱导传入恶意参数，直接执行任意代码。

**修复**: 使用 `JSON.stringify()` 安全传递参数。

### CRIT-02: 影子大脑 `new Function()` 执行未隔离 ⚠️ 待修复
**文件**: `src/brain/shadow/phase10/tool-inventor.ts` 第 224、232、253 行

`new Function('input', tool.code)` 在主进程执行，拥有完整 Node.js 权限。危险关键词检查可被混淆绕过。

**建议**: 使用 `vm2` 或 `isolated-vm` 等真正的沙箱。

### CRIT-03: Git 工具命令注入 ✅ 已修复
**文件**: `src/tools/git-ops.ts`、`src/tools/builtin.ts`

所有 git 命令改用 `execFile` 数组参数，杜绝通过 commit message / branch name 的命令注入。

### CRIT-04: search_files Shell 注入 ✅ 已修复
**文件**: `src/tools/builtin.ts`

改用 `execFile('grep', [...args])` 替代 shell 拼接。

### CRIT-05: 前端 XSS — `dangerouslySetInnerHTML` ⚠️ 待修复
**文件**: `frontend/src/utils/markdown.tsx` 第 228、288 行

代码高亮结果直接注入 DOM，未做 sanitize。

**建议**: 使用 DOMPurify 或类似库 sanitize 高亮输出。

---

## 3. 重要问题（Major）

### MAJ-01: 硬编码的 Edge TTS Token
**文件**: `src/voice/edge-tts.ts` 第 81 行

`private trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'`

这是微软 Edge TTS 的公开客户端 Token，违反"敏感信息不硬编码"原则。

### MAJ-02: `any` 类型泛滥 ✅ 核心模块已修复
**统计**: 405 处 `as any`、180 处 `: any`

已修复核心模块（llm.ts、model-pool-unified.ts、model-router.ts、expert-pool.ts）约 35 处 `any`。

### MAJ-03: SSRF 防护 ✅ 已修复
**文件**: `src/tools/browser.ts`

添加 URL 校验拒绝内网/元数据地址，使用 Node.js fetch 替代 `curl -L`。

### MAJ-04/05: 路径遍历防护 ✅ 已修复
**文件**: `src/tools/builtin.ts`

`read_file`、`write_file`、`list_files` 统一使用 `isPathAllowed()` 限制操作范围。

### MAJ-06: WS 消息 Schema 校验 ✅ 已修复
**文件**: `src/ws/server.ts`

使用 Zod `discriminatedUnion` 校验所有入站消息类型。

### MAJ-07: 前端 Token URL 泄露
**文件**: `frontend/src/App.tsx` 第 46-52 行

Token 通过 HTTP GET 获取后拼入 WebSocket URL。浏览器原生 WebSocket 不支持自定义 header，URL 传 token 是常见做法，但应确保 `/api/ws-token` 只响应本地请求（已实现）。

### MAJ-08: 空 catch 块静默吞错
**统计**: 250+ 处

建议分三级处理：必须记录（DB/IO）、降级 fallback、可保持静默（清理操作）。

---

## 4. 一般问题（Minor）

| 编号 | 问题 | 文件 |
|------|------|------|
| MIN-01 | `formatOutput` 函数重复定义 | `builtin.ts` + `sandbox.ts` |
| MIN-02 | `execAsync` 重复导入 | `builtin.ts` + `git-ops.ts` |
| MIN-03 | `main.ts` 过于庞大（~1700 行） | `src/main.ts` |
| MIN-04 | 测试文件散落在 `src/` 根目录 | `test-*.ts` |
| MIN-05 | Plan 文档过多（60+ 个） | `*_PLAN.md` |
| MIN-06 | 命名不一致（snake_case vs camelCase） | 工具参数 |
| MIN-07 | `generateUUID` 使用 `Math.random()` | `edge-tts.ts` |
| MIN-08 | `DiscordAdapter` 中 `require('ws')` 不兼容 ESM | `platform.ts` |
| MIN-09 | 前端 `SensorPanel` 使用 `as any` | `SensorPanel.tsx` |
| MIN-10 | `WeComCrypto` 使用 `aes-256-cbc` | `wecom-crypto.ts` |

---

## 5. 建议

1. **引入 ESLint + 严格规则** — `@typescript-eslint/no-explicit-any` 设为 `error`
2. **统一错误处理** — 建立 `Result<T, E>` 类型替代随处 try/catch
3. **引入 CSP** — 前端配置 Content Security Policy
4. **工具参数统一 Zod 校验** — 所有 execute 入口强制解析
5. **数据库连接池管理** — 统一生命周期
6. **安全 HTTP 头** — X-Content-Type-Options、X-Frame-Options 等
7. **补充安全测试** — 注入攻击、路径遍历、认证绕过
8. **前端状态管理优化** — 引入 zustand 或 Context 分层
9. **文档精简** — 过时 Plan 归档

---

## 6. 各模块评分

| 模块 | 评分 | 说明 |
|------|------|------|
| brain/ | 8/10 | 三脑架构精巧，信号流清晰。扣分：any、new Function 安全风险 |
| emotion/ | 7/10 | 情绪引擎设计合理，engine.ts 偏大可拆分 |
| memory/ (STMP) | 8/10 | 时空记忆宫殿概念新颖，SQLite 参数化查询安全 |
| intelligence/ | 7/10 | 经验图谱完整。扣分：any、训练数据验证不足 |
| lora/ | 7/10 | LoRA 管道完整。扣分：云训练安全验证不足 |
| ternary/ | 6/10 | 功能齐全但代码量大 |
| tools/ | 6/10 | 沙箱安全强。扣分：浏览器/Git/搜索注入（已修复） |
| billing/ | 7/10 | Stripe 集成规范。扣分：支付宝/微信未实现 |
| social/ | 7/10 | 多平台架构清晰。扣分：Discord require() 不兼容 ESM |
| core/ | 7/10 | 编排设计合理。扣分：main.ts 过大 |
| ws/ | 8/10 | Token 认证 + 频率限制 + 重放缓冲区完善 |
| config.ts | 8/10 | 配置迁移机制好，Zod 校验完整 |
| frontend/ | 6/10 | 组件结构清晰。扣分：XSS 风险、状态管理扁平 |
| 测试 | 7/10 | 覆盖可观，安全测试不足 |

**总评: 7.0 / 10**

---

## 7. 本次修复清单 (2026-05-12)

### 已修复 (14 files, +391, -131)

| 优先级 | 修复项 | 文件 |
|--------|--------|------|
| P0 | CRIT-01 浏览器代码注入 | `src/tools/browser.ts` |
| P0 | CRIT-03 Git 命令注入 | `src/tools/git-ops.ts` |
| P0 | MAJ-03 SSRF 防护 | `src/tools/browser.ts` |
| P0 | MAJ-04/05 路径遍历 | `src/tools/builtin.ts` |
| P0 | MAJ-04 search_files 注入 | `src/tools/builtin.ts` |
| P1 | MAJ-06 WS 消息校验 | `src/ws/server.ts` |
| P2 | llm.ts any 消除 (12处) | `src/core/llm.ts` |
| P2 | model-pool-unified.ts any 消除 (15处) | `src/core/model-pool-unified.ts` |
| P2 | model-router.ts any 消除 (4处) | `src/core/model-router.ts` |
| P2 | expert-pool.ts any 消除 (4处) | `src/core/expert-pool.ts` |
| P2 | message-preprocessor.ts role 类型 | `src/core/message-preprocessor.ts` |
| P2 | belief-store.ts getAll() | `src/memory/belief-store.ts` |
| P2 | ThompsonParams 导出 | `src/core/model-pool.ts` |
| P2 | WSEvent 补充 expert 事件 | `src/types.ts` |

### 待修复 (后续 Sprint)

- CRIT-02: 影子大脑 new Function 隔离
- CRIT-05: 前端 dangerouslySetInnerHTML sanitize
- MAJ-02: 剩余 ~220 处 as any（ws-handler、main、knowledge 等）
- MAJ-08: 250+ 空 catch 块分级处理
