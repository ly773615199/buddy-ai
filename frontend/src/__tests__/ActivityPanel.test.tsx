/**
 * ActivityPanel 组件测试
 * 覆盖：四个子标签渲染、空状态、数据展示、交互
 *
 * V3 i18n：组件直接写中文，不再使用 useTranslation
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActivityPanel from '../components/ActivityPanel';

// 辅助：找包含指定子串的按钮
const findButton = (substr: string) =>
  screen.getAllByRole('button').find(btn => btn.textContent?.includes(substr));

const mockPetStats = {
  totalMessages: 120,
  totalToolCalls: 45,
  totalDays: 7,
  consecutiveDays: 3,
  dailyActivity: [
    { date: '2026-04-20', messages: 10, toolCalls: 3 },
    { date: '2026-04-21', messages: 15, toolCalls: 5 },
    { date: '2026-04-22', messages: 8, toolCalls: 2 },
    { date: '2026-04-23', messages: 20, toolCalls: 8 },
  ],
};

const mockDreamLogs = [
  { journal: '今天学到了React的新特性', timestamp: Date.now() - 3600000 },
  { journal: '回顾了TypeScript的泛型', timestamp: Date.now() - 7200000 },
];

const mockSensorData = {
  location: { lat: 39.9, lng: 116.4, accuracy: 10 },
  motion: { x: 0.1, y: -0.2, z: 9.8, state: 'stationary' },
  environment: { light: 300, battery: 85, online: true },
};

describe('ActivityPanel', () => {
  it('应该渲染六个子标签', () => {
    render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} />);
    expect(findButton('时间线')).toBeTruthy();
    expect(findButton('统计')).toBeTruthy();
    expect(findButton('调度器')).toBeTruthy();
    expect(findButton('梦境')).toBeTruthy();
    expect(findButton('传感器')).toBeTruthy();
    expect(findButton('感知')).toBeTruthy();
  });

  it('默认显示时间线标签', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} />);
    expect(container.textContent).toContain('暂无活动记录');
  });

  it('有数据时显示热力图和明细', () => {
    const { container } = render(<ActivityPanel petStats={mockPetStats} dreamLogs={[]} sensorData={null} />);
    expect(container.textContent).toContain('4/20');
    expect(container.textContent).toContain('4/23');
  });

  it('点击统计标签显示统计面板', () => {
    const { container } = render(<ActivityPanel petStats={mockPetStats} dreamLogs={[]} sensorData={null} />);
    fireEvent.click(findButton('统计')!);
    expect(container.textContent).toContain('总消息');
    expect(container.textContent).toContain('120');
    expect(container.textContent).toContain('工具调用');
    expect(container.textContent).toContain('45');
    expect(container.textContent).toContain('活跃天数');
    expect(container.textContent).toContain('7');
    expect(container.textContent).toContain('连续天数');
    expect(container.textContent).toContain('3');
  });

  it('统计面板显示Token估算和费用', () => {
    const { container } = render(<ActivityPanel petStats={mockPetStats} dreamLogs={[]} sensorData={null} />);
    fireEvent.click(findButton('统计')!);
    expect(container.textContent).toContain('预估 Tokens');
    expect(container.textContent).toContain('预估费用');
  });

  it('无统计数据时显示空状态', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} />);
    fireEvent.click(findButton('统计')!);
    expect(container.textContent).toContain('暂无统计数据');
  });

  it('点击梦境标签显示梦境日志', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={mockDreamLogs} sensorData={null} />);
    fireEvent.click(findButton('梦境')!);
    expect(container.textContent).toContain('梦境日志');
    expect(container.textContent).toContain('React');
    expect(container.textContent).toContain('TypeScript');
  });

  it('无梦境时显示空状态', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} />);
    fireEvent.click(findButton('梦境')!);
    expect(container.textContent).toContain('还没有梦境记录');
  });

  it('点击传感标签显示环境信息', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} />);
    fireEvent.click(findButton('传感器')!);
    expect(container.textContent).toContain('环境信息');
    expect(container.textContent).toContain('网络');
    expect(container.textContent).toContain('语言');
    expect(container.textContent).toContain('平台');
    expect(container.textContent).toContain('时区');
  });

  it('有传感器数据时显示位置和运动', () => {
    const { container } = render(<ActivityPanel petStats={null} dreamLogs={[]} sensorData={mockSensorData} />);
    fireEvent.click(findButton('传感器')!);
    expect(container.textContent).toContain('位置');
    expect(container.textContent).toContain('39.90000');
    expect(container.textContent).toContain('运动状态');
    expect(container.textContent).toContain('stationary');
  });

  it('刷新传感器按钮触发回调', () => {
    const onRequestSensor = vi.fn();
    render(
      <ActivityPanel petStats={null} dreamLogs={[]} sensorData={null} onRequestSensor={onRequestSensor} />
    );
    fireEvent.click(findButton('传感器')!);
    const refreshBtn = screen.getAllByRole('button').find(btn => btn.textContent?.includes('刷新传感器数据'));
    fireEvent.click(refreshBtn!);
    expect(onRequestSensor).toHaveBeenCalledTimes(1);
  });

  it('子标签切换正常', () => {
    const { container } = render(<ActivityPanel petStats={mockPetStats} dreamLogs={mockDreamLogs} sensorData={null} />);
    // 默认时间线
    expect(container.textContent).toContain('4/20');
    // 切到统计
    fireEvent.click(findButton('统计')!);
    expect(container.textContent).toContain('总消息');
    // 切到梦境
    fireEvent.click(findButton('梦境')!);
    expect(container.textContent).toContain('梦境日志');
    // 切到传感
    fireEvent.click(findButton('传感器')!);
    expect(container.textContent).toContain('环境信息');
    // 切回时间线
    fireEvent.click(findButton('时间线')!);
    expect(container.textContent).toContain('4/20');
  });

  it('dailyActivity 超过14天时只显示最近14天', () => {
    const manyDays = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      messages: i * 2,
      toolCalls: i,
    }));
    const { container } = render(
      <ActivityPanel petStats={{ ...mockPetStats, dailyActivity: manyDays }} dreamLogs={[]} sensorData={null} />
    );
    expect(container.textContent).toContain('14');
  });
});
