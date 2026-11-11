# AURA v1.3 — Session Lifecycle

`activity_type` (Interview / RGD / Unknown) **tidak sama** dengan `session_stage` (tahapan berlangsungnya sesi). Keduanya harus disimpan dan ditampilkan terpisah.

## State machine
```
STANDBY --> BRIEFING --> CASE_ANALYSIS --> DISCUSSION --> END
    \--------------------------> DISCUSSION --> END
```
Transisi juga boleh dikoreksi manual, misalnya moderator kembali menjelaskan aturan. Pada interview tanpa studi kasus, `case_analysis` dapat dilewati.

| Tahap | Apa yang boleh dilakukan | Apa yang tidak boleh otomatis dilakukan |
|---|---|---|
| Standby | buka AURA, memilih profil dan model, menyiapkan prompt | panggilan API, capture audio/screen |
| Briefing | mencatat aturan; transkripsi **opsional apabila diizinkan dan diaktifkan** | mendengarkan diam-diam atau mengasumsikan diskusi dimulai |
| Case Analysis | screenshot manual via Ctrl+V jika diizinkan, analisis soal | auto screenshot / auto upload tanpa izin |
| Discussion | mengolah transkrip yang diizinkan, memperbarui posisi dan ringkasan | mengarang ucapan peserta atau memaksakan kesimpulan |
| End | Stop capture, cancel streaming, tampilkan penggunaan biaya | proses monitor diam-diam setelah sesi berakhir |

## Deteksi otomatis yang aman
- Klasifikasi `activity_type` dapat memanfaatkan screenshot, prompt, serta transkrip yang **memang sudah disediakan dengan izin**. Saat ambigu kembalikan `unknown`.
- `session_stage` dapat *disarankan* dari teks: "Sebelum memulai, saya menjelaskan aturan" = briefing; "Diskusi dimulai sekarang" = kemungkinan discussion. Jika itu hanya kutipan contoh aturan, tetap briefing.
- Aktivasi mikrofon, audio sistem, screenshot berkala, atau upload cloud memerlukan tindakan/izin eksplisit; aplikasi tidak dapat mengenali ucapan moderator saat audio belum diaktifkan.
- Tampilkan kontrol manual `Start Notes`, `Start Discussion`, `Pause`, `End Session`, dan indikator jujur bila ada audio yang sedang diproses.
- Default Autostart OFF, microphone OFF, system-audio OFF, background sessions OFF. Tray mode bukan berarti proses berhenti.

## Rekomendasi urutan pengguna
1. Buka aplikasi sebelum masuk Zoom → tetap Standby (tidak ada biaya API).
2. Moderator menjelaskan aturan → Briefing; catatan tanpa AI atau transkripsi yang diizinkan.
3. Soal ditampilkan → Case Analysis, kirim screenshot ke prompt jika aturan memperbolehkan.
4. Moderator resmi membuka sesi → Discussion, konfirmasi bila akan mengaktifkan layanan AI/audio.
5. Waktu habis → End; segera berhenti merekam/pemrosesan.

## Uji penerimaan
- 20 menit standby menghasilkan 0 panggilan API dan 0 aktivitas mikrofon.
- Perubahan tahap dalam prototipe HTML hanya UI demo, tidak memulai recording.
- Moderator yang mengutip contoh kalimat "diskusi dimulai" tidak salah memicu tahap Discussion.
- Status Interview/RGD/Unknown tidak otomatis mengganti fase Standby/Briefing.
- Tombol End menghentikan capture/stream dan cancel request.
- Tidak ada mekanisme penyembunyian proses atau pengelabuan proctoring.
