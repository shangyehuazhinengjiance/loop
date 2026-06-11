const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function parseMessageTime(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
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

export function formatChatTimestamp(iso?: string): string {
  const d = parseMessageTime(iso);
  if (!d) return '';

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfMsg.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}
