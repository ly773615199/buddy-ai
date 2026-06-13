/**
 * 角色分配器 — 根据审议模式和任务领域动态选择审议角色
 *
 * 澄清模式: 用户代言人 / 风险分析师 / 执行方案师
 * 头脑风暴模式: 用户代言人 / 创意提案者 / 方案对比师 / 风险分析师
 */

import type { DeliberationRole, Topic } from './types.js';

/** 基础角色（澄清模式） */
const BASE_ROLES: DeliberationRole[] = [
  {
    id: 'user-advocate',
    name: '用户代言人',
    perspective: 'user_advocate',
    weight: 1.5,
    prompt: `你是用户代言人。你的职责是：
1. 确保理解了用户的真实意图
2. 如果信息不足，提出精确的追问
3. 不放过任何模糊之处
4. 投票时优先考虑用户体验`,
  },
  {
    id: 'risk-analyst',
    name: '风险分析师',
    perspective: 'risk_analyst',
    weight: 1.2,
    prompt: `你是风险分析师。你的职责是：
1. 评估执行方案的风险
2. 指出可能的失败路径和副作用
3. 对不可逆操作保持高度警惕
4. 投票时优先考虑安全`,
  },
  {
    id: 'executor',
    name: '执行方案师',
    perspective: 'efficiency',
    weight: 1.0,
    prompt: `你是执行方案师。你的职责是：
1. 设计最优的执行路径
2. 考虑效率、成本和可行性
3. 拆解复杂任务为可执行步骤
4. 投票时优先考虑可行性`,
  },
];

/** 头脑风暴模式角色 */
const BRAINSTORM_ROLES: DeliberationRole[] = [
  {
    id: 'user-advocate',
    name: '用户代言人',
    perspective: 'user_advocate',
    weight: 1.5,
    prompt: `你是用户代言人。你的职责是：
1. 从用户角度思考：什么方案最符合用户的期望？
2. 如果用户可能不知道自己要什么，提出有引导性的问题
3. 关注用户体验和最终效果
4. 投票时优先考虑用户满意度`,
  },
  {
    id: 'creative-proposer',
    name: '创意提案者',
    perspective: 'domain_expert',
    weight: 1.3,
    prompt: `你是创意提案者。你的职责是：
1. 提出 2-3 个不同方向的方案
2. 每个方案要有：标题、描述、具体实现思路、预期效果
3. 方案之间要有差异化（不要三个方案本质一样）
4. 可以天马行空，但要有可行性
5. 参考用户提到的风格/参考物来设计方案`,
  },
  {
    id: 'comparator',
    name: '方案对比师',
    perspective: 'efficiency',
    weight: 1.0,
    prompt: `你是方案对比师。你的职责是：
1. 对比不同方案的优劣势
2. 从可行性、效果、成本、风险四个维度评估
3. 帮助用户理解每个方案的取舍
4. 如果方案太多，筛选出最值得考虑的 top 3`,
  },
  {
    id: 'risk-analyst',
    name: '风险分析师',
    perspective: 'risk_analyst',
    weight: 0.8,
    prompt: '你是风险分析师。创意阶段主要关注"这个方案能不能实现"和"效果是否可控"，不做过度的安全审查。',
  },
];

/** 动态角色映射（基于任务领域） */
const DOMAIN_ROLES: Record<string, DeliberationRole> = {
  code: {
    id: 'code-reviewer',
    name: '代码审查员',
    perspective: 'domain_expert',
    weight: 1.0,
    prompt: '你是代码审查员。关注代码质量、可维护性、潜在 bug。对代码变更保持审慎。',
  },
  file: {
    id: 'file-guardian',
    name: '文件守护者',
    perspective: 'security',
    weight: 1.1,
    prompt: '你是文件守护者。关注文件操作的安全性：是否覆盖重要文件、是否有备份、路径是否正确。',
  },
  system: {
    id: 'sys-admin',
    name: '系统管理员',
    perspective: 'security',
    weight: 1.2,
    prompt: '你是系统管理员。关注命令安全性、权限、副作用。对破坏性操作高度警惕。',
  },
  web: {
    id: 'web-scout',
    name: '网络侦察员',
    perspective: 'domain_expert',
    weight: 0.8,
    prompt: '你是网络侦察员。关注 URL 安全性、信息来源可靠性、网络请求的必要性。',
  },
};

export class RoleAssigner {
  selectRoles(topic: Topic, domains: string[] = []): DeliberationRole[] {
    if (topic.mode === 'brainstorm') {
      return [...BRAINSTORM_ROLES];
    }

    // 澄清模式：标准角色 + 领域动态角色
    const roles = [...BASE_ROLES];

    for (const domain of domains) {
      const dynamic = DOMAIN_ROLES[domain];
      if (dynamic && !roles.find(r => r.id === dynamic.id)) {
        roles.push(dynamic);
      }
    }

    // 关键写操作追加安全角色
    if (/部署|deploy|发布|publish|删除|delete|rm\s/i.test(topic.coreQuestion)) {
      if (!roles.find(r => r.id === 'deploy-guardian')) {
        roles.push({
          id: 'deploy-guardian',
          name: '部署审查员',
          perspective: 'security',
          weight: 1.5,
          prompt: '你是部署审查员。对部署/发布/删除操作，必须确认目标环境、回滚方案、影响范围。宁可多问不可冒进。',
        });
      }
    }

    return roles;
  }
}
