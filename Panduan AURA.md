# AURA AI

AURA membantu persiapan interview dan role group discussion dari pertanyaan, screenshot, catatan, profil, dan lowongan yang dipilih pengguna. Proyek mengikuti paket `AURA_App_Blueprint_v1.3.zip` di folder ini. Antarmuka memakai React, TypeScript, Vite, dan Tailwind. Aplikasi Windows memakai Tauri v2, Rust, SQLite FTS5, dan Stronghold.

## Menjalankan aplikasi desktop

Di folder proyek, buka `release\AURA.exe` untuk langsung menjalankan AURA. Gunakan `release\AURA_1.3.0_x64-setup.exe` untuk instalasi Windows. Paket lokal ini dibuat tanpa tanda tangan digital.

## Menjalankan dari kode sumber

Build dari kode sumber menargetkan Windows x64. Siapkan Node.js 22.12 atau versi lebih baru yang didukung Vite, Rust stable dengan target `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools dengan workload **Desktop development with C++**, dan Microsoft Edge WebView2 Runtime. Setelah instalasi, buka terminal baru. Proyek menyertakan library statis libsodium x64 untuk Stronghold agar build dapat dijalankan dari folder yang mengandung spasi.

```powershell
cd "D:\laragon\www\AURA AI"
npm ci
npm run tauri dev
```

`npm run dev` membuka pratinjau browser di `http://localhost:1420`. Pratinjau menyediakan alur lokal untuk mencoba tampilan, clipboard, dokumen, profil, dan preferensi. Jalankan host desktop untuk memakai vault, koneksi provider, SQLite FTS5, dan jendela Windows.

## Penggunaan pertama

1. Buka **Settings**, buat kata sandi brankas minimal delapan karakter, lalu simpan API key Gemini atau OpenAI. Gunakan kata sandi yang sama saat membuka brankas pada kesempatan berikutnya.
2. Impor `.txt` atau `.md` di **Knowledge Base**, lalu isi pengalaman dan target lowongan di **Jobs & Profiles** bila diperlukan.
3. Atur format di **Prompt Studio**. Default `KETIK_45` menargetkan 25–35 kata. Kalibrasi kecepatan mengetik atau berbicara di Settings untuk menyesuaikan perkiraan durasi.
4. Buka **Live Copilot**. Pindahkan tahap dari Standby ke Briefing, Case Analysis, atau Discussion, lalu aktifkan izin cloud jika aturan sesi memperbolehkan penggunaan AI.
5. Masukkan pertanyaan atau tempel screenshot menggunakan `Ctrl+V`. PNG, JPEG, dan WebP hingga 10 MB dapat dipilih atau diseret ke kolom prompt. Tinjau lampiran sebelum menekan **Buat jawaban**.
6. Pilih **Panel desktop** untuk menampilkan jendela Prompt dan Jawaban. Seret header untuk memindahkan masing-masing panel atau seret tepinya untuk mengubah ukuran.
7. Gunakan **Akhiri sesi** setelah selesai. Penyimpanan riwayat lokal dapat diaktifkan di Settings sebelum sesi diakhiri.

Preferensi juga dapat diperbarui sekali melalui kolom prompt, misalnya `Mulai sesi ini seluruh jawaban maksimal 45 detik untuk mengetik, panjang 25–35 kata.` Preferensi tersebut digunakan pada input berikutnya.

## Jendela dan shortcut

Dashboard, Prompt, dan Jawaban merupakan tiga jendela desktop terpisah. Panel memiliki opacity latar 30–85% dengan default 45%, kontrol selalu di atas, mode ringkas, dan docking. Posisi serta ukuran jendela disimpan lokal.

Gunakan tombol **Tampilkan atau sembunyikan panel** dan **Reset posisi panel** di Settings untuk mengatur kedua panel langsung dari dashboard.

| Shortcut | Fungsi |
| --- | --- |
| `Ctrl+Alt+Shift+A` | Tampilkan atau sembunyikan panel |
| `Ctrl+Alt+Shift+R` | Reset posisi panel ke monitor utama |

System tray dapat diaktifkan di Settings. Menutup dashboard dengan tray aktif menjeda pemrosesan dan menyembunyikan jendela. AURA tetap menjadi proses aktif sampai pengguna memilih Keluar. Tanpa tray, menutup dashboard mengakhiri proses aplikasi.

## Sesi, memori, dan penggunaan

Jenis aktivitas `Interview`, `RGD`, atau `Belum pasti` terpisah dari tahap sesi. Deteksi teks lokal ditandai sebagai heuristik. Analisis screenshot memerlukan provider multimodal. Saran tahap dari teks harus diterapkan pengguna.

Smart Context Memory menggabungkan profil, fakta terkunci, posisi aktif, checkpoint ekstraktif lokal, giliran terbaru, dan hasil pencarian relevan. Pergantian provider memakai memori lokal yang sama. Giliran dengan pembicara belum diketahui tetap diberi label tidak diketahui.

Anggaran awal sesi adalah Rp10.000 dengan peringatan 80%. Pilih Economy, Balanced, atau Deep untuk mengatur alokasi konteks. Aplikasi memperkirakan biaya sebelum permintaan, termasuk percobaan ulang, lalu memakai token usage dari provider jika tersedia. Nilai Rupiah memakai kurs asumsi yang dapat diedit. Biaya gambar merupakan perkiraan dan tercakup dalam biaya input. Tarif, pembulatan, kuota akun, dan tagihan akhir mengikuti provider.

## Data dan kunci API

Data desktop disimpan di direktori data lokal aplikasi, umumnya `%LOCALAPPDATA%\id.aura.interview`. Berkas `aura.sqlite3` memuat ruang kerja, dokumen, dan riwayat yang dipilih untuk disimpan. Indeks giliran sesi aktif berada di memori. Brankas `vault.hold` dilindungi kata sandi dengan derivasi Argon2id dan Stronghold. Kata sandi brankas tidak dapat dipulihkan aplikasi.

Kunci API disimpan terpisah per provider. Permintaan HTTPS dikirim oleh backend Rust yang mengambil key dari vault. Renderer memasukkan key hanya pada formulir penyimpanan, lalu mengosongkan formulir. Key tidak disimpan dalam localStorage, database ruang kerja, atau konfigurasi proyek.

Screenshot berada dalam memori sementara, lalu dilepas setelah permintaan diproses atau sesi diakhiri. Lampiran tidak dimasukkan ke riwayat. Hasil pembacaan gambar dapat menjadi teks konteks sesi. Tinjau data pribadi sebelum mengirim. Data yang dikirim ke cloud tunduk pada retensi dan kebijakan provider. OpenAI menggunakan `store:false`.

Pada pratinjau browser, ruang kerja lokal memakai penyimpanan browser. Gunakan kontrol reset data untuk menghapusnya. Pada desktop, **Reset ruang kerja** menghapus konfigurasi, dokumen, dan riwayat. Hapus masing-masing key melalui kontrol brankas bila ingin menghapus kunci tersimpan.

## Cakupan versi ini

Antarmuka menyediakan Dashboard, Live Copilot, Session Intelligence, Knowledge Base, Jobs & Profiles, Prompt Studio, Session History, dan Settings. Adapter Gemini dan OpenAI memvalidasi output JSON, menangani error API, timeout, pembatalan, dan satu percobaan ulang untuk error yang dapat dicoba lagi.

Simulasi RGD lokal menyediakan skenario dan peserta contoh berlabel simulasi. Tombol **Peserta AI berikutnya** meminta tanggapan peserta fiktif melalui provider aktif setelah izin cloud diberikan, dengan anggaran sesi yang sama. Mikrofon, audio sistem, transkripsi langsung, screenshot otomatis, ekstraksi PDF/DOCX, dan pencarian web belum tersedia pada alur aplikasi ini. Latihan dapat memakai catatan dan transkrip yang dimasukkan manual.

## Pengujian dan build

```powershell
npm run typecheck
npm test
$env:AURA_E2E_CHANNEL = "chrome"
npm run e2e
npm run build
npm run tauri build
```

Gunakan `npx playwright install chromium` bila browser yang didukung belum tersedia, lalu hapus variabel `AURA_E2E_CHANNEL` untuk memakai browser bawaan Playwright. Installer NSIS akan ditempatkan di `src-tauri\target\release\bundle\nsis` pada build standar. Folder target dapat berbeda bila `CARGO_TARGET_DIR` disetel.

Uji koneksi provider memerlukan API key pengguna, model yang tersedia untuk akun tersebut, tahap sesi aktif, dan izin cloud. Pengujian otomatis memakai respons provider tiruan untuk memeriksa alur tanpa biaya API.

## Hasil verifikasi lokal

Build MSVC x64 yang disertakan menggunakan profil pengembangan dengan aset frontend produksi. Lulus 31 uji unit TypeScript, 5 uji Playwright, dan 6 uji Rust. Pengujian AURA.exe membuka tiga jendela Windows, menyinkronkan prompt, memblokir API saat Standby, serta memeriksa docking, perubahan ukuran terpisah, dan kontrol panel di Settings.

Isi installer NSIS sudah diperiksa. Berkas AURA di dalam installer cocok dengan executable yang diuji. Proses pemasangan dan API dengan kunci asli belum diuji. Windows di lingkungan uji menolak registrasi shortcut global, sehingga pengujian kontrol jendela memakai tombol Settings.

## Referensi resmi

- [Persyaratan Tauri pada Windows](https://v2.tauri.app/start/prerequisites/)
- [Installer Windows Tauri](https://v2.tauri.app/distribute/windows-installer/)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Structured output OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Structured output Gemini](https://ai.google.dev/gemini-api/docs/structured-output)
- [Harga Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- [Harga OpenAI](https://developers.openai.com/api/docs/pricing)
- [Perhitungan token gambar OpenAI](https://developers.openai.com/api/docs/guides/images-vision)
