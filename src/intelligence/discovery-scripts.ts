/**
 * 引导话术库 — 每个功能的引导话术 + 触发条件
 *
 * 设计原则：
 * - 话术要像朋友聊天，不像系统提示
 * - 每个功能有 introduction（首次介绍）、hint（轻提示）、demonstration（展示话术）
 * - 触发条件基于用户行为，不靠随机
 */

import type { IntimacyStageName } from '../types.js';

export interface DiscoveryScript {
  capabilityId: string;
  stage: IntimacyStageName;
  /** 首次介绍（Buddy 主动说） */
  introduction: string;
  /** 轻提示（嵌入对话中） */
  hint: string;
  /** 展示话术（Buddy 做动作时说） */
  demonstration?: string;
  /** 触发关键词 */
  triggers: string[];
  /** 前置能力 */
  requires?: string[];
}

export const DISCOVERY_SCRIPTS: DiscoveryScript[] = [
  // ── 相识阶段 ──
  {
    capabilityId: 'read_file',
    stage: '相识',
    introduction: '我可以帮你直接看文件内容，把路径给我就行。',
    hint: '要不要我帮你看一下这个文件？',
    demonstration: '让我读一下这个文件给你看。',
    triggers: ['文件', '代码', '看看', '打开', '读取', 'file'],
    requires: ['chat'],
  },
  {
    capabilityId: 'list_files',
    stage: '相识',
    introduction: '我可以帮你看看目录下有什么文件。',
    hint: '要不要我列一下当前目录？',
    demonstration: '我来看看这个目录。',
    triggers: ['目录', '文件夹', '有什么', 'dir', 'ls'],
    requires: ['chat'],
  },
  {
    capabilityId: 'search_files',
    stage: '相识',
    introduction: '我可以在文件里搜索内容，找代码、找配置都行。',
    hint: '要不要我帮你搜一下？',
    demonstration: '我搜一下看看。',
    triggers: ['搜索', '搜', '查找', '找一下', 'search', 'grep'],
    requires: ['list_files'],
  },
  {
    capabilityId: 'git_status',
    stage: '相识',
    introduction: '我帮你看下 Git 状态？还能看 diff 和历史。',
    hint: 'Git 有什么变化？我帮你看。',
    demonstration: '让我看看仓库状态。',
    triggers: ['git', '提交', 'commit', '仓库', '版本'],
    requires: ['chat'],
  },
  {
    capabilityId: 'git_diff',
    stage: '相识',
    introduction: '我可以帮你看看代码有什么改动。',
    hint: '要不要看看 diff？',
    demonstration: '让我看看变更内容。',
    triggers: ['改动', '变更', 'diff', '修改了什么'],
    requires: ['git_status'],
  },
  {
    capabilityId: 'git_log',
    stage: '相识',
    introduction: '我可以查看 Git 提交历史。',
    hint: '要不要看看最近的提交记录？',
    demonstration: '让我看看历史记录。',
    triggers: ['历史', '记录', 'log', '之前'],
    requires: ['git_status'],
  },
  {
    capabilityId: 'search_web',
    stage: '相识',
    introduction: '我帮你搜一下？我还能直接看网页内容。',
    hint: '这个问题我搜一下可能更快。',
    demonstration: '我搜搜看。',
    triggers: ['怎么', '是什么', '为什么', '搜一下', '查一下'],
    requires: ['chat'],
  },
  {
    capabilityId: 'fetch_url',
    stage: '相识',
    introduction: '我帮你看看这个链接的内容？',
    hint: '要不要我把这个网页抓下来看看？',
    demonstration: '我抓一下这个页面。',
    triggers: ['链接', '网页', 'url', 'http'],
    requires: ['search_web'],
  },

  // ── 相知阶段 ──
  {
    capabilityId: 'write_file',
    stage: '相知',
    introduction: '我可以帮你创建或修改文件，不过会先给你确认。',
    hint: '要不要我帮你写这个文件？',
    demonstration: '我来写，你确认一下。',
    triggers: ['帮我改', '帮我写', '创建文件', '修改'],
    requires: ['read_file'],
  },
  {
    capabilityId: 'exec',
    stage: '相知',
    introduction: '我可以帮你跑命令，会先问你确认。',
    hint: '这个命令我可以帮你跑。',
    demonstration: '我来跑一下。',
    triggers: ['运行', '跑一下', '执行', '测试', '构建', 'run'],
    requires: ['chat'],
  },
  {
    capabilityId: 'analyze_file',
    stage: '相知',
    introduction: '我可以帮你分析代码结构，看看有什么问题。',
    hint: '要不要我分析一下这段代码？',
    demonstration: '我来分析看看。',
    triggers: ['分析', '看看代码', 'review', 'analyze'],
    requires: ['read_file'],
  },
  {
    capabilityId: 'scan_project',
    stage: '相知',
    introduction: '我可以帮你扫描整个项目结构。',
    hint: '要不要我看看这个项目的整体结构？',
    demonstration: '我来扫一下项目。',
    triggers: ['项目结构', '整体', '架构', 'scan'],
    requires: ['list_files'],
  },
  {
    capabilityId: 'buddy_learn',
    stage: '相知',
    introduction: '你可以教我新知识，我会记住的。',
    hint: '有什么想让我记住的吗？',
    triggers: ['记住', '教', '学习', 'learn'],
  },

  // ── 相伴阶段 ──
  {
    capabilityId: 'stmp_retrieve',
    stage: '相伴',
    introduction: '我有记忆宫殿了，可以回忆以前聊过的东西。',
    hint: '你还记得之前说的吗？我帮你回忆一下。',
    demonstration: '让我想想...',
    triggers: ['记得', '之前', '上次', '回忆'],
  },
  {
    capabilityId: 'dream_consolidate',
    stage: '相伴',
    introduction: '我会做梦了——空闲时自动整理记忆，发现知识之间的联系。',
    hint: '让我整理一下最近学到的东西。',
    triggers: ['做梦', '整理', 'dream'],
  },
  {
    capabilityId: 'knowledge_extract',
    stage: '相伴',
    introduction: '我会从对话中自动提取专业知识，越聊越聪明。',
    hint: '我注意到你在讲专业知识，我会记住的。',
    triggers: ['知识', '提取', '学习'],
  },
  {
    capabilityId: 'experience_compile',
    stage: '相伴',
    introduction: '我会把重复做的事编译成经验，下次更快。',
    hint: '这个操作你经常做，我帮你记下来。',
    triggers: ['经验', '编译', '重复'],
  },

  // ── 感知能力（单独告知） ──
  {
    capabilityId: 'camera',
    stage: '相伴',
    introduction: '我可以通过摄像头看看你周围的世界。画面只在内存中处理，不会存储。需要你同意才能开启。',
    hint: '要不要我看看你那边？',
    triggers: ['摄像头', '看看', 'camera'],
  },
  {
    capabilityId: 'microphone',
    stage: '相伴',
    introduction: '我可以通过麦克风听到你的声音。音频只在识别时使用，不会录音。',
    hint: '想试试语音对话吗？',
    triggers: ['麦克风', '语音', '说话', 'microphone'],
  },
  {
    capabilityId: 'location',
    stage: '相识',
    introduction: '我可以感知你的位置来提供更相关的帮助。',
    hint: '你在哪？我可以提供更本地化的建议。',
    triggers: ['位置', '在哪', 'location'],
  },

  // ── 灵犀阶段 ──
  {
    capabilityId: 'package_create',
    stage: '灵犀',
    introduction: '我们的经验积累够多了，可以打包成能力包分享给别人。',
    hint: '要不要创建一个能力包？',
    triggers: ['打包', '分享', '能力包', 'package'],
  },
  {
    capabilityId: 'package_share',
    stage: '灵犀',
    introduction: '你的好友也可以用我们的能力包。',
    hint: '要不要分享给朋友？',
    triggers: ['分享', '好友', 'share'],
  },
];

/** 获取指定能力的引导话术 */
export function getDiscoveryScript(capabilityId: string): DiscoveryScript | undefined {
  return DISCOVERY_SCRIPTS.find(s => s.capabilityId === capabilityId);
}

/** 获取指定阶段的所有引导话术 */
export function getScriptsByStage(stage: IntimacyStageName): DiscoveryScript[] {
  return DISCOVERY_SCRIPTS.filter(s => s.stage === stage);
}
