-- TCC launch countdown settings
-- Safe to run once; does not remove existing data.
alter table public.church_settings
  add column if not exists launch_enabled boolean not null default false,
  add column if not exists launch_date timestamptz,
  add column if not exists launch_title text default 'THE ORIGIN IS NEAR',
  add column if not exists launch_subtitle text default 'Christ at the centre. Everything else follows.',
  add column if not exists launch_complete_title text default 'WE ARE LIVE',
  add column if not exists launch_complete_body text default 'Welcome to The Christocentric Church.',
  add column if not exists launch_timezone text default 'Africa/Lagos';
update public.church_settings set launch_title=coalesce(launch_title,'THE ORIGIN IS NEAR'), launch_subtitle=coalesce(launch_subtitle,'Christ at the centre. Everything else follows.'), launch_complete_title=coalesce(launch_complete_title,'WE ARE LIVE'), launch_complete_body=coalesce(launch_complete_body,'Welcome to The Christocentric Church.'), launch_timezone=coalesce(launch_timezone,'Africa/Lagos') where id=1;
insert into public.church_settings(id,launch_enabled,launch_title,launch_subtitle,launch_complete_title,launch_complete_body,launch_timezone) values(1,false,'THE ORIGIN IS NEAR','Christ at the centre. Everything else follows.','WE ARE LIVE','Welcome to The Christocentric Church.','Africa/Lagos') on conflict(id) do nothing;
notify pgrst, 'reload schema';
