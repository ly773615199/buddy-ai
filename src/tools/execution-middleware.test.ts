/**
 * execution-middleware.ts — ModelSwitcher 单元测试
 *
 * 覆盖：per-step 模型切换 / 恢复 / 异常恢复
 */
import { describe, it, expect, vi } from 'vitest';
import { ToolExecutionMiddleware, type ModelSwitcher } from './execution-middleware.js';
import type { ToolRegistry } from './registry.js';
import type { ToolDef } from '../types.js';

function mockRegistry(toolResult: string = 'ok'): ToolRegistry {
  const tool: ToolDef = {
    name: 'mock_tool',
    description: 'mock',
    parameters: { safeParse: () => ({ success: true }) } as any,
    execute: async () => toolResult,
  } as unknown as ToolDef;
  return {
    get: () => tool,
    list: () => [tool],
    register: () => {},
    registerMany: () => {},
    listForPermissions: () => [tool],
  } as unknown as ToolRegistry;
}

function failingRegistry(): ToolRegistry {
  const tool: ToolDef = {
    name: 'fail_tool',
    description: 'mock',
    parameters: { safeParse: () => ({ success: true }) } as any,
    execute: async () => { throw new Error('tool failed'); },
  } as unknown as ToolDef;
  return {
    get: () => tool,
    list: () => [tool],
    register: () => {},
    registerMany: () => {},
    listForPermissions: () => [tool],
  } as unknown as ToolRegistry;
}

describe('ModelSwitcher', () => {
  it('executorResourceId 为 model/ 前缀时调用 setModel + restore', async () => {
    const setModel = vi.fn();
    const restore = vi.fn();
    const switcher: ModelSwitcher = { setModel, restore };

    const middleware = new ToolExecutionMiddleware(mockRegistry(), {
      modelSwitcher: switcher,
    });

    const result = await middleware.execute({
      toolName: 'mock_tool',
      args: {},
      source: 'dag',
      executorResourceId: 'model/openai/gpt-4o',
    });

    expect(result.success).toBe(true);
    expect(setModel).toHaveBeenCalledWith('model/openai/gpt-4o');
    expect(restore).toHaveBeenCalled();
  });

  it('executorResourceId 无 model/ 前缀时不触发切换', async () => {
    const setModel = vi.fn();
    const restore = vi.fn();
    const switcher: ModelSwitcher = { setModel, restore };

    const middleware = new ToolExecutionMiddleware(mockRegistry(), {
      modelSwitcher: switcher,
    });

    await middleware.execute({
      toolName: 'mock_tool',
      args: {},
      source: 'dag',
      executorResourceId: 'skill/code_analysis',
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('无 executorResourceId 时不触发切换', async () => {
    const setModel = vi.fn();
    const restore = vi.fn();
    const switcher: ModelSwitcher = { setModel, restore };

    const middleware = new ToolExecutionMiddleware(mockRegistry(), {
      modelSwitcher: switcher,
    });

    await middleware.execute({
      toolName: 'mock_tool',
      args: {},
      source: 'dag',
    });

    expect(setModel).not.toHaveBeenCalled();
  });

  it('工具执行失败时也调用 restore', async () => {
    const setModel = vi.fn();
    const restore = vi.fn();
    const switcher: ModelSwitcher = { setModel, restore };

    const middleware = new ToolExecutionMiddleware(failingRegistry(), {
      modelSwitcher: switcher,
    });

    const result = await middleware.execute({
      toolName: 'fail_tool',
      args: {},
      source: 'dag',
      executorResourceId: 'model/openai/gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(setModel).toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
  });

  it('无 modelSwitcher 时不崩溃', async () => {
    const middleware = new ToolExecutionMiddleware(mockRegistry());

    const result = await middleware.execute({
      toolName: 'mock_tool',
      args: {},
      source: 'dag',
      executorResourceId: 'model/openai/gpt-4o',
    });

    expect(result.success).toBe(true);
  });
});
