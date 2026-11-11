# Prompt implementasi untuk Codex

Implementasikan aplikasi desktop Windows bernama AURA, berdasarkan `BLUEPRINT.md` dan `answer.schema.json` di folder ini. Gunakan Tauri v2 + Rust backend, React + TypeScript + Vite, Tailwind CSS, shadcn/Radix, Zustand, SQLite + FTS5, Zod, Tauri Stronghold untuk kunci API.

PRIORITAS MVP:
1. Buat **dua jendela desktop Tauri WebviewWindow terpisah** (floating Prompt dan floating Answer) yang benar-benar dapat di-drag/resized secara independen, posisi dan ukuran tersimpan via Tauri window-state; dashboard adalah jendela ketiga. Gunakan transparansi dark-glass opacity latar 45% tetapi teks 100% opaque. Opacity slider 30–85%, docking left/right, normal & compact mode, always-on-top opsional, serta keyboard-accessible UI. Jangan menambahkan screen-share exclusion atau fitur penghindaran proctoring.
2. Buat screens Dashboard, Copilot, Session Intelligence, Knowledge, Jobs, Prompt Studio, Session History, Settings. Interview dan RGD harus dikenali otomatis dari screenshot/prompt/transkrip (atau unknown jika ambigu), tidak dipilih pengguna per gambar. Settings wajib menyediakan hanya Gemini dan OpenAI, model yang dapat dipilih, API key terpisah yang disimpan secara aman. Jangan menyimpan API key di localStorage.
3. Implementasi provider adapters nyata untuk OpenAI Responses API dan Gemini, keduanya mendukung text + image, structured JSON, timeout/cancel, rate-limit error, token/biaya jika tersedia. Jangan langsung memanggil API cloud dari renderer apabila key berisiko terekspos.
4. Implement file import `catatan.txt`, `.md` dan image, local SQLite/FTS5 retrieval, disposable image buffer, prompt preferences session-persistent, default KETIK_45 25–35 kata. **Prioritas UI:** textarea prompt utama dengan image attachment dari Ctrl+V/Cmd+V menggunakan ClipboardEvent, thumbnail, tombol hapus, file picker dan drag-drop, batas ukuran dan MIME. Jangan minta durasi lagi setiap gambar.
5. Implement JSON validation Zod dan koreksi bila melebihi batas kata. Jangan memberikan klaim palsu durasi tepat 45 detik; kalibrasikan WPM pengguna.
6. Buat Session Intelligence classifier multimodal: hasil `interview | rgd | unknown`, bukti, tingkat kepastian, rolling memory untuk dialog interviewer atau peserta. Dukung simulator RGD dengan dummy peserta AI tetapi jangan mengharuskan mode RGD dipilih manual. Jangan mengklaim isi screenshot sudah dianalisis ketika API belum tersedia. Live capture audio hanya opsional/fase selanjutnya, dengan izin eksplisit dan indikator jelas.
7. Buat test unit untuk schema, provider switching, word count, prompt overrides, response parsing, classifier/unknown dan API errors; e2e untuk opacity slider, clipboard image paste, paste teks, image removal, dan file import.
8. Lengkapi README untuk instalasi Node, Rust, WebView2, cara run `npm run tauri dev`, build installer dan keamanan.

PENTING: prototipe HTML di `AURA_UI_Prototype.html` adalah referensi visual, bukan implementasi API. Buat modul-modul production code secara terpisah dan jangan mengklaim fitur selesai sebelum diuji.

## Penegasan v1.3 untuk Zoom dan proses background
- Desktop app harus dapat berjalan berdampingan dengan Zoom tanpa bergantung pada plugin/extension Zoom. Dua panel bebas pindah di desktop (bukan hanya di satu kanvas HTML); beri shortcut untuk tampilkan/sembunyikan keduanya dan reset posisi.
- Implement menu system tray opsional: `Show AURA`, `Pause session`, `End session`, `Quit`. Tutup jendela tidak boleh diam-diam merekam atau tetap memproses; tanyakan/patuhi preferensi pengguna. Autostart OFF secara default.
- Nyatakan aplikasi masih merupakan proses aktif saat di-tray. Jangan membuat fitur menyembunyikan proses dari Task Manager, aplikasi pengawasan, atau screen share.
- Prototipe HTML v1.3 memeragakan drag dua panel secara independen, masih terbatas pada area simulasi. Pengujian production memerlukan build `.exe` Tauri, bukan hanya HTML.


## Implementasi yang WAJIB ditambahkan pada v1.3
1. Baca `SMART_MEMORY_AND_COST.md` dan `SESSION_LIFECYCLE.md` sebelum membangun model data dan state machine.
2. `activity_type=interview|rgd|unknown` berbeda dari `session_stage=standby|briefing|case_analysis|discussion|end`. Status awal standby dengan mic/API OFF. Klasifikasi otomatis hanya mengusulkan transisi; aktivasi capture perlu izin eksplisit.
3. Gunakan bounded Smart Context Memory lokal, bukan full chat pada setiap request. Implement pinned facts, provenance, recent 2–3 turns, FTS5 retrieval, checkpoint summary, speaker unknown, dan penanda posisi yang diganti.
4. Anggaran sesi default Rp10.000, warning 80%, pilihan Economy/Balanced/Deep, preflight cost check dan rekonsiliasi usage token yang dikembalikan provider. Laporan image/audio/tools/retry/summarization terpisah.
5. Tambahkan preview tahap sesi dan usage monitor. Prototipe HTML boleh menyimulasikan angka tanpa API tetapi wajib memberi label demo.
6. Tests: tidak ada capture/API saat standby, 30+ turns memory retrieval, posisi berubah, provider switching, budget exceed, transisi moderator quoted rules, Ctrl+V dan opacity.
