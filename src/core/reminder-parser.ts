/**
 * ReminderParser — 自然语言提醒解析器
 *
 * 将自然语言转换为 Reminder 触发条件：
 *   "30 分钟后提醒我喝水" → { type: 'once', at: now + 30min }
 *   "明天 10 点提醒我开会" → { type: 'once', at: tomorrow 10:00 }
 *   "每周五下午提醒我写周报" → { type: 'recurring', cron: '0 14 * * 5' }
 *
 * 优先用正则快速匹配，复杂表达 fallback 到 LLM。
 */

// ==================== 类型 ====================

export interface ParsedReminder {
  /** 提取的提醒内容 */
  content: string;
  /** 触发时间（一次性） */
  at?: number;
  /** cron 表达式（循环） */
  cron?: string;
  /** 模式名（规律触发） */
  pattern?: string;
  /** 触发类型 */
  triggerType: 'once' | 'recurring' | 'pattern';
  /** 原始文本 */
  raw: string;
}

type LLMCaller = (messages: Array<{ role: string; content: string }>) => Promise<string>;

// ==================== 工具 ====================

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function getNextWeekday(from: Date, targetDay: number): Date {
  const d = new Date(from);
  const diff = (targetDay - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function setTime(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const WEEKDAY_MAP: Record<string, number> = {
  '日': 0, '天': 0, '周日': 0, '星期天': 0, '星期日': 0,
  '一': 1, '周一': 1, '星期一': 1,
  '二': 2, '周二': 2, '星期二': 2,
  '三': 3, '周三': 3, '星期三': 3,
  '四': 4, '周四': 4, '星期四': 4,
  '五': 5, '周五': 5, '星期五': 5,
  '六': 6, '周六': 6, '星期六': 6,
  'monday': 1, 'tuesday': 2, 'wednesday': 3,
  'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0,
};

// ==================== 正则解析 ====================

/** 从文本中提取提醒的"事"（去掉"提醒我"前缀） */
function extractContent(text: string): string {
  // 移除触发短语，保留实际内容
  return text
    .replace(/^(请|帮我|到时候)?(提醒|通知|别忘了|记得|到时候)(我|咱们)?[:：,，]?\s*/i, '')
    .trim();
}

/** "X 分钟/小时后" */
function parseRelativeTime(text: string, now: number): number | null {
  const m = text.match(/(\d+)\s*(分钟|小时|天|秒|min|hour|day|sec)\s*(后|之后|以后)?/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case '秒': case 'sec': return now + n * 1000;
    case '分钟': case 'min': return now + n * MINUTE;
    case '小时': case 'hour': return now + n * HOUR;
    case '天': case 'day': return now + n * DAY;
    default: return null;
  }
}

/** "明天/后天 X 点" — 要求至少有日期前缀或时段前缀，避免匹配 "每天/每周" 模式 */
function parseDayTime(text: string, now: number): number | null {
  // 排除 "每天/每周/每个星期" 等循环模式
  if (/每(?:天|周|个(?:星期|礼拜))/.test(text)) return null;

  const m = text.match(/(明天|后天|大后天)?\s*(上午|下午|早上|晚上|中午)?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2})?\s*(半)?/);
  if (!m) return null;

  // 至少需要日期前缀或时段前缀，否则可能是无意义匹配
  if (!m[1] && !m[2]) return null;

  let dayOffset = m[1] === '大后天' ? 3 : m[1] === '后天' ? 2 : m[1] === '明天' ? 1 : 0;
  let hour = parseInt(m[3], 10);
  const minute = m[5] ? 30 : (m[4] ? parseInt(m[4], 10) : 0);

  // 下午/晚上 → 12+ 小时
  if (m[2] && (m[2].includes('下午') || m[2].includes('晚上')) && hour < 12) {
    hour += 12;
  }
  if (m[2] === '中午' && hour === 12) { /* 保持 12 */ }

  const target = new Date(now + dayOffset * DAY);
  const result = setTime(target, hour, minute).getTime();

  // 无日期前缀且目标时间已过 → 自动翻到明天
  if (!m[1] && result <= now) {
    return setTime(new Date(now + DAY), hour, minute).getTime();
  }
  return result;
}

/** "周X 上午/下午" — 支持 "每周五" / "每周星期五" / "每个星期五" / "每周礼拜五" */
function parseWeeklyTime(text: string, now: number): { cron: string } | null {
  const m = text.match(/每(?:周|个(?:星期|礼拜))\s*(?:星期|礼拜)?\s*([一二三四五六日天]|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(上午|下午|早上|晚上|中午)?\s*(\d{1,2})?\s*[点时]?/i);
  if (!m) return null;

  const dayKey = m[1].toLowerCase();
  const dow = WEEKDAY_MAP[dayKey];
  if (dow === undefined) return null;

  // "下午" 无具体小时 → 默认 14:00，有小时 → +12
  let hour = m[3] ? parseInt(m[3], 10) : (m[2] ? 14 : 9);
  if (m[2] && m[3] && (m[2].includes('下午') || m[2].includes('晚上')) && hour < 12) {
    hour += 12;
  }

  return { cron: `0 ${hour} * * ${dow}` };
}

/** "每天 X 点" */
function parseDailyTime(text: string): { cron: string } | null {
  const m = text.match(/每天\s*(上午|下午|早上|晚上|中午)?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2})?/);
  if (!m) return null;

  let hour = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;
  if (m[1] && (m[1].includes('下午') || m[1].includes('晚上')) && hour < 12) {
    hour += 12;
  }

  return { cron: `${minute} ${hour} * * *` };
}

// ==================== 主解析函数 ====================

/**
 * 用正则快速解析提醒文本
 * 返回 null 表示需要 fallback 到 LLM
 */
export function parseReminderFast(text: string, now = Date.now()): ParsedReminder | null {
  const content = extractContent(text);
  if (!content && !text.match(/提醒|通知|别忘了|记得/)) return null;

  // 1. "X 分钟/小时后"
  const relativeAt = parseRelativeTime(text, now);
  if (relativeAt) {
    return { content: content || '提醒', at: relativeAt, triggerType: 'once', raw: text };
  }

  // 2. "明天 10 点" / "后天下午 3 点"
  const dayTimeAt = parseDayTime(text, now);
  if (dayTimeAt && dayTimeAt > now) {
    return { content: content || '提醒', at: dayTimeAt, triggerType: 'once', raw: text };
  }

  // 3. "每周五下午" (循环)
  const weekly = parseWeeklyTime(text, now);
  if (weekly) {
    return { content: content || '提醒', cron: weekly.cron, triggerType: 'recurring', raw: text };
  }

  // 4. "每天 X 点" (循环)
  const daily = parseDailyTime(text);
  if (daily) {
    return { content: content || '提醒', cron: daily.cron, triggerType: 'recurring', raw: text };
  }

  // 5. 明确的日期时间 "4月25日 10点" / "2026-04-25 10:00"
  const dateMatch = text.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})[日号]?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2})?/);
  if (dateMatch) {
    const d = new Date(
      parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]),
      parseInt(dateMatch[4]), dateMatch[5] ? parseInt(dateMatch[5]) : 0,
    );
    if (d.getTime() > now) {
      return { content: content || '提醒', at: d.getTime(), triggerType: 'once', raw: text };
    }
  }

  return null;
}

/**
 * 用 LLM 解析复杂表达
 */
export async function parseReminderLLM(text: string, callLLM: LLMCaller, now = Date.now()): Promise<ParsedReminder | null> {
  const nowStr = new Date(now).toISOString();
  const prompt = `你是提醒时间解析器。当前时间: ${nowStr}

用户说: "${text}"

请提取：
1. 提醒内容（去掉"提醒我"等前缀）
2. 触发时间（ISO 8601 格式，一次性）或 cron 表达式（循环）

JSON 格式返回：
{"content": "...", "at": "ISO时间", "type": "once"}
或
{"content": "...", "cron": "MIN HOUR DOM MON DOW", "type": "recurring"}

只返回 JSON，不要其他文字。`;

  try {
    const response = await callLLM([
      { role: 'system', content: '你是时间解析器，只返回 JSON。' },
      { role: 'user', content: prompt },
    ]);

    // 提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.type === 'once' && parsed.at) {
      const at = new Date(parsed.at).getTime();
      if (at > now) {
        return { content: parsed.content || '提醒', at, triggerType: 'once', raw: text };
      }
    } else if (parsed.type === 'recurring' && parsed.cron) {
      return { content: parsed.content || '提醒', cron: parsed.cron, triggerType: 'recurring', raw: text };
    }
  } catch {
    // LLM 解析失败
  }

  return null;
}

/**
 * 组合解析：先正则，失败再 LLM
 */
export async function parseReminder(
  text: string,
  callLLM?: LLMCaller,
  now = Date.now(),
): Promise<ParsedReminder | null> {
  // 1. 快速正则
  const fast = parseReminderFast(text, now);
  if (fast) return fast;

  // 2. LLM fallback
  if (callLLM) {
    return parseReminderLLM(text, callLLM, now);
  }

  return null;
}
