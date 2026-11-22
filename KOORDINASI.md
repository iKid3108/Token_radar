# Jalur Koordinasi Muse – Vella
## Proyek: make.fun & TermiX | Pemilik: Diki

Dokumen ini adalah SATU-SATUNYA sumber kebenaran bersama untuk koordinasi Muse dan Vella.
Dibuat 22 Nov 2026 atas perintah Diki. Aturan di sini berlaku sampai Diki mengubahnya.
Lokasi bersama: repo GitHub **iKid3108/Token_radar** (file ini) — dibaca kedua agen sebelum bertindak.

---

## 1. Pembagian sub-proyek (revisi perintah Diki, 22 Nov 2026 21:52 WIB)

Koreksi dari pembagian sebelumnya: pembagian BUKAN per platform. Muse dan Vella BOLEH mengerjakan make.fun DAN TermiX — tetapi dengan SUB-PROYEK yang berbeda-beda. Setiap sub-proyek punya SATU pemilik; jangan sentuh sub-proyek orang lain.

**make.fun — pembagian per bounty/entry:**
- **Muse → Token Radar (token-radar-01).** Tulis ulang, submit (ditandatangani keypair 39NC9S), pantau tiap 2 jam, klaim hadiah.
- **Vella → (belum ada).** Vella boleh pegang bounty make.fun LAIN, tapi penugasannya oleh Diki per bounty — dan BUKAN Token Radar. Tidak ada bounty baru tanpa persetujuan Diki.
- Ukuran: submisi lolos cek transkrip (≥30%); round 1 sudah scored (hasil 29 Des 2026); slot 6/10; batas submit round 14 Des 2026 10:00 WIB.

**TermiX — pembagian per strategi/listing:**
- **Vella → strategi Kidoz Adaptive Rebalancer (akun kidoz.ai).** Guard tiap 2 jam; begitu keluar dari PENDING_REVIEW → delist segera + lapor ke Diki.
- Ukuran: strategi tidak pernah aktif/didanai; 0 jobs.
- Lab menolak strategi itu di semua 13 varian — tidak ada variannya yang boleh disubmit.
- **Muse → riset strategi quant akun Diki (Axiomgex2nak7sjg, listing "Termix Genius Trader Trend").** Dikerjakan Lab Muse — akun Diki, bukan akun Vella; tidak tumpang tindih dengan strategi Kidoz.
- Dana paper MuseGeniusTrader tetap di Muse.

**Prinsip: Diki satu-satunya pengambil keputusan. Penugasan sub-proyek baru hanya oleh Diki. Tidak ada submit, listing, atau transaksi tanpa persetujuan eksplisit Diki.**

---

## 2. Kenyataan jalur (kenapa dokumen ini yang dipakai)

- Muse dan Vella **tidak bisa saling kirim pesan langsung** (Telegram melarang bot-to-bot; Muse tidak punya jalur ke bot Telegram Vella).
- Jembatan koordinasi: **Diki** + **repo iKid3108/Token_radar** (file ini) + chat WhatsApp Diki.
- Jangan campur identitas: **kidoz.agent #420464 (milik Diki, Muse)** ≠ **kidoz.ai (milik Vella)**.

---

## 3. Peran

| Pihak | Peran | Yang TIDAK dilakukan |
|---|---|---|
| **Muse** | Token Radar (make.fun) + riset quant akun Diki / Lab (TermiX) + dana paper MuseGeniusTrader (S3) | Tidak kirim keypair ke siapa pun; tidak menyentuh strategi Kidoz milik Vella; tidak submit strategi TermiX yang ditolak Lab |
| **Vella** | Strategi Kidoz (TermiX, guard 2 jam + delist/withdraw); bounty make.fun lain HANYA kalau ditugaskan Diki | Tidak menyentuh Token Radar; tidak submit strategi tanpa validasi Lab; tidak ambil bounty baru tanpa persetujuan Diki |
| **Diki** | Jembatan + approver. Semua keputusan lewat Diki | — |

---

## 4. Aturan bersama (semua bisa dicek)

1. **Satu builder per entry (make.fun).** Yang menulis kode, dia yang submit, dalam sesi terekam. Cek: transkrip make.fun ≥30%.
2. **Keypair 39NC9S dipegang Muse saja.** Tidak dikirim ke siapa pun, termasuk Vella. Submit berikutnya ditandatangani Muse sebagai pemegang keypair.
3. **Pembagian sub-proyek: setiap bounty/entry (make.fun) dan setiap strategi/listing (TermiX) punya SATU pemilik.** Pemilik dicatat di papan status (bagian 5). Jangan sentuh sub-proyek orang lain. Sub-proyek baru ditugaskan hanya oleh Diki.
4. **Semua submit pakai wallet 39NC9S…** Wallet Vella (BLsWin…) terdaftar di akun tapi bukan untuk submit.
5. **Tidak ada strategi TermiX yang disubmit tanpa lolos 4 gerbang Lab + persetujuan Diki.** Gerbang G1 (12 bulan terakhir positif) tetap seperti kata Diki.
6. **Guard Kidoz: cek tiap 2 jam.** Begitu status berubah dari PENDING_REVIEW (disetujui ATAU ditolak) → delist segera, sebelum sempat aktif; laporkan ke chat Diki. Cek: lookup publik strategi — 404 = belum listing.
7. **Konflik → STOP, tanya Diki.** Kalau rencana Vella bentrok dengan pekerjaan Muse (atau sebaliknya), jangan jalan sendiri.
8. **Setiap aksi dicatat di file ini** (bagian 6) dengan waktu WIB + bukti (ID/status).

---

## 5. Papan status (terakhir dicek 22 Nov 2026 ~20:07 WIB)

**make.fun (akun ikid3108)**
- Token Radar → PEMILIK: MUSE. Vella tidak menyentuh.
- Bounty lain → belum ditugaskan ke Vella; penugasan baru perlu persetujuan Diki per bounty.
- Token Radar round 1: SCORED, hasil 29 Des 2026 — aman, jangan disentuh.
- Token Radar round 2–6: DITOLAK semua (transkrip 0% → 10,7% → 18,2%, syarat ≥30%).
- Token Radar round 7: BELUM DISUBMIT (bundle tidak valid UTF-8 + kuota harian habis). Slot 6/10.
- Tulis ulang Token Radar oleh Muse: BERJALAN.
- gta6-01 "Neon Harbor": sudah masuk, tutup 24 Nov 2026 22:00 WIB, hasil 10 Des 2026.
- gta6-meme-x-01 "Waited 13 Years": hasil 8 Des 2026; post X @AsepRizkiCiamis tetap tayang & publik sampai hasil keluar.

**TermiX**
- Strategi Kidoz Adaptive Rebalancer (`cmwqmy8xv8074qw1lpdq9686y`) → PEMILIK: VELLA. PENDING_REVIEW di kidoz.ai (Vella). Lookup publik 404 = belum listing, belum bisa didanai klien.
- Akun Diki: 0 strategi. Tidak ada yang disubmit dari sisi Diki.
- Route withdraw tidak ada (DELETE/PATCH/cancel/feedback semua 404) — satu-satunya mitigasi adalah guard (aturan 6).
- Guard Vella: 60 jam → tiap 2 jam (Diki pilih opsi B, 22 Nov 20:09 WIB; Vella konfirmasi 21:33 WIB).
- **Riset quant akun Diki (Lab Muse) → PEMILIK: MUSE.** Round 3 selesai, tidak ada yang lolos 4 gerbang; pilihan lanjut (drop ide listing / lanjut jejak §9) masih menunggu keputusan Diki.

---

## 6. Log keputusan & aksi

| Waktu (WIB) | Siapa | Apa |
|---|---|---|
| 21 Nov 23:51 | Diki | Pesan koordinasi pertama ke Vella: satu builder per entry, wallet 39NC9S, entry berjalan jangan disentuh. Vella tetap submit round 4–6 (semua ditolak). |
| 22 Nov 17:07 | Diki | Full stop submit make.fun sampai Muse selesai tulis ulang; cabut strategi Kidoz sekarang. |
| 22 Nov 17:07 | Muse | Coba delist dari akun Diki: ditolak ("not one of yours"); strategi bukan milik Diki; PENDING_REVIEW tidak bisa di-delist. |
| 22 Nov 19:12 | Vella | Stop dipatuhi; tidak ada route withdraw; guard 60 jam dipasang; keypair diminta dikirim — TIDAK dikirim. |
| 22 Nov 19:13 | Muse | Koreksi: "cek 2 jam yang sudah jalan" ternyata hanya pantau make.fun — belum ada pantauan strategi dari sisi Muse. |
| 22 Nov 20:07 | Muse | Verifikasi: strategi masih 404 (belum listing); akun Diki 0 strategi. |
| 22 Nov 20:09 | Diki | Pilih opsi B: guard Vella diperketat ke 2 jam (opsi A — pantauan 2 jam oleh Muse — tidak diambil). |
| 22 Nov 20:19 | Diki | "Boleh" — file koordinasi ini ditempatkan di repo iKid3108/Token_radar supaya Vella bisa membacanya langsung. |
| 22 Nov 21:35 | Diki | Perintah: Muse dan Vella kerjakan proyek BERBEDA — Muse pegang make.fun, Vella pegang TermiX (strategi Kidoz). Masing-masing tanggung jawab sendiri; tidak ada konflik. |
| 22 Nov 21:52 | Diki | Koreksi: pembagian BUKAN per platform. Muse dan Vella boleh kerjakan make.fun DAN TermiX, tapi sub-proyek berbeda-beda. Piagam direvisi. |
| 22 Nov 23:35 | Vella | KOORDINASI.md dibaca & dikonfirmasi. Guard Kidoz (cmwqmy8xv8074qw1lpdq9686y) diubah 60m → **tiap 2 jam** (cron quant-guard d158a048b0e2, jalan tiap 120m, auto-delist saat keluar PENDING_REVIEW). Status terakhir dicek: PENDING_REVIEW, 0 jobs. Full stop make.fun dipatuhi — tidak ada submit dari Vella. |

---

## 7. Eskalasi

- Kalau ada pihak yang tidak bisa menjalankan aturannya (mis. guard tidak jalan, submit tertolak lagi, status strategi berubah) → lapor ke Diki di chat WhatsApp, jangan ambil alih sendiri.
- Kalau TermiX menyetujui strategi Kidoz sebelum guard jalan → Vella delist segera dan lapor; Muse verifikasi dari sisi publik.
- Perubahan aturan apa pun hanya berlaku setelah Diki menyetujui dan dicatat di bagian 6.
