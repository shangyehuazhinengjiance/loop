const FIVE_MINUTES_MS = 5 * 60 * 1000;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

export function parseMessageTime(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 将 UTC 时刻转为东八区各字段（用于展示，不修改原 Date） */
function utc8Parts(d: Date) {
  const shifted = new Date(d.getTime() + UTC8_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 顶部 Loop 创建时间：YYYY-MM-DD HH:mm:ss（东八区） */
export function formatLoopCreatedAt(iso?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';
  const p = utc8Parts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** 消息列表时间分隔（东八区） */
export function formatChatTimestamp(iso?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';

  const now = new Date();
  const p = utc8Parts(d);
  const n = utc8Parts(now);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;

  const msgDay = Date.UTC(p.year, p.month - 1, p.day);
  const today = Date.UTC(n.year, n.month - 1, n.day);
  const dayDiff = Math.round((today - msgDay) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (p.year === n.year) {
    return `${p.month}月${p.day}日 ${time}`;
  }
  return `${p.year}年${p.month}月${p.day}日 ${time}`;
}

/** 气泡内时间戳：当天 HH:mm，跨天 MM-DD HH:mm（东八区） */
export function formatBubbleTimestamp(iso?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';

  const now = new Date();
  const p = utc8Parts(d);
  const n = utc8Parts(now);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;

  const msgDay = Date.UTC(p.year, p.month - 1, p.day);
  const today = Date.UTC(n.year, n.month - 1, n.day);
  if (msgDay === today) return time;

  return `${pad(p.month)}-${pad(p.day)} ${time}`;
}

export function shouldShowTimeDivider(
  prevIso?: string,
  currentIso?: string,
): boolean {
  const current = parseMessageTime(currentIso);
  if (!current) return false;
  const prev = parseMessageTime(prevIso);
  if (!prev) return true;
  return current.getTime() - prev.getTime() >= FIVE_MINUTES_MS;
}
