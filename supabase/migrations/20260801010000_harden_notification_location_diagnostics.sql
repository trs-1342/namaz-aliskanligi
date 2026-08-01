delete from public.notification_location_diagnostics
where notification_id like 'smoke-test-%'
  and device_name = 'Codex smoke test';

alter table public.notification_location_diagnostics
  add constraint diagnostics_device_name_size check (device_name is null or octet_length(device_name) <= 256),
  add constraint diagnostics_device_manufacturer_size check (device_manufacturer is null or octet_length(device_manufacturer) <= 128),
  add constraint diagnostics_device_model_size check (device_model is null or octet_length(device_model) <= 128),
  add constraint diagnostics_device_locale_size check (device_locale is null or octet_length(device_locale) <= 64),
  add constraint diagnostics_device_timezone_size check (device_timezone is null or octet_length(device_timezone) <= 128),
  add constraint diagnostics_operating_system_size check (operating_system is null or octet_length(operating_system) <= 64),
  add constraint diagnostics_operating_system_version_size check (operating_system_version is null or octet_length(operating_system_version) <= 64),
  add constraint diagnostics_app_version_size check (app_version is null or octet_length(app_version) <= 64),
  add constraint diagnostics_app_build_version_size check (app_build_version is null or octet_length(app_build_version) <= 64),
  add constraint diagnostics_notification_id_size check (octet_length(notification_id) <= 256);

revoke all on sequence public.notification_location_diagnostics_id_seq from public, anon, authenticated;
grant usage on sequence public.notification_location_diagnostics_id_seq to anon;
