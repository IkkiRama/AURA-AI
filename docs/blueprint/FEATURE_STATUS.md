# AURA v1.3 — Checklist fitur dan status pengerjaan

**Tujuan dokumen:** membedakan kesepakatan desain dari aplikasi yang benar-benar sudah dibangun.

| Kebutuhan pengguna | Spesifikasi v1.3 | HTML demo | Windows desktop production |
|---|---|---|---|
| Prompt sekali, berlaku ke screenshot selanjutnya | Ya | Simulasi UI | Belum dibangun |
| Paste screenshot dari Ctrl+V, thumbnail dan hapus | Ya | Ya, dalam browser | Belum dibangun |
| Dua panel (prompt + jawaban) bisa dipindah terpisah | Ya | Ya, hanya di area demo | Belum dibangun |
| Transparent 45% default; dapat diubah | Ya | Ya, pada latar panel demo | Belum dibangun |
| Digunakan berdampingan Zoom | Ya | Simulasi video conference | Belum diuji |
| Pilih GPT atau Gemini, ganti model | Ya, hanya 2 provider | Dropdown UI saja | API belum diintegrasikan |
| JSON structured output dan jawaban siap dibaca | Ya | Teks contoh | API belum diintegrasikan |
| Deteksi interview/RGD otomatis dari gambar/audio | Ya, termasuk unknown | Heuristik dari teks prompt saja | Belum dibangun |
| Tahapan Standby/Briefing/Case/Discussion/End | Ya | Tombol status simulasi | Deteksi tahap otomatis belum dibangun |
| Pemrosesan audio dengan izin dan indikator | Ya | Tidak ada capture | Belum dibangun |
| Smart Context Memory untuk 30+ pertanyaan | Ya, desain FTS5 + pinned + summary | Keterangan UI | Belum dibangun |
| Pengaturan budget & token per sesi | Ya, mode Economy/Balanced/Deep | Kalkulator ilustratif | Meter penggunaan aktual belum dibangun |
| Mengimpor catatan.txt | Ya | File text dibaca lokal | Indexing dan retrieval belum dibangun |
| Privasi local-first dan API keys aman | Ya | Tidak ada key / data cloud | Secure vault belum dibangun |
| Sistem tray dan pengaturan background | Ya, default OFF | Tidak ada tray | Belum dibangun |

## Kesimpulan
ZIP ini **blueprint komprehensif + prototipe UI offline**, bukan aplikasi AI yang sudah tersambung GPT/Gemini dan bukan file `.exe`. `CODEX_IMPLEMENTATION_PROMPT.md` adalah brief untuk membangun aplikasi desktop nyata. Jangan melaporkan fitur yang masih rencana sebagai sudah selesai diuji di production.
