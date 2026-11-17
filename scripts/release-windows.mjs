import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpsUrl, readReleaseMetadata, releaseConfig, releaseNotes, verifyReleaseSignature } from './release-metadata.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = 'x86_64-pc-windows-msvc';
const cli = 'node_modules/@tauri-apps/cli/tauri.js';

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`Langkah build gagal (${result.error?.code ?? result.status ?? result.signal}).`);
  }
}

function buildRelease() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build rilis AURA memerlukan Node.js dan toolchain MSVC pada Windows x64.');
  }
  if (process.env.CI !== 'true' || !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error('Jalankan rilis resmi di CI dengan secret TAURI_SIGNING_PRIVATE_KEY.');
  }
  const { version, entry, productName } = readReleaseMetadata(root);
  if (process.env.AURA_RELEASE_VERSION && process.env.AURA_RELEASE_VERSION !== version) {
    throw new Error('AURA_RELEASE_VERSION tidak cocok dengan versi proyek.');
  }
  const config = releaseConfig(process.env);
  const assetBase = httpsUrl(process.env.AURA_RELEASE_ASSET_BASE_URL, 'AURA_RELEASE_ASSET_BASE_URL');
  if (!assetBase.pathname.endsWith('/')) assetBase.pathname += '/';
  const releases = join(root, 'release');
  const output = join(releases, `v${version}`);
  if (existsSync(output)) throw new Error('Folder rilis versi ini sudah ada. Naikkan versi untuk menerbitkan paket baru.');
  const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target');
  const signingEnv = { ...process.env, CARGO_TARGET_DIR: targetDir };
  const checkEnv = { ...signingEnv };
  delete checkEnv.TAURI_SIGNING_PRIVATE_KEY;
  delete checkEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

  run(process.execPath, ['scripts/lint.mjs'], checkEnv);
  run(process.execPath, ['--test', 'scripts/release-metadata.test.mjs'], checkEnv);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], checkEnv);
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], checkEnv);
  run('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--target', target], checkEnv);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], checkEnv);
  run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], checkEnv);

  const buildStart = Date.now();
  run(process.execPath, [cli, 'build', '--ci', '--target', target, '--config', JSON.stringify(config)], signingEnv);
  const installerName = `${productName}_${version}_x64-setup.exe`;
  const bundle = join(targetDir, target, 'release', 'bundle', 'nsis');
  const installer = join(bundle, installerName);
  const signatureFile = `${installer}.sig`;
  if ([installer, signatureFile].some((path) => statSync(path).mtimeMs < buildStart - 1000)) {
    throw new Error('Build tidak menghasilkan installer dan signature baru.');
  }
  const artifact = readFileSync(installer);
  const signature = readFileSync(signatureFile, 'utf8').trim();
  verifyReleaseSignature(artifact, signature, config.plugins.updater.pubkey, version);
  const notes = releaseNotes(entry);
  const manifest = {
    version,
    notes,
    pub_date: new Date(`${entry.date}T00:00:00Z`).toISOString(),
    platforms: {
      'windows-x86_64': { url: new URL(encodeURIComponent(installerName), assetBase).href, signature },
    },
  };
  mkdirSync(releases, { recursive: true });
  const staging = mkdtempSync(join(releases, '.staging-'));
  writeFileSync(join(staging, installerName), artifact);
  writeFileSync(join(staging, `${installerName}.sig`), `${signature}\n`);
  writeFileSync(join(staging, 'release-notes.md'), `${notes}\n`);
  writeFileSync(join(staging, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(staging, output);
  console.log(`Paket terverifikasi siap ditinjau di ${output}`);
}

try {
  buildRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
