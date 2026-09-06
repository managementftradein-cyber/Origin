-- Nestegg: self-managed OTP (email + phone)
-- Run this AFTER schema.sql and schema_savings_wallet.sql.
--
-- This replaces reliance on Supabase Auth's built-in email-confirmation OTP.
-- Codes are generated and verified here; sending them (via Resend for email,
-- an SMS gateway for phone) happens in the Next.js API routes, using the
-- service-role client, never directly from the browser.

create extension if not exists pgcrypto with schema extensions;

-- 1. Track verification state on the profile ------------------------------
alter table public.profiles
  add column if not exists email_verified boolean not null default false,
  add column if not exists phone_verified boolean not null default false;

-- 2. OTP codes table --------------------------------------------------------
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'phone')),
  destination text not null, -- the email address or E.164 phone number
  purpose text not null default 'signup'
    check (purpose in ('signup', 'login', 'password_reset', 'phone_change')),
  code_hash text not null,   -- never store the raw code
  expires_at timestamptz not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.otp_codes is 'Self-managed OTP codes. Codes are hashed at rest and returned in plaintext ONLY once, by request_otp(), for the caller to send via email/SMS.';

create index if not exists otp_codes_lookup_idx
  on public.otp_codes (destination, purpose, created_at desc);

-- 3. Request a new code -----------------------------------------------------
-- Rate-limited: one code per 60 seconds per destination+purpose, max 5 per
-- rolling hour. Returns the raw 6-digit code — the ONLY place it ever
-- appears in plaintext — so the caller (a server-only API route) can send
-- it. Only the service role may call this; see grants below.
create or replace function public.request_otp(
  p_user_id uuid,
  p_channel text,
  p_destination text,
  p_purpose text default 'signup'
) returns table(code text, otp_id uuid) as $$
declare
  v_last_created timestamptz;
  v_recent_count int;
  v_code text;
  v_id uuid;
begin
  select created_at into v_last_created
    from public.otp_codes
    where destination = p_destination and purpose = p_purpose
    order by created_at desc
    limit 1;

  if v_last_created is not null and v_last_created > now() - interval '60 seconds' then
    raise exception 'Please wait before requesting another code.';
  end if;

  select count(*) into v_recent_count
    from public.otp_codes
    where destination = p_destination
      and purpose = p_purpose
      and created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then
    raise exception 'Too many code requests. Try again in an hour.';
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  v_id := gen_random_uuid();

  insert into public.otp_codes (id, user_id, channel, destination, purpose, code_hash, expires_at)
  values (
    v_id, p_user_id, p_channel, p_destination, p_purpose,
    extensions.crypt(v_code, extensions.gen_salt('bf')),
    now() + interval '10 minutes'
  );

  return query select v_code, v_id;
end;
$$ language plpgsql security definer set search_path = public, extensions;

-- 4. Verify a code -----------------------------------------------------------
-- Consumes the most recent unexpired, unconsumed code for the destination.
-- Wrong codes increment an attempts counter; 5 wrong attempts locks that
-- code (a new one must be requested). On success, marks the profile's
-- email_verified / phone_verified flag.
create or replace function public.verify_otp(
  p_destination text,
  p_purpose text,
  p_code text
) returns table(success boolean, user_id uuid, message text) as $$
declare
  v_row public.otp_codes%rowtype;
begin
  select * into v_row
    from public.otp_codes
    where destination = p_destination
      and purpose = p_purpose
      and consumed_at is null
    order by created_at desc
    limit 1
    for update;

  if v_row.id is null then
    return query select false, null::uuid, 'No active code — request a new one.';
    return;
  end if;

  if v_row.expires_at < now() then
    return query select false, null::uuid, 'That code has expired — request a new one.';
    return;
  end if;

  if v_row.attempts >= v_row.max_attempts then
    return query select false, null::uuid, 'Too many attempts — request a new code.';
    return;
  end if;

  if extensions.crypt(p_code, v_row.code_hash) <> v_row.code_hash then
    update public.otp_codes set attempts = attempts + 1 where id = v_row.id;
    return query select false, null::uuid, 'Incorrect code.';
    return;
  end if;

  update public.otp_codes set consumed_at = now() where id = v_row.id;

  if v_row.channel = 'email' then
    update public.profiles set email_verified = true where id = v_row.user_id;
  elsif v_row.channel = 'phone' then
    update public.profiles set phone_verified = true where id = v_row.user_id;
  end if;

  return query select true, v_row.user_id, 'Verified.';
end;
$$ language plpgsql security definer set search_path = public, extensions;

-- 5. Housekeeping: clear out old codes ---------------------------------------
create or replace function public.cleanup_expired_otps() returns void as $$
begin
  delete from public.otp_codes
    where expires_at < now() - interval '1 day';
end;
$$ language plpgsql security definer set search_path = public;
-- Optional: schedule with pg_cron, e.g.
--   select cron.schedule('cleanup-otps', '0 3 * * *', 'select public.cleanup_expired_otps()');

-- 6. RLS ----------------------------------------------------------------------
-- otp_codes holds hashed codes and destinations — no client, authenticated
-- or anonymous, should ever query it directly. Enabling RLS with zero
-- policies denies all access except to the service role and to the
-- SECURITY DEFINER functions above.
alter table public.otp_codes enable row level security;

-- 7. Grants ---------------------------------------------------------------
-- request_otp returns a raw code in plaintext — restrict it to the service
-- role (called only from server-only API routes, never client-side).
grant execute on function public.request_otp(uuid, text, text, text) to service_role;
revoke execute on function public.request_otp(uuid, text, text, text) from authenticated, anon;

-- verify_otp doesn't leak the code and is rate-limited by attempts, but
-- still keep it server-only for consistent IP-level rate limiting in the
-- API route rather than direct client calls.
grant execute on function public.verify_otp(text, text, text) to service_role;
revoke execute on function public.verify_otp(text, text, text) from authenticated, anon;
