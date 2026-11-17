import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const [exe, profile] = process.argv.slice(2).map((value) => resolve(value));
assert.ok(exe && profile, 'Pass the isolated AURA QA executable and its data directory.');
const port = 19226;
const id = 'id.aura.interview.evidenceqa';
const invoke = (page, command, args) => page.evaluate(([name, params]) => window.__TAURI_INTERNALS__.invoke(name, params), [command, args]);
let child;
let browser;

async function openApp() {
  child = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview-qa'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.equal(child.exitCode, null);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1_000 });
      break;
    } catch { await setTimeout(350); }
  }
  assert.ok(browser, 'Could not attach to the isolated WebView2 instance.');
  let main;
  await expect.poll(() => {
    main = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().includes('tauri') && !page.url().includes('panel='));
    return Boolean(main);
  }).toBe(true);
  await expect(main.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  assert.equal(await invoke(main, 'plugin:app|identifier'), id);
  assert.equal(realpathSync(await invoke(main, 'plugin:path|resolve_directory', { directory: 15 })).toLowerCase(), realpathSync(profile).toLowerCase());
  assert.equal((await invoke(main, 'release_info')).version, '1.6.0');
  return main;
}

async function closeApp(main) {
  await invoke(main, 'plugin:window|close', { label: 'main' }).catch(() => undefined);
  await expect.poll(() => child.exitCode).not.toBeNull();
  await browser.close().catch(() => undefined);
  browser = null;
}

try {
  let main = await openApp();
  const legacy = 'Saya menyusun dasbor operasi dan meninjau metrik bersama tim.';
  await invoke(main, 'db_save', { data: { profileFacts: legacy, appearance: { answerOpacity: 61 },
    updates: { installedVersion: '1.5.0', lastSeenVersion: '1.5.0' } } });
  await main.reload();
  const whatsNew = main.getByRole('dialog', { name: "What's New in AURA" });
  await expect(whatsNew).toBeVisible();
  await whatsNew.getByRole('button', { name: 'Got it', exact: true }).click();

  await main.getByRole('link', { name: 'Jobs & Profiles', exact: true }).click();
  await expect(main.getByRole('textbox', { name: 'Fakta profil' })).toHaveValue(legacy);
  await main.getByRole('link', { name: 'Evidence Vault', exact: true }).click();
  await main.getByLabel('Judul bukti', { exact: true }).fill('Retensi nasabah');
  await main.getByLabel('Isi bukti', { exact: true }).fill('Saya mengurangi churn nasabah melalui segmentasi dan durasi observasi yang terukur.');
  await main.getByLabel('Asal informasi', { exact: true }).selectOption('user_provided');
  await main.getByRole('button', { name: 'Simpan bukti', exact: true }).click();
  await expect.poll(async () => (await invoke(main, 'db_load'))?.evidence?.[0]?.title).toBe('Retensi nasabah');

  await main.getByRole('link', { name: 'Settings', exact: true }).click();
  await main.getByRole('link', { name: 'Personal Answer DNA', exact: true }).click();
  await expect(main.getByLabel('Gunakan Personal Answer DNA')).not.toBeChecked();
  await main.getByLabel('Gunakan Personal Answer DNA').check();
  await main.getByLabel('Bahasa jawaban', { exact: true }).selectOption('en');
  await main.getByLabel('Istilah pilihan', { exact: true }).fill('credit risk, SQL');
  await main.getByRole('button', { name: 'Simpan Answer DNA', exact: true }).click();
  await expect.poll(async () => (await invoke(main, 'db_load'))?.answerDna?.language).toBe('en');
  await closeApp(main);

  main = await openApp();
  await expect(main.getByText('AURA Desktop · v1.6.0', { exact: true })).toBeVisible();
  await expect(main.getByRole('dialog', { name: "What's New in AURA" })).toHaveCount(0);
  const saved = await invoke(main, 'db_load');
  assert.equal(saved.profileFacts, legacy);
  assert.equal(saved.appearance.answerOpacity, 61);
  assert.equal(saved.evidence[0].provenance, 'user_provided');
  assert.deepEqual(saved.answerDna.terms, ['credit risk', 'SQL']);
  await main.getByRole('link', { name: 'Settings', exact: true }).click();
  await main.getByRole('link', { name: 'Personal Answer DNA', exact: true }).click();
  await expect(main.getByLabel('Bahasa jawaban', { exact: true })).toHaveValue('en');
  await main.getByRole('button', { name: 'Hapus profil', exact: true }).click();
  await main.getByRole('button', { name: 'Ya, hapus profil', exact: true }).click();
  await expect.poll(async () => (await invoke(main, 'db_load'))?.answerDna).toBeNull();
  console.log('Windows SQLite retained Evidence Vault, Answer DNA, and legacy preferences through restart. DNA deletion passed.');
  await closeApp(main);
} finally {
  await browser?.close().catch(() => undefined);
  if (child?.exitCode === null) child.kill();
}
