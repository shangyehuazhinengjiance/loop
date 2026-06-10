import { randomUUID } from 'node:crypto';
import type { DbPool } from './pool.js';

/** mysql2 execute 接受的参数类型 */
export type SqlParam = string | number | boolean | Date | Buffer | null;
export type SqlParams = SqlParam[];

export async function dbQuery<T>(
  pool: DbPool,
  sql: string,
  params: SqlParams = [],
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function dbQueryOne<T>(
  pool: DbPool,
  sql: string,
  params: SqlParams = [],
): Promise<T | null> {
  const rows = await dbQuery<T>(pool, sql, params);
  return rows[0] ?? null;
}

/** MySQL JSON 列有时返回字符串，统一解析为对象 */
export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export async function insertReturning<T extends { id: string }>(
  pool: DbPool,
  table: string,
  columns: string[],
  values: SqlParams,
): Promise<T> {
  const id = randomUUID();
  const cols = ['id', ...columns];
  const vals = [id, ...values];
  const colList = cols.map((c) => `\`${c}\``).join(', ');
  const placeholders = cols.map(() => '?').join(', ');

  await pool.execute(
    `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`,
    vals,
  );

  const row = await dbQueryOne<T>(pool, `SELECT * FROM \`${table}\` WHERE id = ?`, [
    id,
  ]);
  if (!row) throw new Error(`insertReturning failed for ${table}`);
  return row;
}

export async function updateReturning<T extends { id: string }>(
  pool: DbPool,
  table: string,
  setSql: string,
  id: string,
  params: SqlParams,
): Promise<T> {
  await pool.execute(`UPDATE \`${table}\` SET ${setSql} WHERE id = ?`, [
    ...params,
    id,
  ]);
  const row = await dbQueryOne<T>(pool, `SELECT * FROM \`${table}\` WHERE id = ?`, [
    id,
  ]);
  if (!row) throw new Error(`updateReturning failed for ${table} id=${id}`);
  return row;
}
