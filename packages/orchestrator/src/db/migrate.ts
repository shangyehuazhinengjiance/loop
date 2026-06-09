import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getPool, closePool } from './pool.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations',
);

async function migrate(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedSet = new Set(applied.rows.map((r) => r.version));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  await closePool();
  console.log('migrations complete');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
