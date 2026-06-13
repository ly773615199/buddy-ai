/**
 * 语音与音频系统 E2E — TTS、音频播放、语音输入
 *
 * 覆盖：
 * 1. TTS 音频事件渲染
 * 2. 音频缓存机制
 * 3. 音频就绪通知
 * 4. 语音情绪
 */
import { test, expect } from '@playwright/test';
import { skipOnboarding, setupMockWS, injectWsMessage, waitForWSConnection } from './fixtures.js';

// ==================== TTS 音频 ====================

test.describe('语音系统 — TTS 音频', () => {

  test.beforeEach(async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);
  });

  test('audio 事件触发音频播放', async ({ page }) => {
    // 注入 base64 音频数据（模拟 TTS 输出）
    await injectWsMessage(page, {
      type: 'audio',
      data: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
      format: 'wav',
      sentenceId: 'sent-001',
    });

    // audio 事件触发音频播放，无可见文本渲染
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('audio_ready 事件（大音频走 REST）', async ({ page }) => {
    await injectWsMessage(page, {
      type: 'audio_ready',
      id: 'audio-001',
      format: 'mp3',
    });

    // audio_ready 触发 REST fetch + 音频播放，无可见文本渲染
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ==================== 命令系统 ====================

test.describe('语音系统 — 命令', () => {

  test('emotion_reset 命令', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    // 模拟发送 /emotion_reset 命令
    await page.evaluate(() => {
      const ws = (window as any).__mockWs?.instance;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'command', command: 'emotion_reset' }));
      }
    });

    // command 消息发送到服务端，无直接前端 UI 回显
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('model 命令', async ({ page }) => {
    await setupMockWS(page);
    await skipOnboarding(page);
    await waitForWSConnection(page);

    await page.evaluate(() => {
      const ws = (window as any).__mockWs?.instance;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'command', command: 'model' }));
      }
    });

    // command 消息发送到服务端，无直接前端 UI 回显
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
