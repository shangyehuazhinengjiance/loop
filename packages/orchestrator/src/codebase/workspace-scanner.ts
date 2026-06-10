import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  'vendor',
  '.loop',
  '_project-cache',
]);

const KEY_FILE_NAMES = new Set([
  'README.md',
  'readme.md',
  'package.json',
  'tsconfig.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  'go.mod',
  'pyproject.toml',
  'Cargo.toml',
]);

const MAX_TREE_LINES = 120;
const MAX_KEY_FILES = 16;
const MAX_FILE_BYTES = 12_000;
const MAX_DEPTH = 4;

export interface WorkspaceSnapshot {
  tree: string;
  keyFiles: { path: string; content: string }[];
}

async function buildTree(
  root: string,
  dir: string,
  depth: number,
  lines: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || lines.length >= MAX_TREE_LINES) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  entries.sort();
  for (const name of entries) {
    if (lines.length >= MAX_TREE_LINES) break;
    if (SKIP_DIRS.has(name)) continue;

    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, '/');
    let isDir = false;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }

    lines.push(`${'  '.repeat(depth)}${isDir ? '📁 ' : '📄 '}${rel}`);
    if (isDir) {
      await buildTree(root, full, depth + 1, lines);
    }
  }
}

async function collectKeyFiles(
  root: string,
  dir: string,
  depth: number,
  out: { path: string; content: string }[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_KEY_FILES) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (out.length >= MAX_KEY_FILES) break;
    if (SKIP_DIRS.has(name)) continue;

    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      await collectKeyFiles(root, full, depth + 1, out);
      continue;
    }

    if (!KEY_FILE_NAMES.has(name)) continue;
    if (st.size > MAX_FILE_BYTES) continue;

    try {
      const content = await readFile(full, 'utf-8');
      out.push({
        path: relative(root, full).replace(/\\/g, '/'),
        content: content.slice(0, MAX_FILE_BYTES),
      });
    } catch {
      // 二进制或不可读文件跳过
    }
  }
}

export async function scanWorkspace(workspacePath: string): Promise<WorkspaceSnapshot> {
  const treeLines: string[] = [];
  await buildTree(workspacePath, workspacePath, 0, treeLines);

  const keyFiles: { path: string; content: string }[] = [];
  await collectKeyFiles(workspacePath, workspacePath, 0, keyFiles);

  return {
    tree: treeLines.join('\n') || '(empty workspace)',
    keyFiles,
  };
}
