# Task 008: 子系统 LLM 调用适配

## 目标

所有通过 `setLLMCaller()` 注入 LLM 的子系统，自动走 lightweight 模型（后台任务不需要强模型）。

## 改动文件

- `src/core/subsystems.ts`（修改 LLMCaller 注入逻辑）

## 设计

### 现状

```typescript
// 当前：所有子系统共享同一个 LLMAdapter.chat()
const callLLMMessages = async (msgs) => {
  const result = await this.llm.chat(messages, [], 1);
  return result.text;
};
```

### 改造

```typescript
// 改造后：子系统调用带 taskType 标记
const callLLMMessages = async (msgs) => {
  const result = await this.llm.chat(messages, [], 1, { taskType: 'background' });
  return result.text;
};

// 有些子系统需要强模型（如 DAG 规划）
const callLLMForPlanning = async (msgs) => {
  const result = await this.llm.chat(messages, [], 1, { taskType: 'reasoning' });
  return result.text;
};
```

### 各子系统任务类型

| 子系统 | taskType | 理由 |
|--------|----------|------|
| STMP 记忆叙述 | `background` | 文本生成，不需要强模型 |
| 梦境巩固 | `background` | 后台整理，轻量即可 |
| 知识提取 | `background` | 信息抽取，7B 够用 |
| 经验编译增强 | `background` | 辅助理解，轻量即可 |
| 主动提问生成 | `background` | 生成问题，轻量即可 |
| 数据扩增 | `background` | 后台任务 |
| DAG 任务规划 | `reasoning` | 需要理解复杂意图 |
| 意图分类 | `tools` | 结构化输出，需要稳定 |

## 验收标准

- [ ] 所有 `setLLMCaller()` 注入的调用带 `taskType: 'background'`
- [ ] DAG 规划调用带 `taskType: 'reasoning'`
- [ ] 未配置 lightweight 时，行为与改造前完全一致
- [ ] 配置了 lightweight 后，后台任务自动走轻量模型
- [ ] 子系统调用失败时，fallback 机制正常工作

## 依赖

- Task 004（LLMAdapter 支持 taskType 参数）

## 备注

改动量很小，只改 Subsystems 构造函数中的 lambda 定义。不影响子系统本身的逻辑。
