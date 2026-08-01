delete from public.notification_location_diagnostics
where notification_id like 'smoke-test-%'
  and device_name = 'Codex smoke test';
