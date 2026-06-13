/**
 * Settings 组件测试
 * 覆盖：标签切换、LLM 配置、外观语言切换
 *
 * V3 i18n：组件直接写中文，Vite 插件构建时自动注入 t()
 * 测试中断言实际渲染的中文文本，而非 i18n key
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Settings from '../components/Settings';

// Mock i18n 模块（Settings 导入的语言注册函数）
vi.mock('../i18n/index', () => ({
  getRegisteredLanguages: () => [
    { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
  ],
  getAvailableLanguages: () => [],
  registerLanguage: vi.fn(),
  changeLanguage: vi.fn(),
}));

// 辅助：按 role 找包含指定文本的按钮
const getTabButton = (text: string) =>
  screen.getAllByRole('button').find(btn => btn.textContent?.includes(text));

describe('Settings', () => {
  const defaultProps = {
    primaryColor: '#58a6ff',
    language: 'zh-CN',
    onLanguageChange: vi.fn(),
  };

  it('应该渲染五个子标签', () => {
    render(<Settings {...defaultProps} />);
    expect(getTabButton('模型池')).toBeTruthy();
    expect(getTabButton('行为设置')).toBeTruthy();
    expect(getTabButton('外观设置')).toBeTruthy();
    expect(getTabButton('平台设置')).toBeTruthy();
    expect(getTabButton('数据管理')).toBeTruthy();
  });

  it('默认显示模型池标签（加载中状态）', () => {
    render(<Settings {...defaultProps} />);
    // 测试环境无 API → ModelsSection 显示加载中
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  describe('外观标签', () => {
    it('切换到外观标签显示主题和字体选项', () => {
      render(<Settings {...defaultProps} />);
      fireEvent.click(getTabButton('外观设置')!);
      expect(screen.getByText('主题')).toBeInTheDocument();
      expect(screen.getByText('字体大小')).toBeInTheDocument();
    });

    it('显示语言切换', () => {
      render(<Settings {...defaultProps} />);
      fireEvent.click(getTabButton('外观设置')!);
      expect(screen.getByText('语言')).toBeInTheDocument();
      // 按钮内容为 "🇨🇳 中文" / "🇺🇸 English"，用 role+name 匹配
      expect(screen.getByRole('button', { name: /中文/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /English/ })).toBeInTheDocument();
    });

    it('当前语言高亮（中文）', () => {
      render(<Settings {...defaultProps} language="zh-CN" />);
      fireEvent.click(getTabButton('外观设置')!);
      const zhBtn = screen.getByRole('button', { name: /中文/ });
      const enBtn = screen.getByRole('button', { name: /English/ });
      // 高亮按钮背景色应包含 rgba(88, 166, 255, ...) 非高亮为 rgb(33, 38, 45)
      expect(zhBtn.style.background).toContain('88, 166, 255');
      expect(enBtn.style.background).not.toContain('88, 166, 255');
    });

    it('当前语言高亮（English）', () => {
      render(<Settings {...defaultProps} language="en" />);
      fireEvent.click(getTabButton('外观设置')!);
      const zhBtn = screen.getByRole('button', { name: /中文/ });
      const enBtn = screen.getByRole('button', { name: /English/ });
      expect(enBtn.style.background).toContain('88, 166, 255');
      expect(zhBtn.style.background).not.toContain('88, 166, 255');
    });

    it('点击 English 触发 onLanguageChange', () => {
      const onLanguageChange = vi.fn();
      render(<Settings {...defaultProps} onLanguageChange={onLanguageChange} />);
      fireEvent.click(getTabButton('外观设置')!);
      fireEvent.click(screen.getByRole('button', { name: /English/ }));
      expect(onLanguageChange).toHaveBeenCalledWith('en');
    });

    it('点击中文触发 onLanguageChange', () => {
      const onLanguageChange = vi.fn();
      render(<Settings {...defaultProps} language="en" onLanguageChange={onLanguageChange} />);
      fireEvent.click(getTabButton('外观设置')!);
      fireEvent.click(screen.getByRole('button', { name: /中文/ }));
      expect(onLanguageChange).toHaveBeenCalledWith('zh-CN');
    });

    it('未传 onLanguageChange 时不报错', () => {
      render(<Settings {...defaultProps} onLanguageChange={undefined} />);
      fireEvent.click(getTabButton('外观设置')!);
      fireEvent.click(screen.getByRole('button', { name: /English/ }));
    });
  });

  describe('行为标签', () => {
    it('切换到行为标签显示回复风格和确认策略', () => {
      render(<Settings {...defaultProps} />);
      fireEvent.click(getTabButton('行为设置')!);
      expect(screen.getByText('回复风格')).toBeInTheDocument();
      expect(screen.getByText('确认策略')).toBeInTheDocument();
    });
  });

  describe('平台标签', () => {
    it('切换到平台标签显示通道列表', () => {
      render(<Settings {...defaultProps} />);
      fireEvent.click(getTabButton('平台设置')!);
      // 平台列表从 API 加载，测试环境无 API → 显示加载中
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });
  });

  describe('数据标签', () => {
    it('切换到数据标签显示导出和重置按钮', () => {
      render(<Settings {...defaultProps} />);
      fireEvent.click(getTabButton('数据管理')!);
      expect(screen.getByRole('button', { name: /导出所有数据/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /清除本地记忆/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /重置所有/ })).toBeInTheDocument();
    });
  });
});
