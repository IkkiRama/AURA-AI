# AURA UI v1.1 — revisi atas masukan pengguna

## Perubahan nyata di prototipe HTML

- Kotak **Prompt & screenshot** ditambahkan tepat di bawah preview video.
- **Ctrl+V / Cmd+V** dengan clipboard gambar memunculkan thumbnail, nama file, ukuran, dan tombol hapus; paste teks biasa tetap bekerja.
- Mendukung tombol tambah screenshot, file picker PNG/JPG/WebP, serta drag-and-drop (batas 10 MB).
- Menu **RGD Studio** diganti menjadi **Session Intelligence**; tidak perlu memilih Interview/RGD setiap gambar.
- Indikator status **Indikasi Interview / Indikasi RGD / Belum pasti** muncul otomatis dari teks prompt.
- Ketentuan durasi tetap berada di Prompt Studio, sekali per sesi. Mengirim gambar tidak meminta pilihan durasi.
- Preview tetap memiliki pilihan GPT atau Gemini dan slider opacity panel.

## Batas prototipe yang harus dipahami

Prototipe ini bekerja offline. Isi screenshot **belum** dibaca oleh model; deteksi sesi pada HTML hanyalah heuristik berbasis teks prompt, bukan vision/classifier produksi. Tombol Kirim (demo) memberikan konfirmasi UI saja, bukan jawaban AI. Untuk fungsi sebenarnya, tambahkan adapter GPT/Gemini dan gunakan schema activity_type pada `answer.schema.json`.

## Pengujian yang dilakukan

Di Chromium headless dengan Playwright:
- Load HTML tanpa error JavaScript
- Prompt RGD → Indikasi RGD
- Prompt interview → Indikasi Interview
- Paste synthetic ClipboardEvent berisi PNG → attachment muncul
- Gambar tanpa petunjuk teks → Belum pasti
- Hapus attachment → thumbnail hilang
- Tombol kirim demo → status jujur bahwa API belum tersambung
- Provider Gemini → GPT dan perubahan opacity berfungsi
- Import contoh screenshot pengguna via file input dan screenshot halaman versi terbaru
