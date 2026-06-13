/**
 * 经验图谱种子数据 — 冷启动引导
 *
 * 首次运行时导入 15 个高频场景的种子经验，
 * 让经验图谱从"空白"变为"有基础"，
 * 高频请求可以走 exp_direct 路径而非全部走 LLM。
 *
 * 种子经验的置信度设为 0.5（中等），成功后会快速提升。
 */

import type { ExperienceUnit } from './types.js';

/**
 * 生成种子经验列表
 */
export function createSeedExperiences(): ExperienceUnit[] {
  const now = Date.now();

  return [
    // ── Git 操作 ──
    {
      id: 'seed_git_status',
      name: 'git_status',
      description: '查看 Git 仓库状态',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'git_status',
        keywords: ['git', 'status', '状态', '提交', 'commit'],
        contextTags: ['Git'],
        patterns: ['\\bgit\\s+status\\b', '查看.*状态'],
      },
      steps: [
        { tool: 'exec', args: { command: 'git status' }, description: 'git status' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '当前仓库状态：\n{_step_0}', chaotic: '看看仓库！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 5, failCount: 0, confidence: 0.6, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
    {
      id: 'seed_git_diff',
      name: 'git_diff',
      description: '查看 Git 变更',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'git_diff',
        keywords: ['git', 'diff', '改动', '变更', '修改了什么', 'changes'],
        contextTags: ['Git'],
        patterns: ['\\bgit\\s+diff\\b', '看.*改动', '什么.*变更'],
      },
      steps: [
        { tool: 'exec', args: { command: 'git diff' }, description: 'git diff' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '以下是变更内容：\n{_step_0}', chaotic: '改动来了！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 300, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
    {
      id: 'seed_git_log',
      name: 'git_log',
      description: '查看 Git 提交历史',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'git_status',
        keywords: ['git', 'log', '历史', '提交记录', 'history'],
        contextTags: ['Git'],
        patterns: ['\\bgit\\s+log\\b', '提交.*历史', '提交.*记录'],
      },
      steps: [
        { tool: 'exec', args: { command: 'git log --oneline -10' }, description: 'git log --oneline -10' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '最近的提交记录：\n{_step_0}', chaotic: '历史回放！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 文件操作 ──
    {
      id: 'seed_file_read',
      name: 'file_read',
      description: '读取文件内容',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'file_read',
        keywords: ['读', '看', '打开', '查看', 'read', 'show', 'cat', '内容'],
        contextTags: [],
        patterns: ['看.*文件', '读取.*内容', '打开.*文件'],
      },
      steps: [
        { tool: 'read', args: { file_path: '${filePath}' }, description: '读取文件' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '文件内容：\n{_step_0}', chaotic: '给你！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 8, failCount: 0, confidence: 0.65, avgExecutionMs: 100, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
    {
      id: 'seed_list_files',
      name: 'list_files',
      description: '列出目录文件',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'list_files',
        keywords: ['目录', '文件', 'ls', '列表', 'list', 'dir', '有什么'],
        contextTags: [],
        patterns: ['\\bls\\b', '列出.*文件', '有什么.*文件', '目录.*内容'],
      },
      steps: [
        { tool: 'exec', args: { command: 'ls -la' }, description: 'ls -la' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '目录内容：\n{_step_0}', chaotic: '看看有啥！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 6, failCount: 0, confidence: 0.6, avgExecutionMs: 150, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
    {
      id: 'seed_file_search',
      name: 'file_search',
      description: '在文件中搜索文本',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'file_search',
        keywords: ['搜', '找', '查找', 'grep', 'search', 'find', '搜索'],
        contextTags: [],
        patterns: ['\\bgrep\\b', '\\bfind\\b', '搜索.*文件', '查找.*内容'],
      },
      steps: [
        { tool: 'exec', args: { command: '${searchCommand}' }, description: '搜索文件' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '搜索结果：\n{_step_0}', chaotic: '找到了！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 4, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 命令执行 ──
    {
      id: 'seed_exec_command',
      name: 'exec_command',
      description: '执行 Shell 命令',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'exec',
        keywords: ['运行', '执行', '跑', 'run', 'exec', '测试', 'test', 'build'],
        contextTags: [],
        patterns: ['运行.*命令', '执行.*脚本', '\\brun\\b'],
      },
      steps: [
        { tool: 'exec', args: { command: '${cmd}' }, description: '执行命令' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '执行结果：\n{_step_0}', chaotic: '跑起来了！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 5, failCount: 1, confidence: 0.5, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 时间查询 ──
    {
      id: 'seed_get_time',
      name: 'get_time',
      description: '获取当前时间',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'get_time',
        keywords: ['时间', '几点', '日期', 'time', 'date', '今天'],
        contextTags: [],
        patterns: ['几点了', '现在.*时间', '今天.*日期', 'what.*time'],
      },
      steps: [
        { tool: 'exec', args: { command: 'date' }, description: '获取时间' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '现在是：{_step_0}', chaotic: '⏰ {_step_0}', default: '{_step_0}' },
      stats: { successCount: 10, failCount: 0, confidence: 0.7, avgExecutionMs: 50, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── Web 操作 ──
    {
      id: 'seed_search_web',
      name: 'search_web',
      description: '搜索网页',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'search_web',
        keywords: ['搜', '查', '百度', 'google', 'search', '搜索', '搜一下'],
        contextTags: [],
        patterns: ['搜索.*一下', '帮我查', 'google.*搜'],
      },
      steps: [
        { tool: 'web_search', args: { query: '${query}' }, description: '搜索网页' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '搜索结果：\n{_step_0}', chaotic: '网上说：\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 4, failCount: 0, confidence: 0.55, avgExecutionMs: 1500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
    {
      id: 'seed_fetch_url',
      name: 'fetch_url',
      description: '抓取网页内容',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'fetch_url',
        keywords: ['打开', '访问', '抓取', 'fetch', 'url', '网页'],
        contextTags: [],
        patterns: ['https?://', '打开.*网页', '抓取.*页面'],
      },
      steps: [
        { tool: 'web_fetch', args: { url: '${url}' }, description: '抓取网页' },
      ],
      replyTemplate: { sharp: '{_step_0}', warm: '网页内容：\n{_step_0}', chaotic: '抓到了！\n{_step_0}', default: '{_step_0}' },
      stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 代码分析 ──
    {
      id: 'seed_code_analyze',
      name: 'code_analyze',
      description: '分析代码结构',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'code_analyze',
        keywords: ['分析', '结构', '看看', 'analyze', '什么框架', '用了什么', '代码分析'],
        contextTags: [],
        patterns: ['分析.*代码', '看看.*结构', '用了.*什么'],
      },
      steps: [
        { tool: 'exec', args: { command: 'find . -name "package.json" -maxdepth 2 -not -path "*/node_modules/*" | head -5' }, description: '查找项目配置' },
        { tool: 'read', args: { file_path: '${output}' }, description: '读取配置' },
      ],
      replyTemplate: { sharp: '{_step_1}', warm: '项目分析：\n{_step_1}', chaotic: '解剖时间！\n{_step_1}', default: '{_step_1}' },
      stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 800, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 错误修复 ──
    {
      id: 'seed_error_fix',
      name: 'error_fix',
      description: '分析和修复错误',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'error_fix',
        keywords: ['报错', 'error', 'bug', '问题', 'fix', '修复', '解决', '挂了', '出错'],
        contextTags: ['错误'],
        patterns: ['报错了', '出.*错', '怎么.*修复', '\\berror\\b.*怎么'],
      },
      steps: [
        { tool: 'read', args: { file_path: '${errorFile}' }, description: '查看错误文件' },
        { tool: 'exec', args: { command: '${fixCommand}' }, description: '执行修复' },
      ],
      replyTemplate: { sharp: '{_step_1}', warm: '已尝试修复：\n{_step_1}', chaotic: '修好了！\n{_step_1}', default: '{_step_1}' },
      stats: { successCount: 2, failCount: 1, confidence: 0.45, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 文件写入 ──
    {
      id: 'seed_file_write',
      name: 'file_write',
      description: '创建或写入文件',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'file_write',
        keywords: ['写', '创建', '新建', '保存', 'write', 'create', 'save'],
        contextTags: [],
        patterns: ['创建.*文件', '写入.*文件', '保存.*到'],
      },
      steps: [
        { tool: 'write', args: { file_path: '${filePath}', content: '${content}' }, description: '写入文件' },
      ],
      replyTemplate: { sharp: '已写入 ${filePath}', warm: '文件已创建：${filePath}', chaotic: '搞定！${filePath} 📄', default: '已写入 ${filePath}' },
      stats: { successCount: 4, failCount: 0, confidence: 0.55, avgExecutionMs: 100, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 文件编辑 ──
    {
      id: 'seed_file_edit',
      name: 'file_edit',
      description: '编辑文件内容',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'file_write',
        keywords: ['编辑', '修改', '替换', 'edit', 'replace', '改一下'],
        contextTags: [],
        patterns: ['编辑.*文件', '修改.*内容', '替换.*文本'],
      },
      steps: [
        { tool: 'edit', args: { file_path: '${filePath}', old_string: '${oldText}', new_string: '${newText}' }, description: '编辑文件' },
      ],
      replyTemplate: { sharp: '已修改', warm: '文件已更新 ✓', chaotic: '改好了！✨', default: '已修改' },
      stats: { successCount: 3, failCount: 0, confidence: 0.5, avgExecutionMs: 100, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── Phase 1-B3: 检索型种子经验 ──

    // 知识检索型（RAG 模式）
    {
      id: 'seed_knowledge_qa',
      name: 'knowledge_qa',
      description: '知识问答 — 先搜索再总结',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'knowledge_qa',
        keywords: ['是什么', '什么是', '怎么', '为什么', '如何', '原理',
                   'what is', 'why', 'how does', 'explain', '区别', 'difference'],
        contextTags: ['knowledge'],
        patterns: ['什么是.*', '为什么.*', '怎么.*', 'how.*work'],
      },
      steps: [
        { tool: 'search_web', args: { query: '${question}' }, description: '搜索相关资料' },
        { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取详细内容' },
      ],
      replyTemplate: {
        sharp: '{_step_1}',
        warm: '根据搜索结果：\n{_step_1}',
        chaotic: '我查了下，\n{_step_1}',
        default: '{_step_1}',
      },
      stats: { successCount: 5, failCount: 0, confidence: 0.6, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // 错误排查型
    {
      id: 'seed_error_debug',
      name: 'error_debug',
      description: '错误排查 — 搜索解决方案',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'error_debug',
        keywords: ['报错', 'error', 'exception', 'bug', '不工作', '失败',
                   'crash', 'broken', 'fix', 'troubleshoot'],
        contextTags: ['error'],
        patterns: ['报错了', '出.*错', '怎么.*修复', '\\berror\\b'],
      },
      steps: [
        { tool: 'search_web', args: { query: '${error_message} solution fix' }, description: '搜索解决方案' },
        { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取解决方案详情' },
      ],
      replyTemplate: {
        sharp: '{_step_1}',
        warm: '找到解决方案：\n{_step_1}',
        chaotic: 'Stack Overflow 说：\n{_step_1}',
        default: '{_step_1}',
      },
      stats: { successCount: 3, failCount: 1, confidence: 0.5, avgExecutionMs: 2500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // 代码示例查找型
    {
      id: 'seed_code_example',
      name: 'code_example',
      description: '代码示例查找 — 搜索实现参考',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'code_example',
        keywords: ['怎么写', '实现', 'example', '示例', 'sample', 'demo',
                   '代码', 'snippet', '模板', 'template'],
        contextTags: ['code'],
        patterns: ['怎么写.*', '实现.*功能', '.*example.*', '.*示例.*'],
      },
      steps: [
        { tool: 'search_web', args: { query: '${language} ${feature} implementation example code' }, description: '搜索代码示例' },
        { tool: 'fetch_url', args: { url: '${topResult}' }, description: '获取代码详情' },
      ],
      replyTemplate: {
        sharp: '{_step_1}',
        warm: '找到参考实现：\n{_step_1}',
        chaotic: '网上有现成的！\n{_step_1}',
        default: '{_step_1}',
      },
      stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // 文档查找型
    {
      id: 'seed_doc_lookup',
      name: 'doc_lookup',
      description: '文档/API 查找',
      abstractionLevel: 'workflow',
      trigger: {
        intent: 'doc_lookup',
        keywords: ['文档', 'documentation', 'api', '接口', '参数', '用法',
                   'usage', 'reference', 'man page'],
        contextTags: ['docs'],
        patterns: ['.*文档.*', '.*api.*用法', '.*参数.*说明'],
      },
      steps: [
        { tool: 'search_web', args: { query: '${tool_name} documentation API reference' }, description: '搜索官方文档' },
        { tool: 'fetch_url', args: { url: '${docUrl}' }, description: '获取文档内容' },
      ],
      replyTemplate: {
        sharp: '{_step_1}',
        warm: '官方文档：\n{_step_1}',
        chaotic: '翻了下文档~\n{_step_1}',
        default: '{_step_1}',
      },
      stats: { successCount: 4, failCount: 0, confidence: 0.55, avgExecutionMs: 1500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 项目扫描 ──
    {
      id: 'seed_project_scan',
      name: 'project_scan',
      description: '扫描项目结构',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'project_scan',
        keywords: ['项目', '结构', '扫描', 'scan', 'project', '目录结构', '文件树'],
        contextTags: ['code'],
        patterns: ['.*项目.*结构', '.*扫描.*项目', '.*文件.*树'],
      },
      steps: [
        { tool: 'scan_project', args: { path: '.' }, description: '扫描项目结构' },
      ],
      replyTemplate: {
        sharp: '{_step_0}',
        warm: '项目结构：\n{_step_0}',
        chaotic: '扫了一遍项目~\n{_step_0}',
        default: '{_step_0}',
      },
      stats: { successCount: 3, failCount: 0, confidence: 0.5, avgExecutionMs: 800, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 环境检测 ──
    {
      id: 'seed_detect_env',
      name: 'detect_env',
      description: '检测运行环境',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'detect_env',
        keywords: ['环境', '版本', 'node', 'python', '系统', 'env', '检测'],
        contextTags: ['system'],
        patterns: ['.*环境.*', '.*版本.*', '.*系统.*信息'],
      },
      steps: [
        { tool: 'detect_env', args: {}, description: '检测运行环境' },
      ],
      replyTemplate: {
        sharp: '{_step_0}',
        warm: '运行环境：\n{_step_0}',
        chaotic: '查了下环境~\n{_step_0}',
        default: '{_step_0}',
      },
      stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },

    // ── 浏览器截图 ──
    {
      id: 'seed_browser_screenshot',
      name: 'browser_screenshot',
      description: '网页截图',
      abstractionLevel: 'concrete',
      trigger: {
        intent: 'browser_screenshot',
        keywords: ['截图', 'screenshot', '网页', '页面', '截屏', '快照'],
        contextTags: ['web'],
        patterns: ['.*截图.*', '.*screenshot.*', '.*截.*网页'],
      },
      steps: [
        { tool: 'browser', args: { action: 'screenshot', url: '${url}' }, description: '网页截图' },
      ],
      replyTemplate: {
        sharp: '{_step_0}',
        warm: '截图完成：\n{_step_0}',
        chaotic: '咔嚓~截好了\n{_step_0}',
        default: '{_step_0}',
      },
      stats: { successCount: 2, failCount: 0, confidence: 0.45, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false },
    },
  ];
}

/**
 * 检查是否需要导入种子数据
 * 条件：图谱为空时自动导入
 */
export function shouldImportSeeds(nodeCount: number): boolean {
  return nodeCount === 0;
}
