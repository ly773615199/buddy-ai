# 实施总计划 — 落地 5 个未完成计划

**日期**: 2026-04-26
**状态**: 执行中
**目标**: 将 TOOL_SELECTION / TOOL_SELF_GENERATION / CLOSED_LOOP / KNOWLEDGE_BASE 四个计划的核心能力落地

---

## 一、现状盘点

| 计划 | 行数 | 已实现 | 未实现 | 完成率 |
|------|------|--------|--------|--------|
| TOOL_SELECTION_MASTER_PLAN | 646 | ToolRetriever / ExperienceCompiler / DecisionRecorder | message-processor 工具验证 | 75% |
| TOOL_SELF_GENERATION | 1978 | — | 全部（ToolSynthesizer / TriggerGate / SkillmateBuilder 等） | 0% |
| CLOSED_LOOP_EXECUTION | 867 | ClarificationEngine（基础版） | ExecutionSession / 自主等级 / 步骤间校验 | 15% |
| KNOWLEDGE_BASE_UPGRADE | 1009 | MemoryPanel（展示） | PDF/DOCX 解析 / 中文分词 / 知识源接口 | 5% |
| REFACTOR_SCHEDULER | — | ✅ 全部完成 | — | 100% |

---

## 二、实施策略

**原则**：
- 从已有代码出发，不重写，只补全
- 每个 Sprint 独立可交付，不依赖前一个 Sprint 100% 完成
- 优先做 P0 级别的能力（影响核心流程的）

---

## 三、Sprint 1 — 工具选择加固（3 天）

### 3.1 message-processor 工具验证

**文件**: `src/core/message-processor.ts`

LLM 返回 tool_call 后，验证工具是否存在、参数是否合法：

```typescript
// 在 executeToolCalls 前增加验证
private validateToolCall(call: ToolCall, registry: ToolRegistry): ValidationResult {
  const tool = registry.get(call.name);
  if (!tool) {
    return { valid: false, error: `工具 "${call.name}" 不存在`, suggestRecovery: true };
  }
  // 参数 schema 验证
  try {
    tool.inputSchema.parse(call.args);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `参数不合法: ${e.message}`, suggestRecovery: true };
  }
}
```

**验收**:
- [ ] LLM 返回不存在的工具名时，自动重选（最多 1 次）
- [ ] LLM 返回参数不合法时，自动修复（最多 1 次）
- [ ] 测试覆盖：不存在工具、参数缺失、参数类型错误

### 3.2 ToolRetriever 评分优化

**文件**: `src/tools/tool-retriever.ts`

当前问题：中文分词只有 2-gram，长词匹配差。

改进：
- 引入 `Intl.Segmenter`（Node 22 内置）做中文分词
- 增加工具描述的 TF-IDF 权重
- 增加使用频率衰减因子（最近使用的工具权重更高）

**验收**:
- [ ] 中文查询 "查看文件内容" 能匹配到 `read_file`
- [ ] 英文查询 "check git status" 能匹配到 `git_status`
- [ ] 测试覆盖 10 个常见查询场景

---

## 四、Sprint 2 — 闭环执行基础（4 天）

### 4.1 ExecutionSession

**新增文件**: `src/core/execution-session.ts`

管理一次任务执行的完整生命周期：

```typescript
interface ExecutionSession {
  id: string;
  goal: string;                    // 用户目标
  autonomyLevel: 0 | 1 | 2 | 3;   // 自主等级
  steps: ExecutionStep[];          // 执行步骤
  status: 'planning' | 'executing' | 'paused' | 'done' | 'failed';
  checkpoints: Checkpoint[];       // 校验点
}

interface ExecutionStep {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  success?: boolean;
  verified?: boolean;              // 步骤间校验
}

interface Checkpoint {
  stepIndex: number;
  question: string;                // 向用户确认的问题
  autoVerify?: () => boolean;      // 自动校验函数
}
```

### 4.2 自主等级判定

```typescript
function decideAutonomyLevel(context: {
  taskRisk: 'low' | 'medium' | 'high';
  userHistory: number;             // 用户纠正次数
  sessionLength: number;
}): 0 | 1 | 2 | 3 {
  // L0: 新用户，每步确认
  // L1: 低风险自动，高风险确认
  // L2: 大部分自动，关键节点确认
  // L3: 全自动，事后汇报
}
```

### 4.3 ClarificationEngine 扩展

**文件**: `src/core/clarifier.ts`

当前只检测模糊写操作。扩展：
- 检测理解偏差（用户说 A 做了 B）
- 检测目标冲突（多目标互相矛盾）
- 检测资源不足（缺少权限/信息）

**验收**:
- [ ] 多步骤任务自动创建 ExecutionSession
- [ ] 高风险操作（删除/部署）前自动暂停确认
- [ ] 步骤失败时自动重试或降级
- [ ] 测试覆盖 L0-L3 四个等级

---

## 五、Sprint 3 — 工具自生成（5 天）

### 5.1 经验 → 工具桥接

**新增文件**: `src/core/tool-synthesizer.ts`

从 ExperienceCompiler 的高频经验单元自动生成 .skillmate 工具：

```typescript
class ToolSynthesizer {
  // 1. 触发判断：置信度 > 0.8 且成功次数 > 5
  shouldSynthesize(unit: ExperienceUnit): boolean;

  // 2. 参数泛化：从具体值提取参数
  generalizeParams(unit: ExperienceUnit): ParamTemplate;

  // 3. 命令合成：拼装 .skillmate 定义
  composeSkillmate(template: ParamTemplate): SkillmateDefinition;

  // 4. 质量门：验证生成的工具可执行
  validate(skillmate: SkillmateDefinition): boolean;
}
```

### 5.2 集成到 subsystems

**文件**: `src/core/subsystems.ts`

在经验学习循环中增加工具生成触发：

```typescript
// 经验单元更新后检查是否触发工具生成
experienceEvolver.onUnitUpdated(unit => {
  if (toolSynthesizer.shouldSynthesize(unit)) {
    const skillmate = toolSynthesizer.composeSkillmate(unit);
    skillManager.register(skillmate);
  }
});
```

**验收**:
- [ ] 高频经验单元自动生成 .skillmate 文件
- [ ] 生成的工具自动注册到 ToolRegistry
- [ ] 下次同类任务可直接选用生成的工具
- [ ] 质量门拦截不可执行的工具

---

## 六、Sprint 4 — 知识库增强（4 天）

### 6.1 中文分词改造

**文件**: `src/knowledge/extractor.ts`

用 `Intl.Segmenter`（Node 22 内置，零依赖）替换 `split(/\s+/)`：

```typescript
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
function tokenizeChinese(text: string): string[] {
  return [...segmenter.segment(text)]
    .filter(s => s.isWordLike)
    .map(s => s.segment);
}
```

### 6.2 知识持久化

**问题**: EntityStore / BeliefStore / ReasoningChainStore 纯内存，重启丢失。

**方案**: 复用已有的 STMP 存储，增加 JSON 快照：

```typescript
// 每 5 分钟自动保存
setInterval(() => {
  entityStore.saveToDisk(dataDir);
  beliefStore.saveToDisk(dataDir);
}, 5 * 60 * 1000);
```

### 6.3 PDF 文本提取

**新增文件**: `src/knowledge/pdf-parser.ts`

纯 TS 实现，不依赖外部库：
- 解析 PDF 交叉引用表
- 提取文本流（FlateDecode 解压）
- 支持中英文混排

**验收**:
- [ ] 中文分词准确率 > 90%（对比 `split(/\s+/)` 的 ~30%）
- [ ] 知识重启后不丢失
- [ ] PDF 文档可正确提取文本
- [ ] STMP 房间定位准确率提升

---

## 七、文件变更清单

### Sprint 1
| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/message-processor.ts` | 修改 | 增加工具验证逻辑 |
| `src/tools/tool-retriever.ts` | 修改 | Intl.Segmenter 分词 + 评分优化 |
| `src/core/message-processor.test.ts` | 修改 | 补充验证测试 |

### Sprint 2
| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/execution-session.ts` | 新增 | 执行会话管理 |
| `src/core/clarifier.ts` | 修改 | 扩展澄清判断 |
| `src/core/subsystems.ts` | 修改 | 集成 ExecutionSession |
| `src/core/execution-session.test.ts` | 新增 | 测试 |

### Sprint 3
| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/tool-synthesizer.ts` | 新增 | 经验→工具桥接 |
| `src/core/subsystems.ts` | 修改 | 集成 ToolSynthesizer |
| `src/core/tool-synthesizer.test.ts` | 新增 | 测试 |

### Sprint 4
| 文件 | 操作 | 说明 |
|------|------|------|
| `src/knowledge/extractor.ts` | 修改 | 中文分词改造 |
| `src/knowledge/pdf-parser.ts` | 新增 | PDF 文本提取 |
| `src/memory/entity-store.ts` | 修改 | 增加持久化 |
| `src/memory/belief-store.ts` | 修改 | 增加持久化 |
| `src/knowledge/extractor.test.ts` | 新增 | 测试 |

---

## 八、验收标准

### Sprint 1 完成后
- [ ] LLM 返回不存在的工具名 → 自动拦截并重选
- [ ] LLM 返回参数不合法 → 自动拦截并修复
- [ ] 中文查询工具匹配准确率提升 50%+

### Sprint 2 完成后
- [ ] 多步骤任务有 ExecutionSession 管理
- [ ] 高风险操作前自动确认
- [ ] 步骤失败可重试/降级

### Sprint 3 完成后
- [ ] 高频经验自动生成工具
- [ ] 生成的工具可被 ToolRetriever 检索
- [ ] 工具质量门拦截不可执行的生成结果

### Sprint 4 完成后
- [ ] 中文知识提取准确率 > 90%
- [ ] 知识重启后不丢失
- [ ] PDF 文档可学习

---

## 九、风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| PDF 解析复杂度超预期 | Sprint 4 延期 | 先支持纯文本 PDF，跳过扫描版 |
| 工具生成质量不稳定 | Sprint 3 效果差 | QualityGate 严格拦截，宁缺毋滥 |
| ExecutionSession 侵入性强 | Sprint 2 影响现有流程 | 先做可选模式，不影响默认行为 |
| Intl.Segmenter 性能 | Sprint 1 延迟增加 | 只对工具描述做分词，不做输入分词 |
