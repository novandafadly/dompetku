# Log Keputusan (ADR) — DompetKu v2

Format: `ADR-NNN — Judul` · Tanggal · Status (usulan/diterima/diganti) · Konteks · Keputusan · Konsekuensi.

## ADR-001 — Dokumen audit dan rancangan disimpan di repo v1, di branch kerja
- 2026-10-29 · diterima
- **Konteks:** sesi kerja hanya punya akses ke repo `novandafadly/dompetku`; repo v2 belum ada.
- **Keputusan:** `docs/audit/` dan `docs/v2/` ditulis di branch `claude/dompetku-audit-v2-redesign-2f7qmf` repo v1. Tidak ada kode v1 yang diubah.
- **Konsekuensi:** saat repo v2 dibuat (M0), `docs/v2/` dipindahkan ke sana dan file ini berlanjut di repo v2.

## ADR-002 — Restore project Supabase v1 untuk ekstraksi read-only
- 2026-10-29 · diterima (izin pemilik produk di sesi)
- **Konteks:** project `yvapmbjtuhqvsunkmkxw` berstatus paused sehingga skema tidak bisa dibaca.
- **Keputusan:** project dipulihkan; hanya `SELECT` dan metadata yang dijalankan.
- **Konsekuensi:** project v1 kini aktif (dihitung dalam kuota project aktif free tier). Cron job gagal v1 kembali berjalan tiap jam dan gagal (tidak diubah karena v1 read-only).
