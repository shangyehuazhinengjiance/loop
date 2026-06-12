from __future__ import annotations

from typing import Any


class DependencyResolver:
    """解析子任务流依赖：上游 done 后解锁 downstream。"""

    async def refresh_loop(self, cur: Any, loop_id: str, workstream_repo: Any) -> list[str]:
        """将满足依赖的 pending/ready Run 更新为 ready。返回被更新的 run_id 列表。"""
        deps = await workstream_repo.list_dependencies(cur, loop_id)
        instances = await workstream_repo.list_instances(cur, loop_id)
        inst_map = {i["id"]: i for i in instances}

        done_instances: set[str] = set()
        for inst in instances:
            latest = await workstream_repo.latest_run_for_instance(cur, inst["id"])
            if latest and latest["status"] == "done":
                done_instances.add(inst["id"])

        updated: list[str] = []
        for inst in instances:
            latest = await workstream_repo.latest_run_for_instance(cur, inst["id"])
            if not latest or latest["status"] not in ("pending", "blocked"):
                continue

            hard_deps = [
                d["depends_on_id"]
                for d in deps
                if d["instance_id"] == inst["id"] and d.get("kind", "hard") == "hard"
            ]
            if hard_deps and not all(d in done_instances for d in hard_deps):
                continue

            if latest["status"] in ("pending", "blocked"):
                await workstream_repo.update_run_status(cur, latest["id"], "ready")
                updated.append(latest["id"])
        return updated

    async def deps_satisfied(
        self, cur: Any, instance_id: str, workstream_repo: Any
    ) -> tuple[bool, list[str]]:
        deps = await workstream_repo.list_deps_for_instance(cur, instance_id)
        if not deps:
            return True, []
        missing = []
        for d in deps:
            if d.get("kind", "hard") != "hard":
                continue
            upstream = await workstream_repo.latest_run_for_instance(cur, d["depends_on_id"])
            if not upstream or upstream["status"] != "done":
                missing.append(d["depends_on_id"])
        return len(missing) == 0, missing
