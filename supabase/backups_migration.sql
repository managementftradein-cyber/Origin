-- Private storage bucket for automated daily backups (see api/cron-backup.js).
-- Unlike the 'gallery' and 'community' buckets, this one is NOT public —
-- backups contain full table dumps and should only ever be reachable via
-- signed URLs generated for the Head Admin (see /api/system?type=backups).

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;

-- No storage.objects policy is created for this bucket on purpose: all
-- access goes through the service-role key (cron-backup.js writes, and
-- system.js's admin-only handler signs short-lived download URLs).
