from __future__ import annotations

from datetime import datetime
from typing import Any

from app.repositories import (
    ArtifactRepository,
    AuditRepository,
    LoopRepository,
    WorkStreamRepository,
)
from app.template_registry import TemplateRegistry
from app.util import parse_json


class AuditService:
    def __init__(self) -> None:
        self.repo = AuditRepository()

    async def log(
        self,
        cur: Any,
        actor: str,
        action: str,
        loop_id: str | None = None,
        detail: dict | None = None,
    ) -> None:
        await self.repo.create(cur, actor, action, loop_id, detail)

    async def list_loop(self, cur: Any, loop_id: str) -> list[dict]:
        rows = await self.repo.list_by_loop(cur, loop_id)
        return [self._row(r) for r in rows]

    def _row(self, row: dict) -> dict:
        return {
            "id": row["id"],
            "loopId": row.get("loop_id"),
            "actor": row["actor"],
            "action": row["action"],
            "detail": parse_json(row.get("detail")) or {},
            "createdAt": row["created_at"],
        }


class ArtifactService:
    def __init__(self) -> None:
        self.repo = ArtifactRepository()

    async def save(
        self,
        cur: Any,
        loop_id: str,
        artifact_type: str,
        content: dict,
        path: str | None = None,
        run_id: str | None = None,
    ) -> dict:
        row = await self.repo.create(cur, loop_id, artifact_type, path, content, run_id)
        return self._row(row)

    async def list_loop(self, cur: Any, loop_id: str) -> list[dict]:
        rows = await self.repo.list_by_loop(cur, loop_id)
        return [self._row(r) for r in rows]

    async def compare(self, cur: Any, artifact_id: str, compare_id: str) -> dict:
        a = await self.repo.get_by_id(cur, artifact_id)
        b = await self.repo.get_by_id(cur, compare_id)
        if not a or not b:
            raise ValueError("Artifact not found")
        return {"from": self._row(a), "to": self._row(b)}

    def _row(self, row: dict) -> dict:
        return {
            "id": row["id"],
            "loopId": row["loop_id"],
            "runId": row.get("run_id"),
            "type": row["type"],
            "path": row.get("path"),
            "content": parse_json(row.get("content")) or {},
            "version": row["version"],
            "createdAt": row["created_at"],
        }


class StatsService:
    def __init__(self) -> None:
        self.workstreams = WorkStreamRepository()
        self.loops = LoopRepository()
        self.templates = TemplateRegistry()

    async def loop_stats(self, cur: Any, loop_id: str) -> dict:
        await cur.execute(
            """
            SELECT template_id, status, COUNT(*) AS c,
                   AVG(TIMESTAMPDIFF(SECOND, started_at, ended_at)) AS avg_seconds
            FROM workstream_runs WHERE loop_id = %s
            GROUP BY template_id, status
            """,
            (loop_id,),
        )
        by_template: dict[str, dict] = {}
        for row in await cur.fetchall():
            tid = row["template_id"]
            by_template.setdefault(tid, {"byStatus": {}, "avgDurationSec": {}})
            by_template[tid]["byStatus"][row["status"]] = int(row["c"])
            if row["avg_seconds"] is not None:
                by_template[tid]["avgDurationSec"][row["status"]] = int(row["avg_seconds"])

        await cur.execute(
            """
            SELECT COUNT(*) AS reopen_count FROM workstream_runs
            WHERE loop_id = %s AND supersedes IS NOT NULL
            """,
            (loop_id,),
        )
        reopen_count = int((await cur.fetchone())["reopen_count"])

        await cur.execute(
            """
            SELECT COUNT(*) AS blocked_count FROM workstream_runs
            WHERE loop_id = %s AND blocked_reason IS NOT NULL
            """,
            (loop_id,),
        )
        blocked_count = int((await cur.fetchone())["blocked_count"])

        await cur.execute(
            """
            SELECT owner_kind, COUNT(*) AS c FROM workstream_runs
            WHERE loop_id = %s GROUP BY owner_kind
            """,
            (loop_id,),
        )
        owner_mix = {r["owner_kind"]: int(r["c"]) for r in await cur.fetchall()}

        await cur.execute(
            """
            SELECT COUNT(*) AS c FROM workstream_runs
            WHERE loop_id = %s AND status = 'active'
            """,
            (loop_id,),
        )
        parallel_active = int((await cur.fetchone())["c"])

        return {
            "loopId": loop_id,
            "byTemplate": by_template,
            "reopenCount": reopen_count,
            "blockedCount": blocked_count,
            "ownerMix": owner_mix,
            "parallelActive": parallel_active,
        }

    async def project_stats(self, cur: Any, project_id: str) -> dict:
        await cur.execute(
            "SELECT id, title, status FROM loops WHERE project_id = %s",
            (project_id,),
        )
        loops = await cur.fetchall()
        loop_stats = []
        for lp in loops:
            loop_stats.append(await self.loop_stats(cur, lp["id"]))

        total_reopen = sum(s["reopenCount"] for s in loop_stats)
        total_blocked = sum(s["blockedCount"] for s in loop_stats)

        return {
            "projectId": project_id,
            "loopCount": len(loops),
            "loops": [{"id": l["id"], "title": l["title"], "status": l["status"]} for l in loops],
            "aggregate": {
                "reopenCount": total_reopen,
                "blockedCount": total_blocked,
            },
            "loopStats": loop_stats,
        }

    async def summary_timeline(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            """
            SELECT id, instance_id, template_id, version, status, summary_tag,
                   git_ref_end, started_at, ended_at, spawned_from, supersedes
            FROM workstream_runs
            WHERE loop_id = %s AND (summary_tag IS NOT NULL OR status = 'done')
            ORDER BY COALESCE(ended_at, started_at, created_at)
            """,
            (loop_id,),
        )
        rows = await cur.fetchall()
        items = []
        for r in rows:
            tpl = self.templates.get(r["template_id"])
            items.append(
                {
                    "runId": r["id"],
                    "instanceId": r["instance_id"],
                    "templateId": r["template_id"],
                    "templateName": tpl["name"] if tpl else r["template_id"],
                    "version": r["version"],
                    "status": r["status"],
                    "summaryTag": r.get("summary_tag"),
                    "gitRef": r.get("git_ref_end"),
                    "startedAt": r.get("started_at"),
                    "endedAt": r.get("ended_at"),
                    "spawnedFrom": r.get("spawned_from"),
                    "supersedes": r.get("supersedes"),
                }
            )
        return items


class ReplayService:
    def __init__(self) -> None:
        self.workstreams = WorkStreamRepository()
        self.artifacts = ArtifactRepository()

    async def replay(
        self,
        cur: Any,
        loop_id: str,
        run_id: str | None = None,
        message_limit: int = 2000,
    ) -> dict:
        await cur.execute(
            """
            SELECT * FROM messages WHERE loop_id = %s
            ORDER BY created_at ASC LIMIT %s
            """,
            (loop_id, message_limit),
        )
        messages = await cur.fetchall()
        if run_id:
            await cur.execute(
                """
                SELECT created_at, started_at, ended_at FROM workstream_runs
                WHERE id = %s AND loop_id = %s
                """,
                (run_id, loop_id),
            )
            anchor = await cur.fetchone()
            if anchor and anchor.get("ended_at"):
                cutoff: datetime | None = anchor["ended_at"]
                messages = [m for m in messages if m["created_at"] <= cutoff]
            elif anchor and anchor.get("started_at"):
                cutoff = anchor["started_at"]
                messages = [m for m in messages if m["created_at"] <= cutoff]

        await cur.execute(
            """
            SELECT * FROM workstream_events WHERE loop_id = %s
            ORDER BY created_at ASC
            """,
            (loop_id,),
        )
        events = await cur.fetchall()

        runs = await self.workstreams.list_runs(cur, loop_id)
        artifact_rows = await self.artifacts.list_by_loop(cur, loop_id)

        return {
            "loopId": loop_id,
            "anchorRunId": run_id,
            "messages": [
                {
                    "id": m["id"],
                    "runId": m.get("run_id"),
                    "senderType": m["sender_type"],
                    "senderId": m["sender_id"],
                    "content": parse_json(m["content"]) or {},
                    "createdAt": m["created_at"],
                }
                for m in messages
            ],
            "workstreamEvents": [
                {
                    "id": e["id"],
                    "runId": e["run_id"],
                    "eventType": e["event_type"],
                    "payload": parse_json(e.get("payload")) or {},
                    "createdAt": e["created_at"],
                }
                for e in events
            ],
            "runs": [
                {
                    "id": r["id"],
                    "templateId": r["template_id"],
                    "version": r["version"],
                    "status": r["status"],
                    "summaryTag": r.get("summary_tag"),
                    "startedAt": r.get("started_at"),
                    "endedAt": r.get("ended_at"),
                }
                for r in runs
            ],
            "artifacts": [
                {
                    "id": a["id"],
                    "type": a["type"],
                    "path": a.get("path"),
                    "version": a["version"],
                    "runId": a.get("run_id"),
                    "createdAt": a["created_at"],
                }
                for a in artifact_rows
            ],
        }
