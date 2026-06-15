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

    // ── Git 高级操作 ──
    { id: 'seed_git_commit', name: 'git_commit', description: 'Git 提交变更', abstractionLevel: 'concrete', trigger: { intent: 'git_commit', keywords: ['git', 'commit', '提交', '保存更改'], contextTags: ['Git'], patterns: ['\\bgit\\s+commit\\b', '提交.*变更'] }, steps: [{ tool: 'exec', args: { command: 'git add -A && git commit -m "${message}"' }, description: 'git commit' }], replyTemplate: { sharp: '{_step_0}', warm: '已提交：\n{_step_0}', chaotic: '提交好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_push', name: 'git_push', description: 'Git 推送到远程', abstractionLevel: 'concrete', trigger: { intent: 'git_push', keywords: ['git', 'push', '推送', '上传'], contextTags: ['Git'], patterns: ['\\bgit\\s+push\\b', '推送到.*远程'] }, steps: [{ tool: 'exec', args: { command: 'git push' }, description: 'git push' }], replyTemplate: { sharp: '{_step_0}', warm: '已推送：\n{_step_0}', chaotic: '推上去啦~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_pull', name: 'git_pull', description: 'Git 拉取远程更新', abstractionLevel: 'concrete', trigger: { intent: 'git_pull', keywords: ['git', 'pull', '拉取', '同步'], contextTags: ['Git'], patterns: ['\\bgit\\s+pull\\b', '拉取.*更新'] }, steps: [{ tool: 'exec', args: { command: 'git pull' }, description: 'git pull' }], replyTemplate: { sharp: '{_step_0}', warm: '已拉取：\n{_step_0}', chaotic: '同步好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_merge', name: 'git_merge', description: 'Git 合并分支', abstractionLevel: 'concrete', trigger: { intent: 'git_merge', keywords: ['git', 'merge', '合并', '分支'], contextTags: ['Git'], patterns: ['\\bgit\\s+merge\\b', '合并.*分支'] }, steps: [{ tool: 'exec', args: { command: 'git merge ${branch}' }, description: 'git merge' }], replyTemplate: { sharp: '{_step_0}', warm: '已合并：\n{_step_0}', chaotic: '合并完成~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_branch', name: 'git_branch', description: 'Git 分支操作', abstractionLevel: 'concrete', trigger: { intent: 'git_branch', keywords: ['git', 'branch', '分支', '切换'], contextTags: ['Git'], patterns: ['\\bgit\\s+branch\\b', '\\bgit\\s+checkout\\b', '\\bgit\\s+switch\\b'] }, steps: [{ tool: 'exec', args: { command: 'git branch -a' }, description: 'git branch' }], replyTemplate: { sharp: '{_step_0}', warm: '分支列表：\n{_step_0}', chaotic: '看看分支~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_stash', name: 'git_stash', description: 'Git 暂存变更', abstractionLevel: 'concrete', trigger: { intent: 'git_stash', keywords: ['git', 'stash', '暂存', '保存现场'], contextTags: ['Git'], patterns: ['\\bgit\\s+stash\\b'] }, steps: [{ tool: 'exec', args: { command: 'git stash' }, description: 'git stash' }], replyTemplate: { sharp: '{_step_0}', warm: '已暂存：\n{_step_0}', chaotic: '先存起来~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_rebase', name: 'git_rebase', description: 'Git 变基', abstractionLevel: 'concrete', trigger: { intent: 'git_rebase', keywords: ['git', 'rebase', '变基'], contextTags: ['Git'], patterns: ['\\bgit\\s+rebase\\b'] }, steps: [{ tool: 'exec', args: { command: 'git rebase ${branch}' }, description: 'git rebase' }], replyTemplate: { sharp: '{_step_0}', warm: '变基完成：\n{_step_0}', chaotic: 'rebase 好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 1, failCount: 0, confidence: 0.4, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_init', name: 'git_init', description: 'Git 初始化仓库', abstractionLevel: 'concrete', trigger: { intent: 'git_init', keywords: ['git', 'init', '初始化', '新建仓库'], contextTags: ['Git'], patterns: ['\\bgit\\s+init\\b', '初始化.*仓库'] }, steps: [{ tool: 'exec', args: { command: 'git init' }, description: 'git init' }], replyTemplate: { sharp: '{_step_0}', warm: '仓库已初始化：\n{_step_0}', chaotic: '新仓库诞生~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_clone', name: 'git_clone', description: 'Git 克隆仓库', abstractionLevel: 'concrete', trigger: { intent: 'git_clone', keywords: ['git', 'clone', '克隆', '下载仓库'], contextTags: ['Git'], patterns: ['\\bgit\\s+clone\\b', '克隆.*仓库'] }, steps: [{ tool: 'exec', args: { command: 'git clone ${url}' }, description: 'git clone' }], replyTemplate: { sharp: '{_step_0}', warm: '已克隆：\n{_step_0}', chaotic: '克隆好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_tag', name: 'git_tag', description: 'Git 标签管理', abstractionLevel: 'concrete', trigger: { intent: 'git_tag', keywords: ['git', 'tag', '标签', '版本'], contextTags: ['Git'], patterns: ['\\bgit\\s+tag\\b'] }, steps: [{ tool: 'exec', args: { command: 'git tag' }, description: 'git tag' }], replyTemplate: { sharp: '{_step_0}', warm: '标签列表：\n{_step_0}', chaotic: '看看标签~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 包管理 ──
    { id: 'seed_npm_install', name: 'npm_install', description: 'npm 安装依赖', abstractionLevel: 'concrete', trigger: { intent: 'npm_install', keywords: ['npm', 'install', '安装', '依赖', '包'], contextTags: ['node'], patterns: ['\\bnpm\\s+install\\b', '安装.*依赖'] }, steps: [{ tool: 'exec', args: { command: 'npm install' }, description: 'npm install' }], replyTemplate: { sharp: '{_step_0}', warm: '依赖已安装：\n{_step_0}', chaotic: '装好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 4, failCount: 0, confidence: 0.6, avgExecutionMs: 15000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_npm_run', name: 'npm_run', description: 'npm 运行脚本', abstractionLevel: 'concrete', trigger: { intent: 'npm_run', keywords: ['npm', 'run', '运行', '脚本', 'start', 'dev', 'build', 'test'], contextTags: ['node'], patterns: ['\\bnpm\\s+run\\b', 'npm\\s+start', 'npm\\s+test'] }, steps: [{ tool: 'exec', args: { command: 'npm run ${script}' }, description: 'npm run' }], replyTemplate: { sharp: '{_step_0}', warm: '运行结果：\n{_step_0}', chaotic: '跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 4, failCount: 0, confidence: 0.6, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_pip_install', name: 'pip_install', description: 'pip 安装 Python 包', abstractionLevel: 'concrete', trigger: { intent: 'pip_install', keywords: ['pip', 'install', '安装', 'python', '包'], contextTags: ['python'], patterns: ['\\bpip\\s+install\\b', '\\bpip3\\s+install\\b'] }, steps: [{ tool: 'exec', args: { command: 'pip install ${package}' }, description: 'pip install' }], replyTemplate: { sharp: '{_step_0}', warm: '已安装：\n{_step_0}', chaotic: '装好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 20000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_yarn_install', name: 'yarn_install', description: 'yarn 安装依赖', abstractionLevel: 'concrete', trigger: { intent: 'yarn_install', keywords: ['yarn', 'install', '安装'], contextTags: ['node'], patterns: ['\\byarn\\s+install\\b'] }, steps: [{ tool: 'exec', args: { command: 'yarn install' }, description: 'yarn install' }], replyTemplate: { sharp: '{_step_0}', warm: '已安装：\n{_step_0}', chaotic: 'yarn 装好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 15000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_npx_run', name: 'npx_run', description: 'npx 运行临时包', abstractionLevel: 'concrete', trigger: { intent: 'npx_run', keywords: ['npx', '运行', '临时'], contextTags: ['node'], patterns: ['\\bnpx\\s+'] }, steps: [{ tool: 'exec', args: { command: 'npx ${command}' }, description: 'npx run' }], replyTemplate: { sharp: '{_step_0}', warm: '运行结果：\n{_step_0}', chaotic: '跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 代码分析 ──
    { id: 'seed_lint_check', name: 'lint_check', description: '代码检查', abstractionLevel: 'concrete', trigger: { intent: 'lint_check', keywords: ['eslint', 'lint', '检查', '规范', 'prettier'], contextTags: ['code'], patterns: ['\\beslint\\b', '\\blint\\b', '代码.*检查'] }, steps: [{ tool: 'exec', args: { command: 'npx eslint .' }, description: 'eslint' }], replyTemplate: { sharp: '{_step_0}', warm: '检查结果：\n{_step_0}', chaotic: '看看代码质量~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_typecheck', name: 'typecheck', description: 'TypeScript 类型检查', abstractionLevel: 'concrete', trigger: { intent: 'typecheck', keywords: ['tsc', 'typescript', '类型检查', 'typecheck'], contextTags: ['code'], patterns: ['\\btsc\\b', '类型.*检查'] }, steps: [{ tool: 'exec', args: { command: 'npx tsc --noEmit' }, description: 'tsc --noEmit' }], replyTemplate: { sharp: '{_step_0}', warm: '类型检查结果：\n{_step_0}', chaotic: '查查类型~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_format_code', name: 'format_code', description: '代码格式化', abstractionLevel: 'concrete', trigger: { intent: 'format_code', keywords: ['prettier', 'format', '格式化', 'format'], contextTags: ['code'], patterns: ['\\bprettier\\b', '格式化.*代码'] }, steps: [{ tool: 'exec', args: { command: 'npx prettier --write .' }, description: 'prettier' }], replyTemplate: { sharp: '{_step_0}', warm: '已格式化：\n{_step_0}', chaotic: '格式化好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_grep_search', name: 'grep_search', description: '代码搜索', abstractionLevel: 'concrete', trigger: { intent: 'grep_search', keywords: ['grep', 'rg', 'find', '搜索', '查找', 'search'], contextTags: ['code'], patterns: ['\\bgrep\\b', '\\brg\\b', '\\bfind\\b', '搜索.*代码'] }, steps: [{ tool: 'exec', args: { command: 'grep -rn "${pattern}" .' }, description: 'grep search' }], replyTemplate: { sharp: '{_step_0}', warm: '搜索结果：\n{_step_0}', chaotic: '找到了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_wc_count', name: 'wc_count', description: '代码行数统计', abstractionLevel: 'concrete', trigger: { intent: 'wc_count', keywords: ['wc', '行数', '统计', 'lines', 'count'], contextTags: ['code'], patterns: ['\\bwc\\s+-l\\b', '.*行数.*'] }, steps: [{ tool: 'exec', args: { command: 'find . -name "*.ts" | xargs wc -l | tail -1' }, description: 'wc -l' }], replyTemplate: { sharp: '{_step_0}', warm: '行数统计：\n{_step_0}', chaotic: '数数代码~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 网络调试 ──
    { id: 'seed_curl_get', name: 'curl_get', description: 'curl GET 请求', abstractionLevel: 'concrete', trigger: { intent: 'curl_get', keywords: ['curl', '请求', 'api', '接口', 'get'], contextTags: ['network'], patterns: ['\\bcurl\\b', '请求.*接口'] }, steps: [{ tool: 'exec', args: { command: 'curl -s ${url}' }, description: 'curl GET' }], replyTemplate: { sharp: '{_step_0}', warm: '请求结果：\n{_step_0}', chaotic: '请求发出去了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_ping', name: 'ping', description: 'ping 网络连通性', abstractionLevel: 'concrete', trigger: { intent: 'ping', keywords: ['ping', '连通', '网络', '可达'], contextTags: ['network'], patterns: ['\\bping\\b', '.*连通.*'] }, steps: [{ tool: 'exec', args: { command: 'ping -c 4 ${host}' }, description: 'ping' }], replyTemplate: { sharp: '{_step_0}', warm: 'ping 结果：\n{_step_0}', chaotic: 'ping 一下~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_wget', name: 'wget', description: 'wget 下载文件', abstractionLevel: 'concrete', trigger: { intent: 'wget', keywords: ['wget', '下载', 'download'], contextTags: ['network'], patterns: ['\\bwget\\b', '下载.*文件'] }, steps: [{ tool: 'exec', args: { command: 'wget ${url}' }, description: 'wget' }], replyTemplate: { sharp: '{_step_0}', warm: '已下载：\n{_step_0}', chaotic: '下好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_netstat', name: 'netstat', description: '网络连接查看', abstractionLevel: 'concrete', trigger: { intent: 'netstat', keywords: ['netstat', 'ss', '端口', '连接', '监听'], contextTags: ['network'], patterns: ['\\bnetstat\\b', '\\bss\\s+-tlnp\\b', '查看.*端口'] }, steps: [{ tool: 'exec', args: { command: 'ss -tlnp' }, description: 'ss -tlnp' }], replyTemplate: { sharp: '{_step_0}', warm: '网络状态：\n{_step_0}', chaotic: '看看端口~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 系统运维 ──
    { id: 'seed_docker_ps', name: 'docker_ps', description: 'docker 容器列表', abstractionLevel: 'concrete', trigger: { intent: 'docker_ps', keywords: ['docker', 'ps', '容器', 'container'], contextTags: ['docker'], patterns: ['\\bdocker\\s+ps\\b', '查看.*容器'] }, steps: [{ tool: 'exec', args: { command: 'docker ps -a' }, description: 'docker ps' }], replyTemplate: { sharp: '{_step_0}', warm: '容器列表：\n{_step_0}', chaotic: '看看容器~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_docker_logs', name: 'docker_logs', description: 'docker 日志查看', abstractionLevel: 'concrete', trigger: { intent: 'docker_logs', keywords: ['docker', 'logs', '日志', '容器日志'], contextTags: ['docker'], patterns: ['\\bdocker\\s+logs\\b'] }, steps: [{ tool: 'exec', args: { command: 'docker logs --tail 50 ${container}' }, description: 'docker logs' }], replyTemplate: { sharp: '{_step_0}', warm: '容器日志：\n{_step_0}', chaotic: '看看日志~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_docker_compose', name: 'docker_compose', description: 'docker compose 操作', abstractionLevel: 'concrete', trigger: { intent: 'docker_compose', keywords: ['docker', 'compose', '编排', '服务'], contextTags: ['docker'], patterns: ['\\bdocker-compose\\b', '\\bdocker\\s+compose\\b'] }, steps: [{ tool: 'exec', args: { command: 'docker compose up -d' }, description: 'docker compose up' }], replyTemplate: { sharp: '{_step_0}', warm: '服务已启动：\n{_step_0}', chaotic: 'compose 跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 15000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_ps_top', name: 'ps_top', description: '进程查看', abstractionLevel: 'concrete', trigger: { intent: 'ps_top', keywords: ['ps', 'top', 'htop', '进程', 'process'], contextTags: ['system'], patterns: ['\\bps\\s+aux\\b', '\\btop\\b', '查看.*进程'] }, steps: [{ tool: 'exec', args: { command: 'ps aux --sort=-%cpu | head -20' }, description: 'ps aux' }], replyTemplate: { sharp: '{_step_0}', warm: '进程列表：\n{_step_0}', chaotic: '看看进程~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_df_du', name: 'df_du', description: '磁盘使用查看', abstractionLevel: 'concrete', trigger: { intent: 'df_du', keywords: ['df', 'du', '磁盘', '空间', 'disk'], contextTags: ['system'], patterns: ['\\bdf\\s+-h\\b', '\\bdu\\s+', '查看.*空间'] }, steps: [{ tool: 'exec', args: { command: 'df -h' }, description: 'df -h' }], replyTemplate: { sharp: '{_step_0}', warm: '磁盘使用：\n{_step_0}', chaotic: '看看空间~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_free_mem', name: 'free_mem', description: '内存使用查看', abstractionLevel: 'concrete', trigger: { intent: 'free_mem', keywords: ['free', '内存', 'memory', 'ram'], contextTags: ['system'], patterns: ['\\bfree\\s+-h\\b', '查看.*内存'] }, steps: [{ tool: 'exec', args: { command: 'free -h' }, description: 'free -h' }], replyTemplate: { sharp: '{_step_0}', warm: '内存使用：\n{_step_0}', chaotic: '看看内存~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_systemctl', name: 'systemctl', description: 'systemd 服务管理', abstractionLevel: 'concrete', trigger: { intent: 'systemctl', keywords: ['systemctl', 'systemd', '服务', 'service', '启动', '停止'], contextTags: ['system'], patterns: ['\\bsystemctl\\b', '服务.*状态'] }, steps: [{ tool: 'exec', args: { command: 'systemctl status ${service}' }, description: 'systemctl status' }], replyTemplate: { sharp: '{_step_0}', warm: '服务状态：\n{_step_0}', chaotic: '看看服务~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_kill_process', name: 'kill_process', description: '终止进程', abstractionLevel: 'concrete', trigger: { intent: 'kill_process', keywords: ['kill', 'killall', '终止', '杀掉', '停止进程'], contextTags: ['system'], patterns: ['\\bkill\\b', '\\bkillall\\b', '终止.*进程'] }, steps: [{ tool: 'exec', args: { command: 'kill ${pid}' }, description: 'kill' }], replyTemplate: { sharp: '{_step_0}', warm: '已终止：\n{_step_0}', chaotic: '杀掉了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_uptime', name: 'uptime', description: '系统运行时间', abstractionLevel: 'concrete', trigger: { intent: 'uptime', keywords: ['uptime', '运行时间', '负载'], contextTags: ['system'], patterns: ['\\buptime\\b', '.*运行时间.*'] }, steps: [{ tool: 'exec', args: { command: 'uptime' }, description: 'uptime' }], replyTemplate: { sharp: '{_step_0}', warm: '系统状态：\n{_step_0}', chaotic: '看看运行了多久~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 压缩/归档 ──
    { id: 'seed_tar_create', name: 'tar_create', description: 'tar 打包', abstractionLevel: 'concrete', trigger: { intent: 'tar_create', keywords: ['tar', '打包', '压缩', '归档'], contextTags: ['file'], patterns: ['\\btar\\s+', '打包.*文件'] }, steps: [{ tool: 'exec', args: { command: 'tar czf ${archive} ${source}' }, description: 'tar czf' }], replyTemplate: { sharp: '{_step_0}', warm: '已打包：\n{_step_0}', chaotic: '打包好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_tar_extract', name: 'tar_extract', description: 'tar 解压', abstractionLevel: 'concrete', trigger: { intent: 'tar_extract', keywords: ['tar', '解压', '解包', 'untar'], contextTags: ['file'], patterns: ['\\btar\\s+x', '解压.*文件'] }, steps: [{ tool: 'exec', args: { command: 'tar xzf ${archive}' }, description: 'tar xzf' }], replyTemplate: { sharp: '{_step_0}', warm: '已解压：\n{_step_0}', chaotic: '解压好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_zip', name: 'zip', description: 'zip 压缩', abstractionLevel: 'concrete', trigger: { intent: 'zip', keywords: ['zip', '压缩', '打包'], contextTags: ['file'], patterns: ['\\bzip\\b', '压缩.*zip'] }, steps: [{ tool: 'exec', args: { command: 'zip -r ${archive}.zip ${source}' }, description: 'zip' }], replyTemplate: { sharp: '{_step_0}', warm: '已压缩：\n{_step_0}', chaotic: '压缩好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_unzip', name: 'unzip', description: 'zip 解压', abstractionLevel: 'concrete', trigger: { intent: 'unzip', keywords: ['unzip', '解压', '解压缩'], contextTags: ['file'], patterns: ['\\bunzip\\b', '\\bunzip\\b', '解压.*zip'] }, steps: [{ tool: 'exec', args: { command: 'unzip ${archive}' }, description: 'unzip' }], replyTemplate: { sharp: '{_step_0}', warm: '已解压：\n{_step_0}', chaotic: '解压好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 文本处理 ──
    { id: 'seed_sed_replace', name: 'sed_replace', description: 'sed 文本替换', abstractionLevel: 'concrete', trigger: { intent: 'sed_replace', keywords: ['sed', '替换', 'replace'], contextTags: ['text'], patterns: ['\\bsed\\b', '替换.*文本'] }, steps: [{ tool: 'exec', args: { command: 'sed -i "s/${old}/${new}/g" ${file}' }, description: 'sed replace' }], replyTemplate: { sharp: '{_step_0}', warm: '已替换：\n{_step_0}', chaotic: '替换好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_awk_process', name: 'awk_process', description: 'awk 文本处理', abstractionLevel: 'concrete', trigger: { intent: 'awk_process', keywords: ['awk', '处理', '提取', '列'], contextTags: ['text'], patterns: ['\\bawk\\b', '提取.*列'] }, steps: [{ tool: 'exec', args: { command: 'awk \'${pattern}\' ${file}' }, description: 'awk' }], replyTemplate: { sharp: '{_step_0}', warm: '处理结果：\n{_step_0}', chaotic: 'awk 出来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 1, failCount: 0, confidence: 0.4, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_sort_uniq', name: 'sort_uniq', description: '排序去重', abstractionLevel: 'concrete', trigger: { intent: 'sort_uniq', keywords: ['sort', 'uniq', '排序', '去重'], contextTags: ['text'], patterns: ['\\bsort\\b', '\\buniq\\b', '.*去重.*'] }, steps: [{ tool: 'exec', args: { command: 'sort ${file} | uniq' }, description: 'sort | uniq' }], replyTemplate: { sharp: '{_step_0}', warm: '排序去重结果：\n{_step_0}', chaotic: '排好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── SSH/远程 ──
    { id: 'seed_ssh', name: 'ssh', description: 'SSH 远程连接', abstractionLevel: 'concrete', trigger: { intent: 'ssh', keywords: ['ssh', '远程', '连接', 'remote'], contextTags: ['remote'], patterns: ['\\bssh\\b', '远程.*连接'] }, steps: [{ tool: 'exec', args: { command: 'ssh ${host}' }, description: 'ssh' }], replyTemplate: { sharp: '{_step_0}', warm: '已连接：\n{_step_0}', chaotic: '连上了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 1, failCount: 0, confidence: 0.4, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_rsync', name: 'rsync', description: 'rsync 文件同步', abstractionLevel: 'concrete', trigger: { intent: 'rsync', keywords: ['rsync', '同步', 'sync'], contextTags: ['remote'], patterns: ['\\brsync\\b', '同步.*文件'] }, steps: [{ tool: 'exec', args: { command: 'rsync -avz ${src} ${dst}' }, description: 'rsync' }], replyTemplate: { sharp: '{_step_0}', warm: '已同步：\n{_step_0}', chaotic: '同步好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 1, failCount: 0, confidence: 0.4, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── Python 运行 ──
    { id: 'seed_python_run', name: 'python_run', description: 'Python 脚本运行', abstractionLevel: 'concrete', trigger: { intent: 'python_run', keywords: ['python', 'python3', '运行', '脚本', 'py'], contextTags: ['python'], patterns: ['\\bpython3?\\b', '运行.*python'] }, steps: [{ tool: 'exec', args: { command: 'python3 ${script}' }, description: 'python3' }], replyTemplate: { sharp: '{_step_0}', warm: '运行结果：\n{_step_0}', chaotic: '跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_pytest', name: 'pytest', description: 'pytest 测试运行', abstractionLevel: 'concrete', trigger: { intent: 'pytest', keywords: ['pytest', '测试', 'test', '单元测试'], contextTags: ['python'], patterns: ['\\bpytest\\b', '运行.*测试'] }, steps: [{ tool: 'exec', args: { command: 'pytest -v' }, description: 'pytest' }], replyTemplate: { sharp: '{_step_0}', warm: '测试结果：\n{_step_0}', chaotic: '测试跑完了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 10000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── Node.js 运行 ──
    { id: 'seed_node_run', name: 'node_run', description: 'Node.js 脚本运行', abstractionLevel: 'concrete', trigger: { intent: 'node_run', keywords: ['node', '运行', 'js', '脚本'], contextTags: ['node'], patterns: ['\\bnode\\s+', '运行.*node'] }, steps: [{ tool: 'exec', args: { command: 'node ${script}' }, description: 'node' }], replyTemplate: { sharp: '{_step_0}', warm: '运行结果：\n{_step_0}', chaotic: '跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_tsx_run', name: 'tsx_run', description: 'tsx TypeScript 直接运行', abstractionLevel: 'concrete', trigger: { intent: 'tsx_run', keywords: ['tsx', 'ts-node', 'typescript', '运行ts'], contextTags: ['node'], patterns: ['\\btsx\\b', '\\bts-node\\b'] }, steps: [{ tool: 'exec', args: { command: 'npx tsx ${script}' }, description: 'tsx' }], replyTemplate: { sharp: '{_step_0}', warm: '运行结果：\n{_step_0}', chaotic: 'TS 跑起来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 常见问答 ──
    { id: 'seed_weather', name: 'weather', description: '天气查询', abstractionLevel: 'concrete', trigger: { intent: 'weather', keywords: ['天气', 'weather', '温度', '下雨', '气温'], contextTags: ['web'], patterns: ['.*天气.*', '.*weather.*'] }, steps: [{ tool: 'web_fetch', args: { url: 'https://wttr.in/${city}?format=3' }, description: '天气查询' }], replyTemplate: { sharp: '{_step_0}', warm: '天气情况：\n{_step_0}', chaotic: '看看天气~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_translate', name: 'translate', description: '翻译', abstractionLevel: 'concrete', trigger: { intent: 'translate', keywords: ['翻译', 'translate', '英译中', '中译英'], contextTags: ['knowledge'], patterns: ['.*翻译.*', '.*translate.*'] }, steps: [{ tool: 'llm', args: { prompt: '翻译以下内容: ${content}' }, description: '翻译' }], replyTemplate: { sharp: '{_step_0}', warm: '翻译结果：\n{_step_0}', chaotic: '翻好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_explain', name: 'explain', description: '概念解释', abstractionLevel: 'concrete', trigger: { intent: 'explain', keywords: ['是什么', '什么是', 'explain', '解释', '原理'], contextTags: ['knowledge'], patterns: ['.*是什么.*', '.*什么是.*', '.*explain.*'] }, steps: [{ tool: 'llm', args: { prompt: '详细解释: ${content}' }, description: '解释' }], replyTemplate: { sharp: '{_step_0}', warm: '解释如下：\n{_step_0}', chaotic: '这个问题嘛~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_compare', name: 'compare', description: '对比分析', abstractionLevel: 'concrete', trigger: { intent: 'compare', keywords: ['对比', '比较', 'compare', '区别', 'vs', 'difference'], contextTags: ['knowledge'], patterns: ['.*对比.*', '.*比较.*', '.*区别.*', '.*vs.*'] }, steps: [{ tool: 'llm', args: { prompt: '对比分析: ${content}' }, description: '对比' }], replyTemplate: { sharp: '{_step_0}', warm: '对比结果：\n{_step_0}', chaotic: '来比比看~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_summarize', name: 'summarize', description: '总结概括', abstractionLevel: 'concrete', trigger: { intent: 'summarize', keywords: ['总结', '概括', 'summarize', '归纳', '摘要'], contextTags: ['knowledge'], patterns: ['.*总结.*', '.*概括.*', '.*summarize.*'] }, steps: [{ tool: 'llm', args: { prompt: '总结以下内容: ${content}' }, description: '总结' }], replyTemplate: { sharp: '{_step_0}', warm: '总结如下：\n{_step_0}', chaotic: '帮你总结~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_calc', name: 'calc', description: '数学计算', abstractionLevel: 'concrete', trigger: { intent: 'calc', keywords: ['计算', '多少', '等于', 'calculate', 'math'], contextTags: ['system'], patterns: ['\\d+\\s*[\\+\\-\\*\\/\\%]\\s*\\d+', '计算.*\\d+', '.*等于多少'] }, steps: [{ tool: 'exec', args: { command: 'echo "${expression}" | bc -l' }, description: 'bc 计算' }], replyTemplate: { sharp: '{_step_0}', warm: '计算结果：\n{_step_0}', chaotic: '算出来了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_date_time', name: 'date_time', description: '日期时间查询', abstractionLevel: 'concrete', trigger: { intent: 'date_time', keywords: ['时间', '日期', '几点', '几号', 'time', 'date', 'today'], contextTags: ['system'], patterns: ['.*现在几点.*', '.*今天.*日期.*', '.*what.*time.*'] }, steps: [{ tool: 'exec', args: { command: 'date "+%Y-%m-%d %H:%M:%S %Z"' }, description: 'date' }], replyTemplate: { sharp: '{_step_0}', warm: '当前时间：\n{_step_0}', chaotic: '现在是~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 5, failCount: 0, confidence: 0.65, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_hostname', name: 'hostname', description: '主机名查询', abstractionLevel: 'concrete', trigger: { intent: 'hostname', keywords: ['hostname', '主机名', '机器名'], contextTags: ['system'], patterns: ['\\bhostname\\b', '.*主机名.*'] }, steps: [{ tool: 'exec', args: { command: 'hostname && uname -a' }, description: 'hostname' }], replyTemplate: { sharp: '{_step_0}', warm: '主机信息：\n{_step_0}', chaotic: '这台机器是~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_which_cmd', name: 'which_cmd', description: '命令路径查找', abstractionLevel: 'concrete', trigger: { intent: 'which_cmd', keywords: ['which', 'whereis', '命令在哪', '路径'], contextTags: ['system'], patterns: ['\\bwhich\\b', '\\bwhereis\\b', '.*在哪.*命令'] }, steps: [{ tool: 'exec', args: { command: 'which ${command}' }, description: 'which' }], replyTemplate: { sharp: '{_step_0}', warm: '命令路径：\n{_step_0}', chaotic: '找到了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_env_vars', name: 'env_vars', description: '环境变量查看', abstractionLevel: 'concrete', trigger: { intent: 'env_vars', keywords: ['env', '环境变量', '变量', 'environment'], contextTags: ['system'], patterns: ['\\benv\\b', '.*环境变量.*', '\\$\\{?\\w+\\}?'] }, steps: [{ tool: 'exec', args: { command: 'env | sort' }, description: 'env' }], replyTemplate: { sharp: '{_step_0}', warm: '环境变量：\n{_step_0}', chaotic: '看看环境~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_chmod', name: 'chmod', description: '权限修改', abstractionLevel: 'concrete', trigger: { intent: 'chmod', keywords: ['chmod', '权限', 'permission', '可执行'], contextTags: ['file'], patterns: ['\\bchmod\\b', '修改.*权限'] }, steps: [{ tool: 'exec', args: { command: 'chmod ${mode} ${file}' }, description: 'chmod' }], replyTemplate: { sharp: '{_step_0}', warm: '已修改权限：\n{_step_0}', chaotic: '权限改好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_mkdir', name: 'mkdir', description: '创建目录', abstractionLevel: 'concrete', trigger: { intent: 'mkdir', keywords: ['mkdir', '创建目录', '新建文件夹'], contextTags: ['file'], patterns: ['\\bmkdir\\b', '创建.*目录'] }, steps: [{ tool: 'exec', args: { command: 'mkdir -p ${path}' }, description: 'mkdir' }], replyTemplate: { sharp: '{_step_0}', warm: '目录已创建：\n{_step_0}', chaotic: '目录建好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_rm_file', name: 'rm_file', description: '删除文件', abstractionLevel: 'concrete', trigger: { intent: 'rm_file', keywords: ['rm', '删除', 'remove', 'delete'], contextTags: ['file'], patterns: ['\\brm\\b', '删除.*文件'] }, steps: [{ tool: 'exec', args: { command: 'rm -i ${file}' }, description: 'rm' }], replyTemplate: { sharp: '{_step_0}', warm: '已删除：\n{_step_0}', chaotic: '删掉了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_cp_mv', name: 'cp_mv', description: '复制/移动文件', abstractionLevel: 'concrete', trigger: { intent: 'cp_mv', keywords: ['cp', 'mv', '复制', '移动', 'copy', 'move'], contextTags: ['file'], patterns: ['\\bcp\\s+', '\\bmv\\s+', '复制.*文件', '移动.*文件'] }, steps: [{ tool: 'exec', args: { command: 'cp ${src} ${dst}' }, description: 'cp' }], replyTemplate: { sharp: '{_step_0}', warm: '已复制：\n{_step_0}', chaotic: '搞定了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_docker_build', name: 'docker_build', description: 'docker 构建镜像', abstractionLevel: 'concrete', trigger: { intent: 'docker_build', keywords: ['docker', 'build', '构建', '镜像'], contextTags: ['docker'], patterns: ['\\bdocker\\s+build\\b', '构建.*镜像'] }, steps: [{ tool: 'exec', args: { command: 'docker build -t ${tag} .' }, description: 'docker build' }], replyTemplate: { sharp: '{_step_0}', warm: '镜像已构建：\n{_step_0}', chaotic: '镜像构建好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 30000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_docker_exec', name: 'docker_exec', description: 'docker 进入容器', abstractionLevel: 'concrete', trigger: { intent: 'docker_exec', keywords: ['docker', 'exec', '进入容器', '容器shell'], contextTags: ['docker'], patterns: ['\\bdocker\\s+exec\\b', '进入.*容器'] }, steps: [{ tool: 'exec', args: { command: 'docker exec -it ${container} /bin/sh' }, description: 'docker exec' }], replyTemplate: { sharp: '{_step_0}', warm: '已进入容器：\n{_step_0}', chaotic: '进去了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 1, failCount: 0, confidence: 0.4, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_docker_stop', name: 'docker_stop', description: 'docker 停止容器', abstractionLevel: 'concrete', trigger: { intent: 'docker_stop', keywords: ['docker', 'stop', '停止容器'], contextTags: ['docker'], patterns: ['\\bdocker\\s+stop\\b', '停止.*容器'] }, steps: [{ tool: 'exec', args: { command: 'docker stop ${container}' }, description: 'docker stop' }], replyTemplate: { sharp: '{_step_0}', warm: '容器已停止：\n{_step_0}', chaotic: '停掉了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },

    // ── 扩展知识问答 ──
    { id: 'seed_how_to', name: 'how_to', description: '操作指南', abstractionLevel: 'concrete', trigger: { intent: 'how_to', keywords: ['怎么做', '如何操作', '怎样实现', 'how to', '教程', '步骤', '手把手'], contextTags: ['knowledge'], patterns: ['怎么做.*', '如何操作.*', 'how\\s+to.*', '教程.*'] }, steps: [{ tool: 'llm', args: { prompt: '详细说明如何: ${content}' }, description: '操作指南' }], replyTemplate: { sharp: '{_step_0}', warm: '操作步骤：\n{_step_0}', chaotic: '教你怎么做~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_why', name: 'why', description: '原因分析', abstractionLevel: 'concrete', trigger: { intent: 'why', keywords: ['为什么', '为啥', '原因', 'why', '怎么回事', '导致'], contextTags: ['knowledge'], patterns: ['为什么.*', '为啥.*', 'why.*', '什么原因.*'] }, steps: [{ tool: 'llm', args: { prompt: '分析原因: ${content}' }, description: '原因分析' }], replyTemplate: { sharp: '{_step_0}', warm: '原因是：\n{_step_0}', chaotic: '让我想想~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_recommend', name: 'recommend', description: '推荐建议', abstractionLevel: 'concrete', trigger: { intent: 'recommend', keywords: ['推荐', '建议', '有什么好的', 'recommend', 'suggest', '哪个好', '选什么'], contextTags: ['knowledge'], patterns: ['推荐.*', '有什么好的.*', '哪个好.*', '选什么.*'] }, steps: [{ tool: 'llm', args: { prompt: '给出推荐和建议: ${content}' }, description: '推荐' }], replyTemplate: { sharp: '{_step_0}', warm: '推荐如下：\n{_step_0}', chaotic: '我来推荐~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_write_code', name: 'write_code', description: '代码编写', abstractionLevel: 'concrete', trigger: { intent: 'write_code', keywords: ['写代码', '实现', '编写', 'write code', 'implement', '写个', '写一个'], contextTags: ['code'], patterns: ['.*写.*代码.*', '.*实现.*功能.*', '.*write.*code.*'] }, steps: [{ tool: 'llm', args: { prompt: '编写代码: ${content}' }, description: '代码编写' }], replyTemplate: { sharp: '{_step_0}', warm: '代码如下：\n{_step_0}', chaotic: '来写代码~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_debug_help', name: 'debug_help', description: '调试帮助', abstractionLevel: 'concrete', trigger: { intent: 'debug_help', keywords: ['调试', 'debug', '报错', '出错', '不工作', '失败', 'error', 'bug'], contextTags: ['code'], patterns: ['.*报错.*', '.*出错.*', '.*不工作.*', '.*error.*'] }, steps: [{ tool: 'llm', args: { prompt: '帮助调试: ${content}' }, description: '调试帮助' }], replyTemplate: { sharp: '{_step_0}', warm: '调试建议：\n{_step_0}', chaotic: '来看看问题~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 4000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_review_code', name: 'review_code', description: '代码审查', abstractionLevel: 'concrete', trigger: { intent: 'review_code', keywords: ['review', '审查', '检查代码', 'code review', '看看代码'], contextTags: ['code'], patterns: ['.*review.*', '.*审查.*代码.*', '.*看看.*代码.*'] }, steps: [{ tool: 'read_file', args: { path: '${file}' }, description: '读取代码' }, { tool: 'llm', args: { prompt: '审查这段代码的质量、安全性和可改进之处: ${_step_0}' }, description: '代码审查' }], replyTemplate: { sharp: '{_step_1}', warm: '代码审查结果：\n{_step_1}', chaotic: '帮你看看代码~\n{_step_1}', default: '{_step_1}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_write_doc', name: 'write_doc', description: '文档编写', abstractionLevel: 'concrete', trigger: { intent: 'write_doc', keywords: ['文档', 'doc', 'readme', '说明', '注释', 'documentation'], contextTags: ['writing'], patterns: ['.*写.*文档.*', '.*readme.*', '.*说明文档.*'] }, steps: [{ tool: 'llm', args: { prompt: '编写文档: ${content}' }, description: '文档编写' }], replyTemplate: { sharp: '{_step_0}', warm: '文档如下：\n{_step_0}', chaotic: '来写文档~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 4000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_git_remote', name: 'git_remote', description: 'Git 远程仓库管理', abstractionLevel: 'concrete', trigger: { intent: 'git_remote', keywords: ['git', 'remote', '远程仓库', 'origin'], contextTags: ['Git'], patterns: ['\\bgit\\s+remote\\b', '远程.*仓库'] }, steps: [{ tool: 'exec', args: { command: 'git remote -v' }, description: 'git remote' }], replyTemplate: { sharp: '{_step_0}', warm: '远程仓库：\n{_step_0}', chaotic: '看看远程~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_curl_post', name: 'curl_post', description: 'curl POST 请求', abstractionLevel: 'concrete', trigger: { intent: 'curl_post', keywords: ['curl', 'post', '提交数据', '发送请求'], contextTags: ['network'], patterns: ['\\bcurl\\s+.*-X\\s+POST\\b', '\\bcurl\\s+.*--data\\b', 'POST.*请求'] }, steps: [{ tool: 'exec', args: { command: 'curl -s -X POST -H "Content-Type: application/json" -d \'${data}\' ${url}' }, description: 'curl POST' }], replyTemplate: { sharp: '{_step_0}', warm: 'POST 结果：\n{_step_0}', chaotic: '请求发了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_diff_files', name: 'diff_files', description: '文件差异对比', abstractionLevel: 'concrete', trigger: { intent: 'diff_files', keywords: ['diff', '差异', '对比文件', '区别'], contextTags: ['file'], patterns: ['\\bdiff\\b', '对比.*文件', '.*差异.*'] }, steps: [{ tool: 'exec', args: { command: 'diff ${file1} ${file2}' }, description: 'diff' }], replyTemplate: { sharp: '{_step_0}', warm: '差异结果：\n{_step_0}', chaotic: '比比看~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 2000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_tail_log', name: 'tail_log', description: '实时日志查看', abstractionLevel: 'concrete', trigger: { intent: 'tail_log', keywords: ['tail', '日志', 'log', '实时', '跟踪'], contextTags: ['system'], patterns: ['\\btail\\s+-f\\b', '查看.*日志', '实时.*日志'] }, steps: [{ tool: 'exec', args: { command: 'tail -50 ${logfile}' }, description: 'tail' }], replyTemplate: { sharp: '{_step_0}', warm: '日志内容：\n{_step_0}', chaotic: '看看日志~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 1000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_export_var', name: 'export_var', description: '设置环境变量', abstractionLevel: 'concrete', trigger: { intent: 'export_var', keywords: ['export', '设置变量', '环境变量', 'set'], contextTags: ['system'], patterns: ['\\bexport\\b', '设置.*变量'] }, steps: [{ tool: 'exec', args: { command: 'export ${var}=${value} && echo "已设置 ${var}=${value}"' }, description: 'export' }], replyTemplate: { sharp: '{_step_0}', warm: '已设置：\n{_step_0}', chaotic: '设好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 200, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_npm_update', name: 'npm_update', description: 'npm 更新依赖', abstractionLevel: 'concrete', trigger: { intent: 'npm_update', keywords: ['npm', 'update', '更新', '升级'], contextTags: ['node'], patterns: ['\\bnpm\\s+update\\b', '更新.*依赖'] }, steps: [{ tool: 'exec', args: { command: 'npm update' }, description: 'npm update' }], replyTemplate: { sharp: '{_step_0}', warm: '已更新：\n{_step_0}', chaotic: '更新好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 30000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_npm_audit', name: 'npm_audit', description: 'npm 安全审计', abstractionLevel: 'concrete', trigger: { intent: 'npm_audit', keywords: ['npm', 'audit', '安全', '漏洞', 'vulnerability'], contextTags: ['node'], patterns: ['\\bnpm\\s+audit\\b', '安全.*审计'] }, steps: [{ tool: 'exec', args: { command: 'npm audit' }, description: 'npm audit' }], replyTemplate: { sharp: '{_step_0}', warm: '审计结果：\n{_step_0}', chaotic: '查查安全~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 2, failCount: 0, confidence: 0.5, avgExecutionMs: 5000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_googler', name: 'googler', description: 'Google 搜索', abstractionLevel: 'concrete', trigger: { intent: 'googler', keywords: ['google', '谷歌', '搜索', 'search', '查一下', '帮我查'], contextTags: ['web'], patterns: ['.*搜索.*', '.*查一下.*', '.*search.*'] }, steps: [{ tool: 'web_fetch', args: { url: 'https://www.google.com/search?q=${query}' }, description: 'Google 搜索' }], replyTemplate: { sharp: '{_step_0}', warm: '搜索结果：\n{_step_0}', chaotic: '帮你搜搜~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 3000, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
    { id: 'seed_write_file_content', name: 'write_file_content', description: '写入文件内容', abstractionLevel: 'concrete', trigger: { intent: 'write_file_content', keywords: ['写入', '保存到', 'write', 'create file', '新建文件'], contextTags: ['file'], patterns: ['.*写入.*文件.*', '.*保存到.*', '.*create.*file.*'] }, steps: [{ tool: 'write_file', args: { path: '${path}', content: '${content}' }, description: 'write file' }], replyTemplate: { sharp: '{_step_0}', warm: '文件已写入：\n{_step_0}', chaotic: '写好了~\n{_step_0}', default: '{_step_0}' }, stats: { successCount: 3, failCount: 0, confidence: 0.55, avgExecutionMs: 500, lastUsed: now, createdAt: now, extractedFrom: ['seed'], consolidatedAt: 0, evolved: false } },
  ];
}

/**
 * 检查是否需要导入种子数据
 * 条件：图谱为空时自动导入
 */
export function shouldImportSeeds(nodeCount: number): boolean {
  return nodeCount === 0;
}
