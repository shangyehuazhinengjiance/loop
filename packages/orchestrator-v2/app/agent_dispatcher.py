from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

TEMPLATE_AGENT: dict[str, str] = {
    "pm-prd": "pm-agent",
    "pm-revision": "pm-agent",
    "pm-clarify": "pm-agent",
    "dev-impl": "dev-agent",
    "ops-deploy-test": "ops-agent",
    "ops-deploy-prod": "ops-agent",
}

TEMPLATE_PHASE: dict[str, str] = {
    "pm-prd": "requirement",
    "pm-revision": "requirement",
    "pm-clarify": "requirement",
    "dev-impl": "development",
    "ops-deploy-test": "deployment",
    "ops-deploy-prod": "deployment",
}


class AgentDispatcher:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._running: set[str] = set()

    def agent_for_template(self, template_id: str) -> str | None:
        return TEMPLATE_AGENT.get(template_id)

    def phase_for_template(self, template_id: str) -> str:
        return TEMPLATE_PHASE.get(template_id, "requirement")

    async def dispatch_run(
        self,
        loop_id: str,
        run_id: str,
        template_id: str,
        owner_id: str,
        started_by: str | None = None,
    ) -> None:
        if owner_id not in ("pm-agent", "dev-agent", "ops-agent"):
            return
        key = f"{loop_id}:{run_id}"
        if key in self._running:
            return
        self._running.add(key)
        asyncio.create_task(
            self._invoke_worker(loop_id, run_id, template_id, owner_id, started_by, key)
        )

    async def _invoke_worker(
        self,
        loop_id: str,
        run_id: str,
        template_id: str,
        agent_id: str,
        started_by: str | None,
        key: str,
    ) -> None:
        url = f"{self.settings.agent_worker_url.rstrip('/')}/internal/runs/start"
        payload = {
            "loopId": loop_id,
            "runId": run_id,
            "templateId": template_id,
            "agentId": agent_id,
            "orchestratorUrl": f"http://127.0.0.1:{self.settings.orchestrator_port}",
            "startedBy": started_by,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code >= 400:
                    logger.error("agent worker rejected run %s: %s", run_id, res.text)
        except Exception as exc:
            logger.exception("agent dispatch failed run=%s: %s", run_id, exc)
        finally:
            self._running.discard(key)

    async def cancel_run(self, loop_id: str, run_id: str, agent_id: str) -> None:
        url = f"{self.settings.agent_worker_url.rstrip('/')}/internal/runs/cancel"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json={"loopId": loop_id, "runId": run_id, "agentId": agent_id})
        except Exception as exc:
            logger.warning("agent cancel failed: %s", exc)


agent_dispatcher = AgentDispatcher()
