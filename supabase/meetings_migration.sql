-- Video meetings: the Head Admin can start a live call with any single
-- department, or a whole-community call (department_id = null). Department
-- heads and members can only join calls that match their own department
-- (or whole-community calls) — enforced server-side in api/meetings.js.
-- Actual video/audio runs through Daily.co (https://daily.co) — this table
-- only tracks metadata; the room itself lives on Daily's infrastructure.
--
-- Setup required: create a free Daily.co account, generate an API key
-- (Developers > API Keys in their dashboard), and add it to Vercel as the
-- DAILY_API_KEY environment variable. Nothing works until that's set.

create table if not exists public.department_meetings(
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade, -- null = whole-community meeting
  title text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  room_name text not null unique,
  status text not null default 'live' check (status in ('live','ended')),
  started_at timestamptz default now(),
  ended_at timestamptz
);

create index if not exists department_meetings_dept_idx on public.department_meetings(department_id);
create index if not exists department_meetings_status_idx on public.department_meetings(status);

alter table public.department_meetings enable row level security;
-- No anon/authenticated policies on purpose — every read/write goes through
-- /api/meetings.js with the service-role key, which enforces who can start,
-- join, or end a call.
grant all on public.department_meetings to service_role;
