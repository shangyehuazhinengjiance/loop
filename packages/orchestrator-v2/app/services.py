from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from typing import Any, AsyncIterator

from app.analytics import ArtifactService, AuditService, ReplayService, StatsService
from app.agent_dispatcher import agent_dispatcher
from app.config import get_settings
from app.dependency_resolver import DependencyResolver
from app.git_service import GitService
from app.human_end import (
    APPROVAL_ACTION_TEMPLATES,
    build_confirmation_actions,
    match_chat_intent,
)
from app.repositories import (
    LoopRepository,
    MemberRepository,
    MessageRepository,
    ProjectRepository,
    WorkStreamRepository,
)
from app.schemas import (
    LoopResponse,
    MessageResponse,
    Participant,
    ProjectResponse,
    WorkStreamBoardItem,
    WorkStreamBoardResponse,
    WorkStreamRunResponse,
    WorkStreamTemplateResponse,
)
from app.template_registry import TemplateRegistry
from app.util import parse_json, row_to_participant


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[str]]] = defaultdict(list)

    def subscribe(self, loop_id: str) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue()
        self._subscribers[loop_id].append(q)
        return q

    def unsubscribe(self, loop_id: str, q: asyncio.Queue[str]) -> None:
        subs = self._subscribers.get(loop_id, [])
        if q in subs:
            subs.remove(q)
        if not subs:
            self._subscribers.pop(loop_id, None)

    async def publish(self, loop_id: str, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, default=str)
        for q in list(self._subscribers.get(loop_id, [])):
            await q.put(data)


event_bus = EventBus()


class LoopService:
    def __init__(self) -> None:
        self.projects = ProjectRepository()
        self.loops = LoopRepository()
        self.members = MemberRepository()
        self.workstreams = WorkStreamRepository()
        self.messages = MessageRepository()
        self.templates = TemplateRegistry()
        self.git = GitService()
        self.deps = DependencyResolver()
        self.audit = AuditService()
        self.artifacts = ArtifactService()
        self.stats = StatsService()
        self.replay = ReplayService()

    def _project_row(self, row: dict) -> ProjectResponse:
        return ProjectResponse(
            id=row["id"],
            name=row["name"],
            gitConfig=parse_json(row["git_config"]) or {},
            modelConfig=parse_json(row["model_config"]) or {},
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )

    def _loop_row(self, row: dict, summary: dict[str, int] | None = None) -> LoopResponse:
        return LoopResponse(
            id=row["id"],
            projectId=row["project_id"],
            title=row["title"],
            status=row["status"],
            gitBranch=row.get("git_branch"),
            workspacePath=row.get("workspace_path"),
            context=parse_json(row.get("context")) or {},
            milestone=parse_json(row.get("milestone")),
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            workstreamSummary=summary or {},
        )

    def _run_row(self, row: dict, template_name: str | None = None, members: dict[str, str] | None = None) -> WorkStreamRunResponse:
        owner = row_to_participant(row["owner_kind"], row["owner_id"], members)
        return WorkStreamRunResponse(
            id=row["id"],
            instanceId=row["instance_id"],
            loopId=row["loop_id"],
            templateId=row["template_id"],
            templateName=template_name,
            version=row["version"],
            status=row["status"],
            owner=owner,
            assigneeId=row.get("assignee_id"),
            startedAt=row.get("started_at"),
            endedAt=row.get("ended_at"),
            startedBy=row.get("started_by"),
            blockedReason=row.get("blocked_reason"),
            spawnedFrom=row.get("spawned_from"),
            supersedes=row.get("supersedes"),
            summaryTag=row.get("summary_tag"),
            metadata=parse_json(row.get("metadata")) or {},
            createdAt=row["created_at"],
        )

    def _message_row(self, row: dict, members: dict[str, str]) -> MessageResponse:
        from app.schemas import MessageSender

        sender_type = row["sender_type"]
        sender_id = row["sender_id"]
        if sender_type == "system":
            sender = MessageSender(type="system", id="system", displayName="System")
        elif sender_type == "agent":
            p = row_to_participant("agent", sender_id)
            sender = MessageSender(type="agent", id=p.id, displayName=p.displayName)
        else:
            p = row_to_participant("human", sender_id, members)
            sender = MessageSender(type="human", id=p.id, displayName=p.displayName)
        return MessageResponse(
            id=row["id"],
            loopId=row["loop_id"],
            runId=row.get("run_id"),
            sender=sender,
            content=parse_json(row["content"]) or {},
            createdAt=row["created_at"],
        )

    async def _member_map(self, cur: Any, loop_id: str) -> dict[str, str]:
        rows = await self.members.list_by_loop(cur, loop_id)
        return {r["user_id"]: r["display_name"] for r in rows}

    async def _workstream_summary(self, cur: Any, loop_id: str) -> dict[str, int]:
        await cur.execute(
            """
            SELECT r.status, COUNT(*) AS c
            FROM workstream_runs r
            JOIN (
              SELECT instance_id, MAX(version) AS max_v
              FROM workstream_runs WHERE loop_id = %s GROUP BY instance_id
            ) latest ON latest.instance_id = r.instance_id AND latest.max_v = r.version
            WHERE r.loop_id = %s
            GROUP BY r.status
            """,
            (loop_id, loop_id),
        )
        rows = await cur.fetchall()
        return {row["status"]: int(row["c"]) for row in rows}

    async def ensure_templates(self, cur: Any) -> None:
        await self.templates.load_from_yaml(cur)
        await self.templates.refresh_cache(cur)

    async def create_project(self, cur: Any, name: str, git_config: dict, model_config: dict) -> ProjectResponse:
        row = await self.projects.create(cur, name, git_config, model_config)
        return self._project_row(row)

    async def list_projects(self, cur: Any) -> list[ProjectResponse]:
        rows = await self.projects.list_all(cur)
        return [self._project_row(r) for r in rows]

    async def create_loop(
        self,
        cur: Any,
        project_id: str,
        title: str,
        input_requirements: str | None = None,
        input_requirements_title: str | None = None,
    ) -> LoopResponse:
        project = await self.projects.get_by_id(cur, project_id)
        if not project:
            raise ValueError("Project not found")

        loop_row = await self.loops.create(cur, project_id, title)
        loop_id = loop_row["id"]
        settings = get_settings()
        git_branch = f"loop/{loop_id}"
        workspace_path = f"{settings.workspace_root.rstrip('/')}/loop-{loop_id}"

        context: dict[str, Any] = {}
        if input_requirements:
            context["inputRequirements"] = {
                "title": input_requirements_title or "导入需求",
                "content": input_requirements,
            }

        await cur.execute(
            """
            UPDATE loops SET git_branch = %s, workspace_path = %s, context = %s
            WHERE id = %s
            """,
            (git_branch, workspace_path, json.dumps(context, ensure_ascii=False), loop_id),
        )
        loop_row = await self.loops.get_by_id(cur, loop_id)
        return self._loop_row(loop_row, {})

    async def init_loop_git(
        self, cur: Any, loop_id: str, input_requirements: str | None, input_title: str | None
    ) -> None:
        loop = await self.loops.get_by_id(cur, loop_id)
        if not loop:
            return
        project = await self.projects.get_by_id(cur, loop["project_id"])
        if not project:
            return
        git_config = parse_json(project["git_config"]) or {}
        workspace_path = loop.get("workspace_path") or ""
        git_branch = loop.get("git_branch") or f"loop/{loop_id}"
        try:
            result = await self.git.init_loop_workspace(
                loop_id, git_config, workspace_path, git_branch
            )
            context = parse_json(loop.get("context")) or {}
            context["gitRef"] = result.get("gitRef")
            if input_requirements:
                rel = await self.git.write_input_requirements(
                    result["workspacePath"],
                    loop_id,
                    input_title or "导入需求",
                    input_requirements,
                )
                context["inputRequirementsPath"] = rel
            await cur.execute(
                """
                UPDATE loops SET workspace_path = %s, git_branch = %s, context = %s
                WHERE id = %s
                """,
                (
                    result["workspacePath"],
                    result["gitBranch"],
                    json.dumps(context, ensure_ascii=False),
                    loop_id,
                ),
            )
        except Exception as exc:
            await self.publish_system_message(
                cur,
                loop_id,
                f"Git 工作区初始化失败：{exc}",
                msg_type="system",
            )

    def loop_for_agent(self, row: dict, summary: dict | None = None) -> dict:
        """v1 Agent 兼容字段（phase / workspace_path / snake_case）。"""
        resp = self._loop_row(row, summary)
        data = resp.model_dump(mode="json")
        active_template = None
        for _status, count in (summary or {}).items():
            if _status == "active" and count:
                active_template = "requirement"
        data["workspace_path"] = data.get("workspacePath")
        data["project_id"] = data.get("projectId")
        data["phase"] = agent_dispatcher.phase_for_template(active_template or "pm-prd")
        data["title"] = data.get("title")
        return data

    async def get_loop_agent(self, cur: Any, loop_id: str) -> dict | None:
        row = await self.loops.get_by_id(cur, loop_id)
        if not row:
            return None
        summary = await self._workstream_summary(cur, loop_id)
        runs = await self.workstreams.list_runs(cur, loop_id)
        for r in reversed(runs):
            if r["status"] == "active":
                data = self.loop_for_agent(row, summary)
                data["phase"] = agent_dispatcher.phase_for_template(r["template_id"])
                data["activeRunId"] = r["id"]
                data["activeTemplateId"] = r["template_id"]
                return data
        return self.loop_for_agent(row, summary)

    async def _after_run_active(
        self, cur: Any, loop_id: str, run: dict, started_by: str | None = None
    ) -> None:
        if run["owner_kind"] == "agent":
            await agent_dispatcher.dispatch_run(
                loop_id,
                run["id"],
                run["template_id"],
                run["owner_id"],
                started_by,
            )
        await event_bus.publish(
            loop_id,
            {
                "type": "processing",
                "active": run["owner_kind"] == "agent",
                "agent": run["owner_id"],
                "runId": run["id"],
            },
        )

    async def _apply_summary_tag(
        self, cur: Any, loop_id: str, run: dict
    ) -> tuple[str | None, str | None]:
        tpl = self.templates.get(run["template_id"])
        if not tpl or tpl.get("ephemeral"):
            return None, None
        defn = tpl.get("definition") or {}
        tag_cfg = defn.get("tag_on_complete")
        if not tag_cfg:
            return None, None
        loop = await self.loops.get_by_id(cur, loop_id)
        if not loop or not loop.get("workspace_path"):
            return None, None
        prefix = tag_cfg.get("prefix", "summary")
        paths = [p.replace("{loopId}", loop_id) for p in tag_cfg.get("paths") or []]
        try:
            tag, git_ref = await self.git.create_summary_tag(
                loop["workspace_path"],
                loop_id,
                prefix,
                run["version"],
                paths,
            )
            await cur.execute(
                "UPDATE workstream_runs SET summary_tag = %s, git_ref_end = %s WHERE id = %s",
                (tag or None, git_ref or None, run["id"]),
            )
            return tag, git_ref
        except FileNotFoundError:
            return None, None
        except Exception as exc:
            await self.publish_system_message(
                cur, loop_id, f"Summary Tag 未打：{exc}", run_id=run["id"]
            )
            return None, None

    async def get_loop(self, cur: Any, loop_id: str) -> LoopResponse | None:
        row = await self.loops.get_by_id(cur, loop_id)
        if not row:
            return None
        summary = await self._workstream_summary(cur, loop_id)
        return self._loop_row(row, summary)

    async def join_loop(self, cur: Any, loop_id: str, user_id: str, display_name: str, bio: str = "") -> None:
        if not await self.loops.get_by_id(cur, loop_id):
            raise ValueError("Loop not found")
        await self.members.upsert(cur, loop_id, user_id, display_name, bio)

    async def create_workstream(
        self,
        cur: Any,
        loop_id: str,
        template_id: str,
        title: str | None = None,
        assignee_id: str | None = None,
        depends_on: list[str] | None = None,
        started_by: str | None = None,
        auto_start: bool = False,
        spawned_from: str | None = None,
        metadata: dict | None = None,
    ) -> WorkStreamRunResponse:
        loop = await self.loops.get_by_id(cur, loop_id)
        if not loop:
            raise ValueError("Loop not found")
        tpl = self.templates.get(template_id)
        if not tpl:
            await self.templates.refresh_cache(cur)
            tpl = self.templates.get(template_id)
        if not tpl:
            raise ValueError(f"Unknown template: {template_id}")

        instance_title = title or tpl["name"]
        instance = await self.workstreams.create_instance(
            cur, loop_id, template_id, instance_title, assignee_id
        )
        for dep in depends_on or []:
            await self.workstreams.add_dependency(cur, instance["id"], dep)

        satisfied, _missing = await self.deps.deps_satisfied(
            cur, instance["id"], self.workstreams
        )

        owner_kind = tpl["owner_kind"]
        if owner_kind == "agent":
            owner_id = tpl.get("default_owner") or "pm-agent"
        else:
            owner_id = assignee_id or "unassigned"

        if not satisfied:
            status = "pending"
        elif auto_start:
            status = "active"
            if owner_kind == "agent":
                active = await self.workstreams.count_active_by_owner(
                    cur, loop_id, owner_kind, owner_id
                )
                if active > 0:
                    status = "ready"
        else:
            status = "ready"

        run = await self.workstreams.create_run(
            cur,
            instance["id"],
            loop_id,
            template_id,
            version=1,
            owner_kind=owner_kind,
            owner_id=owner_id if owner_kind == "agent" else (assignee_id or "unassigned"),
            assignee_id=assignee_id,
            status=status,
            started_by=started_by,
            spawned_from=spawned_from,
            metadata=metadata,
        )
        await self.workstreams.create_event(cur, run["id"], loop_id, "created", {"templateId": template_id})
        if status == "active":
            await self.workstreams.create_event(cur, run["id"], loop_id, "started", {})
            await self._after_run_active(cur, loop_id, run, started_by)
        members = await self._member_map(cur, loop_id)
        return self._run_row(run, tpl["name"], members)

    async def start_instance(
        self, cur: Any, loop_id: str, instance_id: str, started_by: str | None = None
    ) -> WorkStreamRunResponse:
        instance = await self.workstreams.get_instance(cur, instance_id)
        if not instance or instance["loop_id"] != loop_id:
            raise ValueError("Instance not found")

        satisfied, missing = await self.deps.deps_satisfied(
            cur, instance_id, self.workstreams
        )
        if not satisfied:
            raise ValueError(f"Dependencies not satisfied: {missing}")

        latest = await self.workstreams.latest_run_for_instance(cur, instance_id)
        if not latest:
            raise ValueError("No run for instance")
        if latest["status"] not in ("ready", "pending", "blocked"):
            raise ValueError(f"Cannot start run in status {latest['status']}")

        owner_kind = latest["owner_kind"]
        owner_id = latest["owner_id"]
        if owner_kind == "agent":
            active = await self.workstreams.count_active_by_owner(
                cur, loop_id, owner_kind, owner_id, exclude_run_id=latest["id"]
            )
            if active > 0:
                raise ValueError(f"Owner {owner_id} already has an active run")

        run = await self.workstreams.update_run_status(cur, latest["id"], "active")
        if started_by:
            await cur.execute(
                "UPDATE workstream_runs SET started_by = %s WHERE id = %s",
                (started_by, latest["id"]),
            )
            run = await self.workstreams.get_run(cur, latest["id"])
        await self.workstreams.create_event(cur, run["id"], loop_id, "started", {"startedBy": started_by})
        await self._after_run_active(cur, loop_id, run, started_by)
        tpl = self.templates.get(run["template_id"])
        members = await self._member_map(cur, loop_id)
        return self._run_row(run, tpl["name"] if tpl else None, members)

    async def block_run(self, cur: Any, loop_id: str, run_id: str, reason: str) -> WorkStreamRunResponse:
        run = await self._require_run(cur, loop_id, run_id)
        if run["status"] not in ("active", "ready"):
            raise ValueError("Run cannot be blocked")
        updated = await self.workstreams.update_run_status(cur, run_id, "blocked", blocked_reason=reason)
        await self.workstreams.create_event(cur, run_id, loop_id, "blocked", {"reason": reason})
        tpl = self.templates.get(updated["template_id"])
        members = await self._member_map(cur, loop_id)
        return self._run_row(updated, tpl["name"] if tpl else None, members)

    async def complete_run(
        self, cur: Any, loop_id: str, run_id: str, summary_tag: str | None = None
    ) -> WorkStreamRunResponse:
        run = await self._require_run(cur, loop_id, run_id)
        if run["status"] in ("done", "cancelled"):
            raise ValueError("Run already finished")
        tag, _git_ref = await self._apply_summary_tag(cur, loop_id, run)
        if summary_tag:
            tag = summary_tag
        updated = await self.workstreams.update_run_status(
            cur, run_id, "done", summary_tag=tag
        )
        await self.workstreams.create_event(cur, run_id, loop_id, "done", {"summaryTag": tag})
        await self.deps.refresh_loop(cur, loop_id, self.workstreams)
        await self.audit.log(
            cur, run["owner_id"], "workstream.complete", loop_id,
            {"runId": run_id, "templateId": run["template_id"], "summaryTag": tag},
        )
        await event_bus.publish(loop_id, {"type": "processing", "active": False})
        tpl = self.templates.get(updated["template_id"])
        members = await self._member_map(cur, loop_id)
        return self._run_row(updated, tpl["name"] if tpl else None, members)

    async def cancel_run(self, cur: Any, loop_id: str, run_id: str) -> WorkStreamRunResponse:
        run = await self._require_run(cur, loop_id, run_id)
        updated = await self.workstreams.update_run_status(cur, run_id, "cancelled")
        await self.workstreams.create_event(cur, run_id, loop_id, "cancelled", {})
        tpl = self.templates.get(updated["template_id"])
        members = await self._member_map(cur, loop_id)
        return self._run_row(updated, tpl["name"] if tpl else None, members)

    async def reopen_instance(
        self, cur: Any, loop_id: str, instance_id: str, reason: str, started_by: str | None = None
    ) -> WorkStreamRunResponse:
        instance = await self.workstreams.get_instance(cur, instance_id)
        if not instance or instance["loop_id"] != loop_id:
            raise ValueError("Instance not found")
        latest = await self.workstreams.latest_run_for_instance(cur, instance_id)
        if not latest:
            raise ValueError("No run to reopen")
        version = await self.workstreams.max_version(cur, instance_id) + 1
        tpl = self.templates.get(instance["template_id"])
        if not tpl:
            raise ValueError("Template not found")

        run = await self.workstreams.create_run(
            cur,
            instance_id,
            loop_id,
            instance["template_id"],
            version=version,
            owner_kind=tpl["owner_kind"],
            owner_id=latest["owner_id"],
            assignee_id=latest.get("assignee_id"),
            status="ready",
            started_by=started_by,
            supersedes=latest["id"],
            metadata={"reopenReason": reason},
        )
        await self.workstreams.create_event(
            cur, run["id"], loop_id, "reopened", {"reason": reason, "supersedes": latest["id"]}
        )
        members = await self._member_map(cur, loop_id)
        return self._run_row(run, tpl["name"], members)

    async def spawn_workstream(
        self,
        cur: Any,
        loop_id: str,
        template_id: str,
        reason: str,
        from_run_id: str | None = None,
        assignee_id: str | None = None,
        title: str | None = None,
        started_by: str | None = None,
    ) -> WorkStreamRunResponse:
        metadata = {"spawnReason": reason}
        if from_run_id:
            parent = await self.workstreams.get_run(cur, from_run_id)
            if parent and parent["loop_id"] == loop_id and parent["status"] == "active":
                await self.block_run(cur, loop_id, from_run_id, reason)
            metadata["fromRunId"] = from_run_id

        run = await self.create_workstream(
            cur,
            loop_id,
            template_id,
            title=title,
            assignee_id=assignee_id,
            started_by=started_by,
            auto_start=True,
            spawned_from=from_run_id,
            metadata=metadata,
        )
        await self.workstreams.create_event(
            cur, run.id, loop_id, "spawned", {"reason": reason, "fromRunId": from_run_id}
        )
        return run

    async def get_board(self, cur: Any, loop_id: str) -> WorkStreamBoardResponse:
        if not await self.loops.get_by_id(cur, loop_id):
            raise ValueError("Loop not found")
        instances = await self.workstreams.list_instances(cur, loop_id)
        members = await self._member_map(cur, loop_id)
        columns: dict[str, list[WorkStreamBoardItem]] = {
            "active": [],
            "ready": [],
            "blocked": [],
            "done": [],
            "other": [],
        }
        stats: dict[str, int] = defaultdict(int)

        for inst in instances:
            latest = await self.workstreams.latest_run_for_instance(cur, inst["id"])
            if not latest:
                continue
            tpl = self.templates.get(inst["template_id"])
            run_resp = self._run_row(latest, tpl["name"] if tpl else inst["template_id"], members)
            stats[latest["status"]] = stats.get(latest["status"], 0) + 1
            item = WorkStreamBoardItem(
                instanceId=inst["id"],
                title=inst.get("title") or (tpl["name"] if tpl else inst["template_id"]),
                templateId=inst["template_id"],
                templateName=tpl["name"] if tpl else inst["template_id"],
                latestRun=run_resp,
            )
            col = latest["status"]
            if col in columns:
                columns[col].append(item)
            else:
                columns["other"].append(item)

        return WorkStreamBoardResponse(loopId=loop_id, columns=columns, stats=dict(stats))

    async def list_runs(self, cur: Any, loop_id: str, status: str | None = None) -> list[WorkStreamRunResponse]:
        runs = await self.workstreams.list_runs(cur, loop_id)
        members = await self._member_map(cur, loop_id)
        result = []
        for row in runs:
            if status and row["status"] != status:
                continue
            tpl = self.templates.get(row["template_id"])
            result.append(self._run_row(row, tpl["name"] if tpl else None, members))
        return result

    async def get_graph(self, cur: Any, loop_id: str) -> dict:
        instances = await self.workstreams.list_instances(cur, loop_id)
        deps = await self.workstreams.list_dependencies(cur, loop_id)
        nodes = []
        for inst in instances:
            latest = await self.workstreams.latest_run_for_instance(cur, inst["id"])
            tpl = self.templates.get(inst["template_id"])
            nodes.append(
                {
                    "instanceId": inst["id"],
                    "templateId": inst["template_id"],
                    "templateName": tpl["name"] if tpl else inst["template_id"],
                    "title": inst.get("title"),
                    "latestRunId": latest["id"] if latest else None,
                    "status": latest["status"] if latest else None,
                    "version": latest["version"] if latest else None,
                    "summaryTag": latest.get("summary_tag") if latest else None,
                    "blockedReason": latest.get("blocked_reason") if latest else None,
                }
            )
        edges = [
            {"from": d["depends_on_id"], "to": d["instance_id"], "kind": d["kind"]}
            for d in deps
        ]
        spawned = []
        runs = await self.workstreams.list_runs(cur, loop_id)
        for r in runs:
            if r.get("spawned_from"):
                spawned.append({"fromRunId": r["spawned_from"], "toRunId": r["id"]})
        return {
            "loopId": loop_id,
            "nodes": nodes,
            "edges": edges,
            "spawnedEdges": spawned,
        }

    async def list_templates(self) -> list[WorkStreamTemplateResponse]:
        return [
            WorkStreamTemplateResponse(
                id=t["id"],
                name=t["name"],
                ownerKind=t["owner_kind"],
                defaultOwner=t.get("default_owner"),
                ephemeral=bool(t.get("ephemeral")),
                definition=t.get("definition") or {},
            )
            for t in self.templates.list_all()
        ]

    async def _require_run(self, cur: Any, loop_id: str, run_id: str) -> dict:
        run = await self.workstreams.get_run(cur, run_id)
        if not run or run["loop_id"] != loop_id:
            raise ValueError("Run not found")
        return run

    def extract_mentions(self, body: str) -> list[str]:
        return list({m.lower() for m in re.findall(r"@([\w-]+)", body)})

    async def publish_system_message(
        self,
        cur: Any,
        loop_id: str,
        body: str,
        msg_type: str = "workstream_event",
        extra: dict | None = None,
        run_id: str | None = None,
    ) -> MessageResponse:
        content = {"type": msg_type, "body": body, **(extra or {})}
        row = await self.messages.create(
            cur, loop_id, "system", "system", content, run_id=run_id
        )
        msg = self._message_row(row, {})
        await event_bus.publish(loop_id, {"type": "message", "message": msg.model_dump(mode="json")})
        return msg

    async def send_human_message(
        self,
        cur: Any,
        loop_id: str,
        body: str,
        user_id: str,
        display_name: str,
        mentions: list[str] | None = None,
    ) -> MessageResponse:
        if not await self.loops.get_by_id(cur, loop_id):
            raise ValueError("Loop not found")

        all_mentions = list({*(mentions or []), *self.extract_mentions(body)})
        content = {"type": "text", "body": body, "mentions": [f"@{m}" for m in all_mentions]}
        row = await self.messages.create(cur, loop_id, "human", user_id, content)
        members = await self._member_map(cur, loop_id)
        msg = self._message_row(row, members)
        await event_bus.publish(loop_id, {"type": "message", "message": msg.model_dump(mode="json")})

        for mention in all_mentions:
            template_id = self.templates.template_for_mention(mention)
            if not template_id:
                continue
            existing = await self.workstreams.find_instance_by_template(
                cur, loop_id, template_id
            )
            if existing:
                latest = await self.workstreams.latest_run_for_instance(
                    cur, existing["id"]
                )
                if latest and latest["status"] in ("active", "ready", "blocked"):
                    if latest["status"] == "ready":
                        run = await self.start_instance(cur, loop_id, existing["id"], user_id)
                    else:
                        tpl = self.templates.get(template_id)
                        members = await self._member_map(cur, loop_id)
                        run = self._run_row(
                            latest, tpl["name"] if tpl else None, members
                        )
                    await self.publish_system_message(
                        cur,
                        loop_id,
                        f"子任务流已在进行中：{run.templateName or template_id}",
                        msg_type="workstream_event",
                        extra={"event": "already_active", "runId": run.id},
                        run_id=run.id,
                    )
                    continue
            run = await self.create_workstream(
                cur,
                loop_id,
                template_id,
                started_by=user_id,
                auto_start=True,
            )
            tpl = self.templates.get(template_id)
            await self.publish_system_message(
                cur,
                loop_id,
                f"已启动子任务流：{tpl['name'] if tpl else template_id}（Run v{run.version}）",
                msg_type="workstream_event",
                extra={
                    "event": "started",
                    "runId": run.id,
                    "templateId": template_id,
                    "instanceId": run.instanceId,
                },
                run_id=run.id,
            )

        await self._check_human_chat_end(cur, loop_id, body, user_id)
        return msg

    async def _check_human_chat_end(
        self, cur: Any, loop_id: str, body: str, user_id: str
    ) -> None:
        instances = await self.workstreams.list_instances(cur, loop_id)
        for inst in instances:
            tpl = self.templates.get(inst["template_id"])
            if not tpl or tpl.get("owner_kind") != "human":
                continue
            latest = await self.workstreams.latest_run_for_instance(cur, inst["id"])
            if not latest or latest["status"] not in ("active", "ready"):
                continue
            action_id = match_chat_intent(body, tpl.get("definition") or {})
            if not action_id:
                continue
            actions = build_confirmation_actions(latest["id"], action_id)
            await self.publish_system_message(
                cur,
                loop_id,
                f"检测到完成信号，是否标记「{inst.get('title') or tpl['name']}」为已完成？",
                msg_type="action",
                extra={"actions": actions, "runId": latest["id"]},
                run_id=latest["id"],
            )

    async def post_agent_message(
        self,
        cur: Any,
        loop_id: str,
        agent_id: str,
        content: dict,
        run_id: str | None = None,
        phase: str | None = None,
    ) -> MessageResponse:
        if run_id and content.get("actions"):
            content = {
                **content,
                "actions": [
                    {**action, "runId": action.get("runId") or run_id}
                    for action in content["actions"]
                ],
            }
        row = await self.messages.create(
            cur, loop_id, "agent", agent_id, content, run_id=run_id
        )
        msg = self._message_row(row, {})
        await event_bus.publish(loop_id, {"type": "message", "message": msg.model_dump(mode="json")})
        return msg

    async def update_loop_context(self, cur: Any, loop_id: str, context: dict) -> dict:
        loop = await self.loops.get_by_id(cur, loop_id)
        if not loop:
            raise ValueError("Loop not found")
        merged = {**(parse_json(loop.get("context")) or {}), **context}
        await self.loops.update_context(cur, loop_id, merged)
        return merged

    async def agent_request_spawn(
        self,
        cur: Any,
        loop_id: str,
        from_run_id: str,
        template_id: str,
        reason: str,
    ) -> WorkStreamRunResponse:
        return await self.spawn_workstream(
            cur, loop_id, template_id, reason, from_run_id=from_run_id
        )

    async def agent_request_block(
        self, cur: Any, loop_id: str, run_id: str, reason: str
    ) -> WorkStreamRunResponse:
        return await self.block_run(cur, loop_id, run_id, reason)

    async def list_messages(self, cur: Any, loop_id: str) -> list[MessageResponse]:
        rows = await self.messages.list_by_loop(cur, loop_id)
        members = await self._member_map(cur, loop_id)
        return [self._message_row(r, members) for r in rows]

    async def _find_run_for_template(
        self, cur: Any, loop_id: str, template_id: str
    ) -> str | None:
        instances = await self.workstreams.list_instances(cur, loop_id)
        for inst in instances:
            if inst["template_id"] != template_id:
                continue
            latest = await self.workstreams.latest_run_for_instance(cur, inst["id"])
            if latest and latest["status"] in (
                "active",
                "ready",
                "completing",
                "blocked",
            ):
                return latest["id"]
        return None

    async def handle_action(
        self,
        cur: Any,
        loop_id: str,
        action: str,
        user_id: str,
        run_id: str | None = None,
        note: str | None = None,
    ) -> dict:
        if action == "dismiss_confirm":
            return {"ok": True, "dismissed": True}

        if not run_id and action in APPROVAL_ACTION_TEMPLATES:
            run_id = await self._find_run_for_template(
                cur, loop_id, APPROVAL_ACTION_TEMPLATES[action]
            )
            if not run_id:
                tpl_name = APPROVAL_ACTION_TEMPLATES[action]
                raise ValueError(f"未找到进行中的「{tpl_name}」子任务流，无法确认")

        if run_id:
            run = await self.complete_run(cur, loop_id, run_id)
            label = {
                "approve_prd": "PRD 已确认",
                "approve_dev": "开发验收已通过",
                "approve_deploy": "部署已确认",
            }.get(action, f"子任务流已完成（{action}）")
            await self.publish_system_message(
                cur,
                loop_id,
                f"{label}：{run.templateName or run.templateId} · Run v{run.version}",
                extra={"event": "done", "action": action, "runId": run_id},
                run_id=run_id,
            )
            return {"ok": True, "run": run.model_dump(mode="json")}

        # 无 runId 时尝试匹配最近 active 的 human run
        if action in ("task_done", "confirm_mr_merged", "approve_test", "clarify_done"):
            instances = await self.workstreams.list_instances(cur, loop_id)
            for inst in instances:
                latest = await self.workstreams.latest_run_for_instance(cur, inst["id"])
                if latest and latest["status"] in ("active", "ready"):
                    tpl = self.templates.get(inst["template_id"])
                    if tpl and tpl.get("owner_kind") == "human":
                        return await self.handle_action(
                            cur, loop_id, action, user_id, latest["id"], note
                        )

        await cur.execute(
            """
            INSERT INTO action_records (id, loop_id, action, actor_id, note)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (str(__import__("uuid").uuid4()), loop_id, action, user_id, note),
        )
        return {"ok": True, "action": action}


async def sse_stream(loop_id: str) -> AsyncIterator[str]:
    q = event_bus.subscribe(loop_id)
    try:
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"
        while True:
            data = await q.get()
            yield f"data: {data}\n\n"
    finally:
        event_bus.unsubscribe(loop_id, q)


# 全进程单例：模板缓存在启动时加载，路由须复用同一实例
loop_service = LoopService()
