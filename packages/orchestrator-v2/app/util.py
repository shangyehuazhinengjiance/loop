from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from app.schemas import Participant


def new_id() -> str:
    return str(uuid.uuid4())


def row_to_participant(kind: str, owner_id: str, display_names: dict[str, str] | None = None) -> Participant:
    names = display_names or {}
    default_names = {
        "pm-agent": "PM Agent",
        "dev-agent": "Dev Agent",
        "ops-agent": "Ops Agent",
    }
    if kind == "agent":
        return Participant(kind="agent", id=owner_id, displayName=names.get(owner_id, default_names.get(owner_id, owner_id)))
    return Participant(kind="human", id=owner_id, displayName=names.get(owner_id, owner_id))


def serialize_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return value
