# Task 009: 初始化向导更新

## 目标

`buddy init` 命令支持配置 lightweight 模型和 fallback。

## 改动文件

- `src/main.ts`

## 设计

### 新增步骤

```
🦊 Buddy 初始化向导
...
  LLM 配置:
    1. 硅基流动 (推荐，有免费额度) 🆓
    2. DeepSeek (性价比高)
    3. OpenAI (GPT-4o)
    4. Ollama (本地，无需 Key)
    5. 小米 MiMo
    6. 自定义 (其他 OpenAI 兼容 API)

    选择 [1-6, 默认1]: 1
    → 硅基流动
    Model [Qwen/Qwen2.5-7B-Instruct]: 
    API Key: sk-xxx
    ✅ 连接成功！

  ── 轻量模型（可选，用于闲聊和后台任务）──
  是否配置轻量模型？[y/N]: y
    1. 同平台小模型 (Qwen/Qwen2.5-7B-Instruct) 🆓
    2. 本地 Ollama
    3. 手动指定
    选择 [1-3, 跳过]: 1
    ✅ 轻量模型已配置

  ── Fallback（可选，主模型挂了时自动切换）──
  是否配置 fallback？[y/N]: n
```

### 配置输出

```json
{
  "llm": {
    "provider": "siliconflow",
    "model": "Qwen/Qwen2.5-72B-Instruct",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "lightweight": {
      "provider": "siliconflow",
      "model": "Qwen/Qwen2.5-7B-Instruct"
    }
  }
}
```

## 验收标准

- [ ] init 向导新增"轻量模型"配置步骤（可跳过）
- [ ] init 向导新增"Fallback"配置步骤（可跳过）
- [ ] 跳过时配置文件不包含 lightweight/fallbacks 字段
- [ ] 选择了 siliconflow 时，默认推荐免费小模型做 lightweight
- [ ] 配置文件输出与 types.ts 定义一致
- [ ] 连接测试覆盖 primary + lightweight

## 依赖

- Task 002（类型定义）
- Task 001（Provider 注册表）

## 备注

改动集中在 main.ts 的 initConfig() 函数。保持可选，跳过不影响使用。
