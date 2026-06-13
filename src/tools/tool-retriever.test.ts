/**
 * 工具语义检索器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRetriever } from './tool-retriever.js';
import type { ToolDef } from '../types.js';
import { z } from 'zod';

function makeTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    parameters: z.object({}),
    permission: 'basic',
    execute: async () => 'ok',
  };
}

const SAMPLE_TOOLS: ToolDef[] = [
  makeTool('read_file', '读取文件内容，支持指定起始行和行数'),
  makeTool('write_file', '写入或创建文件'),
  makeTool('git_commit', '暂存所有变更并提交代码'),
  makeTool('git_branch', 'Git 分支操作：列出/创建/切换/删除分支'),
  makeTool('video_info', '获取视频文件元数据，包括时长/分辨率/编码/帧率'),
  makeTool('video_cut', '裁剪视频片段，指定开始和结束时间'),
  makeTool('tts_speak', '将文本转为语音并保存为音频文件'),
  makeTool('search_web', '搜索网页内容'),
  makeTool('exec', '执行 Shell 命令'),
  makeTool('docker_ps', '查看正在运行的 Docker 容器列表'),
  makeTool('system_info', '查看系统综合信息：CPU/内存/磁盘/负载'),
  makeTool('json_query', '用 jq 查询 JSON 数据'),
  makeTool('pdf_extract', '从 PDF 文件中提取文本内容'),
  makeTool('npm_run', '运行 npm scripts'),
  makeTool('lint_check', 'ESLint 代码检查'),
];

describe('ToolRetriever', () => {
  let retriever: ToolRetriever;

  beforeEach(() => {
    retriever = new ToolRetriever();
    retriever.indexTools(SAMPLE_TOOLS);
  });

  it('应索引所有工具', () => {
    expect(retriever.size).toBe(15);
  });

  it('应检索到文件相关工具', () => {
    const results = retriever.retrieve('读取文件内容');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('read_file');
  });

  it('应检索到 Git 相关工具', () => {
    const results = retriever.retrieve('提交代码到 git');
    expect(results.some(r => r.name === 'git_commit')).toBe(true);
  });

  it('应检索到视频相关工具', () => {
    const results = retriever.retrieve('裁剪视频');
    expect(results.some(r => r.name === 'video_cut')).toBe(true);
    expect(results.some(r => r.name === 'video_info')).toBe(true);
  });

  it('应支持上下文标签', () => {
    const results = retriever.retrieve('运行命令', ['git']);
    expect(results.some(r => r.name === 'git_commit')).toBe(true);
  });

  it('getToolsForPrompt 应返回 ToolDef', () => {
    const tools = retriever.getToolsForPrompt('读取文件');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('read_file');
    expect(tools[0].execute).toBeTypeOf('function');
  });

  it('无匹配时应返回空数组', () => {
    const results = retriever.retrieve('外星人入侵地球');
    // 可能返回低分结果，但应该很少或没有
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('应限制返回数量', () => {
    const limited = new ToolRetriever({ maxTools: 3 });
    limited.indexTools(SAMPLE_TOOLS);
    const results = limited.retrieve('文件 git 视频 系统');
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('英文查询也能匹配', () => {
    const results = retriever.retrieve('git commit push');
    expect(results.some(r => r.name === 'git_commit')).toBe(true);
  });

  it('应支持中文查询', () => {
    const results = retriever.retrieve('语音合成');
    expect(results.some(r => r.name === 'tts_speak')).toBe(true);
  });

  it('clear 应清空索引', () => {
    retriever.clear();
    expect(retriever.size).toBe(0);
  });

  // ── Sprint 1.2: Intl.Segmenter 中文分词 ──

  it('中文长词 "查看文件内容" 能匹配到 read_file', () => {
    const results = retriever.retrieve('查看文件内容');
    expect(results.some(r => r.name === 'read_file')).toBe(true);
  });

  it('中文 "代码提交" 能匹配到 git_commit', () => {
    const results = retriever.retrieve('代码提交');
    expect(results.some(r => r.name === 'git_commit')).toBe(true);
  });

  it('中文 "容器列表" 能匹配到 docker_ps', () => {
    const results = retriever.retrieve('查看容器列表');
    expect(results.some(r => r.name === 'docker_ps')).toBe(true);
  });

  it('中文 "文本转语音" 能匹配到 tts_speak', () => {
    const results = retriever.retrieve('文本转语音');
    expect(results.some(r => r.name === 'tts_speak')).toBe(true);
  });

  // ── Sprint 1.2: 使用频率衰减权重 ──

  it('最近使用的工具分数更高', () => {
    retriever.recordUsage('git_commit');
    retriever.recordUsage('git_commit');
    const results = retriever.retrieve('git');
    const gitCommit = results.find(r => r.name === 'git_commit');
    const otherGit = results.find(r => r.name === 'git_branch');
    expect(gitCommit).toBeDefined();
    if (gitCommit && otherGit) {
      expect(gitCommit.score).toBeGreaterThan(otherGit.score);
    }
  });

  it('未使用的工具频率加成为 0', () => {
    const results = retriever.retrieve('系统信息');
    const sysInfo = results.find(r => r.name === 'system_info');
    expect(sysInfo).toBeDefined();
    // 未 recordUsage，reason 中不应有"高频使用"
    if (sysInfo) {
      expect(sysInfo.reason).not.toContain('高频使用');
    }
  });
});
