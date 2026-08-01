# Project Remediation TODO

Durumlar doğrulama komutları tamamlandıkça `[x]` yapılacaktır. Codex baş mühendis; Claude Code yardımcı mühendistir.

- [x] SEC-01 — Release artık debug keystore kullanmıyor; credential yoksa release görevi fail-fast ediyor.
- [x] BUG-01 — Backup içeriği strict doğrulanıyor; restore I/O hatasında iki storage anahtarı rollback ediliyor.
- [x] DEP-01 — Uyumlu lockfile güncellemeleri ve transitif override'larla `npm audit` 0 bulguya indi.
- [x] SEC-02 — Native manifest ve config plugin Android Auto Backup'ı kapatıyor.
- [x] BUG-02 — App state persistence tek mutation queue üzerinden seri çalışıyor; backup da kuyruğu bekliyor.
- [x] BUG-03 — Takip hatırlatmaları tüm cache ufkuna kuruluyor ve incomplete değişiminde yeniden planlanıyor.
- [x] TEST-01 — `npm run check`, 58 assertion ve GitHub Actions quality gate eklendi.
- [x] TODO-01 — Full-screen alarm plugin'i kayıtlı; native modül, manifest izni ve deterministic postinstall patch mevcut.
- [x] ARCH-01 — Persistence ve tracking schedule policy root'tan bağımsız, test edilebilir modüllere ayrıldı.
- [x] BUG-04 — Kalan süre hesabı saniye hassasiyetinde düzeltildi ve 4 assertion ile korundu.
- [x] BUG-05 — Tracking ekranı gece yarısında günü ve seçili bugünü güncelliyor.
- [x] SEC-03 — Production error ekranı ham mesaj/stack göstermiyor.
- [x] QUAL-01 — Boş catch/callback'ler kaldırıldı; storage write hataları tekrar fırlatılıyor.
- [x] PERF-01 — Root clock yalnızca onboarding bitmiş ana ekranda çalışıyor.
- [x] QUAL-02 — APK Git index'inden çıkarıldı, yerel kopya korundu ve `*.apk` ignore aktif.
- [x] CFG-01 — `app.json` App ve Gradle için sürüm kaynağı; package eşleşmesi CI'da kontrol ediliyor.

## Mühendislik raporları

- Claude Code: `CLAUDE_CODE_WORK_REPORT.md`
- Codex: `CODEX_WORK_REPORT.md`
