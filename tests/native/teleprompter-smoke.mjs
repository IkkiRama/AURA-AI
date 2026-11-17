import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [exe, profile, wav] = process.argv.slice(2).map((value) => resolve(value));
assert.ok(exe && profile && wav);
const fixture = readFileSync(wav);
assert.equal(fixture.toString('ascii', 0, 4), 'RIFF');
assert.equal(fixture.readUInt32LE(24), 16_000);
let offset = 12;
while (offset < fixture.length - 8 && fixture.toString('ascii', offset, offset + 4) !== 'data') {
  const size = fixture.readUInt32LE(offset + 4);
  offset += 8 + size + size % 2;
}
const audio = [...fixture.subarray(offset + 8, offset + 8 + fixture.readUInt32LE(offset + 4))];
const port = 19225;
const child = spawn(exe, [], {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview-qa'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture="${wav}"`,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const invoke = (page, command, args) => page.evaluate(([name, params]) => window.__TAURI_INTERNALS__.invoke(name, params), [command, args]);
let browser;
async function pageWith(match) {
  let found;
  await expect.poll(() => {
    found = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().includes('tauri') && match(page.url()));
    return Boolean(found);
  }).toBe(true);
  return found;
}
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.equal(child.exitCode, null);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1_000 });
      break;
    } catch { await setTimeout(350); }
  }
  assert.ok(browser, 'Could not connect to isolated WebView2 instance.');
  const main = await pageWith((url) => !url.includes('panel='));
  await expect(main.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  assert.equal(await invoke(main, 'plugin:app|identifier'), 'id.aura.interview.speechqa');
  assert.equal(realpathSync(await invoke(main, 'plugin:path|resolve_directory', { directory: 15 })).toLowerCase(), realpathSync(profile).toLowerCase());
  assert.equal((await invoke(main, 'release_info')).version, '1.5.0');
  assert.equal(await invoke(main, 'speech_engine_ready'), true);
  assert.equal(await invoke(main, 'speech_activate').then(() => true, () => false), false);

  await main.getByRole('button', { name: 'Panel desktop', exact: true }).first().click();
  const answer = await pageWith((url) => url.includes('panel=answer'));
  await expect(answer.getByText('AURA Jawaban', { exact: true })).toBeVisible();
  assert.equal(await invoke(answer, 'speech_activate').then(() => true, () => false), false);

  await main.getByRole('link', { name: 'Settings', exact: true }).click();
  await main.getByRole('link', { name: 'Teleprompter', exact: true }).click();
  await main.getByRole('checkbox', { name: 'Speech Tracking', exact: true }).check();
  await main.getByRole('combobox', { name: 'Microphone Device' }).selectOption('default');
  await main.getByRole('combobox', { name: 'Highlight Mode' }).selectOption('word');
  await expect.poll(async () => (await invoke(main, 'db_load'))?.teleprompter?.highlightMode).toBe('word');
  await main.reload();
  await expect(main.getByRole('checkbox', { name: 'Speech Tracking', exact: true })).toBeChecked();
  await expect(main.getByRole('combobox', { name: 'Highlight Mode' })).toHaveValue('word');
  await expect(answer.getByRole('button', { name: 'Aktifkan mikrofon', exact: true })).toBeDisabled();
  console.log('Teleprompter preferences persisted in SQLite and Standby enforced.');

  await main.getByRole('link', { name: 'Session Intelligence', exact: true }).click();
  await main.getByRole('button', { name: 'Briefing', exact: true }).click();
  await invoke(main, 'speech_permit', { allowed: true });
  await invoke(answer, 'speech_activate');
  const recognized = await answer.evaluate((pcm) => window.__TAURI_INTERNALS__.invoke('speech_transcribe', Uint8Array.from(pcm).buffer,
    { headers: { 'x-aura-speech-language': 'en' } }), audio);
  assert.match(recognized, /fellow Americans/i);
  assert.match(recognized, /country can do for you/i);
  await invoke(answer, 'speech_stop');
  console.log('Actual Whisper CPU transcription through Rust raw IPC passed.');

  // Supply a fixed answer as a test fixture so distinct provider keys are unnecessary.
  const naskah = 'And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country. This is what we are here to do and why we serve with commitment.';
  const saved = await invoke(main, 'db_load');
  const appearance = { ...saved.appearance, answerOpacity: 45 };
  const publishFixture = (alpha = 45) => main.evaluate(({ naskah, saved, appearance, alpha }) => {
    const channel = new BroadcastChannel('aura-panel-answer-1');
    channel.postMessage({ kind: 'snapshot', view: {
      appearance: { ...appearance, answerOpacity: alpha }, prefs: saved.prefs, calibration: saved.calibration,
      provider: saved.provider, models: saved.models, vault: {}, text: '', image: null,
      teleprompter: saved.teleprompter, speechResumeRequest: 0, speechAllowed: true,
      session: { id: 'qa', stage: 'briefing', paused: false, cloudConsent: false, busy: false, error: null, question: null,
        answer: { jawaban_final: naskah, mode: 'lisan', sumber: [] } },
    } });
    channel.close();
  }, { naskah, saved, appearance, alpha });
  await publishFixture();
  const viewport = answer.getByRole('region', { name: 'Naskah teleprompter', exact: true });
  await expect(viewport.locator('.aura-speech-copy')).toHaveText(naskah);
  await answer.getByRole('button', { name: 'Rescue', exact: true }).click();
  await expect(answer.getByRole('region', { name: 'Saran Rescue', exact: true })).toBeVisible();
  await answer.getByRole('button', { name: 'Tutup saran Rescue', exact: true }).click();
  await answer.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  const mic = answer.getByText('Mic aktif · Lokal', { exact: true });
  await expect(mic).toBeVisible({ timeout: 18_000 });
  await expect(viewport.locator('[data-speech-position=active]')).toHaveCount(1, { timeout: 45_000 });
  await publishFixture(32);
  await expect(mic).toBeVisible();
  assert.equal(await answer.locator('.floating-panel').evaluate((el) => el.style.getPropertyValue('--panel-alpha')), '0.32');
  await main.getByRole('button', { name: 'Akhiri sesi', exact: true }).click();
  await expect(mic).toHaveCount(0);
  await expect(answer.getByRole('button', { name: 'Aktifkan mikrofon', exact: true })).toBeDisabled();
  await expect.poll(() => invoke(answer, 'speech_activate').then(() => true, () => false)).toBe(false);
  console.log('WebView2 test audio followed the unchanged script. Rescue, opacity during capture, and session end passed.');
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

