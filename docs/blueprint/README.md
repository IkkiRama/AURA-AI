# AURA Blueprint Package — v1.3

Ini **bukan** installer atau aplikasi AI yang telah terhubung ke API. Paket ini berisi:

- `BLUEPRINT.md` — spesifikasi produk, desain, arsitektur, schema database, keamanan, roadmap, acceptance criteria.
- `AURA_UI_Prototype.html` — prototipe UI mandiri; buka dengan Chrome/Edge. Slider opacity, model switcher, simulasi meeting, kolom prompt dan **Ctrl+V screenshot ke thumbnail**, indikator dugaan Interview/RGD berbasis teks, output demo, dan file import berfungsi di browser. **Tidak mengirim data ke internet**.
- `answer.schema.json` — kontrak output terstruktur yang sama untuk GPT/Gemini.
- `PROMPT_DEFAULT.md` — instruksi awal yang hanya perlu ditetapkan sekali per sesi/profil.
- `CODEX_IMPLEMENTATION_PROMPT.md` — brief implementasi untuk coding agent.

Jangan masukkan API key asli ke prototipe HTML. Untuk terhubung ke provider, implementasikan aplikasi Tauri menurut blueprint.

## Perubahan v1.1

- Buka `AURA_UI_Prototype.html` dengan Chrome atau Edge. Fokus di kolom **Prompt & screenshot**, ambil screenshot lewat Win+Shift+S, kemudian Ctrl+V. Gambar tampil sebagai thumbnail, bisa dihapus. Drag/drop atau tombol Screenshot tersedia sebagai alternatif. Paste teks biasa tetap bekerja.
- Deteksi sesi tidak dipilih manual: **Session Intelligence** mengestimasi Interview/RGD/Belum Pasti. **Prototipe offline hanya melihat teks prompt, bukan isi screenshot**; untuk klasifikasi visual perlu sambungan GPT atau Gemini.
- Batas waktu jawaban diubah lewat Prompt Studio sekali per sesi, bukan setiap upload gambar.
- File gambar di prototipe tidak diunggah ke mana pun. File asli berada di memori sementara browser; hanya thumbnail ditampilkan. Tutup/reload halaman untuk membuangnya.

## Perubahan v1.2

- Ditambahkan **prompt mini mengambang** di area simulasi meeting, di samping **panel jawaban mengambang**. Seret header masing-masing untuk memindah posisi secara independen; tombol **Reset posisi** mengembalikan keduanya. Ukuran panel bisa diubah menggunakan pegangan resize browser jika tersedia.
- Kolom prompt mini terhubung dua arah dengan kolom prompt besar; tombol `+ Screenshot` pada prompt mini membuka file picker yang sama, `Ctrl+V` gambar tetap berfungsi, dan status lampiran diperlihatkan.
- Posisi drag di prototipe disimpan dalam `localStorage` bila browser mengizinkan. Keduanya hanya dapat digeser di dalam *simulasi meeting HTML*, **belum bisa mengambang di atas Zoom sungguhan**. Itu harus dibuat sebagai dua jendela Tauri terpisah.
- Aplikasi final direncanakan tidak autostart; proses hanya hidup ketika aplikasi berjalan. Mode tray opsional, indikator capture aktif dan kontrol pause/stop. Tidak ada mode menghindari proctoring atau menghilangkan proses dari pengawasan sistem.


## Pembaruan v1.3
- `SMART_MEMORY_AND_COST.md`: memori 30+ giliran, retrieval lokal, penyimpanan klaim/posisi, mode Economy/Balanced/Deep, anggaran pemakaian.
- `SESSION_LIFECYCLE.md`: Standby → Briefing → Case Analysis → Discussion → End, terpisah dari deteksi Interview/RGD; tidak mengaktifkan audio/API tanpa izin.
- HTML prototype menambahkan simulasi fase dan estimasi biaya, **bukan** fitur audio, AI, atau billing nyata.
- Default prompt hanya diatur sekali dari sisi UX; saat request API model masih dapat menghitung token instruksi yang disertakan.
- Paket ini **belum aplikasi desktop `.exe` dan belum ada koneksi GPT/Gemini yang aktif**. Untuk kode produksi ikuti instruksi pada `CODEX_IMPLEMENTATION_PROMPT.md`.

Lihat `FEATURE_STATUS.md` untuk pemisahan **sudah ada di HTML demo** vs **baru direncanakan untuk aplikasi `.exe`**.
