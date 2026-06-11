import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};
const targets = [join(root, 'packages', 'web', '.next')];

for (const dir of targets) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    note(`removed ${dir}`);
  } else {
    note(`skip (missing) ${dir}`);
  }
}

try {
  const tracked = execSync('git ls-files packages/web/.next', {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (tracked) {
    execSync('git rm -r --cached packages/web/.next', { cwd: root, stdio: 'inherit' });
    note('git rm --cached packages/web/.next');
  } else {
    note('packages/web/.next not tracked');
  }
} catch (err) {
  note(`error: ${err.message}`);
  writeFileSync(join(root, 'scripts', 'cleanup-build-artifacts.log'), log.join('\n'));
  process.exit(1);
}

writeFileSync(join(root, 'scripts', 'cleanup-build-artifacts.log'), log.join('\n'));
