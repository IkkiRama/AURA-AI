# AURA — AI Interview Companion
## Product & Engineering Blueprint v1.3
**Tanggal:** 10 November 2026  
**Platform utama:** Windows 10/11 desktop  
**Tujuan:** persiapan interview dan RGD, analisis screenshot, dokumen profil, serta pendamping percakapan real-time **jika diizinkan**.  
**Batasan:** tidak menyediakan mode untuk menghindari proctoring, menyembunyikan penggunaan AI dari pengawasan, atau merekam orang tanpa izin.

> **Pembaruan v1.3:** sesi terdiri dari jenis (`interview|rgd|unknown`) dan tahapan (`standby|briefing|case_analysis|discussion|end`); ada Smart Context Memory dan pengendali biaya. Baca `SMART_MEMORY_AND_COST.md` dan `SESSION_LIFECYCLE.md` untuk detail implementasi.

## 1. Visi Produk
**AURA** adalah asisten interview pribadi yang mengubah konteks dari CV, catatan, deskripsi lowongan, screenshot, dan transkrip yang diberikan dengan izin menjadi saran jawaban yang spesifik, ringkas, natural, dan konsisten antar giliran. UI desktop semi-transparan memudahkan pengguna melihat video conference di belakang jendela.

### Prinsip inti
- **Local-first:** konfigurasi, catatan, profil kerja, arsip, dan ringkasan disimpan lokal secara default.
- **User-controlled:** pengguna memilih provider/model dan izin microphone/desktop-audio. Target durasi/format diatur sekali via prompt dan berlaku ke semua screenshot berikutnya.
- **Provider-agnostic:** hanya ada dua provider: Google Gemini dan OpenAI GPT. API keys terpisah, setiap provider dapat diuji mandiri.
- **Prompt-once:** preferensi durasi dan format berlaku pada sesi/profil sampai diubah. Tiap gambar tidak memerlukan pengaturan ulang.
- **Truthful:** pengalaman kerja dan informasi peserta tidak boleh dibuat-buat; sumber web diberi atribusi.
- **Permitted use:** live copilot hanya pada sesi yang mengizinkan AI; jika dilarang, gunakan mode latihan sebelum sesi.

## 2. Tech Stack yang disarankan
| Lapisan | Teknologi | Kegunaan |
|---|---|---|
| Desktop host | Tauri 2 + Rust | jendela transparan, always-on-top, native permission, file I/O |
| UI | React + TypeScript + Vite | tampilan desktop cepat dan modular |
| Styling | Tailwind CSS + CSS custom properties | tema dark glass, opacity responsif |
| Komponen | Radix UI / shadcn/ui + Lucide | formulir, navigasi, dropdown, tooltip |
| State | Zustand | provider aktif, mode, window state, session state |
| Query/cache | TanStack Query | permintaan AI, loading, cancellation, retry |
| Storage lokal | SQLite + FTS5; Tauri Store untuk prefs | jobs, dokumen, transkrip, riwayat, pencarian lokal |
| Secrets | Tauri Stronghold + password/OS keychain strategy | API keys dan token; jangan simpan di localStorage |
| Validasi | Zod | validasi schema dan runtime JSON |
| AI provider | adapter OpenAI Responses API; adapter Gemini API | satu kontrak jawaban bersama |
| Audio (tahap 2) | system/mic capture dengan izin, streaming STT | transkrip pembicara dan penanda giliran |
| Testing | Vitest, React Testing Library, Playwright | unit, UI, integrasi, regresi |
| Distribusi | Tauri Windows Installer | paket MSI/NSIS setelah build dan pengujian |

Tidak perlu Laravel, PHP, server permanen, ataupun login untuk prototipe satu pengguna. Untuk produk multi-user berlangganan, tambah backend API yang menjaga kunci server.

## 3. Identitas visual dan aturan desain
- **Nama:** AURA | Tagline: Listen. Understand. Respond.
- **Palet:** `#101B2B` (midnight), `#223B55` (slate), `#2DD4BF` (teal), `#EDF4F8` (frost), `#FFBD69` (warning), `#F16E7C` (error).
- **Font:** Inter (fallback system-ui); ukuran output jawaban 17–20 px, kontrol 12–14 px.
- **Gaya:** minimal dark glass, radius 12–18 px, stroke putih 12% opacity, bayangan tipis.
- **Jendela:** actual Tauri window transparent true; body transparan; background panel `rgba(16,27,43,.45)` (opacity 45%). **Jangan** opacity entire DOM (teks harus solid).
- **Kontrol pengguna:** opacity slider 30–85%; default 45%, contrast reading mode, blur 0–8 px, font scale 90–130%, docking kiri/kanan, mini-mode.
- **Ukuran:** dashboard 1180×760; copilot 420×480; mini 420×220; responsive ke layar 1366×768.
- **Always-on-top:** opsional. Jendela dapat terlihat dalam screen share dan kamera; tidak ada jaminan concealment.
- **Multiwindow:** pisahkan `prompt` dan `answer` sebagai dua `WebviewWindow` Tauri mandiri. Masing-masing punya drag handle, resize, opacity, toggle always-on-top, show/hide, dan posisi/ukuran yang disimpan melalui plugin `window-state`. Dashboard dapat disembunyikan tanpa menghentikan proses jika sesi memang masih aktif.
- **Motion:** hanya transisi 120–180 ms, reduksi animasi sesuai preferensi OS.

## 4. Information Architecture dan Halaman
1. **Home / Dashboard** — sesi terakhir, provider aktif, status API, profil default, action screenshot/latihan.
2. **Live Copilot** — video terlihat di belakang overlay, output jawab utama, transcript drawer, source chips, opacity, model.
3. **Session Intelligence (AUTO)** — mengklasifikasikan interview/RGD/unknown dari screenshot + prompt + transkrip berizin; memori umum dan argumen peserta. Tidak ada pilihan mode wajib per gambar. Simulasi RGD adalah fitur latihan di dalam modul ini, bukan tipe sesi yang harus dipilih.
4. **Knowledge Base** — import .txt/.md/.pdf/.docx, ekstraksi, pencarian, preview, relevansi, kontrol hapus.
5. **Jobs & Profiles** — profil pengalaman, CV, deskripsi lowongan, kamus kompetensi, template target perusahaan.
6. **Prompt Studio** — template instruksi awal, default `KETIK_45`/`LISAN_45`, style, mode, uji contoh, versioning.
7. **Sessions & History** — hasil sebelumnya, review, koreksi fakta, evaluasi latihan, export dengan persetujuan.
8. **Settings** — GPT/Gemini model, API key terpisah, test connection, privacy, hotkeys, audio, budget, appearance.

### Mode penggunaan
- **Prepare:** ringkasan lowongan dan pertanyaan potensial berdasarkan profil.
- **Screenshot → Answer:** upload/capture gambar secara sadar, vision → draft jawaban.
- **RGD Practice:** permainan peran dan tanggapan kontekstual, dengan simulasi peserta AI.
- **Live (permitted):** mic/system audio dengan izin → turn segmentation → saran ringkas; indikator LIVE/RECORDING selalu terlihat.

## 5. Detail UI Copilot
Bar atas: logo AURA | provider & model dropdown | permission status | minimize/dock | Settings.  
Area utama: jawaban siap disampaikan dengan tombol copy, Regenerate, Shorten, Expand, Cite. Kolom prompt multimodal di bawah preview; screenshot clipboard muncul sebagai attachment/thumbnail melalui Ctrl+V (Windows) atau Cmd+V (macOS), didukung browse dan drag-drop.  
Footer: tab Transcript | Context | Sources; indikator panjang, estimasi bicara/ketik; badge **AUTO: Interview / RGD / Belum Pasti** dan catatan confidence.  
Panel prompt dan panel jawaban dapat dipindah sendiri-sendiri lewat header, di-resize, dan memiliki opacity masing-masing. Opacity awal 45% hanya untuk latar panel, bukan teks. Pada prototipe HTML, keduanya terbatas di area simulasi meeting; dalam aplikasi Tauri produksi, masing-masing merupakan jendela desktop bebas posisi dan kompatibel dengan Zoom.

### Siklus hidup desktop / Zoom
- Tidak memerlukan ekstensi Zoom: AURA berjalan sebagai proses desktop terpisah di samping Zoom. Menampilkan jendela di atas Zoom tidak otomatis memberikan akses ke audio, layar, atau isi meeting. Audio/system capture perlu izin pengguna dan implementasi terpisah.
- `Open app`: jalankan normal, pilih aktivitas latihan atau sesi yang mengizinkan AI. `Hide to tray`: UI disembunyikan, proses backend tetap aktif hanya jika pengguna memilih tetap menjalankan sesi. `Exit`: hentikan audio/capture, batalkan request, tutup proses.
- Default **launch on startup = OFF**, **capture microphone = OFF**, **capture screen = OFF**, **background session = OFF**. Pengguna dapat mengubah izin secara eksplisit.
- Di Windows, webview yang disembunyikan bisa ditangguhkan. Pekerjaan sesi yang harus tetap berlangsung diproses di Rust/backend, bukan bergantung pada timer JavaScript di UI tersembunyi.
- Tidak ada mode penyembunyian dari Task Manager atau penghindaran mekanisme pengawasan. Jika aplikasi tidak berjalan, ia tidak bisa memonitor kegiatan lokal secara real-time.

## 6. End-to-end data flow
```text
Knowledge: catatan.txt / CV / Job description ----> parser ----> SQLite/FTS5 ----> relevant chunks
                                                                                 \
Screenshot (manual/consented) ----> RAM image + optional crop ----> Vision request --+--> Context assembler
                                                                                 /
Audio (consented) ----> STT --> speaker labels + turns --> rolling discussion memory
                                                                                 |
Provider Router (OpenAI | Gemini) <---- model + API key + system prompt + memory + retrieved sources
            |
       JSON Schema response -> Zod validator -> word/time budget check -> answer card -> local history (optional)
```

### Skenario screenshot
1. Pengguna mengambil screenshot melalui OS lalu menempelkannya dengan Ctrl+V pada kolom prompt; atau memilih/drag-drop PNG/JPG/WebP. Browser/renderer menangani ClipboardEvent dan menampilkan thumbnail seketika, dengan validasi MIME/ukuran.
2. App menampilkan preview/crop dan kontrol redaksi PII.
3. App menambahkan sistem instruksi (sekali per sesi/profil), konteks lowongan, dan ringkasan diskusi. Jenis sesi tidak dipilih pengguna: klasifikasi AI dari gambar, teks, dan percakapan berjalan sebelum menyusun jawaban.
4. App mencari potongan `catatan.txt` yang relevan, bukan mengunggah seluruh dokumen tanpa perlu.
5. App mengirim gambar + konteks ke provider terpilih via HTTPS.
6. Klasifikasi `interview | rgd | unknown` beserta alasan/confidence dinormalisasi menjadi metadata sesi; hasil jawaban dinormalisasi menjadi satu schema. Saat unknown, minta konteks bila perlu dan jangan memaksa identifikasi.
7. Validasi lokal: cek kelengkapan, cek jumlah kata, estimasi durasi berdasar kecepatan user, tandai klaim tak berdasar.
8. Tampilkan jawaban utama, transisi ke histori hanya jika pengguna mengaktifkan.
9. Screenshot dibuang dari RAM setelah respons; opsi save lokal default OFF. Penyedia cloud tetap menerapkan kebijakan retensinya sendiri.

### Deteksi otomatis jenis sesi
- Fase 1: screenshot dan prompt dikirim ke GPT/Gemini menggunakan multimodal vision; model mengeluarkan `activity_type`, `activity_confidence`, `evidence`, dan isi soal/peran yang terbaca.
- Interview: pertanyaan individual, identitas interviewer, CV/HRD/kompetensi, pola wawancara. RGD: banyak peserta, studi kasus, pembagian peran, moderator, saling menanggapi, dan keputusan bersama.
- Gunakan hasil klasifikasi sebagai **indikasi**, bukan kepastian; confidence tidak menjadi angka terkalibrasi tanpa pengujian. Jika ambigu, `unknown`.
- Model membaca transkrip berizin dan memperbarui state secara inkremental; hindari flip-flop akibat satu potongan kalimat. Sediakan koreksi opsional pada kondisi salah deteksi, tetapi tidak wajib memilih tiap gambar.
- Prototipe HTML offline hanya memakai heuristik berdasarkan *teks prompt* (tanpa AI/OCR). Screenshot-only tetap `Belum pasti` agar tidak mengaku membaca gambar.
- Daftar pengujian: paste clipboard screenshot, paste teks biasa, drag/drop, cancel/hapus attachment, klasifikasi teks, unknown pada gambar tanpa prompt, ganti provider, prompt global, error handling.

### Skenario memori RGD
- `session_facts`: isi kasus, tujuan, peran, batas yang diketahui.
- `participants`: peserta A–H dengan role, klaim, usulan, dukungan/kontra, confidence speaker labels.
- `self_positions`: argumentasi yang sudah pernah dinyatakan pengguna.
- `rolling_summary`: ringkasan percakapan 60–120 detik terakhir + keputusan terkini.
- `retrieval`: fakta dokumen profil yang relevan, sumber web bila dipakai.
- Jika speaker ambigu, label `Unknown`, **jangan** mengarang siapa yang bicara.
- Gunakan incremental transcripts dan summarization periodik agar prompt tidak terus membesar; retrieval riwayat wajib menyimpan sumber klaim dan posisi terkini. Jangan mengandalkan summary sebagai satu-satunya sumber.
- Context packet dibatasi sesuai budget token, default sekitar 2.500 input token teks per permintaan; media dihitung terpisah. Lihat `SMART_MEMORY_AND_COST.md`.

### Audio
- Mic dan system audio/loopback diperlakukan sebagai 2 stream terpisah jika tersedia; izin eksplisit.
- VAD menentukan segmen bicara; transkripsi streaming memperbarui isi; semantic end-of-turn menghindari jawaban terlalu dini.
- Speaker separation lebih andal bila channel tersedia. Jika tercampur, diarization sifatnya estimasi.
- Audio tidak otomatis disimpan sebagai file. Tombol Stop/Revoke selalu tersedia.

## 7. Provider adapters
```ts
type Provider = 'gemini' | 'openai';
type AnswerMode = 'KETIK_45' | 'LISAN_45' | 'CUSTOM';
interface AIRequest {
  provider: Provider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  image?: { mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };
  profileFacts: string[];
  discussionSummary: string;
  answerMode: AnswerMode;
  targetSeconds: number;
  allowWebSearch: boolean;
}
interface AIResponse {
  jawaban_final: string;
  intonasi: string;
  gestur: string;
  jeda: string;
  estimasi_durasi_detik: number;
  mode: 'ketik' | 'lisan';
  sumber: { title: string; url: string }[];
  uncertain: boolean;
  activity_type?: 'interview' | 'rgd' | 'unknown';
  activity_evidence?: string[];
}
interface AIProviderAdapter {
  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse>;
  testConnection(model: string): Promise<boolean>;
}
```
**OpenAI:** `POST /v1/responses`, `input_image` data URI, `text.format` JSON schema, `store:false` untuk respons stateless. Gunakan prompt/history lokal; tandai bahwa `store:false` bukan zero-data-retention penuh.  
**Gemini:** model `gemini-2.5-flash`/`gemini-2.5-flash-lite`, inline image parts; structured JSON via konfigurasi kompatibel dengan SDK/API yang dipakai; normalisasi ke schema sama. Jangan mencoba menyamakan JSON field/provider options yang berbeda tanpa adapter.  
**Web Search:** tool resmi pada provider yang mendukung; default OFF dan butuh permintaan fakta mutakhir + kebijakan penggunaan yang membolehkan. Selalu tampilkan sumber dan batasi panggilan berulang.  
**Penggantian model:** sesudah jawaban selesai pengguna dapat mengubah provider; memori sesi (ringkasan tekstual lokal) tetap digunakan; jangan mengoper state provider-specific sebagai sesi mentah.  
**Timeout & retry:** 30 detik screenshot, 1 retry exponential backoff pada 429/5xx, Cancel selalu tersedia; jika API gagal tampilkan pesan tanpa mengarang jawaban.

## 8. Structured Output
Lihat `answer.schema.json`. Perhatikan nilai `estimasi_durasi_detik` adalah **perkiraan** dan **tidak** menjamin target ketik/lisan.

### Prompt override per sesi
Prompt dasar dalam `PROMPT_DEFAULT.md` menetapkan durasi default. Pengguna dapat mengubah lewat chat, contoh:
> Mulai sesi ini seluruh jawaban maksimal 45 detik untuk mengetik, panjang 25–35 kata, satu paragraf.

Saat aplikasi menerima instruksi ini, app memperbarui session preferences; gambar berikutnya otomatis mengikuti.

## 9. Data model SQLite (konseptual)
- `profiles(id, name, base_prompt, created_at, updated_at)`
- `jobs(id, profile_id, company, role, description, created_at)`
- `documents(id, profile_id, filename, mime, hash, content, created_at)`
- `document_chunks(id, document_id, chunk_index, text)` + FTS5 virtual table
- `sessions(id, job_id, detected_type, classification_confidence, provider, model, target_seconds, answer_mode, save_history, created_at)`
- `messages(id, session_id, speaker_label, role, content, created_at)`
- `participant_positions(id, session_id, participant_label, claim, stance, confidence)`
- `responses(id, session_id, input_type, output_json, tokens_input, tokens_output, estimated_cost, created_at)`
- `session_preferences(session_id, prompt_override, panel_opacity, font_scale, web_enabled)`
- **API keys tidak masuk SQLite**; simpan di vault yang aman.

## 10. Privacy & security
1. File lokal tetap lokal sampai diperlukan untuk permintaan API dan ditinjau pengguna.
2. API key selalu dari secure vault / OS credential storage, bukan hardcoded frontend, localStorage, console atau log.
3. Screenshot default hanya RAM; hindari file sementara jika tidak perlu; hapus object URL/byte buffer seusai selesai.
4. Gambar/audio yang dikirim ke cloud tunduk pada penyedia, termasuk masa retensi yang berbeda; tampilkan disclosure per provider.
5. `store:false` untuk OpenAI, tanpa klaim bahwa seluruh data provider langsung terhapus.
6. Redaksi data pribadi: deteksi dan peringatan sebelum kirim; kontrol manual.
7. Mic/audio terpisah memerlukan izin pengguna dan kepatuhan pada aturan privasi/lokasi.
8. No auto-start microphone; LED/indikator aktif terlihat dan tombol Stop permanen.
9. CSP ketat, pembatasan plugin Tauri capabilities, batas ukuran upload, sanitasi output teks.
10. Auto-archive OFF; tombol Hapus Semua Data; export session opsional dan terkonfirmasi.
11. Konten screenshot/transkrip dianggap *untrusted input*; abaikan prompt injection yang muncul di dalamnya.
12. Overlay transparan adalah fitur UX. Tidak mengimplementasikan fitur penghindaran proctoring, capture exclusion, atau kontrol kamera eksternal.

## 11. Biaya dan performance
- **Baru v1.3:** 4 lapis smart memory: stable profile, pinned facts, rolling summary, recent + relevant historical turns. Kumpulkan hanya konteks paling relevan saat input baru, bukan mengirim semua 30 pertanyaan sebelumnya.
- **Baru v1.3:** Budget Controller (default Balanced, Rp10.000 per sesi, warning 80%, preflight stop 100% atas estimasi); usage dari API direkonsiliasi. Biaya per permintaan tidak harus meningkat terus, tetapi total biaya sesi tetap bertambah.
- **Baru v1.3:** Buat kategori terpisah untuk biaya image, streaming audio, web search, summarization, retry, token input/output/cached; nilai cached bergantung pada vendor.

- Default Gemini 2.5 Flash dapat menggunakan free tier selama tersedia dan sesuai kuota.
- Pengguna memasukkan API key sendiri; tak ada biaya langganan aplikasi dalam prototipe.
- Dashboard biaya: jumlah request, input/output tokens, estimasi USD dan IDR, kuota user-set, notifikasi ambang 80%.
- Prioritaskan kompresi gambar dengan menjaga teks tetap terbaca, local-context retrieval, rolling summary, dan cache catatan.
- Sasaran performa (bukan janji vendor): render UI < 150 ms, screenshot-to-answer p50 < 7 s pada koneksi baik, indikator progress seketika; ukur dengan telemetry lokal opt-in.
- STT/audio dan web search adalah komponen biaya tambahan yang dinonaktifkan default.

## 12. Struktur repository
```text
aura/
├── README.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── icons/
├── src/
│   ├── app/                    # routing, bootstrap, error boundary
│   ├── components/
│   │   ├── layout/             # sidebar, titlebar, overlays
│   │   ├── answer/             # AnswerCard, TimingBadge, SourceList
│   │   ├── session/            # TranscriptPanel, ParticipantMap
│   │   ├── knowledge/          # FileImport, ChunkPreview
│   │   └── settings/           # ProviderSelect, SecretVault, OpacitySlider
│   ├── pages/                  # Home, Copilot, Session Intelligence, Knowledge, Jobs, Prompt, History, Settings
│   ├── features/
│   │   ├── ai/
│   │   │   ├── provider.ts     # adapter contract
│   │   │   ├── openai.ts
│   │   │   ├── gemini.ts
│   │   │   ├── normalize.ts
│   │   │   └── answer.schema.ts
│   │   ├── capture/            # import, crop, manual capture with consent
│   │   ├── audio/              # mic permission, STT, VAD, speaker labeling
│   │   ├── knowledge/          # parsing, FTS5 retrieval
│   │   ├── discussion/         # rolling memory, participants, turn segmentation
│   │   ├── prompts/            # instructions, session overrides
│   │   └── budgets/            # token accounting
│   ├── store/                  # zustand state
│   ├── styles/                 # tokens, base, glass
│   ├── utils/
│   └── main.tsx
├── src-tauri/
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/           # file import, db, vault, screen capture, audio
│   │   ├── storage/
│   │   └── security/
│   └── migrations/
├── tests/                      # unit/integration/e2e
└── docs/                       # product design, privacy notice, API mapping
```

## 13. Fase implementasi
**Fase 1 — MVP UI & Vision:** scaffold Tauri, app layout, transparent panel, opacity slider, provider switcher, secure key vault, single-shot screenshot import, catatan.txt import, shared JSON schema, GPT/Gemini adapters, output answer, token counter, tests.  
**Fase 2 — Knowledge & Session Intelligence:** PDF/DOCX extraction, local retrieval, profiles/jobs, robust interview/RGD detection, RGD simulator, bounded Smart Context Memory, FTS5 retrieval, checkpoint summaries, participant map, answer timing calibration, history controls, session stage state machine, cost monitor.  
**Fase 3 — Audio:** opt-in mic/loopback, streaming STT, VAD/turn completion, interruption control, transcript review, budget alerts.  
**Fase 4 — Stabilization:** reliability, secure build, installers, privacy audit, accessibility, provider fallbacks, Windows compatibility.

## 14. Acceptance criteria
- Aplikasi dapat beralih Gemini↔GPT tanpa kehilangan ringkasan sesi.
- Slider opacity 30–85% memperlihatkan video di bawah jendela tanpa mengurangi opacity teks.
- Menutup aplikasi tidak membuat file screenshot tersisa secara default.
- Berkas `catatan.txt` dapat diimpor, dipreview, dikoreksi, dan dihapus.
- Prompt durasi disimpan sekali per sesi/profil; screenshot berikutnya mengikuti aturan.
- Ctrl+V ketika clipboard berisi gambar membuat attachment thumbnail tanpa membuka dialog file. Paste teks biasa tetap normal.
- Pendeteksi otomatis menghasilkan Interview/RGD/Unknown dari analisis multimodal; tidak memaksa pilihan manual per screenshot. Prototipe offline hanya boleh mengklaim deteksi teks heuristik.
- Error API (401, 403, 429, timeout, malformed JSON) ditangani jelas tanpa jawaban palsu.
- Memory RGD tidak mengatribusikan ucapan jika speaker tidak pasti.
- Privasi dan izin mic tampil jelas; indikator recording dapat dilihat dan dihentikan.
- Tidak ada API key dalam JS bundle/log atau file config terbuka.
- Jawaban direview melalui validator lokal dan memiliki tombol regenerate/shorten.

## 15. Dokumentasi teknis resmi
- https://v2.tauri.app/reference/config/
- https://v2.tauri.app/learn/window-customization/
- https://v2.tauri.app/plugin/stronghold/
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/your-data
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://ai.google.dev/gemini-api/docs/pricing


## 15. Pembaruan v1.3 — Session Lifecycle
Pisahkan pengenalan jenis sesi `Interview/RGD/Unknown` dari tahap `Standby/Briefing/Case Analysis/Discussion/End`. AURA sebaiknya dibuka lebih awal namun tetap Standby tanpa audio/API. Deteksi otomatis boleh mengusulkan transisi, tetapi pengaktifan capture/pengiriman data memerlukan izin eksplisit. Moderator boleh menjelaskan aturan sebelum diskusi dimulai. Lihat `SESSION_LIFECYCLE.md`.

## 16. Pembaruan v1.3 — Smart Memory
Riwayat lama dikelola lokal, tidak dikirim mentah berulang. Gunakan pinned verified facts, ringkasan checkpoint, recent turns dan retrieval dari FTS5. `KETIK_45` dapat ditetapkan sekali dalam UI, tetapi instruksi yang dipakai pada setiap request tetap dihitung sebagai token jika dikirim. Token dan biaya diukur dengan laporan API bila tersedia. Lihat `SMART_MEMORY_AND_COST.md`.

## 17. Kriteria penerimaan tambahan
- [ ] Di Standby, API=OFF, mic=OFF, capture=OFF secara default.
- [ ] Klasifikasi RGD/Interview tidak otomatis memicu tahap Discussion.
- [ ] Moderator yang sedang membacakan aturan tidak dianggap memulai diskusi.
- [ ] Giliran ke-31 mampu mengambil posisi relevan dari giliran ke-3 tanpa mengirim semua 30 giliran.
- [ ] Perpindahan GPT↔Gemini menggunakan ringkasan lokal yang sama.
- [ ] Usage monitor melaporkan token input, output, cache serta perkiraan biaya image/audio/search/summary/retry, bukan menyamarkan angka demo sebagai biaya nyata.
- [ ] Anggaran per sesi dan ambang peringatan dapat dikonfigurasi.
- [ ] Prototipe HTML tetap jujur: hanya contoh antarmuka, tidak membuat API call atau rekaman.
