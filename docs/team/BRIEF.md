# Brief Tim DompetKu v2

Kamu anggota tim produk DompetKu v2: aplikasi keuangan pribadi berbahasa Indonesia (IDR, zona Asia/Jakarta) untuk **dua orang**
(pemilik Novanda dan pasangannya Farida) yang dipakai setiap hari. Ruang **Pribadi** per orang + satu ruang **Bersama**.
Self-hosted di 2 VM Oracle Cloud milik pemilik (app + Postgres di VM DB; reverse proxy TLS di VM App), domain publik `dompet.novandafadly.com`.
Stack terpilih: Next.js App Router + TypeScript strict, Postgres 17 polos (tanpa Supabase), Kysely, Better Auth (passkey + TOTP), pg-boss worker,
logika uang sebagai fungsi Postgres atomik di atas jurnal `entries`/`entry_lines`, RLS berbasis `app.user_id`, Tailwind + Radix.
Mulai dari nol: **tidak ada migrasi data v1**. Kerja per irisan vertikal (DB + tes dulu, lalu UI) per milestone M0–M8.
Standar: "enterprise grade" karena ini uang — benar, aman, teruji, teramati — dan UI yang rapi tanpa kesan "AI slop", layak di-screenshot untuk portofolio.

Bacaan wajib (urut):
1. `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` — desain berlaku (revisi 2, menggantikan revisi 1 bila bertentangan).
2. `docs/v2/DESIGN.md` (detail jurnal, fungsi, skema), `docs/v2/UX.md`, `docs/v2/ROADMAP.md`.
3. `docs/audit/SUMMARY.md` dan file audit lain bila relevan untuk peranmu (bug v1 yang tidak boleh terulang).

Aturan:
- Jangan mengubah file selain file output milikmu. Jangan menjalankan perintah yang menulis ke luar repo, jangan menghubungi layanan eksternal.
- Bahasa output: Indonesia, ringkas, spesifik, dengan alasan. Rujuk bagian dokumen (`file §x`).
- Bedakan **wajib** (tanpa ini produk gagal/berisiko) vs **sebaiknya** vs **nanti**.
- Kalau kamu tidak setuju dengan desain, katakan jelas dan usulkan alternatif + trade-off.

Format file output (`docs/team/round1/<peran>.md`):
1. Ringkasan sikap (3–5 kalimat).
2. Rekomendasi (maks 12), masing-masing: prioritas (wajib/sebaiknya/nanti), milestone, isi, alasan.
3. Risiko utama di area-mu + mitigasi.
4. Ketidaksetujuan dengan desain saat ini (jika ada).
5. Kriteria penerimaan yang kamu tuntut untuk areamu (bisa dicek/dites).
6. Pertanyaan/permintaan untuk peran lain (sebut perannya).
