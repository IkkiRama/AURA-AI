import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReleaseMetadata } from './release-metadata.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const { version } = readReleaseMetadata(root);
  const syntax = spawnSync(process.execPath, ['--check', 'scripts/release-windows.mjs'], { cwd: root, stdio: 'inherit' });
  if (syntax.status !== 0) throw new Error('Sintaks skrip rilis tidak valid.');
  console.log(`Metadata versi dan changelog AURA ${version} valid.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
