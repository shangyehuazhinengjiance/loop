import mysql from 'mysql2/promise';

export type DbPool = mysql.Pool;

let pool: DbPool | null = null;

export function getPool(): DbPool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ?? 'mysql://loop:loop@localhost:3306/loop';
    pool = mysql.createPool(connectionString);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
