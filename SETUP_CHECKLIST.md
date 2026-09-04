# TCC Deployment Setup Checklist

Everything below is new since your last deploy: roles/departments, invite-only
signup, video meetings, and security hardening. Work through it top to
bottom — order matters for the SQL files.

## 1. Run these SQL files in Supabase (SQL Editor), in this order

1. `supabase/roles_departments_migration.sql` — department heads, invites, suspension
2. `supabase/community_schema_patch.sql` — fixes the `image_url`/`is_hidden`/bucket errors
3. `supabase/meetings_migration.sql` — video meeting tracking table
4. `supabase/rate_limiting_migration.sql` — spam/bot protection backend
5. `supabase/backups_migration.sql` — private bucket for automated backups

All five are safe to re-run if you're ever unsure whether one went through —
they use `if not exists` / `on conflict` throughout.

## 2. Add these environment variables in Vercel (Project → Settings → Environment Variables)

| Variable | Where to get it | Required for |
|---|---|---|
| `DAILY_API_KEY` | Free account at [daily.co](https://daily.co) → Dashboard → Developers → API Keys | Video meetings |
| `CRON_SECRET` | Any random string you generate yourself (e.g. `openssl rand -hex 32`) | Locking down the automated backup endpoint |

Your existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY`, and `ADMIN_EMAILS` should already be set from before — no change needed there.

After adding env vars, **redeploy** — Vercel doesn't pick up new env vars on already-running deployments.

## 3. Manual account setup (I can't do these for you)

- **Daily.co** — sign up free, generate the API key for step 2 above. Free tier covers reasonable meeting usage for a church-sized community; you'll only need to pay if usage grows a lot.
- **Cloudflare (recommended, not required)** — for the WAF/DDoS layer we discussed. Sign up free, add your domain, switch your domain's nameservers to Cloudflare's, turn on proxying (orange cloud) for your site. About 15 minutes, and it sits in front of Vercel without any code changes.

## 4. Quick test pass after deploying

- [ ] Log in as Head Admin → `/admin` → Community Roles → confirm you can see members and departments
- [ ] Generate an invite link for a department → open it in a private/incognito window → confirm the signup form shows the right department name
- [ ] Promote a test member to Department Head → log in as them at `/dept-admin` → confirm they only see their own department
- [ ] Suspend a test member → confirm they're blocked from signing back in
- [ ] Start a test meeting (any department) → confirm the "Join" button opens a working Daily.co room
- [ ] Submit the contact form 6 times quickly → confirm the 6th attempt is rate-limited
- [ ] Wait for the next 3am UTC backup run, then check `/admin` → System (or `/api/system?type=backups` while signed in as admin) → confirm a backup file appears

## 5. What's still outside this codebase

- Formal third-party penetration test (recommendation only — not something I can perform)
- Cloudflare WAF setup itself (DNS-level, has to be done in your Cloudflare/domain registrar accounts)
- Upgrading Vercel/Supabase to paid tiers if you're expecting >500 concurrent visitors or need backups beyond what's built here
