from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiomysql

from app.config import get_settings
from app.db import _parse_mysql_url, split_sql_statements


async def ensure_database() -> None:
    settings = get_settings()
    cfg = _parse_mysql_url(settings.database_url)
    db_name = cfg.pop("db")
    conn = await aiomysql.connect(**cfg)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        await conn.commit()
    finally:
        conn.close()


async def migrate() -> None:
    await ensure_database()
    settings = get_settings()
    cfg = _parse_mysql_url(settings.database_url)
    conn = await aiomysql.connect(**cfg)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  version VARCHAR(255) NOT NULL,
                  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                  PRIMARY KEY (version)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
            await conn.commit()

            await cur.execute("SELECT version FROM schema_migrations ORDER BY version")
            applied = {row[0] for row in await cur.fetchall()}

            migrations_dir = Path(settings.migrations_dir)
            files = sorted(migrations_dir.glob("*.sql"))
            for file in files:
                if file.name in applied:
                    print(f"skip {file.name}")
                    continue
                sql = file.read_text(encoding="utf-8")
                for statement in split_sql_statements(sql):
                    await cur.execute(statement)
                await cur.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (file.name,),
                )
                await conn.commit()
                print(f"applied {file.name}")
    finally:
        conn.close()
    print("migrations complete")


def main() -> None:
    try:
        asyncio.run(migrate())
    except Exception as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
