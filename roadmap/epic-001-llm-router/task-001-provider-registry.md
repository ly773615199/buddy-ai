# Task 001: Provider 注册表整理

## 目标

`provider-registry.ts` 完成最终形态：
- 所有 OpenAI 兼容 Provider 用 `createOpenAICompatible`（非 `createOpenAI`）
- siliconflow / mimo 作为一等公民注册
- auto-discovery：未知 Provider + baseUrl → 自动按兼容模式处理
- 移除 `custom.needsPromptToolCalling = true` 的保守降级

## 改动文件

- `src/core/provider-registry.ts`

## 验收标准

- [ ] `siliconflow` provider 注册，默认 baseUrl `https://api.siliconflow.cn/v1`，有 detectToolSupport
- [ ] `mimo` provider 注册，默认 baseUrl `https://api.mimo.xiaomi.com/v1`
- [ ] 所有 OpenAI 兼容 Provider（siliconflow, deepseek, mimo, ollama, custom）使用 `createOpenAICompatible`
- [ ] `ProviderFactory.create()` 遇到未知 provider + 有 baseUrl 时自动 fallback 到兼容模式，不报错
- [ ] 未知 provider 无 baseUrl 时给出清晰错误提示
- [ ] `custom` provider 的 `needsPromptToolCalling` 改为 `false`

## 依赖

无（第一步）

## 备注

当前代码已部分完成（加了 siliconflow/mimo 注册），但用的是 `createOpenAI`，需改为 `createOpenAICompatible`。
需要确认 `@ai-sdk/openai-compatible` 包是否已在 package.json 中。
