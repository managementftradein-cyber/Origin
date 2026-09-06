# Supabase repair / setup order

Run the following in **Supabase → SQL Editor**:

1. `supabase/schema.sql` (if your base tables have not already been created)
2. `supabase/tcc_v8_safe_migration.sql` (if the site's v8 additions have not already been applied)
3. `supabase/roles_departments_migration.sql` (if Community roles/invites have not already been applied)
4. `supabase/community_schema_patch.sql` — **run this last**. It is the defensive repair migration and is safe to run repeatedly.

The Community repair migration specifically addresses:

- missing `community_posts.is_hidden`
- missing `community_posts.image_url`
- missing `public.community_comments`
- missing `community_comments.is_hidden`
- missing Community Storage bucket/policies
- missing `profiles` columns used by the Community API
- stale PostgREST schema cache (`NOTIFY pgrst, 'reload schema'`)

It also creates `giving_accounts`, which powers the **Admin → Giving → Offering Accounts** editor and the public `/give` page.

## Giving / Offering

In **Admin → Giving**, click **Add Account** and enter the bank, account name, account number, currency and optional instructions. Only accounts marked active are shown publicly.

## One-time invite links

Invite links are now generated with 256 bits of randomness and are claimed atomically. A link changes from `pending` to `processing` before account creation and then to `used` after successful redemption. This prevents two simultaneous requests from redeeming the same link.

If account creation fails, the invite is returned to `pending` so it can be tried again. Once it reaches `used`, it cannot be reused.

## Security hardening

After the existing migrations, run `supabase/security_hardening_migration.sql`. It closes direct profile-role escalation, removes blanket browser table privileges, removes direct community storage write policies, and aligns the deployed database with the hardened API.
