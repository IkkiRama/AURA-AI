# Checkpoint pengembangan AURA 1.6.0

## Milestone 1.6.0 · Evidence Vault dan Answer DNA

- **Jobs & Profiles → Evidence Vault** menyimpan 12 kategori pengalaman dengan asal klaim, tautan sumber HTTPS opsional, serta tautan lokal ke Knowledge Base. Tautan ke dokumen adalah penandaan pengguna. Status turun menjadi **Belum terverifikasi** ketika berkas terkait dihapus. Dokumen dan metadata sumber tetap di perangkat. Saat pengiriman ke GPT atau Gemini diizinkan, pemilih memakai hanya cuplikan yang relevan dalam anggaran konteks lama. Fakta profil dari 1.5 tetap tersimpan dan memakai jalur seleksi yang sama.
- **Settings → Personal Answer DNA** menyediakan profil gaya yang bisa dinonaktifkan, direset, atau dihapus. Bahasa eksplisit di Prompt Studio atau pertanyaan tetap berlaku. Analisis contoh latihan menghasilkan statistik lokal. Teks latihan dibersihkan setelah dianalisis dan profil hanya menyimpan preferensi yang dikonfirmasi pengguna.
- **Detail jawaban → Pemeriksaan lokal** menampilkan catatan angka tanpa sumber yang cocok, pergeseran angka saat follow-up, pengulangan, relevansi istilah utama, dan bentuk artefak SQL. AURA menyisihkan kalimat yang terdeteksi mengklaim pengalaman personal tanpa dukungan dari cuplikan yang dikirim. Semuanya heuristik lokal tanpa permintaan API tambahan. Pemeriksaan tersebut tidak memvalidasi dokumen asli, mengeksekusi kode, atau menjamin kebenaran seluruh isi jawaban.
- Evidence Vault dan Answer DNA memakai penyimpanan workspace SQLite yang sudah ada. Tidak ada perubahan versi skema SQLite. Profil, izin cloud, dan brankas API mengikuti jalur penyimpanan sebelumnya.

| File 1.6.0 | Perubahan |
| --- | --- |
| `src/features/evidence/{model,context}.ts`, `src/app/EvidenceVaultPage.tsx` | Penyuntingan, provenance, validasi, dan pemilihan cuplikan dengan rujukan lokal |
| `src/features/personalization/model.ts`, `src/features/personalization/AnswerDnaPage.tsx` | Profil gaya, analisis latihan di memori, dan preferensi bahasa |
| `src/features/ai/{verification,answer.schema}.ts`, `src/features/memory/contextAssembler.ts`, `src/app/store.ts` | Rujukan dalam anggaran, prompt, pemeriksaan sebelum hasil tampil, dan kompatibilitas data |
| `src/app/{App,Workspace,WorkspaceLibrary,WorkspaceSettings,AnswerPanel,TechnicalAnswerDetails}.tsx` | Navigasi dan catatan pemeriksaan di panel jawaban |
| `tests/unit/{evidence,answer-verification,personalization}.test.ts`, `tests/e2e/evidence.spec.ts`, `tests/native/personalization-smoke.mjs` | Uji pemilihan bukti, privasi, klaim, preferensi, dan penyimpanan SQLite |
| `package.json`, `package-lock.json`, `src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json}`, `src/app/update/changelog.json`, `README.md` | Metadata 1.6.0 dan panduan pengguna |

Untuk smoke test, buat build QA dengan identifier Tauri `id.aura.interview.evidenceqa` dan `app.appDirectoriesOverride.localData` menunjuk ke direktori uji kosong. Jalankan `node tests/native/personalization-smoke.mjs <exe-qa> <folder-uji>`. Uji mengganti isi workspace QA untuk memeriksa pembukaan data 1.5, jadi gunakan profil uji khusus.

Lint, build frontend, build desktop Windows, 99 uji TypeScript, 11 skenario browser, 14 uji Rust, dan 3 uji metadata rilis lulus. Smoke test pada profil Windows terisolasi memeriksa bahwa fakta profil lama, opacity, Evidence Vault, dan Answer DNA bertahan setelah aplikasi dibuka kembali, serta penghapusan profil DNA tersimpan. Pengujian provider memakai kontrak dan respons uji. Permintaan dengan API key nyata dan rilis NSIS bertanda tangan masih terbuka.

## Milestone 1.5.0 · Teleprompter dan klasifikasi pertanyaan

## Audit dan urutan pengembangan

AURA 1.4 sudah memiliki Tauri v2, dua floating panel, lampiran screenshot manual, SQLite/FTS5, vault Stronghold, GPT/Gemini, Smart Context Memory, Prompt Studio, biaya, serta updater dan Changelog. Bagian teleprompter sebelumnya baru ada di staging. Milestone ini memakai kembali modul alignment dan scroll tersebut, menghubungkannya ke panel jawaban, dan menambahkan klasifikasi pertanyaan sebelum permintaan provider.

| Tahap | Status | Cakupan |
| --- | --- | --- |
| A. Audit | Selesai | Periksa repositori, fitur yang sudah berjalan, dan integrasi yang diperlukan |
| Teleprompter | Diterapkan | Mikrofon terpilih, VAD, Whisper multibahasa lokal, hasil interim dan final, highlight kata/frasa, improvisasi, rejoin, scroll manual/otomatis, override 4 detik, dan preferensi SQLite |
| B. Universal Intelligence | Diterapkan | Klasifikasi lokal domain, intent, perkiraan kompetensi dan bahasa; kerangka per pertanyaan; parent turn dan jawaban terkait dalam Smart Context Memory; panduan domain ringkas |
| C. Personalisasi dan verifikasi | Diterapkan di 1.6 | Evidence Vault, Answer DNA opt-in, detail teknis, dan pemeriksaan lokal tersedia. Job Intelligence tetap menjadi milestone berikutnya |
| D. Coding Intelligence | Sebagian | Jawaban teknis dapat menyertakan langkah implementasi dan verifikasi. Analisis screenshot tetap menggunakan jalur vision yang sudah ada |
| E. Praktik dan keandalan | Sebagian | Jawaban tersimpan dan basis pengetahuan tetap tersedia offline; teleprompter dan Rescue lokal; bahasa campuran mempertahankan istilah teknis |
| F. AURA Rescue | Sebagian | Saran manual di panel Jawaban menggunakan posisi naskah dan ucapan final terbaru. Highlight asli ditahan saat saran tampil. Saran punya alignment terpisah dan ditutup saat selesai atau saat pengguna kembali ke naskah dengan cukup jelas |

## Implementasi dan pengoperasian

| File | Perubahan |
| --- | --- |
| `src/features/teleprompter/alignment.ts`, `concepts.ts` | Segmen naskah yang melestarikan teks asli, alignment fuzzy, dan kemiripan konsep terbatas Bahasa Indonesia dan Inggris |
| `src/features/teleprompter/audio.ts`, `useSpeechTracking.ts`, `public/audio/aura-microphone.js` | AudioWorklet untuk mikrofon tunggal, VAD dan antrean cuplikan terbatas, siklus start/stop, dan data ucapan final terbaru di memori |
| `src/features/teleprompter/{SpeechText.tsx,scroll.ts,speech.css,TeleprompterSettings.tsx,preferences.ts}` | Highlight, posisi tengah, cooldown, pengaturan, dan status |
| `src/features/teleprompter/{rescue.ts,useRescue.ts,RescueSuggestion.tsx}` | Continuation lokal terstruktur, pemilihan poin yang belum disampaikan, panel saran, dan rejoin |
| `src/features/intelligence/intent.ts`, `src/app/store.ts` | Deteksi domain/intent dari pertanyaan dan konteks yang dipilih, guidance provider, dan relasi turn |
| `src/features/ai/{answer.schema.ts,normalize.ts}`, `src/app/TechnicalAnswerDetails.tsx` | Kontrak detail teknis GPT/Gemini yang dipilih hanya untuk pertanyaan relevan, normalisasi kompatibel dengan arsip lama, dan UI yang dapat dibuka |
| `src/app/{App.tsx,Workspace.tsx,WorkspaceSettings.tsx,AnswerPanel.tsx,panels.tsx}` | Navigasi, persetujuan per sesi, kontrol panel, dan integrasi teleprompter/Rescue |
| `src-tauri/src/{speech.rs,main.rs,desktop.rs,release.rs}`, `scripts/install-speech.ps1` | Validasi digest paket Whisper, IPC terbatas pada jendela terkait, pemrosesan audio melalui stdin, pembatalan, dan guard pemasangan updater |
| `tests/unit/{teleprompter-alignment,teleprompter-scroll,teleprompter-audio,intent,rescue,ai}.test.ts`, `tests/e2e/workspace.spec.ts`, `tests/native/teleprompter-smoke.mjs` | Alignment, cooldown, klasifikasi, VAD, Rescue, pilihan skema provider, preferensi, dan runner uji WebView2 Windows |
| `package.json`, `package-lock.json`, `src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json}`, `src/app/update/changelog.json`, `README.md` | Versi 1.5.0, dependensi SHA-256 Rust, catatan rilis, dan panduan pemasangan |

Pasang Whisper dengan `powershell -ExecutionPolicy Bypass -File .\scripts\install-speech.ps1` dari folder proyek. Skrip memeriksa SHA-256 untuk [paket whisper.cpp v1.8.3 Windows x64](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.3) dan [model multilingual Base Q5_1](https://huggingface.co/ggerganov/whisper.cpp/blob/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin). Model berukuran sekitar 60 MB dan dapat disimpan terpisah dari executable AURA. Pada setiap aktivasi, aplikasi memeriksa aset di `%LOCALAPPDATA%\id.aura.interview\speech\whisper-v1.8.3`. Whisper berjalan satu proses per cuplikan, satu cuplikan sekaligus, dengan timeout 22 detik. Audio tidak dikirim ke provider dan tidak ditulis ke basis data. Opsi preferensi mesin lokal tersimpan. Whisper lokal adalah satu-satunya mesin STT yang tersedia pada tahap ini.

Aktifkan Speech Tracking di Settings, pilih mikrofon, lalu mulai capture secara eksplisit dari panel jawaban ketika naskah dan sesi aktif tersedia. Pause, End, dan penutupan panel menghentikan mikrofon. Input hanya dari mikrofon terpilih. Suara peserta lain yang masuk secara akustik melalui mikrofon masih bisa dikenali. Gunakan headset. Tidak ada diarization. Kemiripan semantik lokal terbatas pada kosakata konsep dan urutan kata. Parafrasa yang jauh akan menahan highlight sampai ada bukti tambahan. Tidak ada biaya API untuk teleprompter atau Rescue lokal.

## Status verifikasi

Lint, build frontend, build Windows x64, 81 uji TypeScript, 9 uji browser, 14 uji Rust, dan 3 uji metadata rilis lulus. Pada profil Windows terisolasi, WebView2 memutar rekaman uji Bahasa Inggris melalui perangkat mikrofon virtual. Whisper mengeksekusi transkripsi lokal melalui IPC Rust. Uji desktop memeriksa highlight, Rescue manual, opacity selama capture, preferensi setelah reload, dan penolakan aktivasi di Standby serta setelah sesi berakhir. Uji unit memakai contoh alignment Indonesia dan Inggris. Uji mikrofon fisik, rekaman Bahasa Indonesia, percakapan beberapa penutur, dan keluaran provider dengan API key nyata masih terbuka. Pendaftaran global shortcut ditolak oleh Windows di lingkungan uji.

Untuk mengulang smoke test, buat build QA dengan Tauri `identifier` `id.aura.interview.speechqa` dan `app.appDirectoriesOverride.localData` yang menunjuk ke folder uji. Pasang aset Whisper ke folder itu memakai `-AppDataDirectory`. Jalankan `node tests/native/teleprompter-smoke.mjs <exe-qa> <folder-uji> <jfk.wav>` dengan [fixture upstream](https://github.com/ggml-org/whisper.cpp/blob/v1.8.3/samples/jfk.wav). Runner memeriksa identifier dan lokasi data sebelum mengubah preferensi uji.

Update resmi NSIS masih memerlukan feed HTTPS dan kunci penandatanganan. Atur secret sesuai [panduan rilis](RELEASE.md).

## Milestone berikutnya

1. Tambahkan analisis lowongan dari teks/file dan URL yang diizinkan, pencocokan dengan Evidence Vault, masukan perusahaan, serta profil PCAM OJK berbasis referensi resmi.
2. Tambahkan langkah Coding Navigator dengan path dan status terverifikasi, Coding Session Memory, serta VS Code Companion dengan otorisasi lokal. Sandbox praktik menunggu isolasi eksekusi yang dapat diuji.
3. Lanjutkan simulator adaptif dan metrik latihan tanpa klaim prediksi rekrutmen.
4. Tambahkan Smart Rescue opt-in dengan hysteresis, pemilihan konteks yang mencakup pertanyaan dan poin jawaban, normalisasi Rescue lewat provider dan anggaran yang sama bila perlu, serta metadata penggunaan Rescue dengan persetujuan riwayat. Jangan simpan audio mentah.
