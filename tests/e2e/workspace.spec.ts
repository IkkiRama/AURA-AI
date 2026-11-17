import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

test.beforeEach(async ({ context }) => {
  if (process.env.AURA_E2E_DIST !== '1') return;
  // Exercise the production bundle on a secure loopback origin without a listening server.
  const dist = new URL('../../dist/', import.meta.url);
  await context.route('http://localhost:1420/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const target = new URL(pathname === '/' ? 'index.html' : `.${pathname}`, dist);
    if (!target.href.startsWith(dist.href)) { await route.abort(); return; }
    await route.fulfill({ path: fileURLToPath(target) });
  });
});

test('pastes a clipboard screenshot into the prompt and removes the preview', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('link', { name: 'Live Copilot', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Prompt & screenshot', exact: true });
  await prompt.fill('Jelaskan gambar ini.');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D tidak tersedia.');
    ctx.fillStyle = '#2dd4bf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG tidak tersedia.')), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
  });
  await prompt.press('Control+v');

  const preview = page.getByRole('img', { name: 'Pratinjau screenshot', exact: true });
  await expect(preview).toBeVisible();
  await expect(prompt).toHaveValue('Jelaskan gambar ini.');
  await page.getByRole('button', { name: 'Hapus screenshot', exact: true }).click();
  await expect(preview).toHaveCount(0);
});

test('pastes regular text into the prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('link', { name: 'Live Copilot', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Prompt & screenshot', exact: true });
  const text = 'Moderator membagikan studi kasus.';
  await prompt.focus();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await prompt.press('Control+v');
  await expect(prompt).toHaveValue(text);
  await expect(page.getByRole('img', { name: 'Pratinjau screenshot', exact: true })).toHaveCount(0);
});

test('changes the format once and keeps generation blocked in Standby', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Live Copilot', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Prompt & screenshot', exact: true });
  const run = page.getByRole('button', { name: 'Buat jawaban', exact: true });

  await prompt.fill('Mulai sesi ini semua jawaban untuk mengetik 60 detik, panjang 30–45 kata.');
  await run.click();
  await expect(prompt).toHaveValue('');
  await expect(page.getByText('KETIK_60 · 30–45 kata', { exact: true })).toBeVisible();

  await prompt.fill('Ceritakan tentang pengalaman Anda.');
  await expect(run).toBeDisabled();
  const consent = page.getByRole('checkbox', { name: 'Izinkan cloud untuk sesi ini', exact: true });
  await expect(consent).not.toBeChecked();
  await expect(consent).toBeDisabled();
});

test('changes the answer background alpha from 30 to 85 percent with opaque text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Live Copilot', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Opacity panel jawaban', exact: true });
  const panel = page.getByTestId('answer-opacity-preview');

  await expect(panel).toHaveCSS('background-color', 'rgba(16, 27, 43, 0.45)');
  await slider.press('Home');
  await expect(panel).toHaveCSS('background-color', 'rgba(16, 27, 43, 0.3)');
  await slider.press('End');
  await expect(panel).toHaveCSS('background-color', 'rgba(16, 27, 43, 0.85)');
  await expect(panel).toHaveCSS('opacity', '1');
  await expect(panel.locator('.aura-answer')).toHaveCSS('opacity', '1');
});

test('imports, edits, searches and deletes catatan.txt in the local library', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Knowledge Base', exact: true }).click();
  const body = 'Saya mengelola simulasi logistik dan meninjau hasil evaluasi tim.';
  await page.getByLabel('Impor catatan', { exact: true }).setInputFiles({
    name: 'catatan.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(body, 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'catatan.txt', exact: true })).toBeVisible();
  const content = page.getByRole('textbox', { name: 'Isi dokumen', exact: true });
  await expect(content).toHaveValue(body);

  const corrected = `${body} Saya memverifikasi kesiapan lokomotif.`;
  await content.fill(corrected);
  const save = page.getByRole('button', { name: 'Simpan perubahan', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await page.getByRole('textbox', { name: 'Cari dokumen', exact: true }).fill('lokomotif');
  await page.getByRole('button', { name: 'Jalankan pencarian dokumen', exact: true }).click();
  await expect(page.getByText('1 hasil untuk “lokomotif”')).toBeVisible();
  await expect(content).toHaveValue(corrected);

  await page.getByRole('button', { name: 'Hapus dokumen', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, hapus', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'catatan.txt', exact: true })).toHaveCount(0);
  await expect(page.getByText('Hasil pencarian kosong', { exact: true })).toBeVisible();
});

test('navigates Updates, About and Changelog without a configured browser updater', async ({ page, baseURL }) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== baseURL) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const releaseLinks = page.getByRole('navigation', { name: 'Pembaruan dan informasi aplikasi' });
  await releaseLinks.getByRole('link', { name: 'Updates', exact: true }).click();

  await expect(page).toHaveURL(/#settings-updates$/);
  await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText(version, { exact: true })).toBeVisible();
  await expect(page.getByText('Pembaruan belum dikonfigurasi', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for Updates', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await releaseLinks.getByRole('link', { name: 'About AURA', exact: true }).click();
  await expect(page).toHaveURL(/#settings-about$/);
  await expect(page.getByRole('heading', { name: 'About AURA', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText(version, { exact: true })).toBeVisible();
  await expect(page.getByText('Rifki Romadhan', { exact: true })).toBeVisible();
  const instagram = page.getByText('Instagram', { exact: true }).locator('..');
  await expect(instagram).toContainText('Belum dikonfigurasi');
  await expect(instagram.getByRole('link')).toHaveCount(0);
  await expect(instagram.getByRole('button')).toHaveCount(0);

  await page.getByRole('link', { name: 'View Changelog', exact: true }).click();
  await expect(page).toHaveURL(/#changelog$/);
  await expect(page.getByRole('heading', { name: 'Changelog', exact: true })).toBeVisible();
  const currentRelease = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `AURA ${version}`, exact: true }) });
  for (const label of ['Added', 'Improved', 'Fixed', 'Changed']) {
    await expect(currentRelease.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'AURA 1.3.0', exact: true })).toBeVisible();
  expect(remoteRequests).toEqual([]);
});

test('persists changed update preferences after reload', async ({ page }) => {
  await page.goto('/#settings-updates');
  const updatePreferences = [
    page.getByRole('checkbox', { name: 'Automatic Update', exact: true }),
    page.getByRole('checkbox', { name: 'Automatically Download Updates', exact: true }),
    page.getByRole('checkbox', { name: 'Automatically Install When Idle', exact: true }),
    page.getByRole('checkbox', { name: 'Notify After Update', exact: true }),
  ];
  for (const preference of updatePreferences) await expect(preference).toBeChecked();
  await updatePreferences[0].uncheck();
  await updatePreferences[2].uncheck();

  await page.reload();
  await expect(updatePreferences[0]).not.toBeChecked();
  await expect(updatePreferences[1]).toBeChecked();
  await expect(updatePreferences[2]).not.toBeChecked();
  await expect(updatePreferences[3]).toBeChecked();
});

test('keeps teleprompter off by default and saves highlight and scroll preferences', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Teleprompter', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Speech Tracking', exact: true })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Highlight Mode' })).toHaveValue('phrase');
  await expect(page.getByRole('combobox', { name: 'Scroll Mode' })).toHaveValue('auto');
  await page.getByRole('combobox', { name: 'Highlight Mode' }).selectOption('word');
  await page.getByRole('combobox', { name: 'Scroll Mode' }).selectOption('manual');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Highlight Mode' })).toHaveValue('word');
  await expect(page.getByRole('combobox', { name: 'Scroll Mode' })).toHaveValue('manual');
  await expect(page.getByRole('combobox', { name: 'Microphone Device' })).toBeDisabled();
});

test('shows What’s New once for a workspace migrated from AURA 1.3', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'aura-local-workspace-v1';
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ appearance: { answerOpacity: 67 } }));
    }
  });
  await page.goto('/#copilot');
  const whatsNew = page.getByRole('dialog', { name: "What's New in AURA" });
  await expect(whatsNew).toBeVisible();
  await expect(whatsNew.getByText(`AURA sudah diperbarui ke versi ${version}.`, { exact: true })).toBeVisible();
  await whatsNew.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(whatsNew).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(`Pratinjau browser · v${version}`, { exact: true })).toBeVisible();
  await expect(whatsNew).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Opacity panel jawaban', exact: true })).toHaveValue('67');
});
