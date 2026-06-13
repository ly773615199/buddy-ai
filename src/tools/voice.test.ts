/**
 * 语音工具测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVoiceTools } from './voice.js';
import type { TTSManager, TTSBackend, TTSVoice, TTSResult } from '../voice/tts.js';

// Mock TTSManager
function createMockTTSManager(): TTSManager {
  const mockBackend: TTSBackend = {
    name: 'edge',
    listVoices: () => [
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', language: 'zh-CN', gender: 'female' as const },
      { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' as const },
    ],
    isAvailable: async () => true,
    synthesize: async (text: string) => ({
      success: true,
      audioBuffer: Buffer.from('mock-audio-data'),
      format: 'mp3',
      duration: text.length * 120,
    }),
  };

  return {
    registerBackend: vi.fn(),
    setActiveBackend: vi.fn(),
    getActiveBackend: () => mockBackend,
    listBackends: () => ['edge'],
    setEnabled: vi.fn(),
    isEnabled: () => true,
    setDefaultOptions: vi.fn(),
    getVoiceForSpecies: () => null,
    synthesize: vi.fn(async (text: string, options?: any): Promise<TTSResult> => ({
      success: true,
      audioBuffer: Buffer.from('mock-audio-data'),
      format: 'mp3',
      duration: text.length * 120,
    })),
  } as unknown as TTSManager;
}

describe('voice tools', () => {
  let ttsManager: TTSManager;
  let tools: ReturnType<typeof createVoiceTools>;

  beforeEach(() => {
    ttsManager = createMockTTSManager();
    tools = createVoiceTools(ttsManager);
  });

  describe('工具注册', () => {
    it('应创建 3 个工具', () => {
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toEqual(['tts_speak', 'tts_voices', 'tts_status']);
    });

    it('每个工具应有正确的结构', () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.execute).toBeTypeOf('function');
      }
    });
  });

  describe('tts_speak', () => {
    it('应合成语音并保存文件', async () => {
      const tool = tools.find(t => t.name === 'tts_speak')!;
      const result = await tool.execute({
        text: '你好世界',
        output: '/tmp/test-buddy-tts.mp3',
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.file).toBe('/tmp/test-buddy-tts.mp3');
      expect(parsed.format).toBe('mp3');
      expect(parsed.textLength).toBe(4);
    });

    it('空文本应返回错误', async () => {
      const tool = tools.find(t => t.name === 'tts_speak')!;
      const result = await tool.execute({ text: '' });
      expect(result).toContain('文本为空');
    });

    it('应支持自定义参数', async () => {
      const tool = tools.find(t => t.name === 'tts_speak')!;
      const result = await tool.execute({
        text: '测试',
        voice: 'en-US-AriaNeural',
        rate: '+20%',
        pitch: '+5Hz',
        output: '/tmp/test-custom-voice.mp3',
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it('合成失败应返回错误信息', async () => {
      const failManager = createMockTTSManager();
      (failManager.synthesize as any).mockResolvedValue({
        success: false,
        format: 'mp3',
        error: '网络错误',
      });

      const failTools = createVoiceTools(failManager);
      const tool = failTools.find(t => t.name === 'tts_speak')!;
      const result = await tool.execute({ text: '测试' });
      expect(result).toContain('网络错误');
    });
  });

  describe('tts_voices', () => {
    it('应列出可用音色', async () => {
      const tool = tools.find(t => t.name === 'tts_voices')!;
      const result = await tool.execute({});

      expect(result).toContain('edge');
      expect(result).toContain('zh-CN-XiaoxiaoNeural');
      expect(result).toContain('en-US-AriaNeural');
      expect(result).toContain('2 个音色');
    });
  });

  describe('tts_status', () => {
    it('应返回 TTS 系统状态', async () => {
      const tool = tools.find(t => t.name === 'tts_status')!;
      const result = await tool.execute({});

      expect(result).toContain('启用: 是');
      expect(result).toContain('edge');
    });

    it('禁用状态应正确显示', async () => {
      const disabledManager = createMockTTSManager();
      (disabledManager.isEnabled as any) = () => false;

      const disabledTools = createVoiceTools(disabledManager);
      const tool = disabledTools.find(t => t.name === 'tts_status')!;
      const result = await tool.execute({});

      expect(result).toContain('启用: 否');
    });
  });
});
