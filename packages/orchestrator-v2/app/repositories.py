from __future__ import annotations

from typing import Any

from app.util import new_id, parse_json, serialize_json


class ProjectRepository:
    async def create(self, cur: Any, name: str, git_config: dict, model_config: dict) -> dict:
        pid = new_id()
        await cur.execute(
            """
            INSERT INTO projects (id, name, git_config, model_config)
            VALUES (%s, %s, %s, %s)
            """,
            (pid, name, serialize_json(git_config), serialize_json(model_config)),
        )
        return await self.get_by_id(cur, pid)

    async def list_all(self, cur: Any) -> list[dict]:
        await cur.execute("SELECT * FROM projects ORDER BY created_at DESC")
        return await cur.fetchall()

    async def get_by_id(self, cur: Any, project_id: str) -> dict | None:
        await cur.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
        return await cur.fetchone()


class LoopRepository:
    async def create(
        self,
        cur: Any,
        project_id: str,
        title: str,
        git_branch: str | None = None,
        workspace_path: str | None = None,
        context: dict | None = None,
    ) -> dict:
        loop_id = new_id()
        await cur.execute(
            """
            INSERT INTO loops (id, project_id, title, git_branch, workspace_path, context)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                loop_id,
                project_id,
                title,
                git_branch,
                workspace_path,
                serialize_json(context or {}),
            ),
        )
        return await self.get_by_id(cur, loop_id)

    async def get_by_id(self, cur: Any, loop_id: str) -> dict | None:
        await cur.execute("SELECT * FROM loops WHERE id = %s", (loop_id,))
        return await cur.fetchone()

    async def list_by_project(self, cur: Any, project_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM loops WHERE project_id = %s ORDER BY created_at DESC",
            (project_id,),
        )
        return await cur.fetchall()

    async def update_context(self, cur: Any, loop_id: str, context: dict) -> None:
        await cur.execute(
            "UPDATE loops SET context = %s WHERE id = %s",
            (serialize_json(context), loop_id),
        )

    async def update_status(self, cur: Any, loop_id: str, status: str) -> None:
        await cur.execute("UPDATE loops SET status = %s WHERE id = %s", (status, loop_id))


class MemberRepository:
    async def upsert(
        self,
        cur: Any,
        loop_id: str,
        user_id: str,
        display_name: str,
        bio: str = "",
    ) -> None:
        await cur.execute(
            """
            INSERT INTO loop_members (loop_id, user_id, display_name, bio)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), bio = VALUES(bio)
            """,
            (loop_id, user_id, display_name, bio),
        )

    async def list_by_loop(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM loop_members WHERE loop_id = %s ORDER BY joined_at",
            (loop_id,),
        )
        return await cur.fetchall()


class MessageRepository:
    async def create(
        self,
        cur: Any,
        loop_id: str,
        sender_type: str,
        sender_id: str,
        content: dict,
        run_id: str | None = None,
    ) -> dict:
        mid = new_id()
        await cur.execute(
            """
            INSERT INTO messages (id, loop_id, run_id, sender_type, sender_id, content)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (mid, loop_id, run_id, sender_type, sender_id, serialize_json(content)),
        )
        return await self.get_by_id(cur, mid)

    async def get_by_id(self, cur: Any, message_id: str) -> dict | None:
        await cur.execute("SELECT * FROM messages WHERE id = %s", (message_id,))
        return await cur.fetchone()

    async def list_by_loop(self, cur: Any, loop_id: str, limit: int = 500) -> list[dict]:
        await cur.execute(
            """
            SELECT * FROM messages WHERE loop_id = %s
            ORDER BY created_at ASC LIMIT %s
            """,
            (loop_id, limit),
        )
        return await cur.fetchall()


class TemplateRepository:
    async def upsert(self, cur: Any, template: dict) -> None:
        await cur.execute(
            """
            INSERT INTO workstream_templates (id, name, owner_kind, default_owner, definition, ephemeral)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              owner_kind = VALUES(owner_kind),
              default_owner = VALUES(default_owner),
              definition = VALUES(definition),
              ephemeral = VALUES(ephemeral)
            """,
            (
                template["id"],
                template["name"],
                template["owner_kind"],
                template.get("default_owner"),
                serialize_json(template["definition"]),
                1 if template.get("ephemeral") else 0,
            ),
        )

    async def list_all(self, cur: Any) -> list[dict]:
        await cur.execute("SELECT * FROM workstream_templates ORDER BY id")
        return await cur.fetchall()

    async def get_by_id(self, cur: Any, template_id: str) -> dict | None:
        await cur.execute(
            "SELECT * FROM workstream_templates WHERE id = %s", (template_id,)
        )
        return await cur.fetchone()


class WorkStreamRepository:
    async def find_instance_by_template(
        self, cur: Any, loop_id: str, template_id: str
    ) -> dict | None:
        await cur.execute(
            """
            SELECT * FROM workstream_instances
            WHERE loop_id = %s AND template_id = %s
            ORDER BY created_at DESC LIMIT 1
            """,
            (loop_id, template_id),
        )
        return await cur.fetchone()

    async def create_instance(
        self,
        cur: Any,
        loop_id: str,
        template_id: str,
        title: str | None,
        assignee_id: str | None,
    ) -> dict:
        iid = new_id()
        await cur.execute(
            """
            INSERT INTO workstream_instances (id, loop_id, template_id, title, assignee_id)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (iid, loop_id, template_id, title, assignee_id),
        )
        return await self.get_instance(cur, iid)

    async def get_instance(self, cur: Any, instance_id: str) -> dict | None:
        await cur.execute(
            "SELECT * FROM workstream_instances WHERE id = %s", (instance_id,)
        )
        return await cur.fetchone()

    async def list_instances(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM workstream_instances WHERE loop_id = %s ORDER BY created_at",
            (loop_id,),
        )
        return await cur.fetchall()

    async def add_dependency(
        self, cur: Any, instance_id: str, depends_on_id: str, kind: str = "hard"
    ) -> None:
        await cur.execute(
            """
            INSERT IGNORE INTO workstream_dependencies (instance_id, depends_on_id, kind)
            VALUES (%s, %s, %s)
            """,
            (instance_id, depends_on_id, kind),
        )

    async def list_dependencies(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            """
            SELECT d.* FROM workstream_dependencies d
            JOIN workstream_instances i ON i.id = d.instance_id
            WHERE i.loop_id = %s
            """,
            (loop_id,),
        )
        return await cur.fetchall()

    async def list_deps_for_instance(self, cur: Any, instance_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM workstream_dependencies WHERE instance_id = %s",
            (instance_id,),
        )
        return await cur.fetchall()

    async def create_run(
        self,
        cur: Any,
        instance_id: str,
        loop_id: str,
        template_id: str,
        version: int,
        owner_kind: str,
        owner_id: str,
        assignee_id: str | None,
        status: str,
        started_by: str | None = None,
        spawned_from: str | None = None,
        supersedes: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        rid = new_id()
        await cur.execute(
            """
            INSERT INTO workstream_runs (
              id, instance_id, loop_id, template_id, version, status,
              owner_kind, owner_id, assignee_id, started_by,
              spawned_from, supersedes, metadata, started_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              CASE WHEN %s IN ('active', 'completing') THEN CURRENT_TIMESTAMP(3) ELSE NULL END)
            """,
            (
                rid,
                instance_id,
                loop_id,
                template_id,
                version,
                status,
                owner_kind,
                owner_id,
                assignee_id,
                started_by,
                spawned_from,
                supersedes,
                serialize_json(metadata or {}),
                status,
            ),
        )
        return await self.get_run(cur, rid)

    async def get_run(self, cur: Any, run_id: str) -> dict | None:
        await cur.execute("SELECT * FROM workstream_runs WHERE id = %s", (run_id,))
        return await cur.fetchone()

    async def list_runs(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM workstream_runs WHERE loop_id = %s ORDER BY created_at",
            (loop_id,),
        )
        return await cur.fetchall()

    async def latest_run_for_instance(self, cur: Any, instance_id: str) -> dict | None:
        await cur.execute(
            """
            SELECT * FROM workstream_runs
            WHERE instance_id = %s
            ORDER BY version DESC LIMIT 1
            """,
            (instance_id,),
        )
        return await cur.fetchone()

    async def max_version(self, cur: Any, instance_id: str) -> int:
        await cur.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM workstream_runs WHERE instance_id = %s",
            (instance_id,),
        )
        row = await cur.fetchone()
        return int(row["v"])

    async def update_run_status(
        self,
        cur: Any,
        run_id: str,
        status: str,
        blocked_reason: str | None = None,
        summary_tag: str | None = None,
    ) -> dict:
        if status == "done":
            await cur.execute(
                """
                UPDATE workstream_runs
                SET status = %s, blocked_reason = NULL, ended_at = CURRENT_TIMESTAMP(3),
                    summary_tag = COALESCE(%s, summary_tag)
                WHERE id = %s
                """,
                (status, summary_tag, run_id),
            )
        elif status == "blocked":
            await cur.execute(
                """
                UPDATE workstream_runs
                SET status = %s, blocked_reason = %s
                WHERE id = %s
                """,
                (status, blocked_reason, run_id),
            )
        elif status == "active":
            await cur.execute(
                """
                UPDATE workstream_runs
                SET status = %s, blocked_reason = NULL,
                    started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3))
                WHERE id = %s
                """,
                (status, run_id),
            )
        else:
            await cur.execute(
                "UPDATE workstream_runs SET status = %s, blocked_reason = %s WHERE id = %s",
                (status, blocked_reason, run_id),
            )
        return await self.get_run(cur, run_id)

    async def count_active_by_owner(
        self, cur: Any, loop_id: str, owner_kind: str, owner_id: str, exclude_run_id: str | None = None
    ) -> int:
        sql = """
            SELECT COUNT(*) AS c FROM workstream_runs
            WHERE loop_id = %s AND owner_kind = %s AND owner_id = %s
              AND status = 'active'
        """
        params: list[Any] = [loop_id, owner_kind, owner_id]
        if exclude_run_id:
            sql += " AND id != %s"
            params.append(exclude_run_id)
        await cur.execute(sql, params)
        row = await cur.fetchone()
        return int(row["c"])

    async def create_event(
        self,
        cur: Any,
        run_id: str,
        loop_id: str,
        event_type: str,
        payload: dict | None = None,
    ) -> None:
        await cur.execute(
            """
            INSERT INTO workstream_events (id, run_id, loop_id, event_type, payload)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (new_id(), run_id, loop_id, event_type, serialize_json(payload or {})),
        )

    async def delete_loop_cascade(self, cur: Any, loop_id: str) -> None:
        tables = [
            ("workstream_events", "loop_id"),
            ("workstream_runs", "loop_id"),
            ("workstream_dependencies", None),
            ("workstream_instances", "loop_id"),
            ("messages", "loop_id"),
            ("action_records", "loop_id"),
            ("artifacts", "loop_id"),
            ("audit_logs", "loop_id"),
            ("loop_members", "loop_id"),
        ]
        for table, col in tables:
            if col:
                await cur.execute(f"DELETE FROM {table} WHERE {col} = %s", (loop_id,))
        await cur.execute(
            """
            DELETE d FROM workstream_dependencies d
            JOIN workstream_instances i ON i.id = d.instance_id
            WHERE i.loop_id = %s
            """,
            (loop_id,),
        )
        await cur.execute("DELETE FROM loops WHERE id = %s", (loop_id,))


class ArtifactRepository:
    async def create(
        self,
        cur: Any,
        loop_id: str,
        artifact_type: str,
        path: str | None,
        content: dict,
        run_id: str | None = None,
    ) -> dict:
        version = 1
        if path:
            await cur.execute(
                """
                SELECT COALESCE(MAX(version), 0) AS v FROM artifacts
                WHERE loop_id = %s AND type = %s AND path = %s
                """,
                (loop_id, artifact_type, path),
            )
            row = await cur.fetchone()
            version = int(row["v"]) + 1

        aid = new_id()
        await cur.execute(
            """
            INSERT INTO artifacts (id, loop_id, run_id, type, path, content, version)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (aid, loop_id, run_id, artifact_type, path, serialize_json(content), version),
        )
        return await self.get_by_id(cur, aid)

    async def get_by_id(self, cur: Any, artifact_id: str) -> dict | None:
        await cur.execute("SELECT * FROM artifacts WHERE id = %s", (artifact_id,))
        return await cur.fetchone()

    async def list_by_loop(self, cur: Any, loop_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM artifacts WHERE loop_id = %s ORDER BY created_at DESC",
            (loop_id,),
        )
        return await cur.fetchall()

    async def list_by_run(self, cur: Any, run_id: str) -> list[dict]:
        await cur.execute(
            "SELECT * FROM artifacts WHERE run_id = %s ORDER BY version DESC",
            (run_id,),
        )
        return await cur.fetchall()


class AuditRepository:
    async def create(
        self,
        cur: Any,
        actor: str,
        action: str,
        loop_id: str | None = None,
        detail: dict | None = None,
    ) -> dict:
        aid = new_id()
        await cur.execute(
            """
            INSERT INTO audit_logs (id, loop_id, actor, action, detail)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (aid, loop_id, actor, action, serialize_json(detail or {})),
        )
        await cur.execute("SELECT * FROM audit_logs WHERE id = %s", (aid,))
        return await cur.fetchone()

    async def list_by_loop(self, cur: Any, loop_id: str, limit: int = 500) -> list[dict]:
        await cur.execute(
            """
            SELECT * FROM audit_logs WHERE loop_id = %s
            ORDER BY created_at DESC LIMIT %s
            """,
            (loop_id, limit),
        )
        return await cur.fetchall()

    async def list_by_project(self, cur: Any, project_id: str, limit: int = 500) -> list[dict]:
        await cur.execute(
            """
            SELECT a.* FROM audit_logs a
            JOIN loops l ON l.id = a.loop_id
            WHERE l.project_id = %s
            ORDER BY a.created_at DESC LIMIT %s
            """,
            (project_id, limit),
        )
        return await cur.fetchall()
