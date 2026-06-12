from __future__ import annotations

import asyncio
import os
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from app.config import get_settings


class GitService:
    """Loop Git 工作区：clone、commit、Summary Tag。"""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def init_loop_workspace(
        self, loop_id: str, project_git: dict[str, Any], workspace_path: str, loop_branch: str
    ) -> dict[str, str]:
        return await asyncio.to_thread(
            self._init_sync, loop_id, project_git, workspace_path, loop_branch
        )

    def _init_sync(
        self, loop_id: str, project_git: dict[str, Any], workspace_path: str, loop_branch: str
    ) -> dict[str, str]:
        ws = Path(workspace_path)
        ws.mkdir(parents=True, exist_ok=True)
        remote_url = (project_git or {}).get("remoteUrl") or ""
        default_branch = (project_git or {}).get("defaultBranch") or "main"
        credential_ref = (project_git or {}).get("credentialRef") or "GIT_ACCESS_TOKEN"
        env = self._git_env(credential_ref)

        if not remote_url:
            if not (ws / ".git").exists():
                self._run(["git", "init"], cwd=ws)
                self._run(["git", "config", "user.email", "loop@ai-native.dev"], cwd=ws)
                self._run(["git", "config", "user.name", "AI Native Loop"], cwd=ws)
                self._run(
                    ["git", "commit", "--allow-empty", "-m", "init loop workspace"],
                    cwd=ws,
                )
            self._run(["git", "checkout", "-B", loop_branch], cwd=ws)
            git_ref = self._current_ref(ws)
            return {"workspacePath": str(ws), "gitBranch": loop_branch, "gitRef": git_ref}

        clone_url = self._authenticated_url(remote_url, credential_ref)
        if not (ws / ".git").exists():
            if any(ws.iterdir()):
                raise RuntimeError(f"Workspace not empty and no git: {ws}")
            self._run(["git", "clone", clone_url, str(ws)], env=env)
        self._run(["git", "checkout", default_branch], cwd=ws, env=env)
        self._run(["git", "checkout", "-B", loop_branch], cwd=ws, env=env)
        git_ref = self._current_ref(ws)
        return {"workspacePath": str(ws), "gitBranch": loop_branch, "gitRef": git_ref}

    async def write_input_requirements(
        self, workspace_path: str, loop_id: str, title: str, content: str
    ) -> str:
        rel = f"docs/loop/{loop_id}/INPUT_REQUIREMENTS.md"
        return await asyncio.to_thread(
            self._write_and_commit, workspace_path, rel, title, content, loop_id
        )

    def _write_and_commit(
        self, workspace_path: str, rel_path: str, title: str, content: str, loop_id: str
    ) -> str:
        ws = Path(workspace_path)
        target = ws / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"# {title}\n\n{content}\n", encoding="utf-8")
        self._run(["git", "add", rel_path], cwd=ws)
        status = self._run(["git", "status", "--porcelain"], cwd=ws).stdout.strip()
        if status:
            self._run(
                ["git", "commit", "-m", f"loop({loop_id}): import input requirements"],
                cwd=ws,
            )
        return rel_path

    async def create_summary_tag(
        self,
        workspace_path: str,
        loop_id: str,
        prefix: str,
        version: int,
        required_paths: list[str] | None = None,
    ) -> tuple[str, str]:
        return await asyncio.to_thread(
            self._tag_sync, workspace_path, loop_id, prefix, version, required_paths or []
        )

    def _tag_sync(
        self,
        workspace_path: str,
        loop_id: str,
        prefix: str,
        version: int,
        required_paths: list[str],
    ) -> tuple[str, str]:
        ws = Path(workspace_path)
        if not (ws / ".git").exists():
            return "", self._current_ref(ws)

        for rel in required_paths:
            rel = rel.replace("{loopId}", loop_id)
            if not (ws / rel).exists():
                raise FileNotFoundError(f"Required path missing for tag: {rel}")

        git_ref = self._current_ref(ws)
        tag = f"loop/{loop_id}/summary/{prefix}-v{version}"
        self._run(["git", "tag", "-f", tag, git_ref], cwd=ws)
        return tag, git_ref

    async def checkout_tag(self, workspace_path: str, tag: str) -> str:
        return await asyncio.to_thread(self._checkout_sync, workspace_path, tag)

    def _checkout_sync(self, workspace_path: str, tag: str) -> str:
        ws = Path(workspace_path)
        self._run(["git", "checkout", tag], cwd=ws)
        return self._current_ref(ws)

    def _authenticated_url(self, remote_url: str, credential_ref: str) -> str:
        token = os.environ.get("GIT_ACCESS_TOKEN")
        if credential_ref.startswith("env:"):
            token = os.environ.get(credential_ref[4:], token)
        if token and remote_url.startswith("https://"):
            parsed = urlparse(remote_url)
            return f"{parsed.scheme}://x-access-token:{quote(token)}@{parsed.netloc}{parsed.path}"
        ssh_match = re.match(r"git@([^:]+):(.+)", remote_url)
        if ssh_match:
            return f"https://{ssh_match.group(1)}/{ssh_match.group(2)}"
        return remote_url

    def _git_env(self, credential_ref: str) -> dict[str, str]:
        env = os.environ.copy()
        ssh_key = os.environ.get("GIT_SSH_KEY_PATH")
        if credential_ref.startswith("env:") and "ssh" in credential_ref.lower():
            ssh_key = os.environ.get(credential_ref[4:], ssh_key)
        if ssh_key and Path(ssh_key).exists():
            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {ssh_key} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes"
            )
        return env

    def _current_ref(self, ws: Path) -> str:
        try:
            return self._run(["git", "rev-parse", "HEAD"], cwd=ws).stdout.strip()
        except RuntimeError:
            return ""

    def _run(
        self,
        args: list[str],
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"git failed: {' '.join(args)}\n{result.stderr or result.stdout}"
            )
        return result
