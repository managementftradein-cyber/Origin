# Nestegg — Auth, Onboarding, Savings + Wallet

Real, running code for the app in the flowchart. Built with Next.js 15
(App Router) + Supabase + Paystack.

## What's here

```
app/
  page.tsx                      Splash screen
  auth/signup, auth/login, auth/verify    Sign up, log in, email OTP
  onboarding/profile/            Optional KYC step
  dashboard/
    page.tsx                    Home — real wallet balance + goal totals
    savings/                    List, create, and view savings goals
    wallet/                     Balance, add money (Paystack), transaction history
    wallet/callback/            Verifies a Paystack payment right after checkout
  api/
    paystack/initialize/        Starts a Paystack deposit
    paystack/webhook/           Verifies signature, credits wallet (source of truth)
    wallet/transfer-to-goal/    Moves money from wallet into a goal
    wallet/withdraw/            Moves money from a goal back into wallet
lib/
  supabase/client.ts, server.ts  Browser / server Supabase clients
  supabase/admin.ts              Service-role client (webhook + callback only)
  format.ts                      Kobo <-> naira helpers, currency formatting
supabase/
  schema.sql                     profiles table + RLS
  schema_savings_wallet.sql      wallets, savings_goals, wallet_transactions + RLS
```

## How money moves (important)

Every amount is stored in **kobo** (1 NGN = 100 kobo) to avoid float
rounding — the same unit Paystack's API uses.

Wallet balances and goal amounts are **never updated directly** by client
code. Three Postgres functions in `schema_savings_wallet.sql` are the only
way money moves:

- `credit_wallet` — called only by the service role (the Paystack webhook
  and the payment-callback page), never by a logged-in user's session.
  Idempotent on the Paystack reference, so a webhook retry or the callback
  page running right after the webhook never double-credits.
- `transfer_to_goal` / `withdraw_from_goal` — callable by the logged-in
  user, but use `auth.uid()` internally rather than trusting a client-passed
  user id, so no one can move funds on someone else's behalf.

Row Level Security on `wallets` and `savings_goals` grants **read-only**
access to authenticated users — there is deliberately no UPDATE policy, so
even a compromised or malicious client can't PATCH a balance directly
through the Supabase API. Only these functions (running with elevated
privileges) can.

## Setup

1. **Run the schema, in order.** In Supabase → SQL Editor:
   `supabase/schema.sql` → `supabase/schema_savings_wallet.sql` →
   `supabase/schema_otp.sql` → `supabase/schema_community.sql` →
   `supabase/schema_admin.sql` → `supabase/schema_notifications.sql` →
   `supabase/schema_bank_accounts.sql` → `supabase/schema_referral.sql` →
   `supabase/schema_rewards.sql`. These now include the `GRANT` statements
   a fresh project needs — see the note below if you're patching an
   already-running project instead of starting clean.

2. **Turn OFF "Confirm email."** In Supabase → Authentication → Providers →
   Email, disable "Confirm email." Verification is now handled entirely by
   your own `otp_codes` table and the `/api/otp/*` routes — Supabase's
   built-in confirmation would otherwise also try to gate sign-in and
   conflict with this flow. `signUp()` now returns an active session
   immediately; the middleware separately checks `profiles.email_verified`
   before letting anyone into `/onboarding` or `/dashboard`.

3. **Get a Resend account** (resend.com) for sending the email code, and a
   **Termii account** (termii.com) for the SMS code — or swap `lib/sms.ts`
   for whichever gateway you prefer.

4. **Get a Paystack account.** paystack.com → Settings → API Keys &
   Webhooks. Copy the **test secret key** for development, and set the
   webhook URL to `https://yourdomain.com/api/paystack/webhook`.

5. **Copy env vars.**
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in Supabase URL/anon key/service role key, `PAYSTACK_SECRET_KEY`,
   `RESEND_API_KEY` + `RESEND_FROM_EMAIL`, and `TERMII_API_KEY` +
   `TERMII_SENDER_ID`.

6. **Install and run.**
   ```bash
   npm install
   npm run dev
   ```

7. **Deploy.** Push to GitHub, Vercel picks it up from the repo root. Add
   all env vars in Vercel → Settings → Environment Variables.

## A gotcha worth knowing about

Tables created by running raw SQL in the Supabase SQL Editor do **not**
automatically get the table-level `GRANT`s that tables created through the
dashboard's Table Editor receive. RLS policies only control *which rows* a
role can see — the role still needs a base `GRANT` to touch the table at
all. Without it, Postgres rejects every query with `permission denied for
table X`, before RLS is ever evaluated. If you add a new table by hand
later, remember to also `grant select` (and `insert`/`update` as needed) to
`authenticated` — see `supabase/migration_grant_authenticated_privileges.sql`
for the pattern.

## A security fix you must run if you set this up before the Profile feature

**Run `supabase/migration_restrict_profile_column_updates.sql` now if you
haven't already.** The original grant on `profiles` gave `authenticated`
`UPDATE` on the whole table, which — unlike an RLS policy — silently
covers every column added later too, including `role`, `kyc_status`,
`email_verified`, and `phone_verified`. Until this migration is run, any
logged-in user could open the browser console and run
`supabase.from('profiles').update({ role: 'admin' })` on their own row and
grant themselves admin access, or fake their own KYC/verification status.
This is folded into `schema.sql` for fresh installs, but an
already-running project needs the migration applied by hand.

## How verification works now

Sign up → account is created (session starts immediately since Supabase's
own confirmation is off) → `/api/otp/request` generates a code server-side
and emails it via Resend → `/auth/verify` calls `/api/otp/verify`, which
flips `profiles.email_verified` → middleware lets the user past
`/onboarding` and `/dashboard` only once that flag is true. Phone
verification works the same way, offered as an optional step inside
onboarding, sent via Termii.

## Testing a deposit

Paystack's test mode accepts card `4084 0840 8408 4081`, any future expiry,
any CVV, OTP `123456`. After checkout you'll land on
`/dashboard/wallet/callback`, which verifies the transaction and credits
your wallet immediately — the webhook then fires separately and is a safe
no-op since crediting is idempotent.

## What community forum adds

`supabase/schema_community.sql` — posts, comments, likes, groups, and a
weekly savings leaderboard view. Like/comment counts are kept accurate by
database triggers rather than app-level increments, so two people liking
the same post at once can't corrupt the count. RLS lets any signed-in user
read everything, but only the author of a post/comment can delete it, and
only the security-definer triggers can touch the like/comment counters —
matching the same pattern used everywhere else in this project.

```
app/dashboard/community/
  page.tsx              Feed — posts, group chips, weekly leaderboard
  new/                  Create a post, optionally to a group
  [postId]/             Post detail with comments
  group-chips.tsx        Join/leave a community group
  like-button.tsx         Optimistic like toggle
app/api/community/
  posts/                 Create a post
  posts/[postId]/like     Toggle a like
  posts/[postId]/comments Add a comment
  groups/[groupId]/join   Toggle group membership
```

## What the admin panel adds

`supabase/schema_admin.sql` — adds a `role` column to `profiles`
(`'user'` or `'admin'`), settable **only** via a manual `UPDATE` in the SQL
editor — there's no signup flow, API route, or UI button that can ever
grant it. Admin routes check the caller's own role via their normal
session (`lib/admin-auth.ts`), then do the actual privileged read/write
through the service-role client — rather than adding RLS policies that
would let any authenticated session query everyone's rows directly.

```
app/admin/
  page.tsx               Overview — user counts, KYC queue, totals under management
  users/                 Full user list, filterable by pending KYC
  users/[userId]/         Profile detail + approve/reject KYC
  community/              Moderation — delete any post
app/api/admin/
  users/[userId]/kyc/     Approve/reject a user's KYC
  community/posts/[id]/   Admin delete for any post
lib/admin-auth.ts          Shared requireAdminUser() check
```

**To make yourself an admin**, after running `schema_admin.sql`, run in the
SQL editor:
```sql
update public.profiles set role = 'admin' where id = '<your-user-uuid>';
```
Find your ID with the query in the comments at the bottom of that file.
Then visit `/admin` — ordinary users get redirected straight back to
`/dashboard` if they try.

## What notifications adds

`supabase/schema_notifications.sql` — a `notifications` table, populated
entirely by database triggers on tables that already exist, not by app
code calling an insert after the fact (so a notification can never happen
without the real event, and can't be faked by calling an API directly):

- A deposit or goal withdrawal lands in `wallet_transactions` → trigger
  fires → notification created.
- Someone comments or likes your community post → trigger fires →
  notification created (skips your own likes/comments on your own post).
- A daily cron job (`/api/cron/savings-reminders`, scheduled in
  `vercel.json`) finds users with an active goal who haven't transferred
  anything to it in 7+ days and haven't already been reminded in the last
  7, creates an in-app notification, and sends a nudge email via Resend.

Marking a notification read goes through a column-restricted grant —
same pattern as the profile security fix — so a user can flip their own
`read_at` but can never rewrite a notification's title or body.

```
components/notification-bell.tsx   Bell icon with live unread-count dot
app/dashboard/notifications/       Full list, mark-as-read
app/api/notifications/              Mark one / mark all read
app/api/cron/savings-reminders/     Scheduled reminder job
```

**Setup**: run `supabase/schema_notifications.sql`, add `CRON_SECRET` to
your env vars (Vercel sends it automatically as the cron job's auth
header — see `.env.local.example`). Note: Vercel's free Hobby plan only
runs cron jobs once a day, which is exactly what this one needs, so no
upgrade required.

## What bank account linking + withdrawals adds

Until now, money could come INTO the platform (Paystack deposits) but
never actually leave it — `withdraw_from_goal` only moved money from a
goal back into the in-app wallet. `supabase/schema_bank_accounts.sql`
adds real payouts via Paystack Transfers.

Because this is the first flow where money genuinely leaves the platform,
the sequencing is deliberately conservative:

1. **Reserve first** — `reserve_withdrawal()` deducts the wallet balance
   and creates a `'pending'` ledger row *before* any Paystack API call.
   The balance can never reflect money that's simultaneously gone from the
   wallet and never sent.
2. **Attempt the transfer** — `/api/wallet/withdraw-to-bank` calls
   Paystack's transfer API. If that call fails outright (network error,
   Paystack rejects it, or the account has OTP-for-transfers enabled,
   which a customer-facing flow can't complete), the reservation is
   refunded immediately via `resolve_withdrawal(..., false)`.
3. **Webhook resolves it** — `transfer.success` / `transfer.failed` /
   `transfer.reversed` events are the actual source of truth, matched by
   the transaction's own ID (passed as Paystack's `reference` when
   initiating). A refund on failure, a confirmation on success.

Adding a bank account requires Paystack to resolve the account number to
a real account name first (`/api/bank-accounts/resolve`) — you can't save
an account you haven't verified actually exists. Withdrawals also require
`kyc_status = 'verified'`, enforced inside `reserve_withdrawal()` itself,
not just in the UI.

```
app/dashboard/wallet/bank-accounts/  List, add (with verification), remove
app/dashboard/wallet/withdraw/       Withdraw to a linked account
app/api/banks/                        Bank list for the dropdown
app/api/bank-accounts/                Resolve, create, delete
app/api/wallet/withdraw-to-bank/      Reserve + initiate transfer
```

**One Paystack setting to check**: Settings → Preferences → Transfers —
make sure OTP-for-transfers is OFF, or every withdrawal will fail with
the OTP error message above (that OTP goes to the business's registered
phone, which a customer flow has no way to enter).

Every planned slice from the original flowchart is now built, plus this
refinement. From here it's whatever surfaces as you actually use it —
a referral system, badges/rewards, or fixes to anything above.

## Design system: dark mode + desktop layout

Colors that mean "surface, text, border, background" are now CSS
variables (`app/globals.css`), switched by a `.dark` class on `<html>` —
so `bg-surface`, `text-navy`, `text-ink`, `border-line` etc. automatically
flip everywhere they're used, with zero changes needed to individual
pages. Brand accents (`blue`, `blue-deep`, `success`, `amber`, and a
static `brand-navy` reserved for gradients) stay constant across both
themes.

- `components/theme-toggle.tsx` — the switch, in Profile → Dark mode.
  Preference is saved to `localStorage` and applied via an inline script
  in `app/layout.tsx` that runs before paint, so there's no flash of the
  wrong theme on load.
- `components/app-shell.tsx` — on screens wider than ~900px, the app
  renders as a fixed-width (440px) card centered on a soft decorative
  background, instead of stretching full-bleed. Applied to
  `/dashboard/*`, `/auth/*`, and `/onboarding/*` layouts. **Deliberately
  NOT applied to `/admin`**, which is meant to use the full desktop width
  like a normal web app, not the phone-width shell.
- The splash page (`app/page.tsx`) gets its own full-bleed two-column
  treatment on desktop — marketing copy and feature highlights on the
  left, the sign-up/log-in card on the right — rather than being
  squeezed into the phone-width shell, since a landing page benefits from
  more room to make the case for the app.

## What the referral program adds

`supabase/schema_referral.sql` — every profile gets a short referral code
(auto-generated, `profiles.referral_code`). The reward — ₦500 — fires on
the **referred person's first successful deposit**, not on signup alone;
rewarding signup would be trivially gameable (create accounts, refer
yourself), while requiring real money to move means they actually became
a user. A referral code can be captured via a `?ref=CODE` link
(`/dashboard/referral` has a one-tap copy button for exactly this) or
typed in manually on the signup form.

## What rewards & badges adds

`supabase/schema_rewards.sql` — six badges, all awarded automatically by
database triggers on events that were already happening (first deposit,
first goal created, a goal fully funded, KYC verified, first community
post, first successful referral) — never by app code manually granting
one, so a badge can't be faked by calling an API directly. `/dashboard/rewards`
shows all badges, locked ones dimmed with a 🔒 until earned.

## Where KYC actually stands

Worth being direct about this: KYC today is **self-attested and manually
reviewed**, not real identity verification. A user taps "Start KYC," that
sets `kyc_status = 'pending'`, and an admin approves or rejects it from
`/admin/users/[userId]` — there's no BVN/NIN check, no document upload,
no liveness/selfie match. That's enough to gate bank withdrawals behind
*some* review step, but it is not regulatory-grade KYC for a real
fintech product.

Real KYC would mean integrating a verification provider — Paystack has
BVN/NIN verification endpoints, or dedicated Nigerian KYC providers like
Dojah, YouVerify, or Smile Identity offer document + selfie + liveness
checks. That's a meaningfully sized feature on its own (provider account,
document storage considerations, a review queue that shows the actual
submitted documents to an admin) — worth doing deliberately rather than
folded into an unrelated request. Say the word when you want to build it
and we'll scope it properly.

## Required Supabase privilege migration

If a server-side onboarding/profile request reports `42501 permission denied for table profiles` while the database says the current role is `service_role`, run:

`supabase/migration_service_role_profiles_grants.sql`

This grants the trusted `service_role` the minimum `profiles` table privileges required by the server-side onboarding route. It does not grant browser users direct write access and does not disable RLS.
