from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiomysql
from pymysql.err import OperationalError

from app.config import get_settings
from app.db import _parse_mysql_url, split_sql_statements

MIGRATE_LOCK_NAME = "loop_v2_schema_migrate"


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


async def _has_table(cur: aiomysql.Cursor, table: str) -> bool:
    await cur.execute("SHOW TABLES LIKE %s", (table,))
    return await cur.fetchone() is not None


async def _baseline_existing_schema(
    cur: aiomysql.Cursor,
    files: list[Path],
    applied: set[str],
) -> set[str]:
    """DB 已有 v2 表但 schema_migrations 无记录时（Job 与启动并发等），补登记。"""
    if applied:
        return applied
    if not await _has_table(cur, "projects"):
        return applied

    for file in files:
        if file.name in applied:
            continue
        await cur.execute(
            "INSERT INTO schema_migrations (version) VALUES (%s)",
            (file.name,),
        )
        applied.add(file.name)
        print(f"baseline {file.name} (schema already present)")
    return applied


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

            await cur.execute("SELECT GET_LOCK(%s, 120)", (MIGRATE_LOCK_NAME,))
            lock_row = await cur.fetchone()
            if not lock_row or lock_row[0] != 1:
                raise RuntimeError("Could not acquire schema migration lock")

            try:
                await cur.execute("SELECT version FROM schema_migrations ORDER BY version")
                applied = {row[0] for row in await cur.fetchall()}

                migrations_dir = Path(settings.migrations_dir)
                files = sorted(migrations_dir.glob("*.sql"))

                applied = await _baseline_existing_schema(cur, files, applied)
                if applied:
                    await conn.commit()

                for file in files:
                    if file.name in applied:
                        print(f"skip {file.name}")
                        continue
                    sql = file.read_text(encoding="utf-8")
                    for statement in split_sql_statements(sql):
                        try:
                            await cur.execute(statement)
                        except OperationalError as exc:
                            # 1050 = table exists — 并发或历史半迁移时跳过单条 DDL
                            if exc.args and exc.args[0] == 1050:
                                print(f"warn: skip existing object in {file.name}: {exc}")
                                continue
                            raise
                    await cur.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)",
                        (file.name,),
                    )
                    await conn.commit()
                    print(f"applied {file.name}")
            finally:
                await cur.execute("SELECT RELEASE_LOCK(%s)", (MIGRATE_LOCK_NAME,))
                await conn.commit()
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
