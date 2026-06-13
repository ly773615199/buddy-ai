# 多通道扩展计划 — 飞书 / 企业微信 / 钉钉 / 微信公众号

> 让 Buddy 住进中国用户日常使用的每一个聊天工具

## 背景

Buddy 现有通道：CLI + Telegram + Discord + Web + Chrome。

**问题**：中国用户日常用的是微信、飞书、钉钉——这三个一个都没有。一个住不进这些平台的 Buddy，对中国用户来说等于不存在。

## 目标

```
Phase 1（P0）：飞书 + 企业微信     → 覆盖企业/团队用户 + 个人微信入口
Phase 2（P1）：微信公众号           → 覆盖个人用户
Phase 3（P2）：钉钉                 → 覆盖阿里生态用户
```

## 架构

所有新通道都实现统一的 `PlatformAdapter` 接口，即插即用：

```
PlatformManager
  ├─ CLIAdapter        ✅ 已有
  ├─ TelegramAdapter   ✅ 已有
  ├─ DiscordAdapter    ✅ 已有
  ├─ FeishuAdapter     ← Phase 1 新建
  ├─ WeComAdapter      ← Phase 1 新建
  ├─ WeChatMPAdapter   ← Phase 2 新建
  └─ DingTalkAdapter   ← Phase 3 新建
```

```
消息流（所有通道统一）：

用户发消息
  ↓
平台 Webhook 推送到 Buddy
  ↓
Adapter.onMessage(callback)
  ↓
Agent.chat() 处理
  ↓
Adapter.send() 回复
```

---

## Phase 1: 飞书 + 企业微信（P0，3 天）

### Task 1.1: 飞书 Adapter

- **文件**: `src/social/feishu-adapter.ts`（新建）
- **依赖**: 无（原生 fetch，不引入 SDK）

#### 前提条件

| 项目 | 获取方式 |
|------|---------|
| 飞书账号 | open.feishu.cn 注册 |
| 自建应用 | 管理后台 → 创建应用 → 添加"机器人"能力 |
| App ID + App Secret | 创建应用后自动生成 |
| 事件订阅 URL | `https://你的域名/feishu/webhook` |
| 权限 | `im:message`（收发消息）、`im:chat`（群聊） |

#### 实现

```typescript
export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: true,
    richContent: true,   // 飞书卡片
    reactions: true,
    buttons: true,       // 飞书消息卡片按钮
    files: true,
    voice: true,         // 语音消息
    images: true,
    threads: false,
  };

  private appId: string;
  private appSecret: string;
  private token: string = '';           // tenant_access_token
  private tokenExpireAt: number = 0;
  private webhookPort: number;

  // 核心接口
  async connect(): Promise<void> {
    // 1. 获取 tenant_access_token
    // 2. 启动 Webhook 服务接收飞书推送
  }

  async send(message: string, options?: SendOptions): Promise<void> {
    // POST https://open.feishu.cn/open-apis/im/v1/messages
    // receive_id_type: "chat_id"
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    // Webhook 收到消息后调用 callback
  }
}
```

#### 飞书 API 速查

```
获取 token:
  POST /open-apis/auth/v3/tenant_access_token/internal
  Body: { app_id, app_secret }
  → { tenant_access_token, expire }

发送消息:
  POST /open-apis/im/v1/messages?receive_id_type=chat_id
  Headers: { Authorization: Bearer {token} }
  Body: {
    receive_id: "oc_xxx",      // chat_id
    msg_type: "text",          // text / post / interactive / image / file
    content: '{"text":"Hello"}'
  }

接收消息（事件订阅）:
  飞书推送 POST 到你的 Webhook URL
  Body: {
    schema: "2.0",
    header: { event_type: "im.message.receive_v1" },
    event: {
      message: {
        chat_id: "oc_xxx",
        content: '{"text":"用户说的话"}',
        message_type: "text"
      },
      sender: { sender_id: { user_id: "xxx" } }
    }
  }

回复消息:
  POST /open-apis/im/v1/messages/{message_id}/reply
  Body: { msg_type: "text", content: '{"text":"回复"}' }
```

#### 回调验证（Challenge）

```
飞书首次配置事件订阅时会发一个 challenge 请求：
  POST /feishu/webhook
  Body: { challenge: "xxx", type: "url_verification" }

需要原样返回：
  Response: { challenge: "xxx" }
```

---

### Task 1.2: 企业微信 Adapter

- **文件**: `src/social/wecom-adapter.ts`（新建）
- **依赖**: 无（原生 fetch + Node.js crypto）

#### 前提条件

| 项目 | 获取方式 |
|------|---------|
| 企业微信管理员账号 | work.weixin.qq.com 注册企业 |
| 自建应用 | 管理后台 → 应用管理 → 自建 |
| CorpID | 我的企业 → 企业信息 |
| AgentID | 创建应用后生成 |
| Secret | 创建应用后生成 |
| 回调配置 | URL + Token + EncodingAESKey（自动生成） |

#### 实现

```typescript
export class WeComAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: false,     // 企微不支持原生 markdown
    richContent: true,   // 图文消息
    reactions: false,
    buttons: true,       // 菜单按钮
    files: true,
    voice: true,
    images: true,
    threads: false,
  };

  private corpId: string;
  private agentId: number;
  private secret: string;
  private token: string;            // 回调验证 Token
  private encodingAESKey: string;   // 消息加解密密钥
  private accessToken: string = '';
  private accessTokenExpireAt: number = 0;

  async connect(): Promise<void> {
    // 1. 获取 access_token
    // 2. 启动回调服务
  }

  async send(message: string, options?: SendOptions): Promise<void> {
    // POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=xxx
    // touser: "UserID1|UserID2"  (用 | 分隔多个用户)
  }

  onMessage(callback: (msg: PlatformMessage) => void): void {
    // 回调收到消息后调用 callback
  }
}
```

#### 企微 API 速查

```
获取 token:
  GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
  → { access_token, expires_in }

发送消息:
  POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=xxx
  Body: {
    touser: "UserID1|UserID2",   // 用 | 分隔，最多 1000 人
    msgtype: "text",
    agentid: 1000002,
    text: { content: "消息内容" }
  }

接收消息（回调）:
  首次验证: GET /wecom/callback?msg_signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
  后续消息: POST /wecom/callback?msg_signature=xxx&timestamp=xxx&nonce=xxx
  Body: 加密的 XML（需要 AES 解密）

消息加解密:
  企微消息是 AES-256-CBC 加密的
  解密流程：
  1. 从 URL 取 msg_signature、timestamp、nonce
  2. 从 Body 取 Encrypt 字段
  3. SHA1(sort(token, timestamp, nonce, encrypt)) == msg_signature 验签
  4. AES-256-CBC 解密 Encrypt → 明文 XML
  5. 解析 XML → 拿到 Content、FromUserName 等
```

#### 企微加解密模块

```typescript
// 需要实现的加解密工具
class WeComCrypto {
  constructor(private token: string, private encodingAESKey: string) {}

  // 解密消息
  decrypt(encrypt: string): string {
    // 1. Base64 解码 EncodingAESKey → AES Key (32 bytes)
    // 2. AES Key 前 16 bytes 作为 IV
    // 3. AES-256-CBC 解密
    // 4. 去 PKCS7 Padding
    // 5. 取前 4 bytes = msgLen (big-endian)
    // 6. 取 msgLen bytes = 明文
    // 7. 剩余 = CorpID
  }

  // 加密消息
  encrypt(reply: string): string {
    // 反向操作
  }

  // 验证签名
  verify(timestamp: string, nonce: string, encrypt: string, signature: string): boolean {
    // SHA1(sort([token, timestamp, nonce, encrypt])) === signature
  }
}
```

---

### Task 1.3: 配置支持

- **文件**: `src/config.ts`
- **改动**: 新增飞书和企微的配置字段

```json
{
  "platforms": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "webhookPort": 9876
    },
    "wecom": {
      "enabled": true,
      "corpId": "wwxxx",
      "agentId": 1000002,
      "secret": "xxx",
      "token": "xxx",
      "encodingAESKey": "xxx",
      "webhookPort": 9877
    }
  }
}
```

---

### Task 1.4: Subsystems 初始化

- **文件**: `src/core/subsystems.ts`
- **改动**: 按配置初始化飞书/企微 Adapter（和 Telegram/Discord 同模式）

```typescript
// --- 飞书 ---
if (config.platforms?.feishu?.enabled) {
  const feishuAdapter = new FeishuAdapter(config.platforms.feishu);
  this.platformManager.register(feishuAdapter);
  feishuAdapter.connect().catch(err => {
    if (verbose) console.warn('[Platform] 飞书连接失败:', err.message);
  });
}

// --- 企业微信 ---
if (config.platforms?.wecom?.enabled) {
  const wecomAdapter = new WeComAdapter(config.platforms.wecom);
  this.platformManager.register(wecomAdapter);
  wecomAdapter.connect().catch(err => {
    if (verbose) console.warn('[Platform] 企微连接失败:', err.message);
  });
}
```

---

### Task 1.5: 测试

- **文件**: `src/social/feishu-adapter.test.ts`（新建）
- **文件**: `src/social/wecom-adapter.test.ts`（新建）
- **覆盖**:
  - token 获取/刷新
  - 消息发送（mock fetch）
  - 消息接收（模拟 Webhook 推送）
  - 企微加解密
  - 回调 challenge 验证
  - 断线重连

---

## Phase 2: 微信公众号（P1，2 天）

### Task 2.1: 公众号 Adapter

- **文件**: `src/social/wechat-mp-adapter.ts`（新建）

#### 前提条件

| 项目 | 获取方式 |
|------|---------|
| 公众号（服务号或订阅号） | mp.weixin.qq.com 注册 |
| 服务器配置 | 后台 → 设置与开发 → 基本配置 |
| AppID + AppSecret | 同上 |
| Token + EncodingAESKey | 服务器配置时自定义 |

#### 实现

```typescript
export class WeChatMPAdapter implements PlatformAdapter {
  readonly platform = 'wechat_mp' as const;
  readonly capabilities: PlatformCapabilities = {
    markdown: false,
    richContent: false,   // 公众号只支持纯文本+图片
    reactions: false,
    buttons: false,
    files: false,         // 受限
    voice: true,          // 语音识别
    images: true,
    threads: false,
  };

  // 被动回复（5 秒内响应）
  // 用户发消息 → Webhook → Buddy 处理 → 直接在 HTTP Response 里返回 XML

  // 主动推送（模板消息 / 客服消息）
  // POST https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=xxx
}
```

#### 公众号限制

```
被动回复：
  ✅ 用户发消息后 5 秒内回复
  ✅ 支持文本/图片/语音/视频/图文
  ⚠️ 超过 5 秒没回复，需要通过客服消息补发

主动推送：
  ⚠️ 服务号：每月 4 次群发
  ⚠️ 订阅号：每天 1 次群发
  ⚠️ 客服消息：用户 48 小时内有交互才能发

结论：公众号适合"被动模式"（用户找 Buddy），不适合"主动模式"（Buddy 找用户）
```

### Task 2.2: 公众号加解密

- **文件**: `src/social/wechat-crypto.ts`（新建）
- **说明**: 微信消息加解密和企微类似但不完全相同

### Task 2.3: 48 小时交互窗口管理

- **文件**: `src/social/wechat-mp-adapter.ts`
- **改动**: 记录用户最后交互时间，48 小时内可用客服消息主动推送

---

## Phase 3: 钉钉（P2，2 天）

### Task 3.1: 钉钉 Adapter

- **文件**: `src/social/dingtalk-adapter.ts`（新建）

#### 前提条件

| 项目 | 获取方式 |
|------|---------|
| 钉钉开放平台账号 | open.dingtalk.com 注册 |
| 企业内部应用 | 开发者后台 → 创建应用 |
| AppKey + AppSecret | 创建应用后生成 |
| Robot Webhook | 应用能力 → 机器人 |

#### 钉钉 API 速查

```
获取 token:
  POST https://api.dingtalk.com/v1.0/oauth2/accessToken
  Body: { appKey, appSecret }
  → { accessToken, expireIn }

发送消息:
  POST https://api.dingtalk.com/v1.0/robot/groupMessages/send
  Headers: { x-acs-dingtalk-access-token: {token} }
  Body: {
    msgParam: JSON.stringify({ content: "消息内容" }),
    msgKey: "sampleText",
    openConversationId: "cidxxx",
    robotCode: "xxx"
  }

接收消息（Stream 模式，推荐）:
  钉钉支持 Stream 模式长连接（不需要公网地址）
  使用 @openim/dingtalk SDK 建立长连接
```

#### 钉钉 Stream 模式（无需公网地址）

```
优势：不需要公网地址、不需要 HTTPS、不需要回调验证
实现：使用钉钉官方 SDK 建立 WebSocket 长连接

import { ChatbotMessageClient } from '@openim/dingtalk';

const client = new ChatbotMessageClient({
  clientId: 'xxx',    // AppKey
  clientSecret: 'xxx' // AppSecret
});

client.registerCallback(async (message) => {
  // 收到消息
  const { text, senderStaffId, conversationId } = message;
  // 处理后回复
});
```

---

## 向后兼容

- 不配置新通道时，行为与当前完全一致
- 现有 CLI / Telegram / Discord / Web 不受影响
- 新通道都是可选的，按配置启用

## 文件变更清单

| 文件 | 操作 | Phase | 说明 |
|------|------|-------|------|
| `src/social/feishu-adapter.ts` | 新建 | 1 | 飞书 Adapter |
| `src/social/wecom-adapter.ts` | 新建 | 1 | 企业微信 Adapter |
| `src/social/wecom-crypto.ts` | 新建 | 1 | 企微消息加解密 |
| `src/types.ts` | 修改 | 1 | 新增飞书/企微配置类型 |
| `src/config.ts` | 修改 | 1 | 配置字段 |
| `src/core/subsystems.ts` | 修改 | 1 | 初始化 Adapter |
| `src/social/feishu-adapter.test.ts` | 新建 | 1 | 测试 |
| `src/social/wecom-adapter.test.ts` | 新建 | 1 | 测试 |
| `src/social/wechat-mp-adapter.ts` | 新建 | 2 | 微信公众号 Adapter |
| `src/social/wechat-crypto.ts` | 新建 | 2 | 公众号加解密 |
| `src/social/wechat-mp-adapter.test.ts` | 新建 | 2 | 测试 |
| `src/social/dingtalk-adapter.ts` | 新建 | 3 | 钉钉 Adapter |
| `src/social/dingtalk-adapter.test.ts` | 新建 | 3 | 测试 |
| `CHANNEL_EXPANSION_PLAN.md` | 新建 | — | 本计划文档 |

## 通道能力对比

| 能力 | 飞书 | 企微 | 公众号 | 钉钉 |
|------|------|------|--------|------|
| 文本消息 | ✅ | ✅ | ✅ | ✅ |
| 富文本/卡片 | ✅ | ⚠️ 图文 | ❌ | ✅ |
| 图片 | ✅ | ✅ | ✅ | ✅ |
| 文件 | ✅ | ✅ | ❌ | ✅ |
| 语音 | ✅ | ✅ | ✅ 识别 | ✅ |
| Reaction | ✅ | ❌ | ❌ | ✅ |
| 按钮/菜单 | ✅ | ✅ | ❌ | ✅ |
| 主动推送 | ✅ | ✅ | ⚠️ 受限 | ✅ |
| 群聊 | ✅ | ✅ | ❌ | ✅ |
| 私聊 | ✅ | ✅ | ✅ | ✅ |
| 需要公网地址 | ✅ | ✅ | ✅ | ❌ Stream |
| 接入难度 | ⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐ |

## 开发优先级总结

| 优先级 | 通道 | 时间 | 原因 |
|--------|------|------|------|
| **P0** | 飞书 | 1-2 天 | API 完善，接入最简单，覆盖企业用户 |
| **P0** | 企业微信 | 2 天 | 覆盖企业用户 + 个人微信互通入口 |
| **P1** | 微信公众号 | 2 天 | 个人用户入口，功能受限但合规 |
| **P2** | 钉钉 | 2 天 | 阿里生态，Stream 模式无需公网 |

## 验收标准

1. **飞书**：自建应用配置好后，能正常收发私聊/群聊消息
2. **企业微信**：自建应用配置好后，能正常收发私聊/群聊消息
3. **微信公众号**：关注公众号后，能正常对话（被动回复 < 5 秒）
4. **钉钉**：Stream 模式连接成功，能正常收发消息
5. **统一接口**：所有通道通过 `PlatformManager` 统一管理，Agent 代码零改动
6. **现有测试**：`npm run test` 全部通过
