import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpsUrl, verifyReleaseSignature } from './release-metadata.mjs';

// Public test vector from the Tauri updater's offline signature tests.
// https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
const publicKey = Buffer.from([
  'untrusted comment: minisign public key: A49EF4746FA6E6D7',
  'RWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe',
].join('\n')).toString('base64');
const signature = Buffer.from([
  'untrusted comment: signature from tauri secret key',
  'RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=',
  'trusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0',
  'DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==',
].join('\n')).toString('base64');

test('accepts a genuine version-bound Tauri updater signature', () => {
  assert.doesNotThrow(() => verifyReleaseSignature(Buffer.from('test'), signature, publicKey, '2.0.0'));
});

test('rejects an altered payload or mismatched manifest version', () => {
  assert.throws(() => verifyReleaseSignature(Buffer.from('Test'), signature, publicKey, '2.0.0'), /Verifikasi signature/);
  assert.throws(() => verifyReleaseSignature(Buffer.from('test'), signature, publicKey, '3.0.0'), /Versi dalam signature/);
});

test('accepts only credential-free HTTPS release URLs', () => {
  assert.equal(httpsUrl('https://example.invalid/releases/latest.json', 'endpoint').protocol, 'https:');
  for (const value of ['http://example.invalid', 'https://test@example.invalid', 'https://example.invalid/?secret=test', 'file:///local']) {
    assert.throws(() => httpsUrl(value, 'endpoint'), /HTTPS/);
  }
});
