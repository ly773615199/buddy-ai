import { Component, type ReactNode, type ErrorInfo } from 'react';
import { t } from '../i18n/index';

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 12,
          color: '#8b949e',
          textAlign: 'center',
          minHeight: 200
        }}>
          <div style={{ fontSize: 32 }}>😵</div>
          <div style={{ color: '#c9d1d9', fontWeight: 600 }}>
            {this.props.name ? `${this.props.name} ` : ''}{"\u51FA\u9519\u4E86"}
          </div>
          <div style={{ fontSize: 12, maxWidth: 300, wordBreak: 'break-all' }}>
            {this.state.error?.message || "\u672A\u77E5\u9519\u8BEF"}
          </div>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 8,
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid #30363d',
              background: '#21262d',
              color: '#58a6ff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13
            }}>
            {"\uD83D\uDD04 \u5237\u65B0\u91CD\u8BD5"}</button>
        </div>);

    }
    return this.props.children;
  }
}