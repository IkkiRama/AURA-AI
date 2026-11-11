# AURA v1.3 — Smart Context Memory & Cost Controller

Dokumen ini adalah rancangan fitur aplikasi final, **bukan fungsi yang sudah aktif pada prototipe HTML**.

## Prinsip
- Riwayat lengkap (jika pengguna mengizinkan penyimpanan) berada di SQLite lokal. **Jangan kirim ulang 30 pertanyaan sebelumnya pada setiap permintaan.**
- Untuk pertanyaan terbaru, kirim hanya instruksi yang relevan, fakta penting, ringkasan bertahap, 2–3 giliran terakhir, serta bagian riwayat lama yang relevan.
- Screenshot diubah menjadi informasi teks satu kali lalu hasil analisisnya disimpan sementara sesuai izin; PNG tidak diulang sebagai attachment setiap giliran.
- Instruksi target `KETIK_45` atau `LISAN_45` diatur sekali melalui Prompt Studio, dan tetap digunakan pada permintaan berikutnya. **Pengaturan sekali di UI tidak berarti token prompt dibayar sekali.**
- Saat mengganti Gemini ↔ GPT, rakit kembali konteks dari penyimpanan lokal, bukan mengandalkan ID percakapan spesifik provider.

## Empat lapisan memori
| Lapisan | Konten | Cara pakai |
|---|---|---|
| Profil stabil | CV, pengalaman, keterampilan, deskripsi lowongan | SQLite FTS5 memilih potongan relevan |
| Fakta terkunci | Peran pengguna, aturan, posisi, keputusan penting | Ringkasan singkat selalu dikirim bila relevan |
| Ringkasan bergulir | Perkembangan diskusi, argumen, kesimpulan sementara | Checkpoint per ±6 giliran, bukan setiap giliran |
| Recent + retrieval | 2–3 giliran terbaru, argumen lama yang relevan | Search FTS5 berdasarkan topik pertanyaan |

**Audit provenance**: setiap klaim penting memiliki `source_turn_id`, timestamp dan `speaker_id` bila pasti. Suara yang tidak dapat diatribusikan ditandai `unknown`. Jika pengguna mengubah sikap, posisi lama disimpan sebagai `superseded`, bukan dianggap masih berlaku.

## Request pipeline
1. Terima permintaan terbaru dan data yang telah diizinkan.
2. Ambil *pinned facts* + ringkasan + giliran terbaru + retrieval riwayat/dokumen.
3. Susun `context packet` dan hitung perkiraan token menggunakan metode sesuai model.
4. Bila terlalu besar, kurangi potongan lama yang paling tidak relevan; jangan membuang pertanyaan terbaru atau fakta kritis.
5. Hitung perkiraan biaya *input + output reservation + image/audio/tools*; jika melewati batas, jangan kirim permintaan.
6. Panggil GPT/Gemini, validasi JSON schema dan klaimnya.
7. Catat `usage` asli yang tersedia pada respons API; rekonsiliasi dengan perkiraan dan tampilkan selisih.
8. Simpan hasil lokal hanya sesuai preferensi pengguna; refresh summary pada checkpoint.

## Budget token contoh (dapat disetel)
```
text_context_target = 2500  # token input teks, bukan seluruh input multimodal
text_soft_limit = 3200
text_hard_limit = 4000
reserved_output = 250
allocation_example:
  base_instructions 400
  pinned_facts 250
  rolling_summary 450
  latest_input 550
  recent_turns 450
  relevant_history 250
  safety_margin 150
```
Jangan menganggap satu screenshot bernilai tetap 1.500 token; biaya gambar, cache, dan alasan/penalaran internal dapat bervariasi antar model.

## Biaya dan batas pemakaian
- Pengaturan awal: `Balanced`, anggaran sesi Rp10.000, peringatan 80%, *preflight hard stop* saat perkiraan biaya berikutnya melebihi sisa limit.
- Tampilkan jumlah API calls, input/output/cached tokens, biaya image, STT, web search, summary-refresh, retries, model dan kurs yang digunakan.
- *Preflight hard stop* adalah perkiraan sisi aplikasi, **bukan jaminan tagihan provider tidak pernah melampaui limit** akibat penggunaan paralel dan rekonsiliasi yang tertunda.
- Biaya total sesi tetap meningkat berdasarkan jumlah request, meskipun biaya teks setiap request lebih stabil daripada mengirim full history.
- Free tier memiliki batas request, token, model atau fitur berdasarkan kondisi akun; jangan anggap unlimited.
- Cache vendor adalah optimasi tambahan, bukan sumber memori utama.

## Tabel database baru (konseptual)
```
turns(id, session_id, occurred_at, speaker_id, role, text, source_type)
claims(id, turn_id, speaker_id, claim, stance, certainty, superseded_by)
position_memory(id, session_id, claim_id, source_turn_id, created_at)
summary_checkpoints(id, session_id, from_turn_id, to_turn_id, summary)
retrieval_audit(id, request_id, source_turn_id, reason)
api_usage(id, session_id, provider, model, request_kind, input_tokens,
          output_tokens, cached_tokens, image_cost, stt_cost, tool_cost,
          estimated_cost_usd, provider_cost_usd, created_at)
budget_policy(session_id, strategy, limit_idr, warning_pct, strict_stop, fx_usd_idr)
```

## Pengujian wajib
- Pada pertanyaan ke-31, AURA dapat menemukan argumen penting di pertanyaan ke-3 tanpa mengirim seluruh 30 pertanyaan.
- Posisi yang telah diperbarui mengalahkan posisi yang sudah diganti.
- Speaker tak diketahui tidak diubah menjadi peserta tertentu.
- Perpindahan GPT→Gemini tidak kehilangan memori, tidak memakai previous-response-ID lintas provider.
- Budget controller memblokir request yang diperkirakan melewati limit dan menyampaikan alasan secara eksplisit.
- Penghitungan biaya meliputi summarization, screenshot, transkripsi, search, retries, dan output; ukuran token diperoleh dari respons vendor bila tersedia.
