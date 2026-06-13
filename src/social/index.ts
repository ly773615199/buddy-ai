/**
 * 社交模块 — 统一入口
 */
export { FriendSystem } from './friends.js';
export type { Friend, FriendStatus, FriendRequest } from './friends.js';

export { BuddyInteractionSystem } from './buddy-interact.js';
export type { BuddyProfile, BuddyVisit, VisitInteraction, BuddyConversation, LeaderboardEntry, LeaderboardMetric } from './buddy-interact.js';

export { PlatformManager, CLIAdapter, TelegramAdapter, DiscordAdapter } from './platform.js';
export type { PlatformType, PlatformMessage, PlatformCapabilities, PlatformAdapter, SendOptions } from './platform.js';

export { FeishuAdapter } from './feishu-adapter.js';
export type { FeishuConfig } from './feishu-adapter.js';

export { WeComAdapter } from './wecom-adapter.js';
export type { WeComConfig } from './wecom-adapter.js';
export { WeComCrypto } from './wecom-crypto.js';

export { WeChatMPAdapter } from './wechat-mp-adapter.js';
export type { WeChatMPConfig } from './wechat-mp-adapter.js';

export { DingTalkAdapter } from './dingtalk-adapter.js';
export type { DingTalkConfig } from './dingtalk-adapter.js';
