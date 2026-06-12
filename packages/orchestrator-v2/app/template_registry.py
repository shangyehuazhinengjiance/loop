from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.config import get_settings
from app.repositories import TemplateRepository


MENTION_TO_TEMPLATE: dict[str, str] = {
    "pm-agent": "pm-prd",
    "dev-agent": "dev-impl",
    "ops-agent": "ops-deploy-test",
}


class TemplateRegistry:
    def __init__(self) -> None:
        self._repo = TemplateRepository()
        self._cache: dict[str, dict] = {}

    async def load_from_yaml(self, cur: Any) -> None:
        path = Path(get_settings().templates_yaml)
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        templates = data.get("templates", [])
        for tpl in templates:
            definition = {k: v for k, v in tpl.items() if k not in (
                "id", "name", "owner_kind", "default_owner", "ephemeral", "mention"
            )}
            if tpl.get("mention"):
                definition["mention"] = tpl["mention"]
            row = {
                "id": tpl["id"],
                "name": tpl["name"],
                "owner_kind": tpl["owner_kind"],
                "default_owner": tpl.get("default_owner"),
                "ephemeral": bool(tpl.get("ephemeral")),
                "definition": definition,
            }
            await self._repo.upsert(cur, row)
            self._cache[tpl["id"]] = row

    async def refresh_cache(self, cur: Any) -> None:
        rows = await self._repo.list_all(cur)
        self._cache = {}
        for row in rows:
            import json
            definition = row["definition"]
            if isinstance(definition, str):
                definition = json.loads(definition)
            self._cache[row["id"]] = {
                "id": row["id"],
                "name": row["name"],
                "owner_kind": row["owner_kind"],
                "default_owner": row["default_owner"],
                "ephemeral": bool(row["ephemeral"]),
                "definition": definition,
            }

    def get(self, template_id: str) -> dict | None:
        return self._cache.get(template_id)

    def list_all(self) -> list[dict]:
        return list(self._cache.values())

    def template_for_mention(self, mention: str) -> str | None:
        normalized = mention.lstrip("@").lower()
        if normalized in MENTION_TO_TEMPLATE:
            return MENTION_TO_TEMPLATE[normalized]
        for tpl in self._cache.values():
            if tpl.get("definition", {}).get("mention") == normalized:
                return tpl["id"]
        return None
