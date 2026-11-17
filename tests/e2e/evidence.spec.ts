import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.beforeEach(async ({ context }) => {
  if (process.env.AURA_E2E_DIST !== '1') return;
  const dist = new URL('../../dist/', import.meta.url);
  await context.route('http://localhost:1420/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const asset = new URL(pathname === '/' ? 'index.html' : `.${pathname}`, dist);
    if (!asset.href.startsWith(dist.href)) { await route.abort(); return; }
    await route.fulfill({ path: fileURLToPath(asset) });
  });
});

test('creates, edits, searches, and deletes personal evidence locally', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== baseURL) external.push(url.href);
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Jobs & Profiles', exact: true }).click();
  await page.getByRole('link', { name: 'Evidence Vault', exact: true }).click();
  await expect(page).toHaveURL(/#evidence$/);
  await expect(page.getByRole('heading', { name: 'Evidence Vault', exact: true })).toBeVisible();
  await expect(page.getByText('Belum ada bukti', { exact: true })).toBeVisible();

  const title = page.getByLabel('Judul bukti', { exact: true });
  const claim = page.getByRole('textbox', { name: 'Isi bukti', exact: true });
  const category = page.getByLabel('Kategori', { exact: true });
  const provenance = page.getByLabel('Asal informasi', { exact: true });
  const source = page.getByLabel('URL sumber (opsional)', { exact: true });
  const save = page.getByRole('button', { name: 'Simpan bukti', exact: true });
  await expect(save).toBeDisabled();
  await title.fill('Proyek migrasi data');
  await claim.fill('Saya menyusun skrip untuk memindahkan data inventaris dan memeriksa hasil migrasi.');
  await category.selectOption('technical_project');
  await provenance.selectOption('hypothetical');
  await source.fill('https://example.invalid/portofolio');
  await save.click();
  await expect(page.getByRole('heading', { name: 'Edit bukti', exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  await page.reload();
  const row = page.getByRole('button', { name: /Proyek migrasi data/ });
  await row.click();
  await expect(claim).toHaveValue('Saya menyusun skrip untuk memindahkan data inventaris dan memeriksa hasil migrasi.');
  await expect(provenance).toHaveValue('hypothetical');
  await expect(source).toHaveValue('https://example.invalid/portofolio');
  await claim.fill('Saya menggunakan PostgreSQL untuk membuat prototipe migrasi inventaris.');
  await save.click();
  await expect(save).toBeDisabled();
  const search = page.getByRole('searchbox', { name: 'Cari bukti', exact: true });
  await search.fill('PostgreSQL inventaris');
  await expect(row).toBeVisible();
  await search.fill('tidak cocok');
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Bukti tidak ditemukan', { exact: true })).toBeVisible();
  await search.fill('');

  const remove = page.getByRole('button', { name: 'Hapus bukti', exact: true });
  await remove.click();
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(row).toBeVisible();
  await remove.click();
  await page.getByRole('button', { name: 'Ya, hapus bukti', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Belum ada bukti', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('requires an existing document for document-supported evidence', async ({ page }) => {
  await page.goto('/#evidence');
  await page.getByLabel('Judul bukti', { exact: true }).fill('Riset perpustakaan');
  await page.getByLabel('Isi bukti', { exact: true }).fill('Saya menganalisis pola pencarian katalog untuk penelitian.');
  await page.getByLabel('Asal informasi', { exact: true }).selectOption('document_supported');
  await page.getByRole('button', { name: 'Simpan bukti', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Pilih dokumen lokal yang tersedia untuk mendukung bukti ini.');

  await page.getByRole('link', { name: 'Knowledge Base', exact: true }).click();
  await page.getByLabel('Impor catatan', { exact: true }).setInputFiles({
    name: 'catatan-riset.txt', mimeType: 'text/plain', buffer: Buffer.from('Pola pencarian katalog hasil penelitian.'),
  });
  await expect(page.getByRole('heading', { name: 'catatan-riset.txt', exact: true })).toBeVisible();
  await page.goto('/#evidence');
  await page.getByLabel('Judul bukti', { exact: true }).fill('Riset perpustakaan');
  await page.getByLabel('Isi bukti', { exact: true }).fill('Saya menganalisis pola pencarian katalog untuk penelitian.');
  await page.getByLabel('Kategori', { exact: true }).selectOption('research');
  await page.getByLabel('Asal informasi', { exact: true }).selectOption('document_supported');
  await page.getByLabel('Dokumen sumber', { exact: true }).selectOption({ label: 'catatan-riset.txt' });
  const source = page.getByLabel('URL sumber (opsional)', { exact: true });
  const save = page.getByRole('button', { name: 'Simpan bukti', exact: true });
  await source.fill('https://user:password@example.invalid/riset');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('URL harus memakai HTTPS tanpa kredensial');
  await source.fill('');
  await save.click();
  const evidence = page.getByRole('button', { name: /Riset perpustakaan/ });
  await expect(evidence).toBeVisible();

  await page.getByRole('link', { name: 'Knowledge Base', exact: true }).click();
  await page.getByRole('button', { name: /catatan-riset\.txt/ }).click();
  await page.getByRole('button', { name: 'Hapus dokumen', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, hapus', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'catatan-riset.txt', exact: true })).toHaveCount(0);
  await page.goto('/#evidence');
  await expect(evidence).toContainText(/belum[^\r\n]*verifikasi/i);
});
