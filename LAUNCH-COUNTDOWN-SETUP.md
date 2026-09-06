# TCC Launch Countdown

1. Run `supabase/launch_countdown_migration.sql` once in Supabase SQL Editor.
2. Deploy the project.
3. Sign into `/admin`.
4. Open **Church Settings → Launch Countdown**.
5. Enable the countdown, choose the launch date/time, edit the messages, and save.

When enabled with a future launch date, the public site displays the cinematic blue launch screen. At zero it changes to the configured live message. Disable the setting at any time to return to the normal site.

The selected local browser date/time is converted to an ISO UTC timestamp before saving. The timezone label defaults to `Africa/Lagos` and controls how the launch date is displayed.
