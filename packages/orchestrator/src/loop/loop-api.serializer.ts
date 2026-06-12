import { toIso8601Utc } from '../db/datetime.js';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import type { ProjectRow } from '../db/repositories/project.repository.js';

export function serializeLoopRow(loop: LoopRow) {
  const createdAt = toIso8601Utc(loop.created_at);
  const updatedAt = toIso8601Utc(loop.updated_at);
  return {
    ...loop,
    created_at: createdAt,
    updated_at: updatedAt,
    createdAt,
    updatedAt,
  };
}

export function serializeProjectRow(project: ProjectRow) {
  const createdAt = toIso8601Utc(project.created_at);
  const updatedAt = toIso8601Utc(project.updated_at);
  return {
    ...project,
    created_at: createdAt,
    updated_at: updatedAt,
    createdAt,
    updatedAt,
  };
}
