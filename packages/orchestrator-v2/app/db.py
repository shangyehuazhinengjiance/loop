from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from urllib.parse import unquote, urlparse

import aiomysql

from app.config import get_settings

_pool: aiomysql.Pool | None = None


def _parse_mysql_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme not in ("mysql", "mysql+pymysql"):
        raise ValueError(f"Unsupported DATABASE_URL scheme: {parsed.scheme}")
    database = (parsed.path or "/").lstrip("/") or "loop_v2"
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or "loop"),
        "password": unquote(parsed.password or "loop"),
        "db": database,
        "autocommit": False,
        "charset": "utf8mb4",
    }


async def init_pool() -> aiomysql.Pool:
    global _pool
    if _pool is None:
        cfg = _parse_mysql_url(get_settings().database_url)
        _pool = await aiomysql.create_pool(minsize=1, maxsize=10, **cfg)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


async def get_conn() -> AsyncIterator[aiomysql.Connection]:
    pool = await init_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            yield conn, cur


@asynccontextmanager
async def transaction() -> AsyncIterator[tuple[Any, Any]]:
    pool = await init_pool()
    async with pool.acquire() as conn:
        try:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await conn.begin()
                yield conn, cur
                await conn.commit()
        except Exception:
            await conn.rollback()
            raise


def split_sql_statements(sql: str) -> list[str]:
    without_comments = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
    return [s.strip() for s in without_comments.split(";") if s.strip()]
