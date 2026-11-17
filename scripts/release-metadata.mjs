import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const categories = [['added', 'Added'], ['improved', 'Improved'], ['fixed', 'Fixed'], ['changed', 'Changed']];

function compareVersions(a, b) {
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (const [index, part] of left.entries()) {
    if (part !== right[index]) return part > right[index] ? 1 : -1;
  }
  return 0;
}

export function readReleaseMetadata(project) {
  const readJson = (path) => JSON.parse(readFileSync(join(project, path), 'utf8'));
  const { version } = readJson('package.json');
  const lock = readJson('package-lock.json');
  const tauri = readJson('src-tauri/tauri.conf.json');
  const cargo = readFileSync(join(project, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = readFileSync(join(project, 'src-tauri/Cargo.lock'), 'utf8');
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const cargoLockVersion = cargoLock.match(/^\[\[package\]\]\r?\nname = "aura"\r?\nversion = "([^"]+)"/m)?.[1];
  const versions = [tauri.version, cargoVersion, cargoLockVersion, lock.version, lock.packages?.['']?.version];
  if (!releaseVersion.test(version) || versions.some((entry) => entry !== version)) {
    throw new Error('Samakan SemVer MAJOR.MINOR.PATCH di package.json, package-lock.json, Cargo.toml, Cargo.lock, dan tauri.conf.json.');
  }
  if (tauri.identifier !== 'id.aura.interview' || tauri.productName !== 'AURA') {
    throw new Error('Identifier AURA harus tetap id.aura.interview agar direktori data pengguna tetap terhubung.');
  }
  const changelog = readJson('src/app/update/changelog.json');
  if (!Array.isArray(changelog) || changelog[0]?.version !== version) {
    throw new Error('Entri teratas changelog harus cocok dengan versi paket.');
  }
  let previousVersion;
  for (const entry of changelog) {
    if (!releaseVersion.test(entry?.version) || (previousVersion && compareVersions(previousVersion, entry.version) <= 0)) {
      throw new Error('Urutkan versi changelog dari terbaru ke terlama tanpa duplikat.');
    }
    previousVersion = entry.version;
    const date = new Date(entry.date);
    if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
      || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date) {
      throw new Error(`Tanggal changelog ${entry.version} harus valid dan menggunakan YYYY-MM-DD.`);
    }
    if (typeof entry.summary !== 'string' || !entry.summary.trim()) {
      throw new Error(`Ringkasan changelog ${entry.version} kosong.`);
    }
    for (const [field] of categories) {
      if (field === 'changed' && entry[field] === undefined) continue;
      if (!Array.isArray(entry[field]) || entry[field].some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error(`Bagian ${field} changelog ${entry.version} harus berupa daftar teks.`);
      }
    }
  }
  return { version, entry: changelog[0], productName: tauri.productName };
}

export function releaseNotes(entry) {
  return [
    `# AURA ${entry.version}`,
    entry.date,
    entry.summary.trim(),
    ...categories.filter(([key]) => entry[key]?.length)
      .map(([key, title]) => [`## ${title}`, ...entry[key].map((text) => `- ${text.trim()}`)].join('\n')),
  ].join('\n\n');
}

export function httpsUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} harus berupa URL HTTPS.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} harus berupa URL HTTPS publik tanpa kredensial, query, atau fragmen.`);
  }
  return url;
}

function decodeBase64(value) {
  if (typeof value !== 'string') throw new Error('Format Base64 updater tidak valid.');
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.toString('base64') !== value) {
    throw new Error('Format Base64 updater tidak valid.');
  }
  return decoded;
}

function parsePublicKey(value) {
  const lines = decodeBase64(value).toString('utf8').trimEnd().split(/\r?\n/);
  const key = decodeBase64(lines[1]);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')
    || key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed') {
    throw new Error('Public key updater harus berupa isi file .pub yang dibuat CLI Tauri.');
  }
  return key;
}

export function releaseConfig(env) {
  const endpoint = httpsUrl(env.AURA_UPDATE_ENDPOINT, 'AURA_UPDATE_ENDPOINT');
  const publicKey = env.AURA_UPDATE_PUBLIC_KEY?.trim();
  parsePublicKey(publicKey);
  const aura = {};
  if (env.AURA_INSTAGRAM_USERNAME) {
    if (!/^[a-zA-Z0-9_.]{1,30}$/.test(env.AURA_INSTAGRAM_USERNAME)) {
      throw new Error('AURA_INSTAGRAM_USERNAME harus berisi username Instagram tanpa awalan @.');
    }
    aura.instagramUsername = env.AURA_INSTAGRAM_USERNAME;
  }
  if (env.AURA_PRIVACY_POLICY_URL) {
    aura.privacyPolicyUrl = httpsUrl(env.AURA_PRIVACY_POLICY_URL, 'AURA_PRIVACY_POLICY_URL').href;
  }
  if (env.AURA_LICENSE?.trim()) aura.license = env.AURA_LICENSE.trim();
  return {
    // The verified production assets are built before signing secrets are passed to Tauri.
    build: { beforeBuildCommand: null },
    bundle: { active: true, targets: ['nsis'], createUpdaterArtifacts: true, windows: { nsis: { installMode: 'currentUser' } } },
    plugins: { aura, updater: { pubkey: publicKey, endpoints: [endpoint.href], requireSignedVersion: true, windows: { installMode: 'passive' } } },
  };
}

// Check Tauri's base64-wrapped Minisign signatures with Node's Ed25519 and BLAKE2b.
export function verifyReleaseSignature(artifact, encodedSignature, publicKey, version) {
  const key = parsePublicKey(publicKey);
  const lines = decodeBase64(encodedSignature).toString('utf8').trimEnd().split(/\r?\n/);
  const trustedPrefix = 'trusted comment: ';
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith(trustedPrefix)) {
    throw new Error('Format signature updater tidak valid.');
  }
  const signature = decodeBase64(lines[1]);
  const globalSignature = decodeBase64(lines[3]);
  if (signature.length !== 74 || signature.subarray(0, 2).toString() !== 'ED'
    || !signature.subarray(2, 10).equals(key.subarray(2, 10)) || globalSignature.length !== 64) {
    throw new Error('Signature updater tidak cocok dengan public key rilis.');
  }
  // RFC 8410 SubjectPublicKeyInfo header for a raw 32-byte Ed25519 public key.
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]);
  const verifier = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const artifactSignature = signature.subarray(10);
  const trustedComment = lines[2].slice(trustedPrefix.length);
  const digest = createHash('blake2b512').update(artifact).digest();
  if (!verify(null, digest, verifier, artifactSignature)
    || !verify(null, Buffer.concat([artifactSignature, Buffer.from(trustedComment)]), verifier, globalSignature)) {
    throw new Error('Verifikasi signature paket pembaruan gagal.');
  }
  const signedVersions = trustedComment.split('\t').filter((field) => field.startsWith('version:'));
  if (signedVersions.length !== 1 || signedVersions[0] !== `version:${version}`) {
    throw new Error('Versi dalam signature tidak cocok dengan versi rilis.');
  }
}
