from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import close_pool, init_pool, transaction
from app.routers import router
from app.services import loop_service


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.migrate import migrate

    await migrate()
    await init_pool()
    async with transaction() as (_, cur):
        await loop_service.ensure_templates(cur)
    yield
    await close_pool()


app = FastAPI(title="AI Native Loop Orchestrator v2", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


def main() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.orchestrator_port,
        reload=True,
    )


if __name__ == "__main__":
    main()
