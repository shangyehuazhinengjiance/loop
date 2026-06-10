import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { dbQuery } from './query.js';
import { getPool, closePool } from './pool.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations',
);

function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql.replace(/--.*$/gm, '');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function migrate(): Promise<void> {
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const appliedRows = await dbQuery<{ version: string }>(
    pool,
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = splitSqlStatements(sql);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      for (const statement of statements) {
        await conn.execute(statement);
      }
      await conn.execute(
        'INSERT INTO schema_migrations (version) VALUES (?)',
        [file],
      );
      await conn.commit();
      console.log(`applied ${file}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  await closePool();
  console.log('migrations complete');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
