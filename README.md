# The Christocentric Church — v8

Clean Vercel + Supabase deployment package.

## Project structure
- `index.html` — public website
- `admin/index.html` — admin dashboard
- `api/*.js` — Vercel serverless API functions
- `supabase/tcc_v8_safe_migration.sql` — safe database additions

## Vercel
Import the GitHub repository with the files at repository root.
Use:
- Framework Preset: Other
- Root Directory: `.`
- Build Command: empty
- Output Directory: empty
- Install Command: `npm install`

No custom `vercel.json` is required. Vercel should serve `index.html` and deploy every `api/*.js` file as a serverless function.

## Environment variables
Set these in Vercel:
- SUPABASE_URL
- SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_EMAILS

`ADMIN_EMAILS` must contain the exact Supabase Auth email allowed to use `/admin/`.

## Supabase
Run only `supabase/tcc_v8_safe_migration.sql` if you have not already run the equivalent v7 migration. It is written with IF NOT EXISTS for the v8 additions.
