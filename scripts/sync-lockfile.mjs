#!/usr/bin/env node
/** 在仓库根目录执行：node scripts/sync-lockfile.mjs */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('Running npm install in', root);
execSync('npm install', { cwd: root, stdio: 'inherit' });
console.log('Done. Commit package-lock.json if it changed.');
