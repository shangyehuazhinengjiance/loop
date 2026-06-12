const FIVE_MINUTES_MS = 5 * 60 * 1000;

type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** 将后端 UTC ISO（或 MySQL 风格字符串）解析为 Date */
export function parseMessageTime(iso?: string): Date | null {
  if (!iso) return null;
  const raw = iso.trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const withTz = hasTz ? normalized : `${normalized}Z`;
  const d = new Date(withTz);
  return Number.isNaN(d.getTime()) ? null : d;
}

function partsInZone(d: Date, timeZone?: string): TimeParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const segments = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(segments.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(p: TimeParts): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Loop 创建时间：YYYY-MM-DD HH:mm:ss（设备本地时区） */
export function formatLoopCreatedAt(
  iso?: string,
  timeZone?: string,
): string {
  const d = parseMessageTime(iso);
  if (!d) return '';
  const p = partsInZone(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** 消息列表时间分隔（设备本地时区） */
export function formatChatTimestamp(iso?: string, timeZone?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';

  const p = partsInZone(d, timeZone);
  const n = partsInZone(new Date(), timeZone);
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

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

/** 气泡/日志行时间（设备本地时区，含秒） */
export function formatBubbleTimestamp(iso?: string, timeZone?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';

  const p = partsInZone(d, timeZone);
  const n = partsInZone(new Date(), timeZone);
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

  if (dayKey(p) === dayKey(n)) return time;
  if (p.year === n.year) {
    return `${pad(p.month)}-${pad(p.day)} ${time}`;
  }
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${time}`;
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
