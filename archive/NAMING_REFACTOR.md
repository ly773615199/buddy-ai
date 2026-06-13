# Buddy 命名重构方案 — Skill → 经验模型

> 提出时间：2026-04-20
> 背景：项目原始立意是"每个人的经验专业形成的模型"，现有命名 `Skill` 与 OpenClaw Skill / ChatGPT Plugin 等预制能力插件混淆，无法体现核心差异化。

---

## 一、问题

当前代码中 `intelligence/` 模块统一使用 `Skill` 前缀命名：

```
SkillGraph / SkillFunction / SkillRouter / SkillCompiler / SkillEvolver
```

这导致两个问题：

1. **混淆**：让人误以为与 OpenClaw Skill、VS Code Extension、ChatGPT Plugin 是同类东西
2. **低估**：掩盖了系统最核心的价值——从个人使用经验中自动编译、持续进化的个人经验模型

### 本质区别

| | 预制 Skill | Buddy 经验模型 |
|---|---|---|
| 来源 | 开发者预制 | 从对话中自动编译 |
| 变化 | 静态，写好不变 | 动态，每次使用都在进化 |
| 关系 | 各自独立 | 图谱关联，可组合协作 |
| 个性 | 无 | 同一经验，3 种性格模板 |
| 积累 | 不积累 | 用得越多越强，不用淘汰 |
| 归属 | 所有人共用 | 个人专属，因人而异 |

---

## 二、新命名体系

### 2.1 核心概念

| 层级 | 旧命名 | 新命名 | 说明 |
|------|--------|--------|------|
| 系统统称 | 自产智能引擎 | **经验模型引擎** | 整个系统的统称 |
| 图谱 | 技能图谱 SkillGraph | **经验图谱 ExperienceGraph** | 经验单元之间的关联网络 |
| 单元 | 技能函数 SkillFunction | **经验单元 ExperienceUnit** | 一个可执行的经验结晶 |
| 编译 | 技能编译器 SkillCompiler | **经验编译器 ExperienceCompiler** | 对话 → 经验单元 |
| 路由 | 技能路由器 SkillRouter | **经验路由器 ExperienceRouter** | 置信度分级决策 |
| 执行 | 技能执行器 SkillExecutor | **经验执行器 ExperienceExecutor** | 确定性执行经验单元 |
| 进化 | 技能进化器 SkillEvolver | **经验进化器 ExperienceEvolver** | 积累 / 合并 / 淘汰 |

### 2.2 产品层

| 层级 | 旧命名 | 新命名 | 说明 |
|------|--------|--------|------|
| 能力包系统 | SkillPackageManager | **经验包管理器 ExperiencePackageManager** | 打包 / 分享 / 导出 |
| 能力包调度 | SkillScheduler | **经验包调度器 ExperienceScheduler** | 跨 Buddy 复用 |
| 质量评估 | SkillEvaluator | **经验包评估器 ExperienceEvaluator** | LLM-as-Judge 质量评估 |
| 导出格式 | .skillmate | **.expack** | 经验包文件格式 |

### 2.3 数据结构重命名

```typescript
// 旧
interface SkillFunction { ... }
interface SkillGraph { ... }
interface RouteDecision { path: 'skill_direct' | 'skill_verified' | 'llm_with_hint' }

// 新
interface ExperienceUnit { ... }
interface ExperienceGraph { ... }
interface RouteDecision { path: 'exp_direct' | 'exp_verified' | 'llm_with_hint' }
```

---

## 三、代码影响清单

### 3.1 文件重命名

| 旧路径 | 新路径 |
|--------|--------|
| `src/intelligence/skill-graph.ts` | `src/intelligence/experience-graph.ts` |
| `src/intelligence/compiler.ts` | `src/intelligence/experience-compiler.ts` |
| `src/intelligence/router.ts` | `src/intelligence/experience-router.ts` |
| `src/intelligence/executor.ts` | `src/intelligence/experience-executor.ts` |
| `src/intelligence/evolver.ts` | `src/intelligence/experience-evolver.ts` |

> 注：`skills/` 目录（能力包系统）重命名为 `experience-packs/` 或保留为上层产品模块

### 3.2 类型重命名

| 旧 | 新 |
|---|---|
| `SkillFunction` | `ExperienceUnit` |
| `SkillGraph` | `ExperienceGraph` |
| `SkillRouter` | `ExperienceRouter` |
| `SkillCompiler` | `ExperienceCompiler` |
| `SkillExecutor` | `ExperienceExecutor` |
| `SkillEvolver` | `ExperienceEvolver` |
| `SkillPackageManager` | `ExperiencePackageManager` |
| `SkillScheduler` | `ExperienceScheduler` |
| `SkillEvaluator` | `ExperienceEvaluator` |

### 3.3 字段/属性重命名

| 旧 | 新 | 说明 |
|---|---|---|
| `skill.id` | `expUnit.id` | 经验单元 ID |
| `skill.name` | `expUnit.name` | 经验单元名称 |
| `skill.trigger` | `expUnit.trigger` | 触发条件 |
| `skill.steps` | `expUnit.steps` | 执行步骤 |
| `skill.stats.confidence` | `expUnit.stats.confidence` | 置信度 |
| `skillGraph.match()` | `experienceGraph.match()` | 图谱匹配 |
| `skillGraph.addSkill()` | `experienceGraph.addUnit()` | 添加经验单元 |

### 3.4 API / 事件重命名

| 旧 | 新 |
|---|---|
| `skill_compiled` 事件 | `experience_compiled` 事件 |
| `skill_executed` 事件 | `experience_executed` 事件 |
| `skill_evolved` 事件 | `experience_evolved` 事件 |
| `/api/skills` | `/api/experiences` |

### 3.5 文档影响

| 文件 | 影响范围 |
|------|---------|
| `README.md` | 功能描述、章节标题 |
| `PLAN_V2.md` | 第二十章全文（~250 行） |
| `ARCHITECTURE.md` | 模块地图 |
| `PROJECT_ANALYSIS.md` | 模块代码分布表 |
| `DOCUMENT_INDEX.md` | 文档引用 |
| `DEVELOPMENT_PLAN_INTEGRATION.md` | Evolver 整合相关描述 |
| `CODE_REVIEW.md` | 相关条目 |

---

## 四、产品叙事更新

### 旧叙事
> "Buddy 有自产智能引擎，能从对话中编译技能，通过技能图谱实现零 LLM 调用。"

### 新叙事
> "Buddy 有经验模型，能从你的使用中积累经验，形成个人专属的经验包。养成越久，经验模型越成熟，需要调用大模型的次数越少。每个 Buddy 的经验模型都不同，因为每个主人的经验不同。"

### Slogan 方向
> **"你用得越多，它越懂你。"**
> **"不是装的能力，是长出来的经验。"**

---

## 五、执行计划

### Phase 1：文档同步（本次）
- [x] 生成本方案文档
- [ ] 更新 README.md 相关描述
- [ ] 更新 PLAN_V2.md 第二十章标题和核心术语

### Phase 2：代码重命名（后续）
- [ ] 类型重命名（ExperienceUnit / ExperienceGraph 等）
- [ ] 文件重命名（intelligence/ 目录下）
- [ ] 导入路径更新
- [ ] 测试用例更新
- [ ] 全量测试通过验证

### Phase 3：产品层（后续）
- [ ] .skillmate → .expack 格式迁移
- [ ] 前端 UI 文案更新
- [ ] API 路由更新

> **注意**：代码重命名是破坏性变更，需在独立分支执行，全量测试通过后合并。

---

## 六、决策记录

| 项目 | 决策 |
|------|------|
| 核心概念 | 经验模型 (Experience Model) |
| 原子单元 | 经验单元 (Experience Unit) |
| 打包格式 | 经验包 (Experience Pack) |
| 文件扩展名 | .expack |
| 模块目录 | `src/experience/` (替代 `src/intelligence/`) |
| 系统统称 | 经验模型引擎 (Experience Model Engine) |

---

*文档版本：v1.0*
*最后更新：2026-04-20*
