from __future__ import annotations

import re
from typing import Any


# 群聊按钮 action → 子任务流模板（Human 确认后 complete 对应 Run）
APPROVAL_ACTION_TEMPLATES: dict[str, str] = {
    "approve_prd": "pm-prd",
    "approve_dev": "dev-impl",
    "approve_deploy": "ops-deploy-prod",
}

CHAT_INTENT_PATTERNS: dict[str, list[str]] = {
    "confirm_mr_merged": ["已合并", "mr merged", "合完了", "merge complete"],
    "approve_test": ["测试通过", "验收通过", "test passed"],
    "task_done": ["做完了", "已完成", "done", "完成了"],
    "clarify_done": ["澄清完毕", "澄清完成", "没问题了"],
}


def match_chat_intent(body: str, template_definition: dict[str, Any]) -> str | None:
    text = body.strip().lower()
    end_any = template_definition.get("end_any_of") or []
    for rule in end_any:
        if rule.get("type") != "chat_intent":
            continue
        for pattern in rule.get("patterns") or []:
            if pattern.lower() in text or re.search(re.escape(pattern.lower()), text):
                action_id = rule.get("actionId") or _infer_action_id(template_definition)
                return action_id or "task_done"
    return None


def _infer_action_id(defn: dict[str, Any]) -> str | None:
    for rule in defn.get("end_any_of") or []:
        if rule.get("type") == "explicit_action":
            return rule.get("actionId")
    return None


def build_confirmation_actions(run_id: str, action_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"confirm-{run_id}",
            "label": "确认完成",
            "action": action_id,
            "runId": run_id,
        },
        {
            "id": f"dismiss-{run_id}",
            "label": "取消",
            "action": "dismiss_confirm",
            "runId": run_id,
        },
    ]
