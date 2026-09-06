# The Christocentric Church — v9

Clean Vercel + Supabase deployment package.

## Project structure
- `index.html` — public website (single-page app for Home/About/Programs/Partnership/College/Give/Contact)
- `news.html`, `live.html`, `prophetic-room.html`, `community.html` — standalone feature pages linked from the "TCC Hub" nav
- `admin/index.html` — admin dashboard
- `api/*.js` — Vercel serverless API functions
- `supabase/tcc_v8_safe_migration.sql` — safe database additions (news, prophetic room, live status, etc.)
- `supabase/community_schema.sql` — Community platform tables (profiles, posts, comments, likes)
- `supabase/community_schema_patch.sql` — defensive repair plus Community Storage, Giving/Offering accounts, and one-time invite-link safeguards

## Vercel
Import the GitHub repository with the files at repository root.
Use:
- Framework Preset: Other
- Root Directory: `.`
- Build Command: empty
- Output Directory: empty
- Install Command: `npm install`

This project ships with a `vercel.json` that is required — it rewrites clean
URLs like `/about`, `/contact` and `/give` to `index.html` (so the client-side
router can render them) and maps friendly API paths (e.g. `/api/events`) to
the consolidated handler functions in `api/*.js`.

## Environment variables
Set these in Vercel:
- SUPABASE_URL
- SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_EMAILS

`ADMIN_EMAILS` must contain the exact Supabase Auth email(s) allowed to use `/admin/`.

## Supabase
Run `supabase/tcc_v8_safe_migration.sql` if you have not already run the equivalent v7 migration (news, prophetic room, live status, etc. — written with IF NOT EXISTS/safe upserts).

Then run `supabase/community_schema.sql` to add the Community platform tables
(`profiles`, `community_posts`, `community_comments`, `community_likes`) with
row-level security policies. This is also safe to run more than once.

## Community platform
`community.html` is a members' social feed. Accounts are created through one-time
invite links issued from **Admin → Community Roles**. Posts and comments are
public-read by default; each member can only edit or delete their own content.
Church staff can hide or delete any post/comment from **Admin → Community
Posts / Community Comments**. See `SUPABASE-REPAIR-ORDER.md` for the repair
and migration order.

## Integrated updates
- Admin Giving/Offering accounts are managed from the Admin dashboard and published to the public Give page.
- Community invite redemption is race-safe and one-time; rate limiting and honeypot protection are included.
- Live department/community video meetings are included; configure `DAILY_API_KEY` in Vercel and run `supabase/meetings_migration.sql`.
- Automated backup support and rate-limit storage migrations are included.
- See `SUPABASE-REPAIR-ORDER.md` and `SETUP_CHECKLIST.md` before deployment.
