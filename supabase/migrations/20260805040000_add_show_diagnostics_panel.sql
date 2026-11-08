-- show_diagnostics_panel — Ayarlar'daki teknik teşhis panelinin görünürlüğü.
--
-- NEDEN: Panel, "env ✓ / url ✓ / son deneme: 201" gibi teknik satırlar ve bir
-- "şimdi dene" düğmesi gösteriyor. Sıradan kullanıcı için anlamsız, hatta
-- endişe verici. Buna karşılık sahada bir cihazın neden veri göndermediğini
-- anlamanın tek yolu da bu panel.
--
-- ÇÖZÜM: Varsayılan KAPALI. Gerektiğinde testçinin cihazında panelden açılır,
-- iş bitince kapatılır — uygulama güncellemesi gerekmez.
--
-- İSTEMCİ DAVRANIŞI: Bu alan okunamazsa (config hiç çekilememişse) panel
-- GİZLİ kalır. Yani güvenli yön "gösterme"dir; yeni kurulan bir cihazda panel
-- asla kendiliğinden belirmez.
--
-- SIRA: 20260805000000 bundan ÖNCE çalışmış olmalı.

alter table public.app_remote_config
  add column if not exists show_diagnostics_panel boolean not null default false;

comment on column public.app_remote_config.show_diagnostics_panel is
  'Shows the technical diagnostics panel in app settings. Off by default; turn on only while debugging a tester device.';

notify pgrst, 'reload schema';

-- ── KULLANIM ────────────────────────────────────────────────────────────────
-- Paneli aç (testçi cihazında teşhis gerekince):
--   update public.app_remote_config set show_diagnostics_panel = true where id = 1;
-- Kapat (varsayılan):
--   update public.app_remote_config set show_diagnostics_panel = false where id = 1;
--
-- Değişiklik cihaza en geç `config_poll_minutes` içinde iner; uygulama öne
-- geldiğinde de tazelenir. Panelin görünmesi için uygulamayı arka plana alıp
-- geri açmak yeterlidir.
--
-- NOT: `1` / `'1'` / `'true'` biçimleri de kabul edilir (istemci toleranslı
-- okur), ama Postgres boolean sütununa yazarken `true`/`false` ya da `'1'`/`'0'`
-- kullanın — çıplak `1` tip hatası verir.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.app_remote_config drop column if exists show_diagnostics_panel;
--   notify pgrst, 'reload schema';
--   -- İstemci sütunu bulamazsa varsayılana (gizli) düşer; kırılmaz.
