/**
 * 感知事件总线 — 统一感知事件通道
 *
 * 当前使用中：
 * - 用户交互事件 → PerceptionBridge → 情绪 Buff 注入（agent.ts 每次消息调用）
 * - 感知→情绪映射管线（PerceptionBridge 订阅 onPerception）
 *
 * 扩展预留：摄像头/麦克风/位置传感器（桌面端/移动端）
 *
 * Phase A Week 4 — 所有感知事件的统一通道
 * 前端/后端感知模块 → 事件总线 → Agent 上下文 / 情绪引擎 / 前端渲染
 */

import { EventEmitter } from 'events';
import type { PerceptionEvent, PerceptionCategory } from './types.js';

type EventCallback = (event: PerceptionEvent) => void;

export class PerceptionEventBus extends EventEmitter {
  private history: PerceptionEvent[] = [];
  private maxHistory: number;
  private idCounter = 0;

  constructor(maxHistory = 500) {
    super();
    this.maxHistory = maxHistory;
  }

  /**
   * 发布感知事件
   */
  publish(category: PerceptionCategory, source: PerceptionEvent['source'], data: unknown, metadata?: Record<string, unknown>): PerceptionEvent {
    const event: PerceptionEvent = {
      id: `pev-${++this.idCounter}-${Date.now()}`,
      category,
      source,
      timestamp: Date.now(),
      data,
      metadata,
    };

    // 存入历史
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // 广播
    this.emit('perception', event);
    this.emit(`perception:${category}`, event);
    this.emit(`perception:${source}`, event);

    return event;
  }

  /**
   * 订阅所有感知事件
   */
  onPerception(callback: EventCallback): () => void {
    this.on('perception', callback);
    return () => this.off('perception', callback);
  }

  /**
   * 按类别订阅
   */
  onCategory(category: PerceptionCategory, callback: EventCallback): () => void {
    this.on(`perception:${category}`, callback);
    return () => this.off(`perception:${category}`, callback);
  }

  /**
   * 按来源订阅
   */
  onSource(source: PerceptionEvent['source'], callback: EventCallback): () => void {
    this.on(`perception:${source}`, callback);
    return () => this.off(`perception:${source}`, callback);
  }

  /**
   * 获取最近的感知事件
   */
  getRecent(count = 20, category?: PerceptionCategory): PerceptionEvent[] {
    const filtered = category
      ? this.history.filter(e => e.category === category)
      : this.history;
    return filtered.slice(-count);
  }

  /**
   * 获取时间范围内的事件
   */
  getInTimeRange(startMs: number, endMs: number, category?: PerceptionCategory): PerceptionEvent[] {
    return this.history.filter(e => {
      if (e.timestamp < startMs || e.timestamp > endMs) return false;
      if (category && e.category !== category) return false;
      return true;
    });
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byCategory: Record<string, number>; bySource: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const e of this.history) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    return { total: this.history.length, byCategory, bySource };
  }
}

// 全局单例
let _instance: PerceptionEventBus | null = null;

export function getPerceptionEventBus(): PerceptionEventBus {
  if (!_instance) {
    _instance = new PerceptionEventBus();
  }
  return _instance;
}
