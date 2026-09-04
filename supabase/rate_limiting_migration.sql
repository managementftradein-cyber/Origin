-- Rate limiting store used by api/_supabase.js's checkRateLimit() helper.
-- A fixed-window counter per (key, window) — good enough to stop scripted
-- form-spam and brute-force attempts without needing an external Redis
-- service. Called from the contact form, subscribe form, prayer requests,
-- and invite redemption endpoints.

create table if not exists public.rate_limit_hits(
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (bucket_key, window_start)
);

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limit_hits(bucket_key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start) do update set count = public.rate_limit_hits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup so this table never grows unbounded. Best-effort;
  -- fine if it occasionally skips a cycle.
  delete from public.rate_limit_hits where window_start < now() - interval '1 day';

  return v_count <= p_limit;
end;
$$;

alter table public.rate_limit_hits enable row level security;
grant all on public.rate_limit_hits to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
