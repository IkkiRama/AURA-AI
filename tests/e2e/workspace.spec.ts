import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

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
