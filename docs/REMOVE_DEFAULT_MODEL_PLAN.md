# 移除前端「默认模型」功能

## 背景

后端三脑系统用 Thompson Sampling 从模型池（71+ 模型）动态选择模型。`config.models.providers[0].model` 字段创建的 `currentModel` 在实际调用中**从未被使用**——`ModelRouter.select()` 直接从池子选，池子空了直接报错，不 fallback 到 `currentModel`。

前端的「默认模型」输入框、`defaultModel` 预设、`llm_config` WS 消息全是误导性功能。

## 目标

- 前端不需要默认模型功能
- 添加 API 端点后系统自动发现模型，发现结果即连通性反馈
- 删除独立的「测试连接」功能

## Phase 1: 后端

### 1.1 `src/core/ws-handler.ts` — POST /api/model-pool/providers
- [ ] `model` 字段改为可选
- [ ] 发现失败时返回 `discoveryError` 字段（当前 catch 只 warn，前端无法区分「无可用模型」和「key 无效」）
- [ ] 返回值改为 `{ok, modelCount, discoveryError?}`

### 1.2 `src/core/ws-handler.ts` — 删除测试连接
- [ ] 删除 `handleTestLLM` 方法
- [ ] 删除 `POST /api/llm/test` 路由
- [ ] 删除 `case 'test_llm'` 分支

### 1.3 `src/core/ws-handler.ts` — 删除 llm_config
- [ ] 删除 `handleLLMConfig` 方法
- [ ] 删除 `case 'llm_config'` 分支

### 1.4 `src/core/llm.ts`
- [ ] `resolveLLMConfig()` — model 改为可选，默认 `''`
- [ ] `updateProvider()` — model 改为可选
- [ ] 删除 `testConnection()` 方法

### 1.5 `src/core/subsystems.ts`
- [ ] `reconfigureLLM()` 只更新凭据，不依赖 model

### 1.6 `src/types.ts`
- [ ] `LLMConfig.model` → `model?: string`
- [ ] `UnifiedModelsConfig.providers[].model` → `model?: string`
- [ ] 删除 WS 消息类型 `{ type: 'llm_config' }`

## Phase 2: 前端

### 2.1 `frontend/src/components/Onboarding.tsx`
- [ ] 删除 model 输入框及相关状态
- [ ] 删除 `defaultModel` 字段（ProviderPreset 接口 + PROVIDERS 数组）
- [ ] 删除 `onTestLLM` / `testLLMResult` / `onLLMConfig` props
- [ ] 提交改为 POST `/api/model-pool/providers`，用返回的 `modelCount` / `discoveryError` 显示结果
- [ ] UI 反馈: "添加中..." → "✅ 发现 N 个模型" / "❌ 连接失败: {error}"

### 2.2 `frontend/src/components/Settings.tsx`
- [ ] `PROVIDERS_LIST` 删除 `defaultModel`
- [ ] 删除 `addProviderModel` 状态（已是死代码）
- [ ] 删除 `DEFAULT_LLM` / `llm` 状态 / `saveLlm` / `testLlm`（已是死代码）
- [ ] 删除 `onLLMConfig` / `onTestLLM` / `testLLMResult` props
- [ ] 添加端点后显示发现结果（`modelCount` / `discoveryError`）
- [ ] DataSection 导出去掉 `buddy_llm_config`

### 2.3 `frontend/src/App.tsx`
- [ ] 删除 `sendLLMConfig` / `sendTestLLM` / `testLLMResult` / `handleLLMConfig`
- [ ] 删除 localStorage `buddy_llm_config` 的读取和自动发送
- [ ] Onboarding 和 Settings 的 props 对应清理

### 2.4 `frontend/src/hooks/useWebSocket.ts`
- [ ] 删除 `sendLLMConfig` / `sendTestLLM` / `testLLMResult` 状态
- [ ] 删除 `case 'test_llm_result'` 处理

## Phase 3: E2E 测试适配

- [ ] `e2e/onboarding.spec.ts` — 去掉 model 断言，改为验证 POST 返回 modelCount
- [ ] `e2e/persistence.spec.ts` — 去掉 `buddy_llm_config` 相关断言（7 处）
- [ ] `e2e/ws-lifecycle.spec.ts` — 删 `llm_config` 和 `test_llm` 消息测试
- [ ] `e2e/ws-reconnection.spec.ts` — 去掉 `buddy_llm_config` 设置
- [ ] `e2e/chat-flow.spec.ts` — 去掉 `buddy_llm_config` 设置
- [ ] `e2e/model-selection-real.spec.ts` — 去掉 `llm_config` 监听
- [ ] `e2e/real-llm.spec.ts` / `e2e/real-llm-fixtures.ts` — 去掉 `llm_config` 相关
