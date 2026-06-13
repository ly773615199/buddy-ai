# Task 002: 类型定义升级

## 目标

`types.ts` 中 `BuddyConfig.llm` 结构支持新架构所需的全部字段。

## 改动文件

- `src/types.ts`

## 最终结构

```typescript
llm: {
  // ── 主模型（必填）──
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  // 生成参数
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];

  // ── 轻量模型（可选）──
  // 填了就自动用于简单任务，不填全走主模型
  // apiKey/baseUrl 不填则继承主模型
  lightweight?: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };

  // ── Fallback 链（可选）──
  // 主模型不可用时按顺序尝试
  fallbacks?: Array<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }>;

  // ── 路由模式 ──
  // 'auto' = 系统自动选模型（默认）
  // 'manual' = 按 preferences 指定，未指定的走 primary
  routingMode?: 'auto' | 'manual';

  // ── 用户偏好（routingMode: 'manual' 时生效）──
  // key = 任务类型，value = 'primary' | 'lightweight' | 'local/<domain>' | '<provider>/<model>'
  preferences?: Record<string, string>;
}
```

## 验收标准

- [ ] `BuddyConfig.llm` 包含 `lightweight`、`fallbacks`、`routingMode`、`preferences` 字段
- [ ] 所有新字段都是 optional，不填时行为与旧版完全一致
- [ ] `DEFAULT_CONFIG` 中 `llm` 只有原有的必填字段，新字段不填（保持零配置可用）
- [ ] 现有代码（agent.ts、message-processor.ts 等）不因类型变更而报错

## 依赖

- Task 001

## 备注

当前已部分完成（加了 routing 和 fallbacks 字段），需要按最终设计重新整理字段名和结构。
之前加的 `routing.chat/reasoning/tools/background` 结构过于复杂，改为 `lightweight` + `preferences` 的简洁方案。
