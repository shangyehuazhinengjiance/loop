from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.db import transaction
from app.schemas import (
    ActionRequest,
    BlockRunRequest,
    CompleteRunRequest,
    CreateLoopRequest,
    CreateProjectRequest,
    CreateWorkStreamRequest,
    ReopenWorkStreamRequest,
    SendMessageRequest,
    SpawnWorkStreamRequest,
)
from app.services import loop_service, sse_stream

router = APIRouter(prefix="/api")
service = loop_service


@router.get("/health")
async def health():
    return {"status": "ok", "version": "v2"}


@router.get("/projects")
async def list_projects():
    async with transaction() as (_, cur):
        return await service.list_projects(cur)


@router.post("/projects")
async def create_project(body: CreateProjectRequest):
    async with transaction() as (_, cur):
        return await service.create_project(cur, body.name, body.gitConfig, body.modelConfig)


@router.post("/projects/{project_id}/loops")
async def create_loop(project_id: str, body: CreateLoopRequest):
    try:
        async with transaction() as (_, cur):
            loop = await service.create_loop(
                cur,
                project_id,
                body.title,
                body.inputRequirements,
                body.inputRequirementsTitle,
            )
            await service.publish_system_message(
                cur,
                loop.id,
                f"Loop「{loop.title}」已创建。使用 @pm-agent / @dev-agent / @ops-agent 启动子任务流，或在看板手动添加。",
            )
            await service.init_loop_git(
                cur,
                loop.id,
                body.inputRequirements,
                body.inputRequirementsTitle,
            )
            loop = await service.get_loop(cur, loop.id)
            return loop
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/loops/{loop_id}")
async def get_loop(loop_id: str):
    async with transaction() as (_, cur):
        loop = await service.get_loop_agent(cur, loop_id)
    if not loop:
        raise HTTPException(404, "Loop not found")
    return loop


@router.post("/loops/{loop_id}/members")
async def join_loop(
    loop_id: str,
    body: dict,
):
    try:
        async with transaction() as (_, cur):
            await service.join_loop(
                cur,
                loop_id,
                body.get("userId", "human"),
                body.get("displayName", "Human"),
                body.get("bio", ""),
            )
            return {"ok": True}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/loops/{loop_id}/messages")
async def list_messages(loop_id: str):
    async with transaction() as (_, cur):
        return await service.list_messages(cur, loop_id)


@router.post("/loops/{loop_id}/messages")
async def send_message(loop_id: str, body: SendMessageRequest):
    try:
        async with transaction() as (_, cur):
            return await service.send_human_message(
                cur, loop_id, body.body, body.userId, body.displayName, body.mentions
            )
    except ValueError as e:
        msg = str(e)
        status = 404 if msg == "Loop not found" else 400
        raise HTTPException(status, msg) from e


@router.post("/loops/{loop_id}/actions")
async def post_action(loop_id: str, body: ActionRequest):
    try:
        async with transaction() as (_, cur):
            return await service.handle_action(
                cur, loop_id, body.action, body.userId, body.runId, body.note
            )
    except ValueError as e:
        msg = str(e)
        status = 404 if msg == "Loop not found" else 400
        raise HTTPException(status, msg) from e


@router.get("/loops/{loop_id}/events")
async def loop_events(loop_id: str):
    return StreamingResponse(sse_stream(loop_id), media_type="text/event-stream")


@router.get("/workstream-templates")
async def list_templates():
    return await service.list_templates()


@router.get("/loops/{loop_id}/workstreams")
async def list_workstreams(
    loop_id: str,
    status: str | None = Query(None),
):
    async with transaction() as (_, cur):
        return await service.list_runs(cur, loop_id, status)


@router.get("/loops/{loop_id}/workstreams/board")
async def workstream_board(loop_id: str):
    try:
        async with transaction() as (_, cur):
            return await service.get_board(cur, loop_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/loops/{loop_id}/workstreams/stats")
async def workstream_stats(loop_id: str):
    async with transaction() as (_, cur):
        loop = await service.get_loop(cur, loop_id)
    if not loop:
        raise HTTPException(404, "Loop not found")
    return {"loopId": loop_id, "stats": loop.workstreamSummary}


@router.get("/loops/{loop_id}/workstreams/graph")
async def workstream_graph(loop_id: str):
    try:
        async with transaction() as (_, cur):
            return await service.get_graph(cur, loop_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/loops/{loop_id}/workstreams")
async def create_workstream(loop_id: str, body: CreateWorkStreamRequest):
    try:
        async with transaction() as (_, cur):
            run = await service.create_workstream(
                cur,
                loop_id,
                body.templateId,
                title=body.title,
                assignee_id=body.assigneeId,
                depends_on=body.dependsOnInstanceIds,
                auto_start=False,
            )
            await service.publish_system_message(
                cur,
                loop_id,
                f"已添加子任务流：{run.templateName or run.templateId}",
                extra={"event": "created", "runId": run.id},
                run_id=run.id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/spawn")
async def spawn_workstream(loop_id: str, body: SpawnWorkStreamRequest):
    try:
        async with transaction() as (_, cur):
            run = await service.spawn_workstream(
                cur,
                loop_id,
                body.templateId,
                body.reason,
                body.fromRunId,
                body.assigneeId,
                body.title,
            )
            await service.publish_system_message(
                cur,
                loop_id,
                f"已 spawn 子任务流：{run.templateName}，原因：{body.reason}",
                extra={"event": "spawned", "runId": run.id, "reason": body.reason},
                run_id=run.id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/{instance_id}/start")
async def start_workstream(loop_id: str, instance_id: str, body: dict | None = None):
    try:
        async with transaction() as (_, cur):
            run = await service.start_instance(
                cur, loop_id, instance_id, (body or {}).get("userId")
            )
            await service.publish_system_message(
                cur,
                loop_id,
                f"子任务流已启动：{run.templateName}",
                extra={"event": "started", "runId": run.id},
                run_id=run.id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/{instance_id}/reopen")
async def reopen_workstream(loop_id: str, instance_id: str, body: ReopenWorkStreamRequest):
    try:
        async with transaction() as (_, cur):
            run = await service.reopen_instance(
                cur, loop_id, instance_id, body.reason, None
            )
            await service.publish_system_message(
                cur,
                loop_id,
                f"子任务流已重开：{run.templateName}，原因：{body.reason}",
                extra={"event": "reopened", "runId": run.id},
                run_id=run.id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/runs/{run_id}/block")
async def block_run(loop_id: str, run_id: str, body: BlockRunRequest):
    try:
        async with transaction() as (_, cur):
            run = await service.block_run(cur, loop_id, run_id, body.reason)
            await service.publish_system_message(
                cur,
                loop_id,
                f"子任务流已阻塞：{body.reason}",
                extra={"event": "blocked", "runId": run_id},
                run_id=run_id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/runs/{run_id}/complete")
async def complete_run(loop_id: str, run_id: str, body: CompleteRunRequest | None = None):
    try:
        async with transaction() as (_, cur):
            run = await service.complete_run(
                cur, loop_id, run_id, (body.summaryTag if body else None)
            )
            await service.publish_system_message(
                cur,
                loop_id,
                f"子任务流已完成：{run.templateName}",
                extra={"event": "done", "runId": run_id},
                run_id=run_id,
            )
            return run
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workstreams/runs/{run_id}/cancel")
async def cancel_run(loop_id: str, run_id: str):
    try:
        async with transaction() as (_, cur):
            return await service.cancel_run(cur, loop_id, run_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# --- Agent Worker 对接 ---


@router.post("/loops/{loop_id}/agent-messages")
async def post_agent_message(loop_id: str, body: dict):
    try:
        async with transaction() as (_, cur):
            return await service.post_agent_message(
                cur,
                loop_id,
                body.get("agentId", "pm-agent"),
                body.get("content") or {},
                run_id=body.get("runId"),
                phase=body.get("phase"),
            )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.patch("/loops/{loop_id}/context")
async def patch_loop_context(loop_id: str, body: dict):
    try:
        async with transaction() as (_, cur):
            ctx = await service.update_loop_context(cur, loop_id, body.get("context") or body)
            return {"context": ctx}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/loops/{loop_id}/runs/{run_id}/agent/complete")
async def agent_complete_run(loop_id: str, run_id: str, body: dict | None = None):
    try:
        async with transaction() as (_, cur):
            return await service.complete_run(
                cur, loop_id, run_id, (body or {}).get("summaryTag")
            )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/runs/{run_id}/agent/block")
async def agent_block_run(loop_id: str, run_id: str, body: BlockRunRequest):
    try:
        async with transaction() as (_, cur):
            return await service.block_run(cur, loop_id, run_id, body.reason)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/runs/{run_id}/agent/spawn")
async def agent_spawn_from_run(loop_id: str, run_id: str, body: SpawnWorkStreamRequest):
    try:
        async with transaction() as (_, cur):
            return await service.agent_request_spawn(
                cur, loop_id, run_id, body.templateId, body.reason
            )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/progress")
async def agent_progress(loop_id: str, body: dict):
    async with transaction() as (_, cur):
        await service.agent_progress_report(cur, loop_id, body)
    return {"ok": True}


@router.post("/loops/{loop_id}/workspace/publish-prd")
async def publish_prd_to_git(loop_id: str):
    try:
        async with transaction() as (_, cur):
            return await service.publish_prd_to_git(cur, loop_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/loops/{loop_id}/workspace/commit-dev")
async def commit_dev_workspace(loop_id: str, body: dict | None = None):
    try:
        async with transaction() as (_, cur):
            return await service.commit_dev_workspace(
                cur, loop_id, (body or {}).get("message")
            )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# --- Phase 3: 统计 / 回放 / Artifact / 审计 ---


@router.get("/projects/{project_id}/workstreams/stats")
async def project_workstream_stats(project_id: str):
    async with transaction() as (_, cur):
        return await service.stats.project_stats(cur, project_id)


@router.get("/loops/{loop_id}/workstreams/stats/detail")
async def loop_workstream_stats_detail(loop_id: str):
    async with transaction() as (_, cur):
        return await service.stats.loop_stats(cur, loop_id)


@router.get("/loops/{loop_id}/timeline")
async def loop_timeline(loop_id: str):
    async with transaction() as (_, cur):
        return {
            "loopId": loop_id,
            "items": await service.stats.summary_timeline(cur, loop_id),
        }


@router.get("/loops/{loop_id}/replay")
async def loop_replay(loop_id: str, runId: str | None = Query(None)):
    async with transaction() as (_, cur):
        return await service.replay.replay(cur, loop_id, runId)


@router.get("/loops/{loop_id}/artifacts")
async def list_artifacts(loop_id: str):
    async with transaction() as (_, cur):
        return await service.artifacts.list_loop(cur, loop_id)


@router.post("/loops/{loop_id}/artifacts")
async def create_artifact(loop_id: str, body: dict):
    try:
        async with transaction() as (_, cur):
            artifact = await service.artifacts.save(
                cur,
                loop_id,
                body.get("type", "generic"),
                body.get("content") or {},
                path=body.get("path"),
                run_id=body.get("runId"),
            )
            await service.audit.log(
                cur,
                body.get("createdBy", "system"),
                "artifact.create",
                loop_id,
                {"artifactId": artifact["id"], "type": artifact["type"]},
            )
            return artifact
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/loops/{loop_id}/artifacts/compare")
async def compare_artifacts(
    loop_id: str,
    fromId: str = Query(...),
    toId: str = Query(...),
):
    try:
        async with transaction() as (_, cur):
            return await service.artifacts.compare(cur, fromId, toId)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/loops/{loop_id}/audit")
async def list_audit(loop_id: str):
    async with transaction() as (_, cur):
        return await service.audit.list_loop(cur, loop_id)


@router.post("/loops/{loop_id}/audit")
async def post_audit_log(loop_id: str, body: dict):
    async with transaction() as (_, cur):
        await service.audit.log(
            cur,
            body.get("actor", "system"),
            body.get("action", "unknown"),
            loop_id,
            body.get("detail"),
        )
    return {"ok": True}
