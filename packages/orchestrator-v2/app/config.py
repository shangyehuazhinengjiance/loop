from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "mysql://loop:loop@127.0.0.1:3306/loop_v2"
    orchestrator_port: int = 3000
    # 集群内需为 Service 地址，供 agent-worker 回调 API
    orchestrator_url: str = "http://127.0.0.1:3000"
    agent_worker_url: str = "http://127.0.0.1:3010"
    workspace_root: str = "./workspaces"
    templates_yaml: str = str(REPO_ROOT / "config" / "workstream-templates.yaml")
    migrations_dir: str = str(REPO_ROOT / "migrations" / "v2")


@lru_cache
def get_settings() -> Settings:
    return Settings()
