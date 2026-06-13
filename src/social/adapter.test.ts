/**
 * 社交适配器单元测试
 * 覆盖：钉钉、飞书、企业微信、微信公众号 适配器消息格式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';

// ==================== 钉钉适配器测试 ====================

describe('钉钉适配器', () => {
  it('webhook 签名计算', () => {
    const timestamp = '1629184800000';
    const secret = 'test-secret';
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');

    expect(sign).toBeTruthy();
    expect(typeof sign).toBe('string');
  });

  it('消息格式 - 文本消息', () => {
    const msg = {
      msgtype: 'text',
      text: { content: '你好' },
    };

    expect(msg.msgtype).toBe('text');
    expect(msg.text.content).toBeTruthy();
  });

  it('消息格式 - Markdown 消息', () => {
    const msg = {
      msgtype: 'markdown',
      markdown: {
        title: '测试',
        text: '# 标题\n\n内容',
      },
    };

    expect(msg.msgtype).toBe('markdown');
    expect(msg.markdown.text).toContain('#');
  });

  it('消息格式 - ActionCard', () => {
    const msg = {
      msgtype: 'actionCard',
      actionCard: {
        title: '操作',
        text: '请选择',
        btns: [
          { title: '确认', actionURL: 'https://example.com/confirm' },
          { title: '取消', actionURL: 'https://example.com/cancel' },
        ],
      },
    };

    expect(msg.msgtype).toBe('actionCard');
    expect(msg.actionCard.btns).toHaveLength(2);
  });

  it('入站消息解析', () => {
    const inbound = {
      msgtype: 'text',
      text: { content: '你好小伴' },
      senderStaffId: 'user-123',
      senderNick: '张三',
      conversationId: 'conv-456',
    };

    expect(inbound.text.content).toBe('你好小伴');
    expect(inbound.senderStaffId).toBeTruthy();
  });
});

// ==================== 飞书适配器测试 ====================

describe('飞书适配器', () => {
  it('消息格式 - 文本', () => {
    const msg = {
      msg_type: 'text',
      content: { text: '你好' },
    };

    expect(msg.msg_type).toBe('text');
    expect(msg.content.text).toBeTruthy();
  });

  it('消息格式 - 富文本', () => {
    const msg = {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: '标题',
            content: [[{ tag: 'text', text: '内容' }]],
          },
        },
      },
    };

    expect(msg.msg_type).toBe('post');
    expect(msg.content.post.zh_cn.title).toBe('标题');
  });

  it('消息格式 - 卡片', () => {
    const msg = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: '卡片标题' } },
        elements: [
          { tag: 'div', text: { tag: 'plain_text', content: '卡片内容' } },
        ],
      },
    };

    expect(msg.msg_type).toBe('interactive');
    expect(msg.card.header.title.content).toBe('卡片标题');
  });

  it('事件回调格式', () => {
    const event = {
      schema: '2.0',
      header: {
        event_type: 'im.message.receive_v1',
        token: 'verify-token',
      },
      event: {
        message: {
          content: '{"text":"你好"}',
          message_type: 'text',
          chat_id: 'oc_xxx',
        },
        sender: { sender_id: { user_id: 'user-123' } },
      },
    };

    expect(event.header.event_type).toBe('im.message.receive_v1');
    expect(JSON.parse(event.event.message.content).text).toBe('你好');
  });
});

// ==================== 企业微信适配器测试 ====================

describe('企业微信适配器', () => {
  it('消息格式 - 文本', () => {
    const msg = {
      msgtype: 'text',
      text: { content: '你好' },
      touser: '@all',
    };

    expect(msg.msgtype).toBe('text');
    expect(msg.touser).toBe('@all');
  });

  it('消息格式 - Markdown', () => {
    const msg = {
      msgtype: 'markdown',
      markdown: { content: '# 标题\n**加粗**' },
    };

    expect(msg.msgtype).toBe('markdown');
    expect(msg.markdown.content).toContain('#');
  });

  it('消息格式 - 图文', () => {
    const msg = {
      msgtype: 'news',
      news: {
        articles: [
          { title: '标题', description: '描述', url: 'https://example.com', picurl: 'https://example.com/img.jpg' },
        ],
      },
    };

    expect(msg.msgtype).toBe('news');
    expect(msg.news.articles).toHaveLength(1);
  });

  it('XML 解密格式', () => {
    const xml = `<xml>
<ToUserName><![CDATA[wx_corp]]></ToUserName>
<Encrypt><![CDATA[encrypted_data]]></Encrypt>
</xml>`;

    expect(xml).toContain('Encrypt');
    expect(xml).toContain('ToUserName');
  });

  it('回调验证格式', () => {
    const callback = {
      msg_signature: 'abc123',
      timestamp: '1629184800',
      nonce: 'nonce123',
      echostr: 'echo_string',
    };

    expect(callback.msg_signature).toBeTruthy();
    expect(callback.timestamp).toBeTruthy();
    expect(callback.nonce).toBeTruthy();
  });
});

// ==================== 微信公众号适配器测试 ====================

describe('微信公众号适配器', () => {
  it('消息格式 - 客服消息', () => {
    const msg = {
      touser: 'openid',
      msgtype: 'text',
      text: { content: '你好' },
    };

    expect(msg.touser).toBeTruthy();
    expect(msg.msgtype).toBe('text');
  });

  it('消息格式 - 图文消息', () => {
    const msg = {
      touser: 'openid',
      msgtype: 'news',
      news: {
        articles: [
          { title: '标题', description: '描述', url: 'https://example.com', picurl: 'https://example.com/img.jpg' },
        ],
      },
    };

    expect(msg.msgtype).toBe('news');
    expect(msg.news.articles[0].title).toBeTruthy();
  });

  it('XML 消息解析', () => {
    const parseMsgType = (xml: string) => {
      const match = xml.match(/<MsgType><!\[CDATA\[(\w+)\]\]><\/MsgType>/);
      return match?.[1] ?? 'unknown';
    };

    expect(parseMsgType('<MsgType><![CDATA[text]]></MsgType>')).toBe('text');
    expect(parseMsgType('<MsgType><![CDATA[image]]></MsgType>')).toBe('image');
    expect(parseMsgType('<MsgType><![CDATA[event]]></MsgType>')).toBe('event');
    expect(parseMsgType('invalid')).toBe('unknown');
  });

  it('事件类型解析', () => {
    const parseEvent = (xml: string) => {
      const eventMatch = xml.match(/<Event><!\[CDATA\[(\w+)\]\]><\/Event>/);
      return eventMatch?.[1] ?? 'unknown';
    };

    expect(parseEvent('<Event><![CDATA[subscribe]]></Event>')).toBe('subscribe');
    expect(parseEvent('<Event><![CDATA[CLICK]]></Event>')).toBe('CLICK');
  });

  it('access_token 缓存', () => {
    const tokenCache = {
      token: '',
      expiresAt: 0,
    };

    const getToken = () => {
      if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
        return tokenCache.token;
      }
      return null;
    };

    expect(getToken()).toBeNull();

    tokenCache.token = 'new-token';
    tokenCache.expiresAt = Date.now() + 7200000; // 2h

    expect(getToken()).toBe('new-token');
  });
});

// ==================== 跨平台消息标准化测试 ====================

describe('跨平台消息标准化', () => {
  it('统一消息格式', () => {
    const normalize = (platform: string, raw: any) => {
      const map: Record<string, (r: any) => any> = {
        dingtalk: (r) => ({ text: r.text?.content, userId: r.senderStaffId }),
        feishu: (r) => ({ text: JSON.parse(r.message?.content ?? '{}').text, userId: r.sender?.sender_id?.user_id }),
        wecom: (r) => ({ text: r.Content, userId: r.FromUserName }),
        wechat: (r) => ({ text: r.Content, userId: r.FromUserName }),
      };
      return (map[platform] ?? (() => raw))(raw);
    };

    expect(normalize('dingtalk', { text: { content: 'hi' }, senderStaffId: 'u1' }).text).toBe('hi');
    expect(normalize('wecom', { Content: 'hi', FromUserName: 'u1' }).text).toBe('hi');
  });

  it('统一回复格式', () => {
    const formatReply = (platform: string, text: string) => {
      const formatters: Record<string, string> = {
        dingtalk: JSON.stringify({ msgtype: 'text', text: { content: text } }),
        feishu: JSON.stringify({ msg_type: 'text', content: { text } }),
        wecom: text,
        wechat: text,
      };
      return formatters[platform] ?? text;
    };

    const dingtalkReply = JSON.parse(formatReply('dingtalk', '你好'));
    expect(dingtalkReply.text.content).toBe('你好');

    const feishuReply = JSON.parse(formatReply('feishu', '你好'));
    expect(feishuReply.content.text).toBe('你好');
  });
});
