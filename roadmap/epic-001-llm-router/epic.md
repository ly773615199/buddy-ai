# Epic 001: LLM 智能路由器

## 目标

将 Buddy 的 LLM 调用从"单模型硬编码"升级为"智能路由器"，支持：
- 多 Provider 统一接入（硅基流动、OpenAI、DeepSeek、Ollama、MiMo 等）
- 自动任务路由（简单任务用轻量模型，复杂任务用强模型）
- Fallback 链（主模型挂了自动切换）
- 本地微模型融入（三进制专家训练好后自动加入路由）
- 用户可覆盖（per-message / 配置级）
- Buddy 自主学习（根据执行效果调整路由策略）

## 设计原则

1. **零配置也能跑** — 只填 provider + model + apiKey 就能用，其余全是可选
2. **自动优先，手动可覆盖** — 默认 auto 模式，用户随时可插手
3. **有什么用什么** — 不强制要求配置 lightweight 或 fallback
4. **经验驱动** — Buddy 根据实际执行效果调整路由

## 当前状态

已完成部分改动（provider-registry 加了 siliconflow/mimo，types.ts 加了 routing/fallbacks 字段），
但需要按最终设计方案重新整理，确保一致性。

## Task 列表

| # | Task | 状态 | 说明 |
|---|------|------|------|
| 001 | Provider 注册表整理 | ✅ 完成 | siliconflow/mimo 入库 + auto-discovery |
| 002 | 类型定义升级 | ✅ 完成 | provider→string + lightweight + fallbacks |
| 003 | ModelRouter 核心实现 | ✅ 完成 | 决策链 + 任务推断 + 经验学习 |
| 004 | LLMAdapter 集成路由器 | ✅ 完成 | chat/streamChat/structuredOutput 接入路由 + fallback |
| 005 | 本地微模型桥接 | ✅ 完成 | 三进制专家自动注册到路由器 |
| 006 | 用户覆盖机制 | ✅ 完成 | /model 命令 (status/primary/lightweight/local/auto) |
| 007 | Buddy 经验学习 | ✅ 完成 | recordOutcome 持久化到 router-learned.json |
| 008 | 子系统 LLM 调用适配 | ✅ 完成 | background/reasoning 任务类型标记 |
| 009 | 初始化向导更新 | ✅ 完成 | main.ts init 支持 lightweight |
| 010 | 集成测试 | ✅ 完成 | 21 tests 全部通过 |
