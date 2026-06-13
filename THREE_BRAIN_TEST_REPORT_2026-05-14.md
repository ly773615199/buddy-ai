# 三脑决策与执行质量测试报告

> 生成时间: 2026/5/14 12:57:12
> 测试任务数: 9
> WebSocket: ws://localhost:8765

---

## 一、总览

| 指标 | 值 |
|------|-----|
| 总任务数 | 9 |
| 简单任务 | 3 |
| 中等任务 | 3 |
| 困难任务 | 3 |
| 平均延迟 | 21878ms |
| 有 brain_trace | 9/9 |
| 需确认 | 0 |
| 有工具调用 | 3 |

---

## 二、按难度分析

### 🟢 简单任务

| 指标 | 值 |
|------|-----|
| 数量 | 3 |
| 平均延迟 | 9073ms |
| 平均 trace 数 | 3.0 |
| 有工具调用 | 0/3 |

| # | 任务 | 延迟(ms) | Traces | 决策模式 | 路径 | 工具 | 回复摘要 |
|---|------|---------|--------|---------|------|------|---------|
| 1 | 你好，今天天气怎么样？ | 5385 | 3 | single | threeBrain | 0 |  你好！我可以帮你查询天气信息，不过需要告诉我你想查询哪个城市的天气呢？比如北京、上海、广州等等。请... |
| 2 | 1+1等于几？ | 3884 | 3 | single | threeBrain | 0 | 2 |
| 3 | 用一句话介绍你自己 | 17950 | 3 | single | threeBrain | 0 | 我是你的全能数字助手，擅长编程、文档处理、自动化任务和多模态操作，能调用工具读写文件、执行命令、生成... |

### 🟡 中等任务

| 指标 | 值 |
|------|-----|
| 数量 | 3 |
| 平均延迟 | 24784ms |
| 平均 trace 数 | 3.0 |
| 有工具调用 | 2/3 |

| # | 任务 | 延迟(ms) | Traces | 决策模式 | 路径 | 工具 | 回复摘要 |
|---|------|---------|--------|---------|------|------|---------|
| 1 | 查看当前目录有哪些文件 | 52866 | 3 | single | threeBrain | 2 | 当前目录下的文件和子目录如下：  - 📄 `.dockerignore` - 📄 `.env.e... |
| 2 | 帮我查一下今天的日期和时间 | 5192 | 3 | single | threeBrain | 1 | 现在是 2026年5月14日 12:55，中午时分～ |
| 3 | 计算 fibonacci 数列前 10 项 | 16293 | 3 | single | threeBrain | 0 | 不需要工具，直接计算即可。  斐波那契数列前 10 项为：  1, 1, 2, 3, 5, 8, 1... |

### 🔴 困难任务

| 指标 | 值 |
|------|-----|
| 数量 | 3 |
| 平均延迟 | 31778ms |
| 平均 trace 数 | 3.0 |
| 有工具调用 | 1/3 |

| # | 任务 | 延迟(ms) | Traces | 决策模式 | 路径 | 工具 | 回复摘要 |
|---|------|---------|--------|---------|------|------|---------|
| 1 | 分析当前项目的 package.json，列出所有 | 32482 | 3 | single | threeBrain | 1 |  根据对项目 package.json 文件的分析，以下是所有依赖按类别分组的列表：  ## 运行时... |
| 2 | 写一个 Python 脚本，实现快速排序算法，并解 | 55818 | 3 | single | threeBrain | 0 |  我来为您编写一个 Python 快速排序算法实现，并详细解释其时间复杂度。  ```python ... |
| 3 | 对比 React 和 Vue 的优缺点，用表格形式 | 7033 | 3 | single | threeBrain | 0 |   我来为你对比 React 和 Vue 的主要优缺点：  ## React vs Vue 对比表 ... |

## 三、三脑决策详细追踪

### 任务 1: 你好，今天天气怎么样？

| 属性 | 值 |
|------|-----|
| 难度 | easy |
| 延迟 | 5385ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/zai-org/GLM-4.5-Air, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: web_operations (置信度: 0.314)
- 原型匹配: system_operations (距离: 0.908)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** calm (能量:100 满意度:80) → calm (能量:100 满意度:83)

<details><summary>📋 Trace 时间线</summary>

```
[+8ms] signal: {"domains":["writing"],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.5}
[+8ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"seed_get_time","name":"get_time","desc
[+16ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/zai-org/GLM-4.5-Air","exp"],"threeBrainLatencyMs":7.709285
```

</details>

**回复:**
```

你好！我可以帮你查询天气信息，不过需要告诉我你想查询哪个城市的天气呢？比如北京、上海、广州等等。请提供具体的城市名称，我就能为你查询今天的天气情况了。
```

---

### 任务 2: 1+1等于几？

| 属性 | 值 |
|------|-----|
| 难度 | easy |
| 延迟 | 3884ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/THUDM/GLM-4.1V-9B-Thinking, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.246)
- 原型匹配: system_operations (距离: 0.893)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** calm (能量:100 满意度:83) → calm (能量:100 满意度:85)

<details><summary>📋 Trace 时间线</summary>

```
[+4ms] signal: {"domains":[],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.1}
[+4ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"exp_7d121f65","name":"unknown_等于几","de
[+13ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/THUDM/GLM-4.1V-9B-Thinking","exp"],"threeBrainLatencyMs":8
```

</details>

**回复:**
```
2
```

---

### 任务 3: 用一句话介绍你自己

| 属性 | 值 |
|------|-----|
| 难度 | easy |
| 延迟 | 17950ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/Qwen/Qwen3-235B-A22B-Instruct-2507, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.246)
- 原型匹配: system_operations (距离: 0.893)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: 无

**情绪变化:** calm (能量:100 满意度:85) → calm (能量:100 满意度:86)

<details><summary>📋 Trace 时间线</summary>

```
[+5ms] signal: {"domains":[],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.1}
[+5ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":null}
[+13ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/Qwen/Qwen3-235B-A22B-Instruct-2507","exp"],"threeBrainLate
```

</details>

**回复:**
```
我是你的全能数字助手，擅长编程、文档处理、自动化任务和多模态操作，能调用工具读写文件、执行命令、生成图文音视频，帮你高效完成各类任务。
```

---

### 任务 4: 查看当前目录有哪些文件

| 属性 | 值 |
|------|-----|
| 难度 | medium |
| 延迟 | 52866ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/Qwen/Qwen3-8B, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 2 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.290)
- 原型匹配: system_operations (距离: 0.929)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** calm (能量:100 满意度:86) → happy (能量:97 满意度:84)

<details><summary>📋 Trace 时间线</summary>

```
[+9ms] signal: {"domains":["code"],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.9000000000000001}
[+9ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"seed_list_files","name":"list_files","
[+25ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/Qwen/Qwen3-8B","exp"],"threeBrainLatencyMs":15.67219800001
```

</details>

**回复:**
```
当前目录下的文件和子目录如下：

- 📄 `.dockerignore`
- 📄 `.env.example`
- 🌍 `.git` 目录
- 🌍 `.github` 目录
- 📄 `.gitignore`
- 📄 `ADAPTIVE_CONCURRENCY_PLAN.md`
- 📄 `AIOS_RESTORATION_PLAN.md`
- 📄 `ALIVE_DEVELOPMENT_PLAN.md`
- 📄 `ARCHITECTURE.md`
- 📄 `AUTONOMOUS_SPRITE_OPTIMIZATION_PLAN.md`
- 📄 `BRIDGE_UPGRADE_PLAN.md`
- 📄 `BUDDY_CLOCK_PLAN.md`
- 📄 `CHANNEL_EXPANSION_PLAN.md`
- 📄 `CHAOS_TO_CHARACTER_PLAN.md`
- 📄 `CODE_REVIEW_2026-05-12.md`
- 📄 `COLD_START_VALIDATION_FIX_PLAN.md`
- 📄 `COMMUNICATION_UPGRADE_PLAN.md`
- 📄 `DATA_PROCESSING_RECORD.md`
- 📄 `DATA_PROCESSORS.md`
- 📄 `DEPENDENCY_CLEANUP_PLAN.md`
- 📄 `DEPLOY.md`
- 📄 `DEVELOPMENT_MASTER_PLAN.md`
- 📄 `DEVELOPMENT_RESEARCH.md`
- 📄 `DEV_SESSION_2026-04-24.md`
- 📄 `DEV_SESSION_2026-04-27.md`
- 📄 `DOCUMENT_INDEX.md`
- 📄 `DPIA.md`
- 📄 
```

---

### 任务 5: 帮我查一下今天的日期和时间

| 属性 | 值 |
|------|-----|
| 难度 | medium |
| 延迟 | 5192ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/THUDM/GLM-4.1V-9B-Thinking, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 1 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.290)
- 原型匹配: system_operations (距离: 0.908)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** happy (能量:97 满意度:84) → excited (能量:97 满意度:106)

<details><summary>📋 Trace 时间线</summary>

```
[+4ms] signal: {"domains":[],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.1}
[+4ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"seed_get_time","name":"get_time","desc
[+12ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/THUDM/GLM-4.1V-9B-Thinking","exp"],"threeBrainLatencyMs":7
```

</details>

**回复:**
```
现在是 2026年5月14日 12:55，中午时分～
```

---

### 任务 6: 计算 fibonacci 数列前 10 项

| 属性 | 值 |
|------|-----|
| 难度 | medium |
| 延迟 | 16293ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/Qwen/Qwen3-235B-A22B-Instruct-2507, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.298)
- 原型匹配: system_operations (距离: 0.972)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: 无

**情绪变化:** excited (能量:97 满意度:105) → excited (能量:100 满意度:101)

<details><summary>📋 Trace 时间线</summary>

```
[+4ms] signal: {"domains":[],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.1}
[+4ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":null}
[+10ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/Qwen/Qwen3-235B-A22B-Instruct-2507","exp"],"threeBrainLate
```

</details>

**回复:**
```
不需要工具，直接计算即可。

斐波那契数列前 10 项为：

1, 1, 2, 3, 5, 8, 13, 21, 34, 55

**解释**：
斐波那契数列定义为：  
F(1) = 1, F(2) = 1, F(n) = F(n-1) + F(n-2)（n ≥ 3）

逐项计算：
- F(1) = 1
- F(2) = 1
- F(3) = 1 + 1 = 2
- F(4) = 1 + 2 = 3
- F(5) = 2 + 3 = 5
- F(6) = 3 + 5 = 8
- F(7) = 5 + 8 = 13
- F(8) = 8 + 13 = 21
- F(9) = 13 + 21 = 34
- F(10) = 21 + 34 = 55

✅ 前 10 项为：**1, 1, 2, 3, 5, 8, 13, 21, 34, 55**
```

---

### 任务 7: 分析当前项目的 package.json，列出所有依赖并按类别分组（运行时依赖、开发依赖、AI相关依赖）

| 属性 | 值 |
|------|-----|
| 难度 | hard |
| 延迟 | 32482ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/zai-org/GLM-4.5V, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 1 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: conversation (置信度: 0.339)
- 原型匹配: complex_task (距离: 0.929)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** excited (能量:100 满意度:101) → excited (能量:97 满意度:118)

<details><summary>📋 Trace 时间线</summary>

```
[+3ms] signal: {"domains":["code"],"complexity":"medium","taskType":"tools","shouldUseDAG":false,"intentConfidence":0.7}
[+3ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"seed_code_analyze","name":"code_analyz
[+11ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/zai-org/GLM-4.5V","exp"],"threeBrainLatencyMs":7.288733000
```

</details>

**回复:**
```

根据对项目 package.json 文件的分析，以下是所有依赖按类别分组的列表：

## 运行时依赖（dependencies）
| 包名 | 版本 | 说明 |
|------|------|------|
| @ai-sdk/anthropic | ^3.0.71 | AI 相关（Anthropic AI 驱动） |
| @ai-sdk/deepseek | ^2.0.29 | AI 相关（DeepSeek AI 驱动） |
| @ai-sdk/google | ^3.0.64 | AI 相关（Google AI 驱动） |
| @ai-sdk/openai | ^3.0.53 | AI 相关（OpenAI 驱动） |
| @ai-sdk/openai-compatible | ^2.0.41 | AI 相关（OpenAI 兼容 API 驱动） |
| ai | ^6.0.168 | AI 相关（AI 框架核心） |
| better-sqlite3 | ^12.9.0 | 数据库（Better SQLite） |
| glob | ^13.0.6 | 文件路径匹配工具 |
| seedrandom | ^3.0.5 | 伪随机数生成器 |
| stripe | ^22.1.0 | 支付处理（Stripe API） |
| ws | ^8.20.0 | WebSocket 实现 |
| zod | ^3.25.76 | 类型安全验证 |

## 开发依赖（devDependencies）
| 包名 | 版本 | 说明 |
|------|------|------|
| @babel/generator | ^7.29.1 | Babel 代码生成器 |
| @babel/parser | ^7.29.3 | Babel 语法解析器 |
| @babel/trave
```

---

### 任务 8: 写一个 Python 脚本，实现快速排序算法，并解释时间复杂度

| 属性 | 值 |
|------|-----|
| 难度 | hard |
| 延迟 | 55818ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/zai-org/GLM-4.5-Air, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: conversation (置信度: 0.245)
- 原型匹配: complex_task (距离: 0.918)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: [object Object]

**情绪变化:** excited (能量:97 满意度:118) → happy (能量:100 满意度:107)

<details><summary>📋 Trace 时间线</summary>

```
[+3ms] signal: {"domains":["code"],"complexity":"medium","taskType":"tools","shouldUseDAG":false,"intentConfidence":0.5}
[+3ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":{"id":"seed_get_time","name":"get_time","desc
[+12ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/zai-org/GLM-4.5-Air","exp"],"threeBrainLatencyMs":8.355416
```

</details>

**回复:**
```

我来为您编写一个 Python 快速排序算法实现，并详细解释其时间复杂度。

```python
def quick_sort(arr):
    """
    快速排序算法实现
    
    Args:
        arr (list): 待排序的列表
        
    Returns:
        list: 排序后的列表
    """
    # 基线条件：如果列表长度小于等于1，直接返回
    if len(arr) <= 1:
        return arr
    
    # 选择中间元素作为基准值（这里选择列表的第一个元素）
    pivot = arr[0]
    
    # 将小于基准值的元素放在左侧
    left = [x for x in arr[1:] if x <= pivot]
    
    # 将大于基准值的元素放在右侧  
    right = [x for x in arr[1:] if x > pivot]
    
    # 递归调用快速排序，并将结果拼接
    return quick_sort(left) + [pivot] + quick_sort(right)


def quick_sort_inplace(arr, low=0, high=None):
    """
    原地快速排序实现（节省内存空间）
    
    Args:
        arr (list): 待排序的列表
        low (int): 排序起始索引
        high (int): 排序结束索引
    """
    if high is None:
        high = len(arr) - 1
    
    if low < high:
       
```

---

### 任务 9: 对比 React 和 Vue 的优缺点，用表格形式展示

| 属性 | 值 |
|------|-----|
| 难度 | hard |
| 延迟 | 7033ms |
| 决策模式 | single |
| 决策路径 | threeBrain |
| 决策原因 | 低置信度，经验辅助 → router 补全 |
| 使用节点 | siliconflow/Qwen/Qwen3.5-35B-A3B, exp |
| Trace数 | 3 (signal=1 resource=1 decision=1 execution=0 outcome=0) |
| 工具调用 | 0 |
| 需确认 | 否 |

**右脑直觉信号:**
- 意图分类: knowledge_query (置信度: 0.264)
- 原型匹配: conversation (距离: 0.942)

**小脑资源状态:**
- 可用模型数: 102
- 本地覆盖率: N/A
- 本地置信度: N/A
- 经验命中: 无

**情绪变化:** happy (能量:100 满意度:107) → happy (能量:100 满意度:103)

<details><summary>📋 Trace 时间线</summary>

```
[+5ms] signal: {"domains":[],"complexity":"simple","taskType":"chat","shouldUseDAG":false,"intentConfidence":0.1}
[+5ms] resource: {"budgetRemaining":1,"availableNodeCount":102,"localCoverageRatio":0,"localConfidence":0,"experienceHit":null}
[+10ms] decision: {"path":"threeBrain","mode":"single","reason":"低置信度，经验辅助 → router 补全","nodes":["siliconflow/Qwen/Qwen3.5-35B-A3B","exp"],"threeBrainLatencyMs":5.29055
```

</details>

**回复:**
```


我来为你对比 React 和 Vue 的主要优缺点：

## React vs Vue 对比表

| 对比维度 | React | Vue |
|---------|-------|-----|
| **学习曲线** | 较陡峭，需掌握 JSX、Hooks 等概念 | 较平缓，语法接近 HTML/CSS，易于上手 |
| **核心哲学** | 最小化框架，提供灵活选择 | 渐进式框架，提供开箱即用的功能 |
| **性能** | 优秀，虚拟 DOM 优化到位 | 优秀，双向绑定自动优化更新 |
| **灵活性** | 极高，可自由组合各种方案 | 适中，推荐约定优于配置的方式 |
| **响应式系统** | 手动触发更新（useState, setState） | 自动响应式，基于 Proxy 实现 |
| **虚拟 DOM** | 自己的实现 | 基于模板编译优化 |
| **状态管理** | Redux、Context、Zustand 等第三方库 | Vuex、Pinia（官方推荐） |
| **组件通信** | Props、事件、Context、状态管理库 | Props、$emit、provide/inject、状态管理 |
| **JSX** | 使用 JSX 编写模板，更灵活 | 支持 JSX 和模板语法 |
| **TypeScript 支持** | 优秀，但有时需要更多类型定义 | 原生支持良好，类型推导优秀 |
| **生态丰富度** | 非常庞大，社区活跃，库多 | 成熟但相对较小，官方维护质量高 |
| **文档质量** | 社区文档为主，质量参差不齐 | 官方文档优秀，中文友好 |
| **Bundle 体积** | 需要自己打包，基础包较大 | 核心包更小（~20KB gzipped） |
| **企业采用** | 大型企业和初创广泛使用 | 
```

---

## 四、质量评估

### 4.1 决策链路完整性

| 类别 | 数量 | 占比 |
|------|------|------|
| 完整链路 (signal+decision) | 9 | 100% |
| 有决策追踪 | 9 | 100% |
| 无追踪 | 0 | 0% |

### 4.2 决策模式分布

| 模式 | 数量 | 占比 |
|------|------|------|
| single | 9 | 100% |

### 4.3 延迟分布

| 难度 | 平均(ms) | 最小(ms) | 最大(ms) |
|------|---------|---------|--------|
| easy | 9073 | 3884 | 17950 |
| medium | 24784 | 5192 | 52866 |
| hard | 31778 | 7033 | 55818 |

### 4.4 诊断与建议

- ℹ️ 所有任务均使用 single 模式 — DAG 编排和多专家模式未触发
- ✅ 决策链路覆盖率良好

---
*报告由三脑测试自动生成*
