# Checkpoint pengembangan AURA 1.5.0

## Audit dan urutan pengembangan

AURA 1.4 sudah memiliki Tauri v2, dua floating panel, lampiran screenshot manual, SQLite/FTS5, vault Stronghold, GPT/Gemini, Smart Context Memory, Prompt Studio, biaya, serta updater dan Changelog. Bagian teleprompter sebelumnya baru ada di staging. Milestone ini memakai kembali modul alignment dan scroll tersebut, menghubungkannya ke panel jawaban, dan menambahkan klasifikasi pertanyaan sebelum permintaan provider.

| Tahap | Status | Cakupan |
| --- | --- | --- |
| A. Audit | Selesai | Periksa repositori, fitur yang sudah berjalan, dan integrasi yang diperlukan |
| Teleprompter | Diterapkan | Mikrofon terpilih, VAD, Whisper multibahasa lokal, hasil interim dan final, highlight kata/frasa, improvisasi, rejoin, scroll manual/otomatis, override 4 detik, dan preferensi SQLite |
| B. Universal Intelligence | Diterapkan | Klasifikasi lokal domain, intent, perkiraan kompetensi dan bahasa; kerangka per pertanyaan; parent turn dan jawaban terkait dalam Smart Context Memory; panduan domain ringkas |
| C. Personalisasi dan verifikasi | Sebagian | Detail teknis opsional dan artefak terstruktur untuk jenis pertanyaan yang relevan. Profil dan pencarian dokumen yang sudah ada memasok konteks secara selektif |
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

1. Perluas Evidence Vault yang ada dengan kategori, provenance, dan status verifikasi. Hubungkan fakta terseleksi ke pemeriksaan jawaban dan pilihan jawaban hipotetis yang eksplisit. Tambahkan Personal Answer DNA yang bisa ditinjau, diubah, dan dihapus.
2. Tambahkan analisis lowongan dari teks/file dan URL yang diizinkan, masukan perusahaan, serta profil PCAM OJK berbasis referensi resmi. Lanjutkan simulator adaptif dan metrik latihan tanpa klaim prediksi rekrutmen.
3. Tambahkan langkah Coding Navigator dengan path dan status terverifikasi, Coding Session Memory, serta VS Code Companion dengan otorisasi lokal. Sandbox praktik menunggu isolasi eksekusi yang dapat diuji.
4. Tambahkan Smart Rescue opt-in dengan hysteresis, pemilihan konteks yang mencakup pertanyaan dan poin jawaban, normalisasi Rescue lewat provider dan anggaran yang sama bila perlu, serta metadata penggunaan Rescue dengan persetujuan riwayat. Jangan simpan audio mentah.
