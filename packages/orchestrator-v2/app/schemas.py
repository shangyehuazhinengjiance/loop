from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

WorkStreamStatus = Literal[
    "pending", "ready", "active", "blocked", "completing", "done", "cancelled"
]
LoopStatus = Literal["active", "blocked", "done", "archived"]
ParticipantKind = Literal["human", "agent"]


class Participant(BaseModel):
    kind: ParticipantKind
    id: str
    displayName: str


class CreateProjectRequest(BaseModel):
    name: str
    gitConfig: dict[str, Any] = Field(default_factory=dict)
    modelConfig: dict[str, Any] = Field(default_factory=dict)


class ProjectResponse(BaseModel):
    id: str
    name: str
    gitConfig: dict[str, Any]
    modelConfig: dict[str, Any]
    createdAt: datetime
    updatedAt: datetime


class CreateLoopRequest(BaseModel):
    title: str
    inputRequirements: str | None = None
    inputRequirementsTitle: str | None = None


class LoopResponse(BaseModel):
    id: str
    projectId: str
    title: str
    status: LoopStatus
    gitBranch: str | None = None
    workspacePath: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    milestone: dict[str, Any] | None = None
    createdAt: datetime
    updatedAt: datetime
    workstreamSummary: dict[str, int] = Field(default_factory=dict)


class WorkStreamTemplateResponse(BaseModel):
    id: str
    name: str
    ownerKind: ParticipantKind
    defaultOwner: str | None = None
    ephemeral: bool = False
    definition: dict[str, Any] = Field(default_factory=dict)


class WorkStreamRunResponse(BaseModel):
    id: str
    instanceId: str
    loopId: str
    templateId: str
    templateName: str | None = None
    version: int
    status: WorkStreamStatus
    owner: Participant
    assigneeId: str | None = None
    startedAt: datetime | None = None
    endedAt: datetime | None = None
    startedBy: str | None = None
    blockedReason: str | None = None
    spawnedFrom: str | None = None
    supersedes: str | None = None
    summaryTag: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime


class WorkStreamBoardItem(BaseModel):
    instanceId: str
    title: str
    templateId: str
    templateName: str
    latestRun: WorkStreamRunResponse


class WorkStreamBoardResponse(BaseModel):
    loopId: str
    columns: dict[str, list[WorkStreamBoardItem]]
    stats: dict[str, int]


class CreateWorkStreamRequest(BaseModel):
    templateId: str
    title: str | None = None
    assigneeId: str | None = None
    dependsOnInstanceIds: list[str] = Field(default_factory=list)


class SpawnWorkStreamRequest(BaseModel):
    templateId: str
    fromRunId: str | None = None
    reason: str
    assigneeId: str | None = None
    title: str | None = None


class ReopenWorkStreamRequest(BaseModel):
    reason: str


class BlockRunRequest(BaseModel):
    reason: str


class CompleteRunRequest(BaseModel):
    note: str | None = None
    summaryTag: str | None = None


class SendMessageRequest(BaseModel):
    body: str
    userId: str = "human"
    displayName: str = "Human"
    mentions: list[str] = Field(default_factory=list)


class MessageSender(BaseModel):
    type: Literal["human", "agent", "system"]
    id: str
    displayName: str


class MessageResponse(BaseModel):
    id: str
    loopId: str
    runId: str | None = None
    sender: MessageSender
    content: dict[str, Any]
    createdAt: datetime


class ActionRequest(BaseModel):
    action: str
    runId: str | None = None
    note: str | None = None
    userId: str = "human"
    displayName: str = "Human"
