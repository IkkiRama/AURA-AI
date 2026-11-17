# Rilis AURA untuk Windows

Pembaruan produksi dikirim sebagai installer NSIS Windows x64 per pengguna. Installer memuat kunci publik pembaruan dan alamat feed HTTPS. AURA hanya memasang paket yang tanda tangan Ed25519 dan versi tertandatanganinya cocok. `tauri.conf.json` menjadi dasar build lokal. CI menambahkan konfigurasi produksi saat membangun installer. [Dokumentasi updater Tauri](https://v2.tauri.app/plugin/updater/)

## Menyiapkan konfigurasi produksi

1. Tentukan alamat HTTPS publik dan tetap untuk feed. Jika memakai GitHub Releases sebagai feed publik AURA, gunakan `https://github.com/IkkiRama/AURA-AI/releases/latest/download/latest.json`. Untuk distribusi melalui host HTTPS lain, pilih URL feed tetap dan direktori publik berversi untuk installer.
2. Buat pasangan kunci updater satu kali dari workstation tepercaya di luar direktori proyek. Simpan cadangan kunci privat di penyimpanan terbatas. Gunakan kunci publik yang sama pada setiap rilis yang harus dapat diperbarui oleh instalasi lama. [Pembuatan kunci Tauri](https://v2.tauri.app/plugin/updater/#signing-updates)

   ```powershell
   npm run tauri signer generate -- --write-keys 'C:\path-di-luar-proyek\aura-updater.key'
   ```

3. Simpan seluruh isi `aura-updater.key.pub` sebagai variabel publik `AURA_UPDATE_PUBLIC_KEY`. Isi `AURA_UPDATE_ENDPOINT` dengan alamat feed tetap dan `AURA_RELEASE_ASSET_BASE_URL` dengan URL direktori rilis berversi. Semua URL wajib HTTPS.
4. Isi `TAURI_SIGNING_PRIVATE_KEY` dan `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` pada penyimpanan secret CI. Batasi akses ke job penandatanganan dan tag rilis yang ditinjau. Untuk menampilkan informasi developer, atur variabel publik opsional `AURA_INSTAGRAM_USERNAME`, `AURA_PRIVACY_POLICY_URL`, dan `AURA_LICENSE`.

Tanda tangan updater mengautentikasi paket kepada AURA. Penandatanganan kode Windows untuk kepercayaan penerbit dan SmartScreen menggunakan sertifikat Authenticode yang terpisah. [Penandatanganan kode Windows di Tauri](https://v2.tauri.app/distribute/sign/windows/)

## Membangun dan menerbitkan

1. Setel versi yang sama di `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, dan `src-tauri/tauri.conf.json`. Tambahkan entri terbaru pada awal `src/app/update/changelog.json`. Isi tanggal publikasi aktual, ringkasan, `added`, `improved`, `fixed`, dan `changed` bila ada. `npm run lint` memeriksa metadata rilis tersebut.
2. Siapkan runner Windows x64 dengan toolchain Rust MSVC, dependensi C++, Node.js, dan WebView2. Jalankan langkah berikut pada CI dengan variabel publik dan secret di atas. `AURA_RELEASE_VERSION` dapat diisi dengan versi tanpa awalan `v` untuk memeriksa kesesuaian versi tag.

   ```powershell
   rustup target add x86_64-pc-windows-msvc
   npm ci
   npx playwright install chromium
   node scripts/release-windows.mjs
   ```

3. Skrip menjalankan lint, pengujian TypeScript, Rust, dan Playwright, serta build frontend sebelum penandatanganan. Tauri menghasilkan `AURA_<VERSI>_x64-setup.exe` dan `.sig`. Setelah pemeriksaan tanda tangan dan versi paket, skrip menyiapkan installer, `.sig`, `release-notes.md`, dan `latest.json` di `release/v<VERSI>/`.
4. Unggah installer dan `.sig` ke direktori HTTPS berversi. Pastikan URL installer di manifest dapat diakses dan isinya identik dengan hasil build. Setelah itu publikasikan `latest.json` pada alamat feed tetap. Gunakan TTL singkat atau revalidasi cache untuk manifest. [Format JSON updater Tauri](https://v2.tauri.app/plugin/updater/#static-json-file)

## Menjalankan GitHub Actions

Workflow **AURA Windows release** tersedia di [`.github/workflows/aura-release.yml`](../.github/workflows/aura-release.yml). Setelah file tersedia di branch default GitHub, jalankan workflow dari tab **Actions**. Siapkan environment `aura-release-build` untuk variabel dan secret serta `aura-release-publish` dengan peninjau yang menyetujui publikasi. Batasi kedua environment ke branch rilis yang tepercaya. Workflow membentuk URL aset berversi dari nama repositori dan tag. [Menjalankan workflow secara manual](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) · [Deployment environments GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Lindungi tag `v<VERSI>` dan batasi pembuatan tag ke pengelola rilis. Buat tag dari commit yang telah ditinjau, lalu masukkan versi tanpa `v` saat menjalankan workflow. Secara default workflow menghasilkan artefak CI. Saat opsi **publish** dipilih, job publikasi menunggu build dan persetujuan environment, membuat draft, memasang semua aset, lalu menerbitkannya sebagai rilis terbaru.

## Data dan pemulihan

AURA v1.4 memberi skema SQLite versi `1` menggunakan `PRAGMA user_version`. Pembukaan database v1.3 berangkat dari skema `0` dan melakukan perubahan versi dalam transaksi. Format ruang kerja, dokumen, riwayat dan indeks pencarian v1.3 kompatibel dengan versi ini. Saat menemui database dengan versi skema di atas `1`, AURA v1.4 berhenti sebelum menulis data.

Data pengguna berada di `%LOCALAPPDATA%\id.aura.interview`. Penyimpanan vault terdiri dari `vault.hold` dan `vault.salt`. File SQLite bernama `aura.sqlite3`. Untuk uji migrasi atau cadangan sebelum rilis berisiko, gunakan **Keluar** di tray dan salin direktori aplikasi di `%LOCALAPPDATA%` serta direktori `id.aura.interview` di `%APPDATA%` bila tersedia. Simpan cadangan di lokasi privat, sertakan berkas pendamping SQLite yang masih ada, dan periksa hasil `PRAGMA integrity_check` pada salinan database sebelum mengandalkannya. Simpan pasangan berkas vault bersama-sama. Untuk migrasi skema mendatang yang mengubah format data, siapkan cadangan SQLite konsisten sebelum transaksi dan uji pemulihannya pada versi yang kompatibel.

Sebelum instalasi pembaruan, AURA menyimpan status jendela dan membuat satu salinan executable sebelumnya di `%LOCALAPPDATA%\id.aura.interview\update-recovery\AURA-previous.exe`. Jika pemasangan terhenti, keluar dari semua proses AURA lalu jalankan executable pemulihan. Mode ini menonaktifkan updater. Jika perlu memulihkan data setelah migrasi yang mengubah format, pulihkan cadangan ketika AURA sudah ditutup dan buka dengan versi yang kompatibel. Setelah paket yang benar tersedia, pasang kembali installer rilis terverifikasi di Windows.

## Verifikasi di Windows

- Pada profil Windows uji, pasang v1.3 dan buat dokumen, riwayat, preferensi, posisi panel, dan vault dengan data uji. Pasang v1.4 dari installer NSIS per pengguna. Periksa data tersebut serta kemampuan membuka vault dengan kata sandi yang sama.
- Uji dua versi berturut-turut yang ditandatangani dan menggunakan feed HTTPS staging yang sama. Pasang versi pertama sebelum membuat versi berikutnya tersedia. Periksa skenario tanpa pembaruan, pemeriksaan manual, pemeriksaan setelah start, toggle unduhan otomatis, progres unduhan, dan instalasi saat idle.
- Mulai sesi aktif dan jalankan permintaan AI uji. Pastikan unduhan dapat selesai dan installer menunggu sesi berakhir serta penyimpanan selesai. Uji juga kondisi Pause, editor yang terbuka, kegagalan penyimpanan, dan pemulihan dari status gagal. Untuk fitur perekaman yang kelak diaktifkan, uji penundaan instalasi selama perekaman berjalan.
- Uji feed yang tidak tersedia, installer yang diubah, tanda tangan dari kunci lain, dan versi manifest yang berbeda dari versi paket tertandatangani. Pastikan AURA tetap dapat digunakan dan installer hanya berjalan untuk paket yang lolos verifikasi.
- Periksa Windows membuka kembali AURA pada versi baru. Pastikan What's New tampil setelah kenaikan versi sesuai preferensi, tombol **Got it** menutup dialog, dan status sudah dibaca bertahan setelah AURA dibuka kembali. Periksa **View Changelog**, About, dan Changelog saat offline.
- Pada profil uji, buka salinan pemulihan setelah menutup AURA dan periksa bahwa pembaruan dinonaktifkan dari salinan tersebut.

## File yang berkaitan dengan rilis

| Lokasi | Fungsi |
| --- | --- |
| [`src/app/update/changelog.json`](../src/app/update/changelog.json) | Riwayat rilis yang dibundel di aplikasi dan sumber catatan untuk feed |
| [`ReleasePages.tsx`](../src/app/update/ReleasePages.tsx), [`ReleaseDialogs.tsx`](../src/app/update/ReleaseDialogs.tsx), [`release.css`](../src/app/update/release.css) | Halaman Updates, About, Changelog, dan dialog What's New |
| [`controller.ts`](../src/app/update/controller.ts), [`model.ts`](../src/app/update/model.ts) | Jadwal updater, progres, validasi metadata, dan model preferensi |
| [`App.tsx`](../src/app/App.tsx), [`Workspace.tsx`](../src/app/Workspace.tsx), [`WorkspaceSettings.tsx`](../src/app/WorkspaceSettings.tsx) | Inisialisasi updater dan navigasi di dashboard |
| [`store.ts`](../src/app/store.ts) | Penyimpanan preferensi dan penundaan instalasi selama ruang kerja aktif |
| [`src-tauri/src/release.rs`](../src-tauri/src/release.rs) dan [`src-tauri/capabilities/release.json`](../src-tauri/capabilities/release.json) | Konfigurasi native, persiapan pemasangan, dan izin jendela dashboard |
| [`src-tauri/src/database.rs`](../src-tauri/src/database.rs) | Migrasi SQLite dan uji kompatibilitas |
| [`main.rs`](../src-tauri/src/main.rs), [`cloud.rs`](../src-tauri/src/cloud.rs), [`tauri.conf.json`](../src-tauri/tauri.conf.json) | Inisialisasi sebelum WebView, pemeriksaan aktivitas Cloud, dan konfigurasi installer |
| [`package.json`](../package.json), [`package-lock.json`](../package-lock.json), [`Cargo.toml`](../src-tauri/Cargo.toml), [`Cargo.lock`](../src-tauri/Cargo.lock) | Versi aplikasi dan dependensi updater |
| [`scripts/release-windows.mjs`](../scripts/release-windows.mjs) dan [`scripts/release-metadata.mjs`](../scripts/release-metadata.mjs) | Build NSIS, pemeriksaan tanda tangan dan versi, serta pembuatan feed |
| [`scripts/lint.mjs`](../scripts/lint.mjs), [`scripts/release-metadata.test.mjs`](../scripts/release-metadata.test.mjs) | Pemeriksaan versi, changelog, URL, dan tanda tangan |
| [`tests/unit/updates.test.ts`](../tests/unit/updates.test.ts), [`tests/e2e/workspace.spec.ts`](../tests/e2e/workspace.spec.ts) | Pengujian pengendali updater, preferensi, dan antarmuka |
| [`.github/workflows/aura-release.yml`](../.github/workflows/aura-release.yml) | Build dan publikasi GitHub Releases yang dipicu manual |
| [`docs/templates/tauri.release.example.json`](templates/tauri.release.example.json) dan [`docs/templates/latest.example.json`](templates/latest.example.json) | Contoh konfigurasi dan feed HTTPS |
| [`README.md`](../README.md), [`docs/RELEASE.md`](RELEASE.md) | Panduan penggunaan, verifikasi, dan distribusi |
