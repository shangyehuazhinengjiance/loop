import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { resolveWorkspacePath, validateBashCommand } from './security.js';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
]);

const MAX_TOOL_OUTPUT = 12_000;
const MAX_GREP_MATCHES = 40;
const MAX_GLOB_RESULTS = 80;

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n…(truncated)`;
}

function formatFsError(err: unknown, filePath: string): string {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOENT') {
    return `Error: file not found: ${filePath}（文件不存在，可尝试其他路径或 glob）`;
  }
  return `Error: ${e.message ?? String(err)}`;
}

async function walkFiles(
  root: string,
  dir: string,
  out: string[],
  limit: number,
): Promise<void> {
  if (out.length >= limit) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= limit) break;
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    const rel = relative(root, full).replace(/\\/g, '/');
    if (st.isDirectory()) {
      await walkFiles(root, full, out, limit);
    } else {
      out.push(rel);
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export const DEV_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取工作区内的文本文件',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对工作区根目录的路径' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: '写入或覆盖工作区内的文件',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: '将文件中 old_string 替换为 new_string（需唯一匹配）',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bash',
      description: '在工作区根目录执行 shell 命令',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob',
      description: '按 glob 模式列出文件，如 **/*.ts',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep',
      description: '在源码文件中搜索正则表达式',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: '可选子目录，默认整个工作区' },
        },
        required: ['pattern'],
      },
    },
  },
];

export async function executeDevTool(
  workspacePath: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: string; artifact?: boolean }> {
  switch (name) {
    case 'read_file': {
      const filePath = String(args.file_path ?? '');
      const resolved = resolveWorkspacePath(workspacePath, filePath);
      if (!resolved.ok) return { output: `Error: ${resolved.reason}` };
      try {
        const content = await readFile(resolved.absolute, 'utf-8');
        return { output: truncate(content) };
      } catch (err) {
        return { output: formatFsError(err, filePath) };
      }
    }
    case 'write_file': {
      const filePath = String(args.file_path ?? '');
      const resolved = resolveWorkspacePath(workspacePath, filePath);
      if (!resolved.ok) return { output: `Error: ${resolved.reason}` };
      try {
        await mkdir(dirname(resolved.absolute), { recursive: true });
        await writeFile(resolved.absolute, String(args.content ?? ''), 'utf-8');
        return { output: `Wrote ${filePath}`, artifact: true };
      } catch (err) {
        return { output: formatFsError(err, filePath) };
      }
    }
    case 'edit_file': {
      const filePath = String(args.file_path ?? '');
      const oldString = String(args.old_string ?? '');
      const newString = String(args.new_string ?? '');
      const resolved = resolveWorkspacePath(workspacePath, filePath);
      if (!resolved.ok) return { output: `Error: ${resolved.reason}` };
      let content: string;
      try {
        content = await readFile(resolved.absolute, 'utf-8');
      } catch (err) {
        return { output: formatFsError(err, filePath) };
      }
      if (!content.includes(oldString)) {
        return { output: `Error: old_string not found in ${filePath}` };
      }
      const count = content.split(oldString).length - 1;
      if (count > 1) {
        return { output: `Error: old_string matches ${count} times, must be unique` };
      }
      await writeFile(resolved.absolute, content.replace(oldString, newString), 'utf-8');
      return { output: `Edited ${filePath}`, artifact: true };
    }
    case 'bash': {
      const command = String(args.command ?? '');
      const check = validateBashCommand(command);
      if (!check.ok) return { output: `Error: ${check.reason}` };
      try {
        const { stdout, stderr } = await execFileAsync(
          process.env.SHELL ?? 'bash',
          ['-lc', command],
          {
            cwd: workspacePath,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, SHELL: process.env.SHELL ?? '/bin/bash' },
          },
        );
        return { output: truncate([stdout, stderr].filter(Boolean).join('\n') || '(no output)') };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return {
          output: truncate(
            [e.stdout, e.stderr, e.message].filter(Boolean).join('\n') || 'Command failed',
          ),
        };
      }
    }
    case 'glob': {
      const pattern = String(args.pattern ?? '*');
      const re = globToRegExp(pattern);
      const files: string[] = [];
      await walkFiles(workspacePath, workspacePath, files, 500);
      const matched = files.filter((f) => re.test(f)).slice(0, MAX_GLOB_RESULTS);
      return { output: matched.join('\n') || '(no matches)' };
    }
    case 'grep': {
      const pattern = String(args.pattern ?? '');
      const sub = args.path ? String(args.path) : '.';
      const resolved = resolveWorkspacePath(workspacePath, sub);
      if (!resolved.ok) return { output: `Error: ${resolved.reason}` };
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        return { output: `Error: invalid regex: ${pattern}` };
      }
      const files: string[] = [];
      const base = resolved.absolute;
      const st = await stat(base);
      if (st.isFile()) {
        files.push(relative(workspacePath, base).replace(/\\/g, '/'));
      } else {
        await walkFiles(workspacePath, base, files, 400);
      }
      const lines: string[] = [];
      for (const file of files) {
        if (lines.length >= MAX_GREP_MATCHES) break;
        try {
          const content = await readFile(join(workspacePath, file), 'utf-8');
          for (const [i, line] of content.split('\n').entries()) {
            if (re.test(line)) {
              lines.push(`${file}:${i + 1}:${line}`);
              if (lines.length >= MAX_GREP_MATCHES) break;
            }
          }
        } catch {
          // skip binary
        }
      }
      return { output: lines.join('\n') || '(no matches)' };
    }
    default:
      return { output: `Error: unknown tool ${name}` };
  }
}

export function toolProgressMessage(name: string, args: Record<string, unknown>): {
  body: string;
  type: 'text' | 'artifact';
} {
  if (name === 'read_file') {
    return { body: `正在读取 ${args.file_path ?? ''}`, type: 'text' };
  }
  if (name === 'write_file' || name === 'edit_file') {
    return { body: `修改文件 ${args.file_path ?? ''}`, type: 'artifact' };
  }
  if (name === 'bash') {
    return { body: `执行：${args.command ?? ''}`, type: 'text' };
  }
  return { body: `执行工具 ${name}`, type: 'text' };
}
