/**
 * 将 MySQL DATETIME / JS Date 序列化为 UTC ISO 8601（带 Z），供 API / WebSocket 下发。
 * 配合连接池 timezone 配置，确保前端可用本地时区正确展示。
 */
export function toIso8601Utc(value: Date | string | null | undefined): string {
  if (value == null) return new Date().toISOString();

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? new Date().toISOString()
      : value.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return new Date().toISOString();

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const iso = hasTz ? normalized : `${normalized}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
