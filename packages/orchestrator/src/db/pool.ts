import mysql from 'mysql2/promise';

export type DbPool = mysql.Pool;

let pool: DbPool | null = null;

export function getPool(): DbPool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ?? 'mysql://loop:loop@localhost:3306/loop';
    pool = mysql.createPool({
      uri: connectionString,
      /** MySQL DATETIME 按业务时区解读（默认东八区），读出后 toISOString() 即为 UTC */
      timezone: process.env.DB_TIMEZONE ?? '+08:00',
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
