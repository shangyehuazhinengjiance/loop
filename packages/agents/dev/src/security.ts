import { resolve } from 'node:path';

export const BLOCKED_BASH = [/rm\s+-rf\s+\//, /mkfs/, /curl\s+.*\|\s*sh/];
export const SENSITIVE_FILES = [/\.env$/, /id_rsa$/, /\.pem$/];

export function resolveWorkspacePath(
  workspacePath: string,
  filePath: string,
): { ok: true; absolute: string } | { ok: false; reason: string } {
  const absolute = resolve(workspacePath, filePath);
  const ws = resolve(workspacePath);
  if (!absolute.startsWith(ws)) {
    return { ok: false, reason: `Path outside workspace: ${filePath}` };
  }
  for (const pattern of SENSITIVE_FILES) {
    if (pattern.test(absolute)) {
      return { ok: false, reason: `Sensitive file blocked: ${filePath}` };
    }
  }
  return { ok: true, absolute };
}

export function validateBashCommand(command: string): { ok: true } | { ok: false; reason: string } {
  for (const pattern of BLOCKED_BASH) {
    if (pattern.test(command)) {
      return { ok: false, reason: `Blocked command: ${command}` };
    }
  }
  return { ok: true };
}
